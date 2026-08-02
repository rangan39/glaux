#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.GLAUX_SMOKE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.GLAUX_SMOKE_TIMEOUT_MS ?? 30_000);
const states = [
  "checking",
  "legacy-cleanup",
  "legacy-cleanup-error",
  "confirmation",
  "replacement-confirmation",
  "replacement-deleting",
  "downloading",
  "paused",
  "verifying",
  "ready",
  "retry-success",
  "generating",
  "stopped",
  "error",
  "reset"
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 900 },
  { name: "narrow-tablet", width: 716, height: 900 },
  { name: "compact-mobile", width: 320, height: 568 },
  { name: "mobile", width: 375, height: 812 }
];
const modelThemes = [
  { id: "tiny-aya-water", name: "Water", theme: "water", signal: "#008cff", canvas: "#f8fbff" },
  { id: "tiny-aya-fire", name: "Fire", theme: "fire", signal: "#e85d04", canvas: "#fff8f2" },
  { id: "tiny-aya-earth", name: "Earth", theme: "earth", signal: "#9a8264", canvas: "#f5f2eb" },
  { id: "tiny-aya-global", name: "Global", theme: "global", signal: "#111", canvas: "#f7f7f6" }
];

assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, "GLAUX_SMOKE_TIMEOUT_MS must be a positive number.");

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
      await assertState(page, state, viewport);
      await assertNoHorizontalOverflow(page, viewport, state);
      if (viewport.width <= 768) await assertResponsiveHeader(page, viewport, state);
      if (viewport.width <= 375 && ["ready", "downloading", "paused", "error"].includes(state)) {
        await assertCompleteComposerMetadata(page, state);
      }
      if (viewport.width === 375 && ["ready", "paused", "error"].includes(state)) {
        await assertMobileComposerGeometry(page, viewport, state);
      }
      if (state === "confirmation" || state === "replacement-confirmation" || state === "replacement-deleting") {
        await assertDocumentScrollLock(page, viewport, state);
        if (state === "confirmation") await assertModelChoiceFlow(page, viewport);
      }
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
  await assertModelThemes(browser);
  console.log(`Product UI fixture smoke test passed: ${baseUrl}`);
} finally {
  await browser.close();
}

async function assertModelThemes(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class ProductTestWorkerGuard {
        constructor() {
          throw new Error("Product-test theme fixtures must not construct a model worker.");
        }
      }
    });
  });

  for (const model of modelThemes) {
    const fixtureUrl = new URL(baseUrl);
    fixtureUrl.searchParams.set("sophon-product-test", "ready");
    fixtureUrl.searchParams.set("sophon-product-model", model.id);
    const response = await page.goto(fixtureUrl.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    assert.ok(response?.ok(), `Expected ${fixtureUrl.href} to load, received ${response?.status() ?? "no response"}.`);

    const main = page.locator(`main[data-model-theme="${model.theme}"]`);
    await main.waitFor({ state: "visible", timeout: timeoutMs });
    const values = await main.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        canvas: styles.getPropertyValue("--sophon-canvas").trim().toLowerCase(),
        signal: styles.getPropertyValue("--sophon-signal").trim().toLowerCase()
      };
    });
    assert.deepEqual(values, { canvas: model.canvas, signal: model.signal }, `${model.name} must resolve its centralized theme tokens.`);
    assert.equal(
      await page.getByRole("radio", { name: new RegExp(`Choose Tiny Aya ${model.name}`) }).isChecked(),
      true,
      `${model.name} must be the selected ready model.`
    );
  }

  await context.close();
  console.log("✓ model selection activates all four semantic themes");
}

