"use strict";

  const normalizeTicker = (value) => String(value || "").trim().toUpperCase();
  const TIMING_CACHE_SCHEMA = 1;
  const TIMING_CACHE_REVISION = "market-timing-cache-v12";

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
      sources.dates || [],
      sources.pricesByTicker?.["^KS11"] || [],
      sources.pricesByTicker?.["^KQ11"] || [],
      sources.volatilityRows || sources.adrRows || [],
      sources.macroRows || [],
      sources.creditRows || [],
      sources.crisisRows || [],
    ]);
    return state.toString(36);
  }

  function timingInputFingerprint(sources = {}, rawTicker, sharedFingerprint = "") {
    const ticker = normalizeTicker(rawTicker);
    const dates = Array.isArray(sources.dates) ? sources.dates : [];
    const prices = Array.isArray(sources.pricesByTicker?.[ticker])
      ? sources.pricesByTicker[ticker]
      : [];
    const volumeByDate = new Map((Array.isArray(sources.volumesByTicker?.[ticker])
      ? sources.volumesByTicker[ticker]
      : []).map(([date, volume]) => [String(date || "").slice(0, 10), volume]));
    const alignedVolumes = dates.map((date) => (
      volumeByDate.get(String(date || "").slice(0, 10)) ?? null
    ));
    const state = hashTimingValue([
      sharedFingerprint || sharedTimingFingerprint(sources),
      ticker,
      prices,
      alignedVolumes,
    ]);
    return `${TIMING_CACHE_REVISION}:${state.toString(36)}`;
  }

  function createTimingCacheRecord(
    ticker,
    sources,
    model,
    sharedFingerprint = "",
    now = Date.now(),
    inputFingerprint = "",
  ) {
    const key = normalizeTicker(ticker);
    return {
      schema: TIMING_CACHE_SCHEMA,
      ticker: key,
      fingerprint: inputFingerprint || timingInputFingerprint(sources, key, sharedFingerprint),
      latestDate: String(sources?.dates?.at?.(-1) || "").slice(0, 10),
      savedAt: now,
      lastAccessed: now,
      model: model ?? null,
    };
  }

  function validTimingCacheRecord(record, ticker, sources, sharedFingerprint = "", inputFingerprint = "") {
    const key = normalizeTicker(ticker);
    return Boolean(
      Number(record?.schema) === TIMING_CACHE_SCHEMA
      && normalizeTicker(record?.ticker) === key
      && record?.model
      && record.fingerprint === (
        inputFingerprint || timingInputFingerprint(sources, key, sharedFingerprint)
      )
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
    if (typeof buildMacdOscillator !== "function"
      || typeof buildMarketTimingSignals !== "function") {
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
      const timingInputs = {
        indexKey: ticker,
        dates: macd.dates,
        prices: macd.prices,
        oscillator: macd.normalized,
        benchmarkPrices: macd.dates.map((date) => benchmarkPrices[dateIndexes.get(date)]),
        volumes: macd.dates.map((date) => volumeByDate.get(date) ?? null),
        marketPricesByTicker: Object.fromEntries(["^KS11", "^KQ11"].map((marketTicker) => [
          marketTicker,
          macd.dates.map((date) => pricesByTicker[marketTicker]?.[dateIndexes.get(date)] ?? null),
        ])),
        adrRows: Array.isArray(sources.adrRows) ? sources.adrRows : [],
        macroRows: Array.isArray(sources.macroRows) ? sources.macroRows : [],
        creditRows: Array.isArray(sources.creditRows) ? sources.creditRows : [],
        crisisRows,
        koreanVolatilityRows,
        externalVolatilityRows,
      };
      const model = buildMarketTimingSignals({
        ...timingInputs,
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
    const inputFingerprints = new Map();
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
    const pendingTargetPreparations = new Map();
    const activePreparationsBySignature = new Map();
    const preparationIdleWaiters = new Set();
    let serviceGeneration = 0;
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
      inputFingerprintCalculations: 0,
      coalescedTargets: 0,
    };

    function activePreparationCount() {
      return [...activePreparationsBySignature.values()]
        .reduce((total, count) => total + count, 0);
    }

    function waitForPreparationIdle() {
      if (!activePreparationCount()) return Promise.resolve();
      return new Promise((resolve) => preparationIdleWaiters.add(resolve));
    }

    function enterPreparation(signature) {
      activePreparationsBySignature.set(
        signature,
        (activePreparationsBySignature.get(signature) || 0) + 1,
      );
    }

    function leavePreparation(signature) {
      const next = (activePreparationsBySignature.get(signature) || 1) - 1;
      if (next > 0) activePreparationsBySignature.set(signature, next);
      else activePreparationsBySignature.delete(signature);
      if (activePreparationCount()) return;
      const waiters = [...preparationIdleWaiters];
      preparationIdleWaiters.clear();
      waiters.forEach((resolve) => resolve());
    }

    function fingerprintFor(tickerValue) {
      const ticker = normalizeTicker(tickerValue);
      if (inputFingerprints.has(ticker)) return inputFingerprints.get(ticker);
      const fingerprint = timingInputFingerprint(
        currentSources,
        ticker,
        currentSharedFingerprint,
      );
      inputFingerprints.set(ticker, fingerprint);
      counters.inputFingerprintCalculations += 1;
      return fingerprint;
    }

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
        if (!validTimingCacheRecord(
          record,
          ticker,
          currentSources,
          currentSharedFingerprint,
          fingerprintFor(ticker),
        )) return;
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
          Date.now(),
          fingerprintFor(ticker),
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

    async function calculateMissing(signature, targets, generation) {
      counters.modelCalculations += targets.length;
      let calculated;
      try {
        calculated = await requestWorker(signature, targets);
      } catch (_) {
        if (generation !== serviceGeneration || signature !== currentSignature) return;
        counters.workerFallbacks += 1;
        calculated = calculateFallback(targets);
      }
      if (generation !== serviceGeneration || signature !== currentSignature) return;
      Object.entries(calculated || {}).forEach(([ticker, model]) => {
        const key = normalizeTicker(ticker);
        models.set(key, model ?? null);
        modelFingerprints.set(key, fingerprintFor(key));
      });
      targets.forEach((ticker) => {
        if (!models.has(ticker)) {
          models.set(ticker, null);
          modelFingerprints.set(ticker, fingerprintFor(ticker));
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
      while (signature !== currentSignature && activePreparationCount()) {
        await waitForPreparationIdle();
      }
      if (signature !== currentSignature) {
        const nextSources = input.sources || currentSources;
        if (!nextSources) throw new Error("market timing sources are unavailable");
        const nextSharedFingerprint = sharedTimingFingerprint(nextSources);
        currentSources = nextSources;
        currentSharedFingerprint = nextSharedFingerprint;
        inputFingerprints.clear();
        models.forEach((_model, ticker) => {
          const nextFingerprint = fingerprintFor(ticker);
          if (modelFingerprints.get(ticker) === nextFingerprint) return;
          models.delete(ticker);
          modelFingerprints.delete(ticker);
        });
        currentSignature = signature;
      } else if (input.sources) {
        currentSources = input.sources;
      }
      if (!currentSources) throw new Error("market timing sources are unavailable");
      if (!currentSharedFingerprint) currentSharedFingerprint = sharedTimingFingerprint(currentSources);
      const activeSignature = currentSignature;
      const generation = serviceGeneration;
      enterPreparation(activeSignature);
      try {
        const existingTargets = targets.filter((ticker) => models.has(ticker));
        counters.targetCacheHits += existingTargets.length;
        const initiallyMissing = targets.filter((ticker) => (
          !models.has(ticker) && !pendingTargetPreparations.has(ticker)
        ));
        await hydrateMissing(initiallyMissing);

        const waiting = targets.flatMap((ticker) => {
          const pending = pendingTargetPreparations.get(ticker);
          return pending ? [pending] : [];
        });
        counters.coalescedTargets += waiting.length;
        const missing = targets.filter((ticker) => (
          !models.has(ticker) && !pendingTargetPreparations.has(ticker)
        ));
        let calculation = null;
        if (missing.length) {
          calculation = calculateMissing(activeSignature, missing, generation)
            .finally(() => {
              missing.forEach((ticker) => {
                if (pendingTargetPreparations.get(ticker) === calculation) {
                  pendingTargetPreparations.delete(ticker);
                }
              });
            });
          missing.forEach((ticker) => pendingTargetPreparations.set(ticker, calculation));
        }
        await Promise.all([...new Set([
          ...waiting,
          ...(calculation ? [calculation] : []),
        ])]);
        if (activeSignature !== currentSignature) return prepare(input);
        return models;
      } finally {
        leavePreparation(activeSignature);
      }
    }

    function clear() {
      serviceGeneration += 1;
      currentSignature = "";
      currentSources = null;
      currentSharedFingerprint = "";
      models.clear();
      modelFingerprints.clear();
      inputFingerprints.clear();
      pendingTargetPreparations.clear();
      discardWorker(new Error("market timing service cleared"));
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
        pendingTargets: pendingTargetPreparations.size,
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
