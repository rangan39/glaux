"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Check, CircleUserRound, Copy, Download, Languages, LoaderCircle, LockKeyhole, PanelLeft, Pencil, RotateCcw, SendHorizontal, Sparkles, Square, Trash2 } from "lucide-react";
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
  cancelModelImport,
  cancelModelPreload,
  deleteCachedModel,
  getCachedModels,
  getCapabilities,
  importModelPack,
  inspectModelPack,
  preloadModel,
  runPrompt,
  terminateRuntimeWorker
} from "@/lib/interp-client";
import { getModelRuntimeProfile, MODEL_REGISTRY, RECOMMENDED_MODEL_ID, resolveModelProvider, type ModelManifest } from "@/lib/onnx-models";
import type { GenerationTelemetryEvent, ModelCacheSummary, ModelPackInspection, OnnxLogEvent, RuntimeCapabilities } from "@/lib/onnx-types";
import {
  createFixtureAssistantDraft,
  createFixtureDownloadActivity,
  createFixtureGenerationActivity,
  createProductTestSnapshot,
  PRODUCT_TESTING_BUILD,
  readProductTestState,
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
  phase: "download" | "import" | "runtime" | "tokenize" | "prefill" | "decode" | "complete";
  progress?: OnnxLogEvent["progress"];
};
type OfflinePackOperation =
  | { status: "validating"; modelId: string; file: File; activity: RuntimeActivity }
  | { status: "review"; modelId: string; file: File; inspection: ModelPackInspection }
  | { status: "importing"; modelId: string; file: File; inspection: ModelPackInspection; activity: RuntimeActivity };
type FailedTurn = {
  messageId: string;
  reason: string;
  text: string;
};

type GenerationState =
  | { status: "idle" }
  | { status: "loading"; activity: RuntimeActivity }
  | { status: "running"; activity: RuntimeActivity; draft: string; turn: Omit<FailedTurn, "reason"> };
