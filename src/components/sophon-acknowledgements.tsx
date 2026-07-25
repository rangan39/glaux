"use client";

import { lazy, Suspense, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const SophonAcknowledgementsDialog = lazy(() => import("@/components/sophon-acknowledgements-dialog"));

export function SophonAcknowledgements({ compact = false }: { compact?: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <button
        aria-label={compact ? "About Sophon" : undefined}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex items-center justify-center gap-1.5 uppercase text-white/65 transition-colors hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning",
          compact ? "size-11 shrink-0 rounded-xl border border-white/10 bg-white/[.035] sm:size-9" : "-mx-2 min-h-9 px-2 focus-visible:rounded-md"
        )}
        onClick={() => setShowDialog(true)}
        ref={triggerRef}
        title={compact ? "About Sophon" : undefined}
        type="button"
      >
        {compact ? <Info aria-hidden="true" className="size-4" /> : <span className="whitespace-nowrap underline decoration-sophon-signal-bright underline-offset-2">Made in Toronto by Rangan39</span>}
      </button>

      {showDialog ? (
        <Suspense fallback={<span className="sr-only" role="status">Opening acknowledgements</span>}>
          <SophonAcknowledgementsDialog onDismiss={() => setShowDialog(false)} triggerRef={triggerRef} />
        </Suspense>
      ) : null}
    </>
  );
}
