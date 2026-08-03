import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { getModelStoragePurgeErrorMessage, isLegacyBundledModelRequest, runModelStoragePurge } = await import("../src/lib/model-delivery/opfs-store.ts");

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
    deleteDescriptors: async () => { events.push("descriptors"); },
    deleteOpfs: async () => { events.push("opfs"); },
    verify: async () => { events.push("verify"); }
  });
  assert.deepEqual(events, ["cache", "opfs", "database", "descriptors", "verify"]);
});

test("attempts every backend and skips verification when any purge fails", async () => {
  const events = [];
  await assert.rejects(runModelStoragePurge({
    deleteCache: async () => { events.push("cache"); throw new Error("cache failed"); },
    deleteDatabase: async () => { events.push("database"); throw new Error("database failed"); },
    deleteDescriptors: async () => { events.push("descriptors"); throw new Error("descriptors failed"); },
    deleteOpfs: async () => { events.push("opfs"); },
    verify: async () => { events.push("verify"); }
  }), AggregateError);
  assert.deepEqual(events, ["cache", "opfs", "database", "descriptors"]);
});

test("identifies failed storage backends and explains how to recover", async () => {
  await assert.rejects(runModelStoragePurge({
    deleteCache: async () => {},
    deleteDatabase: async () => { throw new Error("The model checkpoint database deletion was blocked by another tab."); },
    deleteDescriptors: async () => {},
    deleteOpfs: async () => { throw new Error("OPFS failed"); },
    verify: async () => {}
  }), (error) => {
    assert.equal(
      error.message,
      "Glaux could not remove downloaded model files and download checkpoints from browser storage. Another Glaux tab or a restored browser session is still using that storage. Close every Glaux tab, fully close the browser, then reopen Glaux and retry cleanup."
    );
    return true;
  });
});

test("recognizes a blocked database nested inside an aggregate failure", () => {
  const message = getModelStoragePurgeErrorMessage([{
    label: "saved model details",
    error: new AggregateError([new Error("blocked")], "descriptor cleanup failed")
  }]);
  assert.match(message, /restored browser session/);
});

test("does not misdiagnose a lost WebKit database connection as another open tab", () => {
  const connectionLost = new DOMException("Connection to Indexed Database server lost.", "InvalidStateError");
  const message = getModelStoragePurgeErrorMessage([{ label: "download checkpoints", error: connectionLost }]);
  assert.doesNotMatch(message, /restored browser session/);
  assert.match(message, /fully close and reopen the browser/);
});

test("fails closed when physical storage verification finds residue", async () => {
  await assert.rejects(runModelStoragePurge({
    deleteCache: async () => {},
    deleteDatabase: async () => {},
    deleteDescriptors: async () => {},
    deleteOpfs: async () => {},
    verify: async () => { throw new Error("residual files"); }
  }), /residual files/);
});
