import type { SetStateAction } from "react";
import type { ModelReplacementPhase } from "@/lib/model-replacement";
import type { OnnxLogEvent } from "@/lib/onnx-types";
import type { ContextTokenPiece } from "@/lib/token-display";

export type WorkbenchMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: string;
  tokens?: ContextTokenPiece[];
};

export type RuntimeActivity = {
  detail?: string;
  label: string;
  phase: "download" | "runtime" | "tokenize" | "prefill" | "decode" | "complete";
  progress?: OnnxLogEvent["progress"];
};

export type FailedTurn = {
  messageId: string;
  reason: string;
  text: string;
};

export type GenerationState =
  | { status: "idle" }
  | { status: "loading"; activity: RuntimeActivity }
  | { status: "running"; activity: RuntimeActivity; draft: string; turn: Omit<FailedTurn, "reason"> };

export type WorkbenchSessionState = {
  messages: WorkbenchMessage[];
  prompt: string;
  generation: GenerationState;
  error: string | null;
  notice: string | null;
  failedTurn: FailedTurn | null;
  loadedModelId: string | null;
  modelId: string;
  modelLoadPaused: boolean;
  pendingModelDownloadId: string | null;
  pendingDeleteModelId: string | null;
  deletingModelId: string | null;
  modelReplacementPhase: ModelReplacementPhase | null;
  resetConfirmationOpen: boolean;
  autoRestoreEnabled: boolean;
};

export const STARTER_MESSAGES: WorkbenchMessage[] = [{
  id: "assistant-welcome",
  role: "assistant",
  content: "Hi — I’m Glaux. Find a compatible ONNX Community model to download, then chat locally in this browser.",
  meta: "Open-source web tool · local inference · no server inference"
}];

export const INITIAL_WORKBENCH_SESSION: WorkbenchSessionState = {
  messages: STARTER_MESSAGES,
  prompt: "",
  generation: { status: "idle" },
  error: null,
  notice: null,
  failedTurn: null,
  loadedModelId: null,
  modelId: "",
  modelLoadPaused: false,
  pendingModelDownloadId: null,
  pendingDeleteModelId: null,
  deletingModelId: null,
  modelReplacementPhase: null,
  resetConfirmationOpen: false,
  autoRestoreEnabled: true
};

type FieldAction = {
  [Field in keyof WorkbenchSessionState]: {
    type: "field/set";
    field: Field;
    value: SetStateAction<WorkbenchSessionState[Field]>;
  }
}[keyof WorkbenchSessionState];

export type WorkbenchSessionAction = FieldAction
  | { type: "conversation/reset" }
  | { type: "fixture/loaded"; session: Partial<WorkbenchSessionState> }
  | { type: "model/removed"; modelId: string }
  | { type: "model/selected"; modelId: string }
  | { type: "model/stopped" };

export function workbenchSessionReducer(
  state: WorkbenchSessionState,
  action: WorkbenchSessionAction
): WorkbenchSessionState {
  if (action.type === "field/set") {
    const current = state[action.field];
    const value = typeof action.value === "function"
      ? (action.value as (value: typeof current) => typeof current)(current)
      : action.value;
    return { ...state, [action.field]: value };
  }
  if (action.type === "conversation/reset") {
    return {
      ...state,
      messages: STARTER_MESSAGES,
      prompt: "",
      generation: { status: "idle" },
      error: null,
      notice: null,
      failedTurn: null
    };
  }
  if (action.type === "fixture/loaded") {
    return {
      ...INITIAL_WORKBENCH_SESSION,
      ...action.session,
      autoRestoreEnabled: false
    };
  }
  if (action.type === "model/selected") {
    return {
      ...state,
      messages: STARTER_MESSAGES,
      prompt: "",
      generation: { status: "idle" },
      error: null,
      notice: null,
      failedTurn: null,
      modelId: action.modelId,
      loadedModelId: null,
      modelLoadPaused: false,
      autoRestoreEnabled: true
    };
  }
  if (action.type === "model/stopped") {
    return {
      ...state,
      modelId: "",
      loadedModelId: null,
      modelLoadPaused: false,
      generation: { status: "idle" }
    };
  }
  if (action.type === "model/removed") {
    return action.modelId === state.modelId
      ? {
        ...workbenchSessionReducer(state, { type: "conversation/reset" }),
        modelId: "",
        loadedModelId: null,
        modelLoadPaused: false,
        pendingDeleteModelId: null
      }
      : { ...state, pendingDeleteModelId: null };
  }
  return state;
}
