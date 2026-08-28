import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_COLOR_PALETTE,
  SERIES_COLORS,
  createSeriesColorResolver,
  fallbackCustomColor,
} from "../../docs/modules/series-color-policy.mjs";

test("keeps fixed market colors separate from custom stock colors", () => {
  const stocks = [{ ticker: "218410.KQ", color: "#12ab34" }];
  const resolve = createSeriesColorResolver({
    getStocks: () => stocks,
    normalizeHexColor: (value) => String(value || "").toLowerCase(),
  });

  assert.equal(resolve("^KS11"), SERIES_COLORS["^KS11"]);
  assert.equal(resolve("218410.KQ"), "#12ab34");
  assert.equal(resolve("missing"), "#888");
});

test("assigns the same deterministic fallback color for a ticker", () => {
  const first = fallbackCustomColor("005930.KS");
  const second = fallbackCustomColor("005930.KS");
  assert.equal(first, second);
  assert.equal(CUSTOM_COLOR_PALETTE.includes(first), true);
});
