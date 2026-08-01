"use client";

import { FormEvent, useEffect, useState } from "react";
import { Code2, Cpu, Download, ExternalLink, FileText, Flame, Languages, LoaderCircle, Mountain, PanelLeftClose, PanelLeftOpen, Search, Sparkles, Trash2, Waves, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModelRuntimeProfile, MODEL_REGISTRY, type ModelManifest } from "@/lib/onnx-models";
import type { ModelCacheSummary, RuntimeCapabilities } from "@/lib/onnx-types";
import { cn } from "@/lib/utils";
import type { TokenInspectMode } from "@/components/token-lens";
import {
  createCommunityModelDescriptor,
  fetchOnnxCommunityModelDetails,
  refreshCommunityCatalogIndex,
  saveCommunityModelDescriptor,
  searchCommunityCatalogIndex,
  subscribeCommunityCatalogIndex,
  type CommunityModelDescriptor,
  type CommunityModelSummary
} from "@/lib/model-catalog";

type Props = {
  communityModels?: ModelManifest[]; onCommunityModelAdded?: (descriptor: CommunityModelDescriptor) => void;
  activeModelId: string; cacheSummaries: ModelCacheSummary[]; capabilities: RuntimeCapabilities | null; deletingModelId?: string | null; disabled?: boolean; downloadPercent?: number; downloadPercentLabel?: string; loadedModelId: string | null;
  inspectDisplayMode?: TokenInspectMode | null; inspectMetrics?: string; inspectMode?: boolean; loading?: boolean; loadingLabel?: string; mobileOpen: boolean; modelId: string; onDelete: (modelId: string) => void; onDownload: (modelId: string) => void; onHoverModelChange?: (modelId: string | null) => void; onInspectDisplayModeChange?: (mode: TokenInspectMode | null) => void; onMobileOpenChange: (open: boolean) => void; onSelect: (modelId: string) => void; recommendedModelId: string;
  onInspectModeChange?: (enabled: boolean) => void;
};
export const MODEL_UI: Record<string, { bestFor: string; icon: LucideIcon; name: string }> = {
  "tiny-aya-global": { bestFor: "Broad multilingual coverage", icon: Languages, name: "Global" },
  "tiny-aya-earth": { bestFor: "West Asia + Africa", icon: Mountain, name: "Earth" },
  "tiny-aya-fire": { bestFor: "South Asia", icon: Flame, name: "Fire" },
  "tiny-aya-water": { bestFor: "Europe + Asia Pacific", icon: Waves, name: "Water" }
};

export function GlauxModelSidebar({ activeModelId, cacheSummaries = [], capabilities, communityModels = [], deletingModelId = null, disabled = false, downloadPercent, downloadPercentLabel, inspectDisplayMode = null, inspectMetrics, inspectMode = false, loadedModelId, loading = false, loadingLabel = "Downloading", mobileOpen, modelId, onCommunityModelAdded, onDelete, onDownload, onHoverModelChange, onInspectDisplayModeChange, onInspectModeChange, onMobileOpenChange, onSelect, recommendedModelId }: Props) {
  const [expanded, setExpanded] = useState(true);
  const panelProps = { activeModelId, cacheSummaries, capabilities, communityModels, deletingModelId, disabled, downloadPercent, downloadPercentLabel, inspectDisplayMode, inspectMetrics, inspectMode, loadedModelId, loading, loadingLabel, modelId, onCommunityModelAdded, onDelete, onDownload, onHoverModelChange, onInspectDisplayModeChange, onInspectModeChange, onSelect, recommendedModelId };
  return <>
    <aside aria-label="Model library" className={cn("sophon-glass-strong sophon-reveal sophon-reveal-sidebar hidden h-full shrink-0 flex-col overflow-hidden border-y-0 border-l-0 transition-[width] duration-200 motion-reduce:transition-none lg:flex lg:h-[calc(100svh-74px)]", expanded ? "w-72" : "w-[4.75rem]")} data-state={expanded ? "expanded" : "collapsed"} id="model-library-desktop">
      <ModelPanel {...panelProps} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </aside>
    <Sheet onOpenChange={onMobileOpenChange} open={mobileOpen}>
      <SheetContent aria-describedby={undefined} className="sophon-glass-strong flex h-full w-[min(19rem,92vw)] flex-col overflow-hidden rounded-none border-y-0 border-l-0 p-0 pt-[env(safe-area-inset-top)] lg:hidden" id="model-library-mobile" showCloseButton={false} side="left">
        <SheetTitle className="sr-only">Model library</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col" data-testid="mobile-model-sheet"><ModelPanel {...panelProps} expanded mobile onClose={() => onMobileOpenChange(false)} /></div>
      </SheetContent>
    </Sheet>
  </>;
}

