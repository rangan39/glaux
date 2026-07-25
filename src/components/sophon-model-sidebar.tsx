"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Flame, Languages, Mountain, PanelLeftClose, PanelLeftOpen, Trash2, Upload, Waves, X, type LucideIcon } from "lucide-react";
import { SophonAcknowledgements } from "@/components/sophon-acknowledgements";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { getModelRuntimeProfile, MODEL_REGISTRY, type ModelManifest } from "@/lib/onnx-models";
import type { ModelCacheSummary, RuntimeCapabilities } from "@/lib/onnx-types";
import { cn } from "@/lib/utils";

type Props = {
  cacheSummaries: ModelCacheSummary[]; capabilities: RuntimeCapabilities | null; deletingModelId?: string | null; disabled?: boolean; downloadPercent?: number; loadedModelId: string | null;
  importingModelId?: string | null; loading?: boolean; loadingLabel?: string; mobileOpen: boolean; modelId: string; onDelete: (modelId: string) => void; onImport: (modelId: string) => void; onMobileOpenChange: (open: boolean) => void; onSelect: (modelId: string) => void; recommendedModelId: string;
};
const MODEL_UI: Record<string, { icon: LucideIcon; name: string; region: string }> = {
  "tiny-aya-global": { icon: Languages, name: "Global", region: "70+ languages" },
  "tiny-aya-earth": { icon: Mountain, name: "Earth", region: "West Asia + Africa" },
  "tiny-aya-fire": { icon: Flame, name: "Fire", region: "South Asia" },
  "tiny-aya-water": { icon: Waves, name: "Water", region: "Europe + Asia Pacific" }
};

export function SophonModelSidebar({ cacheSummaries = [], capabilities, deletingModelId = null, disabled = false, downloadPercent, importingModelId = null, loadedModelId, loading = false, loadingLabel = "Downloading", mobileOpen, modelId, onDelete, onImport, onMobileOpenChange, onSelect, recommendedModelId }: Props) {
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

  const panelProps = { cacheSummaries, capabilities, deletingModelId, disabled, downloadPercent, importingModelId, loadedModelId, loading, loadingLabel, modelId, onDelete, onImport, onSelect, recommendedModelId };
  return <>
    <aside aria-label="Model library" className={cn("sophon-glass-strong hidden h-full shrink-0 flex-col overflow-hidden border-y-0 border-l-0 transition-[width] duration-200 motion-reduce:transition-none lg:flex", expanded ? "w-72" : "w-[4.75rem]")} data-state={expanded ? "expanded" : "collapsed"} id="model-library-desktop">
      <ModelPanel {...panelProps} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </aside>
    <dialog aria-labelledby="model-library-mobile-title" className="fixed inset-0 z-50 m-0 h-svh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm lg:hidden" id="model-library-mobile" onCancel={(event) => { if (event.target === event.currentTarget) onMobileOpenChange(false); }} onClick={(event) => { if (event.target === event.currentTarget) onMobileOpenChange(false); }} onClose={(event) => { if (event.target === event.currentTarget) onMobileOpenChange(false); }} ref={dialogRef}>
      <div className="sophon-glass-strong flex h-full w-[min(19rem,92vw)] flex-col overflow-hidden rounded-none border-y-0 border-l-0 pt-[env(safe-area-inset-top)]" data-testid="mobile-model-sheet">
        <ModelPanel {...panelProps} expanded mobile onClose={() => onMobileOpenChange(false)} onSelect={(nextModelId) => { onSelect(nextModelId); onMobileOpenChange(false); }} portalContainer={dialogRef} />
      </div>
    </dialog>
  </>;
}

