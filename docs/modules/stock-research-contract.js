(function initThinkStockStockResearchContract(globalScope) {
  "use strict";

  const UNIVERSE_SIZE_KEY = "thinkstock-stock-research-universe-size-v1";
  const UNIVERSE_SIZE_DEFAULT = 400;
  const UNIVERSE_SIZE_LOW = 100;
  const UNIVERSE_SIZE_HIGH = 1000;
  const UNIVERSE_SIZE_STEP = 100;

  function normalizeUniverseSize(value) {
    if (value == null || String(value).trim() === "") return UNIVERSE_SIZE_DEFAULT;
    const number = Number(value);
    if (!Number.isFinite(number)) return UNIVERSE_SIZE_DEFAULT;
    const stepped = Math.round(number / UNIVERSE_SIZE_STEP) * UNIVERSE_SIZE_STEP;
    return Math.max(UNIVERSE_SIZE_LOW, Math.min(UNIVERSE_SIZE_HIGH, stepped));
  }

  function loadUniverseSize(storage) {
    try { return normalizeUniverseSize(storage?.getItem(UNIVERSE_SIZE_KEY)); }
    catch (_) { return UNIVERSE_SIZE_DEFAULT; }
  }

  function saveUniverseSize(storage, value) {
    const normalized = normalizeUniverseSize(value);
    try { storage?.setItem(UNIVERSE_SIZE_KEY, String(normalized)); } catch (_) {}
    return normalized;
  }

  const SIGNAL_LOGIC_VERSION = "adaptive1000-recovery-v11";
  const contract = Object.freeze({
    SIGNAL_LOGIC_VERSION,
    CALCULATION_VERSION: SIGNAL_LOGIC_VERSION,
    HISTORY_QUALITY_VERSION: 2,
    CACHE_FORMAT_SCHEMA: 2,
    HISTORY_CACHE_SCHEMA: 2,
    CACHE_KEY: "thinkstock-stock-research-v1",
    CACHE_VARIANTS_KEY: "thinkstock-stock-research-variants-v1",
    CACHE_BYPASS_KEY: "thinkstock-stock-research-cache-bypass-v1",
    BLOCKED_KEY: "thinkstock-stock-research-blocked-v1",
    BLOCKED_SCHEMA: 1,
    MINIMUM_KEY: "thinkstock-stock-research-minimum-v1",
    MINIMUM_DEFAULT: 5,
    MINIMUM_LOW: 1,
    MINIMUM_HIGH: 10,
    UNIVERSE_SIZE_KEY,
    UNIVERSE_SIZE_DEFAULT,
    UNIVERSE_SIZE_LOW,
    UNIVERSE_SIZE_HIGH,
    UNIVERSE_SIZE_STEP,
    RECENT_SIGNAL_WINDOW: 252,
    ONE_MONTH_SIGNAL_WINDOW: 21,
    loadUniverseSize,
    normalizeUniverseSize,
    saveUniverseSize,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = contract;
  else globalScope.ThinkStockStockResearchContract = contract;
})(typeof self !== "undefined" ? self : globalThis);
