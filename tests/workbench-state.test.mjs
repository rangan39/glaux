import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { INITIAL_WORKBENCH_SESSION, STARTER_MESSAGES, workbenchSessionReducer } = await import("../src/lib/workbench-state.ts");

test("selecting a model atomically resets conversation and model runtime state", () => {
  const current = {
    ...INITIAL_WORKBENCH_SESSION,
    messages: [...STARTER_MESSAGES, { id: "user-1", role: "user", content: "Hello" }],
    prompt: "draft",
    error: "old error",
    notice: "old notice",
    failedTurn: { messageId: "user-1", reason: "failed", text: "Hello" },
    loadedModelId: "hf:old",
    modelLoadPaused: true
  };
  const next = workbenchSessionReducer(current, { type: "model/selected", modelId: "hf:new" });

  assert.equal(next.modelId, "hf:new");
  assert.equal(next.loadedModelId, null);
  assert.equal(next.modelLoadPaused, false);
  assert.deepEqual(next.messages, STARTER_MESSAGES);
  assert.equal(next.prompt, "");
  assert.equal(next.error, null);
  assert.equal(next.failedTurn, null);
});

test("removing the active model clears its conversation and runtime atomically", () => {
  const current = {
    ...INITIAL_WORKBENCH_SESSION,
    modelId: "hf:active",
    loadedModelId: "hf:active",
    messages: [...STARTER_MESSAGES, { id: "user-1", role: "user", content: "Hello" }]
  };
  const next = workbenchSessionReducer(current, { type: "model/removed", modelId: "hf:active" });

  assert.equal(next.modelId, "");
  assert.equal(next.loadedModelId, null);
  assert.deepEqual(next.messages, STARTER_MESSAGES);
  assert.equal(next.pendingDeleteModelId, null);
});

test("fixture hydration resets omitted transient state and disables automatic restore", () => {
  const next = workbenchSessionReducer({ ...INITIAL_WORKBENCH_SESSION, notice: "stale" }, {
    type: "fixture/loaded",
    session: { modelId: "hf:fixture", loadedModelId: "hf:fixture" }
  });
  assert.equal(next.modelId, "hf:fixture");
  assert.equal(next.loadedModelId, "hf:fixture");
  assert.equal(next.notice, null);
  assert.equal(next.autoRestoreEnabled, false);
});
