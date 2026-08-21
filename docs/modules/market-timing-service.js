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
    const buildKoreanVolatilityTimingRows = options.buildKoreanVolatilityTimingRows;
    const buildExternalVolatilityTimingRows = options.buildExternalVolatilityTimingRows;
    const evaluateMarketTimingModel = options.evaluateMarketTimingModel;
    const buildStructuralStockProfile = options.buildStructuralStockProfile;
    const behaviorPolicy = options.behaviorPolicy
      || globalScope.ThinkStockMarketTiming?.PROMOTED_RUNTIME_BEHAVIOR_POLICY
      || { enabled: true, buyEnabled: true, sellEnabled: false };
    if (typeof buildMacdOscillator !== "function" || typeof buildMarketTimingSignals !== "function") {
      throw new Error("market timing calculation dependencies are unavailable");
    }

    const dateIndexes = new Map(dates.map((date, index) => [String(date || "").slice(0, 10), index]));
    const crisisRows = Array.isArray(sources.crisisRows) ? sources.crisisRows : [];
    const volatilityRows = Array.isArray(sources.volatilityRows)
      ? sources.volatilityRows
      : (Array.isArray(sources.adrRows) ? sources.adrRows : []);
    const koreanVolatilityRows = Array.isArray(sources.koreanVolatilityRows)
      ? sources.koreanVolatilityRows
      : (typeof buildKoreanVolatilityTimingRows === "function"
        ? buildKoreanVolatilityTimingRows(volatilityRows)
        : []);
    const externalVolatilityRows = Array.isArray(sources.externalVolatilityRows)
      ? sources.externalVolatilityRows
      : (typeof buildExternalVolatilityTimingRows === "function"
        ? buildExternalVolatilityTimingRows(volatilityRows)
        : []);
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
      const contextProfile = typeof buildStructuralStockProfile === "function"
        ? buildStructuralStockProfile({
          series: ticker,
          dates: macd.dates,
          prices: macd.prices,
          marketCandidates: ["^KS11", "^KQ11"].flatMap((series) => (
            Array.isArray(pricesByTicker[series])
              ? [{ series, dates, prices: pricesByTicker[series] }]
              : []
          )),
          asOfDate: macd.dates.at(-1),
        })
        : null;
      const model = buildMarketTimingSignals({
        indexKey: ticker,
        dates: macd.dates,
        prices: macd.prices,
        oscillator: macd.normalized,
        benchmarkPrices: macd.dates.map((date) => benchmarkPrices[dateIndexes.get(date)]),
        volumes: macd.dates.map((date) => volumeByDate.get(date) ?? null),
        adrRows: Array.isArray(sources.adrRows) ? sources.adrRows : [],
        macroRows: Array.isArray(sources.macroRows) ? sources.macroRows : [],
        creditRows: Array.isArray(sources.creditRows) ? sources.creditRows : [],
        crisisRows,
        koreanVolatilityRows,
        externalVolatilityRows,
        koreanVolatilityPolicy: { enabled: true },
        externalVolatilityPolicy: { enabled: true },
        behaviorPolicy,
      });
      const quality = typeof evaluateMarketTimingModel === "function"
        ? evaluateMarketTimingModel(model, {
          dates: macd.dates,
          prices: macd.prices,
          indexKey: ticker,
        })
        : null;
      models[ticker] = {
        ...model,
        ...(quality ? { quality } : {}),
        ...(contextProfile ? {
          contextProfile: {
            version: contextProfile.version,
            structural: contextProfile,
            diagnosticOnly: true,
          },
        } : {}),
      };
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
      buildKoreanVolatilityTimingRows: options.buildKoreanVolatilityTimingRows
        || scope.ThinkStockMarketTiming?.buildKoreanVolatilityTimingRows,
      buildExternalVolatilityTimingRows: options.buildExternalVolatilityTimingRows
        || scope.ThinkStockMarketTiming?.buildExternalVolatilityTimingRows,
      evaluateMarketTimingModel: options.evaluateMarketTimingModel
        || scope.ThinkStockMarketTimingEvaluation?.evaluateMarketTimingModel,
      buildStructuralStockProfile: options.buildStructuralStockProfile
        || scope.ThinkStockAiContextProfile?.buildStructuralStockProfile,
      summarizeMarketTimingQuality: options.summarizeMarketTimingQuality
        || scope.ThinkStockMarketTimingEvaluation?.summarizeMarketTimingQuality,
    };
    let worker = null;
    let workerSourceSignature = "";
    let currentSignature = "";
    let currentSources = null;
    let pendingPreparation = null;
    let requestSequence = 0;
    const counters = {
      prepareRequests: 0,
      targetCacheHits: 0,
      modelCalculations: 0,
      workerRequests: 0,
      workerFallbacks: 0,
    };

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
      counters.workerRequests += 1;
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
      counters.modelCalculations += targets.length;
      let calculated;
      try {
        calculated = await requestWorker(signature, targets);
      } catch (_) {
        counters.workerFallbacks += 1;
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
      counters.prepareRequests += 1;
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
      if (!missing.length) {
        counters.targetCacheHits += targets.length;
        return models;
      }
      counters.targetCacheHits += targets.length - missing.length;
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
        ...counters,
        signature: currentSignature,
        modelCount: models.size,
        workerSourceSignature,
        quality: typeof dependencies.summarizeMarketTimingQuality === "function"
          ? dependencies.summarizeMarketTimingQuality(models)
          : null,
      }),
    });
  }

  globalScope.ThinkStockMarketTimingService = Object.freeze({
    buildTimingModels,
    createMarketTimingService,
  });
}(typeof self !== "undefined" ? self : globalThis));
