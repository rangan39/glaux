import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { env, pipelineCalls, pipelineRemotePathTemplates } = await import("@huggingface/transformers");
const {
  getRuntimeCapabilities,
  preloadOnnxModel,
  prepareGenerationInput,
  readGeneratedText,
  runOnnxTextModel
} = await import("../src/lib/onnx-runner.ts");

test("preserves structured turns for community chat templates", () => {
  assert.deepEqual(prepareGenerationInput([
    { role: "system", content: " Be concise. " },
    { role: "user", content: " Hello " },
    { role: "assistant", content: "   " }
  ]), [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Hello" }
  ]);
});

test("reads generated text from completion and chat pipeline results", () => {
  assert.equal(readGeneratedText([{ generated_text: "completion" }]), "completion");
  assert.equal(readGeneratedText([{
    generated_text: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "chat response" }
    ]
  }]), "chat response");
  assert.equal(readGeneratedText([{ unexpected: true }]), "");
});

test("returns typed cancellation before loading a model for an aborted request", async () => {
  const controller = new AbortController();
  controller.abort();

  assert.deepEqual(await runOnnxTextModel([{ role: "user", content: "Hello" }], {
    modelId: "hf:fixture-alpha",
    signal: controller.signal
  }), {
    ok: false,
    code: "CANCELLED",
    message: "Generation cancelled."
  });
});

test("preloads and reuses a pinned community WebGPU pipeline without generating", async () => {
  let adapterOptions;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        requestAdapter: async (options) => {
          adapterOptions = options;
          return { limits: { maxStorageBufferBindingSize: 268_435_456 } };
        }
      },
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      userAgentData: { brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }] }
    }
  });
  pipelineCalls.length = 0;
  pipelineRemotePathTemplates.length = 0;
  assert.deepEqual(await getRuntimeCapabilities(), {
    webgpu: true,
    wasm: true,
    crossOriginIsolated: false,
    browserEngine: "chromium",
    hardwareTier: "desktop",
    maxStorageBufferBindingSize: 268_435_456
  });
  assert.deepEqual(adapterOptions, { powerPreference: "high-performance" });
  const logs = [];
  await preloadOnnxModel("hf:fixture-alpha", (event) => logs.push(event));
  await preloadOnnxModel("hf:fixture-alpha", (event) => logs.push(event));

  assert.equal(pipelineCalls.length, 1);
  const [task, source, options] = pipelineCalls[0];
  const { progress_callback: progressCallback, ...pipelineOptions } = options;
  assert.equal(progressCallback, undefined);
  assert.deepEqual([task, source, pipelineOptions], [
    "text-generation",
    "onnx-community/fixture-alpha",
    {
      device: "webgpu",
      dtype: "q4f16",
      session_options: { executionMode: "sequential", graphOptimizationLevel: "all", externalData: [] },
      local_files_only: false,
      revision: "a".repeat(40),
      use_external_data_format: false
    }
  ]);
  assert.equal(env.backends.onnx.webgpu.powerPreference, "high-performance");
  assert.equal(pipelineRemotePathTemplates[0], `{model}/resolve/${"a".repeat(40)}/`);
  assert.equal(env.remotePathTemplate, "{model}/resolve/{revision}/");
  assert.equal(env.allowLocalModels, false);
  assert.equal(env.allowRemoteModels, true);
  assert.equal(logs[0]?.phase, "download");
  assert.ok(logs.some((event) => event.message === "Optimizing Chromium WebGPU"));
  assert.deepEqual(logs.filter((event) => event.progress).map((event) => event.progress), [{ loaded: 1024, total: 1024, stage: "cache" }]);
  assert.match(logs.at(-1)?.message ?? "", /reusing loaded model/i);
});
