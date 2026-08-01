export class ModelDeliveryUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelDeliveryUnavailableError";
  }
}

export class ModelStorageQuotaError extends Error {
  readonly operation: ModelStorageOperation;

  constructor(message: string, operation: ModelStorageOperation = "unknown", options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelStorageQuotaError";
    this.operation = operation;
  }
}

export class ModelStorageWriteError extends Error {
  readonly operation: ModelStorageOperation;

  constructor(message: string, operation: ModelStorageOperation = "unknown", options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelStorageWriteError";
    this.operation = operation;
  }
}

export class ModelStorageOperationError extends Error {
  readonly operation: ModelStorageOperation;

  constructor(message: string, operation: ModelStorageOperation, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelStorageOperationError";
    this.operation = operation;
  }
}

export type ModelStorageOperation =
  | "cache-write"
  | "indexeddb-checkpoint"
  | "opfs-delete"
  | "opfs-flush"
  | "opfs-open"
  | "opfs-resize"
  | "opfs-write"
  | "unknown";

export class InsufficientModelStorageError extends Error {
  readonly availableBytes: number;
  readonly requiredBytes: number;

  constructor(requiredBytes: number, availableBytes: number) {
    super(`This model needs about ${formatBytes(requiredBytes)} of additional browser storage, but only ${formatBytes(availableBytes)} is currently available.`);
    this.name = "InsufficientModelStorageError";
    this.requiredBytes = requiredBytes;
    this.availableBytes = availableBytes;
  }
}

export function isStorageQuotaError(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

export function isCacheStorageWriteError(error: unknown) {
  return error instanceof Error
    && /Cache\.put\(\) encountered a network error/i.test(error.message);
}

export function toModelStorageError(
  error: unknown,
  message = "The browser ran out of storage while saving this model.",
  operation: ModelStorageOperation = "unknown"
) {
  if (error instanceof ModelStorageQuotaError || error instanceof ModelStorageWriteError) return error;
  if (isStorageQuotaError(error)) return new ModelStorageQuotaError(message, operation, { cause: error });
  if (isCacheStorageWriteError(error)) {
    return new ModelStorageWriteError(
      "Glaux could not save the model files in browser storage. Free some device space, remove the partial model download, and retry.",
      "cache-write",
      { cause: error }
    );
  }
  return error;
}

export function toModelStorageOperationError(
  error: unknown,
  message: string,
  operation: ModelStorageOperation
) {
  const storageError = toModelStorageError(error, message, operation);
  return storageError === error
    ? new ModelStorageOperationError(message, operation, { cause: error })
    : storageError;
}

export async function addModelStorageEstimate(error: unknown) {
  if (!(error instanceof ModelStorageQuotaError
    || error instanceof ModelStorageWriteError
    || error instanceof ModelStorageOperationError)) return error;
  try {
    const [estimate, persistent] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() ?? false
    ]);
    if (estimate.usage === undefined || estimate.quota === undefined) return error;
    const available = Math.max(0, estimate.quota - estimate.usage);
    const detail = ` Browser storage reports ${formatBytes(estimate.usage)} used of ${formatBytes(estimate.quota)} (${formatBytes(available)} available; ${persistent ? "persistent" : "best effort"}).`;
    const options = { cause: error };
    if (error instanceof ModelStorageQuotaError) {
      return new ModelStorageQuotaError(`${error.message}${detail}`, error.operation, options);
    }
    if (error instanceof ModelStorageWriteError) {
      return new ModelStorageWriteError(`${error.message}${detail}`, error.operation, options);
    }
    return new ModelStorageOperationError(`${error.message}${detail}`, error.operation, options);
  } catch {
    return error;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.ceil(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
