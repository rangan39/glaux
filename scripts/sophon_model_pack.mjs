#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, openAsBlob } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";
import {
  canonicalJson,
  encodeSophonModelPackPreamble,
  parseSophonModelPack
} from "../src/lib/model-delivery/pack-format.ts";

class UsageError extends Error {}

const DEFAULT_SEED = new URL("../models/model-artifacts.seed.json", import.meta.url);
const DEFAULT_SEGMENT_SIZE = 64 * 1024 * 1024;
const [command, ...rawArguments] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  printHelp();
  process.exitCode = command ? 0 : 2;
} else {
  try {
    const options = parseArguments(rawArguments);
    if (command === "build") await buildPack(options);
    else if (command === "verify") await verifyPackCommand(options);
    else throw new UsageError(`Unknown command ${JSON.stringify(command)}.`);
  } catch (error) {
    console.error(`sophon-model-pack: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) printHelp();
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

async function buildPack(options) {
  const modelId = requireOption(options, "model-id");
  const artifactDirectory = resolve(requireOption(options, "artifact-dir"));
  const outputPath = resolve(requireOption(options, "output"));
  const seed = await loadSeed(options.seed);
  const model = requireSeedModel(seed, modelId);
  if (!options["license-reviewed"]) {
    throw new UsageError("Pack generation is blocked until licensing/attribution review is recorded with --license-reviewed.");
  }
  if (!outputPath.endsWith(".sophon-model")) {
    throw new UsageError("--output must end in .sophon-model.");
  }
  await assertNewOutput(outputPath);
  await assertNewOutput(`${outputPath}.sha256`);
  await assertNewOutput(`${outputPath}.provenance.txt`);
  await assertArtifactDirectory(artifactDirectory, model);

  console.error(`Preflighting ${model.id} artifacts…`);
  const artifacts = [];
  let offset = 0;
  for (const expected of [...model.source.files].sort((left, right) => left.path.localeCompare(right.path))) {
    const path = joinArtifactPath(artifactDirectory, expected.path);
    const measured = await hashFile(path, DEFAULT_SEGMENT_SIZE);
    if (measured.size !== expected.sizeBytes) {
      throw new Error(`${expected.path} has ${measured.size} bytes; the immutable manifest requires ${expected.sizeBytes}.`);
    }
    if (measured.sha256 !== expected.sha256) {
      throw new Error(`${expected.path} SHA-256 mismatch: expected ${expected.sha256}, received ${measured.sha256}.`);
    }
    artifacts.push({
      path: expected.path,
      offset,
      size: expected.sizeBytes,
      sha256: expected.sha256,
      segments: measured.segments
    });
    offset += expected.sizeBytes;
  }
  const header = {
    schemaVersion: 1,
    modelId: model.id,
    repo: model.source.repo,
    revision: model.source.revision,
    quantization: seed.pipeline.quantization,
    segmentSize: DEFAULT_SEGMENT_SIZE,
    artifacts,
    license: model.license
  };
  const preamble = encodeSophonModelPackPreamble(header);
  await mkdir(dirname(outputPath), { recursive: true });
  const output = createWriteStream(outputPath, { flags: "wx" });
  let completed = false;
  try {
    await writeChunk(output, preamble);
    for (const artifact of artifacts) {
      console.error(`Writing ${artifact.path}…`);
      for await (const chunk of createReadStream(joinArtifactPath(artifactDirectory, artifact.path))) {
        await writeChunk(output, chunk);
      }
    }
    output.end();
    await finished(output);
    completed = true;
  } finally {
    if (!output.closed) output.destroy();
    if (!completed) await rm(outputPath, { force: true });
  }

  const verified = await verifyPack(outputPath, seed, model.id);
  const packSha256 = await hashWholeFile(outputPath);
  const checksumPath = `${outputPath}.sha256`;
  const provenancePath = `${outputPath}.provenance.txt`;
  await writeNewFile(checksumPath, `${packSha256}  ${basename(outputPath)}\n`);
  await writeNewFile(provenancePath, [
    "Sophon offline model pack provenance",
    `format: ${verified.format}`,
    `model: ${verified.header.modelId}`,
    `repository: ${verified.header.repo}`,
    `revision: ${verified.header.revision}`,
    `quantization: ${verified.header.quantization}`,
    `payload bytes: ${verified.payloadBytes}`,
    `pack sha256: ${packSha256}`,
    `license: ${verified.header.license.spdx} (non-commercial)`,
    `model card: ${verified.header.license.modelCardUrl}`,
    `acceptable use policy: ${verified.header.license.acceptableUsePolicyUrl}`,
    `attribution: ${verified.header.license.attribution}`,
    "license review gate: acknowledged by pack builder",
    "",
    "Artifacts:",
    ...verified.header.artifacts.map((artifact) => `- ${artifact.path} | ${artifact.size} bytes | sha256 ${artifact.sha256}`),
    ""
  ].join("\n"));
  console.log(`Built and verified ${outputPath}`);
  console.log(`SHA-256 ${packSha256}`);
  console.log(`Provenance ${provenancePath}`);
}

async function verifyPackCommand(options) {
  const packPath = resolve(requireOption(options, "pack"));
  const seed = await loadSeed(options.seed);
  const result = await verifyPack(packPath, seed, options["model-id"]);
  const digest = await hashWholeFile(packPath);
  console.log(`Verified ${packPath}`);
  console.log(`Model ${result.header.modelId}`);
  console.log(`Revision ${result.header.revision}`);
  console.log(`Payload ${result.payloadBytes} bytes`);
  console.log(`SHA-256 ${digest}`);
}

async function verifyPack(packPath, seed, expectedModelId) {
  const pack = await openAsBlob(packPath);
  const parsed = await parseSophonModelPack(pack);
  const model = requireSeedModel(seed, parsed.header.modelId);
  if (expectedModelId && parsed.header.modelId !== expectedModelId) {
    throw new Error(`Wrong model: expected ${expectedModelId}, received ${parsed.header.modelId}.`);
  }
  assertHeaderMatchesSeed(parsed.header, seed, model);
  const fileHandle = await open(packPath, "r");
  try {
    for (const artifact of parsed.header.artifacts) {
      const whole = createHash("sha256");
      for (let index = 0; index < artifact.segments.length; index += 1) {
        const segmentStart = parsed.payloadOffset + artifact.offset + index * parsed.header.segmentSize;
        const segmentBytes = Math.min(parsed.header.segmentSize, artifact.size - index * parsed.header.segmentSize);
        const segment = createHash("sha256");
        let received = 0;
        const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, segmentBytes));
        while (received < segmentBytes) {
          const length = Math.min(buffer.byteLength, segmentBytes - received);
          const { bytesRead } = await fileHandle.read(buffer, 0, length, segmentStart + received);
          if (bytesRead === 0) throw new Error(`${artifact.path} is truncated in segment ${index}.`);
          const chunk = buffer.subarray(0, bytesRead);
          segment.update(chunk);
          whole.update(chunk);
          received += bytesRead;
        }
        const segmentDigest = segment.digest("hex");
        if (segmentDigest !== artifact.segments[index]) {
          throw new Error(`${artifact.path} segment ${index} SHA-256 mismatch.`);
        }
      }
      const digest = whole.digest("hex");
      if (digest !== artifact.sha256) throw new Error(`${artifact.path} whole-file SHA-256 mismatch.`);
    }
  } finally {
    await fileHandle.close();
  }
  return { format: 1, ...parsed };
}

function assertHeaderMatchesSeed(header, seed, model) {
  if (header.repo !== model.source.repo) throw new Error(`Repository mismatch for ${model.id}.`);
  if (header.revision !== model.source.revision) throw new Error(`Revision mismatch for ${model.id}.`);
  if (header.quantization !== seed.pipeline.quantization) throw new Error(`Quantization mismatch for ${model.id}.`);
  if (header.segmentSize !== DEFAULT_SEGMENT_SIZE) throw new Error(`Segment-size mismatch for ${model.id}.`);
  if (canonicalJson(header.license) !== canonicalJson(model.license)) throw new Error(`License metadata mismatch for ${model.id}.`);
  const expected = [...model.source.files].sort((left, right) => left.path.localeCompare(right.path));
  if (header.artifacts.length !== expected.length) throw new Error(`Artifact count mismatch for ${model.id}.`);
  for (const [index, artifact] of header.artifacts.entries()) {
    const pinned = expected[index];
    if (!pinned || artifact.path !== pinned.path) throw new Error(`Unknown or out-of-order artifact ${artifact.path}.`);
    if (artifact.size !== pinned.sizeBytes) throw new Error(`Size mismatch for ${artifact.path}.`);
    if (artifact.sha256 !== pinned.sha256) throw new Error(`SHA-256 allowlist mismatch for ${artifact.path}.`);
  }
}

async function hashFile(path, segmentSize) {
  const whole = createHash("sha256");
  const segments = [];
  let segment = createHash("sha256");
  let segmentBytes = 0;
  let size = 0;
  for await (const sourceChunk of createReadStream(path)) {
    let offset = 0;
    while (offset < sourceChunk.byteLength) {
      const length = Math.min(segmentSize - segmentBytes, sourceChunk.byteLength - offset);
      const chunk = sourceChunk.subarray(offset, offset + length);
      segment.update(chunk);
      whole.update(chunk);
      segmentBytes += length;
      size += length;
      offset += length;
      if (segmentBytes === segmentSize) {
        segments.push(segment.digest("hex"));
        segment = createHash("sha256");
        segmentBytes = 0;
      }
    }
  }
  if (segmentBytes > 0) segments.push(segment.digest("hex"));
  return { size, sha256: whole.digest("hex"), segments };
}

async function hashWholeFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertArtifactDirectory(directory, model) {
  const directoryInfo = await lstat(directory).catch(() => null);
  if (!directoryInfo?.isDirectory()) throw new Error(`Artifact directory does not exist: ${directory}`);
  const actualFiles = await listFiles(directory);
  const expectedFiles = model.source.files.map((file) => file.path).sort();
  if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
    const unexpected = actualFiles.filter((path) => !expectedFiles.includes(path));
    const missing = expectedFiles.filter((path) => !actualFiles.includes(path));
    throw new Error(`Artifact directory must exactly match the immutable manifest.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${unexpected.length ? ` Unknown: ${unexpected.join(", ")}.` : ""}`);
  }
  for (const expected of model.source.files) {
    const path = joinArtifactPath(directory, expected.path);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${expected.path} must be a regular, non-symlink file.`);
    if (info.size !== expected.sizeBytes) throw new Error(`${expected.path} has ${info.size} bytes; expected ${expected.sizeBytes}.`);
  }
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      files.push(relative(root, path).split(sep).join("/"));
    } else if (entry.isDirectory()) {
      files.push(...await listFiles(root, path));
    } else {
      files.push(relative(root, path).split(sep).join("/"));
    }
  }
  return files.sort();
}

