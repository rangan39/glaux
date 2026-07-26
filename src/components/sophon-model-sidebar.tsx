"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Download, Flame, Languages, Mountain, PanelLeftClose, PanelLeftOpen, Trash2, Waves, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { getModelRuntimeProfile, MODEL_REGISTRY, type ModelManifest } from "@/lib/onnx-models";
import type { ModelCacheSummary, RuntimeCapabilities } from "@/lib/onnx-types";
import { cn } from "@/lib/utils";

type Props = {
  activeModelId: string; cacheSummaries: ModelCacheSummary[]; capabilities: RuntimeCapabilities | null; deletingModelId?: string | null; disabled?: boolean; downloadPercent?: number; downloadPercentLabel?: string; loadedModelId: string | null;
  loading?: boolean; loadingLabel?: string; mobileOpen: boolean; modelId: string; onDelete: (modelId: string) => void; onDownload: (modelId: string) => void; onMobileOpenChange: (open: boolean) => void; onSelect: (modelId: string) => void; recommendedModelId: string;
};
const MODEL_UI: Record<string, { bestFor: string; icon: LucideIcon; name: string }> = {
  "tiny-aya-global": { bestFor: "Best all-around · 70+ languages", icon: Languages, name: "Global" },
  "tiny-aya-earth": { bestFor: "Best for West Asia + Africa", icon: Mountain, name: "Earth" },
  "tiny-aya-fire": { bestFor: "Best for South Asia", icon: Flame, name: "Fire" },
  "tiny-aya-water": { bestFor: "Best for Europe + Asia Pacific", icon: Waves, name: "Water" }
};

export function SophonModelSidebar({ activeModelId, cacheSummaries = [], capabilities, deletingModelId = null, disabled = false, downloadPercent, downloadPercentLabel, loadedModelId, loading = false, loadingLabel = "Downloading", mobileOpen, modelId, onDelete, onDownload, onMobileOpenChange, onSelect, recommendedModelId }: Props) {
  const [expanded, setExpanded] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (mobileOpen && !dialog.open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!mobileOpen) {
      if (dialog.open) dialog.close();
      restoreFocusRef.current?.focus();
    }
  }, [mobileOpen]);

  const panelProps = { activeModelId, cacheSummaries, capabilities, deletingModelId, disabled, downloadPercent, downloadPercentLabel, loadedModelId, loading, loadingLabel, modelId, onDelete, onDownload, onSelect, recommendedModelId };
  return <>
    <aside aria-label="Model library" className={cn("sophon-glass-strong hidden h-full shrink-0 flex-col overflow-hidden border-y-0 border-l-0 transition-[width] duration-200 motion-reduce:transition-none lg:flex", expanded ? "w-72" : "w-[4.75rem]")} data-state={expanded ? "expanded" : "collapsed"} id="model-library-desktop">
      <ModelPanel {...panelProps} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </aside>
    <dialog aria-labelledby="model-library-mobile-title" className="fixed inset-0 z-50 m-0 h-svh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-sophon-backdrop backdrop:backdrop-blur-sm lg:hidden" id="model-library-mobile" onCancel={(event) => { if (event.target === event.currentTarget) onMobileOpenChange(false); }} onClick={(event) => { if (event.target === event.currentTarget) onMobileOpenChange(false); }} onClose={(event) => { if (event.target === event.currentTarget) onMobileOpenChange(false); }} ref={dialogRef}>
      <div className="sophon-glass-strong flex h-full w-[min(19rem,92vw)] flex-col overflow-hidden rounded-none border-y-0 border-l-0 pt-[env(safe-area-inset-top)]" data-testid="mobile-model-sheet">
        <ModelPanel {...panelProps} expanded mobile onClose={() => onMobileOpenChange(false)} portalContainer={dialogRef} />
      </div>
    </dialog>
  </>;
}

