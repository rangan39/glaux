import type {
  ChatTurn,
  GenerationCancelResult,
  GenerationTelemetryEvent,
  ModelCacheDeleteResult,
  ModelCacheSummary,
  ModelPackImportResult,
  ModelPackInspection,
  OnnxLogEvent,
  OnnxRunOptions,
  OnnxRunResponse,
  RuntimeCapabilities
} from "@/lib/onnx-types";

type WorkerRequestInputMap = {
  capabilities: { type: "capabilities" };
  generate: {
    type: "generate";
    messages: ChatTurn[];
    modelId: string;
    options: Pick<OnnxRunOptions, "maxNewTokens" | "temperature" | "topK">;
  };
  cancel: { type: "cancel"; targetRequestId: string };
  preload: { type: "preload"; modelId: string };
  "cache-status": { type: "cache-status" };
  "delete-cache": { type: "delete-cache"; modelId: string };
  "inspect-pack": { type: "inspect-pack"; file: Blob; expectedModelId?: string };
  "import-pack": { type: "import-pack"; file: Blob; expectedModelId: string };
};

export type WorkerRequestType = keyof WorkerRequestInputMap;
export type WorkerRequestInput<T extends WorkerRequestType = WorkerRequestType> = WorkerRequestInputMap[T];
export type WorkerRequest = {
  [T in WorkerRequestType]: WorkerRequestInputMap[T] & { requestId: string };
}[WorkerRequestType];

export type WorkerResultMap = {
  capabilities: RuntimeCapabilities;
  generate: OnnxRunResponse;
  cancel: GenerationCancelResult;
  preload: { ok: true };
  "cache-status": { models: ModelCacheSummary[] };
  "delete-cache": ModelCacheDeleteResult;
  "inspect-pack": ModelPackInspection;
  "import-pack": ModelPackImportResult;
};

export type WorkerResponse =
  | { type: "log"; requestId: string; event: OnnxLogEvent }
  | { type: "telemetry"; requestId: string; telemetry: GenerationTelemetryEvent }
  | { type: "complete"; requestId: string; result: unknown }
  | { type: "error"; requestId: string; message: string };

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.requestId !== "string") return false;

  if (value.type === "capabilities") return true;
  if (value.type === "cancel") return typeof value.targetRequestId === "string" && value.targetRequestId.length > 0;
  if (value.type === "preload") return typeof value.modelId === "string" && value.modelId.length > 0;
  if (value.type === "cache-status") return true;
  if (value.type === "delete-cache") return typeof value.modelId === "string" && value.modelId.length > 0;
  if (value.type === "inspect-pack") {
    return isBlobLike(value.file)
      && (value.expectedModelId === undefined || typeof value.expectedModelId === "string" && value.expectedModelId.length > 0);
  }
  if (value.type === "import-pack") {
    return isBlobLike(value.file) && typeof value.expectedModelId === "string" && value.expectedModelId.length > 0;
  }
  if (value.type === "generate") {
    return isChat(value.messages)
      && typeof value.modelId === "string"
      && isRecord(value.options)
      && isOptionalFiniteNumber(value.options.maxNewTokens)
      && isOptionalFiniteNumber(value.options.temperature)
      && isOptionalFiniteNumber(value.options.topK);
  }
  return false;
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.requestId !== "string") return false;
  if (value.type === "complete") return "result" in value;
  if (value.type === "error") return typeof value.message === "string";
  if (value.type === "log") return isLogEvent(value.event);
  if (value.type === "telemetry") return isTelemetryEvent(value.telemetry);
  return false;
}

export function isWorkerResult(type: WorkerRequestType, value: unknown): value is WorkerResultMap[WorkerRequestType] {
  if (!isRecord(value)) return false;
  if (type === "capabilities") {
    return typeof value.webgpu === "boolean"
      && typeof value.wasm === "boolean"
      && typeof value.crossOriginIsolated === "boolean"
      && (value.browserEngine === "chromium"
        || value.browserEngine === "webkit"
        || value.browserEngine === "gecko"
        || value.browserEngine === "unknown")
      && (value.hardwareTier === "mobile" || value.hardwareTier === "desktop")
      && (value.maxStorageBufferBindingSize === null || isFinitePositive(value.maxStorageBufferBindingSize));
  }
  if (type === "generate") {
    return value.ok === false
      ? isRunFailureCode(value.code) && typeof value.message === "string"
      : value.ok === true
        && isRecord(value.result)
        && typeof value.result.generatedText === "string"
        && Array.isArray(value.result.inputTokens)
        && Array.isArray(value.result.generatedTokens)
        && isRecord(value.result.metrics);
  }
  if (type === "cancel") {
    return typeof value.cancelled === "boolean"
      && (typeof value.targetRequestId === "string" || (value.cancelled === false && value.targetRequestId === null));
  }
  if (type === "cache-status") {
    return Array.isArray(value.models) && value.models.every(isModelCacheSummary);
  }
  if (type === "delete-cache") {
    return value.deleted === true && typeof value.modelId === "string";
  }
  if (type === "inspect-pack") return isModelPackInspection(value);
  if (type === "import-pack") {
    return value.imported === true
      && typeof value.modelId === "string"
      && isFinitePositive(value.totalBytes)
      && isFiniteNonNegative(value.resumedBytes)
      && Number(value.resumedBytes) <= Number(value.totalBytes);
  }
  return value.ok === true;
}

