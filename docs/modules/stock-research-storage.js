(function initThinkStockStockResearchStorage(globalScope) {
  "use strict";

  const contract = globalScope.ThinkStockStockResearchContract;
  if (!contract) throw new Error("stock research contract failed to load");
  const {
    CACHE_KEY,
    CACHE_VARIANTS_KEY,
    CACHE_FORMAT_SCHEMA,
    CACHE_BYPASS_KEY,
    BLOCKED_KEY,
    BLOCKED_SCHEMA,
    MINIMUM_KEY,
    MINIMUM_DEFAULT,
    MINIMUM_LOW,
    MINIMUM_HIGH,
    UNIVERSE_SIZE_KEY,
    UNIVERSE_SIZE_DEFAULT,
    UNIVERSE_SIZE_LOW,
    UNIVERSE_SIZE_HIGH,
    UNIVERSE_SIZE_STEP,
  } = contract;
  const CACHE_SCHEMA = CACHE_FORMAT_SCHEMA;
  const CACHE_VARIANT_LIMIT = 4;

  function normalizeCachePayload(payload, strategy) {
    const formatSchema = payload?.formatSchema ?? payload?.schema;
    const calculationVersion = payload?.calculationVersion ?? payload?.strategy;
    if (formatSchema !== CACHE_FORMAT_SCHEMA
      || calculationVersion !== strategy
      || !Array.isArray(payload?.candidates)) return null;
    return {
      ...payload,
      schema: CACHE_FORMAT_SCHEMA,
      formatSchema: CACHE_FORMAT_SCHEMA,
      strategy: calculationVersion,
      calculationVersion,
    };
  }

  function loadCache(storage, strategy) {
    try {
      const payload = JSON.parse(storage?.getItem(CACHE_KEY) || "null");
      return normalizeCachePayload(payload, strategy);
    } catch (_) {
      return null;
    }
  }

  function saveCache(storage, payload) {
    const calculationVersion = payload?.calculationVersion ?? payload?.strategy;
    const formatSchema = payload?.formatSchema ?? payload?.schema ?? CACHE_FORMAT_SCHEMA;
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify({
        ...payload,
        schema: formatSchema,
        formatSchema,
        strategy: calculationVersion,
        calculationVersion,
      }));
    } catch (_) {}
  }

  function loadCacheVariant(storage, strategy, universeSize) {
    try {
      const payload = JSON.parse(storage?.getItem(CACHE_VARIANTS_KEY) || "null");
      if (payload?.schema !== CACHE_FORMAT_SCHEMA || !payload.entries) return null;
      const normalizedSize = normalizeUniverseSize(universeSize);
      const entry = normalizeCachePayload(payload.entries[String(normalizedSize)], strategy);
      return entry && normalizeUniverseSize(entry.universeSize) === normalizedSize ? entry : null;
    } catch (_) {
      return null;
    }
  }

  function saveCacheVariant(storage, payload) {
    const normalizedSize = normalizeUniverseSize(payload?.universeSize);
    const calculationVersion = payload?.calculationVersion ?? payload?.strategy;
    const normalized = normalizeCachePayload({ ...payload, universeSize: normalizedSize }, calculationVersion);
    if (!normalized) return false;
    try {
      const stored = JSON.parse(storage?.getItem(CACHE_VARIANTS_KEY) || "null");
      const entries = stored?.schema === CACHE_FORMAT_SCHEMA && stored.entries
        ? { ...stored.entries }
        : {};
      entries[String(normalizedSize)] = normalized;
      const retained = Object.entries(entries)
        .filter(([, entry]) => normalizeCachePayload(entry, calculationVersion))
        .sort((left, right) => String(right[1]?.generatedAt || "").localeCompare(String(left[1]?.generatedAt || "")))
        .slice(0, CACHE_VARIANT_LIMIT);
      storage?.setItem(CACHE_VARIANTS_KEY, JSON.stringify({
        schema: CACHE_FORMAT_SCHEMA,
        entries: Object.fromEntries(retained),
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeCache(storage) {
    try {
      storage?.removeItem(CACHE_KEY);
      storage?.removeItem(CACHE_VARIANTS_KEY);
    } catch (_) {}
  }

  function normalizeBlockedEntries(entries) {
    const unique = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const ticker = String(entry?.ticker || "").trim().toUpperCase();
      if (!/^\d{6}\.(KS|KQ)$/.test(ticker)) return;
      unique.set(ticker, {
        ticker,
        name: String(entry?.name || ticker).trim() || ticker,
        market: String(entry?.market || "").trim().toUpperCase(),
        blockedAt: String(entry?.blockedAt || ""),
      });
    });
    return [...unique.values()];
  }

  function loadBlocked(storage) {
    try {
      const payload = JSON.parse(storage?.getItem(BLOCKED_KEY) || "null");
      if (payload?.schema !== BLOCKED_SCHEMA) return [];
      return normalizeBlockedEntries(payload.entries);
    } catch (_) {
      return [];
    }
  }

  function saveBlocked(storage, entries) {
    try {
      storage?.setItem(BLOCKED_KEY, JSON.stringify({
        schema: BLOCKED_SCHEMA,
        entries: normalizeBlockedEntries(entries),
      }));
    } catch (_) {}
  }

  function normalizeMinimum(value) {
    if (value == null || String(value).trim() === "") return MINIMUM_DEFAULT;
    const number = Math.round(Number(value));
    return Number.isFinite(number)
      ? Math.max(MINIMUM_LOW, Math.min(MINIMUM_HIGH, number))
      : MINIMUM_DEFAULT;
  }

  function loadMinimum(storage) {
    try { return normalizeMinimum(storage?.getItem(MINIMUM_KEY)); } catch (_) { return MINIMUM_DEFAULT; }
  }

  function saveMinimum(storage, value) {
    try { storage?.setItem(MINIMUM_KEY, String(normalizeMinimum(value))); } catch (_) {}
  }

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

  globalScope.ThinkStockStockResearchStorage = Object.freeze({
    CACHE_KEY,
    CACHE_VARIANTS_KEY,
    CACHE_SCHEMA,
    CACHE_FORMAT_SCHEMA,
    CACHE_BYPASS_KEY,
    BLOCKED_KEY,
    BLOCKED_SCHEMA,
    MINIMUM_KEY,
    MINIMUM_DEFAULT,
    MINIMUM_LOW,
    MINIMUM_HIGH,
    UNIVERSE_SIZE_KEY,
    UNIVERSE_SIZE_DEFAULT,
    UNIVERSE_SIZE_LOW,
    UNIVERSE_SIZE_HIGH,
    UNIVERSE_SIZE_STEP,
    loadBlocked,
    loadCache,
    loadCacheVariant,
    loadMinimum,
    loadUniverseSize,
    normalizeBlockedEntries,
    normalizeMinimum,
    normalizeUniverseSize,
    removeCache,
    saveBlocked,
    saveCache,
    saveCacheVariant,
    saveMinimum,
    saveUniverseSize,
  });
}(typeof self !== "undefined" ? self : globalThis));
