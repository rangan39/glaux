import type { HardwareTier } from "@/lib/browser-runtime";

export type ModelProvider = "webgpu" | "wasm";
export type ModelVerification = "verified" | "experimental";
export type ModelFamily = "cohere";
export type { HardwareTier } from "@/lib/browser-runtime";

type LocalModelSource = {
  kind: "local";
  baseUrl: string;
  revision: "bundled";
};

type HuggingFaceModelSource = {
  kind: "huggingface";
  repo: string;
  revision: string;
};

export type ModelManifest = {
  id: string;
  label: string;
  family: ModelFamily;
  description: string;
  licenseLabel: string;
  parameterLabel: string;
  verification: ModelVerification;
  source: LocalModelSource | HuggingFaceModelSource;
  format: {
    quantization: "fp32" | "fp16" | "int8" | "q4" | "q4f16";
    sizeLabel: string;
    sizeBytes: number | null;
    contextLength: number | null;
  };
  runtime: {
    maxNewTokens: number;
    mobileContextLength: number;
    mobileMaxNewTokens: number;
  };
  providers: readonly ModelProvider[];
};

export function resolveModelProvider(
  model: Pick<ModelManifest, "providers">,
  capabilities: Readonly<Record<ModelProvider, boolean>>
): ModelProvider | null {
  for (const provider of model.providers) {
    if (capabilities[provider]) return provider;
  }
  return null;
}

export const RECOMMENDED_MODEL_ID = "tiny-aya-global";

export function getModelRuntimeProfile(model: ModelManifest, hardwareTier: HardwareTier) {
  return {
    contextLength: hardwareTier === "mobile"
      ? Math.min(model.format.contextLength ?? model.runtime.mobileContextLength, model.runtime.mobileContextLength)
      : model.format.contextLength,
    maxNewTokens: hardwareTier === "mobile" ? model.runtime.mobileMaxNewTokens : model.runtime.maxNewTokens
  };
}

export const MODEL_REGISTRY = [
  {
    id: "tiny-aya-global",
    label: "Tiny Aya Global 3.35B · non-commercial",
    family: "cohere",
    description: "Balanced multilingual coverage across 70+ languages; CC BY-NC 4.0 and Cohere Labs AUP apply.",
    licenseLabel: "Non-commercial use",
    parameterLabel: "3.35B",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/tiny-aya-global-ONNX", revision: "7fff1be9627e40f0d89c33f406882bdafb56ec90" },
    format: { quantization: "q4f16", sizeLabel: "~2.35 GB", sizeBytes: 2_354_413_407, contextLength: 8192 },
    runtime: { maxNewTokens: 128, mobileContextLength: 2048, mobileMaxNewTokens: 64 },
    providers: ["webgpu"]
  },
  {
    id: "tiny-aya-earth",
    label: "Tiny Aya Earth 3.35B · non-commercial",
    family: "cohere",
    description: "Optimized for West Asian and African languages; CC BY-NC 4.0 and Cohere Labs AUP apply.",
    licenseLabel: "Non-commercial use",
    parameterLabel: "3.35B",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/tiny-aya-earth-ONNX", revision: "24a24ee8b8483762575fe734e57bad21ca36d8c6" },
    format: { quantization: "q4f16", sizeLabel: "~2.35 GB", sizeBytes: 2_354_413_397, contextLength: 8192 },
    runtime: { maxNewTokens: 128, mobileContextLength: 2048, mobileMaxNewTokens: 64 },
    providers: ["webgpu"]
  },
  {
    id: "tiny-aya-fire",
    label: "Tiny Aya Fire 3.35B · non-commercial",
    family: "cohere",
    description: "Optimized for South Asian languages; CC BY-NC 4.0 and Cohere Labs AUP apply.",
    licenseLabel: "Non-commercial use",
    parameterLabel: "3.35B",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/tiny-aya-fire-ONNX", revision: "70f6b7edf79955855d7939342d2a39ab644d3ed6" },
    format: { quantization: "q4f16", sizeLabel: "~2.35 GB", sizeBytes: 2_354_413_397, contextLength: 8192 },
    runtime: { maxNewTokens: 128, mobileContextLength: 2048, mobileMaxNewTokens: 64 },
    providers: ["webgpu"]
  },
  {
    id: "tiny-aya-water",
    label: "Tiny Aya Water 3.35B · non-commercial",
    family: "cohere",
    description: "Optimized for European and Asia-Pacific languages; CC BY-NC 4.0 and Cohere Labs AUP apply.",
    licenseLabel: "Non-commercial use",
    parameterLabel: "3.35B",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/tiny-aya-water-ONNX", revision: "e1109b664b476b709d13bf40dc105efb147caa09" },
    format: { quantization: "q4f16", sizeLabel: "~2.35 GB", sizeBytes: 2_354_413_397, contextLength: 8192 },
    runtime: { maxNewTokens: 128, mobileContextLength: 2048, mobileMaxNewTokens: 64 },
    providers: ["webgpu"]
  }
] as const satisfies readonly [ModelManifest, ...ModelManifest[]];

export function requireModelDefinition(id: string) {
  const model = MODEL_REGISTRY.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Unknown model identifier: ${id}`);
  return model;
}
