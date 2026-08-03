import assert from "node:assert/strict";
import test from "node:test";

import { parseGitHubStarCount } from "../src/lib/github-repository.ts";

test("reads a valid GitHub repository star count", () => {
  assert.equal(parseGitHubStarCount({ stargazers_count: 1_234 }), 1_234);
  assert.equal(parseGitHubStarCount({ stargazers_count: 0 }), 0);
});

test("rejects missing or malformed GitHub star counts", () => {
  assert.equal(parseGitHubStarCount({}), null);
  assert.equal(parseGitHubStarCount({ stargazers_count: "123" }), null);
  assert.equal(parseGitHubStarCount({ stargazers_count: -1 }), null);
  assert.equal(parseGitHubStarCount({ stargazers_count: 1.5 }), null);
  assert.equal(parseGitHubStarCount(null), null);
});