function joinArtifactPath(root, artifactPath) {
  const path = resolve(root, ...artifactPath.split("/"));
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Unsafe artifact path ${artifactPath}.`);
  return path;
}

async function writeChunk(stream, chunk) {
  await new Promise((resolveWrite, rejectWrite) => {
    stream.write(chunk, (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });
}

async function writeNewFile(path, content) {
  await writeFile(path, content, { flag: "wx" });
}

async function assertNewOutput(path) {
  if (await stat(path).then(() => true, () => false)) throw new Error(`Refusing to overwrite existing output: ${path}`);
}

async function loadSeed(customPath) {
  const path = customPath ? resolve(String(customPath)) : DEFAULT_SEED;
  const seed = JSON.parse(await readFile(path, "utf8"));
  if (seed.schemaVersion !== 1 || !Array.isArray(seed.models) || seed.pipeline?.quantization !== "q4f16") {
    throw new Error("The model artifact seed has an unsupported schema.");
  }
  return seed;
}

function requireSeedModel(seed, modelId) {
  const model = seed.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown model identifier: ${modelId}`);
  if (typeof model.source?.repo !== "string" || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(model.source.repo)) {
    throw new Error(`${modelId} has no valid source repository.`);
  }
  if (!/^[a-f0-9]{40}$/.test(model.source?.revision ?? "")) throw new Error(`${modelId} does not pin an immutable revision.`);
  if (!Array.isArray(model.source?.files) || model.source.files.length === 0) throw new Error(`${modelId} has no artifact allowlist.`);
  const license = model.license;
  if (license?.spdx !== "CC-BY-NC-4.0"
    || typeof license.attribution !== "string" || license.attribution.length === 0
    || !isHttpsUrl(license.modelCardUrl)
    || !isHttpsUrl(license.acceptableUsePolicyUrl)) {
    throw new Error(`${modelId} has no approved non-commercial license metadata.`);
  }
  return model;
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) throw new UsageError(`Unexpected positional argument ${JSON.stringify(argument)}.`);
    const key = argument.slice(2);
    if (key === "license-reviewed") {
      options[key] = true;
      continue;
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new UsageError(`Missing value for --${key}.`);
    if (key !== "model-id" && key !== "artifact-dir" && key !== "output" && key !== "pack" && key !== "seed") {
      throw new UsageError(`Unknown option --${key}.`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) throw new UsageError(`Missing required --${key}.`);
  return value;
}

function printHelp() {
  console.error(`Usage:
  npm run model-pack -- build --model-id <id> --artifact-dir <dir> --output <file.sophon-model> --license-reviewed [--seed <file>]
  npm run model-pack -- verify --pack <file.sophon-model> [--model-id <id>] [--seed <file>]

The builder streams every artifact, requires an exact immutable-manifest match,
emits one deterministic data-only pack, verifies it, and writes checksum and
provenance sidecars. Generated packs must not be committed or copied into the
Chrome extension package.`);
}