async function assertState(page, state, viewport) {
  if (state === "checking") {
    await assertVisible(page.getByRole("status").filter({ hasText: "Checking this browser" }), "checking state");
    return;
  }
  if (state === "legacy-cleanup") {
    await assertVisible(page.getByRole("status").filter({ hasText: "Cleaning up old model files" }), "legacy model cleanup");
    await assertHeaderStatus(page, "Choose model", "text-sophon-copy-metadata");
    return;
  }
  if (state === "legacy-cleanup-error") {
    const alert = page.getByRole("alert").filter({ hasText: "Old model files could not be removed" });
    await assertVisible(alert, "legacy model cleanup error");
    await assertVisible(alert.getByRole("button", { name: "Retry cleanup", exact: true }), "legacy cleanup retry");
    return;
  }
  if (state === "confirmation") {
    const dialog = page.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true });
    await assertVisible(dialog, "download confirmation");
    await assertVisible(dialog.getByRole("button", { name: "Download model", exact: true }), "download confirmation action");
    assert.match(await dialog.textContent() ?? "", /non-commercial use under CC BY-NC 4\.0/);
    await assertHeaderStatus(page, "Choose model", "text-sophon-copy-metadata");
    return;
  }
  if (state === "replacement-confirmation") {
    const dialog = page.getByRole("dialog", { name: "Replace Tiny Aya Global 3.35B with Tiny Aya Earth 3.35B?", exact: true });
    await assertVisible(dialog, "model replacement confirmation");
    await assertVisible(dialog.getByRole("button", { name: "Keep Tiny Aya Global 3.35B", exact: true }), "keep installed model action");
    await assertVisible(dialog.getByRole("button", { name: "Replace & download", exact: true }), "replace and download action");
    assert.match(await dialog.textContent() ?? "", /keeps one model on this device at a time/i);
    assert.match(await dialog.textContent() ?? "", /Switching back will require another download/i);
    return;
  }
  if (state === "replacement-deleting") {
    const dialog = page.getByRole("dialog", { name: "Replace Tiny Aya Global 3.35B with Tiny Aya Earth 3.35B?", exact: true });
    await assertVisible(dialog, "model replacement deletion progress");
    const removing = dialog.getByRole("button", { name: "Removing Tiny Aya Global 3.35B…", exact: true });
    await assertVisible(removing, "model replacement busy state");
    assert.equal(await removing.isDisabled(), true, "Replacement progress must not be actionable.");
    return;
  }
  if (state === "downloading") {
    const progress = page.getByRole("progressbar", { name: /Loading Tiny Aya Global/ });
    await assertVisible(progress, "download progress");
    assert.equal(await progress.getAttribute("aria-valuenow"), "38.8");
    await assertVisible(page.getByRole("button", { name: "Pause model download", exact: true }), "pause action");
    await assertPromptLocked(page, state);
    return;
  }
  if (state === "paused") {
    await assertVisible(page.getByText("Model download paused", { exact: true }), "paused notice");
    await assertVisible(page.getByRole("button", { name: "Resume download", exact: true }), "resume action");
    await assertHeaderStatus(page, "Download paused", "text-sophon-warning");
    await assertPromptLocked(page, state);
    return;
  }
  if (state === "verifying") {
    const progress = page.getByRole("progressbar", { name: /Loading Tiny Aya Global/ });
    await assertVisible(progress, "verification progress");
    assert.match(await progress.getAttribute("aria-valuetext") ?? "", /verified/);
    const promptHelp = page.locator("#prompt-help");
    await assertVisible(promptHelp, "verification label");
    assert.match(await promptHelp.textContent() ?? "", /Verifying model/);
    await assertPromptLocked(page, state);
    return;
  }
  if (state === "ready" || state === "retry-success") {
    await assertVisible(page.getByRole("article", { name: "Message from you" }), "representative user message");
    const assistant = page.getByRole("article", { name: "Message from Glaux" }).filter({ hasText: "Recommendation" });
    await assertVisible(assistant, "representative assistant message");
    await assertVisible(assistant.getByText(/local-only:\/\/review/), "long markdown fixture");
    const textarea = page.getByRole("textbox", { name: "Message Glaux", exact: true });
    await assertVisible(textarea, "ready composer");
    assert.equal(await textarea.isEnabled(), true, "The prompt must unlock when the selected model is ready.");
    await assertHeaderStatus(page, "Model ready", "text-sophon-verified");
    if (state === "ready") await assertDeveloperModeNavigation(page, assistant, viewport);
    if (state === "ready" && viewport.width === 1440 && viewport.height === 900) await assertDesktopModelGeometry(page);
    await assertCachedModelChoiceFlow(page, viewport);
    return;
  }
  if (state === "generating") {
    const response = page.getByRole("article", { name: "Glaux is responding", exact: true });
    await assertVisible(response, "streaming response");
    await assertVisible(response.getByRole("button", { name: "Stop generation", exact: true }), "stop action");
    return;
  }
  if (state === "stopped" || state === "error") {
    const alert = page.locator("#prompt-error");
    await assertVisible(alert, `${state} recovery alert`);
    await assertVisible(alert.getByRole("button", { name: "Retry", exact: true }), `${state} retry action`);
    await assertVisible(alert.getByRole("button", { name: "Edit", exact: true }), `${state} edit action`);
    if (viewport.width <= 375) {
      const recoveryReason = alert.getByTestId("failed-turn-mobile-reason");
      await assertVisible(recoveryReason, `${state} mobile recovery reason`);
      assert.equal(
        (await recoveryReason.textContent() ?? "").trim(),
        state === "stopped"
          ? "Generation stopped. Your message is ready to retry or edit."
          : "The local WebGPU session was interrupted. Retry to rebuild it without losing your message."
      );
    }
    await assertHeaderStatus(
      page,
      state === "stopped" ? "Generation stopped" : "Session interrupted",
      state === "stopped" ? "text-sophon-warning" : "text-destructive"
    );
    return;
  }
  if (state === "reset") {
    const dialog = page.getByRole("dialog", { name: "Reset this conversation?", exact: true });
    await assertVisible(dialog, "reset confirmation");
    await assertVisible(dialog.getByRole("button", { name: "Reset", exact: true }), "reset action");
    await assertDocumentScrollLocked(page, "reset confirmation");
  }
}

