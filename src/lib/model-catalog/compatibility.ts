import type {
  CommunityModelCompatibility,
  CommunityModelCompatibilityIssue,
  CommunityModelDetails,
  CommunityModelDtype,
  CommunityModelFile
} from "@/lib/model-catalog/types";
import { ONNX_COMMUNITY_LIBRARY, ONNX_COMMUNITY_TASK } from "@/lib/model-catalog/types";

export const DEFAULT_COMMUNITY_MODEL_SIZE_LIMIT = 8 * 1024 ** 3;

// Mirrors the text-only causal-LM mappings in @huggingface/transformers 4.2.
// Review this contract whenever the runtime dependency is upgraded.
const SUPPORTED_ARCHITECTURES = new Set([
  "AfmoeForCausalLM",
  "ApertusForCausalLM",
  "ArceeForCausalLM",
  "BloomForCausalLM",
  "CodeGenForCausalLM",
  "CohereForCausalLM",
  "Cohere2ForCausalLM",
  "DeepseekV3ForCausalLM",
  "Ernie4_5ForCausalLM",
  "ExaoneForCausalLM",
  "FalconForCausalLM",
  "FalconH1ForCausalLM",
  "GemmaForCausalLM",
  "Gemma2ForCausalLM",
  "Gemma3ForCausalLM",
  "Gemma3nForCausalLM",
  "Gemma4ForCausalLM",
  "GlmForCausalLM",
  "GlmMoeDsaForCausalLM",
  "GPTBigCodeForCausalLM",
  "GptOssForCausalLM",
  "GPTJForCausalLM",
  "GPTNeoForCausalLM",
  "GPTNeoXForCausalLM",
  "GraniteForCausalLM",
  "GraniteMoeHybridForCausalLM",
  "HeliumForCausalLM",
  "HunYuanDenseV1ForCausalLM",
  "Lfm2ForCausalLM",
  "Lfm2MoeForCausalLM",
  "Llama4ForCausalLM",
  "LlamaForCausalLM",
  "Ministral3ForCausalLM",
  "MinistralForCausalLM",
  "MistralForCausalLM",
  "Mistral4ForCausalLM",
  "MobileLLMForCausalLM",
  "ModernBertDecoderForCausalLM",
  "MptForCausalLM",
  "NanoChatForCausalLM",
  "NemotronHForCausalLM",
  "OlmoForCausalLM",
  "Olmo2ForCausalLM",
  "Olmo3ForCausalLM",
  "OlmoHybridForCausalLM",
  "OpenELMForCausalLM",
  "OPTForCausalLM",
  "PhiForCausalLM",
  "Phi3ForCausalLM",
  "Qwen2ForCausalLM",
  "Qwen2MoeForCausalLM",
  "Qwen3ForCausalLM",
  "Qwen3NextForCausalLM",
  "Qwen3_5ForCausalLM",
  "Qwen3_5MoeForCausalLM",
  "Qwen3MoeForCausalLM",
  "SmolLM3ForCausalLM",
  "SolarOpenForCausalLM",
  "StableLmForCausalLM",
  "Starcoder2ForCausalLM",
  "VaultGemmaForCausalLM",
  "YoutuForCausalLM"
]);

const GRAPH_CANDIDATES: readonly { path: string; dtype: CommunityModelDtype }[] = [
  { path: "onnx/model_q4f16.onnx", dtype: "q4f16" },
  { path: "onnx/model_q4.onnx", dtype: "q4" },
  { path: "onnx/model_fp16.onnx", dtype: "fp16" },
  { path: "onnx/model.onnx", dtype: "fp32" }
];

