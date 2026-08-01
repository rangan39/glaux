import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const chromeExtensionBuild = process.env.GLAUX_CHROME_EXTENSION === "1";
const productTestingBuild = process.env.NODE_ENV === "development"
  && process.env.GLAUX_PRODUCT_TESTING === "1"
  && !chromeExtensionBuild;
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  env: {
    NEXT_PUBLIC_GLAUX_PRODUCT_TESTING: productTestingBuild ? "1" : "0"
  },
  output: chromeExtensionBuild ? "export" : "standalone",
  ...(chromeExtensionBuild ? {
    distDir: ".next-extension",
    generateBuildId: async () => "sophon-extension",
    images: { unoptimized: true }
  } : {
    ...(productTestingBuild ? { distDir: ".next-product-test" } : {}),
    outputFileTracingRoot: rootDir
  }),
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: rootDir },
  ...(chromeExtensionBuild ? {} : {
    async headers() {
      return [{ source: "/(.*)", headers: securityHeaders }];
    }
  })
};

export default nextConfig;
