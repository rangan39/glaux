#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.GLAUX_SMOKE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.GLAUX_SMOKE_TIMEOUT_MS ?? 30_000);
const viewports = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
  { width: 716, height: 900 },
  { width: 1440, height: 900 }
];
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: viewports[0] });
  await context.route("https://**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByTestId("first-run-welcome").waitFor({ state: "visible", timeout: timeoutMs });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const trustNav = page.getByTestId("first-run-trust-nav");
    const privacyLink = trustNav.getByRole("link", { name: "Privacy", exact: true });
    const aboutButton = trustNav.getByRole("button", { name: "About & licenses", exact: true });
    const supportLink = trustNav.getByRole("link", { name: /Support.*opens in a new tab/ });

    await trustNav.waitFor({ state: "visible", timeout: timeoutMs });
    await privacyLink.scrollIntoViewIfNeeded();
    assert.equal(await privacyLink.getAttribute("href"), "/privacy");
    assert.equal(await supportLink.getAttribute("href"), "https://github.com/rangan39/glaux/issues");
    assert.equal(await supportLink.getAttribute("target"), "_blank");

    for (const [control, label] of [
      [privacyLink, "privacy"],
      [aboutButton, "About and licenses"],
      [supportLink, "support"]
    ]) {
      const box = await control.boundingBox();
      assert.ok(
        box
          && box.x >= -1
          && box.x + box.width <= viewport.width + 1
          && box.width >= 24
          && box.height >= 24,
        `${viewport.width}px ${label} control is clipped or too small: ${JSON.stringify(box)}`
      );
      await control.focus();
      assert.equal(
        await control.evaluate((element) => document.activeElement === element),
        true,
        `${viewport.width}px ${label} control must accept keyboard focus.`
      );
    }

    await aboutButton.click();
    const aboutDialog = page.getByRole("dialog", { name: "About Glaux", exact: true });
    await aboutDialog.waitFor({ state: "visible", timeout: timeoutMs });
    assert.equal(
      await aboutDialog.getByRole("link", { name: /Privacy policy.*Local data and network requests/ }).getAttribute("href"),
      "/privacy"
    );
    assert.equal(
      await aboutDialog.getByRole("link", { name: /CC BY-NC 4\.0.*opens in a new tab/ }).getAttribute("href"),
      "https://creativecommons.org/licenses/by-nc/4.0/"
    );
    assert.equal(
      await aboutDialog.getByRole("link", { name: /Cohere Labs AUP.*opens in a new tab/ }).getAttribute("href"),
      "https://docs.cohere.com/docs/cohere-labs-acceptable-use-policy"
    );
    assert.equal(
      await aboutDialog.getByRole("link", { name: /Project support.*opens in a new tab/ }).getAttribute("href"),
      "https://github.com/rangan39/glaux/issues"
    );
    const panelBox = await aboutDialog.getByTestId("acknowledgements-panel").boundingBox();
    assert.ok(
      panelBox && panelBox.x >= -1 && panelBox.x + panelBox.width <= viewport.width + 1,
      `${viewport.width}px About panel is outside the viewport: ${JSON.stringify(panelBox)}`
    );
    await page.keyboard.press("Escape");
    await aboutDialog.waitFor({ state: "hidden", timeout: timeoutMs });
    assert.equal(
      await aboutButton.evaluate((element) => document.activeElement === element),
      true,
      `${viewport.width}px About dialog must restore trigger focus.`
    );

    const widths = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth
    }));
    assert.ok(
      Math.max(widths.body, widths.document) <= widths.viewport + 1,
      `${viewport.width}px first-run page overflows horizontally: ${JSON.stringify(widths)}`
    );
  }

  const privacyPage = await context.newPage();
  await privacyPage.goto(new URL("/privacy", url).toString(), { waitUntil: "domcontentloaded" });
  await privacyPage.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await privacyPage.getByRole("link", { name: "← Back to Glaux", exact: true }).getAttribute("href"), "/");
  assert.equal(
    await privacyPage.getByRole("link", { name: /public support tracker.*opens in a new tab/ }).getAttribute("target"),
    "_blank"
  );
  await privacyPage.close();

  console.log("✓ Trust, legal, and support navigation passes at 320, 390, 716, and 1440 px");
  console.log("✓ Hosted privacy navigation preserves a path back to Glaux");
} finally {
  await browser?.close();
}
