export const ONNX_COMMUNITY_NAMESPACE = "onnx-community";
export const ONNX_COMMUNITY_TASK = "text-generation";
export const ONNX_COMMUNITY_LIBRARY = "transformers.js";

export type CommunityModelDtype = "q4f16" | "q4" | "fp16" | "fp32";

export type CommunityModelSummary = {
  repo: string;
  name: string;
  revision: string | null;
  pipelineTask: string | null;
  libraryName: string | null;
  gated: boolean;
  private: boolean;
  downloads: number;
  likes: number;
  parameterCount: number | null;
  updatedAt: string | null;
  tags: readonly string[];
  license: string | null;
};

export type CommunityModelFile = {
  path: string;
  size: number | null;
  blobId: string | null;
  sha256: string | null;
};

export type CommunityModelDetails = CommunityModelSummary & {
  architecture: string | null;
  modelType: string | null;
  chatTemplate: string | null;
  baseModel: string | null;
  files: readonly CommunityModelFile[];
};

export type CommunityModelCatalogPage = {
  models: readonly CommunityModelSummary[];
  nextCursor: string | null;
};

export type CommunityModelCompatibilityCode =
  | "architecture-missing"
  | "chat-template-missing"
  | "file-integrity-missing"
  | "file-size-missing"
  | "gated-model"
  | "license-missing"
  | "model-too-large"
  | "onnx-graph-missing"
  | "private-model"
  | "revision-missing"
  | "unsupported-architecture"
  | "unsupported-library"
  | "unsupported-task";

export type CommunityModelCompatibilityIssue = {
  code: CommunityModelCompatibilityCode;
  severity: "error" | "warning";
  message: string;
};

export type CommunityModelCompatibility = {
  status: "compatible" | "unsupported";
  issues: readonly CommunityModelCompatibilityIssue[];
  selectedDtype: CommunityModelDtype | null;
  selectedGraph: string | null;
  estimatedDownloadBytes: number | null;
};

export type CommunityModelDescriptor = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly source: {
    readonly kind: "huggingface";
    readonly repo: string;
    readonly revision: string;
  };
  readonly task: "text-generation";
  readonly runtime: {
    readonly architecture: string;
    readonly modelType: string | null;
  };
  readonly format: {
    readonly dtype: CommunityModelDtype;
    readonly graphPath: string;
    readonly totalBytes: number;
  };
  readonly metadata: {
    readonly baseModel: string | null;
    readonly license: string | null;
  };
  readonly files: readonly CommunityModelFile[];
};

export type CommunityModelPreviewSelection = {
  readonly details: CommunityModelDetails;
  readonly compatibility: CommunityModelCompatibility;
  readonly descriptor: CommunityModelDescriptor | null;
};