type PanelProps = Omit<Props, "mobileOpen" | "onMobileOpenChange"> & { expanded: boolean; mobile?: boolean; onClose?: () => void; onToggle?: () => void; portalContainer?: RefObject<HTMLElement | null> };
function ModelPanel({ activeModelId, cacheSummaries = [], capabilities, deletingModelId = null, disabled = false, downloadPercent, downloadPercentLabel, expanded, loadedModelId, loading, loadingLabel, mobile = false, modelId, onClose, onDelete, onDownload, onSelect, onToggle, portalContainer, recommendedModelId }: PanelProps) {
  const detailModel = MODEL_REGISTRY.find((model) => model.id === modelId)
    ?? MODEL_REGISTRY.find((model) => model.id === recommendedModelId)
    ?? MODEL_REGISTRY[0];
  const mobileProfile = capabilities?.hardwareTier === "mobile";
  const detailProfile = getModelRuntimeProfile(detailModel, mobileProfile ? "mobile" : "desktop");
  return <>
    <header className={cn("flex h-[74px] shrink-0 items-center border-b border-sophon-glass-border p-3", expanded ? "justify-between" : "justify-center")}>
      {expanded ? <div className="min-w-0"><h2 className="sophon-type-status font-mono uppercase tracking-[0.12em] text-sophon-copy-primary" data-typography-role="status" id={mobile ? "model-library-mobile-title" : undefined}>Model library</h2><p className="sophon-type-metadata mt-1 font-mono uppercase tracking-[0.08em] text-sophon-copy-metadata" data-typography-role="metadata">{MODEL_REGISTRY.length} models</p></div> : null}
      <Button aria-controls={mobile ? undefined : "model-library-desktop"} aria-expanded={mobile ? undefined : expanded} aria-label={mobile ? "Close model library" : expanded ? "Collapse model library" : "Expand model library"} className="size-11 shrink-0 rounded-xl lg:size-9" onClick={mobile ? onClose : onToggle} size="icon" type="button" variant="sophon">
        {mobile ? <X aria-hidden="true" /> : expanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
      </Button>
    </header>
    <fieldset className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-y-auto p-3" data-testid={mobile ? "mobile-model-list" : "desktop-model-list"} disabled={disabled || deletingModelId !== null}>
      <legend className="sr-only">Tiny Aya models</legend>
      <div className="min-w-0 w-full space-y-2">
        {MODEL_REGISTRY.map((model) => {
          const ui = MODEL_UI[model.id]!;
          const Icon = ui.icon;
          const selected = model.id === modelId;
          const unavailable = modelAvailability(capabilities, model) === "Browser GPU required";
          const cache = cacheSummaries.find((entry) => entry.modelId === model.id);
          const hasStoredData = cache?.state === "cached" || cache?.state === "partial";
          const availableLocally = cache?.state === "cached";
          const active = loading && activeModelId === model.id;
          const subtitle = `${mobileProfile && model.family === "cohere" ? "2K mobile · " : ""}${model.format.sizeLabel} · ${ui.bestFor}`;
          const status = active
            ? `${loadingLabel}${downloadPercentLabel ? ` ${downloadPercentLabel}` : ""}`
            : loadedModelId === model.id
              ? "Ready"
              : availableLocally
                ? `Available locally · ${formatBytes(cache.totalBytes)}`
                : cache?.state === "partial"
                  ? `${formatSavedBytes(cache.resumableBytes)} saved`
                  : modelAvailability(capabilities, model);
          return <div className={cn("relative min-w-0", expanded && "rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-sophon-signal", expanded && (selected ? "border-sophon-signal-bright/70 bg-sophon-signal/10 shadow-[0_0_24px_var(--sophon-signal-shadow)]" : "border-sophon-glass-border bg-sophon-glass-tile hover:border-sophon-signal-bright/45 hover:bg-sophon-glass-strong"))} data-model-card key={model.id}>
            <label className={cn("relative flex cursor-pointer", expanded ? mobile ? "min-h-[104px] items-start gap-3 p-3" : "min-h-[88px] items-start gap-2 p-2.5" : "mx-auto size-12 items-center justify-center rounded-xl border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sophon-signal", !expanded && (selected ? "border-sophon-signal-bright/70 bg-sophon-signal/10 shadow-[0_0_24px_var(--sophon-signal-shadow)]" : "border-sophon-glass-border bg-sophon-glass-tile hover:border-sophon-signal-bright/45 hover:bg-sophon-glass-strong"), (disabled || unavailable || deletingModelId !== null) && "cursor-not-allowed border-sophon-glass-border bg-sophon-panel-deep")} data-model-id={model.id} data-model-surface={mobile ? "mobile" : "desktop"} title={expanded ? undefined : `${ui.name} · ${status}`}>
              <input aria-label={`Choose ${model.label}. ${ui.bestFor}. ${model.format.sizeLabel} download. ${status}.`} checked={selected} className="sr-only" disabled={unavailable} name={mobile ? "mobile-model" : "desktop-model"} onChange={() => onSelect(model.id)} type="radio" value={model.id} />
              {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sophon-signal-bright shadow-[0_0_10px_var(--sophon-signal-bright)]" /> : null}
              {expanded ? <span aria-hidden="true" className={cn("mt-2 grid size-4 shrink-0 place-items-center rounded-full border", selected ? "border-sophon-signal-bright bg-sophon-signal/15" : "border-sophon-copy-decorative bg-sophon-panel-deep")} data-model-selection-indicator data-selected={selected ? "true" : "false"}>{selected ? <span className="size-2 rounded-full bg-sophon-signal-bright shadow-[0_0_6px_var(--sophon-signal-bright)]" /> : null}</span> : null}
              <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", selected ? "border-sophon-signal-bright/45 bg-sophon-signal/15 text-sophon-signal-soft" : "border-sophon-glass-border bg-sophon-panel-deep text-sophon-copy-metadata")}><Icon className="size-[17px]" /></span>
              {expanded ? <span className="min-w-0 flex-1">
                <span className="sophon-type-status flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono uppercase tracking-[0.06em] text-sophon-copy-primary" data-typography-role="status">
                  <span data-model-name>{ui.name}</span>
                  {model.id === recommendedModelId ? <span className="sophon-verified-emphasis sophon-type-status shrink-0 rounded-full border border-transparent bg-sophon-verified-bright px-1.5 py-0.5 tracking-normal" data-model-recommendation>Recommended</span> : null}
                </span>
                <span className={cn("sophon-type-metadata block break-words text-sophon-copy-metadata", mobile ? "mt-1" : "mt-0.5")} data-model-description data-typography-role="metadata">{subtitle}</span>
                <span className={cn("sophon-type-status flex items-start gap-1.5 break-words font-mono uppercase tracking-[0.06em]", mobile ? "mt-2" : "mt-1", loadedModelId === model.id || availableLocally ? "text-sophon-verified" : active || cache?.state === "partial" ? "text-sophon-signal-soft" : "text-sophon-copy-metadata")} data-model-status data-typography-role="status"><span aria-hidden="true" className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", loadedModelId === model.id || availableLocally ? "bg-sophon-verified-bright shadow-[0_0_8px_var(--sophon-verified-bright)]" : selected || active || cache?.state === "partial" ? "bg-sophon-signal-bright" : "bg-sophon-copy-decorative")} />{status}</span>
              </span> : null}
              {active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-sophon-panel-deep"><span className={cn("block h-full bg-sophon-signal-bright", downloadPercent === undefined && "w-1/3 animate-pulse motion-reduce:animate-none")} style={downloadPercent === undefined ? undefined : { width: `${downloadPercent}%` }} /></span> : null}
            </label>
            {expanded && !active && (selected || hasStoredData) ? <div className={cn("flex min-w-0 items-center gap-1 border-t border-sophon-glass-border", mobile ? "p-1.5" : "flex-wrap p-1")} data-model-actions>
              {selected && !availableLocally ? <Button aria-label={`${cache?.state === "partial" ? "Resume" : "Download"} ${ui.name} · ${model.format.sizeLabel}`} className={cn("sophon-accent-surface sophon-type-action min-w-0 flex-1 gap-1 rounded-lg px-2 font-mono uppercase tracking-[0.04em]", mobile ? "h-11" : "h-8 basis-full")} data-model-download data-typography-role="action" disabled={capabilities === null || unavailable} onClick={() => onDownload(model.id)} title={`${cache?.state === "partial" ? "Resume" : "Download"} ${ui.name} from the network`} type="button"><Download aria-hidden="true" /><span className="truncate">{cache?.state === "partial" ? "Resume" : "Download"} {ui.name} · {model.format.sizeLabel}</span></Button> : null}
              {hasStoredData ? <Button aria-label={`Delete downloaded files for ${model.label}`} className={cn("shrink-0 border-0 bg-transparent text-sophon-copy-decorative shadow-none hover:border-transparent hover:bg-destructive/10 hover:text-destructive", mobile ? "size-11 rounded-xl" : "size-9")} disabled={deletingModelId !== null} onClick={() => onDelete(model.id)} size="icon" title={`Delete ${status.toLowerCase()}`} type="button" variant="sophon"><Trash2 aria-hidden="true" className="stroke-[1.5]" /></Button> : null}
            </div> : null}
          </div>;
        })}
      </div>
    </fieldset>
    {expanded ? (
      <footer className="sophon-type-metadata shrink-0 border-t border-sophon-glass-border p-4 font-mono uppercase tracking-[0.06em] text-sophon-copy-metadata" data-typography-role="metadata">
        <div className="space-y-0.5">
          <div className="flex min-h-6 items-center gap-1">
            <span className="min-w-0 flex-1 text-sophon-copy-body">{detailModel.parameterLabel} · 4-bit · {formatContext(detailProfile.contextLength)}</span>
            <InfoHint concept="modelSpecs" portalContainer={portalContainer} />
          </div>
          <div className="flex min-h-6 items-center gap-1">
            <span className="min-w-0 flex-1">{detailModel.format.sizeLabel} · {capabilities?.browserEngine === "chromium" ? "Chromium WebGPU" : "WebGPU"}</span>
            <InfoHint concept="webgpu" portalContainer={portalContainer} />
          </div>
          <div className="flex min-h-6 items-center gap-1">
            <span className="min-w-0 flex-1">{detailModel.licenseLabel}</span>
            <InfoHint concept="modelLicense" portalContainer={portalContainer} />
          </div>
        </div>
        <p className="sophon-type-metadata mt-2 normal-case tracking-normal text-sophon-copy-metadata">Choose Global for broad coverage, or a regional model when most prompts use that language group.</p>
      </footer>
    ) : null}
  </>;
}

function modelAvailability(capabilities: RuntimeCapabilities | null, model: ModelManifest) {
  if (!capabilities) return "Checking browser GPU";
  return capabilities.webgpu && model.providers.includes("webgpu") ? "Ready to download" : "Browser GPU required";
}

function formatBytes(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatSavedBytes(bytes: number) {
  return bytes > 0 && bytes < 1024 ** 2 ? "<1 MB" : formatBytes(bytes);
}

function formatContext(tokens: number | null) {
  return tokens === null ? "Context varies" : `${Math.round(tokens / 1024)}K context`;
}
