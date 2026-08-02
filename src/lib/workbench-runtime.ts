import { resolveModelProvider, type ModelManifest } from "@/lib/onnx-models";
import type { GenerationTelemetryEvent, OnnxLogEvent, RuntimeCapabilities } from "@/lib/onnx-types";
import type { FailedTurn, RuntimeActivity, WorkbenchMessage } from "@/lib/workbench-state";
import { formatGenerationRate } from "@/lib/generation-format";

export const PROMPT_SHORTCUT_HELP = "Enter sends · Shift+Enter adds a line";

export function getWelcomeMessage(message: WorkbenchMessage, model: ModelManifest | null, modelReady: boolean, isModelLoading: boolean, modelLoadPaused: boolean): WorkbenchMessage {
  if (!model) return message;
  const modelName = model.label.split(" · ")[0];
  if (modelReady) {
    return {
      ...message,
      content: `${modelName} is ready. Ask anything — your prompt and response stay in this browser.`,
      meta: "Local · on-device · no server inference"
    };
  }
  return {
    ...message,
    content: modelLoadPaused
      ? `${modelName} is selected and its download is paused. Resume to finish the download and unlock the prompt.`
      : isModelLoading
        ? `${modelName} is getting ready. The prompt will unlock after Glaux downloads and verifies it locally.`
        : `${modelName} is selected. The prompt will unlock as soon as it is ready to run privately.`,
    meta: "Local download · resumable"
  };
}

export function getModelCompatibility(capabilities: RuntimeCapabilities | null, model: ModelManifest | null) {
  if (!model) return "unselected" as const;
  if (!capabilities) return "probing" as const;
  return resolveModelProvider(model, capabilities) ? "compatible" as const : "incompatible" as const;
}

export function getPromptHelp({ downloadPercent, failedTurn, isBusy, modelCompatibility, modelLoadPaused, modelReady, runtimeActivity }: {
  downloadPercent?: number;
  failedTurn: FailedTurn | null;
  isBusy: boolean;
  modelCompatibility: ReturnType<typeof getModelCompatibility>;
  modelLoadPaused: boolean;
  modelReady: boolean;
  runtimeActivity: RuntimeActivity | null;
}) {
  if (modelCompatibility === "unselected") return "Choose a model above to begin";
  if (modelCompatibility === "probing") return "Checking browser GPU…";
  if (modelCompatibility === "incompatible") return "Selected model needs browser GPU support";
  if (modelLoadPaused) return "Paused · resume to unlock prompt";
  if (failedTurn) return `${getFailedTurnStatus(failedTurn)} · retry or edit`;
  if (!modelReady) {
    const progress = runtimeActivity?.detail ?? (downloadPercent === undefined ? "" : `${downloadPercent}%`);
    return `${runtimeActivity?.label ?? "Preparing local model"}${progress ? ` · ${progress}` : ""}`;
  }
  if (isBusy) return runtimeActivity?.label ?? "Running locally…";
  return PROMPT_SHORTCUT_HELP;
}

