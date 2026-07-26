"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject
} from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { INFO_HINTS, type InfoHintId } from "@/lib/info-hints";
import { cn } from "@/lib/utils";

type InfoHintProps = {
  className?: string;
  concept: InfoHintId;
  portalContainer?: RefObject<HTMLElement | null>;
};

export function InfoHint({ className, concept, portalContainer }: InfoHintProps) {
  const hint = INFO_HINTS[concept];
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const pointerFocusRef = useRef(false);
  const [openReason, setOpenReason] = useState<"focus" | "hover" | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!openReason) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setPortalTarget(portalContainer?.current ?? trigger.closest("main") ?? document.body);
      const bounds = trigger.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 20);
      const center = bounds.left + bounds.width / 2;
      setPosition({
        left: Math.max(10 + width / 2, Math.min(window.innerWidth - 10 - width / 2, center)),
        maxWidth: width,
        top: Math.max(10, bounds.top - 7),
        transform: "translate(-50%, -100%)"
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [openReason, portalContainer]);

  function handleMouseEnter() {
    setOpenReason("hover");
  }

  function handleMouseLeave() {
    setOpenReason((current) => current === "hover" ? null : current);
  }

  function handlePointerDown() {
    pointerFocusRef.current = true;
    queueMicrotask(() => {
      pointerFocusRef.current = false;
    });
  }

  function handleFocus() {
    if (!pointerFocusRef.current) setOpenReason("focus");
  }

  function handleBlur() {
    setOpenReason((current) => current === "focus" ? null : current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "Escape" || !openReason) return;
    event.preventDefault();
    event.stopPropagation();
    setOpenReason(null);
  }

  const tooltip = openReason && portalTarget && typeof document !== "undefined"
    ? createPortal(
      <span
        className="sophon-type-metadata fixed z-[70] w-max rounded-lg border border-sophon-glass-border bg-sophon-panel/95 px-3 py-2.5 text-left font-normal tracking-normal text-sophon-copy-body shadow-[0_18px_52px_var(--sophon-glass-shadow),inset_0_1px_0_var(--sophon-glass-highlight)] outline-none backdrop-blur-xl"
        data-help-id={concept}
        data-slot="tooltip-content"
        id={tooltipId}
        role="tooltip"
        style={position ?? { visibility: "hidden" }}
      >
        <span className="sr-only">{hint.title}. </span>{hint.description}
      </span>,
      portalTarget
    )
    : null;

  return (
    <>
      <span
        aria-describedby={tooltipId}
        aria-label={hint.label}
        className={cn(
          "inline-grid size-7 shrink-0 place-items-center rounded-md text-sophon-copy-decorative transition-colors hover:bg-sophon-glass-tile hover:text-sophon-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal",
          openReason && "bg-sophon-glass-tile text-sophon-signal-soft",
          className
        )}
        data-help-id={concept}
        data-info-hint-trigger=""
        onBlur={handleBlur}
        onClick={() => setOpenReason(null)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        ref={triggerRef}
        tabIndex={0}
      >
        <Info aria-hidden="true" className="size-3.5 stroke-[1.75]" />
      </span>
      {tooltip}
    </>
  );
}
