import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const {
  assessCommunityModelCompatibility,
  buildOnnxCommunityCatalogUrl,
  buildOnnxCommunityIndexUrl,
  fetchOnnxCommunityCatalog,
  fetchOnnxCommunityIndexPage,
  fetchOnnxCommunityModelDetails,
  HuggingFaceCatalogError
} = await import("../src/lib/model-catalog/index.ts");

const REVISION = "a".repeat(40);

function hubModel(overrides = {}) {
  return {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    sha: REVISION,
    pipeline_tag: "text-generation",
    library_name: "transformers.js",
    gated: false,
    private: false,
    downloads: 1234,
    likes: 42,
    lastModified: "2026-07-30T12:00:00.000Z",
    tags: ["transformers.js", "text-generation", "license:apache-2.0"],
    cardData: { license: "apache-2.0", base_model: "Qwen/Qwen2.5-0.5B-Instruct" },
    config: {
      architectures: ["Qwen2ForCausalLM"],
      model_type: "qwen2",
      tokenizer_config: { chat_template: "\n{{ messages }}\n" }
    },
    siblings: [
      { rfilename: "config.json", size: 100, blobId: "b".repeat(40) },
      {
        rfilename: "onnx/model_q4f16.onnx",
        size: 480_000_000,
        blobId: "c".repeat(40),
        lfs: { size: 480_000_000, sha256: "d".repeat(64) }
      },
      {
        rfilename: "onnx/model_q4f16.onnx_data",
        size: 20_000_000,
        blobId: "e".repeat(40),
        lfs: { size: 20_000_000, sha256: "f".repeat(64) }
      },
      { rfilename: "tokenizer.json", size: 2_000, blobId: "1".repeat(40) }
    ],
    ...overrides
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers }
  });
}

test("builds a constrained ONNX Community text-generation query", () => {
  const url = buildOnnxCommunityCatalogUrl({
    search: "  qwen  ",
    cursor: "next-page",
    limit: 500
  });

  assert.equal(url.origin, "https://huggingface.co");
  assert.equal(url.pathname, "/api/models");
  assert.equal(url.searchParams.get("author"), "onnx-community");
  assert.equal(url.searchParams.get("filter"), "transformers.js");
  assert.equal(url.searchParams.get("pipeline_tag"), "text-generation");
  assert.equal(url.searchParams.get("gated"), "false");
  assert.equal(url.searchParams.get("search"), "qwen");
  assert.equal(url.searchParams.get("cursor"), "next-page");
  assert.equal(url.searchParams.get("limit"), "50");
});

test("builds an unfiltered namespace index query for browser-side metadata search", () => {
  const url = buildOnnxCommunityIndexUrl({ cursor: "next-page", limit: 500 });
  assert.equal(url.searchParams.get("author"), "onnx-community");
  assert.equal(url.searchParams.get("gated"), "false");
  assert.equal(url.searchParams.get("sort"), "downloads");
  assert.equal(url.searchParams.get("full"), "true");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("cursor"), "next-page");
  assert.equal(url.searchParams.has("search"), false);
  assert.equal(url.searchParams.has("filter"), false);
  assert.equal(url.searchParams.has("pipeline_tag"), false);
});

test("indexes public namespace models even when optional task and library metadata are absent", async () => {
  const page = await fetchOnnxCommunityIndexPage({}, async () => jsonResponse([
    hubModel({
      id: "onnx-community/tiny-aya-global-ONNX",
      pipeline_tag: undefined,
      library_name: undefined,
      tags: ["onnx", "cohere2"]
    })
  ]));
  assert.equal(page.models.length, 1);
  assert.equal(page.models[0].name, "tiny-aya-global-ONNX");
  assert.deepEqual(page.models[0].tags, ["onnx", "cohere2"]);
});

test("normalizes public catalog entries and ignores restricted or foreign repositories", async () => {
  const page = await fetchOnnxCommunityCatalog({}, async () => jsonResponse([
    hubModel(),
    hubModel({ id: "onnx-community/Qwen2.5-0.5B-Instruct" }),
    hubModel({ id: "another-org/model" }),
    hubModel({ id: "onnx-community/gated-model", gated: "manual" }),
    hubModel({ id: "onnx-community/private-model", private: true }),
    null
  ], {
    headers: {
      link: '<https://huggingface.co/api/models?author=onnx-community&cursor=cursor-token>; rel="next"'
    }
  }));

  assert.equal(page.models.length, 1);
  assert.deepEqual(page.models[0], {
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
    tags: ["transformers.js", "text-generation", "license:apache-2.0"],
    license: "apache-2.0"
  });
  assert.equal(page.nextCursor, "cursor-token");
});

