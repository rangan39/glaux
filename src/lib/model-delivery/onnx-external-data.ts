const DEFAULT_PAGE_SIZE = 64 * 1024;
const MAX_NESTING_DEPTH = 64;
const MAX_EXTERNAL_FILES = 256;
const MAX_EXTERNAL_PATH_LENGTH = 512;

export class OnnxExternalDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OnnxExternalDataError";
  }
}

export async function readOnnxExternalDataLocations(model: Blob, signal?: AbortSignal) {
  if (!(model instanceof Blob) || model.size <= 0) throw new OnnxExternalDataError("The ONNX graph is empty or unavailable.");
  throwIfAborted(signal);
  const reader = new BlobProtoReader(model, signal);
  const locations = new Set<string>();
  await parseModel(reader, model.size, locations, 0);
  return [...locations];
}

async function parseModel(reader: BlobProtoReader, end: number, locations: Set<string>, depth: number) {
  assertDepth(depth);
  while (reader.position < end) {
    const { field, wire } = await reader.readTag(end);
    if (field === 7) await parseNested(reader, end, wire, locations, depth, parseGraph);
    else await reader.skip(wire, end);
  }
}

async function parseGraph(reader: BlobProtoReader, end: number, locations: Set<string>, depth: number) {
  assertDepth(depth);
  while (reader.position < end) {
    const { field, wire } = await reader.readTag(end);
    if (field === 1) await parseNested(reader, end, wire, locations, depth, parseNode);
    else if (field === 5) await parseNested(reader, end, wire, locations, depth, parseTensor);
    else if (field === 15) await parseNested(reader, end, wire, locations, depth, parseSparseTensor);
    else await reader.skip(wire, end);
  }
}

async function parseNode(reader: BlobProtoReader, end: number, locations: Set<string>, depth: number) {
  assertDepth(depth);
  while (reader.position < end) {
    const { field, wire } = await reader.readTag(end);
    if (field === 5) await parseNested(reader, end, wire, locations, depth, parseAttribute);
    else await reader.skip(wire, end);
  }
}

async function parseAttribute(reader: BlobProtoReader, end: number, locations: Set<string>, depth: number) {
  assertDepth(depth);
  while (reader.position < end) {
    const { field, wire } = await reader.readTag(end);
    if (field === 5 || field === 10) await parseNested(reader, end, wire, locations, depth, parseTensor);
    else if (field === 6 || field === 11) await parseNested(reader, end, wire, locations, depth, parseGraph);
    else if (field === 22 || field === 23) await parseNested(reader, end, wire, locations, depth, parseSparseTensor);
    else await reader.skip(wire, end);
  }
}

async function parseSparseTensor(reader: BlobProtoReader, end: number, locations: Set<string>, depth: number) {
  assertDepth(depth);
  while (reader.position < end) {
    const { field, wire } = await reader.readTag(end);
    if (field === 1 || field === 2) await parseNested(reader, end, wire, locations, depth, parseTensor);
    else await reader.skip(wire, end);
  }
}

async function parseTensor(reader: BlobProtoReader, end: number, locations: Set<string>, depth: number) {
  assertDepth(depth);
  while (reader.position < end) {
    const { field, wire } = await reader.readTag(end);
    if (field === 13) await parseNested(reader, end, wire, locations, depth, parseExternalEntry);
    else await reader.skip(wire, end);
  }
}

async function parseExternalEntry(reader: BlobProtoReader, end: number, locations: Set<string>, depth: number) {
  assertDepth(depth);
  let key: string | null = null;
  let value: string | null = null;
  while (reader.position < end) {
    const { field, wire } = await reader.readTag(end);
    if ((field === 1 || field === 2) && wire === 2) {
      const text = await reader.readString(end, MAX_EXTERNAL_PATH_LENGTH);
      if (field === 1) key = text;
      else value = text;
    } else {
      await reader.skip(wire, end);
    }
  }
  if (key !== "location" || value === null) return;
  if (!isSafeExternalLocation(value)) throw new OnnxExternalDataError(`The ONNX graph referenced an unsafe external-data path: ${value}`);
  locations.add(value);
  if (locations.size > MAX_EXTERNAL_FILES) throw new OnnxExternalDataError("The ONNX graph references too many external-data files.");
}

