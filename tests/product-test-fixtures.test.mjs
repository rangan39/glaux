import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductTestSnapshot,
  isProductTestingBuild,
  parseProductTestState,
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

test("enables fixtures only for an explicitly opted-in web development build", () => {
  assert.equal(isProductTestingBuild({
    nodeEnv: "development",
    productTesting: "1",
    chromeExtension: undefined
  }), true);
  assert.equal(isProductTestingBuild({
    nodeEnv: "development",
    productTesting: "0",
    chromeExtension: undefined
  }), false);
  assert.equal(isProductTestingBuild({
    nodeEnv: "production",
    productTesting: "1",
    chromeExtension: undefined
  }), false);
  assert.equal(isProductTestingBuild({
    nodeEnv: "development",
    productTesting: "1",
    chromeExtension: "1"
  }), false);
});

test("provides complete deterministic lifecycle snapshots", () => {
  const snapshots = new Map(PRODUCT_TEST_STATES.map((state) => [state, createProductTestSnapshot(state)]));
  assert.deepEqual([...snapshots.keys()], [...PRODUCT_TEST_STATES]);
  assert.equal(snapshots.get("checking").cacheInventoryResolved, false);
  assert.equal(snapshots.get("confirmation").pendingModelDownloadId, "tiny-aya-global");
  assert.equal(snapshots.get("downloading").generation.status, "loading");
  assert.equal(snapshots.get("downloading").generation.activity.progress.stage, "download");
  assert.equal(snapshots.get("paused").modelLoadPaused, true);
  assert.equal(snapshots.get("verifying").generation.activity.progress.stage, "verify");
  assert.equal(snapshots.get("ready").loadedModelId, "tiny-aya-global");
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

test("representative ready-state content exercises transcript metrics, tokens, and long markdown", () => {
  const ready = createProductTestSnapshot("ready");
  assert.ok(ready.messages.some(({ role }) => role === "user"));
  const assistant = ready.messages.find(({ id }) => id === "fixture-assistant-complete");
  assert.match(assistant.content, /\| Model \| Best fit \| Review note \|/);
  assert.match(assistant.content, /intentionally-long-unbroken-sample-line/);
  assert.match(assistant.meta, /tokens\/s/);
  assert.ok(assistant.tokens.length > 0);
  assert.ok(ready.messages.flatMap(({ tokens = [] }) => tokens).some((token) => token.inContext === false));
});
