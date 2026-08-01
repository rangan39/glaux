import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/components/sophon-workbench.tsx"), "utf8");

test("selecting a different model clears chat before activation", () => {
  const selection = source.match(/function selectModel[\s\S]*?\n  \}/u)?.[0] ?? "";
  assert.match(selection, /clearConversationState\(\)/);
  assert.match(selection, /setModelId\(nextModelId\)/);
  assert.ok(
    selection.indexOf("clearConversationState()") < selection.indexOf("setModelId(nextModelId)")
  );
});

test("model download confirmation explains destructive replacement behavior", () => {
  assert.match(source, /Glaux keeps one model on this device at a time/);
  assert.match(source, /saved model files will be removed first/);
  assert.match(source, /onConfirm=\{\(\) => void confirmModelDownload\(\)\}/);
});
