import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_COLOR_MIN_FIXED_DISTANCE,
  CUSTOM_COLOR_MIN_FIXED_HUE_DISTANCE,
  CUSTOM_COLOR_PALETTE,
  CUSTOM_RESERVED_COLORS,
  FIXED_CORE_SERIES_COLORS,
  SERIES_COLORS,
  createSeriesColorResolver,
  fallbackCustomColor,
} from "../../docs/modules/app-control-config.mjs";
import {
  assignCustomStockColors,
  colorDistance,
} from "../../docs/modules/app-state-controller.mjs";

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

test("keeps the fixed macro sequence muted and rainbow ordered", () => {
  assert.deepEqual(FIXED_CORE_SERIES_COLORS, {
    leading_cycle: "#929292",
    t10y1y: "#cf7777",
    "^KS11": "#ce9668",
    "^KQ11": "#c9b65e",
    us_credit_spread: "#75ad7f",
    customer_deposit: "#64ada9",
    kospi_credit: "#6f91bd",
    kosdaq_credit: "#9680b8",
  });
});

test("keeps twenty random stock colors distinct from every fixed macro color", () => {
  const stocks = Array.from({ length: 20 }, (_, index) => ({ ticker: `stock-${index}` }));
  const assigned = assignCustomStockColors(stocks, {
    palette: CUSTOM_COLOR_PALETTE,
    reservedColors: CUSTOM_RESERVED_COLORS,
    minimumDistance: CUSTOM_COLOR_MIN_FIXED_DISTANCE,
    minimumHueDistance: CUSTOM_COLOR_MIN_FIXED_HUE_DISTANCE,
    random: () => 0,
  });
  const colors = assigned.map((stock) => stock.color);

  assert.equal(new Set(colors).size, 20);
  colors.forEach((color) => {
    CUSTOM_RESERVED_COLORS.forEach((fixedColor) => {
      assert.ok(colorDistance(color, fixedColor) >= CUSTOM_COLOR_MIN_FIXED_DISTANCE);
    });
  });
});
