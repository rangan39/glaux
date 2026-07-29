import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "src");
const sourceFiles = walk(sourceRoot).filter((file) => [".css", ".ts", ".tsx"].includes(extname(file)));

test("keeps deleted runtime stacks out of production source while using shadcn primitives", () => {
  const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const banned of ["next/dynamic", "onnxruntime-web", "runLocalModel", "inspect-pack", "import-pack", "model-pack-importer", ".sophon-model"]) {
    assert.equal(source.includes(banned), false, `Deleted production path returned: ${banned}`);
  }
  assert.match(source, /@radix-ui\/react-dialog/, "Expected shadcn Dialog or Sheet primitives.");
  assert.match(source, /class-variance-authority/, "Expected shadcn variant primitives.");
  assert.equal(source.match(/pipeline\("text-generation"/g)?.length, 1, "There must be one text-generation engine.");
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }).sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}
