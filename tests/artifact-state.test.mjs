import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { inspectArtifactState } = await import("../src/lib/model-delivery/artifact-state.ts");

const artifact = { key: "model:graph", size: 20, sha256: "a".repeat(64) };
const baseState = {
  key: artifact.key,
  version: 1,
  size: artifact.size,
  sha256: artifact.sha256,
  segmentSize: 8,
  etag: '"strong"',
  completed: [0, 1],
  status: "partial"
};

test("reports durable bytes for a valid partial checkpoint", () => {
  assert.deepEqual(inspectArtifactState(baseState, artifact, 16, 8), {
    valid: true,
    ready: false,
    resumableBytes: 16
  });
});

test("reports a complete checkpoint only when every segment and file byte is present", () => {
  assert.deepEqual(inspectArtifactState({ ...baseState, completed: [0, 1, 2], status: "ready" }, artifact, 20, 8), {
    valid: true,
    ready: true,
    resumableBytes: 20
  });
});

test("rejects mismatched, duplicated, out-of-range, and oversized checkpoint state", () => {
  const invalid = { valid: false, ready: false, resumableBytes: 0 };
  assert.deepEqual(inspectArtifactState(undefined, artifact, 0, 8), invalid);
  assert.deepEqual(inspectArtifactState({ ...baseState, sha256: "b".repeat(64) }, artifact, 16, 8), invalid);
  assert.deepEqual(inspectArtifactState({ ...baseState, completed: [0, 0] }, artifact, 8, 8), invalid);
  assert.deepEqual(inspectArtifactState({ ...baseState, completed: [3] }, artifact, 20, 8), invalid);
  assert.deepEqual(inspectArtifactState(baseState, artifact, 21, 8), invalid);
});
