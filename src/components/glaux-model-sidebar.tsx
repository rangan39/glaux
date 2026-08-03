"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDownAZ, ArrowLeft, Check, ChevronLeft, ChevronRight, Circle, Code2, ExternalLink, Feather, FileText, Flame, LoaderCircle, PanelLeftClose, PanelLeftOpen, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModelRuntimeProfile, type ModelManifest } from "@/lib/onnx-models";
import type { ModelCacheState, RuntimeCapabilities } from "@/lib/onnx-types";
import { getReadySidebarModelId } from "@/lib/model-sidebar-navigation";
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
  const [view, setView] = useState<SidebarView>("popular");
  const [catalogView, setCatalogView] = useState<CatalogView>("popular");
  const [dismissedDetailsForModelId, setDismissedDetailsForModelId] = useState<string | null>(null);
  const readyModelIdRef = useRef<string | null>(null);
  const readyModelId = getReadySidebarModelId({ cacheState: modelCacheState, loaded: modelLoaded, modelId });
  const displayedView = modelCacheState === "cached" && modelId && dismissedDetailsForModelId !== modelId
    ? "details"
    : view === "details" && modelCacheState === "missing" ? catalogView : view;
  useEffect(() => {
    if (!readyModelId) {
      readyModelIdRef.current = null;
      return;
    }
    if (readyModelIdRef.current === readyModelId) return;
    readyModelIdRef.current = readyModelId;
    setDismissedDetailsForModelId(null);
    setView("details");
    onInspectModeChange?.(false);
  }, [onInspectModeChange, readyModelId]);
  function selectView(nextView: SidebarView) {
    if (isCatalogView(nextView)) setCatalogView(nextView);
    setDismissedDetailsForModelId(nextView === "details" ? null : modelId);
    setView(nextView);
    onInspectModeChange?.(nextView === "dev");
  }
  const panelProps = { capabilities, communityModels, disabled, inspectDisplayMode, inspectMetrics, inspectMode, modelCacheState, modelId, modelLoaded, onBackToCatalog: () => selectView(catalogView), onCommunityModelAdded, onCommunityModelCheckChange, onCommunityModelCleared, onDeleteModel, onInspectDisplayModeChange, onInspectModeChange, onSelectView: selectView, previewModelId, previewModelUnsupported, view: displayedView };
  return <>
    <aside aria-label="Model library" className={cn("glaux-glass-strong glaux-reveal glaux-reveal-sidebar hidden h-full shrink-0 flex-col overflow-hidden border-y-0 border-l-0 transition-[width] duration-200 motion-reduce:transition-none lg:flex lg:h-[calc(100svh-74px)]", expanded ? "w-72" : "w-[4.75rem]")} data-state={expanded ? "expanded" : "collapsed"} id="model-library-desktop">
      <ModelPanel {...panelProps} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </aside>
    <Sheet onOpenChange={onMobileOpenChange} open={mobileOpen}>
      <SheetContent aria-describedby={undefined} className="glaux-glass-strong flex h-full w-[min(19rem,92vw)] flex-col overflow-hidden rounded-none border-y-0 border-l-0 p-0 pt-[env(safe-area-inset-top)] lg:hidden" id="model-library-mobile">
        <SheetTitle className="sr-only">Model library</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col" data-testid="mobile-model-sheet"><ModelPanel {...panelProps} expanded mobile onClose={() => onMobileOpenChange(false)} /></div>
      </SheetContent>
    </Sheet>
  </>;
}