export function getRuntimeStatus(
  capabilities: RuntimeCapabilities | null,
  model: ModelManifest | null,
  loadedModelId: string | null,
  activity: RuntimeActivity | null,
  modelLoadPaused: boolean,
  failedTurn: FailedTurn | null,
  error: string | null
) {
  if (failedTurn) {
    return isStoppedTurn(failedTurn)
      ? { label: "Generation stopped", className: "text-sophon-warning", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" }
      : { label: "Session interrupted", className: "text-destructive", dotClassName: "bg-destructive shadow-[0_0_10px_var(--destructive)]" };
  }
  if (error) return { label: "Action needed", className: "text-destructive", dotClassName: "bg-destructive shadow-[0_0_10px_var(--destructive)]" };
  if (activity) return { label: activity.label, className: "text-sophon-signal-soft", dotClassName: "bg-sophon-signal-soft shadow-[0_0_10px_var(--sophon-signal-soft)]" };
  if (!model) return { label: "Choose model", className: "text-sophon-copy-metadata", dotClassName: "bg-sophon-signal-bright shadow-[0_0_10px_var(--sophon-signal-bright)]" };
  if (!capabilities) return { label: "Checking browser GPU", className: "text-sophon-copy-metadata", dotClassName: "animate-pulse bg-sophon-copy-metadata motion-reduce:animate-none" };
  if (getModelCompatibility(capabilities, model) === "incompatible") return { label: "Model unavailable", className: "text-destructive", dotClassName: "bg-destructive" };
  if (loadedModelId === model.id) return { label: "Model ready", className: "text-black", dotClassName: "bg-sophon-verified-bright shadow-[0_0_10px_var(--sophon-verified-bright)]" };
  if (modelLoadPaused) return { label: "Download paused", className: "text-sophon-warning", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
  return { label: "Ready to load", className: "text-sophon-copy-metadata", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
}

export function getFailedTurnStatus(failedTurn: FailedTurn) {
  return isStoppedTurn(failedTurn) ? "Generation stopped" : "Session interrupted";
}

export function isStoppedTurn(failedTurn: FailedTurn) {
  return /\bstopped\b/i.test(failedTurn.reason);
}

export function activityFromLog(event: OnnxLogEvent): RuntimeActivity {
  const phase = event.phase === "download" ? "download" : event.phase === "tokenize" ? "tokenize" : event.phase === "inference" || event.phase === "generate" ? "decode" : "runtime";
  const label = phase === "download" ? getDownloadStageLabel(event.progress?.stage) : phase === "tokenize" ? "Preparing input" : phase === "decode" ? "Generating locally" : event.message || "Initializing runtime";
  return { detail: event.progress ? formatDownloadDetail(event.progress) : event.detail, label, phase, progress: event.progress };
}

export function getDownloadStageLabel(stage?: NonNullable<OnnxLogEvent["progress"]>["stage"]) {
  if (stage === "probe") return "Checking model files";
  if (stage === "validate") return "Validating model";
  if (stage === "resume") return "Resuming model";
  if (stage === "verify") return "Verifying model";
  if (stage === "ready") return "Model ready";
  if (stage === "cache") return "Loading downloaded model";
  return "Downloading model";
}

export function formatDownloadDetail(progress: NonNullable<OnnxLogEvent["progress"]>) {
  const parts = [`${formatStorageBytes(progress.loaded)} / ${formatStorageBytes(progress.total)}`];
  if (progress.resumedBytes) parts.push(`${formatStorageBytes(progress.resumedBytes)} resumed`);
  if (progress.networkBytes !== undefined) parts.push(`${formatStorageBytes(progress.networkBytes)} transferred`);
  if (progress.bytesPerSecond !== undefined) parts.push(`${formatStorageBytes(progress.bytesPerSecond)}/s`);
  if (progress.etaMs !== undefined) parts.push(`${formatEta(progress.etaMs)} left`);
  if (progress.elapsedMs !== undefined) parts.push(`${formatElapsed(progress.elapsedMs)} elapsed`);
  return parts.join(" · ");
}

export function formatDownloadAriaText(progress: NonNullable<OnnxLogEvent["progress"]>) {
  const stage = progress.stage === "validate" ? "validated" : progress.stage === "verify" ? "verified" : progress.stage === "cache" || progress.stage === "ready" ? "loaded from browser storage" : "loaded";
  const resumed = progress.resumedBytes ? `, including ${formatStorageBytes(progress.resumedBytes)} resumed` : "";
  return `${formatStorageBytes(progress.loaded)} of ${formatStorageBytes(progress.total)} ${stage}${resumed}`;
}

export function formatDownloadPercent(progress?: NonNullable<OnnxLogEvent["progress"]>) {
  if (!progress || progress.total <= 0) return undefined;
  const percent = Math.floor(progress.loaded / progress.total * 1_000) / 10;
  return progress.loaded > 0 && percent === 0 ? "<0.1%" : `${percent.toFixed(1)}%`;
}

export function formatEta(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.ceil(minutes / 60)}h`;
}

export function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

export function activityFromTelemetry(telemetry: GenerationTelemetryEvent): RuntimeActivity {
  if (telemetry.phase === "prefill") return { detail: `${telemetry.contextTokenCount} context tokens`, label: "Reading context", phase: "prefill" };
  if (telemetry.phase === "decode") return { detail: `${telemetry.outputTokenCount} generated · ${formatGenerationRate(telemetry.decodeTokensPerSecond)}`, label: "Generating response", phase: "decode" };
  return { detail: `${telemetry.outputTokenCount} tokens generated`, label: "Finalizing response", phase: "complete" };
}

export function formatStorageBytes(bytes?: number) {
  if (bytes === undefined) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const rank = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** rank;
  return `${value.toFixed(rank > 0 && value < 10 ? 1 : 0)} ${units[rank] ?? "TB"}`;
}
