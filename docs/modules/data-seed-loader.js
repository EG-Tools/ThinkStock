(function initDataSeedLoader(globalScope) {
  "use strict";

  function createDataSeedLoader(options = {}) {
    const fetchWithTimeout = options.fetchWithTimeout;
    const appendCacheBust = options.appendCacheBust;
    if (typeof fetchWithTimeout !== "function" || typeof appendCacheBust !== "function") {
      throw new Error("fetchWithTimeout and appendCacheBust are required");
    }

    async function fetchSeedText(path, forceNetwork = false) {
      const firstUrl = forceNetwork ? appendCacheBust(path) : path;
      const requestOptions = forceNetwork ? { cache: "reload" } : {};
      try {
        const response = await fetchWithTimeout(firstUrl, requestOptions);
        if (response.ok) return await response.text();
      } catch (_) {
        // Try the stable URL below when an explicit refresh fails.
      }
      if (!forceNetwork) return null;
      try {
        const fallback = await fetchWithTimeout(path, { cache: "no-store" });
        if (fallback.ok) return await fallback.text();
      } catch (_) {
        // The caller decides whether missing seed data is fatal.
      }
      return null;
    }

    function segmentedSeedPath(path, segment) {
      const suffix = segment === "history" ? "_history" : "_recent";
      return String(path).replace(/\.json$/i, `${suffix}.json`);
    }

    async function fetchSegmentedSeedText(path, segment, forceNetwork = false) {
      const segmentedText = await fetchSeedText(segmentedSeedPath(path, segment), forceNetwork);
      if (segmentedText) return { text: segmentedText, usedFullFallback: false };
      const fullText = await fetchSeedText(path, forceNetwork);
      return { text: fullText, usedFullFallback: Boolean(fullText) };
    }

    return Object.freeze({
      fetchSeedText,
      segmentedSeedPath,
      fetchSegmentedSeedText,
    });
  }

  globalScope.ThinkStockDataSeedLoader = Object.freeze({ createDataSeedLoader });
}(typeof self !== "undefined" ? self : globalThis));
