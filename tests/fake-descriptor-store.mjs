export const FIXTURE_MODEL_ID = "hf:fixture-alpha";

export const FIXTURE_DESCRIPTOR = {
  schemaVersion: 1,
  id: FIXTURE_MODEL_ID,
  name: "Fixture Alpha",
  source: {
    kind: "huggingface",
    repo: "onnx-community/fixture-alpha",
    revision: "a".repeat(40)
  },
  task: "text-generation",
  runtime: { architecture: "Qwen2ForCausalLM", modelType: "qwen2" },
  format: {
    dtype: "q4f16",
    graphPath: "onnx/model_q4f16.onnx",
    totalBytes: 1024
  },
  metadata: { baseModel: null, license: "apache-2.0" },
  files: [
    { path: "onnx/model_q4f16.onnx", size: 1024, blobId: "b".repeat(40), sha256: "c".repeat(64) }
  ]
};

export async function getSavedCommunityModelDescriptor(id) {
  return id === FIXTURE_MODEL_ID ? FIXTURE_DESCRIPTOR : null;
}
