import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/cache-lifecycle-policy.js");
const cachePolicy = globalThis.ThinkStockCacheLifecyclePolicy;

test("keeps cache retention appropriate to each data type", () => {
  assert.deepEqual(cachePolicy.storePolicy("tickerPrices"), {
    maxRecords: 24,
    maxIdleMs: 240 * 86400000,
  });
  assert.deepEqual(cachePolicy.CORE_SERIES_CACHE_KEYS, [
    "leading_cycle",
    "^KS11",
    "^KQ11",
    "customer_deposit",
    "kospi_credit",
    "kosdaq_credit",
  ]);
  assert.equal(cachePolicy.TOTAL_SERIES_CACHE_LIMIT, 30);
  assert.equal(cachePolicy.USER_TICKER_CACHE_LIMIT, 24);
  assert.equal(cachePolicy.storePolicy("tickerAiAnalysis").maxIdleMs, 45 * 86400000);
  assert.equal(cachePolicy.storePolicy("tickerAiForecastJournal").maxRecords, 140);
});

test("expires idle records and invalidates likely corporate-action boundaries", () => {
  const now = Date.parse("2026-08-12T00:00:00Z");
  assert.equal(cachePolicy.recordLifecycle({ lastAccessed: now - 50 * 86400000 }, "tickerAiAnalysis", { now }), "expired");
  assert.equal(cachePolicy.recordLifecycle({ lastAccessed: now - 10 * 86400000 }, "tickerAiAnalysis", { now }), "active");
  assert.equal(cachePolicy.shouldInvalidatePriceBoundary({ ratio: 2.1, boundaryDays: 3 }), true);
  assert.equal(cachePolicy.shouldInvalidatePriceBoundary({ ratio: 1.1, boundaryDays: 3 }), false);
});
