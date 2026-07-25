import {
  getArtifactKey,
  getArtifactUrl,
  MODEL_DELIVERY_MANIFESTS,
  MODEL_SEGMENT_SIZE,
  type ModelDeliveryArtifact,
  type ModelDeliveryManifest
} from "@/lib/model-delivery/manifest";
import {
  getAllArtifactStates,
  getArtifactFileSize,
  supportsPersistentModelDelivery
} from "@/lib/model-delivery/opfs-store";
import type { ArtifactDownloadState } from "@/lib/model-delivery/range-downloader";
import type { ModelCacheSummary } from "@/lib/onnx-types";

const TRANSFORMERS_CACHE_NAME = "transformers-cache";

export async function getModelCacheStatus(): Promise<ModelCacheSummary[]> {
  if (!supportsPersistentModelDelivery()) {
    return MODEL_DELIVERY_MANIFESTS.map((model) => ({
      modelId: model.modelId,
      state: "missing",
      resumableBytes: 0,
      verifiedBytes: 0,
      totalBytes: getManifestBytes(model)
    }));
  }
  const states = await getAllArtifactStates();
  return Promise.all(MODEL_DELIVERY_MANIFESTS.map((model) => inspectModelCache(model, states)));
}

export async function inspectModelCache(
  model: ModelDeliveryManifest,
  states: ArtifactDownloadState[]
): Promise<ModelCacheSummary> {
  const stateByKey = new Map(states.map((state) => [state.key, state]));
  let resumableBytes = 0;
  let verifiedBytes = 0;
  let externalReady = true;
  await Promise.all(model.externalData.map(async (artifact) => {
    const state = stateByKey.get(getArtifactKey(model, artifact));
    const fileSize = await getArtifactFileSize(model, artifact);
    if (!stateMatches(state, artifact) || !completedSegmentsFit(state.completed, fileSize, artifact.size)) {
      externalReady = false;
      return;
    }
    const durable = state.completed.reduce((total, index) => total + getSegmentLength(index, artifact.size), 0);
    resumableBytes += durable;
    if (isReadyArtifactState(state, artifact, fileSize)) verifiedBytes += artifact.size;
    else externalReady = false;
  }));
  const auxiliary = await Promise.all(model.auxiliary.map(async (artifact) => ({
    artifact,
    cached: await hasAuxiliaryArtifact(model, artifact)
  })));
  for (const entry of auxiliary) {
    if (entry.cached) {
      resumableBytes += entry.artifact.size;
      verifiedBytes += entry.artifact.size;
    }
  }
  const totalBytes = getManifestBytes(model);
  const allReady = externalReady && auxiliary.every((entry) => entry.cached);
  return {
    modelId: model.modelId,
    state: allReady ? "cached" : resumableBytes > 0 ? "partial" : "missing",
    resumableBytes,
    verifiedBytes,
    totalBytes
  };
}

export function isReadyArtifactState(
  state: ArtifactDownloadState | undefined,
  artifact: ModelDeliveryArtifact,
  fileSize: number
): state is ArtifactDownloadState {
  const segmentCount = Math.ceil(artifact.size / MODEL_SEGMENT_SIZE);
  return stateMatches(state, artifact)
    && state.status === "ready"
    && fileSize === artifact.size
    && state.completed.length === segmentCount
    && completedSegmentsFit(state.completed, fileSize, artifact.size)
    && Boolean(state.etag)
    && !state.etag.startsWith("W/");
}

export function getManifestBytes(model: ModelDeliveryManifest) {
  return [...model.externalData, ...model.auxiliary].reduce((total, artifact) => total + artifact.size, 0);
}

function stateMatches(
  state: ArtifactDownloadState | undefined,
  artifact: ModelDeliveryArtifact
): state is ArtifactDownloadState {
  return Boolean(state
    && state.version === 1
    && state.size === artifact.size
    && state.sha256 === artifact.sha256
    && state.segmentSize === MODEL_SEGMENT_SIZE
    && Array.isArray(state.completed));
}

function completedSegmentsFit(completed: readonly number[], fileSize: number, artifactSize: number) {
  const segmentCount = Math.ceil(artifactSize / MODEL_SEGMENT_SIZE);
  const unique = new Set(completed);
  return fileSize <= artifactSize
    && unique.size === completed.length
    && completed.every((index) => Number.isSafeInteger(index)
      && index >= 0
      && index < segmentCount
      && index * MODEL_SEGMENT_SIZE + getSegmentLength(index, artifactSize) <= fileSize);
}

function getSegmentLength(index: number, size: number) {
  return Math.max(0, Math.min(MODEL_SEGMENT_SIZE, size - index * MODEL_SEGMENT_SIZE));
}

async function hasAuxiliaryArtifact(
  model: ModelDeliveryManifest,
  artifact: ModelDeliveryManifest["auxiliary"][number]
) {
  if (typeof caches === "undefined") return false;
  const cached = await (await caches.open(TRANSFORMERS_CACHE_NAME)).match(getArtifactUrl(model, artifact));
  return Boolean(cached && Number(cached.headers.get("content-length")) === artifact.size);
}
