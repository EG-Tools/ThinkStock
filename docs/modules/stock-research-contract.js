(function initThinkStockStockResearchContract(globalScope) {
  "use strict";

  const contract = Object.freeze({
    CALCULATION_VERSION: "adaptive1000-recovery-v11",
    CACHE_FORMAT_SCHEMA: 1,
    HISTORY_CACHE_SCHEMA: 1,
    CACHE_KEY: "thinkstock-stock-research-v1",
    CACHE_VARIANTS_KEY: "thinkstock-stock-research-variants-v1",
    CACHE_BYPASS_KEY: "thinkstock-stock-research-cache-bypass-v1",
    BLOCKED_KEY: "thinkstock-stock-research-blocked-v1",
    BLOCKED_SCHEMA: 1,
    MINIMUM_KEY: "thinkstock-stock-research-minimum-v1",
    MINIMUM_DEFAULT: 5,
    MINIMUM_LOW: 1,
    MINIMUM_HIGH: 10,
    UNIVERSE_SIZE_KEY: "thinkstock-stock-research-universe-size-v1",
    UNIVERSE_SIZE_DEFAULT: 400,
    UNIVERSE_SIZE_LOW: 100,
    UNIVERSE_SIZE_HIGH: 1000,
    UNIVERSE_SIZE_STEP: 100,
    RECENT_SIGNAL_WINDOW: 252,
    ONE_MONTH_SIGNAL_WINDOW: 21,
  });

  globalScope.ThinkStockStockResearchContract = contract;
}(typeof self !== "undefined" ? self : globalThis));
