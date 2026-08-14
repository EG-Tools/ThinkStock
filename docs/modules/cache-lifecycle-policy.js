(function initThinkStockCacheLifecyclePolicy(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const CORE_SERIES_CACHE_KEYS = Object.freeze([
    "leading_cycle",
    "^KS11",
    "^KQ11",
    "customer_deposit",
    "kospi_credit",
    "kosdaq_credit",
  ]);
  const USER_TICKER_CACHE_LIMIT = 24;
  const TOTAL_SERIES_CACHE_LIMIT = CORE_SERIES_CACHE_KEYS.length + USER_TICKER_CACHE_LIMIT;
  const STORE_POLICIES = Object.freeze({
    snapshots: Object.freeze({ maxRecords: 8, maxIdleDays: 14 }),
    tickerPrices: Object.freeze({ maxRecords: USER_TICKER_CACHE_LIMIT, maxIdleDays: 240 }),
    tickerDisclosures: Object.freeze({ maxRecords: 100, maxIdleDays: 365 }),
    tickerAiAnalysis: Object.freeze({ maxRecords: 80, maxIdleDays: 45 }),
    tickerAiForecast: Object.freeze({ maxRecords: 80, maxIdleDays: 60 }),
    tickerAiForecastJournal: Object.freeze({ maxRecords: 140, maxIdleDays: 730 }),
    tickerResearchHistory: Object.freeze({ maxRecords: 420, maxIdleDays: 240 }),
  });

  function storePolicy(storeName, overrides = {}) {
    const configured = STORE_POLICIES[String(storeName || "")] || {};
    return Object.freeze({
      maxRecords: Math.max(1, Number(overrides.maxRecords ?? configured.maxRecords) || 60),
      maxIdleMs: Math.max(DAY_MS, Number(overrides.maxIdleMs)
        || (Number(overrides.maxIdleDays ?? configured.maxIdleDays) || 120) * DAY_MS),
    });
  }

  function recordLifecycle(record, storeName, options = {}) {
    if (!record || typeof record !== "object") return "invalid";
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const accessedAt = Number(record.lastAccessed || record.savedAt || 0);
    if (!Number.isFinite(accessedAt) || accessedAt <= 0 || accessedAt > now + DAY_MS) return "invalid";
    return now - accessedAt > storePolicy(storeName, options).maxIdleMs ? "expired" : "active";
  }

  function shouldInvalidatePriceBoundary(options = {}) {
    if (options.corporateAction === true) return true;
    const ratio = Math.abs(Number(options.ratio) || 0);
    const boundaryDays = Math.max(0, Number(options.boundaryDays) || 0);
    const ratioThreshold = Math.max(1, Number(options.ratioThreshold) || 1.8);
    const maximumBoundaryDays = Math.max(1, Number(options.maximumBoundaryDays) || 14);
    return ratio >= ratioThreshold && boundaryDays <= maximumBoundaryDays;
  }

  globalScope.ThinkStockCacheLifecyclePolicy = Object.freeze({
    CORE_SERIES_CACHE_KEYS,
    STORE_POLICIES,
    TOTAL_SERIES_CACHE_LIMIT,
    USER_TICKER_CACHE_LIMIT,
    recordLifecycle,
    shouldInvalidatePriceBoundary,
    storePolicy,
  });
}(typeof self !== "undefined" ? self : globalThis));
