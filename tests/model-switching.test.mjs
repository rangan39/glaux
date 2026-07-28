import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/components/sophon-workbench.tsx"), "utf8");

test("replacing a model clears chat and deletes the previous cache before activation", () => {
  const replacement = source.match(/async function replaceActiveModel[\s\S]*?\n  \}/u)?.[0] ?? "";
  assert.match(replacement, /clearConversationState\(\)/);
  assert.match(replacement, /await deleteModelDownload\(previousModelId\)/);
  assert.match(replacement, /selectModel\(nextModelId\)/);
  assert.ok(
    replacement.indexOf("clearConversationState()") < replacement.indexOf("deleteModelDownload(previousModelId)")
  );
  assert.ok(
    replacement.indexOf("deleteModelDownload(previousModelId)") < replacement.indexOf("selectModel(nextModelId)")
  );
});

test("model download confirmation explains destructive replacement behavior", () => {
  assert.match(source, /Switching will clear this conversation and remove the saved/);
  assert.match(source, /onConfirm=\{\(\) => void confirmModelDownload\(\)\}/);
});
