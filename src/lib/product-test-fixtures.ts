import type { ModelCacheSummary, RuntimeCapabilities } from "@/lib/onnx-types";
import type { ModelManifest } from "@/lib/onnx-models";
import type {
  RuntimeActivity,
  WorkbenchMessage,
  WorkbenchSessionState
} from "@/lib/workbench-state";

const PRODUCT_TEST_QUERY_KEY = "sophon-product-test";
const PRODUCT_TEST_MODEL_QUERY_KEY = "sophon-product-model";
export const PRODUCT_TEST_MODEL_IDS = [
  "hf:fixture-alpha",
  "hf:fixture-beta",
  "hf:fixture-gamma",
  "hf:fixture-delta"
] as const;
export const PRODUCT_TEST_MODELS: readonly ModelManifest[] = PRODUCT_TEST_MODEL_IDS.map((id, index) => ({
  id,
  label: `Fixture ${String.fromCharCode(65 + index)}`,
  description: "Deterministic ONNX Community product-test model.",
  licenseLabel: "Test fixture",
  parameterLabel: "Fixture",
  verification: "experimental",
  source: {
    kind: "huggingface",
    repo: `onnx-community/glaux-fixture-${index + 1}`,
    revision: String(index + 1).repeat(40)
  },
  format: {
    quantization: "q4f16",
    sizeLabel: "2.19 GB",
    sizeBytes: 2_354_413_407,
    contextLength: 8192
  },
  runtime: { maxNewTokens: 128, mobileContextLength: 2048, mobileMaxNewTokens: 64 },
  providers: ["webgpu"]
}));
export const PRODUCT_TEST_STATES = [
  "checking",
  "legacy-cleanup",
  "legacy-cleanup-error",
  "confirmation",
  "replacement-confirmation",
  "replacement-deleting",
  "downloading",
  "paused",
  "verifying",
  "ready",
  "retry-success",
  "generating",
  "stopped",
  "error",
  "reset"
] as const;

export type ProductTestState = typeof PRODUCT_TEST_STATES[number];
export type ProductTestModelId = typeof PRODUCT_TEST_MODEL_IDS[number];

export type ProductTestMessage = WorkbenchMessage;

export type ProductTestSnapshot = Pick<WorkbenchSessionState,
  | "error"
  | "failedTurn"
  | "generation"
  | "loadedModelId"
  | "messages"
  | "modelId"
  | "modelLoadPaused"
  | "modelReplacementPhase"
  | "pendingModelDownloadId"
  | "prompt"
  | "resetConfirmationOpen"
> & {
  state: ProductTestState;
  startupCleanupStatus: "idle" | "cleaning" | "failed";
  capabilities: ProductTestCapabilities | null;
  browserStorage: { usage: number; quota: number; persistent: boolean } | undefined;
  cacheSummaries: ProductTestCacheSummary[];
  cacheInventoryResolved: boolean;
};

type ProductTestActivity = RuntimeActivity;
type ProductTestCapabilities = RuntimeCapabilities & { browserEngine: "chromium"; hardwareTier: "desktop" };
type ProductTestCacheSummary = ModelCacheSummary;

