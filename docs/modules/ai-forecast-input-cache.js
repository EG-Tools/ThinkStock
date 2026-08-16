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

  globalScope.ThinkStockAiForecastInputCache = Object.freeze({ createAiForecastInputCache });
}(typeof self !== "undefined" ? self : globalThis));
