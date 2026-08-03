import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/ticker-price-runtime.js");
const runtime = globalThis.ThinkStockTickerPriceRuntime;

test("stores normalized ticker price status and selects the visible ticker", () => {
  const store = runtime.createStatusStore({
    tickerPattern: /^\d{6}\.(KS|KQ)$/,
    now: () => 1234,
  });
  assert.equal(store.set("bad", {}), null);
  const status = store.set("005930.ks", {
    source: "krx",
    latestDate: "2026-08-03T00:00:00Z",
  });
  assert.deepEqual(status, {
    ticker: "005930.KS",
    source: "KRX",
    latestDate: "2026-08-03",
    marketDate: "",
    expectedDate: "",
    cached: false,
    localCache: false,
    stale: false,
    crossCheck: "",
    warning: "",
    checkedAt: 1234,
  });
  assert.equal(store.visible(["005930.KS"], "005930.KS"), status);
});

test("merges, reads and clears a ticker series without changing other prices", () => {
  const payload = {
    records: [
      { date: "2026-08-01", "^KS11": 4100 },
      { date: "2026-08-03", "^KS11": 4200 },
    ],
    series: ["^KS11"],
    display_names: {},
  };
  runtime.mergeSeries(payload, "005930.ks", [
    { date: "2026-08-02", close: 70000 },
    { date: "2026-08-03", close: 71000 },
  ], "Samsung");
  assert.equal(runtime.latestSeriesDate(payload, "005930.KS", (value) => value ?? null), "2026-08-03");
  assert.deepEqual(runtime.seriesPoints(payload, "005930.KS"), [
    { date: "2026-08-01", close: undefined },
    { date: "2026-08-02", close: 70000 },
    { date: "2026-08-03", close: 71000 },
  ]);
  runtime.clearSeries(payload, "005930.KS");
  assert.equal(payload.records[2]["^KS11"], 4200);
  assert.equal("005930.KS" in payload.records[2], false);
  assert.deepEqual(payload.series, ["^KS11"]);
});

test("uses a recent market confirmation before benchmark freshness", () => {
  assert.equal(runtime.isCacheFresh({
    latestDate: "2026-08-01",
    expectedDate: "2026-08-03",
    benchmarkDate: "2026-08-03",
    status: { stale: false, expectedDate: "2026-08-03", checkedAt: 900 },
    nowMs: 1000,
    maxAgeMs: 200,
  }), true);
  assert.equal(runtime.isCacheFresh({
    latestDate: "2026-08-01",
    expectedDate: "2026-08-03",
    benchmarkDate: "2026-08-03",
    status: { stale: true, expectedDate: "2026-08-03", checkedAt: 900 },
    nowMs: 1000,
    maxAgeMs: 200,
  }), false);
});
