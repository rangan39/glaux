import type { GenerationTelemetryEvent, OnnxLogEvent } from "@/lib/onnx-types";
import { isWorkerRequest, type WorkerRequest } from "@/lib/onnx-worker-protocol";

let taskQueue = Promise.resolve();
const requestControllers = new Map<string, AbortController>();

function postLog(requestId: string, event: OnnxLogEvent) {
  self.postMessage({ type: "log", requestId, event });
}

function postTelemetry(requestId: string, telemetry: GenerationTelemetryEvent) {
  self.postMessage({ type: "telemetry", requestId, telemetry });
}

function complete(requestId: string, result: unknown) {
  self.postMessage({ type: "complete", requestId, result });
}

function fail(requestId: string, error: unknown) {
  self.postMessage({
    type: "error",
    requestId,
    message: error instanceof Error ? error.message : "The model worker failed."
  });
}

self.onmessage = (message: MessageEvent<unknown>) => {
  const request = message.data;
  if (!isWorkerRequest(request)) {
    const requestId = readRequestId(request);
    if (requestId) fail(requestId, new Error("The model worker received an invalid request."));
    return;
  }

  if (request.type === "capabilities") {
    void import("@/lib/browser-runtime")
      .then(({ getRuntimeCapabilities }) => getRuntimeCapabilities())
      .then((capabilities) => complete(request.requestId, capabilities))
      .catch((error) => fail(request.requestId, error));
    return;
  }

  if (request.type === "cancel") {
    const controller = requestControllers.get(request.targetRequestId);
    const cancelled = Boolean(controller && !controller.signal.aborted);
    controller?.abort();
    complete(request.requestId, { cancelled, targetRequestId: request.targetRequestId });
    return;
  }

  if (request.type === "generate" || request.type === "preload" || request.type === "delete-cache" || request.type === "import-pack") {
    requestControllers.set(request.requestId, new AbortController());
  }

  taskQueue = taskQueue.then(() => runQueuedRequest(request));
};

async function runQueuedRequest(request: Exclude<WorkerRequest, { type: "capabilities" | "cancel" }>) {
  try {
    if (request.type === "cache-status") {
      const { getModelCacheStatus } = await import("@/lib/model-delivery/cache-status");
      complete(request.requestId, { models: await getModelCacheStatus() });
      return;
    }
    if (request.type === "inspect-pack") {
      const { inspectOfflineModelPack } = await import("@/lib/model-delivery/model-pack-importer");
      complete(request.requestId, await inspectOfflineModelPack(request.file, request.expectedModelId));
      return;
    }
    if (request.type === "import-pack") {
      const { importOfflineModelPack } = await import("@/lib/model-delivery/model-pack-importer");
      complete(request.requestId, await importOfflineModelPack(
        request.file,
        request.expectedModelId,
        (progress) => postLog(request.requestId, {
          level: progress.stage === "ready" ? "success" : "info",
          message: modelPackProgressMessage(progress.stage),
          phase: "import",
          progress
        }),
        requestControllers.get(request.requestId)?.signal
      ));
      return;
    }
    const {
      deleteOnnxModelCache,
      preloadOnnxModel,
      runOnnxTextModel
    } = await import("@/lib/onnx-runner");
    if (request.type === "generate") {
      const controller = requestControllers.get(request.requestId);
      complete(request.requestId, await runOnnxTextModel(request.messages, {
        modelId: request.modelId,
        ...request.options,
        signal: controller?.signal,
        onLog: (event) => postLog(request.requestId, event),
        onTelemetry: (telemetry) => postTelemetry(request.requestId, telemetry)
      }));
      return;
    }
    if (request.type === "preload") {
      await preloadOnnxModel(
        request.modelId,
        (event) => postLog(request.requestId, event),
        requestControllers.get(request.requestId)?.signal
      );
      complete(request.requestId, { ok: true });
      return;
    }
    complete(request.requestId, await deleteOnnxModelCache(
      request.modelId,
      requestControllers.get(request.requestId)?.signal
    ));
  } catch (error) {
    fail(request.requestId, error);
  } finally {
    requestControllers.delete(request.requestId);
  }
}

function modelPackProgressMessage(stage: "validate" | "download" | "resume" | "import" | "verify" | "cache" | "ready") {
  if (stage === "validate") return "Validating offline model pack";
  if (stage === "import") return "Importing offline model pack";
  if (stage === "verify") return "Verifying imported model";
  if (stage === "ready") return "Offline model ready";
  return "Preparing imported model";
}

function readRequestId(value: unknown) {
  if (typeof value !== "object" || value === null || !("requestId" in value)) return null;
  return typeof value.requestId === "string" ? value.requestId : null;
}
