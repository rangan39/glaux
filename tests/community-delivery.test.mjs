import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const { createCommunityModelDescriptor } = await import("../src/lib/model-catalog/index.ts");
const {
  createCommunityModelCache,
  getCommunityGraphArtifact,
  prepareCommunityModelDelivery,
  resolveCommunityDeliveryPlan
} = await import("../src/lib/model-delivery/community-delivery.ts");
const {
  InsufficientModelStorageError,
  ModelDeliveryUnavailableError
} = await import("../src/lib/model-delivery/errors.ts");

const REVISION = "a".repeat(40);

test("resolves graph-declared sidecars against immutable descriptor files", () => {
  const descriptor = createDescriptor();
  const plan = resolveCommunityDeliveryPlan(descriptor, ["model_q4f16.onnx_data"]);

  assert.equal(plan.descriptorId, descriptor.id);
  assert.deepEqual(plan.storageModel, {
    modelId: `community-Qwen2.5-0.5B-Instruct-${REVISION}-q4f16`,
    revision: REVISION
  });
  assert.equal(
    plan.graph.url,
    `https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/${REVISION}/onnx/model_q4f16.onnx`
  );
  assert.equal(plan.externalData[0].path, "onnx/model_q4f16.onnx_data");
  assert.equal(plan.externalData[0].location, "model_q4f16.onnx_data");
  assert.equal(plan.externalData[0].externalPath, `external-${"f".repeat(64)}`);
  assert.equal(plan.totalBytes, descriptor.format.totalBytes);
});

test("fails closed when graph locations are unsafe, absent, repeated, or differ from pinned totals", () => {
  const descriptor = createDescriptor();

  for (const locations of [
    ["../model.bin"],
    ["missing.bin"],
    ["model_q4f16.onnx_data", "model_q4f16.onnx_data"],
    []
  ]) {
    assert.throws(
      () => resolveCommunityDeliveryPlan(descriptor, locations),
      (error) => error instanceof ModelDeliveryUnavailableError
    );
  }
});

test("downloads the graph first, discovers sidecars, and returns OPFS-backed files", async () => {
  const graphBytes = createGraphWithExternalLocation("model_q4f16.onnx_data");
  const descriptor = createDescriptor({ graphSize: graphBytes.length, externalSize: 3 });
  const graphFile = new File([graphBytes], "model_q4f16.onnx");
  const externalFile = new File([Uint8Array.of(1, 2, 3)], "model_q4f16.onnx_data");
  const opened = [];
  const closed = [];
  const downloads = [];
  const progress = [];
  const dependencies = {
    supportsPersistentDelivery: () => true,
    estimateStorage: async () => ({ quota: 1_000_000, usage: 10 }),
    createStateStore: () => ({}),
    async openFile(model, artifact) {
      opened.push({ model, artifact });
      return {
        file: {},
        close() { closed.push(artifact.path); }
      };
    },
    async download(options) {
      downloads.push(options.artifact);
      options.onProgress?.({
        loaded: options.artifact.size,
        total: options.artifact.size,
        stage: "cache",
        resumedBytes: 0,
        networkBytes: options.artifact.size
      });
      return options.artifact.url.endsWith("model_q4f16.onnx") ? graphFile : externalFile;
    }
  };

  const delivery = await prepareCommunityModelDelivery(
    descriptor,
    (event) => progress.push(event),
    undefined,
    dependencies
  );

  assert.deepEqual(opened.map(({ artifact }) => artifact.path), [
    "onnx/model_q4f16.onnx",
    "onnx/model_q4f16.onnx_data"
  ]);
  assert.deepEqual(downloads.map(({ sha256 }) => sha256), ["d".repeat(64), "f".repeat(64)]);
  assert.deepEqual(closed, ["onnx/model_q4f16.onnx", "onnx/model_q4f16.onnx_data"]);
  assert.equal(delivery.graph.data, graphFile);
  assert.deepEqual(delivery.externalData, [{ path: "model_q4f16.onnx_data", data: externalFile }]);
  assert.equal(delivery.totalBytes, graphBytes.length + 3);
  assert.deepEqual(progress.at(-1), {
    loaded: graphBytes.length + 3,
    total: graphBytes.length + 3,
    stage: "cache",
    resumedBytes: 0,
    networkBytes: graphBytes.length + 3
  });
});

