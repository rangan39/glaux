import type { ModelCacheSummary } from "@/lib/onnx-types";

export function getStoredModelSummary(cacheSummaries: readonly ModelCacheSummary[]) {
  return cacheSummaries.find(({ state }) => state !== "missing") ?? null;
}

export function shouldWarnForModelDeparture(cacheSummaries: readonly ModelCacheSummary[], modelActivity: { loading: boolean; paused: boolean }) {
  return getStoredModelSummary(cacheSummaries) !== null || modelActivity.loading || modelActivity.paused;
}

export function formatStoredModelDisclosure(summary: ModelCacheSummary, modelLabel?: string) {
  const label = modelLabel?.split(" · ")[0] ?? "Model";
  if (summary.state === "partial") {
    return `${label} · partial · removed on exit`;
  }
  return `${label} · ${formatBytes(summary.totalBytes)} · removed on exit`;
}

function formatBytes(bytes: number) {
  const gibibytes = bytes / 1024 ** 3;
  if (gibibytes >= 1) return `${Number(gibibytes.toFixed(2))} GB`;
  const mebibytes = bytes / 1024 ** 2;
  return `${Math.max(0, Math.round(mebibytes))} MB`;
}
