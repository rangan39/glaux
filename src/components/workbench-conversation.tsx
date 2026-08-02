"use client";

import { memo } from "react";
import { Check, CircleUserRound, Copy, MoonStar, Pencil, RotateCcw } from "lucide-react";
import { InspectableMessage, type TokenInspectMode } from "@/components/token-lens";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkbenchMessage } from "@/lib/workbench-state";

export type { WorkbenchMessage } from "@/lib/workbench-state";

type ConversationMessagesProps = {
  copiedMessageId: string | null;
  developerMode: boolean;
  inspectDisplayMode: TokenInspectMode | null;
  isBusy: boolean;
  messages: readonly WorkbenchMessage[];
  onCopy: (message: WorkbenchMessage) => void;
  onEdit: (message: WorkbenchMessage, index: number) => void;
  onInspectHover: (metrics: string | undefined) => void;
  onRegenerate: (index: number) => void;
};

export function WorkbenchConversationMessages({ copiedMessageId, developerMode, inspectDisplayMode, isBusy, messages, onCopy, onEdit, onInspectHover, onRegenerate }: ConversationMessagesProps) {
  return messages.map((message, index) => (
    <ConversationMessage
      canEdit={!isBusy && message.role === "user" && message.id !== "assistant-welcome"}
      canRegenerate={!isBusy && message.role === "assistant" && index === messages.length - 1 && index > 0}
      copied={copiedMessageId === message.id}
      developerMode={developerMode}
      index={index}
      inspectDisplayMode={inspectDisplayMode}
      key={message.id}
      message={message}
      onCopy={onCopy}
      onEdit={onEdit}
      onInspectHover={onInspectHover}
      onRegenerate={onRegenerate}
    />
  ));
}

type ConversationMessageProps = {
  canEdit: boolean;
  canRegenerate: boolean;
  copied: boolean;
  developerMode: boolean;
  index: number;
  inspectDisplayMode: TokenInspectMode | null;
  message: WorkbenchMessage;
  onCopy: (message: WorkbenchMessage) => void;
  onEdit: (message: WorkbenchMessage, index: number) => void;
  onInspectHover: (metrics: string | undefined) => void;
  onRegenerate: (index: number) => void;
};

const ConversationMessage = memo(function ConversationMessage({ canEdit, canRegenerate, copied, developerMode, index, inspectDisplayMode, message, onCopy, onEdit, onInspectHover, onRegenerate }: ConversationMessageProps) {
  return (
    <article aria-label={message.role === "user" ? "Message from you" : "Message from Glaux"} className={cn("group/message relative flex w-full min-w-0 gap-3 text-sm", message.role === "user" && "flex-row-reverse")}>
      <div className={cn("flex size-8 shrink-0 items-center justify-center self-end overflow-hidden", message.role === "user" ? "glaux-accent-avatar !self-start mt-1 rounded-xl border border-glaux-signal-bright/50" : "glaux-glass-tile !self-start mt-1 rounded-xl text-glaux-signal-soft")}>
        {message.role === "user" ? <CircleUserRound aria-hidden="true" className="size-4" /> : <MoonStar aria-hidden="true" className="size-4" />}
      </div>
      <div className="flex w-full min-w-0 flex-col gap-2.5 max-w-[calc(100%_-_2.75rem)] sm:max-w-[min(920px,calc(100%_-_3rem))]">
        <InspectableMessage
          actions={<MessageActions canEdit={canEdit} canRegenerate={canRegenerate} copied={copied} onCopy={() => onCopy(message)} onEdit={() => onEdit(message, index)} onRegenerate={() => onRegenerate(index)} role={message.role} />}
          content={message.content}
          developerMode={developerMode}
          inspectMode={developerMode ? inspectDisplayMode : null}
          key={`${message.id}-${developerMode ? "developer" : "chat"}`}
          meta={message.meta}
          onInspectHover={onInspectHover}
          role={message.role}
          showMeta={developerMode || message.id === "assistant-welcome"}
          tokens={message.tokens}
        />
      </div>
    </article>
  );
}, (previous, next) => (
  previous.canEdit === next.canEdit
  && previous.canRegenerate === next.canRegenerate
  && previous.copied === next.copied
  && previous.developerMode === next.developerMode
  && previous.index === next.index
  && previous.inspectDisplayMode === next.inspectDisplayMode
  && previous.message === next.message
));

function MessageActions({ canEdit, canRegenerate, copied, onCopy, onEdit, onRegenerate, role }: {
  canEdit: boolean;
  canRegenerate: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  role: WorkbenchMessage["role"];
}) {
  return (
    <div className={cn("flex items-center gap-1 opacity-70 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100", role === "user" ? "self-end" : "self-start")}>
      <Button aria-label={copied ? "Copied message" : "Copy message"} className="size-11 rounded-xl text-glaux-copy-metadata sm:size-9" onClick={onCopy} size="icon" title={copied ? "Copied" : "Copy message"} type="button" variant="sophon">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      {canEdit ? <Button aria-label="Edit message" className="size-11 rounded-xl text-glaux-copy-metadata sm:size-9" onClick={onEdit} size="icon" title="Edit message" type="button" variant="sophon"><Pencil aria-hidden="true" /></Button> : null}
      {canRegenerate ? <Button aria-label="Regenerate response" className="size-11 rounded-xl text-glaux-copy-metadata sm:size-9" onClick={onRegenerate} size="icon" title="Regenerate response" type="button" variant="sophon"><RotateCcw aria-hidden="true" /></Button> : null}
    </div>
  );
}
