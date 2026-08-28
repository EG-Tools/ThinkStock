import test from "node:test";
import assert from "node:assert/strict";

import { staticContentType } from "../../scripts/static_content_type.mjs";

test("serves JavaScript modules with a WebKit-compatible MIME type", () => {
  assert.equal(staticContentType("modules/chart-model-worker.mjs"), "text/javascript; charset=utf-8");
  assert.equal(staticContentType("assets/app.bundle.min.js"), "text/javascript; charset=utf-8");
});

test("falls back to binary content for an unknown extension", () => {
  assert.equal(staticContentType("data/archive.bin"), "application/octet-stream");
});
