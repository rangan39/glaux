import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const {
  ModelStorageQuotaError,
  ModelStorageOperationError,
  ModelStorageWriteError,
  toModelStorageError,
  toModelStorageOperationError
} = await import("../src/lib/model-delivery/errors.ts");

test("maps explicit quota errors to the requested storage message", () => {
  const result = toModelStorageError(
    new DOMException("Quota exceeded", "QuotaExceededError"),
    "Not enough room for tokenizer.json.",
    "opfs-write"
  );

  assert.ok(result instanceof ModelStorageQuotaError);
  assert.equal(result.message, "Not enough room for tokenizer.json.");
  assert.equal(result.operation, "opfs-write");
});

test("maps Chromium Cache.put network errors to actionable local-storage guidance", () => {
  const result = toModelStorageError(
    new DOMException(
      "Failed to execute 'put' on 'Cache': Cache.put() encountered a network error",
      "NetworkError"
    )
  );

  assert.ok(result instanceof ModelStorageWriteError);
  assert.equal(result.operation, "cache-write");
  assert.match(result.message, /browser storage/i);
  assert.match(result.message, /remove the partial model download/i);
  assert.doesNotMatch(result.message, /Cache\.put/);
});

test("preserves unrelated runtime errors", () => {
  const original = new Error("SHA-256 mismatch");
  assert.equal(toModelStorageError(original), original);
});

test("wraps storage-layer failures with the failing operation", () => {
  const original = new DOMException("Access handle closed", "InvalidStateError");
  const result = toModelStorageOperationError(
    original,
    "The browser could not flush model files to private storage.",
    "opfs-flush"
  );

  assert.ok(result instanceof ModelStorageOperationError);
  assert.equal(result.operation, "opfs-flush");
  assert.match(result.message, /flush model files/);
});