test("pins model details to the requested revision and preserves file integrity metadata", async () => {
  let requestedUrl = null;
  const details = await fetchOnnxCommunityModelDetails(
    "onnx-community/Qwen2.5-0.5B-Instruct",
    REVISION,
    {},
    async (url) => {
      requestedUrl = new URL(url);
      return jsonResponse(hubModel());
    }
  );

  assert.equal(requestedUrl.pathname, `/api/models/onnx-community/Qwen2.5-0.5B-Instruct/revision/${REVISION}`);
  assert.equal(requestedUrl.searchParams.get("blobs"), "true");
  assert.equal(details.revision, REVISION);
  assert.equal(details.architecture, "Qwen2ForCausalLM");
  assert.equal(details.modelType, "qwen2");
  assert.equal(details.chatTemplate, "\n{{ messages }}\n");
  assert.equal(details.baseModel, "Qwen/Qwen2.5-0.5B-Instruct");
  assert.deepEqual(details.files.find(({ path }) => path === "onnx/model_q4f16.onnx"), {
    path: "onnx/model_q4f16.onnx",
    size: 480_000_000,
    blobId: "c".repeat(40),
    sha256: "d".repeat(64)
  });
});

test("rejects responses that drift from the requested immutable revision", async () => {
  await assert.rejects(
    fetchOnnxCommunityModelDetails(
      "onnx-community/Qwen2.5-0.5B-Instruct",
      REVISION,
      {},
      async () => jsonResponse(hubModel({ sha: "9".repeat(40) }))
    ),
    (error) => error instanceof HuggingFaceCatalogError && error.code === "revision-mismatch"
  );
});

test("rejects unsafe repository file paths", async () => {
  await assert.rejects(
    fetchOnnxCommunityModelDetails(
      "onnx-community/Qwen2.5-0.5B-Instruct",
      REVISION,
      {},
      async () => jsonResponse(hubModel({ siblings: [{ rfilename: "../model.onnx", size: 10 }] }))
    ),
    (error) => error instanceof HuggingFaceCatalogError && error.code === "response"
  );
});

test("selects the preferred WebGPU graph and includes its external data", async () => {
  const details = await fetchOnnxCommunityModelDetails(
    "onnx-community/Qwen2.5-0.5B-Instruct",
    REVISION,
    {},
    async () => jsonResponse(hubModel())
  );
  const compatibility = assessCommunityModelCompatibility(details);

  assert.equal(compatibility.status, "compatible");
  assert.equal(compatibility.selectedDtype, "q4f16");
  assert.equal(compatibility.selectedGraph, "onnx/model_q4f16.onnx");
  assert.equal(compatibility.estimatedDownloadBytes, 500_000_000);
  assert.deepEqual(compatibility.issues, []);
});

test("keeps missing license metadata as a warning instead of blocking a model", async () => {
  const details = await fetchOnnxCommunityModelDetails(
    "onnx-community/Qwen2.5-0.5B-Instruct",
    REVISION,
    {},
    async () => jsonResponse(hubModel({ tags: ["transformers.js"], cardData: {} }))
  );
  const compatibility = assessCommunityModelCompatibility(details);

  assert.equal(compatibility.status, "compatible");
  assert.deepEqual(compatibility.issues.map(({ code, severity }) => ({ code, severity })), [
    { code: "license-missing", severity: "warning" }
  ]);
});

test("allows missing task and library hints when runtime artifacts prove compatibility", async () => {
  const details = await fetchOnnxCommunityModelDetails(
    "onnx-community/Qwen2.5-0.5B-Instruct",
    REVISION,
    {},
    async () => jsonResponse(hubModel({ pipeline_tag: undefined, library_name: undefined }))
  );
  const compatibility = assessCommunityModelCompatibility(details);
  assert.equal(compatibility.status, "compatible");
  assert.equal(compatibility.issues.some(({ code }) => code === "unsupported-task" || code === "unsupported-library"), false);
});

test("reports actionable reasons for incompatible chat models", async () => {
  const details = await fetchOnnxCommunityModelDetails(
    "onnx-community/Qwen2.5-0.5B-Instruct",
    REVISION,
    {},
    async () => jsonResponse(hubModel({
      library_name: "transformers",
      tags: [],
      cardData: {},
      config: { architectures: ["UnknownForCausalLM"], model_type: "unknown", tokenizer_config: {} },
      siblings: [{ rfilename: "onnx/model_q1.onnx", size: 500_000_000 }]
    }))
  );
  const compatibility = assessCommunityModelCompatibility(details);
  const issueCodes = compatibility.issues.map(({ code }) => code);

  assert.equal(compatibility.status, "unsupported");
  assert.equal(compatibility.selectedGraph, null);
  assert.ok(issueCodes.includes("unsupported-library"));
  assert.ok(issueCodes.includes("unsupported-architecture"));
  assert.ok(issueCodes.includes("chat-template-missing"));
  assert.ok(issueCodes.includes("onnx-graph-missing"));
  assert.ok(issueCodes.includes("license-missing"));
});

test("applies a configurable model-size safety limit", async () => {
  const details = await fetchOnnxCommunityModelDetails(
    "onnx-community/Qwen2.5-0.5B-Instruct",
    REVISION,
    {},
    async () => jsonResponse(hubModel())
  );
  const compatibility = assessCommunityModelCompatibility(details, { maxDownloadBytes: 400_000_000 });

  assert.equal(compatibility.status, "unsupported");
  assert.ok(compatibility.issues.some(({ code }) => code === "model-too-large"));
});
