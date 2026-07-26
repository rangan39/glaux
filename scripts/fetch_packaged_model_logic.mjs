#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const rootDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(rootDir, "public", "model-runtime");
const packagedManifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
const sourceManifest = JSON.parse(await readFile(path.join(rootDir, "models", "model-artifacts.seed.json"), "utf8"));

assert.equal(packagedManifest.schemaVersion, 1);
for (const artifact of packagedManifest.artifacts) {
  const model = sourceManifest.models.find(({ id }) => id === artifact.sourceModel);
  assert.ok(model, `Unknown source model ${artifact.sourceModel}.`);
  const source = model.source.files.find(({ path: sourcePath }) => sourcePath === artifact.sourcePath);
  assert.deepEqual(source, {
    path: artifact.sourcePath,
    sizeBytes: artifact.size,
    sha256: artifact.sha256
  }, `Packaged metadata drifted from the pinned source for ${artifact.bundledPath}.`);

  const outputPath = path.join(outputDir, artifact.bundledPath);
  assert.equal(outputPath.startsWith(`${outputDir}${path.sep}`), true, `Unsafe packaged path ${artifact.bundledPath}.`);
  if (await matchesPinnedArtifact(outputPath, artifact)) {
    console.log(`✓ ${artifact.bundledPath}`);
    continue;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.download`;
  await rm(temporaryPath, { force: true });
  const url = `https://huggingface.co/${model.source.repo}/resolve/${model.source.revision}/${artifact.sourcePath}`;
  console.log(`↓ ${artifact.bundledPath}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Packaged model artifact request failed with HTTP ${response.status}: ${url}`);
  }
  await pipeline(response.body, createWriteStream(temporaryPath, { flags: "wx" }));
  if (!await matchesPinnedArtifact(temporaryPath, artifact)) {
    await rm(temporaryPath, { force: true });
    throw new Error(`Downloaded bytes failed size or SHA-256 verification for ${artifact.bundledPath}.`);
  }
  await rename(temporaryPath, outputPath);
}

async function matchesPinnedArtifact(file, artifact) {
  try {
    if ((await stat(file)).size !== artifact.size) return false;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const digest = createHash("sha256");
  await pipeline(createReadStream(file), digest);
  return digest.digest("hex") === artifact.sha256;
}
