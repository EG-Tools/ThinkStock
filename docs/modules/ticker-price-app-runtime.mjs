function tickerKey(value) {
  return String(value || "").trim().toUpperCase();
}

function isoDate(value) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

export function shiftHistorySinceDate(value, overlapDays = 21) {
  const date = isoDate(value);
  if (!date) return "";
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return date;
  const days = Math.max(0, Math.floor(Number(overlapDays) || 0));
  return new Date(time - (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

export function hasCompleteTradingCoverage(existingPoints, incomingPoints, isTradingDate) {
  if (typeof isTradingDate !== "function") return true;
  const existingDates = (Array.isArray(existingPoints) ? existingPoints : [])
    .map((point) => isoDate(point?.date))
    .filter(Boolean)
    .sort();
  const incomingDates = (Array.isArray(incomingPoints) ? incomingPoints : [])
    .map((point) => isoDate(point?.date))
    .filter(Boolean)
    .sort();
  const start = existingDates.at(-1) || "";
  const end = incomingDates.at(-1) || "";
  if (!start || !end || end <= start) return true;

  const availableDates = new Set([...existingDates, ...incomingDates]);
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return true;
  for (let time = startTime + (24 * 60 * 60 * 1000); time <= endTime; time += 24 * 60 * 60 * 1000) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (isTradingDate(date) && !availableDates.has(date)) return false;
  }
  return true;
}

export function createPreferredTickerHistoryFetcher(options = {}) {
  if (typeof options.fetchWithTimeout !== "function") {
    throw new TypeError("ticker history fetcher is required");
  }
  if (typeof options.normalizePoints !== "function") {
    throw new TypeError("ticker history normalizer is required");
  }
  const endpoint = String(options.endpoint || "").trim();
  if (!endpoint) throw new TypeError("ticker history endpoint is required");
  const appendCacheBust = typeof options.appendCacheBust === "function"
    ? options.appendCacheBust
    : (url) => url;

  return async function fetchPreferredTickerHistory(ticker, requestOptions = {}) {
    const key = tickerKey(ticker);
    if (!/^\d{6}\.(KS|KQ)$/.test(key)) return [];
    const sinceDate = String(requestOptions.sinceDate || "").slice(0, 10);
    const query = new URLSearchParams({ ticker: key });
    if (sinceDate) query.set("since", sinceDate);
    else query.set("full", "1");

    const headers = {};
    if (options.isLocalRuntime !== true) {
      const accessToken = String(options.getAccessToken?.() || "").trim();
      if (!accessToken) throw new Error("Think Stock access token is unavailable");
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const response = await options.fetchWithTimeout(
      appendCacheBust(`${endpoint}?${query}`),
      { cache: "no-store", headers, signal: requestOptions.signal || null },
      options.timeoutMs,
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || `Price history HTTP ${response.status}`);
    }
    return options.normalizePoints(payload.rows, key);
  };
}

/**
 * @param {{run?: Function, has?: Function, tag?: Function}|null} registry
 * @param {(ticker: string, options?: object) => Promise<unknown>} loadSeries
 */
export function createTickerPriceRequestRunner(registry, loadSeries) {
  if (typeof loadSeries !== "function") throw new TypeError("ticker price loader is required");
  return function runTickerPriceRequest(ticker, loadOptions = {}) {
    const key = tickerKey(ticker);
    if (!registry?.run || loadOptions.returnAfterCache === true) {
      return loadSeries(key, loadOptions);
    }
    const requestKey = `ticker-price:${key}`;
    const force = loadOptions.forceRefresh === true;
    return registry.run(requestKey, (signal) => loadSeries(key, {
      ...loadOptions,
      signal,
    }), {
      signal: loadOptions.signal || null,
      tag: force ? "force" : "normal",
      afterCurrent: force && registry.has?.(requestKey) && registry.tag?.(requestKey) !== "force",
    });
  };
}

export function createTickerPriceAppRuntime(options = {}) {
  const runtime = options.tickerPriceRuntime;
  const invalidation = options.tickerCacheInvalidation;
  const lifecycle = options.cacheLifecycle;
  if (!runtime?.createPayloadController || !runtime?.createCacheRepository || !runtime?.createSeriesLoader) {
    throw new Error("ticker price runtime is required");
  }
  if (!invalidation?.createTickerCacheInvalidator || !lifecycle?.recordLifecycle) {
    throw new Error("ticker cache contracts are required");
  }

  let payloadController = null;
  let cacheRepository = null;
  let cacheInvalidator = null;
  let seriesLoader = null;
  let historyCoordinator = null;

  function displayName(ticker) {
    return options.getDisplayName?.(ticker) || ticker;
  }

  function normalizePointsForTicker(points, ticker = "") {
    const key = tickerKey(ticker);
    const normalized = options.normalizePricePoints(points);
    if (!/^\d{6}\.(KS|KQ)$/.test(key)) return normalized;
    return normalized.filter((point) => options.isMarketPricePoint(point.date, point.volume));
  }

  function hasSeries(ticker) {
    const key = tickerKey(ticker);
    return (options.getPayload()?.records || []).some((row) => options.toNumber(row?.[key]) !== null);
  }

  function getPayloadController() {
    if (payloadController) return payloadController;
    payloadController = runtime.createPayloadController({
      getPayload: options.getPayload,
      setPayload: options.setPayload,
      volumesByTicker: options.volumesByTicker,
      toNumber: options.toNumber,
      normalizePoints: normalizePointsForTicker,
      sameNumber: options.sameNumber,
      assertPoints: options.assertPricePoints,
      displayName,
      onClear: options.onClearSeries,
      onChanged: options.onPayloadChanged,
    });
    return payloadController;
  }

  function clearSeries(ticker) {
    getPayloadController().clear(ticker);
  }

  function mergeSeries(ticker, points, mergeOptions = {}) {
    return getPayloadController().merge(ticker, points, mergeOptions);
  }

  function latestDate(ticker) {
    return getPayloadController().latestDate(ticker);
  }

  function points(ticker) {
    return getPayloadController().points(ticker);
  }

  function hasVolumeHistory(ticker, minimumPoints = 20) {
    return getPayloadController().hasVolumeHistory(ticker, minimumPoints);
  }

  function isCacheFresh(candidateLatestDate, ticker) {
    const key = tickerKey(ticker);
    const benchmark = key.endsWith(".KQ") ? "^KQ11" : "^KS11";
    return runtime.isCacheFresh({
      latestDate: candidateLatestDate,
      expectedDate: options.expectedLatestTradingDate(new Date()),
      benchmarkDate: latestDate(benchmark),
      status: options.getStatus(key),
      nowMs: Date.now(),
      maxAgeMs: options.dayMs,
    });
  }

  function getCacheRepository() {
    if (cacheRepository) return cacheRepository;
    cacheRepository = runtime.createCacheRepository({
      storeName: options.priceStoreName,
      schema: options.cacheSchema,
      normalizePoints: normalizePointsForTicker,
      inspectIntegrity: runtime.inspectPriceHistoryIntegrity,
      ensureRetention: options.ensureRetention,
      retention: options.retention,
      runMutation: options.runCacheMutation,
      readActiveRecord: options.readLifecycleRecord,
      writeRecord: options.writeRecord,
      writeRecords: options.writeRecords,
      deleteRecord: options.deleteRecord,
      fingerprint: options.fingerprintDatedSeries,
      recordIssue: options.recordIssue,
      withMetadata: options.withCacheMetadata,
      normalizeStatus: options.normalizeStatus,
      getStatus: options.getStatus,
      displayName,
    });
    return cacheRepository;
  }

  function readPriceCache(ticker) {
    return getCacheRepository().read(ticker);
  }

  function removePriceCache(ticker) {
    return getCacheRepository().remove(ticker);
  }

  function normalizeResearchHistory(value, ticker) {
    return runtime.normalizeResearchHistoryCache(value, ticker, normalizePointsForTicker, {
      schema: options.researchCacheSchema,
    });
  }

  function priceCacheToResearchHistory(value, ticker) {
    return runtime.priceCacheToResearchHistory(value, ticker, normalizePointsForTicker, {
      priceSchema: options.cacheSchema,
      researchSchema: options.researchCacheSchema,
    });
  }

  async function readResearchHistory(ticker) {
    const key = tickerKey(ticker);
    if (!key) return null;
    try {
      const [priceValue, researchValue] = await Promise.all([
        readPriceCache(key),
        options.readLifecycleRecord(options.researchStoreName, key),
      ]);
      return runtime.selectPreferredResearchHistory(
        priceCacheToResearchHistory(priceValue, key),
        normalizeResearchHistory(researchValue, key),
      );
    } catch (_) {
      return null;
    }
  }

  async function readResearchHistories(tickers) {
    const keys = [...new Set((Array.isArray(tickers) ? tickers : [])
      .map(tickerKey)
      .filter(Boolean))];
    const result = new Map();
    if (!keys.length) return result;
    try {
      const [priceRecords, researchRecords] = await Promise.all([
        options.readRecords(options.priceStoreName, keys),
        options.readRecords(options.researchStoreName, keys),
      ]);
      keys.forEach((key) => {
        const priceValue = priceRecords instanceof Map ? priceRecords.get(key) : null;
        const researchValue = researchRecords instanceof Map ? researchRecords.get(key) : null;
        const priceRecord = lifecycle.recordLifecycle(priceValue, options.priceStoreName) === "active"
          ? priceCacheToResearchHistory(priceValue, key)
          : null;
        const researchRecord = lifecycle.recordLifecycle(researchValue, options.researchStoreName) === "active"
          ? normalizeResearchHistory(researchValue, key)
          : null;
        const selected = runtime.selectPreferredResearchHistory(priceRecord, researchRecord);
        if (selected) result.set(key, selected);
      });
    } catch (_) {
      // Network history loading remains the fallback when IndexedDB is unavailable.
    }
    return result;
  }

  function writePriceCache(ticker, tickerPoints, tickerDisplayName = "", writeOptions = {}) {
    return getCacheRepository().write(ticker, tickerPoints, tickerDisplayName, writeOptions);
  }

  async function applyPriceCache(ticker, tickerDisplayName = "") {
    const key = tickerKey(ticker);
    const record = await readPriceCache(key);
    if (!record) return { applied: false, count: 0, latestDate: "" };
    if (tickerDisplayName || record.displayName) {
      options.setDisplayName(key, tickerDisplayName || record.displayName);
    }
    mergeSeries(key, record.points, { replace: true });
    options.setStatus(key, {
      ...(record.status || {}),
      source: record.status?.source || "LOCAL_CACHE",
      latestDate: record.latestDate || record.points.at(-1)?.date || "",
      cached: true,
      localCache: true,
    });
    return {
      applied: true,
      count: record.points.length,
      latestDate: record.latestDate || record.points.at(-1)?.date || "",
      historyCoverage: runtime.normalizeHistoryCoverage(record.historyCoverage),
    };
  }

  async function applyResearchPriceCache(ticker, tickerDisplayName = "") {
    const key = tickerKey(ticker);
    const record = normalizeResearchHistory(
      await options.readLifecycleRecord(options.researchStoreName, key).catch(() => null),
      key,
    );
    if (!record) return { applied: false, count: 0, latestDate: "" };
    if (tickerDisplayName) options.setDisplayName(key, tickerDisplayName);
    mergeSeries(key, record.rows, { replace: true });
    options.setStatus(key, {
      source: "RESEARCH_CACHE",
      latestDate: record.latestDate,
      cached: true,
      localCache: true,
    });
    const historyCoverage = runtime.normalizeHistoryCoverage(record.historyCoverage);
    await writePriceCache(key, record.rows, tickerDisplayName, { historyCoverage });
    return {
      applied: true,
      count: record.rows.length,
      latestDate: record.latestDate,
      researchCache: true,
      historyCoverage,
    };
  }

  async function applySharedCache(ticker, tickerDisplayName = "") {
    const key = tickerKey(ticker);
    if (!key) return { applied: false, count: 0, latestDate: "" };
    const [priceValue, researchValue] = await Promise.all([
      readPriceCache(key),
      options.readLifecycleRecord(options.researchStoreName, key).catch(() => null),
    ]);
    const priceRecord = priceCacheToResearchHistory(priceValue, key);
    const researchRecord = normalizeResearchHistory(researchValue, key);
    const selected = runtime.selectPreferredResearchHistory(priceRecord, researchRecord);
    if (!selected) return { applied: false, count: 0, latestDate: "" };
    return selected === priceRecord
      ? applyPriceCache(key, tickerDisplayName)
      : applyResearchPriceCache(key, tickerDisplayName);
  }

  function getCacheInvalidator() {
    if (cacheInvalidator) return cacheInvalidator;
    cacheInvalidator = invalidation.createTickerCacheInvalidator({
      remove: (storeName, ticker) => (storeName === options.priceStoreName
        ? removePriceCache(ticker)
        : options.deleteRecord(storeName, ticker)),
      clearMemory: options.clearDerivedMemory,
    });
    return cacheInvalidator;
  }

  function getSeriesLoader() {
    if (seriesLoader) return seriesLoader;
    seriesLoader = runtime.createSeriesLoader({
      applySharedCache,
      assessPriceUpdate: (existingPoints, incomingPoints, { rebaseSignal }) => (
        invalidation.assessPriceUpdate(existingPoints, incomingPoints, {
          rebaseSignal,
          ratioThreshold: options.rebaseRatioThreshold,
          boundaryDays: options.rebaseBoundaryDays,
          maximumBoundaryDays: options.rebaseBoundaryDays,
        })
      ),
      clearSeries,
      displayName: (key) => options.getDisplayName(key) || "",
      fetchHistory: options.fetchHistory,
      fetchLatest: options.fetchLatest,
      findRebaseSignal: (existingPoints, incomingPoints) => options.findRebaseSignal(
        existingPoints,
        incomingPoints,
        {
          ratioThreshold: options.rebaseRatioThreshold,
          boundaryDays: options.rebaseBoundaryDays,
        },
      ),
      getPoints: points,
      getStatus: options.getStatus,
      hasSeries,
      hasVolumeHistory,
      inspectHistoryIntegrity: runtime.inspectPriceHistoryIntegrity,
      invalidateCache: (key, assessment) => getCacheInvalidator().invalidate(key, assessment),
      isAbortError: options.isAbortError,
      isCacheFresh,
      isLatestCoverageComplete: (existingPoints, incomingPoints) => hasCompleteTradingCoverage(
        existingPoints,
        incomingPoints,
        options.isTradingDate,
      ),
      latestDate,
      mergePoints: mergeSeries,
      normalizePoints: normalizePointsForTicker,
      resolveHistorySinceDate: (date) => shiftHistorySinceDate(
        date,
        options.historyOverlapDays,
      ),
      setStatus: options.setStatus,
      throwIfAborted: options.throwIfAborted,
      writeCache: writePriceCache,
    });
    return seriesLoader;
  }

  function getHistoryCoordinator() {
    if (!historyCoordinator) {
      const runTickerPriceRequest = createTickerPriceRequestRunner(
        options.requestRegistry,
        (ticker, loadOptions) => getSeriesLoader().load(ticker, loadOptions),
      );
      historyCoordinator = runtime.createHistoryCoverageCoordinator({
        loadSeries: runTickerPriceRequest,
        hasSeries,
        hasVolumeHistory,
        latestDate,
      });
    }
    return historyCoordinator;
  }

  return Object.freeze({
    applySharedCache,
    clearSeries,
    ensureVisible: (stocks, isHidden) => getHistoryCoordinator().ensureVisible(stocks, isHidden),
    hasVolumeHistory,
    latestDate,
    load: (ticker, loadOptions = {}) => getHistoryCoordinator().load(ticker, loadOptions),
    mergeSeries,
    normalizePointsForTicker,
    points,
    readPriceCache,
    readResearchHistories,
    readResearchHistory,
    removePriceCache,
    visibleReady: (stocks, isHidden) => getHistoryCoordinator().visibleReady(stocks, isHidden),
    writePriceCache,
  });
}
