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
    { date: "2026-08-04", close: 0 },
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

test("backfills partial or legacy five-year caches before using incremental updates", () => {
  const base = {
    hasExisting: true,
    hasVolumeHistory: true,
    latestDate: "2026-08-12",
  };
  assert.equal(runtime.resolveHistoryFetchSinceDate({
    ...base,
    historyCoverage: runtime.HISTORY_COVERAGE_PARTIAL,
  }), "");
  assert.equal(runtime.resolveHistoryFetchSinceDate(base), "");
  assert.equal(runtime.resolveHistoryFetchSinceDate({
    ...base,
    historyCoverage: runtime.HISTORY_COVERAGE_FULL,
  }), "2026-08-12");
});

test("touches ticker cache metadata at most once per interval", () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(runtime.shouldTouchCacheRecord(undefined, day, day), true);
  assert.equal(runtime.shouldTouchCacheRecord(day, day + 1000, day), false);
  assert.equal(runtime.shouldTouchCacheRecord(day, day * 2, day), true);
  assert.equal(runtime.shouldTouchCacheRecord(day * 2, day, day), true);
});

test("payload controller owns price, volume and invalidation mutations", () => {
  let payload = { records: [{ date: "2026-08-12", "^KS11": 4200 }], series: ["^KS11"] };
  const volumes = new Map();
  const changes = [];
  const cleared = [];
  const controller = runtime.createPayloadController({
    getPayload: () => payload,
    setPayload: (value) => { payload = value; },
    volumesByTicker: volumes,
    toNumber: (value) => value == null ? null : Number(value),
    normalizePoints: (points) => points.filter((point) => Number.isFinite(point.close)),
    sameNumber: (left, right) => left === right,
    displayName: () => "삼성전자",
    onChanged: (ticker) => changes.push(ticker),
    onClear: (ticker) => cleared.push(ticker),
  });

  assert.equal(controller.merge("005930.ks", [
    { date: "2026-08-12", close: 70000, volume: 1234 },
  ]), true);
  assert.deepEqual(controller.points("005930.KS"), [
    { date: "2026-08-12", close: 70000, volume: 1234 },
  ]);
  assert.equal(controller.hasVolumeHistory("005930.KS", 1), true);
  assert.equal(controller.clear("005930.KS"), true);
  assert.deepEqual(changes, ["005930.KS", "005930.KS"]);
  assert.deepEqual(cleared, ["005930.KS"]);
  assert.equal(volumes.has("005930.KS"), false);
});

test("converts validated price cache records into research history", () => {
  const rows = Array.from({ length: 252 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    close: 100 + index,
  }));
  const normalize = (values) => Array.isArray(values) ? values : [];
  const history = runtime.priceCacheToResearchHistory({
    schema: 4,
    ticker: "005930.ks",
    savedAt: 10,
    status: { source: "KRX" },
    points: rows,
  }, "005930.KS", normalize, { priceSchema: 4, now: () => 20 });
  assert.equal(history.ticker, "005930.KS");
  assert.equal(history.source, "KRX");
  assert.equal(history.rows.length, 252);
  assert.equal(runtime.normalizeResearchHistoryCache(history, "005930.KS", normalize)?.rows.length, 252);
  assert.equal(runtime.priceCacheToResearchHistory({ ...history, schema: 3 }, "005930.KS", normalize, {
    priceSchema: 4,
  }), null);
});