export function assessCommunityModelCompatibility(
  model: CommunityModelDetails,
  options: { maxDownloadBytes?: number } = {}
): CommunityModelCompatibility {
  const issues: CommunityModelCompatibilityIssue[] = [];
  if (!model.revision) addError(issues, "revision-missing", "The repository does not expose an immutable commit SHA.");
  if (model.gated) addError(issues, "gated-model", "Gated Hugging Face models are not supported in the first community catalog release.");
  if (model.private) addError(issues, "private-model", "Private Hugging Face models are not supported in the first community catalog release.");
  if (model.pipelineTask && model.pipelineTask !== ONNX_COMMUNITY_TASK) addError(issues, "unsupported-task", "Only text-generation models can use Sophon's chat interface.");
  if (model.libraryName && model.libraryName !== ONNX_COMMUNITY_LIBRARY && !model.tags.includes(ONNX_COMMUNITY_LIBRARY)) {
    addError(issues, "unsupported-library", "The repository declares a library that is incompatible with Transformers.js.");
  }
  if (!model.architecture) {
    addError(issues, "architecture-missing", "The repository does not declare a model architecture.");
  } else if (!SUPPORTED_ARCHITECTURES.has(model.architecture)) {
    addError(issues, "unsupported-architecture", `${model.architecture} is not in Sophon's supported text-generation architecture set.`);
  }
  if (!model.chatTemplate) addError(issues, "chat-template-missing", "The tokenizer does not provide a chat template.");
  if (!model.license) addWarning(issues, "license-missing", "The ONNX repository does not declare a license; users must review the source model card.");

  const graph = selectGraph(model.files);
  if (!graph) addError(issues, "onnx-graph-missing", "No supported ONNX graph variant was found.");
  const relatedFiles = graph ? getGraphFiles(graph.file, model.files) : [];
  const estimatedDownloadBytes = relatedFiles.length > 0 && relatedFiles.every((file) => file.size !== null)
    ? relatedFiles.reduce((total, file) => total + (file.size ?? 0), 0)
    : null;
  if (graph && estimatedDownloadBytes === null) {
    addError(issues, "file-size-missing", "The selected ONNX graph has files without a trustworthy size.");
  }
  if (graph && relatedFiles.some((file) => file.sha256 === null)) {
    addError(issues, "file-integrity-missing", "The selected ONNX graph has files without a Hub SHA-256 digest.");
  }
  const maxDownloadBytes = normalizeLimit(options.maxDownloadBytes);
  if (estimatedDownloadBytes !== null && estimatedDownloadBytes > maxDownloadBytes) {
    addError(issues, "model-too-large", `The selected ONNX graph exceeds Sophon's ${formatBytes(maxDownloadBytes)} safety limit.`);
  }

  return {
    status: issues.some((issue) => issue.severity === "error") ? "unsupported" : "compatible",
    issues,
    selectedDtype: graph?.dtype ?? null,
    selectedGraph: graph?.file.path ?? null,
    estimatedDownloadBytes
  };
}

function selectGraph(files: readonly CommunityModelFile[]) {
  for (const candidate of GRAPH_CANDIDATES) {
    const file = files.find((entry) => entry.path === candidate.path);
    if (file) return { ...candidate, file };
  }
  return null;
}

function getGraphFiles(graph: CommunityModelFile, files: readonly CommunityModelFile[]) {
  const externalPrefix = `${graph.path}_data`;
  return files.filter((file) => file.path === graph.path || file.path.startsWith(externalPrefix));
}

function addError(
  issues: CommunityModelCompatibilityIssue[],
  code: CommunityModelCompatibilityIssue["code"],
  message: string
) {
  issues.push({ code, severity: "error", message });
}

function addWarning(
  issues: CommunityModelCompatibilityIssue[],
  code: CommunityModelCompatibilityIssue["code"],
  message: string
) {
  issues.push({ code, severity: "warning", message });
}

function normalizeLimit(value: number | undefined) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_COMMUNITY_MODEL_SIZE_LIMIT;
}

function formatBytes(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${Number((bytes / 1024 ** 3).toFixed(1))} GB`
    : `${Math.ceil(bytes / 1024 ** 2)} MB`;
}
