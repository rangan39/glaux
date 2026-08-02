import assert from "node:assert/strict";
import test from "node:test";
import {
  clearRememberedModelId,
  forgetRememberedModelId,
  LEGACY_READY_MODEL_STORAGE_KEY,
  readRememberedModelId,
  READY_MODEL_STORAGE_KEY,
  rememberReadyModelId
} from "../src/lib/remembered-model.ts";

function createStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
    values
  };
}

test("migrates the remembered Sophon model key to Glaux on read", () => {
  const storage = createStorage([[LEGACY_READY_MODEL_STORAGE_KEY, "hf:fixture@main"]]);

  assert.equal(readRememberedModelId(storage), "hf:fixture@main");
  assert.equal(storage.values.get(READY_MODEL_STORAGE_KEY), "hf:fixture@main");
  assert.equal(storage.values.has(LEGACY_READY_MODEL_STORAGE_KEY), false);
});

test("prefers the current Glaux key and removes legacy state on write", () => {
  const storage = createStorage([
    [READY_MODEL_STORAGE_KEY, "hf:current@main"],
    [LEGACY_READY_MODEL_STORAGE_KEY, "hf:legacy@main"]
  ]);

  assert.equal(readRememberedModelId(storage), "hf:current@main");
  rememberReadyModelId("hf:next@main", storage);
  assert.equal(storage.values.get(READY_MODEL_STORAGE_KEY), "hf:next@main");
  assert.equal(storage.values.has(LEGACY_READY_MODEL_STORAGE_KEY), false);
});

test("forgets a matching model from current and legacy keys", () => {
  const storage = createStorage([
    [READY_MODEL_STORAGE_KEY, "hf:fixture@main"],
    [LEGACY_READY_MODEL_STORAGE_KEY, "hf:fixture@main"]
  ]);

  forgetRememberedModelId("hf:fixture@main", storage);
  assert.equal(storage.values.size, 0);
});

test("clears all remembered model keys during lifecycle cleanup", () => {
  const storage = createStorage([
    [READY_MODEL_STORAGE_KEY, "hf:current@main"],
    [LEGACY_READY_MODEL_STORAGE_KEY, "hf:legacy@main"]
  ]);
  clearRememberedModelId(storage);
  assert.equal(storage.values.size, 0);
});
