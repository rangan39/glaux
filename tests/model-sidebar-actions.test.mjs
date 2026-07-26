import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/components/sophon-model-sidebar.tsx"), "utf8");

test("labels stored-model deletion visibly for cached and partial downloads", () => {
  assert.match(
    source,
    /const deleteLabel = cache\?\.state === "partial" \? "Delete saved progress" : "Delete download"/
  );
  assert.match(source, /data-model-delete/);
  assert.match(source, /<span>\{deleteLabel\}<\/span>/);
});

test("keeps the delete control model-specific and touch-sized on mobile", () => {
  assert.match(source, /aria-label=\{`\$\{deleteLabel\} for \$\{model\.label\}`\}/);
  assert.match(source, /mobile \? "h-11 flex-1 rounded-xl px-3"/);
  assert.match(source, /hasStoredData && "basis-full"/);
});
