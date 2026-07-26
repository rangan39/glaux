import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const chromeExtensionBuild = process.env.SOPHON_CHROME_EXTENSION === "1";
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  output: chromeExtensionBuild ? "export" : "standalone",
  ...(chromeExtensionBuild ? {
    distDir: ".next-extension",
    generateBuildId: async () => "sophon-extension",
    images: { unoptimized: true }
  } : {
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
