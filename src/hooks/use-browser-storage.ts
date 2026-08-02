"use client";

import { useEffect, useState } from "react";

export type BrowserStorage = StorageEstimate & { persistent: boolean };

export function useBrowserStorage(enabled: boolean, revision: number) {
  const [storage, setStorage] = useState<BrowserStorage | null>();

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const manager = navigator.storage;
    const estimate = manager?.estimate ? manager.estimate() : Promise.resolve(null);
    void Promise.all([estimate, manager?.persisted?.() ?? false])
      .then(([nextStorage, persistent]) => {
        if (active) setStorage(nextStorage ? { ...nextStorage, persistent } : null);
      })
      .catch(() => {
        if (active) setStorage(null);
      });
    return () => { active = false; };
  }, [enabled, revision]);

  return [storage, setStorage] as const;
}
