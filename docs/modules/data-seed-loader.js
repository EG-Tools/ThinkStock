(function initDataSeedLoader(globalScope) {
  "use strict";

  function createDataSeedLoader(options = {}) {
    const fetchWithTimeout = options.fetchWithTimeout;
    const appendCacheBust = options.appendCacheBust;
    const manifestPath = String(options.manifestPath || "./data/data_manifest.json");
    let manifest = null;
    let manifestPromise = null;
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

    async function fetchDataManifest(forceNetwork = false) {
      if (manifest && !forceNetwork) return manifest;
      if (manifestPromise) return manifestPromise;
      manifestPromise = (async () => {
        const text = await fetchSeedText(manifestPath, forceNetwork);
        if (!text) return null;
        try {
          const payload = JSON.parse(text);
          if (payload?.format !== "segmented-data-v1" || !payload?.datasets) return null;
          manifest = payload;
          return payload;
        } catch (_) {
          return null;
        }
      })().finally(() => {
        manifestPromise = null;
      });
      return manifestPromise;
    }

    function manifestSegmentPath(path, segment, payload) {
      const filename = String(path).split("/").pop() || "";
      const stem = filename.replace(/\.json$/i, "");
      const segmentFile = payload?.datasets?.[stem]?.[segment]?.file;
      if (!segmentFile) return segmentedSeedPath(path, segment);
      return `./data/${String(segmentFile).replace(/^\.?\//, "")}`;
    }

    async function fetchSegmentedSeedText(path, segment, forceNetwork = false) {
      const dataManifest = await fetchDataManifest(forceNetwork);
      const segmentPath = manifestSegmentPath(path, segment, dataManifest);
      const segmentedText = await fetchSeedText(segmentPath, forceNetwork);
      if (segmentedText) return { text: segmentedText, usedFullFallback: false };
      const fullText = await fetchSeedText(path, forceNetwork);
      return { text: fullText, usedFullFallback: Boolean(fullText) };
    }

    return Object.freeze({
      fetchSeedText,
      fetchDataManifest,
      segmentedSeedPath,
      manifestSegmentPath,
      fetchSegmentedSeedText,
    });
  }

  globalScope.ThinkStockDataSeedLoader = Object.freeze({ createDataSeedLoader });
}(typeof self !== "undefined" ? self : globalThis));
