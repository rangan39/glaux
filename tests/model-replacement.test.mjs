import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const { createModelReplacementPlan, runModelReplacement } = await import("../src/lib/model-replacement.ts");

function summary(modelId, state, resumableBytes = 0, totalBytes = 2_350_000_000) {
  return {
    modelId,
    state,
    resumableBytes,
    verifiedBytes: state === "cached" ? totalBytes : resumableBytes,
    totalBytes
  };
}

test("downloads a missing model directly when no other model is stored", () => {
  assert.deepEqual(
    createModelReplacementPlan("earth", [
      summary("global", "missing"),
      summary("earth", "missing")
    ]),
    {
      action: "download",
      bytesToRemove: 0,
      requiresReplacement: false,
      sourceModelIds: [],
      targetModelId: "earth",
      targetState: "missing"
    }
  );
});

test("replaces the installed model before downloading another model", () => {
  const plan = createModelReplacementPlan("earth", [
    summary("global", "cached"),
    summary("earth", "missing")
  ]);

  assert.equal(plan.action, "download");
  assert.equal(plan.requiresReplacement, true);
  assert.deepEqual(plan.sourceModelIds, ["global"]);
  assert.equal(plan.bytesToRemove, 2_350_000_000);
});

test("deletes target partial data when switching so the download starts from scratch", () => {
  const plan = createModelReplacementPlan("earth", [
    summary("global", "cached"),
    summary("earth", "partial", 640_000_000)
  ]);

  assert.equal(plan.action, "download");
  assert.deepEqual(plan.sourceModelIds, ["global", "earth"]);
  assert.equal(plan.bytesToRemove, 2_990_000_000);
});

test("cleans every non-target model from a legacy multi-model installation", () => {
  const plan = createModelReplacementPlan("earth", [
    summary("global", "cached"),
    summary("earth", "cached"),
    summary("fire", "partial", 128_000_000),
    summary("water", "missing")
  ]);

  assert.equal(plan.action, "download");
  assert.deepEqual(plan.sourceModelIds, ["global", "earth", "fire"]);
  assert.equal(plan.bytesToRemove, 4_828_000_000);
});

test("still resumes a paused download when the user stays on the same model", () => {
  const plan = createModelReplacementPlan("earth", [
    summary("global", "missing"),
    summary("earth", "partial", 640_000_000)
  ]);

  assert.equal(plan.action, "resume");
  assert.equal(plan.requiresReplacement, false);
  assert.deepEqual(plan.sourceModelIds, []);
});

test("stops the runtime and deletes old models before starting the target model", async () => {
  const events = [];
  const plan = createModelReplacementPlan("earth", [
    summary("global", "cached"),
    summary("earth", "missing"),
    summary("fire", "partial", 128_000_000)
  ]);

  const next = await runModelReplacement(plan, {
    deleteStoredModel: async (modelId) => {
      events.push(`delete:${modelId}`);
    },
    onPhaseChange: (phase) => {
      events.push(`phase:${phase}`);
    },
    readCacheSummaries: async () => {
      events.push("refresh");
      return [
        summary("global", "missing"),
        summary("earth", "missing"),
        summary("fire", "missing")
      ];
    },
    stopActiveModel: async () => {
      events.push("stop");
    }
  });

  assert.deepEqual(events, [
    "phase:stopping",
    "stop",
    "phase:deleting",
    "delete:global",
    "delete:fire",
    "refresh",
    "phase:starting"
  ]);
  assert.equal(next.every((entry) => entry.state === "missing"), true);
});

test("does not start the target when old model files remain", async () => {
  const phases = [];
  const plan = createModelReplacementPlan("earth", [
    summary("global", "cached"),
    summary("earth", "missing")
  ]);

  await assert.rejects(
    runModelReplacement(plan, {
      deleteStoredModel: async () => {},
      onPhaseChange: (phase) => phases.push(phase),
      readCacheSummaries: async () => [
        summary("global", "partial", 128_000_000),
        summary("earth", "missing")
      ],
      stopActiveModel: async () => {}
    }),
    /could not finish removing/
  );
  assert.deepEqual(phases, ["stopping", "deleting"]);
});
