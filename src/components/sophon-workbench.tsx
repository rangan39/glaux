"use client";

import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, CircleUserRound, Code2, Copy, Download, ExternalLink, Gauge, Hammer, HardDrive, Languages, LifeBuoy, LoaderCircle, MessageCircle, MoonStar, PanelLeft, Pencil, RotateCcw, SendHorizontal, ShieldCheck, Sparkles, Square, Trash2 } from "lucide-react";
import { GlauxAcknowledgements } from "@/components/sophon-acknowledgements";
import { GlauxModelSidebar } from "@/components/sophon-model-sidebar";
import { InspectableMessage, type InspectableToken, type TokenInspectMode } from "@/components/token-lens";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
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
import { communityDescriptorToManifest, MODEL_REGISTRY, RECOMMENDED_MODEL_ID, resolveModelProvider, type ModelManifest } from "@/lib/onnx-models";
import { listSavedCommunityModelDescriptors, type CommunityModelDescriptor } from "@/lib/model-catalog";
import type { GenerationTelemetryEvent, ModelCacheSummary, OnnxLogEvent, RuntimeCapabilities } from "@/lib/onnx-types";
import {
  createModelReplacementPlan,
  createStartupModelCleanupPlan,
  runModelReplacement,
  runStartupModelCleanup,
  type ModelReplacementPhase,
  type ModelReplacementPlan
} from "@/lib/model-replacement";
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
import { ONNX_COMMUNITY_URL, PRIVACY_PATH, PROJECT_REPOSITORY_URL, PROJECT_SUPPORT_URL } from "@/lib/trust-navigation";

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
type StartupCleanupStatus = "idle" | "cleaning" | "failed";
type InterfaceMode = "chat" | "developer";

type GenerationState =
  | { status: "idle" }
  | { status: "loading"; activity: RuntimeActivity }
  | { status: "running"; activity: RuntimeActivity; draft: string; turn: Omit<FailedTurn, "reason"> };
