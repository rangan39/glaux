#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const rootDir = path.resolve(import.meta.dirname, "..");
const extensionDir = path.join(rootDir, "dist", "chrome-extension");
const outputDir = path.join(rootDir, "chrome-extension", "store-assets", "screenshots");
const profileDir = await mkdtemp(path.join(os.tmpdir(), "sophon-store-assets-"));
let context;

try {
  assert.equal((await stat(path.join(extensionDir, "manifest.json"))).isFile(), true, "Run npm run build:extension first.");
  await mkdir(outputDir, { recursive: true });
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
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
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("first-run-welcome").waitFor({ state: "visible", timeout: 30_000 });
  await capture(page, "01-private-local-ai-1280x800.png");

  const modelLibrary = page.getByRole("complementary", { name: "Model library", exact: true });
  await modelLibrary.locator('[data-model-id="tiny-aya-global"]').click();
  const confirmation = page.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true });
  await confirmation.waitFor({ state: "visible" });
  await capture(page, "02-model-download-disclosure-1280x800.png");
  await confirmation.getByRole("button", { name: "Not now", exact: true }).click();

  await page.getByRole("button", { name: "About Sophon", exact: true }).click();
  await page.getByRole("dialog", { name: "Acknowledgements", exact: true }).waitFor({ state: "visible" });
  await capture(page, "03-open-model-stack-1280x800.png");

  await page.goto(`chrome-extension://${extensionId}/privacy.html`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor({ state: "visible" });
  await capture(page, "04-privacy-policy-1280x800.png");
} finally {
  await context?.close();
  await rm(profileDir, { recursive: true, force: true });
}

async function capture(page, name) {
  const output = path.join(outputDir, name);
  await page.screenshot({ path: output, fullPage: false, animations: "disabled" });
  const metadata = await sharp(output).metadata();
  assert.deepEqual([metadata.width, metadata.height, metadata.format], [1280, 800, "png"]);
  console.log(`✓ ${path.relative(rootDir, output)} (1280×800)`);
}
