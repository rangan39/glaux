import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ArtifactDownloadState, ArtifactStateStore, PositionedFile } from "@/lib/model-delivery/range-downloader";
import {
  ModelDeliveryUnavailableError,
  toModelStorageOperationError
} from "@/lib/model-delivery/errors";

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

export type OpenArtifactFile = {
  file: PositionedFile;
  close: () => void;
};

type StoredModel = { modelId: string; revision: string };
type StoredArtifact = { externalPath: string };

let databasePromise: Promise<IDBPDatabase<DeliveryDatabase>> | null = null;

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
    const root = await navigator.storage.getDirectory();
    const app = await root.getDirectoryHandle("sophon-models");
    const version = await app.getDirectoryHandle("v1");
    const modelDirectory = await version.getDirectoryHandle(model.modelId);
    const revisionDirectory = await modelDirectory.getDirectoryHandle(model.revision);
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
      const root = await navigator.storage.getDirectory();
      const app = await root.getDirectoryHandle("sophon-models");
      const version = await app.getDirectoryHandle("v1");
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
    const database = await getDatabase();
    const transaction = database.transaction("artifacts", "readwrite", { durability: "strict" });
    for (const key of await transaction.store.getAllKeys()) {
      if (key.startsWith(`${model.modelId}:`)) await transaction.store.delete(key);
    }
    await transaction.done;
  } catch (error) {
    throw toModelStorageOperationError(
      error,
      "The browser could not remove old model checkpoints.",
      "indexeddb-checkpoint"
    );
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

export async function commitArtifactStates(states: readonly ArtifactDownloadState[]) {
  try {
    const transaction = (await getDatabase()).transaction("artifacts", "readwrite", { durability: "strict" });
    for (const state of states) await transaction.store.put(state);
    await transaction.done;
  } catch (error) {
    throw toModelStorageOperationError(
      error,
      "The browser could not save resumable model-download checkpoints.",
      "indexeddb-checkpoint"
    );
  }
}

export async function openArtifactFile(model: StoredModel, artifact: StoredArtifact): Promise<OpenArtifactFile> {
  if (!supportsPersistentModelDelivery()) throw new ModelDeliveryUnavailableError("Persistent model storage is unavailable in this browser.");
  try {
    const root = await navigator.storage.getDirectory();
    const app = await root.getDirectoryHandle("sophon-models", { create: true });
    const version = await app.getDirectoryHandle("v1", { create: true });
    const modelDirectory = await version.getDirectoryHandle(model.modelId, { create: true });
    const revisionDirectory = await modelDirectory.getDirectoryHandle(model.revision, { create: true });
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
  databasePromise ??= openDB<DeliveryDatabase>("sophon-model-delivery", 1, {
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