test("checks browser storage before opening any model files", async () => {
  const descriptor = createDescriptor();
  let opened = false;

  await assert.rejects(
    prepareCommunityModelDelivery(descriptor, undefined, undefined, {
      supportsPersistentDelivery: () => true,
      estimateStorage: async () => ({ quota: 100, usage: 90 }),
      createStateStore: () => ({}),
      async openFile() { opened = true; throw new Error("should not open"); },
      async download() { throw new Error("should not download"); }
    }),
    (error) => error instanceof InsufficientModelStorageError
      && error.requiredBytes === descriptor.format.totalBytes
      && error.availableBytes === 10
  );
  assert.equal(opened, false);
});

test("subtracts durable resumable segments from the storage preflight", async () => {
  const graphBytes = createGraphWithExternalLocation("model_q4f16.onnx_data");
  const descriptor = createDescriptor({ graphSize: graphBytes.length, externalSize: 3 });
  const graph = getCommunityGraphArtifact(descriptor);
  const graphFile = new File([graphBytes], "model_q4f16.onnx");
  const externalFile = new File([Uint8Array.of(1, 2, 3)], "model_q4f16.onnx_data");

  const delivery = await prepareCommunityModelDelivery(descriptor, undefined, undefined, {
    supportsPersistentDelivery: () => true,
    estimateStorage: async () => ({ quota: 100, usage: 97 }),
    getArtifactStates: async () => [{
      key: graph.key,
      version: 1,
      size: graph.size,
      sha256: graph.sha256,
      segmentSize: 64 * 1024 * 1024,
      etag: "\"pinned\"",
      completed: [0],
      status: "ready"
    }],
    getFileSize: async (_model, artifact) => artifact.path === graph.path ? graph.size : 0,
    createStateStore: () => ({}),
    async openFile() { return { file: {}, close() {} }; },
    async download({ artifact }) {
      return artifact.url.endsWith("model_q4f16.onnx") ? graphFile : externalFile;
    }
  });

  assert.equal(delivery.totalBytes, graphBytes.length + 3);
});

test("serves the prepared graph from a custom cache and delegates other requests", async () => {
  const descriptor = createDescriptor();
  const graph = getCommunityGraphArtifact(descriptor);
  const fallbackEvents = [];
  const fallback = {
    async match(request) {
      fallbackEvents.push(["match", request]);
      return new Response("fallback");
    },
    async put(request) {
      fallbackEvents.push(["put", request]);
    }
  };
  const cache = createCommunityModelCache({
    plan: resolveCommunityDeliveryPlan(descriptor, ["model_q4f16.onnx_data"]),
    graph: { url: graph.url, data: new File(["graph"], "model.onnx") },
    externalData: [],
    totalBytes: descriptor.format.totalBytes
  }, fallback);

  const cached = await cache.match(graph.url);
  assert.equal(await cached.text(), "graph");
  assert.equal(cached.headers.get("content-length"), "5");
  assert.equal(await (await cache.match("https://example.test/config.json")).text(), "fallback");
  await cache.put(graph.url, new Response("ignored"));
  await cache.put("https://example.test/config.json", new Response("saved"));
  assert.deepEqual(fallbackEvents, [
    ["match", "https://example.test/config.json"],
    ["put", "https://example.test/config.json"]
  ]);
});

function createDescriptor({ graphSize = 480_000_000, externalSize = 20_000_000 } = {}) {
  return createCommunityModelDescriptor({
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
        size: graphSize,
        blobId: "c".repeat(40),
        sha256: "d".repeat(64)
      },
      {
        path: "onnx/model_q4f16.onnx_data",
        size: externalSize,
        blobId: "e".repeat(40),
        sha256: "f".repeat(64)
      }
    ]
  });
}

function createGraphWithExternalLocation(location) {
  const encoder = new TextEncoder();
  const entry = message(
    bytesField(1, encoder.encode("location")),
    bytesField(2, encoder.encode(location))
  );
  const tensor = message(bytesField(13, entry));
  return message(bytesField(7, message(bytesField(5, tensor))));
}

function bytesField(field, value) {
  return Uint8Array.from([...varint((field << 3) | 2), ...varint(value.length), ...value]);
}

function message(...fields) {
  return Uint8Array.from(fields.flatMap((field) => [...field]));
}

function varint(value) {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return bytes;
}
