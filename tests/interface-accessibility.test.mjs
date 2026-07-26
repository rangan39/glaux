import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = read("src/app/globals.css");
const auditedFiles = [
  "src/app/loading.tsx",
  "src/app/privacy/page.tsx",
  "src/components/sophon-acknowledgements-dialog.tsx",
  "src/components/sophon-acknowledgements.tsx",
  "src/components/sophon-model-sidebar.tsx",
  "src/components/sophon-workbench.tsx",
  "src/components/token-lens.tsx",
  "src/components/ui/info-hint.tsx"
];
const auditedSource = auditedFiles.map((file) => read(file)).join("\n");

test("keeps semantic type roles above the interface readability floor", () => {
  assert.match(css, /\.sophon-type-decorative\s*\{[^}]*font-size:\s*0\.6875rem/s);
  assert.match(css, /\.sophon-type-metadata,[^{]+\.sophon-type-action\s*\{[^}]*font-size:\s*0\.75rem/s);
  assert.match(css, /\.sophon-type-body\s*\{[^}]*font-size:\s*0\.875rem/s);

  const arbitraryPixelSizes = [...auditedSource.matchAll(/text-\[([0-9.]+)px\]/g)]
    .map((match) => Number(match[1]))
    .filter((size) => size < 11);
  assert.deepEqual(arbitraryPixelSizes, [], "Audited interface copy must not use arbitrary sizes below 11px.");

  for (const role of ["decorative", "metadata", "status", "body", "action"]) {
    assert.match(auditedSource, new RegExp(`data-typography-role="${role}"`), `Missing the ${role} typography role.`);
  }
});

test("keeps normal and disabled copy tokens at WCAG AA contrast", () => {
  const lightestInteractiveSurface = "#25272c";
  for (const token of [
    "--sophon-copy-primary",
    "--sophon-copy-body",
    "--sophon-copy-metadata",
    "--sophon-copy-decorative",
    "--sophon-copy-disabled"
  ]) {
    const foreground = customPropertyHex(css, token);
    const ratio = contrastRatio(foreground, lightestInteractiveSurface);
    assert.ok(ratio >= 4.5, `${token} has only ${ratio.toFixed(2)}:1 contrast on ${lightestInteractiveSurface}.`);
  }

  assert.ok(contrastRatio("#f4f0e9", "#91402f") >= 4.5, "Disabled primary buttons must retain readable labels.");
  assert.ok(contrastRatio("#210b07", "#ff4d2e") >= 4.5, "Primary action labels must retain readable contrast.");
});

test("does not dim essential disabled-state copy with component opacity", () => {
  const button = read("src/components/ui/button.tsx");
  const modelSidebar = read("src/components/sophon-model-sidebar.tsx");
  assert.doesNotMatch(button, /disabled:opacity-/);
  assert.doesNotMatch(modelSidebar, /cursor-not-allowed opacity-/);
  assert.match(button, /disabled:text-sophon-copy-disabled/);
});

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function customPropertyHex(source, property) {
  const match = source.match(new RegExp(`${property}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `Missing ${property}.`);
  return match[1];
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
