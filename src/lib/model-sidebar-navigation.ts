import type { ModelCacheState } from "@/lib/onnx-types";

export function getReadySidebarModelId({
  cacheState,
  loaded,
  modelId
}: {
  cacheState: ModelCacheState;
  loaded: boolean;
  modelId: string;
}) {
  return cacheState === "cached" && loaded && modelId ? modelId : null;
}

export function getActiveSidebarModelId({
  cacheState,
  loading,
  modelId
}: {
  cacheState: ModelCacheState;
  loading: boolean;
  modelId: string;
}) {
  return modelId && (loading || cacheState !== "missing") ? modelId : null;
}
