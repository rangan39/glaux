"use client";

import { useEffect, useState } from "react";
import { listSavedCommunityModelDescriptors } from "@/lib/model-catalog";
import { communityDescriptorToManifest, type ModelManifest } from "@/lib/onnx-models";

export function useCommunityModelInventory(enabled: boolean) {
  const [models, setModels] = useState<ModelManifest[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void listSavedCommunityModelDescriptors()
      .then((descriptors) => {
        if (active) setModels(descriptors.map(communityDescriptorToManifest));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [enabled]);

  return [models, setModels] as const;
}