type PanelProps = Omit<Props, "mobileOpen" | "onMobileOpenChange"> & { expanded: boolean; mobile?: boolean; onClose?: () => void; onToggle?: () => void };
type SidebarView = "search" | "details" | "dev";
function ModelPanel({ activeModelId, cacheSummaries = [], capabilities, communityModels = [], deletingModelId = null, disabled = false, downloadPercent, downloadPercentLabel, expanded, inspectDisplayMode = null, inspectMetrics, inspectMode = false, loadedModelId, loading, loadingLabel, mobile = false, modelId, onClose, onCommunityModelAdded, onDelete, onDownload, onHoverModelChange, onInspectDisplayModeChange, onInspectModeChange, onSelect, onToggle, recommendedModelId }: PanelProps) {
  const [view, setView] = useState<SidebarView>("search");
  const activeView: SidebarView = inspectMode ? "dev" : view;
  const models = [...MODEL_REGISTRY, ...communityModels];
  const visibleModelCards: ModelManifest[] = [];
  const detailModel = models.find((model) => model.id === modelId)
    ?? MODEL_REGISTRY.find((model) => model.id === recommendedModelId)
    ?? MODEL_REGISTRY[0];
  const mobileProfile = capabilities?.hardwareTier === "mobile";
  const detailProfile = getModelRuntimeProfile(detailModel, mobileProfile ? "mobile" : "desktop");
  function selectView(nextView: SidebarView) {
    setView(nextView);
    onInspectModeChange?.(nextView === "dev");
  }
  return <>
    <header className={cn("flex h-16 shrink-0 items-center border-b border-sophon-glass-border p-2.5", expanded ? "justify-between" : "justify-center")}>
      {expanded ? <div className="min-w-0"><h2 className="sophon-type-status font-mono uppercase tracking-[0.12em] text-sophon-copy-primary" data-typography-role="status" id={mobile ? "model-library-mobile-title" : undefined}>Model library</h2><p className="sophon-type-metadata mt-1 font-mono uppercase tracking-[0.08em] text-sophon-copy-metadata" data-typography-role="metadata">{activeView === "search" ? "ONNX Community" : activeView === "details" ? "Model information" : "Developer tools"}</p></div> : null}
      <Button aria-controls={mobile ? undefined : "model-library-desktop"} aria-expanded={mobile ? undefined : expanded} aria-label={mobile ? "Close model library" : expanded ? "Collapse model library" : "Expand model library"} className="size-11 shrink-0 rounded-xl lg:size-9" onClick={mobile ? onClose : onToggle} size="icon" type="button" variant="sophon">
        {mobile ? <X aria-hidden="true" /> : expanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
      </Button>
    </header>
    {expanded ? <div className="border-b border-sophon-glass-border px-2 py-1.5"><div aria-label="Model library views" className="grid grid-cols-3 gap-0.5 rounded-lg border border-sophon-glass-border bg-sophon-panel-deep p-0.5 shadow-[inset_0_1px_0_var(--sophon-glass-highlight)]" role="group">
      {([
        { icon: Search, label: "Model Search", value: "search" },
        { icon: FileText, label: "Model Details", value: "details" },
        { icon: Code2, label: "Dev Mode", value: "dev" }
      ] as const).map(({ icon: ViewIcon, label, value }) => <Tooltip key={value}>
        <TooltipTrigger asChild><button aria-label={label} aria-pressed={activeView === value} className={cn("grid h-8 min-w-0 place-items-center rounded-md transition-colors", activeView === value ? "bg-sophon-signal/10 text-sophon-signal-soft shadow-[inset_0_0_0_1px_var(--sophon-signal-bright)]" : "text-sophon-copy-metadata hover:bg-sophon-glass-tile hover:text-sophon-copy-primary")} onClick={() => selectView(value)} type="button"><ViewIcon aria-hidden="true" className="size-3.5" /></button></TooltipTrigger>
        <TooltipContent className="border border-sophon-glass-border bg-sophon-copy-primary text-sophon-panel shadow-lg" side="top">{label}</TooltipContent>
      </Tooltip>)}
    </div></div> : null}
    {activeView === "search" ? <fieldset className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-y-auto p-3" data-testid={mobile ? "mobile-model-list" : "desktop-model-list"} disabled={disabled || deletingModelId !== null}>
      <legend className="sr-only">Local text generation models</legend>
      <div className="min-w-0 w-full space-y-2">
        {expanded ? <CommunityCatalog disabled={disabled} onAdded={onCommunityModelAdded} /> : null}
        {visibleModelCards.map((model) => {
          const ui = MODEL_UI[model.id] ?? { bestFor: "ONNX Community", icon: Cpu, name: model.label };
          const Icon = ui.icon;
          const selected = model.id === modelId;
          const unavailable = modelAvailability(capabilities, model) === "Browser GPU required";
          const cache = cacheSummaries.find((entry) => entry.modelId === model.id);
          const hasStoredData = cache?.state === "cached" || cache?.state === "partial";
          const availableLocally = cache?.state === "cached";
          const replacesStoredModel = cacheSummaries.some((entry) => (
            entry.modelId !== model.id && entry.state !== "missing"
          ));
          const active = loading && activeModelId === model.id;
          const deleteLabel = cache?.state === "partial" ? "Delete saved progress" : "Delete download";
          const primaryAction = replacesStoredModel ? "Replace" : cache?.state === "partial" ? "Resume" : "Download";
          const subtitle = `${mobileProfile && model.family === "cohere" ? "Mobile profile · " : ""}${ui.bestFor}`;
          const accessibleStatus = active
            ? `${loadingLabel}${downloadPercentLabel ? ` ${downloadPercentLabel}` : ""}`
            : loadedModelId === model.id
              ? "Installed · active"
              : availableLocally
                ? `Installed · ${formatBytes(cache.totalBytes)}`
                : cache?.state === "partial"
                  ? `${formatSavedBytes(cache.resumableBytes)} saved`
                  : modelAvailability(capabilities, model);
          const status = active
            ? `${loadingLabel}${downloadPercentLabel ? ` ${downloadPercentLabel}` : ""}`
            : loadedModelId === model.id
              ? "Active"
              : availableLocally
                ? "Installed"
                : cache?.state === "partial"
                  ? `${formatSavedBytes(cache.resumableBytes)} saved`
                  : modelAvailability(capabilities, model) === "Ready to download" ? "Ready" : modelAvailability(capabilities, model);
          return <div className={cn("relative min-w-0", expanded && "rounded-xl border transition-colors duration-200 ease-out focus-within:ring-2 focus-within:ring-sophon-signal", expanded && (selected ? "border-sophon-signal-bright/70 bg-sophon-signal/10 shadow-[0_0_24px_var(--sophon-signal-shadow)]" : "border-sophon-glass-border bg-sophon-glass-tile hover:border-sophon-signal-bright/45 hover:bg-sophon-glass-strong"))} data-model-card data-selected={selected ? "true" : "false"} key={model.id} onPointerEnter={mobile ? undefined : () => onHoverModelChange?.(model.id)} onPointerLeave={mobile ? undefined : () => onHoverModelChange?.(null)} onPointerMove={mobile ? undefined : () => onHoverModelChange?.(model.id)}>
            <label className={cn("relative flex cursor-pointer", expanded ? mobile ? cn("min-h-[80px] items-start gap-3 p-3", (hasStoredData || (selected && !availableLocally && !active)) && "pr-12") : cn("min-h-[62px] items-start gap-2 p-2.5", (hasStoredData || (selected && !availableLocally && !active)) && "pr-10") : "mx-auto size-12 items-center justify-center rounded-xl border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sophon-signal", !expanded && (selected ? "border-sophon-signal-bright/70 bg-sophon-signal/10 shadow-[0_0_24px_var(--sophon-signal-shadow)]" : "border-sophon-glass-border bg-sophon-glass-tile hover:border-sophon-signal-bright/45 hover:bg-sophon-glass-strong"), (disabled || unavailable || deletingModelId !== null) && "cursor-not-allowed border-sophon-glass-border bg-sophon-panel-deep")} data-model-id={model.id} data-model-surface={mobile ? "mobile" : "desktop"} title={expanded ? undefined : `${ui.name} · ${status}`}>
              <input aria-label={`Choose ${model.label}. Best for ${ui.bestFor}. ${model.format.sizeLabel} download. ${accessibleStatus}.`} checked={selected} className="sr-only" disabled={unavailable} name={mobile ? "mobile-model" : "desktop-model"} onChange={() => onSelect(model.id)} type="radio" value={model.id} />
              {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sophon-signal-bright shadow-[0_0_10px_var(--sophon-signal-bright)]" /> : null}
              {expanded ? <span aria-hidden="true" className={cn("mt-2 grid size-4 shrink-0 place-items-center rounded-full border lg:hidden", selected ? "border-sophon-signal-bright bg-sophon-signal/15" : "border-sophon-copy-decorative bg-sophon-panel-deep")} data-model-selection-indicator data-selected={selected ? "true" : "false"}>{selected ? <span className="size-2 rounded-full bg-sophon-signal-bright shadow-[0_0_6px_var(--sophon-signal-bright)]" /> : null}</span> : null}
              <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", selected ? "border-sophon-signal-bright/45 bg-sophon-signal/15 text-sophon-signal-soft" : "border-sophon-glass-border bg-sophon-panel-deep text-sophon-copy-metadata")} data-model-emblem><Icon className="size-[17px]" /></span>
              {expanded ? <span className="min-w-0 flex-1">
                <span className="sophon-type-status flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono uppercase tracking-[0.06em] text-sophon-copy-primary" data-typography-role="status">
                  <span data-model-name>{ui.name}</span>
                  {model.id === recommendedModelId ? <span aria-label="Recommended model" className="sophon-verified-emphasis grid size-4 shrink-0 place-items-center rounded-full bg-sophon-verified-bright text-sophon-on-verified" data-model-recommendation title="Recommended model"><Sparkles aria-hidden="true" className="size-2.5" /><span className="sr-only">Recommended</span></span> : null}
                </span>
                <span className={cn("sophon-type-metadata block truncate text-sophon-copy-metadata", mobile ? "mt-1" : "mt-0.5")} data-model-description data-typography-role="metadata">{subtitle}</span>
                {status !== "Ready" && status !== "Active" ? <span className={cn("sophon-type-status flex items-start gap-1.5 break-words font-mono uppercase tracking-[0.06em]", mobile ? "mt-2" : "mt-1", loadedModelId === model.id || availableLocally ? "text-sophon-verified" : active || cache?.state === "partial" ? "text-sophon-signal-soft" : "text-sophon-copy-metadata")} data-model-status data-typography-role="status"><span aria-hidden="true" className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", loadedModelId === model.id || availableLocally ? "bg-sophon-verified-bright shadow-[0_0_8px_var(--sophon-verified-bright)]" : selected || active || cache?.state === "partial" ? "bg-sophon-signal-bright" : "bg-sophon-copy-decorative")} />{status}</span> : null}
              </span> : null}
              {active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-sophon-panel-deep"><span className={cn("block h-full bg-sophon-signal-bright", downloadPercent === undefined && "w-1/3 motion-reduce:animate-none")} style={downloadPercent === undefined ? undefined : { width: `${downloadPercent}%` }} /></span> : null}
            </label>
            {expanded && !active && selected && !availableLocally ? <Button aria-label={`${primaryAction} ${ui.name} · ${model.format.sizeLabel}`} className={cn("absolute z-10 size-9 rounded-lg border-sophon-signal-bright/60 bg-sophon-signal/10 p-0 text-sophon-signal-soft shadow-none hover:border-sophon-signal-bright hover:bg-sophon-signal hover:text-white", mobile ? "right-3 top-3" : "right-2.5 top-2.5")} data-model-download disabled={capabilities === null || unavailable} onClick={() => onDownload(model.id)} title={replacesStoredModel ? `Replace the saved model with ${ui.name}` : `${primaryAction} ${ui.name} from the network`} type="button" variant="sophon"><Download aria-hidden="true" className="size-[17px] stroke-[1.75]" /><span className="sr-only">{primaryAction} {ui.name}</span></Button> : null}
            {expanded && !active && hasStoredData ? <Button aria-label={`${deleteLabel} for ${model.label}`} className={cn("absolute z-10 size-9 rounded-lg border-destructive/70 bg-transparent p-0 text-destructive shadow-none hover:border-destructive hover:bg-destructive/10 hover:text-destructive", mobile ? "right-3 top-3" : "right-2.5 top-2.5")} data-model-delete disabled={deletingModelId !== null} onClick={() => onDelete(model.id)} title={`${deleteLabel} for ${ui.name}`} type="button" variant="sophon"><Trash2 aria-hidden="true" className="size-[17px] stroke-[1.75]" /><span className="sr-only">{deleteLabel}</span></Button> : null}
          </div>;
        })}
      </div>
    </fieldset> : null}
    {expanded && activeView === "details" ? <ModelDetails model={detailModel} profile={detailProfile} /> : null}
    {expanded && activeView === "dev" ? <DeveloperTools inspectDisplayMode={inspectDisplayMode} inspectMetrics={inspectMetrics} onInspectDisplayModeChange={onInspectDisplayModeChange} /> : null}
    {expanded && visibleModelCards.length > 0 ? (
      <footer className="sophon-type-metadata shrink-0 border-t border-sophon-glass-border bg-sophon-panel-deep p-3 font-mono tracking-[0.03em] text-sophon-copy-metadata shadow-[inset_0_1px_0_rgb(255_255_255/0.8)]" data-typography-role="metadata">
        <div className="grid grid-cols-2 gap-1.5">
          <span className="inline-flex h-7 min-w-0 items-center rounded-md border border-sophon-glass-border bg-sophon-panel px-2 font-medium text-sophon-copy-body shadow-[inset_0_1px_0_var(--sophon-glass-highlight)]">{detailModel.parameterLabel} · 4-bit</span>
          <span className="inline-flex h-7 min-w-0 items-center rounded-md border border-sophon-glass-border bg-sophon-panel pl-2 pr-1 font-medium text-sophon-copy-body shadow-[inset_0_1px_0_var(--sophon-glass-highlight)]">{formatContext(detailProfile.contextLength)}<InfoHint className="ml-auto size-6" concept="modelSpecs" /></span>
          <span className="inline-flex h-7 min-w-0 items-center rounded-md border border-sophon-glass-border bg-sophon-panel px-2 font-medium shadow-[inset_0_1px_0_var(--sophon-glass-highlight)]">{detailModel.format.sizeLabel}</span>
          <span className="inline-flex h-7 min-w-0 items-center rounded-md border border-sophon-glass-border bg-sophon-panel pl-2 pr-1 font-medium shadow-[inset_0_1px_0_var(--sophon-glass-highlight)]" title={capabilities?.browserEngine === "chromium" ? "Chromium WebGPU" : "WebGPU"}>WebGPU<InfoHint className="ml-auto size-6" concept="webgpu" /></span>
        </div>
        <div className="mt-2 flex items-center">
          <span className="inline-flex items-center">{detailModel.licenseLabel}<InfoHint className="size-6" concept="modelLicense" /></span>
        </div>
        <p className="sophon-type-metadata mt-2 border-l-2 border-sophon-signal-bright/45 pl-2 normal-case tracking-normal text-sophon-copy-metadata">One model is stored locally. Choosing another replaces it.</p>
      </footer>
    ) : null}
  </>;
}

function ModelDetails({ model, profile }: { model: ModelManifest; profile: ReturnType<typeof getModelRuntimeProfile> }) {
  if (model.source.kind !== "huggingface") {
    return <section aria-label="Model details" className="min-h-0 flex-1 overflow-y-auto p-3"><div className="rounded-xl border border-sophon-glass-border bg-sophon-panel-deep p-3"><p className="text-sm text-sophon-copy-metadata">Select a Hugging Face model to view its details.</p></div></section>;
  }
  const details = [
    ["Repository", model.source.repo],
    ["Revision", model.source.revision.slice(0, 12)],
    ["Download", model.format.sizeLabel],
    ["Quantization", model.format.quantization.toUpperCase()],
    ["Context", formatContext(profile.contextLength)],
    ["Runtime", model.providers.join(" · ").toUpperCase()],
    ["License", model.licenseLabel]
  ];
  return <section aria-label="Model details" className="min-h-0 flex-1 overflow-y-auto p-2.5">
    <div className="rounded-lg border border-sophon-glass-border bg-sophon-panel-deep p-2.5">
      <p className="text-sm font-semibold text-sophon-copy-primary">{model.label}</p>
      <p className="mt-1 text-xs leading-5 text-sophon-copy-metadata">{model.description}</p>
      <dl className="mt-2 divide-y divide-sophon-glass-border overflow-hidden rounded-md border border-sophon-glass-border bg-sophon-panel">{details.map(([label, value]) => <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 px-2 py-1.5" key={label}><dt className="text-[9px] font-medium uppercase tracking-[0.06em] text-sophon-copy-metadata">{label}</dt><dd className="min-w-0 break-words text-[11px] text-sophon-copy-primary">{value}</dd></div>)}</dl>
      <Button asChild className="mt-3 w-full" size="sm" variant="sophon"><a href={`https://huggingface.co/${model.source.repo}`} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" />View on Hugging Face</a></Button>
    </div>
  </section>;
}

function DeveloperTools({ inspectDisplayMode, inspectMetrics, onInspectDisplayModeChange }: { inspectDisplayMode: TokenInspectMode | null; inspectMetrics?: string; onInspectDisplayModeChange?: (mode: TokenInspectMode | null) => void }) {
  return <section aria-label="Generation metrics" className="min-h-0 flex-1 overflow-y-auto p-2.5">
    <div aria-label="Inspect message display" className="mb-3 flex rounded-xl border border-sophon-glass-border bg-sophon-panel-deep p-0.5" role="group">
      {(["tokens", "words"] as const).map((mode) => <button aria-pressed={inspectDisplayMode === mode} className={cn("sophon-type-action min-h-9 flex-1 rounded-lg px-2 font-mono uppercase tracking-[0.06em] transition-colors", inspectDisplayMode === mode ? "bg-sophon-signal text-white shadow-[0_0_12px_var(--sophon-signal-shadow)]" : "text-sophon-copy-metadata hover:bg-sophon-glass-tile hover:text-sophon-copy-primary")} key={mode} onClick={() => onInspectDisplayModeChange?.(inspectDisplayMode === mode ? null : mode)} type="button">{mode}</button>)}
    </div>
    <div className="rounded-xl border border-sophon-glass-border bg-sophon-panel-deep p-3">
      <p className="sophon-type-metadata font-mono uppercase tracking-[0.1em] text-sophon-copy-metadata" data-typography-role="metadata">Generation metrics</p>
      {inspectMetrics ? <dl className="mt-3 grid gap-2">{inspectMetrics.split(" · ").map((metric) => <div className="rounded-lg border border-sophon-glass-border bg-sophon-panel px-2.5 py-2" key={metric}><dd className="sophon-type-status font-mono font-medium text-sophon-copy-primary" data-typography-role="status">{metric}</dd></div>)}</dl> : <p className="mt-3 text-sm leading-5 text-sophon-copy-metadata">Hover a response to inspect its timing and token metrics.</p>}
      <p className="mt-3 border-t border-sophon-glass-border pt-3 text-xs leading-5 text-sophon-copy-metadata">Choose Tokens or Words to inspect generated responses.</p>
    </div>
  </section>;
}

function CommunityCatalog({ disabled, onAdded }: { disabled: boolean; onAdded?: (descriptor: CommunityModelDescriptor) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly CommunityModelSummary[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busyRepo, setBusyRepo] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const trimmedQuery = query.trim();
    const resultLimit = trimmedQuery ? 8 : 5;
    const updateResults = async () => {
      const models = await searchCommunityCatalogIndex(trimmedQuery, resultLimit);
      if (!active) return models;
      setResults(models);
      if (models.length > 0) setStatus(null);
      return models;
    };
    const unsubscribe = subscribeCommunityCatalogIndex(() => { void updateResults(); });
    const timer = window.setTimeout(() => {
      setStatus(trimmedQuery ? "Updating the on-device catalog…" : "Loading popular models…");
      void updateResults()
        .then(() => refreshCommunityCatalogIndex())
        .then(updateResults)
        .then((models) => {
          if (active) setStatus(models.length === 0
            ? trimmedQuery ? "No matching text-generation models" : "No compatible community models found"
            : null);
        })
        .catch((error) => {
          if (active) setStatus(error instanceof Error ? error.message : "Catalog indexing failed");
        });
    }, trimmedQuery ? 300 : 0);
    return () => { active = false; unsubscribe(); window.clearTimeout(timer); };
  }, [query]);

  async function addModel(model: CommunityModelSummary) {
    if (!model.revision) return;
    setBusyRepo(model.repo);
    setStatus(`Checking ${model.name}…`);
    try {
      const details = await fetchOnnxCommunityModelDetails(model.repo, model.revision);
      const descriptor = createCommunityModelDescriptor(details);
      await saveCommunityModelDescriptor(descriptor);
      onAdded?.(descriptor);
      setStatus(`${model.name} is ready for review. Confirm the download from its model card.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${model.name} could not be added.`);
    } finally {
      setBusyRepo(null);
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); }

  return <section className="mb-2 rounded-lg border border-sophon-glass-border bg-sophon-panel-deep p-2" aria-label="ONNX Community catalog">
    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-sophon-copy-primary">Hugging Face ONNX Community</p>
    <form className="relative mt-1.5" onSubmit={submit} role="search">
      <Search aria-hidden="true" className="absolute left-2 top-2 size-3.5 text-sophon-copy-metadata" />
      <input aria-label="Search ONNX Community models" className="h-8 w-full rounded-md border border-sophon-glass-border bg-sophon-panel pl-7 pr-2 text-xs text-sophon-copy-primary outline-none focus:border-sophon-signal-bright" disabled={disabled} onChange={(event) => {
        const value = event.target.value;
        setQuery(value);
        setResults([]);
        setStatus(null);
      }} placeholder="Search models…" value={query} />
    </form>
    {status ? <p className="mt-2 text-xs leading-4 text-sophon-copy-metadata" role="status">{status}</p> : null}
    {results.length > 0 ? <p className="mt-2 text-[9px] font-medium uppercase tracking-[0.08em] text-sophon-copy-metadata">{query.trim() ? "Search results" : "Popular models"}</p> : null}
    <div className="mt-1 space-y-1">
      {results.map((model) => <button className="flex w-full items-center gap-1.5 rounded-md border border-sophon-glass-border bg-sophon-panel px-2 py-1.5 text-left hover:border-sophon-signal-bright/60 disabled:opacity-60" disabled={disabled || busyRepo !== null || !model.revision} key={model.repo} onClick={() => void addModel(model)} type="button">
        {busyRepo === model.repo ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" /> : <Download aria-hidden="true" className="size-3.5 shrink-0" />}
        <span className="min-w-0"><span className="block truncate text-[11px] font-medium leading-4 text-sophon-copy-primary">{model.name}</span><span className="block truncate text-[9.5px] leading-3 text-sophon-copy-metadata">{model.downloads.toLocaleString()} downloads{model.license ? ` · ${model.license}` : ""}</span></span>
      </button>)}
    </div>
  </section>;
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
