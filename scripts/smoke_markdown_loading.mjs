#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.GLAUX_SMOKE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.GLAUX_SMOKE_TIMEOUT_MS ?? 30_000);
const rendererDelayMs = 750;
const rawMarkdownMarkers = [
  "## Recommendation",
  "**Global**",
  "| Model | Best fit | Review note |",
  "[local privacy details](/privacy)",
  "```text"
];
const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 }
];

assert.ok(Number.isFinite(timeoutMs) && timeoutMs > rendererDelayMs, "GLAUX_SMOKE_TIMEOUT_MS must exceed the renderer delay.");

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    let delayedChunks = 0;

    await page.route("**/_next/static/chunks/*markdown-content*", async (route) => {
      delayedChunks += 1;
      await new Promise((resolve) => setTimeout(resolve, rendererDelayMs));
      await route.continue();
    });

    const fixtureUrl = new URL(baseUrl);
    fixtureUrl.searchParams.set("sophon-product-test", "ready");
    const response = await page.goto(fixtureUrl.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    assert.ok(response?.ok(), `Expected ${fixtureUrl.href} to load, received ${response?.status() ?? "no response"}.`);

    const loadingState = page.getByRole("status").filter({ hasText: "Formatting response" });
    await loadingState.waitFor({ state: "attached", timeout: timeoutMs });
    assert.equal(await loadingState.getAttribute("aria-busy"), "true");
    assert.equal(delayedChunks > 0, true, "Expected the Markdown renderer chunk to be delayed.");

    const bodyTextWhileDelayed = await page.locator("body").innerText();
    for (const marker of rawMarkdownMarkers) {
      assert.equal(
        bodyTextWhileDelayed.includes(marker),
        false,
        `${viewport.width}×${viewport.height} exposed raw Markdown while the renderer was delayed: ${marker}`
      );
    }

    const assistant = page.getByRole("article", { name: "Message from Glaux" }).filter({ hasText: "Recommendation" });
    await assistant.getByRole("heading", { level: 2, name: "Recommendation" }).waitFor({ timeout: timeoutMs });
    assert.equal(await assistant.locator("strong", { hasText: "Global" }).count(), 1);
    assert.equal(await assistant.getByRole("table").count(), 1);
    assert.equal(await assistant.locator("pre code").filter({ hasText: "local-only://review/" }).count(), 1);
    assert.equal(await assistant.getByRole("link", { name: "local privacy details" }).getAttribute("href"), "/privacy");

    const widths = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth
    }));
    assert.ok(
      Math.max(widths.body, widths.document) <= widths.viewport + 1,
      `${viewport.width}×${viewport.height} rich content overflows horizontally: ${JSON.stringify(widths)}`
    );

    await page.close();
    console.log(`✓ delayed Markdown renderer stays neutral at ${viewport.width}×${viewport.height}`);
  }
  console.log(`Markdown loading smoke test passed: ${baseUrl}`);
} finally {
  await browser.close();
}
