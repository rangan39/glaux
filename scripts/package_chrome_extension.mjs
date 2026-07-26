#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { auditChromeExtension } from "./audit_chrome_extension.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const extensionDir = path.resolve(resolveArgument("--extension-dir") ?? path.join(rootDir, "dist", "chrome-extension"));
const outputDir = path.resolve(resolveArgument("--output-dir") ?? path.join(rootDir, "artifacts", "chrome-web-store"));
const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
assert.equal(manifest.version, packageJson.version);
await auditChromeExtension(extensionDir);

await mkdir(outputDir, { recursive: true });
const baseName = `sophon-${manifest.version}`;
const zipPath = path.join(outputDir, `${baseName}.zip`);
const checksumPath = `${zipPath}.sha256`;
const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "sophon-cws-package-"));
try {
  await cp(extensionDir, temporaryDir, { recursive: true });
  const files = (await walk(temporaryDir)).sort((left, right) =>
    path.relative(temporaryDir, left).localeCompare(path.relative(temporaryDir, right), "en")
  );
  const reproducibleDate = new Date("1980-01-01T00:00:00.000Z");
  for (const file of files) {
    await chmod(file, 0o644);
    await utimes(file, reproducibleDate, reproducibleDate);
  }
  for (const directory of (await directories(temporaryDir)).sort().reverse()) {
    await chmod(directory, 0o755);
    await utimes(directory, reproducibleDate, reproducibleDate);
  }

  await rm(zipPath, { force: true });
  await rm(checksumPath, { force: true });
  const relativeFiles = files.map((file) => path.relative(temporaryDir, file));
  await run("zip", ["-X", "-q", zipPath, "-@"], {
    cwd: temporaryDir,
    env: { ...process.env, TZ: "UTC" },
    input: `${relativeFiles.join("\n")}\n`
  });
  const entries = (await run("unzip", ["-Z1", zipPath], { cwd: rootDir })).stdout.trim().split("\n");
  assert.ok(entries.includes("manifest.json"), "manifest.json is not at the ZIP root.");
  assert.equal(entries.some((entry) => entry.startsWith("/") || entry.includes("../")), false);
  assert.deepEqual(entries, relativeFiles);

  const digest = createHash("sha256");
  await pipeline(createReadStream(zipPath), digest);
  const sha256 = digest.digest("hex");
  await writeFile(checksumPath, `${sha256}  ${path.basename(zipPath)}\n`);
  console.log(JSON.stringify({
    zip: path.relative(rootDir, zipPath),
    checksum: path.relative(rootDir, checksumPath),
    sha256,
    bytes: (await stat(zipPath)).size,
    files: entries.length
  }, null, 2));
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
}

async function directories(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const target = path.join(directory, entry.name);
    return [target, ...(await directories(target))];
  }));
  return [directory, ...nested.flat()];
}

async function run(command, args, { cwd, env = process.env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"]
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(`${command} failed (${signal ?? `exit ${code}`}).`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

function resolveArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}