function isModelPackInspection(value: Record<string, unknown>) {
  return value.formatVersion === 1
    && typeof value.fileName === "string"
    && typeof value.modelId === "string"
    && typeof value.repo === "string"
    && typeof value.revision === "string"
    && value.quantization === "q4f16"
    && isFinitePositive(value.packBytes)
    && isFinitePositive(value.modelBytes)
    && isFiniteNonNegative(value.requiredBytes)
    && (value.availableBytes === null || isFiniteNonNegative(value.availableBytes))
    && isFiniteNonNegative(value.resumableBytes)
    && typeof value.alreadyReady === "boolean"
    && isPackLicense(value.license);
}

function isPackLicense(value: unknown) {
  return isRecord(value)
    && value.spdx === "CC-BY-NC-4.0"
    && typeof value.modelCardUrl === "string"
    && typeof value.acceptableUsePolicyUrl === "string"
    && typeof value.attribution === "string";
}

function isModelCacheSummary(value: unknown) {
  return isRecord(value)
    && typeof value.modelId === "string"
    && (value.state === "missing" || value.state === "partial" || value.state === "cached")
    && isFiniteNonNegative(value.resumableBytes)
    && isFiniteNonNegative(value.verifiedBytes)
    && isFinitePositive(value.totalBytes)
    && Number(value.resumableBytes) <= Number(value.totalBytes)
    && Number(value.verifiedBytes) <= Number(value.totalBytes);
}

function isChat(value: unknown): value is ChatTurn[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 100
    && value.every((message) => isRecord(message)
      && (message.role === "system" || message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.length <= 100_000);
}

function isRunFailureCode(value: unknown) {
  return value === "CANCELLED"
    || value === "WEBGPU_UNAVAILABLE"
    || value === "MODEL_NOT_VERIFIED"
    || value === "PROMPT_TOO_LONG"
    || value === "REQUEST_FAILED";
}

function isLogEvent(value: unknown): value is OnnxLogEvent {
  return isRecord(value)
    && (value.level === "info" || value.level === "success" || value.level === "warning" || value.level === "error")
    && typeof value.message === "string"
    && (value.detail === undefined || typeof value.detail === "string")
    && (value.phase === undefined || value.phase === "download" || value.phase === "import" || value.phase === "tokenize" || value.phase === "inference" || value.phase === "generate" || value.phase === "runtime")
    && (value.progress === undefined || isDownloadProgress(value.progress))
    && (value.durationMs === undefined || isFiniteNonNegative(value.durationMs));
}

function isDownloadProgress(value: unknown) {
  if (!isRecord(value) || !isFiniteNonNegative(value.loaded) || !isFinitePositive(value.total) || Number(value.loaded) > Number(value.total)) return false;
  if (value.stage !== undefined
    && value.stage !== "validate"
    && value.stage !== "download"
    && value.stage !== "resume"
    && value.stage !== "import"
    && value.stage !== "verify"
    && value.stage !== "cache"
    && value.stage !== "ready") return false;
  if (value.resumedBytes !== undefined && (!isFiniteNonNegative(value.resumedBytes) || Number(value.resumedBytes) > Number(value.total))) return false;
  if (value.networkBytes !== undefined && !isFiniteNonNegative(value.networkBytes)) return false;
  return (value.bytesPerSecond === undefined || isFiniteNonNegative(value.bytesPerSecond))
    && (value.etaMs === undefined || isFiniteNonNegative(value.etaMs))
    && (value.elapsedMs === undefined || isFiniteNonNegative(value.elapsedMs));
}

function isTelemetryEvent(value: unknown): value is GenerationTelemetryEvent {
  return isRecord(value)
    && (value.phase === "prefill" || value.phase === "decode" || value.phase === "complete")
    && Number.isSafeInteger(value.promptTokenCount)
    && Number(value.promptTokenCount) >= 0
    && Number.isSafeInteger(value.contextTokenCount)
    && Number(value.contextTokenCount) >= 0
    && Number.isSafeInteger(value.outputTokenCount)
    && Number(value.outputTokenCount) >= 0
    && (value.generatedText === undefined || (typeof value.generatedText === "string" && value.generatedText.length <= 100_000))
    && isFiniteNonNegative(value.endToEndMs)
    && isNullableFiniteNonNegative(value.ttftMs)
    && isFiniteNonNegative(value.decodeMs)
    && isNullableFiniteNonNegative(value.decodeTokensPerSecond)
    && isNullableFiniteNonNegative(value.timePerOutputTokenMs)
    && isNullableFiniteNonNegative(value.latestInterTokenLatencyMs)
    && isNullableFiniteNonNegative(value.p95InterTokenLatencyMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlobLike(value: unknown): value is Blob {
  return isRecord(value)
    && isFiniteNonNegative(value.size)
    && typeof value.slice === "function"
    && typeof value.stream === "function";
}

function isOptionalFiniteNumber(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isFiniteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNullableFiniteNonNegative(value: unknown) {
  return value === null || isFiniteNonNegative(value);
}
