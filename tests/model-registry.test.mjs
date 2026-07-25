import assert from "node:assert/strict";
import test from "node:test";
import {
  getModelRuntimeProfile,
  MODEL_REGISTRY,
  RECOMMENDED_MODEL_ID,
  requireModelDefinition,
  resolveModelProvider
} from "../src/lib/onnx-models.ts";

const EXPECTED_TINY_AYA_MODELS = [
  {
    id: "tiny-aya-global",
    repo: "onnx-community/tiny-aya-global-ONNX",
    revision: "7fff1be9627e40f0d89c33f406882bdafb56ec90",
    sizeBytes: 2_354_413_407
  },
  {
    id: "tiny-aya-earth",
    repo: "onnx-community/tiny-aya-earth-ONNX",
    revision: "24a24ee8b8483762575fe734e57bad21ca36d8c6",
    sizeBytes: 2_354_413_397
  },
  {
    id: "tiny-aya-fire",
    repo: "onnx-community/tiny-aya-fire-ONNX",
    revision: "70f6b7edf79955855d7939342d2a39ab644d3ed6",
    sizeBytes: 2_354_413_397
  },
  {
    id: "tiny-aya-water",
    repo: "onnx-community/tiny-aya-water-ONNX",
    revision: "e1109b664b476b709d13bf40dc105efb147caa09",
    sizeBytes: 2_354_413_397
  }
];

test("catalogs only the four pinned Tiny Aya regional models", () => {
  assert.equal(RECOMMENDED_MODEL_ID, "tiny-aya-global");
  assert.equal(MODEL_REGISTRY[0].id, RECOMMENDED_MODEL_ID);
  assert.deepEqual(MODEL_REGISTRY.map(({ id }) => id), EXPECTED_TINY_AYA_MODELS.map(({ id }) => id));

  for (const expected of EXPECTED_TINY_AYA_MODELS) {
    const model = requireModelDefinition(expected.id);
    assert.equal(model.family, "cohere");
    assert.equal(model.verification, "experimental");
    assert.equal(model.source.kind, "huggingface");
    assert.equal(model.source.repo, expected.repo);
    assert.equal(model.source.revision, expected.revision);
    assert.match(model.source.revision, /^[a-f0-9]{40}$/);
    assert.deepEqual(model.providers, ["webgpu"]);
    assert.equal(model.format.quantization, "q4f16");
    assert.equal(model.format.sizeLabel, "~2.35 GB");
    assert.equal(model.format.sizeBytes, expected.sizeBytes);
    assert.equal(model.format.contextLength, 8192);
    assert.equal(model.runtime.maxNewTokens, 48);
    assert.deepEqual(getModelRuntimeProfile(model, "mobile"), { contextLength: 2048, maxNewTokens: 24 });
    assert.deepEqual(getModelRuntimeProfile(model, "desktop"), { contextLength: 8192, maxNewTokens: 48 });
    assert.match(model.label, /non-commercial/i);
    assert.match(model.description, /CC BY-NC 4\.0/i);
    assert.match(model.description, /Cohere Labs AUP/i);
  }
});

test("rejects unknown model identifiers at runtime boundaries", () => {
  assert.throws(() => requireModelDefinition("not-a-model"), /Unknown model identifier/);
});

test("requires WebGPU for every local model", () => {
  for (const model of MODEL_REGISTRY) {
    assert.equal(resolveModelProvider(model, { webgpu: true, wasm: true }), "webgpu");
    assert.equal(resolveModelProvider(model, { webgpu: false, wasm: true }), null);
  }
});
