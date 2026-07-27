import type { ModelCacheState, ModelCacheSummary } from "@/lib/onnx-types";

export type ModelReplacementAction = "activate" | "download" | "resume";

export type ModelReplacementPlan = {
  action: ModelReplacementAction;
  bytesToRemove: number;
  requiresReplacement: boolean;
  sourceModelIds: string[];
  targetModelId: string;
  targetState: ModelCacheState;
};

export type ModelReplacementPhase = "stopping" | "deleting" | "starting";

type ModelReplacementTransaction = {
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
    requiresReplacement,
    sourceModelIds: sources.map((source) => source.modelId),
    targetModelId,
    targetState
  };
}

export async function runModelReplacement(
  plan: ModelReplacementPlan,
  transaction: ModelReplacementTransaction
) {
  transaction.onPhaseChange("stopping");
  await transaction.stopActiveModel();

  transaction.onPhaseChange("deleting");
  for (const sourceModelId of plan.sourceModelIds) {
    await transaction.deleteStoredModel(sourceModelId);
  }

  const cacheSummaries = await transaction.readCacheSummaries();
  const remainingSources = createModelReplacementPlan(plan.targetModelId, cacheSummaries).sourceModelIds;
  if (remainingSources.length > 0) {
    throw new Error("Sophon could not finish removing the previously saved model.");
  }

  transaction.onPhaseChange("starting");
  return cacheSummaries;
}
