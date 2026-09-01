"use strict";

  const storageModule = require("./stock-research-storage.js");
  if (!storageModule) throw new Error("stock research storage module failed to load");
  const navigationModule = require("./stock-research-navigation.js");
  if (!navigationModule) throw new Error("stock research navigation module failed to load");
  const filterModule = require("./stock-research-filter.js");
  if (!filterModule) throw new Error("stock research filter module failed to load");
  const historyCacheModule = require("./stock-research-history-cache.js");
  if (!historyCacheModule) throw new Error("stock research history cache module failed to load");
  const workerClientModule = require("./stock-research-worker-client.js");
  if (!workerClientModule) throw new Error("stock research worker client failed to load");
  const summaryQualityModule = require("../../shared/stock-research-summary-quality.js");
  if (!summaryQualityModule) throw new Error("stock research summary quality module failed to load");
  const {
    CACHE_KEY,
    CACHE_VARIANTS_KEY,
    CACHE_SCHEMA,
    CACHE_BYPASS_KEY,
    BLOCKED_KEY,
    BLOCKED_SCHEMA,
    MINIMUM_KEY,
    MINIMUM_DEFAULT,
    MINIMUM_LOW,
    MINIMUM_HIGH,
    UNIVERSE_SIZE_KEY,
    UNIVERSE_SIZE_DEFAULT,
    UNIVERSE_SIZE_LOW,
    UNIVERSE_SIZE_HIGH,
    UNIVERSE_SIZE_STEP,
    loadBlocked,
    loadCache,
    loadCacheVariant,
    loadMinimum,
    loadUniverseSize,
    normalizeMinimum,
    normalizeUniverseSize,
    normalizeCachePayload,
    removeCache,
    saveBlocked,
    saveCache,
    saveCacheVariant,
    saveMinimum,
    saveUniverseSize,
  } = storageModule;
  const {
    DISPLAY_LIMIT,
    candidateSignalFingerprint,
    diffUniverse,
    diffUniverseState,
    markUniverseAnalysisFailure,
    markUniverseAnalysisInsufficientHistory,
    markUniverseAnalysisSuccess,
    mergeCandidateProfiles,
    normalizeCandidateOrder,
    selectCandidatePage,
    selectIncrementalScanRecords,
    selectRandomBatch,
    sharedResearchFingerprint,
    sharedResearchFingerprints,
    universeAnalysisFailures,
  } = navigationModule;
  const {
    candidateMatchesTodayFilter,
    candidateMatchesSignalWindow,
    candidateMeetsSignalMinimum,
    candidateResearchMarketDate,
    candidateSignalWindowState,
    latestResearchDate,
    nextSignalWindowDays,
    normalizeSignalWindowDays,
    researchMarketDateLabel,
    researchMarketDateIsCurrent,
    resolveCandidateResearchMarketDates,
    resolveResearchMarketDates,
    signalWindowLabel,
    visibleCandidateReasons,
  } = filterModule;
  const {
    HISTORY_CACHE_SCHEMA,
    HISTORY_QUALITY_VERSION,
    configureCacheLifecycle,
    configureTickerPriceRuntime,
    mergeResearchHistoryPayload,
    mergeUniversePointIntoHistoryCache,
    normalizeHistoryCacheRecord,
    normalizeResearchHistoryRows,
    researchHistoryRequestUrl,
  } = historyCacheModule;
  const { createWorkerLane } = workerClientModule;
  const {
    researchSummaryIsPublishable,
    shouldPreferResearchSummary,
  } = summaryQualityModule;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
  const compactStockName = (value, limit = 8) => {
    const text = String(value || "").trim();
    const characters = Array.from(text);
    return characters.length > limit ? `${characters.slice(0, limit).join("")}...` : text;
  };

  function requireFunction(value, label) {
    if (typeof value !== "function") throw new Error(`stock research ${label} dependency is required`);
    return value;
  }

  function createControllerOptions(options = {}) {
    const store = options.indexedCacheStore;
    if (!store?.readRecord || !store?.writeRecord || !store?.clearStore) {
      throw new Error("stock research indexed cache store is required");
    }
    const names = options.storeNames || {};
    const history = String(names.history || "");
    const results = String(names.results || "");
    const timing = String(names.timing || "");
    if (!history || !results || !timing) throw new Error("stock research cache store names are incomplete");
    return Object.freeze({
      cacheLifecycle: options.cacheLifecycle,
      tickerPriceRuntime: options.tickerPriceRuntime,
      isLocalRuntime: Boolean(options.isLocalRuntime),
      gatewayBaseUrl: String(options.gatewayBaseUrl || ""),
      getAccessToken: requireFunction(options.getAccessToken, "access token"),
      fetchWithTimeout: requireFunction(options.fetchWithTimeout, "request"),
      requestTimeoutMs: Math.max(1000, Number(options.requestTimeoutMs) || 90000),
      getExpectedLatestTradingDate: requireFunction(options.getExpectedLatestTradingDate, "latest trading date"),
      prepareSharedData: typeof options.prepareSharedData === "function" ? options.prepareSharedData : null,
      getSignalPriceMode: requireFunction(options.getSignalPriceMode, "signal price mode"),
      getSignalSettlementDelayMs: requireFunction(options.getSignalSettlementDelayMs, "signal settlement delay"),
      workerUrl: String(options.workerUrl || ""),
      canRun: requireFunction(options.canRun, "access check"),
      createProgressView: requireFunction(options.createProgressView, "progress view"),
      toggleFailurePopover: typeof options.toggleFailurePopover === "function"
        ? options.toggleFailurePopover
        : () => false,
      hideFailurePopover: typeof options.hideFailurePopover === "function"
        ? options.hideFailurePopover
        : () => {},
      toggleBlockedPopover: typeof options.toggleBlockedPopover === "function"
        ? options.toggleBlockedPopover
        : () => false,
      hideBlockedPopover: typeof options.hideBlockedPopover === "function"
        ? options.hideBlockedPopover
        : () => {},
      getData: requireFunction(options.getData, "data snapshot"),
      isAdded: requireFunction(options.isAdded, "ticker selection check"),
      addStock: requireFunction(options.addStock, "ticker add"),
      addFailedStock: typeof options.addFailedStock === "function"
        ? options.addFailedStock
        : requireFunction(options.addStock, "failed ticker add"),
      removeStock: requireFunction(options.removeStock, "ticker remove"),
      historyCache: Object.freeze({
        read: requireFunction(options.readHistory, "history read"),
        readMany: requireFunction(options.readHistoryMany, "history batch read"),
        write: (ticker, record) => store.writeRecord(history, ticker, record),
        writeMany: (entries) => store.writeRecords(history, entries),
        clear: () => store.clearStore(history),
        prune: () => options.schedulePrune?.(history, options.historyLimit || 420),
      }),
      resultCache: Object.freeze({
        read: (key) => store.readRecord(results, key),
        write: (key, value) => store.writeRecord(results, key, value),
        clear: () => store.clearStore(results),
      }),
      timingCache: Object.freeze({
        readMany: (tickers) => store.readRecords(timing, tickers),
        writeMany: (entries) => store.writeRecords(timing, entries),
      }),
    });
  }

  async function fetchCandidateProfileWithRetry(load, wait = () => Promise.resolve(), attempts = 2) {
    let lastError = null;
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
      try {
        return await load();
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await wait(attempt + 1);
      }
    }
    throw lastError || new Error("candidate profile request failed");
  }

  function retryableResearchHistoryError(error) {
    if (String(error?.code || "") === "insufficient-history"
      || /가격 이력이 1년 미만/.test(String(error?.message || error || ""))) return false;
    const status = Math.round(Number(error?.status) || 0);
    if ([408, 425, 429].includes(status) || status >= 500) return true;
    return /\b(?:408|425|429|500|502|503|504)\b|failed to fetch|fetch failed|network|timed?\s*out|timeout/i
      .test(String(error?.message || error || ""));
  }

  async function fetchResearchHistoryWithRetry(load, wait = () => Promise.resolve(), attempts = 3) {
    let lastError = null;
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
      try {
        return await load();
      } catch (error) {
        lastError = error;
        if (!retryableResearchHistoryError(error) || attempt + 1 >= attempts) break;
        await wait(attempt + 1);
      }
    }
    throw lastError || new Error("research history request failed");
  }

  function researchWorkerLaneCount(_navigatorLike, taskCount) {
    const total = Math.max(0, Math.round(Number(taskCount) || 0));
    if (!total) return 0;
    return Math.max(1, Math.min(total, 4));
  }

  function partitionResearchScanQueues(records, laneCount, options = {}) {
    const items = Array.isArray(records) ? records : [];
    const count = Math.max(1, Math.min(items.length || 1, Math.round(Number(laneCount) || 1)));
    const queues = Array.from({ length: count }, () => []);
    if (count === 4 && options.marketParity !== false) {
      const fallbackRanks = { KOSPI: 0, KOSDAQ: 0 };
      items.forEach((item) => {
        const ticker = String(item?.ticker || "").trim().toUpperCase();
        const market = (String(item?.market || "").trim().toUpperCase() === "KOSDAQ"
          || ticker.endsWith(".KQ")) ? "KOSDAQ" : "KOSPI";
        const explicitRank = Math.round(Number(item?.rank) || 0);
        const ordinal = explicitRank > 0 ? explicitRank - 1 : fallbackRanks[market]++;
        const marketOffset = market === "KOSDAQ" ? 2 : 0;
        queues[marketOffset + (Math.abs(ordinal) % 2)].push(item);
      });
      return queues;
    }
    items.forEach((item, index) => queues[index % count].push(item));
    return queues;
  }

  function createController(scope = globalThis, options = {}) {
    configureCacheLifecycle(options.cacheLifecycle);
    configureTickerPriceRuntime(options.tickerPriceRuntime);
    const research = options.research;
    if (!research) throw new Error("stock research model is required");
    const calculationVersion = research.CALCULATION_VERSION || research.STRATEGY_VERSION;
    if (!calculationVersion) throw new Error("stock research calculation version is required");
    const storage = options.storage || scope.localStorage;
    const isLocalRuntime = Boolean(options.isLocalRuntime);
    const gatewayBaseUrl = String(options.gatewayBaseUrl || "");
    const fetchWithTimeout = options.fetchWithTimeout;
    const requestTimeoutMs = Math.max(1000, Number(options.requestTimeoutMs) || 90000);
    const getAccessToken = options.getAccessToken || (() => "");
    const getData = options.getData || (() => ({}));
    const getExpectedLatestTradingDate = options.getExpectedLatestTradingDate || (() => "");
    const prepareSharedData = options.prepareSharedData;
    const getSignalPriceMode = options.getSignalPriceMode || (() => "settled");
    const getSignalSettlementDelayMs = options.getSignalSettlementDelayMs || (() => null);
    const createSettlementRuntime = options.createSettlementRuntime;
    if (typeof createSettlementRuntime !== "function") {
      throw new Error("stock research settlement runtime is required");
    }
    const fetchJson = options.fetchJson || (async (url, init = {}) => {
      const accessToken = String(getAccessToken() || "").trim();
      if (!isLocalRuntime && !accessToken) {
        throw new Error("API 설정에서 Think Stock 접속 코드를 먼저 저장해 주세요.");
      }
      const response = await fetchWithTimeout(url, {
        cache: "no-store",
        ...init,
        headers: {
          ...(init.headers || {}),
          ...(!isLocalRuntime ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      }, requestTimeoutMs);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        const error = new Error(payload?.error || `종목탐구 HTTP ${response.status}`);
        error.status = response.status;
        error.code = String(payload?.code || "");
        throw error;
      }
      return payload;
    });
    const addStock = options.addStock;
    const addFailedStock = options.addFailedStock || addStock;
    const removeStock = options.removeStock || (() => {});
    const isAdded = options.isAdded || (() => false);
    const random = typeof options.random === "function" ? options.random : Math.random;
    const canRun = options.canRun || (() => true);
    const bindOpenButton = options.bindOpenButton !== false;
    const bindSettingsButtons = options.bindSettingsButtons !== false;
    const onCacheStateChanged = options.onCacheStateChanged || (() => {});
    const onBlockedStateChanged = options.onBlockedStateChanged || (() => {});
    const toggleFailurePopover = options.toggleFailurePopover || (() => false);
    const hideFailurePopover = options.hideFailurePopover || (() => {});
    const toggleBlockedPopover = options.toggleBlockedPopover || (() => false);
    const hideBlockedPopover = options.hideBlockedPopover || (() => {});
    const historyCache = options.historyCache || null;
    const resultCache = options.resultCache || null;
    const timingCache = options.timingCache || null;
    const getSharedSources = options.getSharedSources || (() => {
      const data = getData();
      const records = Array.isArray(data.priceRecords) ? data.priceRecords : [];
      const benchmarkRows = (ticker) => records.map((row) => ({
        date: String(row?.date || "").slice(0, 10),
        close: Number.isFinite(Number(row?.[ticker])) ? Number(row[ticker]) : null,
      })).filter((row) => row.date && row.close !== null);
      return {
        kospiRows: benchmarkRows("^KS11"),
        kosdaqRows: benchmarkRows("^KQ11"),
        adrRows: data.adrRows || [],
        macroRows: data.macroRows || [],
        creditRows: data.creditRows || [],
        crisisRows: data.crisisRows || [],
      };
    });
    const getHeaders = options.getHeaders || (() => ({}));
    const endpointRoot = isLocalRuntime ? "./api/research" : `${gatewayBaseUrl}/api/research`;
    const universeUrl = String(options.universeUrl || `${endpointRoot}/universe`);
    const historyUrl = String(options.historyUrl || `${endpointRoot}/history`);
    const profileUrl = String(options.profileUrl || `${endpointRoot}/profile`);
    const summaryUrl = String(options.summaryUrl || `${endpointRoot}/summary`);
    const workerUrl = String(options.workerUrl || "./assets/stock-research-worker.bundle.min.js?v=dev");
    const DEFAULT_FILTER = Object.freeze({ includeBuy: true, includeSell: false, signalWindowDays: 0 });
    const ANALYSIS_FILTER = Object.freeze({
      includeBuy: true,
      includeSell: true,
      signalWindowDays: 0,
      collectAllSignals: true,
    });
    const filterKey = (filter) => [
      filter?.includeBuy === true ? "buy" : "",
      filter?.includeSell === true ? "sell" : "",
      normalizeSignalWindowDays(filter?.signalWindowDays, filter?.todayOnly === true) > 0
        ? `window-${normalizeSignalWindowDays(filter?.signalWindowDays, filter?.todayOnly === true)}`
        : "history",
    ].filter(Boolean).join("-");
    const analysisFilterKey = `${filterKey(ANALYSIS_FILTER)}-all`;
    let activeFilter = { ...DEFAULT_FILTER };
    let minimumBuySignals = loadMinimum(storage);
    let universeSize = loadUniverseSize(storage);
    let cached = loadCacheVariant(storage, calculationVersion, universeSize)
      || loadCache(storage, calculationVersion);
    if (cached && !cached.filterKey) cached = { ...cached, filterKey: analysisFilterKey };
    if (cached && !cached.universeSize) {
      cached = {
        ...cached,
        universeSize: normalizeUniverseSize(cached.universeTickers?.length || cached.scanned),
      };
    }
    let bypassSummary = false;
    try { bypassSummary = storage?.getItem(CACHE_BYPASS_KEY) === "1"; } catch (_) {}
    const blocked = new Map(loadBlocked(storage).map((entry) => [entry.ticker, entry]));
    let running = false;
    let stopRequested = false;
    let enrichingCachedProfiles = false;
    let navigationSequence = 0;
    let resultCacheHydrated = !resultCache;
    let resultCacheHydrationPromise = null;
    let persistTimer = 0;
    let pendingPersistPayload = null;
    let progressView = null;

    const elements = {};
    const element = (id) => scope.document.getElementById(id);

    function currentSignalPriceMode() {
      return String(getSignalPriceMode() || "settled").trim().toLowerCase() === "realtime"
        ? "realtime"
        : "settled";
    }

    function needsSignalSettlement(payload = cached) {
      return String(payload?.priceMode || "settled") === "realtime"
        && currentSignalPriceMode() === "settled";
    }

    const signalSettlement = createSettlementRuntime(scope, {
      getDelayMs: getSignalSettlementDelayMs,
      shouldSchedule: () => (
        String(cached?.priceMode || "settled") === "realtime"
        && currentSignalPriceMode() === "realtime"
        && elements.modal?.hidden !== false
      ),
      shouldRun: () => elements.modal?.hidden !== false && needsSignalSettlement(),
      isBusy: () => running,
      settle: async () => {
        await runSearch({ settlement: true });
        return true;
      },
      offsetMs: 1000,
      retryMs: 1500,
    });

    function scheduleSignalSettlement() {
      return signalSettlement.schedule();
    }

    function notifyCacheState() {
      try { onCacheStateChanged(Boolean(cached)); } catch (_) {}
    }

    function persistCache() {
      if (cached && resultCache) {
        pendingPersistPayload = cached;
        if (!persistTimer) {
          persistTimer = scope.setTimeout(() => {
            persistTimer = 0;
            const payload = pendingPersistPayload;
            pendingPersistPayload = null;
            if (!payload) return;
            const size = normalizeUniverseSize(payload.universeSize);
            Promise.all([
              resultCache.write(`current:${calculationVersion}`, payload),
              resultCache.write(`variant:${calculationVersion}:${size}`, payload),
            ]).then(() => removeCache(storage)).catch(() => {});
          }, 180);
        }
      } else if (cached) {
        saveCache(storage, cached);
        saveCacheVariant(storage, cached);
      }
      notifyCacheState();
    }

    async function hydrateResultCache() {
      if (resultCacheHydrated) return cached;
      if (resultCacheHydrationPromise) return resultCacheHydrationPromise;
      resultCacheHydrationPromise = (async () => {
        const size = normalizeUniverseSize(universeSize);
        const records = await Promise.all([
          resultCache.read(`variant:${calculationVersion}:${size}`),
          resultCache.read(`current:${calculationVersion}`),
        ]);
        const stored = records
          .map((value) => normalizeCachePayload(value, calculationVersion))
          .filter((value) => value && normalizeUniverseSize(value.universeSize) === size)
          .sort((left, right) => String(right.generatedAt || "").localeCompare(String(left.generatedAt || "")))[0];
        if (stored && (!cached || String(stored.generatedAt || "") >= String(cached.generatedAt || ""))) {
          cached = stored;
        }
        resultCacheHydrated = true;
        if (cached) persistCache();
        return cached;
      })().catch(() => {
        resultCacheHydrated = true;
        return cached;
      }).finally(() => {
        resultCacheHydrationPromise = null;
      });
      return resultCacheHydrationPromise;
    }

    function markSummaryAvailable() {
      bypassSummary = false;
      try { storage?.removeItem(CACHE_BYPASS_KEY); } catch (_) {}
    }

    function clearCache(clearOptions = {}) {
      if (running) return false;
      if (persistTimer) scope.clearTimeout(persistTimer);
      persistTimer = 0;
      pendingPersistPayload = null;
      const bypassAfterClear = clearOptions.bypassSummary !== false;
      cached = null;
      bypassSummary = bypassAfterClear;
      removeCache(storage);
      if (resultCache) Promise.resolve(resultCache.clear()).catch(() => {});
      if (clearOptions.clearHistory !== false) {
        try { Promise.resolve(historyCache?.clear?.()).catch(() => {}); } catch (_) {}
      }
      try {
        if (bypassAfterClear) storage?.setItem(CACHE_BYPASS_KEY, "1");
        else storage?.removeItem(CACHE_BYPASS_KEY);
      } catch (_) {}
      navigationSequence += 1;
      render();
      notifyCacheState();
      return true;
    }

    async function loadTickerHistory(item, preloadedRecord = undefined, pendingWrites = null) {
      const ticker = String(item?.ticker || "").trim().toUpperCase();
      let stored = null;
      try {
        const cachedRecord = preloadedRecord === undefined
          ? await historyCache?.read?.(ticker)
          : preloadedRecord;
        stored = normalizeHistoryCacheRecord(cachedRecord, ticker);
      } catch (_) {}
      const localUpdate = mergeUniversePointIntoHistoryCache(stored, item);
      if (localUpdate?.record) {
        if (localUpdate.changed) {
          if (pendingWrites instanceof Map) pendingWrites.set(ticker, localUpdate.record);
          else {
            try { await historyCache?.write?.(ticker, localUpdate.record); } catch (_) {}
          }
        }
        return localUpdate.record.rows;
      }
      const fetchHistory = (record, forceFull = false) => fetchResearchHistoryWithRetry(
        () => fetchJson(researchHistoryRequestUrl(historyUrl, ticker, record, forceFull), {
          headers: getHeaders(),
        }),
        (attempt) => new Promise((resolve) => (scope.setTimeout || setTimeout)(
          resolve,
          attempt * 700 + Math.floor((Number(random()) || 0) * 250),
        )),
      );
      let payload = await fetchHistory(stored);
      let record = mergeResearchHistoryPayload(stored, payload, ticker);
      if (!record && stored) {
        payload = await fetchHistory(null, true);
        record = mergeResearchHistoryPayload(null, payload, ticker);
      }
      if (!record) throw new Error(`${ticker} 가격 이력이 불완전합니다.`);
      const currentUpdate = mergeUniversePointIntoHistoryCache(record, item);
      if (currentUpdate?.record) record = currentUpdate.record;
      if (pendingWrites instanceof Map) pendingWrites.set(ticker, record);
      else {
        try { await historyCache?.write?.(ticker, record); } catch (_) {}
      }
      return record.rows;
    }

    function setProgressTrackVisible(visible) {
      const track = elements.progressBar?.parentElement;
      if (!track) return;
      track.hidden = !visible;
      track.style.display = visible ? "" : "none";
    }

    function setFailureButton(failures = []) {
      const items = Array.isArray(failures) ? failures : [];
      elements.failed.hidden = items.length === 0;
      elements.failed.textContent = `추출 실패 ${items.length}개`;
      if (!items.length) elements.failed.setAttribute("aria-pressed", "false");
    }

    function hideFailureItems() {
      hideFailurePopover();
      elements.failed?.setAttribute("aria-pressed", "false");
    }

    function showFailedItems(event) {
      const failures = universeAnalysisFailures(cached?.universeState);
      if (!failures.length) return false;
      hideBlockedItems();
      const visible = toggleFailurePopover({
        popoverKey: "failed",
        anchorElement: elements.failed,
        anchorAlign: "right",
        anchorOffsetX: -4,
        anchorOffsetY: 4,
        onVisibilityChange: (nextVisible) => {
          elements.failed?.setAttribute("aria-pressed", nextVisible ? "true" : "false");
        },
        events: failures.map((failure) => {
          const ticker = String(failure?.ticker || "").toUpperCase();
          const name = String(failure?.name || ticker);
          return {
            title: compactStockName(name),
            fullTitle: name,
            actionLabel: isAdded(ticker) ? "제거" : "추가",
            onAction: async () => {
              if (isAdded(ticker)) await removeStock(ticker);
              else {
                await addFailedStock({
                  ticker,
                  code: ticker.slice(0, 6),
                  name,
                  market: ticker.endsWith(".KQ") ? "KOSDAQ" : "KOSPI",
                });
              }
              return isAdded(ticker) ? "제거" : "추가";
            },
          };
        }),
      }, event);
      elements.failed.setAttribute("aria-pressed", visible ? "true" : "false");
      return visible;
    }

    function setProgress(percent, text, count = "") {
      hideFailureItems();
      setFailureButton([]);
      setProgressTrackVisible(true);
      if (progressView) progressView.paint(percent, text, { visible: true });
      else {
        elements.progress.hidden = false;
        elements.progressText.textContent = text;
        elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      }
      elements.progressCount.textContent = count;
    }

    function completeProgress(text, count = "", failures = universeAnalysisFailures(cached?.universeState)) {
      setProgress(100, text, count);
      setFailureButton(failures);
      setProgressTrackVisible(false);
    }

    function hideProgress() {
      if (progressView) progressView.setVisible(false);
      else if (elements.progress) elements.progress.hidden = true;
    }

    function persistBlocked() {
      saveBlocked(storage, [...blocked.values()]);
      try { onBlockedStateChanged(blocked.size); } catch (_) {}
    }

    function activeSignalWindowDays() {
      return normalizeSignalWindowDays(activeFilter.signalWindowDays, activeFilter.todayOnly === true);
    }

    function signalWindowIsActive() {
      return activeSignalWindowDays() > 0;
    }

    function effectiveMinimum() {
      return minimumBuySignals;
    }

    function signalLabel() {
      if (activeFilter.includeBuy && activeFilter.includeSell) return "전체신호";
      return activeFilter.includeSell ? "매도신호" : "매수신호";
    }

    function expectedResearchDate() {
      try { return String(getExpectedLatestTradingDate() || "").slice(0, 10); }
      catch (_) { return ""; }
    }

    function candidateMatchesFilter(
      candidate,
      minimum = effectiveMinimum(),
      marketDates = null,
      expectedDate = "",
    ) {
      if (signalWindowIsActive()) {
        return candidateMatchesSignalWindow(candidate, {
          ...activeFilter,
          minimumSignals: minimum,
        }, marketDates || {}, expectedDate);
      }
      return candidateMeetsSignalMinimum(candidate, activeFilter, minimum);
    }

    function syncFilterControls() {
      if (!elements.buyFilter || !elements.sellFilter || !elements.todayFilter) return;
      elements.buyFilter.setAttribute("aria-pressed", String(activeFilter.includeBuy));
      elements.sellFilter.setAttribute("aria-pressed", String(activeFilter.includeSell));
      const windowDays = activeSignalWindowDays();
      const windowLabel = signalWindowLabel(windowDays);
      elements.todayFilter.textContent = windowDays > 0 ? windowLabel : signalWindowLabel(1);
      elements.todayFilter.dataset.signalWindow = String(windowDays);
      elements.todayFilter.setAttribute(
        "aria-label",
        windowDays > 0 ? `신호 기간 ${windowLabel}` : "1일 신호 기간 비활성",
      );
      elements.todayFilter.setAttribute("aria-pressed", String(windowDays > 0));
      [elements.buyFilter, elements.sellFilter, elements.todayFilter].forEach((button) => {
        button.disabled = running;
      });
      elements.modalBlocked.disabled = running || blocked.size === 0;
      elements.refresh.textContent = cached ? "재검색" : "검색";
    }

    function syncMinimumControls() {
      if (!elements.minimumValue) return;
      const minimum = effectiveMinimum();
      elements.minimumValue.textContent = String(minimum);
      elements.signalLabel.textContent = signalLabel();
      elements.signalStepper.setAttribute("aria-label", `최소 ${signalLabel()} 횟수`);
      elements.signalStepper.setAttribute("aria-disabled", "false");
      elements.signalStepper.classList.remove("is-locked");
      elements.minimumDecrease.disabled = running || minimumBuySignals <= MINIMUM_LOW;
      elements.minimumIncrease.disabled = running || minimumBuySignals >= MINIMUM_HIGH;
    }

    function getMinimumCandidatePool(marketDates = null, expectedDate = "") {
      const source = Array.isArray(cached?.candidatePool) ? cached.candidatePool : (cached?.candidates || []);
      const references = marketDates || (signalWindowIsActive()
        ? resolveCandidateResearchMarketDates(
            source,
            resolveResearchMarketDates(getSharedSources()),
          )
        : null);
      const expected = signalWindowIsActive() ? (expectedDate || expectedResearchDate()) : "";
      return source.filter((candidate) => candidateMatchesFilter(
        candidate,
        effectiveMinimum(),
        references,
        expected,
      ));
    }

    function getCandidateNavigation(fresh = false) {
      const source = Array.isArray(cached?.candidatePool) ? cached.candidatePool : (cached?.candidates || []);
      const marketDates = signalWindowIsActive()
        ? resolveCandidateResearchMarketDates(
            source,
            resolveResearchMarketDates(getSharedSources()),
          )
        : null;
      const expectedDate = signalWindowIsActive() ? expectedResearchDate() : "";
      const fullPool = getMinimumCandidatePool(marketDates, expectedDate);
      const preferred = fresh
        ? []
        : (Array.isArray(cached?.candidateOrder)
          ? cached.candidateOrder
          : (cached?.candidates || []).map((candidate) => candidate.ticker));
      const storedOrder = normalizeCandidateOrder(fullPool, preferred, random);
      const pool = fullPool.filter((candidate) => !blocked.has(String(candidate?.ticker || "").toUpperCase()));
      const eligibleTickers = new Set(pool.map((candidate) => String(candidate.ticker).toUpperCase()));
      const order = storedOrder.filter((ticker) => eligibleTickers.has(ticker));
      const pageCount = Math.ceil(order.length / DISPLAY_LIMIT);
      const currentPage = pageCount > 0
        ? Math.max(0, Math.min(pageCount - 1, Math.round(Number(cached?.candidatePageIndex) || 0)))
        : 0;
      return { pool, order, storedOrder, pageCount, currentPage, marketDates, expectedDate };
    }

    function syncNavigationControls() {
      if (!elements.previous || !elements.next) return;
      const navigation = getCandidateNavigation();
      const disabled = running || navigation.pageCount <= 1;
      elements.previous.disabled = disabled;
      elements.next.disabled = disabled;
      if (elements.pagePosition) {
        const currentPage = navigation.pageCount > 0 ? navigation.currentPage + 1 : 1;
        elements.pagePosition.textContent = String(currentPage);
        elements.pagePosition.setAttribute(
          "aria-label",
          `현재 ${currentPage} / ${Math.max(1, navigation.pageCount)} 페이지`,
        );
      }
    }

    function setMinimum(value) {
      minimumBuySignals = normalizeMinimum(value);
      saveMinimum(storage, minimumBuySignals);
      syncMinimumControls();
      if (Array.isArray(cached?.candidatePool)) applyCandidatePage(0);
      else render();
    }

    function getUniverseSize() {
      return universeSize;
    }

    function setUniverseSize(value) {
      if (running) return universeSize;
      universeSize = saveUniverseSize(storage, normalizeUniverseSize(value));
      if (resultCache) {
        cached = null;
        resultCacheHydrated = false;
        hydrateResultCache().then(() => {
          navigationSequence += 1;
          render();
          notifyCacheState();
        });
        return universeSize;
      }
      const variant = loadCacheVariant(storage, calculationVersion, universeSize);
      if (variant) {
        cached = variant;
        navigationSequence += 1;
        render();
        notifyCacheState();
      }
      return universeSize;
    }

    function setFilter(nextFilter) {
      if (running) return;
      const next = {
        includeBuy: nextFilter?.includeBuy === true,
        includeSell: nextFilter?.includeSell === true,
        signalWindowDays: normalizeSignalWindowDays(
          nextFilter?.signalWindowDays,
          nextFilter?.todayOnly === true,
        ),
      };
      if (!next.includeBuy && !next.includeSell) return;
      const nextKey = filterKey(next);
      if (filterKey(activeFilter) === nextKey) return;
      activeFilter = next;
      if (cached) cached = { ...cached, candidatePageIndex: 0 };
      navigationSequence += 1;
      syncFilterControls();
      syncMinimumControls();
      render();
    }

    function hideBlockedItems() {
      hideBlockedPopover();
      elements.modalBlocked?.setAttribute("aria-expanded", "false");
    }

    function toggleBlockedList(event) {
      if (running || blocked.size === 0) return false;
      hideFailureItems();
      const entries = [...blocked.values()].map((entry) => ({ ...entry }));
      const visible = toggleBlockedPopover({
        popoverKey: "blocked",
        anchorElement: elements.modalBlocked,
        anchorAlign: "right",
        anchorOffsetX: -4,
        anchorOffsetY: 4,
        onVisibilityChange: (nextVisible) => {
          elements.modalBlocked?.setAttribute("aria-expanded", nextVisible ? "true" : "false");
        },
        events: entries.map((entry) => {
          const ticker = String(entry?.ticker || "").toUpperCase();
          const name = String(entry?.name || ticker);
          return {
            title: compactStockName(name),
            fullTitle: name,
            actionLabel: blocked.has(ticker) ? "해제" : "차단",
            onAction: async () => {
              if (blocked.has(ticker)) unblockCandidate(ticker);
              else blockCandidate(entry);
              return blocked.has(ticker) ? "해제" : "차단";
            },
          };
        }),
      }, event);
      elements.modalBlocked.setAttribute("aria-expanded", visible ? "true" : "false");
      return visible;
    }

    function syncBlockedButton() {
      if (elements.blockedButton) {
        elements.blockedButton.disabled = blocked.size === 0;
        elements.blockedButton.textContent = blocked.size ? "차단종목리셋" : "차단종목없음";
        elements.blockedButton.title = blocked.size
          ? `종목탐구에서 차단한 ${blocked.size}개 종목을 모두 해제합니다.`
          : "차단된 종목이 없습니다.";
      }
      if (!elements.modalBlocked) return;
      elements.modalBlocked.disabled = running || blocked.size === 0;
      elements.modalBlocked.textContent = blocked.size > 0
        ? `차단 ${blocked.size} 종목`
        : "차단 0 종목";
      elements.modalBlocked.title = blocked.size
        ? `종목탐구에서 차단한 ${blocked.size}개 종목을 확인하고 개별 해제합니다.`
        : "차단된 종목이 없습니다.";
    }

    function clearBlocked() {
      if (running) return false;
      hideBlockedItems();
      blocked.clear();
      persistBlocked();
      syncBlockedButton();
      if (Array.isArray(cached?.candidatePool)) applyCandidatePage(cached?.candidatePageIndex || 0);
      else render();
      return true;
    }

    function unblockCandidate(tickerValue) {
      if (running) return false;
      const ticker = String(tickerValue || "").toUpperCase();
      if (!ticker || !blocked.delete(ticker)) return false;
      persistBlocked();
      syncBlockedButton();
      if (Array.isArray(cached?.candidatePool)) applyCandidatePage(cached?.candidatePageIndex || 0);
      else render();
      return true;
    }

    function blockCandidate(candidate) {
      const ticker = String(candidate?.ticker || "").toUpperCase();
      if (!ticker) return;
      blocked.set(ticker, {
        ticker,
        name: String(candidate?.name || ticker),
        market: String(candidate?.market || ""),
        blockedAt: new Date().toISOString(),
      });
      persistBlocked();
      syncBlockedButton();
      if (Array.isArray(cached?.candidatePool)) applyCandidatePage(cached?.candidatePageIndex || 0);
      else render();
    }

    function render() {
      const minimum = effectiveMinimum();
      const navigation = getCandidateNavigation();
      const detectedCount = navigation.pool.length;
      const candidates = selectCandidatePage(
        navigation.pool,
        navigation.order,
        navigation.currentPage,
      );
      const storedAnalysisDate = String(cached?.analysisDate || cached?.baseDate || "");
      const periodActive = signalWindowIsActive();
      const windowLabel = signalWindowLabel(activeSignalWindowDays());
      const analysisDate = periodActive
        ? researchMarketDateLabel(navigation.marketDates, navigation.expectedDate)
        : storedAnalysisDate;
      const compositionText = !periodActive
        && cached?.baseDate && storedAnalysisDate && cached.baseDate !== storedAnalysisDate
        ? ` · 구성 ${cached.baseDate}`
        : "";
      const incrementalText = cached?.incrementalDate ? ` · 부분갱신 ${cached.incrementalDate}` : "";
      const selectedSignals = [
        ...(activeFilter.includeBuy ? ["매수"] : []),
        ...(activeFilter.includeSell ? ["매도"] : []),
      ].join("·");
      const filterText = periodActive
        ? `${selectedSignals} ${minimum}회+ · ${windowLabel}`
        : `${signalLabel()} ${minimum}회+`;
      const filteringExistingPool = Boolean(cached?.baseDate)
        && (cached?.filterKey || analysisFilterKey) !== analysisFilterKey;
      const filteredExistingText = filteringExistingPool
        ? " · 기존 결과 내 필터"
        : "";
      elements.asOf.textContent = cached?.baseDate
        ? `검출종목 ${detectedCount}개 · 탐구기준 ${analysisDate}${compositionText}${incrementalText} · ${filterText}${filteredExistingText}`
        : "마지막 탐구 결과가 없습니다.";
      elements.empty.hidden = candidates.length > 0;
      elements.empty.textContent = !cached?.baseDate
        ? "검색을 누르면 최신 조건으로 탐구합니다."
        : (filteringExistingPool
          ? "기존 결과에는 해당 신호가 없습니다. 재검색을 누르면 전체 종목에서 찾습니다."
          : "조건을 통과한 종목이 없습니다.");
      elements.list.innerHTML = candidates.map((candidate) => {
        const added = isAdded(candidate.ticker);
        const reason = visibleCandidateReasons(candidate.reasons).join(" · ");
        const buyCount = Math.max(0, Number(candidate.buyCount) || 0);
        const sellCount = Math.max(0, Number(candidate.sellCount) || 0);
        const periodState = periodActive
          ? candidateSignalWindowState(
            candidate,
            { ...activeFilter, minimumSignals: minimum },
            navigation.marketDates,
            navigation.expectedDate,
          )
          : null;
        const periodSignals = [
          ...(periodState?.buy ? ["매수"] : []),
          ...(periodState?.sell ? ["매도"] : []),
        ];
        const signalText = periodActive
          ? (activeSignalWindowDays() === 1 && candidate.signalState === "realtime"
            ? `${periodSignals.join("·")} 실시간 신호`
            : [
              periodState?.buy ? `매수 ${periodState.buyCount}회` : "",
              periodState?.sell ? `매도 ${periodState.sellCount}회` : "",
              windowLabel,
            ].filter(Boolean).join(" · "))
          : (activeFilter.includeBuy && activeFilter.includeSell
            ? [buyCount ? `매수 ${buyCount}회 연속` : "", sellCount ? `매도 ${sellCount}회 연속` : ""].filter(Boolean).join(" · ")
            : (activeFilter.includeSell ? `매도신호 ${sellCount}회 연속` : `${buyCount}회 연속 신호`));
        const marketLabel = candidate.market === "KOSDAQ"
          ? "코스닥"
          : (candidate.market === "KOSPI" ? "코스피" : candidate.market);
        const marketRankText = [marketLabel, candidate.marketRank ? `${candidate.marketRank}위` : ""]
          .filter(Boolean)
          .join(" ");
        return `
          <div class="stock-research-item${added ? " is-added" : ""}">
          <div class="stock-research-item-main" data-research-ticker="${escapeHtml(candidate.ticker)}">
            <span class="stock-research-item-top">
              <span class="stock-research-name-group">
                <span class="stock-research-name">${escapeHtml(candidate.name)}</span>
                ${candidate.category ? `<span class="stock-research-category">${escapeHtml(candidate.category)}</span>` : ""}
              </span>
              <span class="stock-research-status-group">
                <span class="stock-research-market-rank">${escapeHtml(marketRankText)}</span>
                <span class="stock-research-status">${escapeHtml(signalText)}</span>
              </span>
            </span>
            ${reason ? `<span class="stock-research-item-reason">${escapeHtml(reason)}</span>` : ""}
          </div>
          <span class="stock-research-item-actions">
            <button class="stock-research-toggle-btn" type="button" data-research-toggle="${escapeHtml(candidate.ticker)}">${added ? "제거" : "추가"}</button>
            <button class="stock-research-block-btn" type="button" data-research-block="${escapeHtml(candidate.ticker)}" aria-label="${escapeHtml(candidate.name)} 종목탐구 차단">차단</button>
          </span>
          </div>`;
      }).join("");
      elements.list.querySelectorAll("[data-research-toggle]").forEach((button) => {
        button.addEventListener("click", async () => {
          const candidate = candidates.find((item) => item.ticker === button.dataset.researchToggle);
          if (!candidate) return;
          button.disabled = true;
          const added = isAdded(candidate.ticker);
          button.textContent = added ? "제거 중" : "추가 중";
          try {
            if (added) await removeStock(candidate.ticker);
            else await addStock(candidate);
          } finally {
            render();
          }
        });
      });
      elements.list.querySelectorAll("[data-research-block]").forEach((button) => {
        button.addEventListener("click", () => {
          const candidate = candidates.find((item) => item.ticker === button.dataset.researchBlock);
          if (candidate) blockCandidate(candidate);
        });
      });
      elements.refresh.textContent = cached ? "재검색" : "검색";
      syncNavigationControls();
    }

    async function enrichCandidateProfiles(candidates, options = {}) {
      if (!candidates.length) return candidates;
      const showProgress = options.showProgress !== false;
      const previousByTicker = new Map([
        ...(cached?.candidatePool || []),
        ...(cached?.candidates || []),
      ].map((candidate) => [candidate.ticker, candidate]));
      const enriched = candidates.map((candidate) => {
        const previous = previousByTicker.get(candidate.ticker);
        return !candidate.category && previous?.category
          ? {
              ...candidate,
              category: previous.category,
              industry: previous.industry || "",
              categoryType: previous.categoryType || "업종",
            }
          : { ...candidate };
      });
      const pendingIndexes = enriched.flatMap((candidate, index) => (
        candidate.category ? [] : [index]
      ));
      if (!pendingIndexes.length) return enriched;
      let cursor = 0;
      let completed = 0;
      if (showProgress) setProgress(98, "후보 업종 확인", `0 / ${pendingIndexes.length}`);
      const laneCount = Math.min(3, pendingIndexes.length);
      await Promise.all(Array.from({ length: laneCount }, async () => {
        while (cursor < pendingIndexes.length) {
          const index = pendingIndexes[cursor];
          cursor += 1;
          const candidate = enriched[index];
          try {
            const payload = await fetchCandidateProfileWithRetry(
              () => fetchJson(`${profileUrl}?ticker=${encodeURIComponent(candidate.ticker)}`, {
                headers: getHeaders(),
              }),
              () => new Promise((resolve) => (scope.setTimeout || setTimeout)(resolve, 300)),
            );
            if (payload?.ok === true && payload.category) {
              enriched[index] = {
                ...candidate,
                category: String(payload.category),
                industry: String(payload.industry || ""),
                categoryType: String(payload.categoryType || "업종"),
              };
            }
          } catch (_) {
            // A missing profile does not invalidate the signal result.
          } finally {
            completed += 1;
            if (showProgress) setProgress(
              98 + Math.round(completed / pendingIndexes.length),
              "후보 업종 확인",
              `${completed} / ${pendingIndexes.length}`,
            );
          }
        }
      }));
      return enriched;
    }

    async function applyCandidatePage(pageIndex) {
      if (!cached || running) return;
      const navigation = getCandidateNavigation();
      if (!navigation.pageCount) {
        cached = { ...cached, candidates: [], candidateOrder: [], candidatePageIndex: 0 };
        persistCache();
        render();
        return;
      }
      const normalizedPage = ((Math.round(Number(pageIndex) || 0) % navigation.pageCount) + navigation.pageCount) % navigation.pageCount;
      const candidates = selectCandidatePage(navigation.pool, navigation.order, normalizedPage);
      const requestId = ++navigationSequence;
      cached = {
        ...cached,
        candidateOrder: navigation.storedOrder,
        candidatePageIndex: normalizedPage,
        candidates,
      };
      persistCache();
      render();
      if (!candidates.some((candidate) => !candidate.category)) return;
      const enrichedCandidates = await enrichCandidateProfiles(candidates, { showProgress: false });
      if (requestId !== navigationSequence) return;
      cached = {
        ...cached,
        candidatePool: Array.isArray(cached.candidatePool)
          ? mergeCandidateProfiles(cached.candidatePool, enrichedCandidates)
          : cached.candidatePool,
        candidates: enrichedCandidates,
      };
      persistCache();
      render();
    }

    function navigateCandidates(direction) {
      if (running) return;
      const navigation = getCandidateNavigation();
      if (navigation.pageCount <= 1) return;
      applyCandidatePage(navigation.currentPage + direction);
    }

    async function enrichExistingCandidateProfiles() {
      if (running || enrichingCachedProfiles || !cached?.candidates?.some((candidate) => !candidate.category)) return;
      enrichingCachedProfiles = true;
      try {
        const candidates = await enrichCandidateProfiles(cached.candidates);
        cached = {
          ...cached,
          candidates,
          candidatePool: Array.isArray(cached.candidatePool)
            ? mergeCandidateProfiles(cached.candidatePool, candidates)
            : cached.candidatePool,
        };
        persistCache();
        render();
        completeProgress("업종 확인 완료", `${candidates.length}종목`);
      } finally {
        enrichingCachedProfiles = false;
        scope.setTimeout(() => {
          if (!running
            && !enrichingCachedProfiles
            && universeAnalysisFailures(cached?.universeState).length === 0) hideProgress();
        }, 900);
      }
    }

    async function loadSummary() {
      if (bypassSummary) return null;
      const query = new URLSearchParams({
        strategy: calculationVersion,
        minimum: String(MINIMUM_LOW),
        size: String(universeSize),
      });
      const payload = await fetchJson(`${summaryUrl}?${query}`, { headers: getHeaders() });
      const candidatePool = Array.isArray(payload?.candidatePool) ? payload.candidatePool : [];
      if (payload?.ok !== true
        || payload?.schema !== CACHE_SCHEMA
        || payload?.strategy !== calculationVersion
        || Number(payload?.historyQualityVersion) !== HISTORY_QUALITY_VERSION
        || normalizeMinimum(payload?.minimumBuySignals) !== MINIMUM_LOW
        || normalizeUniverseSize(payload?.universeSize) !== universeSize
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload?.baseDate || ""))) return null;
      if (!researchSummaryIsPublishable(payload)) return null;
      if (needsSignalSettlement(payload)) return null;
      const candidateOrder = normalizeCandidateOrder(candidatePool, payload?.candidateOrder, random);
      return {
        schema: CACHE_SCHEMA,
        formatSchema: CACHE_SCHEMA,
        strategy: calculationVersion,
        calculationVersion,
        historyQualityVersion: HISTORY_QUALITY_VERSION,
        filterKey: analysisFilterKey,
        baseDate: payload.baseDate,
        analysisDate: String(payload.analysisDate || payload.baseDate),
        incrementalDate: String(payload.incrementalDate || ""),
        refreshCursor: Math.max(0, Number(payload.refreshCursor) || 0),
        generatedAt: String(payload.generatedAt || new Date().toISOString()),
        priceMode: String(payload.priceMode || "settled") === "realtime"
          ? "realtime"
          : "settled",
        universeTickers: Array.isArray(payload.universeTickers) ? payload.universeTickers : [],
        universeState: payload.universeState || {},
        sharedFingerprint: String(payload.sharedFingerprint || ""),
        sharedFingerprints: payload.sharedFingerprints || {},
        scanned: Math.max(0, Number(payload.scanned) || 0),
        failed: Math.max(0, Number(payload.failed) || 0),
        minimumBuySignals: MINIMUM_LOW,
        universeSize,
        candidatePool,
        candidateOrder,
        candidatePageIndex: 0,
        candidates: selectCandidatePage(candidatePool, candidateOrder, 0),
      };
    }

    function saveSummary(payload) {
      if (payload?.filterKey !== analysisFilterKey
        || !payload?.baseDate
        || !Array.isArray(payload?.candidatePool)) return Promise.resolve(false);
      const query = new URLSearchParams({
        strategy: calculationVersion,
        minimum: String(MINIMUM_LOW),
        size: String(universeSize),
      });
      return fetchJson(`${summaryUrl}?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getHeaders() },
        body: JSON.stringify({
          schema: CACHE_SCHEMA,
          formatSchema: CACHE_SCHEMA,
          strategy: calculationVersion,
          calculationVersion,
          signalLogicVersion: calculationVersion,
          historyQualityVersion: HISTORY_QUALITY_VERSION,
          baseDate: payload.baseDate,
          analysisDate: payload.analysisDate || payload.baseDate,
          incrementalDate: payload.incrementalDate || "",
          refreshCursor: payload.refreshCursor || 0,
          generatedAt: payload.generatedAt,
          priceMode: payload.priceMode || "settled",
          universeTickers: payload.universeTickers,
          universeState: payload.universeState,
          sharedFingerprint: payload.sharedFingerprint,
          sharedFingerprints: payload.sharedFingerprints,
          scanned: payload.scanned,
          failed: payload.failed,
          minimumBuySignals: MINIMUM_LOW,
          universeSize,
          candidatePool: payload.candidatePool,
          candidateOrder: payload.candidateOrder,
        }),
      }).then((result) => result?.ok === true).catch(() => false);
    }

    async function runSearch(searchOptions = {}) {
      if (running || !canRun()) return;
      hideFailureItems();
      hideBlockedItems();
      const forceIndividual = searchOptions.forceIndividual === true;
      const targetUniverseSize = normalizeUniverseSize(universeSize);
      const perMarketLimit = targetUniverseSize / 2;
      running = true;
      stopRequested = false;
      navigationSequence += 1;
      elements.refresh.disabled = true;
      elements.stop.disabled = false;
      syncFilterControls();
      syncMinimumControls();
      syncNavigationControls();
      setProgress(2, "최신 시총 목록 확인", `0 / ${targetUniverseSize}`);
      const previous = cached;
      const lanes = [];
      try {
        if (prepareSharedData) {
          setProgress(3, "공통 지표 이력 확인", "");
          await prepareSharedData().catch(() => false);
        }
        if (!forceIndividual && !bypassSummary && (!cached || cached.partial === true)) {
          setProgress(4, "저장된 탐구 요약 확인", "");
          const summary = await loadSummary().catch(() => null);
          if (summary && shouldPreferResearchSummary(summary, cached)) {
            cached = summary;
            persistCache();
            render();
            setProgress(6, "탐구 요약 표시 · 최신 구성 확인", `${cached.candidates.length}종목`);
          }
        }
        const refreshedUniverseUrl = `${universeUrl}${universeUrl.includes("?") ? "&" : "?"}refresh=1&limit=${targetUniverseSize}`;
        const universe = await fetchJson(refreshedUniverseUrl, { headers: getHeaders() });
        const records = Array.isArray(universe?.records)
          ? universe.records.map((item) => ({
            ...item,
            baseDate: item?.baseDate || universe.baseDate,
            priceMode: item?.priceMode || universe.priceMode || "settled",
          }))
          : [];
        if (universe?.ok !== true || records.length !== targetUniverseSize) {
          throw new Error(universe?.error || `시총 상위 ${perMarketLimit}+${perMarketLimit} 목록이 불완전합니다.`);
        }
        const itemByTicker = new Map(records.map((item) => [String(item.ticker).toUpperCase(), item]));
        const shared = getSharedSources();
        const nextSharedFingerprint = sharedResearchFingerprint(shared);
        const nextSharedFingerprints = sharedResearchFingerprints(shared);
        const canIncrement = !forceIndividual
          && cached?.partial !== true
          && (cached?.calculationVersion || cached?.strategy) === calculationVersion
          && (cached?.filterKey || analysisFilterKey) === analysisFilterKey
          && normalizeMinimum(cached?.minimumBuySignals) === MINIMUM_LOW
          && Array.isArray(cached?.candidatePool)
          && Array.isArray(cached?.universeTickers)
          && cached.universeTickers.length > 0;
        const priorSharedFingerprints = cached?.sharedFingerprints;
        const sharedMarketsChanged = new Set();
        if (canIncrement) {
          if (priorSharedFingerprints?.KOSPI && priorSharedFingerprints?.KOSDAQ) {
            ["KOSPI", "KOSDAQ"].forEach((market) => {
              if (priorSharedFingerprints[market] !== nextSharedFingerprints[market]) {
                sharedMarketsChanged.add(market);
              }
            });
          } else if (cached?.sharedFingerprint !== nextSharedFingerprint) {
            sharedMarketsChanged.add("KOSPI");
            sharedMarketsChanged.add("KOSDAQ");
          }
        }
        const sharedChanged = sharedMarketsChanged.size > 0;
        const universeChanges = canIncrement
          ? diffUniverseState(cached.universeState, records, cached.universeTickers)
          : {
            added: records,
            changed: [],
            metadataChanged: [],
            removed: [],
            unchanged: [],
            state: diffUniverseState({}, records).state,
          };
        const directlyChangedTickers = new Set([
          ...universeChanges.added,
          ...universeChanges.changed,
        ].map((item) => String(item?.ticker || "").trim().toUpperCase()));
        // The first scan stores all recent buy/sell signal ages. Period and
        // minimum filters can therefore reuse that result without rerunning models.
        const scanRecords = selectIncrementalScanRecords(records, {
          canIncrement,
          directlyChangedTickers,
          sharedMarketsChanged,
          previousState: cached?.universeState,
          now: Date.now(),
        });
        const nextUniverseState = universeChanges.state;
        const scannedTickers = new Set(scanRecords.map((item) => String(item?.ticker || "").toUpperCase()));
        const previousCandidateByTicker = new Map((canIncrement ? cached.candidatePool : []).map((candidate) => [
          String(candidate?.ticker || "").toUpperCase(),
          candidate,
        ]));
        const retainedCandidates = canIncrement
          ? cached.candidatePool.flatMap((candidate) => {
            const item = itemByTicker.get(String(candidate?.ticker || "").toUpperCase());
            if (!item || scannedTickers.has(String(candidate?.ticker || "").toUpperCase())) return [];
            return [{
              ...candidate,
              name: item.name || candidate.name,
              market: item.market || candidate.market,
              marketRank: Number(item.rank) || candidate.marketRank,
              marketCap: Number(item.marketCap) || candidate.marketCap,
            }];
          })
          : [];
        const removedCount = universeChanges.removed.length;
        setProgress(8, canIncrement ? "편입·기존 종목 순환 확인" : "최초 탐구 계산 준비", `0 / ${scanRecords.length}`);
        let preloadedHistory = new Map();
        let preloadedTiming = new Map();
        const pendingHistoryWrites = new Map();
        const pendingTimingWrites = new Map();
        let historyWriteChain = Promise.resolve();
        const flushPendingHistoryWrites = async (force = false) => {
          if (typeof historyCache?.writeMany !== "function"
            || !pendingHistoryWrites.size
            || (!force && pendingHistoryWrites.size < 24)) return historyWriteChain;
          const batch = new Map(pendingHistoryWrites);
          pendingHistoryWrites.clear();
          historyWriteChain = historyWriteChain.then(async () => {
            try {
              await historyCache.writeMany(batch);
            } catch (_) {
              batch.forEach((record, ticker) => {
                if (!pendingHistoryWrites.has(ticker)) pendingHistoryWrites.set(ticker, record);
              });
            }
          });
          return historyWriteChain;
        };
        if (scanRecords.length && typeof historyCache?.readMany === "function") {
          try {
            preloadedHistory = await historyCache.readMany(scanRecords.map((item) => (
              String(item?.ticker || "").trim().toUpperCase()
            )));
            if (!(preloadedHistory instanceof Map)) preloadedHistory = new Map();
          } catch (_) {
            preloadedHistory = new Map();
          }
        }
        if (scanRecords.length && typeof timingCache?.readMany === "function") {
          try {
            preloadedTiming = await timingCache.readMany(scanRecords.map((item) => (
              String(item?.ticker || "").trim().toUpperCase()
            )));
            if (!(preloadedTiming instanceof Map)) preloadedTiming = new Map();
          } catch (_) {
            preloadedTiming = new Map();
          }
        }
        if (scanRecords.length) {
          const laneCount = researchWorkerLaneCount(scope.navigator, scanRecords.length);
          if (typeof scope.Worker !== "function") throw new Error("이 브라우저는 백그라운드 계산을 지원하지 않습니다.");
          for (let index = 0; index < laneCount; index += 1) {
            lanes.push(await createWorkerLane(scope, workerUrl, shared));
          }
        }
        let failed = 0;
        let insufficientHistory = 0;
        let signalChanges = 0;
        let latestAnalyzedDate = latestResearchDate(retainedCandidates);
        const candidates = [...retainedCandidates];
        let processed = 0;
        const failedRecords = [];
        const queues = partitionResearchScanQueues(scanRecords, lanes.length || 1, {
          marketParity: true,
        });
        await Promise.all(queues.map(async (queue, laneIndex) => {
          const lane = lanes[laneIndex];
          for (const item of queue) {
            if (stopRequested) break;
            const ticker = String(item?.ticker || "").trim().toUpperCase();
            try {
              const historyRows = await loadTickerHistory(
                item,
                preloadedHistory.has(ticker) ? preloadedHistory.get(ticker) : undefined,
                typeof historyCache?.writeMany === "function" ? pendingHistoryWrites : null,
              );
              const tickerAnalysisDate = latestResearchDate(historyRows, universe.baseDate);
              if (tickerAnalysisDate > latestAnalyzedDate) latestAnalyzedDate = tickerAnalysisDate;
              const analysis = await lane.analyze(
                item,
                historyRows,
                tickerAnalysisDate,
                ANALYSIS_FILTER,
                preloadedTiming.get(ticker) || null,
              );
              const candidate = analysis && ("candidate" in analysis || "timingCacheRecord" in analysis)
                ? (analysis.candidate || null)
                : (analysis || null);
              if (analysis?.timingCacheRecord?.model) {
                pendingTimingWrites.set(ticker, analysis.timingCacheRecord);
              }
              const previousSignal = cached?.universeState?.[ticker]?.signalFingerprint || "";
              const nextSignal = candidateSignalFingerprint(candidate);
              if (canIncrement && previousSignal && previousSignal !== nextSignal) signalChanges += 1;
              if (nextUniverseState[ticker]) {
                nextUniverseState[ticker] = markUniverseAnalysisSuccess({
                  ...nextUniverseState[ticker],
                  signalFingerprint: nextSignal,
                });
              }
              if (candidate) candidates.push(candidate);
            } catch (error) {
              if (String(error?.code || "") === "insufficient-history"
                || /가격 이력이 1년 미만/.test(String(error?.message || error || ""))) {
                const previousCandidate = previousCandidateByTicker.get(ticker);
                if (previousCandidate) candidates.push(previousCandidate);
                if (nextUniverseState[ticker]) {
                  nextUniverseState[ticker] = markUniverseAnalysisInsufficientHistory(
                    nextUniverseState[ticker],
                  );
                }
                insufficientHistory += 1;
              } else {
                failedRecords.push(item);
              }
            } finally {
              processed += 1;
              const percent = 8 + Math.round((processed / Math.max(1, scanRecords.length)) * 86);
              setProgress(percent, canIncrement
                ? "변경 종목만 갱신"
                : `${signalLabel()} 탐구`, `${processed} / ${scanRecords.length}`);
              if (pendingHistoryWrites.size >= 24) await flushPendingHistoryWrites();
            }
          }
        }));
        const interrupted = stopRequested;
        if (!interrupted) {
          failedRecords.forEach((item) => {
            const failedTicker = String(item?.ticker || "").trim().toUpperCase();
            const previousCandidate = previousCandidateByTicker.get(failedTicker);
            if (previousCandidate) candidates.push(previousCandidate);
            if (nextUniverseState[failedTicker]) {
              nextUniverseState[failedTicker] = markUniverseAnalysisFailure(
                nextUniverseState[failedTicker],
              );
            }
          });
        }
        const failureItems = universeAnalysisFailures(nextUniverseState);
        failed = failureItems.length;
        await flushPendingHistoryWrites(true);
        await historyWriteChain;
        if (pendingTimingWrites.size && typeof timingCache?.writeMany === "function") {
          await timingCache.writeMany(pendingTimingWrites).catch(() => {});
        }
        const candidatePool = candidates
          .map(({ score: _score, ...candidate }) => candidate);
        const candidateOrder = normalizeCandidateOrder(candidatePool, [], random);
        const firstPage = selectCandidatePage(candidatePool, candidateOrder, 0);
        const enrichedCandidates = await enrichCandidateProfiles(firstPage);
        cached = {
          schema: CACHE_SCHEMA,
          formatSchema: CACHE_SCHEMA,
          strategy: calculationVersion,
          calculationVersion,
          historyQualityVersion: HISTORY_QUALITY_VERSION,
          filterKey: analysisFilterKey,
          baseDate: universe.baseDate,
          analysisDate: (!canIncrement || sharedChanged || scanRecords.length > 0)
            ? (latestAnalyzedDate || universe.baseDate)
            : (cached.analysisDate || cached.baseDate),
          incrementalDate: canIncrement ? (latestAnalyzedDate || universe.baseDate) : "",
          refreshCursor: 0,
          generatedAt: new Date().toISOString(),
          partial: interrupted,
          priceMode: String(universe.priceMode || "settled") === "realtime"
            ? "realtime"
            : "settled",
          universeTickers: records.map((item) => item.ticker),
          universeState: nextUniverseState,
          sharedFingerprint: nextSharedFingerprint,
          sharedFingerprints: nextSharedFingerprints,
          scanned: interrupted ? processed : records.length,
          failed,
          minimumBuySignals: MINIMUM_LOW,
          universeSize: targetUniverseSize,
          candidatePool: mergeCandidateProfiles(candidatePool, enrichedCandidates),
          candidateOrder,
          candidatePageIndex: 0,
          candidates: enrichedCandidates,
        };
        if (!interrupted) markSummaryAvailable();
        persistCache();
        if (!interrupted && researchSummaryIsPublishable(cached)) saveSummary(cached);
        try { Promise.resolve(historyCache?.prune?.()).catch(() => {}); } catch (_) {}
        render();
        const reusedCount = Math.max(0, records.length - scanRecords.length);
        const completionText = interrupted
          ? "검색 정지 · 현재 결과 표시"
          : (canIncrement && !scanRecords.length ? "저장 결과 재사용 완료" : (canIncrement ? "탐구 구성 갱신 완료" : "최초 탐구 완료"));
        const completionDetails = interrupted
          ? `${processed} / ${records.length}`
          : [
              canIncrement ? `재사용 ${reusedCount}` : `${records.length}종목`,
              scanRecords.length ? `재계산 ${processed}` : "",
              signalChanges ? `신호변경 ${signalChanges}` : "",
              insufficientHistory ? `이력부족 ${insufficientHistory}` : "",
              removedCount ? `탈락 ${removedCount}` : "",
            ].filter(Boolean).join(" · ");
        completeProgress(completionText, completionDetails, failureItems);
        if (!interrupted) scheduleSignalSettlement();
        if (!failed) scope.setTimeout(() => { if (!running) hideProgress(); }, 900);
      } catch (error) {
        cached = previous;
        render();
        completeProgress(`재검색 실패: ${error?.message || error}`, "이전 목록 유지");
      } finally {
        lanes.forEach((lane) => lane.terminate());
        running = false;
        stopRequested = false;
        elements.refresh.disabled = false;
        elements.stop.disabled = true;
        syncFilterControls();
        syncMinimumControls();
        syncNavigationControls();
      }
    }

    async function open() {
      if (!canRun()) return false;
      await hydrateResultCache();
      render();
      hideFailureItems();
      hideBlockedItems();
      elements.modal.hidden = false;
      const failures = universeAnalysisFailures(cached?.universeState);
      if (failures.length) completeProgress("마지막 탐구 결과", "", failures);
      else setFailureButton([]);
      if (needsSignalSettlement()) await runSearch({ settlement: true });
      else if (cached) enrichExistingCandidateProfiles();
      scheduleSignalSettlement();
      return true;
    }

    function setup() {
      Object.assign(elements, {
        button: element("stockResearchBtn"),
        modal: element("stockResearchModal"),
        close: element("stockResearchCloseBtn"),
        stop: element("stockResearchStopBtn"),
        refresh: element("stockResearchRefreshBtn"),
        previous: element("stockResearchPreviousBtn"),
        pagePosition: element("stockResearchPagePosition"),
        next: element("stockResearchNextBtn"),
        asOf: element("stockResearchAsOf"),
        progress: element("stockResearchProgress"),
        progressText: element("stockResearchProgressText"),
        progressCount: element("stockResearchProgressCount"),
        failed: element("stockResearchFailedBtn"),
        progressBar: element("stockResearchProgressBar"),
        list: element("stockResearchList"),
        empty: element("stockResearchEmpty"),
        blockedButton: element("stockResearchBlockedBtn"),
        modalBlocked: element("stockResearchModalBlockedClearBtn"),
        buyFilter: element("stockResearchBuyFilter"),
        sellFilter: element("stockResearchSellFilter"),
        todayFilter: element("stockResearchTodayFilter"),
        signalStepper: element("stockResearchSignalStepper"),
        signalLabel: element("stockResearchSignalLabel"),
        minimumDecrease: element("stockResearchMinimumDecrease"),
        minimumValue: element("stockResearchMinimumValue"),
        minimumIncrease: element("stockResearchMinimumIncrease"),
      });
      if (Object.entries(elements).some(([key, value]) => key !== "blockedButton" && !value)) return;
      if (bindSettingsButtons && !elements.blockedButton) return;
      const createProgressView = options.createProgressView;
      if (typeof createProgressView === "function") {
        progressView = createProgressView(scope, {
          getRoot: () => elements.progress,
          getText: () => elements.progressText,
          getBar: () => elements.progressBar,
        });
      }
      if (bindOpenButton) elements.button.addEventListener("click", open);
      elements.close.addEventListener("click", () => {
        hideFailureItems();
        hideBlockedItems();
        elements.modal.hidden = true;
        signalSettlement.clear();
      });
      elements.failed.addEventListener("click", showFailedItems);
      elements.refresh.addEventListener("click", () => runSearch());
      elements.stop.addEventListener("click", () => {
        if (!running || stopRequested) return;
        stopRequested = true;
        elements.stop.disabled = true;
        setProgress(99, "검색 정지 중", "진행 중인 종목 마무리");
      });
      elements.previous.addEventListener("click", () => navigateCandidates(-1));
      elements.next.addEventListener("click", () => navigateCandidates(1));
      elements.buyFilter.addEventListener("click", () => setFilter({
        ...activeFilter,
        includeBuy: !activeFilter.includeBuy,
      }));
      elements.sellFilter.addEventListener("click", () => setFilter({
        ...activeFilter,
        includeSell: !activeFilter.includeSell,
      }));
      elements.todayFilter.addEventListener("click", () => setFilter({
        ...activeFilter,
        signalWindowDays: nextSignalWindowDays(activeSignalWindowDays()),
      }));
      elements.minimumDecrease.addEventListener("click", () => setMinimum(minimumBuySignals - 1));
      elements.minimumIncrease.addEventListener("click", () => setMinimum(minimumBuySignals + 1));
      if (bindSettingsButtons) elements.blockedButton.addEventListener("click", clearBlocked);
      syncBlockedButton();
      try { onBlockedStateChanged(blocked.size); } catch (_) {}
      syncFilterControls();
      syncMinimumControls();
      render();
      notifyCacheState();
    }

    return Object.freeze({
      clearBlocked,
      clearCache,
      getUniverseSize,
      open,
      render,
      runSearch,
      setUniverseSize,
      setup,
      toggleBlockedList,
    });
  }

  const stockResearchController = Object.freeze({
    CACHE_KEY,
    CACHE_VARIANTS_KEY,
    CACHE_SCHEMA,
    CACHE_BYPASS_KEY,
    BLOCKED_KEY,
    BLOCKED_SCHEMA,
    MINIMUM_KEY,
    MINIMUM_DEFAULT,
    UNIVERSE_SIZE_KEY,
    UNIVERSE_SIZE_DEFAULT,
    UNIVERSE_SIZE_LOW,
    UNIVERSE_SIZE_HIGH,
    UNIVERSE_SIZE_STEP,
    DISPLAY_LIMIT,
    HISTORY_CACHE_SCHEMA,
    HISTORY_QUALITY_VERSION,
    candidateSignalFingerprint,
    configureCacheLifecycle,
    createControllerOptions,
    createController,
    diffUniverse,
    diffUniverseState,
    fetchCandidateProfileWithRetry,
    fetchResearchHistoryWithRetry,
    loadCache,
    removeCache,
    loadBlocked,
    partitionResearchScanQueues,
    saveBlocked,
    loadMinimum,
    loadUniverseSize,
    latestResearchDate,
    resolveResearchMarketDates,
    candidateResearchMarketDate,
    candidateMatchesSignalWindow,
    candidateSignalWindowState,
    candidateMatchesTodayFilter,
    candidateMeetsSignalMinimum,
    nextSignalWindowDays,
    normalizeSignalWindowDays,
    researchMarketDateLabel,
    researchMarketDateIsCurrent,
    resolveCandidateResearchMarketDates,
    retryableResearchHistoryError,
    researchWorkerLaneCount,
    mergeResearchHistoryPayload,
    mergeUniversePointIntoHistoryCache,
    normalizeHistoryCacheRecord,
    normalizeResearchHistoryRows,
    researchHistoryRequestUrl,
    saveMinimum,
    saveUniverseSize,
    signalWindowLabel,
    sharedResearchFingerprint,
    sharedResearchFingerprints,
    normalizeCandidateOrder,
    selectCandidatePage,
    selectRandomBatch,
    visibleCandidateReasons,
  });

module.exports = stockResearchController;
