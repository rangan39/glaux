import { createSHA256 } from "hash-wasm";
import { putVerifiedAuxiliaryArtifact } from "@/lib/model-delivery/auxiliary-cache";
import { getManifestBytes, inspectModelCache, isReadyArtifactState } from "@/lib/model-delivery/cache-status";
import { ensureStorageHeadroom, withModelLock } from "@/lib/model-delivery/index";
import {
  getArtifactKey,
  getModelDeliveryManifest,
  MODEL_SEGMENT_SIZE,
  type ModelAuxiliaryArtifact,
  type ModelDeliveryArtifact,
  type ModelDeliveryManifest
} from "@/lib/model-delivery/manifest";
import {
  commitArtifactStates,
  createArtifactStateStore,
  getAllArtifactStates,
  openArtifactFile,
  supportsPersistentModelDelivery
} from "@/lib/model-delivery/opfs-store";
import {
  parseSophonModelPack,
  type ParsedSophonModelPack,
  type SophonModelPackArtifact,
  type SophonModelPackHeader
} from "@/lib/model-delivery/pack-format";
import {
  markArtifactVerifiedThisSession,
  type ArtifactDownloadState,
  type DeliveryProgress,
  type PositionedFile
} from "@/lib/model-delivery/range-downloader";
import { ModelDeliveryUnavailableError, toModelStorageError } from "@/lib/model-delivery/errors";
import type { ModelPackImportResult, ModelPackInspection } from "@/lib/onnx-types";

export type ModelPackValidationErrorCode =
  | "unknown-model"
  | "wrong-model"
  | "revision-mismatch"
  | "artifact-mismatch"
  | "license-mismatch";

export class ModelPackValidationError extends Error {
  readonly code: ModelPackValidationErrorCode;

  constructor(code: ModelPackValidationErrorCode, message: string) {
    super(message);
    this.name = "ModelPackValidationError";
    this.code = code;
  }
}

export async function inspectOfflineModelPack(
  file: Blob,
  expectedModelId?: string
): Promise<ModelPackInspection> {
  requireImportStorage();
  const parsed = await parseSophonModelPack(file);
  const manifest = validatePackAllowlist(parsed.header, expectedModelId);
  const states = await getAllArtifactStates();
  const cache = await inspectModelCache(manifest, states);
  const estimate = await navigator.storage.estimate?.().catch(() => null);
  const requiredBytes = Math.max(0, getManifestBytes(manifest) - cache.resumableBytes);
  const availableBytes = estimate?.quota === undefined || estimate.usage === undefined
    ? null
    : Math.max(0, estimate.quota - estimate.usage);
  return {
    formatVersion: 1,
    fileName: file instanceof File ? file.name : "offline-model.sophon-model",
    modelId: manifest.modelId,
    repo: manifest.repo,
    revision: manifest.revision,
    quantization: manifest.quantization,
    packBytes: file.size,
    modelBytes: getManifestBytes(manifest),
    requiredBytes,
    availableBytes,
    resumableBytes: cache.resumableBytes,
    alreadyReady: cache.state === "cached",
    license: { ...manifest.license }
  };
}

