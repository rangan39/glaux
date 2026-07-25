export const SOPHON_MODEL_PACK_FORMAT = 1;
export const SOPHON_MODEL_PACK_MAX_HEADER_BYTES = 1024 * 1024;
export const SOPHON_MODEL_PACK_MAGIC = Uint8Array.from([
  0x53, 0x4f, 0x50, 0x48, 0x4f, 0x4e, 0x5f, 0x4d, 0x4f,
  0x44, 0x45, 0x4c, 0x5f, 0x50, 0x41, 0x43, 0x4b, 0x00
]);
export const SOPHON_MODEL_PACK_PREAMBLE_BYTES = SOPHON_MODEL_PACK_MAGIC.byteLength + 8;

export type SophonModelPackLicense = {
  spdx: "CC-BY-NC-4.0";
  modelCardUrl: string;
  acceptableUsePolicyUrl: string;
  attribution: string;
};

export type SophonModelPackArtifact = {
  path: string;
  offset: number;
  size: number;
  sha256: string;
  segments: string[];
};

export type SophonModelPackHeader = {
  schemaVersion: 1;
  modelId: string;
  repo: string;
  revision: string;
  quantization: "q4f16";
  segmentSize: number;
  artifacts: SophonModelPackArtifact[];
  license: SophonModelPackLicense;
};

export type ParsedSophonModelPack = {
  header: SophonModelPackHeader;
  payloadOffset: number;
  payloadBytes: number;
};

export type ModelPackFormatErrorCode =
  | "unsupported-format"
  | "invalid-header"
  | "truncated-file"
  | "trailing-data";

export class ModelPackFormatError extends Error {
  readonly code: ModelPackFormatErrorCode;

  constructor(code: ModelPackFormatErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelPackFormatError";
    this.code = code;
  }
}

