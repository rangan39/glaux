"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { FileText, HeartHandshake, Scale, ShieldCheck, X } from "lucide-react";
import { ExternalLinkIndicator } from "@/components/external-link-indicator";
import { Button } from "@/components/ui/button";
import {
  COHERE_LABS_AUP_URL,
  PRIVACY_PATH,
  PROJECT_SUPPORT_URL,
  TINY_AYA_LICENSE_URL
} from "@/lib/trust-navigation";

const ACKNOWLEDGEMENT_SECTIONS = [
  {
    id: "technical",
    title: "Technical",
    description: "Open model and local inference stack.",
    items: [
      {
        label: "Models",
        name: "Cohere Labs · Tiny Aya",
        description: "Multilingual Global, Earth, Fire, and Water model family.",
        href: "https://huggingface.co/CohereLabs"
      },
      {
        label: "Model format",
        name: "ONNX Community",
        description: "Browser-ready ONNX conversions for local inference.",
        href: "https://huggingface.co/onnx-community"
      },
      {
        label: "Browser runtime",
        name: "Transformers.js",
        description: "Model loading, tokenization, and generation in the browser.",
        href: "https://github.com/huggingface/transformers.js"
      },
      {
        label: "Inference engine",
        name: "ONNX Runtime Web",
        description: "Hardware-accelerated local inference through WebGPU.",
        href: "https://onnxruntime.ai/"
      }
    ]
  },
  {
    id: "community",
    title: "Community",
    description: "With appreciation for Toronto’s AI community.",
    items: [
      {
        label: "AI ecosystem",
        name: "Radical Ventures",
        description: "Backing ambitious teams building the future of AI.",
        href: "https://radical.vc/"
      },
      {
        label: "Founder network",
        name: "NEXT Canada",
        description: "Growing Canada’s next generation of entrepreneurs.",
        href: "https://www.nextcanada.com/"
      },
      {
        label: "AI safety",
        name: "Trajectory Labs",
        description: "A Toronto home for AI safety research and community.",
        href: "https://www.trajectorylabs.org/"
      }
    ]
  }
] as const;

