import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ArtifactDownloadState, ArtifactStateStore, PositionedFile } from "@/lib/model-delivery/range-downloader";
import {
  ModelDeliveryUnavailableError,
  toModelStorageOperationError
} from "@/lib/model-delivery/errors";
import {
  assertCommunityModelDescriptorsEmpty,
  purgeCommunityModelDescriptors
} from "@/lib/model-catalog/descriptor-store";

interface DeliveryDatabase extends DBSchema {
  artifacts: { key: string; value: ArtifactDownloadState };
}

type SyncAccessHandle = {
  getSize: () => number;
  truncate: (size: number) => void;
  read: (data: Uint8Array, options: { at: number }) => number;
  write: (data: Uint8Array, options: { at: number }) => number;
  flush: () => void;
  close: () => void;
};

type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

export type OpenArtifactFile = {
  file: PositionedFile;
  close: () => void;
};

type StoredModel = { modelId: string; revision: string };
type StoredArtifact = { externalPath: string };

let databasePromise: Promise<IDBPDatabase<DeliveryDatabase>> | null = null;
export const MODEL_STORAGE_DIRECTORY = "sophon-models";
export const MODEL_DELIVERY_DATABASE = "sophon-model-delivery";
export const MODEL_RUNTIME_CACHE = "transformers-cache";
const MODEL_STORAGE_VERSION = "v1";
export const MODEL_STORAGE_LOCK = "glaux:model-storage";
const MODEL_STORAGE_DELETE_RETRY_DELAYS_MS = [150, 500, 1_200] as const;
const MODEL_STORAGE_LOCK_TIMEOUT_MS = 15_000;

export type ModelStorageCleanupStage = "waiting-for-lock" | "cache" | "opfs" | "checkpoints" | "descriptors" | "verification";

const MODEL_STORAGE_STAGE_TIMEOUTS_MS: Record<Exclude<ModelStorageCleanupStage, "waiting-for-lock">, number> = {
  cache: 30_000,
  opfs: 120_000,
  checkpoints: 30_000,
  descriptors: 30_000,
  verification: 30_000
};

export function getModelStorageCleanupTimeoutMs(stage: ModelStorageCleanupStage) {
  return stage === "waiting-for-lock" ? MODEL_STORAGE_LOCK_TIMEOUT_MS : MODEL_STORAGE_STAGE_TIMEOUTS_MS[stage];
}

export class ModelStorageCleanupTimeoutError extends Error {
  readonly stage: ModelStorageCleanupStage;
  readonly timeoutMs: number;
  readonly lockAcquired: boolean;

