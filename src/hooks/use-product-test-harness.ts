"use client";

import { useEffect, useEffectEvent, useState } from "react";
import {
  createProductTestSnapshot,
  PRODUCT_TESTING_BUILD,
  readProductTestModelId,
  readProductTestState,
  type ProductTestModelId,
  type ProductTestSnapshot,
  type ProductTestState
} from "@/lib/product-test-fixtures";

export function useProductTestRoute() {
  const [state, setState] = useState<ProductTestState | null | undefined>(PRODUCT_TESTING_BUILD ? undefined : null);
  const [modelId, setModelId] = useState<ProductTestModelId | null | undefined>(PRODUCT_TESTING_BUILD ? undefined : null);

  useEffect(() => {
    if (!PRODUCT_TESTING_BUILD) return;
    queueMicrotask(() => {
      const search = window.location.search;
      setModelId(readProductTestModelId(search));
      setState(readProductTestState(search));
    });
  }, []);

  return { modelId, runtimeEnabled: state === null, state };
}

export function useProductTestHydration(
  state: ProductTestState | null | undefined,
  modelId: ProductTestModelId | null | undefined,
  onHydrate: (snapshot: ProductTestSnapshot) => void
) {
  const hydrate = useEffectEvent(onHydrate);

  useEffect(() => {
    if (!state || !modelId) return;
    const snapshot = createProductTestSnapshot(state, modelId);
    queueMicrotask(() => hydrate(snapshot));
  }, [modelId, state]);
}
