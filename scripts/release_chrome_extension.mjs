#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const artifactDir = path.join(rootDir, "artifacts", "chrome-web-store");
const zipPath = path.join(artifactDir, `sophon-${packageJson.version}.zip`);
const reportPath = path.join(artifactDir, `sophon-${packageJson.version}-audit.json`);

await run("npm", ["run", "check"]);
await run("npm", ["run", "build:extension"]);
await run("npm", ["run", "smoke:extension"]);
await run("npm", ["run", "audit:extension"]);
await run("npm", ["run", "package:extension"]);
const firstPackageSha256 = await readChecksum(`${zipPath}.sha256`);

await run("npm", ["run", "build:extension"]);
await run("npm", ["run", "package:extension"]);
const rebuiltPackageSha256 = await readChecksum(`${zipPath}.sha256`);
assert.equal(
  rebuiltPackageSha256,
  firstPackageSha256,
  "Two clean extension builds produced different Chrome Web Store ZIPs."
);
console.log(`✓ Clean rebuild reproduced SHA-256 ${rebuiltPackageSha256}`);

await mkdir(artifactDir, { recursive: true });
const unpackedDir = await mkdtemp(path.join(os.tmpdir(), "sophon-cws-release-"));
try {
  await run("unzip", ["-q", zipPath, "-d", unpackedDir]);
  await run(process.execPath, [
    "scripts/audit_chrome_extension.mjs",
    "--extension-dir", unpackedDir,
    "--report", reportPath
  ]);
  await run(process.execPath, ["scripts/smoke_chrome_extension.mjs"], {
    ...process.env,
    SOPHON_EXTENSION_DIR: unpackedDir
  });
} finally {
  await rm(unpackedDir, { recursive: true, force: true });
}

console.log(`✓ Release ${packageJson.version} passed checks, reproducibility, package audits, and source/exact-ZIP smoke tests.`);

async function readChecksum(checksumPath) {
  const checksum = (await readFile(checksumPath, "utf8")).trim().split(/\s+/, 1)[0];
  assert.match(checksum, /^[a-f0-9]{64}$/);
  return checksum;
}

async function run(command, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? `exit ${code}`}).`));
    });
  });
}
