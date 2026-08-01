import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const {
  assessCommunityModelCompatibility,
  CommunityModelDescriptorError,
  CommunityModelDescriptorStoreError,
  createCommunityModelDescriptor,
  deleteSavedCommunityModelDescriptor,
  getSavedCommunityModelDescriptor,
  listSavedCommunityModelDescriptors,
  parseCommunityModelDescriptor,
  saveCommunityModelDescriptor
} = await import("../src/lib/model-catalog/index.ts");

const REVISION = "a".repeat(40);

function modelDetails(overrides = {}) {
  return {
    repo: "onnx-community/Qwen2.5-0.5B-Instruct",
    name: "Qwen2.5-0.5B-Instruct",
    revision: REVISION,
    pipelineTask: "text-generation",
    libraryName: "transformers.js",
    gated: false,
    private: false,
    downloads: 1234,
    likes: 42,
    updatedAt: "2026-07-30T12:00:00.000Z",
    tags: ["transformers.js", "text-generation"],
    license: "apache-2.0",
    architecture: "Qwen2ForCausalLM",
    modelType: "qwen2",
    chatTemplate: "{{ messages }}",
    baseModel: "Qwen/Qwen2.5-0.5B-Instruct",
    files: [
      { path: "config.json", size: 100, blobId: "b".repeat(40), sha256: null },
      {
        path: "onnx/model_q4f16.onnx",
        size: 480_000_000,
        blobId: "c".repeat(40),
        sha256: "d".repeat(64)
      },
      {
        path: "onnx/model_q4f16.onnx_data",
        size: 20_000_000,
        blobId: "e".repeat(40),
        sha256: "f".repeat(64)
      },
      { path: "tokenizer.json", size: 2_000, blobId: "1".repeat(40), sha256: null }
    ],
    ...overrides
  };
}

function createMemoryStorage() {
  const values = new Map();
  return {
    values,
    storage: {
      async get(id) {
        const value = values.get(id);
        return value === undefined ? undefined : structuredClone(value);
      },
      async getAll() {
        return [...values.values()].map((value) => structuredClone(value));
      },
      async put(descriptor) {
        values.set(descriptor.id, structuredClone(descriptor));
      },
      async delete(id) {
        values.delete(id);
      }
    }
  };
}

test("creates a frozen immutable descriptor from a compatible pinned model", () => {
  const descriptor = createCommunityModelDescriptor(modelDetails());

  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.id, `hf:onnx-community/Qwen2.5-0.5B-Instruct@${REVISION}:q4f16`);
  assert.deepEqual(descriptor.source, {
    kind: "huggingface",
    repo: "onnx-community/Qwen2.5-0.5B-Instruct",
    revision: REVISION
  });
  assert.deepEqual(descriptor.format, {
    dtype: "q4f16",
    graphPath: "onnx/model_q4f16.onnx",
    totalBytes: 500_000_000
  });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.files), true);
  assert.equal(Object.isFrozen(descriptor.files[0]), true);
});

test("round-trips serialized descriptors through strict validation", () => {
  const descriptor = createCommunityModelDescriptor(modelDetails());
  const parsed = parseCommunityModelDescriptor(JSON.parse(JSON.stringify(descriptor)));

  assert.deepEqual(parsed, descriptor);
});

test("rejects descriptor mutations that break identity, paths, or graph byte totals", () => {
  const descriptor = createCommunityModelDescriptor(modelDetails());
  const wrongIdentity = structuredClone(descriptor);
  wrongIdentity.id = "hf:onnx-community/other@invalid:q4f16";
  const wrongTotal = structuredClone(descriptor);
  wrongTotal.format.totalBytes += 1;
  const unsafePath = structuredClone(descriptor);
  unsafePath.files[0].path = "%2e%2e/secret";

  assert.equal(parseCommunityModelDescriptor(wrongIdentity), null);
  assert.equal(parseCommunityModelDescriptor(wrongTotal), null);
  assert.equal(parseCommunityModelDescriptor(unsafePath), null);
});

test("requires Hub integrity metadata for every selected graph artifact", () => {
  const details = modelDetails({
    files: modelDetails().files.map((file) => file.path === "onnx/model_q4f16.onnx_data"
      ? { ...file, blobId: null, sha256: null }
      : file)
  });
  const compatibility = assessCommunityModelCompatibility(details);

  assert.equal(compatibility.status, "unsupported");
  assert.ok(compatibility.issues.some(({ code }) => code === "file-integrity-missing"));
  assert.throws(
    () => createCommunityModelDescriptor(details),
    (error) => error instanceof CommunityModelDescriptorError && error.code === "unsupported"
  );
});

test("persists, reads, lists, and deletes immutable descriptors", async () => {
  const { storage } = createMemoryStorage();
  const qwen = createCommunityModelDescriptor(modelDetails());
  const other = createCommunityModelDescriptor(modelDetails({
    repo: "onnx-community/Alpha-model",
    name: "Alpha model"
  }));

  assert.deepEqual(await saveCommunityModelDescriptor(qwen, storage), qwen);
  assert.deepEqual(await saveCommunityModelDescriptor(qwen, storage), qwen);
  assert.deepEqual(await saveCommunityModelDescriptor(other, storage), other);
  assert.deepEqual(await getSavedCommunityModelDescriptor(qwen.id, storage), qwen);
  assert.deepEqual((await listSavedCommunityModelDescriptors(storage)).map(({ name }) => name), [
    "Alpha model",
    "Qwen2.5-0.5B-Instruct"
  ]);

  await deleteSavedCommunityModelDescriptor(qwen.id, storage);
  assert.equal(await getSavedCommunityModelDescriptor(qwen.id, storage), null);
});

test("refuses to overwrite a different descriptor with the same immutable identity", async () => {
  const { storage } = createMemoryStorage();
  const descriptor = createCommunityModelDescriptor(modelDetails());
  const conflicting = parseCommunityModelDescriptor({ ...structuredClone(descriptor), name: "Changed name" });
  assert.ok(conflicting);
  await saveCommunityModelDescriptor(descriptor, storage);

  await assert.rejects(
    saveCommunityModelDescriptor(conflicting, storage),
    (error) => error instanceof CommunityModelDescriptorStoreError && error.code === "conflict"
  );
});

test("does not silently replace corrupt saved descriptor state", async () => {
  const { storage, values } = createMemoryStorage();
  const descriptor = createCommunityModelDescriptor(modelDetails());
  values.set(descriptor.id, { id: descriptor.id, schemaVersion: 1 });

  await assert.rejects(
    saveCommunityModelDescriptor(descriptor, storage),
    (error) => error instanceof CommunityModelDescriptorStoreError && error.code === "corrupt"
  );
  assert.deepEqual(await listSavedCommunityModelDescriptors(storage), []);
});

test("wraps unexpected IndexedDB-style failures with an actionable storage error", async () => {
  const descriptor = createCommunityModelDescriptor(modelDetails());
  const failingStorage = {
    async get() { throw new Error("database closed"); },
    async getAll() { throw new Error("database closed"); },
    async put() {},
    async delete() {}
  };

  await assert.rejects(
    saveCommunityModelDescriptor(descriptor, failingStorage),
    (error) => error instanceof CommunityModelDescriptorStoreError && error.code === "storage-failed"
  );
});
