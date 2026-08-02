import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

type RuntimeCapabilities = {
  webgpu: boolean;
  wasm: boolean;
  crossOriginIsolated: boolean;
  browserEngine: "chromium" | "webkit" | "gecko" | "unknown";
  hardwareTier: "mobile" | "desktop";
  maxStorageBufferBindingSize: number | null;
};

async function readCapabilities(page: Page) {
  await page.goto("/product-test/runtime-capabilities");
  const output = page.getByTestId("runtime-capabilities");
  await expect(output).not.toHaveText("probing");
  return JSON.parse(await output.innerText()) as RuntimeCapabilities;
}

test("falls back to the default adapter in every browser engine", async ({ page, browserName, isMobile }) => {
  await page.addInitScript(() => {
    const requests: Array<{ powerPreference?: string } | undefined> = [];
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: async (options?: { powerPreference?: string }) => {
          requests.push(options);
          (globalThis as typeof globalThis & { __adapterRequests?: typeof requests }).__adapterRequests = requests;
          return options ? null : { limits: { maxStorageBufferBindingSize: 67_108_864 } };
        }
      }
    });
  });

  const capabilities = await readCapabilities(page);
  expect(capabilities.webgpu).toBe(true);
  expect(capabilities.maxStorageBufferBindingSize).toBe(67_108_864);
  expect(capabilities.browserEngine).toBe(browserName === "firefox" ? "gecko" : browserName);
  expect(capabilities.hardwareTier).toBe(isMobile ? "mobile" : "desktop");
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __adapterRequests?: unknown[] }).__adapterRequests)).toEqual([
    { powerPreference: "high-performance" },
    undefined
  ]);
});

test("recovers when the preferred adapter request rejects", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: async (options?: { powerPreference?: string }) => {
          if (options) throw new DOMException("Unsupported preference", "NotSupportedError");
          return { limits: {} };
        }
      }
    });
  });

  const capabilities = await readCapabilities(page);
  expect(capabilities.webgpu).toBe(true);
  expect(capabilities.maxStorageBufferBindingSize).toBeNull();
});

test("reports unavailable WebGPU when neither request finds an adapter", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => null }
    });
  });

  const capabilities = await readCapabilities(page);
  expect(capabilities.webgpu).toBe(false);
  expect(capabilities.maxStorageBufferBindingSize).toBeNull();
});