const MODEL_ID: ProductTestModelId = "hf:fixture-alpha";
const MODEL_BYTES = 2_354_413_407;
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const FIXTURE_CAPABILITIES: ProductTestCapabilities = {
  webgpu: true,
  wasm: true,
  crossOriginIsolated: false,
  browserEngine: "chromium",
  hardwareTier: "desktop",
  maxStorageBufferBindingSize: 1_073_741_824
};
const FIXTURE_STORAGE = {
  usage: 3.72 * GIB,
  quota: 20 * GIB,
  persistent: true
};
const USER_TOKENS: NonNullable<WorkbenchMessage["tokens"]> = [
  { id: 11_201, text: "Compare", inContext: false },
  { id: 318, text: " the", inContext: true },
  { id: 9_431, text: " options", inContext: true },
  { id: 29, text: " and", inContext: true },
  { id: 6_804, text: " recommend", inContext: true },
  { id: 37, text: " one.", inContext: true }
];
const ASSISTANT_TOKENS: NonNullable<WorkbenchMessage["tokens"]> = [
  { id: 4_102, text: "Here" },
  { id: 34, text: " is" },
  { id: 901, text: " a" },
  { id: 7_431, text: " concise" },
  { id: 2_210, text: " comparison" },
  { id: 17, text: "." }
];
const LONG_USER_PROMPT = "Compare several browser-compatible ONNX language models for a multilingual community help desk. Explain the trade-offs, recommend a default, and preserve enough detail to exercise wrapping in a narrow composer without sending anything off-device.";
const ASSISTANT_RESPONSE = `## Recommendation

Start with **Fixture A** for the deterministic test, then compare it with the other fixtures.

| Model | Best fit | Review note |
| --- | --- | --- |
| Fixture A | Primary test path | Safest default |
| Fixture B | Replacement flow | Validate switching |
| Fixture C | Alternate selection | Review catalog state |
| Fixture D | Alternate selection | Check narrow layouts |

\`\`\`text
local-only://review/this-intentionally-long-unbroken-sample-line-keeps-horizontal-content-contained-within-the-message-bubble
\`\`\`

The model files stay in browser storage. Review the [local data details](/privacy); prompts and responses remain in this page session.`;
const BASE_MESSAGES: ProductTestMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content: "Hi — I’m Glaux. Find a compatible ONNX Community model to download, then chat locally in this browser.",
    meta: "Open-source web tool · local inference · no server inference"
  },
  {
    id: "fixture-user-complete",
    role: "user",
    content: LONG_USER_PROMPT,
    tokens: USER_TOKENS
  },
  {
    id: "fixture-assistant-complete",
    role: "assistant",
    content: ASSISTANT_RESPONSE,
    tokens: ASSISTANT_TOKENS,
    meta: "WebGPU · 148/149 → 96 tokens · 8.4 tokens/s · first token 410 ms · 1 earlier token omitted"
  }
];
const PENDING_MESSAGE: ProductTestMessage = {
  id: "fixture-user-pending",
  role: "user",
  content: "Summarize that recommendation in French and keep the table.",
  tokens: [
    { id: 8_310, text: "Summarize", inContext: true },
    { id: 42, text: " that", inContext: true },
    { id: 9_105, text: " recommendation", inContext: true },
    { id: 71, text: " in French", inContext: true }
  ]
};

export const PRODUCT_TESTING_BUILD = isProductTestingBuild({
  nodeEnv: process.env.NODE_ENV,
  productTesting: process.env.NEXT_PUBLIC_GLAUX_PRODUCT_TESTING
});

export function isProductTestingBuild({
  nodeEnv,
  productTesting
}: {
  nodeEnv: string | undefined;
  productTesting: string | undefined;
}) {
  return nodeEnv === "development" && productTesting === "1";
}

export function parseProductTestState(value: string | null | undefined): ProductTestState | null {
  if (!value) return null;
  return PRODUCT_TEST_STATES.find((state) => state === value) ?? null;
}

export function parseProductTestModelId(value: string | null | undefined): ProductTestModelId | null {
  if (!value) return null;
  return PRODUCT_TEST_MODEL_IDS.find((modelId) => modelId === value) ?? null;
}

export function readProductTestState(search = typeof window === "undefined" ? "" : window.location.search) {
  if (!PRODUCT_TESTING_BUILD) return null;
  const requested = new URLSearchParams(search).get(PRODUCT_TEST_QUERY_KEY);
  return parseProductTestState(requested) ?? "checking";
}

export function readProductTestModelId(search = typeof window === "undefined" ? "" : window.location.search) {
  if (!PRODUCT_TESTING_BUILD) return null;
  const requested = new URLSearchParams(search).get(PRODUCT_TEST_MODEL_QUERY_KEY);
  return parseProductTestModelId(requested) ?? MODEL_ID;
}