type BrowserStorage = StorageEstimate & { persistent: boolean };
const LAST_READY_MODEL_KEY = "sophon:last-ready-model";
const PROMPT_MAX_HEIGHT = 192;
const PROMPT_SHORTCUT_HELP = "Enter sends · Shift+Enter adds a line";
const STARTER_MESSAGES: ChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content: "Hi — I’m Glaux. Find a compatible ONNX Community model to download, then chat locally in this browser.",
    meta: "Open-source web tool · local inference · no server inference"
  }
];
export function GlauxWorkbench() {
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
  const [communityModels, setCommunityModels] = useState<ModelManifest[]>([]);
  const [libraryModelId, setLibraryModelId] = useState("");
  const [modelSidebarOpen, setModelSidebarOpen] = useState(false);
  const [inspectDisplayMode, setInspectDisplayMode] = useState<TokenInspectMode | null>(null);
  const [hoveredInspectMetrics, setHoveredInspectMetrics] = useState<string | undefined>();
  const [modelLoadPaused, setModelLoadPaused] = useState(false);
  const [pendingModelDownloadId, setPendingModelDownloadId] = useState<string | null>(null);
  const [modelReplacementPhase, setModelReplacementPhase] = useState<ModelReplacementPhase | null>(null);
  const [pendingDeleteModelId, setPendingDeleteModelId] = useState<string | null>(null);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [browserStorage, setBrowserStorage] = useState<BrowserStorage | null>();
  const [cacheSummaries, setCacheSummaries] = useState<ModelCacheSummary[]>([]);
  const [cacheInventoryResolved, setCacheInventoryResolved] = useState(false);
  const [startupCleanupStatus, setStartupCleanupStatus] = useState<StartupCleanupStatus>("idle");
  const [startupCleanupRetryRevision, setStartupCleanupRetryRevision] = useState(0);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [storageRevision, setStorageRevision] = useState(0);
  const [autoRestoreEnabled, setAutoRestoreEnabled] = useState(true);
  const generationIdRef = useRef(0);
  const dialogScrollSnapshotRef = useRef<DocumentScrollSnapshot | null>(null);
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
  const isProbingModelFiles = downloadProgress?.stage === "probe";
  const downloadPercent = downloadProgress && !isProbingModelFiles
    ? Math.floor(downloadProgress.loaded / downloadProgress.total * 1_000) / 10
    : undefined;
  const downloadPercentLabel = formatDownloadPercent(isProbingModelFiles ? undefined : downloadProgress);
  const downloadStatus = getDownloadStageLabel(downloadProgress?.stage, true);
  const isNetworkDownload = downloadProgress?.stage === "download" || downloadProgress?.stage === "resume";
  const availableModels = [...MODEL_REGISTRY, ...communityModels];
  const selectedModel = availableModels.find((model) => model.id === modelId) ?? null;
  const loadingModel = selectedModel;
  const modelLoadCancelLabel = isNetworkDownload ? "Pause model download" : "Cancel model loading";
  const modelLoadCancelText = isNetworkDownload ? "Pause" : "Cancel";
  const recommendedModel = availableModels.find((model) => model.id === RECOMMENDED_MODEL_ID)!;
  const recommendedCache = cacheSummaries.find((model) => model.modelId === RECOMMENDED_MODEL_ID);
  const recommendedCompatibility = getModelCompatibility(capabilities, recommendedModel);
  const pendingModelDownload = availableModels.find((model) => model.id === pendingModelDownloadId) ?? null;
  const pendingModelDownloadCache = cacheSummaries.find((model) => model.modelId === pendingModelDownloadId);
  const pendingModelPlan = pendingModelDownloadId
    ? createModelReplacementPlan(pendingModelDownloadId, cacheSummaries)
    : null;
  const pendingReplacementModels: ModelManifest[] = pendingModelPlan?.sourceModelIds.flatMap((sourceModelId) => {
    const source = availableModels.find((model) => model.id === sourceModelId);
    return source ? [source] : [];
  }) ?? [];
  const pendingDeleteModel = availableModels.find((model) => model.id === pendingDeleteModelId) ?? null;
  const pendingDeleteSummary = cacheSummaries.find((model) => model.modelId === pendingDeleteModelId);
  const pendingDeleteBytes = pendingDeleteSummary?.state === "partial" ? pendingDeleteSummary.resumableBytes : pendingDeleteSummary?.totalBytes;
  const modelCompatibility = getModelCompatibility(capabilities, selectedModel);
  const modelReady = selectedModel !== null && loadedModelId === selectedModel.id;
  const developerMode = interfaceMode === "developer";
  const runtimeStatus = getRuntimeStatus(capabilities, selectedModel, loadedModelId, runtimeActivity, modelLoadPaused, failedTurn, error);
  const storageLabel = browserStorage === undefined ? "Checking…" : browserStorage === null ? "Unavailable" : `${formatStorageBytes(browserStorage.usage)} / ${formatStorageBytes(browserStorage.quota)} · ${browserStorage.persistent ? "Persistent" : "Best effort"}`;
  const promptDisabled = !modelReady || modelCompatibility !== "compatible";
  const canSend = modelReady && prompt.trim().length > 0 && !isBusy && modelCompatibility === "compatible";
  const canResetConversation = messages.length > STARTER_MESSAGES.length
    || prompt.length > 0
    || (error !== null && startupCleanupStatus !== "failed")
    || failedTurn !== null;
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
  const replacingModel = modelReplacementPhase !== null;
  const storageReconciliationBlocked = startupCleanupStatus === "cleaning" || startupCleanupStatus === "failed";

  useDocumentScrollLock(blockingDialogOpen, dialogScrollSnapshotRef);

  useEffect(() => {
    if (productTestState !== null) return;
    let active = true;
    void listSavedCommunityModelDescriptors()
      .then((descriptors) => {
        if (active) setCommunityModels(descriptors.map(communityDescriptorToManifest));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [productTestState]);

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
      setModelReplacementPhase(snapshot.modelReplacementPhase);
      setPendingDeleteModelId(null);
      setResetConfirmationOpen(snapshot.resetConfirmationOpen);
      setCapabilities(snapshot.capabilities);
      setBrowserStorage(snapshot.browserStorage);
      setCacheSummaries(snapshot.cacheSummaries);
      setCacheInventoryResolved(snapshot.cacheInventoryResolved);
      setStartupCleanupStatus(snapshot.startupCleanupStatus);
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
    let inventoryTimedOut = false;
    const inventoryFallbackTimer = window.setTimeout(() => {
      if (!active) return;
      inventoryTimedOut = true;
      setCacheSummaries([]);
      setCacheInventoryResolved(true);
      setNotice("Glaux couldn’t check for saved model data. You can still choose a model to download.");
    }, 5_000);
    void (async () => {
      let models = await getCachedModels();
      if (!active || inventoryTimedOut) return;
      window.clearTimeout(inventoryFallbackTimer);
      setStartupCleanupStatus("idle");
      const cleanupPlan = createStartupModelCleanupPlan(models);
      if (cleanupPlan.requiresCleanup) {
        if (!active) return;
        setStartupCleanupStatus("cleaning");
        setError(null);
        setNotice(null);
        generationIdRef.current += 1;
        try {
          models = await runStartupModelCleanup(cleanupPlan, {
            deleteStoredModel: async (modelToDelete) => {
              setDeletingModelId(modelToDelete);
              await deleteCachedModel(modelToDelete);
              forgetRememberedModelId(modelToDelete);
            },
            onPhaseChange: setModelReplacementPhase,
            readCacheSummaries: getCachedModels,
            stopActiveModel: async () => {
              await cancelModelPreload().catch(() => terminateRuntimeWorker());
              setModelId("");
              setLoadedModelId(null);
              setModelLoadPaused(false);
              setGeneration({ status: "idle" });
            }
          });
          if (!active) return;
          setStorageRevision((value) => value + 1);
          setNotice("Old model files were removed. Choose a model to download.");
          setStartupCleanupStatus("idle");
        } catch (caught) {
          if (!active) return;
          const refreshed = await getCachedModels().catch(() => models);
          setCacheSummaries(refreshed);
          setStartupCleanupStatus("failed");
          setError(caught instanceof Error
            ? caught.message
            : "Glaux could not remove old model files.");
          return;
        } finally {
          if (active) {
            setDeletingModelId(null);
            setModelReplacementPhase(null);
          }
        }
      }
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
    })()
      .catch(() => {
        if (!active || inventoryTimedOut) return;
        window.clearTimeout(inventoryFallbackTimer);
        setCacheSummaries([]);
        setCacheInventoryResolved(true);
        setNotice("Glaux couldn’t check for saved model data. You can still choose a model to download.");
      });
    return () => {
      active = false;
      window.clearTimeout(inventoryFallbackTimer);
    };
  }, [autoRestoreEnabled, productTestState, startupCleanupRetryRevision, storageRevision]);

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
      captureDialogScrollSnapshot(dialogScrollSnapshotRef);
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
    clearConversationState();
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

  function addCommunityModel(descriptor: CommunityModelDescriptor) {
    const model = communityDescriptorToManifest(descriptor);
    setCommunityModels((current) => current.some((entry) => entry.id === model.id) ? current : [...current, model]);
    setLibraryModelId(model.id);
    requestModelAction(model.id);
  }

  function chooseLibraryModel(nextModelId: string) {
    const target = availableModels.find((model) => model.id === nextModelId);
    if (!target) return;
    const cache = cacheSummaries.find((model) => model.modelId === nextModelId);
    if (cache?.state === "cached") {
      const plan = createModelReplacementPlan(nextModelId, cacheSummaries);
      if (plan.requiresReplacement) {
        requestModelAction(nextModelId);
      } else {
        selectModel(nextModelId);
        if (modelSidebarOpen) setModelSidebarOpen(false);
      }
    } else {
      setLibraryModelId(nextModelId);
    }
  }

  function requestModelDownload(nextModelId: string) {
    const target = availableModels.find((model) => model.id === nextModelId);
    if (!target) return;
    const cache = cacheSummaries.find((model) => model.modelId === nextModelId);
    if (cache?.state === "cached") {
      const plan = createModelReplacementPlan(nextModelId, cacheSummaries);
      if (plan.requiresReplacement) requestModelAction(nextModelId);
      else {
        selectModel(nextModelId);
        if (modelSidebarOpen) setModelSidebarOpen(false);
      }
      return;
    }
    const plan = createModelReplacementPlan(nextModelId, cacheSummaries);
    if (plan.requiresReplacement) {
      requestModelAction(nextModelId);
    } else {
      setLibraryModelId(nextModelId);
      requestModelAction(nextModelId);
    }
  }

  function requestModelAction(nextModelId: string) {
    modelDownloadTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modelDownloadFromMobileRef.current = modelSidebarOpen;
    captureDialogScrollSnapshot(dialogScrollSnapshotRef);
    setPendingModelDownloadId(nextModelId);
    if (modelSidebarOpen) setModelSidebarOpen(false);
  }

  function closeModelDownloadConfirmation() {
    if (modelReplacementPhase) return;
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
    const plan = createModelReplacementPlan(targetModelId, cacheSummaries);
    if (productTestState) {
      const activity = plan.action === "activate"
        ? null
        : createFixtureDownloadActivity(plan.action === "resume" ? "resume" : "download");
      setCacheSummaries((current) => current.map((summary) => {
        if (summary.modelId === targetModelId && activity) {
          return {
            ...summary,
            state: "partial",
            resumableBytes: activity.progress?.loaded ?? 0,
            verifiedBytes: activity.progress?.loaded ?? 0
          };
        }
        if (plan.sourceModelIds.includes(summary.modelId)) {
          return { ...summary, state: "missing", resumableBytes: 0, verifiedBytes: 0 };
        }
        return summary;
      }));
      setPendingModelDownloadId(null);
      selectModel(targetModelId);
      if (activity) setGeneration({ status: "loading", activity });
      else setLoadedModelId(targetModelId);
      return;
    }

    if (!plan.requiresReplacement) {
      setPendingModelDownloadId(null);
      selectModel(targetModelId);
      return;
    }

    setError(null);
    setNotice(null);
    generationIdRef.current += 1;
    try {
      const next = await runModelReplacement(plan, {
        deleteStoredModel: async (sourceModelId) => {
          setDeletingModelId(sourceModelId);
          await deleteCachedModel(sourceModelId);
          forgetRememberedModelId(sourceModelId);
        },
        onPhaseChange: setModelReplacementPhase,
        readCacheSummaries: getCachedModels,
        stopActiveModel: async () => {
          await cancelModelPreload().catch(() => terminateRuntimeWorker());
          setModelId("");
          setLoadedModelId(null);
          setModelLoadPaused(false);
          setGeneration({ status: "idle" });
        }
      });
      setCacheSummaries(next);
      setStorageRevision((value) => value + 1);
      setPendingModelDownloadId(null);
      selectModel(targetModelId);
    } catch (caught) {
      const refreshed = await getCachedModels().catch(() => null);
      if (refreshed) setCacheSummaries(refreshed);
      setPendingModelDownloadId(null);
      setError(caught instanceof Error
        ? caught.message
        : `Glaux could not replace the saved model with ${modelName(targetModelId)}.`);
    } finally {
      setDeletingModelId(null);
      setModelReplacementPhase(null);
    }
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
        ? `${cancelledModel.label} download paused. Glaux will check saved progress when you resume.`
        : `${cancelledModel.label} loading paused. Downloaded files remain available in this browser.`
      : pausedNetworkDownload ? "Model download paused." : "Model loading cancelled.");
    setStorageRevision((value) => value + 1);
  }

  function requestDeleteModelDownload(targetModelId: string) {
    if (!availableModels.some((model) => model.id === targetModelId)) return;
    modelDeleteTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modelDeleteFromMobileRef.current = modelSidebarOpen;
    captureDialogScrollSnapshot(dialogScrollSnapshotRef);
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
    const target = availableModels.find((model) => model.id === targetModelId);
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
      setError("Choose an ONNX Community model before sending a message.");
      return;
    }

    if (modelCompatibility !== "compatible") {
      setError(modelCompatibility === "probing"
        ? "Glaux is still checking this browser's GPU support."
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
    <main className={cn("sophon-stage relative w-full bg-sophon-canvas text-foreground", selectedModel ? "h-svh overflow-hidden" : "min-h-svh")} data-inference={isBusy ? "active" : "idle"} data-product-test-state={productTestState ?? undefined}>
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-45" />
      <div className={cn("relative flex w-full flex-col bg-transparent", selectedModel ? "h-svh" : "min-h-svh")}>
        <header className={cn("sophon-glass-strong sophon-reveal sophon-reveal-header relative z-20 shrink-0 items-center border-x-0 border-t-0", selectedModel ? "grid h-[calc(106px+env(safe-area-inset-top))] grid-cols-[minmax(0,1fr)_auto] grid-rows-[28px_44px] gap-x-2 gap-y-2 px-3 pb-[10px] pt-[calc(8px+env(safe-area-inset-top))] sm:h-[calc(120px+env(safe-area-inset-top))] sm:grid-rows-[40px_36px] sm:px-7 sm:pb-3 sm:pt-[calc(12px+env(safe-area-inset-top))] lg:flex lg:h-auto lg:justify-between lg:gap-0 lg:p-4" : "flex h-[calc(106px+env(safe-area-inset-top))] justify-between px-3 pb-8 pt-[env(safe-area-inset-top)] sm:h-auto sm:p-4")} data-testid="workbench-header">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3" data-testid="workbench-brand">
            <div aria-label="Glaux logo" className="sophon-accent-surface sophon-mark relative grid size-10 shrink-0 place-items-center border border-sophon-signal-bright/60" role="img">
              <MoonStar aria-hidden="true" className="size-5 stroke-[1.7]" />
            </div>
            <div className={cn("min-w-0", selectedModel && "max-[359px]:hidden")}>
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-sm font-semibold tracking-[0.12em] text-sophon-copy-primary">GLAUX</h1>
                <span className="sophon-type-decorative hidden items-center rounded-md border border-sophon-signal-bright/40 bg-sophon-signal/10 px-2 py-0.5 font-mono font-medium uppercase tracking-[0.12em] text-sophon-signal-soft xl:inline-flex" data-typography-role="decorative">Open-source local AI</span>
              </div>
              <p className="sophon-type-metadata hidden whitespace-nowrap font-mono uppercase tracking-[0.12em] text-sophon-copy-metadata xl:block" data-typography-role="metadata">Multilingual AI, in your browser</p>
            </div>
          </div>

          <div className={cn("sophon-glass-tile sophon-type-status flex min-w-0 items-center justify-center gap-2 rounded-full px-3 py-1 font-mono uppercase tracking-[0.08em] sm:py-1.5", selectedModel ? "col-span-2 sm:col-span-1 sm:justify-self-end lg:static lg:inset-auto lg:shrink-0" : "absolute inset-x-3 bottom-2 sm:static sm:inset-auto sm:shrink-0", runtimeStatus.className)} data-testid="workbench-status" data-typography-role="status">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", runtimeStatus.dotClassName)} />
            <span className="truncate">{runtimeStatus.label}{downloadPercentLabel ? ` · ${downloadPercentLabel}` : null}</span>
          </div>

          <div className={cn("items-center [&_button:hover]:translate-y-0", selectedModel ? "col-span-2 flex w-full justify-end gap-1 [&_button]:gap-1 sm:gap-2 lg:col-span-1 lg:w-auto lg:shrink-0 lg:gap-3 lg:[&_button]:gap-2" : "flex shrink-0 gap-1.5 sm:gap-3")} data-testid="workbench-actions">
            {generation.status === "loading" ? <Button aria-label={modelLoadCancelLabel} className="size-10 rounded-xl p-0" onClick={cancelModelLoad} size="sm" title={modelLoadCancelLabel} type="button" variant="sophon"><Square aria-hidden="true" className="size-3 fill-current" /><span className="sr-only">{modelLoadCancelText}</span></Button> : null}
            {modelLoadPaused && selectedModel ? <Button aria-label="Resume model download" className="size-10 rounded-xl p-0" onClick={resumeModelLoad} size="sm" title="Resume model download" type="button" variant="sophon"><Download aria-hidden="true" /><span className="sr-only">Resume</span></Button> : null}
            {canResetConversation && !isBusy ? (
              <Button aria-label="Reset conversation" className="size-10 rounded-xl p-0 text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive" disabled={isBusy} onClick={requestResetConversation} ref={resetTriggerRef} size="sm" title="Reset conversation" type="button" variant="sophon">
                <Trash2 aria-hidden="true" />
                <span className="sr-only">Reset</span>
              </Button>
            ) : null}
            {modelReady ? (
              <ToggleGroup aria-label="Interface mode" className="h-10 gap-0 rounded-xl border border-sophon-glass-border bg-sophon-panel-deep p-0.5 shadow-[inset_0_1px_0_var(--sophon-glass-highlight)]" data-mode={interfaceMode} data-testid="interface-mode-toggle" onValueChange={(value) => { if (value === "chat" || value === "developer") setInterfaceMode(value); }} type="single" value={interfaceMode}>
                <ToggleGroupItem aria-label="Chat mode" className="size-9 rounded-lg bg-transparent p-0 text-sophon-copy-metadata shadow-[inset_0_0_0_1px_var(--sophon-glass-border)] data-[state=on]:bg-sophon-signal data-[state=on]:text-white data-[state=on]:shadow-none" title="Chat mode" value="chat"><MessageCircle aria-hidden="true" className="size-4" /><span className="sr-only">Chat</span></ToggleGroupItem>
                <ToggleGroupItem aria-label="Developer mode" className="size-9 rounded-lg bg-transparent p-0 text-sophon-copy-metadata shadow-[inset_0_0_0_1px_var(--sophon-glass-border)] data-[state=on]:bg-sophon-signal data-[state=on]:text-white data-[state=on]:shadow-none" title="Developer mode" value="developer"><Code2 aria-hidden="true" className="size-4" /><span className="sr-only">Developer</span></ToggleGroupItem>
              </ToggleGroup>
            ) : null}
            <GlauxAcknowledgements className="size-10 rounded-xl p-0 sm:!size-10" compact />
            <Button aria-controls="model-library-mobile" aria-expanded={modelSidebarOpen} aria-label="Open model library" className="size-10 rounded-xl p-0 lg:hidden" data-testid="open-model-library" onClick={() => setModelSidebarOpen(true)} size="sm" type="button" variant="sophon"><PanelLeft aria-hidden="true" /><span className="sr-only">Models</span></Button>
          </div>
          {isModelLoading && loadingModel && !isProbingModelFiles ? <span aria-label={`Loading ${loadingModel.label}`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={downloadPercent} aria-valuetext={downloadProgress ? formatDownloadAriaText(downloadProgress) : "Preparing model delivery"} className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-sophon-panel-deep" role="progressbar"><span className={cn("block h-full bg-gradient-to-r from-sophon-signal to-sophon-signal-bright shadow-[0_0_12px_var(--sophon-signal-bright)] transition-[width] duration-200 motion-reduce:transition-none", downloadPercent === undefined && "w-1/3 motion-reduce:animate-none")} style={downloadPercent === undefined ? undefined : { width: `${downloadPercent}%` }} /></span> : null}
        </header>

        <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">{runtimeStatus.label}</div>

        <div className={cn("flex flex-1", selectedModel ? "min-h-0" : "min-h-fit")}>
          <GlauxModelSidebar activeModelId={modelId} cacheSummaries={cacheSummaries} capabilities={capabilities} communityModels={communityModels} deletingModelId={deletingModelId} disabled={isRunning || replacingModel || storageReconciliationBlocked} downloadPercent={downloadPercent} downloadPercentLabel={downloadPercentLabel} inspectMetrics={hoveredInspectMetrics} inspectMode={developerMode} inspectDisplayMode={inspectDisplayMode} loadedModelId={loadedModelId} loading={isModelLoading} loadingLabel={downloadStatus} mobileOpen={modelSidebarOpen} modelId={libraryModelId} onCommunityModelAdded={addCommunityModel} onDelete={requestDeleteModelDownload} onDownload={requestModelDownload} onInspectDisplayModeChange={setInspectDisplayMode} onInspectModeChange={(enabled) => setInterfaceMode(enabled ? "developer" : "chat")} onMobileOpenChange={setModelSidebarOpen} onSelect={chooseLibraryModel} recommendedModelId={RECOMMENDED_MODEL_ID} />
          <section aria-busy={isBusy} aria-label="Conversation" className={cn("sophon-reveal sophon-reveal-workspace relative flex min-w-0 flex-1 flex-col", selectedModel && "h-full min-h-0")}>
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
                      />
                    ) : (
                      <FirstRunCheck
                        error={startupCleanupStatus === "failed" ? error : null}
                        onRetry={() => {
                          setError(null);
                          setStartupCleanupRetryRevision((value) => value + 1);
                        }}
                        status={startupCleanupStatus}
                      />
                    )
                  ) : displayedMessages.map((message, index) => (
                    <article aria-label={message.role === "user" ? "Message from you" : "Message from Glaux"} className={cn("group/message relative flex w-full min-w-0 gap-3 text-sm", message.role === "user" && "flex-row-reverse")} key={message.id}>
                      <div className={cn("flex size-8 shrink-0 items-center justify-center self-end overflow-hidden", message.role === "user" ? "sophon-accent-avatar !self-start mt-1 rounded-xl border border-sophon-signal-bright/50" : "sophon-glass-tile !self-start mt-1 rounded-xl text-sophon-signal-soft")}>
                        {message.role === "user" ? <CircleUserRound aria-hidden="true" className="size-4" /> : <MoonStar aria-hidden="true" className="size-4" />}
                      </div>
                      <div className="flex w-full min-w-0 flex-col gap-2.5 max-w-[calc(100%_-_2.75rem)] sm:max-w-[min(920px,calc(100%_-_3rem))]">
                          <InspectableMessage
                          actions={<MessageActions
                            canEdit={!isBusy && message.role === "user" && message.id !== "assistant-welcome"}
                            canRegenerate={!isBusy && message.role === "assistant" && index === messages.length - 1 && index > 0}
                            copied={copiedMessageId === message.id}
                            onCopy={() => void copyMessage(message)}
                            onEdit={() => editMessage(message, index)}
                            onRegenerate={() => regenerateLatest(index)}
                            role={message.role}
                          />}
                          content={message.content}
                          developerMode={developerMode}
                          inspectMode={developerMode ? inspectDisplayMode : null}
                          key={`${message.id}-${interfaceMode}`}
                          meta={message.meta}
                          onInspectHover={setHoveredInspectMetrics}
                          role={message.role}
                          showMeta={developerMode || message.id === "assistant-welcome"}
                          tokens={message.tokens}
                        />
                      </div>
                    </article>
                  ))}
                  {isRunning ? (
                    <article aria-label={generation.draft.trim() ? "Glaux is responding" : `Glaux status: ${runtimeActivity?.label ?? "Generating response"}`} aria-live="off" className="group/message relative flex w-full min-w-0 gap-3 text-sm">
                      <div className="sophon-glass-tile !self-start mt-1 flex size-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-xl text-sophon-signal-soft"><MoonStar aria-hidden="true" className="size-4 animate-pulse motion-reduce:animate-none" /></div>
                      <div className="flex w-full min-w-0 flex-col gap-2.5 max-w-[calc(100%_-_2.75rem)] sm:max-w-xl">
                        <Card className="w-full max-w-full overflow-hidden rounded-xl border-sophon-glass-border bg-sophon-panel shadow-none">
                          {generation.draft.trim() ? (
                            <CardContent className="sophon-glass-tile block w-full overflow-hidden rounded-xl p-0">
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
                            </CardContent>
                          ) : (
                            <CardContent className="sophon-glass-tile flex w-full items-center gap-3 rounded-xl px-4 py-3">
                              <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-sophon-signal-soft motion-reduce:animate-none" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-sophon-copy-primary">{runtimeActivity?.label ?? "Generating response"}</span>
                                {runtimeActivity?.detail ? <span className="sophon-type-metadata mt-0.5 block truncate text-sophon-copy-metadata" data-typography-role="metadata">{runtimeActivity.detail}</span> : null}
                              </span>
                              <Button aria-label="Stop generation" className="shrink-0" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                                <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                              </Button>
                            </CardContent>
                          )}
                        </Card>
                      </div>
                    </article>
                  ) : null}
                  <div aria-hidden="true" ref={messageEndRef} />
                </div>
              </div>
            </div>

            {selectedModel ? (
              <div className="sophon-glass-strong sophon-reveal sophon-reveal-composer z-10 shrink-0 border-x-0 border-b-0 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="composer-panel">
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
                <label className="sr-only" htmlFor="sophon-prompt">Message Glaux</label>
                <div className="sophon-glass-tile sophon-glass-interactive relative overflow-hidden rounded-2xl before:pointer-events-none before:absolute before:inset-y-3 before:left-0 before:z-10 before:w-px before:bg-sophon-glass-highlight after:pointer-events-none after:absolute after:inset-y-3 after:right-0 after:z-10 after:w-px after:bg-sophon-glass-highlight">
                  <Textarea
                    aria-describedby="prompt-help"
                    className="flex min-h-20 max-h-[7.5rem] w-full resize-none overflow-y-auto rounded-md border-0 bg-transparent px-3 py-2 pr-14 text-[15px] leading-6 text-sophon-copy-primary shadow-none placeholder:text-sophon-copy-decorative focus-visible:outline-none disabled:cursor-not-allowed disabled:text-sophon-copy-disabled sm:max-h-48"
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
                      {selectedModel ? `${modelName(selectedModel.id)} · on-device` : "Choose a model to unlock chat"}
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
                <footer className="sophon-type-metadata mt-2 flex min-w-0 items-center gap-2 overflow-x-auto rounded-xl border border-sophon-glass-border bg-sophon-panel-deep px-2.5 py-1.5 font-mono text-[10px] uppercase leading-4 tracking-[0.04em] text-sophon-copy-metadata [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-typography-role="metadata">
                  <span className={cn("flex shrink-0 items-center whitespace-nowrap text-sophon-copy-body", modelCompatibility === "incompatible" && "text-destructive")} id="prompt-help">
                    {downloadProgress ? (
                      downloadProgress.stage === "probe" ? (
                        <>
                          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-sophon-signal-soft motion-reduce:animate-none" />
                          <span>Checking files</span>
                        </>
                      ) : (
                      <>
                        <span className="sr-only">Downloading model · </span>
                        <span aria-label={`Downloaded ${formatStorageBytes(downloadProgress.loaded)} of ${formatStorageBytes(downloadProgress.total)}`} className="flex items-center gap-1.5 rounded border border-sophon-glass-border bg-sophon-glass-tile px-1.5">
                          <Download aria-hidden="true" className="size-3.5 text-sophon-signal-soft" />
                          <span className="tabular-nums">{formatStorageBytes(downloadProgress.loaded)} / {formatStorageBytes(downloadProgress.total)}</span>
                        </span>
                        {(downloadProgress.bytesPerSecond !== undefined || downloadProgress.etaMs !== undefined) ? <span className="ml-2 flex items-center gap-1.5 border-l border-sophon-glass-border pl-2" aria-label={`${downloadProgress.bytesPerSecond !== undefined ? `Download speed ${formatStorageBytes(downloadProgress.bytesPerSecond)} per second` : ""}${downloadProgress.etaMs !== undefined ? `; ${formatEta(downloadProgress.etaMs)} remaining` : ""}`}>
                          <Gauge aria-hidden="true" className="size-3.5 text-sophon-copy-decorative" />
                          {downloadProgress.bytesPerSecond !== undefined ? <span className="tabular-nums">{formatStorageBytes(downloadProgress.bytesPerSecond)}/s</span> : null}
                          {downloadProgress.etaMs !== undefined ? <span className="tabular-nums">{formatEta(downloadProgress.etaMs)}</span> : null}
                        </span> : null}
                      </>
                      )
                    ) : promptHelp === PROMPT_SHORTCUT_HELP ? (
                      <><span className="sm:hidden">Enter sends</span><span className="hidden sm:inline">{PROMPT_SHORTCUT_HELP}</span></>
                    ) : <span>{promptHelp}</span>}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-sophon-glass-border pl-2 whitespace-nowrap">
                    <HardDrive aria-hidden="true" className="size-3.5 text-sophon-copy-decorative" />
                    <p data-state={browserStorage === undefined ? "checking" : browserStorage === null ? "unavailable" : "ready"} data-testid="browser-storage">
                      <span className="sr-only">Browser storage · </span><span className="tabular-nums text-sophon-copy-body">{storageLabel}</span>
                    </p>
                    <a aria-label="Privacy" className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded border border-sophon-glass-border bg-sophon-glass-tile text-sophon-copy-primary transition-colors hover:border-sophon-signal-bright/55 hover:text-sophon-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal" data-typography-role="action" href={PRIVACY_PATH} title="Privacy"><ShieldCheck aria-hidden="true" className="size-3" /></a>
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
          busy={replacingModel}
          busyLabel={getReplacementBusyLabel(modelReplacementPhase, pendingReplacementModels)}
          cancelAriaLabel={getModelActionCancelLabel(pendingModelPlan)}
          cancelLabel="Keep"
          confirmAriaLabel={getModelActionLabel(pendingModelPlan)}
          confirmLabel="Replace"
          confirmTone="default"
          description={getModelActionDescription(pendingModelDownload, pendingModelDownloadCache, browserStorage, pendingModelPlan)}
          details={pendingModelPlan?.requiresReplacement ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-sophon-glass-border bg-sophon-panel-deep text-sm">
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-sophon-glass-border px-3 py-2">
                <span className="text-sophon-copy-metadata">Remove</span>
                <span className="min-w-0 font-medium text-sophon-copy-primary">{pendingReplacementModels.map((model) => model.label.split(" · ")[0]).join(", ")}</span>
                <span className="tabular-nums text-sophon-copy-metadata">{formatStorageBytes(pendingModelPlan.bytesToRemove)}</span>
              </div>
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2">
                <span className="text-sophon-copy-metadata">Download</span>
                <span className="min-w-0 font-medium text-sophon-copy-primary">{pendingModelDownload.label.split(" · ")[0]}</span>
                <span className="tabular-nums text-sophon-copy-metadata">{pendingModelDownload.format.sizeLabel}</span>
              </div>
            </div>
          ) : null}
          onCancel={closeModelDownloadConfirmation}
          onConfirm={() => void confirmModelDownload()}
          title={getModelActionTitle(pendingModelDownload, pendingModelPlan)}
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

function FirstRunCheck({ error, onRetry, status }: {
  error: string | null;
  onRetry: () => void;
  status: StartupCleanupStatus;
}) {
  const cleaning = status === "cleaning";
  const failed = status === "failed";
  return (
    <div className="sophon-glass-tile mx-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-2xl px-5 py-4" role={failed ? "alert" : "status"}>
      {failed
        ? <Trash2 aria-hidden="true" className="size-5 shrink-0 text-destructive" />
        : <LoaderCircle aria-hidden="true" className="size-5 shrink-0 animate-spin text-sophon-signal-soft motion-reduce:animate-none" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-sophon-copy-primary">
          {failed ? "Old model files could not be removed" : cleaning ? "Cleaning up old model files" : "Checking this browser"}
        </span>
        <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">
          {failed ? error : cleaning ? "Removing legacy downloads before Glaux starts…" : "Looking for a model you have already downloaded…"}
        </span>
      </span>
      {failed ? <Button className="ml-auto h-11 shrink-0 rounded-xl max-[359px]:basis-full sm:h-8" onClick={onRetry} size="sm" type="button" variant="sophon">Retry cleanup</Button> : null}
    </div>
  );
}

function FirstRunWelcome({ compatibility, notice, onDismissNotice, onOpenModels }: {
  cacheState?: ModelCacheSummary["state"];
  compatibility: ReturnType<typeof getModelCompatibility>;
  mobileProfile: boolean;
  model: ModelManifest;
  notice: string | null;
  onDismissNotice: () => void;
  onOpenModels: () => void;
}) {

  return (
    <section aria-labelledby="first-run-title" className="mx-auto w-full max-w-3xl" data-testid="first-run-welcome">
      {notice ? (
        <div className="sophon-glass-tile mb-3 flex items-center gap-3 rounded-xl border-sophon-glass-border px-4 py-3 text-sm text-sophon-copy-body" role="status">
          <span className="min-w-0 flex-1">{notice}</span>
          <Button className="h-11 shrink-0 rounded-xl sm:h-8" onClick={onDismissNotice} size="sm" type="button" variant="sophon">Dismiss</Button>
        </div>
      ) : null}
      <div className="sophon-first-run-card sophon-glass-strong sophon-reveal sophon-reveal-hero overflow-hidden rounded-2xl">
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="sophon-type-decorative mb-2 flex items-center gap-1.5 font-mono font-semibold uppercase tracking-[0.12em] text-sophon-signal-soft" data-typography-role="decorative">
            <Sparkles aria-hidden="true" className="size-3.5" />
            Start here
          </div>
          <h2 className="max-w-2xl font-serif text-[2rem] leading-[1.02] tracking-[-0.025em] text-sophon-copy-primary sm:text-[2.25rem] lg:text-[2.75rem]" id="first-run-title">Multilingual AI that runs locally</h2>
          <p className="sophon-type-body mt-2 max-w-2xl text-sophon-copy-body" data-typography-role="body">
            Search Hugging Face ONNX Community models, then run a compatible model locally with WebGPU. No account is needed, and your prompts and responses are not sent to an inference server.
          </p>

          <div className="mt-4 rounded-xl border border-sophon-glass-border bg-sophon-glass-tile p-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3" data-testid="first-run-recommended">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg border border-sophon-glass-border bg-sophon-panel-deep text-sophon-signal-soft" data-testid="first-run-recommended-icon">
              <Languages className="size-4.5" />
            </span>
            <div className="mt-3 min-w-0 sm:mt-0" data-testid="first-run-recommended-details">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-base font-semibold text-sophon-copy-primary">Hugging Face ONNX Community</h3>
                <span aria-label="Community model search" className="sophon-verified-emphasis grid size-4 place-items-center rounded-full bg-sophon-verified-bright text-sophon-on-verified" title="Community model search">
                  <Sparkles aria-hidden="true" className="size-2.5" />
                </span>
              </div>
              <p className="sophon-type-metadata mt-1 text-sophon-copy-metadata" data-typography-role="metadata">Visit the ONNX Community page on Hugging Face to browse available models.</p>
            </div>
            <Button
              asChild
              className="sophon-accent-surface mt-3 h-11 w-full shrink-0 rounded-lg px-3 sm:mt-0 sm:w-auto"
              data-testid="first-run-primary"
            >
              <a aria-label="Visit the Hugging Face ONNX Community (opens in a new tab)" href={ONNX_COMMUNITY_URL} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" /><span>View on Hugging Face</span>
              </a>
            </Button>
          </div>
          {compatibility === "incompatible" ? (
            <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-5 text-destructive" role="alert">
              This device does not expose the browser GPU support required to run this model locally.
            </p>
          ) : null}

          <div className="mt-3 grid overflow-hidden rounded-xl border border-sophon-glass-border bg-sophon-glass-tile sm:grid-cols-2 sm:divide-x sm:divide-sophon-glass-border">
            <div className="flex items-start gap-2 px-3 py-2.5">
              <span aria-hidden="true" className="sophon-verified-emphasis mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-sophon-verified-bright">
                <Hammer className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-sophon-copy-primary">Stays local</span>
                <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">Chats run in this browser, not an inference server.</span>
              </span>
            </div>
            <div className="flex items-start gap-2 border-t border-sophon-glass-border px-3 py-2.5 sm:border-t-0">
              <span aria-hidden="true" className="sophon-verified-emphasis mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-sophon-verified-bright">
                <Download className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-sophon-copy-primary">Download once</span>
                <span className="sophon-type-metadata mt-0.5 block text-sophon-copy-metadata" data-typography-role="metadata">Choose a compatible model and confirm its exact download size.</span>
              </span>
            </div>
          </div>
          <div className="sophon-type-metadata mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-sophon-glass-border pt-3 text-sophon-copy-metadata" data-typography-role="metadata">
            <span>Open weights</span>
            <span aria-hidden="true">·</span>
            <span>Model-specific licenses</span>
            <span aria-hidden="true">·</span>
            <span>Stores one model locally</span>
            <Button className="h-11 rounded-lg px-2.5 sm:h-8 lg:hidden" onClick={onOpenModels} size="sm" type="button" variant="sophon">Browse models</Button>
          </div>
          <nav aria-label="First-run resources" className="mt-3 flex items-center justify-between gap-3 border-t border-sophon-glass-border pt-3" data-testid="first-run-trust-nav">
            <p className="sophon-type-decorative shrink-0 font-mono font-semibold uppercase tracking-[0.1em] text-sophon-copy-decorative" data-typography-role="decorative">Resources</p>
            <div className="flex items-center gap-1">
              <a aria-label="Source (opens in a new tab)" className="inline-flex size-9 items-center justify-center rounded-lg border border-sophon-glass-border bg-sophon-glass-strong text-sophon-copy-primary transition-colors hover:border-sophon-signal-bright/55 hover:bg-sophon-glass-tile hover:text-sophon-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal" href={PROJECT_REPOSITORY_URL} rel="noreferrer" target="_blank" title="Source">
                <Code2 aria-hidden="true" className="size-4" />
              </a>
              <a aria-label="Privacy" className="inline-flex size-9 items-center justify-center rounded-lg border border-sophon-glass-border bg-sophon-glass-strong text-sophon-copy-primary transition-colors hover:border-sophon-signal-bright/55 hover:bg-sophon-glass-tile hover:text-sophon-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal" href={PRIVACY_PATH} title="Privacy">
                <ShieldCheck aria-hidden="true" className="size-4" />
              </a>
              <GlauxAcknowledgements ariaLabel="About & licenses" className="size-9 rounded-lg border border-sophon-glass-border bg-sophon-glass-strong hover:border-sophon-signal-bright/55 hover:bg-sophon-glass-tile sm:size-9" compact />
              <a aria-label="Support (opens in a new tab)" className="inline-flex size-9 items-center justify-center rounded-lg border border-sophon-glass-border bg-sophon-glass-strong text-sophon-copy-primary transition-colors hover:border-sophon-signal-bright/55 hover:bg-sophon-glass-tile hover:text-sophon-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-signal" href={PROJECT_SUPPORT_URL} rel="noreferrer" target="_blank" title="Support">
                <LifeBuoy aria-hidden="true" className="size-4" />
              </a>
            </div>
          </nav>
        </div>
      </div>
    </section>
  );
}

function ConfirmationDialog({ busy = false, busyLabel, cancelAriaLabel, cancelLabel, confirmAriaLabel, confirmLabel, confirmTone = "destructive", description, details, onCancel, onConfirm, title }: {
  busy?: boolean;
  busyLabel?: string;
  cancelAriaLabel?: string;
  cancelLabel: string;
  confirmAriaLabel?: string;
  confirmLabel: string;
  confirmTone?: "default" | "destructive";
  description: string;
  details?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const titleId = useId();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
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
        {details}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button aria-label={cancelAriaLabel} className="h-10 min-w-0 rounded-xl px-3 sm:h-9" disabled={busy} onClick={onCancel} ref={cancelRef} type="button" variant="sophon">{cancelLabel}</Button>
          <Button aria-label={confirmAriaLabel} className={cn("h-10 min-w-0 rounded-xl px-3 sm:h-9", confirmTone === "destructive" && "bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/85")} disabled={busy} onClick={onConfirm} ref={confirmRef} type="button">
            {busy ? busyLabel ?? confirmLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function getWelcomeMessage(message: ChatMessage, model: ModelManifest | null, modelReady: boolean, isModelLoading: boolean, modelLoadPaused: boolean): ChatMessage {
  if (!model) return message;
  const modelName = model.label.split(" · ")[0];
  if (modelReady) {
    return {
      ...message,
      content: `${modelName} is ready. Ask anything — your prompt and response stay in this browser.`,
      meta: "Local · on-device · no server inference"
    };
  }
  return {
    ...message,
    content: modelLoadPaused
      ? `${modelName} is selected and its download is paused. Resume to finish the download and unlock the prompt.`
      : isModelLoading
        ? `${modelName} is getting ready. The prompt will unlock after Glaux downloads and verifies it locally.`
        : `${modelName} is selected. The prompt will unlock as soon as it is ready to run privately.`,
    meta: "Local download · resumable"
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
    // Browser storage can be unavailable in restricted contexts.
  }
}

function forgetRememberedModelId(modelId: string) {
  try {
    if (window.localStorage.getItem(LAST_READY_MODEL_KEY) === modelId) {
      window.localStorage.removeItem(LAST_READY_MODEL_KEY);
    }
  } catch {
    // Browser storage can be unavailable in restricted contexts.
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
    return { label: "Model ready", className: "text-black", dotClassName: "bg-sophon-verified-bright shadow-[0_0_10px_var(--sophon-verified-bright)]" };
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

type DocumentScrollSnapshot = {
  height: number;
  x: number;
  y: number;
};

function captureDialogScrollSnapshot(snapshotRef: { current: DocumentScrollSnapshot | null }) {
  snapshotRef.current = {
    height: document.documentElement.scrollHeight,
    x: window.scrollX,
    y: window.scrollY
  };
}

function useDocumentScrollLock(locked: boolean, snapshotRef: { current: DocumentScrollSnapshot | null }) {
  useLayoutEffect(() => {
    if (!locked) return;

    const root = document.documentElement;
    const body = document.body;
    const snapshot = snapshotRef.current;
    const scrollX = snapshot?.x ?? window.scrollX;
    const scrollY = snapshot?.y ?? window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingInlineEnd = body.style.paddingInlineEnd;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyLeft = body.style.left;
    const previousBodyWidth = body.style.width;
    const bodyPaddingInlineEnd = Number.parseFloat(window.getComputedStyle(body).paddingInlineEnd) || 0;
    const documentHeight = snapshot?.height ?? root.scrollHeight;
    const scrollSpacer = document.createElement("div");

    scrollSpacer.ariaHidden = "true";
    scrollSpacer.style.height = `${documentHeight}px`;
    scrollSpacer.style.pointerEvents = "none";
    scrollSpacer.style.width = "1px";
    root.append(scrollSpacer);
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `${-scrollY}px`;
    body.style.left = `${-scrollX}px`;
    body.style.width = "100%";
    if (scrollbarWidth > 0) body.style.paddingInlineEnd = `${bodyPaddingInlineEnd + scrollbarWidth}px`;
    window.scrollTo(scrollX, scrollY);
    const restoreFrame = window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));

    return () => {
      window.cancelAnimationFrame(restoreFrame);
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingInlineEnd = previousBodyPaddingInlineEnd;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.left = previousBodyLeft;
      body.style.width = previousBodyWidth;
      scrollSpacer.remove();
      window.scrollTo(scrollX, scrollY);
      snapshotRef.current = null;
    };
  }, [locked, snapshotRef]);
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
  if (stage === "probe") return compact ? "Checking files" : "Checking model files";
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

function getModelActionLabel(plan: ModelReplacementPlan | null) {
  if (!plan) return "Download model";
  const action = plan.action === "activate" ? "use" : plan.action;
  return plan.requiresReplacement
    ? `Replace & ${action}`
    : plan.action === "activate" ? "Use model" : `${capitalize(action)} model`;
}

function getModelActionCancelLabel(plan: ModelReplacementPlan | null) {
  if (!plan?.requiresReplacement) return "Not now";
  const replacedModelIds = plan.sourceModelIds.filter((modelId) => modelId !== plan.targetModelId);
  return replacedModelIds.length === 1
    ? `Keep ${modelName(replacedModelIds[0])}`
    : "Keep current models";
}

function getModelActionTitle(model: ModelManifest, plan: ModelReplacementPlan | null) {
  const targetName = model.label.split(" · ")[0];
  if (plan?.requiresReplacement) {
    const replacedModelIds = plan.sourceModelIds.filter((modelId) => modelId !== plan.targetModelId);
    const source = replacedModelIds.length === 1
      ? modelName(replacedModelIds[0])
      : `${replacedModelIds.length} saved models`;
    return `Replace ${source} with ${targetName}?`;
  }
  return `${plan?.action === "resume" ? "Resume" : plan?.action === "activate" ? "Use" : "Download"} ${targetName}?`;
}

function getModelActionDescription(
  model: ModelManifest,
  cache: ModelCacheSummary | undefined,
  storage: BrowserStorage | null | undefined,
  plan: ModelReplacementPlan | null
) {
  if (!plan?.requiresReplacement) return getModelDownloadDescription(model, cache, storage);
  const targetName = model.label.split(" · ")[0];
  const available = storage && storage.quota !== undefined && storage.usage !== undefined
    ? ` ${formatStorageBytes(Math.max(0, storage.quota - storage.usage))} is currently available.`
    : "";
  return `${targetName} downloads from scratch after replacement.${available} Non-commercial use applies; switching back requires another download.`;
}

function getReplacementBusyLabel(
  phase: ModelReplacementPhase | null,
  replacementModels: readonly ModelManifest[]
) {
  if (phase === "stopping") return "Stopping current model…";
  if (phase === "deleting") {
    return replacementModels.length === 1
      ? `Removing ${replacementModels[0]!.label.split(" · ")[0]}…`
      : "Removing saved models…";
  }
  return phase === "starting" ? "Starting new model…" : undefined;
}

function modelName(modelId: string | undefined) {
  if (!modelId) return "current model";
  return MODEL_REGISTRY.find((model) => model.id === modelId)?.label.split(" · ")[0] ?? "current model";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
    ? `Glaux found ${formatStorageBytes(resumableBytes)} of resumable data and will download about ${formatStorageBytes(remainingBytes)} more.`
    : `Glaux will download ${model.format.sizeLabel} to this browser before it can answer locally.`;
  const availableBytes = storage?.quota !== undefined && storage.usage !== undefined
    ? Math.max(0, storage.quota - storage.usage)
    : null;
  const storageMessage = availableBytes === null
    ? "Your browser will verify available storage before downloading."
    : `This browser currently reports ${formatStorageBytes(availableBytes)} available.`;
  return `${action} ${storageMessage} Review the selected model’s license and repository terms before use.`;
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
