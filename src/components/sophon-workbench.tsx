"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Check, CircleUserRound, Code2, Copy, Download, Languages, LoaderCircle, LockKeyhole, MessageCircle, PanelLeft, Pencil, RotateCcw, SendHorizontal, Sparkles, Square, Trash2 } from "lucide-react";
import { ExternalLinkIndicator } from "@/components/external-link-indicator";
import { SophonAcknowledgements } from "@/components/sophon-acknowledgements";
import { SophonModelSidebar } from "@/components/sophon-model-sidebar";
import { InspectableMessage, type InspectableToken } from "@/components/token-lens";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import {
  cancelGeneration,
  cancelModelPreload,
  deleteCachedModel,
  getCachedModels,
  getCapabilities,
  preloadModel,
  runPrompt,
  terminateRuntimeWorker
} from "@/lib/interp-client";
import { getModelRuntimeProfile, MODEL_REGISTRY, RECOMMENDED_MODEL_ID, resolveModelProvider, type ModelManifest } from "@/lib/onnx-models";
import type { GenerationTelemetryEvent, ModelCacheSummary, OnnxLogEvent, RuntimeCapabilities } from "@/lib/onnx-types";
import {
  createFixtureAssistantDraft,
  createFixtureDownloadActivity,
  createFixtureGenerationActivity,
  createProductTestSnapshot,
  PRODUCT_TESTING_BUILD,
  readProductTestModelId,
  readProductTestState,
  type ProductTestModelId,
  type ProductTestState
} from "@/lib/product-test-fixtures";
import { cn } from "@/lib/utils";
import { PRIVACY_PATH, PROJECT_SUPPORT_URL } from "@/lib/trust-navigation";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: string;
  tokens?: InspectableToken[];
};
type RuntimeActivity = {
  detail?: string;
  label: string;
  phase: "download" | "runtime" | "tokenize" | "prefill" | "decode" | "complete";
  progress?: OnnxLogEvent["progress"];
};
type FailedTurn = {
  messageId: string;
  reason: string;
  text: string;
};
type InterfaceMode = "chat" | "developer";
type ModelTheme = "earth" | "fire" | "global" | "water";

type GenerationState =
  | { status: "idle" }
  | { status: "loading"; activity: RuntimeActivity }
  | { status: "running"; activity: RuntimeActivity; draft: string; turn: Omit<FailedTurn, "reason"> };
