import { listSavedCommunityModelDescriptors } from "@/lib/model-catalog/descriptor-store";
import { getCommunityModelCacheSummary, getCommunityStorageModel } from "@/lib/model-delivery/community-delivery";
import { reconcileModelStorage } from "@/lib/model-delivery/opfs-store";
import type { ModelCacheSummary } from "@/lib/onnx-types";

export async function getModelCacheStatus(): Promise<ModelCacheSummary[]> {
  const descriptors = await listSavedCommunityModelDescriptors();
  await reconcileModelStorage(new Set(descriptors.map((descriptor) => getCommunityStorageModel(descriptor).modelId)));
  return Promise.all(descriptors.map(getCommunityModelCacheSummary));
}
