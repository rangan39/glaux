import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const {
  ModelStorageQuotaError,
  ModelStorageWriteError,
  toModelStorageError
} = await import("../src/lib/model-delivery/errors.ts");

test("maps explicit quota errors to the requested storage message", () => {
  const result = toModelStorageError(
    new DOMException("Quota exceeded", "QuotaExceededError"),
    "Not enough room for tokenizer.json."
  );

  assert.ok(result instanceof ModelStorageQuotaError);
  assert.equal(result.message, "Not enough room for tokenizer.json.");
});

test("maps Chromium Cache.put network errors to actionable local-storage guidance", () => {
  const result = toModelStorageError(
    new DOMException(
      "Failed to execute 'put' on 'Cache': Cache.put() encountered a network error",
      "NetworkError"
    )
  );

  assert.ok(result instanceof ModelStorageWriteError);
  assert.match(result.message, /browser storage/i);
  assert.match(result.message, /remove the partial model download/i);
  assert.doesNotMatch(result.message, /Cache\.put/);
});

test("preserves unrelated runtime errors", () => {
  const original = new Error("SHA-256 mismatch");
  assert.equal(toModelStorageError(original), original);
});
