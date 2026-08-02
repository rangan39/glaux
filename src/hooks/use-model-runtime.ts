"use client";

import { useEffect, useState } from "react";
import { getCapabilities } from "@/lib/interp-client";
import type { RuntimeCapabilities } from "@/lib/onnx-types";

const UNAVAILABLE_CAPABILITIES: RuntimeCapabilities = {
  webgpu: false,
  wasm: false,
  crossOriginIsolated: false,
  browserEngine: "unknown",
  hardwareTier: "desktop",
  maxStorageBufferBindingSize: null
};

export function useModelRuntimeCapabilities(enabled: boolean) {
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void getCapabilities()
      .then((nextCapabilities) => {
        if (active) setCapabilities(nextCapabilities);
      })
      .catch(() => {
        if (active) setCapabilities(UNAVAILABLE_CAPABILITIES);
      });
    return () => { active = false; };
  }, [enabled]);

  return [capabilities, setCapabilities] as const;
}
