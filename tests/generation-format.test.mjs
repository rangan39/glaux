import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { formatGenerationDuration, formatGenerationProvider, formatGenerationRate } = await import("../src/lib/generation-format.ts");

test("formats generation telemetry consistently across runtime logs and chat metadata", () => {
  assert.equal(formatGenerationProvider("webgpu"), "WebGPU");
  assert.equal(formatGenerationProvider("wasm"), "WASM");
  assert.equal(formatGenerationRate(null), "Speed pending");
  assert.equal(formatGenerationRate(8.25), "8.3 tokens/s");
  assert.equal(formatGenerationDuration(null), "—");
  assert.equal(formatGenerationDuration(410), "410 ms");
  assert.equal(formatGenerationDuration(1_250), "1.3s");
});
