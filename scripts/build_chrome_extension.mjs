#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportDir = path.join(rootDir, ".next-extension");
const extensionSourceDir = path.join(rootDir, "chrome-extension");
const extensionDir = path.join(rootDir, "dist", "chrome-extension");
const nextBin = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");

await Promise.all([
  rm(exportDir, { recursive: true, force: true }),
  rm(extensionDir, { recursive: true, force: true })
]);

await run(process.execPath, [nextBin, "build"], {
  ...process.env,
  SOPHON_CHROME_EXTENSION: "1",
  NEXT_PUBLIC_SOPHON_CHROME_EXTENSION: "1"
});

await cp(exportDir, extensionDir, { recursive: true });
await sanitizeChromePaths();
await Promise.all([
  cp(path.join(extensionSourceDir, "manifest.json"), path.join(extensionDir, "manifest.json")),
  cp(path.join(extensionSourceDir, "background.js"), path.join(extensionDir, "background.js"))
]);

await generateIcons();
await validateStoreIconSafeArea();
const externalizedScripts = await externalizeInlineScripts();
const summary = await validateExtension(externalizedScripts);
console.log(JSON.stringify(summary, null, 2));

async function run(command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Extension build failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

async function generateIcons() {
  const source = await readFile(path.join(extensionSourceDir, "icon-source.svg"));
  const iconDir = path.join(extensionDir, "icons");
  await mkdir(iconDir, { recursive: true });
  await Promise.all([16, 32, 48, 128].map((size) =>
    sharp(source)
      .resize(size, size)
      .png()
      .toFile(path.join(iconDir, `icon-${size}.png`))
  ));
}

async function validateStoreIconSafeArea() {
  const image = await sharp(path.join(extensionDir, "icons", "icon-128.png"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = image.info.width;
  let minY = image.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.info.height; y += 1) {
    for (let x = 0; x < image.info.width; x += 1) {
      if (image.data[(y * image.info.width + x) * image.info.channels + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert.deepEqual({ minX, minY, maxX, maxY }, { minX: 16, minY: 16, maxX: 111, maxY: 111 }, "The 128px icon must use a 96px safe-area with 16px transparent padding.");
}

async function externalizeInlineScripts() {
  const htmlFiles = (await walk(extensionDir)).filter((file) => file.endsWith(".html"));
  let scriptIndex = 0;
  const scriptDir = path.join(extensionDir, "extension-runtime");
  await mkdir(scriptDir, { recursive: true });

  for (const file of htmlFiles) {
    const source = await readFile(file, "utf8");
    const replacements = [];
    const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    for (const match of source.matchAll(pattern)) {
      const [markup, attributes, content] = match;
      if (/\bsrc\s*=/i.test(attributes) || !isExecutableScript(attributes) || content.trim().length === 0) continue;
      const fileName = `inline-${scriptIndex += 1}.js`;
      await writeFile(path.join(scriptDir, fileName), `${content}\n`);
      replacements.push({
        start: match.index,
        end: match.index + markup.length,
        value: `<script${attributes} src="/extension-runtime/${fileName}"></script>`
      });
    }
    if (replacements.length === 0) continue;
    let output = source;
    for (const replacement of replacements.reverse()) {
      output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
    }
    await writeFile(file, output);
  }
  return scriptIndex;
}

function isExecutableScript(attributes) {
  const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
  return type === undefined
    || type === "module"
    || type === "text/javascript"
    || type === "application/javascript";
}

async function validateExtension(externalizedScripts) {
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version, "Extension and package versions must match.");
  assert.deepEqual(manifest.permissions, ["unlimitedStorage"]);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-inline'"));
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
  assert.ok(externalizedScripts > 0, "The static export did not contain the expected hydration scripts.");

  const requiredFiles = [
    "index.html",
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  for (const relativePath of new Set(requiredFiles)) {
    assert.equal((await stat(path.join(extensionDir, relativePath))).isFile(), true, `Missing ${relativePath}.`);
  }

  const files = await walk(extensionDir);
  for (const file of files) {
    const relativePath = path.relative(extensionDir, file);
    assert.ok(
      relativePath.split(path.sep).every((segment) => !segment.startsWith("_")),
      `Chrome-reserved filename remains: ${relativePath}.`
    );
    assert.ok(
      !relativePath.endsWith(".sophon-model") && !relativePath.includes(".onnx_data"),
      `Model data must not be bundled in the extension: ${relativePath}.`
    );
  }
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  for (const file of htmlFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attributes, content] = match;
      if (isExecutableScript(attributes)) {
        assert.match(attributes, /\bsrc\s*=/i, `Executable inline script remains in ${path.relative(extensionDir, file)}.`);
        assert.equal(content.trim(), "", `Script with src contains inline code in ${path.relative(extensionDir, file)}.`);
        const sourcePath = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
        assert.ok(!/^https?:/i.test(sourcePath), `Remote script remains in ${path.relative(extensionDir, file)}.`);
        const localPath = sourcePath.replace(/^\//, "").split(/[?#]/, 1)[0];
        assert.equal((await stat(path.join(extensionDir, localPath))).isFile(), true, `Missing script ${sourcePath}.`);
      }
    }
    assert.ok(!source.includes("/_next/"), `Reserved Next.js asset prefix remains in ${path.relative(extensionDir, file)}.`);
  }

  const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size)))
    .reduce((total, size) => total + size, 0);
  return {
    output: path.relative(rootDir, extensionDir),
    files: files.length,
    bytes: totalBytes,
    externalizedScripts
  };
}

async function sanitizeChromePaths() {
  const nextAssets = path.join(extensionDir, "_next");
  const chromeAssets = path.join(extensionDir, "next-assets");
  await rename(nextAssets, chromeAssets);

  for (const entry of await readdir(extensionDir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name === "404.html" || entry.name === "index.txt") {
      await rm(path.join(extensionDir, entry.name), { recursive: true, force: true });
    }
  }
  await removeReservedDescendants(extensionDir);

  const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs"]);
  for (const file of await walk(extensionDir)) {
    if (!textExtensions.has(path.extname(file))) continue;
    const source = await readFile(file, "utf8");
    if (!source.includes("/_next/")) continue;
    await writeFile(file, source.replaceAll("/_next/", "/next-assets/"));
  }
}

async function removeReservedDescendants(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.name.startsWith("_")) {
      await rm(target, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await removeReservedDescendants(target);
    }
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
}
