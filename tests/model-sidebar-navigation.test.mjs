import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const { getReadySidebarModelId } = await import("../src/lib/model-sidebar-navigation.ts");

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
