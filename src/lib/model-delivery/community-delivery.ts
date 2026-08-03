import { parseCommunityModelDescriptor } from "@/lib/model-catalog/descriptor";
import type { CommunityModelDescriptor, CommunityModelFile } from "@/lib/model-catalog/types";
import {
  createArtifactStateStore,
  deleteModelStorage,
  getAllArtifactStates,
  getArtifactFileSize,
  MODEL_STORAGE_LOCK,
  openArtifactFile,
  supportsPersistentModelDelivery
} from "@/lib/model-delivery/opfs-store";
import {
  isSafeExternalLocation,
  OnnxExternalDataError,
  readOnnxExternalDataLocations
} from "@/lib/model-delivery/onnx-external-data";
import {
  downloadRangeArtifact,
  RangeDeliveryUnavailableError,
  type DeliveryProgress
} from "@/lib/model-delivery/range-downloader";
import {
  InsufficientModelStorageError,
  ModelDeliveryUnavailableError
} from "@/lib/model-delivery/errors";
import type { ModelCacheSummary } from "@/lib/onnx-types";
import { inspectArtifactState } from "@/lib/model-delivery/artifact-state";

const HUB_ORIGIN = "https://huggingface.co";
export const MODEL_SEGMENT_SIZE = 64 * 1024 * 1024;

export type CommunityDeliveryArtifact = {
  key: string;
  path: string;
  externalPath: string;
  url: string;
  size: number;
  sha256: string;
};

export type CommunityDeliveryPlan = {
  descriptorId: string;
  storageModel: { modelId: string; revision: string };
  graph: CommunityDeliveryArtifact;
  externalData: readonly (CommunityDeliveryArtifact & { location: string })[];
  totalBytes: number;
};

export type PreparedCommunityModelDelivery = {
  plan: CommunityDeliveryPlan;
  graph: { url: string; data: File };
  externalData: { path: string; data: File }[];
  totalBytes: number;
};

type CommunityDeliveryDependencies = {
  supportsPersistentDelivery: typeof supportsPersistentModelDelivery;
  openFile: typeof openArtifactFile;
  download: typeof downloadRangeArtifact;
  createStateStore: typeof createArtifactStateStore;
  estimateStorage: () => Promise<StorageEstimate | null>;
  getArtifactStates?: typeof getAllArtifactStates;
  getFileSize?: typeof getArtifactFileSize;
};

const defaultDependencies: CommunityDeliveryDependencies = {
  supportsPersistentDelivery: supportsPersistentModelDelivery,
  openFile: openArtifactFile,
  download: downloadRangeArtifact,
  createStateStore: createArtifactStateStore,
  getArtifactStates: getAllArtifactStates,
  getFileSize: getArtifactFileSize,
  async estimateStorage() {
    if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") return null;
    return navigator.storage.estimate().catch(() => null);
  }
};