async function assertDeveloperModeNavigation(page, assistant, viewport) {
  const mobile = viewport.width < 1024;
  if (mobile) await page.getByRole("button", { name: "Open model library", exact: true }).click();
  const library = mobile
    ? page.getByRole("dialog", { name: "Model library", exact: true })
    : page.getByRole("complementary", { name: "Model library", exact: true });
  const developerModeButton = library.getByRole("button", { name: "Dev Mode", exact: true });
  const inspectors = page.locator('button[aria-label^="Inspect "][aria-label$=" message tokens"]');
  await assertVisible(developerModeButton, `${viewport.name} sidebar developer-mode control`);
  assert.equal(await developerModeButton.getAttribute("aria-pressed"), "false", `${viewport.name} must default to Model Details.`);
  assert.equal(await inspectors.count(), 0, `${viewport.name} standard view must hide token inspection controls.`);
  assert.equal(await assistant.getByText(/8\.4 tokens\/s/).count(), 0, `${viewport.name} standard view must hide response metrics.`);
  await assertVisible(
    page.getByRole("article", { name: "Message from Glaux" }).filter({ hasText: "no server inference" }),
    `${viewport.name} standard-view privacy metadata`
  );

  await developerModeButton.click();
  assert.equal(await developerModeButton.getAttribute("aria-pressed"), "true", `${viewport.name} must switch to Developer mode.`);
  if (mobile) await library.getByRole("button", { name: "Close model library", exact: true }).click();
  assert.equal(await inspectors.count(), 2, `${viewport.name} Developer mode must expose both token inspectors.`);
  await assertVisible(assistant.getByText(/8\.4 tokens\/s/), `${viewport.name} Developer mode generation metrics`);

  if (mobile) await page.getByRole("button", { name: "Open model library", exact: true }).click();
  await library.getByRole("button", { name: "Model Details", exact: true }).click();
  if (mobile) await library.getByRole("button", { name: "Close model library", exact: true }).click();
  assert.equal(await inspectors.count(), 0, `${viewport.name} leaving Dev Mode must hide token inspectors.`);
  assert.equal(await assistant.getByText(/8\.4 tokens\/s/).count(), 0, `${viewport.name} leaving Dev Mode must hide metrics.`);
}

