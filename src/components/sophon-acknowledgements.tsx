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
          "inline-flex items-center justify-center gap-1.5 uppercase text-white/65 transition-colors hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning",
          compact
            ? visibleLabel
              ? "min-h-11 shrink-0 rounded-xl border border-white/10 bg-white/[.035] px-3 text-[11px] font-semibold tracking-[0.08em]"
              : "size-11 shrink-0 rounded-xl border border-white/10 bg-white/[.035] sm:size-9"
            : "-mx-2 min-h-9 px-2 focus-visible:rounded-md",
          className
        )}
        onClick={() => setShowDialog(true)}
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
