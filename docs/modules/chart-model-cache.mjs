"use strict";

/**
 * @typedef {object} ChartModelCacheOptions
 * @property {number} [maxEntries]
 * @property {number} [maxWeight]
 * @property {(value: unknown, key: string) => number} [getWeight]
 */

  /** @param {ChartModelCacheOptions} [options] */
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
      entryEvictions: 0,
      weightEvictions: 0,
      stores: 0,
      clears: 0,
    };

    function remember(key, value, countStore = true) {
      const previous = entries.get(key);
      if (previous) totalWeight -= previous.weight;
      entries.delete(key);
      const weight = Math.max(1, Number(getWeight(value, key)) || 1);
      entries.set(key, { value, weight });
      totalWeight += weight;
      if (countStore) counters.stores += 1;
      while (entries.size > maxEntries || (entries.size > 1 && totalWeight > maxWeight)) {
        const exceedsEntryLimit = entries.size > maxEntries;
        const oldestKey = entries.keys().next().value;
        const oldest = entries.get(oldestKey);
        totalWeight -= Number(oldest?.weight) || 0;
        entries.delete(oldestKey);
        counters.evictions += 1;
        if (exceedsEntryLimit) counters.entryEvictions += 1;
        else counters.weightEvictions += 1;
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
        remember(normalizedKey, value, false);
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
      stats: () => {
        const requests = counters.hits + counters.misses + counters.coalesced;
        const resolvedLookups = counters.hits + counters.misses;
        return Object.freeze({
          ...counters,
          requests,
          hitRate: resolvedLookups ? counters.hits / resolvedLookups : 0,
          reuseRate: requests ? (counters.hits + counters.coalesced) / requests : 0,
          entries: entries.size,
          pending: pending.size,
          maxEntries,
          maxWeight: Number.isFinite(maxWeight) ? maxWeight : null,
          totalWeight,
        });
      },
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
    let evictions = 0;

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
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
        evictions += 1;
      }
      return value;
    }

    return Object.freeze({
      clear: () => entries.clear(),
      resolve,
      stats: () => Object.freeze({
        entries: entries.size,
        hits,
        misses,
        evictions,
        hitRate: hits + misses ? hits / (hits + misses) : 0,
        maxEntries,
      }),
    });
  }

  /**
   * Keeps one or more revisioned calculations per series while allowing the
   * whole series to be invalidated without knowing its current revision key.
   * @template T
   * @param {{maxEntries?: number}} [options]
   * @returns {{
   *   clear: () => void,
   *   invalidate: (series: string) => number,
   *   resolve: (series: string, revision: unknown, producer: () => T) => T,
   *   stats: () => Readonly<object>
   * }}
   */
  function createSeriesDerivedCache(options = {}) {
    const maxEntries = Math.max(1, Math.trunc(Number(options.maxEntries) || 40));
    const entries = new Map();
    const keysBySeries = new Map();
    const counters = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0,
    };

    function normalizeSeries(series) {
      return String(series || "").trim().toUpperCase();
    }

    function entryKey(series, revision) {
      return `${series}\u0000${String(revision || "")}`;
    }

    function unlink(series, key) {
      const seriesKeys = keysBySeries.get(series);
      if (!seriesKeys) return;
      seriesKeys.delete(key);
      if (!seriesKeys.size) keysBySeries.delete(series);
    }

    function remove(key) {
      const entry = entries.get(key);
      if (!entry) return false;
      entries.delete(key);
      unlink(entry.series, key);
      return true;
    }

    function remember(series, key, value) {
      remove(key);
      entries.set(key, { series, value });
      if (!keysBySeries.has(series)) keysBySeries.set(series, new Set());
      keysBySeries.get(series).add(key);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (remove(oldestKey)) counters.evictions += 1;
      }
      return value;
    }

    function resolve(series, revision, producer) {
      const normalizedSeries = normalizeSeries(series);
      if (!normalizedSeries || typeof producer !== "function") {
        throw new Error("series derived cache key and producer are required");
      }
      const key = entryKey(normalizedSeries, revision);
      if (entries.has(key)) {
        const value = entries.get(key).value;
        remember(normalizedSeries, key, value);
        counters.hits += 1;
        return value;
      }
      counters.misses += 1;
      return remember(normalizedSeries, key, producer());
    }

    function invalidate(series) {
      const normalizedSeries = normalizeSeries(series);
      const seriesKeys = keysBySeries.get(normalizedSeries);
      if (!seriesKeys?.size) return 0;
      const removed = [...seriesKeys].reduce((count, key) => count + Number(remove(key)), 0);
      if (removed) counters.invalidations += 1;
      return removed;
    }

    function clear() {
      entries.clear();
      keysBySeries.clear();
    }

    return Object.freeze({
      clear,
      invalidate,
      resolve,
      stats: () => Object.freeze({
        ...counters,
        entries: entries.size,
        maxEntries,
        series: keysBySeries.size,
      }),
    });
  }

  /**
   * Routes one source revision to every dependent in-memory calculation.
   * Adapters may resolve lazily so optional AI and timing features stay unloaded.
   */
  function createSeriesDerivedCacheRegistry() {
    const adapters = new Map();
    const counters = { invalidations: 0, adapterInvalidations: 0, clears: 0 };

    function normalizedSet(values) {
      return new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean));
    }

    function register(name, adapter, dependencies = {}) {
      const key = String(name || "").trim();
      if (!key || !adapter || typeof adapter !== "object") {
        throw new Error("derived cache adapter name and contract are required");
      }
      adapters.set(key, Object.freeze({
        adapter,
        sources: normalizedSet(dependencies.sources),
        stores: normalizedSet(dependencies.stores),
      }));
      return () => adapters.delete(key);
    }

    function matches(entry, context = {}) {
      if (!entry.sources.size && !entry.stores.size) return true;
      const sources = normalizedSet(context.changedSources);
      const stores = normalizedSet(context.stores);
      return [...entry.sources].some((value) => sources.has(value))
        || [...entry.stores].some((value) => stores.has(value));
    }

    function invalidate(series, context = {}) {
      let affected = 0;
      adapters.forEach((entry) => {
        if (!matches(entry, context) || typeof entry.adapter.invalidate !== "function") return;
        const result = entry.adapter.invalidate(series, context);
        if (result !== false) affected += 1;
      });
      if (affected) {
        counters.invalidations += 1;
        counters.adapterInvalidations += affected;
      }
      return affected;
    }

    function clear(context = {}) {
      let affected = 0;
      adapters.forEach((entry) => {
        if (!matches(entry, context) || typeof entry.adapter.clear !== "function") return;
        entry.adapter.clear(context);
        affected += 1;
      });
      if (affected) counters.clears += 1;
      return affected;
    }

    return Object.freeze({
      clear,
      invalidate,
      register,
      stats: () => Object.freeze({
        ...counters,
        adapters: Object.freeze(Object.fromEntries([...adapters].map(([name, entry]) => [
          name,
          typeof entry.adapter.stats === "function" ? entry.adapter.stats() : null,
        ]))),
      }),
    });
  }

export {
  createChartModelCache,
  createSeriesDerivedCache,
  createSeriesDerivedCacheRegistry,
  createSourceFingerprintCache,
  estimateMainChartModelWeight,
};
