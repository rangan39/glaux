"use client";

import { useEffect, useEffectEvent, type Dispatch } from "react";
import { cancelModelPreload, preloadModel, terminateRuntimeWorker } from "@/lib/interp-client";
import { resolveModelProvider, type ModelManifest } from "@/lib/onnx-models";
import type { RuntimeCapabilities } from "@/lib/onnx-types";
import { activityFromLog } from "@/lib/workbench-runtime";
import type { WorkbenchSessionAction } from "@/lib/workbench-state";

export function useActiveModelPreload({
  capabilities,
  dispatch,
  enabled,
  generationIdRef,
  model,
  paused,
  onStorageChanged
}: {
  capabilities: RuntimeCapabilities | null;
  dispatch: Dispatch<WorkbenchSessionAction>;
  enabled: boolean;
  generationIdRef: { current: number };
  model: ModelManifest | null;
  paused: boolean;
  onStorageChanged: () => void;
}) {
  const notifyStorageChanged = useEffectEvent(onStorageChanged);

  useEffect(() => {
    if (!enabled || !model || paused || !capabilities || !resolveModelProvider(model, capabilities)) return;
    const loadId = generationIdRef.current += 1;
    queueMicrotask(() => {
      if (generationIdRef.current === loadId) {
        dispatch({ type: "field/set", field: "generation", value: { status: "loading", activity: { detail: `${model.label} · ${model.format.sizeLabel}`, label: "Preparing local model", phase: "runtime" } } });
      }
    });
    void preloadModel(model.id, (event) => {
      if (generationIdRef.current === loadId) {
        dispatch({ type: "field/set", field: "generation", value: (current) => current.status === "loading" ? { ...current, activity: activityFromLog(event) } : current });
      }
    }).then(() => {
      if (generationIdRef.current === loadId) {
        dispatch({ type: "field/set", field: "loadedModelId", value: model.id });
      }
    }).catch((caught) => {
      if (generationIdRef.current === loadId) {
        dispatch({ type: "field/set", field: "error", value: caught instanceof Error ? caught.message : `${model.label} could not load.` });
      }
    }).finally(() => {
      if (generationIdRef.current === loadId) {
        dispatch({ type: "field/set", field: "generation", value: { status: "idle" } });
        notifyStorageChanged();
      }
    });
    return () => {
      if (generationIdRef.current === loadId) generationIdRef.current += 1;
      void cancelModelPreload().catch(() => terminateRuntimeWorker());
    };
  }, [capabilities, dispatch, enabled, generationIdRef, model, paused]);
}
