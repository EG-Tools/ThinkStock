(function initThinkStockMarketTimingService(globalScope) {
  "use strict";

  const normalizeTicker = (value) => String(value || "").trim().toUpperCase();

  function normalizeTargets(targets) {
    return [...new Set((targets || []).map(normalizeTicker).filter(Boolean))].sort();
  }

  function buildTimingModels(options = {}) {
    const sources = options.sources || {};
    const dates = Array.isArray(sources.dates) ? sources.dates : [];
    const pricesByTicker = sources.pricesByTicker || {};
    const volumesByTicker = sources.volumesByTicker || {};
    const buildMacdOscillator = options.buildMacdOscillator;
    const buildMarketTimingSignals = options.buildMarketTimingSignals;
    if (typeof buildMacdOscillator !== "function" || typeof buildMarketTimingSignals !== "function") {
      throw new Error("market timing calculation dependencies are unavailable");
    }

    const dateIndexes = new Map(dates.map((date, index) => [String(date || "").slice(0, 10), index]));
    const models = {};
    normalizeTargets(options.targets).forEach((ticker) => {
      const prices = Array.isArray(pricesByTicker[ticker]) ? pricesByTicker[ticker] : [];
      const macd = buildMacdOscillator({ dates, prices });
      if (!macd) {
        models[ticker] = null;
        return;
      }
      const benchmarkKey = ticker === "^KQ11" || ticker.endsWith(".KQ") ? "^KQ11" : "^KS11";
      const benchmarkPrices = Array.isArray(pricesByTicker[benchmarkKey])
        ? pricesByTicker[benchmarkKey]
        : [];
      const volumeByDate = new Map(Array.isArray(volumesByTicker[ticker])
        ? volumesByTicker[ticker]
        : []);
      models[ticker] = buildMarketTimingSignals({
        indexKey: ticker,
        dates: macd.dates,
        prices: macd.prices,
        oscillator: macd.normalized,
        benchmarkPrices: macd.dates.map((date) => benchmarkPrices[dateIndexes.get(date)]),
        volumes: macd.dates.map((date) => volumeByDate.get(date) ?? null),
        adrRows: Array.isArray(sources.adrRows) ? sources.adrRows : [],
        macroRows: Array.isArray(sources.macroRows) ? sources.macroRows : [],
        creditRows: Array.isArray(sources.creditRows) ? sources.creditRows : [],
        crisisRows: Array.isArray(sources.crisisRows) ? sources.crisisRows : [],
      });
    });
    return models;
  }

  function createMarketTimingService(scope = globalScope, options = {}) {
    const models = new Map();
    const pendingRequests = new Map();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
    const workerUrl = String(options.workerUrl || "./modules/market-timing-worker.js");
    const createWorker = options.createWorker || ((url) => new scope.Worker(url));
    const dependencies = {
      buildMacdOscillator: options.buildMacdOscillator
        || scope.ThinkStockMacdOscillator?.buildMacdOscillator,
      buildMarketTimingSignals: options.buildMarketTimingSignals
        || scope.ThinkStockMarketTiming?.buildMarketTimingSignals,
    };
    let worker = null;
    let workerSourceSignature = "";
    let currentSignature = "";
    let currentSources = null;
    let pendingPreparation = null;
    let requestSequence = 0;

    function rejectPending(error) {
      pendingRequests.forEach((request) => {
        clearTimeout(request.timer);
        request.reject(error);
      });
      pendingRequests.clear();
    }

    function discardWorker(error = null) {
      const activeWorker = worker;
      worker = null;
      workerSourceSignature = "";
      try { activeWorker?.terminate(); } catch (_) {}
      if (error) rejectPending(error);
    }

    function ensureWorker() {
      if (worker) return worker;
      if (typeof createWorker !== "function" || (!options.createWorker && typeof scope.Worker !== "function")) {
        return null;
      }
      const nextWorker = createWorker(workerUrl);
      nextWorker.onmessage = (event) => {
        const id = Number(event.data?.id);
        const request = pendingRequests.get(id);
        if (!request) return;
        pendingRequests.delete(id);
        clearTimeout(request.timer);
        if (event.data?.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data?.models || {});
      };
      nextWorker.onerror = (event) => {
        discardWorker(new Error(event?.message || "market timing worker failed"));
      };
      worker = nextWorker;
      return worker;
    }

    function requestWorker(signature, targets) {
      const activeWorker = ensureWorker();
      if (!activeWorker) return Promise.reject(new Error("market timing worker is unavailable"));
      const id = ++requestSequence;
      const includeSources = workerSourceSignature !== signature;
      if (includeSources) workerSourceSignature = signature;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          discardWorker();
          reject(new Error("market timing worker timeout"));
        }, timeoutMs);
        pendingRequests.set(id, { resolve, reject, timer });
        try {
          activeWorker.postMessage({
            id,
            signature,
            targets,
            ...(includeSources ? { sources: currentSources } : {}),
          });
        } catch (error) {
          clearTimeout(timer);
          pendingRequests.delete(id);
          workerSourceSignature = "";
          reject(error);
        }
      });
    }

    function calculateFallback(targets) {
      return buildTimingModels({
        sources: currentSources,
        targets,
        ...dependencies,
      });
    }

    async function calculateMissing(signature, targets) {
      let calculated;
      try {
        calculated = await requestWorker(signature, targets);
      } catch (_) {
        calculated = calculateFallback(targets);
      }
      Object.entries(calculated || {}).forEach(([ticker, model]) => {
        models.set(normalizeTicker(ticker), model ?? null);
      });
      targets.forEach((ticker) => {
        if (!models.has(ticker)) models.set(ticker, null);
      });
    }

    async function prepare(input = {}) {
      const signature = String(input.signature || "");
      const targets = normalizeTargets(input.targets);
      if (!signature || !targets.length) return models;
      if (pendingPreparation) await pendingPreparation.catch(() => {});
      if (signature !== currentSignature) {
        currentSignature = signature;
        currentSources = input.sources || null;
        models.clear();
      } else if (input.sources) {
        currentSources = input.sources;
      }
      if (!currentSources) throw new Error("market timing sources are unavailable");

      const missing = targets.filter((ticker) => !models.has(ticker));
      if (!missing.length) return models;
      const activeSignature = currentSignature;
      pendingPreparation = calculateMissing(activeSignature, missing)
        .finally(() => { pendingPreparation = null; });
      await pendingPreparation;
      if (activeSignature !== currentSignature) return prepare(input);
      return models;
    }

    function clear() {
      currentSignature = "";
      currentSources = null;
      models.clear();
      discardWorker();
    }

    return Object.freeze({
      clear,
      get: (ticker) => models.get(normalizeTicker(ticker)) ?? null,
      has: (ticker) => models.has(normalizeTicker(ticker)),
      prepare,
      stats: () => ({
        signature: currentSignature,
        modelCount: models.size,
        workerSourceSignature,
      }),
    });
  }

  globalScope.ThinkStockMarketTimingService = Object.freeze({
    buildTimingModels,
    createMarketTimingService,
  });
}(typeof self !== "undefined" ? self : globalThis));
