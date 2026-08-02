"use client";

import { type FormEvent, type KeyboardEvent, type SetStateAction, useEffect, useReducer, useRef, useState } from "react";
import { AlertTriangle, Code2, Download, ExternalLink, Gauge, Hammer, HardDrive, Languages, LifeBuoy, LoaderCircle, MoonStar, PanelLeft, Pencil, RotateCcw, SendHorizontal, ShieldCheck, Sparkles, Square, Trash2 } from "lucide-react";
import { GlauxAcknowledgements } from "@/components/glaux-acknowledgements";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { GlauxModelSidebar } from "@/components/glaux-model-sidebar";
import type { TokenInspectMode } from "@/components/token-lens";
import { WorkbenchConversationMessages, type WorkbenchMessage as ChatMessage } from "@/components/workbench-conversation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelGeneration,
  cancelModelPreload,
  deleteCachedModel,
  getCachedModels,
  runPrompt,
  terminateRuntimeWorker
} from "@/lib/interp-client";
import { communityDescriptorToManifest, type ModelManifest } from "@/lib/onnx-models";
import { deleteSavedCommunityModelDescriptor, saveCommunityModelDescriptor, type CommunityModelPreviewSelection } from "@/lib/model-catalog";
import type { GenerationTelemetryEvent, ModelCacheSummary, OnnxLogEvent } from "@/lib/onnx-types";
import {
  createModelReplacementPlan,
  runModelReplacement,
  type ModelReplacementPhase
} from "@/lib/model-replacement";
import {
  createFixtureAssistantDraft,
  createFixtureDownloadActivity,
  createFixtureGenerationActivity,
  PRODUCT_TEST_MODELS
} from "@/lib/product-test-fixtures";
import { cn } from "@/lib/utils";
import { ONNX_COMMUNITY_URL, PRIVACY_PATH, PROJECT_REPOSITORY_URL, PROJECT_SUPPORT_URL } from "@/lib/trust-navigation";
import { formatGenerationDuration, formatGenerationProvider, formatGenerationRate } from "@/lib/generation-format";
import {
  INITIAL_WORKBENCH_SESSION,
  STARTER_MESSAGES,
  workbenchSessionReducer,
  type FailedTurn,
  type WorkbenchSessionState
} from "@/lib/workbench-state";
import { useCommunityModelInventory } from "@/hooks/use-community-model-inventory";
import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { useModelRuntimeCapabilities } from "@/hooks/use-model-runtime";
import { captureDialogScrollSnapshot, type DocumentScrollSnapshot, useDocumentScrollLock } from "@/hooks/use-document-scroll-lock";
import { useProductTestHydration, useProductTestRoute } from "@/hooks/use-product-test-harness";
import { useActiveModelPreload } from "@/hooks/use-active-model-preload";
import { useModelDepartureLifecycle } from "@/hooks/use-model-departure-lifecycle";
import { clearRememberedModelId, forgetRememberedModelId } from "@/lib/remembered-model";
import { purgeAllModelStorage } from "@/lib/model-delivery/opfs-store";
import { formatStoredModelDisclosure, getStoredModelSummary, shouldWarnForModelDeparture } from "@/lib/model-storage-awareness";
import {
  activityFromLog,
  activityFromTelemetry,
  formatDownloadAriaText,
  formatDownloadPercent,
  formatEta,
  formatStorageBytes,
  getFailedTurnStatus,
  getModelCompatibility,
  getPromptHelp,
  getRuntimeStatus,
  getWelcomeMessage,
  PROMPT_SHORTCUT_HELP
} from "@/lib/workbench-runtime";
import {
  getModelActionButtonLabel,
  getModelActionCancelLabel,
  getModelActionDescription,
  getModelActionLabel,
  getModelActionTitle,
  getReplacementBusyLabel,
  modelName
} from "@/lib/model-action-copy";

