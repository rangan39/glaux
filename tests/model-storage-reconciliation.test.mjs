import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { isLegacyBundledModelRequest } = await import("../src/lib/model-delivery/opfs-store.ts");

test("identifies only obsolete bundled model cache requests", () => {
  assert.equal(isLegacyBundledModelRequest("https://glaux.example/model-runtime/shared/tokenizer.json"), true);
  assert.equal(isLegacyBundledModelRequest("/model-runtime/fixture/config.json"), true);
  assert.equal(isLegacyBundledModelRequest("https://huggingface.co/onnx-community/model/resolve/revision/config.json"), false);
  assert.equal(isLegacyBundledModelRequest("not a valid url"), false);
});
