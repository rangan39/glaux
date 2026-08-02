"use client";

import { useEffect, useState } from "react";

import { getRuntimeCapabilities } from "@/lib/browser-runtime";

export function RuntimeCapabilitiesProbe() {
  const [result, setResult] = useState("probing");

  useEffect(() => {
    let active = true;
    void getRuntimeCapabilities().then((capabilities) => {
      if (active) setResult(JSON.stringify(capabilities));
    });
    return () => {
      active = false;
    };
  }, []);

  return <output data-testid="runtime-capabilities">{result}</output>;
}