  constructor(stage: ModelStorageCleanupStage, timeoutMs: number, lockAcquired: boolean) {
    super(stage === "waiting-for-lock"
      ? "Glaux timed out waiting for another session to release model storage."
      : `Glaux could not confirm that ${modelStorageStageLabel(stage)} finished within ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = "ModelStorageCleanupTimeoutError";
    this.stage = stage;
    this.timeoutMs = timeoutMs;
    this.lockAcquired = lockAcquired;
  }
}

export type ModelStorageCleanupProgress = {
  stage: ModelStorageCleanupStage;
  lockAcquired: boolean;
};

export type ModelStorageCleanupOptions = {
  lockTimeoutMs?: number;
  onStage?: (progress: ModelStorageCleanupProgress) => void;
  stageTimeoutsMs?: Partial<Record<Exclude<ModelStorageCleanupStage, "waiting-for-lock">, number>>;
};

type ModelStorageLockManager = {
  request: <T>(name: string, options: LockOptions, callback: () => Promise<T>) => Promise<T>;
};

export function supportsPersistentModelDelivery() {
  return typeof navigator !== "undefined"
    && typeof navigator.storage?.getDirectory === "function"
    && typeof indexedDB !== "undefined"
    && typeof File !== "undefined"
    && typeof ReadableStream !== "undefined";
}

export async function getAllArtifactStates() {
  return (await getDatabase()).getAll("artifacts");
}

export async function getArtifactFileSize(model: StoredModel, artifact: StoredArtifact) {
  if (!supportsPersistentModelDelivery()) return 0;
  try {
    const revisionDirectory = await openModelRevisionDirectory(model);
    const handle = await revisionDirectory.getFileHandle(artifact.externalPath);
    return (await handle.getFile()).size;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return 0;
    throw error;
  }
}

export async function deleteModelStorage(model: StoredModel) {
  if (supportsPersistentModelDelivery()) {
    try {
      const version = await openModelStorageVersion();
      await version.removeEntry(model.modelId, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        throw toModelStorageOperationError(
          error,
          "The browser could not remove old model files from browser storage.",
          "opfs-delete"
        );
      }
    }
  }
  try {
    await deleteArtifactStatesWhere((key) => key.startsWith(`${model.modelId}:`));
  } catch (error) {
    throw toModelStorageOperationError(
      error,
      "The browser could not remove old model checkpoints.",
      "indexeddb-checkpoint"
    );
  }
}

export async function reconcileModelStorage(allowedModelIds: ReadonlySet<string>) {
  if (!supportsPersistentModelDelivery()) return [];
  const removed = new Set<string>();
  try {
    const version = await openModelStorageVersion() as IterableDirectoryHandle;
    for await (const [modelId, handle] of version.entries()) {
      if (handle.kind !== "directory" || allowedModelIds.has(modelId)) continue;
      await version.removeEntry(modelId, { recursive: true });
      removed.add(modelId);
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) {
      throw toModelStorageOperationError(
        error,
        "The browser could not remove orphaned model files from browser storage.",
        "opfs-delete"
      );
    }
  }
  try {
    await deleteArtifactStatesWhere((key) => {
      const modelId = key.slice(0, key.indexOf(":"));
      if (!modelId || allowedModelIds.has(modelId)) return false;
      removed.add(modelId);
      return true;
    });
  } catch (error) {
    throw toModelStorageOperationError(
      error,
      "The browser could not remove orphaned model checkpoints.",
      "indexeddb-checkpoint"
    );
  }
  if (typeof caches !== "undefined") {
    try {
      const runtimeCache = await caches.open("transformers-cache");
      for (const request of await runtimeCache.keys()) {
        if (isLegacyBundledModelRequest(request.url)) await runtimeCache.delete(request);
      }
    } catch (error) {
      throw toModelStorageOperationError(
        error,
        "The browser could not remove obsolete bundled model files.",
        "cache-delete"
      );
    }
  }
  return [...removed].sort();
}

export type ModelStoragePurgeDependencies = {
  deleteCache: () => Promise<unknown>;
  deleteDatabase: () => Promise<void>;
  deleteDescriptors: () => Promise<void>;
  deleteOpfs: () => Promise<void>;
  verify: () => Promise<void>;
};

type ModelStoragePurgeFailure = {
  label: string;
  error: unknown;
};

export async function runModelStoragePurge(
  dependencies: ModelStoragePurgeDependencies,
  options: ModelStorageCleanupOptions = {}
) {
  const failures: ModelStoragePurgeFailure[] = [];
  const operations = [
    { label: "cached model files", stage: "cache" as const, run: dependencies.deleteCache },
    { label: "downloaded model files", stage: "opfs" as const, run: dependencies.deleteOpfs },
    { label: "download checkpoints", stage: "checkpoints" as const, run: dependencies.deleteDatabase },
    { label: "saved model details", stage: "descriptors" as const, run: dependencies.deleteDescriptors }
  ];
  for (const operation of operations) {
    try {
      options.onStage?.({ stage: operation.stage, lockAcquired: true });
      await withModelStorageDeadline(
        operation.run(),
        operation.stage,
        options.stageTimeoutsMs?.[operation.stage] ?? MODEL_STORAGE_STAGE_TIMEOUTS_MS[operation.stage],
        true
      );
    } catch (error) {
      if (error instanceof ModelStorageCleanupTimeoutError) throw error;
      failures.push({ label: operation.label, error });
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      getModelStoragePurgeErrorMessage(failures)
    );
  }
  options.onStage?.({ stage: "verification", lockAcquired: true });
  await withModelStorageDeadline(
    dependencies.verify(),
    "verification",
    options.stageTimeoutsMs?.verification ?? MODEL_STORAGE_STAGE_TIMEOUTS_MS.verification,
    true
  );
}

export function getModelStoragePurgeErrorMessage(failures: readonly ModelStoragePurgeFailure[]) {
  const labels = failures.map(({ label }) => label);
  const failedStorage = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  const summary = `Glaux could not remove ${failedStorage} from browser storage.`;
  if (failures.some(({ error }) => isBlockedStorageError(error))) {
    return `${summary} Another Glaux tab or a restored browser session is still using that storage. Close other Glaux tabs, then use Reset Glaux storage.`;
  }
  return `${summary} Use Reset Glaux storage to start fresh.`;
}

export async function retryModelStorageDeletion(
  operation: () => Promise<void>,
  wait: (delayMs: number) => Promise<void> = waitForModelStorageRelease,
  delays: readonly number[] = MODEL_STORAGE_DELETE_RETRY_DELAYS_MS
) {
  for (const delay of delays) {
    try {
      await operation();
      return;
    } catch {
      await wait(delay);
    }
  }
  await operation();
}

function isBlockedStorageError(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.some(isBlockedStorageError);
  if (!(error instanceof Error)) return false;
  return /block(?:ed|ing)|another (?:glaux )?tab|still (?:open|using)/i.test(error.message)
    || isBlockedStorageError(error.cause);
}

export async function purgeAllModelStorage(options: ModelStorageCleanupOptions = {}) {
  const purge = () => runModelStoragePurge({
    deleteCache: async () => {
      if (typeof caches !== "undefined") await caches.delete(MODEL_RUNTIME_CACHE);
    },
    deleteDatabase: deleteDeliveryDatabase,
    deleteDescriptors: purgeCommunityModelDescriptors,
    deleteOpfs: async () => {
      if (typeof navigator === "undefined" || typeof navigator.storage?.getDirectory !== "function") return;
      await retryModelStorageDeletion(async () => {
        const root = await navigator.storage.getDirectory();
        try {
          await root.removeEntry(MODEL_STORAGE_DIRECTORY, { recursive: true });
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
        }
      });
    },
    verify: assertModelStorageEmpty
  }, options);
  if (typeof navigator !== "undefined" && typeof navigator.locks?.request === "function") {
    await runWithModelStorageLock(navigator.locks, purge, options);
  } else {
    await purge();
  }
}

export async function runWithModelStorageLock<T>(
  locks: ModelStorageLockManager,
  task: () => Promise<T>,
  options: ModelStorageCleanupOptions = {}
) {
  options.onStage?.({ stage: "waiting-for-lock", lockAcquired: false });
  const controller = new AbortController();
  const timeoutMs = options.lockTimeoutMs ?? MODEL_STORAGE_LOCK_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(new ModelStorageCleanupTimeoutError("waiting-for-lock", timeoutMs, false)), timeoutMs);
  try {
    return await locks.request(MODEL_STORAGE_LOCK, { mode: "exclusive", signal: controller.signal }, task);
  } finally {
    clearTimeout(timeout);
  }
}

export async function withModelStorageDeadline<T>(
  operation: Promise<T>,
  stage: Exclude<ModelStorageCleanupStage, "waiting-for-lock">,
  timeoutMs: number,
  lockAcquired = true
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new ModelStorageCleanupTimeoutError(stage, timeoutMs, lockAcquired)), timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function modelStorageStageLabel(stage: Exclude<ModelStorageCleanupStage, "waiting-for-lock">) {
  if (stage === "cache") return "removing cached runtime files";
  if (stage === "opfs") return "removing downloaded model files";
  if (stage === "checkpoints") return "removing download checkpoints";
  if (stage === "descriptors") return "removing saved model details";
  return "verifying model storage";
}

function waitForModelStorageRelease(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

export async function assertModelStorageEmpty() {
  if (typeof caches !== "undefined" && (await caches.keys()).includes(MODEL_RUNTIME_CACHE)) {
    throw new Error("The model runtime cache still exists after cleanup.");
  }
  if (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function") {
    const root = await navigator.storage.getDirectory();
    try {
      await root.getDirectoryHandle(MODEL_STORAGE_DIRECTORY);
      throw new Error("The model file directory still exists after cleanup.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
  }
  if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    if (databases.some(({ name }) => name === MODEL_DELIVERY_DATABASE)) {
      throw new Error("The model checkpoint database still exists after cleanup.");
    }
  }
  await assertCommunityModelDescriptorsEmpty();
}

export function isLegacyBundledModelRequest(url: string) {
  try {
    return new URL(url, "https://glaux.invalid").pathname.startsWith("/model-runtime/");
  } catch {
    return false;
  }
}

export function createArtifactStateStore(): ArtifactStateStore {
  return {
    async get(key) {
      return (await getDatabase()).get("artifacts", key);
    },
    async put(state) {
      try {
        const transaction = (await getDatabase()).transaction("artifacts", "readwrite", { durability: "strict" });
        await transaction.store.put(state);
        await transaction.done;
      } catch (error) {
        throw toModelStorageOperationError(
          error,
          "The browser could not save resumable model-download checkpoints.",
          "indexeddb-checkpoint"
        );
      }
    },
    async delete(key) {
      try {
        const transaction = (await getDatabase()).transaction("artifacts", "readwrite", { durability: "strict" });
        await transaction.store.delete(key);
        await transaction.done;
      } catch (error) {
        throw toModelStorageOperationError(
          error,
          "The browser could not update resumable model-download checkpoints.",
          "indexeddb-checkpoint"
        );
      }
    }
  };
}

export async function openArtifactFile(model: StoredModel, artifact: StoredArtifact): Promise<OpenArtifactFile> {
  if (!supportsPersistentModelDelivery()) throw new ModelDeliveryUnavailableError("Persistent model storage is unavailable in this browser.");
  try {
    const revisionDirectory = await openModelRevisionDirectory(model, true);
    const handle = await revisionDirectory.getFileHandle(artifact.externalPath, { create: true }) as SyncFileHandle;
    if (typeof handle.createSyncAccessHandle !== "function") {
      throw new ModelDeliveryUnavailableError("This browser cannot open model storage for local inference.");
    }
    const access = await handle.createSyncAccessHandle();
    if (typeof access.read !== "function") {
      access.close();
      throw new ModelDeliveryUnavailableError("This browser cannot read model files in the format local inference requires.");
    }
    let closed = false;
    return {
      file: {
        getSize: () => access.getSize(),
        truncate: (size) => {
          try {
            return access.truncate(size);
          } catch (error) {
            throw toModelStorageOperationError(
              error,
              "The browser rejected a model-file resize in browser storage.",
              "opfs-resize"
            );
          }
        },
        read: (data, offset) => access.read(data, { at: offset }),
        write: (data, offset) => {
          try {
            return access.write(data, { at: offset });
          } catch (error) {
            throw toModelStorageOperationError(
              error,
              "The browser rejected a model-file write in browser storage.",
              "opfs-write"
            );
          }
        },
        flush: () => {
          try {
            return access.flush();
          } catch (error) {
            throw toModelStorageOperationError(
              error,
              "The browser could not flush model files to browser storage.",
              "opfs-flush"
            );
          }
        },
        getFile: () => handle.getFile()
      },
      close: () => {
        if (closed) return;
        closed = true;
        access.close();
      }
    };
  } catch (error) {
    if (error instanceof ModelDeliveryUnavailableError) throw error;
    const storageError = toModelStorageOperationError(
      error,
      "The browser could not open browser model storage.",
      "opfs-open"
    );
    if (storageError !== error) throw storageError;
    throw new ModelDeliveryUnavailableError("Persistent model storage could not be opened.", { cause: error });
  }
}

async function getDatabase() {
  databasePromise ??= openDB<DeliveryDatabase>(MODEL_DELIVERY_DATABASE, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("artifacts")) database.createObjectStore("artifacts", { keyPath: "key" });
    },
    blocking() {
      const current = databasePromise;
      databasePromise = null;
      void current?.then((database) => database.close());
    },
    terminated() {
      databasePromise = null;
    }
  });
  return databasePromise;
}

async function deleteDeliveryDatabase() {
  const current = databasePromise;
  databasePromise = null;
  (await current?.catch(() => null))?.close();
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(MODEL_DELIVERY_DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("The model checkpoint database could not be deleted."));
    request.onblocked = () => reject(new Error("The model checkpoint database deletion was blocked by another tab."));
  });
}

async function openModelStorageVersion(create = false) {
  const root = await navigator.storage.getDirectory();
  const app = await root.getDirectoryHandle(MODEL_STORAGE_DIRECTORY, { create });
  return app.getDirectoryHandle(MODEL_STORAGE_VERSION, { create });
}

async function openModelRevisionDirectory(model: StoredModel, create = false) {
  const version = await openModelStorageVersion(create);
  const modelDirectory = await version.getDirectoryHandle(model.modelId, { create });
  return modelDirectory.getDirectoryHandle(model.revision, { create });
}

async function deleteArtifactStatesWhere(predicate: (key: string) => boolean) {
  const database = await getDatabase();
  const transaction = database.transaction("artifacts", "readwrite", { durability: "strict" });
  for (const key of await transaction.store.getAllKeys()) {
    if (predicate(key)) await transaction.store.delete(key);
  }
  await transaction.done;
}
