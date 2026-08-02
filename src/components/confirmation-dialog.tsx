"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ConfirmationDialog({ busy = false, busyLabel, cancelAriaLabel, cancelLabel, confirmAriaLabel, confirmLabel, confirmTone = "destructive", description, details, onCancel, onConfirm, title }: {
  busy?: boolean;
  busyLabel?: string;
  cancelAriaLabel?: string;
  cancelLabel: string;
  confirmAriaLabel?: string;
  confirmLabel: string;
  confirmTone?: "default" | "destructive";
  description: string;
  details?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {details}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <AlertDialogCancel asChild>
            <Button aria-label={cancelAriaLabel} className="h-10 min-w-0 rounded-xl px-3 sm:h-9" disabled={busy} type="button" variant="sophon">{cancelLabel}</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              aria-label={confirmAriaLabel}
              className={cn("h-10 min-w-0 rounded-xl px-3 sm:h-9", confirmTone === "destructive" && "bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/85")}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                onConfirm();
              }}
              type="button"
            >
              {busy ? busyLabel ?? confirmLabel : confirmLabel}
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