export async function parseSophonModelPack(file: Blob): Promise<ParsedSophonModelPack> {
  if (file.size < SOPHON_MODEL_PACK_PREAMBLE_BYTES) {
    throw new ModelPackFormatError("truncated-file", "The offline pack is truncated before its header.");
  }
  const preamble = new Uint8Array(await file.slice(0, SOPHON_MODEL_PACK_PREAMBLE_BYTES).arrayBuffer());
  if (!bytesEqual(preamble.subarray(0, SOPHON_MODEL_PACK_MAGIC.byteLength), SOPHON_MODEL_PACK_MAGIC)) {
    throw new ModelPackFormatError("invalid-header", "This file is not a Sophon offline model pack.");
  }
  const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
  const format = view.getUint32(SOPHON_MODEL_PACK_MAGIC.byteLength, true);
  if (format !== SOPHON_MODEL_PACK_FORMAT) {
    throw new ModelPackFormatError("unsupported-format", `Offline pack format ${format} is not supported by this version of Sophon.`);
  }
  const headerBytes = view.getUint32(SOPHON_MODEL_PACK_MAGIC.byteLength + 4, true);
  if (headerBytes === 0 || headerBytes > SOPHON_MODEL_PACK_MAX_HEADER_BYTES) {
    throw new ModelPackFormatError("invalid-header", `The offline pack header must be between 1 byte and ${SOPHON_MODEL_PACK_MAX_HEADER_BYTES} bytes.`);
  }
  const payloadOffset = SOPHON_MODEL_PACK_PREAMBLE_BYTES + headerBytes;
  if (!Number.isSafeInteger(payloadOffset) || payloadOffset > file.size) {
    throw new ModelPackFormatError("truncated-file", "The offline pack ended before its declared header was complete.");
  }
  const encodedHeader = new Uint8Array(await file.slice(SOPHON_MODEL_PACK_PREAMBLE_BYTES, payloadOffset).arrayBuffer());
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(encodedHeader);
  } catch (error) {
    throw new ModelPackFormatError("invalid-header", "The offline pack header is not valid UTF-8.", { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch (error) {
    throw new ModelPackFormatError("invalid-header", "The offline pack header is not valid JSON.", { cause: error });
  }
  let canonical: Uint8Array;
  try {
    canonical = new TextEncoder().encode(canonicalJson(value));
  } catch (error) {
    throw new ModelPackFormatError("invalid-header", "The offline pack header contains unsupported JSON values.", { cause: error });
  }
  if (!bytesEqual(encodedHeader, canonical)) {
    throw new ModelPackFormatError("invalid-header", "The offline pack header is not in canonical JSON form.");
  }
  const header = validatePackHeader(value);
  const payloadBytes = header.artifacts.reduce((total, artifact) => total + artifact.size, 0);
  const expectedBytes = payloadOffset + payloadBytes;
  if (!Number.isSafeInteger(expectedBytes)) {
    throw new ModelPackFormatError("invalid-header", "The offline pack declares an unsafe total size.");
  }
  if (file.size < expectedBytes) {
    throw new ModelPackFormatError("truncated-file", `The offline pack is truncated at ${file.size} of ${expectedBytes} bytes.`);
  }
  if (file.size > expectedBytes) {
    throw new ModelPackFormatError("trailing-data", `The offline pack has ${file.size - expectedBytes} unexpected trailing bytes.`);
  }
  return { header, payloadOffset, payloadBytes };
}

export function encodeSophonModelPackPreamble(header: SophonModelPackHeader) {
  const encodedHeader = new TextEncoder().encode(canonicalJson(header));
  if (encodedHeader.byteLength === 0 || encodedHeader.byteLength > SOPHON_MODEL_PACK_MAX_HEADER_BYTES) {
    throw new ModelPackFormatError("invalid-header", "The generated offline pack header exceeds the 1 MiB limit.");
  }
  const preamble = new Uint8Array(SOPHON_MODEL_PACK_PREAMBLE_BYTES + encodedHeader.byteLength);
  preamble.set(SOPHON_MODEL_PACK_MAGIC);
  const view = new DataView(preamble.buffer);
  view.setUint32(SOPHON_MODEL_PACK_MAGIC.byteLength, SOPHON_MODEL_PACK_FORMAT, true);
  view.setUint32(SOPHON_MODEL_PACK_MAGIC.byteLength + 4, encodedHeader.byteLength, true);
  preamble.set(encodedHeader, SOPHON_MODEL_PACK_PREAMBLE_BYTES);
  return preamble;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Canonical model-pack JSON only supports safe integers.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical model-pack JSON contains an unsupported value.");
}

function validatePackHeader(value: unknown): SophonModelPackHeader {
  const header = requireRecord(value, "header");
  requireExactKeys(header, ["schemaVersion", "modelId", "repo", "revision", "quantization", "segmentSize", "artifacts", "license"], "header");
  if (header.schemaVersion !== 1) {
    throw new ModelPackFormatError("invalid-header", "The offline pack schema version must be 1.");
  }
  const modelId = requireBoundedString(header.modelId, "modelId", 1, 128);
  const repo = requireBoundedString(header.repo, "repo", 1, 256);
  const revision = requireBoundedString(header.revision, "revision", 40, 64);
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new ModelPackFormatError("invalid-header", "The offline pack revision must be an immutable 40-character commit.");
  }
  if (header.quantization !== "q4f16") {
    throw new ModelPackFormatError("invalid-header", "The offline pack quantization must be q4f16.");
  }
  const segmentSize = requirePositiveSafeInteger(header.segmentSize, "segmentSize");
  if (segmentSize > 128 * 1024 * 1024) {
    throw new ModelPackFormatError("invalid-header", "The offline pack segment size exceeds Sophon's memory budget.");
  }
  if (!Array.isArray(header.artifacts) || header.artifacts.length === 0 || header.artifacts.length > 64) {
    throw new ModelPackFormatError("invalid-header", "The offline pack must declare between 1 and 64 artifacts.");
  }
  const artifacts: SophonModelPackArtifact[] = [];
  const paths = new Set<string>();
  let nextOffset = 0;
  for (const [index, entry] of header.artifacts.entries()) {
    const artifact = requireRecord(entry, `artifact ${index}`);
    requireExactKeys(artifact, ["path", "offset", "size", "sha256", "segments"], `artifact ${index}`);
    const path = requireSafePath(artifact.path, index);
    if (paths.has(path)) throw new ModelPackFormatError("invalid-header", `The offline pack contains duplicate artifact path ${path}.`);
    paths.add(path);
    const offset = requireNonNegativeSafeInteger(artifact.offset, `offset for ${path}`);
    const size = requirePositiveSafeInteger(artifact.size, `size for ${path}`);
    if (offset !== nextOffset) {
      throw new ModelPackFormatError("invalid-header", `Artifact ${path} creates an overlap or gap at payload offset ${offset}.`);
    }
    if (!Array.isArray(artifact.segments)) {
      throw new ModelPackFormatError("invalid-header", `Artifact ${path} has no segment digest list.`);
    }
    const expectedSegments = Math.ceil(size / segmentSize);
    if (artifact.segments.length !== expectedSegments || artifact.segments.some((digest) => typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))) {
      throw new ModelPackFormatError("invalid-header", `Artifact ${path} must contain exactly ${expectedSegments} valid segment digests.`);
    }
    if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      throw new ModelPackFormatError("invalid-header", `Artifact ${path} has an invalid SHA-256 digest.`);
    }
    nextOffset += size;
    if (!Number.isSafeInteger(nextOffset)) {
      throw new ModelPackFormatError("invalid-header", "The offline pack payload size is unsafe.");
    }
    artifacts.push({ path, offset, size, sha256: artifact.sha256, segments: [...artifact.segments] });
  }
  const licenseRecord = requireRecord(header.license, "license");
  requireExactKeys(licenseRecord, ["spdx", "modelCardUrl", "acceptableUsePolicyUrl", "attribution"], "license");
  if (licenseRecord.spdx !== "CC-BY-NC-4.0") {
    throw new ModelPackFormatError("invalid-header", "The offline pack must include the CC-BY-NC-4.0 license identifier.");
  }
  const license: SophonModelPackLicense = {
    spdx: licenseRecord.spdx,
    modelCardUrl: requireHttpsUrl(licenseRecord.modelCardUrl, "model card URL"),
    acceptableUsePolicyUrl: requireHttpsUrl(licenseRecord.acceptableUsePolicyUrl, "acceptable-use policy URL"),
    attribution: requireBoundedString(licenseRecord.attribution, "attribution", 1, 2048)
  };
  return {
    schemaVersion: 1,
    modelId,
    repo,
    revision,
    quantization: "q4f16",
    segmentSize,
    artifacts,
    license
  };
}

