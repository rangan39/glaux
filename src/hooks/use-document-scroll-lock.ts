"use client";

import { useLayoutEffect, type RefObject } from "react";

export type DocumentScrollSnapshot = {
  height: number;
  x: number;
  y: number;
};

export function captureDialogScrollSnapshot(snapshotRef: RefObject<DocumentScrollSnapshot | null>) {
  snapshotRef.current = {
    height: document.documentElement.scrollHeight,
    x: window.scrollX,
    y: window.scrollY
  };
}

export function useDocumentScrollLock(locked: boolean, snapshotRef: RefObject<DocumentScrollSnapshot | null>) {
  useLayoutEffect(() => {
    if (!locked) return;

    const root = document.documentElement;
    const body = document.body;
    const snapshot = snapshotRef.current;
    const scrollX = snapshot?.x ?? window.scrollX;
    const scrollY = snapshot?.y ?? window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingInlineEnd = body.style.paddingInlineEnd;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyLeft = body.style.left;
    const previousBodyWidth = body.style.width;
    const bodyPaddingInlineEnd = Number.parseFloat(window.getComputedStyle(body).paddingInlineEnd) || 0;
    const documentHeight = snapshot?.height ?? root.scrollHeight;
    const scrollSpacer = document.createElement("div");

    scrollSpacer.ariaHidden = "true";
    scrollSpacer.style.height = `${documentHeight}px`;
    scrollSpacer.style.pointerEvents = "none";
    scrollSpacer.style.width = "1px";
    root.append(scrollSpacer);
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `${-scrollY}px`;
    body.style.left = `${-scrollX}px`;
    body.style.width = "100%";
    if (scrollbarWidth > 0) body.style.paddingInlineEnd = `${bodyPaddingInlineEnd + scrollbarWidth}px`;
    window.scrollTo(scrollX, scrollY);
    const restoreFrame = window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));

    return () => {
      window.cancelAnimationFrame(restoreFrame);
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingInlineEnd = previousBodyPaddingInlineEnd;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.left = previousBodyLeft;
      body.style.width = previousBodyWidth;
      scrollSpacer.remove();
      window.scrollTo(scrollX, scrollY);
      snapshotRef.current = null;
    };
  }, [locked, snapshotRef]);
}
