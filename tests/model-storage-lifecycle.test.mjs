import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { isModelStorageReady } = await import("../src/lib/model-storage-lifecycle.ts");

test("hydrates model inventory only after authoritative startup cleanup", () => {
  assert.equal(isModelStorageReady(true, "cleaning"), false);
  assert.equal(isModelStorageReady(true, "failed"), false);
  assert.equal(isModelStorageReady(false, "idle"), false);
  assert.equal(isModelStorageReady(true, "idle"), true);
});
