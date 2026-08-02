export type BrowserEngine = "chromium" | "webkit" | "gecko" | "unknown";
export type HardwareTier = "mobile" | "desktop";

type BrowserEnvironment = {
  userAgent: string;
  maxTouchPoints?: number;
  brands?: readonly string[];
};

type AdapterLike = {
  limits?: { maxStorageBufferBindingSize?: number };
};

type RuntimeNavigator = Navigator & {
  gpu?: {
    requestAdapter?: (options?: { powerPreference?: "low-power" | "high-performance" }) => Promise<AdapterLike | null>;
  };
  userAgentData?: { brands?: readonly { brand: string }[] };
};

let runtimeCapabilitiesPromise: Promise<{
  webgpu: boolean;
  wasm: boolean;
  crossOriginIsolated: boolean;
  browserEngine: BrowserEngine;
  hardwareTier: HardwareTier;
  maxStorageBufferBindingSize: number | null;
}> | null = null;

export function detectBrowserEngine(userAgent: string, brands: readonly string[] = []): BrowserEngine {
  const normalizedBrands = brands.map((brand) => brand.toLowerCase());
  const iOSBrowser = /\b(?:iPhone|iPad|iPod)\b/i.test(userAgent)
    || /\b(?:CriOS|EdgiOS|FxiOS|OPiOS)\//i.test(userAgent);
  const chromiumBrand = normalizedBrands.some((brand) =>
    brand.includes("chromium")
    || brand.includes("google chrome")
    || brand.includes("microsoft edge")
    || brand.includes("opera")
  );
  if (!iOSBrowser && (chromiumBrand || /\b(?:HeadlessChrome|Chrome|Chromium|Edg|OPR)\/\d+/i.test(userAgent))) return "chromium";
  if (/\b(?:Firefox|FxiOS)\//i.test(userAgent)) return iOSBrowser ? "webkit" : "gecko";
  if (/AppleWebKit/i.test(userAgent)) return "webkit";
  return "unknown";
}

export function detectHardwareTier(userAgent: string, maxTouchPoints = 0): HardwareTier {
  const appleTouchDevice = /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent) || appleTouchDevice
    ? "mobile"
    : "desktop";
}

export function classifyBrowserEnvironment({
  userAgent,
  maxTouchPoints = 0,
  brands = []
}: BrowserEnvironment) {
  return {
    browserEngine: detectBrowserEngine(userAgent, brands),
    hardwareTier: detectHardwareTier(userAgent, maxTouchPoints)
  } as const;
}

export function getRuntimeCapabilities() {
  runtimeCapabilitiesPromise ??= detectRuntimeCapabilities();
  return runtimeCapabilitiesPromise;
}

async function detectRuntimeCapabilities() {
  const scope = globalThis as typeof globalThis & {
    navigator?: RuntimeNavigator;
    crossOriginIsolated?: boolean;
  };
  let adapter: AdapterLike | null = null;
  try {
    adapter = await scope.navigator?.gpu?.requestAdapter?.({ powerPreference: "high-performance" }) ?? null;
    // Safari can reject a high-performance preference on an integrated GPU even
    // when WebGPU is available. Let the browser choose its default adapter before
    // reporting WebGPU as unavailable.
    if (!adapter) adapter = await scope.navigator?.gpu?.requestAdapter?.() ?? null;
  } catch {
    // A denied or unavailable adapter is equivalent to no WebGPU capability.
  }
  const userAgent = scope.navigator?.userAgent ?? "";
  const { browserEngine, hardwareTier } = classifyBrowserEnvironment({
    userAgent,
    maxTouchPoints: scope.navigator?.maxTouchPoints ?? 0,
    brands: scope.navigator?.userAgentData?.brands?.map(({ brand }) => brand) ?? []
  });
  const maxStorageBufferBindingSize = adapter?.limits?.maxStorageBufferBindingSize;
  return {
    webgpu: Boolean(adapter),
    wasm: typeof WebAssembly !== "undefined",
    crossOriginIsolated: Boolean(scope.crossOriginIsolated),
    browserEngine,
    hardwareTier,
    maxStorageBufferBindingSize: typeof maxStorageBufferBindingSize === "number" && Number.isFinite(maxStorageBufferBindingSize)
      ? maxStorageBufferBindingSize
      : null
  };
}
