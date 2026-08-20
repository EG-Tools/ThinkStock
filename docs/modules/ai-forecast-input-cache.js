(function initThinkStockAiForecastInputCache(globalScope) {
  "use strict";

  function createAiForecastInputCache(options = {}) {
    const maxEntries = Math.max(1, Math.round(Number(options.maxEntries) || 20));
    const entries = new Map();

    function resolve(keyValue, producer) {
      const key = String(keyValue || "");
      if (!key || typeof producer !== "function") return producer?.();
      if (entries.has(key)) {
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      }
      const value = producer();
      entries.set(key, value);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    }

    return Object.freeze({
      clear: () => entries.clear(),
      resolve,
      stats: () => Object.freeze({ entries: entries.size, maxEntries }),
    });
  }

  function createSeriesRevisionCache(options = {}) {
    const fingerprint = options.fingerprint;
    if (typeof fingerprint !== "function") throw new Error("series fingerprint callback is required");
    const maxEntries = Math.max(1, Math.round(Number(options.maxEntries) || 30));
    const logicVersion = String(options.logicVersion || "ai-series-revision-v1");
    const entries = new Map();

    function resolve(seriesValue, rows, sourceRevision, keys = []) {
      const series = String(seriesValue || "").trim().toUpperCase();
      if (!series) return "";
      const revision = String(sourceRevision || "");
      const cached = entries.get(series);
      if (cached?.sourceRevision === revision) return cached.fingerprint;
      const source = Array.isArray(rows) ? rows : [];
      const value = fingerprint(source, keys, {
        tail: Math.max(1, source.length),
        logicVersion,
      });
      entries.delete(series);
      entries.set(series, { sourceRevision: revision, fingerprint: value });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    }

    return Object.freeze({
      clear: () => entries.clear(),
      resolve,
      stats: () => Object.freeze({ entries: entries.size, maxEntries }),
    });
  }

  globalScope.ThinkStockAiForecastInputCache = Object.freeze({
    createAiForecastInputCache,
    createSeriesRevisionCache,
  });
}(typeof self !== "undefined" ? self : globalThis));
