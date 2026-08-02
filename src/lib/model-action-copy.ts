import type { BrowserStorage } from "@/hooks/use-browser-storage";
import type { ModelReplacementPhase, ModelReplacementPlan } from "@/lib/model-replacement";
import type { ModelManifest } from "@/lib/onnx-models";
import type { ModelCacheSummary } from "@/lib/onnx-types";
import { formatStorageBytes } from "@/lib/workbench-runtime";

export function getModelActionLabel(plan: ModelReplacementPlan | null) {
  if (!plan) return "Download model";
  const action = plan.action === "activate" ? "use" : plan.action;
  return plan.requiresReplacement
    ? `Replace & ${action}`
    : plan.action === "activate" ? "Use model" : `${capitalize(action)} model`;
}

export function getModelActionButtonLabel(plan: ModelReplacementPlan | null) {
  if (!plan) return "Download";
  if (plan.requiresReplacement) return "Replace";
  if (plan.action === "activate") return "Use model";
  return capitalize(plan.action);
}

export function getModelActionCancelLabel(plan: ModelReplacementPlan | null) {
  if (!plan?.requiresReplacement) return "Not now";
  const replacedModelIds = plan.sourceModelIds.filter((modelId) => modelId !== plan.targetModelId);
  return replacedModelIds.length === 1 ? `Keep ${modelName(replacedModelIds[0])}` : "Keep current models";
}

export function getModelActionTitle(model: ModelManifest, plan: ModelReplacementPlan | null) {
  const targetName = model.label.split(" · ")[0];
  if (plan?.requiresReplacement) {
    const replacedModelIds = plan.sourceModelIds.filter((modelId) => modelId !== plan.targetModelId);
    const source = replacedModelIds.length === 1 ? modelName(replacedModelIds[0]) : `${replacedModelIds.length} saved models`;
    return `Replace ${source} with ${targetName}?`;
  }
  return `${plan?.action === "resume" ? "Resume" : plan?.action === "activate" ? "Use" : "Download"} ${targetName}?`;
}

export function getModelActionDescription(
  model: ModelManifest,
  cache: ModelCacheSummary | undefined,
  storage: BrowserStorage | null | undefined,
  plan: ModelReplacementPlan | null
) {
  if (!plan?.requiresReplacement) return getModelDownloadDescription(model, cache, storage);
  const targetName = model.label.split(" · ")[0];
  const available = storage && storage.quota !== undefined && storage.usage !== undefined
    ? ` ${formatStorageBytes(Math.max(0, storage.quota - storage.usage))} is currently available.`
    : "";
  return `${targetName} downloads from scratch after replacement.${available} Non-commercial use applies; switching back requires another download.`;
}

export function getReplacementBusyLabel(phase: ModelReplacementPhase | null, replacementModels: readonly ModelManifest[]) {
  if (phase === "stopping") return "Stopping current model…";
  if (phase === "deleting") {
    return replacementModels.length === 1
      ? `Removing ${replacementModels[0]!.label.split(" · ")[0]}…`
      : "Removing saved models…";
  }
  return phase === "starting" ? "Starting new model…" : undefined;
}

export function modelName(modelId: string | undefined) {
  if (!modelId) return "current model";
  return modelId.startsWith("hf:") ? modelId.slice(3).split("@")[0] ?? "current model" : "current model";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getModelDownloadDescription(model: ModelManifest, cache: ModelCacheSummary | undefined, storage: BrowserStorage | null | undefined) {
  const resumableBytes = cache?.state === "partial" ? cache.resumableBytes : 0;
  const totalBytes = model.format.sizeBytes ?? cache?.totalBytes ?? 0;
  const remainingBytes = Math.max(0, totalBytes - resumableBytes);
  const action = resumableBytes > 0
    ? `Glaux found ${formatStorageBytes(resumableBytes)} of resumable data and will download about ${formatStorageBytes(remainingBytes)} more.`
    : `Glaux will download ${model.format.sizeLabel} to this browser before it can answer locally.`;
  const availableBytes = storage?.quota !== undefined && storage.usage !== undefined ? Math.max(0, storage.quota - storage.usage) : null;
  const storageMessage = availableBytes === null
    ? "Your browser will verify available storage before downloading."
    : `This browser currently reports ${formatStorageBytes(availableBytes)} available.`;
  return `${action} ${storageMessage} Review the selected model’s license and repository terms before use.`;
}
