import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_REGISTRY, requireModelDefinition, resolveModelProvider } from "../src/lib/onnx-models.ts";

test("rejects unknown model identifiers at runtime boundaries", () => {
  assert.throws(() => requireModelDefinition("not-a-model"), /Unknown model identifier/);
});

test("requires WebGPU for every local model", () => {
  for (const model of MODEL_REGISTRY) {
    assert.equal(resolveModelProvider(model, { webgpu: true, wasm: true }), "webgpu");
    assert.equal(resolveModelProvider(model, { webgpu: false, wasm: true }), null);
  }
});
