(function initThinkStockAppCacheManager(globalScope) {
  "use strict";

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
  }

  function byteLength(scope, value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return 0;
    try {
      const Encoder = scope.TextEncoder;
      if (typeof Encoder === "function") return new Encoder().encode(text).byteLength;
    } catch (_) {}
    return text.length * 2;
  }

  function formatBytes(bytes) {
    const total = Math.max(0, Number(bytes) || 0);
    if (total <= 0) return "0B";
    if (total < 1024 * 1024) return `${Math.max(1, Math.round(total / 1024))}KB`;
    const megabytes = total / (1024 * 1024);
    return `${megabytes >= 100 ? Math.round(megabytes) : megabytes.toFixed(1)}MB`;
  }

  function createAppCacheManager(scope = globalScope, options = {}) {
    const indexedCacheStore = options.indexedCacheStore || null;
    const indexedStoreNames = uniqueStrings(options.indexedStoreNames);
    const localStorageKeys = uniqueStrings(options.localStorageKeys);
    const sessionStorageKeys = uniqueStrings(options.sessionStorageKeys);
    const cacheNamePrefix = String(options.cacheNamePrefix || "thinkstock-");

    function storageBytes(storage, keys) {
      return keys.reduce((total, key) => {
        try {
          const value = storage?.getItem(key);
          return value == null ? total : total + byteLength(scope, key) + byteLength(scope, value);
        } catch (_) {
          return total;
        }
      }, 0);
    }

    async function indexedDbBytes() {
      if (!indexedCacheStore?.readAllRecords) return 0;
      let total = 0;
      for (const storeName of indexedStoreNames) {
        try {
          const records = await indexedCacheStore.readAllRecords(storeName);
          total += (Array.isArray(records) ? records : [])
            .reduce((sum, record) => sum + byteLength(scope, record), 0);
        } catch (_) {
          // A blocked or unavailable store must not hide the remaining cache size.
        }
      }
      return total;
    }

    async function appCacheNames() {
      if (typeof scope.caches?.keys !== "function") return [];
      try {
        return (await scope.caches.keys())
          .filter((name) => String(name).startsWith(cacheNamePrefix));
      } catch (_) {
        return [];
      }
    }

    async function cachedResponseBytes(response) {
      if (!response) return 0;
      try {
        const body = await (response.clone?.() || response).arrayBuffer();
        if (body?.byteLength) return body.byteLength;
      } catch (_) {}
      const headerBytes = Number(response.headers?.get?.("content-length"));
      return Number.isFinite(headerBytes) && headerBytes > 0 ? headerBytes : 0;
    }

    async function cacheStorageBytes() {
      let total = 0;
      for (const cacheName of await appCacheNames()) {
        try {
          const cache = await scope.caches.open(cacheName);
          const requests = await cache.keys();
          let cursor = 0;
          const laneCount = Math.min(3, requests.length);
          const laneTotals = await Promise.all(Array.from({ length: laneCount }, async () => {
            let laneTotal = 0;
            while (cursor < requests.length) {
              const request = requests[cursor];
              cursor += 1;
              const response = await cache.match(request);
              laneTotal += byteLength(scope, request?.url || "") + await cachedResponseBytes(response);
            }
            return laneTotal;
          }));
          total += laneTotals.reduce((sum, size) => sum + size, 0);
        } catch (_) {
          // Continue measuring other ThinkStock caches when one entry is unreadable.
        }
      }
      return total;
    }

    async function measure() {
      const localBytes = storageBytes(scope.localStorage, localStorageKeys);
      const sessionBytes = storageBytes(scope.sessionStorage, sessionStorageKeys);
      const [indexedBytes, browserCacheBytes] = await Promise.all([
        indexedDbBytes(),
        cacheStorageBytes(),
      ]);
      return Object.freeze({
        totalBytes: localBytes + sessionBytes + indexedBytes + browserCacheBytes,
        localBytes,
        sessionBytes,
        indexedBytes,
        browserCacheBytes,
      });
    }

    async function clear() {
      localStorageKeys.forEach((key) => {
        try { scope.localStorage?.removeItem(key); } catch (_) {}
      });
      sessionStorageKeys.forEach((key) => {
        try { scope.sessionStorage?.removeItem(key); } catch (_) {}
      });

      const tasks = indexedStoreNames.map((storeName) => (
        Promise.resolve(indexedCacheStore?.clearStore?.(storeName))
      ));
      tasks.push(...(await appCacheNames()).map((cacheName) => scope.caches.delete(cacheName)));
      const results = await Promise.allSettled(tasks);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("일부 캐시를 초기화하지 못했습니다.");
      }
      return true;
    }

    return Object.freeze({ clear, formatBytes, measure });
  }

  globalScope.ThinkStockAppCacheManager = Object.freeze({
    byteLength,
    createAppCacheManager,
    formatBytes,
  });
}(typeof self !== "undefined" ? self : globalThis));

// Granular cache validation belongs to cache management.
(function initThinkStockCacheRecordHealth(globalScope) {
  "use strict";

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function granularRecordIssue(record, options = {}) {
    if (record == null) return "missing";
    if (!record || typeof record !== "object" || Array.isArray(record)) return "invalid-record";
    if (Number(record.schema) !== Number(options.schema)) return "schema-mismatch";
    const expectedKey = String(options.key || "").trim().toUpperCase();
    const recordKey = String(record[options.keyField || "ticker"] || "").trim().toUpperCase();
    if (expectedKey && recordKey !== expectedKey) return "key-mismatch";
    if (options.requireContent !== false && Math.max(0, Number(options.contentCount) || 0) === 0) {
      return "empty-content";
    }
    const savedAt = Number(record.savedAt || 0);
    const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
    if (!Number.isFinite(savedAt) || savedAt <= 0 || savedAt > now + 24 * 60 * 60 * 1000) {
      return "invalid-timestamp";
    }
    const latestDate = String(options.latestDate || record.latestDate || "").slice(0, 10);
    if (latestDate && !DATE_PATTERN.test(latestDate)) return "invalid-date";
    const expectedFingerprint = String(options.contentFingerprint || "");
    const storedFingerprint = String(record.contentFingerprint || "");
    if (storedFingerprint && expectedFingerprint && storedFingerprint !== expectedFingerprint) {
      return "content-mismatch";
    }
    return "";
  }

  globalScope.ThinkStockCacheRecordHealth = Object.freeze({ granularRecordIssue });
}(typeof self !== "undefined" ? self : globalThis));