export async function importOfflineModelPack(
  file: Blob,
  expectedModelId: string,
  onProgress: (progress: DeliveryProgress) => void = () => undefined,
  signal?: AbortSignal
): Promise<ModelPackImportResult> {
  const operationStartedAt = now();
  requireImportStorage();
  throwIfAborted(signal);
  onProgress({ loaded: 0, total: Math.max(1, file.size), stage: "validate", resumedBytes: 0, elapsedMs: 0 });
  const parsed = await parseSophonModelPack(file);
  const manifest = validatePackAllowlist(parsed.header, expectedModelId);
  const totalBytes = getManifestBytes(manifest);
  onProgress({ loaded: 0, total: totalBytes, stage: "validate", resumedBytes: 0, elapsedMs: now() - operationStartedAt });

  return withModelLock(manifest.modelId, "exclusive", async () => {
    throwIfAborted(signal);
    const initialStates = await getAllArtifactStates();
    const initialSummary = await inspectModelCache(manifest, initialStates);
    if (initialSummary.state === "cached") {
      onProgress({ loaded: totalBytes, total: totalBytes, stage: "ready", resumedBytes: totalBytes, elapsedMs: now() - operationStartedAt });
      return { modelId: manifest.modelId, imported: true, totalBytes, resumedBytes: totalBytes };
    }
    await ensureStorageHeadroom(manifest, totalBytes, initialStates);
    await navigator.storage.persist?.().catch(() => false);
    const stateStore = createArtifactStateStore();
    const stateByKey = new Map(initialStates.map((state) => [state.key, state]));
    const externalResults: {
      artifact: ModelDeliveryArtifact;
      state: ArtifactDownloadState;
      requiresVerification: boolean;
    }[] = [];
    const verifiedExternalKeys = new Set<string>();
    let importedBytes = 0;
    let resumedBytes = 0;
    const reportImport = (additionalBytes = 0) => {
      importedBytes = Math.min(totalBytes, importedBytes + additionalBytes);
      const elapsedMs = Math.max(0, now() - operationStartedAt);
      const elapsedSeconds = elapsedMs / 1000;
      const copiedBytes = Math.max(0, importedBytes - resumedBytes);
      const bytesPerSecond = elapsedSeconds > 0 && copiedBytes > 0 ? copiedBytes / elapsedSeconds : undefined;
      onProgress({
        loaded: importedBytes,
        total: totalBytes,
        stage: "import",
        resumedBytes,
        elapsedMs,
        ...(bytesPerSecond === undefined ? {} : {
          bytesPerSecond,
          etaMs: Math.max(0, totalBytes - importedBytes) / bytesPerSecond * 1000
        })
      });
    };
    reportImport();

    try {
      for (const artifact of parsed.header.artifacts) {
        throwIfAborted(signal);
        const external = manifest.externalData.find((candidate) => candidate.path === artifact.path);
        if (external) {
          const result = await importExternalArtifact({
            file,
            parsed,
            model: manifest,
            artifact: external,
            packArtifact: artifact,
            priorState: stateByKey.get(getArtifactKey(manifest, external)),
            stateStore,
            signal,
            onChunk: reportImport
          });
          externalResults.push({ artifact: external, state: result.state, requiresVerification: result.requiresVerification });
          resumedBytes += result.resumedBytes;
          reportImport(result.resumedBytes);
          continue;
        }
        const auxiliary = manifest.auxiliary.find((candidate) => candidate.path === artifact.path);
        if (!auxiliary) throw new ModelPackValidationError("artifact-mismatch", `Artifact ${artifact.path} is not in Sophon's compiled allowlist.`);
        const body = await readVerifiedAuxiliary(file, parsed, auxiliary, artifact, signal, reportImport);
        await putVerifiedAuxiliaryArtifact(manifest, auxiliary, body);
      }
      throwIfAborted(signal);
      let verifiedBytes = manifest.auxiliary.reduce((total, artifact) => total + artifact.size, 0)
        + externalResults.filter((result) => !result.requiresVerification).reduce((total, result) => total + result.artifact.size, 0);
      onProgress({ loaded: verifiedBytes, total: totalBytes, stage: "verify", resumedBytes, elapsedMs: now() - operationStartedAt });
      const readyStates: ArtifactDownloadState[] = [];
      for (const result of externalResults) {
        if (!result.requiresVerification) {
          readyStates.push(result.state);
          continue;
        }
        const ready = await verifyImportedExternal(
          manifest,
          result.artifact,
          result.state,
          signal,
          (loaded) => onProgress({
            loaded: verifiedBytes + loaded,
            total: totalBytes,
            stage: "verify",
            resumedBytes,
            elapsedMs: now() - operationStartedAt
          })
        );
        readyStates.push(ready);
        verifiedBytes += result.artifact.size;
        verifiedExternalKeys.add(ready.key);
      }
      await commitArtifactStates(readyStates);
      for (const key of verifiedExternalKeys) markArtifactVerifiedThisSession(key);
      onProgress({ loaded: totalBytes, total: totalBytes, stage: "ready", resumedBytes, elapsedMs: now() - operationStartedAt });
      return { modelId: manifest.modelId, imported: true, totalBytes, resumedBytes };
    } catch (error) {
      throw toModelStorageError(error, "The browser ran out of storage while importing this offline model pack.");
    }
  }, signal);
}