async function parseNested(
  reader: BlobProtoReader,
  parentEnd: number,
  wire: number,
  locations: Set<string>,
  depth: number,
  parser: (reader: BlobProtoReader, end: number, locations: Set<string>, depth: number) => Promise<void>
) {
  if (wire !== 2) throw new OnnxExternalDataError("The ONNX graph contained an invalid protobuf field type.");
  const end = await reader.readMessageEnd(parentEnd);
  await parser(reader, end, locations, depth + 1);
  reader.position = end;
}

export function isSafeExternalLocation(path: string) {
  if (!path || path.length > MAX_EXTERNAL_PATH_LENGTH || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  if (/%(?:00|2e|2f|5c)/i.test(path)) return false;
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function assertDepth(depth: number) {
  if (depth > MAX_NESTING_DEPTH) throw new OnnxExternalDataError("The ONNX graph exceeded the supported protobuf nesting depth.");
}

class BlobProtoReader {
  position = 0;
  readonly #blob: Blob;
  readonly #signal?: AbortSignal;
  #page = new Uint8Array();
  #pageStart = -1;

  constructor(blob: Blob, signal?: AbortSignal) {
    this.#blob = blob;
    this.#signal = signal;
  }

  async readTag(end: number) {
    const tag = await this.readVarint(end);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field <= 0) throw new OnnxExternalDataError("The ONNX graph contained an invalid protobuf field number.");
    return { field, wire };
  }

  async readMessageEnd(parentEnd: number) {
    const length = await this.readVarint(parentEnd);
    const end = this.position + length;
    if (!Number.isSafeInteger(end) || end > parentEnd) throw new OnnxExternalDataError("The ONNX graph contained a truncated protobuf message.");
    return end;
  }

  async readString(parentEnd: number, maximumLength: number) {
    const length = await this.readVarint(parentEnd);
    if (length > maximumLength || this.position + length > parentEnd) {
      throw new OnnxExternalDataError("The ONNX graph contained an invalid external-data string.");
    }
    const bytes = new Uint8Array(await this.#blob.slice(this.position, this.position + length).arrayBuffer());
    throwIfAborted(this.#signal);
    this.position += length;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new OnnxExternalDataError("The ONNX graph contained invalid UTF-8 metadata.", { cause: error });
    }
  }

  async skip(wire: number, parentEnd: number) {
    if (wire === 0) {
      await this.readVarint(parentEnd);
      return;
    }
    if (wire === 1) return this.advance(8, parentEnd);
    if (wire === 2) return this.advance(await this.readVarint(parentEnd), parentEnd);
    if (wire === 5) return this.advance(4, parentEnd);
    throw new OnnxExternalDataError(`The ONNX graph used unsupported protobuf wire type ${wire}.`);
  }

  async readVarint(end: number) {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 10; index += 1) {
      const byte = await this.readByte(end);
      value += (byte & 0x7f) * multiplier;
      if (!Number.isSafeInteger(value)) throw new OnnxExternalDataError("The ONNX graph contained an oversized protobuf integer.");
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    throw new OnnxExternalDataError("The ONNX graph contained an unterminated protobuf integer.");
  }

  private async readByte(end: number) {
    throwIfAborted(this.#signal);
    if (this.position >= end || this.position >= this.#blob.size) {
      throw new OnnxExternalDataError("The ONNX graph ended inside a protobuf field.");
    }
    if (this.position < this.#pageStart || this.position >= this.#pageStart + this.#page.length) {
      this.#pageStart = Math.floor(this.position / DEFAULT_PAGE_SIZE) * DEFAULT_PAGE_SIZE;
      this.#page = new Uint8Array(await this.#blob.slice(this.#pageStart, this.#pageStart + DEFAULT_PAGE_SIZE).arrayBuffer());
      throwIfAborted(this.#signal);
    }
    const byte = this.#page[this.position - this.#pageStart];
    if (byte === undefined) throw new OnnxExternalDataError("The ONNX graph could not be read.");
    this.position += 1;
    return byte;
  }

  private advance(length: number, end: number) {
    throwIfAborted(this.#signal);
    const next = this.position + length;
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(next) || next > end) {
      throw new OnnxExternalDataError("The ONNX graph contained a truncated protobuf field.");
    }
    this.position = next;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The model download was cancelled.", "AbortError");
}
