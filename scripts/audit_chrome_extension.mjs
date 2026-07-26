#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");

export async function auditChromeExtension(extensionDir, { reportPath } = {}) {
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version, "package.json and manifest.json versions differ.");
  assert.equal(manifest.name, "Sophon — Private Local AI");
  assert.deepEqual(manifest.permissions, ["unlimitedStorage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://huggingface.co/*",
    "https://*.huggingface.co/*",
    "https://*.hf.co/*",
    "https://*.xethub.hf.co/*"
  ]);
  assert.equal(manifest.homepage_url, "https://sophon-coral.vercel.app");
  assert.match(manifest.content_security_policy.extension_pages, /^script-src 'self' 'wasm-unsafe-eval';/);
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-inline'"));
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));

  const files = (await walk(extensionDir)).sort();
  assert.ok(files.some((file) => file.endsWith(".wasm")), "The local ONNX WebAssembly fallback is missing.");
  assert.equal(files.some((file) => file.endsWith(".onnx_data") || file.endsWith(".sophon-model")), false);
  assert.equal(files.some((file) => path.basename(file) === "privacy.html"), true, "The stable /privacy export is missing.");

  const remoteExecutableUrls = [];
  const inlineExecutableScripts = [];
  for (const file of files) {
    const extension = path.extname(file);
    if (![".html", ".js", ".mjs", ".css", ".json"].includes(extension)) continue;
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\b(?:importScripts|fetch|Worker|SharedWorker)\s*\(\s*["'`](https?:\/\/[^\s"'`<>\\)]+?\.(?:js|mjs|wasm)(?:[?#][^\s"'`<>\\)]*)?)/gi)) {
      remoteExecutableUrls.push({ file: path.relative(extensionDir, file), url: match[1] });
    }
    for (const match of source.matchAll(/\bimport\s*\(\s*["'`](https?:\/\/[^\s"'`<>\\)]+?\.(?:js|mjs)(?:[?#][^\s"'`<>\\)]*)?)/gi)) {
      remoteExecutableUrls.push({ file: path.relative(extensionDir, file), url: match[1] });
    }
    if (extension === ".html") {
      for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const [, attributes, content] = match;
        const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
        const executable = type === undefined || ["module", "text/javascript", "application/javascript"].includes(type);
        if (!executable) continue;
        if (content.trim()) inlineExecutableScripts.push(path.relative(extensionDir, file));
        const scriptSource = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
        if (!scriptSource || /^https?:/i.test(scriptSource)) {
          remoteExecutableUrls.push({ file: path.relative(extensionDir, file), url: scriptSource ?? "(missing src)" });
        }
      }
    }
  }
  assert.deepEqual(inlineExecutableScripts, [], "Executable inline scripts remain in extension HTML.");
  assert.deepEqual(remoteExecutableUrls, [], "Remote JavaScript or WebAssembly references remain in the package.");

  const packagedManifestPath = path.join(extensionDir, "model-runtime", "artifacts.json");
  const packagedManifest = JSON.parse(await readFile(packagedManifestPath, "utf8"));
  const sourceManifest = JSON.parse(await readFile(path.join(rootDir, "models", "model-artifacts.seed.json"), "utf8"));
  assert.equal(packagedManifest.schemaVersion, 1);
  const packagedHashes = new Set();
  for (const artifact of packagedManifest.artifacts) {
    assert.ok(!artifact.bundledPath.endsWith(".onnx_data"));
    const target = path.join(extensionDir, "model-runtime", artifact.bundledPath);
    assert.equal(target.startsWith(`${path.join(extensionDir, "model-runtime")}${path.sep}`), true);
    const bytes = await readFile(target);
    assert.equal(bytes.byteLength, artifact.size, `Packaged size mismatch for ${artifact.bundledPath}.`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, `Packaged SHA-256 mismatch for ${artifact.bundledPath}.`);
    packagedHashes.add(artifact.sha256);
  }

  const remoteTensorArtifacts = [];
  for (const model of sourceManifest.models) {
    assert.match(model.source.revision, /^[a-f0-9]{40}$/);
    for (const artifact of model.source.files) {
      if (artifact.path.includes(".onnx_data")) {
        remoteTensorArtifacts.push({
          modelId: model.id,
          revision: model.source.revision,
          path: artifact.path,
          size: artifact.sizeBytes,
          sha256: artifact.sha256
        });
      } else {
        assert.ok(packagedHashes.has(artifact.sha256), `${model.id}:${artifact.path} is neither packaged nor approved tensor data.`);
      }
    }
  }
  assert.equal(remoteTensorArtifacts.length, 8);
  assert.ok(remoteTensorArtifacts.every(({ path: artifactPath }) => /^onnx\/model_q4f16\.onnx_data(?:_1)?$/.test(artifactPath)));

  const deliverySource = await readFile(path.join(rootDir, "src", "lib", "model-delivery", "auxiliary-cache.ts"), "utf8");
  assert.match(deliverySource, /fetch\(bundledUrl,/);
  assert.doesNotMatch(deliverySource, /fetch\(key,/);

  const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size)))
    .reduce((total, size) => total + size, 0);
  const report = {
    schemaVersion: 1,
    extension: {
      name: manifest.name,
      version: manifest.version,
      manifestVersion: manifest.manifest_version
    },
    package: {
      files: files.length,
      bytes: totalBytes,
      localJavaScriptFiles: files.filter((file) => [".js", ".mjs"].includes(path.extname(file))).length,
      localWebAssemblyFiles: files.filter((file) => file.endsWith(".wasm")).length,
      packagedModelLogicFiles: packagedManifest.artifacts.length,
      forbiddenPayloadFiles: 0,
      remoteExecutableReferences: 0
    },
    remoteModelData: {
      classification: "immutable external tensor weights only",
      artifacts: remoteTensorArtifacts
    }
  };
  if (reportPath) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

async function walk(directory) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const extensionDir = resolveArgument("--extension-dir") ?? path.join(rootDir, "dist", "chrome-extension");
  const reportPath = resolveArgument("--report");
  console.log(JSON.stringify(await auditChromeExtension(path.resolve(extensionDir), {
    ...(reportPath ? { reportPath: path.resolve(reportPath) } : {})
  }), null, 2));
}

function resolveArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}
