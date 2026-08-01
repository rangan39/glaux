import { createSHA256 } from "hash-wasm";
import {
  getArtifactKey,
  getArtifactUrl,
  getBundledArtifactUrl,
  type ModelAuxiliaryArtifact,
  type ModelDeliveryManifest
} from "@/lib/model-delivery/manifest";
import type { DeliveryProgress } from "@/lib/model-delivery/range-downloader";
import {
  ModelDeliveryUnavailableError,
  toModelStorageOperationError
} from "@/lib/model-delivery/errors";

export const TRANSFORMERS_CACHE_NAME = "transformers-cache";

const verifiedThisSession = new Set<string>();

export async function ensureAuxiliaryArtifact(
  model: ModelDeliveryManifest,
  artifact: ModelAuxiliaryArtifact,
  onProgress: (progress: DeliveryProgress) => void,
  signal?: AbortSignal
) {
  if (typeof caches === "undefined") throw new ModelDeliveryUnavailableError("This browser cannot store the model files Glaux needs.");
  throwIfAborted(signal);
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  const key = getArtifactUrl(model, artifact);
  const sessionKey = getArtifactKey(model, artifact);
  const cached = await cache.match(key);
  if (cached) {
    if (verifiedThisSession.has(sessionKey)) {
      onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes: artifact.size, networkBytes: 0 });
      return;
    }
    const cachedSha256 = await readAndHash(cached, artifact.size, (loaded) => {
      onProgress({ loaded, total: artifact.size, stage: "verify", resumedBytes: artifact.size, networkBytes: 0 });
    }, signal);
    if (cachedSha256 === artifact.sha256) {
      verifiedThisSession.add(sessionKey);
      onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes: artifact.size, networkBytes: 0 });
      return;
    }
    await cache.delete(key);
    verifiedThisSession.delete(sessionKey);
  }

  const bundledUrl = getBundledArtifactUrl(artifact);
  const response = await fetch(bundledUrl, { cache: "no-store", redirect: "error", signal });
  if (!response.ok) throw new Error(`Packaged model artifact request failed with HTTP ${response.status} for ${artifact.path}.`);
  if (!response.body) throw new Error("The model artifact response had no body.");
  const [verificationBody, cacheBody] = response.body.tee();
  const guardedCacheBody = signal
    ? cacheBody.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), { signal })
    : cacheBody;
  const headers = {
    "content-length": String(artifact.size),
    "content-type": response.headers.get("content-type") ?? "application/octet-stream"
  };
  const caching = cache.put(key, new Response(guardedCacheBody, { headers })).catch((error) => {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new DOMException("The model download was cancelled.", "AbortError");
    }
    throw toModelStorageOperationError(
      error,
      `The browser ran out of storage while caching ${artifact.path}.`,
      "cache-write"
    );
  });
  try {
    const downloadedSha256 = await readAndHash(new Response(verificationBody), artifact.size, (loaded) => {
      onProgress({ loaded, total: artifact.size, stage: "verify", resumedBytes: 0, networkBytes: 0 });
    }, signal);
    await caching;
    if (downloadedSha256 !== artifact.sha256) {
      await cache.delete(key);
      throw new Error(`SHA-256 mismatch for ${sessionKey}.`);
    }
  } catch (error) {
    await caching.catch(() => undefined);
    await cache.delete(key).catch(() => undefined);
    throw error;
  }
  verifiedThisSession.add(sessionKey);
  onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes: 0, networkBytes: 0 });
}

export async function deleteAuxiliaryArtifacts(model: ModelDeliveryManifest) {
  if (typeof caches === "undefined") return;
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  try {
    await Promise.all(model.auxiliary.map(async (artifact) => {
      await cache.delete(getArtifactUrl(model, artifact));
      verifiedThisSession.delete(getArtifactKey(model, artifact));
    }));
  } catch (error) {
    throw toModelStorageOperationError(
      error,
      "The browser could not remove cached model runtime files.",
      "cache-write"
    );
  }
}

async function readAndHash(
  response: Response,
  expectedSize: number,
  onChunk: (loaded: number) => void,
  signal?: AbortSignal
) {
  if (!response.body) throw new Error("The model metadata response had no body.");
  const hasher = await createSHA256();
  hasher.init();
  const reader = response.body.getReader();
  let loaded = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > expectedSize) throw new Error(`Model metadata exceeded its declared size of ${expectedSize} bytes.`);
      hasher.update(value);
      onChunk(loaded);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (loaded !== expectedSize) throw new Error(`Model metadata ended at ${loaded} of ${expectedSize} bytes.`);
  return hasher.digest("hex");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The model download was cancelled.", "AbortError");
}
