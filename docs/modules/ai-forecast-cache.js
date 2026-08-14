(function initThinkStockAiForecastCache(globalScope) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const TICKER_PATTERN = /^(?:\^KS11|\^KQ11|\d{6}\.(?:KS|KQ))$/;

  function normalizeRecord(ticker, inputKey, forecast, now = Date.now()) {
    const target = String(ticker || "").trim().toUpperCase();
    const key = String(inputKey || "");
    if (!TICKER_PATTERN.test(target) || !key || !forecast || typeof forecast !== "object") return null;
    return {
      schema: SCHEMA_VERSION,
      ticker: target,
      inputKey: key,
      savedAt: now,
      lastAccessed: now,
      forecast,
    };
  }

  function matchesInput(record, ticker, inputKey) {
    return record?.schema === SCHEMA_VERSION
      && record?.ticker === String(ticker || "").trim().toUpperCase()
      && record?.inputKey === String(inputKey || "")
      && record?.forecast && typeof record.forecast === "object";
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
      if (matchesInput(current, target, inputKey)) return current.forecast;
      const requestKey = `${target}:${inputKey}`;
      if (pendingReads.has(requestKey)) return pendingReads.get(requestKey);
      const task = Promise.resolve(read(target)).then(async (stored) => {
        if (!matchesInput(stored, target, inputKey)) {
          if (stored != null) await remove(target).catch(() => false);
          return null;
        }
        const record = { ...stored, lastAccessed: Date.now() };
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

  globalScope.ThinkStockAiForecastCache = Object.freeze({
    SCHEMA_VERSION,
    createForecastCache,
    matchesInput,
    normalizeRecord,
  });
}(typeof self !== "undefined" ? self : globalThis));
