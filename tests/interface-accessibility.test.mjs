import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = read("src/app/globals.css");

test("keeps normal and disabled copy tokens at WCAG AA contrast", () => {
  const darkestInteractiveSurface = "#edf3f7";
  for (const token of [
    "--glaux-copy-primary",
    "--glaux-copy-body",
    "--glaux-copy-metadata",
    "--glaux-copy-decorative",
    "--glaux-copy-disabled"
  ]) {
    const foreground = customPropertyHex(css, token);
    const ratio = contrastRatio(foreground, darkestInteractiveSurface);
    assert.ok(ratio >= 4.5, `${token} has only ${ratio.toFixed(2)}:1 contrast on ${darkestInteractiveSurface}.`);
  }

  assert.ok(contrastRatio("#40556b", "#b9d4e8") >= 4.5, "Disabled primary buttons must retain readable labels.");
  assert.ok(contrastRatio("#061225", "#008cff") >= 4.5, "Primary action labels must retain readable contrast.");
  assert.ok(contrastRatio("#061225", "#00b8ff") >= 4.5, "Primary action labels must remain readable across the accent gradient.");
});

test("does not dim essential disabled-state copy with component opacity", () => {
  const button = read("src/components/ui/button.tsx");
  const modelSidebar = read("src/components/glaux-model-sidebar.tsx");
  assert.doesNotMatch(button, /disabled:opacity-/);
  assert.doesNotMatch(modelSidebar, /cursor-not-allowed opacity-/);
  assert.match(button, /disabled:text-glaux-copy-disabled/);
});

test("keeps the default accent gradient at WCAG AA contrast", () => {
  const block = cssRuleBlock(css, ":root");
  const foreground = customPropertyHex(block, "--glaux-on-signal");
  for (const token of ["--glaux-signal", "--glaux-signal-bright"]) {
    const background = customPropertyHex(block, token);
    const ratio = contrastRatio(foreground, background);
    assert.ok(ratio >= 4.5, `${token} has only ${ratio.toFixed(2)}:1 contrast.`);
  }
});

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function cssRuleBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, "s"));
  assert.ok(match, `Missing ${selector}.`);
  return match[1];
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
