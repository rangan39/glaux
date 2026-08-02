import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const expectedCspDirectives = [
  "default-src 'self'",
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.xethub.hf.co",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class ProductTestWorkerGuard {
        constructor() {
          throw new Error("Product-test fixtures must not construct a model worker.");
        }
      }
    });
  });
});

test("serves production security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  const headers = response.headers();
  const policy = headers["content-security-policy-report-only"] ?? "";
  for (const directive of expectedCspDirectives) expect(policy).toContain(directive);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
});

for (const state of ["checking", "ready", "error"] as const) {
  test(`${state} product state has no automated WCAG A/AA violations`, async ({ page }) => {
    await page.goto(`/?sophon-product-test=${state}`);
    await expect(page.locator(`main[data-product-test-state="${state}"]`)).toBeVisible();
    // Axe must inspect the settled interface, not a transient opacity frame from the entrance animation.
    await page.waitForTimeout(750);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test("confirmation dialogs trap focus and close from the keyboard", async ({ page }) => {
  await page.goto("/?sophon-product-test=confirmation");

  const dialog = page.getByRole("alertdialog", { name: "Download Fixture A?" });
  const cancel = dialog.getByRole("button", { name: "Not now" });
  const confirm = dialog.getByRole("button", { name: "Download" });

  await expect(dialog).toBeVisible();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
