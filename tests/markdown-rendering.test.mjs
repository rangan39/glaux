import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokenLens = readFileSync(join(root, "src/components/token-lens.tsx"), "utf8");

test("keeps a delayed rich renderer out of a raw-source loading fallback", () => {
  assert.match(
    tokenLens,
    /<Suspense fallback=\{<MarkdownLoading \/>\}>/,
    "Rich messages must use the neutral loading state while their renderer is delayed."
  );
  const loadingComponent = tokenLens.match(/function MarkdownLoading\(\) \{([\s\S]+?)\n\}/)?.[1];
  assert.ok(loadingComponent, "The neutral Markdown loading state must remain defined.");
  assert.match(loadingComponent, /role="status"/);
  assert.match(loadingComponent, /aria-busy="true"/);
  assert.match(loadingComponent, />Formatting response</);
  assert.doesNotMatch(
    loadingComponent,
    /\{content\}/,
    "The delayed-renderer state must not expose raw Markdown source."
  );
  assert.doesNotMatch(
    tokenLens,
    /fallback=\{<p>\{content\}<\/p>\}/,
    "Rich content must never fall back to a final-looking paragraph of raw Markdown."
  );
});

test("keeps immediate plain-text rendering separate from rich Markdown rendering", () => {
  assert.match(
    tokenLens,
    /\{markdownSyntax\.test\(content\) \? \([\s\S]+?\) : <p>\{content\}<\/p>\}/,
    "Simple messages should continue to bypass Markdown parsing."
  );
});
