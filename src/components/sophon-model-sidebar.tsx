"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDownAZ, Check, ChevronLeft, ChevronRight, Code2, Download, ExternalLink, Feather, FileText, Flame, LoaderCircle, PanelLeftClose, PanelLeftOpen, Search, Trash2, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModelRuntimeProfile, type ModelManifest } from "@/lib/onnx-models";
import type { ModelCacheState, RuntimeCapabilities } from "@/lib/onnx-types";
import { cn } from "@/lib/utils";
import type { TokenInspectMode } from "@/components/token-lens";
import {
  createCommunityModelDescriptor,
  assessCommunityModelCompatibility,
  estimateParameterCount,
  fetchOnnxCommunityModelDetails,
  refreshCommunityCatalogIndex,
  searchCommunityCatalogIndexPage,
  subscribeCommunityCatalogIndex,
  type CommunityModelPreviewSelection,
  type CommunityModelSummary,
  type CommunityCatalogSort
} from "@/lib/model-catalog";

type Props = {
  capabilities: RuntimeCapabilities | null;
  communityModels?: ModelManifest[];
  disabled?: boolean;
  inspectDisplayMode?: TokenInspectMode | null;
  inspectMetrics?: string;
  inspectMode?: boolean;
  mobileOpen: boolean;
  modelCacheState?: ModelCacheState;
  modelId: string;
  modelLoaded?: boolean;
  previewModelId?: string;
  previewModelUnsupported?: boolean;
  onCommunityModelAdded?: (selection: CommunityModelPreviewSelection) => void;
  onCommunityModelCheckChange?: (modelName: string | null) => void;
  onCommunityModelCleared?: () => void;
  onDeleteModel?: (modelId: string) => void;
  onInspectDisplayModeChange?: (mode: TokenInspectMode | null) => void;
  onInspectModeChange?: (enabled: boolean) => void;
  onMobileOpenChange: (open: boolean) => void;
};

export function GlauxModelSidebar({ capabilities, communityModels = [], disabled = false, inspectDisplayMode = null, inspectMetrics, inspectMode = false, mobileOpen, modelCacheState = "missing", modelId, modelLoaded = false, onCommunityModelAdded, onCommunityModelCheckChange, onCommunityModelCleared, onDeleteModel, onInspectDisplayModeChange, onInspectModeChange, onMobileOpenChange, previewModelId = "", previewModelUnsupported = false }: Props) {
  const [expanded, setExpanded] = useState(true);
  const panelProps = { capabilities, communityModels, disabled, inspectDisplayMode, inspectMetrics, inspectMode, modelCacheState, modelId, modelLoaded, onCommunityModelAdded, onCommunityModelCheckChange, onCommunityModelCleared, onDeleteModel, onInspectDisplayModeChange, onInspectModeChange, previewModelId, previewModelUnsupported };
  return <>
    <aside aria-label="Model library" className={cn("sophon-glass-strong sophon-reveal sophon-reveal-sidebar hidden h-full shrink-0 flex-col overflow-hidden border-y-0 border-l-0 transition-[width] duration-200 motion-reduce:transition-none lg:flex lg:h-[calc(100svh-74px)]", expanded ? "w-72" : "w-[4.75rem]")} data-state={expanded ? "expanded" : "collapsed"} id="model-library-desktop">
      <ModelPanel {...panelProps} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </aside>
    <Sheet onOpenChange={onMobileOpenChange} open={mobileOpen}>
      <SheetContent aria-describedby={undefined} className="sophon-glass-strong flex h-full w-[min(19rem,92vw)] flex-col overflow-hidden rounded-none border-y-0 border-l-0 p-0 pt-[env(safe-area-inset-top)] lg:hidden" id="model-library-mobile">
        <SheetTitle className="sr-only">Model library</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col" data-testid="mobile-model-sheet"><ModelPanel {...panelProps} expanded mobile onClose={() => onMobileOpenChange(false)} /></div>
      </SheetContent>
    </Sheet>
  </>;
}

