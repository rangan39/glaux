import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { isLegacyBundledModelRequest, runModelStoragePurge } = await import("../src/lib/model-delivery/opfs-store.ts");

test("identifies only obsolete bundled model cache requests", () => {
  assert.equal(isLegacyBundledModelRequest("https://glaux.example/model-runtime/shared/tokenizer.json"), true);
  assert.equal(isLegacyBundledModelRequest("/model-runtime/fixture/config.json"), true);
  assert.equal(isLegacyBundledModelRequest("https://huggingface.co/onnx-community/model/resolve/revision/config.json"), false);
  assert.equal(isLegacyBundledModelRequest("not a valid url"), false);
});

test("purges every model storage backend before verifying", async () => {
  const events = [];
  await runModelStoragePurge({
    deleteCache: async () => { events.push("cache"); },
    deleteDatabase: async () => { events.push("database"); },
    deleteOpfs: async () => { events.push("opfs"); },
    verify: async () => { events.push("verify"); }
  });
  assert.deepEqual(events, ["cache", "opfs", "database", "verify"]);
});

test("attempts every backend and skips verification when any purge fails", async () => {
  const events = [];
  await assert.rejects(runModelStoragePurge({
    deleteCache: async () => { events.push("cache"); throw new Error("cache failed"); },
    deleteDatabase: async () => { events.push("database"); throw new Error("database failed"); },
    deleteOpfs: async () => { events.push("opfs"); },
    verify: async () => { events.push("verify"); }
  }), AggregateError);
  assert.deepEqual(events, ["cache", "opfs", "database"]);
});

test("fails closed when physical storage verification finds residue", async () => {
  await assert.rejects(runModelStoragePurge({
    deleteCache: async () => {},
    deleteDatabase: async () => {},
    deleteOpfs: async () => {},
    verify: async () => { throw new Error("residual files"); }
  }), /residual files/);
});
