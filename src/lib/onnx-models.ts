import type { HardwareTier } from "@/lib/browser-runtime";
import { getSavedCommunityModelDescriptor } from "@/lib/model-catalog/descriptor-store";
import type { CommunityModelDescriptor } from "@/lib/model-catalog/types";

export type ModelProvider = "webgpu" | "wasm";
export type ModelVerification = "verified" | "experimental";
export type { HardwareTier } from "@/lib/browser-runtime";

export type ModelManifest = {
  id: string;
  label: string;
  description: string;
  licenseLabel: string;
  parameterLabel: string;
  verification: ModelVerification;
  source: {
    kind: "huggingface";
    repo: string;
    revision: string;
  };
  format: {
    quantization: "fp32" | "fp16" | "int8" | "q4" | "q4f16";
    sizeLabel: string;
    sizeBytes: number;
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

export function getModelRuntimeProfile(model: ModelManifest, hardwareTier: HardwareTier) {
  return {
    contextLength: hardwareTier === "mobile"
      ? Math.min(model.format.contextLength ?? model.runtime.mobileContextLength, model.runtime.mobileContextLength)
      : model.format.contextLength,
    maxNewTokens: hardwareTier === "mobile" ? model.runtime.mobileMaxNewTokens : model.runtime.maxNewTokens
  };
}

export async function resolveModelDefinition(id: string): Promise<ModelManifest> {
  if (!id.startsWith("hf:")) throw new Error(`Unknown model identifier: ${id}`);
  const descriptor = await getSavedCommunityModelDescriptor(id);
  if (!descriptor) throw new Error(`The community model descriptor is missing or invalid: ${id}`);
  return communityDescriptorToManifest(descriptor);
}

export function communityDescriptorToManifest(descriptor: CommunityModelDescriptor): ModelManifest {
  return {
    id: descriptor.id,
    label: descriptor.name,
    description: `ONNX Community model pinned to ${descriptor.source.revision.slice(0, 8)}.`,
    licenseLabel: descriptor.metadata.license ?? "License not specified",
    parameterLabel: "Community",
    verification: "experimental",
    source: descriptor.source,
    format: {
      quantization: descriptor.format.dtype,
      sizeLabel: formatModelBytes(descriptor.format.totalBytes),
      sizeBytes: descriptor.format.totalBytes,
      contextLength: null
    },
    runtime: { maxNewTokens: 128, mobileContextLength: 2048, mobileMaxNewTokens: 64 },
    providers: ["webgpu"]
  };
}

function formatModelBytes(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
