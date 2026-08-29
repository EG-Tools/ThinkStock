"use strict";

  const normalizeTicker = (value) => String(value || "").trim().toUpperCase();
  const TIMING_CACHE_SCHEMA = 1;
  const TIMING_CACHE_REVISION = "market-timing-cache-v3";

  function normalizeTargets(targets) {
    return [...new Set((targets || []).map(normalizeTicker).filter(Boolean))].sort();
  }

  function hashTimingValue(value, state = 0x811c9dc5) {
    const append = (text) => {
      const source = String(text ?? "");
      for (let index = 0; index < source.length; index += 1) {
        state ^= source.charCodeAt(index);
        state = Math.imul(state, 0x01000193);
      }
      state ^= 31;
      state = Math.imul(state, 0x01000193);
    };
    const visit = (entry) => {
      if (Array.isArray(entry)) {
        append(entry.length);
        entry.forEach(visit);
      } else if (entry && typeof entry === "object") {
        Object.keys(entry).sort().forEach((key) => {
          append(key);
          visit(entry[key]);
        });
      } else {
        append(Number.isFinite(entry) ? Number(entry).toPrecision(12) : entry);
      }
    };
    visit(value);
    return state >>> 0;
  }

  function sharedTimingFingerprint(sources = {}) {
    const state = hashTimingValue([
      TIMING_CACHE_REVISION,
      sources.volatilityRows || sources.adrRows || [],
      sources.macroRows || [],
      sources.creditRows || [],
      sources.crisisRows || [],
    ]);
    return state.toString(36);
  }

  function timingInputFingerprint(sources = {}, rawTicker, sharedFingerprint = "") {
    const ticker = normalizeTicker(rawTicker);
    const benchmark = ticker === "^KQ11" || ticker.endsWith(".KQ") ? "^KQ11" : "^KS11";
    const dates = Array.isArray(sources.dates) ? sources.dates : [];
    const prices = Array.isArray(sources.pricesByTicker?.[ticker])
      ? sources.pricesByTicker[ticker]
      : [];
    const benchmarks = Array.isArray(sources.pricesByTicker?.[benchmark])
      ? sources.pricesByTicker[benchmark]
      : [];
    const marketPrices = ["^KS11", "^KQ11"].map((marketTicker) => (
      Array.isArray(sources.pricesByTicker?.[marketTicker])
        ? sources.pricesByTicker[marketTicker]
        : []
    ));
    const volumeByDate = new Map(Array.isArray(sources.volumesByTicker?.[ticker])
      ? sources.volumesByTicker[ticker]
      : []);
    const aligned = dates.flatMap((date, index) => {
      const price = Number(prices[index]);
      if (!Number.isFinite(price) || price <= 0) return [];
      return [[
        String(date || "").slice(0, 10),
        price,
        benchmarks[index] ?? null,
        marketPrices[0][index] ?? null,
        marketPrices[1][index] ?? null,
        volumeByDate.get(date) ?? null,
      ]];
    });
    const state = hashTimingValue([
      sharedFingerprint || sharedTimingFingerprint(sources),
      ticker,
      aligned,
    ]);
    return `${TIMING_CACHE_REVISION}:${state.toString(36)}`;
  }

  function createTimingCacheRecord(ticker, sources, model, sharedFingerprint = "", now = Date.now()) {
    const key = normalizeTicker(ticker);
    return {
      schema: TIMING_CACHE_SCHEMA,
      ticker: key,
      fingerprint: timingInputFingerprint(sources, key, sharedFingerprint),
      latestDate: String(sources?.dates?.at?.(-1) || "").slice(0, 10),
      savedAt: now,
      lastAccessed: now,
      model: model ?? null,
    };
  }

  function validTimingCacheRecord(record, ticker, sources, sharedFingerprint = "") {
    const key = normalizeTicker(ticker);
    return Boolean(
      Number(record?.schema) === TIMING_CACHE_SCHEMA
      && normalizeTicker(record?.ticker) === key
      && record?.model
      && record.fingerprint === timingInputFingerprint(sources, key, sharedFingerprint)
    );
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

  function createMarketTimingService(scope = globalThis, options = {}) {
    const models = new Map();
    const modelFingerprints = new Map();
    const pendingRequests = new Map();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
    const cache = options.cache || null;
    const schedulePersistence = typeof options.schedulePersistence === "function"
      ? options.schedulePersistence
      : null;
    const workerUrl = String(options.workerUrl || "./assets/market-timing-worker.bundle.min.js?v=dev");
    const createWorker = options.createWorker || ((url) => new scope.Worker(url));
    const dependencies = {
      buildMacdOscillator: options.buildMacdOscillator,
      buildMarketTimingSignals: options.buildMarketTimingSignals,
      buildKoreanVolatilityTimingRows: options.buildKoreanVolatilityTimingRows,
      buildExternalVolatilityTimingRows: options.buildExternalVolatilityTimingRows,
      evaluateMarketTimingModel: options.evaluateMarketTimingModel,
      buildStructuralStockProfile: options.buildStructuralStockProfile,
      summarizeMarketTimingQuality: options.summarizeMarketTimingQuality,
    };
    let worker = null;
    let workerSourceSignature = "";
    let currentSignature = "";
    let currentSources = null;
    let pendingPreparation = null;
    let requestSequence = 0;
    let currentSharedFingerprint = "";
    const workerLifecycle = typeof options.createIdleResourceLifecycle === "function"
      ? options.createIdleResourceLifecycle(scope, {
        idleMs: Math.max(10000, Number(options.workerIdleMs) || 60000),
        onIdle: () => discardWorker(),
      })
      : null;
    const counters = {
      prepareRequests: 0,
      targetCacheHits: 0,
      modelCalculations: 0,
      workerRequests: 0,
      workerFallbacks: 0,
      persistentCacheHits: 0,
      persistentCacheWrites: 0,
      deferredCacheWrites: 0,
    };

    function rejectPending(error) {
      pendingRequests.forEach((request) => {
        clearTimeout(request.timer);
        request.reject(error);
      });
      pendingRequests.clear();
    }

    function discardWorker(error = null) {
      workerLifecycle?.cancel();
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
        if (!pendingRequests.size) workerLifecycle?.markIdle();
      };
      nextWorker.onerror = (event) => {
        discardWorker(new Error(event?.message || "market timing worker failed"));
      };
      worker = nextWorker;
      return worker;
    }

    function requestWorker(signature, targets) {
      workerLifecycle?.markBusy();
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
          if (!pendingRequests.size) workerLifecycle?.markIdle();
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

    function enrichCachedModel(ticker, model) {
      if (!model || !currentSources) return model ?? null;
      const prices = currentSources.pricesByTicker?.[ticker] || [];
      const dates = currentSources.dates || [];
      const quality = model.quality || (typeof dependencies.evaluateMarketTimingModel === "function"
        ? dependencies.evaluateMarketTimingModel(model, { dates, prices, indexKey: ticker })
        : null);
      const structural = model.contextProfile?.structural
        || (typeof dependencies.buildStructuralStockProfile === "function"
          ? dependencies.buildStructuralStockProfile({
            series: ticker,
            dates,
            prices,
            marketCandidates: ["^KS11", "^KQ11"].flatMap((series) => (
              Array.isArray(currentSources.pricesByTicker?.[series])
                ? [{ series, dates, prices: currentSources.pricesByTicker[series] }]
                : []
            )),
            asOfDate: dates.at(-1),
          })
          : null);
      return {
        ...model,
        ...(quality ? { quality } : {}),
        ...(structural ? {
          contextProfile: { version: structural.version, structural, diagnosticOnly: true },
        } : {}),
      };
    }

    async function hydrateMissing(targets) {
      if (!cache?.readMany || !targets.length || !currentSources) return;
      let records;
      try { records = await cache.readMany(targets); } catch (_) { return; }
      if (!(records instanceof Map)) return;
      targets.forEach((ticker) => {
        const record = records.get(ticker);
        if (!validTimingCacheRecord(record, ticker, currentSources, currentSharedFingerprint)) return;
        models.set(ticker, enrichCachedModel(ticker, record.model));
        modelFingerprints.set(ticker, record.fingerprint);
        counters.persistentCacheHits += 1;
      });
    }

    async function persistModels(targets) {
      if (!cache?.writeMany || !targets.length || !currentSources) return;
      const entries = targets.flatMap((ticker) => {
        const model = models.get(ticker);
        return model ? [[ticker, createTimingCacheRecord(
          ticker,
          currentSources,
          model,
          currentSharedFingerprint,
        )]] : [];
      });
      if (!entries.length) return;
      try {
        await cache.writeMany(new Map(entries));
        counters.persistentCacheWrites += entries.length;
      } catch (_) {}
    }

    function persistCalculatedModels(signature, targets) {
      const persist = () => persistModels(targets);
      if (!schedulePersistence) return persist();
      counters.deferredCacheWrites += targets.length;
      try {
        const scheduled = schedulePersistence(persist, { signature, targets: [...targets] });
        scheduled?.catch?.(() => {});
      } catch (_) {}
      return null;
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
        const key = normalizeTicker(ticker);
        models.set(key, model ?? null);
        modelFingerprints.set(
          key,
          timingInputFingerprint(currentSources, key, currentSharedFingerprint),
        );
      });
      targets.forEach((ticker) => {
        if (!models.has(ticker)) {
          models.set(ticker, null);
          modelFingerprints.set(
            ticker,
            timingInputFingerprint(currentSources, ticker, currentSharedFingerprint),
          );
        }
      });
      // Signal rendering must not wait for IndexedDB. The application scheduler
      // serializes this write later, while direct consumers keep synchronous
      // persistence for deterministic tests and non-UI usage.
      await persistCalculatedModels(signature, targets);
    }

    async function prepare(input = {}) {
      counters.prepareRequests += 1;
      const signature = String(input.signature || "");
      const targets = normalizeTargets(input.targets);
      if (!signature || !targets.length) return models;
      if (pendingPreparation) await pendingPreparation.catch(() => {});
      if (signature !== currentSignature) {
        const nextSources = input.sources || currentSources;
        if (!nextSources) throw new Error("market timing sources are unavailable");
        const nextSharedFingerprint = sharedTimingFingerprint(nextSources);
        models.forEach((_model, ticker) => {
          const nextFingerprint = timingInputFingerprint(nextSources, ticker, nextSharedFingerprint);
          if (modelFingerprints.get(ticker) === nextFingerprint) return;
          models.delete(ticker);
          modelFingerprints.delete(ticker);
        });
        currentSignature = signature;
        currentSources = nextSources;
        currentSharedFingerprint = nextSharedFingerprint;
      } else if (input.sources) {
        currentSources = input.sources;
      }
      if (!currentSources) throw new Error("market timing sources are unavailable");
      if (!currentSharedFingerprint) currentSharedFingerprint = sharedTimingFingerprint(currentSources);

      let missing = targets.filter((ticker) => !models.has(ticker));
      await hydrateMissing(missing);
      missing = targets.filter((ticker) => !models.has(ticker));
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
      currentSharedFingerprint = "";
      models.clear();
      modelFingerprints.clear();
      discardWorker();
    }

    function invalidate(tickerValue) {
      const ticker = normalizeTicker(tickerValue);
      if (!ticker) return false;
      const removed = models.delete(ticker);
      modelFingerprints.delete(ticker);
      return removed;
    }

    function dispose() {
      clear();
      workerLifecycle?.dispose();
    }

    return Object.freeze({
      clear,
      dispose,
      get: (ticker) => models.get(normalizeTicker(ticker)) ?? null,
      has: (ticker) => models.has(normalizeTicker(ticker)),
      invalidate,
      prepare,
      stats: () => ({
        ...counters,
        signature: currentSignature,
        modelCount: models.size,
        fingerprintCount: modelFingerprints.size,
        workerSourceSignature,
        workerLifecycle: workerLifecycle?.stats?.() || null,
        quality: typeof dependencies.summarizeMarketTimingQuality === "function"
          ? dependencies.summarizeMarketTimingQuality(models)
          : null,
      }),
    });
  }

  const marketTimingService = Object.freeze({
    TIMING_CACHE_REVISION,
    TIMING_CACHE_SCHEMA,
    buildTimingModels,
    createTimingCacheRecord,
    createMarketTimingService,
    sharedTimingFingerprint,
    timingInputFingerprint,
    validTimingCacheRecord,
  });

export {
  TIMING_CACHE_REVISION,
  TIMING_CACHE_SCHEMA,
  buildTimingModels,
  createTimingCacheRecord,
  createMarketTimingService,
  sharedTimingFingerprint,
  timingInputFingerprint,
  validTimingCacheRecord,
};
export default marketTimingService;
