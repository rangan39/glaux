export const READY_MODEL_STORAGE_KEY = "glaux:last-ready-model";
export const LEGACY_READY_MODEL_STORAGE_KEY = "sophon:last-ready-model";
export const MODEL_CLEANUP_REQUIRED_KEY = "glaux:model-cleanup-required";

type ModelPreferenceStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function readRememberedModelId(storage: ModelPreferenceStorage = window.localStorage) {
  try {
    const rememberedModelId = storage.getItem(READY_MODEL_STORAGE_KEY);
    if (rememberedModelId) return rememberedModelId;

    const legacyModelId = storage.getItem(LEGACY_READY_MODEL_STORAGE_KEY);
    if (!legacyModelId) return null;
    storage.setItem(READY_MODEL_STORAGE_KEY, legacyModelId);
    storage.removeItem(LEGACY_READY_MODEL_STORAGE_KEY);
    return legacyModelId;
  } catch {
    return null;
  }
}

export function rememberReadyModelId(modelId: string, storage: ModelPreferenceStorage = window.localStorage) {
  try {
    storage.setItem(READY_MODEL_STORAGE_KEY, modelId);
    storage.removeItem(LEGACY_READY_MODEL_STORAGE_KEY);
  } catch {
    // Browser storage can be unavailable in restricted contexts.
  }
}

export function forgetRememberedModelId(modelId: string, storage: ModelPreferenceStorage = window.localStorage) {
  try {
    for (const key of [READY_MODEL_STORAGE_KEY, LEGACY_READY_MODEL_STORAGE_KEY]) {
      if (storage.getItem(key) === modelId) storage.removeItem(key);
    }
  } catch {
    // Browser storage can be unavailable in restricted contexts.
  }
}

export function clearRememberedModelId(storage: Pick<Storage, "removeItem"> = window.localStorage) {
  try {
    storage.removeItem(READY_MODEL_STORAGE_KEY);
    storage.removeItem(LEGACY_READY_MODEL_STORAGE_KEY);
  } catch {
    // Browser storage can be unavailable in restricted contexts.
  }
}

export function markModelCleanupRequired(modelId: string, storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(MODEL_CLEANUP_REQUIRED_KEY, JSON.stringify({ modelId, schemaVersion: 1 }));
  } catch {
    // Startup still audits physical storage when localStorage is unavailable.
  }
}

export function clearModelCleanupRequired(storage: Pick<Storage, "removeItem"> = window.localStorage) {
  try {
    storage.removeItem(MODEL_CLEANUP_REQUIRED_KEY);
  } catch {
    // Physical cleanup verification remains authoritative.
  }
}
