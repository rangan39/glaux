import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const { communityDescriptorToManifest, resolveModelDefinition, resolveModelProvider } = await import("../src/lib/onnx-models.ts");

test("rejects identifiers that are not saved community descriptors", async () => {
  await assert.rejects(resolveModelDefinition("not-a-model"), /Unknown model identifier/);
});

test("maps a pinned community descriptor to a WebGPU model", () => {
  const model = communityDescriptorToManifest({
    schemaVersion: 1,
    id: "hf:fixture-alpha",
    name: "Fixture Alpha",
    source: { kind: "huggingface", repo: "onnx-community/fixture-alpha", revision: "a".repeat(40) },
    task: "text-generation",
    runtime: { architecture: "Qwen2ForCausalLM", modelType: "qwen2" },
    format: { dtype: "q4f16", graphPath: "onnx/model_q4f16.onnx", totalBytes: 1024 },
    metadata: { baseModel: null, license: "apache-2.0" },
    files: []
  });
  assert.equal(model.id, "hf:fixture-alpha");
  assert.equal(model.source.revision, "a".repeat(40));
  assert.equal(resolveModelProvider(model, { webgpu: true, wasm: true }), "webgpu");
  assert.equal(resolveModelProvider(model, { webgpu: false, wasm: true }), null);
});
