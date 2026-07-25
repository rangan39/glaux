import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const {
  canonicalJson,
  encodeSophonModelPackPreamble,
  ModelPackFormatError,
  parseSophonModelPack,
  SOPHON_MODEL_PACK_MAGIC,
  SOPHON_MODEL_PACK_PREAMBLE_BYTES
} = await import("../src/lib/model-delivery/pack-format.ts");
const { getModelDeliveryManifest, MODEL_SEGMENT_SIZE } = await import("../src/lib/model-delivery/manifest.ts");
const { ModelPackValidationError, validatePackAllowlist } = await import("../src/lib/model-delivery/model-pack-importer.ts");

const LICENSE = {
  spdx: "CC-BY-NC-4.0",
  modelCardUrl: "https://example.test/model",
  acceptableUsePolicyUrl: "https://example.test/aup",
  attribution: "Fixture model attribution."
};
const PAYLOAD = new TextEncoder().encode("bounded streaming fixture");

test("parses one canonical framed pack without reading beyond the bounded header", async () => {
  const file = packBlob(fixtureHeader(), PAYLOAD);
  const parsed = await parseSophonModelPack(file);
  assert.equal(parsed.payloadOffset, SOPHON_MODEL_PACK_PREAMBLE_BYTES + new TextEncoder().encode(canonicalJson(fixtureHeader())).byteLength);
  assert.equal(parsed.payloadBytes, PAYLOAD.byteLength);
  assert.deepEqual(parsed.header, fixtureHeader());
});

test("rejects unsupported versions, non-canonical headers, truncation, and trailing bytes", async () => {
  const valid = packBlob(fixtureHeader(), PAYLOAD);
  const unsupported = new Uint8Array(await valid.arrayBuffer());
  new DataView(unsupported.buffer).setUint32(SOPHON_MODEL_PACK_MAGIC.byteLength, 2, true);
  await rejectsWithCode(new Blob([unsupported]), "unsupported-format");

  const prettyHeader = new TextEncoder().encode(JSON.stringify(fixtureHeader(), null, 2));
  const nonCanonicalPreamble = new Uint8Array(SOPHON_MODEL_PACK_PREAMBLE_BYTES + prettyHeader.byteLength);
  nonCanonicalPreamble.set(SOPHON_MODEL_PACK_MAGIC);
  const view = new DataView(nonCanonicalPreamble.buffer);
  view.setUint32(SOPHON_MODEL_PACK_MAGIC.byteLength, 1, true);
  view.setUint32(SOPHON_MODEL_PACK_MAGIC.byteLength + 4, prettyHeader.byteLength, true);
  nonCanonicalPreamble.set(prettyHeader, SOPHON_MODEL_PACK_PREAMBLE_BYTES);
  await rejectsWithCode(new Blob([nonCanonicalPreamble, PAYLOAD]), "invalid-header");
  await rejectsWithCode(valid.slice(0, valid.size - 1), "truncated-file");
  await rejectsWithCode(new Blob([valid, Uint8Array.of(0)]), "trailing-data");
});

test("rejects traversal, duplicate paths, gaps, unsafe integers, and Unicode path tricks", async () => {
  for (const path of ["../model.bin", "/model.bin", "onnx\\model.bin", "onnx/./model.bin", "onnx/mοdel.bin"]) {
    const header = fixtureHeader();
    header.artifacts[0].path = path;
    await rejectsWithCode(packBlob(header, PAYLOAD), "invalid-header");
  }

  const duplicate = fixtureHeader();
  duplicate.artifacts.push({ ...duplicate.artifacts[0], offset: PAYLOAD.byteLength });
  await rejectsWithCode(packBlob(duplicate, new Uint8Array(PAYLOAD.byteLength * 2)), "invalid-header");

  const gap = fixtureHeader();
  gap.artifacts[0].offset = 1;
  await rejectsWithCode(packBlob(gap, PAYLOAD), "invalid-header");

  const unsafe = fixtureHeader();
  unsafe.artifacts[0].size = Number.MAX_SAFE_INTEGER + 1;
  const unsafeJson = JSON.stringify(unsafe);
  await rejectsWithCode(rawPack(unsafeJson, new Uint8Array()), "invalid-header");
});

