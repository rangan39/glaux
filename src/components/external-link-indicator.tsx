import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function ExternalLinkIndicator({ className }: { className?: string }) {
  return (
    <>
      <ExternalLink aria-hidden="true" className={cn("size-3 shrink-0", className)} />
      <span className="sr-only"> (opens in a new tab)</span>
    </>
  );
}