interface SophonAcknowledgementsDialogProps {
  onDismiss: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export default function SophonAcknowledgementsDialog({ onDismiss, triggerRef }: SophonAcknowledgementsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  function closeDialog() {
    const dialog = dialogRef.current;
    if (!dialog?.open || closingRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => dialog.close(), 100);
  }

  function handleClose() {
    triggerRef.current?.focus();
    onDismiss();
  }

  return (
    <dialog
      aria-labelledby="about-sophon-title"
      className="fixed inset-0 z-50 m-0 h-svh max-h-none w-full max-w-none items-center justify-center bg-transparent p-4 backdrop:bg-black/75 backdrop:backdrop-blur-sm open:flex sm:p-8"
      data-state={closing ? "closing" : "open"}
      id="sophon-acknowledgements"
      onCancel={(event) => { event.preventDefault(); closeDialog(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}
      onClose={handleClose}
      ref={dialogRef}
    >
      <section className="sophon-glass-strong flex max-h-[min(84svh,44rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-white/15 shadow-[0_28px_100px_rgb(0_0_0/.55)]" data-testid="acknowledgements-panel">
        <header className="flex shrink-0 items-start gap-3 border-b border-white/10 p-4 sm:p-5">
          <span aria-hidden="true" className="sophon-glass-tile hidden size-10 shrink-0 place-items-center rounded-xl font-serif text-lg text-sophon-signal-soft min-[400px]:grid">Σ</span>
          <span className="min-w-0 flex-1">
            <span className="sophon-type-decorative block font-mono uppercase tracking-[0.12em] text-sophon-signal-soft" data-typography-role="decorative">Trust, terms & credits</span>
            <h2 className="mt-1 text-base font-semibold text-white sm:text-lg" id="about-sophon-title">About Sophon</h2>
          </span>
          <Button aria-label="Close About Sophon" className="size-11 shrink-0 rounded-xl sm:size-9" onClick={closeDialog} size="icon" type="button" variant="sophon"><X aria-hidden="true" /></Button>
        </header>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
          <div className="space-y-5">
            <section aria-labelledby="trust-support-title">
              <div className="mb-2 px-1">
                <h3 className="sophon-type-decorative font-mono uppercase tracking-[0.12em] text-sophon-signal-soft" data-typography-role="decorative" id="trust-support-title">Privacy, licensing & support</h3>
                <p className="sophon-type-metadata mt-0.5 text-sophon-copy-metadata" data-typography-role="metadata">Essential information for using Sophon and Tiny Aya.</p>
              </div>
              <nav aria-label="Privacy, licensing, and support">
                <ul className="grid gap-2 sm:grid-cols-2" data-testid="trust-support-links">
                  <li>
                    <a className="sophon-glass-tile flex min-h-16 h-full items-center gap-3 rounded-xl px-3.5 py-3 text-white/90 transition-colors hover:border-white/15 hover:bg-white/[0.045] hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" href={PRIVACY_PATH}>
                      <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-sophon-verified" />
                      <span>
                        <span className="block text-sm font-medium">Privacy policy</span>
                        <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">Local data and network requests</span>
                      </span>
                    </a>
                  </li>
                  <li>
                    <a className="sophon-glass-tile flex min-h-16 h-full items-center gap-3 rounded-xl px-3.5 py-3 text-white/90 transition-colors hover:border-white/15 hover:bg-white/[0.045] hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" href={TINY_AYA_LICENSE_URL} rel="noreferrer" target="_blank">
                      <Scale aria-hidden="true" className="size-4 shrink-0 text-sophon-signal-soft" />
                      <span>
                        <span className="flex items-center gap-1.5 text-sm font-medium">CC BY-NC 4.0 <ExternalLinkIndicator /></span>
                        <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">Tiny Aya non-commercial license</span>
                      </span>
                    </a>
                  </li>
                  <li>
                    <a className="sophon-glass-tile flex min-h-16 h-full items-center gap-3 rounded-xl px-3.5 py-3 text-white/90 transition-colors hover:border-white/15 hover:bg-white/[0.045] hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" href={COHERE_LABS_AUP_URL} rel="noreferrer" target="_blank">
                      <FileText aria-hidden="true" className="size-4 shrink-0 text-sophon-signal-soft" />
                      <span>
                        <span className="flex items-center gap-1.5 text-sm font-medium">Cohere Labs AUP <ExternalLinkIndicator /></span>
                        <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">Required acceptable-use terms</span>
                      </span>
                    </a>
                  </li>
                  <li>
                    <a className="sophon-glass-tile flex min-h-16 h-full items-center gap-3 rounded-xl px-3.5 py-3 text-white/90 transition-colors hover:border-white/15 hover:bg-white/[0.045] hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" href={PROJECT_SUPPORT_URL} rel="noreferrer" target="_blank">
                      <HeartHandshake aria-hidden="true" className="size-4 shrink-0 text-sophon-signal-soft" />
                      <span>
                        <span className="flex items-center gap-1.5 text-sm font-medium">Project support <ExternalLinkIndicator /></span>
                        <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">Questions and issue reports</span>
                      </span>
                    </a>
                  </li>
                </ul>
              </nav>
            </section>

            <div className="border-t border-white/10 pt-5">
              <h3 className="px-1 text-sm font-semibold text-white">Acknowledgements</h3>
            </div>
            {ACKNOWLEDGEMENT_SECTIONS.map((section) => (
              <section aria-labelledby={`acknowledgements-${section.id}-title`} key={section.id}>
                <div className="mb-2 flex items-end justify-between gap-4 px-1">
                  <span>
                    <h3 className="sophon-type-decorative font-mono uppercase tracking-[0.12em] text-sophon-signal-soft" data-typography-role="decorative" id={`acknowledgements-${section.id}-title`}>{section.title}</h3>
                    <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">{section.description}</span>
                  </span>
                  <span aria-hidden="true" className="sophon-type-decorative font-mono uppercase tracking-[0.1em] text-sophon-copy-decorative" data-typography-role="decorative">{section.items.length} credits</span>
                </div>

                <ul className="space-y-2" data-testid={`acknowledgements-${section.id}`}>
                  {section.items.map((credit) => (
                    <li className="sophon-glass-tile rounded-xl px-3.5 py-3 transition-colors hover:border-white/15 hover:bg-white/[0.045]" key={credit.name}>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <a className="break-words text-sm font-medium text-white/90 transition-colors hover:text-sophon-signal-bright focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" href={credit.href} rel="noreferrer" target="_blank">
                          <span className="inline-flex items-center gap-1.5">{credit.name}<ExternalLinkIndicator className="text-sophon-copy-metadata" /></span>
                        </a>
                        <span className="sophon-type-decorative rounded-md border border-white/10 bg-black/10 px-2 py-1 font-mono uppercase tracking-[0.06em] text-sophon-copy-decorative" data-typography-role="decorative">{credit.label}</span>
                      </div>
                      <p className="sophon-type-metadata mt-1.5 text-sophon-copy-metadata" data-typography-role="metadata">{credit.description}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="sophon-type-metadata mt-4 border-t border-white/10 pt-4 text-sophon-copy-metadata" data-typography-role="metadata">
            <p>Tiny Aya weights use CC BY-NC 4.0 and the Cohere Labs Acceptable Use Policy. Sophon is independent.</p>
            <p className="mt-3 text-sophon-copy-body">Designed and built in Toronto, Canada by <a className="inline-flex items-center gap-1 text-white underline decoration-white/25 underline-offset-4 transition-colors hover:text-sophon-signal-bright focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" href="https://github.com/rangan39" rel="noreferrer" target="_blank">rangan39 <ExternalLinkIndicator className="text-sophon-copy-metadata" /></a>.</p>
          </div>
        </div>
      </section>
    </dialog>
  );
}
