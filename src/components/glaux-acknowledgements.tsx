"use client";

import { lazy, Suspense, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const GlauxAcknowledgementsDialog = lazy(() => import("@/components/glaux-acknowledgements-dialog"));

export function GlauxAcknowledgements({ ariaLabel, className, compact = false, label }: {
  ariaLabel?: string;
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
        aria-label={visibleLabel ? undefined : ariaLabel ?? "About Glaux"}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex items-center justify-center gap-1.5 uppercase text-glaux-copy-primary transition-colors hover:text-glaux-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glaux-signal",
          compact
            ? visibleLabel
              ? "glaux-type-action min-h-11 shrink-0 rounded-xl border border-glaux-glass-border bg-glaux-glass-tile px-3 tracking-[0.06em]"
              : "size-11 shrink-0 rounded-xl border border-glaux-glass-border bg-glaux-glass-tile sm:size-9"
            : "-mx-2 min-h-9 px-2 focus-visible:rounded-md",
          className
        )}
        onClick={() => setShowDialog(true)}
        data-typography-role={visibleLabel ? "action" : undefined}
        ref={triggerRef}
        title={compact && !visibleLabel ? "About Glaux" : undefined}
        type="button"
      >
        {compact ? <Info aria-hidden="true" className="size-4" /> : null}
        {visibleLabel ? <span className={cn(!compact && "whitespace-nowrap underline decoration-glaux-signal-bright underline-offset-2")}>{visibleLabel}</span> : null}
      </button>

      {showDialog ? (
        <Suspense fallback={<span className="sr-only" role="status">Opening acknowledgements</span>}>
          <GlauxAcknowledgementsDialog onDismiss={() => setShowDialog(false)} triggerRef={triggerRef} />
        </Suspense>
      ) : null}
    </>
  );
}
