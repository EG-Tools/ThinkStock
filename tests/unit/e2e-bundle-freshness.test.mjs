import assert from "node:assert/strict";
import test from "node:test";

import { assertE2eBundleFresh } from "../../scripts/e2e-bundle-freshness.mjs";

test("Playwright rejects an older diagnostic bundle after product assets change", () => {
  assert.throws(
    () => assertE2eBundleFresh(
      { size: 100, mtimeMs: 2_000 },
      { size: 110, mtimeMs: 1_000 },
    ),
    /diagnostic bundle is stale/,
  );
});

test("Playwright accepts bundles produced together", () => {
  assert.equal(assertE2eBundleFresh(
    { size: 100, mtimeMs: 1_000 },
    { size: 110, mtimeMs: 1_001 },
  ), true);
});
