#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.SOPHON_SMOKE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.SOPHON_SMOKE_TIMEOUT_MS ?? 30_000);
const runtimeErrors = [];
let browser;
let activePage;

try {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, "SOPHON_SMOKE_TIMEOUT_MS must be a positive number.");
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"]
  });

  const serverContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  activePage = await serverContext.newPage();
  await openPage(activePage);
  await assertVisible(activePage.getByRole("status").filter({ hasText: "Loading inference console" }), "SSR loading shell");
  assert.equal(await activePage.locator("h1", { hasText: "SOPHON" }).count(), 1, "SSR response must contain the workbench shell.");
  await serverContext.close();
  console.log("✓ Server-rendered fallback and workbench shell exist without JavaScript");

  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktopContext.route("https://**/*", (route) => route.abort("blockedbyclient"));
  activePage = await desktopContext.newPage();
  captureRuntimeErrors(activePage);
  await openPage(activePage);

  const heading = activePage.getByRole("heading", { name: "SOPHON", exact: true });
  const textarea = activePage.getByRole("textbox", { name: "Message Sophon", exact: true });
  const modelLibrary = activePage.getByRole("complementary", { name: "Model library", exact: true });
  const modelRadios = modelLibrary.getByRole("radio");
  const sendButton = activePage.getByRole("button", { name: "Send message", exact: true });
  const resetButton = activePage.getByRole("button", { name: "Reset conversation", exact: true });
  const aboutTrigger = activePage.getByRole("button", { name: "About", exact: true });
  const storageStatus = activePage.getByTestId("browser-storage");
  await assertVisible(heading, "Sophon heading");
  const firstRunWelcome = activePage.getByTestId("first-run-welcome");
  const firstRunPrimary = activePage.getByTestId("first-run-primary");
  await assertVisible(firstRunWelcome, "first-run welcome");
  await assertVisible(firstRunWelcome.getByRole("heading", { name: "Private AI, right in your browser", exact: true }), "first-run heading");
  assert.equal(await textarea.count(), 0, "The composer must stay hidden until the user chooses a model.");
  await assertVisible(modelLibrary, "desktop model library");
  await assertVisible(aboutTrigger, "stable About Sophon control");
  assert.equal(await aboutTrigger.getAttribute("aria-haspopup"), "dialog");
  await aboutTrigger.click();
  const acknowledgements = activePage.getByRole("dialog", { name: "About Sophon", exact: true });
  await assertVisible(acknowledgements, "About Sophon dialog");
  const acknowledgementsPanel = acknowledgements.getByTestId("acknowledgements-panel");
  assert.equal(await acknowledgementsPanel.evaluate((element) => getComputedStyle(element).animationName), "sophon-dialog-in", "Acknowledgements should enter with the restrained panel transition.");
  assert.equal(await acknowledgementsPanel.evaluate((element) => getComputedStyle(element).animationDuration), "0.12s", "Acknowledgements transition should remain snappy.");
  const trustSupportLinks = acknowledgements.getByTestId("trust-support-links");
  const technicalAcknowledgements = acknowledgements.getByTestId("acknowledgements-technical");
  const communityAcknowledgements = acknowledgements.getByTestId("acknowledgements-community");
  await assertVisible(acknowledgements.getByRole("heading", { name: "Privacy, licensing & support", exact: true }), "privacy, licensing, and support heading");
  await assertVisible(acknowledgements.getByRole("heading", { name: "Technical", exact: true }), "technical acknowledgements heading");
  await assertVisible(acknowledgements.getByRole("heading", { name: "Community", exact: true }), "community acknowledgements heading");
  assert.equal(await trustSupportLinks.getByRole("link").count(), 4, "About Sophon must expose privacy, license, AUP, and support links.");
  assert.equal(await trustSupportLinks.getByRole("link", { name: /Privacy policy.*Local data and network requests/ }).getAttribute("href"), "/privacy");
  assert.equal(await trustSupportLinks.getByRole("link", { name: /CC BY-NC 4\.0.*opens in a new tab/ }).getAttribute("href"), "https://creativecommons.org/licenses/by-nc/4.0/");
  assert.equal(await trustSupportLinks.getByRole("link", { name: /Cohere Labs AUP.*opens in a new tab/ }).getAttribute("href"), "https://docs.cohere.com/docs/cohere-labs-acceptable-use-policy");
  assert.equal(await trustSupportLinks.getByRole("link", { name: /Project support.*opens in a new tab/ }).getAttribute("href"), "https://github.com/rangan39/sophon/issues");
  assert.equal(await trustSupportLinks.locator('a[target="_blank"]').count(), 3, "Every external About link must open in a new tab.");
  assert.equal(await technicalAcknowledgements.locator("li").count(), 4, "Technical acknowledgements must include all four model/runtime credits.");
  assert.equal(await communityAcknowledgements.locator("li").count(), 3, "Community acknowledgements must include all three organizations.");
  assert.equal(await communityAcknowledgements.getByRole("link", { name: /Radical Ventures.*opens in a new tab/ }).getAttribute("href"), "https://radical.vc/");
  assert.equal(await communityAcknowledgements.getByRole("link", { name: /NEXT Canada.*opens in a new tab/ }).getAttribute("href"), "https://www.nextcanada.com/");
  assert.equal(await communityAcknowledgements.getByRole("link", { name: /Trajectory Labs.*opens in a new tab/ }).getAttribute("href"), "https://www.trajectorylabs.org/");
  assert.equal(await acknowledgements.getByRole("link", { name: /rangan39.*opens in a new tab/ }).getAttribute("href"), "https://github.com/rangan39");
  await activePage.keyboard.press("Escape");
  await acknowledgements.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await aboutTrigger.evaluate((element) => document.activeElement === element), true, "Closing About Sophon must restore trigger focus.");
  await activePage.waitForFunction(() => {
    const radios = document.querySelectorAll('[data-model-surface="desktop"] input[type="radio"]');
    return radios.length === 4 && [...radios].every((radio) => !/(Checking browser GPU|Downloading)/.test(radio.getAttribute("aria-label") ?? ""));
  }, undefined, { timeout: timeoutMs });
  const models = await modelRadios.evaluateAll((nodes) => nodes.map((radio) => ({
    checked: radio.checked,
    disabled: radio.disabled,
    label: radio.getAttribute("aria-label") ?? "",
    value: radio.value
  })));
  assert.deepEqual(models.map((model) => model.value), ["tiny-aya-global", "tiny-aya-earth", "tiny-aya-fire", "tiny-aya-water"]);
  assert.ok(models.every((model) => /\.( Ready to download| Browser GPU required)\.$/.test(model.label)), "Every model radio must expose availability.");
  assert.ok(models.every((model) => /non-commercial/.test(model.label)), "Every Tiny Aya model must disclose its non-commercial license.");
  assert.ok(models.some((model) => !model.disabled), "At least one model must be compatible with the smoke-test browser.");
  assert.ok(models.every((model) => !model.checked), "No model should be selected before an explicit user choice.");
  const selectionIndicators = modelLibrary.locator("[data-model-selection-indicator]");
  assert.equal(await selectionIndicators.count(), 4, "Every expanded desktop model card must expose a visible radio affordance.");
  assert.equal(await modelLibrary.locator('[data-model-selection-indicator][data-selected="true"]').count(), 0, "Visible selection affordances must agree with the unchecked native radios.");
  const earthRadio = modelLibrary.getByRole("radio", { name: /Choose Tiny Aya Earth/ });
  await modelLibrary.locator('[data-model-id="tiny-aya-earth"]').click();
  assert.equal(await earthRadio.isChecked(), true, "Choosing an uncached model must update the native radio selection.");
  assert.equal(await modelLibrary.locator('[data-model-selection-indicator][data-selected="true"]').count(), 1, "Exactly one visible model selection affordance must be active.");
  assert.equal(await activePage.getByRole("dialog", { name: /Download Tiny Aya Earth/ }).count(), 0, "Choosing an uncached model must not open the download confirmation.");
  await assertVisible(modelLibrary.getByRole("button", { name: "Download Earth · ~2.35 GB", exact: true }), "selected-model network download action");
  await assertModelLibraryLayout(modelLibrary, { width: 1440, height: 900 }, "desktop");
  await assertTypographyRoles(modelLibrary, "desktop model library");
  const firstRunViewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 716, height: 987 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ];
  for (const viewport of firstRunViewports) {
    const { width } = viewport;
    await activePage.setViewportSize(viewport);
    await assertFirstRunLayout(activePage, viewport);
    await assertTypographyRoles(activePage, `${width}px first-run interface`);
    const trustNav = activePage.getByTestId("first-run-trust-nav");
    const privacyLink = trustNav.getByRole("link", { name: "Privacy", exact: true });
    const aboutButton = trustNav.getByRole("button", { name: "About & licenses", exact: true });
    const supportLink = trustNav.getByRole("link", { name: /Support.*opens in a new tab/ });
    await assertVisible(trustNav, `${width}px first-run trust navigation`);
    await privacyLink.scrollIntoViewIfNeeded();
    await assertWithinViewport(privacyLink, width, `${width}px first-run privacy link`);
    await assertWithinViewport(aboutButton, width, `${width}px first-run About and licenses control`);
    await assertWithinViewport(supportLink, width, `${width}px first-run support link`);
    assert.equal(await privacyLink.getAttribute("href"), "/privacy");
    assert.equal(await supportLink.getAttribute("href"), "https://github.com/rangan39/sophon/issues");
    assert.equal(await supportLink.getAttribute("target"), "_blank");
    for (const [control, label] of [[privacyLink, "privacy"], [aboutButton, "About and licenses"], [supportLink, "support"]]) {
      const box = await control.boundingBox();
      assert.ok(box && box.width >= 24 && box.height >= 24, `${width}px first-run ${label} target is too small to operate: ${JSON.stringify(box)}`);
      await control.focus();
      assert.equal(await control.evaluate((element) => document.activeElement === element), true, `${width}px first-run ${label} control must accept keyboard focus.`);
    }
    await aboutButton.click();
    const responsiveAbout = activePage.getByRole("dialog", { name: "About Sophon", exact: true });
    await assertVisible(responsiveAbout, `${width}px About Sophon dialog`);
    await assertWithinViewport(responsiveAbout.getByTestId("acknowledgements-panel"), width, `${width}px About Sophon panel`);
    await responsiveAbout.getByTestId("acknowledgements-panel").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await assertTypographyRoles(responsiveAbout, `${width}px About Sophon dialog`);
    await activePage.keyboard.press("Escape");
    await responsiveAbout.waitFor({ state: "hidden", timeout: timeoutMs });
    assert.equal(await aboutButton.evaluate((element) => document.activeElement === element), true, `${width}px About dialog must restore first-run trigger focus.`);
    const responsiveWidths = await activePage.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth
    }));
    assert.ok(Math.max(responsiveWidths.body, responsiveWidths.document) <= responsiveWidths.viewport + 1, `${width}px first-run layout overflows horizontally: ${JSON.stringify(responsiveWidths)}`);
  }
  const hostedPrivacyPage = await desktopContext.newPage();
  await hostedPrivacyPage.goto(new URL("/privacy", url).toString(), { waitUntil: "domcontentloaded" });
  await hostedPrivacyPage.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await hostedPrivacyPage.getByRole("link", { name: "← Back to Sophon", exact: true }).getAttribute("href"), "/");
  assert.equal(await hostedPrivacyPage.getByRole("link", { name: /public support tracker.*opens in a new tab/ }).getAttribute("target"), "_blank");
  await hostedPrivacyPage.close();
  console.log("✓ First-run header, recommendation, CTA, and single-scroll reflow pass from 320px through desktop");
  await activePage.setViewportSize({ width: 1440, height: 900 });
  await assertVisible(firstRunPrimary, "first-run recommended-model action");
  assert.equal(await firstRunPrimary.isEnabled(), true, "The recommended model action must enable on a compatible browser.");
  assert.match((await firstRunPrimary.textContent()) ?? "", /Download/);
  await firstRunPrimary.click();
  const firstRunDownloadConfirmation = activePage.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true });
  await assertVisible(firstRunDownloadConfirmation, "first-run model download confirmation");
  await firstRunDownloadConfirmation.getByRole("button", { name: "Download model", exact: true }).click();
  await assertVisible(textarea, "labeled prompt textarea");
  assert.equal(await textarea.getAttribute("placeholder"), "Prompting unlocks when the model is ready...");
  assert.equal(await textarea.isDisabled(), true, "The prompt must remain disabled until the selected model is ready.");
  await activePage.locator("#prompt-error").waitFor({ state: "visible", timeout: timeoutMs });
  await assertVisible(resetButton, "conversation reset control after a failed model preload");
  assert.equal(await resetButton.isEnabled(), true, "Reset must recover the composer after a failed model preload.");
  await assertVisible(storageStatus, "browser storage status");
  await activePage.waitForFunction(() => document.querySelector('[data-testid="browser-storage"]')?.getAttribute("data-state") === "ready", undefined, { timeout: timeoutMs });
  assert.match((await storageStatus.textContent()) ?? "", /^\s*Browser storage · .+ \/ .+ · (Persistent|Best effort)\s*$/);
  assert.equal(await storageStatus.getAttribute("title"), null, "Browser storage must not expose a second native tooltip.");
  await assertVisible(modelLibrary.getByText("4 models", { exact: true }), "plain-language model count");
  await assertVisible(modelLibrary.getByText("3.35B · 4-bit · 8K context", { exact: true }), "plain-language model specifications");
  await assertVisible(modelLibrary.getByText("Non-commercial use", { exact: true }), "plain-language model usage label");

  const modelSpecsHint = modelLibrary.locator('[data-info-hint-trigger][aria-label="About model specifications"]');
  const webgpuHint = modelLibrary.locator('[data-info-hint-trigger][aria-label="About WebGPU"]');
  const modelUsageHint = modelLibrary.locator('[data-info-hint-trigger][aria-label="About model usage"]');
  const browserStorageHint = activePage.locator('[data-info-hint-trigger][aria-label="About browser storage"]');
  await assertInfoHintTrigger(modelSpecsHint, "modelSpecs", "model specifications InfoHint");
  await assertInfoHintTrigger(webgpuHint, "webgpu", "WebGPU InfoHint");
  await assertInfoHintTrigger(modelUsageHint, "modelLicense", "model usage InfoHint");
  await assertInfoHintTrigger(browserStorageHint, "browserStorage", "browser storage InfoHint");

  await modelSpecsHint.hover();
  const modelSpecsContent = activePage.locator('[data-slot="tooltip-content"][data-help-id="modelSpecs"]');
  await assertImmediatelyVisible(modelSpecsContent, "hovered model specifications tooltip");
  await assertTooltipContract(modelSpecsHint, modelSpecsContent, "model specifications tooltip");
  await assertCenteredAbove(modelSpecsHint, modelSpecsContent, "model specifications tooltip");
  assert.match((await modelSpecsContent.textContent()) ?? "", /3\.35B.+4-bit \(q4f16\).+8,192-token context window/s);
  await modelSpecsHint.click();
  await modelSpecsContent.waitFor({ state: "hidden", timeout: timeoutMs });
  await heading.hover();
  await modelSpecsHint.dispatchEvent("click");
  await activePage.waitForTimeout(100);
  assert.equal(await modelSpecsContent.isVisible(), false, "Click activation alone must not reveal an InfoHint.");

  await focusWithKeyboard(activePage, browserStorageHint, "browser storage InfoHint");
  assert.equal(await browserStorageHint.evaluate((element) => document.activeElement === element), true, "InfoHint must be keyboard focusable.");
  const browserStorageContent = activePage.locator('[data-slot="tooltip-content"][data-help-id="browserStorage"]');
  await assertImmediatelyVisible(browserStorageContent, "focus-opened browser storage tooltip");
  await assertTooltipContract(browserStorageHint, browserStorageContent, "browser storage tooltip");
  await assertCenteredAbove(browserStorageHint, browserStorageContent, "browser storage tooltip");
  await assertBoxWithinViewport(browserStorageContent, { width: 1440, height: 900 }, "browser storage tooltip");
  assert.match((await browserStorageContent.textContent()) ?? "", /estimated quota.+best effort data may be removed/is);
  await activePage.keyboard.press("Escape");
  await browserStorageContent.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await browserStorageHint.evaluate((element) => document.activeElement === element), true, "Escape must close an InfoHint without moving trigger focus.");
  await activePage.keyboard.press("Tab");
  await browserStorageContent.waitFor({ state: "hidden", timeout: timeoutMs });
  await focusWithKeyboard(activePage, browserStorageHint, "browser storage InfoHint after blur");
  await assertImmediatelyVisible(browserStorageContent, "refocused browser storage tooltip");
  await activePage.keyboard.press("Tab");
  await browserStorageContent.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await modelRadios.count(), 4, "Model library must expose exactly four native radio controls.");
  assert.equal(await sendButton.isDisabled(), true, "Send must be disabled for an empty prompt.");
  await assertVisible(resetButton, "conversation reset control");
  assert.equal(await resetButton.getAttribute("title"), "Reset conversation");
  assert.equal((await resetButton.textContent())?.trim(), "Reset", "Reset control must expose a visible action name.");
  assert.equal(await textarea.isDisabled(), true, "A failed model download must leave the prompt locked.");
  assert.equal(await textarea.inputValue(), "", "The locked prompt must not accept a draft.");
  assert.equal(await resetButton.isEnabled(), true, "Reset must recover the composer after a failed model preload.");
  await resetButton.press("Enter");
  assert.equal(await textarea.inputValue(), "", "Reset must clear the composer.");
  await resetButton.waitFor({ state: "detached", timeout: timeoutMs });
  assert.equal(await sendButton.isDisabled(), true, "Send must disable again when the prompt is cleared.");
  const toggleModels = modelLibrary.locator('button[aria-controls="model-library-desktop"]');
  assert.equal(await toggleModels.getAttribute("aria-label"), "Collapse model library");
  await toggleModels.click();
  assert.equal(await modelLibrary.getAttribute("data-state"), "collapsed");
  assert.equal(await toggleModels.getAttribute("aria-expanded"), "false");
  await activePage.waitForFunction(() => (document.querySelector("#model-library-desktop")?.getBoundingClientRect().width ?? Infinity) <= 80, undefined, { timeout: timeoutMs });
  assert.ok((await modelLibrary.boundingBox())?.width <= 80, "Collapsed model rail must remain compact.");
  await modelLibrary.getByRole("button", { name: "Expand model library", exact: true }).click();
  assert.equal(await modelLibrary.getAttribute("data-state"), "expanded");
  console.log("✓ Desktop semantics and composer gating pass");

  await activePage.setViewportSize({ width: 320, height: 568 });
  await assertVisible(textarea, "mobile prompt textarea");
  assert.equal(await textarea.isDisabled(), true, "The mobile prompt must remain locked until the model is ready.");
  await assertWithinViewport(textarea, 320, "mobile prompt textarea");
  const mobileTrigger = activePage.getByRole("button", { name: "Open model library", exact: true });
  await assertVisible(mobileTrigger, "mobile model-library trigger");
  await mobileTrigger.click();
  const mobileDialog = activePage.getByRole("dialog", { name: "Model library", exact: true });
  await assertVisible(mobileDialog, "mobile model-library sheet");
  assert.equal(await mobileTrigger.getAttribute("aria-expanded"), "true");
  assert.equal(await mobileDialog.getByRole("radio").count(), 4, "Mobile sheet must expose the same four models.");
  await assertWithinViewport(activePage.getByTestId("mobile-model-sheet"), 320, "mobile model-library sheet");
  await assertModelLibraryLayout(mobileDialog, { width: 320, height: 568 }, "mobile");
  await assertTypographyRoles(mobileDialog, "320px mobile model library");
  await activePage.setViewportSize({ width: 390, height: 844 });
  await assertModelLibraryLayout(mobileDialog, { width: 390, height: 844 }, "mobile");
  await activePage.setViewportSize({ width: 716, height: 900 });
  await assertModelLibraryLayout(mobileDialog, { width: 716, height: 900 }, "mobile");
  await activePage.setViewportSize({ width: 320, height: 800 });
  const mobileSpecsHint = mobileDialog.locator('[data-info-hint-trigger][aria-label="About model specifications"]');
  await assertInfoHintTrigger(mobileSpecsHint, "modelSpecs", "mobile model specifications InfoHint");
  await mobileSpecsHint.hover();
  const mobileSpecsContent = mobileDialog.locator('[data-slot="tooltip-content"][data-help-id="modelSpecs"]');
  await assertImmediatelyVisible(mobileSpecsContent, "mobile model specifications tooltip");
  await assertTooltipContract(mobileSpecsHint, mobileSpecsContent, "mobile model specifications tooltip");
  await assertAbove(mobileSpecsHint, mobileSpecsContent, "mobile model specifications tooltip");
  const mobileSpecsBox = await assertBoxWithinViewport(mobileSpecsContent, { width: 320, height: 800 }, "mobile model specifications tooltip");
  assert.ok(mobileSpecsBox.width <= 281, `Mobile InfoHint must stay within its 280px maximum width: ${JSON.stringify(mobileSpecsBox)}`);
  await mobileSpecsHint.click();
  await mobileSpecsContent.waitFor({ state: "hidden", timeout: timeoutMs });
  await activePage.keyboard.press("Escape");
  await mobileDialog.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await mobileTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(await mobileTrigger.evaluate((element) => document.activeElement === element), true, "Closing the mobile sheet must restore trigger focus.");
  await assertWithinViewport(aboutTrigger, 320, "mobile About Sophon control");
  await aboutTrigger.click();
  await assertWithinViewport(activePage.getByTestId("acknowledgements-panel"), 320, "mobile About Sophon dialog");
  await activePage.keyboard.press("Escape");
  await acknowledgements.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await aboutTrigger.evaluate((element) => document.activeElement === element), true, "Closing mobile About Sophon must restore trigger focus.");
  await assertWithinViewport(storageStatus, 320, "mobile browser storage status");
  const widths = await activePage.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  assert.ok(Math.max(widths.body, widths.document) <= widths.viewport + 1, `Mobile page overflows horizontally: ${JSON.stringify(widths)}`);
  console.log("✓ 320px mobile reflow has no horizontal overflow");

  await activePage.waitForTimeout(100);
  if (runtimeErrors.length > 0) throw new Error("Runtime browser errors were detected.");
  await desktopContext.close();

  const touchViewport = { width: 320, height: 800 };
  const touchContext = await browser.newContext({ hasTouch: true, viewport: touchViewport });
  activePage = await touchContext.newPage();
  captureRuntimeErrors(activePage);
  await openPage(activePage);

  const touchModelsTrigger = activePage.getByRole("button", { name: "Open model library", exact: true });
  for (let attempt = 0; attempt < 3 && await touchModelsTrigger.getAttribute("aria-expanded") !== "true"; attempt += 1) {
    await touchModelsTrigger.click();
    await activePage.waitForTimeout(100);
  }
  const touchModelsDialog = activePage.getByRole("dialog", { name: "Model library", exact: true });
  await assertVisible(touchModelsDialog, "touch model-library dialog");
  const touchSpecsHint = touchModelsDialog.locator('[data-info-hint-trigger][aria-label="About model specifications"]');
  await assertInfoHintTrigger(touchSpecsHint, "modelSpecs", "touch model specifications InfoHint");
  await touchSpecsHint.tap();
  await activePage.waitForTimeout(100);
  await assertNoVisibleInfoHint(activePage, "Tapping a model specifications InfoHint");
  const touchWidths = await activePage.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  assert.ok(Math.max(touchWidths.body, touchWidths.document) <= touchWidths.viewport + 1, `Touch layout overflows horizontally: ${JSON.stringify(touchWidths)}`);
  await assertVisible(touchModelsDialog, "model-library dialog after tapping its InfoHint");
  assert.equal(await touchModelsTrigger.getAttribute("aria-expanded"), "true", "Tapping an InfoHint must leave the mobile model library open.");
  await activePage.keyboard.press("Escape");
  await touchModelsDialog.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await touchModelsTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(await touchModelsTrigger.evaluate((element) => document.activeElement === element), true, "Closing the touch model library must restore trigger focus.");
  await touchContext.close();
  console.log("✓ InfoHints open immediately on hover/focus, ignore touch activation, and fit at 320px");

  const preloadContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let blockedModelRoute;
  let rejectModelRequests = false;
  let modelRequestTimeout;
  let resolveModelRequest;
  const modelRequest = new Promise((resolve) => { resolveModelRequest = resolve; });
  await preloadContext.route("https://**/*", (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.includes("onnx-community/tiny-aya-global-ONNX")) {
      resolveModelRequest(requestUrl);
      if (rejectModelRequests) {
        void route.abort("blockedbyclient");
        return;
      }
      blockedModelRoute = route;
      return;
    }
    void route.abort("blockedbyclient");
  });
  activePage = await preloadContext.newPage();
  await openPage(activePage);
  const preloadModels = activePage.getByRole("complementary", { name: "Model library", exact: true });
  const preloadGlobal = preloadModels.locator('[data-model-id="tiny-aya-global"]');
  const preloadSend = activePage.getByRole("button", { name: "Send message", exact: true });
  await preloadGlobal.waitFor({ state: "visible", timeout: timeoutMs });
  await activePage.waitForFunction(() => {
    const radios = [...document.querySelectorAll('[data-model-surface="desktop"] input[type="radio"]')];
    return radios.some((radio) => radio.value === "tiny-aya-global" && radio.getAttribute("aria-label")?.endsWith("Ready to download.") && !radio.disabled) && radios.every((radio) => !radio.checked);
  }, undefined, { timeout: timeoutMs });
  await preloadGlobal.click();
  await activePage.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true }).getByRole("button", { name: "Download model", exact: true }).click();
  const requestedModelUrl = await Promise.race([modelRequest, new Promise((_, reject) => { modelRequestTimeout = setTimeout(() => reject(new Error("Tiny Aya preload did not request its pinned repository.")), timeoutMs); })]);
  clearTimeout(modelRequestTimeout);
  assert.match(requestedModelUrl, /7fff1be9627e40f0d89c33f406882bdafb56ec90/);
  const loadingSelection = await preloadGlobal.getByRole("radio").evaluate((radio) => ({ checked: radio.checked, label: radio.getAttribute("aria-label"), value: radio.value }));
  assert.deepEqual(loadingSelection, { checked: true, label: "Choose Tiny Aya Global 3.35B · non-commercial. Best all-around · 70+ languages. ~2.35 GB download. Downloading.", value: "tiny-aya-global" });
  const progressBar = activePage.getByRole("progressbar", { name: "Loading Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(progressBar, "model download progress bar");
  assert.equal(await progressBar.getAttribute("aria-valuenow"), null, "Progress must remain indeterminate until byte totals arrive.");
  assert.equal(await preloadModels.locator('[data-model-id="tiny-aya-earth"] input').isEnabled(), true, "Other model radios must remain enabled so another selection can cancel the download.");
  const preloadPrompt = activePage.getByRole("textbox", { name: "Message Sophon", exact: true });
  assert.equal(await preloadPrompt.isDisabled(), true, "The prompt must remain disabled while the selected model downloads.");
  assert.equal(await preloadPrompt.inputValue(), "", "The disabled prompt must not accept text during download.");
  assert.equal(await preloadSend.isDisabled(), true, "Send must remain disabled while the selected model downloads.");
  rejectModelRequests = true;
  await blockedModelRoute.abort("blockedbyclient");
  await activePage.locator("#prompt-error").waitFor({ state: "visible", timeout: timeoutMs });
  await progressBar.waitFor({ state: "detached", timeout: timeoutMs });
  assert.equal(await preloadSend.isDisabled(), true, "A failed preload must keep generation gated until the model is ready.");
  await preloadContext.close();
  console.log("✓ Sidebar selection starts the pinned download and gates generation");

  const progressContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await progressContext.addInitScript(() => {
    const requests = [];
    const modelBytes = 2_354_413_407;
    const cacheModels = ["tiny-aya-global", "tiny-aya-earth", "tiny-aya-fire", "tiny-aya-water"].map((modelId) => ({ modelId, state: "missing", resumableBytes: 0, verifiedBytes: 0, totalBytes: modelBytes }));
    Object.defineProperty(window, "__sophonWorkerRequests", { value: requests });
    Object.defineProperty(window, "__storagePersistCalls", { value: 0, writable: true });
    Object.defineProperty(window, "confirm", { configurable: true, value: () => true });
    try {
      Object.defineProperty(navigator.storage, "persist", { configurable: true, value: async () => { window.__storagePersistCalls += 1; return true; } });
    } catch {}
    class FakeWorker {
      constructor() {
        this.onmessage = null;
        this.terminated = false;
      }
      postMessage(request) {
        requests.push(request);
        if (request.type === "capabilities") queueMicrotask(() => this.respond({ type: "complete", requestId: request.requestId, result: { webgpu: true, wasm: true, crossOriginIsolated: false } }));
        if (request.type === "cache-status") queueMicrotask(() => this.respond({ type: "complete", requestId: request.requestId, result: { models: cacheModels.map((model) => ({ ...model })) } }));
        if (request.type === "cancel") queueMicrotask(() => this.respond({ type: "complete", requestId: request.requestId, result: { cancelled: true, targetRequestId: request.targetRequestId } }));
        if (request.type === "delete-cache") queueMicrotask(() => {
          const cache = cacheModels.find((model) => model.modelId === request.modelId);
          if (cache) Object.assign(cache, { state: "missing", resumableBytes: 0, verifiedBytes: 0 });
          this.respond({ type: "complete", requestId: request.requestId, result: { modelId: request.modelId, deleted: true } });
        });
        if (request.type === "generate") queueMicrotask(() => this.respond({
          type: "complete",
          requestId: request.requestId,
          result: {
            ok: true,
            result: {
              generatedText: "Fixture response",
              inputTokens: [
                { id: 101, text: "Token", inContext: false },
                { id: 102, text: " lens", inContext: true },
                { id: 103, text: " fixture", inContext: true }
              ],
              generatedTokens: [
                { id: 201, text: "Fixture" },
                { id: 202, text: " response" }
              ],
              outputTokenCount: 2,
              metrics: {
                provider: "webgpu",
                modelLoadMs: 0,
                endToEndMs: 320,
                ttftMs: 120,
                decodeMs: 200,
                decodeTokensPerSecond: 5,
                timePerOutputTokenMs: 200,
                p95InterTokenLatencyMs: 200,
                promptTokenCount: 3,
                contextTokenCount: 2,
                truncatedInputTokens: 1,
                outputTokenCount: 2
              }
            }
          }
        }));
        if (request.type === "preload") queueMicrotask(() => {
          const cache = cacheModels.find((model) => model.modelId === request.modelId);
          if (cache) Object.assign(cache, { state: "partial", resumableBytes: 64 * 1024 * 1024, verifiedBytes: 0 });
          this.respond({ type: "log", requestId: request.requestId, event: { level: "info", message: "Loading model", phase: "download", progress: { loaded: 25, total: 100 } } });
          window.__setDownloadProgress = (progress) => this.respond({ type: "log", requestId: request.requestId, event: { level: "info", message: "Loading model", phase: "download", progress } });
          window.__finishPreload = () => {
            if (cache) Object.assign(cache, { state: "cached", resumableBytes: modelBytes, verifiedBytes: modelBytes });
            this.respond({ type: "complete", requestId: request.requestId, result: { ok: true } });
          };
        });
      }
      respond(data) {
        if (!this.terminated) this.onmessage?.({ data });
      }
      terminate() {
        this.terminated = true;
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: FakeWorker });
  });
  activePage = await progressContext.newPage();
  await openPage(activePage);
  const progressGlobal = activePage.locator('[data-model-surface="desktop"][data-model-id="tiny-aya-global"]');
  await activePage.waitForFunction(() => document.querySelector('[data-model-surface="desktop"] input[value="tiny-aya-global"]')?.getAttribute("aria-label")?.endsWith("Ready to download."), undefined, { timeout: timeoutMs });
  assert.equal((await activePage.evaluate(() => window.__sophonWorkerRequests)).some((request) => request.type === "preload"), false, "Capability probing must not preload a model.");
  await progressGlobal.click();
  await activePage.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true }).getByRole("button", { name: "Download model", exact: true }).click();
  await activePage.waitForFunction(() => window.__storagePersistCalls === 1, undefined, { timeout: timeoutMs });
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.some((request) => request.type === "preload" && request.modelId === "tiny-aya-global"), undefined, { timeout: timeoutMs });
  const determinateProgress = activePage.getByRole("progressbar", { name: "Loading Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(determinateProgress, "determinate model download progress bar");
  assert.equal(await determinateProgress.getAttribute("aria-valuenow"), "25");
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "25 B of 100 B loaded");
  await activePage.evaluate(() => window.__setDownloadProgress({ loaded: 50, total: 100, stage: "resume", resumedBytes: 25, networkBytes: 25, bytesPerSecond: 20, etaMs: 2500 }));
  await activePage.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "50", undefined, { timeout: timeoutMs });
  assert.match((await activePage.locator("#prompt-help").textContent())?.trim() ?? "", /^Resuming model · /);
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "50 B of 100 B loaded, including 25 B resumed");
  assert.match(await progressGlobal.getByRole("radio").getAttribute("aria-label") ?? "", /\. Resuming 50%\.$/);
  const pauseDownload = activePage.getByRole("button", { name: "Pause model download", exact: true });
  await assertVisible(pauseDownload, "model download pause control");
  await pauseDownload.click();
  await determinateProgress.waitFor({ state: "detached", timeout: timeoutMs });
  await activePage.getByText("Model download paused", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.some((request) => request.type === "cancel" && request.targetRequestId), undefined, { timeout: timeoutMs });
  assert.equal(await progressGlobal.getByRole("radio").isChecked(), true, "Pausing must retain the selected model and the user's draft.");
  const partialDelete = activePage.getByRole("button", { name: "Delete downloaded files for Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(partialDelete, "partial model deletion control");
  assert.match(await progressGlobal.getByRole("radio").getAttribute("aria-label") ?? "", /64 MB saved/);
  await activePage.getByRole("button", { name: "Resume model download", exact: true }).click();
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.filter((request) => request.type === "preload" && request.modelId === "tiny-aya-global").length === 2, undefined, { timeout: timeoutMs });
  await assertVisible(determinateProgress, "resumed model download progress bar");
  await activePage.evaluate(() => window.__setDownloadProgress({ loaded: 80, total: 100, stage: "verify" }));
  await activePage.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "80", undefined, { timeout: timeoutMs });
  assert.match((await activePage.locator("#prompt-help").textContent())?.trim() ?? "", /^Verifying model · /);
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "80 B of 100 B verified");
  await activePage.evaluate(() => window.__setDownloadProgress({ loaded: 100, total: 100, stage: "cache" }));
  await activePage.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "100", undefined, { timeout: timeoutMs });
  assert.match((await activePage.locator("#prompt-help").textContent())?.trim() ?? "", /^Loading downloaded model · /);
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "100 B of 100 B loaded from browser storage");
  assert.equal((await activePage.evaluate(() => window.__sophonWorkerRequests)).some((request) => request.type === "generate"), false);
  await activePage.evaluate(() => window.__finishPreload());
  await determinateProgress.waitFor({ state: "detached", timeout: timeoutMs });
  await activePage.getByText("Model ready", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });

  await activePage.getByRole("textbox", { name: "Message Sophon", exact: true }).fill("Token lens fixture");
  await activePage.getByRole("button", { name: "Send message", exact: true }).click();
  const userFixtureMessage = activePage.getByRole("article", { name: "Message from you", exact: true }).filter({ hasText: "Token lens fixture" });
  const assistantFixtureMessage = activePage.getByRole("article", { name: "Message from Sophon", exact: true }).filter({ hasText: "Fixture response" });
  await assertVisible(userFixtureMessage, "generated fixture user message");
  await assertVisible(assistantFixtureMessage, "generated fixture assistant message");
  assert.equal(await assistantFixtureMessage.getByText(/5\.0 tokens\/s/).count(), 0, "Chat mode must hide response metrics.");
  assert.equal(await userFixtureMessage.getByRole("button", { name: "Inspect 3 message tokens", exact: true }).count(), 0, "Chat mode must hide token inspection.");
  const interfaceModeToggle = activePage.getByTestId("interface-mode-toggle");
  await assertVisible(interfaceModeToggle, "interface-mode toggle");
  assert.equal(await interfaceModeToggle.getAttribute("data-mode"), "chat", "Chat mode must be the default.");
  assert.equal(await interfaceModeToggle.getAttribute("aria-label"), "Switch to developer mode. Chat mode is active");
  assert.equal((await interfaceModeToggle.textContent())?.trim(), "Developer", "Chat mode must offer Developer mode.");
  await interfaceModeToggle.click();
  assert.equal(await interfaceModeToggle.getAttribute("data-mode"), "developer", "The interface must switch to Developer mode.");
  assert.equal(await interfaceModeToggle.getAttribute("aria-label"), "Switch to chat mode. Developer mode is active");
  assert.equal((await interfaceModeToggle.textContent())?.trim(), "Chat", "Developer mode must offer Chat mode.");
  await assertVisible(assistantFixtureMessage.getByText("WebGPU · 2/3 → 2 tokens · 5.0 tokens/s · first token 120 ms · 1 earlier tokens omitted", { exact: true }), "plain-language response metrics");
  await userFixtureMessage.getByRole("button", { name: "Inspect 3 message tokens", exact: true }).click();
  await assistantFixtureMessage.getByRole("button", { name: "Inspect 2 message tokens", exact: true }).click();

  const metricsHint = assistantFixtureMessage.locator('[data-info-hint-trigger][aria-label="About response metrics"]');
  const userTokenHint = userFixtureMessage.locator('[data-info-hint-trigger][aria-label="About token display"]');
  const assistantTokenHint = assistantFixtureMessage.locator('[data-info-hint-trigger][aria-label="About token display"]');
  await assertInfoHintTrigger(metricsHint, "generationMetrics", "response metrics InfoHint");
  await assertInfoHintTrigger(userTokenHint, "tokenLens", "user token display InfoHint");
  await assertInfoHintTrigger(assistantTokenHint, "tokenLens", "assistant token display InfoHint");

  await focusWithKeyboard(activePage, metricsHint, "response metrics InfoHint");
  const metricsContent = activePage.locator('[data-slot="tooltip-content"][data-help-id="generationMetrics"]');
  await assertImmediatelyVisible(metricsContent, "focus-opened response metrics tooltip");
  await assertTooltipContract(metricsHint, metricsContent, "response metrics tooltip");
  await assertCenteredAbove(metricsHint, metricsContent, "response metrics tooltip");
  assert.match((await metricsContent.textContent()) ?? "", /Input → output.+tokens\/s.+TTFT.+omitted to fit the context/s);
  await activePage.keyboard.press("Escape");
  await metricsContent.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await metricsHint.evaluate((element) => document.activeElement === element), true, "Escape must dismiss a response metrics tooltip without moving focus.");

  await assistantTokenHint.hover();
  const tokenLensContent = activePage.locator('[data-slot="tooltip-content"][data-help-id="tokenLens"]');
  await assertImmediatelyVisible(tokenLensContent, "hovered token display tooltip");
  await assertTooltipContract(assistantTokenHint, tokenLensContent, "token display tooltip");
  await assertCenteredAbove(assistantTokenHint, tokenLensContent, "token display tooltip");
  assert.match((await tokenLensContent.textContent()) ?? "", /Tokens shows the model pieces and IDs.+Words groups them.+Outside context/s);
  await activePage.getByRole("heading", { name: "SOPHON", exact: true }).hover();
  await tokenLensContent.waitFor({ state: "hidden", timeout: timeoutMs });
  await userFixtureMessage.getByRole("button", { name: "tokens", exact: true }).click();
  await assertVisible(userFixtureMessage.getByRole("toolbar", { name: /3 inspectable token segments/ }), "user token toolbar");
  assert.equal(await userFixtureMessage.locator('[data-context="omitted"]').count(), 1, "The token lens must preserve outside-context state.");
  await assistantFixtureMessage.getByRole("button", { name: "tokens", exact: true }).click();
  await assertVisible(assistantFixtureMessage.getByRole("toolbar", { name: /2 inspectable token segments/ }), "assistant token toolbar");
  await interfaceModeToggle.click();
  assert.equal(await interfaceModeToggle.getAttribute("data-mode"), "chat", "The interface must switch back to Chat mode.");
  assert.equal(await activePage.locator('[role="toolbar"][aria-label*="inspectable token segments"]').count(), 0, "Chat mode must close open token inspectors.");
  assert.equal(await assistantFixtureMessage.getByText(/5\.0 tokens\/s/).count(), 0, "Chat mode must hide response metrics after switching back.");

  const deleteCached = activePage.getByRole("button", { name: "Delete downloaded files for Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(deleteCached, "downloaded model deletion control");
  await deleteCached.click();
  const deleteConfirmation = activePage.getByRole("dialog", { name: "Delete downloaded model?", exact: true });
  await assertVisible(deleteConfirmation, "downloaded model deletion confirmation");
  await deleteConfirmation.getByRole("button", { name: "Delete files", exact: true }).click();
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.some((request) => request.type === "delete-cache" && request.modelId === "tiny-aya-global"), undefined, { timeout: timeoutMs });
  await activePage.waitForFunction(() => document.querySelector('[data-model-surface="desktop"] input[value="tiny-aya-global"]')?.getAttribute("aria-label")?.endsWith("Ready to download."), undefined, { timeout: timeoutMs });
  await progressContext.close();
  console.log("✓ Aggregate progress, pause/resume, cache inventory, and deletion controls pass");

  const fallbackContext = await browser.newContext({ viewport: { width: 320, height: 800 } });
  await fallbackContext.addInitScript(() => Object.defineProperty(Navigator.prototype, "storage", { configurable: true, get: () => undefined }));
  await fallbackContext.route("https://**/*", (route) => route.abort("blockedbyclient"));
  activePage = await fallbackContext.newPage();
  captureRuntimeErrors(activePage);
  await openPage(activePage);
  const fallbackPrimary = activePage.getByTestId("first-run-primary");
  await fallbackPrimary.waitFor({ state: "visible", timeout: timeoutMs });
  await activePage.waitForFunction(() => document.querySelector('[data-testid="first-run-primary"]')?.disabled === false, undefined, { timeout: timeoutMs });
  await fallbackPrimary.click();
  await activePage.getByRole("dialog", { name: "Download Tiny Aya Global 3.35B?", exact: true }).getByRole("button", { name: "Download model", exact: true }).click();
  const fallbackStorage = activePage.getByTestId("browser-storage");
  await assertVisible(fallbackStorage, "unavailable browser storage status");
  await activePage.waitForFunction(() => document.querySelector('[data-testid="browser-storage"]')?.getAttribute("data-state") === "unavailable", undefined, { timeout: timeoutMs });
  assert.match((await fallbackStorage.textContent()) ?? "", /Browser storage · Unavailable/);
  if (runtimeErrors.length > 0) throw new Error("Runtime browser errors were detected.");
  await fallbackContext.close();
  console.log("✓ Browser storage fallback handles unsupported browsers");
  console.log(`UI smoke test passed: ${url}`);
} catch (error) {
  const screenshotPath = "/tmp/sophon-smoke-ui-failure.png";
  await activePage?.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  if (runtimeErrors.length > 0) console.error(`\nRuntime browser errors:\n${runtimeErrors.join("\n")}`);
  console.error(`\nScreenshot: ${screenshotPath}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
}

async function openPage(page) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  assert.ok(response?.ok(), `Expected a successful response from ${url}, received ${response?.status() ?? "no response"}.`);
}

async function assertVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await locator.count(), 1, `Expected exactly one ${label}.`);
  assert.equal(await locator.isVisible(), true, `Expected ${label} to be visible.`);
}

async function assertInfoHintTrigger(locator, concept, label) {
  await assertVisible(locator, label);
  assert.equal(await locator.evaluate((element) => element.tagName), "SPAN", `${label} must be a non-clickable span.`);
  assert.equal(await locator.getAttribute("tabindex"), "0", `${label} must remain keyboard focusable.`);
  assert.equal(await locator.getAttribute("data-help-id"), concept);
  assert.equal(await locator.getAttribute("aria-haspopup"), null, `${label} must not expose a popover contract.`);
  assert.equal(await locator.getAttribute("aria-expanded"), null, `${label} must not expose expandable state.`);
  assert.equal(await locator.locator('svg[aria-hidden="true"]').count(), 1, `${label} icon must stay out of the accessibility tree.`);
}

async function focusWithKeyboard(page, locator, label) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  assert.equal(await locator.evaluate((element) => document.activeElement === element), true, `Expected keyboard focus on ${label}.`);
}

async function assertImmediatelyVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 200 });
  assert.equal(await locator.count(), 1, `Expected exactly one ${label}.`);
}

async function assertTooltipContract(trigger, tooltip, label) {
  assert.equal(await tooltip.getAttribute("role"), "tooltip", `${label} must expose tooltip semantics.`);
  assert.equal(await trigger.getAttribute("aria-describedby"), await tooltip.getAttribute("id"), `${label} must describe its trigger.`);
  assert.equal(await trigger.getAttribute("aria-haspopup"), null, `${label} trigger must not expose aria-haspopup.`);
  assert.equal(await trigger.getAttribute("aria-expanded"), null, `${label} trigger must not expose aria-expanded.`);
}

async function assertCenteredAbove(trigger, tooltip, label) {
  const triggerBox = await trigger.boundingBox();
  const tooltipBox = await tooltip.boundingBox();
  assert.ok(triggerBox && tooltipBox, `Expected measurable ${label} geometry.`);
  const triggerCenter = triggerBox.x + triggerBox.width / 2;
  const tooltipCenter = tooltipBox.x + tooltipBox.width / 2;
  assert.ok(Math.abs(triggerCenter - tooltipCenter) <= 2, `${label} is not horizontally centered above its icon: ${JSON.stringify({ triggerBox, tooltipBox })}`);
  assert.ok(tooltipBox.y + tooltipBox.height <= triggerBox.y + 1, `${label} is not above its icon: ${JSON.stringify({ triggerBox, tooltipBox })}`);
}

async function assertAbove(trigger, tooltip, label) {
  const triggerBox = await trigger.boundingBox();
  const tooltipBox = await tooltip.boundingBox();
  assert.ok(triggerBox && tooltipBox, `Expected measurable ${label} geometry.`);
  assert.ok(tooltipBox.y + tooltipBox.height <= triggerBox.y + 1, `${label} is not above its icon: ${JSON.stringify({ triggerBox, tooltipBox })}`);
}

async function assertNoVisibleInfoHint(page, action) {
  const visibleTooltips = page.locator('[data-slot="tooltip-content"]:visible');
  assert.equal(await visibleTooltips.count(), 0, `${action} must not reveal a tooltip.`);
}

async function assertWithinViewport(locator, viewportWidth, label) {
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= viewportWidth + 1, `${label} is outside the ${viewportWidth}px viewport: ${JSON.stringify(box)}`);
}

async function assertBoxWithinViewport(locator, viewport, label) {
  const box = await locator.boundingBox();
  assert.ok(
    box
      && box.x >= -1
      && box.y >= -1
      && box.x + box.width <= viewport.width + 1
      && box.y + box.height <= viewport.height + 1,
    `${label} is outside the ${viewport.width}×${viewport.height}px viewport: ${JSON.stringify(box)}`
  );
  return box;
}

async function assertTypographyRoles(root, label) {
  const roles = await root.locator('[data-typography-role]:visible').evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    const rgbaAlpha = style.color.match(/^rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([0-9.]+))?\)$/)?.[1];
    const modernAlpha = style.color.match(/\/\s*([0-9.]+)\s*\)$/)?.[1];
    let effectiveOpacity = 1;
    for (let current = element; current; current = current.parentElement) {
      effectiveOpacity *= Number.parseFloat(getComputedStyle(current).opacity);
    }
    return {
      color: style.color,
      colorAlpha: Number(rgbaAlpha ?? modernAlpha ?? 1),
      effectiveOpacity,
      fontSize: Number.parseFloat(style.fontSize),
      role: element.getAttribute("data-typography-role"),
      text: element.innerText.trim().slice(0, 100)
    };
  }));
  assert.ok(roles.length > 0, `${label} must expose semantic typography roles.`);
  for (const role of roles) {
    const minimum = role.role === "decorative" ? 11 : role.role === "body" ? 14 : 12;
    assert.ok(role.fontSize >= minimum, `${label} ${role.role} copy is ${role.fontSize}px, below its ${minimum}px floor: ${JSON.stringify(role)}`);
    assert.equal(role.colorAlpha, 1, `${label} ${role.role} copy uses a translucent foreground: ${JSON.stringify(role)}`);
    assert.equal(role.effectiveOpacity, 1, `${label} ${role.role} copy is dimmed by component opacity: ${JSON.stringify(role)}`);
  }
}

async function assertFirstRunLayout(page, viewport) {
  const layout = await page.evaluate(() => {
    const measure = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        bottom: box.bottom,
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        display: style.display,
        height: box.height,
        left: box.left,
        overflowY: style.overflowY,
        right: box.right,
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        top: box.top,
        visibility: style.visibility,
        width: box.width
      };
    };
    const select = (selector) => document.querySelector(selector);
    const header = select('[data-testid="workbench-header"]');
    const brand = select('[data-testid="workbench-brand"]');
    const actions = select('[data-testid="workbench-actions"]');
    const status = select('[data-testid="workbench-status"]');
    const about = header?.querySelector('button[aria-haspopup="dialog"]');
    const models = select('[data-testid="open-model-library"]');
    const recommended = select('[data-testid="first-run-recommended"]');
    const icon = select('[data-testid="first-run-recommended-icon"]');
    const details = select('[data-testid="first-run-recommended-details"]');
    const primary = select('[data-testid="first-run-primary"]');
    const conversationScroll = select('[data-testid="conversation-scroll"]');
    const footer = select('[data-testid="first-run-trust-nav"]');
    const scrollableAncestors = [];
    for (let ancestor = footer?.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const overflowY = getComputedStyle(ancestor).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && ancestor.scrollHeight > ancestor.clientHeight + 1) {
        scrollableAncestors.push({
          className: typeof ancestor.className === "string" ? ancestor.className : "",
          clientHeight: ancestor.clientHeight,
          scrollHeight: ancestor.scrollHeight
        });
      }
    }
    return {
      about: measure(about),
      actions: measure(actions),
      brand: measure(brand),
      conversationScroll: measure(conversationScroll),
      details: measure(details),
      document: {
        clientHeight: document.documentElement.clientHeight,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth
      },
      footer: measure(footer),
      header: measure(header),
      icon: measure(icon),
      main: measure(document.querySelector("main")),
      models: measure(models),
      modelsText: models?.innerText.trim() ?? "",
      primary: measure(primary),
      primaryAccessibleName: primary?.getAttribute("aria-label") ?? "",
      recommended: measure(recommended),
      scrollableAncestors,
      status: measure(status),
      statusText: status?.innerText.trim() ?? ""
    };
  });

  const isRendered = (box) => box && box.display !== "none" && box.visibility !== "hidden" && box.width > 0 && box.height > 0;
  const isInsideHorizontally = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const label = `${viewport.width}×${viewport.height}`;

  assert.ok(isRendered(layout.header), `${label} workbench header must render.`);
  assert.ok(isRendered(layout.brand), `${label} branding must render.`);
  assert.ok(isRendered(layout.actions), `${label} header actions must render.`);
  assert.ok(isRendered(layout.status), `${label} runtime status must render.`);
  assert.ok(isRendered(layout.about), `${label} About control must render.`);
  assert.ok(isInsideHorizontally(layout.brand, layout.header), `${label} branding leaves the header: ${JSON.stringify(layout.brand)}`);
  assert.ok(isInsideHorizontally(layout.actions, layout.header), `${label} actions leave the header: ${JSON.stringify(layout.actions)}`);
  assert.ok(isInsideHorizontally(layout.status, layout.header), `${label} status leaves the header: ${JSON.stringify(layout.status)}`);
  assert.ok(isInsideHorizontally(layout.about, layout.header), `${label} About control leaves the header: ${JSON.stringify(layout.about)}`);
  assert.equal(overlaps(layout.brand, layout.actions), false, `${label} branding and actions overlap: ${JSON.stringify({ brand: layout.brand, actions: layout.actions })}`);
  assert.notEqual(layout.statusText, "", `${label} runtime status must remain understandable.`);

  if (viewport.width < 1024) {
    assert.ok(isRendered(layout.models), `${label} Models control must render.`);
    assert.ok(isInsideHorizontally(layout.models, layout.header), `${label} Models control leaves the header: ${JSON.stringify(layout.models)}`);
    assert.equal(layout.modelsText, "Models", `${label} Models control must keep a visible text label.`);
    assert.equal(overlaps(layout.about, layout.models), false, `${label} About and Models controls overlap.`);
  } else {
    assert.equal(layout.models?.display, "none", `${label} mobile Models control should yield to the desktop model library.`);
  }

  assert.ok(isRendered(layout.recommended) && isRendered(layout.icon) && isRendered(layout.details) && isRendered(layout.primary), `${label} recommended-model content must render.`);
  for (const [name, box] of [["icon", layout.icon], ["details", layout.details], ["primary CTA", layout.primary]]) {
    assert.ok(isInsideHorizontally(box, layout.recommended), `${label} recommended-model ${name} leaves its container: ${JSON.stringify({ box, recommended: layout.recommended })}`);
  }
  assert.ok(layout.icon.width >= 43 && layout.icon.height >= 43, `${label} recommended-model icon was squeezed: ${JSON.stringify(layout.icon)}`);
  assert.equal(overlaps(layout.icon, layout.details), false, `${label} recommended icon overlaps its details.`);
  assert.equal(overlaps(layout.icon, layout.primary), false, `${label} recommended icon overlaps its CTA.`);
  assert.equal(overlaps(layout.details, layout.primary), false, `${label} recommended details overlap its CTA.`);
  assert.ok(layout.primary.scrollWidth <= layout.primary.clientWidth + 1 && layout.primary.scrollHeight <= layout.primary.clientHeight + 1, `${label} primary CTA label is clipped: ${JSON.stringify(layout.primary)}`);
  assert.equal(layout.primaryAccessibleName, "Download recommended model", `${label} responsive CTA copy must preserve the full accessible name.`);

  assert.equal(layout.conversationScroll?.overflowY, "visible", `${label} first-run onboarding must not use an internal conversation scroller.`);
  assert.deepEqual(layout.scrollableAncestors, [], `${label} first-run content has a nested vertical scroll trap: ${JSON.stringify(layout.scrollableAncestors)}`);
  assert.ok(layout.footer?.bottom <= layout.document.scrollHeight + 1, `${label} first-run footer is not reachable through document scrolling: ${JSON.stringify({ footer: layout.footer, document: layout.document })}`);
  assert.ok(layout.document.scrollWidth <= layout.document.clientWidth + 1, `${label} page requires horizontal scrolling: ${JSON.stringify(layout.document)}`);
  if (viewport.height <= 844) {
    assert.ok(layout.document.scrollHeight > layout.document.clientHeight, `${label} overflowing first-run content must expose the document scroll path.`);
    assert.ok(layout.main?.height >= layout.document.scrollHeight - 1, `${label} the page shell clips first-run content: ${JSON.stringify({ main: layout.main, document: layout.document })}`);
  }
}

async function assertModelLibraryLayout(library, viewport, surface) {
  const list = library.getByTestId(surface === "desktop" ? "desktop-model-list" : "mobile-model-list");
  await assertVisible(list, `${viewport.width}px ${surface} model list`);
  const cards = library.locator(`[data-model-surface="${surface}"]`);
  const retiredOfflineActions = library.locator('button[aria-label*="offline file"]');
  assert.equal(await cards.count(), 4, `${viewport.width}px ${surface} model list must render four cards.`);
  assert.equal(await retiredOfflineActions.count(), 0, `${viewport.width}px ${surface} model list must not expose the retired offline-file import.`);

  const contentGeometry = await library.locator("[data-model-card]").evaluateAll((nodes) => nodes.map((card) => {
    const cardBox = card.getBoundingClientRect();
    const fields = ["[data-model-name]", "[data-model-recommendation]", "[data-model-description]", "[data-model-status]"]
      .map((selector) => card.querySelector(selector))
      .filter(Boolean)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          selector: element.hasAttribute("data-model-name")
            ? "name"
            : element.hasAttribute("data-model-recommendation")
              ? "recommendation"
              : element.hasAttribute("data-model-description")
                ? "description"
                : "status",
          clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
          insideCard: box.left >= cardBox.left - 1 && box.right <= cardBox.right + 1
        };
      });
    return { fields };
  }));
  assert.equal(contentGeometry.length, 4, `${viewport.width}px ${surface} model list must expose four measurable cards.`);
  assert.equal(contentGeometry.flatMap(({ fields }) => fields).filter(({ clipped, insideCard }) => clipped || !insideCard).length, 0, `${viewport.width}px ${surface} model text or badges are clipped: ${JSON.stringify(contentGeometry)}`);

  if (surface === "desktop" && viewport.width === 1440 && viewport.height === 900) {
    const verticalGeometry = await library.evaluate((element) => {
      const listElement = element.querySelector('[data-testid="desktop-model-list"]');
      const footer = element.querySelector("footer");
      if (!listElement || !footer) return null;
      const listBox = listElement.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      const cards = [...element.querySelectorAll("[data-model-card]")].map((card) => {
        const box = card.getBoundingClientRect();
        return {
          bottom: box.bottom,
          top: box.top,
          fields: ["[data-model-name]", "[data-model-description]", "[data-model-status]"].map((selector) => {
            const field = card.querySelector(selector);
            const fieldBox = field?.getBoundingClientRect();
            return { bottom: fieldBox?.bottom ?? Infinity, selector, top: fieldBox?.top ?? -Infinity };
          })
        };
      });
      return {
        cards,
        footer: { bottom: footerBox.bottom, top: footerBox.top },
        library: element.getBoundingClientRect().toJSON(),
        list: { bottom: listBox.bottom, clientHeight: listElement.clientHeight, scrollHeight: listElement.scrollHeight, scrollTop: listElement.scrollTop, top: listBox.top }
      };
    });
    assert.ok(verticalGeometry, "Desktop model-library geometry must be measurable.");
    assert.equal(verticalGeometry.list.scrollTop, 0, "Desktop model-library comparison must begin at the top of the list.");
    assert.ok(verticalGeometry.list.clientHeight > 0, `Desktop model list has no usable height: ${JSON.stringify(verticalGeometry)}`);
    assert.ok(verticalGeometry.cards.every((card) => card.top >= verticalGeometry.list.top - 1 && card.bottom <= verticalGeometry.list.bottom + 1), `All four desktop model cards must be initially visible at 1440×900: ${JSON.stringify(verticalGeometry)}`);
    assert.ok(verticalGeometry.cards.flatMap((card) => card.fields).every((field) => field.top >= verticalGeometry.list.top - 1 && field.bottom <= verticalGeometry.list.bottom + 1), `All model names, descriptions, and statuses must be initially visible at 1440×900: ${JSON.stringify(verticalGeometry)}`);
    assert.ok(verticalGeometry.footer.top >= verticalGeometry.list.bottom - 1 && verticalGeometry.footer.bottom <= verticalGeometry.library.bottom + 1, `The model specification footer must remain visible without overlapping the list: ${JSON.stringify(verticalGeometry)}`);
  }

  const overflow = await library.evaluate((element) => {
    const listElement = element.querySelector('[data-testid$="-model-list"]');
    const clippedInteractiveContainers = [element, ...element.querySelectorAll("*")]
      .filter((candidate) => candidate.querySelector("button, input"))
      .filter((candidate) => {
        const overflowX = getComputedStyle(candidate).overflowX;
        return (overflowX === "hidden" || overflowX === "clip") && candidate.scrollWidth > candidate.clientWidth + 1;
      })
      .map((candidate) => ({
        className: typeof candidate.className === "string" ? candidate.className : "",
        clientWidth: candidate.clientWidth,
        scrollWidth: candidate.scrollWidth
      }));
    return {
      listClientWidth: listElement?.clientWidth ?? 0,
      listScrollWidth: listElement?.scrollWidth ?? 0,
      clippedInteractiveContainers
    };
  });
  assert.ok(overflow.listClientWidth > 0 && overflow.listScrollWidth <= overflow.listClientWidth + 1, `${viewport.width}px ${surface} model list overflows horizontally: ${JSON.stringify(overflow)}`);
  assert.deepEqual(overflow.clippedInteractiveContainers, [], `${viewport.width}px ${surface} model controls are hidden by horizontal clipping.`);
}

function captureRuntimeErrors(page) {
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
}