export function createProductTestSnapshot(state: ProductTestState, activeModelId: ProductTestModelId = MODEL_ID): ProductTestSnapshot {
  const snapshot = baseSnapshot(state);

  if (state === "checking") {
    return {
      ...snapshot,
      capabilities: null,
      browserStorage: undefined,
      cacheInventoryResolved: false
    };
  }

  if (state === "legacy-cleanup" || state === "legacy-cleanup-error") {
    const legacyCaches = cacheSummaries("cached", MODEL_BYTES, MODEL_BYTES, MODEL_ID).map((summary) => (
      summary.modelId === "hf:fixture-beta"
        ? { ...summary, state: "cached" as const, resumableBytes: MODEL_BYTES, verifiedBytes: MODEL_BYTES }
        : summary
    ));
    return {
      ...snapshot,
      error: state === "legacy-cleanup-error"
        ? "The browser could not remove old model files from browser storage."
        : null,
      startupCleanupStatus: state === "legacy-cleanup-error" ? "failed" : "cleaning",
      modelReplacementPhase: state === "legacy-cleanup" ? "deleting" : null,
      cacheSummaries: legacyCaches,
      cacheInventoryResolved: false
    };
  }

  if (state === "confirmation") {
    return {
      ...snapshot,
      pendingModelDownloadId: activeModelId
    };
  }

  if (state === "replacement-confirmation" || state === "replacement-deleting") {
    return {
      ...snapshot,
      modelId: MODEL_ID,
      loadedModelId: MODEL_ID,
      messages: cloneMessages(BASE_MESSAGES),
      modelReplacementPhase: state === "replacement-deleting" ? "deleting" : null,
      pendingModelDownloadId: "hf:fixture-beta",
      cacheSummaries: cacheSummaries("cached", MODEL_BYTES, MODEL_BYTES, MODEL_ID)
    };
  }

  if (state === "downloading") {
    const loaded = 872 * MIB;
    return {
      ...snapshot,
      modelId: activeModelId,
      prompt: LONG_USER_PROMPT,
      generation: {
        status: "loading",
        activity: {
          label: "Downloading model",
          detail: "872 MB / 2.19 GB · 84.0 MB/s · 16s left",
          phase: "download",
          progress: {
            loaded,
            total: MODEL_BYTES,
            stage: "download",
            networkBytes: loaded,
            bytesPerSecond: 84 * MIB,
            etaMs: 16_000,
            elapsedMs: 11_000
          }
        }
      },
      cacheSummaries: cacheSummaries("partial", loaded, loaded, activeModelId)
    };
  }

  if (state === "paused") {
    const saved = 1_088 * MIB;
    return {
      ...snapshot,
      modelId: activeModelId,
      prompt: LONG_USER_PROMPT,
      modelLoadPaused: true,
      cacheSummaries: cacheSummaries("partial", saved, saved, activeModelId)
    };
  }

  if (state === "verifying") {
    return {
      ...snapshot,
      modelId: activeModelId,
      prompt: LONG_USER_PROMPT,
      generation: {
        status: "loading",
        activity: {
          label: "Verifying model",
          detail: "2.03 GB / 2.19 GB · 1.34 GB resumed · 2.19 GB transferred",
          phase: "download",
          progress: {
            loaded: Math.floor(MODEL_BYTES * 0.93),
            total: MODEL_BYTES,
            stage: "verify",
            resumedBytes: 1_440 * MIB,
            networkBytes: MODEL_BYTES
          }
        }
      },
      cacheSummaries: cacheSummaries("partial", MODEL_BYTES, Math.floor(MODEL_BYTES * 0.93), activeModelId)
    };
  }

  if (state === "ready" || state === "retry-success" || state === "reset") {
    return {
      ...snapshot,
      modelId: activeModelId,
      loadedModelId: activeModelId,
      messages: cloneMessages(BASE_MESSAGES),
      prompt: LONG_USER_PROMPT,
      resetConfirmationOpen: state === "reset",
      cacheSummaries: cacheSummaries("cached", MODEL_BYTES, MODEL_BYTES, activeModelId)
    };
  }

  if (state === "generating") {
    const messages = [...cloneMessages(BASE_MESSAGES), cloneMessage(PENDING_MESSAGE)];
    return {
      ...snapshot,
      modelId: activeModelId,
      loadedModelId: activeModelId,
      messages,
      generation: {
        status: "running",
        activity: {
          label: "Generating response",
          detail: "31 generated · 8.1 tokens/s",
          phase: "decode"
        },
        draft: "Voici la recommandation en bref : utilisez **Fixture A** comme modèle de test par défaut, puis",
        turn: {
          messageId: PENDING_MESSAGE.id,
          text: PENDING_MESSAGE.content
        }
      },
      cacheSummaries: cacheSummaries("cached", MODEL_BYTES, MODEL_BYTES, activeModelId)
    };
  }

  const reason = state === "stopped"
    ? "Generation stopped. Your message is ready to retry or edit."
    : "The local WebGPU session was interrupted. Retry to rebuild it without losing your message.";
  return {
    ...snapshot,
    modelId: activeModelId,
    loadedModelId: activeModelId,
    messages: [...cloneMessages(BASE_MESSAGES), cloneMessage(PENDING_MESSAGE)],
    error: reason,
    failedTurn: {
      messageId: PENDING_MESSAGE.id,
      reason,
      text: PENDING_MESSAGE.content
    },
    cacheSummaries: cacheSummaries("cached", MODEL_BYTES, MODEL_BYTES, activeModelId)
  };
}