export async function prepareCommunityModelDelivery(
  value: CommunityModelDescriptor,
  onProgress: (progress: DeliveryProgress) => void = () => undefined,
  signal?: AbortSignal,
  dependencies: CommunityDeliveryDependencies = defaultDependencies
): Promise<PreparedCommunityModelDelivery> {
  const descriptor = requireDescriptor(value);
  if (!dependencies.supportsPersistentDelivery()) {
    throw new ModelDeliveryUnavailableError("This browser cannot securely store and resume community model files.");
  }
  const storageModel = getCommunityStorageModel(descriptor);

  return withCommunityModelLock(async () => {
    throwIfAborted(signal);
    const resumableBytes = await getCommunityResumableBytes(descriptor, dependencies);
    await ensureStorageHeadroom(descriptor.format.totalBytes, resumableBytes, dependencies.estimateStorage);
    const graphArtifact = getCommunityGraphArtifact(descriptor);
    let graphProgress: DeliveryProgress = {
      loaded: 0,
      total: graphArtifact.size,
      stage: "download",
      resumedBytes: 0,
      networkBytes: 0
    };
    const graphFile = await downloadArtifact(storageModel, graphArtifact, (progress) => {
      graphProgress = progress;
      onProgress({ ...progress, total: descriptor.format.totalBytes });
    }, signal, dependencies);
    graphProgress = { ...graphProgress, loaded: graphArtifact.size, total: graphArtifact.size, stage: "cache" };
    onProgress({ loaded: graphArtifact.size, total: descriptor.format.totalBytes, stage: "validate" });
    let locations: string[];
    try {
      locations = await readOnnxExternalDataLocations(graphFile, signal);
    } catch (error) {
      if (!(error instanceof OnnxExternalDataError)) throw error;
      throw new ModelDeliveryUnavailableError("The downloaded ONNX graph has invalid external-data metadata.", { cause: error });
    }
    const plan = resolveCommunityDeliveryPlan(descriptor, locations);
    const aggregate = createAggregateProgress(plan, graphProgress, onProgress);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    let primaryError: unknown;
    let externalFiles: PreparedCommunityModelDelivery["externalData"];
    try {
      const tasks = plan.externalData.map(async (artifact) => ({
        path: artifact.location,
        data: await downloadArtifact(
          plan.storageModel,
          artifact,
          aggregate.update(artifact.path),
          controller.signal,
          dependencies
        )
      })).map((task) => task.catch((error) => {
        if (primaryError === undefined) {
          primaryError = error;
          controller.abort(error);
        }
        throw error;
      }));
      const results = await Promise.allSettled(tasks);
      if (primaryError !== undefined) throw primaryError;
      externalFiles = results.map((result) => (result as PromiseFulfilledResult<PreparedCommunityModelDelivery["externalData"][number]>).value);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    aggregate.complete();
    return {
      plan,
      graph: { url: graphArtifact.url, data: graphFile },
      externalData: externalFiles,
      totalBytes: plan.totalBytes
    };
  }, signal);
}

export function resolveCommunityDeliveryPlan(
  value: CommunityModelDescriptor,
  externalLocations: readonly string[]
): CommunityDeliveryPlan {
  const descriptor = requireDescriptor(value);
  const storageModel = getCommunityStorageModel(descriptor);
  const graph = getCommunityGraphArtifact(descriptor);
  const graphDirectory = descriptor.format.graphPath.slice(0, descriptor.format.graphPath.lastIndexOf("/") + 1);
  const seen = new Set<string>();
  const externalData = externalLocations.map((location) => {
    if (!isSafeExternalLocation(location)) {
      throw new ModelDeliveryUnavailableError(`The ONNX graph referenced an unsafe external-data path: ${location}`);
    }
    if (seen.has(location)) throw new ModelDeliveryUnavailableError(`The ONNX graph repeated external-data path ${location}.`);
    seen.add(location);
    const repositoryPath = `${graphDirectory}${location}`;
    const file = descriptor.files.find((candidate) => candidate.path === repositoryPath);
    if (!file) throw new ModelDeliveryUnavailableError(`The pinned model descriptor does not include ${repositoryPath}.`);
    return {
      ...toDeliveryArtifact(descriptor, file, storageModel, "external"),
      location
    };
  });
  const totalBytes = graph.size + externalData.reduce((total, artifact) => total + artifact.size, 0);
  if (totalBytes !== descriptor.format.totalBytes) {
    throw new ModelDeliveryUnavailableError("The ONNX graph's external-data plan did not match the pinned model descriptor.");
  }
  return { descriptorId: descriptor.id, storageModel, graph, externalData, totalBytes };
}

export function getCommunityGraphArtifact(value: CommunityModelDescriptor) {
  const descriptor = requireDescriptor(value);
  const file = descriptor.files.find((candidate) => candidate.path === descriptor.format.graphPath);
  if (!file) throw new ModelDeliveryUnavailableError("The pinned model descriptor does not include its selected ONNX graph.");
  return toDeliveryArtifact(descriptor, file, getCommunityStorageModel(descriptor), "graph");
}

export function getCommunityStorageModel(value: CommunityModelDescriptor) {
  const descriptor = requireDescriptor(value);
  const repositoryName = descriptor.source.repo.slice(descriptor.source.repo.indexOf("/") + 1);
  return {
    modelId: `community-${repositoryName}-${descriptor.source.revision}-${descriptor.format.dtype}`,
    revision: descriptor.source.revision
  };
}

export async function deleteCommunityModelDelivery(value: CommunityModelDescriptor, signal?: AbortSignal) {
  const storageModel = getCommunityStorageModel(value);
  await withCommunityModelLock(async () => {
    throwIfAborted(signal);
    await deleteModelStorage(storageModel);
  }, signal);
}

export async function getCommunityModelCacheSummary(
  value: CommunityModelDescriptor
): Promise<ModelCacheSummary> {
  const descriptor = requireDescriptor(value);
  if (!supportsPersistentModelDelivery()) return missingCommunitySummary(descriptor);
  const storageModel = getCommunityStorageModel(descriptor);
  const states = await getAllArtifactStates();
  const stateByKey = new Map(states.map((state) => [state.key, state]));
  const artifacts = getDescriptorDeliveryArtifacts(descriptor, storageModel);
  let resumableBytes = 0;
  let verifiedBytes = 0;
  for (const artifact of artifacts) {
    const state = stateByKey.get(artifact.key);
    const fileSize = await getArtifactFileSize(storageModel, artifact);
    const inspection = inspectArtifactState(state, artifact, fileSize, MODEL_SEGMENT_SIZE);
    resumableBytes += inspection.resumableBytes;
    if (inspection.ready) verifiedBytes += artifact.size;
  }
  return {
    modelId: descriptor.id,
    state: verifiedBytes === descriptor.format.totalBytes
      ? "cached"
      : resumableBytes > 0 ? "partial" : "missing",
    resumableBytes,
    verifiedBytes,
    totalBytes: descriptor.format.totalBytes
  };
}

function missingCommunitySummary(descriptor: CommunityModelDescriptor): ModelCacheSummary {
  return {
    modelId: descriptor.id,
    state: "missing",
    resumableBytes: 0,
    verifiedBytes: 0,
    totalBytes: descriptor.format.totalBytes
  };
}

export type CommunityModelCache = {
  match: (request: string) => Promise<Response | undefined>;
  put: (request: string, response: Response) => Promise<void>;
  delete?: (request: string) => Promise<boolean>;
};

export function createCommunityModelCache(
  delivery: PreparedCommunityModelDelivery,
  fallback?: CommunityModelCache
): CommunityModelCache {
  return {
    async match(request) {
      if (sameUrl(request, delivery.graph.url)) {
        return new Response(delivery.graph.data, {
          headers: {
            "content-length": String(delivery.graph.data.size),
            "content-type": "application/octet-stream"
          }
        });
      }
      return fallback?.match(request);
    },
    async put(request, response) {
      if (sameUrl(request, delivery.graph.url)) return;
      await fallback?.put(request, response);
    },
    ...(fallback?.delete ? { delete: (request: string) => fallback.delete!(request) } : {})
  };
}

function toDeliveryArtifact(
  descriptor: CommunityModelDescriptor,
  file: CommunityModelFile,
  storageModel: { modelId: string; revision: string },
  storagePrefix: string
): CommunityDeliveryArtifact {
  if (file.size === null || file.sha256 === null) {
    throw new ModelDeliveryUnavailableError(`The pinned model file ${file.path} is missing size or SHA-256 metadata.`);
  }
  return {
    key: `${storageModel.modelId}:${storageModel.revision}:${file.path}`,
    path: file.path,
    externalPath: `${storagePrefix}-${file.sha256}`,
    url: getPinnedFileUrl(descriptor, file.path),
    size: file.size,
    sha256: file.sha256
  };
}

function getPinnedFileUrl(descriptor: CommunityModelDescriptor, path: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${HUB_ORIGIN}/${descriptor.source.repo}/resolve/${descriptor.source.revision}/${encodedPath}`;
}

async function downloadArtifact(
  storageModel: { modelId: string; revision: string },
  artifact: CommunityDeliveryArtifact,
  onProgress: (progress: DeliveryProgress) => void,
  signal: AbortSignal | undefined,
  dependencies: CommunityDeliveryDependencies
) {
  const opened = await dependencies.openFile(storageModel, artifact);
  try {
    return await dependencies.download({
      artifact: {
        key: artifact.key,
        url: artifact.url,
        size: artifact.size,
        sha256: artifact.sha256
      },
      file: opened.file,
      stateStore: dependencies.createStateStore(),
      onProgress,
      signal,
      segmentSize: MODEL_SEGMENT_SIZE
    });
  } catch (error) {
    if (error instanceof RangeDeliveryUnavailableError) {
      throw new ModelDeliveryUnavailableError("The model host cannot provide the strong, resumable byte ranges Glaux requires.", { cause: error });
    }
    throw error;
  } finally {
    opened.close();
  }
}

function createAggregateProgress(
  plan: CommunityDeliveryPlan,
  graphProgress: DeliveryProgress,
  publish: (progress: DeliveryProgress) => void
) {
  const entries = new Map<string, DeliveryProgress>([
    [plan.graph.path, graphProgress],
    ...plan.externalData.map((artifact): [string, DeliveryProgress] => [artifact.path, {
      loaded: 0,
      total: artifact.size,
      stage: "download",
      resumedBytes: 0,
      networkBytes: 0
    }])
  ]);
  const emit = () => {
    const values = [...entries.values()];
    const loaded = values.reduce((total, progress) => total + progress.loaded, 0);
    const resumedBytes = values.reduce((total, progress) => total + (progress.resumedBytes ?? 0), 0);
    const networkBytes = values.reduce((total, progress) => total + (progress.networkBytes ?? 0), 0);
    const stage = values.some((progress) => progress.stage === "resume")
      ? "resume"
      : values.some((progress) => progress.stage === "download")
        ? "download"
        : values.some((progress) => progress.stage === "verify")
          ? "verify"
          : "cache";
    publish({ loaded, total: plan.totalBytes, stage, resumedBytes, networkBytes });
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
      emit();
    }
  };
}

async function getCommunityResumableBytes(
  descriptor: CommunityModelDescriptor,
  dependencies: CommunityDeliveryDependencies
) {
  if (!dependencies.getArtifactStates || !dependencies.getFileSize) return 0;
  const storageModel = getCommunityStorageModel(descriptor);
  const candidates = getDescriptorDeliveryArtifacts(descriptor, storageModel);
  const states = await dependencies.getArtifactStates();
  const stateByKey = new Map(states.map((state) => [state.key, state]));
  const durable = await Promise.all(candidates.map(async (artifact) => {
    const state = stateByKey.get(artifact.key);
    const fileSize = await dependencies.getFileSize!(storageModel, artifact);
    return inspectArtifactState(state, artifact, fileSize, MODEL_SEGMENT_SIZE).resumableBytes;
  }));
  return durable.reduce((total, bytes) => total + bytes, 0);
}

function getDescriptorDeliveryArtifacts(
  descriptor: CommunityModelDescriptor,
  storageModel: { modelId: string; revision: string }
) {
  return descriptor.files
    .filter((file) => file.path === descriptor.format.graphPath || file.path.startsWith(`${descriptor.format.graphPath}_data`))
    .map((file) => toDeliveryArtifact(
      descriptor,
      file,
      storageModel,
      file.path === descriptor.format.graphPath ? "graph" : "external"
    ));
}

async function ensureStorageHeadroom(
  totalBytes: number,
  resumableBytes: number,
  estimate: () => Promise<StorageEstimate | null>
) {
  const storage = await estimate();
  if (!storage || storage.quota === undefined || storage.usage === undefined) return;
  const required = Math.max(0, totalBytes - resumableBytes);
  const available = Math.max(0, storage.quota - storage.usage);
  if (required > available) throw new InsufficientModelStorageError(required, available);
}

function requireDescriptor(value: CommunityModelDescriptor) {
  const descriptor = parseCommunityModelDescriptor(value);
  if (!descriptor) throw new ModelDeliveryUnavailableError("The community model descriptor is invalid or corrupt.");
  return descriptor;
}

async function withCommunityModelLock<T>(
  task: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") return task();
  return navigator.locks.request(MODEL_STORAGE_LOCK, { mode: "exclusive", signal }, task);
}

function sameUrl(left: string, right: string) {
  try {
    return new URL(left, HUB_ORIGIN).href === new URL(right, HUB_ORIGIN).href;
  } catch {
    return left === right;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The model download was cancelled.", "AbortError");
}
