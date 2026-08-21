import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSourceFiles,
  shouldIncludeSource,
} from "../../scripts/check_javascript_sources.mjs";

test("classifies web and runtime syntax-check scopes without generated bundles", () => {
  assert.equal(shouldIncludeSource("docs/app.js", "web"), true);
  assert.equal(shouldIncludeSource("shared/series-integrity.mjs", "web"), true);
  assert.equal(shouldIncludeSource("scripts/pages-entry.mjs", "web"), true);
  assert.equal(shouldIncludeSource("scripts/feature-entries/ai-feature.mjs", "web"), true);
  assert.equal(shouldIncludeSource("docs/assets/app.bundle.min.js", "web"), false);
  assert.equal(shouldIncludeSource("scripts/local_pages_server.mjs", "runtime"), true);
  assert.equal(shouldIncludeSource("scripts/feature-entries/ai-feature.mjs", "runtime"), false);
  assert.equal(shouldIncludeSource("worker/src/index.mjs", "runtime"), true);
  assert.equal(shouldIncludeSource("docs/app.js", "runtime"), false);
});

test("discovers newly added source modules automatically", async () => {
  const web = await collectSourceFiles("web");
  const runtime = await collectSourceFiles("runtime");

  assert.equal(web.includes("docs/modules/chart-display-sampler.js"), true);
  assert.equal(web.includes("docs/modules/chart-relayout-queue.js"), true);
  assert.equal(web.includes("shared/series-integrity.mjs"), true);
  assert.equal(runtime.includes("scripts/check_javascript_sources.mjs"), true);
  assert.equal(runtime.includes("worker/src/index.mjs"), true);
});
