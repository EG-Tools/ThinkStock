(function initThinkStockChartModelCache(globalScope) {
  "use strict";

  function createChartModelCache(options = {}) {
    const maxEntries = Math.max(1, Math.trunc(Number(options.maxEntries) || 3));
    const maxWeight = Number.isFinite(Number(options.maxWeight)) && Number(options.maxWeight) > 0
      ? Number(options.maxWeight)
      : Number.POSITIVE_INFINITY;
    const getWeight = typeof options.getWeight === "function" ? options.getWeight : () => 1;
    const entries = new Map();
    const pending = new Map();
    let totalWeight = 0;
    let generation = 0;
    const counters = {
      hits: 0,
      misses: 0,
      coalesced: 0,
      evictions: 0,
      clears: 0,
    };

    function remember(key, value) {
      const previous = entries.get(key);
      if (previous) totalWeight -= previous.weight;
      entries.delete(key);
      const weight = Math.max(1, Number(getWeight(value, key)) || 1);
      entries.set(key, { value, weight });
      totalWeight += weight;
      while (entries.size > maxEntries || (entries.size > 1 && totalWeight > maxWeight)) {
        const oldestKey = entries.keys().next().value;
        const oldest = entries.get(oldestKey);
        totalWeight -= Number(oldest?.weight) || 0;
        entries.delete(oldestKey);
        counters.evictions += 1;
      }
      return value;
    }

    function resolve(key, producer) {
      const normalizedKey = String(key || "");
      if (!normalizedKey || typeof producer !== "function") {
        throw new Error("chart model cache key and producer are required");
      }
      if (entries.has(normalizedKey)) {
        const value = entries.get(normalizedKey).value;
        remember(normalizedKey, value);
        counters.hits += 1;
        return Object.freeze({ status: "hit", promise: Promise.resolve(value) });
      }
      if (pending.has(normalizedKey)) {
        counters.coalesced += 1;
        return Object.freeze({ status: "coalesced", promise: pending.get(normalizedKey) });
      }

      counters.misses += 1;
      const requestGeneration = generation;
      const task = Promise.resolve()
        .then(producer)
        .then((value) => {
          if (value != null && requestGeneration === generation) remember(normalizedKey, value);
          return value;
        })
        .finally(() => {
          if (pending.get(normalizedKey) === task) pending.delete(normalizedKey);
        });
      pending.set(normalizedKey, task);
      return Object.freeze({ status: "miss", promise: task });
    }

    function clear() {
      generation += 1;
      entries.clear();
      totalWeight = 0;
      counters.clears += 1;
    }

    return Object.freeze({
      clear,
      resolve,
      stats: () => Object.freeze({
        ...counters,
        entries: entries.size,
        pending: pending.size,
        maxEntries,
        maxWeight: Number.isFinite(maxWeight) ? maxWeight : null,
        totalWeight,
      }),
    });
  }

  function estimateMainChartModelWeight(model) {
    if (!model || typeof model !== "object") return 1;
    const rows = Array.isArray(model.rows) ? model.rows.length : 0;
    const series = Array.isArray(model.seriesModels) ? model.seriesModels : [];
    const seriesWeight = series.reduce((sum, item) => sum + [
      item?.rawTexts,
      item?.xValues,
      item?.values,
      item?.baseValues,
    ].reduce((count, values) => count + (Array.isArray(values) ? values.length : 0), 0), 0);
    const displayWeight = Array.isArray(model.displayIndexes) ? model.displayIndexes.length : 0;
    return Math.max(1, rows + seriesWeight + displayWeight);
  }

  function createSourceFingerprintCache(options = {}) {
    const fingerprint = options.fingerprint;
    if (typeof fingerprint !== "function") throw new Error("source fingerprint callback is required");
    const maxEntries = Math.max(1, Math.trunc(Number(options.maxEntries) || 2));
    const entries = new Map();
    let hits = 0;
    let misses = 0;

    function resolve(rows, keys, revision, fingerprintOptions = {}) {
      const targetKeys = [...new Set((keys || []).map(String).filter(Boolean))];
      const cacheKey = [
        String(revision || ""),
        Array.isArray(rows) ? rows.length : 0,
        targetKeys.join(","),
        Number(fingerprintOptions.tail) || 0,
        String(fingerprintOptions.logicVersion || "1"),
      ].join("|");
      if (entries.has(cacheKey)) {
        const value = entries.get(cacheKey);
        entries.delete(cacheKey);
        entries.set(cacheKey, value);
        hits += 1;
        return value;
      }
      misses += 1;
      const value = fingerprint(rows, targetKeys, fingerprintOptions);
      entries.set(cacheKey, value);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    }

    return Object.freeze({
      clear: () => entries.clear(),
      resolve,
      stats: () => Object.freeze({ entries: entries.size, hits, misses, maxEntries }),
    });
  }

  globalScope.ThinkStockChartModelCache = Object.freeze({
    createChartModelCache,
    createSourceFingerprintCache,
    estimateMainChartModelWeight,
  });
}(typeof self !== "undefined" ? self : globalThis));