export function validatePackAllowlist(header: SophonModelPackHeader, expectedModelId?: string) {
  const manifest = getModelDeliveryManifest(header.modelId);
  if (!manifest) {
    throw new ModelPackValidationError("unknown-model", `Offline pack model ${header.modelId} is not supported by this version of Sophon.`);
  }
  if (expectedModelId && header.modelId !== expectedModelId) {
    throw new ModelPackValidationError("wrong-model", `Wrong offline pack: select a pack for ${expectedModelId}, not ${header.modelId}.`);
  }
  if (header.repo !== manifest.repo) {
    throw new ModelPackValidationError("artifact-mismatch", `Offline pack repository does not match Sophon's compiled source for ${manifest.modelId}.`);
  }
  if (header.revision !== manifest.revision) {
    throw new ModelPackValidationError("revision-mismatch", `Offline pack revision ${header.revision} does not match Sophon's required revision ${manifest.revision}.`);
  }
  if (header.quantization !== manifest.quantization || header.segmentSize !== MODEL_SEGMENT_SIZE) {
    throw new ModelPackValidationError("artifact-mismatch", "Offline pack quantization or segment size does not match Sophon's compiled manifest.");
  }
  if (!licensesEqual(header.license, manifest.license)) {
    throw new ModelPackValidationError("license-mismatch", "Offline pack license, attribution, model-card, or acceptable-use metadata does not match Sophon's compiled manifest.");
  }
  const expectedArtifacts = [
    ...manifest.externalData.map((artifact) => ({
      path: artifact.path,
      size: artifact.size,
      sha256: artifact.sha256,
      segments: artifact.segmentSha256
    })),
    ...manifest.auxiliary.map((artifact) => ({
      path: artifact.path,
      size: artifact.size,
      sha256: artifact.sha256,
      segments: [artifact.sha256]
    }))
  ].sort((left, right) => left.path.localeCompare(right.path));
  if (header.artifacts.length !== expectedArtifacts.length) {
    throw new ModelPackValidationError("artifact-mismatch", `Offline pack declares ${header.artifacts.length} artifacts; Sophon requires exactly ${expectedArtifacts.length}.`);
  }
  for (const [index, actual] of header.artifacts.entries()) {
    const expected = expectedArtifacts[index];
    if (!expected || actual.path !== expected.path) {
      throw new ModelPackValidationError("artifact-mismatch", `Offline pack artifact ${actual.path} is unknown or out of order.`);
    }
    if (actual.size !== expected.size || !constantTimeStringEqual(actual.sha256, expected.sha256)
      || actual.segments.length !== expected.segments.length
      || actual.segments.some((digest, segmentIndex) => !constantTimeStringEqual(digest, expected.segments[segmentIndex] ?? ""))) {
      throw new ModelPackValidationError("artifact-mismatch", `Offline pack integrity metadata does not match Sophon's compiled allowlist for ${actual.path}.`);
    }
  }
  return manifest;
}

