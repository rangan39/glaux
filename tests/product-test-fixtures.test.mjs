import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductTestSnapshot,
  isProductTestingBuild,
  parseProductTestModelId,
  parseProductTestState,
  PRODUCT_TEST_MODEL_IDS,
  PRODUCT_TEST_STATES
} from "../src/lib/product-test-fixtures.ts";

test("recognizes every documented product-test state and rejects unknown values", () => {
  assert.deepEqual(
    PRODUCT_TEST_STATES.map((state) => parseProductTestState(state)),
    [...PRODUCT_TEST_STATES]
  );
  assert.equal(parseProductTestState(""), null);
  assert.equal(parseProductTestState("downloaded"), null);
  assert.equal(parseProductTestState(null), null);
});

test("recognizes the four model fixtures and rejects unknown model IDs", () => {
  assert.deepEqual(
    PRODUCT_TEST_MODEL_IDS.map((modelId) => parseProductTestModelId(modelId)),
    [...PRODUCT_TEST_MODEL_IDS]
  );
  assert.equal(parseProductTestModelId("tiny-aya-air"), null);
  assert.equal(parseProductTestModelId(null), null);
});

test("enables fixtures only for an explicitly opted-in web development build", () => {
  assert.equal(isProductTestingBuild({
    nodeEnv: "development",
    productTesting: "1"
  }), true);
  assert.equal(isProductTestingBuild({
    nodeEnv: "development",
    productTesting: "0"
  }), false);
  assert.equal(isProductTestingBuild({
    nodeEnv: "production",
    productTesting: "1"
  }), false);
});

test("provides complete deterministic lifecycle snapshots", () => {
  const snapshots = new Map(PRODUCT_TEST_STATES.map((state) => [state, createProductTestSnapshot(state)]));
  assert.deepEqual([...snapshots.keys()], [...PRODUCT_TEST_STATES]);
  assert.equal(snapshots.get("checking").cacheInventoryResolved, false);
  assert.equal(snapshots.get("legacy-cleanup").startupCleanupStatus, "cleaning");
  assert.equal(snapshots.get("legacy-cleanup").cacheInventoryResolved, false);
  assert.equal(snapshots.get("legacy-cleanup-error").startupCleanupStatus, "failed");
  assert.match(snapshots.get("legacy-cleanup-error").error, /could not remove/i);
  assert.equal(snapshots.get("confirmation").pendingModelDownloadId, "tiny-aya-global");
  assert.equal(snapshots.get("replacement-confirmation").pendingModelDownloadId, "tiny-aya-earth");
  assert.equal(snapshots.get("replacement-confirmation").modelId, "tiny-aya-global");
  assert.equal(snapshots.get("replacement-deleting").modelReplacementPhase, "deleting");
  assert.equal(snapshots.get("downloading").generation.status, "loading");
  assert.equal(snapshots.get("downloading").generation.activity.progress.stage, "download");
  assert.equal(snapshots.get("paused").modelLoadPaused, true);
  assert.equal(snapshots.get("verifying").generation.activity.progress.stage, "verify");
  assert.equal(snapshots.get("ready").loadedModelId, "tiny-aya-global");
  assert.equal(snapshots.get("retry-success").loadedModelId, "tiny-aya-global");
  assert.equal(snapshots.get("retry-success").failedTurn, null);
  assert.equal(snapshots.get("generating").generation.status, "running");
  assert.match(snapshots.get("generating").generation.draft, /Global/);
  assert.match(snapshots.get("stopped").failedTurn.reason, /stopped/i);
  assert.match(snapshots.get("error").failedTurn.reason, /Retry/);
  assert.equal(snapshots.get("reset").resetConfirmationOpen, true);

  for (const [state, snapshot] of snapshots) {
    assert.equal(snapshot.state, state);
    assert.equal(snapshot.cacheSummaries.length, 4);
    assert.ok(snapshot.cacheSummaries.every(({ totalBytes }) => totalBytes === 2_354_413_407));
  }
});

test("ready fixtures can activate each model without changing lifecycle semantics", () => {
  for (const modelId of PRODUCT_TEST_MODEL_IDS) {
    const ready = createProductTestSnapshot("ready", modelId);
    assert.equal(ready.modelId, modelId);
    assert.equal(ready.loadedModelId, modelId);
    assert.equal(ready.cacheSummaries.find((summary) => summary.modelId === modelId)?.state, "cached");
    assert.ok(ready.cacheSummaries.filter((summary) => summary.modelId !== modelId).every((summary) => summary.state === "missing"));
  }
});