type BrowserStorage = StorageEstimate & { persistent: boolean };
const LAST_READY_MODEL_KEY = "sophon:last-ready-model";
const PROMPT_MAX_HEIGHT = 192;
const PROMPT_SHORTCUT_HELP = "Enter to send · Shift+Enter for a new line";
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
  const [messages, setMessages] = useState(STARTER_MESSAGES);
  const [prompt, setPrompt] = useState("");
  const [generation, setGeneration] = useState<GenerationState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [modelId, setModelId] = useState("");
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
  const [offlinePack, setOfflinePack] = useState<OfflinePackOperation | null>(null);
  const [offlineLicenseAccepted, setOfflineLicenseAccepted] = useState(false);
  const generationIdRef = useRef(0);
  const modelDownloadFromMobileRef = useRef(false);
  const modelDownloadTriggerRef = useRef<HTMLElement | null>(null);
  const modelDeleteFromMobileRef = useRef(false);
  const modelDeleteTriggerRef = useRef<HTMLElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const offlineImportCancelledRef = useRef(false);
  const isRunning = generation.status === "running";
  const isPackBusy = offlinePack?.status === "validating" || offlinePack?.status === "importing";
  const isBusy = generation.status !== "idle" || isPackBusy;
  const generationActivity = generation.status === "idle" ? null : generation.activity;
  const runtimeActivity = offlinePack?.status === "validating" || offlinePack?.status === "importing"
    ? offlinePack.activity
    : generationActivity;
  const isModelLoading = generation.status === "loading" || runtimeActivity?.phase === "download" || runtimeActivity?.phase === "import";
  const downloadProgress = isModelLoading ? runtimeActivity?.progress : undefined;
  const downloadPercent = downloadProgress ? Math.floor(downloadProgress.loaded / downloadProgress.total * 100) : undefined;
  const downloadPercentLabel = formatDownloadPercent(downloadProgress);
  const downloadStatus = offlinePack?.status === "validating" ? "Validating" : getDownloadStageLabel(downloadProgress?.stage, true);
  const isNetworkDownload = !isPackBusy && (downloadProgress?.stage === "download" || downloadProgress?.stage === "resume");
  const selectedModel = MODEL_REGISTRY.find((model) => model.id === modelId) ?? null;
  const loadingModel = MODEL_REGISTRY.find((model) => model.id === offlinePack?.modelId) ?? selectedModel;
  const modelLoadCancelLabel = offlinePack?.status === "importing" ? "Cancel offline model import" : isNetworkDownload ? "Pause model download" : "Cancel model loading";
  const modelLoadCancelText = isNetworkDownload ? "Pause" : "Cancel";
  const recommendedModel = MODEL_REGISTRY.find((model) => model.id === RECOMMENDED_MODEL_ID)!;
  const recommendedCache = cacheSummaries.find((model) => model.modelId === RECOMMENDED_MODEL_ID);
  const recommendedCompatibility = getModelCompatibility(capabilities, recommendedModel);
  const pendingModelDownload = MODEL_REGISTRY.find((model) => model.id === pendingModelDownloadId) ?? null;
  const pendingModelDownloadCache = cacheSummaries.find((model) => model.modelId === pendingModelDownloadId);
  const pendingDeleteModel = MODEL_REGISTRY.find((model) => model.id === pendingDeleteModelId) ?? null;
  const pendingDeleteSummary = cacheSummaries.find((model) => model.modelId === pendingDeleteModelId);
  const pendingDeleteBytes = pendingDeleteSummary?.state === "partial" ? pendingDeleteSummary.resumableBytes : pendingDeleteSummary?.totalBytes;
  const modelCompatibility = getModelCompatibility(capabilities, selectedModel);
  const selectedRuntimeProfile = selectedModel
    ? getModelRuntimeProfile(selectedModel, capabilities?.hardwareTier ?? "desktop")
    : null;
  const modelReady = selectedModel !== null && loadedModelId === selectedModel.id;
  const runtimeStatus = getRuntimeStatus(capabilities, selectedModel, loadedModelId, runtimeActivity, modelLoadPaused);
  const storageLabel = browserStorage === undefined ? "Checking…" : browserStorage === null ? "Unavailable" : `${formatStorageBytes(browserStorage.usage)} / ${formatStorageBytes(browserStorage.quota)} · ${browserStorage.persistent ? "Persistent" : "Best effort"}`;
  const canSend = modelReady && prompt.trim().length > 0 && !isBusy && modelCompatibility === "compatible";
  const canResetConversation = messages.length > STARTER_MESSAGES.length || prompt.length > 0 || error !== null || failedTurn !== null;
  const displayedMessages = messages.map((message) => message.id === "assistant-welcome"
    ? getWelcomeMessage(message, selectedModel, modelReady, isModelLoading, modelLoadPaused)
    : message);
  const promptPlaceholder = !selectedModel
    ? "Choose a model above to unlock chat..."
    : modelReady
      ? "Ask the local model anything..."
      : "Write a prompt while the model gets ready...";
  const promptHelp = getPromptHelp({
    downloadPercent,
    isBusy,
    modelCompatibility,
    modelLoadPaused,
    modelReady,
    runtimeActivity
  });

  useEffect(() => {
    if (!PRODUCT_TESTING_BUILD) return;
    queueMicrotask(() => setProductTestState(readProductTestState()));
  }, []);

  useEffect(() => {
    if (!productTestState) return;
    const snapshot = createProductTestSnapshot(productTestState);
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
      setOfflinePack(null);
      setOfflineLicenseAccepted(false);
    });
  }, [productTestState]);

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
        setModelId((current) => {
          if (current || !autoRestoreEnabled) return current;
          const rememberedModelId = readRememberedModelId();
          return models.some((model) => model.modelId === rememberedModelId && model.state === "cached")
            ? rememberedModelId ?? current
            : current;
        });
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
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    messageEndRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [isRunning, messages]);

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
    setMessages(STARTER_MESSAGES);
    setPrompt("");
    setError(null);
    offlineImportCancelledRef.current = false;
    setNotice(null);
    setFailedTurn(null);
    setGeneration({ status: "idle" });
    setResetConfirmationOpen(false);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function selectModel(nextModelId: string) {
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

  function requestModelSelection(nextModelId: string) {
    const target = MODEL_REGISTRY.find((model) => model.id === nextModelId);
    if (!target || nextModelId === modelId) return;
    const cache = cacheSummaries.find((model) => model.modelId === nextModelId);
    if (cache?.state === "cached") {
      selectModel(nextModelId);
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

  function confirmModelDownload() {
    if (!pendingModelDownloadId) return;
    const targetModelId = pendingModelDownloadId;
    setPendingModelDownloadId(null);
    selectModel(targetModelId);
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

  function resumeModelLoad() {
    if (!selectedModel || !modelLoadPaused) return;
    setError(null);
    setNotice(null);
    setModelLoadPaused(false);
    if (productTestState) setGeneration({ status: "loading", activity: createFixtureDownloadActivity("resume") });
  }

  async function requestOfflinePackImport(targetModelId: string) {
    if (isBusy || offlinePack || !MODEL_REGISTRY.some((model) => model.id === targetModelId)) return;
    if (productTestState) {
      setModelSidebarOpen(false);
      setNotice("Offline pack import is disabled in product-test fixtures; no model bytes will be read or written.");
      return;
    }
    setModelSidebarOpen(false);
    setError(null);
    setNotice(null);
    let file: File | null;
    try {
      file = await pickOfflineModelPack();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The offline model pack picker could not be opened.");
      return;
    }
    if (!file) return;
    setOfflineLicenseAccepted(false);
    setOfflinePack({
      status: "validating",
      modelId: targetModelId,
      file,
      activity: {
        label: "Validating offline pack",
        detail: file.name,
        phase: "import",
        progress: { loaded: 0, total: Math.max(1, file.size), stage: "validate" }
      }
    });
    try {
      const inspection = await inspectModelPack(file, targetModelId);
      setOfflinePack((current) => current?.status === "validating" && current.file === file
        ? { status: "review", modelId: targetModelId, file, inspection }
        : current);
    } catch (caught) {
      setOfflinePack(null);
      setError(caught instanceof Error ? caught.message : "The offline model pack could not be validated.");
    }
  }

  async function confirmOfflinePackImport() {
    if (offlinePack?.status !== "review" || !offlineLicenseAccepted) return;
    const { file, inspection, modelId: targetModelId } = offlinePack;
    setError(null);
    offlineImportCancelledRef.current = false;
    setOfflinePack({
      status: "importing",
      modelId: targetModelId,
      file,
      inspection,
      activity: {
        label: "Validating offline pack",
        detail: file.name,
        phase: "import",
        progress: { loaded: 0, total: inspection.modelBytes, stage: "validate" }
      }
    });
    try {
      const result = await importModelPack(file, targetModelId, (event) => {
        setOfflinePack((current) => current?.status === "importing" && current.file === file
          ? { ...current, activity: activityFromLog(event) }
          : current);
      });
      const next = await getCachedModels();
      setCacheSummaries(next);
      setOfflinePack(null);
      setOfflineLicenseAccepted(false);
      selectModel(result.modelId);
      setNotice(`${MODEL_REGISTRY.find((model) => model.id === result.modelId)?.label ?? result.modelId} was imported, verified, and saved for offline use.`);
    } catch (caught) {
      setOfflinePack(null);
      setOfflineLicenseAccepted(false);
      if (!offlineImportCancelledRef.current && !(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "The offline model pack could not be imported.");
      }
    } finally {
      setStorageRevision((value) => value + 1);
    }
  }

  function closeOfflinePackReview() {
    if (offlinePack?.status !== "review") return;
    setOfflinePack(null);
    setOfflineLicenseAccepted(false);
  }

  function cancelModelLoad() {
    if (offlinePack?.status === "importing") {
      const target = MODEL_REGISTRY.find((model) => model.id === offlinePack.modelId);
      offlineImportCancelledRef.current = true;
      setOfflinePack(null);
      setOfflineLicenseAccepted(false);
      if (!productTestState) void cancelModelImport().catch(() => terminateRuntimeWorker());
      setNotice(`${target?.label ?? "Offline model"} import cancelled. Fully verified segments were kept and can resume from the same pack.`);
      setStorageRevision((value) => value + 1);
      return;
    }
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
    if (!target) return;
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
      return;
    }
    try {
      await deleteCachedModel(targetModelId);
      forgetRememberedModelId(targetModelId);
      const next = await getCachedModels();
      setCacheSummaries(next);
      setStorageRevision((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${target.label} could not be deleted.`);
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
    <main className={cn("relative w-full bg-sophon-canvas text-foreground", selectedModel ? "h-svh overflow-hidden" : "min-h-svh")} data-inference={isBusy ? "active" : "idle"} data-product-test-state={productTestState ?? undefined}>
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-45" />
      <div className={cn("relative flex w-full flex-col bg-transparent", selectedModel ? "h-svh" : "min-h-svh")}>
        <header className="sophon-glass-strong relative z-20 flex h-[calc(106px+env(safe-area-inset-top))] shrink-0 items-center justify-between border-x-0 border-t-0 px-3 pb-8 pt-[env(safe-area-inset-top)] sm:h-[calc(74px+env(safe-area-inset-top))] sm:px-7 sm:pb-0" data-testid="workbench-header">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3" data-testid="workbench-brand">
            <div className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-sophon-signal-bright/60 bg-gradient-to-br from-sophon-signal-bright to-sophon-signal text-[#210b07] shadow-[0_0_34px_rgb(255_77_46/.24)]">
              <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>
              <span aria-hidden="true" className="absolute -right-1 -top-1 size-2 rounded-full bg-sophon-warning shadow-[0_0_12px_var(--sophon-warning)]" />
            </div>
            <div className={cn("min-w-0", selectedModel && "max-[359px]:hidden")}>
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-sm font-semibold tracking-[0.12em] text-white">SOPHON</h1>
                <span className="sophon-type-decorative hidden items-center rounded-md border border-sophon-signal-bright/35 bg-sophon-signal/15 px-2 py-0.5 font-mono font-medium uppercase tracking-[0.12em] text-[#ffb4a4] sm:inline-flex" data-typography-role="decorative">Local AI</span>
              </div>
              <p className="sophon-type-metadata hidden font-mono uppercase tracking-[0.12em] text-sophon-copy-metadata md:block" data-typography-role="metadata">Private AI in your browser</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3" data-testid="workbench-actions">
            <div className={cn("sophon-glass-tile sophon-type-status absolute inset-x-3 bottom-2 flex min-w-0 items-center justify-center gap-2 rounded-full px-3 py-1 font-mono uppercase tracking-[0.08em] sm:static sm:inset-auto sm:shrink-0 sm:py-1.5", runtimeStatus.className)} data-testid="workbench-status" data-typography-role="status">
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", runtimeStatus.dotClassName)} />
              <span className="truncate">{runtimeStatus.label}{downloadPercentLabel ? ` · ${downloadPercentLabel}` : null}</span>
            </div>
            {generation.status === "loading" || offlinePack?.status === "importing" ? <Button aria-label={modelLoadCancelLabel} className="h-11 rounded-xl sm:h-9" onClick={cancelModelLoad} size="sm" title={modelLoadCancelLabel} type="button" variant="sophon"><Square aria-hidden="true" className="size-3 fill-current" /><span className="hidden sm:inline">{modelLoadCancelText}</span></Button> : null}
            {modelLoadPaused && selectedModel ? <Button aria-label="Resume model download" className="hidden h-11 rounded-xl sm:inline-flex sm:h-9" onClick={resumeModelLoad} size="sm" title="Resume model download" type="button" variant="sophon"><Download aria-hidden="true" /><span>Resume</span></Button> : null}
            {canResetConversation && !isBusy ? (
              <Button aria-label="Reset conversation" className="size-11 rounded-xl text-sophon-copy-metadata hover:text-sophon-signal-bright sm:size-9" disabled={isBusy} onClick={requestResetConversation} ref={resetTriggerRef} size="icon" title="Reset conversation" type="button" variant="sophon">
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
            <SophonAcknowledgements compact />
            <Button aria-controls="model-library-mobile" aria-expanded={modelSidebarOpen} aria-label="Open model library" className="h-11 rounded-xl px-2 sm:h-8 sm:px-3 lg:hidden" data-testid="open-model-library" onClick={() => setModelSidebarOpen(true)} size="sm" type="button" variant="sophon"><PanelLeft aria-hidden="true" /><span>Models</span></Button>
          </div>
          {isModelLoading && loadingModel ? <span aria-label={`Loading ${loadingModel.label}`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={downloadPercent} aria-valuetext={downloadProgress ? formatDownloadAriaText(downloadProgress) : "Preparing model delivery"} className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-white/10" role="progressbar"><span className={cn("block h-full bg-gradient-to-r from-sophon-signal to-sophon-signal-bright shadow-[0_0_12px_var(--sophon-signal-bright)] transition-[width] duration-200 motion-reduce:transition-none", downloadPercent === undefined && "w-1/3 animate-pulse motion-reduce:animate-none")} style={downloadPercent === undefined ? undefined : { width: `${downloadPercent}%` }} /></span> : null}
        </header>

        <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">{runtimeActivity?.label ?? ""}</div>

        <div className={cn("flex flex-1", selectedModel ? "min-h-0" : "min-h-fit")}>
          <SophonModelSidebar cacheSummaries={cacheSummaries} capabilities={capabilities} deletingModelId={deletingModelId} disabled={isRunning || isPackBusy} downloadPercent={downloadPercent} downloadPercentLabel={downloadPercentLabel} importingModelId={offlinePack?.status === "validating" || offlinePack?.status === "importing" ? offlinePack.modelId : null} loadedModelId={loadedModelId} loading={isModelLoading} loadingLabel={downloadStatus} mobileOpen={modelSidebarOpen} modelId={modelId} onDelete={requestDeleteModelDownload} onImport={(targetModelId) => void requestOfflinePackImport(targetModelId)} onMobileOpenChange={setModelSidebarOpen} onSelect={requestModelSelection} recommendedModelId={RECOMMENDED_MODEL_ID} />
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
                        onSelectRecommended={() => requestModelSelection(RECOMMENDED_MODEL_ID)}
                      />
                    ) : (
                      <FirstRunCheck />
                    )
                  ) : displayedMessages.map((message, index) => (
                    <Message align={message.role === "user" ? "end" : "start"} aria-label={message.role === "user" ? "Message from you" : "Message from Sophon"} key={message.id} role="article">
                      <MessageAvatar className={message.role === "user" ? "!self-start mt-1 rounded-xl border border-sophon-signal-bright/50 bg-gradient-to-br from-sophon-signal-bright to-sophon-signal text-[#210b07] shadow-[0_0_20px_rgb(255_77_46/.16)]" : "sophon-glass-tile !self-start mt-1 rounded-xl text-sophon-signal-soft"}>
                        {message.role === "user" ? <CircleUserRound aria-hidden="true" className="size-4" /> : <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>}
                      </MessageAvatar>
                      <MessageContent className="w-full max-w-[calc(100%_-_2.75rem)] sm:max-w-[min(920px,calc(100%_-_3rem))]">
                        <InspectableMessage content={message.content} meta={message.meta} role={message.role} tokens={message.tokens} />
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
                              <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-6 text-white/90">
                                {generation.draft}<span aria-hidden="true" className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-sophon-signal-soft align-text-bottom motion-reduce:animate-none" />
                              </p>
                              <span className="flex items-center gap-2 border-t border-white/10 bg-black/10 px-3 py-2">
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
                                <span className="block text-sm font-medium text-white/90">{runtimeActivity?.label ?? "Generating response"}</span>
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
              <div className="sophon-glass-strong z-10 shrink-0 border-x-0 border-b-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <form className="mx-auto max-w-6xl" onSubmit={submitPrompt}>
                {modelLoadPaused && selectedModel ? (
                  <div className="sophon-glass-tile mb-3 flex flex-col gap-3 rounded-xl border-sophon-warning/30 px-4 py-3 text-sm text-sophon-copy-body sm:flex-row sm:items-center" role="status">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-white">Model download paused</span>
                      <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">Your draft stays here. Resume when you are ready to finish downloading {selectedModel.format.sizeLabel} and send it.</span>
                    </span>
                    <Button className="h-11 shrink-0 self-start rounded-xl sm:h-9 sm:self-auto" onClick={resumeModelLoad} type="button" variant="sophon"><Download aria-hidden="true" /> Resume download</Button>
                  </div>
                ) : failedTurn ? (
                  <div className="sophon-glass-tile mb-3 flex flex-col gap-3 rounded-xl border-destructive/35 px-4 py-3 text-sm text-[#ffb4b7] sm:flex-row sm:items-center" id="prompt-error" role="alert">
                    <span className="min-w-0 flex-1">{failedTurn.reason}</span>
                    <span className="flex shrink-0 gap-2">
                      <Button disabled={modelCompatibility !== "compatible"} onClick={retryFailedTurn} size="sm" type="button" variant="sophon"><RotateCcw aria-hidden="true" /> Retry</Button>
                      <Button onClick={editFailedTurn} size="sm" type="button" variant="sophon"><Pencil aria-hidden="true" /> Edit</Button>
                    </span>
                  </div>
                ) : error ? (
                  <div className="sophon-glass-tile mb-3 rounded-xl border-destructive/35 px-4 py-3 text-sm text-[#ffb4b7]" id="prompt-error" role="alert">{error}</div>
                ) : notice ? (
                  <div className="sophon-glass-tile mb-3 flex flex-col gap-3 rounded-xl border-white/15 px-4 py-3 text-sm text-sophon-copy-body sm:flex-row sm:items-center" role="status">
                    <span className="min-w-0 flex-1">{notice}</span>
                    <Button className="h-11 self-start rounded-xl sm:h-8 sm:self-auto" onClick={() => setNotice(null)} size="sm" type="button" variant="sophon">Dismiss</Button>
                  </div>
                ) : null}
                <label className="sr-only" htmlFor="sophon-prompt">Message Sophon</label>
                <div className="sophon-glass-tile sophon-glass-interactive relative overflow-hidden rounded-2xl">
                  <textarea
                    aria-describedby="prompt-help"
                    className="flex min-h-24 max-h-48 w-full resize-none overflow-y-auto rounded-md border-0 bg-transparent px-3 py-2 pr-14 text-[15px] leading-6 text-sophon-copy-primary shadow-none placeholder:text-sophon-copy-decorative focus-visible:outline-none disabled:cursor-not-allowed disabled:text-sophon-copy-disabled"
                    id="sophon-prompt"
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={promptPlaceholder}
                    ref={promptRef}
                    disabled={!selectedModel || modelCompatibility === "incompatible"}
                    value={prompt}
                  />
                  <div className="flex items-center justify-between border-t border-white/[.1] bg-black/10 px-3 py-2">
                    <span className="sophon-type-metadata truncate pr-3 font-mono uppercase tracking-[0.08em] text-sophon-copy-metadata" data-typography-role="metadata">
                      {selectedModel ? `${selectedModel.family} · ${formatQuantization(selectedModel.format.quantization)} · ${selectedModel.format.sizeLabel} · ${formatContextBudget(selectedRuntimeProfile?.contextLength ?? null)}` : "Choose a model above to unlock chat"}
                    </span>
                    {isRunning ? (
                      <Button aria-label="Stop generation" className="h-10 shrink-0 rounded-xl" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                        <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                      </Button>
                    ) : (
                      <Button aria-label="Send message" className="relative size-10 shrink-0 rounded-xl bg-gradient-to-br from-sophon-signal-bright to-sophon-signal text-[#210b07] shadow-[0_0_24px_rgb(255_77_46/.28)] after:absolute after:-inset-1 after:content-[''] hover:from-[#ff8068] hover:to-sophon-signal-bright" disabled={!canSend} size="icon" type="submit">
                        <SendHorizontal aria-hidden="true" className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <footer className="sophon-type-metadata mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-1 font-mono uppercase tracking-[0.06em] text-sophon-copy-metadata min-[900px]:flex min-[900px]:gap-2" data-typography-role="metadata">
                  <span className={cn("min-w-0 truncate text-sophon-copy-body", modelCompatibility === "incompatible" && "text-destructive")} id="prompt-help">
                    {promptHelp === PROMPT_SHORTCUT_HELP ? (
                      <><span className="sm:hidden">Enter to send</span><span className="hidden sm:inline">{PROMPT_SHORTCUT_HELP}</span></>
                    ) : promptHelp}
                  </span>
                  <span className="shrink-0 tabular-nums">{prompt.length} {prompt.length === 1 ? "char" : "chars"}</span>
                  <div className="col-span-2 flex min-w-0 items-center gap-0.5 min-[900px]:col-auto min-[900px]:ml-auto">
                    <InfoHint className="-my-1" concept="browserStorage" />
                    <p className="min-w-0 truncate min-[900px]:text-right" data-state={browserStorage === undefined ? "checking" : browserStorage === null ? "unavailable" : "ready"} data-testid="browser-storage">
                      Browser storage · <span className="tabular-nums text-sophon-copy-body">{storageLabel}</span>
                    </p>
                    <a className="sophon-type-action ml-2 shrink-0 text-sophon-copy-primary underline decoration-white/25 underline-offset-4 hover:text-sophon-signal-bright" data-typography-role="action" href={PRIVACY_PATH}>Privacy</a>
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
          description={getModelDownloadDescription(pendingModelDownload, pendingModelDownloadCache, browserStorage)}
          onCancel={closeModelDownloadConfirmation}
          onConfirm={confirmModelDownload}
          title={`${pendingModelDownloadCache?.state === "partial" ? "Resume" : "Download"} ${pendingModelDownload.label.split(" · ")[0]}?`}
        />
      ) : null}
      {offlinePack?.status === "review" ? (
        <OfflinePackDialog
          accepted={offlineLicenseAccepted}
          inspection={offlinePack.inspection}
          model={MODEL_REGISTRY.find((model) => model.id === offlinePack.modelId) ?? null}
          onAcceptedChange={setOfflineLicenseAccepted}
          onCancel={closeOfflinePackReview}
          onConfirm={() => void confirmOfflinePackImport()}
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
        <span className="block text-sm font-medium text-white">Checking this browser</span>
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
        <div className="sophon-glass-tile mb-3 flex items-center gap-3 rounded-xl border-white/15 px-4 py-3 text-sm text-sophon-copy-body" role="status">
          <span className="min-w-0 flex-1">{notice}</span>
          <Button className="h-11 shrink-0 rounded-xl sm:h-8" onClick={onDismissNotice} size="sm" type="button" variant="sophon">Dismiss</Button>
        </div>
      ) : null}
      <div className="sophon-glass-strong overflow-hidden rounded-3xl">
        <div className="px-5 py-5 sm:px-8 sm:py-8">
          <div className="sophon-type-decorative mb-3 flex items-center gap-2 font-mono font-semibold uppercase tracking-[0.12em] text-[#ffb4a4] sm:mb-4" data-typography-role="decorative">
            <Sparkles aria-hidden="true" className="size-4" />
            Start here
          </div>
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl" id="first-run-title">Private AI, right in your browser</h2>
          <p className="sophon-type-body mt-3 max-w-2xl text-sophon-copy-body sm:text-base" data-typography-role="body">
            Choose one Cohere Tiny Aya model to run locally. No account is needed, and your prompts and responses are not sent to an inference server.
          </p>

          <div className="mt-5 rounded-2xl border border-sophon-signal-bright/35 bg-sophon-signal/10 p-4 sm:grid sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:gap-x-5 sm:gap-y-4 sm:p-5 min-[900px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[900px]:items-center" data-testid="first-run-recommended">
            <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl border border-sophon-signal-bright/40 bg-sophon-signal/15 text-[#ffb4a4]" data-testid="first-run-recommended-icon">
              <Languages className="size-5" />
            </span>
            <div className="mt-3 min-w-0 sm:mt-0" data-testid="first-run-recommended-details">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-white">{modelName}</h3>
                <span className="sophon-type-status rounded-full border border-sophon-verified/30 bg-sophon-verified/10 px-2 py-0.5 font-mono uppercase tracking-[0.04em] text-sophon-verified" data-typography-role="status">{mobileProfile ? "Mobile mode" : "Recommended"}</span>
              </div>
              <p className="sophon-type-body mt-1 text-sophon-copy-body" data-typography-role="body">Best all-around choice for broad multilingual use.{mobileProfile ? " Sophon uses a 2K context and shorter responses on this device." : ""}</p>
            </div>
            <Button
              aria-label={compatibility === "probing" ? "Checking browser compatibility" : compatibility === "incompatible" ? "Browser GPU unavailable" : primaryLabel}
              className="mt-4 min-h-11 h-auto w-full shrink-0 whitespace-normal rounded-xl bg-gradient-to-br from-sophon-signal-bright to-sophon-signal px-5 py-2 text-center leading-5 text-[#210b07] shadow-[0_0_24px_rgb(255_77_46/.2)] hover:from-[#ff8068] hover:to-sophon-signal-bright sm:col-span-2 sm:mt-0 min-[900px]:col-span-1 min-[900px]:w-auto"
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
            <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-5 text-[#ffb4b7]" role="alert">
              This device does not expose the browser GPU support required to run this model locally.
            </p>
          ) : null}

          <div className="mt-4 grid gap-2 sm:grid-cols-2 sm:gap-3">
            <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-3 sm:p-4">
              <LockKeyhole aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-sophon-verified" />
              <span>
                <span className="block text-sm font-medium text-white">Stays private</span>
                <span className="sophon-type-metadata mt-1 block text-sophon-copy-metadata" data-typography-role="metadata">Chats remain in this browser.</span>
              </span>
            </div>
            <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-3 sm:p-4">
              <Download aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-sophon-signal-soft" />
              <span>
                <span className="block text-sm font-medium text-white">Download once</span>
                <span className="sophon-type-metadata mt-1 block text-sophon-copy-metadata" data-typography-role="metadata">About {model.format.sizeLabel.replace("~", "")}, then reused on future visits.</span>
              </span>
            </div>
          </div>
          <div className="sophon-type-metadata mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 text-sophon-copy-metadata sm:flex-row sm:items-center sm:justify-between" data-typography-role="metadata">
            <span>Open weights · {model.licenseLabel} · Downloads can be paused and resumed</span>
            <Button className="h-11 self-start rounded-xl sm:h-8 lg:hidden" onClick={onOpenModels} size="sm" type="button" variant="sophon">Compare all {MODEL_REGISTRY.length} models</Button>
            <span className="hidden items-center gap-3 lg:flex">More multilingual models are available in the library.</span>
          </div>
          <nav aria-label="First-run privacy, licensing, and support" className="mt-4 border-t border-white/10 pt-4" data-testid="first-run-trust-nav">
            <p className="sophon-type-decorative mb-2 font-mono font-semibold uppercase tracking-[0.1em] text-sophon-copy-decorative" data-typography-role="decorative">Privacy, terms & support</p>
            <div className="flex flex-wrap gap-2">
              <a className="sophon-type-action inline-flex min-h-11 items-center rounded-xl border border-white/10 bg-white/[.035] px-3 uppercase tracking-[0.06em] text-sophon-copy-primary transition-colors hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" data-typography-role="action" href={PRIVACY_PATH}>Privacy</a>
              <SophonAcknowledgements compact label="About & licenses" />
              <a className="sophon-type-action inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[.035] px-3 uppercase tracking-[0.06em] text-sophon-copy-primary transition-colors hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" data-typography-role="action" href={PROJECT_SUPPORT_URL} rel="noreferrer" target="_blank">Support <ExternalLinkIndicator /></a>
            </div>
          </nav>
        </div>
      </div>
    </section>
  );
}

function OfflinePackDialog({ accepted, inspection, model, onAcceptedChange, onCancel, onConfirm }: {
  accepted: boolean;
  inspection: ModelPackInspection;
  model: ModelManifest | null;
  onAcceptedChange: (accepted: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const insufficientStorage = inspection.availableBytes !== null && inspection.requiredBytes > inspection.availableBytes;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 px-4 py-6 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div aria-describedby={descriptionId} aria-labelledby={titleId} aria-modal="true" className="sophon-glass-strong w-full max-w-xl rounded-2xl p-5 shadow-[0_24px_80px_rgb(0_0_0/.55)] sm:p-6" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }} role="dialog">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl border border-sophon-signal-bright/35 bg-sophon-signal/15 text-[#ffb4a4]"><Download className="size-5" /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white" id={titleId}>Review offline model pack</h2>
            <p className="sophon-type-metadata mt-1 truncate text-sophon-copy-metadata" data-typography-role="metadata">{inspection.fileName}</p>
          </div>
        </div>
        <p className="sophon-type-body mt-4 text-sophon-copy-body" data-typography-role="body" id={descriptionId}>
          Sophon matched this pack exactly to its compiled artifact allowlist. Review the source and non-commercial terms before writing model data to browser storage.
        </p>
        <dl className="sophon-type-metadata mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-black/20 p-4 text-sophon-copy-metadata" data-typography-role="metadata">
          <dt>Model</dt><dd className="truncate text-right text-sophon-copy-body">{model?.label ?? inspection.modelId}</dd>
          <dt>Model size</dt><dd className="text-right tabular-nums text-sophon-copy-body">{formatStorageBytes(inspection.modelBytes)}</dd>
          <dt>Space needed</dt><dd className="text-right tabular-nums text-sophon-copy-body">{inspection.alreadyReady ? "Already installed" : formatStorageBytes(inspection.requiredBytes)}</dd>
          <dt>Available</dt><dd className="text-right tabular-nums text-sophon-copy-body">{inspection.availableBytes === null ? "Browser did not report" : formatStorageBytes(inspection.availableBytes)}</dd>
          <dt>Source</dt><dd className="truncate text-right text-sophon-copy-body">{inspection.repo}</dd>
          <dt>Revision</dt><dd className="truncate text-right font-mono text-sophon-copy-body" title={inspection.revision}>{inspection.revision.slice(0, 12)}</dd>
        </dl>
        {insufficientStorage ? (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-5 text-[#ffb4b7]" role="alert">
            This browser does not report enough free storage for the verified model. Delete another model or free device storage, then try again.
          </p>
        ) : null}
        <div className="sophon-type-metadata mt-4 rounded-xl border border-sophon-warning/25 bg-sophon-warning/5 p-4 text-sophon-copy-metadata" data-typography-role="metadata">
          <p className="font-medium text-sophon-copy-body">CC BY-NC 4.0 · non-commercial use only</p>
          <p className="mt-1">{inspection.license.attribution}</p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            <a className="inline-flex items-center gap-1 text-sophon-signal-soft underline underline-offset-2" href={inspection.license.modelCardUrl} rel="noreferrer" target="_blank">Model card <ExternalLinkIndicator /></a>
            <a className="inline-flex items-center gap-1 text-sophon-signal-soft underline underline-offset-2" href={inspection.license.acceptableUsePolicyUrl} rel="noreferrer" target="_blank">Cohere Labs AUP <ExternalLinkIndicator /></a>
          </p>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[.035] p-3 text-sm leading-5 text-sophon-copy-body">
          <input checked={accepted} className="mt-1 size-4 accent-[var(--sophon-signal-bright)]" onChange={(event) => onAcceptedChange(event.target.checked)} type="checkbox" />
          <span>I understand that Tiny Aya is licensed for non-commercial use and remains subject to the Cohere Labs Acceptable Use Policy.</span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} ref={cancelRef} type="button" variant="sophon">Cancel</Button>
          <Button disabled={!accepted || insufficientStorage} onClick={onConfirm} type="button">Import and verify</Button>
        </div>
      </div>
    </div>
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="sophon-glass-strong w-full max-w-sm rounded-2xl p-5 shadow-[0_24px_80px_rgb(0_0_0/.55)]"
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
        <h2 className="text-base font-semibold text-white" id={titleId}>{title}</h2>
        <p className="sophon-type-body mt-2 text-sophon-copy-body" data-typography-role="body" id={descriptionId}>{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button className="h-11 rounded-xl sm:h-9" disabled={busy} onClick={onCancel} ref={cancelRef} type="button" variant="sophon">{cancelLabel}</Button>
          <Button className={cn("h-11 rounded-xl sm:h-9", confirmTone === "destructive" && "bg-destructive text-white shadow-none hover:bg-destructive/85")} disabled={busy} onClick={onConfirm} ref={confirmRef} type="button">
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
      ? `${modelName} is selected and its download is paused. Your draft stays here until you resume.`
      : isModelLoading
        ? `${modelName} is getting ready. You can write your prompt while Sophon downloads and verifies it locally.`
        : `${modelName} is selected. Sophon will run it privately as soon as it is ready.`,
    meta: "Browser storage · resumable download · no server inference"
  };
}

function getPromptHelp({
  downloadPercent,
  isBusy,
  modelCompatibility,
  modelLoadPaused,
  modelReady,
  runtimeActivity
}: {
  downloadPercent?: number;
  isBusy: boolean;
  modelCompatibility: ReturnType<typeof getModelCompatibility>;
  modelLoadPaused: boolean;
  modelReady: boolean;
  runtimeActivity: RuntimeActivity | null;
}) {
  if (modelCompatibility === "unselected") return "Choose a model above to begin";
  if (modelCompatibility === "probing") return "Checking browser GPU…";
  if (modelCompatibility === "incompatible") return "Selected model needs browser GPU support";
  if (modelLoadPaused) return "Download paused · resume to send";
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
      <Button aria-label={copied ? "Copied message" : "Copy message"} className="size-11 rounded-xl text-white/70 sm:size-9" onClick={onCopy} size="icon" title={copied ? "Copied" : "Copy message"} type="button" variant="sophon">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      {canEdit ? (
        <Button aria-label="Edit message" className="size-11 rounded-xl text-white/70 sm:size-9" onClick={onEdit} size="icon" title="Edit message" type="button" variant="sophon">
          <Pencil aria-hidden="true" />
        </Button>
      ) : null}
      {canRegenerate ? (
        <Button aria-label="Regenerate response" className="size-11 rounded-xl text-white/70 sm:size-9" onClick={onRegenerate} size="icon" title="Regenerate response" type="button" variant="sophon">
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
  modelLoadPaused: boolean
) {
  if (activity) {
    return { label: activity.label, className: "text-[#dbe7ff]", dotClassName: "bg-sophon-signal-soft shadow-[0_0_10px_var(--sophon-signal-soft)]" };
  }
  if (!model) {
    return { label: "Choose model", className: "text-sophon-copy-metadata", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
  }
  if (!capabilities) {
    return { label: "Checking browser GPU", className: "text-sophon-copy-metadata", dotClassName: "animate-pulse bg-white/60 motion-reduce:animate-none" };
  }
  if (getModelCompatibility(capabilities, model) === "incompatible") {
    return { label: "Model unavailable", className: "text-destructive", dotClassName: "bg-destructive" };
  }
  if (loadedModelId === model.id) {
    return { label: "Model ready", className: "text-sophon-verified", dotClassName: "bg-sophon-verified shadow-[0_0_10px_var(--sophon-verified)]" };
  }
  if (modelLoadPaused) {
    return { label: "Download paused", className: "text-sophon-warning", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
  }
  return { label: "Ready to load", className: "text-sophon-copy-metadata", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
}

function activityFromLog(event: OnnxLogEvent): RuntimeActivity {
  const phase = event.phase === "import"
    ? "import"
    : event.phase === "download"
    ? "download"
    : event.phase === "tokenize"
      ? "tokenize"
      : event.phase === "inference" || event.phase === "generate"
        ? "decode"
        : "runtime";
  const label = phase === "download" || phase === "import"
    ? getDownloadStageLabel(event.progress?.stage)
    : phase === "tokenize"
      ? "Preparing input"
      : phase === "decode"
        ? "Generating locally"
        : event.message || "Initializing runtime";
  return { detail: event.progress ? formatDownloadDetail(event.progress) : event.detail, label, phase, progress: event.progress };
}

function getDownloadStageLabel(stage?: NonNullable<OnnxLogEvent["progress"]>["stage"], compact = false) {
  if (stage === "validate") return compact ? "Validating" : "Validating offline pack";
  if (stage === "import") return compact ? "Importing" : "Importing offline pack";
  if (stage === "resume") return compact ? "Resuming" : "Resuming model";
  if (stage === "verify") return compact ? "Verifying" : "Verifying model";
  if (stage === "ready") return "Offline model ready";
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
    : progress.stage === "import"
      ? "imported"
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
  const percent = Math.floor(progress.loaded / progress.total * 100);
  return progress.loaded > 0 && percent === 0 ? "<1%" : `${percent}%`;
}

function getModelDownloadDescription(
  model: ModelManifest,
  cache: ModelCacheSummary | undefined,
  storage: BrowserStorage | null | undefined
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
  return `${action} ${storageMessage} Tiny Aya is licensed for non-commercial use under CC BY-NC 4.0 and the Cohere Labs AUP.`;
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

async function pickOfflineModelPack(): Promise<File | null> {
  const picker = (window as Window & {
    showOpenFilePicker?: (options: { multiple: boolean }) => Promise<{ getFile: () => Promise<File> }[]>;
  }).showOpenFilePicker;
  if (typeof picker === "function") {
    try {
      const handles = await picker({ multiple: false });
      return handles[0] ? handles[0].getFile() : null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      resolve(file);
    };
    input.type = "file";
    input.accept = ".sophon-model,application/octet-stream";
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    window.addEventListener("focus", () => {
      window.setTimeout(() => finish(input.files?.[0] ?? null), 0);
    }, { once: true });
    input.click();
  });
}