async function importExternalArtifact({
  file,
  parsed,
  model,
  artifact,
  packArtifact,
  priorState,
  stateStore,
  signal,
  onChunk
}: {
  file: Blob;
  parsed: ParsedSophonModelPack;
  model: ModelDeliveryManifest;
  artifact: ModelDeliveryArtifact;
  packArtifact: SophonModelPackArtifact;
  priorState: ArtifactDownloadState | undefined;
  stateStore: ReturnType<typeof createArtifactStateStore>;
  signal?: AbortSignal;
  onChunk: (bytes: number) => void;
}) {
  const key = getArtifactKey(model, artifact);
  const opened = await openArtifactFile(model, artifact);
  try {
    const fileSize = await opened.file.getSize();
    if (isReadyArtifactState(priorState, artifact, fileSize)) {
      return { state: priorState, resumedBytes: artifact.size, requiresVerification: false };
    }
    let state: ArtifactDownloadState;
    if (isReusablePartialState(priorState, artifact, fileSize)) {
      state = { ...(priorState as ArtifactDownloadState), etag: packEtag(model), status: "partial" };
      await stateStore.put(state);
    } else {
      await opened.file.truncate(0);
      await opened.file.flush();
      state = {
        key,
        version: 1,
        size: artifact.size,
        sha256: artifact.sha256,
        segmentSize: MODEL_SEGMENT_SIZE,
        etag: packEtag(model),
        completed: [],
        status: "partial"
      };
      await stateStore.put(state);
    }
    const completed = new Set(state.completed);
    const resumedBytes = state.completed.reduce((total, index) => total + segmentLength(index, artifact.size), 0);
    for (let index = 0; index < artifact.segmentSha256.length; index += 1) {
      if (completed.has(index)) continue;
      throwIfAborted(signal);
      const start = index * MODEL_SEGMENT_SIZE;
      const length = segmentLength(index, artifact.size);
      const sourceStart = parsed.payloadOffset + packArtifact.offset + start;
      await copyVerifiedPackSegment(
        file.slice(sourceStart, sourceStart + length),
        opened.file,
        start,
        length,
        artifact.segmentSha256[index]!,
        artifact.path,
        index,
        signal,
        onChunk
      );
      await opened.file.flush();
      completed.add(index);
      state = { ...state, completed: [...completed].sort((left, right) => left - right) };
      await stateStore.put(state);
    }
    if (await opened.file.getSize() !== artifact.size) {
      throw new Error(`Offline pack wrote an unexpected final size for ${artifact.path}.`);
    }
    await opened.file.flush();
    return {
      state: {
        ...state,
        completed: artifact.segmentSha256.map((_, index) => index),
        status: "partial" as const
      },
      resumedBytes,
      requiresVerification: true
    };
  } finally {
    opened.close();
  }
}

async function verifyImportedExternal(
  model: ModelDeliveryManifest,
  artifact: ModelDeliveryArtifact,
  state: ArtifactDownloadState,
  signal: AbortSignal | undefined,
  onChunk: (loaded: number) => void
) {
  const opened = await openArtifactFile(model, artifact);
  try {
    await opened.file.flush();
    const storedFile = await opened.file.getFile();
    if (storedFile.size !== artifact.size) throw new Error(`Imported file size changed before verification for ${artifact.path}.`);
    const digest = await sha256Blob(storedFile, signal, onChunk);
    if (!constantTimeStringEqual(digest, artifact.sha256)) {
      throw new Error(`Offline pack whole-file SHA-256 mismatch for ${artifact.path}. Re-select a verified pack and try again.`);
    }
    return { ...state, status: "ready" as const };
  } finally {
    opened.close();
  }
}

export async function copyVerifiedPackSegment(
  source: Blob,
  destination: PositionedFile,
  destinationOffset: number,
  expectedBytes: number,
  expectedSha256: string,
  path: string,
  segmentIndex: number,
  signal: AbortSignal | undefined,
  onChunk: (bytes: number) => void
) {
  if (source.size !== expectedBytes) throw new Error(`Offline pack is truncated in segment ${segmentIndex} of ${path}.`);
  const hasher = await createSHA256();
  hasher.init();
  const reader = source.stream().getReader();
  let received = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > expectedBytes) throw new Error(`Offline pack segment ${segmentIndex} of ${path} exceeded its declared size.`);
      try {
        hasher.update(value);
        await writeAll(destination, value, destinationOffset + received);
        received += value.byteLength;
        onChunk(value.byteLength);
      } finally {
        value.fill(0);
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  throwIfAborted(signal);
  if (received !== expectedBytes) throw new Error(`Offline pack is truncated in segment ${segmentIndex} of ${path}.`);
  if (!constantTimeStringEqual(hasher.digest("hex"), expectedSha256)) {
    throw new Error(`Offline pack has a corrupt segment ${segmentIndex} in ${path}. Rebuild or re-download the pack.`);
  }
}

