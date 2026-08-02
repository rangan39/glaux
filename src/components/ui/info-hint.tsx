"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { INFO_HINTS, type InfoHintId } from "@/lib/info-hints";
import { cn } from "@/lib/utils";

type InfoHintProps = {
  className?: string;
  concept: InfoHintId;
};

export function InfoHint({ className, concept }: InfoHintProps) {
  const hint = INFO_HINTS[concept];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={hint.label}
          className={cn(
            "inline-grid size-7 shrink-0 place-items-center rounded-md text-glaux-copy-decorative transition-colors hover:bg-glaux-glass-tile hover:text-glaux-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glaux-signal",
            className
          )}
          data-help-id={concept}
          data-info-hint-trigger=""
          type="button"
        >
          <Info aria-hidden="true" className="size-3.5 stroke-[1.75]" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="glaux-type-metadata z-[70] max-w-[17.5rem] rounded-lg border border-glaux-glass-border bg-glaux-panel/95 px-3 py-2.5 text-left font-normal tracking-normal text-glaux-copy-body shadow-[0_18px_52px_var(--glaux-glass-shadow),inset_0_1px_0_var(--glaux-glass-highlight)] backdrop-blur-xl" data-help-id={concept} data-slot="tooltip-content">
        <span className="sr-only">{hint.title}. </span>{hint.description}
      </TooltipContent>
    </Tooltip>
  );
}
