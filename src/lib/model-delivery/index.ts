import {
  getArtifactKey,
  getArtifactUrl,
  getModelDeliveryManifest,
  MODEL_SEGMENT_SIZE,
  type ModelDeliveryArtifact,
  type ModelDeliveryManifest
} from "@/lib/model-delivery/manifest";
import {
  createArtifactStateStore,
  deleteModelStorage,
  getAllArtifactStates,
  getArtifactFileSize,
  openArtifactFile,
  supportsPersistentModelDelivery
} from "@/lib/model-delivery/opfs-store";
import {
  getManifestBytes,
  inspectModelCache,
  isReadyArtifactState
} from "@/lib/model-delivery/cache-status";
import {
  downloadRangeArtifact,
  probeRangeArtifact,
  RangeDeliveryUnavailableError,
  type ArtifactDownloadState,
  type DeliveryProgress
} from "@/lib/model-delivery/range-downloader";
import { deleteAuxiliaryArtifacts, ensureAuxiliaryArtifact } from "@/lib/model-delivery/auxiliary-cache";
import {
  addModelStorageEstimate,
  InsufficientModelStorageError,
  ModelDeliveryUnavailableError,
  toModelStorageError
} from "@/lib/model-delivery/errors";

type DeliveryModel = {
  id: string;
  source: { kind: "local"; baseUrl: string; revision: "bundled" } | { kind: "huggingface"; repo: string; revision: string };
};

export type PreparedModelDelivery = {
  externalData: { path: string; data: File }[];
  totalBytes: number;
};

const inFlightArtifacts = new Map<string, Promise<File>>();
const MINIMUM_PROBE_STATE_MS = 700;

export async function prepareModelDelivery(
  model: DeliveryModel,
  onProgress: (progress: DeliveryProgress) => void = () => undefined,
  signal?: AbortSignal
): Promise<PreparedModelDelivery | null> {
  const manifest = getModelDeliveryManifest(model.id);
  if (!manifest || model.source.kind !== "huggingface" || model.source.repo !== manifest.repo || model.source.revision !== manifest.revision) return null;
  if (!supportsPersistentModelDelivery()) {
    throw new ModelDeliveryUnavailableError("This browser cannot securely store and resume Sophon's multi-gigabyte model files.");
  }

  return withModelLock(manifest.modelId, "shared", async () => {
    throwIfAborted(signal);
    const totalBytes = getManifestBytes(manifest);
    const states = await getAllArtifactStates();
    await ensureStorageHeadroom(manifest, totalBytes, states);
    const probeStartedAt = now();
    onProgress({ loaded: 0, total: totalBytes, stage: "probe" });

    let probes: { artifact: ModelDeliveryArtifact; etag: string }[];
    try {
      const stateByKey = new Map(states.map((state) => [state.key, state]));
      probes = await Promise.all(manifest.externalData.map(async (artifact) => {
        const key = getArtifactKey(manifest, artifact);
        const state = stateByKey.get(key);
        const fileSize = await getArtifactFileSize(manifest, artifact);
        if (isReadyArtifactState(state, artifact, fileSize)) {
          return { artifact, etag: state.etag };
        }
        return {
          artifact,
          ...(await probeRangeArtifact({
            key,
            url: getArtifactUrl(manifest, artifact),
            size: artifact.size,
            sha256: artifact.sha256
          }, { signal }))
        };
      }));
      const remainingProbeStateMs = MINIMUM_PROBE_STATE_MS - (now() - probeStartedAt);
      if (remainingProbeStateMs > 0) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, remainingProbeStateMs));
    } catch (error) {
      if (error instanceof RangeDeliveryUnavailableError) {
        throw new ModelDeliveryUnavailableError("The model host cannot provide the strong, resumable byte ranges Sophon requires.", { cause: error });
      }
      throw error;
    }

    const aggregate = createAggregateProgress(manifest, onProgress);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    let primaryError: unknown;
    try {
      const external = probes.map(({ artifact, etag }) => ensureArtifact(
        manifest,
        artifact,
        etag,
        aggregate.update(artifact.path),
        controller.signal
      ));
      const auxiliary = manifest.auxiliary.map((artifact) => ensureAuxiliaryArtifact(
        manifest,
        artifact,
        aggregate.update(artifact.path),
        controller.signal
      ));
      const tasks = [...external, ...auxiliary].map((task) => task.catch((error) => {
        if (primaryError === undefined) {
          primaryError = error;
          controller.abort(error);
        }
        throw error;
      }));
      const results = await Promise.allSettled(tasks);
      if (primaryError !== undefined) throw primaryError;
      const files = results.slice(0, external.length).map((result, index) => ({
        path: manifest.externalData[index]!.externalPath,
        data: (result as PromiseFulfilledResult<File>).value
      }));
      aggregate.complete();
      return { externalData: files, totalBytes };
    } catch (error) {
      throw await addModelStorageEstimate(toModelStorageError(error));
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }, signal);
}

export async function deleteModelCache(modelId: string, signal?: AbortSignal) {
  const model = getModelDeliveryManifest(modelId);
  if (!model) throw new Error(`Unknown model identifier: ${modelId}`);
  try {
    await withModelLock(model.modelId, "exclusive", async () => {
      throwIfAborted(signal);
      await deleteAuxiliaryArtifacts(model);
      await deleteModelStorage(model);
    }, signal);
  } catch (error) {
    throw await addModelStorageEstimate(error);
  }
  return { modelId, deleted: true as const };
}

