import {
  ONNX_COMMUNITY_NAMESPACE,
  type CommunityModelCatalogPage,
  type CommunityModelDetails,
  type CommunityModelFile,
  type CommunityModelSummary
} from "@/lib/model-catalog/types";
import { isSafeRepositoryPath } from "@/lib/model-catalog/repository-path";

const HUB_ORIGIN = "https://huggingface.co";
const MAX_PAGE_SIZE = 50;
const MAX_CURSOR_LENGTH = 4_096;
const MAX_REPOSITORY_FILES = 2_048;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^onnx-community\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

export type CommunityIndexPageQuery = {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
};

export type CatalogFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class HuggingFaceCatalogError extends Error {
  readonly code: "invalid-request" | "network" | "not-found" | "response" | "revision-mismatch";

  constructor(
    code: HuggingFaceCatalogError["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "HuggingFaceCatalogError";
    this.code = code;
  }
}

export function buildOnnxCommunityIndexUrl(query: Omit<CommunityIndexPageQuery, "signal"> = {}) {
  const url = new URL("/api/models", HUB_ORIGIN);
  url.searchParams.set("author", ONNX_COMMUNITY_NAMESPACE);
  url.searchParams.set("gated", "false");
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("full", "true");
  url.searchParams.set("limit", String(clampInteger(query.limit ?? MAX_PAGE_SIZE, 1, MAX_PAGE_SIZE)));
  const cursor = normalizeOptionalString(query.cursor, MAX_CURSOR_LENGTH);
  if (cursor) url.searchParams.set("cursor", cursor);
  return url;
}

export async function fetchOnnxCommunityIndexPage(
  query: CommunityIndexPageQuery = {},
  fetcher: CatalogFetch = globalThis.fetch as CatalogFetch
): Promise<CommunityModelCatalogPage> {
  const response = await request(buildOnnxCommunityIndexUrl(query), query.signal, fetcher);
  return readCatalogPage(response, "index");
}

async function readCatalogPage(response: Response, source: "catalog" | "index"): Promise<CommunityModelCatalogPage> {
  const payload = await readJson(response);
  if (!Array.isArray(payload)) throw invalidResponse(`The Hugging Face model ${source} returned a non-list response.`);
  if (payload.length > MAX_PAGE_SIZE) throw invalidResponse(`The Hugging Face model ${source} exceeded the requested page limit.`);
  const seen = new Set<string>();
  const models = payload.flatMap((entry) => {
    const model = normalizeCommunityModelSummary(entry);
    if (!model || model.gated || model.private || seen.has(model.repo)) return [];
    seen.add(model.repo);
    return [model];
  });
  return { models, nextCursor: readNextCursor(response.headers.get("link")) };
}

export async function fetchOnnxCommunityModelDetails(
  repo: string,
  revision: string,
  options: { signal?: AbortSignal } = {},
  fetcher: CatalogFetch = globalThis.fetch as CatalogFetch
): Promise<CommunityModelDetails> {
  if (!REPOSITORY_PATTERN.test(repo)) {
    throw new HuggingFaceCatalogError("invalid-request", "Only repositories in the ONNX Community namespace can be inspected.");
  }
  if (!REVISION_PATTERN.test(revision)) {
    throw new HuggingFaceCatalogError("invalid-request", "A full Hugging Face commit SHA is required before inspecting a model.");
  }

  const [namespace, name] = repo.split("/") as [string, string];
  const url = new URL(`/api/models/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/revision/${revision}`, HUB_ORIGIN);
  url.searchParams.set("blobs", "true");
  url.searchParams.set("cardData", "true");
  const response = await request(url, options.signal, fetcher);
  const payload = await readJson(response);
  const summary = normalizeCommunityModelSummary(payload);
  if (!summary || summary.repo !== repo) throw invalidResponse("The Hugging Face model response did not match the requested repository.");
  if (summary.revision !== revision) {
    throw new HuggingFaceCatalogError("revision-mismatch", "The Hugging Face model response did not match the pinned revision.");
  }
  if (!isRecord(payload)) throw invalidResponse("The Hugging Face model response was malformed.");

  const siblings = payload.siblings;
  if (!Array.isArray(siblings)) throw invalidResponse("The Hugging Face model response did not include a file list.");
  if (siblings.length > MAX_REPOSITORY_FILES) throw invalidResponse("The Hugging Face repository contains too many files to inspect safely.");
  const files = siblings.flatMap((entry) => {
    const file = normalizeFile(entry);
    return file ? [file] : [];
  });
  if (files.length !== siblings.length) throw invalidResponse("The Hugging Face repository contained an invalid or unsafe file entry.");

  const config = isRecord(payload.config) ? payload.config : null;
  const tokenizerConfig = config && isRecord(config.tokenizer_config) ? config.tokenizer_config : null;
  const architecture = config && Array.isArray(config.architectures)
    ? normalizeOptionalString(config.architectures[0], 160)
    : null;

  return {
    ...summary,
    architecture,
    modelType: config ? normalizeOptionalString(config.model_type, 120) : null,
    chatTemplate: tokenizerConfig ? normalizeOptionalText(tokenizerConfig.chat_template, 100_000) : null,
    baseModel: readBaseModel(payload.cardData, summary.tags),
    files
  };
}

function normalizeCommunityModelSummary(value: unknown): CommunityModelSummary | null {
  if (!isRecord(value)) return null;
  const repo = normalizeOptionalString(value.id, 180);
  if (!repo || !REPOSITORY_PATTERN.test(repo)) return null;
  const tags = normalizeStringArray(value.tags, 200, 160);
  const cardData = isRecord(value.cardData) ? value.cardData : null;
  const safetensors = isRecord(value.safetensors) ? value.safetensors : null;
  const revision = normalizeOptionalString(value.sha, 40);
  return {
    repo,
    name: repo.slice(ONNX_COMMUNITY_NAMESPACE.length + 1),
    revision: revision && REVISION_PATTERN.test(revision) ? revision : null,
    pipelineTask: normalizeOptionalString(value.pipeline_tag, 120),
    libraryName: normalizeOptionalString(value.library_name, 120),
    gated: value.gated === true || typeof value.gated === "string",
    private: value.private === true,
    downloads: normalizeNonNegativeInteger(value.downloads),
    likes: normalizeNonNegativeInteger(value.likes),
    parameterCount: normalizePositiveInteger(safetensors?.total),
    updatedAt: normalizeDate(value.lastModified ?? value.last_modified),
    tags,
    license: readLicense(cardData, tags)
  };
}

function normalizePositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeFile(value: unknown): CommunityModelFile | null {
  if (!isRecord(value)) return null;
  const path = normalizeOptionalString(value.rfilename, 512);
  if (!path || !isSafeRepositoryPath(path)) return null;
  const lfs = isRecord(value.lfs) ? value.lfs : null;
  const size = normalizeFileSize(value.size ?? lfs?.size);
  const blobId = normalizeOptionalString(value.blobId, 64);
  const sha256 = lfs ? normalizeOptionalString(lfs.sha256, 64) : null;
  return {
    path,
    size,
    blobId: blobId && /^[a-f0-9]{40,64}$/.test(blobId) ? blobId : null,
    sha256: sha256 && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null
  };
}

function readLicense(cardData: Record<string, unknown> | null, tags: readonly string[]) {
  const cardLicense = cardData ? normalizeOptionalString(cardData.license, 160) : null;
  if (cardLicense) return cardLicense;
  return tags.find((tag) => tag.startsWith("license:"))?.slice("license:".length) || null;
}

function readBaseModel(cardDataValue: unknown, tags: readonly string[]) {
  const cardData = isRecord(cardDataValue) ? cardDataValue : null;
  const raw = cardData?.base_model;
  const fromCard = Array.isArray(raw)
    ? normalizeOptionalString(raw[0], 180)
    : normalizeOptionalString(raw, 180);
  if (fromCard) return fromCard;
  return tags.find((tag) => tag.startsWith("base_model:") && !tag.startsWith("base_model:quantized:"))
    ?.slice("base_model:".length) || null;
}

function readNextCursor(link: string | null) {
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/i);
  if (!match?.[1]) return null;
  try {
    const url = new URL(match[1]);
    if (url.origin !== HUB_ORIGIN || url.pathname !== "/api/models") return null;
    if (url.searchParams.get("author") !== ONNX_COMMUNITY_NAMESPACE) return null;
    const cursor = url.searchParams.get("cursor");
    return cursor && cursor.length <= MAX_CURSOR_LENGTH ? cursor : null;
  } catch {
    return null;
  }
}

async function request(url: URL, signal: AbortSignal | undefined, fetcher: CatalogFetch) {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
      signal
    });
  } catch (error) {
    throw new HuggingFaceCatalogError("network", "The Hugging Face model catalog could not be reached.", { cause: error });
  }
  if (response.ok) return response;
  if (response.status === 404) throw new HuggingFaceCatalogError("not-found", "The requested Hugging Face model revision was not found.");
  throw new HuggingFaceCatalogError("response", `The Hugging Face model catalog returned HTTP ${response.status}.`);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new HuggingFaceCatalogError("response", "The Hugging Face model catalog returned invalid JSON.", { cause: error });
  }
}

function invalidResponse(message: string) {
  return new HuggingFaceCatalogError("response", message);
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).flatMap((entry) => {
    const normalized = normalizeOptionalString(entry, maxLength);
    return normalized ? [normalized] : [];
  });
}

function normalizeOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength ? value : null;
}

function normalizeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeFileSize(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
