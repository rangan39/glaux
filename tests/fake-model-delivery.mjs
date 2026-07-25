export async function prepareModelDelivery() {
  return null;
}

export async function getModelCacheStatus() {
  return [];
}

export async function deleteModelCache(modelId) {
  return { modelId, deleted: true };
}

export async function ensureStorageHeadroom() {}

export async function withModelLock(_modelId, _mode, task) {
  return task();
}
