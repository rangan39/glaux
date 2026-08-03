import assert from "node:assert/strict";
import test from "node:test";

const { POST } = await import("../src/app/api/storage/reset/route.ts");

function resetRequest(headers = {}) {
  return new Request("https://glaux.example/api/storage/reset", {
    method: "POST",
    headers
  });
}

test("asks the browser to clear same-origin Glaux storage without caching the response", async () => {
  const response = await POST(resetRequest({
    origin: "https://glaux.example",
    "sec-fetch-site": "same-origin",
    "x-glaux-storage-reset": "1"
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Clear-Site-Data"), '"storage"');
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("denies reset requests without an explicit same-origin user flow", async () => {
  for (const request of [
    resetRequest({ "sec-fetch-site": "same-origin" }),
    resetRequest({ "sec-fetch-site": "cross-site", "x-glaux-storage-reset": "1" }),
    resetRequest({ origin: "https://attacker.example", "sec-fetch-site": "same-origin", "x-glaux-storage-reset": "1" })
  ]) {
    const response = await POST(request);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Clear-Site-Data"), null);
  }
});
