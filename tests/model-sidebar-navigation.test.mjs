import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const { getActiveSidebarModelId, getReadySidebarModelId } = await import("../src/lib/model-sidebar-navigation.ts");

test("opens model details as soon as download or loading begins", () => {
  assert.equal(getActiveSidebarModelId({ cacheState: "missing", loading: true, modelId: "hf:model" }), "hf:model");
  assert.equal(getActiveSidebarModelId({ cacheState: "partial", loading: true, modelId: "hf:model" }), "hf:model");
  assert.equal(getActiveSidebarModelId({ cacheState: "cached", loading: false, modelId: "hf:model" }), "hf:model");
  assert.equal(getActiveSidebarModelId({ cacheState: "missing", loading: false, modelId: "hf:model" }), null);
});

test("opens model details only after the selected model is cached and loaded", () => {
  assert.equal(getReadySidebarModelId({ cacheState: "missing", loaded: false, modelId: "hf:model" }), null);
  assert.equal(getReadySidebarModelId({ cacheState: "partial", loaded: false, modelId: "hf:model" }), null);
  assert.equal(getReadySidebarModelId({ cacheState: "cached", loaded: false, modelId: "hf:model" }), null);
  assert.equal(getReadySidebarModelId({ cacheState: "partial", loaded: true, modelId: "hf:model" }), null);
  assert.equal(getReadySidebarModelId({ cacheState: "cached", loaded: true, modelId: "hf:model" }), "hf:model");
});

test("does not open details without a selected model", () => {
  assert.equal(getReadySidebarModelId({ cacheState: "cached", loaded: true, modelId: "" }), null);
});