async function readVerifiedAuxiliary(
  file: Blob,
  parsed: ParsedSophonModelPack,
  artifact: ModelAuxiliaryArtifact,
  packArtifact: SophonModelPackArtifact,
  signal: AbortSignal | undefined,
  onChunk: (bytes: number) => void
) {
  const sourceStart = parsed.payloadOffset + packArtifact.offset;
  const source = file.slice(sourceStart, sourceStart + artifact.size);
  if (source.size !== artifact.size) throw new Error(`Offline pack is truncated in ${artifact.path}.`);
  const hasher = await createSHA256();
  hasher.init();
  const chunks: ArrayBuffer[] = [];
  const reader = source.stream().getReader();
  let received = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > artifact.size) throw new Error(`Offline pack artifact ${artifact.path} exceeded its declared size.`);
      hasher.update(value);
      chunks.push(value.slice().buffer);
      received += value.byteLength;
      onChunk(value.byteLength);
      value.fill(0);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    for (const chunk of chunks) new Uint8Array(chunk).fill(0);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (received !== artifact.size || !constantTimeStringEqual(hasher.digest("hex"), artifact.sha256)) {
    for (const chunk of chunks) new Uint8Array(chunk).fill(0);
    throw new Error(`Offline pack SHA-256 mismatch for ${artifact.path}.`);
  }
  const body = new Blob(chunks);
  for (const chunk of chunks) new Uint8Array(chunk).fill(0);
  return body;
}

async function sha256Blob(blob: Blob, signal?: AbortSignal, onChunk?: (loaded: number) => void) {
  const hasher = await createSHA256();
  hasher.init();
  const reader = blob.stream().getReader();
  let loaded = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      loaded += value.byteLength;
      onChunk?.(loaded);
      value.fill(0);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return hasher.digest("hex");
}

async function writeAll(file: PositionedFile, data: Uint8Array, offset: number) {
  let written = 0;
  while (written < data.byteLength) {
    const count = await file.write(data.subarray(written), offset + written);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error("The offline model file write did not make progress.");
    written += count;
  }
}

function isReusablePartialState(
  state: ArtifactDownloadState | undefined,
  artifact: ModelDeliveryArtifact,
  fileSize: number
): state is ArtifactDownloadState {
  if (!state || state.key.length === 0 || state.version !== 1 || state.size !== artifact.size
    || state.sha256 !== artifact.sha256 || state.segmentSize !== MODEL_SEGMENT_SIZE
    || !Array.isArray(state.completed) || fileSize > artifact.size) return false;
  const unique = new Set(state.completed);
  return unique.size === state.completed.length && state.completed.every((index) =>
    Number.isSafeInteger(index)
    && index >= 0
    && index < artifact.segmentSha256.length
    && index * MODEL_SEGMENT_SIZE + segmentLength(index, artifact.size) <= fileSize);
}

function segmentLength(index: number, size: number) {
  return Math.max(0, Math.min(MODEL_SEGMENT_SIZE, size - index * MODEL_SEGMENT_SIZE));
}

function licensesEqual(
  left: SophonModelPackHeader["license"],
  right: SophonModelPackHeader["license"]
) {
  return left.spdx === right.spdx
    && left.modelCardUrl === right.modelCardUrl
    && left.acceptableUsePolicyUrl === right.acceptableUsePolicyUrl
    && left.attribution === right.attribution;
}

function constantTimeStringEqual(left: string, right: string) {
  const maximum = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maximum; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function packEtag(model: ModelDeliveryManifest) {
  return `"sophon-pack-v1:${model.revision}"`;
}

function requireImportStorage() {
  if (!supportsPersistentModelDelivery() || typeof caches === "undefined") {
    throw new ModelDeliveryUnavailableError("This browser cannot securely import and store Sophon offline model packs.");
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The offline model import was cancelled.", "AbortError");
  }
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}
