import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBrowserEnvironment,
  detectRuntimeCapabilities,
  detectBrowserEngine,
  detectHardwareTier
} from "../src/lib/browser-runtime.ts";

test("detects Chromium engines from user agent brands and desktop browser tokens", () => {
  assert.equal(detectBrowserEngine("", ["Not/A Brand", "Chromium", "Google Chrome"]), "chromium");
  assert.equal(detectBrowserEngine("Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36"), "chromium");
  assert.equal(detectBrowserEngine("Mozilla/5.0 HeadlessChrome/140.0.0.0 Safari/537.36"), "chromium");
  assert.equal(detectBrowserEngine("Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"), "chromium");
});

test("does not mistake iOS browser shells for Chromium engines", () => {
  assert.equal(detectBrowserEngine("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1"), "webkit");
  assert.equal(detectBrowserEngine("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"), "webkit");
  assert.equal(detectBrowserEngine("Mozilla/5.0 Firefox/140.0"), "gecko");
});

test("classifies phones and touch-based iPads as mobile hardware", () => {
  assert.equal(detectHardwareTier("Mozilla/5.0 (Linux; Android 16; Pixel 10) Chrome/140.0 Mobile", 5), "mobile");
  assert.equal(detectHardwareTier("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 5), "mobile");
  assert.deepEqual(classifyBrowserEnvironment({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36",
    maxTouchPoints: 0
  }), {
    browserEngine: "chromium",
    hardwareTier: "desktop"
  });
});

function safariEnvironment(requestAdapter) {
  return {
    navigator: {
      gpu: { requestAdapter },
      maxTouchPoints: 0,
      userAgent: "Mozilla/5.0 (Macintosh; Apple M1) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"
    },
    crossOriginIsolated: true,
    wasmAvailable: true
  };
}

test("uses the preferred WebGPU adapter without an unnecessary fallback", async () => {
  const adapterRequests = [];
  const capabilities = await detectRuntimeCapabilities(safariEnvironment(async (options) => {
    adapterRequests.push(options);
    return { limits: { maxStorageBufferBindingSize: 268_435_456 } };
  }));

  assert.equal(capabilities.webgpu, true);
  assert.equal(capabilities.maxStorageBufferBindingSize, 268_435_456);
  assert.deepEqual(adapterRequests, [{ powerPreference: "high-performance" }]);
});

test("falls back to the default WebGPU adapter when high-performance returns null", async () => {
  const adapterRequests = [];
  const capabilities = await detectRuntimeCapabilities(safariEnvironment(async (options) => {
    adapterRequests.push(options);
    return options ? null : { limits: { maxStorageBufferBindingSize: 67_108_864 } };
  }));

  assert.equal(capabilities.webgpu, true);
  assert.equal(capabilities.browserEngine, "webkit");
  assert.deepEqual(adapterRequests, [{ powerPreference: "high-performance" }, undefined]);
});

test("falls back to the default WebGPU adapter when high-performance rejects", async () => {
  const adapterRequests = [];
  const capabilities = await detectRuntimeCapabilities(safariEnvironment(async (options) => {
    adapterRequests.push(options);
    if (options) throw new DOMException("Unsupported preference", "NotSupportedError");
    return { limits: {} };
  }));

  assert.equal(capabilities.webgpu, true);
  assert.equal(capabilities.maxStorageBufferBindingSize, null);
  assert.deepEqual(adapterRequests, [{ powerPreference: "high-performance" }, undefined]);
});

test("reports WebGPU unavailable when no adapter can be acquired", async () => {
  const capabilities = await detectRuntimeCapabilities(safariEnvironment(async () => null));

  assert.equal(capabilities.webgpu, false);
  assert.equal(capabilities.wasm, true);
  assert.equal(capabilities.crossOriginIsolated, true);
  assert.equal(capabilities.maxStorageBufferBindingSize, null);
});

test("reports WebGPU unavailable when the browser has no GPU API", async () => {
  const capabilities = await detectRuntimeCapabilities({
    navigator: { userAgent: "unknown", maxTouchPoints: 0 },
    crossOriginIsolated: false,
    wasmAvailable: false
  });

  assert.deepEqual(capabilities, {
    webgpu: false,
    wasm: false,
    crossOriginIsolated: false,
    browserEngine: "unknown",
    hardwareTier: "desktop",
    maxStorageBufferBindingSize: null
  });
});