async function assertCachedModelChoiceFlow(page, viewport) {
  const mobile = viewport.width < 1024;
  if (mobile) await page.getByRole("button", { name: "Open model library", exact: true }).click();
  const library = mobile
    ? page.getByRole("dialog", { name: "Model library", exact: true })
    : page.getByRole("complementary", { name: "Model library", exact: true });
  await assertVisible(library, `${viewport.name} ready-state model library`);
  await assertNoOfflineImport(library, viewport);

  await library.locator('[data-model-id="tiny-aya-earth"]').click();
  assert.equal(
    await library.getByRole("radio", { name: /Choose Tiny Aya Earth/ }).isChecked(),
    true,
    `${viewport.name} uncached comparison choice must remain in the library.`
  );

  await library.locator('[data-model-id="tiny-aya-global"]').click();
  const globalRadio = page.locator(`${mobile ? "#model-library-mobile" : "#model-library-desktop"} input[value="tiny-aya-global"]`);
  assert.equal(await globalRadio.isChecked(), true, `${viewport.name} cached model selection must switch immediately.`);
  assert.equal(
    await page.getByRole("dialog", { name: /Download Tiny Aya/ }).count(),
    0,
    `${viewport.name} cached model selection must not request download confirmation.`
  );
  if (mobile) await library.waitFor({ state: "hidden", timeout: timeoutMs });
}

async function assertDesktopModelGeometry(page) {
  const library = page.getByRole("complementary", { name: "Model library", exact: true });
  const geometry = await library.evaluate((element) => {
    const list = element.querySelector('[data-testid="desktop-model-list"]');
    const footer = element.querySelector("footer");
    if (!list || !footer) return null;
    const listBox = list.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    return {
      cards: [...element.querySelectorAll("[data-model-card]")].map((card) => {
        const cardBox = card.getBoundingClientRect();
        return {
          bottom: cardBox.bottom,
          fields: ["[data-model-name]", "[data-model-description]", "[data-model-status]"].map((selector) => {
            const fieldBox = card.querySelector(selector)?.getBoundingClientRect();
            return { bottom: fieldBox?.bottom ?? Infinity, selector, top: fieldBox?.top ?? -Infinity };
          }),
          top: cardBox.top
        };
      }),
      footer: { bottom: footerBox.bottom, top: footerBox.top },
      library: element.getBoundingClientRect().toJSON(),
      list: {
        bottom: listBox.bottom,
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        scrollTop: list.scrollTop,
        top: listBox.top
      }
    };
  });

  assert.ok(geometry, "Desktop model-library geometry must be measurable.");
  assert.equal(geometry.cards.length, 4, "Desktop model library must render four measurable cards.");
  assert.equal(geometry.list.scrollTop, 0, "Desktop model comparison must begin at the top of the list.");
  assert.ok(
    geometry.cards.every((card) => card.top >= geometry.list.top - 1 && card.bottom <= geometry.list.bottom + 1),
    `All four model cards must be initially visible at 1440×900: ${JSON.stringify(geometry)}`
  );
  assert.ok(
    geometry.cards.flatMap((card) => card.fields).every((field) => field.top >= geometry.list.top - 1 && field.bottom <= geometry.list.bottom + 1),
    `Every model name, description, and status must be initially visible at 1440×900: ${JSON.stringify(geometry)}`
  );
  assert.ok(
    geometry.footer.top >= geometry.list.bottom - 1 && geometry.footer.bottom <= geometry.library.bottom + 1,
    `The model specification footer must remain visible without overlapping the list: ${JSON.stringify(geometry)}`
  );
}

