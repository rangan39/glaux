import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const { ensureAuxiliaryArtifact, TRANSFORMERS_CACHE_NAME } = await import("../src/lib/model-delivery/auxiliary-cache.ts");

test("rejects a corrupt cached auxiliary file and replaces it with pinned packaged bytes", async () => {
  const expected = new TextEncoder().encode("verified tokenizer metadata");
  const corrupt = expected.map((value) => value ^ 0xff);
  const artifact = { path: "tokenizer_config.json", bundledPath: "fixture/tokenizer_config.json", size: expected.length, sha256: digest(expected) };
  const model = {
    modelId: "fixture-model",
    repo: "fixture/repo",
    revision: "0123456789012345678901234567890123456789",
    externalData: [],
    auxiliary: [artifact]
  };
  const key = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${artifact.path}`;
  const cache = new MemoryCache();
  await cache.put(key, new Response(corrupt, { headers: { "content-length": String(corrupt.length) } }));
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { open: async (name) => {
      assert.equal(name, TRANSFORMERS_CACHE_NAME);
      return cache;
    } }
  });
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests += 1;
    assert.equal(String(url), `/model-runtime/${artifact.bundledPath}`);
    return new Response(expected, { headers: { "content-length": String(expected.length), "content-type": "application/json" } });
  };
  const progress = [];

  try {
    await ensureAuxiliaryArtifact(model, artifact, (event) => progress.push(event));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests, 1);
  assert.deepEqual(new Uint8Array(await (await cache.match(key)).arrayBuffer()), expected);
  assert.ok(progress.some(({ stage }) => stage === "verify"));
  assert.ok(progress.every(({ networkBytes }) => networkBytes === 0));
  assert.equal(progress.at(-1)?.stage, "cache");
});

test("cancels both verification and the streamed cache write", async () => {
  const expected = Uint8Array.from({ length: 256 }, (_, index) => index);
  const artifact = { path: "onnx/model_q4f16.onnx", bundledPath: "fixture/model_q4f16.onnx", size: expected.length, sha256: digest(expected) };
  const model = {
    modelId: "cancel-model",
    repo: "fixture/repo",
    revision: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    externalData: [],
    auxiliary: [artifact]
  };
  const key = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${artifact.path}`;
  const cache = new MemoryCache();
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { open: async () => cache }
  });
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(streamController) {
      streamController.enqueue(expected.slice(0, 128));
      setTimeout(() => {
        try {
          streamController.enqueue(expected.slice(128));
          streamController.close();
        } catch {
          // Cancellation closes the stream before the delayed source completes.
        }
      }, 50);
    }
  }), { headers: { "content-length": String(expected.length) } });

  try {
    await assert.rejects(
      ensureAuxiliaryArtifact(model, artifact, ({ loaded }) => {
        if (loaded > 0) controller.abort(new DOMException("Test cancellation", "AbortError"));
      }, controller.signal),
      /cancell/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(await cache.match(key), undefined);
});

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

class MemoryCache {
  #entries = new Map();

  async match(key) {
    return this.#entries.get(String(key))?.clone();
  }

  async put(key, response) {
    const bytes = await response.arrayBuffer();
    this.#entries.set(String(key), new Response(bytes, { headers: response.headers }));
  }

  async delete(key) {
    return this.#entries.delete(String(key));
  }
}
