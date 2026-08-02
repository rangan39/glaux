"use client";

import { useEffect, useEffectEvent } from "react";

export function requestDepartureConfirmation(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = true;
}

export function useModelDepartureLifecycle({ onDeparture, warnBeforeLeaving }: {
  onDeparture: () => void;
  warnBeforeLeaving: boolean;
}) {
  const runDepartureCleanup = useEffectEvent(onDeparture);

  useEffect(() => {
    if (!warnBeforeLeaving) return;
    window.addEventListener("beforeunload", requestDepartureConfirmation);
    return () => window.removeEventListener("beforeunload", requestDepartureConfirmation);
  }, [warnBeforeLeaving]);

  useEffect(() => {
    const cleanup = () => runDepartureCleanup();
    window.addEventListener("pagehide", cleanup);
    return () => window.removeEventListener("pagehide", cleanup);
  }, []);
}