async function assertModelChoiceFlow(page, viewport) {
  const mobile = viewport.width < 1024;
  if (mobile) await page.getByRole("button", { name: "Open model library", exact: true }).click();
  const library = mobile
    ? page.getByRole("dialog", { name: "Model library", exact: true })
    : page.getByRole("complementary", { name: "Model library", exact: true });
  await assertVisible(library, `${viewport.name} model library`);
  await assertNoOfflineImport(library, viewport);
  assert.equal(await library.getByRole("radio").count(), 4, `${viewport.name} model library must retain native radio semantics.`);
  assert.equal(
    await library.locator("[data-model-selection-indicator]").count(),
    4,
    `${viewport.name} model cards must expose visible radio affordances.`
  );

  const earth = library.getByRole("radio", { name: /Choose Tiny Aya Earth/ });
  await library.locator('[data-model-id="tiny-aya-earth"]').click();
  assert.equal(await earth.isChecked(), true, `${viewport.name} uncached model selection must update the radio.`);
  assert.equal(
    await page.getByRole("dialog", { name: "Download Tiny Aya Earth 3.35B?", exact: true }).count(),
    0,
    `${viewport.name} selection alone must not open confirmation.`
  );

  const download = library.getByRole("button", { name: "Download Earth · ~2.35 GB", exact: true });
  await assertVisible(download, `${viewport.name} selected-model download action`);
  await download.click();

  const confirmation = page.getByRole("dialog", { name: "Download Tiny Aya Earth 3.35B?", exact: true });
  await assertVisible(confirmation, `${viewport.name} selected-model download confirmation`);
  assert.match(await confirmation.textContent() ?? "", /non-commercial use under CC BY-NC 4\.0/);
  await confirmation.getByRole("button", { name: "Not now", exact: true }).click();
  await confirmation.waitFor({ state: "hidden", timeout: timeoutMs });
  if (mobile) {
    await assertVisible(library, `${viewport.name} model library restored after cancelling download`);
    await page.keyboard.press("Escape");
    await library.waitFor({ state: "hidden", timeout: timeoutMs });
  }
}

async function assertNoOfflineImport(library, viewport) {
  assert.equal(
    await library.locator('button[aria-label*="offline file"]').count(),
    0,
    `${viewport.name} model library must not expose the retired offline-file import.`
  );
}

async function assertHeaderStatus(page, label, semanticClass) {
  const status = page.getByTestId("workbench-status");
  await assertVisible(status, `${label} header status`);
  assert.equal((await status.textContent() ?? "").trim(), label);
  assert.match(await status.getAttribute("class") ?? "", new RegExp(`(?:^|\\s)${semanticClass}(?:\\s|$)`));
}

async function assertResponsiveHeader(page, viewport, state) {
  const header = page.getByTestId("workbench-header");
  const geometry = await header.evaluate((element) => {
    const headerBox = element.getBoundingClientRect();
    const measured = ["workbench-brand", "workbench-status", "workbench-actions"].flatMap((testId) => {
      const child = element.querySelector(`[data-testid="${testId}"]`);
      if (!child || getComputedStyle(child).display === "none") return [];
      const box = child.getBoundingClientRect();
      return [{
        bottom: box.bottom,
        clientWidth: child.clientWidth,
        left: box.left,
        right: box.right,
        scrollWidth: child.scrollWidth,
        testId,
        top: box.top
      }];
    });
    return { children: measured, header: headerBox.toJSON() };
  });

  for (const child of geometry.children) {
    assert.ok(
      child.left >= geometry.header.left - 1
        && child.right <= geometry.header.right + 1
        && child.top >= geometry.header.top - 1
        && child.bottom <= geometry.header.bottom + 1,
      `${viewport.name} ${state} ${child.testId} clips outside the header: ${JSON.stringify(geometry)}`
    );
    assert.ok(
      child.scrollWidth <= child.clientWidth + 1,
      `${viewport.name} ${state} ${child.testId} overflows its layout slot: ${JSON.stringify(child)}`
    );
  }

  if (state !== "ready") return;
  for (const [name, visibleText] of [
    ["Reset conversation", "Reset"],
    [/Switch to developer mode/, "Developer"],
    ["About", "About"],
    ["Open model library", "Models"]
  ]) {
    const action = page.getByRole("button", { name, exact: typeof name === "string" });
    await assertVisible(action, `${viewport.name} ${visibleText} header action`);
    assert.equal((await action.textContent() ?? "").trim(), visibleText, `${viewport.name} must show the ${visibleText} action name.`);
    if (viewport.width <= 375) await assertTouchTarget(action, `${viewport.name} ${visibleText}`);
  }
}