type PanelProps = Omit<Props, "mobileOpen" | "onMobileOpenChange"> & { expanded: boolean; mobile?: boolean; onClose?: () => void; onToggle?: () => void };
type SidebarView = "popular" | "lightweight" | "all" | "details" | "dev";
function ModelPanel({ capabilities, communityModels = [], disabled = false, expanded, inspectDisplayMode = null, inspectMetrics, inspectMode = false, mobile = false, modelCacheState = "missing", modelId, modelLoaded = false, onClose, onCommunityModelAdded, onCommunityModelCheckChange, onCommunityModelCleared, onDeleteModel, onInspectDisplayModeChange, onInspectModeChange, onToggle, previewModelId = "", previewModelUnsupported = false }: PanelProps) {
  const [view, setView] = useState<SidebarView>("details");
  const hasLocalFiles = modelCacheState !== "missing";
  const availableViews: readonly SidebarView[] = modelLoaded
    ? ["details", "popular", "dev"]
    : hasLocalFiles
      ? ["details", "popular", "lightweight", "all"]
      : ["popular", "lightweight", "all"];
  const requestedView: SidebarView = inspectMode ? "dev" : view;
  const activeView = availableViews.includes(requestedView) ? requestedView : availableViews[0];
  const detailModel = communityModels.find((model) => model.id === modelId);
  const mobileProfile = capabilities?.hardwareTier === "mobile";
  const detailProfile = detailModel
    ? getModelRuntimeProfile(detailModel, mobileProfile ? "mobile" : "desktop")
    : null;
  function selectView(nextView: SidebarView) {
    setView(nextView);
    onInspectModeChange?.(nextView === "dev");
  }
  useEffect(() => {
    if (inspectMode && !modelLoaded) onInspectModeChange?.(false);
  }, [inspectMode, modelLoaded, onInspectModeChange]);
  const viewOptions = availableViews.map((value) => ({
    value,
    icon: value === "details" ? FileText : value === "popular" ? (modelLoaded ? Trophy : Flame) : value === "lightweight" ? Feather : value === "all" ? ArrowDownAZ : Code2,
    label: value === "details" ? "Model Details" : value === "popular" ? (modelLoaded ? "ONNX Leaderboard" : "Popular Models") : value === "lightweight" ? "Lightweight Models" : value === "all" ? "All Models" : "Dev Mode"
  }));
  return <>
    <header className={cn("flex h-16 shrink-0 items-center border-b border-sophon-glass-border p-2.5", expanded ? "justify-between" : "justify-center")}>
      {expanded ? <div className="min-w-0"><h2 className="sophon-type-status font-mono uppercase tracking-[0.12em] text-sophon-copy-primary" data-typography-role="status" id={mobile ? "model-library-mobile-title" : undefined}>Model library</h2><p className="sophon-type-metadata mt-1 font-mono uppercase tracking-[0.08em] text-sophon-copy-metadata" data-typography-role="metadata">{activeView === "details" ? "Model information" : activeView === "dev" ? "Developer tools" : activeView === "all" ? "Browse A–Z" : activeView === "lightweight" ? "Smaller models" : modelLoaded ? "ONNX Leaderboard" : "Popular models"}</p></div> : null}
      <Button aria-controls={mobile ? undefined : "model-library-desktop"} aria-expanded={mobile ? undefined : expanded} aria-label={mobile ? "Close model library" : expanded ? "Collapse model library" : "Expand model library"} className="size-11 shrink-0 rounded-xl lg:size-9" onClick={mobile ? onClose : onToggle} size="icon" type="button" variant="sophon">
        {mobile ? <X aria-hidden="true" /> : expanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
      </Button>
    </header>
    {expanded ? <div className="border-b border-sophon-glass-border px-2 py-1.5"><div aria-label="Model library views" className={cn("grid gap-0.5 rounded-lg border border-sophon-glass-border bg-sophon-panel-deep p-0.5 shadow-[inset_0_1px_0_var(--sophon-glass-highlight)]", viewOptions.length === 2 ? "grid-cols-2" : "grid-cols-3")} role="group">
      {viewOptions.map(({ icon: ViewIcon, label, value }) => <Tooltip key={value}>
        <TooltipTrigger asChild><button aria-label={label} aria-pressed={activeView === value} className={cn("grid h-8 min-w-0 place-items-center rounded-md transition-colors", activeView === value ? "bg-sophon-signal/10 text-sophon-signal-soft shadow-[inset_0_0_0_1px_var(--sophon-signal-bright)]" : "text-sophon-copy-metadata hover:bg-sophon-glass-tile hover:text-sophon-copy-primary")} onClick={() => selectView(value)} type="button"><ViewIcon aria-hidden="true" className="size-3.5" /></button></TooltipTrigger>
        <TooltipContent className="border border-sophon-glass-border bg-sophon-copy-primary text-sophon-panel shadow-lg" side="top">{label}</TooltipContent>
      </Tooltip>)}
    </div></div> : null}
    {activeView === "popular" || activeView === "lightweight" || activeView === "all" ? <fieldset className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-hidden p-3" data-testid={mobile ? "mobile-model-list" : "desktop-model-list"} disabled={disabled}>
      <legend className="sr-only">Local text generation models</legend>
      <div className="h-full min-h-0 min-w-0 w-full">
        {expanded ? <CommunityCatalog disabled={disabled} leaderboard={modelLoaded} mode={activeView === "all" ? "alphabetical" : activeView === "lightweight" ? "lightweight" : "popular"} onAdded={onCommunityModelAdded} onCheckChange={onCommunityModelCheckChange} onCleared={onCommunityModelCleared} selectedModelId={previewModelId} selectedModelUnsupported={previewModelUnsupported} /> : null}
      </div>
    </fieldset> : null}
    {expanded && activeView === "details" ? <ModelDetails cacheState={modelCacheState} disabled={disabled} model={detailModel} onDelete={onDeleteModel} profile={detailProfile} /> : null}
    {expanded && activeView === "dev" ? <DeveloperTools inspectDisplayMode={inspectDisplayMode} inspectMetrics={inspectMetrics} onInspectDisplayModeChange={onInspectDisplayModeChange} /> : null}
  </>;
}

function ModelDetails({ cacheState, disabled, model, onDelete, profile }: { cacheState: ModelCacheState; disabled: boolean; model?: ModelManifest; onDelete?: (modelId: string) => void; profile: ReturnType<typeof getModelRuntimeProfile> | null }) {
  if (!model || !profile) {
    return <section aria-label="Model details" className="min-h-0 flex-1 overflow-y-auto p-3"><div className="rounded-xl border border-sophon-glass-border bg-sophon-panel-deep p-3"><p className="text-sm font-medium text-sophon-copy-primary">No model selected</p><p className="mt-1 text-xs leading-5 text-sophon-copy-metadata">Choose a model from the ONNX Leaderboard to review its files, license, and runtime requirements.</p></div></section>;
  }
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
      {cacheState === "partial" ? <p className="mt-2 inline-flex rounded-md border border-sophon-glass-border bg-sophon-panel px-2 py-1 text-[10px] font-medium uppercase tracking-[0.06em] text-sophon-copy-metadata">Partial download</p> : null}
      <p className="mt-1 text-xs leading-5 text-sophon-copy-metadata">{model.description}</p>
      <dl className="mt-2 divide-y divide-sophon-glass-border overflow-hidden rounded-md border border-sophon-glass-border bg-sophon-panel">{details.map(([label, value]) => <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 px-2 py-2" key={label}><dt className="text-[10px] font-medium uppercase leading-4 tracking-[0.05em] text-sophon-copy-metadata">{label}</dt><dd className="min-w-0 break-words text-xs leading-4 text-sophon-copy-primary">{value}</dd></div>)}</dl>
      <Button asChild className="sophon-type-action mt-3 w-full !font-mono uppercase tracking-[0.06em]" size="sm" variant="sophon"><a href={`https://huggingface.co/${model.source.repo}`} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" />View on Hugging Face</a></Button>
      <Button aria-label={`Delete ${model.label} from this browser`} className="sophon-type-action mt-2 w-full border-destructive/35 !font-mono uppercase tracking-[0.06em] text-destructive hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive" disabled={disabled || !onDelete} onClick={() => onDelete?.(model.id)} size="sm" type="button" variant="sophon"><Trash2 aria-hidden="true" />Delete model</Button>
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

function CommunityCatalog({ disabled, leaderboard, mode, onAdded, onCheckChange, onCleared, selectedModelId, selectedModelUnsupported }: { disabled: boolean; leaderboard: boolean; mode: CommunityCatalogSort; onAdded?: (selection: CommunityModelPreviewSelection) => void; onCheckChange?: (modelName: string | null) => void; onCleared?: () => void; selectedModelId: string; selectedModelUnsupported: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly CommunityModelSummary[]>([]);
  const [pageSize, setPageSize] = useState(8);
  const [pageOffset, setPageOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<string | null>("Loading popular models…");
  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const modeLabel = mode === "alphabetical" ? "All Models" : mode === "lightweight" ? "Lightweight Models" : leaderboard ? "ONNX Leaderboard" : "Popular Models";

  useLayoutEffect(() => {
    const element = resultsRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const updatePageSize = (height: number) => {
      const nextPageSize = Math.max(1, Math.min(50, Math.floor((height + 4) / 56)));
      setPageSize((current) => current === nextPageSize ? current : nextPageSize);
    };
    updatePageSize(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updatePageSize(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeCommunityCatalogIndex(() => setCatalogRevision((revision) => revision + 1));
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    let active = true;
    void refreshCommunityCatalogIndex().catch((error) => {
      if (active) setStatus(error instanceof Error ? error.message : "Catalog indexing failed");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const trimmedQuery = query.trim();
    const timer = window.setTimeout(() => {
      void searchCommunityCatalogIndexPage(trimmedQuery, { limit: pageSize, offset: pageOffset, sort: mode })
        .then(({ models, total: nextTotal }) => {
          if (!active) return;
          if (nextTotal > 0 && pageOffset >= nextTotal) {
            setPageOffset(Math.max(0, nextTotal - pageSize));
            return;
          }
          setResults(models);
          setTotal(nextTotal);
          setStatus(models.length === 0
            ? trimmedQuery ? "No matching text-generation models" : "No compatible community models found"
            : null);
        })
        .catch((error) => {
          if (active) setStatus(error instanceof Error ? error.message : "Catalog indexing failed");
        });
    }, trimmedQuery ? 300 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [catalogRevision, mode, pageOffset, pageSize, query]);

  async function addModel(model: CommunityModelSummary) {
    if (!model.revision) return;
    const selected = selectedModelId === `${model.repo}@${model.revision}`;
    if (selected) {
      onCleared?.();
      setStatus(null);
      return;
    }
    setBusyRepo(model.repo);
    setStatus(null);
    onCheckChange?.(model.name);
    try {
      const details = await fetchOnnxCommunityModelDetails(model.repo, model.revision);
      const compatibility = assessCommunityModelCompatibility(details);
      const descriptor = compatibility.status === "compatible" ? createCommunityModelDescriptor(details) : null;
      onAdded?.({ compatibility, descriptor, details });
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${model.name} could not be added.`);
    } finally {
      setBusyRepo(null);
      onCheckChange?.(null);
    }
  }

  return <section className="flex h-full min-h-0 flex-col rounded-lg border border-sophon-glass-border bg-sophon-panel-deep p-2" aria-label={mode === "alphabetical" ? "All ONNX Community models" : mode === "lightweight" ? "Lightweight ONNX Community models" : leaderboard ? "ONNX Community leaderboard" : "Popular ONNX Community models"}>
    <div className="flex items-start gap-2">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-md border border-sophon-glass-border bg-sophon-panel text-sophon-signal-soft"><Trophy className="size-3.5" /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-sophon-copy-primary">{modeLabel}</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-sophon-copy-metadata">{mode === "alphabetical" ? "Compatible community models sorted A–Z" : mode === "lightweight" ? "Smallest estimated parameter counts first" : "Community models ranked by downloads · refreshed daily"}</span>
      </span>
    </div>
    <form className="relative mt-1.5" onSubmit={(event) => event.preventDefault()} role="search">
      <Search aria-hidden="true" className="absolute left-2 top-2 size-3.5 text-sophon-copy-metadata" />
      <input aria-label={`Filter ${modeLabel.toLowerCase()}`} className="h-8 w-full rounded-md border border-sophon-glass-border bg-sophon-panel pl-7 pr-2 text-xs text-sophon-copy-primary outline-none focus:border-sophon-signal-bright" disabled={disabled} onChange={(event) => {
        const value = event.target.value;
        setQuery(value);
        setPageOffset(0);
        setResults([]);
        setStatus(null);
      }} placeholder={mode === "popular" ? "Filter leaderboard…" : "Filter models…"} value={query} />
    </form>
    {status ? <p className="mt-2 text-xs leading-4 text-sophon-copy-metadata" role="status">{status}</p> : null}
    {results.length > 0 ? <p className="mt-2 text-[10px] font-medium uppercase leading-4 tracking-[0.07em] text-sophon-copy-metadata">{query.trim() ? "Matching models" : mode === "alphabetical" ? "Models A–Z" : mode === "lightweight" ? "Smallest models" : "Top models"}</p> : null}
    <div className="mt-1 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-0.5" ref={resultsRef} style={{ gridAutoRows: "minmax(2.875rem, 3.25rem)" }}>
      {results.map((model, index) => {
        const selected = Boolean(model.revision && selectedModelId === `${model.repo}@${model.revision}`);
        const unsupported = selected && selectedModelUnsupported;
        return <button aria-pressed={selected} className={cn("grid h-full w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-60", unsupported ? "border-destructive bg-destructive/10 text-destructive shadow-[inset_0_0_0_1px_var(--destructive)]" : selected ? "border-sophon-signal-bright bg-sophon-signal/10 shadow-[inset_0_0_0_1px_var(--sophon-signal-bright)]" : "border-sophon-glass-border bg-sophon-panel hover:border-sophon-signal-bright/60")} disabled={disabled || busyRepo !== null || !model.revision} key={model.repo} onClick={() => void addModel(model)} type="button">
        <span aria-label={`Rank ${pageOffset + index + 1}`} className="sophon-type-status font-mono text-[10px] font-semibold tabular-nums text-sophon-signal-soft">#{pageOffset + index + 1}</span>
        <span className="min-w-0"><span className="block truncate text-xs font-medium leading-4 text-sophon-copy-primary">{model.name}</span><span className="block truncate text-[10px] leading-4 text-sophon-copy-metadata">{mode === "lightweight" ? formatParameterCount(estimateParameterCount(model)) : `${model.downloads.toLocaleString()} downloads`}{model.license ? ` · ${model.license}` : ""}</span></span>
        {busyRepo === model.repo ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" /> : unsupported ? <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-destructive" /> : selected ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-sophon-signal-soft" /> : <Download aria-hidden="true" className="size-3.5 shrink-0" />}
      </button>})}
    </div>
    {total > 0 ? <nav aria-label={`${modeLabel} pagination`} className="mt-2 flex shrink-0 items-center gap-1 border-t border-sophon-glass-border pt-2">
      <Button aria-label={`Previous ${modeLabel.toLowerCase()} page`} className="size-8 shrink-0 p-0" disabled={disabled || busyRepo !== null || pageOffset === 0} onClick={() => setPageOffset((current) => Math.max(0, current - pageSize))} size="icon" type="button" variant="sophon"><ChevronLeft aria-hidden="true" /></Button>
      <span className="sophon-type-metadata min-w-0 flex-1 text-center font-mono uppercase tracking-[0.06em] text-sophon-copy-metadata" data-typography-role="metadata"><span className="font-semibold tabular-nums text-sophon-copy-primary">{pageOffset + 1}–{Math.min(pageOffset + results.length, total)}</span> of <span className="tabular-nums">{total}</span></span>
      <Button aria-label={`Next ${modeLabel.toLowerCase()} page`} className="size-8 shrink-0 p-0" disabled={disabled || busyRepo !== null || pageOffset + results.length >= total} onClick={() => setPageOffset((current) => Math.min(Math.max(0, total - pageSize), current + pageSize))} size="icon" type="button" variant="sophon"><ChevronRight aria-hidden="true" /></Button>
    </nav> : null}
  </section>;
}

function formatContext(tokens: number | null) {
  return tokens === null ? "Context varies" : `${Math.round(tokens / 1024)}K context`;
}

function formatParameterCount(count: number | null) {
  if (count === null) return "Size estimate unavailable";
  if (count >= 1_000_000_000) return `~${Number((count / 1_000_000_000).toFixed(1))}B parameters`;
  return `~${Math.round(count / 1_000_000)}M parameters`;
}
