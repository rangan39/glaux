"use client";

import { lazy, Suspense, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const SophonAcknowledgementsDialog = lazy(() => import("@/components/sophon-acknowledgements-dialog"));

export function SophonAcknowledgements({ className, compact = false, label }: {
  className?: string;
  compact?: boolean;
  label?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showDialog, setShowDialog] = useState(false);
  const visibleLabel = label ?? (compact ? null : "Made in Toronto by Rangan39");

  return (
    <>
      <button
        aria-label={visibleLabel ? undefined : "About Sophon"}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex items-center justify-center gap-1.5 uppercase text-sophon-copy-primary transition-colors hover:text-sophon-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal",
          compact
            ? visibleLabel
              ? "sophon-type-action min-h-11 shrink-0 rounded-xl border border-sophon-glass-border bg-sophon-glass-tile px-3 tracking-[0.06em]"
              : "size-11 shrink-0 rounded-xl border border-sophon-glass-border bg-sophon-glass-tile sm:size-9"
            : "-mx-2 min-h-9 px-2 focus-visible:rounded-md",
          className
        )}
        onClick={() => setShowDialog(true)}
        data-typography-role={visibleLabel ? "action" : undefined}
        ref={triggerRef}
        title={compact && !visibleLabel ? "About Sophon" : undefined}
        type="button"
      >
        {compact ? <Info aria-hidden="true" className="size-4" /> : null}
        {visibleLabel ? <span className={cn(!compact && "whitespace-nowrap underline decoration-sophon-signal-bright underline-offset-2")}>{visibleLabel}</span> : null}
      </button>

      {showDialog ? (
        <Suspense fallback={<span className="sr-only" role="status">Opening acknowledgements</span>}>
          <SophonAcknowledgementsDialog onDismiss={() => setShowDialog(false)} triggerRef={triggerRef} />
        </Suspense>
      ) : null}
    </>
  );
}
