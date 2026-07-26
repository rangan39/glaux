import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");
const runtimeDir = path.join(rootDir, "public", "model-runtime");
const packagedManifest = JSON.parse(await readFile(path.join(runtimeDir, "manifest.json"), "utf8"));
const sourceManifest = JSON.parse(await readFile(path.join(rootDir, "models", "model-artifacts.seed.json"), "utf8"));

test("packages every behavior-defining model artifact with pinned bytes", async () => {
  assert.equal(packagedManifest.schemaVersion, 1);
  assert.equal(packagedManifest.artifacts.length, 7);
  const bundledPaths = new Set();
  for (const artifact of packagedManifest.artifacts) {
    assert.equal(bundledPaths.has(artifact.bundledPath), false);
    bundledPaths.add(artifact.bundledPath);
    assert.match(artifact.bundledPath, /^(shared|tiny-aya-(global|regional))\/[a-z0-9_.-]+$/);
    assert.ok(!artifact.bundledPath.endsWith(".onnx_data"));
    const sourceModel = sourceManifest.models.find(({ id }) => id === artifact.sourceModel);
    const source = sourceModel?.source.files.find(({ path: sourcePath }) => sourcePath === artifact.sourcePath);
    assert.deepEqual(source, {
      path: artifact.sourcePath,
      sizeBytes: artifact.size,
      sha256: artifact.sha256
    });
    const bytes = await readFile(path.join(runtimeDir, artifact.bundledPath));
    assert.equal((await stat(path.join(runtimeDir, artifact.bundledPath))).size, artifact.size);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
  }
});

test("leaves only immutable tensor data in the remote runtime allowlist", async () => {
  for (const model of sourceManifest.models) {
    for (const file of model.source.files) {
      if (file.path.includes(".onnx_data")) continue;
      assert.ok(packagedManifest.artifacts.some((artifact) =>
        artifact.sourcePath === file.path && artifact.sha256 === file.sha256
      ), `${model.id}:${file.path} is not represented by a packaged artifact.`);
    }
  }
});
