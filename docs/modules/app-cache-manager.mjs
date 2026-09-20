"use strict";

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
  }

  function byteLength(scope, value) {
    let text = "";
    try { text = typeof value === "string" ? value : JSON.stringify(value); } catch (_) { return 0; }
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

  function createAppCacheManager(scope = globalThis, options = {}) {
    const indexedCacheStore = options.indexedCacheStore || null;
    const indexedStoreNames = uniqueStrings(options.indexedStoreNames);
    const localStorageKeys = uniqueStrings(options.localStorageKeys);
    const sessionStorageKeys = uniqueStrings(options.sessionStorageKeys);
    const cacheNamePrefix = String(options.cacheNamePrefix || "thinkstock-");
    const measurementTtlMs = Math.max(0,
      Number.isFinite(Number(options.measurementTtlMs))
        ? Number(options.measurementTtlMs)
        : 30000);
    let measuredAt = 0;
    let lastMeasurement = null;
    let measurementInFlight = null;

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
      let cursor = 0;
      const laneCount = Math.min(2, indexedStoreNames.length);
      const laneTotals = await Promise.all(Array.from({ length: laneCount }, async () => {
        let laneTotal = 0;
        while (cursor < indexedStoreNames.length) {
          const storeName = indexedStoreNames[cursor];
          cursor += 1;
          try {
            const records = await indexedCacheStore.readAllRecords(storeName);
            laneTotal += (Array.isArray(records) ? records : [])
              .reduce((sum, record) => sum + byteLength(scope, record), 0);
          } catch (_) {
            // A blocked or unavailable store must not hide the remaining cache size.
          }
        }
        return laneTotal;
      }));
      return laneTotals.reduce((sum, size) => sum + size, 0);
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

    async function invalidateServiceWorkerCacheInfo() {
      const controller = scope.navigator?.serviceWorker?.controller;
      const Channel = scope.MessageChannel;
      if (!controller?.postMessage || typeof Channel !== "function") return;
      await new Promise((resolve) => {
        const channel = new Channel();
        let timeout;
        const finish = () => {
          (scope.clearTimeout || clearTimeout)(timeout);
          channel.port1.close?.();
          channel.port2.close?.();
          resolve();
        };
        channel.port1.onmessage = finish;
        timeout = (scope.setTimeout || setTimeout)(finish, 500);
        try {
          controller.postMessage("INVALIDATE_DATA_CACHE_INFO", [channel.port2]);
        } catch (_) {
          finish();
        }
      });
    }

    async function cachedResponseBytes(response) {
      if (!response) return 0;
      const headerBytes = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(headerBytes) && headerBytes > 0) return headerBytes;
      try {
        const body = await (response.clone?.() || response).arrayBuffer();
        if (body?.byteLength) return body.byteLength;
      } catch (_) {}
      return 0;
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

    async function measureNow() {
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

    function measure(options = {}) {
      if (measurementInFlight) return measurementInFlight;
      if (options.full !== true && lastMeasurement
        && Date.now() - measuredAt < measurementTtlMs) {
        return Promise.resolve(lastMeasurement);
      }
      measurementInFlight = measureNow().then((summary) => {
        lastMeasurement = summary;
        measuredAt = Date.now();
        return summary;
      }).finally(() => { measurementInFlight = null; });
      return measurementInFlight;
    }

    async function clear() {
      if (measurementInFlight) await measurementInFlight.catch(() => null);
      lastMeasurement = null;
      measuredAt = 0;
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
      await invalidateServiceWorkerCacheInfo();
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("일부 캐시를 초기화하지 못했습니다.");
      }
      return true;
    }

    return Object.freeze({ clear, formatBytes, measure });
  }

export { byteLength, createAppCacheManager, formatBytes };
