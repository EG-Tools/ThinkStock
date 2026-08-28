"use strict";

const CORE_SERIES = Object.freeze([
  "leading_cycle",
  "^KS11",
  "^KQ11",
  "customer_deposit",
  "kospi_credit",
  "kosdaq_credit",
]);

const FIXED_CORE_SERIES_COLORS = Object.freeze({
  leading_cycle: "#999999",
  customer_deposit: "#f59e0b",
  "^KS11": "#4ade80",
  kospi_credit: "#60a5fa",
  "^KQ11": "#f87171",
  kosdaq_credit: "#a78bfa",
});

const SERIES_COLORS = Object.freeze({
  ...FIXED_CORE_SERIES_COLORS,
  news_sentiment: "#22d3ee",
  adr_kospi: "#facc15",
  adr_kosdaq: "#f472b6",
  fear_greed: "#fb923c",
  vkospi: "#e5e7eb",
  vix: "#60a5fa",
});

const CUSTOM_RESERVED_COLORS = Object.freeze(
  CORE_SERIES.map((key) => FIXED_CORE_SERIES_COLORS[key]),
);
const CUSTOM_COLOR_MIN_FIXED_DISTANCE = 90;
const CUSTOM_COLOR_MIN_FIXED_HUE_DISTANCE = 28;
const CUSTOM_COLOR_PALETTE = Object.freeze([
  "#d41111", "#d44211", "#a4d411", "#73d411", "#11d411", "#0da559",
  "#11d4d4", "#1173d4", "#1142d4", "#1111d4", "#4211d4", "#7311d4",
  "#a411d4", "#d411d4", "#d411a4", "#d41173", "#d41142", "#eeee2b",
  "#bdee2b", "#2beeee", "#2b2bee", "#ee2bee", "#f2f25a", "#89f5da",
  "#9707b0", "#67b007", "#f73be1", "#bff73b", "#14f5df", "#f51481",
  "#11a2a7", "#9e1a5a", "#76f514", "#d709bf",
]);

function customStockColorRandom(scope = globalThis) {
  try {
    const values = new Uint32Array(1);
    scope.crypto?.getRandomValues?.(values);
    if (values[0] > 0) return values[0] / 4294967296;
  } catch (_) {
    // A visual color choice does not require cryptographic randomness.
  }
  return Math.random();
}

function fallbackCustomColor(ticker, palette = CUSTOM_COLOR_PALETTE) {
  const colors = Array.isArray(palette) && palette.length ? palette : CUSTOM_COLOR_PALETTE;
  const hash = [...String(ticker || "")]
    .reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 0);
  return colors[hash % colors.length];
}

function createSeriesColorResolver(options = {}) {
  const fixedColors = options.fixedColors || SERIES_COLORS;
  const palette = options.palette || CUSTOM_COLOR_PALETTE;
  const getStocks = typeof options.getStocks === "function" ? options.getStocks : () => [];
  const normalizeHexColor = typeof options.normalizeHexColor === "function"
    ? options.normalizeHexColor
    : (value) => String(value || "").trim();
  const fallback = String(options.fallback || "#888");

  return function seriesColor(key) {
    const seriesKey = String(key || "");
    if (fixedColors[seriesKey]) return fixedColors[seriesKey];
    const stock = (getStocks() || []).find((item) => item?.ticker === seriesKey);
    if (!stock) return fallback;
    return normalizeHexColor(stock.color) || fallbackCustomColor(seriesKey, palette);
  };
}

export {
  CORE_SERIES,
  CUSTOM_COLOR_MIN_FIXED_DISTANCE,
  CUSTOM_COLOR_MIN_FIXED_HUE_DISTANCE,
  CUSTOM_COLOR_PALETTE,
  CUSTOM_RESERVED_COLORS,
  FIXED_CORE_SERIES_COLORS,
  SERIES_COLORS,
  createSeriesColorResolver,
  customStockColorRandom,
  fallbackCustomColor,
};
