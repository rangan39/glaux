#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.SOPHON_SMOKE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.SOPHON_SMOKE_TIMEOUT_MS ?? 30_000);
const states = [
  "checking",
  "confirmation",
  "downloading",
  "paused",
  "verifying",
  "ready",
  "generating",
  "stopped",
  "error",
  "reset"
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 320, height: 800 }
];

assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, "SOPHON_SMOKE_TIMEOUT_MS must be a positive number.");

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const externalRequests = [];
    const runtimeErrors = [];
    const expectedOrigin = new URL(baseUrl).origin;

    await page.addInitScript(() => {
      Object.defineProperty(window, "__sophonProductTestWorkerCount", {
        configurable: false,
        value: 0,
        writable: true
      });
      Object.defineProperty(window, "Worker", {
        configurable: true,
        value: class ProductTestWorkerGuard {
          constructor() {
            window.__sophonProductTestWorkerCount += 1;
            throw new Error("Product-test fixtures must not construct a model worker.");
          }
        }
      });
    });
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== expectedOrigin) externalRequests.push(request.url());
    });
    page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
    });

    for (const state of states) {
      const fixtureUrl = new URL(baseUrl);
      fixtureUrl.searchParams.set("sophon-product-test", state);
      const response = await page.goto(fixtureUrl.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      assert.ok(response?.ok(), `Expected ${fixtureUrl.href} to load, received ${response?.status() ?? "no response"}.`);
      const main = page.locator(`main[data-product-test-state="${state}"]`);
      await main.waitFor({ state: "visible", timeout: timeoutMs });
      await assertState(page, state);
      await assertNoHorizontalOverflow(page, viewport, state);
      assert.equal(
        await page.evaluate(() => window.__sophonProductTestWorkerCount),
        0,
        `${viewport.name} ${state} fixture constructed a model worker.`
      );
    }

    assert.deepEqual(externalRequests, [], `${viewport.name} fixtures made external requests.`);
    assert.deepEqual(runtimeErrors, [], `${viewport.name} fixtures emitted runtime errors.`);
    await context.close();
    console.log(`✓ ${viewport.name} product fixtures cover all lifecycle states`);
  }
  console.log(`Product UI fixture smoke test passed: ${baseUrl}`);
} finally {
  await browser.close();
}

async function assertState(page, state) {
  if (state === "checking") {
    await assertVisible(page.getByRole("status").filter({ hasText: "Checking this browser" }), "checking state");
    return;
  }
  if (state === "confirmation") {
    const dialog = page.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true });
    await assertVisible(dialog, "download confirmation");
    await assertVisible(dialog.getByRole("button", { name: "Download model", exact: true }), "download confirmation action");
    assert.match(await dialog.textContent() ?? "", /non-commercial use under CC BY-NC 4\.0/);
    return;
  }
  if (state === "downloading") {
    const progress = page.getByRole("progressbar", { name: /Loading Tiny Aya Global/ });
    await assertVisible(progress, "download progress");
    assert.equal(await progress.getAttribute("aria-valuenow"), "38");
    await assertVisible(page.getByRole("button", { name: "Pause model download", exact: true }), "pause action");
    return;
  }
  if (state === "paused") {
    await assertVisible(page.getByText("Model download paused", { exact: true }), "paused notice");
    await assertVisible(page.getByRole("button", { name: "Resume download", exact: true }).last(), "resume action");
    return;
  }
  if (state === "verifying") {
    const progress = page.getByRole("progressbar", { name: /Loading Tiny Aya Global/ });
    await assertVisible(progress, "verification progress");
    assert.match(await progress.getAttribute("aria-valuetext") ?? "", /verified/);
    await assertVisible(page.getByText(/Verifying model/).first(), "verification label");
    return;
  }
  if (state === "ready") {
    await assertVisible(page.getByRole("article", { name: "Message from you" }), "representative user message");
    const assistant = page.getByRole("article", { name: "Message from Sophon" }).filter({ hasText: "Recommendation" });
    await assertVisible(assistant, "representative assistant message");
    await assertVisible(assistant.getByText(/8\.4 tokens\/s/), "generation metrics");
    await assertVisible(assistant.getByText(/local-only:\/\/review/), "long markdown fixture");
    await assertVisible(page.getByRole("textbox", { name: "Message Sophon", exact: true }), "ready composer");
    return;
  }
  if (state === "generating") {
    await assertVisible(page.getByRole("article", { name: "Sophon is responding", exact: true }), "streaming response");
    await assertVisible(page.getByRole("button", { name: "Stop generation", exact: true }).first(), "stop action");
    return;
  }
  if (state === "stopped" || state === "error") {
    const alert = page.locator("#prompt-error");
    await assertVisible(alert, `${state} recovery alert`);
    await assertVisible(alert.getByRole("button", { name: "Retry", exact: true }), `${state} retry action`);
    await assertVisible(alert.getByRole("button", { name: "Edit", exact: true }), `${state} edit action`);
    return;
  }
  if (state === "reset") {
    const dialog = page.getByRole("dialog", { name: "Reset this conversation?", exact: true });
    await assertVisible(dialog, "reset confirmation");
    await assertVisible(dialog.getByRole("button", { name: "Reset", exact: true }), "reset action");
  }
}

async function assertVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await locator.count(), 1, `Expected exactly one ${label}.`);
}

async function assertNoHorizontalOverflow(page, viewport, state) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  assert.ok(
    Math.max(widths.body, widths.document) <= widths.viewport + 1,
    `${viewport.name} ${state} fixture overflows horizontally: ${JSON.stringify(widths)}`
  );
}