type PanelProps = Omit<Props, "mobileOpen" | "onMobileOpenChange"> & { expanded: boolean; mobile?: boolean; onClose?: () => void; onToggle?: () => void; portalContainer?: RefObject<HTMLElement | null> };
function ModelPanel({ cacheSummaries = [], capabilities, deletingModelId = null, disabled = false, downloadPercent, expanded, importingModelId = null, loadedModelId, loading, loadingLabel, mobile = false, modelId, onClose, onDelete, onImport, onSelect, onToggle, portalContainer, recommendedModelId }: PanelProps) {
  const detailModel = MODEL_REGISTRY.find((model) => model.id === modelId)
    ?? MODEL_REGISTRY.find((model) => model.id === recommendedModelId)
    ?? MODEL_REGISTRY[0];
  const mobileProfile = capabilities?.hardwareTier === "mobile";
  const detailProfile = getModelRuntimeProfile(detailModel, mobileProfile ? "mobile" : "desktop");
  return <>
    <header className={cn("flex h-[74px] shrink-0 items-center border-b border-white/10 p-3", expanded ? "justify-between" : "justify-center")}>
      {expanded ? <div className="min-w-0"><h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white" id={mobile ? "model-library-mobile-title" : undefined}>Model library</h2><p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/50">{MODEL_REGISTRY.length} models</p></div> : null}
      <Button aria-controls={mobile ? undefined : "model-library-desktop"} aria-expanded={mobile ? undefined : expanded} aria-label={mobile ? "Close model library" : expanded ? "Collapse model library" : "Expand model library"} className="size-11 shrink-0 rounded-xl lg:size-9" onClick={mobile ? onClose : onToggle} size="icon" type="button" variant="sophon">
        {mobile ? <X aria-hidden="true" /> : expanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
      </Button>
    </header>
    <fieldset className="min-h-0 flex-1 overflow-y-auto p-3" disabled={disabled || deletingModelId !== null}>
      <legend className="sr-only">Tiny Aya models</legend>
      <div className="space-y-2">
        {MODEL_REGISTRY.map((model) => {
          const ui = MODEL_UI[model.id]!;
          const Icon = ui.icon;
          const selected = model.id === modelId;
          const unavailable = modelAvailability(capabilities, model) === "Browser GPU required";
          const cache = cacheSummaries.find((entry) => entry.modelId === model.id);
          const hasStoredData = cache?.state === "cached" || cache?.state === "partial";
          const active = importingModelId === model.id || loading && selected;
          const subtitle = `${mobileProfile && model.family === "cohere" ? "2K mobile · " : ""}${model.format.sizeLabel} · ${ui.region}`;
          const status = active
            ? `${loadingLabel}${downloadPercent === undefined ? "" : ` ${downloadPercent}%`}`
            : loadedModelId === model.id
              ? "Ready"
              : cache?.state === "cached"
                ? `Downloaded · ${formatBytes(cache.totalBytes)}`
                : cache?.state === "partial"
                  ? `${formatBytes(cache.resumableBytes)} saved`
                  : modelAvailability(capabilities, model);
          return <div className="relative" key={model.id}>
            <label className={cn("relative flex cursor-pointer items-center overflow-hidden rounded-xl border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sophon-warning", expanded ? "min-h-[78px] gap-3 p-3" : "mx-auto size-12 justify-center", selected ? "border-sophon-signal-bright/70 bg-sophon-signal/15 shadow-[0_0_24px_rgb(255_77_46/.12)]" : "border-white/10 bg-white/[.035] hover:border-white/20 hover:bg-white/[.065]", (disabled || unavailable || deletingModelId !== null) && "cursor-not-allowed opacity-45")} data-model-id={model.id} data-model-surface={mobile ? "mobile" : "desktop"} title={expanded ? undefined : `${ui.name} · ${status}`}>
            <input aria-label={`${model.label}. ${model.format.sizeLabel} download. ${status}.`} checked={selected} className="sr-only" disabled={unavailable} name={mobile ? "mobile-model" : "desktop-model"} onChange={() => onSelect(model.id)} type="radio" value={model.id} />
            {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sophon-signal-bright shadow-[0_0_10px_var(--sophon-signal-bright)]" /> : null}
            <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", selected ? "border-sophon-signal-bright/45 bg-sophon-signal/20 text-[#ffb4a4]" : "border-white/10 bg-black/20 text-white/65")}><Icon className="size-[17px]" /></span>
            {expanded ? <span className="min-w-0 flex-1 pr-[4.75rem]"><span className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-white"><span>{ui.name}</span>{model.id === recommendedModelId ? <span className="rounded-full border border-sophon-verified/25 bg-sophon-verified/10 px-1.5 py-0.5 text-[7px] tracking-[0.08em] text-sophon-verified">Recommended</span> : null}</span><span className="mt-1 block truncate text-[11px] text-white/55">{subtitle}</span><span className={cn("mt-2 flex items-center gap-1.5 truncate font-mono text-[9px] uppercase tracking-[0.08em]", loadedModelId === model.id || cache?.state === "cached" ? "text-sophon-verified" : active || cache?.state === "partial" ? "text-[#ffb4a4]" : "text-white/45")}><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", loadedModelId === model.id || cache?.state === "cached" ? "bg-sophon-verified" : selected || active || cache?.state === "partial" ? "bg-sophon-signal-bright" : "bg-white/30")} />{status}</span></span> : null}
            {active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10"><span className={cn("block h-full bg-sophon-signal-bright", downloadPercent === undefined && "w-1/3 animate-pulse motion-reduce:animate-none")} style={downloadPercent === undefined ? undefined : { width: `${downloadPercent}%` }} /></span> : null}
            </label>
            {expanded && !active ? <Button aria-label={`Import offline pack for ${model.label}`} className={cn("absolute right-1.5 h-7 w-[4.25rem] gap-1 border-0 bg-transparent px-1.5 font-mono text-[8px] uppercase tracking-[0.08em] text-white/45 shadow-none hover:border-transparent hover:bg-sophon-signal/20 hover:text-[#ffb4a4]", hasStoredData ? "bottom-1" : "top-1/2 -translate-y-1/2")} onClick={() => onImport(model.id)} title="Import offline pack" type="button" variant="sophon"><Upload aria-hidden="true" className="size-3 stroke-[1.5]" />Import</Button> : null}
            {expanded && hasStoredData && !active ? <Button aria-label={`Delete downloaded files for ${model.label}`} className="absolute right-1.5 top-1 size-9 border-0 bg-transparent text-white/35 shadow-none hover:border-transparent hover:bg-destructive/10 hover:text-destructive" disabled={deletingModelId !== null} onClick={() => onDelete(model.id)} size="icon" title={`Delete ${status.toLowerCase()}`} type="button" variant="sophon"><Trash2 aria-hidden="true" className="stroke-[1.5]" /></Button> : null}
          </div>;
        })}
      </div>
    </fieldset>
    {expanded ? (
      <footer className="shrink-0 border-t border-white/10 p-4 font-mono text-[9px] uppercase tracking-[0.1em] text-white/45">
        <div className="space-y-0.5">
          <div className="flex min-h-6 items-center gap-1">
            <span className="min-w-0 flex-1 text-white/65">{detailModel.parameterLabel} · 4-bit · {formatContext(detailProfile.contextLength)}</span>
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
        <div className="mt-3 border-t border-white/10 pt-2"><SophonAcknowledgements /></div>
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

function formatContext(tokens: number | null) {
  return tokens === null ? "Context varies" : `${Math.round(tokens / 1024)}K context`;
}
