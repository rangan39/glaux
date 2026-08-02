import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { isSafeRepositoryPath } = await import("../src/lib/model-catalog/repository-path.ts");

test("accepts normalized relative repository paths", () => {
  assert.equal(isSafeRepositoryPath("onnx/model_q4f16.onnx"), true);
  assert.equal(isSafeRepositoryPath("tokenizer.json"), true);
});

test("rejects absolute, traversing, malformed, and encoded repository paths", () => {
  for (const path of [
    "",
    "/model.onnx",
    "../model.onnx",
    "onnx/../model.onnx",
    "onnx/./model.onnx",
    "onnx//model.onnx",
    "onnx\\model.onnx",
    "onnx/model\0.onnx",
    "%2e%2e/model.onnx",
    "onnx%2fmodel.onnx",
    "onnx%5cmodel.onnx",
    "onnx%00model.onnx"
  ]) assert.equal(isSafeRepositoryPath(path), false, path);
});
