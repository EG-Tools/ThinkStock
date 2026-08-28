import * as cacheLifecycle from "./cache-lifecycle-policy.mjs";

  "use strict";

  const SCHEMA_VERSION = 1;
  const TICKER_PATTERN = /^(?:\^KS11|\^KQ11|\d{6}\.(?:KS|KQ))$/;
  if (!cacheLifecycle?.withCacheMetadata) throw new Error("cache lifecycle policy is required");

  function forecastAsOf(forecast) {
    const value = forecast?.decisionDate || forecast?.audit?.asOfDate || forecast?.dates?.[0] || "";
    const date = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  }

  function inputFingerprint(inputKey) {
    return cacheLifecycle.contentFingerprint(String(inputKey || ""));
  }

  function recordIssue(record, ticker, inputKey) {
    const target = String(ticker || "").trim().toUpperCase();
    const key = String(inputKey || "");
    if (!record || typeof record !== "object") return "invalid-record";
    if (record.schema !== SCHEMA_VERSION) return "schema-mismatch";
    if (record.ticker !== target) return "ticker-mismatch";
    if (record.inputKey !== key) return "input-mismatch";
    if (!record.forecast || typeof record.forecast !== "object") return "missing-forecast";
    return cacheLifecycle.cacheMetadataIssue(record, {
      source: "ai-forecast",
      revision: String(SCHEMA_VERSION),
      contentFingerprint: inputFingerprint(key),
    });
  }

  function normalizeStoredRecord(record, ticker, inputKey, now = Date.now()) {
    if (recordIssue(record, ticker, inputKey)) return null;
    return cacheLifecycle.withCacheMetadata(record, {
      source: "ai-forecast",
      asOf: forecastAsOf(record.forecast),
      revision: String(SCHEMA_VERSION),
      contentFingerprint: inputFingerprint(inputKey),
      now,
      touch: true,
    });
  }

  function normalizeRecord(ticker, inputKey, forecast, now = Date.now()) {
    const target = String(ticker || "").trim().toUpperCase();
    const key = String(inputKey || "");
    if (!TICKER_PATTERN.test(target) || !key || !forecast || typeof forecast !== "object") return null;
    return cacheLifecycle.withCacheMetadata({
      schema: SCHEMA_VERSION,
      ticker: target,
      inputKey: key,
      savedAt: now,
      lastAccessed: now,
      forecast,
    }, {
      source: "ai-forecast",
      asOf: forecastAsOf(forecast),
      revision: String(SCHEMA_VERSION),
      contentFingerprint: inputFingerprint(key),
      now,
      savedAt: now,
      touch: true,
    });
  }

  function matchesInput(record, ticker, inputKey) {
    return !recordIssue(record, ticker, inputKey);
  }

  function createForecastCache(options = {}) {
    const memory = options.memory || new Map();
    const read = options.read || (async () => null);
    const write = options.write || (async () => false);
    const remove = options.remove || (async () => false);
    const prune = options.prune || (async () => false);
    const maxMemory = Math.max(1, Number(options.maxMemory) || 24);
    const pendingReads = new Map();

    function remember(ticker, record) {
      memory.delete(ticker);
      memory.set(ticker, record);
      while (memory.size > maxMemory) memory.delete(memory.keys().next().value);
      return record;
    }

    async function get(ticker, inputKey) {
      const target = String(ticker || "").trim().toUpperCase();
      const current = memory.get(target);
      const normalizedCurrent = normalizeStoredRecord(current, target, inputKey);
      if (normalizedCurrent) return remember(target, normalizedCurrent).forecast;
      const requestKey = `${target}:${inputKey}`;
      if (pendingReads.has(requestKey)) return pendingReads.get(requestKey);
      const task = Promise.resolve(read(target)).then(async (stored) => {
        const record = normalizeStoredRecord(stored, target, inputKey);
        if (!record) {
          if (stored != null) await remove(target).catch(() => false);
          return null;
        }
        remember(target, record);
        return record.forecast;
      }).catch(() => null).finally(() => pendingReads.delete(requestKey));
      pendingReads.set(requestKey, task);
      return task;
    }

    async function set(ticker, inputKey, forecast) {
      const record = normalizeRecord(ticker, inputKey, forecast);
      if (!record) return false;
      remember(record.ticker, record);
      let persisted = false;
      try {
        await write(record.ticker, record);
        persisted = true;
      } catch (_) {
        // Persistence is an optimization; the fresh in-memory forecast remains usable.
      }
      prune().catch(() => false);
      return persisted;
    }

    function invalidate(ticker) {
      const target = String(ticker || "").trim().toUpperCase();
      memory.delete(target);
      return remove(target).catch(() => false);
    }

    return Object.freeze({
      get,
      invalidate,
      memory,
      set,
      stats: () => ({ memoryEntries: memory.size, pendingReads: pendingReads.size }),
    });
  }

  const aiForecastCache = Object.freeze({
    SCHEMA_VERSION,
    createForecastCache,
    matchesInput,
    normalizeRecord,
    normalizeStoredRecord,
    recordIssue,
  });

export {
  SCHEMA_VERSION,
  createForecastCache,
  matchesInput,
  normalizeRecord,
  normalizeStoredRecord,
  recordIssue,
};

export default aiForecastCache;
