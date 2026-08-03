import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { shouldDeferRuntimeLoad } = await import("../src/hooks/use-active-model-preload.ts");

test("downloads on mobile without allocating the runtime until the user approves it", () => {
  assert.equal(shouldDeferRuntimeLoad("mobile", false), true);
  assert.equal(shouldDeferRuntimeLoad("mobile", true), false);
  assert.equal(shouldDeferRuntimeLoad("desktop", false), false);
});
