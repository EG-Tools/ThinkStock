"use strict";

import {
  createIdleResourceLifecycle,
  createWorkerInstance,
} from "./browser-request-runtime.mjs";

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

  function createSeedBundleParser(scope = globalThis, options = {}) {
    const workerUrl = String(options.workerUrl || "./modules/data-worker.mjs?v=dev");
    const parseSync = options.parseSync;
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope) || globalThis.setTimeout.bind(globalThis);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope) || globalThis.clearTimeout.bind(globalThis);
    const createWorker = options.createWorker || ((url) => createWorkerInstance(scope, url, {
      type: "module",
      name: "thinkstock-seed-parser",
    }));
    const pending = new Map();
    let worker = null;
    let sequence = 0;
    const workerLifecycle = createIdleResourceLifecycle(scope, {
      idleMs: Math.max(5000, Number(options.workerIdleMs) || 15000),
      setTimer,
      clearTimer,
      onIdle: () => {
        if (!pending.size) discardWorker();
      },
    });

    function parseFallback(texts, error) {
      if (typeof parseSync !== "function") return Promise.reject(error);
      return Promise.resolve().then(() => parseSync(texts));
    }

    function discardWorker(error = null) {
      workerLifecycle.cancel();
      const activeWorker = worker;
      worker = null;
      try { activeWorker?.terminate(); } catch (_) {}
      if (!error) return;
      pending.forEach((request) => {
        clearTimer(request.timer);
        request.reject(error);
      });
      pending.clear();
    }

    function ensureWorker() {
      workerLifecycle.markBusy();
      if (worker) return worker;
      if (typeof createWorker !== "function"
        || (!options.createWorker && typeof scope.Worker !== "function")) return null;
      const nextWorker = createWorker(workerUrl);
      nextWorker.onmessage = (event) => {
        const id = String(event.data?.id || "");
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        clearTimer(request.timer);
        if (event.data?.ok) request.resolve(event.data?.result || {});
        else request.reject(new Error(event.data?.error || "seed parse worker failed"));
        if (!pending.size) workerLifecycle.markIdle();
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
          const timer = setTimer(() => {
            pending.delete(id);
            const error = new Error("seed parse worker timeout");
            reject(error);
            discardWorker(error);
          }, timeoutMs);
          pending.set(id, { resolve, reject, timer });
          try {
            activeWorker.postMessage({ id, type: "parseSeedBundle", texts });
          } catch (error) {
            pending.delete(id);
            clearTimer(timer);
            discardWorker();
            reject(error);
          }
        });
      } catch (error) {
        return parseFallback(texts, error);
      }
    }

    return Object.freeze({
      dispose: () => {
        workerLifecycle.dispose();
        discardWorker(new Error("seed parser disposed"));
      },
      parse,
      stats: () => Object.freeze({ active: Boolean(worker), pending: pending.size }),
    });
  }

  function createSeedBundleLoader(options = {}) {
    const seedLoader = options.seedLoader;
    const parser = options.parser;
    if (!seedLoader?.fetchSeedText || !seedLoader?.fetchSegmentedSeedText || !parser?.parse) {
      throw new Error("seed bundle loader dependencies are incomplete");
    }

    async function load(loadOptions = {}) {
      const segment = loadOptions.segment === "history" ? "history" : "recent";
      const forceNetwork = Boolean(loadOptions.forceNetwork);
      const includeDisclosures = loadOptions.includeDisclosures !== false;
      const [priceSeed, macroSeed, creditSeed, adrSeed, vkospiText, disclosureText] = await Promise.all([
        seedLoader.fetchSegmentedSeedText("./data/prices.json", segment, forceNetwork),
        seedLoader.fetchSegmentedSeedText("./data/macro_data.json", segment, forceNetwork),
        seedLoader.fetchSegmentedSeedText("./data/credit_data.json", segment, forceNetwork),
        seedLoader.fetchSegmentedSeedText("./data/adr_data.json", segment, forceNetwork),
        seedLoader.fetchSeedText("./data/vkospi_data.json", forceNetwork),
        includeDisclosures
          ? seedLoader.fetchSeedText("./data/disclosures.json", forceNetwork)
          : Promise.resolve(null),
      ]);
      const coreSeeds = [priceSeed, macroSeed, creditSeed, adrSeed];
      const parsed = await parser.parse({
        priceText: priceSeed.text,
        macroText: macroSeed.text,
        creditText: creditSeed.text,
        adrText: adrSeed.text,
        vkospiText,
        disclosureText,
      });
      return Object.freeze({
        segment,
        parsed,
        allCoreSeedsLoaded: coreSeeds.every((seed) => Boolean(seed.text)),
        allUsedFullFallback: coreSeeds.every((seed) => seed.usedFullFallback),
      });
    }

    return Object.freeze({ load });
  }

  /**
   * Owns the DART stock-code shard manifest and loaded shard state. Keeping this
   * beside the seed loader prevents the application composition root from
   * duplicating manifest, normalization, and request-deduplication policy.
   */
  function createShardedCorpCodeRegistry(options = {}) {
    const fetchText = options.fetchText;
    const runRequest = options.runRequest;
    if (typeof fetchText !== "function" || typeof runRequest !== "function") {
      throw new Error("corp code registry dependencies are incomplete");
    }
    let records = new Map();
    let manifest = null;
    const loadedShards = new Set();

    function sanitize(values) {
      const output = [];
      const source = Array.isArray(values)
        ? values
        : Object.entries(values || {}).map(([stockCode, corpCode]) => ({
          stock_code: stockCode,
          corp_code: corpCode,
        }));
      source.forEach((record) => {
        const stockCode = String(record?.stock_code || record?.stockCode || "").replace(/\D/g, "").slice(0, 6);
        const corpCode = String(record?.corp_code || record?.corpCode || "").replace(/\D/g, "").slice(0, 8);
        if (stockCode.length !== 6 || corpCode.length !== 8) return;
        output.push({
          stock_code: stockCode,
          corp_code: corpCode,
          corp_name: String(record?.corp_name || record?.corpName || "").trim(),
        });
      });
      return output;
    }

    function merge(values) {
      sanitize(values).forEach((record) => records.set(record.stock_code, record));
      return records.size;
    }

    function replace(values) {
      records = new Map();
      loadedShards.clear();
      return merge(values);
    }

    async function ensureManifest(forceNetwork = false) {
      if (manifest && !forceNetwork) return manifest;
      return runRequest("corp-manifest", "global", async () => {
        const text = await fetchText("./data/dart_corp_codes.json", forceNetwork);
        if (!text) return null;
        const payload = JSON.parse(text);
        if (payload?.format !== "stock-to-corp-shards-v1" || !payload?.files) {
          replace(payload?.codes || payload?.records || []);
        }
        manifest = payload;
        return payload;
      }, { force: forceNetwork });
    }

    async function ensure(stockCode = "", forceNetwork = false) {
      const code = String(stockCode || "").replace(/\D/g, "").slice(0, 6);
      if (code.length === 6 && records.has(code)) return true;
      const currentManifest = await ensureManifest(forceNetwork);
      if (!currentManifest) return false;
      if (currentManifest.format !== "stock-to-corp-shards-v1") {
        return code.length === 6 ? records.has(code) : records.size > 0;
      }
      const prefixLength = Math.max(1, Math.min(4, Number(currentManifest.prefix_length) || 2));
      const prefix = code.slice(0, prefixLength);
      const relativePath = currentManifest.files?.[prefix];
      if (!relativePath) return false;
      if (loadedShards.has(prefix)) return records.has(code);
      return runRequest("corp-shard", prefix, async () => {
        const path = `./${String(relativePath).replace(/^\.?\//, "")}`;
        const text = await fetchText(path, forceNetwork);
        if (!text) return false;
        const payload = JSON.parse(text);
        if (payload?.format !== "stock-to-corp-shard-v1" || !payload?.codes) return false;
        merge(payload.codes);
        loadedShards.add(prefix);
        return records.has(code);
      }, { force: forceNetwork });
    }

    return Object.freeze({
      ensure,
      get: (stockCode) => records.get(String(stockCode || "").replace(/\D/g, "").slice(0, 6)) || null,
      loadedShards: () => [...loadedShards],
      merge,
      replace,
      size: () => records.size,
    });
  }

export {
  createDataSeedLoader,
  createSeedBundleLoader,
  createSeedBundleParser,
  createShardedCorpCodeRegistry,
};
