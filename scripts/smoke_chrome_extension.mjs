#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const rootDir = path.resolve(import.meta.dirname, "..");
const extensionDir = path.resolve(process.env.GLAUX_EXTENSION_DIR ?? path.join(rootDir, "dist", "chrome-extension"));
const profileDir = await mkdtemp(path.join(os.tmpdir(), "sophon-extension-"));
const runtimeErrors = [];
let context;

try {
  assert.equal((await stat(path.join(extensionDir, "manifest.json"))).isFile(), true, "Run npm run build:extension first.");
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage"
    ]
  });

  let [serviceWorker] = context.serviceWorkers();
  serviceWorker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  assert.match(extensionId, /^[a-p]{32}$/);

  let resolveModelRequest;
  const modelRequest = new Promise((resolve) => {
    resolveModelRequest = resolve;
  });
  await context.route("https://huggingface.co/**", async (route) => {
    resolveModelRequest(route.request().url());
    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  await page.goto(`chrome-extension://${extensionId}/index.html?sophon-product-test=ready`, { waitUntil: "domcontentloaded" });
  assert.equal(new URL(page.url()).protocol, "chrome-extension:");
  await page.getByRole("heading", { name: "GLAUX", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("first-run-welcome").waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await page.locator("[data-product-test-state]").count(), 0, "The packaged extension must ignore product-test query parameters.");
  assert.equal(await page.getByText("Recommendation", { exact: true }).count(), 0, "Fixture transcript content must not activate in the packaged extension.");
  const privacyLink = page.getByRole("link", { name: "Privacy", exact: true });
  assert.equal(await privacyLink.count(), 1);
  assert.equal(await privacyLink.getAttribute("href"), "/privacy.html");
  const firstRunTrustNav = page.getByTestId("first-run-trust-nav");
  await firstRunTrustNav.getByRole("button", { name: "About & licenses", exact: true }).click();
  const aboutDialog = page.getByRole("dialog", { name: "About Glaux", exact: true });
  await aboutDialog.waitFor({ state: "visible" });
  assert.equal(await aboutDialog.getByRole("link", { name: /Privacy policy.*Local data and network requests/ }).getAttribute("href"), "/privacy.html");
  assert.equal(await aboutDialog.getByRole("link", { name: /CC BY-NC 4\.0.*opens in a new tab/ }).getAttribute("href"), "https://creativecommons.org/licenses/by-nc/4.0/");
  assert.equal(await aboutDialog.getByRole("link", { name: /Cohere Labs AUP.*opens in a new tab/ }).getAttribute("href"), "https://docs.cohere.com/docs/cohere-labs-acceptable-use-policy");
  assert.equal(await aboutDialog.getByRole("link", { name: /Project support.*opens in a new tab/ }).getAttribute("href"), "https://github.com/rangan39/glaux/issues");
  await page.keyboard.press("Escape");
  await aboutDialog.waitFor({ state: "hidden" });
  const privacyPage = await context.newPage();
  privacyPage.on("pageerror", (error) => runtimeErrors.push(`privacy pageerror: ${error.message}`));
  privacyPage.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`privacy console: ${message.text()}`);
  });
  await privacyPage.goto(`chrome-extension://${extensionId}/privacy.html`, { waitUntil: "domcontentloaded" });
  await privacyPage.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor({ state: "visible" });
  assert.equal(await privacyPage.getByRole("link", { name: "← Back to Glaux", exact: true }).getAttribute("href"), "/index.html");
  await privacyPage.close();
  const modelLibrary = page.getByRole("complementary", { name: "Model library", exact: true });
  await modelLibrary.waitFor({ state: "visible" });
  assert.equal(await page.getByRole("radio").count(), 4);
  try {
    await modelLibrary.getByText("~2.35 GB · Chromium WebGPU", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      brands: navigator.userAgentData?.brands ?? [],
      userAgent: navigator.userAgent
    }));
    throw new Error(`Chromium profile was not detected: ${JSON.stringify({
      ...diagnostics,
      modelLibrary: await modelLibrary.innerText(),
      runtimeErrors
    })}`, { cause: error });
  }
  await page.waitForTimeout(250);
  assert.deepEqual(runtimeErrors, []);
  const globalModel = modelLibrary.locator('[data-model-id="tiny-aya-global"]');
  assert.equal(await globalModel.count(), 1);
  await globalModel.click();
  const downloadConfirmation = page.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true });
  await downloadConfirmation.waitFor({ state: "visible" });
  await downloadConfirmation.getByText(/2\.35 GB.*before it can answer locally/).waitFor({ state: "visible" });
  await downloadConfirmation.getByText(/CC BY-NC 4\.0.*Cohere Labs AUP/).waitFor({ state: "visible" });
  await downloadConfirmation.getByRole("button", { name: "Download model", exact: true }).click();
  let modelRequestTimeout;
  const requestedModelUrl = await Promise.race([
    modelRequest,
    new Promise((_, reject) => {
      modelRequestTimeout = setTimeout(() => reject(new Error("The extension worker did not request the selected Tiny Aya model.")), 15_000);
    })
  ]).finally(() => clearTimeout(modelRequestTimeout));
  assert.match(requestedModelUrl, /onnx-community\/tiny-aya-global-ONNX\/resolve\/7fff1be9627e40f0d89c33f406882bdafb56ec90\/onnx\/model_q4f16\.onnx_data(?:_1)?$/);
  console.log(`✓ Manifest V3 extension loaded at chrome-extension://${extensionId}/`);
  console.log("✓ Packaged privacy, licensing, support, and extension-safe navigation rendered");
  console.log("✓ Packaged extension ignored the development-only product-test query");
  console.log("✓ WebGPU capability detection and the four-model Cohere library rendered");
  console.log("✓ Model selection required an explicit size and licensing confirmation");
  console.log("✓ Extension worker reached the pinned Tiny Aya runtime on selection");
} finally {
  await context?.close();
  await rm(profileDir, { recursive: true, force: true });
}
