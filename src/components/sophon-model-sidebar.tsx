"use client";

import { FormEvent, useEffect, useState } from "react";
import { Code2, Download, ExternalLink, FileText, LoaderCircle, PanelLeftClose, PanelLeftOpen, Search, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModelRuntimeProfile, type ModelManifest } from "@/lib/onnx-models";
import type { RuntimeCapabilities } from "@/lib/onnx-types";
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
  capabilities: RuntimeCapabilities | null;
  communityModels?: ModelManifest[];
  disabled?: boolean;
  inspectDisplayMode?: TokenInspectMode | null;
  inspectMetrics?: string;
  inspectMode?: boolean;
  mobileOpen: boolean;
  modelId: string;
  onCommunityModelAdded?: (descriptor: CommunityModelDescriptor) => void;
  onInspectDisplayModeChange?: (mode: TokenInspectMode | null) => void;
  onInspectModeChange?: (enabled: boolean) => void;
  onMobileOpenChange: (open: boolean) => void;
};

export function GlauxModelSidebar({ capabilities, communityModels = [], disabled = false, inspectDisplayMode = null, inspectMetrics, inspectMode = false, mobileOpen, modelId, onCommunityModelAdded, onInspectDisplayModeChange, onInspectModeChange, onMobileOpenChange }: Props) {
  const [expanded, setExpanded] = useState(true);
  const panelProps = { capabilities, communityModels, disabled, inspectDisplayMode, inspectMetrics, inspectMode, modelId, onCommunityModelAdded, onInspectDisplayModeChange, onInspectModeChange };
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
function ModelPanel({ capabilities, communityModels = [], disabled = false, expanded, inspectDisplayMode = null, inspectMetrics, inspectMode = false, mobile = false, modelId, onClose, onCommunityModelAdded, onInspectDisplayModeChange, onInspectModeChange, onToggle }: PanelProps) {
  const [view, setView] = useState<SidebarView>("search");
  const activeView: SidebarView = inspectMode ? "dev" : view;
  const detailModel = communityModels.find((model) => model.id === modelId);
  const mobileProfile = capabilities?.hardwareTier === "mobile";
  const detailProfile = detailModel
    ? getModelRuntimeProfile(detailModel, mobileProfile ? "mobile" : "desktop")
    : null;
  function selectView(nextView: SidebarView) {
    setView(nextView);
    onInspectModeChange?.(nextView === "dev");
  }
  return <>
    <header className={cn("flex h-16 shrink-0 items-center border-b border-sophon-glass-border p-2.5", expanded ? "justify-between" : "justify-center")}>
      {expanded ? <div className="min-w-0"><h2 className="sophon-type-status font-mono uppercase tracking-[0.12em] text-sophon-copy-primary" data-typography-role="status" id={mobile ? "model-library-mobile-title" : undefined}>Model library</h2><p className="sophon-type-metadata mt-1 font-mono uppercase tracking-[0.08em] text-sophon-copy-metadata" data-typography-role="metadata">{activeView === "search" ? "ONNX Leaderboard" : activeView === "details" ? "Model information" : "Developer tools"}</p></div> : null}
      <Button aria-controls={mobile ? undefined : "model-library-desktop"} aria-expanded={mobile ? undefined : expanded} aria-label={mobile ? "Close model library" : expanded ? "Collapse model library" : "Expand model library"} className="size-11 shrink-0 rounded-xl lg:size-9" onClick={mobile ? onClose : onToggle} size="icon" type="button" variant="sophon">
        {mobile ? <X aria-hidden="true" /> : expanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
      </Button>
    </header>
    {expanded ? <div className="border-b border-sophon-glass-border px-2 py-1.5"><div aria-label="Model library views" className="grid grid-cols-3 gap-0.5 rounded-lg border border-sophon-glass-border bg-sophon-panel-deep p-0.5 shadow-[inset_0_1px_0_var(--sophon-glass-highlight)]" role="group">
      {([
        { icon: Trophy, label: "ONNX Leaderboard", value: "search" },
        { icon: FileText, label: "Model Details", value: "details" },
        { icon: Code2, label: "Dev Mode", value: "dev" }
      ] as const).map(({ icon: ViewIcon, label, value }) => <Tooltip key={value}>
        <TooltipTrigger asChild><button aria-label={label} aria-pressed={activeView === value} className={cn("grid h-8 min-w-0 place-items-center rounded-md transition-colors", activeView === value ? "bg-sophon-signal/10 text-sophon-signal-soft shadow-[inset_0_0_0_1px_var(--sophon-signal-bright)]" : "text-sophon-copy-metadata hover:bg-sophon-glass-tile hover:text-sophon-copy-primary")} onClick={() => selectView(value)} type="button"><ViewIcon aria-hidden="true" className="size-3.5" /></button></TooltipTrigger>
        <TooltipContent className="border border-sophon-glass-border bg-sophon-copy-primary text-sophon-panel shadow-lg" side="top">{label}</TooltipContent>
      </Tooltip>)}
    </div></div> : null}
    {activeView === "search" ? <fieldset className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-y-auto p-3" data-testid={mobile ? "mobile-model-list" : "desktop-model-list"} disabled={disabled}>
      <legend className="sr-only">Local text generation models</legend>
      <div className="min-w-0 w-full space-y-2">
        {expanded ? <CommunityCatalog disabled={disabled} onAdded={onCommunityModelAdded} /> : null}
      </div>
    </fieldset> : null}
    {expanded && activeView === "details" ? <ModelDetails model={detailModel} profile={detailProfile} /> : null}
    {expanded && activeView === "dev" ? <DeveloperTools inspectDisplayMode={inspectDisplayMode} inspectMetrics={inspectMetrics} onInspectDisplayModeChange={onInspectDisplayModeChange} /> : null}
  </>;
}

function ModelDetails({ model, profile }: { model?: ModelManifest; profile: ReturnType<typeof getModelRuntimeProfile> | null }) {
  if (!model || !profile) {
    return <section aria-label="Model details" className="min-h-0 flex-1 overflow-y-auto p-3"><div className="rounded-xl border border-sophon-glass-border bg-sophon-panel-deep p-3"><p className="text-sm font-medium text-sophon-copy-primary">No model selected</p><p className="mt-1 text-xs leading-5 text-sophon-copy-metadata">Choose a model in Search to review its files, license, and runtime requirements.</p></div></section>;
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
      <p className="mt-1 text-xs leading-5 text-sophon-copy-metadata">{model.description}</p>
      <dl className="mt-2 divide-y divide-sophon-glass-border overflow-hidden rounded-md border border-sophon-glass-border bg-sophon-panel">{details.map(([label, value]) => <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 px-2 py-2" key={label}><dt className="text-[10px] font-medium uppercase leading-4 tracking-[0.05em] text-sophon-copy-metadata">{label}</dt><dd className="min-w-0 break-words text-xs leading-4 text-sophon-copy-primary">{value}</dd></div>)}</dl>
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
  const [status, setStatus] = useState<string | null>("Loading popular models…");
  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);

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
    const resultLimit = trimmedQuery ? 8 : 5;
    const timer = window.setTimeout(() => {
      void searchCommunityCatalogIndex(trimmedQuery, resultLimit)
        .then((models) => {
          if (!active) return;
          setResults(models);
          setStatus(models.length === 0
            ? trimmedQuery ? "No matching text-generation models" : "No compatible community models found"
            : null);
        })
        .catch((error) => {
          if (active) setStatus(error instanceof Error ? error.message : "Catalog indexing failed");
        });
    }, trimmedQuery ? 300 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [catalogRevision, query]);

  async function addModel(model: CommunityModelSummary) {
    if (!model.revision) return;
    setBusyRepo(model.repo);
    setStatus(`Checking ${model.name}…`);
    try {
      const details = await fetchOnnxCommunityModelDetails(model.repo, model.revision);
      const descriptor = createCommunityModelDescriptor(details);
      await saveCommunityModelDescriptor(descriptor);
      onAdded?.(descriptor);
      setStatus(`${model.name} selected. Confirm the download in the open dialog.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${model.name} could not be added.`);
    } finally {
      setBusyRepo(null);
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); }

  return <section className="mb-2 rounded-lg border border-sophon-glass-border bg-sophon-panel-deep p-2" aria-label="ONNX Community leaderboard">
    <div className="flex items-start gap-2">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-md border border-sophon-glass-border bg-sophon-panel text-sophon-signal-soft"><Trophy className="size-3.5" /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-sophon-copy-primary">ONNX Leaderboard</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-sophon-copy-metadata">Community models ranked by downloads · refreshed daily</span>
      </span>
    </div>
    <form className="relative mt-1.5" onSubmit={submit} role="search">
      <Search aria-hidden="true" className="absolute left-2 top-2 size-3.5 text-sophon-copy-metadata" />
      <input aria-label="Filter ONNX leaderboard models" className="h-8 w-full rounded-md border border-sophon-glass-border bg-sophon-panel pl-7 pr-2 text-xs text-sophon-copy-primary outline-none focus:border-sophon-signal-bright" disabled={disabled} onChange={(event) => {
        const value = event.target.value;
        setQuery(value);
        setResults([]);
        setStatus(null);
      }} placeholder="Filter leaderboard…" value={query} />
    </form>
    {status ? <p className="mt-2 text-xs leading-4 text-sophon-copy-metadata" role="status">{status}</p> : null}
    {results.length > 0 ? <p className="mt-2 text-[10px] font-medium uppercase leading-4 tracking-[0.07em] text-sophon-copy-metadata">{query.trim() ? "Matching models" : "Top models"}</p> : null}
    <div className="mt-1 space-y-1">
      {results.map((model, index) => <button className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border border-sophon-glass-border bg-sophon-panel px-2 py-1.5 text-left hover:border-sophon-signal-bright/60 disabled:opacity-60" disabled={disabled || busyRepo !== null || !model.revision} key={model.repo} onClick={() => void addModel(model)} type="button">
        <span aria-label={`Rank ${index + 1}`} className="sophon-type-status font-mono text-[10px] font-semibold tabular-nums text-sophon-signal-soft">#{index + 1}</span>
        <span className="min-w-0"><span className="block truncate text-xs font-medium leading-4 text-sophon-copy-primary">{model.name}</span><span className="block truncate text-[10px] leading-4 text-sophon-copy-metadata">{model.downloads.toLocaleString()} downloads{model.license ? ` · ${model.license}` : ""}</span></span>
        {busyRepo === model.repo ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" /> : <Download aria-hidden="true" className="size-3.5 shrink-0" />}
      </button>)}
    </div>
  </section>;
}

function formatContext(tokens: number | null) {
  return tokens === null ? "Context varies" : `${Math.round(tokens / 1024)}K context`;
}
