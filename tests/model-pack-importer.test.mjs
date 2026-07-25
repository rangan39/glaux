import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const { copyVerifiedPackSegment } = await import("../src/lib/model-delivery/model-pack-importer.ts");

test("streams a verified pack segment into positioned storage without a whole-segment allocation", async () => {
  const bytes = Uint8Array.from({ length: 257 * 1024 }, (_, index) => index % 251);
  const destination = new MemoryPositionedFile(bytes.byteLength);
  const chunks = [];
  await copyVerifiedPackSegment(
    chunkedBlobLike(bytes, 32 * 1024),
    destination,
    0,
    bytes.byteLength,
    digest(bytes),
    "onnx/model.bin",
    0,
    undefined,
    (count) => chunks.push(count)
  );
  assert.deepEqual(destination.bytes, bytes);
  assert.equal(chunks.reduce((total, count) => total + count, 0), bytes.byteLength);
  assert.ok(chunks.length > 1, "Blob streaming should remain chunked for this fixture");
});

test("fails a corrupt pack segment before it can become checkpoint-eligible", async () => {
  const bytes = new TextEncoder().encode("corrupt fixture bytes");
  const destination = new MemoryPositionedFile(bytes.byteLength);
  await assert.rejects(
    copyVerifiedPackSegment(
      new Blob([bytes]),
      destination,
      0,
      bytes.byteLength,
      "0".repeat(64),
      "onnx/model.bin",
      3,
      undefined,
      () => undefined
    ),
    /corrupt segment 3/i
  );
});

test("honors cancellation before a copied segment is declared verified", async () => {
  const bytes = Uint8Array.from({ length: 256 * 1024 }, (_, index) => index % 251);
  const destination = new MemoryPositionedFile(bytes.byteLength);
  const controller = new AbortController();
  await assert.rejects(
    copyVerifiedPackSegment(
      new Blob([bytes]),
      destination,
      0,
      bytes.byteLength,
      digest(bytes),
      "onnx/model.bin",
      0,
      controller.signal,
      () => controller.abort(new DOMException("Test cancellation", "AbortError"))
    ),
    /cancell/i
  );
});

class MemoryPositionedFile {
  constructor(size) {
    this.bytes = new Uint8Array(size);
  }

  write(data, offset) {
    this.bytes.set(data, offset);
    return data.byteLength;
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function chunkedBlobLike(bytes, chunkSize) {
  return {
    size: bytes.byteLength,
    stream() {
      let offset = 0;
      return new ReadableStream({
        pull(controller) {
          if (offset >= bytes.byteLength) {
            controller.close();
            return;
          }
          const end = Math.min(bytes.byteLength, offset + chunkSize);
          controller.enqueue(bytes.slice(offset, end));
          offset = end;
        }
      });
    }
  };
}
