import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config.mjs";

test("serves a report-only CSP tailored to local inference and Hugging Face delivery", async () => {
  const routes = await nextConfig.headers();
  const headers = new Map(routes[0].headers.map(({ key, value }) => [key, value]));
  const policy = headers.get("Content-Security-Policy-Report-Only") ?? "";

  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/);
  assert.match(policy, /connect-src 'self' https:\/\/huggingface\.co https:\/\/\*\.huggingface\.co https:\/\/\*\.hf\.co https:\/\/\*\.xethub\.hf\.co/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /form-action 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
});