type StartupCleanupStatus = "idle" | "cleaning" | "failed";
const PROMPT_MAX_HEIGHT = 192;
export function GlauxWorkbench() {
  const { modelId: productTestModelId, runtimeEnabled, state: productTestState } = useProductTestRoute();
  const [session, dispatchSession] = useReducer(workbenchSessionReducer, INITIAL_WORKBENCH_SESSION);
  const {
    deletingModelId,
    error,
    failedTurn,
    generation,
    loadedModelId,
    messages,
    modelId,
    modelLoadPaused,
    modelReplacementPhase,
    notice,
    pendingDeleteModelId,
    pendingModelDownloadId,
    prompt,
    resetConfirmationOpen
  } = session;
  const setSessionField = <Field extends keyof WorkbenchSessionState>(field: Field, value: SetStateAction<WorkbenchSessionState[Field]>) => {
    dispatchSession({ type: "field/set", field, value } as Parameters<typeof dispatchSession>[0]);
  };
  const setMessages = (value: SetStateAction<WorkbenchSessionState["messages"]>) => setSessionField("messages", value);
  const setPrompt = (value: SetStateAction<string>) => setSessionField("prompt", value);
  const setGeneration = (value: SetStateAction<WorkbenchSessionState["generation"]>) => setSessionField("generation", value);
  const setError = (value: SetStateAction<string | null>) => setSessionField("error", value);
  const setNotice = (value: SetStateAction<string | null>) => setSessionField("notice", value);
  const setFailedTurn = (value: SetStateAction<FailedTurn | null>) => setSessionField("failedTurn", value);
  const setLoadedModelId = (value: SetStateAction<string | null>) => setSessionField("loadedModelId", value);
  const setModelLoadPaused = (value: SetStateAction<boolean>) => setSessionField("modelLoadPaused", value);
  const setPendingModelDownloadId = (value: SetStateAction<string | null>) => setSessionField("pendingModelDownloadId", value);
  const setPendingDeleteModelId = (value: SetStateAction<string | null>) => setSessionField("pendingDeleteModelId", value);
  const setDeletingModelId = (value: SetStateAction<string | null>) => setSessionField("deletingModelId", value);
  const setModelReplacementPhase = (value: SetStateAction<ModelReplacementPhase | null>) => setSessionField("modelReplacementPhase", value);
  const setResetConfirmationOpen = (value: SetStateAction<boolean>) => setSessionField("resetConfirmationOpen", value);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [developerMode, setDeveloperMode] = useState(false);
  const [communityModels, setCommunityModels] = useCommunityModelInventory(runtimeEnabled);
  const [checkingCommunityModel, setCheckingCommunityModel] = useState<string | null>(null);
  const [previewSelection, setPreviewSelection] = useState<CommunityModelPreviewSelection | null>(null);
  const [libraryModelId, setLibraryModelId] = useState("");
  const [modelSidebarOpen, setModelSidebarOpen] = useState(false);
  const [inspectDisplayMode, setInspectDisplayMode] = useState<TokenInspectMode | null>(null);
  const [hoveredInspectMetrics, setHoveredInspectMetrics] = useState<string | undefined>();
  const [capabilities, setCapabilities] = useModelRuntimeCapabilities(runtimeEnabled);
  const [cacheSummaries, setCacheSummaries] = useState<ModelCacheSummary[]>([]);
  const [cacheInventoryResolved, setCacheInventoryResolved] = useState(false);
  const [startupCleanupStatus, setStartupCleanupStatus] = useState<StartupCleanupStatus>("cleaning");
  const [startupCleanupRetryRevision, setStartupCleanupRetryRevision] = useState(0);
  const [storageRevision, setStorageRevision] = useState(0);
  const [browserStorage, setBrowserStorage] = useBrowserStorage(runtimeEnabled, storageRevision);
  const generationIdRef = useRef(0);
  const dialogScrollSnapshotRef = useRef<DocumentScrollSnapshot | null>(null);
  const modelDownloadFromMobileRef = useRef(false);
  const modelDownloadTriggerRef = useRef<HTMLElement | null>(null);
  const modelDeleteFromMobileRef = useRef(false);
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
  const isNetworkDownload = downloadProgress?.stage === "download" || downloadProgress?.stage === "resume";
  const previewDescriptor = previewSelection?.descriptor ?? null;
  const previewModel = previewDescriptor ? communityDescriptorToManifest(previewDescriptor) : null;
  const fixtureModels = productTestState ? PRODUCT_TEST_MODELS : [];
  const availableModels = [...fixtureModels, ...communityModels, ...(previewModel && !communityModels.some((model) => model.id === previewModel.id) ? [previewModel] : [])];
  const selectedModel = availableModels.find((model) => model.id === modelId) ?? null;
  const loadingModel = selectedModel;
  const modelLoadCancelLabel = isNetworkDownload ? "Cancel model download" : "Cancel model loading";
  const modelLoadCancelText = "Cancel";
  const pendingModelDownload = availableModels.find((model) => model.id === pendingModelDownloadId) ?? null;
  const pendingDeleteModel = communityModels.find((model) => model.id === pendingDeleteModelId) ?? null;
  const libraryModelCache = cacheSummaries.find((model) => model.modelId === libraryModelId);
  const pendingModelDownloadCache = cacheSummaries.find((model) => model.modelId === pendingModelDownloadId);
  const pendingModelPlan = pendingModelDownloadId
    ? createModelReplacementPlan(pendingModelDownloadId, cacheSummaries)
    : null;
  const pendingReplacementModels: ModelManifest[] = pendingModelPlan?.sourceModelIds.flatMap((sourceModelId) => {
    const source = availableModels.find((model) => model.id === sourceModelId);
    return source ? [source] : [];
  }) ?? [];
  const storedModelSummary = getStoredModelSummary(cacheSummaries);
  const storedModel = storedModelSummary
    ? availableModels.find((model) => model.id === storedModelSummary.modelId)
    : null;
  const storedModelDisclosure = storedModelSummary
    ? formatStoredModelDisclosure(storedModelSummary, storedModel?.label)
    : null;
  const modelCompatibility = getModelCompatibility(capabilities, selectedModel);
  const modelReady = selectedModel !== null && loadedModelId === selectedModel.id;
  const runtimeStatus = getRuntimeStatus(capabilities, selectedModel, loadedModelId, runtimeActivity, modelLoadPaused, failedTurn, error);
  const displayedRuntimeStatus = checkingCommunityModel
    ? { label: `Checking ${checkingCommunityModel}`, className: "text-glaux-copy-metadata", dotClassName: "animate-pulse bg-glaux-copy-metadata motion-reduce:animate-none" }
    : runtimeStatus;
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

  useProductTestHydration(productTestState, productTestModelId, (snapshot) => {
    generationIdRef.current += 1;
    terminateRuntimeWorker();
    dispatchSession({ type: "fixture/loaded", session: snapshot });
    setCopiedMessageId(null);
    setLibraryModelId(snapshot.modelId);
    setModelSidebarOpen(false);
    setCapabilities(snapshot.capabilities);
    setBrowserStorage(snapshot.browserStorage);
    setCacheSummaries(snapshot.cacheSummaries);
    setCacheInventoryResolved(snapshot.cacheInventoryResolved);
    setStartupCleanupStatus(snapshot.startupCleanupStatus);
  });

  useEffect(() => {
    if (productTestState !== null) return;
    let active = true;
    void (async () => {
      generationIdRef.current += 1;
      terminateRuntimeWorker();
      dispatchSession({ type: "model/stopped" });
      clearRememberedModelId();
      await purgeAllModelStorage();
      const models = await getCachedModels();
      const remaining = models.filter((model) => model.state !== "missing");
      if (remaining.length > 0) {
        throw new Error(`Glaux could not finish removing saved model files for ${remaining.map((model) => model.modelId).join(", ")}.`);
      }
      if (!active) return;
      setCacheSummaries(models);
      setCacheInventoryResolved(true);
      setStartupCleanupStatus("idle");
      setStorageRevision((value) => value + 1);
    })()
      .catch((caught) => {
        if (!active) return;
        setCacheSummaries([]);
        setCacheInventoryResolved(false);
        setStartupCleanupStatus("failed");
        dispatchSession({ type: "field/set", field: "error", value: caught instanceof Error
          ? caught.message
          : "Glaux could not remove saved model files." });
      });
    return () => {
      active = false;
    };
  }, [productTestState, startupCleanupRetryRevision]);

  useActiveModelPreload({
    capabilities,
    dispatch: dispatchSession,
    enabled: productTestState === null && startupCleanupStatus === "idle",
    generationIdRef,
    model: selectedModel,
    paused: modelLoadPaused,
    onStorageChanged: () => {
      setStorageRevision((value) => value + 1);
      void getCachedModels().then(setCacheSummaries).catch(() => undefined);
    }
  });

  useModelDepartureLifecycle({
    warnBeforeLeaving: productTestState === null && shouldWarnForModelDeparture(cacheSummaries, { loading: isModelLoading, paused: modelLoadPaused }),
    onDeparture: () => {
      generationIdRef.current += 1;
      clearRememberedModelId();
      terminateRuntimeWorker();
      void purgeAllModelStorage().catch(() => undefined);
    }
  });

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
    dispatchSession({ type: "conversation/reset" });
  }

  function selectModel(nextModelId: string) {
    setPreviewSelection(null);
    setLibraryModelId(nextModelId);
    if (nextModelId === modelId && !modelLoadPaused) return;
    if (!productTestState) {
      void navigator.storage?.persist?.()
        .then((persistent) => setBrowserStorage((current) => current ? { ...current, persistent } : current))
        .catch(() => undefined);
    }
    generationIdRef.current += 1;
    if (!productTestState) void cancelModelPreload().catch(() => terminateRuntimeWorker());
    dispatchSession({ type: "model/selected", modelId: nextModelId });
  }

  function addCommunityModel(selection: CommunityModelPreviewSelection) {
    setPreviewSelection(selection);
    setModelSidebarOpen(false);
  }

  function clearCommunityModelPreview() {
    setPreviewSelection(null);
    setModelSidebarOpen(false);
  }

  function requestDeleteModel(targetModelId: string) {
    if (!communityModels.some((model) => model.id === targetModelId)) return;
    modelDeleteFromMobileRef.current = modelSidebarOpen;
    captureDialogScrollSnapshot(dialogScrollSnapshotRef);
    setPendingDeleteModelId(targetModelId);
    if (modelSidebarOpen) setModelSidebarOpen(false);
  }

  function closeDeleteModelConfirmation() {
    if (deletingModelId) return;
    setPendingDeleteModelId(null);
    if (modelDeleteFromMobileRef.current) setModelSidebarOpen(true);
  }

  async function confirmDeleteModel() {
    if (!pendingDeleteModelId) return;
    const targetModelId = pendingDeleteModelId;
    setDeletingModelId(targetModelId);
    setError(null);
    setNotice(null);
    try {
      generationIdRef.current += 1;
      if (!productTestState) {
        await cancelModelPreload().catch(() => terminateRuntimeWorker());
        await deleteCachedModel(targetModelId);
        await deleteSavedCommunityModelDescriptor(targetModelId);
      }
      forgetRememberedModelId(targetModelId);
      dispatchSession({ type: "model/removed", modelId: targetModelId });
      if (targetModelId === libraryModelId) setLibraryModelId("");
      setCommunityModels((current) => current.filter((model) => model.id !== targetModelId));
      setCacheSummaries(productTestState ? [] : await getCachedModels());
      setStorageRevision((value) => value + 1);
      setNotice("The model and its downloaded files were removed from this browser.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Glaux could not delete the model from this browser.");
    } finally {
      setDeletingModelId(null);
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

    if (previewDescriptor?.id === targetModelId) {
      try {
        await saveCommunityModelDescriptor(previewDescriptor);
        const model = communityDescriptorToManifest(previewDescriptor);
        setCommunityModels((current) => current.some((entry) => entry.id === model.id) ? current : [...current, model]);
        setLibraryModelId(model.id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Glaux could not prepare this model for download.");
        setPendingModelDownloadId(null);
        return;
      }
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
          await deleteCachedModel(sourceModelId);
          forgetRememberedModelId(sourceModelId);
        },
        onPhaseChange: setModelReplacementPhase,
        readCacheSummaries: getCachedModels,
        stopActiveModel: async () => {
          await cancelModelPreload().catch(() => terminateRuntimeWorker());
          dispatchSession({ type: "model/stopped" });
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

  async function cancelModelLoad() {
    const cancelledModel = selectedModel;
    generationIdRef.current += 1;
    if (!productTestState) {
      await cancelModelPreload().catch(() => undefined);
      terminateRuntimeWorker();
      clearRememberedModelId();
      try {
        await purgeAllModelStorage();
        setCacheSummaries(await getCachedModels());
      } catch (caught) {
        setStartupCleanupStatus("failed");
        setError(caught instanceof Error ? caught.message : "Glaux could not remove the cancelled model download.");
        return;
      }
    }
    dispatchSession({ type: "model/stopped" });
    setNotice(cancelledModel ? `${cancelledModel.label} loading cancelled. Downloaded files were removed.` : "Model loading cancelled.");
    setStorageRevision((value) => value + 1);
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
          meta: `${formatGenerationProvider(metrics.provider)} · ${metrics.contextTokenCount}${metrics.truncatedInputTokens ? `/${metrics.promptTokenCount}` : ""} → ${response.result.outputTokenCount} tokens · ${formatGenerationRate(metrics.decodeTokensPerSecond)} · first token ${formatGenerationDuration(metrics.ttftMs)}${metrics.truncatedInputTokens ? ` · ${metrics.truncatedInputTokens} earlier tokens omitted` : ""}`
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
    <main className={cn("glaux-stage relative w-full bg-glaux-canvas text-foreground", selectedModel ? "h-svh overflow-hidden" : "min-h-svh")} data-inference={isBusy ? "active" : "idle"} data-product-test-state={productTestState ?? undefined}>
      <div aria-hidden="true" className="glaux-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="glaux-grid pointer-events-none absolute inset-0 opacity-45" />
      <div className={cn("relative flex w-full flex-col bg-transparent", selectedModel ? "h-svh" : "min-h-svh")}>
        <header className={cn("glaux-glass-strong glaux-reveal glaux-reveal-header relative z-20 shrink-0 items-center border-x-0 border-t-0", selectedModel ? "grid h-[calc(106px+env(safe-area-inset-top))] grid-cols-[minmax(0,1fr)_auto] grid-rows-[40px_28px] gap-x-2 gap-y-2 px-3 pb-[10px] pt-[calc(8px+env(safe-area-inset-top))] sm:h-[calc(120px+env(safe-area-inset-top))] sm:grid-rows-[40px_36px] sm:px-7 sm:pb-3 sm:pt-[calc(12px+env(safe-area-inset-top))] lg:flex lg:h-auto lg:justify-between lg:gap-0 lg:p-4" : "flex h-[calc(106px+env(safe-area-inset-top))] justify-between px-3 pb-8 pt-[env(safe-area-inset-top)] sm:h-auto sm:p-4")} data-testid="workbench-header">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3" data-testid="workbench-brand">
            <div aria-label="Glaux logo" className="glaux-accent-surface glaux-mark relative grid size-10 shrink-0 place-items-center border border-glaux-signal-bright/60" role="img">
              <MoonStar aria-hidden="true" className="size-5 stroke-[1.7]" />
            </div>
            <div className={cn("min-w-0", selectedModel && "max-[359px]:hidden")}>
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-sm font-semibold tracking-[0.12em] text-glaux-copy-primary">GLAUX</h1>
                <span className="glaux-type-decorative hidden items-center rounded-md border border-glaux-signal-bright/40 bg-glaux-signal/10 px-2 py-0.5 font-mono font-medium uppercase tracking-[0.12em] text-glaux-signal-soft xl:inline-flex" data-typography-role="decorative">Open-source local AI</span>
              </div>
              <p className="glaux-type-metadata hidden whitespace-nowrap font-mono uppercase tracking-[0.12em] text-glaux-copy-metadata xl:block" data-typography-role="metadata">ONNX models, in your browser</p>
            </div>
          </div>

          <div className={cn("glaux-glass-tile glaux-type-status flex min-w-0 items-center justify-center gap-2 rounded-full px-3 py-1 font-mono uppercase tracking-[0.08em] sm:py-1.5", selectedModel ? "col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto sm:justify-self-end lg:static lg:inset-auto lg:shrink-0" : "absolute inset-x-3 bottom-2 sm:static sm:inset-auto sm:shrink-0", displayedRuntimeStatus.className)} data-testid="workbench-status" data-typography-role="status">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", displayedRuntimeStatus.dotClassName)} />
            <span className="truncate">{displayedRuntimeStatus.label}{!checkingCommunityModel && downloadPercentLabel ? ` · ${downloadPercentLabel}` : null}</span>
          </div>

          <div className={cn("items-center [&_button:hover]:translate-y-0", selectedModel ? "col-start-2 row-start-1 flex w-auto justify-end gap-1 [&_button]:gap-1 sm:col-span-2 sm:col-start-auto sm:row-start-auto sm:w-full sm:gap-2 lg:col-span-1 lg:w-auto lg:shrink-0 lg:gap-3 lg:[&_button]:gap-2" : "flex shrink-0 gap-1.5 sm:gap-3")} data-testid="workbench-actions">
            {generation.status === "loading" ? <Button aria-label={modelLoadCancelLabel} className="size-10 rounded-xl p-0" onClick={cancelModelLoad} size="sm" title={modelLoadCancelLabel} type="button" variant="sophon"><Square aria-hidden="true" className="size-3 fill-current" /><span className="sr-only">{modelLoadCancelText}</span></Button> : null}
            {modelLoadPaused && selectedModel ? <Button aria-label="Resume model download" className="size-10 rounded-xl p-0" onClick={resumeModelLoad} size="sm" title="Resume model download" type="button" variant="sophon"><Download aria-hidden="true" /><span className="sr-only">Resume</span></Button> : null}
            {canResetConversation && !isBusy ? (
              <Button aria-label="Reset conversation" className="size-10 rounded-xl p-0 text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive" disabled={isBusy} onClick={requestResetConversation} ref={resetTriggerRef} size="sm" title="Reset conversation" type="button" variant="sophon">
                <Trash2 aria-hidden="true" />
                <span className="sr-only">Reset</span>
              </Button>
            ) : null}
            <GlauxAcknowledgements className="size-10 rounded-xl p-0 sm:!size-10" compact />
            <Button aria-controls="model-library-mobile" aria-expanded={modelSidebarOpen} aria-label="Open model library" className="size-10 rounded-xl p-0 lg:hidden" data-testid="open-model-library" onClick={() => setModelSidebarOpen(true)} size="sm" type="button" variant="sophon"><PanelLeft aria-hidden="true" /><span className="sr-only">Models</span></Button>
          </div>
          {isModelLoading && loadingModel && !isProbingModelFiles ? <span aria-label={`Loading ${loadingModel.label}`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={downloadPercent} aria-valuetext={downloadProgress ? formatDownloadAriaText(downloadProgress) : "Preparing model delivery"} className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-glaux-panel-deep" role="progressbar"><span className={cn("block h-full bg-gradient-to-r from-glaux-signal to-glaux-signal-bright shadow-[0_0_12px_var(--glaux-signal-bright)] transition-[width] duration-200 motion-reduce:transition-none", downloadPercent === undefined && "w-1/3 motion-reduce:animate-none")} style={downloadPercent === undefined ? undefined : { width: `${downloadPercent}%` }} /></span> : null}
        </header>

        <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">{displayedRuntimeStatus.label}</div>

        <div className={cn("flex flex-1", selectedModel ? "min-h-0" : "min-h-fit")}>
          <GlauxModelSidebar capabilities={capabilities} communityModels={availableModels} disabled={isRunning || replacingModel || storageReconciliationBlocked} inspectMetrics={hoveredInspectMetrics} inspectMode={developerMode} inspectDisplayMode={inspectDisplayMode} mobileOpen={modelSidebarOpen} modelCacheState={libraryModelCache?.state} modelId={libraryModelId} modelLoaded={loadedModelId === libraryModelId && libraryModelCache?.state === "cached"} onCommunityModelAdded={addCommunityModel} onCommunityModelCheckChange={setCheckingCommunityModel} onCommunityModelCleared={clearCommunityModelPreview} onDeleteModel={requestDeleteModel} onInspectDisplayModeChange={setInspectDisplayMode} onInspectModeChange={setDeveloperMode} onMobileOpenChange={setModelSidebarOpen} previewModelId={previewSelection?.details.revision ? `${previewSelection.details.repo}@${previewSelection.details.revision}` : ""} previewModelUnsupported={previewSelection?.compatibility.status === "unsupported"} />
          <section aria-busy={isBusy} aria-label={previewModel ? "Model preview" : "Conversation"} className={cn("glaux-reveal glaux-reveal-workspace relative flex min-w-0 flex-1 flex-col", selectedModel && "h-full min-h-0")}>
            <div className={cn("flex-1", selectedModel ? "min-h-0 overflow-y-auto overscroll-contain" : "overflow-visible")} data-testid="conversation-scroll">
              <div className="mx-auto flex min-w-0 w-full max-w-6xl flex-col px-4 py-6 sm:px-12 sm:py-9">
                <div aria-live={isRunning ? "off" : "polite"} aria-relevant="additions text" className="min-w-0 space-y-6" role={previewModel ? undefined : "log"}>
                  {previewSelection ? (
                    <ModelPreview
                      compatibility={previewModel ? getModelCompatibility(capabilities, previewModel) : "compatible"}
                      model={previewModel}
                      onDownload={previewModel ? () => requestModelAction(previewModel.id) : undefined}
                      selection={previewSelection}
                    />
                  ) : !selectedModel ? (
                    cacheInventoryResolved ? (
                      <FirstRunWelcome
                        notice={notice}
                        onDismissNotice={() => setNotice(null)}
                        onOpenModels={() => setModelSidebarOpen(true)}
                      />
                    ) : (
                      <FirstRunCheck
                        error={startupCleanupStatus === "failed" ? error : null}
                        onRetry={() => {
                          setError(null);
                          setStartupCleanupStatus("cleaning");
                          setCacheInventoryResolved(false);
                          setStartupCleanupRetryRevision((value) => value + 1);
                        }}
                        status={startupCleanupStatus}
                      />
                    )
                  ) : <WorkbenchConversationMessages copiedMessageId={copiedMessageId} developerMode={developerMode} inspectDisplayMode={inspectDisplayMode} isBusy={isBusy} messages={displayedMessages} onCopy={(message) => void copyMessage(message)} onEdit={editMessage} onInspectHover={setHoveredInspectMetrics} onRegenerate={regenerateLatest} />}
                  {isRunning && !previewModel ? (
                    <article aria-label={generation.draft.trim() ? "Glaux is responding" : `Glaux status: ${runtimeActivity?.label ?? "Generating response"}`} aria-live="off" className="group/message relative flex w-full min-w-0 gap-3 text-sm">
                      <div className="glaux-glass-tile !self-start mt-1 flex size-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-xl text-glaux-signal-soft"><MoonStar aria-hidden="true" className="size-4 animate-pulse motion-reduce:animate-none" /></div>
                      <div className="flex w-full min-w-0 flex-col gap-2.5 max-w-[calc(100%_-_2.75rem)] sm:max-w-xl">
                        <Card className="w-full max-w-full overflow-hidden rounded-xl border-glaux-glass-border bg-glaux-panel shadow-none">
                          {generation.draft.trim() ? (
                            <CardContent className="glaux-glass-tile block w-full overflow-hidden rounded-xl p-0">
                              <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-6 text-glaux-copy-primary">
                                {generation.draft}<span aria-hidden="true" className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-glaux-signal-soft align-text-bottom motion-reduce:animate-none" />
                              </p>
                              <span className="flex items-center gap-2 border-t border-glaux-glass-border bg-glaux-panel-deep px-3 py-2">
                                <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-glaux-signal-soft motion-reduce:animate-none" />
                                <span className="glaux-type-status min-w-0 flex-1 truncate font-mono uppercase tracking-[0.08em] text-glaux-copy-metadata" data-typography-role="status">{runtimeActivity?.label ?? "Generating response"}</span>
                                <Button aria-label="Stop generation" className="shrink-0" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                                  <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                                </Button>
                              </span>
                            </CardContent>
                          ) : (
                            <CardContent className="glaux-glass-tile flex w-full items-center gap-3 rounded-xl px-4 py-3">
                              <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-glaux-signal-soft motion-reduce:animate-none" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-glaux-copy-primary">{runtimeActivity?.label ?? "Generating response"}</span>
                                {runtimeActivity?.detail ? <span className="glaux-type-metadata mt-0.5 block truncate text-glaux-copy-metadata" data-typography-role="metadata">{runtimeActivity.detail}</span> : null}
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

            {selectedModel && !previewModel ? (
              <div className="glaux-glass-strong glaux-reveal glaux-reveal-composer z-10 shrink-0 border-x-0 border-b-0 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="composer-panel">
              <form className="mx-auto max-w-6xl" onSubmit={submitPrompt}>
                {modelLoadPaused && selectedModel ? (
                  <div className="glaux-glass-tile mb-2 flex items-center gap-2 rounded-xl border-glaux-warning/30 px-3 py-2 text-sm text-glaux-copy-body sm:mb-3 sm:gap-3 sm:px-4 sm:py-3" role="status">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-5 text-glaux-copy-primary">Model download paused</span>
                      <span className="glaux-type-metadata mt-0.5 hidden text-glaux-copy-metadata sm:block" data-typography-role="metadata">Resume to finish downloading {selectedModel.format.sizeLabel} before you can write or send a prompt.</span>
                      <span className="sr-only sm:hidden">Resume to finish downloading {selectedModel.format.sizeLabel} before you can write or send a prompt.</span>
                    </span>
                    <Button aria-label="Resume download" className="h-11 shrink-0 rounded-xl px-3 sm:h-9" onClick={resumeModelLoad} type="button" variant="sophon"><Download aria-hidden="true" /><span className="sm:hidden">Resume</span><span className="hidden sm:inline">Resume download</span></Button>
                  </div>
                ) : failedTurn ? (
                  <div className="glaux-glass-tile mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl border-destructive/35 px-3 py-2 text-sm text-destructive sm:mb-3 sm:flex sm:gap-3 sm:px-4 sm:py-3" id="prompt-error" role="alert">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-5">{getFailedTurnStatus(failedTurn)}</span>
                      <span className="hidden sm:mt-0.5 sm:block">{failedTurn.reason}</span>
                    </span>
                    <span className="flex shrink-0 gap-1.5 sm:gap-2">
                      <Button className="h-11 rounded-xl px-2.5 sm:h-8" disabled={modelCompatibility !== "compatible"} onClick={retryFailedTurn} size="sm" type="button" variant="sophon"><RotateCcw aria-hidden="true" /> Retry</Button>
                      <Button className="h-11 rounded-xl px-2.5 sm:h-8" onClick={editFailedTurn} size="sm" type="button" variant="sophon"><Pencil aria-hidden="true" /> Edit</Button>
                    </span>
                    <span className="glaux-type-metadata col-span-2 block leading-4 sm:hidden" data-testid="failed-turn-mobile-reason" data-typography-role="metadata">
                      {failedTurn.reason}
                    </span>
                  </div>
                ) : error ? (
                  <div className="glaux-glass-tile mb-3 rounded-xl border-destructive/35 px-4 py-3 text-sm text-destructive" id="prompt-error" role="alert">{error}</div>
                ) : notice ? (
                  <div className="glaux-glass-tile mb-3 flex flex-col gap-3 rounded-xl border-glaux-glass-border px-4 py-3 text-sm text-glaux-copy-body sm:flex-row sm:items-center" role="status">
                    <span className="min-w-0 flex-1">{notice}</span>
                    <Button className="h-11 self-start rounded-xl sm:h-8 sm:self-auto" onClick={() => setNotice(null)} size="sm" type="button" variant="sophon">Dismiss</Button>
                  </div>
                ) : null}
                <label className="sr-only" htmlFor="glaux-prompt">Message Glaux</label>
                <div className="glaux-glass-tile glaux-glass-interactive relative overflow-hidden rounded-2xl before:pointer-events-none before:absolute before:inset-y-3 before:left-0 before:z-10 before:w-px before:bg-glaux-glass-highlight after:pointer-events-none after:absolute after:inset-y-3 after:right-0 after:z-10 after:w-px after:bg-glaux-glass-highlight">
                  <Textarea
                    aria-describedby="prompt-help"
                    className="flex min-h-20 max-h-[7.5rem] w-full resize-none overflow-y-auto rounded-md border-0 bg-transparent px-3 py-2 pr-14 text-[15px] leading-6 text-glaux-copy-primary shadow-none placeholder:text-glaux-copy-decorative focus-visible:outline-none disabled:cursor-not-allowed disabled:text-glaux-copy-disabled sm:max-h-48"
                    id="glaux-prompt"
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={promptPlaceholder}
                    ref={promptRef}
                    disabled={promptDisabled}
                    value={prompt}
                  />
                  <div className="flex items-center justify-between border-t border-glaux-glass-border bg-glaux-panel-deep px-3 py-2">
                    <span className="glaux-type-metadata truncate pr-3 font-mono uppercase tracking-[0.08em] text-glaux-copy-metadata" data-typography-role="metadata">
                      {selectedModel ? `${modelName(selectedModel.id)} · on-device` : "Choose a model to unlock chat"}
                    </span>
                    {isRunning ? (
                      <Button aria-label="Stop generation" className="h-10 shrink-0 rounded-xl" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                        <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                      </Button>
                    ) : (
                      <Button aria-label="Send message" className="glaux-accent-surface relative size-10 shrink-0 rounded-xl after:absolute after:-inset-1 after:content-['']" disabled={!canSend} size="icon" type="submit">
                        <SendHorizontal aria-hidden="true" className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {storedModelDisclosure ? <p className="glaux-type-metadata mt-2 flex min-w-0 items-center gap-1.5 rounded-lg border border-glaux-glass-border bg-glaux-panel-deep px-2.5 py-1 font-mono text-[10px] uppercase leading-4 tracking-[0.04em] text-glaux-copy-body" data-testid="model-storage-disclosure" data-typography-role="metadata"><Download aria-hidden="true" className="size-3.5 shrink-0 text-glaux-signal-soft" /><span className="truncate">{storedModelDisclosure}</span></p> : null}
                <footer className={cn("glaux-type-metadata flex min-w-0 items-center gap-2 overflow-x-auto rounded-xl border border-glaux-glass-border bg-glaux-panel-deep px-2.5 py-1.5 font-mono text-[10px] uppercase leading-4 tracking-[0.04em] text-glaux-copy-metadata [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", storedModelDisclosure ? "mt-1" : "mt-2")} data-typography-role="metadata">
                  <span className={cn("flex shrink-0 items-center whitespace-nowrap text-glaux-copy-body", modelCompatibility === "incompatible" && "text-destructive")} id="prompt-help">
                    {downloadProgress ? (
                      downloadProgress.stage === "probe" ? (
                        <>
                          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-glaux-signal-soft motion-reduce:animate-none" />
                          <span>Checking files</span>
                        </>
                      ) : (
                      <>
                        <span className="sr-only">Downloading model · </span>
                        <span aria-label={`Downloaded ${formatStorageBytes(downloadProgress.loaded)} of ${formatStorageBytes(downloadProgress.total)}`} className="flex items-center gap-1.5 rounded border border-glaux-glass-border bg-glaux-glass-tile px-1.5">
                          <Download aria-hidden="true" className="size-3.5 text-glaux-signal-soft" />
                          <span className="tabular-nums">{formatStorageBytes(downloadProgress.loaded)} / {formatStorageBytes(downloadProgress.total)}</span>
                        </span>
                        {(downloadProgress.bytesPerSecond !== undefined || downloadProgress.etaMs !== undefined) ? <span className="ml-2 flex items-center gap-1.5 border-l border-glaux-glass-border pl-2" aria-label={`${downloadProgress.bytesPerSecond !== undefined ? `Download speed ${formatStorageBytes(downloadProgress.bytesPerSecond)} per second` : ""}${downloadProgress.etaMs !== undefined ? `; ${formatEta(downloadProgress.etaMs)} remaining` : ""}`}>
                          <Gauge aria-hidden="true" className="size-3.5 text-glaux-copy-decorative" />
                          {downloadProgress.bytesPerSecond !== undefined ? <span className="tabular-nums">{formatStorageBytes(downloadProgress.bytesPerSecond)}/s</span> : null}
                          {downloadProgress.etaMs !== undefined ? <span className="tabular-nums">{formatEta(downloadProgress.etaMs)}</span> : null}
                        </span> : null}
                      </>
                      )
                    ) : promptHelp === PROMPT_SHORTCUT_HELP ? (
                      <><span className="sm:hidden">Enter sends</span><span className="hidden sm:inline">{PROMPT_SHORTCUT_HELP}</span></>
                    ) : <span>{promptHelp}</span>}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-glaux-glass-border pl-2 whitespace-nowrap">
                    <HardDrive aria-hidden="true" className="size-3.5 text-glaux-copy-decorative" />
                    <p data-state={browserStorage === undefined ? "checking" : browserStorage === null ? "unavailable" : "ready"} data-testid="browser-storage">
                      <span className="sr-only">Browser storage · </span><span className="tabular-nums text-glaux-copy-body">{storageLabel}</span>
                    </p>
                    <a aria-label="Privacy (opens in a new tab)" className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded border border-glaux-glass-border bg-glaux-glass-tile text-glaux-copy-primary transition-colors hover:border-glaux-signal-bright/55 hover:text-glaux-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glaux-signal" data-typography-role="action" href={PRIVACY_PATH} rel="noreferrer" target="_blank" title="Privacy"><ShieldCheck aria-hidden="true" className="size-3" /></a>
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
          cancelLabel={pendingModelPlan?.requiresReplacement ? "Keep current" : "Not now"}
          confirmAriaLabel={getModelActionLabel(pendingModelPlan)}
          confirmLabel={getModelActionButtonLabel(pendingModelPlan)}
          confirmTone="default"
          description={getModelActionDescription(pendingModelDownload, pendingModelDownloadCache, browserStorage, pendingModelPlan)}
          details={pendingModelPlan?.requiresReplacement ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-glaux-glass-border bg-glaux-panel-deep text-sm">
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-glaux-glass-border px-3 py-2">
                <span className="text-glaux-copy-metadata">Remove</span>
                <span className="min-w-0 font-medium text-glaux-copy-primary">{pendingReplacementModels.map((model) => model.label.split(" · ")[0]).join(", ")}</span>
                <span className="tabular-nums text-glaux-copy-metadata">{formatStorageBytes(pendingModelPlan.bytesToRemove)}</span>
              </div>
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2">
                <span className="text-glaux-copy-metadata">Download</span>
                <span className="min-w-0 font-medium text-glaux-copy-primary">{pendingModelDownload.label.split(" · ")[0]}</span>
                <span className="tabular-nums text-glaux-copy-metadata">{pendingModelDownload.format.sizeLabel}</span>
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
          confirmLabel="Delete model"
          description={`${pendingDeleteModel.label.split(" · ")[0]} and all of its downloaded files will be removed from this browser. You can add and download it again later.`}
          onCancel={closeDeleteModelConfirmation}
          onConfirm={() => void confirmDeleteModel()}
          title="Delete this model?"
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
    <div className="glaux-glass-tile mx-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-2xl px-5 py-4" role={failed ? "alert" : "status"}>
      {failed
        ? <Trash2 aria-hidden="true" className="size-5 shrink-0 text-destructive" />
        : <LoaderCircle aria-hidden="true" className="size-5 shrink-0 animate-spin text-glaux-signal-soft motion-reduce:animate-none" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-glaux-copy-primary">
          {failed ? "Old model files could not be removed" : cleaning ? "Finishing model cleanup" : "Checking this browser"}
        </span>
        <span className="glaux-type-metadata mt-0.5 block text-glaux-copy-metadata" data-typography-role="metadata">
          {failed ? error : cleaning ? "Glaux found files from a previous session and is removing them before continuing…" : "Looking for a model you have already downloaded…"}
        </span>
      </span>
      {failed ? <Button className="ml-auto h-11 shrink-0 rounded-xl max-[359px]:basis-full sm:h-8" onClick={onRetry} size="sm" type="button" variant="sophon">Retry cleanup</Button> : null}
    </div>
  );
}

function ModelPreview({ compatibility, model, onDownload, selection }: {
  compatibility: ReturnType<typeof getModelCompatibility>;
  model: ModelManifest | null;
  onDownload?: () => void;
  selection: CommunityModelPreviewSelection;
}) {
  const unsupported = selection.compatibility.status === "unsupported";
  const repository = selection.details.repo;
  const revision = selection.details.revision?.slice(0, 12) ?? null;
  const issues = selection.compatibility.issues.filter((issue) => issue.severity === "error");
  const detailRows = [
    ["Download size", selection.compatibility.estimatedDownloadBytes === null ? "Unavailable" : formatStorageBytes(selection.compatibility.estimatedDownloadBytes)],
    ["Quantization", selection.compatibility.selectedDtype?.toUpperCase() ?? "Unavailable"],
    ["Architecture", selection.details.architecture ?? "Not declared"],
    ["License", selection.details.license ?? "Not specified"]
  ];

  return (
    <section aria-labelledby="model-preview-title" className="mx-auto w-full max-w-3xl" data-testid="model-preview">
      <div className={cn("glaux-first-run-card glaux-glass-strong glaux-reveal glaux-reveal-hero overflow-hidden rounded-2xl", unsupported && "border-destructive/50 ring-1 ring-destructive/30")}>
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="glaux-type-decorative mb-2 flex items-center gap-1.5 font-mono font-semibold uppercase tracking-[0.12em] text-glaux-signal-soft" data-typography-role="decorative">
            <Sparkles aria-hidden="true" className="size-3.5" />
            Model preview
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="max-w-2xl font-serif text-[2rem] leading-[1.02] tracking-[-0.025em] text-glaux-copy-primary sm:text-[2.25rem] lg:text-[2.75rem]" id="model-preview-title">{selection.details.name}</h2>
              <p className="glaux-type-body mt-2 max-w-2xl text-glaux-copy-body" data-typography-role="body">{unsupported ? "Review why this ONNX Community model cannot run in Glaux." : "Review this ONNX Community model before storing its files in your browser."}</p>
            </div>
            <span className={cn("rounded-full border bg-glaux-panel-deep px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]", unsupported ? "border-destructive/50 text-destructive" : "border-glaux-glass-border text-glaux-copy-metadata")}>{unsupported ? "Not compatible" : "Not downloaded"}</span>
          </div>

          <div className="mt-4 rounded-xl border border-glaux-glass-border bg-glaux-glass-tile p-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg border border-glaux-glass-border bg-glaux-panel-deep text-glaux-signal-soft">
              <HardDrive className="size-4.5" />
            </span>
            <div className="mt-3 min-w-0 sm:mt-0">
              <h3 className="truncate text-base font-semibold text-glaux-copy-primary">{repository}</h3>
              <p className="glaux-type-metadata mt-1 text-glaux-copy-metadata" data-typography-role="metadata">Pinned ONNX weights{revision ? ` at revision ${revision}` : ""}.</p>
            </div>
            {!unsupported && model && onDownload ? <Button className="glaux-accent-surface mt-3 h-11 w-full shrink-0 rounded-lg px-3 sm:mt-0 sm:w-auto" disabled={compatibility === "incompatible"} onClick={onDownload} type="button">
              <Download aria-hidden="true" />Download model
            </Button> : null}
          </div>

          {unsupported ? <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive" role="alert"><p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle aria-hidden="true" className="size-4" />This model is not compatible with Glaux</p><ul className="mt-2 space-y-1 pl-6 text-sm leading-5">{issues.map((issue) => <li className="list-disc" key={issue.code}>{issue.message}</li>)}</ul></div> : compatibility === "incompatible" ? <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-5 text-destructive" role="alert">This device does not expose the browser GPU support required to run this model locally.</p> : null}

          <dl className="mt-3 grid overflow-hidden rounded-xl border border-glaux-glass-border bg-glaux-glass-tile sm:grid-cols-2">
            {detailRows.map(([label, value], index) => <div className={cn("px-3 py-2.5", index > 0 && "border-t border-glaux-glass-border", index === 1 && "sm:border-t-0 sm:border-l", index === 2 && "sm:border-l-0", index === 3 && "sm:border-l")} key={label}>
              <dt className="text-[10px] font-medium uppercase leading-4 tracking-[0.05em] text-glaux-copy-metadata">{label}</dt>
              <dd className="mt-0.5 break-words text-sm font-medium text-glaux-copy-primary">{value}</dd>
            </div>)}
          </dl>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-glaux-glass-border pt-3">
            <p className="glaux-type-metadata text-glaux-copy-metadata" data-typography-role="metadata">{unsupported ? "This preview is not stored, and incompatible model files cannot be downloaded." : "Nothing is stored until you confirm the download."}</p>
            <Button asChild className="h-11 rounded-lg sm:h-8" size="sm" variant="sophon"><a href={`https://huggingface.co/${repository}`} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" />View on Hugging Face</a></Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function FirstRunWelcome({ notice, onDismissNotice, onOpenModels }: {
  notice: string | null;
  onDismissNotice: () => void;
  onOpenModels: () => void;
}) {

  return (
    <section aria-labelledby="first-run-title" className="mx-auto w-full max-w-3xl" data-testid="first-run-welcome">
      {notice ? (
        <div className="glaux-glass-tile mb-3 flex items-center gap-3 rounded-xl border-glaux-glass-border px-4 py-3 text-sm text-glaux-copy-body" role="status">
          <span className="min-w-0 flex-1">{notice}</span>
          <Button className="h-11 shrink-0 rounded-xl sm:h-8" onClick={onDismissNotice} size="sm" type="button" variant="sophon">Dismiss</Button>
        </div>
      ) : null}
      <div className="glaux-first-run-card glaux-glass-strong glaux-reveal glaux-reveal-hero overflow-hidden rounded-2xl">
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="glaux-type-decorative mb-2 flex items-center gap-1.5 font-mono font-semibold uppercase tracking-[0.12em] text-glaux-signal-soft" data-typography-role="decorative">
            <Sparkles aria-hidden="true" className="size-3.5" />
            Start here
          </div>
          <h2 className="max-w-2xl font-serif text-[2rem] leading-[1.02] tracking-[-0.025em] text-glaux-copy-primary sm:text-[2.25rem] lg:text-[2.75rem]" id="first-run-title">Run community ONNX models locally</h2>
          <p className="glaux-type-body mt-2 max-w-2xl text-glaux-copy-body" data-typography-role="body">
            Browse the ONNX Leaderboard, then run a compatible community model locally with WebGPU. No account is needed, and your prompts and responses are not sent to an inference server.
          </p>

          <div className="mt-4 rounded-xl border border-glaux-glass-border bg-glaux-glass-tile p-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3" data-testid="first-run-recommended">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg border border-glaux-glass-border bg-glaux-panel-deep text-glaux-signal-soft" data-testid="first-run-recommended-icon">
              <Languages className="size-4.5" />
            </span>
            <div className="mt-3 min-w-0 sm:mt-0" data-testid="first-run-recommended-details">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-base font-semibold text-glaux-copy-primary">Hugging Face ONNX Community</h3>
                <span aria-label="ONNX Leaderboard" className="grid size-4 place-items-center rounded-full bg-glaux-copy-primary text-glaux-panel" title="ONNX Leaderboard">
                  <Sparkles aria-hidden="true" className="size-2.5" />
                </span>
              </div>
              <p className="glaux-type-metadata mt-1 text-glaux-copy-metadata" data-typography-role="metadata">Visit the ONNX Community page on Hugging Face to browse available models.</p>
            </div>
            <Button
              asChild
              className="glaux-accent-surface mt-3 h-11 w-full shrink-0 rounded-lg px-3 sm:mt-0 sm:w-auto"
              data-testid="first-run-primary"
            >
              <a aria-label="Visit the Hugging Face ONNX Community (opens in a new tab)" href={ONNX_COMMUNITY_URL} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" /><span>View on Hugging Face</span>
              </a>
            </Button>
          </div>
          <div className="mt-3 grid overflow-hidden rounded-xl border border-glaux-glass-border bg-glaux-glass-tile sm:grid-cols-2 sm:divide-x sm:divide-glaux-glass-border">
            <div className="flex items-start gap-2 px-3 py-2.5">
              <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-glaux-copy-primary text-glaux-panel">
                <Hammer className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-glaux-copy-primary">Stays local</span>
                <span className="glaux-type-metadata mt-0.5 block text-glaux-copy-metadata" data-typography-role="metadata">Chats run in this browser, not an inference server.</span>
              </span>
            </div>
            <div className="flex items-start gap-2 border-t border-glaux-glass-border px-3 py-2.5 sm:border-t-0">
              <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-glaux-copy-primary text-glaux-panel">
                <Download className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-glaux-copy-primary">Download once</span>
                <span className="glaux-type-metadata mt-0.5 block text-glaux-copy-metadata" data-typography-role="metadata">Choose a compatible model and confirm its exact download size.</span>
              </span>
            </div>
          </div>
          <div className="glaux-type-metadata mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-glaux-glass-border pt-3 text-glaux-copy-metadata" data-typography-role="metadata">
            <span>Open weights</span>
            <span aria-hidden="true">·</span>
            <span>Model-specific licenses</span>
            <span aria-hidden="true">·</span>
            <span>Stores one model locally</span>
            <Button className="h-11 rounded-lg px-2.5 sm:h-8 lg:hidden" onClick={onOpenModels} size="sm" type="button" variant="sophon">Browse models</Button>
          </div>
          <nav aria-label="First-run resources" className="mt-3 flex items-center justify-between gap-3 border-t border-glaux-glass-border pt-3" data-testid="first-run-trust-nav">
            <p className="glaux-type-decorative shrink-0 font-mono font-semibold uppercase tracking-[0.1em] text-glaux-copy-decorative" data-typography-role="decorative">Resources</p>
            <div className="flex items-center gap-1">
              <a aria-label="Source (opens in a new tab)" className="inline-flex size-9 items-center justify-center rounded-lg border border-glaux-glass-border bg-glaux-glass-strong text-glaux-copy-primary transition-colors hover:border-glaux-signal-bright/55 hover:bg-glaux-glass-tile hover:text-glaux-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glaux-signal" href={PROJECT_REPOSITORY_URL} rel="noreferrer" target="_blank" title="Source">
                <Code2 aria-hidden="true" className="size-4" />
              </a>
              <a aria-label="Privacy (opens in a new tab)" className="inline-flex size-9 items-center justify-center rounded-lg border border-glaux-glass-border bg-glaux-glass-strong text-glaux-copy-primary transition-colors hover:border-glaux-signal-bright/55 hover:bg-glaux-glass-tile hover:text-glaux-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glaux-signal" href={PRIVACY_PATH} rel="noreferrer" target="_blank" title="Privacy">
                <ShieldCheck aria-hidden="true" className="size-4" />
              </a>
              <GlauxAcknowledgements ariaLabel="About & licenses" className="size-9 rounded-lg border border-glaux-glass-border bg-glaux-glass-strong hover:border-glaux-signal-bright/55 hover:bg-glaux-glass-tile sm:size-9" compact />
              <a aria-label="Support (opens in a new tab)" className="inline-flex size-9 items-center justify-center rounded-lg border border-glaux-glass-border bg-glaux-glass-strong text-glaux-copy-primary transition-colors hover:border-glaux-signal-bright/55 hover:bg-glaux-glass-tile hover:text-glaux-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glaux-signal" href={PROJECT_SUPPORT_URL} rel="noreferrer" target="_blank" title="Support">
                <LifeBuoy aria-hidden="true" className="size-4" />
              </a>
            </div>
          </nav>
        </div>
      </div>
    </section>
  );
}