async function assertCompleteComposerMetadata(page, state) {
  const promptHelp = page.locator("#prompt-help");
  const storage = page.getByTestId("browser-storage");
  await assertVisible(promptHelp, `${state} prompt help`);
  await assertVisible(storage, `${state} browser storage`);

  const expectedPromptText = state === "paused"
    ? "Paused · resume to unlock prompt"
    : state === "error"
      ? "Session interrupted · retry or edit"
      : null;
  if (expectedPromptText) assert.equal((await promptHelp.textContent() ?? "").trim(), expectedPromptText);
  assert.match((await storage.textContent() ?? "").replace(/\s+/g, " ").trim(), /^Browser storage · [\d.]+ (?:MB|GB) \/ [\d.]+ (?:MB|GB) · Persistent$/);

  for (const [element, label] of [[promptHelp, "prompt help"], [storage, "browser storage"]]) {
    const layout = await element.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        clientWidth: node.clientWidth,
        overflowX: style.overflowX,
        scrollWidth: node.scrollWidth,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace
      };
    });
    assert.notEqual(layout.textOverflow, "ellipsis", `${state} ${label} must not use ellipsis: ${JSON.stringify(layout)}`);
    assert.notEqual(layout.whiteSpace, "nowrap", `${state} ${label} must be able to wrap: ${JSON.stringify(layout)}`);
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${state} ${label} overflows its row: ${JSON.stringify(layout)}`);
  }
}

async function assertPromptLocked(page, state) {
  const textarea = page.getByRole("textbox", { name: "Message Glaux", exact: true });
  await assertVisible(textarea, `${state} prompt`);
  assert.equal(await textarea.isDisabled(), true, `The prompt must stay disabled while the model is ${state}.`);
  assert.equal(
    await textarea.getAttribute("placeholder"),
    "Prompting unlocks when the model is ready...",
    `${state} prompt copy must explain when input unlocks.`
  );
}

async function assertMobileComposerGeometry(page, viewport, state) {
  const conversation = page.getByTestId("conversation-scroll");
  const composer = page.getByTestId("composer-panel");
  const textarea = page.getByRole("textbox", { name: "Message Glaux", exact: true });
  const [conversationBox, composerBox, textareaLayout] = await Promise.all([
    conversation.boundingBox(),
    composer.boundingBox(),
    textarea.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight
    }))
  ]);

  assert.ok(conversationBox, `${state} conversation geometry is unavailable.`);
  assert.ok(composerBox, `${state} composer geometry is unavailable.`);
  assert.ok(
    conversationBox.height >= viewport.height * 0.4,
    `${state} leaves only ${conversationBox.height}px of ${viewport.height}px for transcript context.`
  );
  assert.ok(textareaLayout.clientHeight <= 120, `${state} textarea exceeds its 120px mobile cap: ${JSON.stringify(textareaLayout)}`);
  assert.equal(textareaLayout.overflowY, "auto", `${state} textarea must scroll internally at its cap.`);
  if (state === "ready" || state === "paused") {
    assert.ok(textareaLayout.scrollHeight > textareaLayout.clientHeight, `${state} representative draft does not exercise internal textarea scrolling.`);
  }

  if (state === "paused") {
    await assertTouchTarget(page.getByRole("button", { name: "Resume download", exact: true }), "paused Resume");
  }
  if (state === "error") {
    await assertTouchTarget(page.getByRole("button", { name: "Retry", exact: true }), "error Retry");
    await assertTouchTarget(page.getByRole("button", { name: "Edit", exact: true }), "error Edit");
  }
}

async function assertTouchTarget(locator, label) {
  const box = await locator.boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44, `${label} must remain at least 44×44px: ${JSON.stringify(box)}`);
}

async function assertDocumentScrollLock(page, viewport, state) {
  await assertDocumentScrollLocked(page, `${viewport.name} ${state}`);
  const lockedScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await page.mouse.wheel(0, 500);
  await page.keyboard.press("PageDown");
  assert.deepEqual(
    await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
    lockedScroll,
    `${viewport.name} initially open fixture allowed background scrolling.`
  );
  if (state !== "confirmation") return;

  const dialog = page.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true });
  await dialog.getByRole("button", { name: "Not now", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: timeoutMs });

  const firstRunPrimary = page.getByTestId("first-run-primary");
  await firstRunPrimary.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, Math.min(180, document.documentElement.scrollHeight - window.innerHeight)));
  const before = await page.evaluate(() => {
    const panel = document.querySelector("[data-testid='first-run-welcome']");
    const rect = panel?.getBoundingClientRect();
    return {
      panelLeft: rect?.left ?? null,
      panelWidth: rect?.width ?? null,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
  });

  await firstRunPrimary.evaluate((element) => {
    element.focus({ preventScroll: true });
    element.click();
  });
  await dialog.waitFor({ state: "visible", timeout: timeoutMs });
  await assertDocumentScrollLocked(page, `${viewport.name} reopened download confirmation`);
  const opened = await page.evaluate(() => {
    const panel = document.querySelector("[data-testid='first-run-welcome']");
    const rect = panel?.getBoundingClientRect();
    return {
      panelLeft: rect?.left ?? null,
      panelWidth: rect?.width ?? null,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
  });
  assert.deepEqual({ x: opened.scrollX, y: opened.scrollY }, { x: before.scrollX, y: before.scrollY }, `${viewport.name} dialog opening changed the document position.`);
  assert.ok(Math.abs((opened.panelLeft ?? 0) - (before.panelLeft ?? 0)) <= 0.5, `${viewport.name} dialog opening shifted the page horizontally: ${JSON.stringify({ before, opened })}`);
  assert.ok(Math.abs((opened.panelWidth ?? 0) - (before.panelWidth ?? 0)) <= 0.5, `${viewport.name} dialog opening changed the page width: ${JSON.stringify({ before, opened })}`);

  await page.mouse.wheel(0, 500);
  await page.keyboard.press("PageDown");
  const afterScrollAttempts = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  assert.deepEqual(afterScrollAttempts, { x: before.scrollX, y: before.scrollY }, `${viewport.name} background moved while the dialog was open.`);

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: timeoutMs });
  await page.waitForFunction(() => document.activeElement === document.querySelector("[data-testid='first-run-primary']"), undefined, { timeout: timeoutMs });
  const restored = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  assert.deepEqual(restored, { x: before.scrollX, y: before.scrollY }, `${viewport.name} dialog did not restore its prior scroll position.`);
  assert.equal(await firstRunPrimary.evaluate((element) => document.activeElement === element), true, `${viewport.name} dialog did not restore trigger focus.`);
}

async function assertDocumentScrollLocked(page, label) {
  const lock = await page.evaluate(() => ({
    bodyOverflow: document.body.style.overflow,
    rootOverflow: document.documentElement.style.overflow,
    rootOverscrollBehavior: document.documentElement.style.overscrollBehavior
  }));
  assert.deepEqual(
    lock,
    { bodyOverflow: "hidden", rootOverflow: "hidden", rootOverscrollBehavior: "none" },
    `${label} did not lock document scrolling.`
  );
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