type BrowserStorage = StorageEstimate & { persistent: boolean };
const LAST_READY_MODEL_KEY = "sophon:last-ready-model";
const PROMPT_MAX_HEIGHT = 192;
const PROMPT_SHORTCUT_HELP = "Enter to send · Shift+Enter for a new line";
const MODEL_THEME_BY_ID: Record<string, ModelTheme> = {
  "tiny-aya-earth": "earth",
  "tiny-aya-fire": "fire",
  "tiny-aya-global": "global",
  "tiny-aya-water": "water"
};
const STARTER_MESSAGES: ChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content: "Hi — I’m Sophon. Choose a Tiny Aya model to download, then your prompts will run privately in this browser.",
    meta: "Cohere open weights · local by design · no server inference"
  }
];
export function SophonWorkbench() {
  const [productTestState, setProductTestState] = useState<ProductTestState | null | undefined>(
    PRODUCT_TESTING_BUILD ? undefined : null
  );
  const [productTestModelId, setProductTestModelId] = useState<ProductTestModelId | null | undefined>(
    PRODUCT_TESTING_BUILD ? undefined : null
  );
  const [messages, setMessages] = useState(STARTER_MESSAGES);
  const [prompt, setPrompt] = useState("");
  const [generation, setGeneration] = useState<GenerationState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>("chat");
  const [modelId, setModelId] = useState("");
  const [libraryModelId, setLibraryModelId] = useState("");
  const [modelSidebarOpen, setModelSidebarOpen] = useState(false);
  const [modelLoadPaused, setModelLoadPaused] = useState(false);
  const [pendingModelDownloadId, setPendingModelDownloadId] = useState<string | null>(null);
  const [pendingDeleteModelId, setPendingDeleteModelId] = useState<string | null>(null);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [browserStorage, setBrowserStorage] = useState<BrowserStorage | null>();
  const [cacheSummaries, setCacheSummaries] = useState<ModelCacheSummary[]>([]);
  const [cacheInventoryResolved, setCacheInventoryResolved] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [storageRevision, setStorageRevision] = useState(0);
  const [autoRestoreEnabled, setAutoRestoreEnabled] = useState(true);
  const generationIdRef = useRef(0);
  const modelDownloadFromMobileRef = useRef(false);
  const modelDownloadTriggerRef = useRef<HTMLElement | null>(null);
  const modelDeleteFromMobileRef = useRef(false);
  const modelDeleteTriggerRef = useRef<HTMLElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const isRunning = generation.status === "running";
  const isBusy = generation.status !== "idle";
  const runtimeActivity = generation.status === "idle" ? null : generation.activity;
  const isModelLoading = generation.status === "loading" || runtimeActivity?.phase === "download";
  const downloadProgress = isModelLoading ? runtimeActivity?.progress : undefined;
  const downloadPercent = downloadProgress
    ? Math.floor(downloadProgress.loaded / downloadProgress.total * 1_000) / 10
    : undefined;
  const downloadPercentLabel = formatDownloadPercent(downloadProgress);
  const downloadStatus = getDownloadStageLabel(downloadProgress?.stage, true);
  const isNetworkDownload = downloadProgress?.stage === "download" || downloadProgress?.stage === "resume";
  const selectedModel = MODEL_REGISTRY.find((model) => model.id === modelId) ?? null;
  const modelTheme = selectedModel ? MODEL_THEME_BY_ID[selectedModel.id] : undefined;
  const loadingModel = selectedModel;
  const modelLoadCancelLabel = isNetworkDownload ? "Pause model download" : "Cancel model loading";
  const modelLoadCancelText = isNetworkDownload ? "Pause" : "Cancel";
  const recommendedModel = MODEL_REGISTRY.find((model) => model.id === RECOMMENDED_MODEL_ID)!;
  const recommendedCache = cacheSummaries.find((model) => model.modelId === RECOMMENDED_MODEL_ID);
  const recommendedCompatibility = getModelCompatibility(capabilities, recommendedModel);
  const pendingModelDownload = MODEL_REGISTRY.find((model) => model.id === pendingModelDownloadId) ?? null;
  const pendingModelDownloadCache = cacheSummaries.find((model) => model.modelId === pendingModelDownloadId);
  const replacedModel = pendingModelDownload && selectedModel && pendingModelDownload.id !== selectedModel.id
    ? selectedModel
    : null;
  const pendingDeleteModel = MODEL_REGISTRY.find((model) => model.id === pendingDeleteModelId) ?? null;
  const pendingDeleteSummary = cacheSummaries.find((model) => model.modelId === pendingDeleteModelId);
  const pendingDeleteBytes = pendingDeleteSummary?.state === "partial" ? pendingDeleteSummary.resumableBytes : pendingDeleteSummary?.totalBytes;
  const modelCompatibility = getModelCompatibility(capabilities, selectedModel);
  const selectedRuntimeProfile = selectedModel
    ? getModelRuntimeProfile(selectedModel, capabilities?.hardwareTier ?? "desktop")
    : null;
  const modelReady = selectedModel !== null && loadedModelId === selectedModel.id;
  const developerMode = interfaceMode === "developer";
  const runtimeStatus = getRuntimeStatus(capabilities, selectedModel, loadedModelId, runtimeActivity, modelLoadPaused, failedTurn, error);
  const storageLabel = browserStorage === undefined ? "Checking…" : browserStorage === null ? "Unavailable" : `${formatStorageBytes(browserStorage.usage)} / ${formatStorageBytes(browserStorage.quota)} · ${browserStorage.persistent ? "Persistent" : "Best effort"}`;
  const promptDisabled = !modelReady || modelCompatibility !== "compatible";
  const canSend = modelReady && prompt.trim().length > 0 && !isBusy && modelCompatibility === "compatible";
  const canResetConversation = messages.length > STARTER_MESSAGES.length || prompt.length > 0 || error !== null || failedTurn !== null;
  const displayedMessages = messages.map((message) => message.id === "assistant-welcome"
    ? getWelcomeMessage(message, selectedModel, modelReady, isModelLoading, modelLoadPaused)
    : message);
  const promptPlaceholder = !selectedModel
    ? "Choose a model above to unlock chat..."
    : modelReady
      ? "Ask the local model anything..."
      : "Prompting unlocks when the model is ready...";
  const promptHelp = getPromptHelp({
    downloadPercent,
    isBusy,
    failedTurn,
    modelCompatibility,
    modelLoadPaused,
    modelReady,
    runtimeActivity
  });
  const blockingDialogOpen = resetConfirmationOpen
    || pendingModelDownload !== null
    || pendingDeleteModel !== null;

  useDocumentScrollLock(blockingDialogOpen);

  useEffect(() => {
    if (!PRODUCT_TESTING_BUILD) return;
    queueMicrotask(() => {
      const search = window.location.search;
      setProductTestModelId(readProductTestModelId(search));
      setProductTestState(readProductTestState(search));
    });
  }, []);

  useEffect(() => {
    if (!productTestState || !productTestModelId) return;
    const snapshot = createProductTestSnapshot(productTestState, productTestModelId);
    queueMicrotask(() => {
      generationIdRef.current += 1;
      terminateRuntimeWorker();
      setMessages(snapshot.messages);
      setPrompt(snapshot.prompt);
      setGeneration(snapshot.generation);
      setError(snapshot.error);
      setNotice(null);
      setFailedTurn(snapshot.failedTurn);
      setLoadedModelId(snapshot.loadedModelId);
      setCopiedMessageId(null);
      setModelId(snapshot.modelId);
      setLibraryModelId(snapshot.modelId);
      setModelSidebarOpen(false);
      setModelLoadPaused(snapshot.modelLoadPaused);
      setPendingModelDownloadId(snapshot.pendingModelDownloadId);
      setPendingDeleteModelId(null);
      setResetConfirmationOpen(snapshot.resetConfirmationOpen);
      setCapabilities(snapshot.capabilities);
      setBrowserStorage(snapshot.browserStorage);
      setCacheSummaries(snapshot.cacheSummaries);
      setCacheInventoryResolved(snapshot.cacheInventoryResolved);
      setDeletingModelId(null);
      setAutoRestoreEnabled(false);
    });
  }, [productTestModelId, productTestState]);

  useEffect(() => {
    if (productTestState !== null) return;
    let active = true;
    void getCapabilities()
      .then((nextCapabilities) => {
        if (active) setCapabilities(nextCapabilities);
      })
      .catch(() => {
        if (active) setCapabilities({ webgpu: false, wasm: false, crossOriginIsolated: false, browserEngine: "unknown", hardwareTier: "desktop", maxStorageBufferBindingSize: null });
      });
    return () => {
      active = false;
    };
  }, [productTestState]);

  useEffect(() => {
    if (productTestState !== null) return;
    let active = true;
    const manager = navigator.storage;
    const estimate = manager?.estimate ? manager.estimate() : Promise.resolve(null);
    void Promise.all([estimate, manager?.persisted?.() ?? false])
      .then(([storage, persistent]) => { if (active) setBrowserStorage(storage ? { ...storage, persistent } : null); })
      .catch(() => { if (active) setBrowserStorage(null); });
    return () => { active = false; };
  }, [productTestState, storageRevision]);

  useEffect(() => {
    if (productTestState !== null) return;
    let active = true;
    void getCachedModels()
      .then((models) => {
        if (!active) return;
        setCacheSummaries(models);
        const rememberedModelId = readRememberedModelId();
        const restorableModelId = models.some((model) => model.modelId === rememberedModelId && model.state === "cached")
          ? rememberedModelId
          : null;
        setModelId((current) => {
          if (current || !autoRestoreEnabled) return current;
          return restorableModelId ?? current;
        });
        if (autoRestoreEnabled && restorableModelId) setLibraryModelId((current) => current || restorableModelId);
        setCacheInventoryResolved(true);
      })
      .catch(() => {
        if (active) {
          setCacheSummaries([]);
          setCacheInventoryResolved(true);
        }
      });
    return () => { active = false; };
  }, [autoRestoreEnabled, productTestState, storageRevision]);

  useEffect(() => {
    if (productTestState !== null) return;
    if (!selectedModel || modelLoadPaused || !capabilities || !resolveModelProvider(selectedModel, capabilities)) return;
    const loadId = generationIdRef.current += 1;
    queueMicrotask(() => {
      if (generationIdRef.current === loadId) setGeneration({ status: "loading", activity: { detail: `${selectedModel.label} · ${selectedModel.format.sizeLabel}`, label: "Preparing local model", phase: "runtime" } });
    });
    void preloadModel(selectedModel.id, (event) => {
      if (generationIdRef.current === loadId) setGeneration((current) => current.status === "loading" ? { ...current, activity: activityFromLog(event) } : current);
    }).then(() => {
      if (generationIdRef.current === loadId) {
        setLoadedModelId(selectedModel.id);
        rememberReadyModelId(selectedModel.id);
      }
    }).catch((caught) => {
      if (generationIdRef.current === loadId) setError(caught instanceof Error ? caught.message : `${selectedModel.label} could not load.`);
    }).finally(() => {
      if (generationIdRef.current === loadId) {
        setGeneration({ status: "idle" });
        setStorageRevision((value) => value + 1);
      }
    });
    return () => {
      if (generationIdRef.current === loadId) generationIdRef.current += 1;
      void cancelModelPreload().catch(() => terminateRuntimeWorker());
    };
  }, [capabilities, modelLoadPaused, productTestState, selectedModel]);

  useEffect(() => {
    if (!selectedModel || blockingDialogOpen) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    messageEndRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [blockingDialogOpen, isRunning, messages, selectedModel]);

  useEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
  }, [prompt]);

  useEffect(() => () => {
    generationIdRef.current += 1;
    terminateRuntimeWorker();
  }, []);

  function requestResetConversation() {
    if (messages.length > STARTER_MESSAGES.length) {
      setResetConfirmationOpen(true);
      return;
    }
    resetConversation();
  }

  function closeResetConfirmation() {
    setResetConfirmationOpen(false);
    window.requestAnimationFrame(() => resetTriggerRef.current?.focus());
  }

  function resetConversation() {
    generationIdRef.current += 1;
    if (isRunning && !productTestState) {
      void cancelGeneration().catch(() => terminateRuntimeWorker());
    }
    clearConversationState();
    setResetConfirmationOpen(false);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function clearConversationState() {
    setMessages(STARTER_MESSAGES);
    setPrompt("");
    setError(null);
    setNotice(null);
    setFailedTurn(null);
    setGeneration({ status: "idle" });
  }

  function selectModel(nextModelId: string) {
    setLibraryModelId(nextModelId);
    if (nextModelId === modelId && !modelLoadPaused) return;
    if (!productTestState) {
      void navigator.storage?.persist?.()
        .then((persistent) => setBrowserStorage((current) => current ? { ...current, persistent } : current))
        .catch(() => undefined);
    }
    generationIdRef.current += 1;
    if (!productTestState) void cancelModelPreload().catch(() => terminateRuntimeWorker());
    setAutoRestoreEnabled(true);
    setModelLoadPaused(false);
    setModelId(nextModelId);
    setLoadedModelId(null);
    setError(null);
    setNotice(null);
    setFailedTurn(null);
    setGeneration({ status: "idle" });
  }

  function chooseLibraryModel(nextModelId: string) {
    const target = MODEL_REGISTRY.find((model) => model.id === nextModelId);
    if (!target) return;
    setLibraryModelId(nextModelId);
    const cache = cacheSummaries.find((model) => model.modelId === nextModelId);
    if (cache?.state === "cached") {
      if (modelSidebarOpen) setModelSidebarOpen(false);
      void replaceActiveModel(nextModelId);
    }
  }

  function requestModelDownload(nextModelId: string) {
    const target = MODEL_REGISTRY.find((model) => model.id === nextModelId);
    if (!target) return;
    setLibraryModelId(nextModelId);
    const cache = cacheSummaries.find((model) => model.modelId === nextModelId);
    if (cache?.state === "cached") {
      selectModel(nextModelId);
      if (modelSidebarOpen) setModelSidebarOpen(false);
      return;
    }
    modelDownloadTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modelDownloadFromMobileRef.current = modelSidebarOpen;
    setPendingModelDownloadId(nextModelId);
    if (modelSidebarOpen) setModelSidebarOpen(false);
  }

  function closeModelDownloadConfirmation() {
    setPendingModelDownloadId(null);
    if (modelDownloadFromMobileRef.current) {
      setModelSidebarOpen(true);
    } else {
      window.requestAnimationFrame(() => modelDownloadTriggerRef.current?.focus());
    }
  }

  async function confirmModelDownload() {
    if (!pendingModelDownloadId) return;
    const targetModelId = pendingModelDownloadId;
    setPendingModelDownloadId(null);
    if (!await replaceActiveModel(targetModelId)) return;
    if (productTestState) {
      const activity = createFixtureDownloadActivity();
      setGeneration({ status: "loading", activity });
      setCacheSummaries((current) => current.map((summary) => summary.modelId === targetModelId
        ? {
          ...summary,
          state: "partial",
          resumableBytes: activity.progress?.loaded ?? 0,
          verifiedBytes: activity.progress?.loaded ?? 0
        }
        : summary));
    }
  }

  async function replaceActiveModel(nextModelId: string) {
    if (nextModelId === modelId && !modelLoadPaused) return true;
    const previousModelId = modelId && modelId !== nextModelId ? modelId : null;
    clearConversationState();
    if (previousModelId && !(await deleteModelDownload(previousModelId))) return false;
    selectModel(nextModelId);
    return true;
  }

  function resumeModelLoad() {
    if (!selectedModel || !modelLoadPaused) return;
    setError(null);
    setNotice(null);
    setModelLoadPaused(false);
    if (productTestState) setGeneration({ status: "loading", activity: createFixtureDownloadActivity("resume") });
  }

  function cancelModelLoad() {
    const cancelledModel = selectedModel;
    const pausedNetworkDownload = isNetworkDownload;
    generationIdRef.current += 1;
    if (!productTestState) void cancelModelPreload().catch(() => terminateRuntimeWorker());
    setAutoRestoreEnabled(false);
    setModelLoadPaused(Boolean(cancelledModel));
    setLoadedModelId(null);
    setGeneration({ status: "idle" });
    setFailedTurn(null);
    setError(null);
    setNotice(cancelledModel
      ? pausedNetworkDownload
        ? `${cancelledModel.label} download paused. Sophon will check saved progress when you resume.`
        : `${cancelledModel.label} loading paused. Downloaded files remain available in this browser.`
      : pausedNetworkDownload ? "Model download paused." : "Model loading cancelled.");
    setStorageRevision((value) => value + 1);
  }

  function requestDeleteModelDownload(targetModelId: string) {
    if (!MODEL_REGISTRY.some((model) => model.id === targetModelId)) return;
    modelDeleteTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modelDeleteFromMobileRef.current = modelSidebarOpen;
    if (modelSidebarOpen) {
      setModelSidebarOpen(false);
      window.requestAnimationFrame(() => setPendingDeleteModelId(targetModelId));
    } else {
      setPendingDeleteModelId(targetModelId);
    }
  }

  function closeDeleteModelConfirmation() {
    setPendingDeleteModelId(null);
    if (modelDeleteFromMobileRef.current) {
      setModelSidebarOpen(true);
    } else {
      window.requestAnimationFrame(() => modelDeleteTriggerRef.current?.focus());
    }
  }

  async function confirmDeleteModelDownload() {
    if (!pendingDeleteModelId) return;
    await deleteModelDownload(pendingDeleteModelId);
    setPendingDeleteModelId(null);
    if (modelDeleteFromMobileRef.current) setModelSidebarOpen(true);
  }

  async function deleteModelDownload(targetModelId: string) {
    const target = MODEL_REGISTRY.find((model) => model.id === targetModelId);
    if (!target) return false;
    setDeletingModelId(targetModelId);
    setError(null);
    setNotice(null);
    if (targetModelId === modelId) {
      generationIdRef.current += 1;
      if (!productTestState) await cancelModelPreload().catch(() => terminateRuntimeWorker());
      setModelId("");
      setModelLoadPaused(false);
      setLoadedModelId(null);
      setGeneration({ status: "idle" });
    }
    if (productTestState) {
      setCacheSummaries((current) => current.map((summary) => summary.modelId === targetModelId
        ? { ...summary, state: "missing", resumableBytes: 0, verifiedBytes: 0 }
        : summary));
      setDeletingModelId(null);
      return true;
    }
    try {
      await deleteCachedModel(targetModelId);
      forgetRememberedModelId(targetModelId);
      const next = await getCachedModels();
      setCacheSummaries(next);
      setStorageRevision((value) => value + 1);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${target.label} could not be deleted.`);
      return false;
    } finally {
      setDeletingModelId(null);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  }

  async function submitPrompt(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || isBusy) return;

    if (!selectedModel) {
      setError("Choose a Tiny Aya model before sending a message.");
      return;
    }

    if (modelCompatibility !== "compatible") {
      setError(modelCompatibility === "probing"
        ? "Sophon is still checking this browser's GPU support."
        : `${selectedModel.label} needs browser GPU support, which is unavailable in this browser.`);
      return;
    }

    const generationId = generationIdRef.current += 1;
    const userMessageId = `user-${generationId}`;
    const nextMessages = [...messages, { id: userMessageId, role: "user" as const, content: text }];
    setPrompt("");
    setError(null);
    setFailedTurn(null);
    setMessages(nextMessages);
    await runGeneration({ conversation: nextMessages, generationId, model: selectedModel, text, userMessageId });
  }

  async function runGeneration({ conversation, generationId, model, text, userMessageId }: {
    conversation: ChatMessage[];
    generationId: number;
    model: ModelManifest;
    text: string;
    userMessageId: string;
  }) {
    const activeModelId = model.id;
    setGeneration({
      status: "running",
      draft: "",
      turn: { messageId: userMessageId, text },
      activity: {
        detail: loadedModelId === activeModelId ? "Preparing the conversation context" : `${model.label} · ${model.format.sizeLabel}`,
        label: loadedModelId === activeModelId ? "Preparing context" : "Preparing local model",
        phase: "runtime"
      }
    });

    if (productTestState) {
      setGeneration({
        status: "running",
        draft: createFixtureAssistantDraft(),
        turn: { messageId: userMessageId, text },
        activity: createFixtureGenerationActivity()
      });
      return;
    }

    const turns = conversation
      .filter((message) => message.id !== "assistant-welcome")
      .map(({ content, role }) => ({ content, role }));

    try {
      const response = await runPrompt(turns, {
        modelId: activeModelId,
        maxNewTokens: getModelRuntimeProfile(model, capabilities?.hardwareTier ?? "desktop").maxNewTokens,
        onLog: (event) => updateRuntimeFromLog(generationId, event),
        onTelemetry: (telemetry) => updateRuntimeFromTelemetry(generationId, telemetry),
        temperature: 0.8
      });
      if (generationIdRef.current !== generationId) return;
      if (!response.ok) {
        setError(response.message);
        setFailedTurn({ messageId: userMessageId, reason: response.message, text });
        return;
      }

      const metrics = response.result.metrics;
      const conversationWithTokens = conversation.map((message) => message.id === userMessageId
        ? { ...message, tokens: response.result.inputTokens }
        : message);
      setLoadedModelId(activeModelId);
      if (!response.result.generatedText.trim()) {
        const reason = "The model completed without returning visible text.";
        setMessages(conversationWithTokens);
        setError(reason);
        setFailedTurn({ messageId: userMessageId, reason, text });
        return;
      }
      setMessages([
        ...conversationWithTokens,
        {
          id: `assistant-${generationId}`,
          role: "assistant",
          content: response.result.generatedText,
          tokens: response.result.generatedTokens,
          meta: `${formatProvider(metrics.provider)} · ${metrics.contextTokenCount}${metrics.truncatedInputTokens ? `/${metrics.promptTokenCount}` : ""} → ${response.result.outputTokenCount} tokens · ${formatRate(metrics.decodeTokensPerSecond)} · first token ${formatDuration(metrics.ttftMs)}${metrics.truncatedInputTokens ? ` · ${metrics.truncatedInputTokens} earlier tokens omitted` : ""}`
        }
      ]);
    } catch (caught) {
      if (generationIdRef.current !== generationId) return;
      const reason = caught instanceof Error ? caught.message : "The local model could not run.";
      setError(reason);
      setFailedTurn({ messageId: userMessageId, reason, text });
    } finally {
      if (generationIdRef.current === generationId) {
        setGeneration({ status: "idle" });
      }
    }
  }

  function updateRuntimeFromLog(generationId: number, event: OnnxLogEvent) {
    if (generationIdRef.current !== generationId) return;
    setGeneration((current) => current.status === "running" ? { ...current, activity: activityFromLog(event) } : current);
  }

  function updateRuntimeFromTelemetry(generationId: number, telemetry: GenerationTelemetryEvent) {
    if (generationIdRef.current !== generationId) return;
    setGeneration((current) => current.status === "running"
      ? { ...current, activity: activityFromTelemetry(telemetry), draft: telemetry.generatedText ?? current.draft }
      : current);
  }

  function stopGeneration() {
    if (generation.status !== "running") return;
    const pendingTurn = generation.turn;

    generationIdRef.current += 1;
    if (!productTestState) {
      void cancelGeneration().catch(() => {
        terminateRuntimeWorker();
        setLoadedModelId(null);
      });
    }
    setGeneration({ status: "idle" });
    setError("Generation stopped. Your message is ready to retry or edit.");
    setFailedTurn({ ...pendingTurn, reason: "Generation stopped." });
  }

  function retryFailedTurn() {
    if (!failedTurn || !selectedModel || isBusy || modelCompatibility !== "compatible") return;
    const generationId = generationIdRef.current += 1;
    setError(null);
    setFailedTurn(null);
    void runGeneration({ conversation: messages, generationId, model: selectedModel, text: failedTurn.text, userMessageId: failedTurn.messageId });
  }

  function editFailedTurn() {
    if (!failedTurn || isBusy) return;
    const failedIndex = messages.findIndex((message) => message.id === failedTurn.messageId);
    setMessages(failedIndex >= 0 ? messages.slice(0, failedIndex) : messages);
    setPrompt(failedTurn.text);
    setError(null);
    setFailedTurn(null);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function editMessage(message: ChatMessage, index: number) {
    if (isBusy || message.role !== "user") return;
    setMessages(messages.slice(0, index));
    setPrompt(message.content);
    setError(null);
    setFailedTurn(null);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function regenerateLatest(assistantIndex: number) {
    if (!selectedModel || isBusy || modelCompatibility !== "compatible") return;
    const userIndex = messages.slice(0, assistantIndex).findLastIndex((message) => message.role === "user");
    const userMessage = messages[userIndex];
    if (!userMessage) return;
    const conversation = messages.slice(0, assistantIndex);
    const generationId = generationIdRef.current += 1;
    setMessages(conversation);
    setError(null);
    setFailedTurn(null);
    void runGeneration({ conversation, generationId, model: selectedModel, text: userMessage.content, userMessageId: userMessage.id });
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1600);
    } catch {
      setError("The message could not be copied to the clipboard.");
    }
  }

  return (
    <main className={cn("relative w-full bg-sophon-canvas text-foreground", selectedModel ? "h-svh overflow-hidden" : "min-h-svh")} data-inference={isBusy ? "active" : "idle"} data-model-theme={modelTheme} data-product-test-state={productTestState ?? undefined}>
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-45" />
      <div className={cn("relative flex w-full flex-col bg-transparent", selectedModel ? "h-svh" : "min-h-svh")}>
        <header className={cn("sophon-glass-strong relative z-20 shrink-0 items-center border-x-0 border-t-0", selectedModel ? "grid h-[calc(106px+env(safe-area-inset-top))] grid-cols-[minmax(0,1fr)_auto] grid-rows-[28px_44px] gap-x-2 gap-y-2 px-3 pb-[10px] pt-[calc(8px+env(safe-area-inset-top))] sm:h-[calc(120px+env(safe-area-inset-top))] sm:grid-rows-[40px_36px] sm:px-7 sm:pb-3 sm:pt-[calc(12px+env(safe-area-inset-top))] lg:flex lg:h-[calc(74px+env(safe-area-inset-top))] lg:justify-between lg:gap-0 lg:px-7 lg:pb-0 lg:pt-[env(safe-area-inset-top)]" : "flex h-[calc(106px+env(safe-area-inset-top))] justify-between px-3 pb-8 pt-[env(safe-area-inset-top)] sm:h-[calc(74px+env(safe-area-inset-top))] sm:px-7 sm:pb-0")} data-testid="workbench-header">
          <div className={cn("min-w-0 items-center gap-2 sm:flex sm:gap-3", selectedModel ? "hidden" : "flex")} data-testid="workbench-brand">
            <div className="sophon-accent-surface relative grid size-10 shrink-0 place-items-center rounded-xl border border-sophon-signal-bright/60">
              <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>
            </div>
            <div className={cn("min-w-0", selectedModel && "max-[359px]:hidden")}>
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-sm font-semibold tracking-[0.12em] text-sophon-copy-primary">SOPHON</h1>
                <span className="sophon-type-decorative hidden items-center rounded-md border border-sophon-signal-bright/40 bg-sophon-signal/10 px-2 py-0.5 font-mono font-medium uppercase tracking-[0.12em] text-sophon-signal-soft xl:inline-flex" data-typography-role="decorative">Local AI</span>
              </div>
              <p className="sophon-type-metadata hidden whitespace-nowrap font-mono uppercase tracking-[0.12em] text-sophon-copy-metadata xl:block" data-typography-role="metadata">Private AI in your browser</p>
            </div>
          </div>

          <div className={cn("sophon-glass-tile sophon-type-status flex min-w-0 items-center justify-center gap-2 rounded-full px-3 py-1 font-mono uppercase tracking-[0.08em] sm:py-1.5", selectedModel ? "col-span-2 sm:col-span-1 sm:justify-self-end lg:static lg:inset-auto lg:shrink-0" : "absolute inset-x-3 bottom-2 sm:static sm:inset-auto sm:shrink-0", runtimeStatus.className)} data-testid="workbench-status" data-typography-role="status">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", runtimeStatus.dotClassName)} />
            <span className="truncate">{runtimeStatus.label}{downloadPercentLabel ? ` · ${downloadPercentLabel}` : null}</span>
          </div>

          <div className={cn("items-center", selectedModel ? "col-span-2 grid w-full grid-flow-col auto-cols-fr gap-1 [&_button]:gap-1 max-[399px]:[&_svg]:hidden sm:gap-2 lg:col-span-1 lg:flex lg:w-auto lg:shrink-0 lg:gap-3 lg:[&_button]:gap-2" : "flex shrink-0 gap-1.5 sm:gap-3")} data-testid="workbench-actions">
            {generation.status === "loading" ? <Button aria-label={modelLoadCancelLabel} className="h-11 min-w-0 rounded-xl px-1.5 text-[11px] sm:h-9 sm:px-3 sm:text-xs" onClick={cancelModelLoad} size="sm" title={modelLoadCancelLabel} type="button" variant="sophon"><Square aria-hidden="true" className="size-3 fill-current" /><span>{modelLoadCancelText}</span></Button> : null}
            {modelLoadPaused && selectedModel ? <Button aria-label="Resume model download" className="h-11 min-w-0 rounded-xl px-1.5 text-[11px] sm:h-9 sm:px-3 sm:text-xs" onClick={resumeModelLoad} size="sm" title="Resume model download" type="button" variant="sophon"><Download aria-hidden="true" /><span>Resume</span></Button> : null}
            {canResetConversation && !isBusy ? (
              <Button aria-label="Reset conversation" className="h-11 min-w-0 rounded-xl px-1.5 text-[11px] text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive sm:h-9 sm:px-3 sm:text-xs" disabled={isBusy} onClick={requestResetConversation} ref={resetTriggerRef} size="sm" title="Reset conversation" type="button" variant="sophon">
                <Trash2 aria-hidden="true" />
                <span>Reset</span>
              </Button>
            ) : null}
            {selectedModel ? (
              <Button
                aria-label={`Switch to ${developerMode ? "chat" : "developer"} mode. ${developerMode ? "Developer" : "Chat"} mode is active`}
                className="h-11 min-w-0 rounded-xl px-1.5 text-[11px] sm:h-9 sm:px-3 sm:text-xs"
                data-mode={interfaceMode}
                data-testid="interface-mode-toggle"
                onClick={() => setInterfaceMode(developerMode ? "chat" : "developer")}
                title={`Switch to ${developerMode ? "Chat" : "Developer"} mode`}
                type="button"
                variant="sophon"
              >
                {developerMode ? <MessageCircle aria-hidden="true" /> : <Code2 aria-hidden="true" />}
                <span>{developerMode ? "Chat" : "Developer"}</span>
              </Button>
            ) : null}
            <SophonAcknowledgements className="h-11 min-w-0 px-1.5 text-[11px] sm:h-9 sm:min-h-0 sm:px-3 sm:text-xs" compact label="About" />
            <Button aria-controls="model-library-mobile" aria-expanded={modelSidebarOpen} aria-label="Open model library" className="h-11 min-w-0 rounded-xl px-1.5 text-[11px] sm:h-9 sm:px-3 sm:text-xs lg:hidden" data-testid="open-model-library" onClick={() => setModelSidebarOpen(true)} size="sm" type="button" variant="sophon"><PanelLeft aria-hidden="true" /><span>Models</span></Button>
          </div>
          {isModelLoading && loadingModel ? <span aria-label={`Loading ${loadingModel.label}`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={downloadPercent} aria-valuetext={downloadProgress ? formatDownloadAriaText(downloadProgress) : "Preparing model delivery"} className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-sophon-panel-deep" role="progressbar"><span className={cn("block h-full bg-gradient-to-r from-sophon-signal to-sophon-signal-bright shadow-[0_0_12px_var(--sophon-signal-bright)] transition-[width] duration-200 motion-reduce:transition-none", downloadPercent === undefined && "w-1/3 animate-pulse motion-reduce:animate-none")} style={downloadPercent === undefined ? undefined : { width: `${downloadPercent}%` }} /></span> : null}
        </header>

        <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">{runtimeStatus.label}</div>

        <div className={cn("flex flex-1", selectedModel ? "min-h-0" : "min-h-fit")}>
          <SophonModelSidebar activeModelId={modelId} cacheSummaries={cacheSummaries} capabilities={capabilities} deletingModelId={deletingModelId} disabled={isRunning} downloadPercent={downloadPercent} downloadPercentLabel={downloadPercentLabel} loadedModelId={loadedModelId} loading={isModelLoading} loadingLabel={downloadStatus} mobileOpen={modelSidebarOpen} modelId={libraryModelId} onDelete={requestDeleteModelDownload} onDownload={requestModelDownload} onMobileOpenChange={setModelSidebarOpen} onSelect={chooseLibraryModel} recommendedModelId={RECOMMENDED_MODEL_ID} />
          <section aria-busy={isBusy} aria-label="Conversation" className={cn("relative flex min-w-0 flex-1 flex-col", selectedModel && "h-full min-h-0")}>
            <div className={cn("flex-1", selectedModel ? "min-h-0 overflow-y-auto overscroll-contain" : "overflow-visible")} data-testid="conversation-scroll">
              <div className="mx-auto flex min-w-0 w-full max-w-6xl flex-col px-4 py-6 sm:px-12 sm:py-9">
                <div aria-live={isRunning ? "off" : "polite"} aria-relevant="additions text" className="min-w-0 space-y-6" role="log">
                  {!selectedModel ? (
                    cacheInventoryResolved ? (
                      <FirstRunWelcome
                        cacheState={recommendedCache?.state}
                        compatibility={recommendedCompatibility}
                        model={recommendedModel}
                        mobileProfile={capabilities?.hardwareTier === "mobile"}
                        notice={notice}
                        onDismissNotice={() => setNotice(null)}
                        onOpenModels={() => setModelSidebarOpen(true)}
                        onSelectRecommended={() => requestModelDownload(RECOMMENDED_MODEL_ID)}
                      />
                    ) : (
                      <FirstRunCheck />
                    )
                  ) : displayedMessages.map((message, index) => (
                    <Message align={message.role === "user" ? "end" : "start"} aria-label={message.role === "user" ? "Message from you" : "Message from Sophon"} key={message.id} role="article">
                      <MessageAvatar className={message.role === "user" ? "sophon-accent-avatar !self-start mt-1 rounded-xl border border-sophon-signal-bright/50" : "sophon-glass-tile !self-start mt-1 rounded-xl text-sophon-signal-soft"}>
                        {message.role === "user" ? <CircleUserRound aria-hidden="true" className="size-4" /> : <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>}
                      </MessageAvatar>
                      <MessageContent className="w-full max-w-[calc(100%_-_2.75rem)] sm:max-w-[min(920px,calc(100%_-_3rem))]">
                        <InspectableMessage
                          content={message.content}
                          developerMode={developerMode}
                          key={`${message.id}-${interfaceMode}`}
                          meta={message.meta}
                          role={message.role}
                          showMeta={developerMode || message.id === "assistant-welcome"}
                          tokens={message.tokens}
                        />
                        <MessageActions
                          canEdit={!isBusy && message.role === "user" && message.id !== "assistant-welcome"}
                          canRegenerate={!isBusy && message.role === "assistant" && index === messages.length - 1 && index > 0}
                          copied={copiedMessageId === message.id}
                          onCopy={() => void copyMessage(message)}
                          onEdit={() => editMessage(message, index)}
                          onRegenerate={() => regenerateLatest(index)}
                          role={message.role}
                        />
                      </MessageContent>
                    </Message>
                  ))}
                  {isRunning ? (
                    <Message aria-label={generation.draft.trim() ? "Sophon is responding" : `Sophon status: ${runtimeActivity?.label ?? "Generating response"}`} aria-live="off" role="article">
                      <MessageAvatar className="sophon-glass-tile !self-start mt-1 rounded-xl text-sophon-signal-soft"><GreekGlyph className="animate-pulse text-lg font-semibold motion-reduce:animate-none">Σ</GreekGlyph></MessageAvatar>
                      <MessageContent className="w-full max-w-[calc(100%_-_2.75rem)] sm:max-w-xl">
                        <Bubble className="w-full max-w-full" variant="muted">
                          {generation.draft.trim() ? (
                            <BubbleContent className="sophon-glass-tile block w-full overflow-hidden rounded-xl p-0">
                              <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-6 text-sophon-copy-primary">
                                {generation.draft}<span aria-hidden="true" className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-sophon-signal-soft align-text-bottom motion-reduce:animate-none" />
                              </p>
                              <span className="flex items-center gap-2 border-t border-sophon-glass-border bg-sophon-panel-deep px-3 py-2">
                                <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-sophon-signal-soft motion-reduce:animate-none" />
                                <span className="sophon-type-status min-w-0 flex-1 truncate font-mono uppercase tracking-[0.08em] text-sophon-copy-metadata" data-typography-role="status">{runtimeActivity?.label ?? "Generating response"}</span>
                                <Button aria-label="Stop generation" className="shrink-0" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                                  <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                                </Button>
                              </span>
                            </BubbleContent>
                          ) : (
                            <BubbleContent className="sophon-glass-tile flex w-full items-center gap-3 rounded-xl px-4 py-3">
                              <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-sophon-signal-soft motion-reduce:animate-none" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-sophon-copy-primary">{runtimeActivity?.label ?? "Generating response"}</span>
                                {runtimeActivity?.detail ? <span className="sophon-type-metadata mt-0.5 block truncate text-sophon-copy-metadata" data-typography-role="metadata">{runtimeActivity.detail}</span> : null}
                              </span>
                              <Button aria-label="Stop generation" className="shrink-0" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                                <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                              </Button>
                            </BubbleContent>
                          )}
                        </Bubble>
                      </MessageContent>
                    </Message>
                  ) : null}
                  <div aria-hidden="true" ref={messageEndRef} />
                </div>
              </div>
            </div>

            {selectedModel ? (
              <div className="sophon-glass-strong z-10 shrink-0 border-x-0 border-b-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]" data-testid="composer-panel">
              <form className="mx-auto max-w-6xl" onSubmit={submitPrompt}>
                {modelLoadPaused && selectedModel ? (
                  <div className="sophon-glass-tile mb-2 flex items-center gap-2 rounded-xl border-sophon-warning/30 px-3 py-2 text-sm text-sophon-copy-body sm:mb-3 sm:gap-3 sm:px-4 sm:py-3" role="status">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-5 text-sophon-copy-primary">Model download paused</span>
                      <span className="sophon-type-metadata mt-0.5 hidden text-sophon-copy-metadata sm:block" data-typography-role="metadata">Resume to finish downloading {selectedModel.format.sizeLabel} before you can write or send a prompt.</span>
                      <span className="sr-only sm:hidden">Resume to finish downloading {selectedModel.format.sizeLabel} before you can write or send a prompt.</span>
                    </span>
                    <Button aria-label="Resume download" className="h-11 shrink-0 rounded-xl px-3 sm:h-9" onClick={resumeModelLoad} type="button" variant="sophon"><Download aria-hidden="true" /><span className="sm:hidden">Resume</span><span className="hidden sm:inline">Resume download</span></Button>
                  </div>
                ) : failedTurn ? (
                  <div className="sophon-glass-tile mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl border-destructive/35 px-3 py-2 text-sm text-destructive sm:mb-3 sm:flex sm:gap-3 sm:px-4 sm:py-3" id="prompt-error" role="alert">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-5">{getFailedTurnStatus(failedTurn)}</span>
                      <span className="hidden sm:mt-0.5 sm:block">{failedTurn.reason}</span>
                    </span>
                    <span className="flex shrink-0 gap-1.5 sm:gap-2">
                      <Button className="h-11 rounded-xl px-2.5 sm:h-8" disabled={modelCompatibility !== "compatible"} onClick={retryFailedTurn} size="sm" type="button" variant="sophon"><RotateCcw aria-hidden="true" /> Retry</Button>
                      <Button className="h-11 rounded-xl px-2.5 sm:h-8" onClick={editFailedTurn} size="sm" type="button" variant="sophon"><Pencil aria-hidden="true" /> Edit</Button>
                    </span>
                    <span className="sophon-type-metadata col-span-2 block leading-4 sm:hidden" data-testid="failed-turn-mobile-reason" data-typography-role="metadata">
                      {failedTurn.reason}
                    </span>
                  </div>
                ) : error ? (
                  <div className="sophon-glass-tile mb-3 rounded-xl border-destructive/35 px-4 py-3 text-sm text-destructive" id="prompt-error" role="alert">{error}</div>
                ) : notice ? (
                  <div className="sophon-glass-tile mb-3 flex flex-col gap-3 rounded-xl border-sophon-glass-border px-4 py-3 text-sm text-sophon-copy-body sm:flex-row sm:items-center" role="status">
                    <span className="min-w-0 flex-1">{notice}</span>
                    <Button className="h-11 self-start rounded-xl sm:h-8 sm:self-auto" onClick={() => setNotice(null)} size="sm" type="button" variant="sophon">Dismiss</Button>
                  </div>
                ) : null}
                <label className="sr-only" htmlFor="sophon-prompt">Message Sophon</label>
                <div className="sophon-glass-tile sophon-glass-interactive relative overflow-hidden rounded-2xl">
                  <textarea
                    aria-describedby="prompt-help"
                    className="flex min-h-24 max-h-[7.5rem] w-full resize-none overflow-y-auto rounded-md border-0 bg-transparent px-3 py-2 pr-14 text-[15px] leading-6 text-sophon-copy-primary shadow-none placeholder:text-sophon-copy-decorative focus-visible:outline-none disabled:cursor-not-allowed disabled:text-sophon-copy-disabled sm:max-h-48"
                    id="sophon-prompt"
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={promptPlaceholder}
                    ref={promptRef}
                    disabled={promptDisabled}
                    value={prompt}
                  />
                  <div className="flex items-center justify-between border-t border-sophon-glass-border bg-sophon-panel-deep px-3 py-2">
                    <span className="sophon-type-metadata truncate pr-3 font-mono uppercase tracking-[0.08em] text-sophon-copy-metadata" data-typography-role="metadata">
                      {selectedModel ? `${selectedModel.family} · ${formatQuantization(selectedModel.format.quantization)} · ${selectedModel.format.sizeLabel} · ${formatContextBudget(selectedRuntimeProfile?.contextLength ?? null)}` : "Choose a model above to unlock chat"}
                    </span>
                    {isRunning ? (
                      <Button aria-label="Stop generation" className="h-10 shrink-0 rounded-xl" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                        <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                      </Button>
                    ) : (
                      <Button aria-label="Send message" className="sophon-accent-surface relative size-10 shrink-0 rounded-xl after:absolute after:-inset-1 after:content-['']" disabled={!canSend} size="icon" type="submit">
                        <SendHorizontal aria-hidden="true" className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <footer className="sophon-type-metadata mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-1 font-mono uppercase tracking-[0.06em] text-sophon-copy-metadata min-[900px]:flex min-[900px]:gap-2" data-typography-role="metadata">
                  <span className={cn("min-w-0 whitespace-normal text-sophon-copy-body", modelCompatibility === "incompatible" && "text-destructive")} id="prompt-help">
                    {promptHelp === PROMPT_SHORTCUT_HELP ? (
                      <><span className="sm:hidden">Enter to send</span><span className="hidden sm:inline">{PROMPT_SHORTCUT_HELP}</span></>
                    ) : promptHelp}
                  </span>
                  <span className="shrink-0 tabular-nums">{prompt.length} {prompt.length === 1 ? "char" : "chars"}</span>
                  <div className="col-span-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-0.5 min-[900px]:col-auto min-[900px]:ml-auto">
                    <InfoHint className="-my-1" concept="browserStorage" />
                    <p className="min-w-0 whitespace-normal break-words min-[900px]:text-right" data-state={browserStorage === undefined ? "checking" : browserStorage === null ? "unavailable" : "ready"} data-testid="browser-storage">
                      Browser storage · <span className="tabular-nums text-sophon-copy-body">{storageLabel}</span>
                    </p>
                    <a className="sophon-type-action ml-2 shrink-0 text-sophon-copy-primary underline decoration-sophon-signal/30 underline-offset-4 hover:text-sophon-signal-soft" data-typography-role="action" href={PRIVACY_PATH}>Privacy</a>
                  </div>
                </footer>
              </form>
              </div>
            ) : null}
          </section>
        </div>
      </div>
      {resetConfirmationOpen ? (
        <ConfirmationDialog
          cancelLabel="Keep conversation"
          confirmLabel="Reset"
          description="Your messages will be removed. The downloaded model stays available in this browser."
          onCancel={closeResetConfirmation}
          onConfirm={resetConversation}
          title="Reset this conversation?"
        />
      ) : null}
      {pendingModelDownload ? (
        <ConfirmationDialog
          cancelLabel="Not now"
          confirmLabel={pendingModelDownloadCache?.state === "partial" ? "Resume download" : "Download model"}
          confirmTone="default"
          description={getModelDownloadDescription(pendingModelDownload, pendingModelDownloadCache, browserStorage, replacedModel)}
          onCancel={closeModelDownloadConfirmation}
          onConfirm={() => void confirmModelDownload()}
          title={`${pendingModelDownloadCache?.state === "partial" ? "Resume" : "Download"} ${pendingModelDownload.label.split(" · ")[0]}?`}
        />
      ) : null}
      {pendingDeleteModel ? (
        <ConfirmationDialog
          busy={deletingModelId === pendingDeleteModel.id}
          busyLabel="Deleting…"
          cancelLabel="Keep model"
          confirmLabel="Delete files"
          description={`The ${pendingDeleteBytes ? `${formatStorageBytes(pendingDeleteBytes)} ` : ""}saved model data for ${pendingDeleteModel.label.split(" · ")[0]} will be removed from this browser. You can download it again later.`}
          onCancel={closeDeleteModelConfirmation}
          onConfirm={() => void confirmDeleteModelDownload()}
          title="Delete downloaded model?"
        />
      ) : null}
    </main>
  );
}

function FirstRunCheck() {
  return (
    <div className="sophon-glass-tile mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl px-5 py-4" role="status">
      <LoaderCircle aria-hidden="true" className="size-5 shrink-0 animate-spin text-sophon-signal-soft motion-reduce:animate-none" />
      <span>
        <span className="block text-sm font-medium text-sophon-copy-primary">Checking this browser</span>
        <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">Looking for a model you have already downloaded…</span>
      </span>
    </div>
  );
}

function FirstRunWelcome({ cacheState, compatibility, mobileProfile, model, notice, onDismissNotice, onOpenModels, onSelectRecommended }: {
  cacheState?: ModelCacheSummary["state"];
  compatibility: ReturnType<typeof getModelCompatibility>;
  mobileProfile: boolean;
  model: ModelManifest;
  notice: string | null;
  onDismissNotice: () => void;
  onOpenModels: () => void;
  onSelectRecommended: () => void;
}) {
  const canStart = compatibility === "compatible";
  const modelName = model.label.split(" · ")[0];
  const primaryLabel = cacheState === "cached"
    ? `Use ${modelName}`
    : cacheState === "partial"
      ? "Continue model download"
      : "Download recommended model";
  const compactPrimaryLabel = cacheState === "cached"
    ? "Use model"
    : cacheState === "partial"
      ? "Continue download"
      : "Download model";

  return (
    <section aria-labelledby="first-run-title" className="mx-auto w-full max-w-3xl" data-testid="first-run-welcome">
      {notice ? (
        <div className="sophon-glass-tile mb-3 flex items-center gap-3 rounded-xl border-sophon-glass-border px-4 py-3 text-sm text-sophon-copy-body" role="status">
          <span className="min-w-0 flex-1">{notice}</span>
          <Button className="h-11 shrink-0 rounded-xl sm:h-8" onClick={onDismissNotice} size="sm" type="button" variant="sophon">Dismiss</Button>
        </div>
      ) : null}
      <div className="sophon-glass-strong overflow-hidden rounded-2xl">
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="sophon-type-decorative mb-2 flex items-center gap-1.5 font-mono font-semibold uppercase tracking-[0.12em] text-sophon-signal-soft" data-typography-role="decorative">
            <Sparkles aria-hidden="true" className="size-3.5" />
            Start here
          </div>
          <h2 className="max-w-2xl text-xl font-semibold tracking-tight text-sophon-copy-primary sm:text-2xl" id="first-run-title">Private AI, right in your browser</h2>
          <p className="sophon-type-body mt-2 max-w-2xl text-sophon-copy-body" data-typography-role="body">
            Choose one Cohere Tiny Aya model to run locally. No account is needed, and your prompts and responses are not sent to an inference server.
          </p>

          <div className="mt-4 rounded-xl border border-sophon-signal-bright/35 bg-sophon-signal/10 p-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3" data-testid="first-run-recommended">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg border border-sophon-signal-bright/40 bg-sophon-signal/10 text-sophon-signal-soft" data-testid="first-run-recommended-icon">
              <Languages className="size-4.5" />
            </span>
            <div className="mt-3 min-w-0 sm:mt-0" data-testid="first-run-recommended-details">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-sophon-copy-primary">{modelName}</h3>
                <span className="sophon-verified-emphasis sophon-type-status rounded-full border border-transparent bg-sophon-verified-bright px-2 py-0.5 font-mono uppercase tracking-[0.04em]" data-typography-role="status">{mobileProfile ? "Mobile mode" : "Recommended"}</span>
              </div>
              <p className="sophon-type-body mt-1 text-sophon-copy-body" data-typography-role="body">Best all-around choice for broad multilingual use.{mobileProfile ? " Sophon uses a 2K context and shorter responses on this device." : ""}</p>
            </div>
            <Button
              aria-label={compatibility === "probing" ? "Checking browser compatibility" : compatibility === "incompatible" ? "Browser GPU unavailable" : primaryLabel}
              className="sophon-accent-surface mt-3 min-h-11 h-auto w-full shrink-0 whitespace-normal rounded-lg px-4 py-2 text-center leading-5 sm:mt-0 sm:w-auto"
              data-testid="first-run-primary"
              disabled={!canStart}
              onClick={onSelectRecommended}
              type="button"
            >
              {compatibility === "probing" ? <><LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> Checking browser…</>
                : compatibility === "incompatible" ? "Browser GPU unavailable"
                  : <><Download aria-hidden="true" /><span className="min-[360px]:hidden">{compactPrimaryLabel}</span><span className="hidden min-[360px]:inline">{primaryLabel}</span></>}
            </Button>
          </div>
          {compatibility === "incompatible" ? (
            <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-5 text-destructive" role="alert">
              This device does not expose the browser GPU support required to run this model locally.
            </p>
          ) : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-xl border border-sophon-glass-border bg-sophon-glass-tile px-3 py-2">
              <span aria-hidden="true" className="sophon-verified-emphasis grid size-7 shrink-0 place-items-center rounded-lg bg-sophon-verified-bright">
                <LockKeyhole className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-sophon-copy-primary">Stays private</span>
                <span className="sophon-type-metadata text-sophon-copy-metadata" data-typography-role="metadata">Chats remain in this browser.</span>
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-sophon-glass-border bg-sophon-glass-tile px-3 py-2">
              <Download aria-hidden="true" className="size-4 shrink-0 text-sophon-signal-soft" />
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-sophon-copy-primary">Download once</span>
                <span className="sophon-type-metadata text-sophon-copy-metadata" data-typography-role="metadata">About {model.format.sizeLabel.replace("~", "")}, then reused on future visits.</span>
              </span>
            </div>
          </div>
          <div className="sophon-type-metadata mt-3 flex flex-col gap-2 border-t border-sophon-glass-border pt-3 text-sophon-copy-metadata sm:flex-row sm:items-center sm:justify-between" data-typography-role="metadata">
            <span>Open weights · {model.licenseLabel} · Downloads can be paused and resumed</span>
            <Button className="h-11 self-start rounded-lg px-2.5 sm:h-8 lg:hidden" onClick={onOpenModels} size="sm" type="button" variant="sophon">Compare all {MODEL_REGISTRY.length} models</Button>
            <span className="hidden items-center gap-3 lg:flex">More multilingual models are available in the library.</span>
          </div>
          <nav aria-label="First-run privacy, licensing, and support" className="mt-3 border-t border-sophon-glass-border pt-3 sm:flex sm:items-center sm:justify-between sm:gap-2" data-testid="first-run-trust-nav">
            <p className="sophon-type-decorative mb-2 shrink-0 font-mono font-semibold uppercase tracking-[0.1em] text-sophon-copy-decorative sm:mb-0" data-typography-role="decorative">Privacy, terms & support</p>
            <div className="flex flex-wrap gap-1.5">
              <a className="sophon-type-action inline-flex min-h-11 items-center rounded-lg border border-sophon-glass-border bg-sophon-glass-tile px-3 uppercase tracking-[0.06em] text-sophon-copy-primary transition-colors hover:border-sophon-signal-bright/55 hover:text-sophon-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal sm:min-h-9 sm:px-2" data-typography-role="action" href={PRIVACY_PATH}>Privacy</a>
              <SophonAcknowledgements className="rounded-lg sm:min-h-9 sm:px-2" compact label="About & licenses" />
              <a className="sophon-type-action inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-sophon-glass-border bg-sophon-glass-tile px-3 uppercase tracking-[0.06em] text-sophon-copy-primary transition-colors hover:border-sophon-signal-bright/55 hover:text-sophon-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal sm:min-h-9 sm:px-2" data-typography-role="action" href={PROJECT_SUPPORT_URL} rel="noreferrer" target="_blank">Support <ExternalLinkIndicator /></a>
            </div>
          </nav>
        </div>
      </div>
    </section>
  );
}

function ConfirmationDialog({ busy = false, busyLabel, cancelLabel, confirmLabel, confirmTone = "destructive", description, onCancel, onConfirm, title }: {
  busy?: boolean;
  busyLabel?: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmTone?: "default" | "destructive";
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const titleId = useId();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain bg-sophon-backdrop px-4 py-6 backdrop-blur-sm"
      onClick={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="sophon-glass-strong w-full max-w-sm rounded-2xl p-5 shadow-[0_24px_80px_var(--sophon-glass-shadow)]"
        onKeyDown={(event) => {
          if (!busy && event.key === "Escape") {
            onCancel();
          } else if (event.key === "Tab") {
            if (event.shiftKey && document.activeElement === cancelRef.current) {
              event.preventDefault();
              confirmRef.current?.focus();
            } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
              event.preventDefault();
              cancelRef.current?.focus();
            }
          }
        }}
        role="dialog"
      >
        <h2 className="text-base font-semibold text-sophon-copy-primary" id={titleId}>{title}</h2>
        <p className="sophon-type-body mt-2 text-sophon-copy-body" data-typography-role="body" id={descriptionId}>{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button className="h-11 rounded-xl sm:h-9" disabled={busy} onClick={onCancel} ref={cancelRef} type="button" variant="sophon">{cancelLabel}</Button>
          <Button className={cn("h-11 rounded-xl sm:h-9", confirmTone === "destructive" && "bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/85")} disabled={busy} onClick={onConfirm} ref={confirmRef} type="button">
            {busy ? busyLabel ?? confirmLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GreekGlyph({ children, className }: { children: string; className?: string }) {
  return <span aria-hidden="true" className={cn("font-serif text-base leading-none", className)}>{children}</span>;
}

function getWelcomeMessage(message: ChatMessage, model: ModelManifest | null, modelReady: boolean, isModelLoading: boolean, modelLoadPaused: boolean): ChatMessage {
  if (!model) return message;
  const modelName = model.label.split(" · ")[0];
  if (modelReady) {
    return {
      ...message,
      content: `${modelName} is ready. Ask anything — your prompt and response stay in this browser.`,
      meta: "WebGPU ready · local by design · no server inference"
    };
  }
  return {
    ...message,
    content: modelLoadPaused
      ? `${modelName} is selected and its download is paused. Resume to finish the download and unlock the prompt.`
      : isModelLoading
        ? `${modelName} is getting ready. The prompt will unlock after Sophon downloads and verifies it locally.`
        : `${modelName} is selected. The prompt will unlock as soon as it is ready to run privately.`,
    meta: "Browser storage · resumable download · no server inference"
  };
}

function getPromptHelp({
  downloadPercent,
  failedTurn,
  isBusy,
  modelCompatibility,
  modelLoadPaused,
  modelReady,
  runtimeActivity
}: {
  downloadPercent?: number;
  failedTurn: FailedTurn | null;
  isBusy: boolean;
  modelCompatibility: ReturnType<typeof getModelCompatibility>;
  modelLoadPaused: boolean;
  modelReady: boolean;
  runtimeActivity: RuntimeActivity | null;
}) {
  if (modelCompatibility === "unselected") return "Choose a model above to begin";
  if (modelCompatibility === "probing") return "Checking browser GPU…";
  if (modelCompatibility === "incompatible") return "Selected model needs browser GPU support";
  if (modelLoadPaused) return "Paused · resume to unlock prompt";
  if (failedTurn) return `${getFailedTurnStatus(failedTurn)} · retry or edit`;
  if (!modelReady) {
    const detail = runtimeActivity?.detail;
    const progress = detail ?? (downloadPercent === undefined ? "" : `${downloadPercent}%`);
    return `${runtimeActivity?.label ?? "Preparing local model"}${progress ? ` · ${progress}` : ""}`;
  }
  if (isBusy) return runtimeActivity?.label ?? "Running locally…";
  return PROMPT_SHORTCUT_HELP;
}

function readRememberedModelId() {
  try {
    return window.localStorage.getItem(LAST_READY_MODEL_KEY);
  } catch {
    return null;
  }
}

function rememberReadyModelId(modelId: string) {
  try {
    window.localStorage.setItem(LAST_READY_MODEL_KEY, modelId);
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

function forgetRememberedModelId(modelId: string) {
  try {
    if (window.localStorage.getItem(LAST_READY_MODEL_KEY) === modelId) {
      window.localStorage.removeItem(LAST_READY_MODEL_KEY);
    }
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

function MessageActions({ canEdit, canRegenerate, copied, onCopy, onEdit, onRegenerate, role }: {
  canEdit: boolean;
  canRegenerate: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  role: ChatMessage["role"];
}) {
  return (
    <div className={cn(
      "flex items-center gap-1 opacity-70 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100",
      role === "user" ? "self-end" : "self-start"
    )}>
      <Button aria-label={copied ? "Copied message" : "Copy message"} className="size-11 rounded-xl text-sophon-copy-metadata sm:size-9" onClick={onCopy} size="icon" title={copied ? "Copied" : "Copy message"} type="button" variant="sophon">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      {canEdit ? (
        <Button aria-label="Edit message" className="size-11 rounded-xl text-sophon-copy-metadata sm:size-9" onClick={onEdit} size="icon" title="Edit message" type="button" variant="sophon">
          <Pencil aria-hidden="true" />
        </Button>
      ) : null}
      {canRegenerate ? (
        <Button aria-label="Regenerate response" className="size-11 rounded-xl text-sophon-copy-metadata sm:size-9" onClick={onRegenerate} size="icon" title="Regenerate response" type="button" variant="sophon">
          <RotateCcw aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

function getModelCompatibility(capabilities: RuntimeCapabilities | null, model: ModelManifest | null) {
  if (!model) return "unselected" as const;
  if (!capabilities) return "probing" as const;
  return resolveModelProvider(model, capabilities) ? "compatible" as const : "incompatible" as const;
}

function getRuntimeStatus(
  capabilities: RuntimeCapabilities | null,
  model: ModelManifest | null,
  loadedModelId: string | null,
  activity: RuntimeActivity | null,
  modelLoadPaused: boolean,
  failedTurn: FailedTurn | null,
  error: string | null
) {
  if (failedTurn) {
    return isStoppedTurn(failedTurn)
      ? { label: "Generation stopped", className: "text-sophon-warning", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" }
      : { label: "Session interrupted", className: "text-destructive", dotClassName: "bg-destructive shadow-[0_0_10px_var(--destructive)]" };
  }
  if (error) {
    return { label: "Action needed", className: "text-destructive", dotClassName: "bg-destructive shadow-[0_0_10px_var(--destructive)]" };
  }
  if (activity) {
    return { label: activity.label, className: "text-sophon-signal-soft", dotClassName: "bg-sophon-signal-soft shadow-[0_0_10px_var(--sophon-signal-soft)]" };
  }
  if (!model) {
    return { label: "Choose model", className: "text-sophon-copy-metadata", dotClassName: "bg-sophon-signal-bright shadow-[0_0_10px_var(--sophon-signal-bright)]" };
  }
  if (!capabilities) {
    return { label: "Checking browser GPU", className: "text-sophon-copy-metadata", dotClassName: "animate-pulse bg-sophon-copy-metadata motion-reduce:animate-none" };
  }
  if (getModelCompatibility(capabilities, model) === "incompatible") {
    return { label: "Model unavailable", className: "text-destructive", dotClassName: "bg-destructive" };
  }
  if (loadedModelId === model.id) {
    return { label: "Model ready", className: "text-sophon-verified", dotClassName: "bg-sophon-verified-bright shadow-[0_0_10px_var(--sophon-verified-bright)]" };
  }
  if (modelLoadPaused) {
    return { label: "Download paused", className: "text-sophon-warning", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
  }
  return { label: "Ready to load", className: "text-sophon-copy-metadata", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
}

function getFailedTurnStatus(failedTurn: FailedTurn) {
  return isStoppedTurn(failedTurn) ? "Generation stopped" : "Session interrupted";
}

function isStoppedTurn(failedTurn: FailedTurn) {
  return /\bstopped\b/i.test(failedTurn.reason);
}

function useDocumentScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const root = document.documentElement;
    const body = document.body;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingInlineEnd = body.style.paddingInlineEnd;
    const bodyPaddingInlineEnd = Number.parseFloat(window.getComputedStyle(body).paddingInlineEnd) || 0;

    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingInlineEnd = `${bodyPaddingInlineEnd + scrollbarWidth}px`;

    return () => {
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingInlineEnd = previousBodyPaddingInlineEnd;
      window.scrollTo(scrollX, scrollY);
    };
  }, [locked]);
}

function activityFromLog(event: OnnxLogEvent): RuntimeActivity {
  const phase = event.phase === "download"
    ? "download"
    : event.phase === "tokenize"
      ? "tokenize"
      : event.phase === "inference" || event.phase === "generate"
        ? "decode"
        : "runtime";
  const label = phase === "download"
    ? getDownloadStageLabel(event.progress?.stage)
    : phase === "tokenize"
      ? "Preparing input"
      : phase === "decode"
        ? "Generating locally"
        : event.message || "Initializing runtime";
  return { detail: event.progress ? formatDownloadDetail(event.progress) : event.detail, label, phase, progress: event.progress };
}

function getDownloadStageLabel(stage?: NonNullable<OnnxLogEvent["progress"]>["stage"], compact = false) {
  if (stage === "validate") return compact ? "Validating" : "Validating model";
  if (stage === "resume") return compact ? "Resuming" : "Resuming model";
  if (stage === "verify") return compact ? "Verifying" : "Verifying model";
  if (stage === "ready") return "Model ready";
  if (stage === "cache") return "Loading downloaded model";
  return compact ? "Downloading" : "Downloading model";
}

function formatDownloadDetail(progress: NonNullable<OnnxLogEvent["progress"]>) {
  const parts = [`${formatStorageBytes(progress.loaded)} / ${formatStorageBytes(progress.total)}`];
  if (progress.resumedBytes) parts.push(`${formatStorageBytes(progress.resumedBytes)} resumed`);
  if (progress.networkBytes !== undefined) parts.push(`${formatStorageBytes(progress.networkBytes)} transferred`);
  if (progress.bytesPerSecond !== undefined) parts.push(`${formatStorageBytes(progress.bytesPerSecond)}/s`);
  if (progress.etaMs !== undefined) parts.push(`${formatEta(progress.etaMs)} left`);
  if (progress.elapsedMs !== undefined) parts.push(`${formatElapsed(progress.elapsedMs)} elapsed`);
  return parts.join(" · ");
}

function formatDownloadAriaText(progress: NonNullable<OnnxLogEvent["progress"]>) {
  const stage = progress.stage === "validate"
    ? "validated"
    : progress.stage === "verify"
        ? "verified"
        : progress.stage === "cache" || progress.stage === "ready"
          ? "loaded from browser storage"
          : "loaded";
  const resumed = progress.resumedBytes ? `, including ${formatStorageBytes(progress.resumedBytes)} resumed` : "";
  return `${formatStorageBytes(progress.loaded)} of ${formatStorageBytes(progress.total)} ${stage}${resumed}`;
}

function formatDownloadPercent(progress?: NonNullable<OnnxLogEvent["progress"]>) {
  if (!progress || progress.total <= 0) return undefined;
  const percent = Math.floor(progress.loaded / progress.total * 1_000) / 10;
  return progress.loaded > 0 && percent === 0 ? "<0.1%" : `${percent.toFixed(1)}%`;
}

function getModelDownloadDescription(
  model: ModelManifest,
  cache: ModelCacheSummary | undefined,
  storage: BrowserStorage | null | undefined,
  replacedModel: ModelManifest | null
) {
  const resumableBytes = cache?.state === "partial" ? cache.resumableBytes : 0;
  const totalBytes = model.format.sizeBytes ?? cache?.totalBytes ?? 0;
  const remainingBytes = Math.max(0, totalBytes - resumableBytes);
  const action = resumableBytes > 0
    ? `Sophon found ${formatStorageBytes(resumableBytes)} of resumable data and will download about ${formatStorageBytes(remainingBytes)} more.`
    : `Sophon will download ${model.format.sizeLabel} to this browser before it can answer locally.`;
  const availableBytes = storage?.quota !== undefined && storage.usage !== undefined
    ? Math.max(0, storage.quota - storage.usage)
    : null;
  const storageMessage = availableBytes === null
    ? "Your browser will verify available storage before downloading."
    : `This browser currently reports ${formatStorageBytes(availableBytes)} available.`;
  const replacementMessage = replacedModel
    ? `Switching will clear this conversation and remove the saved ${replacedModel.label.split(" · ")[0]} model first.`
    : "";
  return `${action} ${replacementMessage} ${storageMessage} Tiny Aya is licensed for non-commercial use under CC BY-NC 4.0 and the Cohere Labs AUP.`;
}

function formatEta(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.ceil(minutes / 60)}h`;
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

function activityFromTelemetry(telemetry: GenerationTelemetryEvent): RuntimeActivity {
  if (telemetry.phase === "prefill") {
    return { detail: `${telemetry.contextTokenCount} context tokens`, label: "Reading context", phase: "prefill" };
  }
  if (telemetry.phase === "decode") {
    return {
      detail: `${telemetry.outputTokenCount} generated · ${formatRate(telemetry.decodeTokensPerSecond)}`,
      label: "Generating response",
      phase: "decode"
    };
  }
  return {
    detail: `${telemetry.outputTokenCount} tokens generated`,
    label: "Finalizing response",
    phase: "complete"
  };
}

function formatRate(value: number | null) {
  return value === null ? "Speed pending" : `${value.toFixed(1)} tokens/s`;
}

function formatProvider(value: string) {
  return value === "webgpu" ? "WebGPU" : value.toUpperCase();
}

function formatQuantization(value: string) {
  return value === "q4f16" ? "4-bit" : value;
}

function formatContextBudget(tokens: number | null) {
  return tokens === null ? "context varies" : `${Math.round(tokens / 1024)}K context`;
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function formatStorageBytes(bytes?: number) {
  if (bytes === undefined) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const rank = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** rank;
  return `${value.toFixed(rank > 0 && value < 10 ? 1 : 0)} ${units[rank] ?? "TB"}`;
}
