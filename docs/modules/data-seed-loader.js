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

  function createSeedBundleParser(scope = globalScope, options = {}) {
    const workerUrl = String(options.workerUrl || "./modules/data-worker.js?v=dev");
    const parseSync = options.parseSync;
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);
    const createWorker = options.createWorker || ((url) => new scope.Worker(url));
    const pending = new Map();
    let worker = null;
    let sequence = 0;

    function parseFallback(texts, error) {
      if (typeof parseSync !== "function") return Promise.reject(error);
      return Promise.resolve().then(() => parseSync(texts));
    }

    function discardWorker(error = null) {
      const activeWorker = worker;
      worker = null;
      try { activeWorker?.terminate(); } catch (_) {}
      if (!error) return;
      pending.forEach((request) => {
        clearTimeout(request.timer);
        request.reject(error);
      });
      pending.clear();
    }

    function ensureWorker() {
      if (worker) return worker;
      if (typeof createWorker !== "function"
        || (!options.createWorker && typeof scope.Worker !== "function")) return null;
      const nextWorker = createWorker(workerUrl);
      nextWorker.onmessage = (event) => {
        const id = String(event.data?.id || "");
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        clearTimeout(request.timer);
        if (event.data?.ok) request.resolve(event.data?.result || {});
        else request.reject(new Error(event.data?.error || "seed parse worker failed"));
      };
      nextWorker.onerror = (event) => {
        discardWorker(new Error(event?.message || "seed parse worker failed"));
      };
      worker = nextWorker;
      return worker;
    }

    async function parse(texts) {
      const activeWorker = ensureWorker();
      if (!activeWorker) return parseFallback(texts, new Error("seed parse worker is unavailable"));
      const id = `${Date.now()}-${++sequence}`;
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            const error = new Error("seed parse worker timeout");
            reject(error);
            discardWorker(error);
          }, timeoutMs);
          pending.set(id, { resolve, reject, timer });
          activeWorker.postMessage({ id, type: "parseSeedBundle", texts });
        });
      } catch (error) {
        return parseFallback(texts, error);
      }
    }

    return Object.freeze({
      dispose: () => discardWorker(new Error("seed parser disposed")),
      parse,
      stats: () => Object.freeze({ active: Boolean(worker), pending: pending.size }),
    });
  }

  globalScope.ThinkStockDataSeedLoader = Object.freeze({
    createDataSeedLoader,
    createSeedBundleParser,
  });
}(typeof self !== "undefined" ? self : globalThis));