type SidebarView = "popular" | "lightweight" | "all" | "details" | "dev";
type CatalogView = Extract<SidebarView, "popular" | "lightweight" | "all">;
type PanelProps = Omit<Props, "mobileOpen" | "onMobileOpenChange"> & { expanded: boolean; mobile?: boolean; onBackToCatalog: () => void; onClose?: () => void; onSelectView: (view: SidebarView) => void; onToggle?: () => void; view: SidebarView };
function isCatalogView(view: SidebarView): view is CatalogView {
  return view === "popular" || view === "lightweight" || view === "all";
}
function ModelPanel({ capabilities, communityModels = [], disabled = false, expanded, inspectDisplayMode = null, inspectMetrics, inspectMode = false, mobile = false, modelCacheState = "missing", modelId, modelLoaded = false, onBackToCatalog, onClose, onCommunityModelAdded, onCommunityModelCheckChange, onCommunityModelCleared, onDeleteModel, onInspectDisplayModeChange, onInspectModeChange, onSelectView, onToggle, previewModelId = "", previewModelUnsupported = false, view }: PanelProps) {
  const hasLocalFiles = modelCacheState !== "missing";
  const requestedView: SidebarView = inspectMode ? "dev" : view;
  const activeView: SidebarView = requestedView === "dev" && !modelLoaded
    ? hasLocalFiles ? "details" : "popular"
    : requestedView === "details" && !hasLocalFiles ? "popular" : requestedView;
  const detailModel = communityModels.find((model) => model.id === modelId);
  const mobileProfile = capabilities?.hardwareTier === "mobile";
  const detailProfile = detailModel
    ? getModelRuntimeProfile(detailModel, mobileProfile ? "mobile" : "desktop")
    : null;
  useEffect(() => {
    if (inspectMode && !modelLoaded) onInspectModeChange?.(false);
  }, [inspectMode, modelLoaded, onInspectModeChange]);
  const viewOptions: readonly SidebarView[] = isCatalogView(activeView)
    ? ["popular", "lightweight", "all"]
    : modelLoaded ? ["details", "dev"] : ["details"];
  const viewOptionDetails = viewOptions.map((value) => ({
    value,
    icon: value === "details" ? FileText : value === "popular" ? Flame : value === "lightweight" ? Feather : value === "all" ? ArrowDownAZ : Code2,
    label: value === "details" ? "Model Details" : value === "popular" ? "Popular Models" : value === "lightweight" ? "Lightweight Models" : value === "all" ? "All Models" : "Dev Mode"
  }));
  return <>
    <header className={cn("flex h-16 shrink-0 items-center border-b border-glaux-glass-border p-2.5", expanded ? "justify-between" : "justify-center")}>
      {expanded ? <div className="min-w-0"><h2 className="glaux-type-status font-mono uppercase tracking-[0.12em] text-glaux-copy-primary" data-typography-role="status" id={mobile ? "model-library-mobile-title" : undefined}>Model library</h2><p className="glaux-type-metadata mt-1 font-mono uppercase tracking-[0.08em] text-glaux-copy-metadata" data-typography-role="metadata">{activeView === "details" ? "Model information" : activeView === "dev" ? "Developer tools" : activeView === "all" ? "Browse A–Z" : activeView === "lightweight" ? "Smaller models" : "Popular models"}</p></div> : null}
      <Button aria-controls={mobile ? undefined : "model-library-desktop"} aria-expanded={mobile ? undefined : expanded} aria-label={mobile ? "Close model library" : expanded ? "Collapse model library" : "Expand model library"} className="size-11 shrink-0 rounded-xl lg:size-9" onClick={mobile ? onClose : onToggle} size="icon" type="button" variant="sophon">
        {mobile ? <X aria-hidden="true" /> : expanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
      </Button>
    </header>
    {expanded && !isCatalogView(activeView) ? <div className="border-b border-glaux-glass-border px-2 py-1.5"><Button className="w-full justify-start" onClick={onBackToCatalog} size="sm" type="button" variant="sophon"><ArrowLeft aria-hidden="true" />Back to model library</Button></div> : null}
    {expanded && isCatalogView(activeView) && hasLocalFiles ? <div className="border-b border-glaux-glass-border px-2 py-1.5"><Button className="w-full justify-start" onClick={() => onSelectView("details")} size="sm" type="button" variant="sophon"><FileText aria-hidden="true" />View model details</Button></div> : null}
    {expanded ? <div className="border-b border-glaux-glass-border px-2 py-1.5"><div aria-label="Model library views" className={cn("grid gap-0.5 rounded-lg border border-glaux-glass-border bg-glaux-panel-deep p-0.5 shadow-[inset_0_1px_0_var(--glaux-glass-highlight)]", viewOptionDetails.length === 1 ? "grid-cols-1" : viewOptionDetails.length === 2 ? "grid-cols-2" : "grid-cols-3")} role="group">
      {viewOptionDetails.map(({ icon: ViewIcon, label, value }) => <Tooltip key={value}>
        <TooltipTrigger asChild><button aria-label={label} aria-pressed={activeView === value} className={cn("grid h-8 min-w-0 place-items-center rounded-md transition-colors", activeView === value ? "bg-glaux-signal/10 text-glaux-signal-soft shadow-[inset_0_0_0_1px_var(--glaux-signal-bright)]" : "text-glaux-copy-metadata hover:bg-glaux-glass-tile hover:text-glaux-copy-primary")} onClick={() => onSelectView(value)} type="button"><ViewIcon aria-hidden="true" className="size-3.5" /></button></TooltipTrigger>
        <TooltipContent className="border border-glaux-glass-border bg-glaux-copy-primary text-glaux-panel shadow-lg" side="top">{label}</TooltipContent>
      </Tooltip>)}
    </div></div> : null}
    {activeView === "popular" || activeView === "lightweight" || activeView === "all" ? <fieldset className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-hidden p-3" data-testid={mobile ? "mobile-model-list" : "desktop-model-list"} disabled={disabled}>
      <legend className="sr-only">Local text generation models</legend>
      <div className="h-full min-h-0 min-w-0 w-full">
        {expanded ? <CommunityCatalog disabled={disabled} mode={activeView === "all" ? "alphabetical" : activeView === "lightweight" ? "lightweight" : "popular"} onAdded={onCommunityModelAdded} onCheckChange={onCommunityModelCheckChange} onCleared={onCommunityModelCleared} selectedModelId={previewModelId} selectedModelUnsupported={previewModelUnsupported} /> : null}
      </div>
    </fieldset> : null}
    {expanded && activeView === "details" ? <ModelDetails cacheState={modelCacheState} disabled={disabled} model={detailModel} onDelete={onDeleteModel} profile={detailProfile} /> : null}
    {expanded && activeView === "dev" ? <DeveloperTools inspectDisplayMode={inspectDisplayMode} inspectMetrics={inspectMetrics} onInspectDisplayModeChange={onInspectDisplayModeChange} /> : null}
  </>;
}

function ModelDetails({ cacheState, disabled, model, onDelete, profile }: { cacheState: ModelCacheState; disabled: boolean; model?: ModelManifest; onDelete?: (modelId: string) => void; profile: ReturnType<typeof getModelRuntimeProfile> | null }) {
  if (!model || !profile) {
    return <section aria-label="Model details" className="min-h-0 flex-1 overflow-y-auto p-3"><div className="rounded-xl border border-glaux-glass-border bg-glaux-panel-deep p-3"><p className="text-sm font-medium text-glaux-copy-primary">No model selected</p><p className="mt-1 text-xs leading-5 text-glaux-copy-metadata">Choose a model from Popular Models to review its files, license, and runtime requirements.</p></div></section>;
  }
  if (model.source.kind !== "huggingface") {
    return <section aria-label="Model details" className="min-h-0 flex-1 overflow-y-auto p-3"><div className="rounded-xl border border-glaux-glass-border bg-glaux-panel-deep p-3"><p className="text-sm text-glaux-copy-metadata">Select a Hugging Face model to view its details.</p></div></section>;
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
    <div className="rounded-lg border border-glaux-glass-border bg-glaux-panel-deep p-2.5">
      <p className="text-sm font-semibold text-glaux-copy-primary">{model.label}</p>
      {cacheState === "partial" ? <p className="mt-2 inline-flex rounded-md border border-glaux-glass-border bg-glaux-panel px-2 py-1 text-[10px] font-medium uppercase tracking-[0.06em] text-glaux-copy-metadata">Partial download</p> : null}
      <p className="mt-1 text-xs leading-5 text-glaux-copy-metadata">{model.description}</p>
      <dl className="mt-2 divide-y divide-glaux-glass-border overflow-hidden rounded-md border border-glaux-glass-border bg-glaux-panel">{details.map(([label, value]) => <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 px-2 py-2" key={label}><dt className="text-[10px] font-medium uppercase leading-4 tracking-[0.05em] text-glaux-copy-metadata">{label}</dt><dd className="min-w-0 break-words text-xs leading-4 text-glaux-copy-primary">{value}</dd></div>)}</dl>
      <Button asChild className="glaux-type-action mt-3 w-full !font-mono uppercase tracking-[0.06em]" size="sm" variant="sophon"><a href={`https://huggingface.co/${model.source.repo}`} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" />View on Hugging Face</a></Button>
      <Button aria-label={`Delete ${model.label} from this browser`} className="glaux-type-action mt-2 w-full border-destructive/35 !font-mono uppercase tracking-[0.06em] text-destructive hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive" disabled={disabled || !onDelete} onClick={() => onDelete?.(model.id)} size="sm" type="button" variant="sophon"><Trash2 aria-hidden="true" />Delete model</Button>
    </div>
  </section>;
}

function DeveloperTools({ inspectDisplayMode, inspectMetrics, onInspectDisplayModeChange }: { inspectDisplayMode: TokenInspectMode | null; inspectMetrics?: string; onInspectDisplayModeChange?: (mode: TokenInspectMode | null) => void }) {
  return <section aria-label="Generation metrics" className="min-h-0 flex-1 overflow-y-auto p-2.5">
    <div aria-label="Inspect message display" className="mb-3 flex rounded-xl border border-glaux-glass-border bg-glaux-panel-deep p-0.5" role="group">
      {(["tokens", "words"] as const).map((mode) => <button aria-pressed={inspectDisplayMode === mode} className={cn("glaux-type-action min-h-9 flex-1 rounded-lg px-2 font-mono uppercase tracking-[0.06em] transition-colors", inspectDisplayMode === mode ? "bg-glaux-signal text-white shadow-[0_0_12px_var(--glaux-signal-shadow)]" : "text-glaux-copy-metadata hover:bg-glaux-glass-tile hover:text-glaux-copy-primary")} key={mode} onClick={() => onInspectDisplayModeChange?.(inspectDisplayMode === mode ? null : mode)} type="button">{mode}</button>)}
    </div>
    <div className="rounded-xl border border-glaux-glass-border bg-glaux-panel-deep p-3">
      <p className="glaux-type-metadata font-mono uppercase tracking-[0.1em] text-glaux-copy-metadata" data-typography-role="metadata">Generation metrics</p>
      {inspectMetrics ? <dl className="mt-3 grid gap-2">{inspectMetrics.split(" · ").map((metric) => <div className="rounded-lg border border-glaux-glass-border bg-glaux-panel px-2.5 py-2" key={metric}><dd className="glaux-type-status font-mono font-medium text-glaux-copy-primary" data-typography-role="status">{metric}</dd></div>)}</dl> : <p className="mt-3 text-sm leading-5 text-glaux-copy-metadata">Hover a response to inspect its timing and token metrics.</p>}
      <p className="mt-3 border-t border-glaux-glass-border pt-3 text-xs leading-5 text-glaux-copy-metadata">Choose Tokens or Words to inspect generated responses.</p>
    </div>
  </section>;
}

function CommunityCatalog({ disabled, mode, onAdded, onCheckChange, onCleared, selectedModelId, selectedModelUnsupported }: { disabled: boolean; mode: CommunityCatalogSort; onAdded?: (selection: CommunityModelPreviewSelection) => void; onCheckChange?: (modelName: string | null) => void; onCleared?: () => void; selectedModelId: string; selectedModelUnsupported: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly CommunityModelSummary[]>([]);
  const [pageSize, setPageSize] = useState(8);
  const [pageOffset, setPageOffset] = useState(0);
  const [pageMode, setPageMode] = useState(mode);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const modeLabel = mode === "alphabetical" ? "All Models" : mode === "lightweight" ? "Lightweight Models" : "Popular Models";

  if (pageMode !== mode) {
    setPageMode(mode);
    setPageOffset(0);
    setResults([]);
    setTotal(0);
    setStatus(null);
    setLoading(true);
  }

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
    let settleTimer: number | undefined;
    const trimmedQuery = query.trim();
    const timer = window.setTimeout(() => {
      const loadingStartedAt = Date.now();
      void searchCommunityCatalogIndexPage(trimmedQuery, { limit: pageSize, offset: pageOffset, sort: mode })
        .then(({ models, total: nextTotal }) => {
          const remainingTransitionMs = Math.max(0, 240 - (Date.now() - loadingStartedAt));
          settleTimer = window.setTimeout(() => {
            if (!active) return;
            if (nextTotal > 0 && pageOffset >= nextTotal) {
              setPageOffset(Math.max(0, nextTotal - pageSize));
              return;
            }
            setResults(models);
            setTotal(nextTotal);
            setLoading(false);
            setStatus(models.length === 0
              ? trimmedQuery ? "No matching text-generation models" : "No compatible community models found"
              : null);
          }, remainingTransitionMs);
        })
        .catch((error) => {
          if (active) {
            setLoading(false);
            setStatus(error instanceof Error ? error.message : "Catalog indexing failed");
          }
        });
    }, trimmedQuery ? 300 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    };
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

  return <section aria-busy={loading} className="flex h-full min-h-0 flex-col rounded-lg border border-glaux-glass-border bg-glaux-panel-deep p-2" aria-label={mode === "alphabetical" ? "All ONNX Community models" : mode === "lightweight" ? "Lightweight ONNX Community models" : "Popular ONNX Community models"}>
    <div>
      <span className="block min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-glaux-copy-primary">{modeLabel}</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-glaux-copy-metadata">{mode === "alphabetical" ? "Compatible community models sorted A–Z" : mode === "lightweight" ? "Smallest estimated parameter counts first" : "Community models ranked by downloads · refreshed daily"}</span>
      </span>
    </div>
    <form className="relative mt-1.5" onSubmit={(event) => event.preventDefault()} role="search">
      <Search aria-hidden="true" className="absolute left-2 top-2 size-3.5 text-glaux-copy-metadata" />
      <input aria-label={`Filter ${modeLabel.toLowerCase()}`} className="h-8 w-full rounded-md border border-glaux-glass-border bg-glaux-panel pl-7 pr-2 text-xs text-glaux-copy-primary outline-none focus:border-glaux-signal-bright" disabled={disabled} onChange={(event) => {
        const value = event.target.value;
        setQuery(value);
        setPageOffset(0);
        setResults([]);
        setStatus(null);
        setLoading(true);
      }} placeholder={mode === "popular" ? "Filter popular models…" : "Filter models…"} value={query} />
    </form>
    {status ? <p className="mt-2 text-xs leading-4 text-glaux-copy-metadata" role="status">{status}</p> : null}
    {loading ? <p className="sr-only" role="status">Loading {modeLabel.toLowerCase()}</p> : null}
    {loading || results.length > 0 ? <p className="mt-2 text-[10px] font-medium uppercase leading-4 tracking-[0.07em] text-glaux-copy-metadata">{loading ? "Loading models" : query.trim() ? "Matching models" : mode === "alphabetical" ? "Models A–Z" : mode === "lightweight" ? "Smallest models" : "Top models"}</p> : null}
    <div className="mt-1 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-0.5" ref={resultsRef} style={{ gridAutoRows: "minmax(2.875rem, 3.25rem)" }}>
      {loading ? Array.from({ length: Math.min(pageSize, 10) }, (_, index) => <div aria-hidden="true" className={cn("grid h-full w-full items-center gap-1.5 rounded-md border border-glaux-glass-border bg-glaux-panel px-2 py-1.5", mode === "alphabetical" ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[1.5rem_minmax(0,1fr)_auto]")} key={index}>
        {mode !== "alphabetical" ? <span className="h-2 w-4 rounded bg-glaux-glass-border/70" /> : null}
        <span className="grid gap-1.5"><span className="h-2.5 w-2/3 rounded bg-glaux-glass-border/70 motion-safe:animate-pulse" /><span className="h-2 w-1/2 rounded bg-glaux-glass-border/50 motion-safe:animate-pulse" /></span>
        <span className="size-3.5 rounded-full border border-glaux-glass-border" />
      </div>) : results.map((model, index) => {
        const selected = Boolean(model.revision && selectedModelId === `${model.repo}@${model.revision}`);
        const unsupported = selected && selectedModelUnsupported;
        return <button aria-pressed={selected} className={cn("grid h-full w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-60", mode === "alphabetical" ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[1.5rem_minmax(0,1fr)_auto]", unsupported ? "border-destructive bg-destructive/10 text-destructive shadow-[inset_0_0_0_1px_var(--destructive)]" : selected ? "border-glaux-signal-bright bg-glaux-signal/10 shadow-[inset_0_0_0_1px_var(--glaux-signal-bright)]" : "border-glaux-glass-border bg-glaux-panel hover:border-glaux-signal-bright/60")} disabled={disabled || busyRepo !== null || !model.revision} key={model.repo} onClick={() => void addModel(model)} type="button">
        {mode !== "alphabetical" ? <span aria-label={`Rank ${pageOffset + index + 1}`} className="glaux-type-status font-mono text-[10px] font-semibold tabular-nums text-glaux-signal-soft">#{pageOffset + index + 1}</span> : null}
        <span className="min-w-0"><span className="block truncate text-xs font-medium leading-4 text-glaux-copy-primary">{model.name}</span><span className="block truncate text-[10px] leading-4 text-glaux-copy-metadata">{mode === "lightweight" ? formatParameterCount(estimateParameterCount(model)) : `${model.downloads.toLocaleString()} downloads`}{model.license ? ` · ${model.license}` : ""}</span></span>
        {busyRepo === model.repo ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" /> : unsupported ? <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-destructive" /> : selected ? <span aria-hidden="true" className="grid size-3.5 shrink-0 place-items-center rounded-full bg-green-500 text-white"><Check className="size-2.5 stroke-[2.75]" /></span> : <Circle aria-hidden="true" className="size-3.5 shrink-0 text-glaux-copy-metadata" />}
      </button>})}
    </div>
    <nav aria-hidden={total === 0 ? true : undefined} aria-label={total > 0 ? `${modeLabel} pagination` : undefined} className={cn("mt-2 flex shrink-0 items-center gap-1 border-t border-glaux-glass-border pt-2", total === 0 && "invisible")}>
      <Button aria-label={`Previous ${modeLabel.toLowerCase()} page`} className="size-8 shrink-0 p-0" disabled={disabled || busyRepo !== null || total === 0 || pageOffset === 0} onClick={() => setPageOffset((current) => Math.max(0, current - pageSize))} size="icon" type="button" variant="sophon"><ChevronLeft aria-hidden="true" /></Button>
      <span className="glaux-type-metadata min-w-0 flex-1 text-center font-mono uppercase tracking-[0.06em] text-glaux-copy-metadata" data-typography-role="metadata"><span className="font-semibold tabular-nums text-glaux-copy-primary">{pageOffset + 1}–{Math.min(pageOffset + results.length, total)}</span> of <span className="tabular-nums">{total}</span></span>
      <Button aria-label={`Next ${modeLabel.toLowerCase()} page`} className="size-8 shrink-0 p-0" disabled={disabled || busyRepo !== null || total === 0 || pageOffset + results.length >= total} onClick={() => setPageOffset((current) => Math.min(Math.max(0, total - pageSize), current + pageSize))} size="icon" type="button" variant="sophon"><ChevronRight aria-hidden="true" /></Button>
    </nav>
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
