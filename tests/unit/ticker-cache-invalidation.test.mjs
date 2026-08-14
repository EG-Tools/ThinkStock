import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/cache-lifecycle-policy.js");
await import("../../docs/modules/ticker-cache-invalidation.js");
const cache = globalThis.ThinkStockTickerCacheInvalidation;

test("keeps append-only price tails and ignores a live latest-price revision", () => {
  const existing = [
    { date: "2026-08-11", close: 100 },
    { date: "2026-08-12", close: 101 },
  ];
  assert.equal(cache.assessPriceUpdate(existing, [
    { date: "2026-08-12", close: 102 },
  ]).reason, "append-only");
  assert.equal(cache.assessPriceUpdate(existing, [
    { date: "2026-08-13", close: 103 },
  ]).reason, "append-only");
});

test("invalidates derived caches for a historical correction", () => {
  const assessment = cache.assessPriceUpdate([
    { date: "2026-08-10", close: 100 },
    { date: "2026-08-11", close: 101 },
    { date: "2026-08-12", close: 102 },
  ], [
    { date: "2026-08-10", close: 98 },
    { date: "2026-08-12", close: 102 },
  ]);
  assert.equal(assessment.reason, "historical-price-revision");
  assert.equal(assessment.invalidatePrice, false);
  assert.equal(assessment.invalidateDerived, true);
});

test("requests full history and clears all related caches at a corporate-action boundary", async () => {
  const assessment = cache.assessPriceUpdate([], [], {
    rebaseSignal: { type: "boundary", ratio: 2.1 },
    boundaryDays: 3,
  });
  assert.equal(assessment.fullHistoryRequired, true);

  const removed = [];
  let memoryTicker = "";
  const invalidator = cache.createTickerCacheInvalidator({
    remove: async (storeName, ticker) => removed.push(`${storeName}:${ticker}`),
    clearMemory: (ticker) => { memoryTicker = ticker; },
  });
  const result = await invalidator.invalidate("005930.ks", assessment);
  assert.deepEqual(result.stores, [
    "tickerPrices",
    "tickerResearchHistory",
    "tickerAiForecast",
  ]);
  assert.equal(removed.length, 3);
  assert.equal(memoryTicker, "005930.KS");
});

test("invalidates only forecast output when company analysis changes", async () => {
  const removed = [];
  let memoryContext = null;
  const invalidator = cache.createTickerCacheInvalidator({
    remove: async (storeName) => removed.push(storeName),
    clearMemory: (_ticker, context) => { memoryContext = context; },
  });

  const result = await invalidator.invalidateSources("005930.KS", ["analysis"], {
    reason: "analysis-revision",
  });
  assert.deepEqual(result.stores, ["tickerAiForecast"]);
  assert.deepEqual(removed, ["tickerAiForecast"]);
  assert.deepEqual(memoryContext.changedSources, ["analysis"]);
});

test("maps source revisions to deterministic dependent cache stores", () => {
  assert.deepEqual(cache.storesForSources(["macro", "price"]), [
    "tickerAiForecast",
    "tickerResearchHistory",
  ]);
  assert.deepEqual(cache.storesForSources(["price"], { includePrice: true }), [
    "tickerPrices",
    "tickerResearchHistory",
    "tickerAiForecast",
  ]);
});