test("matches every pack field against Sophon's compiled model allowlist", () => {
  const manifest = getModelDeliveryManifest("tiny-aya-global");
  const header = allowlistedHeader(manifest);
  assert.equal(validatePackAllowlist(header, manifest.modelId), manifest);

  const wrongTarget = structuredClone(header);
  assert.throws(() => validatePackAllowlist(wrongTarget, "tiny-aya-water"), (error) =>
    error instanceof ModelPackValidationError && error.code === "wrong-model");

  const wrongRevision = structuredClone(header);
  wrongRevision.revision = "0".repeat(40);
  assert.throws(() => validatePackAllowlist(wrongRevision), (error) =>
    error instanceof ModelPackValidationError && error.code === "revision-mismatch");

  const wrongLicense = structuredClone(header);
  wrongLicense.license.attribution += " changed";
  assert.throws(() => validatePackAllowlist(wrongLicense), (error) =>
    error instanceof ModelPackValidationError && error.code === "license-mismatch");

  const corruptSegmentMetadata = structuredClone(header);
  corruptSegmentMetadata.artifacts.find((artifact) => artifact.path.includes(".onnx_data")).segments[0] = "f".repeat(64);
  assert.throws(() => validatePackAllowlist(corruptSegmentMetadata), (error) =>
    error instanceof ModelPackValidationError && error.code === "artifact-mismatch");
});

function fixtureHeader() {
  const sha256 = digest(PAYLOAD);
  return {
    schemaVersion: 1,
    modelId: "fixture-model",
    repo: "fixture/model",
    revision: "0123456789abcdef0123456789abcdef01234567",
    quantization: "q4f16",
    segmentSize: 64,
    artifacts: [{
      path: "onnx/model.bin",
      offset: 0,
      size: PAYLOAD.byteLength,
      sha256,
      segments: [sha256]
    }],
    license: { ...LICENSE }
  };
}

function allowlistedHeader(manifest) {
  let offset = 0;
  const artifacts = [
    ...manifest.externalData.map((artifact) => ({
      path: artifact.path,
      size: artifact.size,
      sha256: artifact.sha256,
      segments: [...artifact.segmentSha256]
    })),
    ...manifest.auxiliary.map((artifact) => ({
      path: artifact.path,
      size: artifact.size,
      sha256: artifact.sha256,
      segments: [artifact.sha256]
    }))
  ].sort((left, right) => left.path.localeCompare(right.path)).map((artifact) => {
    const framed = { ...artifact, offset };
    offset += artifact.size;
    return framed;
  });
  return {
    schemaVersion: 1,
    modelId: manifest.modelId,
    repo: manifest.repo,
    revision: manifest.revision,
    quantization: manifest.quantization,
    segmentSize: MODEL_SEGMENT_SIZE,
    artifacts,
    license: { ...manifest.license }
  };
}

function packBlob(header, payload) {
  return new Blob([encodeSophonModelPackPreamble(header), payload]);
}

function rawPack(headerJson, payload) {
  const header = new TextEncoder().encode(headerJson);
  const preamble = new Uint8Array(SOPHON_MODEL_PACK_PREAMBLE_BYTES + header.byteLength);
  preamble.set(SOPHON_MODEL_PACK_MAGIC);
  const view = new DataView(preamble.buffer);
  view.setUint32(SOPHON_MODEL_PACK_MAGIC.byteLength, 1, true);
  view.setUint32(SOPHON_MODEL_PACK_MAGIC.byteLength + 4, header.byteLength, true);
  preamble.set(header, SOPHON_MODEL_PACK_PREAMBLE_BYTES);
  return new Blob([preamble, payload]);
}

async function rejectsWithCode(file, code) {
  await assert.rejects(parseSophonModelPack(file), (error) =>
    error instanceof ModelPackFormatError && error.code === code);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
