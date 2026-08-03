import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const {
  getModelStoragePurgeErrorMessage,
  isLegacyBundledModelRequest,
  ModelStorageCleanupTimeoutError,
  retryModelStorageDeletion,
  runModelStoragePurge,
  runWithModelStorageLock,
  withModelStorageDeadline
} = await import("../src/lib/model-delivery/opfs-store.ts");

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
      "Glaux could not remove downloaded model files and download checkpoints from browser storage. Another Glaux tab or a restored browser session is still using that storage. Close other Glaux tabs, then use Reset Glaux storage."
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
  assert.match(message, /Reset Glaux storage/);
});

test("retries transient model-file deletion while Safari releases OPFS handles", async () => {
  const attempts = [];
  const waits = [];
  await retryModelStorageDeletion(async () => {
    attempts.push("delete");
    if (attempts.length < 3) throw new DOMException("The object is in an invalid state.", "InvalidStateError");
  }, async (delay) => { waits.push(delay); }, [10, 20, 30]);
  assert.equal(attempts.length, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("preserves the terminal OPFS error after bounded deletion retries", async () => {
  const failure = new DOMException("The operation failed for an unknown transient reason.", "UnknownError");
  let attempts = 0;
  await assert.rejects(retryModelStorageDeletion(async () => {
    attempts += 1;
    throw failure;
  }, async () => {}, [10, 20]), (error) => error === failure);
  assert.equal(attempts, 3);
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

test("reports each cleanup stage in order", async () => {
  const stages = [];
  await runModelStoragePurge({
    deleteCache: async () => {},
    deleteDatabase: async () => {},
    deleteDescriptors: async () => {},
    deleteOpfs: async () => {},
    verify: async () => {}
  }, { onStage: ({ stage }) => stages.push(stage) });
  assert.deepEqual(stages, ["cache", "opfs", "checkpoints", "descriptors", "verification"]);
});

test("times out a storage operation that never settles", async () => {
  await assert.rejects(
    withModelStorageDeadline(new Promise(() => {}), "opfs", 5),
    (error) => error instanceof ModelStorageCleanupTimeoutError
      && error.stage === "opfs"
      && error.lockAcquired === true
  );
});

test("does not start later cleanup stages after an indeterminate timeout", async () => {
  const events = [];
  await assert.rejects(runModelStoragePurge({
    deleteCache: async () => { events.push("cache"); },
    deleteOpfs: async () => { events.push("opfs"); await new Promise(() => {}); },
    deleteDatabase: async () => { events.push("database"); },
    deleteDescriptors: async () => { events.push("descriptors"); },
    verify: async () => { events.push("verify"); }
  }, { stageTimeoutsMs: { opfs: 5 } }), ModelStorageCleanupTimeoutError);
  assert.deepEqual(events, ["cache", "opfs"]);
});

test("aborts lock acquisition when another session never releases it", async () => {
  let taskStarted = false;
  const locks = {
    request: async (_name, { signal }, callback) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      void callback;
      void resolve;
    })
  };
  await assert.rejects(
    runWithModelStorageLock(locks, async () => { taskStarted = true; }, { lockTimeoutMs: 5 }),
    (error) => error instanceof ModelStorageCleanupTimeoutError
      && error.stage === "waiting-for-lock"
      && error.lockAcquired === false
  );
  assert.equal(taskStarted, false);
});

test("runs cleanup when the storage lock becomes available before its deadline", async () => {
  const stages = [];
  const locks = { request: async (_name, _options, callback) => callback() };
  const result = await runWithModelStorageLock(locks, async () => "clean", {
    lockTimeoutMs: 100,
    onStage: ({ stage }) => stages.push(stage)
  });
  assert.equal(result, "clean");
  assert.deepEqual(stages, ["waiting-for-lock"]);
});
