"use client";

import { type KeyboardEvent, lazy, memo, type ReactNode, Suspense, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { groupTokenPieces, type ContextTokenPiece, type TokenWord } from "@/lib/token-display";
import { cn } from "@/lib/utils";

const MarkdownContent = lazy(() => import("@/components/markdown-content"));
const markdownSyntax = /(?:^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+[.)]\s|```|~~~|(?:-{3,}|\*{3,}|_{3,})\s*(?:\n|$))|(?:\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~)|(?:^|\n)\s*\|.+\|\s*(?:\n|$)/m;
export type InspectableToken = ContextTokenPiece;

export type TokenInspectMode = "tokens" | "words";
type TokenSelection =
  | { kind: "token"; index: number; token: InspectableToken }
  | { kind: "word"; index: number; word: TokenWord }
  | null;

type InspectableSegment = {
  active: boolean;
  ariaLabel: string;
  key: string;
  selection: Exclude<TokenSelection, null>;
  text: string;
  tokenId?: number;
};

type InspectableMessageProps = {
  actions?: ReactNode;
  content: string;
  developerMode?: boolean;
  inspectMode?: TokenInspectMode | null;
  meta?: string;
  onInspectHover?: (metrics: string | undefined) => void;
  role: "user" | "assistant";
  showMeta?: boolean;
  tokens?: InspectableToken[];
};

export const InspectableMessage = memo(function InspectableMessage({ actions, content, developerMode = false, inspectMode = null, meta, onInspectHover, role, showMeta = false, tokens = [] }: InspectableMessageProps) {
  const mode = inspectMode ?? "tokens";
  const [selection, setSelection] = useState<TokenSelection>(null);
  const words = useMemo(() => mode === "words" ? groupTokenPieces(tokens) : [], [mode, tokens]);
  const segments = useMemo<InspectableSegment[]>(() => {
    if (mode === "tokens") {
      return tokens.map((token, index) => ({
        active: token.inContext !== false,
        ariaLabel: `Token ${index + 1}, ID ${token.id}: ${describeToken(token.text)}${token.inContext === false ? ", outside context" : ""}`,
        key: `${index}-${token.id}`,
        selection: { kind: "token", index, token },
        text: token.text,
        tokenId: token.id
      }));
    }
    if (mode === "words") {
      return words.map((word, index) => ({
        active: word.inContext,
        ariaLabel: `Word segment ${index + 1}, ${describeTokenRange(word.tokenIndexes)}: ${describeToken(word.text)}${word.inContext ? "" : ", outside context"}`,
        key: `${index}-${word.tokenIds.join("-")}`,
        selection: { kind: "word", index, word },
        text: word.text
      }));
    }
    return [];
  }, [mode, tokens, words]);
  const hasTokens = tokens.length > 0;
  const visibleMeta = showMeta ? meta : undefined;

  return (
    <div className={cn("flex max-w-full flex-col gap-2", role === "user" ? "items-end" : "items-start")} data-message-role={role} onPointerEnter={developerMode && role === "assistant" ? () => onInspectHover?.(meta) : undefined} onPointerLeave={developerMode && role === "assistant" ? () => onInspectHover?.(undefined) : undefined}>
      <Card className={cn("w-fit max-w-[92%] self-start overflow-hidden rounded-xl border shadow-none", role === "user" ? "self-end sophon-accent-message border-sophon-signal-bright/55 font-medium" : "sophon-theme-elevation border-sophon-glass-border bg-sophon-panel text-sophon-copy-primary")}>
        <CardContent className="break-words p-4 text-sm leading-relaxed">
          {developerMode && inspectMode && hasTokens ? (
            <SegmentSequence key={mode} kind={mode} role={role} segments={segments} selection={selection} setSelection={setSelection} />
          ) : (
            <MarkdownMessage content={content} role={role} />
          )}
        </CardContent>
      </Card>

      {actions ? (
        <div className={cn("flex max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 px-1", role === "user" && "flex-row-reverse")}>
          {actions}
        </div>
      ) : null}

      {visibleMeta ? <div className={cn("flex max-w-full items-center gap-1.5 px-1", role === "user" && "justify-end")}>
        <span className={cn("min-w-0 max-w-full break-words text-xs text-sophon-copy-metadata", role === "user" && "text-right")}>{visibleMeta}</span>
        {developerMode && role === "assistant" && hasTokens ? <InfoHint concept="generationMetrics" /> : null}
      </div> : null}

      {developerMode && inspectMode && hasTokens ? (
        <TokenInspector role={role} selection={selection} tokenCount={tokens.length} />
      ) : null}
    </div>
  );
});

function MarkdownMessage({ content, role }: Pick<InspectableMessageProps, "content" | "role">) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-x-auto text-[15px] leading-6",
        "[&_a]:break-words [&_a]:font-semibold [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-4 [&_a:focus-visible]:rounded-sm [&_a:focus-visible]:outline-none [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-sophon-signal",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic",
        "[&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
        "[&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:font-semibold",
        "[&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t",
        "[&_li]:pl-1 [&_li]:marker:font-mono [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
        "[&_p]:my-3 [&_p]:whitespace-pre-wrap [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-5 [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit",
        "[&_table]:my-3 [&_table]:min-w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_th]:font-semibold",
        role === "user"
          ? "[&_a]:text-sophon-on-signal [&_blockquote]:border-sophon-on-signal/45 [&_code]:bg-sophon-on-signal/10 [&_code]:text-sophon-on-signal [&_hr]:border-sophon-on-signal/30 [&_li]:marker:text-sophon-on-signal/70 [&_pre]:border-sophon-on-signal/35 [&_pre]:bg-sophon-code-inverse/95 [&_pre]:text-sophon-code-inverse-copy [&_td]:border-sophon-on-signal/25 [&_th]:border-sophon-on-signal/35 [&_th]:bg-sophon-on-signal/10"
          : "[&_a]:text-sophon-signal-soft [&_blockquote]:border-sophon-signal-soft/60 [&_code]:bg-sophon-panel-deep [&_code]:text-sophon-signal-soft [&_hr]:border-sophon-glass-border [&_li]:marker:text-sophon-signal-soft [&_pre]:border-sophon-glass-border [&_pre]:bg-sophon-code-inverse [&_pre]:text-sophon-code-inverse-copy [&_td]:border-sophon-glass-border [&_th]:border-sophon-glass-border [&_th]:bg-sophon-panel-deep"
      )}
    >
      {markdownSyntax.test(content) ? (
        <Suspense fallback={<MarkdownLoading />}>
          <MarkdownContent content={content} />
        </Suspense>
      ) : <p>{content}</p>}
    </div>
  );
}

function MarkdownLoading() {
  return (
    <div
      aria-busy="true"
      className="w-[min(18rem,70vw)] max-w-full space-y-2 py-1 motion-safe:animate-pulse"
      role="status"
    >
      <span className="sr-only">Formatting response</span>
      <span aria-hidden="true" className="block h-3 w-2/3 rounded-full bg-sophon-panel-deep" />
      <span aria-hidden="true" className="block h-3 w-full rounded-full bg-sophon-panel-deep" />
      <span aria-hidden="true" className="block h-3 w-5/6 rounded-full bg-sophon-panel-deep" />
    </div>
  );
}

function SegmentSequence({ kind, role, segments, selection, setSelection }: {
  kind: TokenInspectMode;
  role: InspectableMessageProps["role"];
  segments: InspectableSegment[];
  selection: TokenSelection;
  setSelection: (selection: TokenSelection) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectSegment(index: number) {
    const segment = segments[index];
    if (!segment) return;
    setSelection(segment.selection);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = rovingIndex(event.key, index, segments.length);
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    selectSegment(nextIndex);
    segmentRefs.current[nextIndex]?.focus();
  }

  return (
    <span aria-label={`${segments.length} inspectable ${kind === "tokens" ? "token" : "word"} segments. Use arrow keys, Home, and End to navigate.`} aria-orientation="horizontal" className="whitespace-pre-wrap break-words" role="toolbar">
      {segments.map((segment, index) => {
        const selected = selection?.kind === segment.selection.kind && selection.index === index;
        return (
          <button
            aria-label={segment.ariaLabel}
            aria-pressed={selected}
            className={cn("inline-flex min-h-6 cursor-crosshair items-center whitespace-pre-wrap rounded-sm border-l border-dotted px-px py-0 font-inherit text-inherit transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal", role === "user" ? "border-sophon-on-signal/70" : "border-sophon-signal-bright", segmentClass(role, selected), !segment.active && "opacity-75")}
            data-context={segment.active ? "active" : "omitted"}
            data-token-id={segment.tokenId}
            key={segment.key}
            onClick={() => { setActiveIndex(index); selectSegment(index); }}
            onFocus={() => { setActiveIndex(index); selectSegment(index); }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onMouseEnter={() => setSelection(segment.selection)}
            ref={(node) => { segmentRefs.current[index] = node; }}
            tabIndex={activeIndex === index ? 0 : -1}
            type="button"
          >
            {segment.text || <span aria-hidden="true">∅</span>}
          </button>
        );
      })}
    </span>
  );
}

function TokenInspector({ role, selection, tokenCount }: {
  role: InspectableMessageProps["role"];
  selection: TokenSelection;
  tokenCount: number;
}) {
  const details = selectionDetails(selection, role);
  return (
    <div className="sophon-type-metadata flex max-w-full flex-wrap items-center gap-2 rounded-md border border-sophon-glass-border bg-sophon-panel-deep/90 px-2.5 py-2 font-mono uppercase tracking-[0.06em] text-sophon-copy-metadata" data-typography-role="metadata">
      {details ? (
        <>
          <span className="text-sophon-signal-soft">{details.index}</span>
          <span aria-hidden="true" className="text-sophon-copy-decorative">/</span>
          <span className="text-sophon-copy-body">{details.ids}</span>
          <span aria-hidden="true" className="text-sophon-copy-decorative">/</span>
          <span className="max-w-52 truncate normal-case tracking-normal text-sophon-copy-primary">“{details.text}”</span>
          <span aria-hidden="true" className="text-sophon-copy-decorative">/</span>
          <span className={details.active ? "text-sophon-verified" : "text-sophon-warning"}>{details.active ? "within context" : "outside context"}</span>
        </>
      ) : (
        <><span className="font-serif text-sm normal-case text-sophon-signal-soft">τ</span><span>Select a segment</span><span className="ml-auto tabular-nums text-sophon-copy-metadata">{tokenCount} tokens</span></>
      )}
    </div>
  );
}

function selectionDetails(selection: TokenSelection, role: InspectableMessageProps["role"]) {
  if (!selection) return null;
  if (selection.kind === "token") {
    return {
      index: `Token ${selection.index + 1}`,
      ids: `ID ${selection.token.id}`,
      text: describeToken(selection.token.text),
      active: role === "assistant" || selection.token.inContext !== false
    };
  }
  return {
    index: `Word ${selection.index + 1}`,
    ids: selection.word.tokenIds.length === 1 ? `ID ${selection.word.tokenIds[0]}` : `${selection.word.tokenIds.length} IDs`,
    text: describeToken(selection.word.text),
    active: role === "assistant" || selection.word.inContext
  };
}

function segmentClass(role: InspectableMessageProps["role"], selected: boolean) {
  if (role === "user") {
    return selected
      ? "bg-sophon-on-signal/15"
      : "hover:bg-sophon-on-signal/[.07]";
  }
  return selected
    ? "bg-sophon-signal-soft/15"
    : "hover:bg-sophon-signal/10";
}

function rovingIndex(key: string, index: number, count: number) {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  return null;
}

function describeTokenRange(indexes: number[]) {
  const firstIndex = indexes[0];
  if (firstIndex === undefined) return "no tokens";
  const lastIndex = indexes[indexes.length - 1] ?? firstIndex;
  const first = firstIndex + 1;
  const last = lastIndex + 1;
  return first === last ? `token ${first}` : `tokens ${first} through ${last}`;
}

function describeToken(text: string) {
  if (!text) return "empty token";
  return text.replaceAll(" ", "·").replaceAll("\n", "↵").replaceAll("\t", "⇥");
}
