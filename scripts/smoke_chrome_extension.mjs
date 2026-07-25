#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const rootDir = path.resolve(import.meta.dirname, "..");
const extensionDir = path.join(rootDir, "dist", "chrome-extension");
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
  await page.goto(`chrome-extension://${extensionId}/index.html`, { waitUntil: "domcontentloaded" });
  assert.equal(new URL(page.url()).protocol, "chrome-extension:");
  await page.getByRole("heading", { name: "SOPHON", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
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
  let modelRequestTimeout;
  const requestedModelUrl = await Promise.race([
    modelRequest,
    new Promise((_, reject) => {
      modelRequestTimeout = setTimeout(() => reject(new Error("The extension worker did not request the selected Tiny Aya model.")), 15_000);
    })
  ]).finally(() => clearTimeout(modelRequestTimeout));
  assert.match(requestedModelUrl, /onnx-community\/tiny-aya-global-ONNX\/resolve\/7fff1be9627e40f0d89c33f406882bdafb56ec90\//);
  console.log(`✓ Manifest V3 extension loaded at chrome-extension://${extensionId}/`);
  console.log("✓ WebGPU capability detection and the four-model Cohere library rendered");
  console.log("✓ Extension worker reached the pinned Tiny Aya runtime on selection");
} finally {
  await context?.close();
  await rm(profileDir, { recursive: true, force: true });
}
