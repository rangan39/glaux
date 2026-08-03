import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { parseCommunityModelDescriptor } from "@/lib/model-catalog/descriptor";
import type { CommunityModelDescriptor } from "@/lib/model-catalog/types";

export const COMMUNITY_MODEL_DATABASE = "glaux-community-models";
export const LEGACY_COMMUNITY_MODEL_DATABASE = "sophon-community-models";
const DATABASE_VERSION = 1;
const DESCRIPTOR_STORE = "descriptors";

interface CommunityModelDatabase extends DBSchema {
  descriptors: {
    key: string;
    value: CommunityModelDescriptor;
  };
}

export type CommunityModelDescriptorStorage = {
  get: (id: string) => Promise<unknown | undefined>;
  getAll: () => Promise<unknown[]>;
  put: (descriptor: CommunityModelDescriptor) => Promise<void>;
  delete: (id: string) => Promise<void>;
};

export class CommunityModelDescriptorStoreError extends Error {
  readonly code: "conflict" | "corrupt" | "invalid" | "storage-unavailable" | "storage-failed";

  constructor(
    code: CommunityModelDescriptorStoreError["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "CommunityModelDescriptorStoreError";
    this.code = code;
  }
}

let databasePromise: Promise<IDBPDatabase<CommunityModelDatabase>> | null = null;

export async function saveCommunityModelDescriptor(
  value: CommunityModelDescriptor,
  storage: CommunityModelDescriptorStorage = indexedDbDescriptorStorage
) {
  const descriptor = parseCommunityModelDescriptor(value);
  if (!descriptor) throw new CommunityModelDescriptorStoreError("invalid", "The community model descriptor is invalid.");
  return withStorageError(async () => {
    const existingValue = await storage.get(descriptor.id);
    if (existingValue !== undefined) {
      const existing = parseCommunityModelDescriptor(existingValue);
      if (!existing) throw new CommunityModelDescriptorStoreError("corrupt", "The saved community model descriptor is corrupt.");
      if (JSON.stringify(existing) !== JSON.stringify(descriptor)) {
        throw new CommunityModelDescriptorStoreError("conflict", "A different descriptor already exists for this immutable model revision.");
      }
      return existing;
    }
    await storage.put(descriptor);
    return descriptor;
  });
}

export async function getSavedCommunityModelDescriptor(
  id: string,
  storage: CommunityModelDescriptorStorage = indexedDbDescriptorStorage
) {
  return withStorageError(async () => parseCommunityModelDescriptor(await storage.get(id)));
}

export async function listSavedCommunityModelDescriptors(
  storage: CommunityModelDescriptorStorage = indexedDbDescriptorStorage
) {
  return withStorageError(async () => (await storage.getAll())
    .flatMap((value) => {
      const descriptor = parseCommunityModelDescriptor(value);
      return descriptor ? [descriptor] : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name)));
}

export async function deleteSavedCommunityModelDescriptor(
  id: string,
  storage: CommunityModelDescriptorStorage = indexedDbDescriptorStorage
) {
  await withStorageError(() => storage.delete(id));
}

export async function purgeCommunityModelDescriptors() {
  const current = databasePromise;
  databasePromise = null;
  (await current?.catch(() => null))?.close();
  if (typeof indexedDB === "undefined") return;
  await deleteCommunityModelDatabases(deleteDescriptorDatabase);
}

export async function assertCommunityModelDescriptorsEmpty() {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return;
  const remaining = getRemainingCommunityModelDatabases(await indexedDB.databases());
  if (remaining.length > 0) {
    throw new Error(`The saved model descriptor database still exists after cleanup: ${remaining.map(({ name }) => name).join(", ")}.`);
  }
}

export async function deleteCommunityModelDatabases(deleteDatabase: (name: string) => Promise<void>) {
  const failures: unknown[] = [];
  for (const name of [COMMUNITY_MODEL_DATABASE, LEGACY_COMMUNITY_MODEL_DATABASE]) {
    try {
      await deleteDatabase(name);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Glaux could not remove all saved model descriptor databases.");
  }
}

export function getRemainingCommunityModelDatabases(databases: readonly { name?: string }[]) {
  return databases.filter(({ name }) => name === COMMUNITY_MODEL_DATABASE || name === LEGACY_COMMUNITY_MODEL_DATABASE);
}

const indexedDbDescriptorStorage: CommunityModelDescriptorStorage = {
  async get(id) {
    return (await getDatabase()).get(DESCRIPTOR_STORE, id);
  },
  async getAll() {
    return (await getDatabase()).getAll(DESCRIPTOR_STORE);
  },
  async put(descriptor) {
    await (await getDatabase()).put(DESCRIPTOR_STORE, descriptor);
  },
  async delete(id) {
    await (await getDatabase()).delete(DESCRIPTOR_STORE, id);
  }
};

async function getDatabase() {
  if (typeof indexedDB === "undefined") {
    throw new CommunityModelDescriptorStoreError("storage-unavailable", "IndexedDB is unavailable in this browser.");
  }
  databasePromise ??= openDB<CommunityModelDatabase>(COMMUNITY_MODEL_DATABASE, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(DESCRIPTOR_STORE)) {
        database.createObjectStore(DESCRIPTOR_STORE, { keyPath: "id" });
      }
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

async function deleteDescriptorDatabase(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`The saved model descriptor database could not be deleted: ${name}.`));
    request.onblocked = () => reject(new Error(`The saved model descriptor database deletion was blocked by another Glaux tab: ${name}.`));
  });
}

async function withStorageError<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CommunityModelDescriptorStoreError) throw error;
    throw new CommunityModelDescriptorStoreError("storage-failed", "The community model catalog could not access browser storage.", { cause: error });
  }
}