function requireSafePath(value: unknown, index: number) {
  const path = requireBoundedString(value, `path for artifact ${index}`, 1, 512);
  const parts = path.split("/");
  if (path.startsWith("/") || path.includes("\\") || path.includes(":") || !/^[A-Za-z0-9._/-]+$/.test(path)
    || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new ModelPackFormatError("invalid-header", `Artifact path ${JSON.stringify(path)} is not a safe allowlist path.`);
  }
  return path;
}

function requireHttpsUrl(value: unknown, field: string) {
  const url = requireBoundedString(value, field, 1, 2048);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new ModelPackFormatError("invalid-header", `The offline pack ${field} is invalid.`, { cause: error });
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ModelPackFormatError("invalid-header", `The offline pack ${field} must be an HTTPS URL without credentials.`);
  }
  return url;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ModelPackFormatError("invalid-header", `The offline pack ${field} must be an object.`);
  }
  return value;
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[], field: string) {
  const keys = Object.keys(record).sort();
  const allowed = [...expected].sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    throw new ModelPackFormatError("invalid-header", `The offline pack ${field} contains missing or unsupported fields.`);
  }
}

function requireBoundedString(value: unknown, field: string, minimum: number, maximum: number) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new ModelPackFormatError("invalid-header", `The offline pack ${field} must contain ${minimum}-${maximum} characters.`);
  }
  return value;
}

function requirePositiveSafeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new ModelPackFormatError("invalid-header", `The offline pack ${field} must be a positive safe integer.`);
  }
  return Number(value);
}

function requireNonNegativeSafeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ModelPackFormatError("invalid-header", `The offline pack ${field} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