async function ensureArtifact(
  model: ModelDeliveryManifest,
  artifact: ModelDeliveryArtifact,
  etag: string,
  onProgress: (progress: DeliveryProgress) => void,
  signal?: AbortSignal
) {
  const key = getArtifactKey(model, artifact);
  const existing = inFlightArtifacts.get(key);
  if (existing) return existing;
  const loading = withArtifactLock(key, async () => {
    const opened = await openArtifactFile(model, artifact);
    try {
      return await downloadRangeArtifact({
        artifact: {
          key,
          url: getArtifactUrl(model, artifact),
          size: artifact.size,
          sha256: artifact.sha256,
          segmentSha256: artifact.segmentSha256
        },
        file: opened.file,
        stateStore: createArtifactStateStore(),
        segmentSize: MODEL_SEGMENT_SIZE,
        onProgress,
        signal,
        etag
      });
    } finally {
      opened.close();
    }
  }, signal).finally(() => inFlightArtifacts.delete(key));
  inFlightArtifacts.set(key, loading);
  return loading;
}

export async function ensureStorageHeadroom(model: ModelDeliveryManifest, totalBytes: number, states: ArtifactDownloadState[]) {
  const summary = await inspectModelCache(model, states);
  const estimate = await navigator.storage.estimate?.().catch(() => null);
  if (!estimate || estimate.quota === undefined || estimate.usage === undefined) return;
  const required = Math.max(0, totalBytes - summary.resumableBytes);
  const available = Math.max(0, estimate.quota - estimate.usage);
  if (required > available) throw new InsufficientModelStorageError(required, available);
}

function createAggregateProgress(model: ModelDeliveryManifest, publish: (progress: DeliveryProgress) => void) {
  const minimumPublishBytes = 2 * 1024 * 1024;
  const minimumPublishIntervalMs = 100;
  const maximumPublishIntervalMs = 500;
  const artifacts = [...model.externalData, ...model.auxiliary];
  const entries = new Map<string, DeliveryProgress>(artifacts.map((artifact) => [artifact.path, {
    loaded: 0,
    total: artifact.size,
    stage: "download",
    resumedBytes: 0,
    networkBytes: 0
  }]));
  const startedAt = now();
  let lastPublishedLoaded = 0;
  let lastStage = "";
  let lastPublishedAt = 0;
  const emit = (force = false) => {
    const values = [...entries.values()];
    const loaded = values.reduce((total, progress) => total + progress.loaded, 0);
    const total = values.reduce((sum, progress) => sum + progress.total, 0);
    const resumedBytes = values.reduce((sum, progress) => sum + (progress.resumedBytes ?? 0), 0);
    const networkBytes = values.reduce((sum, progress) => sum + (progress.networkBytes ?? 0), 0);
    const stage = values.some((progress) => progress.stage === "resume")
      ? "resume"
      : values.some((progress) => progress.stage === "download")
        ? "download"
        : values.some((progress) => progress.stage === "verify")
          ? "verify"
          : "cache";
    const elapsedSeconds = Math.max(0, now() - startedAt) / 1000;
    const bytesPerSecond = elapsedSeconds > 0 && networkBytes > 0 ? networkBytes / elapsedSeconds : undefined;
    const observedAt = now();
    const elapsedSincePublish = observedAt - lastPublishedAt;
    const newlyVisibleBytes = Math.max(0, loaded - lastPublishedLoaded);
    if (!force
      && stage === lastStage
      && elapsedSincePublish < maximumPublishIntervalMs
      && (elapsedSincePublish < minimumPublishIntervalMs || newlyVisibleBytes < minimumPublishBytes)) return;
    lastPublishedLoaded = loaded;
    lastStage = stage;
    lastPublishedAt = observedAt;
    publish({
      loaded,
      total,
      stage,
      resumedBytes,
      networkBytes,
      ...(bytesPerSecond === undefined ? {} : { bytesPerSecond, etaMs: Math.max(0, total - loaded) / bytesPerSecond * 1000 })
    });
  };
  return {
    update(path: string) {
      return (progress: DeliveryProgress) => {
        entries.set(path, progress);
        emit();
      };
    },
    complete() {
      for (const [path, progress] of entries) entries.set(path, { ...progress, loaded: progress.total, stage: "cache" });
      emit(true);
    }
  };
}

export async function withModelLock<T>(modelId: string, mode: "shared" | "exclusive", task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (typeof navigator.locks?.request !== "function") return task();
  return navigator.locks.request(`sophon-model:${modelId}`, { mode, signal }, task);
}

async function withArtifactLock<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (typeof navigator.locks?.request !== "function") return task();
  return navigator.locks.request(`sophon-model-delivery:${key}`, { mode: "exclusive", signal }, task);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The model download was cancelled.", "AbortError");
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export { MODEL_DELIVERY_MANIFESTS } from "@/lib/model-delivery/manifest";
export { getModelCacheStatus } from "@/lib/model-delivery/cache-status";
export type { DeliveryProgress } from "@/lib/model-delivery/range-downloader";
export type { ModelCacheSummary } from "@/lib/onnx-types";