export function createFixtureDownloadActivity(stage: "download" | "resume" = "download"): ProductTestActivity {
  const resumedBytes = stage === "resume" ? 1_088 * MIB : 0;
  const networkBytes = 352 * MIB;
  const loaded = resumedBytes + networkBytes;
  return {
    label: stage === "resume" ? "Resuming model" : "Downloading model",
    detail: stage === "resume"
      ? "1.41 GB / 2.19 GB · 1.06 GB resumed · 352 MB transferred · 72.0 MB/s · 11s left"
      : "352 MB / 2.19 GB · 72.0 MB/s · 27s left",
    phase: "download",
    progress: {
      loaded,
      total: MODEL_BYTES,
      stage,
      resumedBytes: resumedBytes || undefined,
      networkBytes,
      bytesPerSecond: 72 * MIB,
      etaMs: stage === "resume" ? 11_000 : 27_000,
      elapsedMs: 5_000
    }
  };
}

export function createFixtureGenerationActivity(): ProductTestActivity {
  return {
    label: "Generating response",
    detail: "18 generated · 8.2 tokens/s",
    phase: "decode"
  };
}

export function createFixtureAssistantDraft() {
  return "I’ll keep this local. **Fixture A** exercises the primary path; use another fixture to validate model switching.";
}

function baseSnapshot(state: ProductTestState): ProductTestSnapshot {
  return {
    state,
    messages: [cloneMessage(BASE_MESSAGES[0]!)],
    prompt: "",
    generation: { status: "idle" },
    error: null,
    failedTurn: null,
    loadedModelId: null,
    modelId: "",
    modelLoadPaused: false,
    modelReplacementPhase: null,
    startupCleanupStatus: "idle",
    pendingModelDownloadId: null,
    resetConfirmationOpen: false,
    capabilities: { ...FIXTURE_CAPABILITIES },
    browserStorage: { ...FIXTURE_STORAGE },
    cacheSummaries: cacheSummaries("missing", 0, 0),
    cacheInventoryResolved: true
  };
}

function cacheSummaries(
  globalState: ProductTestCacheSummary["state"],
  resumableBytes: number,
  verifiedBytes: number,
  activeModelId: ProductTestModelId = MODEL_ID
) {
  return PRODUCT_TEST_MODEL_IDS.map((modelId) => ({
    modelId,
    state: modelId === activeModelId ? globalState : "missing",
    resumableBytes: modelId === activeModelId ? resumableBytes : 0,
    verifiedBytes: modelId === activeModelId ? verifiedBytes : 0,
    totalBytes: MODEL_BYTES
  })) satisfies ProductTestCacheSummary[];
}

function cloneMessages(messages: ProductTestMessage[]) {
  return messages.map(cloneMessage);
}

function cloneMessage(message: ProductTestMessage): ProductTestMessage {
  return {
    ...message,
    tokens: message.tokens?.map((token) => ({ ...token }))
  };
}
