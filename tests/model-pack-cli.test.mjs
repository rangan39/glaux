import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/sophon_model_pack.mjs");
const payloads = new Map([
  ["config.json", Buffer.from('{"fixture":true}\n')],
  ["onnx/model_q4f16.onnx_data", Buffer.from("deterministic fixture weights")]
]);

test("builds reproducible packs, verifies them, and emits checksum and provenance", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "sophon-pack-cli-"));
  try {
    const artifactDirectory = join(temporaryRoot, "artifacts");
    mkdirSync(join(artifactDirectory, "onnx"), { recursive: true });
    for (const [path, bytes] of payloads) writeFileSync(join(artifactDirectory, path), bytes);
    const seedPath = join(temporaryRoot, "seed.json");
    writeFileSync(seedPath, JSON.stringify(fixtureSeed()));
    const first = join(temporaryRoot, "first.sophon-model");
    const second = join(temporaryRoot, "second.sophon-model");
    for (const output of [first, second]) {
      const built = run("build", "--model-id", "fixture-model", "--artifact-dir", artifactDirectory, "--output", output, "--seed", seedPath, "--license-reviewed");
      assert.equal(built.status, 0, built.stderr);
      assert.match(built.stdout, /Built and verified/);
      assert.match(readFileSync(`${output}.sha256`, "utf8"), new RegExp(`^[a-f0-9]{64}  ${output.endsWith("first.sophon-model") ? "first" : "second"}\\.sophon-model\\n$`));
      assert.match(readFileSync(`${output}.provenance.txt`, "utf8"), /license review gate: acknowledged/);
    }
    assert.deepEqual(readFileSync(first), readFileSync(second));

    const verified = run("verify", "--pack", first, "--model-id", "fixture-model", "--seed", seedPath);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /Verified/);

    const corrupt = Buffer.from(readFileSync(first));
    corrupt[corrupt.length - 1] ^= 0xff;
    const corruptPath = join(temporaryRoot, "corrupt.sophon-model");
    writeFileSync(corruptPath, corrupt);
    const rejected = run("verify", "--pack", corruptPath, "--seed", seedPath);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /SHA-256 mismatch/i);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("blocks pack distribution until the explicit license review gate is present", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "sophon-pack-license-"));
  try {
    const artifactDirectory = join(temporaryRoot, "artifacts");
    mkdirSync(join(artifactDirectory, "onnx"), { recursive: true });
    for (const [path, bytes] of payloads) writeFileSync(join(artifactDirectory, path), bytes);
    const seedPath = join(temporaryRoot, "seed.json");
    writeFileSync(seedPath, JSON.stringify(fixtureSeed()));
    const result = run("build", "--model-id", "fixture-model", "--artifact-dir", artifactDirectory, "--output", join(temporaryRoot, "blocked.sophon-model"), "--seed", seedPath);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /license.*review/i);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function fixtureSeed() {
  return {
    schemaVersion: 1,
    pipeline: { quantization: "q4f16" },
    models: [{
      id: "fixture-model",
      license: {
        acceptableUsePolicyUrl: "https://example.test/aup",
        attribution: "Fixture model attribution.",
        modelCardUrl: "https://example.test/model",
        spdx: "CC-BY-NC-4.0"
      },
      source: {
        repo: "fixture/model",
        revision: "0123456789abcdef0123456789abcdef01234567",
        files: [...payloads].map(([path, bytes]) => ({
          path,
          sizeBytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex")
        }))
      }
    }]
  };
}

function run(...argumentsList) {
  return spawnSync(process.execPath, ["--experimental-strip-types", script, ...argumentsList], {
    cwd: root,
    encoding: "utf8"
  });
}
