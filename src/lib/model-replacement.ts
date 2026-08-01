import type { ModelCacheState, ModelCacheSummary } from "@/lib/onnx-types";

export type ModelReplacementAction = "activate" | "download" | "resume";

export type ModelReplacementPlan = {
  action: ModelReplacementAction;
  bytesToRemove: number;
  modelIdsToDelete: string[];
  requiresReplacement: boolean;
  sourceModelIds: string[];
  targetModelId: string;
  targetState: ModelCacheState;
};

export type StartupModelCleanupPlan = {
  bytesToRemove: number;
  modelIdsToDelete: string[];
  requiresCleanup: boolean;
  storedModelIds: string[];
};

export type ModelReplacementPhase = "stopping" | "deleting" | "starting";

type ModelCleanupTransaction = {
  deleteStoredModel: (modelId: string) => Promise<void>;
  onPhaseChange: (phase: ModelReplacementPhase) => void;
  readCacheSummaries: () => Promise<ModelCacheSummary[]>;
  stopActiveModel: () => Promise<void>;
};

export function createModelReplacementPlan(
  targetModelId: string,
  cacheSummaries: readonly ModelCacheSummary[]
): ModelReplacementPlan {
  const target = cacheSummaries.find((summary) => summary.modelId === targetModelId);
  const targetState = target?.state ?? "missing";
  const storedModels = cacheSummaries.filter((summary) => summary.state !== "missing");
  const requiresReplacement = storedModels.some((summary) => (
    summary.modelId !== targetModelId && summary.state !== "missing"
  ));
  const sources = requiresReplacement ? storedModels : [];

  return {
    action: requiresReplacement
      ? "download"
      : targetState === "cached" ? "activate" : targetState === "partial" ? "resume" : "download",
    bytesToRemove: sources.reduce((total, source) => (
      total + (source.state === "partial" ? source.resumableBytes : source.totalBytes)
    ), 0),
    modelIdsToDelete: requiresReplacement
      ? cacheSummaries.map((summary) => summary.modelId)
      : [],
    requiresReplacement,
    sourceModelIds: sources.map((source) => source.modelId),
    targetModelId,
    targetState
  };
}

export function createStartupModelCleanupPlan(
  cacheSummaries: readonly ModelCacheSummary[]
): StartupModelCleanupPlan {
  const storedModels = cacheSummaries.filter((summary) => summary.state !== "missing");
  const requiresCleanup = storedModels.length > 1;
  return {
    bytesToRemove: requiresCleanup
      ? storedModels.reduce((total, source) => (
        total + (source.state === "partial" ? source.resumableBytes : source.totalBytes)
      ), 0)
      : 0,
    modelIdsToDelete: requiresCleanup
      ? cacheSummaries.map((summary) => summary.modelId)
      : [],
    requiresCleanup,
    storedModelIds: storedModels.map((summary) => summary.modelId)
  };
}

export async function runModelReplacement(
  plan: ModelReplacementPlan,
  transaction: ModelCleanupTransaction
) {
  const cacheSummaries = await runModelStorageCleanup(plan.modelIdsToDelete, transaction);
  transaction.onPhaseChange("starting");
  return cacheSummaries;
}

export async function runStartupModelCleanup(
  plan: StartupModelCleanupPlan,
  transaction: ModelCleanupTransaction
) {
  if (!plan.requiresCleanup) return transaction.readCacheSummaries();
  return runModelStorageCleanup(plan.modelIdsToDelete, transaction);
}

async function runModelStorageCleanup(
  modelIdsToDelete: readonly string[],
  transaction: ModelCleanupTransaction
) {
  transaction.onPhaseChange("stopping");
  await transaction.stopActiveModel();

  transaction.onPhaseChange("deleting");
  for (const modelId of modelIdsToDelete) {
    await transaction.deleteStoredModel(modelId);
  }

  const cacheSummaries = await transaction.readCacheSummaries();
  const remainingModels = cacheSummaries.filter((summary) => summary.state !== "missing");
  if (remainingModels.length > 0) {
    throw new Error(`Glaux could not finish removing saved model files for ${remainingModels.map((summary) => summary.modelId).join(", ")}.`);
  }
  return cacheSummaries;
}
