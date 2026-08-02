import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { formatStoredModelDisclosure, getStoredModelSummary, shouldWarnForModelDeparture } = await import("../src/lib/model-storage-awareness.ts");

const missing = { modelId: "missing", state: "missing", resumableBytes: 0, verifiedBytes: 0, totalBytes: 0 };

test("finds cached and partial model files but ignores missing inventory", () => {
  const partial = { modelId: "partial", state: "partial", resumableBytes: 512 * 1024 ** 2, verifiedBytes: 0, totalBytes: 2 * 1024 ** 3 };
  assert.equal(getStoredModelSummary([missing, partial]), partial);
  assert.equal(getStoredModelSummary([missing]), null);
});

test("discloses exact cached model identity and size", () => {
  const cached = { modelId: "cached", state: "cached", resumableBytes: 2.19 * 1024 ** 3, verifiedBytes: 2.19 * 1024 ** 3, totalBytes: 2.19 * 1024 ** 3 };
  assert.equal(formatStoredModelDisclosure(cached, "Fixture A · WebGPU"), "Fixture A · 2.19 GB · removed on exit");
});

test("labels partial storage without implying a completed download", () => {
  const partial = { modelId: "partial", state: "partial", resumableBytes: 512 * 1024 ** 2, verifiedBytes: 0, totalBytes: 2 * 1024 ** 3 };
  assert.equal(formatStoredModelDisclosure(partial, "Fixture A"), "Fixture A · partial · removed on exit");
});

test("warns during active and paused delivery before inventory catches up", () => {
  assert.equal(shouldWarnForModelDeparture([missing], { loading: true, paused: false }), true);
  assert.equal(shouldWarnForModelDeparture([missing], { loading: false, paused: true }), true);
  assert.equal(shouldWarnForModelDeparture([missing], { loading: false, paused: false }), false);
});
