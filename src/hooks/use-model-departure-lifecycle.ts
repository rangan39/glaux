"use client";

import { useEffect, useEffectEvent } from "react";

export function requestDepartureConfirmation(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = true;
}

export function shouldReconcileAfterPageShow(event: Pick<PageTransitionEvent, "persisted">) {
  return event.persisted;
}

export function useModelDepartureLifecycle({ onDeparture, onPageRestore, warnBeforeLeaving }: {
  onDeparture: () => void;
  onPageRestore: () => void;
  warnBeforeLeaving: boolean;
}) {
  const runDepartureCleanup = useEffectEvent(onDeparture);
  const runPageRestoreCleanup = useEffectEvent(onPageRestore);

  useEffect(() => {
    if (!warnBeforeLeaving) return;
    window.addEventListener("beforeunload", requestDepartureConfirmation);
    return () => window.removeEventListener("beforeunload", requestDepartureConfirmation);
  }, [warnBeforeLeaving]);

  useEffect(() => {
    const cleanup = () => runDepartureCleanup();
    const reconcile = (event: PageTransitionEvent) => {
      if (shouldReconcileAfterPageShow(event)) runPageRestoreCleanup();
    };
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("pageshow", reconcile);
    return () => {
      window.removeEventListener("pagehide", cleanup);
      window.removeEventListener("pageshow", reconcile);
    };
  }, []);
}
