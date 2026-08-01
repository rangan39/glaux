import { assessCommunityModelCompatibility } from "@/lib/model-catalog/compatibility";
import {
  ONNX_COMMUNITY_NAMESPACE,
  ONNX_COMMUNITY_TASK,
  type CommunityModelDescriptor,
  type CommunityModelDetails,
  type CommunityModelDtype,
  type CommunityModelFile
} from "@/lib/model-catalog/types";

const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^onnx-community\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const MAX_REPOSITORY_FILES = 2_048;
const GRAPH_PATHS: Readonly<Record<CommunityModelDtype, string>> = {
  q4f16: "onnx/model_q4f16.onnx",
  q4: "onnx/model_q4.onnx",
  fp16: "onnx/model_fp16.onnx",
  fp32: "onnx/model.onnx"
};

export class CommunityModelDescriptorError extends Error {
  readonly code: "invalid" | "unsupported";

  constructor(code: CommunityModelDescriptorError["code"], message: string) {
    super(message);
    this.name = "CommunityModelDescriptorError";
    this.code = code;
  }
}

export function createCommunityModelDescriptor(
  model: CommunityModelDetails,
  options: { maxDownloadBytes?: number } = {}
): CommunityModelDescriptor {
  const compatibility = assessCommunityModelCompatibility(model, options);
  if (compatibility.status !== "compatible"
    || !model.revision
    || !model.architecture
    || !compatibility.selectedDtype
    || !compatibility.selectedGraph
    || compatibility.estimatedDownloadBytes === null) {
    const reasons = compatibility.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.message)
      .join(" ");
    throw new CommunityModelDescriptorError("unsupported", reasons || "The community model is not compatible with Glaux.");
  }

  const descriptor = parseCommunityModelDescriptor({
    schemaVersion: 1,
    id: createCommunityModelDescriptorId(model.repo, model.revision, compatibility.selectedDtype),
    name: model.name,
    source: { kind: "huggingface", repo: model.repo, revision: model.revision },
    task: ONNX_COMMUNITY_TASK,
    runtime: { architecture: model.architecture, modelType: model.modelType },
    format: {
      dtype: compatibility.selectedDtype,
      graphPath: compatibility.selectedGraph,
      totalBytes: compatibility.estimatedDownloadBytes
    },
    metadata: { baseModel: model.baseModel, license: model.license },
    files: model.files
  });
  if (!descriptor) throw new CommunityModelDescriptorError("invalid", "Glaux could not create a valid immutable model descriptor.");
  return descriptor;
}

export function createCommunityModelDescriptorId(repo: string, revision: string, dtype: CommunityModelDtype) {
  if (!REPOSITORY_PATTERN.test(repo) || !REVISION_PATTERN.test(revision) || !(dtype in GRAPH_PATHS)) {
    throw new CommunityModelDescriptorError("invalid", "A valid ONNX Community repository, commit, and data type are required.");
  }
  return `hf:${repo}@${revision}:${dtype}`;
}

export function parseCommunityModelDescriptor(value: unknown): CommunityModelDescriptor | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const source = isRecord(value.source) ? value.source : null;
  const runtime = isRecord(value.runtime) ? value.runtime : null;
  const format = isRecord(value.format) ? value.format : null;
  const metadata = isRecord(value.metadata) ? value.metadata : null;
  if (!source || !runtime || !format || !metadata || !Array.isArray(value.files)) return null;

  const repo = readString(source.repo, 180);
  const revision = readString(source.revision, 40);
  const dtype = readDtype(format.dtype);
  const name = readString(value.name, 160);
  const architecture = readString(runtime.architecture, 160);
  const modelType = readNullableString(runtime.modelType, 120);
  const graphPath = readString(format.graphPath, 512);
  const baseModel = readNullableString(metadata.baseModel, 180);
  const license = readNullableString(metadata.license, 160);
  if (source.kind !== "huggingface"
    || value.task !== ONNX_COMMUNITY_TASK
    || !repo
    || !repo.startsWith(`${ONNX_COMMUNITY_NAMESPACE}/`)
    || !REPOSITORY_PATTERN.test(repo)
    || !revision
    || !REVISION_PATTERN.test(revision)
    || !dtype
    || !name
    || !architecture
    || !graphPath
    || graphPath !== GRAPH_PATHS[dtype]
    || modelType === undefined
    || baseModel === undefined
    || license === undefined
    || !Number.isSafeInteger(format.totalBytes)
    || Number(format.totalBytes) <= 0
    || value.files.length === 0
    || value.files.length > MAX_REPOSITORY_FILES) return null;

  const files: CommunityModelFile[] = [];
  const paths = new Set<string>();
  for (const rawFile of value.files) {
    const file = parseFile(rawFile);
    if (!file || paths.has(file.path)) return null;
    paths.add(file.path);
    files.push(file);
  }
  const graphFiles = files.filter((file) => file.path === graphPath || file.path.startsWith(`${graphPath}_data`));
  if (graphFiles.length === 0
    || graphFiles.some((file) => file.size === null || file.sha256 === null)) return null;
  const totalBytes = graphFiles.reduce((total, file) => total + (file.size ?? 0), 0);
  if (totalBytes !== format.totalBytes) return null;

  const id = createCommunityModelDescriptorId(repo, revision, dtype);
  if (value.id !== id) return null;
  return freezeDescriptor({
    schemaVersion: 1,
    id,
    name,
    source: { kind: "huggingface", repo, revision },
    task: ONNX_COMMUNITY_TASK,
    runtime: { architecture, modelType },
    format: { dtype, graphPath, totalBytes },
    metadata: { baseModel, license },
    files
  });
}

function parseFile(value: unknown): CommunityModelFile | null {
  if (!isRecord(value)) return null;
  const path = readString(value.path, 512);
  const size = value.size === null
    ? null
    : typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size > 0 ? value.size : undefined;
  const blobId = readNullableDigest(value.blobId, /^[a-f0-9]{40,64}$/);
  const sha256 = readNullableDigest(value.sha256, /^[a-f0-9]{64}$/);
  if (!path || !isSafeRepositoryPath(path) || size === undefined || blobId === undefined || sha256 === undefined) return null;
  return { path, size, blobId, sha256 };
}

function freezeDescriptor(descriptor: CommunityModelDescriptor) {
  const files = Object.freeze(descriptor.files.map((file) => Object.freeze({ ...file })));
  return Object.freeze({
    ...descriptor,
    source: Object.freeze({ ...descriptor.source }),
    runtime: Object.freeze({ ...descriptor.runtime }),
    format: Object.freeze({ ...descriptor.format }),
    metadata: Object.freeze({ ...descriptor.metadata }),
    files
  });
}

function readDtype(value: unknown): CommunityModelDtype | null {
  return value === "q4f16" || value === "q4" || value === "fp16" || value === "fp32" ? value : null;
}

function readString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength ? value : null;
}

function readNullableString(value: unknown, maxLength: number) {
  if (value === null) return null;
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength ? value : undefined;
}

function readNullableDigest(value: unknown, pattern: RegExp) {
  if (value === null) return null;
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function isSafeRepositoryPath(path: string) {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || /%(?:00|2e|2f|5c)/i.test(path)) return false;
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
