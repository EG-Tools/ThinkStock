const disclosurePolicy = globalThis.ThinkStockDisclosurePolicy;
if (!disclosurePolicy) throw new Error("Disclosure policy module failed to load");
const {
  classifyDisclosureType,
  shouldDisplayDisclosure,
  createDisclosureDataService,
} = disclosurePolicy;
const serviceWorkerClientModule = globalThis.ThinkStockServiceWorkerClient;
if (!serviceWorkerClientModule) throw new Error("Service worker client module failed to load");
const serviceWorkerClient = serviceWorkerClientModule.createServiceWorkerClient(globalThis);
const requestServiceWorkerDataRefresh = serviceWorkerClient.requestDataRefresh;
const scheduleServiceWorkerRegistration = serviceWorkerClient.scheduleRegistration;
const runtimeRefreshModule = globalThis.ThinkStockRuntimeRefresh;
if (!runtimeRefreshModule) throw new Error("Runtime refresh module failed to load");
const { runRefreshPhases } = runtimeRefreshModule;
const dataSeedLoaderModule = globalThis.ThinkStockDataSeedLoader;
if (!dataSeedLoaderModule) throw new Error("Data seed loader module failed to load");
const marketDataModule = globalThis.ThinkStockMarketData;
if (!marketDataModule) throw new Error("Market data module failed to load");
const {
  getSeriesColumns,
  copyDisplayNames,
  sanitizePricePayload: sanitizePricePayloadForSnapshot,
  mergeRowsPreservingExisting,
  mergePricePayloadPreservingExisting,
  normalizeTickerPricePoints,
  findTickerPriceRebaseSignal,
  mergeSources: mergeMarketDataSources,
  normalizeSeries,
  centeredScale,
  autoFitScales,
  shiftIsoDateByDays,
} = marketDataModule;
const chartInteractionMath = globalThis.ThinkStockChartInteractionMath;
if (!chartInteractionMath) throw new Error("Chart interaction math module failed to load");
const {
  toMsSafe,
  getTraceTimeMsArray,
  findNearestHoverPoint,
  getChartInteractionGeometry,
  axisPixelToXValue,
  xRangeMatches,
  buildLineHitIndex,
  lineHitIndexMatches,
  findNearestLineTarget,
} = chartInteractionMath;
const chartInteractionControllerModule = globalThis.ThinkStockChartInteractionController;
if (!chartInteractionControllerModule) throw new Error("Chart interaction controller module failed to load");
const { createPointerFrameController } = chartInteractionControllerModule;
const browserMarketClientModule = globalThis.ThinkStockBrowserMarketClient;
if (!browserMarketClientModule) throw new Error("Browser market client module failed to load");
const auxiliaryChartModelModule = globalThis.ThinkStockAuxiliaryChartModel;
if (!auxiliaryChartModelModule) throw new Error("Auxiliary chart model module failed to load");
const buildAuxiliaryChartModelSync = auxiliaryChartModelModule.buildAuxiliaryChartModel;
const mainChartRenderer = globalThis.ThinkStockMainChartRenderer;
if (!mainChartRenderer) throw new Error("Main chart renderer module failed to load");
const aiForecastModule = globalThis.ThinkStockAiForecast;
if (!aiForecastModule) throw new Error("AI forecast module failed to load");
const { buildForecast: buildAiForecast, isForecastSeries } = aiForecastModule;
const aiAnalysisCacheModule = globalThis.ThinkStockAiAnalysisCache;
if (!aiAnalysisCacheModule) throw new Error("AI analysis cache module failed to load");
const {
  SCHEMA_VERSION: AI_ANALYSIS_CACHE_SCHEMA_VERSION,
  isAnalysisFresh,
  normalizeAnalysisRecord,
} = aiAnalysisCacheModule;
const macdOscillatorModule = globalThis.ThinkStockMacdOscillator;
if (!macdOscillatorModule) throw new Error("MACD oscillator module failed to load");
const { buildMacdOscillator, thinMacdPoints } = macdOscillatorModule;
const performanceMonitorModule = globalThis.ThinkStockPerformanceMonitor;
if (!performanceMonitorModule) throw new Error("Performance monitor module failed to load");
const performanceMonitor = performanceMonitorModule.createPerformanceMonitor(globalThis);
const initPerfDebugAccess = () => performanceMonitor.init();
const startPerfSample = () => performanceMonitor.startSample();
const recordPerfSample = (label, startedAt, meta = {}) => (
  performanceMonitor.recordSample(label, startedAt, meta)
);
const deferredDiagnosticsModule = globalThis.ThinkStockDeferredDiagnostics;
if (!deferredDiagnosticsModule) throw new Error("Deferred diagnostics module failed to load");
const dataHealthModule = globalThis.ThinkStockDataHealth;
if (!dataHealthModule) throw new Error("Data health module failed to load");
const { buildFreshnessItems } = dataHealthModule;
const appStorageModule = globalThis.ThinkStockAppStorage;
if (!appStorageModule) throw new Error("App storage module failed to load");
const runtimeSnapshotPolicyModule = globalThis.ThinkStockRuntimeSnapshotPolicy;
if (!runtimeSnapshotPolicyModule) throw new Error("Runtime snapshot policy module failed to load");
const appUiBindingsModule = globalThis.ThinkStockAppUiBindings;
if (!appUiBindingsModule) throw new Error("App UI bindings module failed to load");
const startupLoaderModule = globalThis.ThinkStockStartupLoader;
if (!startupLoaderModule) throw new Error("Startup loader module failed to load");
const startupLoader = startupLoaderModule.createStartupLoader(globalThis);
const setStartupLoaderProgress = (percent, label = "") => (
  startupLoader.setProgress(percent, label)
);
const showStartupLoader = () => startupLoader.show();
const hideStartupLoader = () => startupLoader.hide();

const DISPLAY_NAMES = {
  leading_cycle: "\uC120\uD589\uC21C\uD658\uBCC0\uB3D9",
  news_sentiment: "\uB274\uC2A4\uC2EC\uB9AC",
  customer_deposit: "\uACE0\uAC1D\uC608\uD0C1\uAE08",
  kospi_credit: "\uCF54\uC2A4\uD53C \uC2E0\uC6A9",
  kosdaq_credit: "\uCF54\uC2A4\uB2E5 \uC2E0\uC6A9",
  "^KS11": "\uCF54\uC2A4\uD53C",
  "^KQ11": "\uCF54\uC2A4\uB2E5",
  adr_kospi: "ADR K",
  adr_kosdaq: "ADR KQ",
  fear_greed: "\uACF5\uD3EC\uD0D0\uC695",
};

const ADR_SERIES = ["adr_kospi", "adr_kosdaq"];
const FEAR_GREED_SERIES = ["fear_greed"];
const NEWS_SENTIMENT_SERIES = ["news_sentiment"];
const MACD_STOCK_PATTERN = /^\d{6}\.(KS|KQ)$/;
const SUPPLEMENTAL_SERIES = [...ADR_SERIES, ...FEAR_GREED_SERIES, ...NEWS_SENTIMENT_SERIES];
const CORE_SERIES = ["leading_cycle", "^KS11", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"];
const BASE_SERIES_PRIORITY = [...CORE_SERIES, ...SUPPLEMENTAL_SERIES];
const SERIES_COLORS = {
  leading_cycle: "#999999",
  news_sentiment: "#22d3ee",
  customer_deposit: "#f59e0b",
  "^KS11": "#4ade80",
  kospi_credit: "#60a5fa",
  "^KQ11": "#f87171",
  kosdaq_credit: "#a78bfa",
  adr_kospi: "#facc15",
  adr_kosdaq: "#f472b6",
  fear_greed: "#fb923c",
};
const CUSTOM_COLOR_PALETTE = [
  "#2dd4bf", "#fb923c", "#22d3ee", "#facc15", "#f472b6",
  "#84cc16", "#c084fc", "#38bdf8", "#f59e0b", "#10b981",
];
const MAX_CUSTOM_STOCKS = 10;
const CUSTOM_STOCK_PRELOAD_CONCURRENCY = 3;
const STATE_KEY = "thinkstock-v5";
const API_SETTINGS_KEY = "thinkstock-api-v1";
const API_SETTINGS_SESSION_KEY = "thinkstock-api-session-v1";
const DART_GATEWAY_SETTINGS_KEY = "thinkstock-dart-gateway-v1";
const DART_GATEWAY_SETTINGS_SESSION_KEY = "thinkstock-dart-gateway-session-v1";
const DATA_CACHE_DB_NAME = "thinkstock-runtime-cache-v1";
const DATA_CACHE_DB_VERSION = 3;
const DATA_CACHE_STORE_NAME = "snapshots";
const DATA_CACHE_RECORD_KEY = "latest";
const DATA_CACHE_LOCAL_KEY = "thinkstock-runtime-cache-v1";
const DATA_CACHE_SCHEMA_VERSION = 8;
const DATA_CACHE_MAX_AGE_DAYS = 7;
const RUNTIME_SNAPSHOT_FORMAT = "component-v1";
const RUNTIME_SNAPSHOT_COMPONENT_KEYS = Object.freeze({
  price: "component:price",
  macro: "component:macro",
  credit: "component:credit",
  adr: "component:adr",
  disclosure: "component:disclosure",
});
const LOCAL_SNAPSHOT_MAX_ROWS = 900;
const LOCAL_SNAPSHOT_MAX_DISCLOSURES = 80;
const TICKER_PRICE_CACHE_STORE_NAME = "tickerPrices";
const TICKER_DISCLOSURE_CACHE_STORE_NAME = "tickerDisclosures";
const TICKER_AI_ANALYSIS_CACHE_STORE_NAME = "tickerAiAnalysis";
const GRANULAR_CACHE_SCHEMA_VERSION = 1;
const TICKER_DISCLOSURE_CACHE_SCHEMA_VERSION = 2;
const GRANULAR_CACHE_MAX_IDLE_DAYS = 120;
const GRANULAR_CACHE_MAX_TICKERS = 60;
const TICKER_PRICE_CACHE_FRESH_DAYS = 1;
const TICKER_AI_ANALYSIS_CACHE_FRESH_DAYS = 30;
const PRICE_CACHE_REBASE_RATIO_THRESHOLD = 1.8;
const PRICE_CACHE_REBASE_BOUNDARY_DAYS = 14;
const APP_VERSION = "1.22";
function getAppBuildVersion() {
  try {
    const script = document.currentScript
      || [...document.scripts].find((node) => String(node?.src || "").includes("/app.bundle.min.js"));
    const src = String(script?.src || "");
    return src ? (new URL(src, window.location.href).searchParams.get("v") || "dev") : "dev";
  } catch (_) {
    return "dev";
  }
}
const APP_BUILD_VERSION = getAppBuildVersion();
const deferredPerformanceDiagnostics = deferredDiagnosticsModule.createDeferredDiagnostics(globalThis, {
  scriptUrl: `./modules/performance-diagnostics.js?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
  createOptions: { performanceApi: performanceMonitor.api },
});
const indexedCacheStore = appStorageModule.createIndexedCacheStore(globalThis, {
  dbName: DATA_CACHE_DB_NAME,
  dbVersion: DATA_CACHE_DB_VERSION,
  storeNames: [
    DATA_CACHE_STORE_NAME,
    TICKER_PRICE_CACHE_STORE_NAME,
    TICKER_DISCLOSURE_CACHE_STORE_NAME,
    TICKER_AI_ANALYSIS_CACHE_STORE_NAME,
  ],
});
const dartGatewaySettingsStore = appStorageModule.createApiSettingsStore(globalThis, {
  defaults: { accessToken: "" },
  localKey: DART_GATEWAY_SETTINGS_KEY,
  sessionKey: DART_GATEWAY_SETTINGS_SESSION_KEY,
});
const runtimeSnapshotCacheConfig = Object.freeze({
  storeName: DATA_CACHE_STORE_NAME,
  manifestKey: DATA_CACHE_RECORD_KEY,
  format: RUNTIME_SNAPSHOT_FORMAT,
  componentKeys: RUNTIME_SNAPSHOT_COMPONENT_KEYS,
});
const runtimeSnapshotRevisionTracker = runtimeSnapshotPolicyModule.createRevisionTracker(
  Object.keys(RUNTIME_SNAPSHOT_COMPONENT_KEYS),
);
const FREESIS_CREDIT_META_URL = "https://freesis.kofia.or.kr/meta/getMetaDataList.do";
const FREESIS_CREDIT_OBJ_NM = "STATSCU0100000070BO";
const FREESIS_CREDIT_LOOKBACK_DAYS = 120;
const FREESIS_CREDIT_UNIT_CODE = "01";
const FEAR_GREED_LIVE_URL = "https://kospi.feargreedchart.com/api/?action=kospi";
const DART_DISCLOSURE_CACHE_KEY = "thinkstock-dart-disclosure-cache-v1";
const DART_DISCLOSURE_CACHE_TTL_DAYS = 1;
const DART_GATEWAY_URL = "https://thinkstock-api.keg0320.workers.dev";
const DART_GATEWAY_DISCLOSURE_ENDPOINT = `${DART_GATEWAY_URL}/api/dart/disclosures`;
const AI_ANALYSIS_ENDPOINT = `${DART_GATEWAY_URL}/api/analysis`;
const DART_VISIBLE_REFRESH_CONCURRENCY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const NETWORK_REQUEST_TIMEOUT_MS = 12000;
const CHART_WORKER_STALE_CANCEL_MS = 40;
const RECENT_DATA_MONTHS = 132;
function appendCacheBust(url) {
  const stamp = `_=${Date.now()}`;
  return url.includes("?") ? `${url}&${stamp}` : `${url}?${stamp}`;
}

async function fetchWithTimeout(resource, init = {}, timeoutMs = NETWORK_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  let timedOut = false;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  try {
    return await fetch(resource, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new Error(`요청 시간 초과(${Math.round(timeoutMs / 1000)}초)`);
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}
const dataSeedLoader = dataSeedLoaderModule.createDataSeedLoader({
  fetchWithTimeout,
  appendCacheBust,
});
const {
  fetchSeedText,
  fetchSegmentedSeedText,
} = dataSeedLoader;

function isAbortError(error) {
  return error?.name === "AbortError" || /aborted|aborterror/i.test(String(error?.message || ""));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Request was superseded by a newer refresh");
  error.name = "AbortError";
  throw error;
}
const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const browserMarketClient = browserMarketClientModule.createBrowserMarketClient({
  fetchJson: (...args) => fetchJsonWithProxyFallback(...args),
  appendCacheBust,
  shiftDays,
  toNumber: toNum,
  dayMs: DAY_MS,
});
const {
  fetchYahooHistorySeries,
} = browserMarketClient;
const POPUP_NUMBER_FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
const formatActualValue = (v) => (Number.isFinite(v) ? POPUP_NUMBER_FORMAT.format(v) : "N/A");
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const labelName = (key) => DISPLAY_NAMES[key] || key;
function customColorForTicker(key) {
  const idx = customStocks.findIndex((item) => item.ticker === key);
  if (idx < 0) return null;
  return CUSTOM_COLOR_PALETTE[idx % CUSTOM_COLOR_PALETTE.length];
}
const seriesColor = (key) => SERIES_COLORS[key] || customColorForTicker(key) || "#888";
const toUtcMs = (d) => Date.parse(`${d}T00:00:00Z`);
const isTouchDevice = () => typeof window !== "undefined"
  && (("ontouchstart" in window) || ((navigator && navigator.maxTouchPoints) > 0));
const PLOTLY_CONFIG = {
  responsive: true,
  displayModeBar: false,
  displaylogo: false,
  scrollZoom: true,
  doubleClick: false,
};
function plotlyHoverLabel(fontSize) {
  return hoverShowPopup
    ? {
      bgcolor: "rgba(34,34,34,0.45)",
      bordercolor: "rgba(140,140,140,0.35)",
      font: { color: "#eee", ...(fontSize ? { size: fontSize } : {}) },
    }
    : {
      bgcolor: "rgba(0,0,0,0)",
      bordercolor: "rgba(0,0,0,0)",
      font: { color: "rgba(0,0,0,0)", size: 1 },
    };
}

async function ensurePlotlyReady() {
  if (window.Plotly) return window.Plotly;
  const loader = window.ThinkStockChartLoader;
  if (loader?.ensurePlotlyLoaded) {
    return loader.ensurePlotlyLoaded();
  }
  throw new Error("차트 엔진을 불러오지 못했습니다. 앱을 새로고침해 주세요.");
}
const LINE_DRAG_TOLERANCE_PX = 14;
const LINE_DRAG_TOUCH_TOLERANCE_PX = 24;
const LINE_HIGHLIGHT_EXTRA_WIDTH = 2;
const LINE_HIT_TEST_INTERVAL_MS = 50;
const CHART_GEOMETRY_CACHE_MS = 240;
const VIEWPORT_SYNC_DEBOUNCE_MS = 70;
const HANDLE_UPDATE_DEBOUNCE_MS = 120;
const DISCLOSURE_HOVER_DELAY_MS = 90;
const SNAPSHOT_SAVE_IDLE_TIMEOUT_MS = 3500;
const MAIN_LINE_TRACE_TYPE = "scatter";
const MAIN_CHART_MIN_DISPLAY_POINTS = 720;
const MAIN_CHART_MOBILE_MIN_DISPLAY_POINTS = 420;
const MAIN_CHART_MAX_DISPLAY_POINTS = 1500;
const MAIN_CHART_POINTS_PER_PIXEL = 1.45;
const MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_DESKTOP = 6500;
const MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_MOBILE = 2800;
const INTERACTION_RENDER_DELAY_MS = 260;
const DISCLOSURE_TRACE_NAME = "공시";
const DISCLOSURE_ICON_TEXT = "◆";
const DISCLOSURE_MARKER_COLOR = "#fde047";
const DISCLOSURE_MARKER_HOVER_LINE_COLOR = "#fef3c7";
const DISCLOSURE_TEXT_SIZE = 13;
const DISCLOSURE_TEXT_HOVER_SIZE = 17;
const DISCLOSURE_MOUSE_HIT_RADIUS_PX = 22;
const DISCLOSURE_TOUCH_HIT_RADIUS_PX = 30;

let pricePayload = null;
let macroRows = [];
let creditRows = [];   // KOFIA credit balance seed data (credit_data.json)
let disclosureRows = [];
let disclosureManifest = null;
let disclosureSeedLoadPromises = new Map();
let disclosureSeedLoadedTickers = new Set();
let dartCorpCodeMap = new Map();
let dartCorpCodeMapLoaded = false;
let dartCorpCodeManifest = null;
let dartCorpCodeManifestPromise = null;
let dartCorpCodeLoadedShards = new Set();
let dartCorpCodeMapPromises = new Map();
let dartDisclosureTickerRefreshPromises = new Map();
let activeMonths = 120;
let hiddenSeries = new Set(["customer_deposit", "kospi_credit", "^KQ11", "kosdaq_credit"]);
let hiddenAuxiliarySeries = new Set();
let customStocks = [];
let krxUniverse = [];
let krxUniverseLoaded = false;
let krxUniverseLoading = false;
let stockSuggestItems = [];
let stockSuggestActiveIndex = -1;
let loadingCustomStocks = new Set();
let seriesOffsets = {};
let seriesScales = {};
let currentSelected = [];
let currentDisclosureHighlight = null;
let lastDisclosureTraceStats = { total: 0, candidates: 0, markers: 0 };
let baseTraceValues = {};
let legendHandlerSet = false;
let adrHandlerSet = false;
let lastAdrRenderKey = "";
let dragRafId = null;
let cursorRafId = 0;
let pendingCursorState = null;
let hoverSyncRafId = 0;
let pendingHoverSync = null;
let lastHoverSyncKey = "";
let currentRows = [];
let currentStart = "";
let currentEnd = "";
let currentMainChartModel = null;
let historicalDataLoaded = false;
let historicalDataLoadPromise = null;
let mainChartCalcCache = null;
let mainChartCalcPending = null;
let lastMainChartModelCacheHit = false;
let lastMainChartModelSource = "none";
let lastAuxiliaryChartModelSource = "none";
let auxiliaryChartRenderGeneration = 0;
let auxiliaryChartCalcCache = null;
let auxiliaryChartCalcPending = null;
let chartModelWorker = null;
let chartModelWorkerSeq = 0;
let chartModelWorkerRequests = new Map();
let chartModelWorkerDataKeys = new Map();
let chartModelWorkerActiveId = "";
let chartModelWorkerQueuedRequests = new Map();
let chartModelWorkerDispatchCount = 0;
let chartModelWorkerSourceTransferCount = 0;
let chartModelWorkerSupersededCount = 0;
let chartModelWorkerDispatchByType = {};
let partialDisclosureUpdateCount = 0;
let mainChartPartialUpdateCount = 0;
let mainChartFullRenderCount = 0;
let lastMainChartRenderMode = "none";
let chartRenderGeneration = 0;
let chartSyncing = false;   // relayout sync loop guard
let hoverShowPopup = false;
let showDisclosures = true;
let showAiForecast = false;
let lastAiForecastTraceCount = 0;
let aiAnalysisByTicker = new Map();
let aiAnalysisPromises = new Map();
let aiAnalysisPendingTickers = new Set();
let showMacdOscillator = false;
let lastMacdTraceCount = 0;
let lastMacdRenderKey = "";
let macdModelCache = new Map();
let macdHandlerSet = false;
let isHandleDragging = false;
let pinnedXRange = null;
let hoverSyncing = false;
let cursorSyncing = false;
let cursorMoveBound = false;
let renderChartRafId = 0;
let pendingRenderPreserveZoom = true;
let deferredRenderTimer = 0;
let pendingDeferredRenderPreserveZoom = true;
let handleUpdateTimer = 0;
let viewportSyncTimer = 0;
let pendingViewportSync = new Map();
let disclosureHoverTimer = 0;
let pendingDisclosureHoverData = null;
let disclosureGroupStore = new Map();
let disclosureGroupStoreSeq = 0;
let disclosureMarkerPixelCache = new WeakMap();
let lineHitIndexCache = new WeakMap();
let pointerMoveController = null;
const CURSOR_LINE_CLASS = "synced-cursor-line";
let lastTouchTapAt = 0;
let lastTouchTapX = null;
let lastTouchTapEl = null;
let dragZoomBound = false;
let touchDoubleTapZoomActive = false;
let touchDoubleTapPrevRange = null;
let suppressPlotlyClickUntil = 0;
let hoveredLineTraceIndex = null;
let activeLineTraceIndex = null;
let appliedLineHighlightTraceIndex = null;
let isViewportDragging = false;
let runtimeSnapshotIdleTimer = 0;
let runtimeSnapshotSavedSignature = "";
let runtimeSnapshotWritePromise = null;
let runtimeSnapshotWriteSignature = "";
let runtimeSnapshotBuildCount = 0;
let runtimeSnapshotWriteCount = 0;
let runtimeSnapshotSkipCount = 0;
let runtimeSnapshotComponentWriteCount = 0;
let runtimeSnapshotPersistedRevisions = {};
let granularCacheCleanupStats = { runs: 0, transactions: 0, deleted: 0 };
let lineHighlightDomUpdateCount = 0;
let disclosureHighlightDomUpdateCount = 0;
let runtimeRefreshController = null;
let runtimeRefreshPromise = null;
let runtimeRefreshGeneration = 0;
let runtimeRefreshPhaseStats = { criticalReady: 0, supplementalReady: 0 };
function initE2eDebugAccess() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("e2e") !== "1") return;
    window.ThinkStockE2E = {
      getChartModelSource() {
        return lastMainChartModelSource;
      },
      getAuxiliaryChartModelSource() {
        return lastAuxiliaryChartModelSource;
      },
      getChartRenderGeneration() {
        return chartRenderGeneration;
      },
      getRefreshPhaseStats() {
        return { ...runtimeRefreshPhaseStats };
      },
      getChartWorkerStats() {
        return {
          dispatched: chartModelWorkerDispatchCount,
          sourceTransfers: chartModelWorkerSourceTransferCount,
          superseded: chartModelWorkerSupersededCount,
          partialDisclosureUpdates: partialDisclosureUpdateCount,
          partialChartUpdates: mainChartPartialUpdateCount,
          fullChartRenders: mainChartFullRenderCount,
          lastChartRenderMode: lastMainChartRenderMode,
          dispatchByType: { ...chartModelWorkerDispatchByType },
        };
      },
      getRuntimeSnapshotStats() {
        return {
          builds: runtimeSnapshotBuildCount,
          writes: runtimeSnapshotWriteCount,
          skips: runtimeSnapshotSkipCount,
          componentWrites: runtimeSnapshotComponentWriteCount,
          revisions: getDataRevisions(),
        };
      },
      getCacheCleanupStats() {
        return { ...granularCacheCleanupStats };
      },
      getHighlightStats() {
        return {
          lineDomUpdates: lineHighlightDomUpdateCount,
          disclosureDomUpdates: disclosureHighlightDomUpdateCount,
        };
      },
      applyNewsSentimentForTest(rows) {
        const result = applyNewsSentimentLiveRows(rows);
        if (result.updated > 0) {
          mainChartCalcCache = null;
          lastAdrRenderKey = "";
          requestChartRender(false);
        }
        return result;
      },
      pruneGranularCacheForTest(storeName, maxRecords) {
        return pruneGranularCacheStore(storeName, maxRecords);
      },
      saveRuntimeSnapshotNow() {
        return saveLastRuntimeSnapshot();
      },
      getMainHoverMode() {
        return document.getElementById("chart")?._fullLayout?.hovermode;
      },
      applyDartCorpCodesForTest(payload) {
        setDartCorpCodeRows(payload?.codes || payload?.records || []);
        return dartCorpCodeMap.size;
      },
      async loadDartCorpCodeForTest(stockCode) {
        const loaded = await ensureDartCorpCodeMapLoaded(stockCode);
        return {
          loaded,
          corpCode: dartCorpCodeMap.get(String(stockCode || ""))?.corp_code || "",
          shards: [...dartCorpCodeLoadedShards],
        };
      },
      openFirstDisclosure(offsetX = 0, offsetY = 0) {
        const chart = document.getElementById("chart");
        const traceIndex = chart?.data?.findIndex((item) => item?.meta?.isDisclosureTrace) ?? -1;
        const trace = traceIndex >= 0 ? chart.data[traceIndex] : null;
        const xaxis = chart?._fullLayout?.xaxis;
        const yaxis = chart?._fullLayout?.yaxis;
        if (!trace || !xaxis || !yaxis || !trace.x?.length) return false;
        const rect = chart.getBoundingClientRect();
        const clientX = rect.left + Number(xaxis._offset || 0) + xaxis.d2p(trace.x[0]) + Number(offsetX || 0);
        const clientY = rect.top + Number(yaxis._offset || 0) + yaxis.d2p(trace.y[0]) + Number(offsetY || 0);
        return handleDisclosureClick({
          event: { clientX, clientY },
          points: [{
            curveNumber: traceIndex,
            pointIndex: 0,
            pointNumber: 0,
            data: trace,
            customdata: trace.customdata?.[0],
            x: trace.x[0],
            y: trace.y[0],
            xaxis,
            yaxis,
          }],
        });
      },
    };
  } catch (_) {
    // Test-only diagnostics must never affect normal boot.
  }
}

/* localStorage persistence */
function sanitizeCustomStocks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const ticker = String(item.ticker || "").trim().toUpperCase();
    const name = String(item.name || "").trim();
    const code = String(item.code || "").trim();
    const market = String(item.market || "").trim().toUpperCase();
    if (!ticker || !name) return;
    if (!/^[0-9]{6}\.(KS|KQ)$/.test(ticker)) return;
    if (seen.has(ticker)) return;
    seen.add(ticker);
    out.push({ ticker, name, code, market });
  });
  return out.slice(0, MAX_CUSTOM_STOCKS);
}

function applyCustomStockDisplayNames() {
  customStocks.forEach((item) => {
    if (item?.ticker && item?.name) DISPLAY_NAMES[item.ticker] = item.name;
  });
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      activeMonths,
      hiddenSeries: [...hiddenSeries],
      hiddenAuxiliarySeries: [...hiddenAuxiliarySeries],
      customStocks,
      seriesOffsets,
      seriesScales,
      creditOffset: -CREDIT_OFFSET_DAYS,
      hoverShowPopup,
      showDisclosures,
      showAiForecast,
      showMacdOscillator,
    }));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (typeof p.activeMonths === "number") activeMonths = p.activeMonths;
    if (Array.isArray(p.hiddenSeries)) hiddenSeries = new Set(p.hiddenSeries);
    if (Array.isArray(p.hiddenAuxiliarySeries)) {
      hiddenAuxiliarySeries = new Set(p.hiddenAuxiliarySeries);
    }
    if (p.seriesOffsets && typeof p.seriesOffsets === "object") seriesOffsets = p.seriesOffsets;
    if (p.seriesScales && typeof p.seriesScales === "object") seriesScales = p.seriesScales;
    if (typeof p.creditOffset === "number") CREDIT_OFFSET_DAYS = Math.abs(p.creditOffset);
    if (typeof p.hoverShowPopup === "boolean") hoverShowPopup = p.hoverShowPopup;
    if (typeof p.showDisclosures === "boolean") showDisclosures = p.showDisclosures;
    if (typeof p.showAiForecast === "boolean") showAiForecast = p.showAiForecast;
    if (typeof p.showMacdOscillator === "boolean") showMacdOscillator = p.showMacdOscillator;
    if (Array.isArray(p.customStocks)) customStocks = sanitizeCustomStocks(p.customStocks);
    applyCustomStockDisplayNames();
  } catch (_) {}
}

function clearLegacyBrowserApiSettings() {
  try { localStorage.removeItem(API_SETTINGS_KEY); } catch (_) {}
  try { sessionStorage.removeItem(API_SETTINGS_SESSION_KEY); } catch (_) {}
}

const disclosureDataService = createDisclosureDataService({
  classifyType: classifyDisclosureType,
  shouldDisplay: shouldDisplayDisclosure,
  labelName,
  refreshCacheKey: DART_DISCLOSURE_CACHE_KEY,
  refreshCacheTtlMs: DART_DISCLOSURE_CACHE_TTL_DAYS * DAY_MS,
  getStorage: () => localStorage,
});
let dartDisclosureServicePromise = null;

function ensureDartDisclosureService() {
  if (dartDisclosureServicePromise) return dartDisclosureServicePromise;
  dartDisclosureServicePromise = deferredDiagnosticsModule.loadScriptGlobal(
    globalThis,
    `./modules/dart-disclosure.js?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
    "ThinkStockDartDisclosure",
    "thinkstockDartDisclosure",
  ).then((module) => module.createDartDisclosureService({
    classifyType: classifyDisclosureType,
    shouldDisplay: shouldDisplayDisclosure,
    labelName,
  })).catch((error) => {
    dartDisclosureServicePromise = null;
    throw error;
  });
  return dartDisclosureServicePromise;
}

function sanitizeDisclosureRows(records) {
  return disclosureDataService.sanitizeRows(records);
}

function sanitizeDartCorpCodeRows(records) {
  const source = Array.isArray(records)
    ? records
    : Object.entries(records || {}).map(([stockCode, corpCode]) => ({
      stock_code: stockCode,
      corp_code: corpCode,
    }));
  const out = [];
  const seen = new Set();
  source.forEach((record) => {
    if (!record || typeof record !== "object") return;
    const stockCode = String(record.stock_code || record.stockCode || "").replace(/\D/g, "").slice(0, 6);
    const corpCode = String(record.corp_code || record.corpCode || "").replace(/\D/g, "");
    if (stockCode.length !== 6 || !corpCode || seen.has(stockCode)) return;
    seen.add(stockCode);
    out.push({
      stock_code: stockCode,
      corp_code: corpCode,
      corp_name: String(record.corp_name || record.corpName || "").trim(),
    });
  });
  return out;
}

function setDartCorpCodeRows(records) {
  dartCorpCodeMap = new Map();
  dartCorpCodeLoadedShards = new Set();
  sanitizeDartCorpCodeRows(records).forEach((record) => {
    dartCorpCodeMap.set(record.stock_code, record);
  });
  dartCorpCodeMapLoaded = dartCorpCodeMap.size > 0;
}

function mergeDartCorpCodeRows(records) {
  sanitizeDartCorpCodeRows(records).forEach((record) => {
    dartCorpCodeMap.set(record.stock_code, record);
  });
  dartCorpCodeMapLoaded = dartCorpCodeMap.size > 0;
}

async function ensureDartCorpCodeManifest(forceNetwork = false) {
  if (dartCorpCodeManifest && !forceNetwork) return dartCorpCodeManifest;
  if (dartCorpCodeManifestPromise) return dartCorpCodeManifestPromise;
  dartCorpCodeManifestPromise = (async () => {
    const text = await fetchSeedText("./data/dart_corp_codes.json", forceNetwork);
    if (!text) return null;
    const payload = JSON.parse(text);
    if (payload?.format === "stock-to-corp-shards-v1" && payload?.files) {
      dartCorpCodeManifest = payload;
      return payload;
    }
    setDartCorpCodeRows(payload?.codes || payload?.records || []);
    dartCorpCodeManifest = payload;
    return payload;
  })().finally(() => {
    dartCorpCodeManifestPromise = null;
  });
  return dartCorpCodeManifestPromise;
}

async function ensureDartCorpCodeMapLoaded(stockCode = "", forceNetwork = false) {
  const code = String(stockCode || "").replace(/\D/g, "").slice(0, 6);
  if (code.length === 6 && dartCorpCodeMap.has(code)) return true;
  const manifest = await ensureDartCorpCodeManifest(forceNetwork);
  if (!manifest) return false;
  if (manifest.format !== "stock-to-corp-shards-v1") {
    return code.length === 6 ? dartCorpCodeMap.has(code) : dartCorpCodeMapLoaded;
  }
  const prefixLength = Math.max(1, Math.min(4, Number(manifest.prefix_length) || 2));
  const prefix = code.slice(0, prefixLength);
  const relativePath = manifest.files?.[prefix];
  if (!relativePath) return false;
  if (dartCorpCodeLoadedShards.has(prefix)) return dartCorpCodeMap.has(code);
  if (dartCorpCodeMapPromises.has(prefix)) return dartCorpCodeMapPromises.get(prefix);

  const task = (async () => {
    const path = `./${String(relativePath).replace(/^\.?\//, "")}`;
    const text = await fetchSeedText(path, forceNetwork);
    if (!text) return false;
    const payload = JSON.parse(text);
    if (payload?.format !== "stock-to-corp-shard-v1" || !payload?.codes) return false;
    mergeDartCorpCodeRows(payload.codes);
    dartCorpCodeLoadedShards.add(prefix);
    return dartCorpCodeMap.has(code);
  })().finally(() => {
    dartCorpCodeMapPromises.delete(prefix);
  });
  dartCorpCodeMapPromises.set(prefix, task);
  return task;
}

function getDataRevisions() {
  return runtimeSnapshotRevisionTracker.getRevisions();
}

function markDataChanged(...names) {
  runtimeSnapshotRevisionTracker.markChanged(names);
}

function applySnapshotRevisions(revisions, loadedNames) {
  runtimeSnapshotRevisionTracker.applyRevisions(revisions, loadedNames);
}

function getSnapshotComponent(name) {
  return runtimeSnapshotRevisionTracker.getComponent(name, () => {
    if (name === "price") return sanitizePricePayloadForSnapshot(pricePayload);
    if (name === "macro") return normalizePayloadRecords(macroRows);
    if (name === "credit") return normalizeCreditRows(creditRows);
    if (name === "adr") return normalizePayloadRecords(adrRows);
    if (name === "disclosure") return sanitizeDisclosureRows(disclosureRows);
    return null;
  });
}

function buildRuntimeDataSnapshot() {
  if (!hasRuntimeDataLoaded() && !disclosureRows.length) return null;
  const revisions = getDataRevisions();
  const components = {};
  Object.keys(RUNTIME_SNAPSHOT_COMPONENT_KEYS).forEach((name) => {
    if (Number(runtimeSnapshotPersistedRevisions[name]) === Number(revisions[name])) return;
    components[name] = getSnapshotComponent(name);
  });
  return {
    manifest: {
      version: DATA_CACHE_SCHEMA_VERSION,
      format: RUNTIME_SNAPSHOT_FORMAT,
      app_version: APP_VERSION,
      build_version: APP_BUILD_VERSION,
      saved_at: new Date().toISOString(),
      historical_data_loaded: historicalDataLoaded,
      revisions,
    },
    components,
  };
}

function buildCompactLocalSnapshot() {
  return runtimeSnapshotPolicyModule.buildCompactSnapshot({
    metadata: {
      version: DATA_CACHE_SCHEMA_VERSION,
      format: "compact-v1",
      app_version: APP_VERSION,
      build_version: APP_BUILD_VERSION,
      saved_at: new Date().toISOString(),
    },
    revisions: getDataRevisions(),
    maxRows: LOCAL_SNAPSHOT_MAX_ROWS,
    maxDisclosures: LOCAL_SNAPSHOT_MAX_DISCLOSURES,
    components: Object.fromEntries(
      Object.keys(RUNTIME_SNAPSHOT_COMPONENT_KEYS).map((name) => [name, getSnapshotComponent(name)]),
    ),
  });
}

function getRuntimeDataSignature() {
  return runtimeSnapshotPolicyModule.buildSignature(
    historicalDataLoaded,
    Object.keys(RUNTIME_SNAPSHOT_COMPONENT_KEYS),
    getDataRevisions(),
  );
}

function isRuntimeSnapshotUsable(snapshot) {
  return runtimeSnapshotPolicyModule.isSnapshotUsable(snapshot, {
    schemaVersion: DATA_CACHE_SCHEMA_VERSION,
    futureToleranceMs: DAY_MS,
    maxAgeMs: DATA_CACHE_MAX_AGE_DAYS * DAY_MS,
  });
}

function applyRuntimeDataSnapshot(snapshot) {
  if (!isRuntimeSnapshotUsable(snapshot)) return false;

  const safePricePayload = sanitizePricePayloadForSnapshot(snapshot.pricePayload);
  const safeMacroRows = normalizePayloadRecords(snapshot.macroRows);
  const safeCreditRows = normalizeCreditRows(snapshot.creditRows);
  const safeAdrRows = normalizePayloadRecords(snapshot.adrRows);
  const safeDisclosureRows = sanitizeDisclosureRows(snapshot.disclosureRows);

  if (!safePricePayload && !safeMacroRows.length && !safeCreditRows.length && !safeAdrRows.length && !safeDisclosureRows.length) return false;

  const loadedNames = [];
  if (safePricePayload) {
    pricePayload = safePricePayload;
    Object.assign(DISPLAY_NAMES, safePricePayload.display_names || {});
    loadedNames.push("price");
  }
  if (Array.isArray(snapshot.macroRows)) {
    macroRows = safeMacroRows;
    loadedNames.push("macro");
  }
  if (Array.isArray(snapshot.creditRows)) {
    creditRows = safeCreditRows;
    loadedNames.push("credit");
  }
  if (Array.isArray(snapshot.adrRows)) {
    adrRows = safeAdrRows;
    loadedNames.push("adr");
  }
  if (Array.isArray(snapshot.disclosureRows)) {
    disclosureRows = safeDisclosureRows;
    loadedNames.push("disclosure");
  }
  applySnapshotRevisions(snapshot.revisions, loadedNames);
  loadedNames.forEach((name) => {
    runtimeSnapshotRevisionTracker.seedComponent(
      name,
      name === "price" ? safePricePayload
        : name === "macro" ? safeMacroRows
          : name === "credit" ? safeCreditRows
            : name === "adr" ? safeAdrRows
              : safeDisclosureRows,
    );
  });
  runtimeSnapshotPersistedRevisions = snapshot._persistedRevisions
    ? { ...snapshot._persistedRevisions }
    : {};
  historicalDataLoaded = snapshot.historical_data_loaded === true || hasHistoricalDataCoverage();
  runtimeSnapshotSavedSignature = getRuntimeDataSignature();
  return true;
}

function hasRuntimeDataLoaded() {
  return Boolean(
    pricePayload?.records?.length
    || macroRows?.length
    || creditRows?.length
    || adrRows?.length
  );
}

async function readRuntimeSnapshotFromIndexedDb() {
  const snapshot = await indexedCacheStore.readSnapshot(runtimeSnapshotCacheConfig);
  if (!snapshot || snapshot.format !== RUNTIME_SNAPSHOT_FORMAT) return snapshot;
  return {
    ...snapshot,
    pricePayload: snapshot.price,
    macroRows: snapshot.macro,
    creditRows: snapshot.credit,
    adrRows: snapshot.adr,
    disclosureRows: snapshot.disclosure,
  };
}

const writeRuntimeSnapshotToIndexedDb = (snapshotBundle) => (
  indexedCacheStore.writeSnapshot(snapshotBundle, runtimeSnapshotCacheConfig)
);

const deleteRuntimeSnapshotFromIndexedDb = () => (
  indexedCacheStore.deleteSnapshot(runtimeSnapshotCacheConfig)
);

const readIndexedDbRecord = (storeName, key) => (
  indexedCacheStore.readRecord(storeName, key)
);

const writeIndexedDbRecord = (storeName, key, value) => (
  indexedCacheStore.writeRecord(storeName, key, value)
);

const deleteIndexedDbRecord = (storeName, key) => (
  indexedCacheStore.deleteRecord(storeName, key)
);

async function pruneGranularCacheStore(storeName, maxRecords = GRANULAR_CACHE_MAX_TICKERS) {
  try {
    const deletedCount = await indexedCacheStore.pruneStore(storeName, {
      maxRecords,
      maxIdleMs: GRANULAR_CACHE_MAX_IDLE_DAYS * DAY_MS,
    });
    if (deletedCount > 0) {
      granularCacheCleanupStats.transactions += 1;
      granularCacheCleanupStats.deleted += deletedCount;
    }
  } catch (_) {
    // Cache cleanup should never block the app.
  } finally {
    granularCacheCleanupStats.runs += 1;
  }
}

function scheduleGranularCacheCleanup() {
  setTimeout(() => {
    pruneGranularCacheStore(TICKER_PRICE_CACHE_STORE_NAME).catch(() => {});
    pruneGranularCacheStore(TICKER_DISCLOSURE_CACHE_STORE_NAME).catch(() => {});
    pruneGranularCacheStore(TICKER_AI_ANALYSIS_CACHE_STORE_NAME).catch(() => {});
  }, 2500);
}

function readRuntimeSnapshotFromLocalStorage() {
  try {
    const raw = localStorage.getItem(DATA_CACHE_LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeRuntimeSnapshotToLocalStorage(snapshot) {
  localStorage.setItem(DATA_CACHE_LOCAL_KEY, JSON.stringify(snapshot));
}

function deleteRuntimeSnapshotFromLocalStorage() {
  localStorage.removeItem(DATA_CACHE_LOCAL_KEY);
}

async function readLastRuntimeSnapshot() {
  try {
    const snapshot = await readRuntimeSnapshotFromIndexedDb();
    if (snapshot) return snapshot;
  } catch (_) {
    // Fall back to localStorage for browsers or modes that block IndexedDB.
  }
  return readRuntimeSnapshotFromLocalStorage();
}

async function clearLastRuntimeSnapshot() {
  try { await deleteRuntimeSnapshotFromIndexedDb(); } catch (_) {}
  try { deleteRuntimeSnapshotFromLocalStorage(); } catch (_) {}
  runtimeSnapshotSavedSignature = "";
  runtimeSnapshotPersistedRevisions = {};
}

async function saveLastRuntimeSnapshot() {
  const signature = getRuntimeDataSignature();
  if (signature === runtimeSnapshotSavedSignature) {
    runtimeSnapshotSkipCount += 1;
    return false;
  }
  if (runtimeSnapshotWritePromise) {
    if (signature === runtimeSnapshotWriteSignature) {
      runtimeSnapshotSkipCount += 1;
      return runtimeSnapshotWritePromise;
    }
    await runtimeSnapshotWritePromise.catch(() => false);
    return saveLastRuntimeSnapshot();
  }

  runtimeSnapshotBuildCount += 1;
  const snapshotBundle = buildRuntimeDataSnapshot();
  if (!snapshotBundle) return false;

  const writeTask = (async () => {
    try {
      await writeRuntimeSnapshotToIndexedDb(snapshotBundle);
      runtimeSnapshotPersistedRevisions = { ...snapshotBundle.manifest.revisions };
      runtimeSnapshotComponentWriteCount += Object.keys(snapshotBundle.components).length;
      try { deleteRuntimeSnapshotFromLocalStorage(); } catch (_) {}
      return true;
    } catch (idbErr) {
      try {
        writeRuntimeSnapshotToLocalStorage(buildCompactLocalSnapshot());
        return true;
      } catch (storageErr) {
        const message = storageErr?.message || idbErr?.message || "runtime cache write failed";
        throw new Error(message);
      }
    }
  })();
  runtimeSnapshotWritePromise = writeTask;
  runtimeSnapshotWriteSignature = signature;
  try {
    const saved = await writeTask;
    if (saved) {
      runtimeSnapshotSavedSignature = signature;
      runtimeSnapshotWriteCount += 1;
    }
    return saved;
  } finally {
    if (runtimeSnapshotWritePromise === writeTask) {
      runtimeSnapshotWritePromise = null;
      runtimeSnapshotWriteSignature = "";
    }
  }
}

let runtimeSnapshotSaveTimer = 0;
function isChartInteractionBusy() {
  return Boolean(isViewportDragging || isHandleDragging || dragRafId || cursorRafId || viewportSyncTimer);
}

function cancelRuntimeSnapshotIdleSave() {
  if (!runtimeSnapshotIdleTimer) return;
  if (typeof cancelIdleCallback === "function") {
    try { cancelIdleCallback(runtimeSnapshotIdleTimer); } catch (_) {}
  } else {
    clearTimeout(runtimeSnapshotIdleTimer);
  }
  runtimeSnapshotIdleTimer = 0;
}

function queueRuntimeSnapshotIdleSave() {
  cancelRuntimeSnapshotIdleSave();
  const run = () => {
    runtimeSnapshotIdleTimer = 0;
    if (isChartInteractionBusy()) {
      scheduleLastRuntimeSnapshotSave(1200);
      return;
    }
    saveLastRuntimeSnapshot().catch(() => {});
  };
  if (typeof requestIdleCallback === "function") {
    runtimeSnapshotIdleTimer = requestIdleCallback(run, { timeout: SNAPSHOT_SAVE_IDLE_TIMEOUT_MS });
  } else {
    runtimeSnapshotIdleTimer = setTimeout(run, 250);
  }
}

function scheduleLastRuntimeSnapshotSave(delayMs = 1500) {
  if (runtimeSnapshotSaveTimer) clearTimeout(runtimeSnapshotSaveTimer);
  runtimeSnapshotSaveTimer = setTimeout(() => {
    runtimeSnapshotSaveTimer = 0;
    queueRuntimeSnapshotIdleSave();
  }, delayMs);
}

async function loadLastRuntimeSnapshot() {
  const snapshot = await readLastRuntimeSnapshot();
  const applied = applyRuntimeDataSnapshot(snapshot);
  if (!applied && snapshot) clearLastRuntimeSnapshot().catch(() => {});
  return applied;
}

let runtimeSnapshotExitSaveBound = false;
function bindRuntimeSnapshotExitSave() {
  if (runtimeSnapshotExitSaveBound || typeof window === "undefined") return;
  runtimeSnapshotExitSaveBound = true;
  const save = () => {
    if (runtimeSnapshotSaveTimer) {
      clearTimeout(runtimeSnapshotSaveTimer);
      runtimeSnapshotSaveTimer = 0;
    }
    cancelRuntimeSnapshotIdleSave();
    saveLastRuntimeSnapshot().catch(() => {});
  };
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
}

function syncApiOptionsButton() {
  const btn = document.getElementById("apiOptionsBtn");
  if (!btn) return;
  btn.classList.toggle("is-configured", canUseDartGateway());
}

function getDartGatewayAccessToken() {
  return String(dartGatewaySettingsStore.load()?.accessToken || "").trim();
}

function canUseDartGateway() {
  return Boolean(getDartGatewayAccessToken());
}

function renderAppVersionLabel() {
  const el = document.getElementById("appVersionText");
  if (el) {
    el.textContent = APP_VERSION;
    el.title = `Build ${APP_BUILD_VERSION}`;
  }
}

function setMessage(msgEl, lines, isError = false) {
  if (!msgEl) return;
  const list = (Array.isArray(lines) ? lines : [lines])
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (!list.length) {
    msgEl.innerHTML = "";
    return;
  }
  const body = list.map((line) => escapeHtml(line)).join("<br>");
  msgEl.innerHTML = `<div class="message${isError ? " error" : ""}">${body}</div>`;
}

function syncDisclosureToggleButton(markerCount = null) {
  const btn = document.getElementById("disclosureToggle");
  if (!btn) return;
  const count = Number(markerCount);
  const hasCount = showDisclosures && Number.isFinite(count) && count > 0;
  btn.classList.toggle("is-active", showDisclosures);
  btn.textContent = showDisclosures ? `공시${hasCount ? ` ${count}` : ""}` : "공시 OFF";
  btn.title = showDisclosures
    ? `공시 마커 켜짐${hasCount ? ` - 현재 범위 ${count}개` : ""}`
    : "공시 마커 꺼짐";
}

function enableDisclosureMarkers() {
  showDisclosures = true;
  syncDisclosureToggleButton(lastDisclosureTraceStats.markers);
}

function renderDataFreshness() {
  const el = document.getElementById("dataFreshness");
  if (!el) return;

  const priceKeys = Array.isArray(pricePayload?.series) ? pricePayload.series : [];
  const creditSourceRows = [...(macroRows || []), ...(creditRows || [])];
  const items = buildFreshnessItems([
    { label: "가격", rows: pricePayload?.records || [], keys: priceKeys, staleDays: 10 },
    {
      label: "선행",
      rows: macroRows,
      keys: ["leading_cycle"],
      staleDays: 75,
      changePolicies: {
        leading_cycle: { maxRelativeChange: 0.05, maxAbsoluteChange: 3, maxGapDays: 62 },
      },
    },
    {
      label: "뉴스심리",
      rows: macroRows,
      keys: ["news_sentiment"],
      staleDays: 10,
      changePolicies: {
        news_sentiment: { maxRelativeChange: 0.35, maxAbsoluteChange: 20, maxGapDays: 14 },
      },
    },
    {
      label: "예탁·신용",
      rows: creditSourceRows,
      keys: CREDIT_COLS,
      staleDays: 14,
      changePolicies: {
        customer_deposit: { maxRelativeChange: 0.2, maxAbsoluteChange: 25, maxGapDays: 14 },
        kospi_credit: { maxRelativeChange: 0.15, maxAbsoluteChange: 3, maxGapDays: 14 },
        kosdaq_credit: { maxRelativeChange: 0.15, maxAbsoluteChange: 1, maxGapDays: 14 },
      },
    },
    {
      label: "ADR",
      rows: adrRows,
      keys: ADR_SERIES,
      staleDays: 10,
      changePolicies: {
        adr_kospi: { maxRelativeChange: 0.5, maxAbsoluteChange: 40, maxGapDays: 14 },
        adr_kosdaq: { maxRelativeChange: 0.5, maxAbsoluteChange: 40, maxGapDays: 14 },
      },
    },
    {
      label: "공포탐욕",
      rows: adrRows,
      keys: FEAR_GREED_SERIES,
      staleDays: 10,
      changePolicies: {
        fear_greed: { maxRelativeChange: 0.5, maxAbsoluteChange: 30, maxGapDays: 14 },
      },
    },
  ]);

  el.innerHTML = items.map((item) => {
    const classes = [
      "freshness-chip",
      item.isEmpty ? "is-empty" : "",
      item.isStale ? "is-stale" : "",
      item.anomalies.length ? "is-anomaly" : "",
    ].filter(Boolean).join(" ");
    const rangeTitle = item.first && item.latest ? `범위: ${item.first} ~ ${item.latest}` : "";
    const staleTitle = item.isStale ? `최신 데이터 확인 필요: ${item.ageDays}일 전` : "";
    const anomalyTitle = item.anomalies.length
      ? `최근 값 급변 확인 필요: ${item.anomalies.map((entry) => labelName(entry.key)).join(", ")}`
      : "";
    const title = [rangeTitle, staleTitle, anomalyTitle].filter(Boolean).join(" / ");
    return `<span class="${classes}" title="${escapeHtml(title)}"><strong>${escapeHtml(item.label)}</strong>${escapeHtml(item.date || "없음")}</span>`;
  }).join("");
}

function setupApiSettingsPanel(msgEl) {
  const modal = document.getElementById("apiSettingsModal");
  const openBtn = document.getElementById("apiOptionsBtn");
  if (!modal || !openBtn) return;

  const closeBtn = document.getElementById("apiSettingsCloseBtn");
  const dataCacheClearBtn = document.getElementById("dataCacheClearBtn");
  const diagnosticsBtn = document.getElementById("performanceDiagnosticsBtn");
  const diagnosticsPanel = document.getElementById("performanceDiagnosticsPanel");
  const diagnosticsSummary = document.getElementById("performanceDiagnosticsSummary");
  const diagnosticsRefreshBtn = document.getElementById("performanceDiagnosticsRefreshBtn");
  const diagnosticsClearBtn = document.getElementById("performanceDiagnosticsClearBtn");
  const dartGatewayTokenInput = document.getElementById("dartGatewayTokenInput");
  const dartGatewayTokenSaveBtn = document.getElementById("dartGatewayTokenSaveBtn");

  const close = () => { modal.hidden = true; };
  const open = () => {
    if (dartGatewayTokenInput) dartGatewayTokenInput.value = getDartGatewayAccessToken();
    modal.hidden = false;
  };
  const renderDiagnostics = async () => {
    if (!diagnosticsPanel || !diagnosticsSummary) return;
    diagnosticsPanel.hidden = false;
    diagnosticsSummary.textContent = "측정 중...";
    diagnosticsBtn?.setAttribute("disabled", "");
    diagnosticsRefreshBtn?.setAttribute("disabled", "");
    try {
      const performanceDiagnostics = await deferredPerformanceDiagnostics.ensure();
      const report = await performanceDiagnostics.capture({
        appVersion: APP_VERSION,
        buildVersion: APP_BUILD_VERSION,
      });
      diagnosticsSummary.textContent = performanceDiagnostics.reportLines(
        report,
        performanceDiagnostics.comparisonFor(report),
      ).join("\n");
    } catch (error) {
      diagnosticsSummary.textContent = `상태를 측정하지 못했습니다: ${error?.message || error}`;
    } finally {
      diagnosticsBtn?.removeAttribute("disabled");
      diagnosticsRefreshBtn?.removeAttribute("disabled");
    }
  };

  if (openBtn.dataset.bound === "1") {
    syncApiOptionsButton();
    return;
  }
  openBtn.dataset.bound = "1";

  openBtn.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  modal.querySelectorAll("[data-api-close='1']").forEach((node) => {
    node.addEventListener("click", close);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  });

  dataCacheClearBtn?.addEventListener("click", async () => {
    try {
      await clearLastRuntimeSnapshot();
      close();
      setMessage(msgEl, ["Last chart screen cache was cleared."]);
    } catch (err) {
      setMessage(msgEl, `Last chart screen cache could not be cleared: ${err.message}`, true);
    }
  });
  diagnosticsBtn?.addEventListener("click", () => {
    if (diagnosticsPanel && !diagnosticsPanel.hidden) {
      diagnosticsPanel.hidden = true;
      return;
    }
    renderDiagnostics();
  });
  diagnosticsRefreshBtn?.addEventListener("click", renderDiagnostics);
  diagnosticsClearBtn?.addEventListener("click", async () => {
    try {
      const performanceDiagnostics = await deferredPerformanceDiagnostics.ensure();
      performanceDiagnostics.clear();
      if (diagnosticsSummary) diagnosticsSummary.textContent = "이전 성능 기록을 지웠습니다.";
    } catch (error) {
      if (diagnosticsSummary) {
        diagnosticsSummary.textContent = `기록을 지우지 못했습니다: ${error?.message || error}`;
      }
    }
  });
  dartGatewayTokenSaveBtn?.addEventListener("click", () => {
    const accessToken = String(dartGatewayTokenInput?.value || "").trim();
    try {
      if (accessToken) dartGatewaySettingsStore.save({ accessToken });
      else dartGatewaySettingsStore.clear();
      localStorage.removeItem(DART_DISCLOSURE_CACHE_KEY);
    } catch (_) {}
    if (dartGatewayTokenInput) dartGatewayTokenInput.value = accessToken;
    syncApiOptionsButton();
    close();
    setMessage(msgEl, accessToken
      ? ["DART 개인 접속 코드를 이 기기에 저장했습니다."]
      : ["DART 개인 접속 코드를 이 기기에서 지웠습니다."]);
  });

  syncApiOptionsButton();
}
function shiftMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() - months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function shiftDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rowsCoverMoreThanRecentWindow(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return false;
  const first = String(rows[0]?.date || "").slice(0, 10);
  const last = String(rows[rows.length - 1]?.date || "").slice(0, 10);
  if (!first || !last) return false;
  return first < shiftMonths(last, RECENT_DATA_MONTHS);
}

function hasHistoricalDataCoverage() {
  const sources = [macroRows, creditRows].filter((rows) => Array.isArray(rows) && rows.length > 1);
  return sources.length > 0 && sources.every(rowsCoverMoreThanRecentWindow);
}


function syncHoverToChartNow(targetEl, xValue) {
  if (!targetEl || !window.Plotly?.Fx?.hover || xValue == null) return;
  hoverSyncing = true;
  try {
    // Prefer exact x-date synchronization first.
    Plotly.Fx.hover(targetEl, [{ xval: xValue }], ["xy"]);
  } catch (_) {
    const pt = findNearestHoverPoint(targetEl, xValue);
    if (!pt) {
      requestAnimationFrame(() => { hoverSyncing = false; });
      return;
    }
    try {
      Plotly.Fx.hover(targetEl, [pt], ["xy"]);
    } catch (_) {
      // no-op
    }
  }
  requestAnimationFrame(() => { hoverSyncing = false; });
}

function syncHoverToChart(targetEl, xValue) {
  if (!targetEl || xValue == null) return;
  const key = `${targetEl.id || "chart"}|${String(xValue)}`;
  pendingHoverSync = { targetEl, xValue, key };
  if (hoverSyncRafId) return;
  hoverSyncRafId = requestAnimationFrame(() => {
    const pending = pendingHoverSync;
    pendingHoverSync = null;
    hoverSyncRafId = 0;
    if (!pending || pending.key === lastHoverSyncKey) return;
    lastHoverSyncKey = pending.key;
    syncHoverToChartNow(pending.targetEl, pending.xValue);
  });
}

function clearHoverOnChart(targetEl) {
  if (!targetEl || !window.Plotly?.Fx?.unhover) return;
  if (hoverSyncRafId) {
    cancelAnimationFrame(hoverSyncRafId);
    hoverSyncRafId = 0;
  }
  pendingHoverSync = null;
  lastHoverSyncKey = "";
  hoverSyncing = true;
  try {
    Plotly.Fx.unhover(targetEl);
  } catch (_) {
    // no-op
  }
  requestAnimationFrame(() => { hoverSyncing = false; });
}

function ensureCursorLine(el) {
  if (!el) return null;
  let line = el.querySelector(`.${CURSOR_LINE_CLASS}`);
  if (!line) {
    line = document.createElement("div");
    line.className = CURSOR_LINE_CLASS;
    el.appendChild(line);
  }
  return line;
}

function hideCursorLine(el) {
  const line = ensureCursorLine(el);
  if (!line) return;
  line.style.opacity = "0";
}

function toLocalXFromValue(el, xValue) {
  const xa = el?._fullLayout?.xaxis;
  if (!xa) return null;
  let plotX = null;
  try {
    if (typeof xa.d2p === "function") plotX = xa.d2p(xValue);
    else if (typeof xa.r2p === "function") plotX = xa.r2p(xValue);
  } catch (_) {
    plotX = null;
  }
  if (!Number.isFinite(plotX)) return null;
  const localX = xa._offset + plotX;
  if (!Number.isFinite(localX)) return null;
  return localX;
}

function showCursorLine(el, localX) {
  const line = ensureCursorLine(el);
  const xa = el?._fullLayout?.xaxis;
  if (!line || !xa || !Number.isFinite(localX)) return hideCursorLine(el);
  const minX = xa._offset;
  const maxX = xa._offset + xa._length;
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || localX < minX || localX > maxX) return hideCursorLine(el);
  line.style.opacity = "1";
  line.style.transform = `translateX(${localX.toFixed(2)}px)`;
}

function applySyncedCursor(xValue, sourceEl, sourceClientX, sourceLocalX = null) {
  const mainEl = document.getElementById("chart");
  const macdEl = document.getElementById("chart-macd");
  const adrEl = document.getElementById("chart-adr");
  const targets = [mainEl, macdEl, adrEl].filter((el) => el && !el.hidden);
  if (!targets.length) return;
  if (xValue == null) {
    targets.forEach((el) => hideCursorLine(el));
    return;
  }
  targets.forEach((el) => {
    if (!el?._fullLayout?.xaxis) {
      hideCursorLine(el);
      return;
    }
    if (el === sourceEl && Number.isFinite(sourceLocalX)) {
      showCursorLine(el, sourceLocalX);
      return;
    }
    if (el === sourceEl && Number.isFinite(sourceClientX)) {
      const rect = el.getBoundingClientRect();
      showCursorLine(el, sourceClientX - rect.left);
      return;
    }
    showCursorLine(el, toLocalXFromValue(el, xValue));
  });
}

function scheduleSyncedCursor(xValue, sourceEl, sourceClientX, sourceLocalX = null) {
  pendingCursorState = { xValue, sourceEl, sourceClientX, sourceLocalX };
  if (cursorRafId) return;
  cursorRafId = requestAnimationFrame(() => {
    const pending = pendingCursorState;
    pendingCursorState = null;
    cursorRafId = 0;
    if (!pending) return;
    applySyncedCursor(pending.xValue, pending.sourceEl, pending.sourceClientX, pending.sourceLocalX);
  });
}

function clearTouchDoubleTapZoomState() {
  touchDoubleTapZoomActive = false;
  touchDoubleTapPrevRange = null;
}
function getCurrentXRangeMs(sourceEl) {
  const el = sourceEl || document.getElementById("chart");
  const range = el?._fullLayout?.xaxis?.range;
  if (!Array.isArray(range) || range.length < 2) return null;
  const r0 = toMsSafe(range[0]);
  const r1 = toMsSafe(range[1]);
  if (!Number.isFinite(r0) || !Number.isFinite(r1) || r1 <= r0) return null;
  return [r0, r1];
}

function applySyncedXRangeMs(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;

  const mainEl = document.getElementById("chart");
  const macdEl = document.getElementById("chart-macd");
  const adrEl = document.getElementById("chart-adr");
  const r0 = new Date(startMs).toISOString();
  const r1 = new Date(endMs).toISOString();

  pinnedXRange = [r0, r1];
  chartSyncing = true;

  const tasks = [];
  if (mainEl?.data) {
    tasks.push(Plotly.relayout(mainEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }));
  }
  if (macdEl?.data && !macdEl.hidden) {
    tasks.push(Plotly.relayout(macdEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }));
  }
  if (adrEl?.data) {
    tasks.push(Plotly.relayout(adrEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }));
  }

  Promise.allSettled(tasks).finally(() => {
    chartSyncing = false;
  });
}

function scheduleHandleUpdate(delay = HANDLE_UPDATE_DEBOUNCE_MS) {
  if (handleUpdateTimer) clearTimeout(handleUpdateTimer);
  handleUpdateTimer = setTimeout(() => {
    handleUpdateTimer = 0;
    updateHandles();
  }, delay);
}

function scheduleViewportRangeSync(targetEl, payload) {
  if (!targetEl?.data || !payload) return;
  pendingViewportSync.set(targetEl.id || String(pendingViewportSync.size), { targetEl, payload });
  if (viewportSyncTimer) clearTimeout(viewportSyncTimer);
  viewportSyncTimer = setTimeout(() => {
    const pending = [...pendingViewportSync.values()];
    pendingViewportSync.clear();
    viewportSyncTimer = 0;
    const tasks = pending.map(({ targetEl: el, payload: nextPayload }) => {
      if (!el?.data) return null;
      const r0 = nextPayload["xaxis.range[0]"];
      const r1 = nextPayload["xaxis.range[1]"];
      if (r0 != null && r1 != null && xRangeMatches(el, r0, r1)) return null;
      try {
        return Promise.resolve(Plotly.relayout(el, nextPayload))
          .catch(() => {})
          .finally(() => {
            if (el.id === "chart") scheduleHandleUpdate(40);
          });
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
    if (!tasks.length) return;

    chartSyncing = true;
    Promise.allSettled(tasks)
      .finally(() => {
        chartSyncing = false;
      });
  }, VIEWPORT_SYNC_DEBOUNCE_MS);
}

function zoomAroundClientX(sourceEl, clientX, zoomFactor = 0.5) {
  const xValue = axisPixelToXValue(sourceEl, clientX, true);
  const centerMs = toMsSafe(xValue);
  if (!Number.isFinite(centerMs)) return false;

  const range = getCurrentXRangeMs(sourceEl);
  if (!range) return false;

  const [curStart, curEnd] = range;
  const span = curEnd - curStart;
  if (!Number.isFinite(span) || span <= 0) return false;

  const targetSpan = Math.max(span * zoomFactor, DAY_MS * 7);
  let startMs = centerMs - targetSpan / 2;
  let endMs = centerMs + targetSpan / 2;

  if (startMs < curStart) {
    endMs += (curStart - startMs);
    startMs = curStart;
  }
  if (endMs > curEnd) {
    startMs -= (endMs - curEnd);
    endMs = curEnd;
  }

  if (startMs < curStart) startMs = curStart;
  if (endMs > curEnd) endMs = curEnd;
  if (endMs <= startMs) return false;

  applySyncedXRangeMs(startMs, endMs);
  return true;
}

function ensureDragZoomOverlay(el) {
  if (!el) return null;
  let overlay = el.querySelector('.drag-zoom-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'drag-zoom-overlay';
    const box = document.createElement('div');
    box.className = 'drag-zoom-box';
    overlay.appendChild(box);
    el.appendChild(overlay);
  }
  const box = overlay.querySelector('.drag-zoom-box');
  return { overlay, box };
}

function hideDragZoomOverlay(el) {
  const ui = ensureDragZoomOverlay(el);
  if (!ui) return;
  ui.overlay.style.display = 'none';
  ui.box.style.width = '0px';
}

function renderDragZoomOverlay(el, startClientX, currentClientX) {
  const xa = el?._fullLayout?.xaxis;
  if (!xa || !Number.isFinite(startClientX) || !Number.isFinite(currentClientX)) return;

  const rect = el.getBoundingClientRect();
  const minClient = rect.left + xa._offset;
  const maxClient = minClient + xa._length;

  const sx = Math.max(minClient, Math.min(maxClient, startClientX));
  const cx = Math.max(minClient, Math.min(maxClient, currentClientX));

  const left = Math.min(sx, cx) - rect.left;
  const width = Math.max(1, Math.abs(cx - sx));

  const ui = ensureDragZoomOverlay(el);
  if (!ui) return;
  ui.overlay.style.display = 'block';
  ui.box.style.left = `${left}px`;
  ui.box.style.width = `${width}px`;
}

function findNearestLineDragTarget(el, clientX, clientY, isTouch = false, geometry = null) {
  const mainEl = document.getElementById("chart");
  if (!el || el !== mainEl || !el._fullLayout || !Array.isArray(el.data)) return null;

  const xa = geometry?.xa || el._fullLayout.xaxis;
  const ya = geometry?.ya || el._fullLayout.yaxis;
  if (!xa || !ya) return null;

  const rect = geometry?.rect || el.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const minX = xa._offset;
  const maxX = xa._offset + xa._length;
  const minY = ya._offset;
  const maxY = ya._offset + ya._length;
  if (localX < minX || localX > maxX || localY < minY || localY > maxY) return null;

  const xValue = axisPixelToXValue(el, clientX, false, geometry);
  const targetMs = toMsSafe(xValue);
  if (!Number.isFinite(targetMs)) return null;

  const tolerance = isTouch ? LINE_DRAG_TOUCH_TOLERANCE_PX : LINE_DRAG_TOLERANCE_PX;
  let index = lineHitIndexCache.get(el);
  if (!lineHitIndexMatches(index, el.data, currentSelected)) {
    index = buildLineHitIndex(el.data, currentSelected);
    lineHitIndexCache.set(el, index);
  }
  return findNearestLineTarget(index, targetMs, localY, ya, tolerance);
}

function getDisclosureMarkerPixelIndex(el, geometry = null) {
  if (!el?._fullLayout || !Array.isArray(el.data)) return null;
  const traceIndex = el.data.findIndex((trace) => trace?.meta?.isDisclosureTrace && trace.visible !== "legendonly");
  const trace = traceIndex >= 0 ? el.data[traceIndex] : null;
  const xAxis = el._fullLayout.xaxis;
  const yAxis = el._fullLayout.yaxis;
  if (!trace || !xAxis || !yAxis || typeof xAxis.d2p !== "function" || typeof yAxis.d2p !== "function") return null;

  const axisKey = [
    xAxis._offset,
    xAxis._length,
    ...(Array.isArray(xAxis.range) ? xAxis.range : []),
    yAxis._offset,
    yAxis._length,
    ...(Array.isArray(yAxis.range) ? yAxis.range : []),
  ].map((value) => String(value ?? "")).join("|");
  const cached = disclosureMarkerPixelCache.get(el);
  if (
    cached
    && cached.trace === trace
    && cached.xValues === trace.x
    && cached.yValues === trace.y
    && cached.axisKey === axisKey
  ) {
    return cached;
  }

  const pointCount = Math.min(
    Array.isArray(trace.x) ? trace.x.length : 0,
    Array.isArray(trace.y) ? trace.y.length : 0,
  );
  const chartRect = geometry?.rect || el.getBoundingClientRect();
  const textNodes = [...el.querySelectorAll(".textpoint text")]
    .filter((node) => node.textContent?.trim() === DISCLOSURE_ICON_TEXT);
  const points = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const x = Number(xAxis._offset || 0) + xAxis.d2p(trace.x[pointIndex]);
    let y = Number(yAxis._offset || 0) + yAxis.d2p(trace.y[pointIndex]);
    const textRect = textNodes[pointIndex]?.getBoundingClientRect?.();
    if (textRect?.height) y = textRect.top + textRect.height * 0.5 - chartRect.top;
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y, pointIndex });
  }
  points.sort((a, b) => a.x - b.x);

  const index = { trace, traceIndex, xValues: trace.x, yValues: trace.y, axisKey, points };
  disclosureMarkerPixelCache.set(el, index);
  return index;
}

function findDisclosureMarkerAtClientPoint(el, clientX, clientY, isTouch = false, geometry = null) {
  const markerIndex = getDisclosureMarkerPixelIndex(el, geometry);
  if (!markerIndex) return null;

  const rect = geometry?.rect || el.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const hitRadius = isTouch ? DISCLOSURE_TOUCH_HIT_RADIUS_PX : DISCLOSURE_MOUSE_HIT_RADIUS_PX;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  let low = 0;
  let high = markerIndex.points.length;
  const minX = localX - hitRadius;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (markerIndex.points[middle].x < minX) low = middle + 1;
    else high = middle;
  }

  for (let index = low; index < markerIndex.points.length; index += 1) {
    const point = markerIndex.points[index];
    if (point.x > localX + hitRadius) break;
    if (Math.abs(point.y - localY) > hitRadius) continue;
    const distance = Math.hypot(localX - point.x, localY - point.y);
    if (distance <= hitRadius && distance < bestDistance) {
      bestDistance = distance;
      best = { traceIndex: markerIndex.traceIndex, pointIndex: point.pointIndex };
    }
  }
  return best;
}

function openDisclosureMarkerHit(el, hit, sourceEvent) {
  const trace = el?.data?.[hit?.traceIndex];
  const raw = trace?.customdata?.[hit?.pointIndex]?.[0];
  if (!raw) return false;
  try {
    const group = disclosureGroupStore.get(raw) || JSON.parse(raw);
    showDisclosurePopover(group, sourceEvent);
    return true;
  } catch (_) {
    return false;
  }
}

function getTraceBaseLineWidth(trace) {
  const metaWidth = toNum(trace?.meta?.baseLineWidth);
  if (metaWidth !== null) return metaWidth;
  const lineWidth = toNum(trace?.line?.width);
  return lineWidth !== null ? lineWidth : 2;
}

function getTraceLinePaths(el, traceIndex) {
  if (!el || !Number.isInteger(traceIndex)) return [];
  const groups = [...el.querySelectorAll(".scatterlayer .trace.scatter")];
  const uid = String(el._fullData?.[traceIndex]?.uid || el.data?.[traceIndex]?.uid || "");
  const group = (uid ? groups.find((node) => node.classList.contains(`trace${uid}`)) : null)
    || groups[traceIndex]
    || null;
  return group ? [...group.querySelectorAll(".js-line")] : [];
}

function setTraceLineHighlighted(el, traceIndex, highlighted) {
  if (!el?.data || traceIndex == null || traceIndex < 0 || traceIndex >= el.data.length) return;
  const trace = el.data[traceIndex];
  if (!trace || trace.visible === "legendonly") return;
  const baseWidth = getTraceBaseLineWidth(trace);
  const nextWidth = highlighted ? baseWidth + LINE_HIGHLIGHT_EXTRA_WIDTH : baseWidth;
  const paths = getTraceLinePaths(el, traceIndex);
  paths.forEach((path) => {
    path.style.strokeWidth = `${nextWidth}px`;
    path.setAttribute("stroke-width", String(nextWidth));
  });
  if (paths.length) lineHighlightDomUpdateCount += 1;
}

function refreshLineHighlight() {
  const el = document.getElementById("chart");
  if (!el?.data) return;

  const nextIndex = activeLineTraceIndex ?? hoveredLineTraceIndex;
  if (appliedLineHighlightTraceIndex === nextIndex) return;

  const prevIndex = appliedLineHighlightTraceIndex;
  appliedLineHighlightTraceIndex = nextIndex;

  if (prevIndex != null && prevIndex !== nextIndex) {
    setTraceLineHighlighted(el, prevIndex, false);
  }
  if (nextIndex != null) {
    setTraceLineHighlighted(el, nextIndex, true);
  }

  el.classList.toggle("is-line-hovering", nextIndex != null);
}

function setHoveredLineTarget(target) {
  const nextIndex = target?.traceIndex ?? null;
  if (hoveredLineTraceIndex === nextIndex) return;
  hoveredLineTraceIndex = nextIndex;
  refreshLineHighlight();
}

function setActiveLineTarget(target) {
  const nextIndex = target?.traceIndex ?? null;
  if (activeLineTraceIndex === nextIndex) return;
  activeLineTraceIndex = nextIndex;
  refreshLineHighlight();
}

function beginLineOffsetDrag(el, target, startClientY, pointerId) {
  const ya = el?._fullLayout?.yaxis;
  const range = ya?.range;
  if (!target || !ya || !Array.isArray(range) || range.length < 2 || !ya._length) return false;

  const startOffset = seriesOffsets[target.seriesKey] || 0;
  const lockedXRange = getCurrentMainXRange();
  let moved = false;

  suppressPlotlyClickUntil = Date.now() + 500;
  isHandleDragging = true;
  setActiveLineTarget(target);
  el.classList.add("is-line-dragging");
  hideDragZoomOverlay(el);
  lockCurrentYAxisRange();

  function onMove(clientY) {
    const dy = clientY - startClientY;
    if (Math.abs(dy) >= 3) moved = true;
    const dataDelta = -dy * (range[1] - range[0]) / ya._length;
    seriesOffsets[target.seriesKey] = startOffset + dataDelta;
    restyleLive(target.traceIndex, target.seriesKey);
  }

  function onEnd(clientY) {
    el.classList.remove("is-line-dragging");
    isHandleDragging = false;
    setActiveLineTarget(null);
    if (lockedXRange) pinnedXRange = [...lockedXRange];
    if (!moved || Math.abs(clientY - startClientY) < 3) {
      seriesOffsets[target.seriesKey] = startOffset;
      restyleLive(target.traceIndex, target.seriesKey);
      finishTraceYEdit(false, target.seriesKey);
      return;
    }
    finishTraceYEdit(true, target.seriesKey);
  }

  addDragListeners(pointerId, onMove, onEnd);
  return true;
}

function bindCursorMoveSync() {
  const mainEl = document.getElementById("chart");
  const macdEl = document.getElementById("chart-macd");
  const adrEl = document.getElementById("chart-adr");
  let disclosurePointerDown = null;
  if (!mainEl || !adrEl) return;
  ensureCursorLine(mainEl);
  ensureCursorLine(adrEl);
  ensureDragZoomOverlay(mainEl);
  ensureDragZoomOverlay(adrEl);
  if (cursorMoveBound && dragZoomBound) return;

  let touchStartPoint = null;
  let dragState = null;

  const latestPointerSample = (event) => {
    const samples = typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : null;
    return samples?.length ? samples[samples.length - 1] : event;
  };

  const moveAt = (sourceEl, clientX, geometry = null) => {
    const xValue = axisPixelToXValue(sourceEl, clientX, false, geometry);
    if (xValue == null) {
      scheduleSyncedCursor(null);
      return;
    }
    const sourceLocalX = geometry?.rect ? clientX - geometry.rect.left : null;
    scheduleSyncedCursor(xValue, sourceEl, clientX, sourceLocalX);
  };

  const processPointerMove = ({
    sourceEl,
    clientX,
    clientY,
    geometry,
    runHitTest,
  }) => {
    const perfStartedAt = startPerfSample();
    if (runHitTest && !isViewportDragging) {
      const disclosureTarget = findDisclosureMarkerAtClientPoint(
        sourceEl,
        clientX,
        clientY,
        false,
        geometry,
      );
      sourceEl.classList.toggle("is-disclosure-hovering", Boolean(disclosureTarget));
      if (!hoverShowPopup) {
        if (disclosureTarget) {
          const trace = sourceEl.data?.[disclosureTarget.traceIndex];
          scheduleDisclosureHoverHighlight({
            points: [{
              curveNumber: disclosureTarget.traceIndex,
              pointIndex: disclosureTarget.pointIndex,
              pointNumber: disclosureTarget.pointIndex,
              data: trace,
            }],
          });
        } else {
          resetDisclosureHoverHighlight(sourceEl);
        }
      }
      const lineTarget = disclosureTarget
        ? null
        : findNearestLineDragTarget(sourceEl, clientX, clientY, false, geometry);
      setHoveredLineTarget(lineTarget);
    }
    moveAt(sourceEl, clientX, geometry);
    if (perfStartedAt) recordPerfSample("pointerMove", perfStartedAt, { chart: sourceEl.id || "unknown" });
  };

  pointerMoveController = createPointerFrameController(window, {
    geometryTtlMs: CHART_GEOMETRY_CACHE_MS,
    hitTestIntervalMs: LINE_HIT_TEST_INTERVAL_MS,
    readGeometry: getChartInteractionGeometry,
    processFrame: processPointerMove,
  });

  const schedulePointerMove = (sourceEl, clientX, clientY, findLineTarget) => {
    pointerMoveController.schedule({ sourceEl, clientX, clientY, findLineTarget });
  };

  const onLeave = () => {
    if (isHandleDragging || isViewportDragging) return;
    pointerMoveController.cancel();
    setHoveredLineTarget(null);
    mainEl.classList.remove("is-disclosure-hovering");
    resetDisclosureHoverHighlight(mainEl);
    scheduleSyncedCursor(null);
    clearHoverOnChart(mainEl);
    clearHoverOnChart(macdEl);
    clearHoverOnChart(adrEl);
  };

  const invalidatePointerGeometry = () => pointerMoveController?.invalidate();
  window.addEventListener("resize", invalidatePointerGeometry, { passive: true });
  window.addEventListener("scroll", invalidatePointerGeometry, { passive: true });

  const onDisclosurePriorityClick = (event) => {
    if (event.target instanceof Element && event.target.closest(".disclosure-popover")) return;
    const hit = findDisclosureMarkerAtClientPoint(mainEl, event.clientX, event.clientY, isTouchDevice());
    const now = Date.now();
    const directPress = Boolean(
      hit
      && disclosurePointerDown
      && now - disclosurePointerDown.at <= 800
      && disclosurePointerDown.traceIndex === hit.traceIndex
      && disclosurePointerDown.pointIndex === hit.pointIndex
    );
    disclosurePointerDown = null;
    if (!hit) {
      hideDisclosurePopover();
      return;
    }
    if (now < suppressPlotlyClickUntil && !directPress) return;
    if (!openDisclosureMarkerHit(mainEl, hit, event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const stopViewportDrag = (upEvent, cancelled = false) => {
    const st = dragState;
    if (!st || upEvent.pointerId !== st.pointerId) return;
    dragState = null;
    isViewportDragging = false;
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
    try { st.sourceEl.releasePointerCapture?.(st.pointerId); } catch (_) {}
    hideDragZoomOverlay(st.sourceEl);
    if (cancelled || !st.moved) return;
    suppressPlotlyClickUntil = Date.now() + 700;

    const xStart = axisPixelToXValue(st.sourceEl, st.startClientX, true);
    const xEnd = axisPixelToXValue(st.sourceEl, upEvent.clientX, true);
    const ms0 = toMsSafe(xStart);
    const ms1 = toMsSafe(xEnd);
    if (!Number.isFinite(ms0) || !Number.isFinite(ms1)) return;
    const startMs = Math.min(ms0, ms1);
    const endMs = Math.max(ms0, ms1);
    if ((endMs - startMs) < DAY_MS) return;
    applySyncedXRangeMs(startMs, endMs);
    clearTouchDoubleTapZoomState();
  };

  const onWindowPointerMove = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const sample = latestPointerSample(event);
    const delta = Math.abs(sample.clientX - dragState.startClientX);
    if (delta >= 3 && !dragState.moved) {
      dragState.moved = true;
      suppressPlotlyClickUntil = Date.now() + 700;
      resetDisclosureHoverHighlight(dragState.sourceEl);
    }
    renderDragZoomOverlay(dragState.sourceEl, dragState.startClientX, sample.clientX);
    const xValue = axisPixelToXValue(dragState.sourceEl, sample.clientX, true);
    if (xValue != null) scheduleSyncedCursor(xValue, dragState.sourceEl, sample.clientX);
  };
  const onWindowPointerUp = (event) => stopViewportDrag(event, false);
  const onWindowPointerCancel = (event) => stopViewportDrag(event, true);

  const onPointerDown = (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (event.target instanceof Element
      && event.target.closest(".disclosure-popover, .y-handle, .legend, .modebar-container")) return;
    const sourceEl = event.currentTarget;
    const xa = sourceEl?._fullLayout?.xaxis;
    if (!xa) return;
    const isTouch = event.pointerType === "touch";
    const geometry = getChartInteractionGeometry(sourceEl);
    disclosurePointerDown = null;
    if (isTouch) touchStartPoint = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };

    const disclosureTarget = findDisclosureMarkerAtClientPoint(
      sourceEl,
      event.clientX,
      event.clientY,
      isTouch,
      geometry,
    );
    if (disclosureTarget) {
      disclosurePointerDown = { ...disclosureTarget, at: Date.now() };
      setHoveredLineTarget(null);
      clearTouchDoubleTapZoomState();
      return;
    }

    const lineTarget = findNearestLineDragTarget(
      sourceEl,
      event.clientX,
      event.clientY,
      isTouch,
      geometry,
    );
    if (lineTarget && beginLineOffsetDrag(sourceEl, lineTarget, event.clientY, event.pointerId)) {
      event.preventDefault();
      event.stopPropagation();
      setHoveredLineTarget(lineTarget);
      lastTouchTapAt = 0;
      lastTouchTapX = null;
      lastTouchTapEl = null;
      clearTouchDoubleTapZoomState();
      return;
    }

    setHoveredLineTarget(null);
    if (isTouch) {
      hideDisclosurePopover();
      event.preventDefault();
      moveAt(sourceEl, event.clientX, geometry);
      const now = Date.now();
      const sameTarget = lastTouchTapEl === sourceEl;
      const nearX = Number.isFinite(lastTouchTapX) ? Math.abs(lastTouchTapX - event.clientX) <= 28 : false;
      const isDoubleTap = sameTarget && nearX && (now - lastTouchTapAt) <= 320;
      if (isDoubleTap) {
        if (touchDoubleTapZoomActive
          && Array.isArray(touchDoubleTapPrevRange)
          && touchDoubleTapPrevRange.length === 2) {
          applySyncedXRangeMs(touchDoubleTapPrevRange[0], touchDoubleTapPrevRange[1]);
          clearTouchDoubleTapZoomState();
        } else {
          const currentRange = getCurrentXRangeMs(sourceEl);
          if (Array.isArray(currentRange) && currentRange.length === 2) {
            touchDoubleTapPrevRange = [currentRange[0], currentRange[1]];
            if (zoomAroundClientX(sourceEl, event.clientX, 0.5)) touchDoubleTapZoomActive = true;
          }
        }
        lastTouchTapAt = 0;
        lastTouchTapX = null;
        lastTouchTapEl = null;
        return;
      }
      lastTouchTapAt = now;
      lastTouchTapX = event.clientX;
      lastTouchTapEl = sourceEl;
      return;
    }

    if (event.pointerType !== "mouse") return;
    dragState = {
      sourceEl,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      moved: false,
    };
    isViewportDragging = true;
    renderDragZoomOverlay(sourceEl, event.clientX, event.clientX);
    try { sourceEl.setPointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
    window.addEventListener("pointermove", onWindowPointerMove, { passive: true });
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
  };

  const onPointerMove = (event) => {
    if (!event.isPrimary || isHandleDragging || isViewportDragging) return;
    if (event.target instanceof Element
      && event.target.closest(".disclosure-popover, .legend, .modebar-container")) return;
    const sample = latestPointerSample(event);
    if (event.pointerType === "touch") {
      event.preventDefault();
      if (touchStartPoint?.pointerId === event.pointerId && Math.hypot(
        sample.clientX - touchStartPoint.x,
        sample.clientY - touchStartPoint.y,
      ) > 8) {
        suppressPlotlyClickUntil = Date.now() + 500;
      }
      schedulePointerMove(event.currentTarget, sample.clientX, sample.clientY, false);
      return;
    }
    schedulePointerMove(
      event.currentTarget,
      sample.clientX,
      sample.clientY,
      event.currentTarget === mainEl,
    );
  };

  const onPointerEnd = (event) => {
    if (event.pointerType !== "touch" || touchStartPoint?.pointerId !== event.pointerId) return;
    touchStartPoint = null;
    setHoveredLineTarget(null);
    onLeave();
  };

  [mainEl, macdEl, adrEl].filter(Boolean).forEach((chartEl) => {
    chartEl.addEventListener("pointerdown", onPointerDown, { passive: false });
    chartEl.addEventListener("pointermove", onPointerMove, { passive: false });
    chartEl.addEventListener("pointerleave", onLeave);
    chartEl.addEventListener("pointerup", onPointerEnd);
    chartEl.addEventListener("pointercancel", onPointerEnd);
  });
  mainEl.addEventListener("click", onDisclosurePriorityClick, true);
  cursorMoveBound = true;
  dragZoomBound = true;
}


const dataPayloadUtils = window.ThinkStockDataPayload;
if (!dataPayloadUtils) throw new Error("ThinkStock data payload module is unavailable");
const {
  normalizePayloadRecords,
  rowsFromColumnarPayload,
  parsePayloadText,
  parseMacroPayload,
  normalizeDisclosureRows: normalizeDisclosureSeedRows,
} = dataPayloadUtils;

function getSeriesPriorityOrder() {
  const customOrder = customStocks.map((item) => item.ticker);
  return [
    ...CORE_SERIES,
    ...customOrder,
    ...SUPPLEMENTAL_SERIES,
  ];
}

function sortSeries(list) {
  const priorityOrder = getSeriesPriorityOrder();
  const pri = new Map(priorityOrder.map((name, idx) => [name, idx]));
  return [...list].sort((a, b) => {
    const ar = pri.has(a) ? pri.get(a) : priorityOrder.length + 1;
    const br = pri.has(b) ? pri.get(b) : priorityOrder.length + 1;
    return ar !== br ? ar - br : labelName(a).localeCompare(labelName(b), "ko");
  });
}

/* Dense macro interpolation (for daily data) */

function syncSeriesToggleBoard(allSeries) {
  const available = new Set(allSeries || []);
  document.querySelectorAll(".series-toggle-btn").forEach((btn) => {
    const key = btn.dataset.series;
    btn.style.setProperty("--series-color", seriesColor(key));
    const isAvailable = available.has(key);
    const isVisible = isAvailable && !hiddenSeries.has(key);
    btn.disabled = !isAvailable;
    btn.classList.toggle("is-disabled", !isAvailable);
    btn.classList.toggle("is-on", isVisible);
    btn.classList.toggle("is-off", isAvailable && !isVisible);
  });
}

function applySeriesVisibilityFast(seriesKey) {
  if (!window.Plotly) return false;
  const el = document.getElementById("chart");
  const traceIndex = currentSelected.indexOf(seriesKey);
  if (!el?.data || traceIndex < 0 || traceIndex >= el.data.length) return false;
  if (showAiForecast) {
    syncSeriesToggleBoard(currentSelected);
    requestChartRender();
    return true;
  }

  Plotly.restyle(el, { visible: hiddenSeries.has(seriesKey) ? "legendonly" : true }, [traceIndex])
    .then(() => {
      if (showDisclosures && !refreshDisclosureTraceFast()) {
        requestChartRender();
        return;
      }
      updateHandles();
      if (showMacdOscillator) {
        lastMacdRenderKey = "";
        renderMacdChart(el._fullLayout?.xaxis?.range?.slice() || null).catch(() => {});
      }
      scheduleLastRuntimeSnapshotSave();
    })
    .catch(() => requestChartRender());
  syncSeriesToggleBoard(currentSelected);
  return true;
}

function bindSeriesToggleBoard() {
  document.querySelectorAll(".series-toggle-btn").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const key = btn.dataset.series;
      if (!key || btn.disabled) return;
      if (hiddenSeries.has(key)) hiddenSeries.delete(key);
      else hiddenSeries.add(key);
      saveState();
      if (!applySeriesVisibilityFast(key)) requestChartRender();
    });
  });
}

function renderCustomStockButtons() {
  const container = document.getElementById("customStockButtons");
  if (!container) return;
  container.innerHTML = customStocks.map((item) => {
    const ticker = item.ticker;
    const name = item.name;
    const color = seriesColor(ticker);
    return `
      <div class="custom-stock-chip" data-custom-series="${escapeHtml(ticker)}">
        <button class="series-toggle-btn custom-stock-toggle-btn" data-series="${escapeHtml(ticker)}" style="--series-color:${escapeHtml(color)}">${escapeHtml(name)}</button>
        <button class="stock-remove-btn" type="button" data-remove-series="${escapeHtml(ticker)}" aria-label="${escapeHtml(name)} remove">-</button>
      </div>
    `;
  }).join("");
  bindSeriesToggleBoard();
  bindCustomStockRemoveButtons();
}

function bindCustomStockRemoveButtons() {
  document.querySelectorAll(".stock-remove-btn").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ticker = btn.dataset.removeSeries;
      if (!ticker) return;
      removeCustomStock(ticker);
    });
  });
}

function removeCustomStock(ticker) {
  const before = customStocks.length;
  customStocks = customStocks.filter((item) => item.ticker !== ticker);
  if (customStocks.length === before) return;
  hiddenSeries.delete(ticker);
  delete seriesOffsets[ticker];
  delete seriesScales[ticker];
  delete DISPLAY_NAMES[ticker];
  loadingCustomStocks.delete(ticker);
  clearTickerSeriesFromPricePayload(ticker);
  renderCustomStockButtons();
  saveState();
  requestChartRender(false);
}

function clearTickerSeriesFromPricePayload(ticker) {
  if (!ticker || !pricePayload || typeof pricePayload !== "object") return;

  if (Array.isArray(pricePayload.records)) {
    pricePayload.records.forEach((row) => {
      if (row && typeof row === "object") delete row[ticker];
    });
  }
  if (pricePayload.columns && typeof pricePayload.columns === "object") {
    delete pricePayload.columns[ticker];
  }

  if (Array.isArray(pricePayload.series)) {
    pricePayload.series = pricePayload.series.filter((key) => key !== ticker);
  }

  if (pricePayload.display_names && typeof pricePayload.display_names === "object") {
    delete pricePayload.display_names[ticker];
  }
  markDataChanged("price");
}

let krxUniversePromise = null;

function resetKrxUniverseCache() {
  krxUniverse = [];
  krxUniverseLoaded = false;
  krxUniverseLoading = false;
  krxUniversePromise = null;
}

async function ensureKrxUniverseLoaded() {
  if (krxUniverseLoaded && krxUniverse.length) return;
  if (krxUniversePromise) {
    await krxUniversePromise;
    return;
  }

  krxUniverseLoading = true;
  krxUniversePromise = (async () => {
    const payload = await fetchJsonWithProxyFallback(
      appendCacheBust("./data/krx_universe.json"),
      { cache: "no-store" },
      { allowProxy: false },
    );
    const records = Array.isArray(payload?.records) ? payload.records : [];
    krxUniverse = records.filter((item) => (
      /^[0-9]{6}\.(KS|KQ)$/.test(String(item?.ticker || ""))
      && String(item?.name || "").trim()
    )).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    if (!krxUniverse.length) throw new Error("서버 종목 목록이 아직 준비되지 않았습니다.");
    krxUniverseLoaded = true;
  })().finally(() => {
    krxUniverseLoading = false;
    krxUniversePromise = null;
  });

  await krxUniversePromise;
}

function filterKrxUniverse(keyword) {
  const q = String(keyword || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return [];

  const scored = [];
  krxUniverse.forEach((item) => {
    const name = item.name.toLowerCase().replace(/\s+/g, "");
    const code = item.code.toLowerCase();
    const ticker = item.ticker.toLowerCase();

    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (code.startsWith(q)) score = 2;
    else if (code.includes(q) || ticker.includes(q)) score = 3;
    if (score < 0) return;

    scored.push({ item, score });
  });

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.item.name.localeCompare(b.item.name, "ko");
  });

  return scored.slice(0, 12).map((entry) => entry.item);
}

function hideStockSuggestList() {
  const listEl = document.getElementById("stockSuggestList");
  if (!listEl) return;
  listEl.hidden = true;
  listEl.innerHTML = "";
  stockSuggestItems = [];
  stockSuggestActiveIndex = -1;
}

function setStockSuggestActiveIndex(index) {
  const listEl = document.getElementById("stockSuggestList");
  const maxIndex = stockSuggestItems.length - 1;
  if (!listEl || maxIndex < 0) {
    stockSuggestActiveIndex = -1;
    return;
  }

  let next = Number(index);
  if (!Number.isFinite(next)) next = -1;
  if (next < -1) next = -1;
  if (next > maxIndex) next = maxIndex;
  stockSuggestActiveIndex = next;

  const nodes = listEl.querySelectorAll(".stock-suggest-item");
  nodes.forEach((node, nodeIndex) => {
    const isActive = nodeIndex === stockSuggestActiveIndex;
    node.classList.toggle("is-active", isActive);
    node.setAttribute("aria-selected", isActive ? "true" : "false");
    if (isActive) node.scrollIntoView({ block: "nearest" });
  });
}

function renderStockSuggestList(items) {
  const listEl = document.getElementById("stockSuggestList");
  if (!listEl) return;
  stockSuggestItems = Array.isArray(items) ? items : [];
  stockSuggestActiveIndex = -1;

  if (!stockSuggestItems.length) {
    listEl.hidden = true;
    listEl.innerHTML = "";
    return;
  }

  listEl.innerHTML = stockSuggestItems.map((item, idx) => `
    <button type="button" class="stock-suggest-item" data-suggest-idx="${idx}" aria-selected="false">
      <span class="stock-suggest-name">${escapeHtml(item.name)}</span>
      <span class="stock-suggest-meta">${escapeHtml(item.code)} / ${escapeHtml(item.market)}</span>
    </button>
  `).join("");
  listEl.hidden = false;
}

function mergeTickerSeriesIntoPricePayload(ticker, points) {
  const byDate = new Map();
  (pricePayload?.records || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    byDate.set(date, { ...row });
  });

  points.forEach(({ date, close }) => {
    if (!date || !Number.isFinite(close)) return;
    const prev = byDate.get(date) || { date };
    prev[ticker] = close;
    byDate.set(date, prev);
  });

  const merged = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!pricePayload) pricePayload = {};
  pricePayload.records = merged;

  if (!Array.isArray(pricePayload.series)) pricePayload.series = [];
  if (!pricePayload.series.includes(ticker)) pricePayload.series.push(ticker);

  if (!pricePayload.display_names || typeof pricePayload.display_names !== "object") {
    pricePayload.display_names = {};
  }
  if (DISPLAY_NAMES[ticker]) pricePayload.display_names[ticker] = DISPLAY_NAMES[ticker];
  markDataChanged("price");
}

function getLatestTickerDateFromPricePayload(ticker) {
  let latest = "";
  (pricePayload?.records || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const value = toNum(row?.[ticker]);
    if (!date || value === null) return;
    if (!latest || date > latest) latest = date;
  });
  return latest;
}

function getTickerPricePointsFromPayload(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  return normalizeTickerPricePoints((pricePayload?.records || []).map((row) => ({
    date: row?.date,
    close: row?.[key],
  })));
}

function isTickerPriceCacheFresh(latestDate) {
  const latest = String(latestDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) return false;
  return latest >= shiftDays(new Date().toISOString().slice(0, 10), -TICKER_PRICE_CACHE_FRESH_DAYS);
}

async function readTickerPriceCache(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  if (!key) return null;
  try {
    const record = await readIndexedDbRecord(TICKER_PRICE_CACHE_STORE_NAME, key);
    if (!record || record.schema !== GRANULAR_CACHE_SCHEMA_VERSION || record.ticker !== key) return null;
    const points = normalizeTickerPricePoints(record.points);
    if (!points.length) return null;
    const nextRecord = {
      ...record,
      points,
      lastAccessed: Date.now(),
    };
    writeIndexedDbRecord(TICKER_PRICE_CACHE_STORE_NAME, key, nextRecord).catch(() => {});
    return nextRecord;
  } catch (_) {
    return null;
  }
}

async function writeTickerPriceCache(ticker, points, displayName = "") {
  const key = String(ticker || "").trim().toUpperCase();
  const normalized = normalizeTickerPricePoints(points);
  if (!key || !normalized.length) return false;
  const now = Date.now();
  const record = {
    schema: GRANULAR_CACHE_SCHEMA_VERSION,
    ticker: key,
    displayName: String(displayName || DISPLAY_NAMES[key] || key).trim(),
    savedAt: now,
    lastAccessed: now,
    latestDate: normalized[normalized.length - 1].date,
    points: normalized,
  };
  try {
    await writeIndexedDbRecord(TICKER_PRICE_CACHE_STORE_NAME, key, record);
    pruneGranularCacheStore(TICKER_PRICE_CACHE_STORE_NAME).catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

async function applyTickerPriceCache(ticker, displayName = "") {
  const key = String(ticker || "").trim().toUpperCase();
  const record = await readTickerPriceCache(key);
  if (!record) return { applied: false, count: 0, latestDate: "" };
  if (displayName || record.displayName) {
    DISPLAY_NAMES[key] = displayName || record.displayName;
  }
  mergeTickerSeriesIntoPricePayload(key, record.points);
  return {
    applied: true,
    count: record.points.length,
    latestDate: record.latestDate || record.points[record.points.length - 1]?.date || "",
  };
}

async function ensureCustomTickerSeriesLoaded(ticker, options = {}) {
  const key = String(ticker || "").trim().toUpperCase();
  const forceRefresh = Boolean(options?.forceRefresh);
  const displayName = String(options?.displayName || DISPLAY_NAMES[key] || "").trim();
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const cacheInfo = await applyTickerPriceCache(key, displayName);
  throwIfAborted(signal);
  const hasExisting = (pricePayload?.records || []).some((row) => toNum(row?.[key]) !== null);
  const latestExisting = cacheInfo.latestDate || getLatestTickerDateFromPricePayload(key);
  if (hasExisting && !forceRefresh && isTickerPriceCacheFresh(latestExisting)) return;

  try {
    const existingPoints = getTickerPricePointsFromPayload(key);
    const sinceDate = hasExisting ? getLatestTickerDateFromPricePayload(key) : "";
    let points = await fetchYahooHistorySeries(key, { sinceDate, signal });
    throwIfAborted(signal);
    if (!points.length) throw new Error(`${key} price history is empty`);
    const rebaseSignal = sinceDate ? findTickerPriceRebaseSignal(existingPoints, points, {
      ratioThreshold: PRICE_CACHE_REBASE_RATIO_THRESHOLD,
      boundaryDays: PRICE_CACHE_REBASE_BOUNDARY_DAYS,
    }) : null;
    if (rebaseSignal) {
      points = await fetchYahooHistorySeries(key, { signal });
      throwIfAborted(signal);
      if (!points.length) throw new Error(`${key} price history is empty`);
      await deleteIndexedDbRecord(TICKER_PRICE_CACHE_STORE_NAME, key).catch(() => {});
      clearTickerSeriesFromPricePayload(key);
    }
    throwIfAborted(signal);
    mergeTickerSeriesIntoPricePayload(key, points);
    await writeTickerPriceCache(key, getTickerPricePointsFromPayload(key), displayName);
  } catch (err) {
    if (hasExisting || cacheInfo.applied) return;
    throw err;
  }
}

async function refreshCoreIndexSeries(options = {}) {
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const tickers = ["^KS11", "^KQ11"];
  const beforeLatest = {};

  tickers.forEach((ticker) => {
    beforeLatest[ticker] = "";
  });

  (pricePayload?.records || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    tickers.forEach((ticker) => {
      const v = toNum(row?.[ticker]);
      if (v === null) return;
      if (!beforeLatest[ticker] || date > beforeLatest[ticker]) beforeLatest[ticker] = date;
    });
  });

  const applied = [];
  const warnings = [];

  const yahooResults = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const points = await fetchYahooHistorySeries(ticker, { sinceDate: beforeLatest[ticker], signal });
      if (!points.length) throw new Error("price history is empty");
      throwIfAborted(signal);
      mergeTickerSeriesIntoPricePayload(ticker, points);
      return { ticker, latestDate: points[points.length - 1]?.date || "" };
    }),
  );

  throwIfAborted(signal);
  yahooResults.forEach((result, idx) => {
    const ticker = tickers[idx];
    if (result.status === "fulfilled") {
      const latestDate = String(result.value?.latestDate || "");
      if (latestDate && latestDate !== beforeLatest[ticker]) {
        applied.push(`${labelName(ticker)} 반영(${latestDate})`);
      }
      return;
    }
    const reason = result.reason?.message || String(result.reason || "unknown error");
    warnings.push(`${labelName(ticker)} 갱신 오류: ${reason}`);
  });

  return { applied, warnings };
}

async function addCustomStock(candidate, msgEl) {
  if (!candidate?.ticker || !candidate?.name) return;

  if (customStocks.some((item) => item.ticker === candidate.ticker)) {
    setMessage(msgEl, ["이미 추가된 종목입니다."], true);
    return;
  }
  if (customStocks.length >= MAX_CUSTOM_STOCKS) {
    setMessage(msgEl, [`종목은 최대 ${MAX_CUSTOM_STOCKS}개까지 추가할 수 있습니다.`], true);
    return;
  }
  if (loadingCustomStocks.has(candidate.ticker)) return;

  loadingCustomStocks.add(candidate.ticker);
  try {
    DISPLAY_NAMES[candidate.ticker] = candidate.name;
    await ensureCustomTickerSeriesLoaded(candidate.ticker, { displayName: candidate.name });

    customStocks.push({
      ticker: candidate.ticker,
      name: candidate.name,
      code: candidate.code,
      market: candidate.market,
    });

    hiddenSeries.delete(candidate.ticker);
    renderCustomStockButtons();
    saveState();
    if (showAiForecast) requestAiAnalysisForTicker(candidate.ticker).catch(() => {});
    requestChartRender(false);
    setMessage(msgEl, [`${candidate.name} 종목이 추가되었습니다.`]);
    requestDartDisclosureRefreshForTicker(candidate.ticker, msgEl);
  } catch (err) {
    delete DISPLAY_NAMES[candidate.ticker];
    setMessage(msgEl, `종목 추가 중 오류가 발생했습니다: ${err.message}`, true);
  } finally {
    loadingCustomStocks.delete(candidate.ticker);
  }
}

function setupStockAddPanel(msgEl) {
  const inputEl = document.getElementById("stockSearchInput");
  const listEl = document.getElementById("stockSuggestList");
  if (!inputEl || !listEl) return;
  if (inputEl.dataset.bound === "1") return;
  inputEl.dataset.bound = "1";

  let searchSeq = 0;

  const refreshSuggest = async () => {
    const keyword = inputEl.value.trim();
    if (!keyword) {
      hideStockSuggestList();
      return;
    }

    const seq = ++searchSeq;
    try {
      await ensureKrxUniverseLoaded();
      if (seq !== searchSeq) return;
      const items = filterKrxUniverse(keyword);
      renderStockSuggestList(items);
    } catch (err) {
      if (seq !== searchSeq) return;
      hideStockSuggestList();
      setMessage(msgEl, `종목 검색 목록을 불러오지 못했습니다: ${err.message}`, true);
    }
  };

  const submitSuggestByIndex = (idx) => {
    const item = stockSuggestItems[idx];
    if (!item) return;
    addCustomStock(item, msgEl).finally(() => {
      inputEl.value = "";
      hideStockSuggestList();
    });
  };

  inputEl.addEventListener("input", () => {
    refreshSuggest();
  });

  inputEl.addEventListener("focus", () => {
    if (!inputEl.value.trim()) return;
    refreshSuggest();
  });

  inputEl.addEventListener("click", () => {
    if (!inputEl.value.trim()) return;
    if (!listEl.hidden) return;
    refreshSuggest();
  });

  inputEl.addEventListener("keydown", (event) => {
    const key = event.key;

    if (key === "ArrowDown") {
      if (!stockSuggestItems.length) return;
      event.preventDefault();
      const next = stockSuggestActiveIndex < 0
        ? 0
        : ((stockSuggestActiveIndex + 1) % stockSuggestItems.length);
      setStockSuggestActiveIndex(next);
      return;
    }

    if (key === "ArrowUp") {
      if (!stockSuggestItems.length) return;
      event.preventDefault();
      const next = stockSuggestActiveIndex < 0
        ? (stockSuggestItems.length - 1)
        : ((stockSuggestActiveIndex - 1 + stockSuggestItems.length) % stockSuggestItems.length);
      setStockSuggestActiveIndex(next);
      return;
    }

    if (key === "Escape") {
      hideStockSuggestList();
      return;
    }

    if (key !== "Enter") return;
    event.preventDefault();
    if (!stockSuggestItems.length) return;
    const pickIndex = stockSuggestActiveIndex >= 0 ? stockSuggestActiveIndex : 0;
    submitSuggestByIndex(pickIndex);
  });

  listEl.addEventListener("mousemove", (event) => {
    const btn = event.target.closest("[data-suggest-idx]");
    if (!btn) return;
    const idx = Number(btn.dataset.suggestIdx);
    if (!Number.isFinite(idx)) return;
    setStockSuggestActiveIndex(idx);
  });

  listEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-suggest-idx]");
    if (!btn) return;
    const idx = Number(btn.dataset.suggestIdx);
    if (!Number.isFinite(idx)) return;
    setStockSuggestActiveIndex(idx);
    submitSuggestByIndex(idx);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target === inputEl || listEl.contains(target)) return;
    hideStockSuggestList();
  });
}

async function preloadCustomStocks(options = {}) {
  if (!customStocks.length) return { failedNames: [] };

  const forceRefresh = Boolean(options?.forceRefresh);
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const items = [...customStocks];
  const perfStartedAt = startPerfSample();
  const results = await mapWithConcurrency(items, CUSTOM_STOCK_PRELOAD_CONCURRENCY, async (item) => {
    const hadExisting = (pricePayload?.records || []).some((row) => toNum(row?.[item.ticker]) !== null);
    try {
      await ensureCustomTickerSeriesLoaded(item.ticker, {
        forceRefresh,
        displayName: item.name,
        signal,
      });
      DISPLAY_NAMES[item.ticker] = item.name;
      return null;
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      // Keep ticker if older history exists and refresh fails.
      if (hadExisting) {
        DISPLAY_NAMES[item.ticker] = item.name;
        return null;
      }
      return { ticker: item.ticker, name: item.name || item.ticker };
    }
  });
  throwIfAborted(signal);
  const failedResults = results.filter(Boolean);
  const failed = failedResults.map((item) => item.ticker);
  const failedNames = failedResults.map((item) => item.name);
  recordPerfSample("preloadCustomStocks", perfStartedAt, {
    stocks: items.length,
    concurrency: CUSTOM_STOCK_PRELOAD_CONCURRENCY,
    failed: failed.length,
  });

  if (!failed.length) return { failedNames: [] };

  customStocks = customStocks.filter((item) => !failed.includes(item.ticker));
  failed.forEach((ticker) => {
    hiddenSeries.delete(ticker);
    delete seriesOffsets[ticker];
    delete seriesScales[ticker];
    delete DISPLAY_NAMES[ticker];
  });
  renderCustomStockButtons();
  saveState();
  return { failedNames };
}
function buildDenseMacroRows(sourceRows, targetDates) {
  const sorted = [...sourceRows].sort((a, b) => a.date.localeCompare(b.date));
  const cols = getSeriesColumns(sorted);
  if (!sorted.length || !targetDates.length || !cols.length) return sorted;
  const targets = targetDates.map((d) => ({ date: d, time: toUtcMs(d) }));
  const dense = targets.map(({ date }) => ({ date }));
  cols.forEach((col) => {
    const pts = sorted.map((r) => ({ time: toUtcMs(r.date), value: toNum(r[col]) })).filter((p) => p.value !== null).sort((a, b) => a.time - b.time);
    if (!pts.length) { targets.forEach((_, i) => { dense[i][col] = null; }); return; }
    let ptr = 0;
    targets.forEach(({ time }, i) => {
      if (time < pts[0].time || time > pts[pts.length - 1].time) { dense[i][col] = null; return; }
      while (ptr + 1 < pts.length && pts[ptr + 1].time < time) ptr += 1;
      const L = pts[ptr], R = pts[ptr + 1];
      if (!L) { dense[i][col] = null; return; }
      if (!R || L.time === time || L.time === R.time) { dense[i][col] = L.value; return; }
      if (R.time === time) { dense[i][col] = R.value; return; }
      const t = (time - L.time) / (R.time - L.time);
      dense[i][col] = L.value + (R.value - L.value) * t;
    });
  });
  return dense.filter((r) => cols.some((c) => toNum(r[c]) !== null));
}

let CREDIT_OFFSET_DAYS = 2;  // Fund-data publication-lag alignment in days (UI uses negative sign for display)
const CREDIT_COLS = ["customer_deposit", "kospi_credit", "kosdaq_credit"];

function dataRevisionSignature(...names) {
  const revisions = getDataRevisions();
  return names.map((name) => `${name}:${Number(revisions[name]) || 0}`).join("|");
}

function sortedObjectSignature(obj) {
  if (!obj || typeof obj !== "object") return "";
  return Object.keys(obj)
    .sort()
    .map((key) => `${key}:${obj[key]}`)
    .join("|");
}

function rejectChartModelWorkerRequests(error) {
  chartModelWorkerRequests.forEach(({ reject, timer }) => {
    clearTimeout(timer);
    reject(error);
  });
  chartModelWorkerRequests = new Map();
  chartModelWorkerQueuedRequests.forEach(({ reject }) => reject(error));
  chartModelWorkerQueuedRequests.clear();
  chartModelWorkerActiveId = "";
  chartModelWorkerDataKeys.clear();
}

function dispatchQueuedChartModelWorkerRequest() {
  if (chartModelWorkerActiveId || !chartModelWorkerQueuedRequests.size) return;
  const nextType = chartModelWorkerQueuedRequests.has("buildMainChartModel")
    ? "buildMainChartModel"
    : chartModelWorkerQueuedRequests.keys().next().value;
  const queued = chartModelWorkerQueuedRequests.get(nextType);
  chartModelWorkerQueuedRequests.delete(nextType);
  dispatchChartModelWorkerRequest(queued);
}

function ensureChartModelWorker() {
  if (chartModelWorker) return chartModelWorker;
  if (typeof Worker === "undefined") throw new Error("chart worker is unavailable");

  const workerUrl = `./modules/chart-model-worker.js?v=${encodeURIComponent(APP_BUILD_VERSION || "dev")}`;
  const worker = new Worker(workerUrl);
  worker.onmessage = (event) => {
    const message = event.data || {};
    const pending = chartModelWorkerRequests.get(message.id);
    if (!pending) return;
    chartModelWorkerRequests.delete(message.id);
    clearTimeout(pending.timer);
    if (chartModelWorkerActiveId === message.id) chartModelWorkerActiveId = "";
    if (message.ok) pending.resolve(message.result || {});
    else {
      chartModelWorkerDataKeys.delete(pending.type);
      pending.reject(new Error(message.error || "chart worker failed"));
    }
    dispatchQueuedChartModelWorkerRequest();
  };
  worker.onerror = (event) => {
    if (chartModelWorker !== worker) return;
    const error = new Error(event?.message || "chart worker failed");
    rejectChartModelWorkerRequests(error);
    try { worker.terminate(); } catch (_) {}
    if (chartModelWorker === worker) chartModelWorker = null;
  };
  chartModelWorker = worker;
  return worker;
}

function dispatchChartModelWorkerRequest(request) {
  let worker = null;
  try {
    worker = ensureChartModelWorker();
  } catch (error) {
    request.reject(error);
    return;
  }

  const requestType = request.type || "buildMainChartModel";
  const id = `chart-${requestType}-${Date.now()}-${++chartModelWorkerSeq}`;
  const { datasetKey, sources, ...config } = request.payload;
  const cacheSources = Boolean(datasetKey && sources);
  const includeSources = cacheSources && chartModelWorkerDataKeys.get(requestType) !== datasetKey;
  const workerPayload = cacheSources
    ? {
        ...config,
        datasetKey,
        ...(includeSources ? { sources } : {}),
      }
    : request.payload;
  if (includeSources) chartModelWorkerDataKeys.set(requestType, datasetKey);
  chartModelWorkerDispatchCount += 1;
  chartModelWorkerDispatchByType[requestType] = (
    Number(chartModelWorkerDispatchByType[requestType]) || 0
  ) + 1;
  if (includeSources) chartModelWorkerSourceTransferCount += 1;
  chartModelWorkerActiveId = id;

  const timer = setTimeout(() => {
    const pending = chartModelWorkerRequests.get(id);
    if (!pending) return;
    chartModelWorkerRequests.delete(id);
    if (chartModelWorkerActiveId === id) chartModelWorkerActiveId = "";
    chartModelWorkerDataKeys.clear();
    pending.reject(new Error("chart worker timeout"));
    try { worker.terminate(); } catch (_) {}
    if (chartModelWorker === worker) chartModelWorker = null;
    dispatchQueuedChartModelWorkerRequest();
  }, 10000);
  chartModelWorkerRequests.set(id, {
    resolve: request.resolve,
    reject: request.reject,
    timer,
    startedAt: performance.now(),
    type: requestType,
  });
  try {
    worker.postMessage({ id, type: requestType, payload: workerPayload });
  } catch (error) {
    clearTimeout(timer);
    chartModelWorkerRequests.delete(id);
    chartModelWorkerActiveId = "";
    chartModelWorkerDataKeys.delete(requestType);
    request.reject(error);
    dispatchQueuedChartModelWorkerRequest();
  }
}

function cancelStaleChartModelWorkerRequest() {
  const id = chartModelWorkerActiveId;
  const pending = id ? chartModelWorkerRequests.get(id) : null;
  if (!pending) return false;
  if (performance.now() - pending.startedAt < CHART_WORKER_STALE_CANCEL_MS) return false;

  clearTimeout(pending.timer);
  chartModelWorkerRequests.delete(id);
  chartModelWorkerActiveId = "";
  chartModelWorkerDataKeys.clear();
  chartModelWorkerSupersededCount += 1;
  pending.resolve(null);
  const worker = chartModelWorker;
  chartModelWorker = null;
  try { worker?.terminate(); } catch (_) {}
  return true;
}

function requestChartModelFromWorker(payload, type = "buildMainChartModel") {
  return new Promise((resolve, reject) => {
    const request = { type, payload, resolve, reject };
    if (chartModelWorkerActiveId) {
      const queued = chartModelWorkerQueuedRequests.get(type);
      if (queued) {
        chartModelWorkerSupersededCount += 1;
        queued.resolve(null);
      }
      chartModelWorkerQueuedRequests.set(type, request);
      if (cancelStaleChartModelWorkerRequest()) {
        chartModelWorkerQueuedRequests.delete(type);
        dispatchChartModelWorkerRequest(request);
      }
      return;
    }
    dispatchChartModelWorkerRequest(request);
  });
}

function getMainChartCalcCacheKey(priceRows, start, end, displayBudget) {
  return [
    start,
    end,
    activeMonths,
    CREDIT_OFFSET_DAYS,
    dataRevisionSignature("price", "macro", "credit"),
    customStocks.map((item) => item.ticker).join(","),
    [...hiddenSeries].sort().join(","),
    sortedObjectSignature(seriesOffsets),
    sortedObjectSignature(seriesScales),
    displayBudget,
  ].join("::");
}

function getChartModelDataKey(priceRows) {
  return dataRevisionSignature("price", "macro", "credit");
}

function buildMainChartModel(priceRows, start, end, allowedSeries) {
  const { rows, macroCols, liveCols } = mergeMarketDataSources({
    priceRows,
    macroRows,
    creditRows,
    creditCols: CREDIT_COLS,
    start,
    end,
  });
  const allSeries = sortSeries(
    [...new Set([...liveCols, ...macroCols])]
      .filter((s) => allowedSeries.has(s))
      .filter((s) => rows.some((r) => toNum(r[s]) !== null))
  );
  const selected = sortSeries(allSeries.filter((s) => !SUPPLEMENTAL_SERIES.includes(s)));
  if (!selected.length) {
    const fallback = sortSeries(allSeries);
    selected.push(...fallback.slice(0, 2));
  }

  const commonNormBases = {};
  const firstDates = selected.map((s) => {
    const r = rows.find((row) => toNum(row[s]) !== null);
    return r ? r.date : null;
  }).filter(Boolean);
  const commonBaseDate = firstDates.length ? firstDates.reduce((mx, d) => (d > mx ? d : mx)) : null;
  if (commonBaseDate) {
    selected.forEach((s) => {
      const r = rows.find((row) => row.date >= commonBaseDate && toNum(row[s]) !== null);
      commonNormBases[s] = r ? toNum(r[s]) : null;
    });
  }

  const visibleForAuto = selected.filter((s) => !hiddenSeries.has(s));
  const autoScales = autoFitScales(
    rows,
    visibleForAuto.length ? visibleForAuto : selected,
    commonNormBases,
  );
  const seriesModels = selected.map((series) => {
    const rawValues = rows.map((r) => toNum(r[series]));
    const rawTexts = rawValues.map((v) => formatActualValue(v));
    const baseLineWidth = macroCols.includes(series) ? 3 : 2;
    const xValues = CREDIT_COLS.includes(series) && CREDIT_OFFSET_DAYS
      ? rows.map((r) => shiftIsoDateByDays(r.date, -CREDIT_OFFSET_DAYS))
      : rows.map((r) => r.date);

    let values = [...rawValues];
    const base = commonNormBases[series];
    values = (base && base !== 0)
      ? values.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null))
      : normalizeSeries(values);
    values = centeredScale(values, series === "leading_cycle" ? 100 : (autoScales[series] || 100), true);
    const baseValues = values;

    const userScale = seriesScales[series] != null ? seriesScales[series] : defaultSeriesScale(series);
    if (userScale !== 1) {
      values = values.map((v) => (v !== null ? 100 + (v - 100) * userScale : null));
    }

    const offset = seriesOffsets[series] || 0;
    if (offset) values = values.map((v) => (v !== null ? v + offset : null));

    return { series, rawTexts, baseLineWidth, xValues, values, baseValues };
  });

  return { rows, allSeries, selected, seriesModels };
}

async function buildMainChartModelOffThread(priceRows, start, end, allowedSeries, displayBudget) {
  const result = await requestChartModelFromWorker({
    datasetKey: getChartModelDataKey(priceRows),
    sources: { priceRows, macroRows, creditRows },
    creditCols: [...CREDIT_COLS],
    creditOffsetDays: CREDIT_OFFSET_DAYS,
    start,
    end,
    allowedSeries: [...allowedSeries],
    priorityOrder: getSeriesPriorityOrder(),
    displayNames: { ...DISPLAY_NAMES },
    hiddenSeries: [...hiddenSeries],
    seriesOffsets: { ...seriesOffsets },
    seriesScales: { ...seriesScales },
    displayBudget,
  });
  if (!result) return null;
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const seriesModels = Array.isArray(result.seriesModels) ? result.seriesModels : [];
  if (!rows.length || !seriesModels.length) throw new Error("chart worker returned an empty model");
  return {
    rows,
    allSeries: Array.isArray(result.allSeries) ? result.allSeries : [],
    selected: Array.isArray(result.selected) ? result.selected : [],
    seriesModels,
    displayIndexes: Array.isArray(result.displayIndexes) ? result.displayIndexes : null,
  };
}

async function getMainChartModel(priceRows, start, end, allowedSeries, displayBudget) {
  const key = getMainChartCalcCacheKey(priceRows, start, end, displayBudget);
  if (mainChartCalcCache?.key === key) {
    lastMainChartModelCacheHit = true;
    return mainChartCalcCache.model;
  }
  if (mainChartCalcPending?.key === key) {
    lastMainChartModelCacheHit = true;
    return mainChartCalcPending.promise;
  }
  lastMainChartModelCacheHit = false;
  const promise = (async () => {
    let model = null;
    try {
      model = await buildMainChartModelOffThread(priceRows, start, end, allowedSeries, displayBudget);
      if (!model) return null;
      lastMainChartModelSource = "worker";
    } catch (_) {
      model = buildMainChartModel(priceRows, start, end, allowedSeries);
      lastMainChartModelSource = "sync";
      model.displayIndexes = buildMainChartDisplayIndexes(
        model.rows,
        model.seriesModels,
        model.selected,
        displayBudget,
      );
    }
    if (model) mainChartCalcCache = { key, model };
    return model;
  })();
  mainChartCalcPending = { key, promise };
  try {
    return await promise;
  } finally {
    if (mainChartCalcPending?.promise === promise) mainChartCalcPending = null;
  }
}

function getMainChartDisplayPointBudget(el, visibleSeriesCount = 1) {
  const width = Math.max(320, Math.round(el?.getBoundingClientRect?.().width || window.innerWidth || 390));
  const mobile = isTouchDevice() || width < 700;
  const minimum = mobile ? MAIN_CHART_MOBILE_MIN_DISPLAY_POINTS : MAIN_CHART_MIN_DISPLAY_POINTS;
  const totalTarget = mobile
    ? MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_MOBILE
    : MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_DESKTOP;
  const widthBudget = Math.round(width * MAIN_CHART_POINTS_PER_PIXEL);
  const seriesBudget = Math.round(totalTarget / Math.max(1, visibleSeriesCount));
  return Math.max(
    minimum,
    Math.min(MAIN_CHART_MAX_DISPLAY_POINTS, widthBudget, seriesBudget),
  );
}

function pickByIndexes(values, indexes) {
  return indexes.map((idx) => values[idx]);
}

function thinIndexList(indexes, budget, rowCount) {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  if (sorted.length <= budget) return sorted;
  const out = new Set([0, rowCount - 1]);
  const slots = Math.max(1, budget - 2);
  for (let i = 1; i <= slots; i += 1) {
    const idx = sorted[Math.round((i * (sorted.length - 1)) / (slots + 1))];
    if (Number.isInteger(idx)) out.add(idx);
  }
  return [...out].sort((a, b) => a - b);
}

function buildMainChartDisplayIndexes(rows, seriesModels, selected, budget) {
  const rowCount = rows.length;
  if (!rowCount || rowCount <= budget) return null;
  const visible = selected.filter((key) => !hiddenSeries.has(key));
  const targets = visible.length ? visible : selected;
  const bySeries = new Map(seriesModels.map((model) => [model.series, model.values]));
  const perBucketCost = Math.max(2, targets.length * 2);
  const bucketCount = Math.max(1, Math.floor((budget - 2) / perBucketCost));
  const bucketSize = Math.max(1, Math.ceil((rowCount - 2) / bucketCount));
  const keep = new Set([0, rowCount - 1]);

  for (let startIndex = 1; startIndex < rowCount - 1; startIndex += bucketSize) {
    const endIndex = Math.min(rowCount - 1, startIndex + bucketSize);
    targets.forEach((series) => {
      const values = bySeries.get(series);
      if (!values) return;
      let minIdx = -1;
      let maxIdx = -1;
      let minVal = Number.POSITIVE_INFINITY;
      let maxVal = Number.NEGATIVE_INFINITY;
      for (let i = startIndex; i < endIndex; i += 1) {
        const value = values[i];
        if (!Number.isFinite(value)) continue;
        if (value < minVal) {
          minVal = value;
          minIdx = i;
        }
        if (value > maxVal) {
          maxVal = value;
          maxIdx = i;
        }
      }
      if (minIdx >= 0) keep.add(minIdx);
      if (maxIdx >= 0) keep.add(maxIdx);
    });
  }

  return thinIndexList([...keep], budget, rowCount);
}

/* Drag handles */

function updateHandles() {
  const el = document.getElementById("chart");
  if (!el || !el._fullLayout) return;

  let container = document.getElementById("y-handles");
  if (!container) {
    container = document.createElement("div");
    container.id = "y-handles";
    el.appendChild(container);
  }
  container.innerHTML = "";

  const ya = el._fullLayout.yaxis;
  const xa = el._fullLayout.xaxis;
  if (!ya || !ya._length) return;

  const rightX = xa._offset + xa._length + 6;

  el.data.forEach((trace, i) => {
    if (trace.visible === "legendonly") return;
    const key = currentSelected[i];
    if (!key) return;

    let firstY = null;
    for (let j = 0; j < trace.y.length; j++) {
      if (trace.y[j] !== null) { firstY = trace.y[j]; break; }
    }
    let lastY = null;
    for (let j = trace.y.length - 1; j >= 0; j--) {
      if (trace.y[j] !== null) { lastY = trace.y[j]; break; }
    }
    if (firstY === null) return;

    const firstFrac = (firstY - ya.range[0]) / (ya.range[1] - ya.range[0]);
    const leftPixelY = ya._offset + ya._length * (1 - firstFrac);
    const lastFrac = lastY !== null ? (lastY - ya.range[0]) / (ya.range[1] - ya.range[0]) : firstFrac;
    const rightPixelY = ya._offset + ya._length * (1 - lastFrac);
    const color = trace.line.color;

    const leftHandle = document.createElement("div");
    leftHandle.className = "y-handle y-handle-left";
    leftHandle.style.top = leftPixelY - 7 + "px";
    leftHandle.style.backgroundColor = color;
    leftHandle.title = labelName(key) + " (위치)";
    setupOffsetDrag(leftHandle, i, key, leftPixelY, ya);
    container.appendChild(leftHandle);

    const rightHandle = document.createElement("div");
    rightHandle.className = "y-handle y-handle-right";
    rightHandle.style.top = rightPixelY - 7 + "px";
    rightHandle.style.left = rightX + "px";
    rightHandle.style.backgroundColor = color;
    rightHandle.title = labelName(key) + " (스케일)";
    setupScaleDrag(rightHandle, i, key, rightPixelY, ya);
    container.appendChild(rightHandle);
  });
}

function defaultSeriesScale(seriesKey) {
  return seriesKey === "leading_cycle" ? 20 : 1;
}

function computeFinalValues(seriesKey) {
  const base = baseTraceValues[seriesKey];
  if (!base) return null;
  const s = seriesScales[seriesKey] != null ? seriesScales[seriesKey] : defaultSeriesScale(seriesKey);
  const o = seriesOffsets[seriesKey] || 0;
  return base.map((v) => (v !== null ? 100 + (v - 100) * s + o : null));
}

function restyleLive(traceIndex, seriesKey) {
  if (dragRafId) return;
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null;
    const el = document.getElementById("chart");
    const newY = computeFinalValues(seriesKey);
    if (newY) {
      lineHitIndexCache.delete(el);
      Plotly.restyle(el, { y: [newY] }, [traceIndex]);
    }
  });
}

function finishTraceYEdit(rebuildForDisclosures = true, seriesKey = "") {
  saveState();
  if (showAiForecast) {
    requestAnimationFrame(() => requestChartRender());
    return;
  }
  if (showDisclosures && rebuildForDisclosures) {
    requestAnimationFrame(() => {
      if (!refreshDisclosureTraceFast(seriesKey)) requestChartRender();
    });
    return;
  }
  updateHandles();
  saveLastRuntimeSnapshot().catch(() => {});
}


function lockCurrentYAxisRange() {
  const el = document.getElementById("chart");
  const range = el?._fullLayout?.yaxis?.range;
  if (!el || !Array.isArray(range) || range.length < 2) return;
  Plotly.relayout(el, {
    "yaxis.range[0]": range[0],
    "yaxis.range[1]": range[1],
    "yaxis.autorange": false,
  });
}

function getCurrentMainXRange() {
  const range = document.getElementById("chart")?._fullLayout?.xaxis?.range;
  if (!Array.isArray(range) || range.length < 2) return null;
  return [range[0], range[1]];
}

function setupOffsetDrag(handle, traceIndex, seriesKey, basePixelY, ya) {
  function onStart(startClientY, pointerId) {
    const startOffset = seriesOffsets[seriesKey] || 0;
    const lockedXRange = getCurrentMainXRange();
    isHandleDragging = true;
    handle.classList.add("dragging");
    lockCurrentYAxisRange();

    function onMove(clientY) {
      const dy = clientY - startClientY;
      const dataDelta = -dy * (ya.range[1] - ya.range[0]) / ya._length;
      seriesOffsets[seriesKey] = startOffset + dataDelta;
      handle.style.top = basePixelY + dy - 7 + "px";
      restyleLive(traceIndex, seriesKey);
    }

    function onEnd(clientY) {
      handle.classList.remove("dragging");
      isHandleDragging = false;
      if (lockedXRange) pinnedXRange = [...lockedXRange];
      const dy = clientY - startClientY;
      if (Math.abs(dy) < 3) {
        seriesOffsets[seriesKey] = startOffset;
        if (hiddenSeries.has(seriesKey)) hiddenSeries.delete(seriesKey);
        else hiddenSeries.add(seriesKey);
        restyleLive(traceIndex, seriesKey);
        saveState();
        if (!applySeriesVisibilityFast(seriesKey)) requestChartRender();
        return;
      }
      finishTraceYEdit(true, seriesKey);
    }

    addDragListeners(pointerId, onMove, onEnd);
  }

  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    onStart(event.clientY, event.pointerId);
  }, { passive: false });
}

function setupScaleDrag(handle, traceIndex, seriesKey, basePixelY, ya) {
  function onStart(startClientY, pointerId) {
    const startScale = seriesScales[seriesKey] != null ? seriesScales[seriesKey] : defaultSeriesScale(seriesKey);
    const lockedXRange = getCurrentMainXRange();
    isHandleDragging = true;
    handle.classList.add("dragging");
    lockCurrentYAxisRange();

    function onMove(clientY) {
      const dy = clientY - startClientY;
      const factor = 1 - dy / 150;
      seriesScales[seriesKey] = startScale * factor;
      handle.style.top = basePixelY + dy - 7 + "px";
      restyleLive(traceIndex, seriesKey);
    }

    function onEnd() {
      handle.classList.remove("dragging");
      isHandleDragging = false;
      if (lockedXRange) pinnedXRange = [...lockedXRange];
      finishTraceYEdit(true, seriesKey);
    }

    addDragListeners(pointerId, onMove, onEnd);
  }

  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    onStart(event.clientY, event.pointerId);
  }, { passive: false });
}

function addDragListeners(pointerId, onMove, onEnd) {
  let lastClientY = Number.NaN;
  const cleanup = () => {
    document.removeEventListener("pointermove", pointerMove);
    document.removeEventListener("pointerup", pointerEnd);
    document.removeEventListener("pointercancel", pointerCancel);
  };
  const pointerMove = (event) => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : null;
    const sample = samples?.length ? samples[samples.length - 1] : event;
    lastClientY = sample.clientY;
    onMove(lastClientY);
  };
  const pointerEnd = (event) => {
    if (event.pointerId !== pointerId) return;
    cleanup();
    onEnd(event.clientY);
  };
  const pointerCancel = (event) => {
    if (event.pointerId !== pointerId) return;
    cleanup();
    onEnd(Number.isFinite(lastClientY) ? lastClientY : event.clientY);
  };
  document.addEventListener("pointermove", pointerMove, { passive: false });
  document.addEventListener("pointerup", pointerEnd);
  document.addEventListener("pointercancel", pointerCancel);
}

function resetHandles() {
  seriesOffsets = {};
  seriesScales = {};
  pinnedXRange = null;
  saveState();
  requestChartRender(false);
}

function buildDisclosurePointIndex(seriesModels, tickers) {
  const index = {};
  const modelBySeries = new Map((seriesModels || []).map((model) => [model.series, model]));
  (tickers || []).forEach((ticker) => {
    const model = modelBySeries.get(ticker);
    if (!model) return;
    const pointCount = Math.min(model.xValues?.length || 0, model.values?.length || 0);
    index[ticker] = Array.from({ length: pointCount }, (_, pointIndex) => {
      const date = String(model.xValues[pointIndex] || "").slice(0, 10);
      const y = model.values[pointIndex];
      const ms = toUtcMs(date);
      return date && Number.isFinite(y) && Number.isFinite(ms) ? { date, y, ms } : null;
    })
      .filter(Boolean);
  });
  return index;
}

function findNearestDisclosurePoint(eventDate, ticker, pointIndex) {
  const points = pointIndex?.[ticker];
  if (!points?.length) return null;
  const targetMs = toUtcMs(eventDate);
  if (!Number.isFinite(targetMs)) return null;

  let best = null;
  const consider = (point) => {
    if (!point) return;
    const diff = Math.abs(point.ms - targetMs);
    if (diff > 10 * DAY_MS) return;
    if (!best || diff < best.diff || (diff === best.diff && point.date >= eventDate && best.date < eventDate)) {
      best = { date: point.date, y: point.y, diff };
    }
  };

  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].ms < targetMs) lo = mid + 1;
    else hi = mid;
  }
  consider(points[lo]);
  consider(points[lo - 1]);
  return best;
}

function buildDisclosureTrace(selected, seriesModels, start, end) {
  lastDisclosureTraceStats = { total: disclosureRows.length, candidates: 0, markers: 0 };
  if (!disclosureRows.length || !seriesModels.length) return null;
  const selectedSet = new Set(selected);
  const candidates = disclosureRows.filter((event) => (
    selectedSet.has(event.ticker)
    && !hiddenSeries.has(event.ticker)
    && event.date >= start
    && event.date <= end
  ));
  lastDisclosureTraceStats.candidates = candidates.length;
  const candidateTickers = new Set(candidates.map((event) => event.ticker));
  const pointIndex = buildDisclosurePointIndex(seriesModels, candidateTickers);
  const grouped = new Map();

  candidates.forEach((event) => {
    const point = findNearestDisclosurePoint(event.date, event.ticker, pointIndex);
    if (!point) return;
    const key = `${event.ticker}|${point.date}`;
    const group = grouped.get(key) || {
      ticker: event.ticker,
      name: event.name || labelName(event.ticker),
      color: seriesColor(event.ticker),
      plotDate: point.date,
      y: point.y,
      events: [],
    };
    group.events.push(event);
    grouped.set(key, group);
  });

  const groups = [...grouped.values()].sort((a, b) => a.plotDate.localeCompare(b.plotDate));
  lastDisclosureTraceStats.markers = groups.length;
  disclosureGroupStore = new Map();
  if (!groups.length) return null;
  const groupIds = groups.map((group) => {
    const id = `d${++disclosureGroupStoreSeq}`;
    disclosureGroupStore.set(id, group);
    return id;
  });

  return {
    x: groups.map((group) => group.plotDate),
    y: groups.map((group) => group.y),
    text: groups.map(() => DISCLOSURE_ICON_TEXT),
    customdata: groupIds.map((id) => [id]),
    type: "scatter",
    mode: "text",
    name: DISCLOSURE_TRACE_NAME,
    showlegend: false,
    cliponaxis: false,
    hovertemplate: groups.map((group) => {
      const first = group.events[0];
      const more = group.events.length > 1 ? ` 외 ${group.events.length - 1}건` : "";
      return `${escapeHtml(group.name)}<br>${escapeHtml(first.type)}: ${escapeHtml(first.title)}${more}<extra>공시</extra>`;
    }),
    meta: { isDisclosureTrace: true },
    textposition: "top center",
    textfont: {
      color: groups.map((group) => group.color || DISCLOSURE_MARKER_COLOR),
      size: DISCLOSURE_TEXT_SIZE,
      family: "Arial Black, sans-serif",
    },
  };
}

function updateCurrentMainChartSeriesTransform(seriesKey) {
  if (!seriesKey || !currentMainChartModel?.seriesModels) return true;
  const model = currentMainChartModel.seriesModels.find((item) => item.series === seriesKey);
  if (!model || !Array.isArray(model.baseValues)) return false;
  const scale = seriesScales[seriesKey] != null
    ? seriesScales[seriesKey]
    : defaultSeriesScale(seriesKey);
  const offset = seriesOffsets[seriesKey] || 0;
  model.values = model.baseValues.map((value) => (
    value !== null ? 100 + (value - 100) * scale + offset : null
  ));
  return true;
}

function refreshDisclosureTraceFast(seriesKey = "") {
  const el = document.getElementById("chart");
  if (
    !showDisclosures
    || !window.Plotly
    || !el?.data
    || !currentMainChartModel?.seriesModels?.length
    || !currentStart
    || !currentEnd
  ) return false;
  if (!updateCurrentMainChartSeriesTransform(seriesKey)) return false;

  const nextTrace = buildDisclosureTrace(
    currentMainChartModel.selected,
    currentMainChartModel.seriesModels,
    currentStart,
    currentEnd,
  );
  const traceIndex = el.data.findIndex((trace) => trace?.meta?.isDisclosureTrace);
  clearDisclosureHoverTimer();
  currentDisclosureHighlight = null;
  let task = Promise.resolve();
  if (nextTrace && traceIndex >= 0) {
    task = Plotly.restyle(el, {
      x: [nextTrace.x],
      y: [nextTrace.y],
      text: [nextTrace.text],
      customdata: [nextTrace.customdata],
      hovertemplate: [nextTrace.hovertemplate],
      "textfont.size": [DISCLOSURE_TEXT_SIZE],
      "textfont.color": [nextTrace.textfont.color],
      visible: true,
    }, [traceIndex]);
  } else if (nextTrace) {
    task = Plotly.addTraces(el, nextTrace);
  } else if (traceIndex >= 0) {
    task = Plotly.deleteTraces(el, traceIndex);
  }

  mainChartCalcCache = null;
  partialDisclosureUpdateCount += 1;
  hideDisclosurePopover();
  disclosureMarkerPixelCache.delete(el);
  Promise.resolve(task)
    .then(() => {
      syncDisclosureToggleButton(lastDisclosureTraceStats.markers);
      updateHandles();
      scheduleLastRuntimeSnapshotSave();
    })
    .catch(() => requestChartRender());
  return true;
}

function applyDisclosureStateFast(seriesKey = "") {
  if (showDisclosures) return refreshDisclosureTraceFast(seriesKey);
  const el = document.getElementById("chart");
  if (!window.Plotly || !el?.data) return false;
  const traceIndex = el.data.findIndex((trace) => trace?.meta?.isDisclosureTrace);
  hideDisclosurePopover();
  clearDisclosureHoverTimer();
  currentDisclosureHighlight = null;
  lastDisclosureTraceStats = { total: disclosureRows.length, candidates: 0, markers: 0 };
  syncDisclosureToggleButton(0);
  if (traceIndex < 0) return true;
  disclosureMarkerPixelCache.delete(el);
  Promise.resolve(Plotly.deleteTraces(el, traceIndex))
    .then(() => {
      updateHandles();
      scheduleLastRuntimeSnapshotSave();
    })
    .catch(() => requestChartRender());
  return true;
}

const disclosurePopoverModule = globalThis.ThinkStockDisclosurePopover;
if (!disclosurePopoverModule) throw new Error("Disclosure popover module failed to load");
const disclosurePopover = disclosurePopoverModule.createDisclosurePopover(globalThis, {
  chartId: "chart",
  escapeHtml,
  fallbackName: (group) => labelName(group?.ticker),
});

function hideDisclosurePopover() {
  disclosurePopover.hide();
}

function showDisclosurePopover(group, sourceEvent) {
  disclosurePopover.show(group, sourceEvent);
}

function isDirectDisclosureTap(evtData, point) {
  const sourceEvent = evtData?.event;
  const chart = document.getElementById("chart");
  const clientX = Number(sourceEvent?.clientX);
  const clientY = Number(sourceEvent?.clientY);
  const xAxis = point?.xaxis;
  const yAxis = point?.yaxis;
  if (!chart || !Number.isFinite(clientX) || !Number.isFinite(clientY)
    || typeof xAxis?.d2p !== "function" || typeof yAxis?.d2p !== "function") return false;

  const rect = chart.getBoundingClientRect();
  const markerX = Number(xAxis._offset || 0) + xAxis.d2p(point.x);
  const markerY = Number(yAxis._offset || 0) + yAxis.d2p(point.y);
  const hitRadius = isTouchDevice()
    ? DISCLOSURE_TOUCH_HIT_RADIUS_PX
    : DISCLOSURE_MOUSE_HIT_RADIUS_PX;
  return Math.hypot(clientX - rect.left - markerX, clientY - rect.top - markerY) <= hitRadius;
}

function handleDisclosureClick(evtData) {
  const point = evtData?.points?.find((p) => p?.data?.meta?.isDisclosureTrace);
  if (!point || !isDirectDisclosureTap(evtData, point)) return false;
  try {
    const raw = point.customdata?.[0];
    const group = disclosureGroupStore.get(raw) || JSON.parse(raw);
    showDisclosurePopover(group, evtData.event);
    return true;
  } catch (_) {
    return false;
  }
}

function findDisclosureEventPoint(evtData) {
  return evtData?.points?.find((p) => p?.data?.meta?.isDisclosureTrace) || null;
}

function clearDisclosureHoverTimer() {
  if (disclosureHoverTimer) clearTimeout(disclosureHoverTimer);
  disclosureHoverTimer = 0;
  pendingDisclosureHoverData = null;
}

function getDisclosureTextNodes(chartEl) {
  if (!chartEl) return [];
  return [...chartEl.querySelectorAll(".textpoint text")]
    .filter((node) => node.textContent?.trim() === DISCLOSURE_ICON_TEXT);
}

function setDisclosureTextHighlighted(chartEl, pointIndex, highlighted) {
  const node = getDisclosureTextNodes(chartEl)[pointIndex];
  if (!node) return false;
  const size = highlighted ? DISCLOSURE_TEXT_HOVER_SIZE : DISCLOSURE_TEXT_SIZE;
  const disclosureTrace = chartEl.data?.find((trace) => trace?.meta?.isDisclosureTrace);
  const traceColors = disclosureTrace?.textfont?.color;
  const baseColor = Array.isArray(traceColors)
    ? traceColors[pointIndex] || DISCLOSURE_MARKER_COLOR
    : traceColors || DISCLOSURE_MARKER_COLOR;
  const color = highlighted ? DISCLOSURE_MARKER_HOVER_LINE_COLOR : baseColor;
  node.style.fontSize = `${size}px`;
  node.style.fill = color;
  node.setAttribute("font-size", String(size));
  node.setAttribute("fill", color);
  disclosureHighlightDomUpdateCount += 1;
  return true;
}

function resetDisclosureHoverHighlight(chartEl = document.getElementById("chart")) {
  clearDisclosureHoverTimer();
  if (!chartEl || !currentDisclosureHighlight) return;
  const pointIndex = currentDisclosureHighlight.pointIndex;
  currentDisclosureHighlight = null;
  setDisclosureTextHighlighted(chartEl, pointIndex, false);
}

function scheduleDisclosureHoverHighlight(evtData) {
  if (isViewportDragging || isHandleDragging) return;
  const chartEl = document.getElementById("chart");
  const point = findDisclosureEventPoint(evtData);
  if (!chartEl || !point) {
    resetDisclosureHoverHighlight(chartEl);
    return;
  }

  const traceIndex = point.curveNumber;
  const pointIndex = point.pointIndex ?? point.pointNumber;
  if (
    currentDisclosureHighlight
    && currentDisclosureHighlight.traceIndex === traceIndex
    && currentDisclosureHighlight.pointIndex === pointIndex
  ) {
    return;
  }

  pendingDisclosureHoverData = evtData;
  if (disclosureHoverTimer) clearTimeout(disclosureHoverTimer);
  disclosureHoverTimer = setTimeout(() => {
    const pending = pendingDisclosureHoverData;
    disclosureHoverTimer = 0;
    pendingDisclosureHoverData = null;
    if (isViewportDragging || isHandleDragging || !pending) return;
    highlightDisclosureHoverPoint(pending);
  }, DISCLOSURE_HOVER_DELAY_MS);
}

function highlightDisclosureHoverPoint(evtData) {
  const chartEl = document.getElementById("chart");
  const point = findDisclosureEventPoint(evtData);
  if (!chartEl || !point) {
    resetDisclosureHoverHighlight(chartEl);
    return;
  }

  const traceIndex = point.curveNumber;
  const pointIndex = point.pointIndex ?? point.pointNumber;
  const count = Array.isArray(point.data?.x) ? point.data.x.length : 0;
  if (!Number.isInteger(traceIndex) || !Number.isInteger(pointIndex) || count <= 0) return;
  if (
    currentDisclosureHighlight
    && currentDisclosureHighlight.traceIndex === traceIndex
    && currentDisclosureHighlight.pointIndex === pointIndex
  ) {
    return;
  }

  resetDisclosureHoverHighlight(chartEl);

  currentDisclosureHighlight = { traceIndex, pointIndex };
  setDisclosureTextHighlighted(chartEl, pointIndex, true);
}

function visibleAiAnalysisTickers() {
  return [...new Set(currentSelected
    .map((ticker) => String(ticker || "").toUpperCase())
    .filter((ticker) => /^\d{6}\.(KS|KQ)$/.test(ticker) && !hiddenSeries.has(ticker)))];
}

async function readAiAnalysisCacheForTicker(ticker) {
  try {
    const stored = await readIndexedDbRecord(TICKER_AI_ANALYSIS_CACHE_STORE_NAME, ticker);
    if (stored?.schema !== AI_ANALYSIS_CACHE_SCHEMA_VERSION) return null;
    return normalizeAnalysisRecord(ticker, stored, null, Date.now());
  } catch (_) {
    return null;
  }
}

async function saveAiAnalysisCacheForTicker(ticker, analysis) {
  if (!analysis) return false;
  try {
    await writeIndexedDbRecord(TICKER_AI_ANALYSIS_CACHE_STORE_NAME, ticker, analysis);
    return true;
  } catch (_) {
    return false;
  }
}

function aiAnalysisIsFresh(analysis) {
  return isAnalysisFresh(analysis, TICKER_AI_ANALYSIS_CACHE_FRESH_DAYS * DAY_MS);
}

async function requestAiAnalysisForTicker(ticker) {
  const target = String(ticker || "").trim().toUpperCase();
  if (!/^\d{6}\.(KS|KQ)$/.test(target)) return null;
  const memoryAnalysis = aiAnalysisByTicker.get(target) || null;
  if (aiAnalysisIsFresh(memoryAnalysis)) return memoryAnalysis;
  if (aiAnalysisPromises.has(target)) return aiAnalysisPromises.get(target);

  aiAnalysisPendingTickers.add(target);
  syncAiForecastToggleButton();

  const task = (async () => {
    let cached = memoryAnalysis || await readAiAnalysisCacheForTicker(target);
    if (cached) {
      aiAnalysisByTicker.set(target, cached);
      if (showAiForecast) requestChartRender(lastAiForecastTraceCount > 0);
      if (aiAnalysisIsFresh(cached)) return cached;
    }
    if (!canUseDartGateway()) return cached;

    const response = await fetchWithTimeout(`${AI_ANALYSIS_ENDPOINT}?ticker=${encodeURIComponent(target)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${getDartGatewayAccessToken()}` },
    }, 25000);
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) return null;
    const analysis = normalizeAnalysisRecord(target, payload, cached, Date.now());
    if (!analysis) return cached;
    aiAnalysisByTicker.set(target, analysis);
    await saveAiAnalysisCacheForTicker(target, analysis);
    return analysis;
  })().catch(() => memoryAnalysis).finally(() => {
    aiAnalysisPromises.delete(target);
    aiAnalysisPendingTickers.delete(target);
    syncAiForecastToggleButton();
    if (showAiForecast) requestChartRender(lastAiForecastTraceCount > 0);
  });
  aiAnalysisPromises.set(target, task);
  return task;
}

async function refreshAiAnalysisForVisibleSeries() {
  if (!showAiForecast) return 0;
  const tickers = visibleAiAnalysisTickers();
  if (!tickers.length) return 0;
  const before = aiAnalysisByTicker.size;
  await mapWithConcurrency(tickers, 2, requestAiAnalysisForTicker);
  return Math.max(0, aiAnalysisByTicker.size - before);
}

function disclosureTargetTickers() {
  const tickers = new Set();
  (pricePayload?.series || []).forEach((series) => {
    const ticker = String(series || "").trim().toUpperCase();
    if (/^[0-9]{6}\.(KS|KQ)$/.test(ticker)) tickers.add(ticker);
  });
  customStocks.forEach((item) => {
    const ticker = String(item?.ticker || "").trim().toUpperCase();
    if (/^[0-9]{6}\.(KS|KQ)$/.test(ticker)) tickers.add(ticker);
  });
  return [...tickers];
}

async function fetchDartDisclosuresLive(apiKey, options = {}) {
  const results = await mapWithConcurrency(
    disclosureTargetTickers(),
    DART_VISIBLE_REFRESH_CONCURRENCY,
    (ticker) => fetchDartDisclosuresForTickerLive(apiKey, ticker, options),
  );
  return sanitizeDisclosureRows(results.flat());
}

async function fetchDartDisclosuresForTickerLive(apiKey, ticker, options = {}) {
  const targetTicker = String(ticker || "").trim().toUpperCase();
  if (!/^[0-9]{6}\.(KS|KQ)$/.test(targetTicker)) return [];
  const stockCode = targetTicker.slice(0, 6);
  const corpCodeLoaded = await ensureDartCorpCodeMapLoaded(stockCode);
  const corpCode = String(dartCorpCodeMap.get(stockCode)?.corp_code || "");
  if (!corpCodeLoaded || !corpCode) {
    throw new Error("DART 회사코드를 찾지 못했습니다. 배포 데이터 갱신 후 다시 시도해 주세요.");
  }
  const accessToken = getDartGatewayAccessToken();
  if (!accessToken) throw new Error("API 설정에서 DART 개인 접속 코드를 먼저 저장해 주세요.");
  const query = new URLSearchParams({ ticker: targetTicker, corpCode });
  const latestDate = disclosureRowsForTicker(targetTicker).at(-1)?.date || "";
  if (latestDate) query.set("since", latestDate);
  if (options?.forceNetwork) query.set("force", "1");
  let response;
  try {
    response = await fetchWithTimeout(`${DART_GATEWAY_DISCLOSURE_ENDPOINT}?${query.toString()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: options?.signal || null,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("ThinkStock DART 중계 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok || payload?.ok === false) {
    const detail = String(payload?.error || "").trim();
    throw new Error(detail || "ThinkStock DART 중계 서버가 응답하지 않습니다.");
  }
  return sanitizeDisclosureRows(payload?.records || []);
}

function syncAiForecastToggleButton(traceCount = lastAiForecastTraceCount) {
  const button = document.getElementById("aiForecastToggle");
  if (!button) return;
  const count = Number(traceCount) || 0;
  const pendingCount = visibleAiAnalysisTickers()
    .filter((ticker) => aiAnalysisPendingTickers.has(ticker)).length;
  button.classList.toggle("is-active", showAiForecast);
  button.setAttribute("aria-pressed", showAiForecast ? "true" : "false");
  button.setAttribute("aria-busy", pendingCount > 0 ? "true" : "false");
  button.title = showAiForecast
    ? (pendingCount > 0
      ? `종목 실적 분석 준비 중 - ${pendingCount}개`
      : (count > 0
      ? `6개월 AI 가상 흐름 켜짐 - ${count}개 종목 (투자 판단용 아님)`
      : "AI 분석에는 종목별로 최소 90거래일이 필요합니다."))
    : "6개월 AI 가상 흐름 (투자 판단용 아님)";
}

function syncMacdToggleButton(traceCount = lastMacdTraceCount) {
  const button = document.getElementById("macdToggle");
  if (!button) return;
  const count = Number(traceCount) || 0;
  button.classList.toggle("is-active", showMacdOscillator);
  button.setAttribute("aria-pressed", showMacdOscillator ? "true" : "false");
  button.title = showMacdOscillator
    ? (count > 0
      ? `MACD 오실레이터 켜짐 - ${count}개 종목 (12·26·9)`
      : "표시 중인 종목에 MACD 계산용 가격 이력이 부족합니다.")
    : "종목별 MACD 오실레이터 (12·26·9)";
}

function mergeDisclosureRows(existingRows, incomingRows) {
  return disclosureDataService.mergeRows(existingRows, incomingRows);
}

function getDartDisclosureRefreshCacheEntry(ticker) {
  return disclosureDataService.getRefreshCacheEntry(ticker);
}

function rememberDartDisclosureRefresh(ticker, info) {
  disclosureDataService.rememberRefresh(ticker, info);
}

function hasFreshDartDisclosureRefresh(ticker) {
  return disclosureDataService.hasFreshRefresh(ticker);
}

function disclosureRowsForTicker(ticker) {
  const target = String(ticker || "").trim().toUpperCase();
  return sanitizeDisclosureRows(disclosureRows.filter((row) => row.ticker === target));
}

async function readTickerDisclosureCache(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  if (!key) return null;
  try {
    const record = await readIndexedDbRecord(TICKER_DISCLOSURE_CACHE_STORE_NAME, key);
    if (!record || record.schema !== TICKER_DISCLOSURE_CACHE_SCHEMA_VERSION || record.ticker !== key) return null;
    const rows = sanitizeDisclosureRows(record.rows);
    if (!rows.length) return null;
    const nextRecord = {
      ...record,
      rows,
      lastAccessed: Date.now(),
    };
    writeIndexedDbRecord(TICKER_DISCLOSURE_CACHE_STORE_NAME, key, nextRecord).catch(() => {});
    return nextRecord;
  } catch (_) {
    return null;
  }
}

async function writeTickerDisclosureCache(ticker, rows) {
  const key = String(ticker || "").trim().toUpperCase();
  const normalized = sanitizeDisclosureRows(rows).filter((row) => row.ticker === key);
  if (!key || !normalized.length) return false;
  const now = Date.now();
  const record = {
    schema: TICKER_DISCLOSURE_CACHE_SCHEMA_VERSION,
    ticker: key,
    savedAt: now,
    lastAccessed: now,
    latestDate: normalized[normalized.length - 1]?.date || "",
    rows: normalized,
  };
  try {
    await writeIndexedDbRecord(TICKER_DISCLOSURE_CACHE_STORE_NAME, key, record);
    pruneGranularCacheStore(TICKER_DISCLOSURE_CACHE_STORE_NAME).catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

async function applyTickerDisclosureCache(ticker) {
  const record = await readTickerDisclosureCache(ticker);
  if (!record) return { applied: false, added: 0, latestDate: "" };
  const beforeCount = disclosureRows.length;
  disclosureRows = mergeDisclosureRows(disclosureRows, record.rows);
  if (record.rows.length) markDataChanged("disclosure");
  return {
    applied: true,
    added: Math.max(0, disclosureRows.length - beforeCount),
    latestDate: record.latestDate || record.rows[record.rows.length - 1]?.date || "",
  };
}

function getDisclosureSeedTickers() {
  const tickers = [
    ...(Array.isArray(pricePayload?.series) ? pricePayload.series : []),
    ...customStocks.map((item) => item.ticker),
    ...currentSelected,
  ];
  return [...new Set(tickers.map((ticker) => String(ticker || "").toUpperCase()))]
    .filter((ticker) => /^[0-9]{6}\.(KS|KQ)$/.test(ticker));
}

async function fetchDisclosureSeedForTicker(ticker, forceNetwork = false) {
  const target = String(ticker || "").trim().toUpperCase();
  const relativePath = String(disclosureManifest?.files?.[target] || "").trim();
  if (!relativePath) return { ticker: target, added: 0, seeded: false, latestDate: "" };

  const text = await fetchSeedText(relativePath, forceNetwork);
  const payload = parsePayloadText(text);
  const rows = normalizeDisclosureSeedRows(payload?.records || [])
    .filter((row) => row.ticker === target);
  const beforeCount = disclosureRows.length;
  disclosureRows = mergeDisclosureRows(disclosureRows, rows);
  if (rows.length) {
    markDataChanged("disclosure");
    await writeTickerDisclosureCache(target, disclosureRowsForTicker(target));
  }
  return {
    ticker: target,
    added: Math.max(0, disclosureRows.length - beforeCount),
    seeded: true,
    latestDate: rows.at(-1)?.date || "",
  };
}

async function ensureDisclosureSeedForTicker(ticker, forceNetwork = false) {
  const target = String(ticker || "").trim().toUpperCase();
  if (!/^[0-9]{6}\.(KS|KQ)$/.test(target)) return { ticker: target, added: 0 };
  if (disclosureSeedLoadedTickers.has(target) && !forceNetwork) return { ticker: target, added: 0 };
  if (disclosureSeedLoadPromises.has(target)) return disclosureSeedLoadPromises.get(target);

  const task = (async () => {
    const cached = await applyTickerDisclosureCache(target);
    const manifestLatest = String(disclosureManifest?.latest?.[target] || "");
    const cacheIsCurrent = cached.applied
      && (!manifestLatest || String(cached.latestDate || "") >= manifestLatest);
    const seeded = cacheIsCurrent && !forceNetwork
      ? { ticker: target, added: 0, seeded: false, latestDate: cached.latestDate }
      : await fetchDisclosureSeedForTicker(target, forceNetwork);
    disclosureSeedLoadedTickers.add(target);
    return {
      ticker: target,
      added: cached.added + seeded.added,
      cached: cached.applied,
      seeded: seeded.seeded,
      latestDate: seeded.latestDate || cached.latestDate,
    };
  })().catch(() => ({ ticker: target, added: 0 })).finally(() => {
    disclosureSeedLoadPromises.delete(target);
  });

  disclosureSeedLoadPromises.set(target, task);
  return task;
}

async function ensureDisclosureSeedsForTickers(tickers, forceNetwork = false) {
  const targets = [...new Set((tickers || []).map((ticker) => String(ticker || "").toUpperCase()))];
  const results = await Promise.all(targets.map((ticker) => ensureDisclosureSeedForTicker(ticker, forceNetwork)));
  return results.reduce((sum, result) => sum + (result?.added || 0), 0);
}

async function refreshDartDisclosuresFromApi(apiKey, ticker = "", options = {}) {
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const targetTicker = String(ticker || "").trim().toUpperCase();
  if (targetTicker && !options.forceNetwork && hasFreshDartDisclosureRefresh(targetTicker)) {
    const cached = getDartDisclosureRefreshCacheEntry(targetTicker);
    return {
      fetched: 0,
      added: 0,
      latestDate: cached?.latestDate || "",
      cached: true,
    };
  }
  const liveRows = ticker
    ? await fetchDartDisclosuresForTickerLive(apiKey, targetTicker, {
      signal,
      forceNetwork: options.forceNetwork,
    })
    : await fetchDartDisclosuresLive(apiKey, { signal });
  throwIfAborted(signal);
  const beforeCount = disclosureRows.length;
  disclosureRows = mergeDisclosureRows(disclosureRows, liveRows);
  if (liveRows.length) markDataChanged("disclosure");
  const latestDate = disclosureRows.length ? disclosureRows[disclosureRows.length - 1].date : "";
  const info = {
    fetched: liveRows.length,
    added: Math.max(0, disclosureRows.length - beforeCount),
    latestDate,
  };
  if (targetTicker) {
    rememberDartDisclosureRefresh(targetTicker, info);
    writeTickerDisclosureCache(targetTicker, disclosureRowsForTicker(targetTicker)).catch(() => {});
  } else {
    [...new Set(liveRows.map((row) => row.ticker).filter(Boolean))]
      .forEach((ticker) => writeTickerDisclosureCache(ticker, disclosureRowsForTicker(ticker)).catch(() => {}));
  }
  return info;
}

async function mapWithConcurrency(items, limit, worker) {
  const source = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.min(Number(limit) || 1, source.length || 1));
  const results = Array(source.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(source[index], index);
    }
  }));
  return results;
}

async function refreshDartDisclosuresForVisibleTickersFromApi(apiKey, options = {}) {
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const tickers = disclosureTargetTickers()
    .filter((ticker) => !hiddenSeries.has(ticker));
  const uniqueTickers = [...new Set(tickers)];
  const beforeCount = disclosureRows.length;
  const incomingRows = [];
  const failed = [];
  let cached = 0;

  const results = await mapWithConcurrency(uniqueTickers, DART_VISIBLE_REFRESH_CONCURRENCY, async (ticker) => {
    try {
      if (!options.forceNetwork && hasFreshDartDisclosureRefresh(ticker)) {
        return { ticker, rows: [], cached: true };
      }
      const rows = await fetchDartDisclosuresForTickerLive(apiKey, ticker, {
        signal,
        forceNetwork: options.forceNetwork,
      });
      throwIfAborted(signal);
      rememberDartDisclosureRefresh(ticker, {
        fetched: rows.length,
        added: rows.length,
        latestDate: rows.length ? rows[rows.length - 1].date : "",
      });
      return { ticker, rows };
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      return { ticker, error: err };
    }
  });

  throwIfAborted(signal);
  results.forEach((result) => {
    if (!result) return;
    if (result.error) {
      failed.push(`${labelName(result.ticker)}: ${result.error.message}`);
      return;
    }
    if (result.cached) {
      cached += 1;
      return;
    }
    incomingRows.push(...(result.rows || []));
  });

  disclosureRows = mergeDisclosureRows(disclosureRows, incomingRows);
  if (incomingRows.length) markDataChanged("disclosure");
  uniqueTickers.forEach((ticker) => {
    writeTickerDisclosureCache(ticker, disclosureRowsForTicker(ticker)).catch(() => {});
  });

  const latestDate = disclosureRows.length ? disclosureRows[disclosureRows.length - 1].date : "";
  return {
    fetched: incomingRows.length,
    added: Math.max(0, disclosureRows.length - beforeCount),
    latestDate,
    failed,
    cached,
  };
}

function requestDartDisclosureRefreshForTicker(ticker, msgEl) {
  const target = String(ticker || "").trim().toUpperCase();
  if (!/^[0-9]{6}\.(KS|KQ)$/.test(target)) return;
  if (dartDisclosureTickerRefreshPromises.has(target)) {
    return;
  }

  const name = labelName(target);
  enableDisclosureMarkers();
  saveState();
  const task = ensureDisclosureSeedForTicker(target)
    .then(async (seedInfo) => {
      if (seedInfo?.added > 0) {
        if (!applyDisclosureStateFast()) requestChartRender(false);
      }
      if (canUseDartGateway()) {
        const refreshInfo = await refreshDartDisclosuresFromApi("gateway", target, { forceNetwork: true });
        if (refreshInfo?.added > 0 || refreshInfo?.fetched > 0) {
          if (!applyDisclosureStateFast()) requestChartRender(false);
        }
      }
      scheduleLastRuntimeSnapshotSave();
      const rows = disclosureRowsForTicker(target);
      setMessage(msgEl, rows.length
        ? [`${name} 종목을 추가했습니다.`, `주요 공시 ${rows.length}건을 반영했습니다.`]
        : [`${name} 종목을 추가했습니다.`, "표시할 주요 공시가 없거나 다음 공시 갱신을 기다리는 중입니다."]);
    })
    .catch((error) => {
      setMessage(msgEl, [
        `${name} 종목은 추가됐지만 최신 DART 공시를 확인하지 못했습니다.`,
        error.message,
      ], true);
    })
    .finally(() => {
      dartDisclosureTickerRefreshPromises.delete(target);
    });
  dartDisclosureTickerRefreshPromises.set(target, task);
}

/* Main chart */

async function applyMainChartRender(el, traces, layout) {
  const partialCandidate = mainChartRenderer.canApplyPartialUpdate(el, traces);
  if (partialCandidate) chartSyncing = true;
  let result;
  try {
    result = await mainChartRenderer.render(Plotly, el, traces, layout, PLOTLY_CONFIG);
  } finally {
    if (partialCandidate) chartSyncing = false;
  }
  if (result.mode === "partial") mainChartPartialUpdateCount += 1;
  else mainChartFullRenderCount += 1;
  lastMainChartRenderMode = result.mode;
  return lastMainChartRenderMode;
}

function scheduleDeferredChartRender(preserveZoom = true) {
  pendingDeferredRenderPreserveZoom = pendingDeferredRenderPreserveZoom && preserveZoom;
  if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
  deferredRenderTimer = setTimeout(() => {
    deferredRenderTimer = 0;
    const nextPreserveZoom = pendingDeferredRenderPreserveZoom;
    pendingDeferredRenderPreserveZoom = true;
    if (isChartInteractionBusy()) {
      scheduleDeferredChartRender(nextPreserveZoom);
      return;
    }
    requestChartRender(nextPreserveZoom, { deferDuringInteraction: false });
  }, INTERACTION_RENDER_DELAY_MS);
}

function requestChartRender(preserveZoom = true, options = {}) {
  if (options.deferDuringInteraction !== false && isChartInteractionBusy()) {
    scheduleDeferredChartRender(preserveZoom);
    return;
  }
  pendingRenderPreserveZoom = pendingRenderPreserveZoom && preserveZoom;
  if (renderChartRafId) return;
  renderChartRafId = requestAnimationFrame(() => {
    const nextPreserveZoom = pendingRenderPreserveZoom;
    renderChartRafId = 0;
    pendingRenderPreserveZoom = true;
    renderChart(nextPreserveZoom).catch((err) => {
      const msgEl = document.getElementById("messageArea");
      setMessage(msgEl, err.message || "차트 렌더링 오류", true);
    });
  });
}

function renderChartWhenIdleOrNow(preserveZoom = true) {
  if (isChartInteractionBusy()) {
    requestChartRender(preserveZoom);
    return false;
  }
  renderChart(preserveZoom).catch((err) => {
    const msgEl = document.getElementById("messageArea");
    setMessage(msgEl, err.message || "차트 렌더링 오류", true);
  });
  return true;
}

function aiForecastHistoryRows(series) {
  const source = Array.isArray(pricePayload?.records) ? pricePayload.records : [];
  return source.filter((row) => (
    /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "").slice(0, 10))
    && (!currentEnd || row.date <= currentEnd)
    && Number.isFinite(toNum(row?.[series]))
    && toNum(row?.[series]) > 0
  ));
}

function buildAiForecastTraces(rows, seriesModels) {
  if (!showAiForecast) {
    lastAiForecastTraceCount = 0;
    syncAiForecastToggleButton(0);
    return [];
  }
  const traces = [];
  let forecastCount = 0;
  (seriesModels || []).forEach((model) => {
    const series = String(model?.series || "").toUpperCase();
    if (!isForecastSeries(series) || hiddenSeries.has(series)) return;
    const analysis = aiAnalysisByTicker.get(series) || null;
    if (aiAnalysisPendingTickers.has(series) && !analysis) return;
    const macdModel = getMacdModelForSeries(series);
    const historyRows = aiForecastHistoryRows(series);
    const forecast = buildAiForecast({
      series,
      dates: historyRows.map((row) => row.date),
      prices: historyRows.map((row) => row[series]),
      transformPrices: (rows || []).map((row) => row?.[series]),
      transformChartValues: model.values,
      macroRows,
      auxiliaryRows: adrRows,
      creditRows,
      marketCandidates: ["^KS11", "^KQ11"].map((marketSeries) => ({
        series: marketSeries,
        dates: historyRows.map((row) => row.date),
        prices: historyRows.map((row) => row[marketSeries]),
      })),
      disclosures: disclosureRows,
      consensus: analysis?.consensus || null,
      financials: analysis?.financials || [],
      macdSignal: macdModel?.signal || 0,
      horizon: 126,
    });
    if (!forecast) return;
    forecastCount += 1;
    const consensusUsed = Number(forecast.signals?.consensusConfidence) > 0;
    const fundamentalsUsed = Number(forecast.signals?.fundamentalsConfidence) > 0;
    const backtestSamples = Number(forecast.backtest?.samples) || 0;
    const backtestAccuracy = Number(forecast.backtest?.directionAccuracy);
    const marketWeight = Number(forecast.marketRelationship?.weight) || 0;
    const backtestSummary = backtestSamples >= 3 && Number.isFinite(backtestAccuracy)
      ? `<br>시간순 검증 방향 적중 ${Math.round(backtestAccuracy * 100)}% (${backtestSamples}시점)`
      : "";
    const confidence = Number(forecast.backtest?.confidence) || 0;
    const intervalLevel = Number(forecast.backtest?.intervalLevel) || 0.8;
    const confidenceSummary = `<br>검증 예상범위 ${Math.round(intervalLevel * 100)}%`;
    const commonMeta = {
      seriesKey: series,
      historyDays: forecast.historyDays,
      backtestSamples,
      backtestAccuracy: Number.isFinite(backtestAccuracy) ? backtestAccuracy : null,
      backtestConfidence: confidence,
      modelName: String(forecast.model?.name || ""),
    };
    traces.push({
      x: forecast.dates,
      y: forecast.lowerChartValues,
      type: MAIN_LINE_TRACE_TYPE,
      mode: "lines",
      name: `${labelName(series)} AI 예상 범위 하단`,
      showlegend: false,
      connectgaps: false,
      hoverinfo: "skip",
      line: { color: "rgba(190, 190, 190, 0)", width: 0, shape: "linear" },
      meta: { ...commonMeta, isAiForecastBand: true, aiTraceRole: "lower" },
    });
    traces.push({
      x: forecast.dates,
      y: forecast.upperChartValues,
      type: MAIN_LINE_TRACE_TYPE,
      mode: "lines",
      name: `${labelName(series)} AI 예상 범위`,
      showlegend: false,
      connectgaps: false,
      hoverinfo: "skip",
      fill: "tonexty",
      fillcolor: "rgba(190, 190, 190, 0.10)",
      line: { color: "rgba(190, 190, 190, 0)", width: 0, shape: "linear" },
      meta: { ...commonMeta, isAiForecastBand: true, aiTraceRole: "upper" },
    });
    traces.push({
      x: forecast.dates,
      y: forecast.chartValues,
      text: forecast.prices.map((value) => formatActualValue(value)),
      customdata: forecast.prices,
      type: MAIN_LINE_TRACE_TYPE,
      mode: "lines",
      name: `${labelName(series)} AI 예상 흐름`,
      showlegend: false,
      connectgaps: false,
      hoverinfo: hoverShowPopup ? undefined : "skip",
      hovertemplate: hoverShowPopup
        ? `AI 예상 흐름<br>%{x|%Y.%-m.%-d}<br>%{text}${backtestSummary}${confidenceSummary}${marketWeight > 0 ? "<br>시장 관계 학습" : ""}${consensusUsed ? "<br>컨센서스 제한 반영" : ""}${fundamentalsUsed ? "<br>실적 추세 제한 반영" : ""}<extra>${escapeHtml(labelName(series))}</extra>`
        : undefined,
      line: { color: "rgba(190, 190, 190, 0.7)", width: 2, dash: "dot", shape: "linear" },
      meta: {
        ...commonMeta,
        isAiForecastTrace: true,
        patternMatches: forecast.patternMatches,
        marketWeight,
        marketSeries: String(forecast.marketRelationship?.series || ""),
        marketDownsideBeta: Number(forecast.marketRelationship?.downsideBeta) || 0,
        marketEnvironment: Number(forecast.marketEnvironment?.combined) || 0,
        consensusUsed,
        fundamentalsUsed,
      },
    });
  });
  lastAiForecastTraceCount = forecastCount;
  syncAiForecastToggleButton(forecastCount);
  return traces;
}

async function renderChart(preserveZoom = true) {
  const perfStartedAt = startPerfSample();
  const el = document.getElementById("chart");
  const msgEl = document.getElementById("messageArea");
  if (!window.Plotly) {
    try {
      await ensurePlotlyReady();
    } catch (err) {
      setMessage(msgEl, err.message || "차트 엔진을 불러오지 못했습니다.", true);
      return;
    }
  }
  const renderGeneration = ++chartRenderGeneration;
  const priceRows = pricePayload.records || [];
  const today = new Date().toISOString().slice(0, 10);

  const minCandidates = [];
  const maxCandidates = [];
  const pushBounds = (rows) => {
    if (!Array.isArray(rows) || !rows.length) return;
    const first = String(rows[0]?.date || "").slice(0, 10);
    const last = String(rows[rows.length - 1]?.date || "").slice(0, 10);
    if (first) minCandidates.push(first);
    if (last) maxCandidates.push(last);
  };

  pushBounds(priceRows);
  pushBounds(macroRows);
  pushBounds(creditRows);
  pushBounds(adrRows);
  renderDataFreshness();

  const maxDate = maxCandidates.length
    ? maxCandidates.reduce((mx, d) => (d > mx ? d : mx), maxCandidates[0])
    : today;
  const minDate = minCandidates.length
    ? minCandidates.reduce((mn, d) => (d < mn ? d : mn), minCandidates[0])
    : maxDate;

  const end = maxDate;
  let start = shiftMonths(end, activeMonths);
  if (start < minDate) start = minDate;

  const allowedSeries = new Set([
    ...CORE_SERIES,
    ...customStocks.map((item) => item.ticker),
  ]);
  const visibleSeriesCount = [...allowedSeries]
    .filter((key) => !SUPPLEMENTAL_SERIES.includes(key) && !hiddenSeries.has(key))
    .length;
  const displayBudget = getMainChartDisplayPointBudget(el, visibleSeriesCount);
  const model = await getMainChartModel(priceRows, start, end, allowedSeries, displayBudget);
  if (!model || renderGeneration !== chartRenderGeneration) return;
  const { rows, allSeries, selected, seriesModels } = model;
  currentMainChartModel = model;
  currentRows = rows;
  currentStart = start;
  currentEnd = end;
  syncSeriesToggleBoard(allSeries);
  currentSelected = [...selected];
  if (!showDisclosures) hideDisclosurePopover();
  hoveredLineTraceIndex = null;
  activeLineTraceIndex = null;
  appliedLineHighlightTraceIndex = null;
  currentDisclosureHighlight = null;
  el.classList.remove("is-line-hovering", "is-line-dragging", "is-disclosure-hovering");

  if (!rows.length || !selected.length) {
    msgEl.innerHTML = '<div class="message error">표시할 데이터가 없습니다.</div>';
    return;
  }
  msgEl.innerHTML = "";

  const displayIndexes = model.displayIndexes;
  const displayPointCount = displayIndexes ? displayIndexes.length : rows.length;

  const traces = seriesModels.map(({ series, rawTexts, baseLineWidth, xValues, values, baseValues }) => {
    const traceX = displayIndexes ? pickByIndexes(xValues, displayIndexes) : xValues;
    const traceY = displayIndexes ? pickByIndexes(values, displayIndexes) : values;
    const traceText = displayIndexes ? pickByIndexes(rawTexts, displayIndexes) : rawTexts;
    baseTraceValues[series] = displayIndexes ? pickByIndexes(baseValues, displayIndexes) : baseValues;

    return {
      x: traceX,
      y: traceY,
      text: traceText,
      type: MAIN_LINE_TRACE_TYPE,
      mode: "lines",
      name: labelName(series),
      visible: hiddenSeries.has(series) ? "legendonly" : true,
      connectgaps: true,
      meta: { seriesKey: series, baseLineWidth, sourcePointCount: xValues.length, displayPointCount },
      line: {
        color: seriesColor(series),
        width: baseLineWidth,
        shape: "linear",
      },
      marker: { symbol: "circle", size: 7, color: seriesColor(series) },
      hoverinfo: hoverShowPopup ? undefined : "skip",
      hovertemplate: hoverShowPopup ? "%{text}<extra>%{fullData.name}</extra>" : undefined,
    };
  });

  const aiForecastTraces = buildAiForecastTraces(rows, seriesModels);
  traces.push(...aiForecastTraces);

  if (!showDisclosures) {
    lastDisclosureTraceStats = { total: disclosureRows.length, candidates: 0, markers: 0 };
  }
  const disclosureTrace = showDisclosures
    ? buildDisclosureTrace(selected, seriesModels, start, end)
    : null;
  if (disclosureTrace) traces.push(disclosureTrace);
  syncDisclosureToggleButton(lastDisclosureTraceStats.markers);

  // Preserve zoom while reapplying handle transforms and updated traces.

  if (!preserveZoom) pinnedXRange = null;
  const savedXRange = preserveZoom
    ? (pinnedXRange ? [...pinnedXRange] : (el._fullLayout?.xaxis?.range?.slice() || null))
    : null;
  const savedYRange = preserveZoom ? (el._fullLayout?.yaxis?.range?.slice() || null) : null;
  const forecastEnd = aiForecastTraces
    .map((trace) => trace.x?.at(-1) || "")
    .reduce((latest, date) => date > latest ? date : latest, end);
  const defaultXRange = [start, forecastEnd];

  clearDisclosureHoverTimer();
  currentDisclosureHighlight = null;
  hoveredLineTraceIndex = null;
  activeLineTraceIndex = null;
  appliedLineHighlightTraceIndex = null;
  const layout = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    margin: { l: 42, r: 42, t: 28, b: 32 },
    hovermode: hoverShowPopup ? "x unified" : false,
    showlegend: false,
    legend: { orientation: "h", x: 0, y: 1.08, font: { color: "rgba(255,255,255,0.7)", size: 11 } },
    xaxis: { showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, color: "#666", tickfont: { size: 10 }, fixedrange: false, showspikes: false, hoverformat: "%Y.%-m.%-d", ...(savedXRange ? { range: savedXRange } : { range: defaultXRange, autorange: false }) },
    yaxis: { showticklabels: false, title: "", showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, fixedrange: true, ...(savedYRange ? { range: savedYRange, autorange: false } : {}) },
    font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: plotlyHoverLabel(),
    dragmode: false,
  };
  const renderMode = await applyMainChartRender(el, traces, layout);

  if (!legendHandlerSet) {
    el.on("plotly_legendclick", (evtData) => {
      const idx = evtData.curveNumber;
      const key = currentSelected[idx];
      if (key) {
        if (hiddenSeries.has(key)) hiddenSeries.delete(key);
        else hiddenSeries.add(key);
      }
      Plotly.restyle(el, { visible: hiddenSeries.has(key) ? "legendonly" : true }, [idx]);
      saveState();
      updateHandles();
      return false;
    });
    el.on("plotly_legenddoubleclick", () => {
      hiddenSeries.clear();
      Plotly.restyle(el, { visible: currentSelected.map(() => true) });
      saveState();
      updateHandles();
      return false;
    });
    el.on("plotly_relayout", (eventData) => {
      const rangePair = Array.isArray(eventData["xaxis.range"]) ? eventData["xaxis.range"] : null;
      const hasRange = (eventData["xaxis.range[0]"] != null && eventData["xaxis.range[1]"] != null)
        || (Array.isArray(rangePair) && rangePair.length === 2);
      const hasAuto = eventData["xaxis.autorange"] === true;
      if (chartSyncing || isHandleDragging) return;
      if (cursorSyncing && !hasRange && !hasAuto) return;
      scheduleHandleUpdate();
      // Sync main chart pan/zoom to ADR chart x-axis.
      const syncedCharts = [
        document.getElementById("chart-macd"),
        document.getElementById("chart-adr"),
      ].filter((target) => target?.data && !target.hidden);
      if (syncedCharts.length) {
        const r0 = eventData["xaxis.range[0]"] ?? (Array.isArray(rangePair) ? rangePair[0] : null);
        const r1 = eventData["xaxis.range[1]"] ?? (Array.isArray(rangePair) ? rangePair[1] : null);
        if (r0 != null && r1 != null) {
          pinnedXRange = [r0, r1];
          syncedCharts.forEach((target) => {
            scheduleViewportRangeSync(target, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 });
          });
        } else if (hasAuto) {
          pinnedXRange = null;
          const mainRange = el._fullLayout?.xaxis?.range?.slice();
          if (Array.isArray(mainRange) && mainRange.length === 2) {
            syncedCharts.forEach((target) => {
              scheduleViewportRangeSync(target, { "xaxis.range[0]": mainRange[0], "xaxis.range[1]": mainRange[1] });
            });
          } else {
            syncedCharts.forEach((target) => scheduleViewportRangeSync(target, { "xaxis.autorange": true }));
          }
        }
      }
    });
    el.on("plotly_hover", (eventData) => {
      scheduleDisclosureHoverHighlight(eventData);
      if (!hoverShowPopup || hoverSyncing) return;
      const xValue = eventData?.points?.[0]?.x;
      if (!xValue) return;
      const macdEl = document.getElementById("chart-macd");
      const adrEl = document.getElementById("chart-adr");
      if (!macdEl?.hidden) syncHoverToChart(macdEl, xValue);
      syncHoverToChart(adrEl, xValue);
    });
    el.on("plotly_unhover", () => {
      resetDisclosureHoverHighlight(el);
      if (!hoverShowPopup || hoverSyncing) return;
      const macdEl = document.getElementById("chart-macd");
      const adrEl = document.getElementById("chart-adr");
      clearHoverOnChart(macdEl);
      clearHoverOnChart(adrEl);
    });
    el.on("plotly_click", (evtData) => {
      if (Date.now() < suppressPlotlyClickUntil) return;
      if (handleDisclosureClick(evtData)) return;
      // iPhone Safari sends click after touchend; if we auto-reset here,
      // double-tap zoom is immediately cancelled when the finger is lifted.
      if (isTouchDevice()) return;
      Plotly.relayout(el, { "xaxis.autorange": true, "yaxis.autorange": true });
    });
    legendHandlerSet = true;
  }

  updateHandles();
  const mainRangeForAdr = el._fullLayout?.xaxis?.range?.slice() || (savedXRange ? [...savedXRange] : null);
  renderMacdChart(mainRangeForAdr ? [...mainRangeForAdr] : null).catch(() => {});
  renderAdrChart(mainRangeForAdr ? [...mainRangeForAdr] : null);
  bindCursorMoveSync();
  recordPerfSample("renderChart", perfStartedAt, {
    rows: rows.length,
    displayRows: displayPointCount,
    series: selected.length,
    disclosures: lastDisclosureTraceStats.markers,
    cacheHit: lastMainChartModelCacheHit,
    modelSource: lastMainChartModelSource,
    renderMode,
  });
}

function getMacdModelForSeries(series) {
  const ticker = String(series || "").toUpperCase();
  if (!MACD_STOCK_PATTERN.test(ticker)) return null;
  const records = Array.isArray(pricePayload?.records) ? pricePayload.records : [];
  const latest = records.at(-1);
  const cacheKey = [
    dataRevisionSignature("price"),
    ticker,
    records.length,
    latest?.date || "",
    latest?.[ticker] ?? "",
  ].join("|");
  if (macdModelCache.has(cacheKey)) return macdModelCache.get(cacheKey);

  const model = buildMacdOscillator({
    dates: records.map((row) => row?.date),
    prices: records.map((row) => row?.[ticker]),
  });
  macdModelCache.set(cacheKey, model);
  while (macdModelCache.size > 40) macdModelCache.delete(macdModelCache.keys().next().value);
  return model;
}

async function renderMacdChart(xRange) {
  const perfStartedAt = startPerfSample();
  const el = document.getElementById("chart-macd");
  if (!el) return;
  if (!showMacdOscillator) {
    el.hidden = true;
    lastMacdTraceCount = 0;
    syncMacdToggleButton(0);
    return;
  }

  el.hidden = false;
  const visibleSeries = (currentMainChartModel?.seriesModels || [])
    .map((model) => String(model?.series || "").toUpperCase())
    .filter((series) => MACD_STOCK_PATTERN.test(series) && !hiddenSeries.has(series));
  const renderKey = [
    activeMonths,
    hoverShowPopup ? 1 : 0,
    dataRevisionSignature("price"),
    visibleSeries.join(","),
  ].join("::");
  if (lastMacdRenderKey === renderKey && el.data?.length) {
    if (Array.isArray(xRange) && xRange.length === 2 && !xRangeMatches(el, xRange[0], xRange[1])) {
      scheduleViewportRangeSync(el, { "xaxis.range[0]": xRange[0], "xaxis.range[1]": xRange[1] });
    }
    return;
  }

  const width = Math.max(320, el.getBoundingClientRect?.().width || 900);
  const pointBudget = Math.max(320, Math.min(1400, Math.round(width * 1.35)));
  const traces = [];
  const allValues = [];
  visibleSeries.forEach((series) => {
    const model = getMacdModelForSeries(series);
    if (!model) return;
    const displayDates = [];
    const displayValues = [];
    model.dates.forEach((date, index) => {
      if ((currentStart && date < currentStart) || (currentEnd && date > currentEnd)) return;
      const value = model.normalized[index];
      if (!Number.isFinite(value)) return;
      displayDates.push(date);
      displayValues.push(value);
    });
    if (!displayValues.length) return;
    const thinned = thinMacdPoints(displayDates, displayValues, pointBudget);
    const baseColor = seriesColor(series);
    allValues.push(...thinned.values.filter(Number.isFinite));
    traces.push({
      x: thinned.dates,
      y: thinned.values,
      type: "bar",
      name: labelName(series),
      marker: {
        color: baseColor,
        line: { width: 0 },
      },
      opacity: visibleSeries.length > 1 ? 0.78 : 0.9,
      hoverinfo: hoverShowPopup ? undefined : "skip",
      hovertemplate: hoverShowPopup
        ? "%{x|%Y.%-m.%-d}<br>오실레이터 %{y:.3f}%<extra>%{fullData.name}</extra>"
        : undefined,
      meta: { macdSeriesKey: series, macdSignal: model.signal },
    });
  });

  lastMacdTraceCount = traces.length;
  syncMacdToggleButton(traces.length);
  const maxAbs = allValues.length
    ? Math.max(0.02, ...allValues.map((value) => Math.abs(value)))
    : 1;
  const layout = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    margin: { l: 42, r: 42, t: 34, b: 30 },
    hovermode: hoverShowPopup ? "x unified" : false,
    showlegend: traces.length > 0,
    legend: {
      orientation: "h", x: 0.5, y: 1.18, xanchor: "center",
      font: { color: "rgba(255,255,255,0.72)", size: 10 },
    },
    barmode: "overlay",
    bargap: 0,
    shapes: [{
      type: "line", xref: "paper", yref: "y",
      x0: 0, x1: 1, y0: 0, y1: 0,
      line: { color: "rgba(255,255,255,0.42)", width: 1, dash: "dot" },
    }],
    annotations: traces.length ? [{
      xref: "paper", yref: "paper", x: 0, y: 1.18,
      xanchor: "left", yanchor: "middle",
      text: "MACD",
      showarrow: false,
      font: { color: "rgba(255,255,255,0.72)", size: 11 },
    }] : [{
      xref: "paper", yref: "paper", x: 0.5, y: 0.5,
      text: "표시 중인 종목의 MACD 이력이 부족합니다.",
      showarrow: false,
      font: { color: "rgba(255,255,255,0.55)", size: 11 },
    }],
    xaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1,
      zeroline: false, color: "#666", tickfont: { size: 9 }, fixedrange: false,
      showspikes: false, hoverformat: "%Y.%-m.%-d",
      ...(Array.isArray(xRange) && xRange.length === 2 ? { range: xRange } : {}),
    },
    yaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.055)", gridwidth: 1,
      zeroline: false, color: "#777", tickfont: { size: 9 }, ticksuffix: "%",
      tickformat: ".2f", fixedrange: true, range: [-maxAbs * 1.08, maxAbs * 1.08],
    },
    font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: plotlyHoverLabel(11),
    dragmode: false,
  };

  await Plotly.react(el, traces, layout, PLOTLY_CONFIG);
  lastMacdRenderKey = renderKey;
  if (!macdHandlerSet) {
    el.on("plotly_relayout", (eventData) => {
      if (chartSyncing) return;
      const rangePair = Array.isArray(eventData["xaxis.range"]) ? eventData["xaxis.range"] : null;
      const r0 = eventData["xaxis.range[0]"] ?? rangePair?.[0];
      const r1 = eventData["xaxis.range[1]"] ?? rangePair?.[1];
      if (r0 == null || r1 == null) return;
      pinnedXRange = [r0, r1];
      [document.getElementById("chart"), document.getElementById("chart-adr")]
        .filter((target) => target?.data)
        .forEach((target) => scheduleViewportRangeSync(target, {
          "xaxis.range[0]": r0,
          "xaxis.range[1]": r1,
        }));
    });
    el.on("plotly_hover", (eventData) => {
      if (!hoverShowPopup || hoverSyncing) return;
      const xValue = eventData?.points?.[0]?.x;
      if (!xValue) return;
      syncHoverToChart(document.getElementById("chart"), xValue);
      syncHoverToChart(document.getElementById("chart-adr"), xValue);
    });
    el.on("plotly_unhover", () => {
      if (!hoverShowPopup || hoverSyncing) return;
      clearHoverOnChart(document.getElementById("chart"));
      clearHoverOnChart(document.getElementById("chart-adr"));
    });
    macdHandlerSet = true;
  }
  recordPerfSample("renderMacdChart", perfStartedAt, {
    traces: traces.length,
    points: traces.reduce((sum, trace) => sum + (trace.x?.length || 0), 0),
  });
}

/* ADR sub-chart rendering (source: adrinfo.kr) */

// Threshold zone styling for ADR visualization.
const ADR_ZONE_LOW_COLOR   = "#b0c6ed";   // < 80
const ADR_ZONE_HIGH_COLOR  = "#e6adad";   // > 120
const ADR_BAND_COLOR       = "rgba(100,100,100,0.06)";
const ADR_LOW_THRESH  = 80;
const ADR_HIGH_THRESH = 120;
const FEAR_GREED_LOW_THRESH = 25;
const FEAR_GREED_HIGH_THRESH = 75;
const NEWS_SENTIMENT_LOW_THRESH = 90;
const NEWS_SENTIMENT_HIGH_THRESH = 110;
const AUXILIARY_SERIES_KEYS = Object.freeze({
  adrKospi: "adr_kospi",
  adrKosdaq: "adr_kosdaq",
  fearGreed: "fear_greed",
  newsSentiment: "news_sentiment",
});

/**
 * Build ADR overlay traces with segmented zones.
 *   - below 80  : low-risk/oversold zone fill
 *   - 80 ~ 120  : neutral zone line
 *   - above 120 : high-risk/overheated zone fill
 *
 * Uses threshold baselines with fill="tonexty" to avoid filling toward y=0.
 */
function buildAdrZoneTraces(dates, zoneModel, mainColor, legendName, seriesKey) {
  const base = {
    x: dates,
    type: "scatter",
    mode: "lines",
    connectgaps: false,
    meta: { auxiliarySeriesKey: seriesKey },
    visible: hiddenAuxiliarySeries.has(seriesKey) ? "legendonly" : true,
  };
  const noHover = { hoverinfo: "skip", hovertemplate: undefined };
  const {
    low: yLow,
    middle: yMid,
    high: yHigh,
    lowBaseline: yBaseLow,
    highBaseline: yBaseHigh,
  } = zoneModel;

  return [
    // Low zone fill (< 80)
    { ...base, y: yBaseLow,  showlegend: false, legendgroup: legendName,
      line: { color: "transparent", width: 0 }, ...noHover },
    { ...base, mode: "lines+markers", y: yLow, name: legendName, showlegend: true, legendgroup: legendName,
      line: { color: ADR_ZONE_LOW_COLOR, width: 1.5 },
      marker: { symbol: "circle", size: 7, color: mainColor },
      fill: "tonexty", fillcolor: "rgba(176,198,237,0.15)", ...noHover },

    // Mid zone line (80~120)
    { ...base, y: yMid, name: legendName, showlegend: false, legendgroup: legendName,
      line: { color: mainColor, width: 2 }, ...noHover },

    // High zone fill (> 120)
    { ...base, y: yBaseHigh, showlegend: false, legendgroup: legendName,
      line: { color: "transparent", width: 0 }, ...noHover },
    { ...base, y: yHigh, name: legendName, showlegend: false, legendgroup: legendName,
      line: { color: ADR_ZONE_HIGH_COLOR, width: 1.5 },
      fill: "tonexty", fillcolor: "rgba(230,173,173,0.15)", ...noHover },
  ];
}

let adrRows = [];   // ADR daily records (seed file + live append)

const ADR_SOURCE_URL = "http://www.adrinfo.kr/chart";
const CORS_PROXY     = "https://corsproxy.io/?url=";

function findLatestAuxiliaryDate(rows, key = "") {
  for (let index = (rows?.length || 0) - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.date && (!key || toNum(row[key]) !== null)) return row.date;
  }
  return "";
}

async function getAuxiliaryChartModel(renderKey, startDate) {
  if (auxiliaryChartCalcCache?.key === renderKey) return auxiliaryChartCalcCache.model;
  if (auxiliaryChartCalcPending?.key === renderKey) return auxiliaryChartCalcPending.promise;

  const payload = {
    datasetKey: dataRevisionSignature("adr", "macro"),
    sources: { adrRows, macroRows },
    startDate,
    adrLowThreshold: ADR_LOW_THRESH,
    adrHighThreshold: ADR_HIGH_THRESH,
    newsLowThreshold: NEWS_SENTIMENT_LOW_THRESH,
    newsHighThreshold: NEWS_SENTIMENT_HIGH_THRESH,
  };
  const promise = (async () => {
    let model = null;
    try {
      model = await requestChartModelFromWorker(payload, "buildAuxiliaryChartModel");
      if (!model) return null;
      lastAuxiliaryChartModelSource = "worker";
    } catch (_) {
      model = buildAuxiliaryChartModelSync({
        ...payload,
        adrRows,
        macroRows,
      });
      lastAuxiliaryChartModelSource = "sync";
    }
    auxiliaryChartCalcCache = { key: renderKey, model };
    return model;
  })();
  auxiliaryChartCalcPending = { key: renderKey, promise };
  try {
    return await promise;
  } finally {
    if (auxiliaryChartCalcPending?.promise === promise) auxiliaryChartCalcPending = null;
  }
}

async function renderAdrChart(xRange) {
  const perfStartedAt = startPerfSample();
  const el = document.getElementById("chart-adr");
  const latestAdrDate = findLatestAuxiliaryDate(adrRows);
  const latestNewsDate = findLatestAuxiliaryDate(macroRows, "news_sentiment");
  if (!el || (!latestAdrDate && !latestNewsDate)) return;

  const renderKey = [
    activeMonths,
    hoverShowPopup ? 1 : 0,
    dataRevisionSignature("adr", "macro"),
  ].join("::");
  if (lastAdrRenderKey === renderKey && el.data?.length) {
    if (Array.isArray(xRange) && xRange.length === 2 && !xRangeMatches(el, xRange[0], xRange[1])) {
      chartSyncing = true;
      Promise.resolve(Plotly.relayout(el, {
        "xaxis.range[0]": xRange[0],
        "xaxis.range[1]": xRange[1],
      })).catch(() => {}).finally(() => {
        chartSyncing = false;
      });
    }
    recordPerfSample("renderAdrChart", perfStartedAt, { rows: el.data[0]?.x?.length || 0, cacheHit: true });
    return;
  }

  const maxDate = [latestAdrDate, latestNewsDate].filter(Boolean).sort().slice(-1)[0];
  const startDate = shiftMonths(maxDate, activeMonths);
  const renderGeneration = ++auxiliaryChartRenderGeneration;
  const model = await getAuxiliaryChartModel(renderKey, startDate);
  if (!model || renderGeneration !== auxiliaryChartRenderGeneration) return;
  const {
    dates,
    kospiValues: kospiVals,
    kosdaqValues: kosdaqVals,
    fearGreedValues: fearGreedVals,
    newsDates,
    newsValues: newsSentimentVals,
    kospiZones,
    kosdaqZones,
    adrYMin,
    adrYMax,
    newsYMin,
    newsYMax,
    adrRowCount,
    newsRowCount,
  } = model;
  if (!adrRowCount && !newsRowCount) return;

  const hoverProxyTraces = [
    {
      x: dates,
      y: dates.map((_, i) => {
        const k = kospiVals[i];
        const q = kosdaqVals[i];
        return Number.isFinite(k) ? k : (Number.isFinite(q) ? q : null);
      }),
      customdata: dates.map((_, i) => [
        Number.isFinite(kospiVals[i]) ? `${kospiVals[i].toFixed(2)}%` : "N/A",
        Number.isFinite(kosdaqVals[i]) ? `${kosdaqVals[i].toFixed(2)}%` : "N/A",
        Number.isFinite(fearGreedVals[i]) ? fearGreedVals[i].toFixed(0) : "N/A",
      ]),
      type: "scatter",
      mode: "lines",
      name: "ADR HOVER",
      showlegend: false,
      connectgaps: false,
      line: { color: "rgba(0,0,0,0)", width: 1 },
      hoverinfo: hoverShowPopup ? undefined : "skip",
      hovertemplate: hoverShowPopup ? "KOSPI. %{customdata[0]}<br>KOSDAQ. %{customdata[1]}<br>공포탐욕. %{customdata[2]}<extra></extra>" : undefined,
    },
  ];

  const traces = [
    ...buildAdrZoneTraces(
      dates,
      kospiZones,
      "#facc15",
      "ADR KOSPI",
      AUXILIARY_SERIES_KEYS.adrKospi,
    ),
    ...buildAdrZoneTraces(
      dates,
      kosdaqZones,
      "#f472b6",
      "ADR KOSDAQ",
      AUXILIARY_SERIES_KEYS.adrKosdaq,
    ),
    {
      x: dates,
      y: fearGreedVals,
      yaxis: "y2",
      type: "scatter",
      mode: "lines",
      name: "공포탐욕",
      meta: { auxiliarySeriesKey: AUXILIARY_SERIES_KEYS.fearGreed },
      visible: hiddenAuxiliarySeries.has(AUXILIARY_SERIES_KEYS.fearGreed) ? "legendonly" : true,
      connectgaps: false,
      line: { color: SERIES_COLORS.fear_greed, width: 2 },
      hoverinfo: "skip",
    },
    {
      x: newsDates,
      y: newsSentimentVals,
      yaxis: "y3",
      type: "scatter",
      mode: "lines",
      name: "뉴스심리",
      meta: { auxiliarySeriesKey: AUXILIARY_SERIES_KEYS.newsSentiment },
      visible: hiddenAuxiliarySeries.has(AUXILIARY_SERIES_KEYS.newsSentiment) ? "legendonly" : true,
      connectgaps: false,
      line: { color: SERIES_COLORS.news_sentiment, width: 2 },
      hoverinfo: hoverShowPopup ? undefined : "skip",
      hovertemplate: hoverShowPopup ? "뉴스심리. %{y:.2f}<extra></extra>" : undefined,
    },
    ...hoverProxyTraces,
  ];

  const layout = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    // Keep left/right margins identical with the main chart so synced cursor lines
    // stay visually aligned across the full width (especially near edges).
    margin: { l: 42, r: 42, t: 14, b: 36 },
    hovermode: hoverShowPopup ? "x unified" : false,
    showlegend: true,
    legend: {
      orientation: "h", x: 0.5, y: 1.12, xanchor: "center",
      font: { color: "rgba(255,255,255,0.7)", size: 10 },
    },
    shapes: [
      // Highlight neutral ADR band (80~120)
      {
        type: "rect", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_HIGH_THRESH,
        fillcolor: ADR_BAND_COLOR, line: { width: 0 }, layer: "below",
      },
      // 80% reference line
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_LOW_THRESH,
        line: { color: ADR_ZONE_LOW_COLOR, width: 0.9, dash: "dash" },
      },
      // 120% reference line
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_HIGH_THRESH, y1: ADR_HIGH_THRESH,
        line: { color: ADR_ZONE_HIGH_COLOR, width: 0.9, dash: "dash" },
      },
      // 100% center line
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: 100, y1: 100,
        line: { color: "rgba(255,255,255,0.15)", width: 0.8, dash: "dot" },
      },
      {
        type: "line", xref: "paper", yref: "paper",
        x0: 0, x1: 1, y0: 0.54, y1: 0.54,
        line: { color: "rgba(255,255,255,0.24)", width: 1 },
      },
      {
        type: "rect", xref: "paper", yref: "y2",
        x0: 0, x1: 1, y0: 0, y1: FEAR_GREED_LOW_THRESH,
        fillcolor: "rgba(176,198,237,0.12)", line: { width: 0 }, layer: "below",
      },
      {
        type: "rect", xref: "paper", yref: "y2",
        x0: 0, x1: 1, y0: FEAR_GREED_HIGH_THRESH, y1: 100,
        fillcolor: "rgba(230,173,173,0.12)", line: { width: 0 }, layer: "below",
      },
      {
        type: "line", xref: "paper", yref: "y2",
        x0: 0, x1: 1, y0: FEAR_GREED_LOW_THRESH, y1: FEAR_GREED_LOW_THRESH,
        line: { color: ADR_ZONE_LOW_COLOR, width: 0.9, dash: "dash" },
      },
      {
        type: "line", xref: "paper", yref: "y2",
        x0: 0, x1: 1, y0: 50, y1: 50,
        line: { color: "rgba(255,255,255,0.15)", width: 0.8, dash: "dot" },
      },
      {
        type: "line", xref: "paper", yref: "y2",
        x0: 0, x1: 1, y0: FEAR_GREED_HIGH_THRESH, y1: FEAR_GREED_HIGH_THRESH,
        line: { color: ADR_ZONE_HIGH_COLOR, width: 0.9, dash: "dash" },
      },
      {
        type: "line", xref: "paper", yref: "paper",
        x0: 0, x1: 1, y0: 0.25, y1: 0.25,
        line: { color: "rgba(255,255,255,0.24)", width: 1 },
      },
      {
        type: "rect", xref: "paper", yref: "y3",
        x0: 0, x1: 1, y0: newsYMin, y1: NEWS_SENTIMENT_LOW_THRESH,
        fillcolor: "rgba(176,198,237,0.12)", line: { width: 0 }, layer: "below",
      },
      {
        type: "rect", xref: "paper", yref: "y3",
        x0: 0, x1: 1, y0: NEWS_SENTIMENT_HIGH_THRESH, y1: newsYMax,
        fillcolor: "rgba(230,173,173,0.12)", line: { width: 0 }, layer: "below",
      },
      {
        type: "line", xref: "paper", yref: "y3",
        x0: 0, x1: 1, y0: NEWS_SENTIMENT_LOW_THRESH, y1: NEWS_SENTIMENT_LOW_THRESH,
        line: { color: ADR_ZONE_LOW_COLOR, width: 0.9, dash: "dash" },
      },
      {
        type: "line", xref: "paper", yref: "y3",
        x0: 0, x1: 1, y0: 100, y1: 100,
        line: { color: "rgba(255,255,255,0.15)", width: 0.8, dash: "dot" },
      },
      {
        type: "line", xref: "paper", yref: "y3",
        x0: 0, x1: 1, y0: NEWS_SENTIMENT_HIGH_THRESH, y1: NEWS_SENTIMENT_HIGH_THRESH,
        line: { color: ADR_ZONE_HIGH_COLOR, width: 0.9, dash: "dash" },
      },
    ],
    annotations: [
      {
        xref: "paper", yref: "y", x: 1.01, y: ADR_LOW_THRESH,
        text: "80%", showarrow: false, xanchor: "left",
        font: { color: ADR_ZONE_LOW_COLOR, size: 9 },
      },
      {
        xref: "paper", yref: "y", x: 1.01, y: ADR_HIGH_THRESH,
        text: "120%", showarrow: false, xanchor: "left",
        font: { color: ADR_ZONE_HIGH_COLOR, size: 9 },
      },
      {
        xref: "paper", yref: "y2", x: 1.01, y: FEAR_GREED_LOW_THRESH,
        text: "공포", showarrow: false, xanchor: "left",
        font: { color: ADR_ZONE_LOW_COLOR, size: 9 },
      },
      {
        xref: "paper", yref: "y2", x: 1.01, y: FEAR_GREED_HIGH_THRESH,
        text: "탐욕", showarrow: false, xanchor: "left",
        font: { color: ADR_ZONE_HIGH_COLOR, size: 9 },
      },
      {
        xref: "paper", yref: "y3", x: 1.01, y: NEWS_SENTIMENT_LOW_THRESH,
        text: "부정", showarrow: false, xanchor: "left",
        font: { color: ADR_ZONE_LOW_COLOR, size: 9 },
      },
      {
        xref: "paper", yref: "y3", x: 1.01, y: NEWS_SENTIMENT_HIGH_THRESH,
        text: "긍정", showarrow: false, xanchor: "left",
        font: { color: ADR_ZONE_HIGH_COLOR, size: 9 },
      },
    ],
    xaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1,
      zeroline: false, color: "#666", tickfont: { size: 9 },
      fixedrange: false,
      anchor: "y3",
      showspikes: false,
      hoverformat: "%Y, %-m, %-d",
      ...(xRange ? { range: xRange } : {}),
    },
    yaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1,
      zeroline: false, color: "#666", tickfont: { size: 9 },
      fixedrange: true, ticksuffix: "%",
      tickformat: ".0f",
      autorange: false,
      range: [adrYMin, adrYMax],
      domain: [0.58, 1],
    },
    yaxis2: {
      showgrid: false,
      zeroline: false,
      color: "#777",
      tickfont: { size: 9 },
      tickvals: [0, FEAR_GREED_LOW_THRESH, 50, FEAR_GREED_HIGH_THRESH, 100],
      fixedrange: true,
      range: [0, 100],
      domain: [0.29, 0.50],
    },
    yaxis3: {
      showgrid: false,
      zeroline: false,
      color: "#777",
      tickfont: { size: 9 },
      tickvals: [NEWS_SENTIMENT_LOW_THRESH, 100, NEWS_SENTIMENT_HIGH_THRESH],
      fixedrange: true,
      range: [newsYMin, newsYMax],
      domain: [0, 0.21],
    },
    font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: plotlyHoverLabel(11),
    dragmode: false,
  };

  lastAdrRenderKey = renderKey;
  try {
    await Plotly.react(el, traces, layout, PLOTLY_CONFIG);
  } catch (error) {
    if (lastAdrRenderKey === renderKey) lastAdrRenderKey = "";
    throw error;
  }

  if (!adrHandlerSet) {
    el.on("plotly_legendclick", (eventData) => {
      const key = el.data?.[eventData?.curveNumber]?.meta?.auxiliarySeriesKey;
      if (!key) return true;
      if (hiddenAuxiliarySeries.has(key)) hiddenAuxiliarySeries.delete(key);
      else hiddenAuxiliarySeries.add(key);
      const indexes = el.data
        .map((trace, index) => trace?.meta?.auxiliarySeriesKey === key ? index : -1)
        .filter((index) => index >= 0);
      Plotly.restyle(
        el,
        { visible: hiddenAuxiliarySeries.has(key) ? "legendonly" : true },
        indexes,
      );
      saveState();
      return false;
    });
    el.on("plotly_legenddoubleclick", () => false);
    el.on("plotly_relayout", (eventData) => {
      const rangePair = Array.isArray(eventData["xaxis.range"]) ? eventData["xaxis.range"] : null;
      const hasRange = (eventData["xaxis.range[0]"] != null && eventData["xaxis.range[1]"] != null)
        || (Array.isArray(rangePair) && rangePair.length === 2);
      const hasAuto = eventData["xaxis.autorange"] === true;
      if (chartSyncing) return;
      if (cursorSyncing && !hasRange && !hasAuto) return;
      scheduleHandleUpdate();
      const syncedCharts = [
        document.getElementById("chart"),
        document.getElementById("chart-macd"),
      ].filter((target) => target?.data && !target.hidden);
      if (syncedCharts.length) {
        const r0 = eventData["xaxis.range[0]"] ?? (Array.isArray(rangePair) ? rangePair[0] : null);
        const r1 = eventData["xaxis.range[1]"] ?? (Array.isArray(rangePair) ? rangePair[1] : null);
        if (r0 != null && r1 != null) {
          pinnedXRange = [r0, r1];
          syncedCharts.forEach((target) => scheduleViewportRangeSync(target, {
            "xaxis.range[0]": r0,
            "xaxis.range[1]": r1,
          }));
        } else if (hasAuto) {
          pinnedXRange = null;
          const adrRange = el._fullLayout?.xaxis?.range?.slice();
          if (Array.isArray(adrRange) && adrRange.length === 2) {
            syncedCharts.forEach((target) => scheduleViewportRangeSync(target, {
              "xaxis.range[0]": adrRange[0],
              "xaxis.range[1]": adrRange[1],
            }));
          } else {
            syncedCharts.forEach((target) => scheduleViewportRangeSync(target, { "xaxis.autorange": true }));
          }
        }
      }
    });
    el.on("plotly_hover", (eventData) => {
      if (!hoverShowPopup || hoverSyncing) return;
      const xValue = eventData?.points?.[0]?.x;
      if (!xValue) return;
      const mainEl = document.getElementById("chart");
      const macdEl = document.getElementById("chart-macd");
      syncHoverToChart(mainEl, xValue);
      if (!macdEl?.hidden) syncHoverToChart(macdEl, xValue);
    });
    el.on("plotly_unhover", () => {
      if (!hoverShowPopup || hoverSyncing) return;
      const mainEl = document.getElementById("chart");
      const macdEl = document.getElementById("chart-macd");
      clearHoverOnChart(mainEl);
      clearHoverOnChart(macdEl);
    });
    adrHandlerSet = true;
  }
  recordPerfSample("renderAdrChart", perfStartedAt, {
    rows: adrRowCount,
    newsRows: newsRowCount,
    cacheHit: false,
    modelSource: lastAuxiliaryChartModelSource,
  });
}

function syncButtons() {
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.months) === activeMonths);
  });
}

function toYyyymm(dateObj) {
  const year = dateObj.getUTCFullYear();
  const month = `${dateObj.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}${month}`;
}

function monthCodeToDate(code) {
  const raw = String(code || "").trim();
  if (!/^\d{6}$/.test(raw)) return "";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-01`;
}

function dayCodeToDate(code) {
  const raw = String(code || "").trim();
  if (!/^\d{8}$/.test(raw)) return "";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function normalizeLeadingRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const value = toNum(row?.leading_cycle);
    if (!date || !Number.isFinite(value)) return;
    map.set(date, { date, leading_cycle: value });
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeNewsSentimentRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const value = toNum(row?.news_sentiment);
    if (!date || !Number.isFinite(value)) return;
    map.set(date, { date, news_sentiment: value });
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeCreditRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    const next = { date };
    CREDIT_COLS.forEach((key) => { next[key] = toNum(row?.[key]); });
    if (!CREDIT_COLS.some((key) => Number.isFinite(next[key]))) return;
    const prev = map.get(date) || { date };
    const merged = { date };
    CREDIT_COLS.forEach((key) => {
      merged[key] = Number.isFinite(next[key]) ? next[key] : (prev[key] ?? null);
    });
    map.set(date, merged);
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sameNullableNumber(a, b) {
  const na = toNum(a);
  const nb = toNum(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  return Math.abs(na - nb) <= 1e-9;
}

async function fetchJsonWithProxyFallback(url, init = null, options = {}) {
  const allowProxy = options?.allowProxy !== false;
  const candidates = allowProxy ? [url, CORS_PROXY + encodeURIComponent(url)] : [url];
  let lastError = "Request failed";
  for (const target of candidates) {
    try {
      const requestInit = { cache: "no-store", ...(init || {}) };
      const res = await fetchWithTimeout(target, requestInit);
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const text = await res.text();
      if (!text) {
        lastError = "Empty response";
        continue;
      }
      return JSON.parse(text);
    } catch (err) {
      if (isAbortError(err) || init?.signal?.aborted) throw err;
      lastError = err?.message || String(err);
    }
  }
  throw new Error(lastError);
}
function parseKofiaAmountToTrillion(rawValue) {
  const n = Number(String(rawValue ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 1e12) * 10000) / 10000;
}

async function fetchKofiaFundSeriesLive(apiKey, endpoint, itemMapper, signal = null) {
  const clean = String(apiKey || "").trim();
  if (!clean) return [];

  const keyCandidates = [clean];
  try {
    const decoded = decodeURIComponent(clean);
    if (decoded && decoded !== clean) keyCandidates.push(decoded);
  } catch (_) {
    // ignore
  }

  let lastError = null;

  for (const serviceKey of [...new Set(keyCandidates)]) {
    try {
      const rows = [];
      const numOfRows = 1000;
      const pageMeta = new Map();

      const fetchPage = async (pageNo) => {
        if (!Number.isFinite(pageNo) || pageNo < 1) return null;
        if (pageMeta.has(pageNo)) return pageMeta.get(pageNo);

        const query = new URLSearchParams({
          serviceKey,
          numOfRows: String(numOfRows),
          pageNo: String(pageNo),
          resultType: "json",
        });
        const url = appendCacheBust(`${endpoint}?${query.toString()}`);
        const payload = await fetchJsonWithProxyFallback(url, { signal }, { allowProxy: false });

        const header = payload?.response?.header || {};
        if (header.resultCode && header.resultCode !== "00") {
          if (pageNo > 1) {
            const empty = { totalCount: 0, rowsPerPage: numOfRows, currentPage: pageNo, itemCount: 0 };
            pageMeta.set(pageNo, empty);
            return empty;
          }
          throw new Error(header.resultMsg || "KOFIA API error");
        }

        const body = payload?.response?.body || {};
        const rawItems = body?.items?.item;
        const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);

        items.forEach((item) => {
          const mapped = itemMapper(item);
          if (mapped) rows.push(mapped);
        });

        const totalCount = Number(body?.totalCount);
        const bodyNumRows = Number(body?.numOfRows);
        const rowsPerPage = Number.isFinite(bodyNumRows) && bodyNumRows > 0
          ? bodyNumRows
          : (items.length || numOfRows);
        const currentPage = Number(body?.pageNo) || pageNo;

        const meta = {
          totalCount: Number.isFinite(totalCount) ? totalCount : 0,
          rowsPerPage,
          currentPage,
          itemCount: items.length,
        };
        pageMeta.set(pageNo, meta);
        return meta;
      };

      const firstMeta = await fetchPage(1);
      if (!firstMeta || !firstMeta.itemCount) {
        const normalized = normalizeCreditRows(rows);
        if (normalized.length) return normalized;
        continue;
      }

      let lastPage = 1;
      if (Number.isFinite(firstMeta.totalCount) && firstMeta.totalCount > 0) {
        const rowsPerPage = Math.max(1, Number(firstMeta.rowsPerPage) || numOfRows);
        lastPage = Math.max(1, Math.ceil(firstMeta.totalCount / rowsPerPage));
      } else {
        let low = 1;
        let high = 2;
        let highMeta = await fetchPage(high);
        const maxProbe = 4096;

        while (highMeta && highMeta.itemCount > 0 && high < maxProbe) {
          low = high;
          high *= 2;
          highMeta = await fetchPage(high);
        }

        if (highMeta && highMeta.itemCount > 0) {
          lastPage = high;
        } else {
          let lo = low;
          let hi = high;
          while (lo + 1 < hi) {
            const mid = Math.floor((lo + hi) / 2);
            const midMeta = await fetchPage(mid);
            if (midMeta && midMeta.itemCount > 0) lo = mid;
            else hi = mid;
          }
          lastPage = lo;
        }
      }

      const pagesToFetch = [2, 3, lastPage, lastPage - 1, lastPage - 2, lastPage - 3]
        .filter((p) => Number.isFinite(p) && p > 1);

      for (const page of pagesToFetch) {
        await fetchPage(page);
      }

      const normalized = normalizeCreditRows(rows);
      if (normalized.length) return normalized;
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function fetchKofiaCreditLive(apiKey, signal = null) {
  throwIfAborted(signal);
  return [];
}

async function fetchKofiaCustomerDepositLive(apiKey, signal = null) {
  throwIfAborted(signal);
  return [];
}

async function fetchFreesisCreditLive(startDate = "", endDate = "") {
  const today = new Date().toISOString().slice(0, 10);
  const safeEnd = String(endDate || "").slice(0, 10) || today;
  const safeStart = String(startDate || "").slice(0, 10)
    || shiftDays(safeEnd, -FREESIS_CREDIT_LOOKBACK_DAYS);
  const fromYmd = safeStart.replace(/-/g, "");
  const toYmd = safeEnd.replace(/-/g, "");
  if (!/^\d{8}$/.test(fromYmd) || !/^\d{8}$/.test(toYmd)) return [];

  const payload = {
    dmSearch: {
      OBJ_NM: FREESIS_CREDIT_OBJ_NM,
      tmpV1: "D",
      tmpV40: FREESIS_CREDIT_UNIT_CODE,
      tmpV45: fromYmd,
      tmpV46: toYmd,
    },
  };

  const response = await fetchJsonWithProxyFallback(
    appendCacheBust(FREESIS_CREDIT_META_URL),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload),
    },
  );

  const rows = Array.isArray(response?.ds1) ? response.ds1 : [];
  return normalizeCreditRows(rows.map((row) => ({
    date: dayCodeToDate(row?.TMPV1),
    kospi_credit: parseKofiaAmountToTrillion(row?.TMPV3),
    kosdaq_credit: parseKofiaAmountToTrillion(row?.TMPV4),
  })));
}

function applyLeadingCycleLiveRows(monthlyRows) {
  const normalized = normalizeLeadingRows(monthlyRows);
  if (!normalized.length || !pricePayload?.records?.length) return { updated: 0, latestDate: "" };

  const priceDates = (pricePayload.records || []).map((r) => r.date).filter(Boolean);
  if (!priceDates.length) return { updated: 0, latestDate: normalized[normalized.length - 1].date };

  const dense = buildDenseMacroRows(normalized, priceDates);
  if (!dense.length) return { updated: 0, latestDate: normalized[normalized.length - 1].date };

  const byDate = new Map((macroRows || []).map((row) => [row.date, { ...row }]));
  priceDates.forEach((date) => {
    if (!byDate.has(date)) byDate.set(date, { date });
  });

  let updated = 0;
  dense.forEach((row) => {
    const date = String(row.date || "").slice(0, 10);
    const value = toNum(row.leading_cycle);
    if (!date || !Number.isFinite(value)) return;
    const prev = byDate.get(date) || { date };
    if (!sameNullableNumber(prev.leading_cycle, value)) updated += 1;
    prev.leading_cycle = value;
    byDate.set(date, prev);
  });

  macroRows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (updated > 0) markDataChanged("macro");
  return { updated, latestDate: normalized[normalized.length - 1].date };
}

function applyNewsSentimentLiveRows(liveRows) {
  const normalized = normalizeNewsSentimentRows(liveRows);
  if (!normalized.length) return { updated: 0, latestDate: "" };
  const byDate = new Map((macroRows || []).map((row) => [row.date, { ...row }]));
  let updated = 0;
  normalized.forEach((row) => {
    const prev = byDate.get(row.date) || { date: row.date };
    if (!sameNullableNumber(prev.news_sentiment, row.news_sentiment)) updated += 1;
    prev.news_sentiment = row.news_sentiment;
    byDate.set(row.date, prev);
  });
  macroRows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (updated > 0) markDataChanged("macro");
  return { updated, latestDate: normalized[normalized.length - 1].date };
}

function applyCreditLiveRows(liveRows) {
  const normalized = normalizeCreditRows(liveRows);
  if (!normalized.length) return { updated: 0, latestDate: "" };

  const byDate = new Map();
  (creditRows || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    const next = { date };
    CREDIT_COLS.forEach((key) => { next[key] = toNum(row?.[key]); });
    byDate.set(date, next);
  });

  let updated = 0;
  normalized.forEach((row) => {
    const prev = byDate.get(row.date) || { date: row.date };
    const next = { date: row.date };
    CREDIT_COLS.forEach((key) => {
      const value = toNum(row[key]);
      next[key] = Number.isFinite(value) ? value : (prev[key] ?? null);
    });
    if (CREDIT_COLS.some((key) => !sameNullableNumber(prev[key], next[key]))) updated += 1;
    byDate.set(row.date, next);
  });

  creditRows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (updated > 0) markDataChanged("credit");
  const latestDate = creditRows.length
    ? String(creditRows[creditRows.length - 1].date || "").slice(0, 10)
    : normalized[normalized.length - 1].date;
  return { updated, latestDate };
}

function medianCreditScaleFactor(existingRows, liveRows, key) {
  const existingByDate = new Map();
  normalizeCreditRows(existingRows).forEach((row) => {
    existingByDate.set(row.date, row);
  });

  const ratios = [];
  normalizeCreditRows(liveRows).forEach((row) => {
    const existing = existingByDate.get(row.date);
    const existingValue = toNum(existing?.[key]);
    const liveValue = toNum(row?.[key]);
    if (Number.isFinite(existingValue) && Number.isFinite(liveValue) && liveValue > 0) {
      ratios.push(existingValue / liveValue);
    }
  });

  if (!ratios.length) return 1;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const factor = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function scaleCreditRowsToExisting(liveRows, existingRows) {
  const normalized = normalizeCreditRows(liveRows);
  if (!normalized.length) return normalized;

  const factors = Object.fromEntries(
    CREDIT_COLS.map((key) => [key, medianCreditScaleFactor(existingRows, normalized, key)]),
  );

  return normalized.map((row) => {
    const out = { date: row.date };
    CREDIT_COLS.forEach((key) => {
      const value = toNum(row[key]);
      out[key] = Number.isFinite(value) ? value * factors[key] : null;
    });
    return out;
  });
}

async function refreshLiveApiData(signal = null) {
  throwIfAborted(signal);
  return { applied: [], warnings: [] };
}
/**
 * Fetch adrinfo.kr/chart via CORS proxy, parse arrays, and append only new rows to adrRows.
 * Returns: { added: number, latestDate: string }
 */
async function refreshAdrFromWeb(signal = null) {
  const sourceUrl = appendCacheBust(ADR_SOURCE_URL);
  const proxyUrl = CORS_PROXY + encodeURIComponent(sourceUrl);
  const res = await fetchWithTimeout(proxyUrl, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`adrinfo.kr 응답 오류: ${res.status}`);
  const html = await res.text();

  function extractJsArray(src, varName) {
    const marker = `const ${varName}=`;
    const s = src.indexOf(marker);
    if (s < 0) return [];
    const e = src.indexOf("];", s) + 1;
    return JSON.parse(src.slice(s + marker.length, e).replace(/,\s*\]/g, "]"));
  }

  const kospiRaw  = extractJsArray(html, "kospi_adr");
  const kosdaqRaw = extractJsArray(html, "kosdaq_adr");
  if (!kospiRaw.length && !kosdaqRaw.length) throw new Error("ADR data parse failed. Source format may have changed.");
  throwIfAborted(signal);

  const tsToDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
  const kospiMap  = new Map(kospiRaw.map(([ts, v])  => [tsToDate(ts), v]));
  const kosdaqMap = new Map(kosdaqRaw.map(([ts, v]) => [tsToDate(ts), v]));

  // Append only dates newer than the last known ADR date.
  const lastKnown = (adrRows || []).reduce((latest, row) => (
    (toNum(row?.adr_kospi) !== null || toNum(row?.adr_kosdaq) !== null) && row.date > latest
      ? row.date
      : latest
  ), "");
  const allDates  = [...new Set([...kospiMap.keys(), ...kosdaqMap.keys()])].sort();
  const newRows   = allDates
    .filter((d) => d > lastKnown)
    .map((d) => ({ date: d, adr_kospi: kospiMap.get(d) ?? null, adr_kosdaq: kosdaqMap.get(d) ?? null }))
    .filter((r) => r.adr_kospi !== null || r.adr_kosdaq !== null);

  if (newRows.length > 0) {
    const byDate = new Map((adrRows || []).map((row) => [row.date, { ...row }]));
    newRows.forEach((row) => {
      const prev = byDate.get(row.date) || { date: row.date };
      prev.adr_kospi = row.adr_kospi;
      prev.adr_kosdaq = row.adr_kosdaq;
      byDate.set(row.date, prev);
    });
    adrRows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    markDataChanged("adr");
  }

  return {
    added: newRows.length,
    latestDate: adrRows.length ? adrRows[adrRows.length - 1].date : lastKnown,
  };
}

function parseSeedBundleSync(texts) {
  const pricePayloadRaw = parsePayloadText(texts.priceText);
  const priceRows = rowsFromColumnarPayload(pricePayloadRaw);
  const disclosurePayload = parsePayloadText(texts.disclosureText);
  return {
    pricePayload: pricePayloadRaw ? {
      ...pricePayloadRaw,
      records: priceRows,
      series: Array.isArray(pricePayloadRaw.series) ? pricePayloadRaw.series : getSeriesColumns(priceRows),
      display_names: pricePayloadRaw.display_names && typeof pricePayloadRaw.display_names === "object" ? pricePayloadRaw.display_names : {},
    } : null,
    macroRows: parseMacroPayload(texts.macroText),
    creditRows: parseMacroPayload(texts.creditText),
    adrRows: parseMacroPayload(texts.adrText),
    disclosurePayload,
    disclosureRows: normalizeDisclosureSeedRows(disclosurePayload?.records || []),
  };
}

async function refreshFearGreedFromWeb(signal = null) {
  const payload = await fetchJsonWithProxyFallback(
    appendCacheBust(FEAR_GREED_LIVE_URL),
    { signal },
    { allowProxy: false },
  );
  throwIfAborted(signal);
  const date = String(payload?.updated || "").slice(0, 10);
  const score = toNum(payload?.score);
  if (!date || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("공포탐욕 응답 형식이 올바르지 않습니다.");
  }
  const byDate = new Map((adrRows || []).map((row) => [row.date, { ...row }]));
  const prev = byDate.get(date) || { date };
  const changed = !sameNullableNumber(prev.fear_greed, score);
  prev.fear_greed = score;
  byDate.set(date, prev);
  adrRows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (changed) markDataChanged("adr");
  return { added: changed ? 1 : 0, latestDate: date };
}

function parseSeedBundleInWorker(texts) {
  if (typeof Worker === "undefined") return Promise.resolve(parseSeedBundleSync(texts));

  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const workerUrl = `./modules/data-worker.js?v=${encodeURIComponent(APP_BUILD_VERSION || "dev")}`;
    const worker = new Worker(workerUrl);
    const timeoutId = setTimeout(() => {
      worker.terminate();
      reject(new Error("seed parse worker timeout"));
    }, 8000);

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.id !== id) return;
      clearTimeout(timeoutId);
      worker.terminate();
      if (message.ok) resolve(message.result || {});
      else reject(new Error(message.error || "seed parse worker failed"));
    };
    worker.onerror = (event) => {
      clearTimeout(timeoutId);
      worker.terminate();
      reject(new Error(event?.message || "seed parse worker failed"));
    };
    worker.postMessage({ id, type: "parseSeedBundle", texts });
  }).catch(() => parseSeedBundleSync(texts));
}

async function loadData(forceNetwork = false, options = {}) {
  const mergeWithExisting = Boolean(options?.mergeWithExisting);
  const segment = options?.segment === "history" ? "history" : "recent";
  const includeDisclosures = options?.includeDisclosures !== false;
  if (!pricePayload || typeof pricePayload !== "object") {
    pricePayload = { records: [], series: [], display_names: {} };
  } else {
    if (!Array.isArray(pricePayload.records)) pricePayload.records = [];
    if (!Array.isArray(pricePayload.series)) pricePayload.series = [];
    if (!pricePayload.display_names || typeof pricePayload.display_names !== "object") {
      pricePayload.display_names = {};
    }
  }
  if (!Array.isArray(macroRows)) macroRows = [];
  if (!Array.isArray(creditRows)) creditRows = [];
  const [priceSeed, macroSeed, creditSeed, adrSeed, disclosureText] = await Promise.all([
    fetchSegmentedSeedText("./data/prices.json", segment, forceNetwork),
    fetchSegmentedSeedText("./data/macro_data.json", segment, forceNetwork),
    fetchSegmentedSeedText("./data/credit_data.json", segment, forceNetwork),
    fetchSegmentedSeedText("./data/adr_data.json", segment, forceNetwork),
    includeDisclosures ? fetchSeedText("./data/disclosures.json", forceNetwork) : Promise.resolve(null),
  ]);
  const coreSeeds = [priceSeed, macroSeed, creditSeed, adrSeed];
  const allCoreSeedsLoaded = coreSeeds.every((seed) => Boolean(seed.text));
  const allUsedFullFallback = coreSeeds.every((seed) => seed.usedFullFallback);
  const priceText = priceSeed.text;
  const macroText = macroSeed.text;
  const creditText = creditSeed.text;
  const adrText = adrSeed.text;

  const parsed = await parseSeedBundleInWorker({ priceText, macroText, creditText, adrText, disclosureText });
  if (parsed.pricePayload?.records?.length) {
    pricePayload = mergeWithExisting
      ? mergePricePayloadPreservingExisting(pricePayload, parsed.pricePayload)
      : parsed.pricePayload;
    Object.assign(DISPLAY_NAMES, pricePayload.display_names || {});
    markDataChanged("price");
  }

  if (parsed.macroRows?.length) {
    macroRows = mergeWithExisting
      ? mergeRowsPreservingExisting(macroRows, parsed.macroRows)
      : parsed.macroRows;
    markDataChanged("macro");
  }

  if (parsed.creditRows?.length) {
    creditRows = mergeWithExisting
      ? normalizeCreditRows(mergeRowsPreservingExisting(creditRows, parsed.creditRows))
      : normalizeCreditRows(parsed.creditRows);
    markDataChanged("credit");
  }

  if (parsed.adrRows?.length) {
    adrRows = mergeWithExisting
      ? mergeRowsPreservingExisting(adrRows, parsed.adrRows)
      : parsed.adrRows;
    markDataChanged("adr");
  }

  if (parsed.disclosurePayload?.format === "by-ticker-v1") {
    disclosureManifest = parsed.disclosurePayload;
    if (!mergeWithExisting) {
      disclosureRows = [];
      markDataChanged("disclosure");
      disclosureSeedLoadedTickers = new Set();
    }
    await ensureDisclosureSeedsForTickers(getDisclosureSeedTickers(), forceNetwork);
  } else if (parsed.disclosurePayload) {
    const seededDisclosureRows = sanitizeDisclosureRows(parsed.disclosureRows || []);
    disclosureRows = mergeWithExisting
      ? mergeDisclosureRows(disclosureRows, seededDisclosureRows)
      : seededDisclosureRows;
    markDataChanged("disclosure");
  }

  const loadedAny = Boolean(
    parsed.pricePayload?.records?.length
    || parsed.macroRows?.length
    || parsed.creditRows?.length
    || parsed.adrRows?.length
  );
  if (loadedAny && ((segment === "history" && allCoreSeedsLoaded) || allUsedFullFallback)) {
    historicalDataLoaded = true;
  }
  return { segment, loadedAny, historicalDataLoaded, usedFullFallback: allUsedFullFallback };
}

async function ensureHistoricalDataLoaded(forceNetwork = false) {
  if (historicalDataLoaded) return true;
  if (historicalDataLoadPromise) return historicalDataLoadPromise;

  historicalDataLoadPromise = loadData(forceNetwork, {
    mergeWithExisting: true,
    segment: "history",
    includeDisclosures: false,
  }).then((result) => {
    if (!result.loadedAny || !result.historicalDataLoaded) {
      throw new Error("과거 데이터 묶음을 불러오지 못했습니다.");
    }
    mainChartCalcCache = null;
    lastAdrRenderKey = "";
    return true;
  }).finally(() => {
    historicalDataLoadPromise = null;
  });

  return historicalDataLoadPromise;
}

async function applyRuntimeRefreshChanges(revisionsBefore, options = {}) {
  const revisionsAfter = getDataRevisions();
  const mainDataChanged = ["price", "macro", "credit"]
    .some((name) => revisionsAfter[name] !== revisionsBefore[name]);
  const adrDataChanged = revisionsAfter.adr !== revisionsBefore.adr;
  const disclosureDataChanged = revisionsAfter.disclosure !== revisionsBefore.disclosure;
  if (mainDataChanged) {
    if (options.awaitMainRender) await renderChart(false);
    else renderChartWhenIdleOrNow(false);
  } else {
    if (adrDataChanged) {
      lastAdrRenderKey = "";
      const mainEl = document.getElementById("chart");
      renderAdrChart(mainEl?._fullLayout?.xaxis?.range?.slice() || null);
    }
    if (disclosureDataChanged && !applyDisclosureStateFast()) requestChartRender(false);
  }
  return { revisionsAfter, mainDataChanged, adrDataChanged, disclosureDataChanged };
}

async function runRuntimeDataRefresh(msgEl, options = {}) {
  const revisionsBeforeRefresh = getDataRevisions();
  const perfStartedAt = startPerfSample();
  const infoLines = [];
  const warnLines = [];
  let refreshedDart = false;
  let phaseRevisions = revisionsBeforeRefresh;
  let mainDataChanged = false;
  let adrDataChanged = false;
  let disclosureDataChanged = false;
  const forceNetwork = Boolean(options?.forceNetwork);
  const signal = options?.signal || null;

  const coreIndexTask = () => refreshCoreIndexSeries({ signal })
    .then((result) => ({ info: result.applied || [], warnings: result.warnings || [] }));

  const preloadTask = () => preloadCustomStocks({ forceRefresh: forceNetwork, signal })
    .then((result) => ({
      info: [],
      warnings: result.failedNames.length
        ? [`일부 선택 종목을 불러오지 못했습니다: ${result.failedNames.join(", ")}`]
        : [],
    }));

  const adrTask = () => refreshAdrFromWeb(signal)
    .then(({ added, latestDate }) => ({
      info: added > 0 ? [`ADR ${added}건 추가 반영(~ ${latestDate})`] : [],
      warnings: [],
    }))
    .catch((adrErr) => ({ info: [], warnings: [`ADR 불러오기 오류: ${adrErr.message}`] }));

  const fearGreedTask = () => refreshFearGreedFromWeb(signal)
    .then(({ added, latestDate }) => ({
      info: added > 0 ? [`공포탐욕 최신값 반영(~ ${latestDate})`] : [],
      warnings: [],
    }))
    .catch((error) => ({ info: [], warnings: [`공포탐욕 불러오기 오류: ${error.message}`] }));

  const dartTask = () => {
    if (!forceNetwork || !canUseDartGateway()) {
      return Promise.resolve({ info: [], warnings: [], refreshed: false });
    }
    return refreshDartDisclosuresForVisibleTickersFromApi("gateway", {
      forceNetwork,
      signal,
    }).then((result) => ({
      info: result.fetched > 0 ? [`DART 공시 ${result.fetched}건 확인`] : [],
      warnings: result.failed || [],
      refreshed: result.fetched > 0,
    })).catch((error) => ({
      info: [],
      warnings: [`DART 공시 오류: ${error.message}`],
      refreshed: false,
    }));
  };

  const liveTask = () => refreshLiveApiData(signal)
    .then((result) => ({ info: result.applied || [], warnings: result.warnings || [] }))
    .catch((liveErr) => ({ info: [], warnings: [`최신 지표 불러오기 오류: ${liveErr.message}`] }));

  const collectResults = (results) => results.forEach((result) => {
    infoLines.push(...(result.info || []));
    warnLines.push(...(result.warnings || []));
  });

  const applyPhaseChanges = async (awaitMainRender = false) => {
    const changes = await applyRuntimeRefreshChanges(phaseRevisions, { awaitMainRender });
    phaseRevisions = changes.revisionsAfter;
    mainDataChanged = mainDataChanged || changes.mainDataChanged;
    adrDataChanged = adrDataChanged || changes.adrDataChanged;
    disclosureDataChanged = disclosureDataChanged || changes.disclosureDataChanged;
    return changes;
  };

  await runRefreshPhases({
    criticalTasks: [coreIndexTask, preloadTask, liveTask],
    supplementalTasks: [adrTask, fearGreedTask, dartTask],
    onCritical: async (results) => {
      throwIfAborted(signal);
      collectResults(results);
      const changes = await applyPhaseChanges(Boolean(options?.awaitCriticalRender));
      runtimeRefreshPhaseStats.criticalReady += 1;
      if (typeof options?.onCriticalReady === "function") {
        setMessage(msgEl, [
          ...infoLines,
          ...warnLines,
          "공시·보조지표를 백그라운드에서 갱신 중입니다.",
        ], false);
        await options.onCriticalReady({ changes, info: [...infoLines], warnings: [...warnLines] });
      }
    },
    onSupplemental: async (results) => {
      throwIfAborted(signal);
      collectResults(results);
      refreshedDart = Boolean(results[2]?.refreshed);
      await applyPhaseChanges(false);
      runtimeRefreshPhaseStats.supplementalReady += 1;
    },
  });

  if (refreshedDart) {
    if (lastDisclosureTraceStats.markers > 0) {
      infoLines.push(`현재 차트에 공시 마커 ${lastDisclosureTraceStats.markers}개 표시됨`);
    } else if (showDisclosures && disclosureRows.length) {
      warnLines.push("공시 데이터는 있지만 현재 차트 범위/켜진 종목에는 표시할 마커가 없습니다.");
    }
  }
  scheduleLastRuntimeSnapshotSave(1800);
  if (perfStartedAt) {
    recordPerfSample("runtimeRefresh", perfStartedAt, {
      mainDataChanged,
      adrDataChanged,
      disclosureDataChanged,
    });
  }

  if (infoLines.length || warnLines.length) {
    setMessage(msgEl, [...infoLines, ...warnLines], infoLines.length === 0);
  } else {
    setMessage(msgEl, []);
  }
}

async function refreshRuntimeData(msgEl, options = {}) {
  const forceNetwork = Boolean(options?.forceNetwork);
  if (runtimeRefreshPromise && !forceNetwork) return runtimeRefreshPromise;

  if (runtimeRefreshController) {
    const abortError = new Error("Superseded by a newer data refresh");
    abortError.name = "AbortError";
    runtimeRefreshController.abort(abortError);
  }

  const controller = new AbortController();
  const generation = ++runtimeRefreshGeneration;
  runtimeRefreshController = controller;
  const task = runRuntimeDataRefresh(msgEl, { ...options, signal: controller.signal, generation })
    .catch((error) => {
      if (isAbortError(error) || controller.signal.aborted) return { cancelled: true };
      throw error;
    })
    .finally(() => {
      if (runtimeRefreshGeneration !== generation) return;
      runtimeRefreshController = null;
      runtimeRefreshPromise = null;
    });
  runtimeRefreshPromise = task;
  return task;
}

function waitForFirstPaint() {
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(done);
    } else {
      done();
    }
  });
}

async function boot() {
  const startupPerfStartedAt = startPerfSample();
  const msgEl = document.getElementById("messageArea");
  scheduleServiceWorkerRegistration();
  showStartupLoader();
  setStartupLoaderProgress(4, "Preparing");
  initPerfDebugAccess();
  initE2eDebugAccess();
  loadState();
  clearLegacyBrowserApiSettings();
  renderCustomStockButtons();
  bindSeriesToggleBoard();
  setupStockAddPanel(msgEl);
  syncButtons();
  setupApiSettingsPanel(msgEl);
  syncApiOptionsButton();
  renderAppVersionLabel();
  syncAiForecastToggleButton();
  syncMacdToggleButton();
  bindRuntimeSnapshotExitSave();
  scheduleGranularCacheCleanup();
  setStartupLoaderProgress(10, "Preparing");
  const plotlyReadyTask = ensurePlotlyReady()
    .then((plotly) => ({ plotly, error: null }))
    .catch((error) => ({ plotly: null, error }));
  try {
    const restoredLastSnapshot = await loadLastRuntimeSnapshot();
    if (restoredLastSnapshot) {
      setStartupLoaderProgress(42, "Restoring last view");
    } else {
      await loadData(true);
      setStartupLoaderProgress(45, "Loading saved data");
    }
    if (activeMonths > RECENT_DATA_MONTHS && !historicalDataLoaded) {
      setStartupLoaderProgress(50, "Loading historical data");
      try {
        await ensureHistoricalDataLoaded(true);
      } catch (_) {
        activeMonths = 120;
        syncButtons();
        setMessage(msgEl, ["과거 데이터 로딩에 실패해 10년 범위로 시작합니다."], true);
      }
    }
    setStartupLoaderProgress(56, "Loading chart engine");
    const plotlyResult = await plotlyReadyTask;
    if (plotlyResult.error) throw plotlyResult.error;
    await renderChart(false);
    setStartupLoaderProgress(72, restoredLastSnapshot ? "Rendering last view" : "Rendering saved data");

    appUiBindingsModule.bindRangeButtons({
      buttons: document.querySelectorAll(".range-btn"),
      getActiveMonths: () => activeMonths,
      setActiveMonths: (value) => { activeMonths = value; },
      clearPinnedRange: () => { pinnedXRange = null; },
      syncButtons,
      recentDataMonths: RECENT_DATA_MONTHS,
      isHistoricalDataLoaded: () => historicalDataLoaded,
      ensureHistoricalDataLoaded,
      setMessage: (message, isError) => setMessage(msgEl, message, isError),
      saveState,
      requestChartRender,
    });

    document.getElementById("resetHandles").addEventListener("click", resetHandles);
    document.getElementById("aiForecastToggle").addEventListener("click", () => {
      showAiForecast = !showAiForecast;
      saveState();
      syncAiForecastToggleButton();
      if (showAiForecast) refreshAiAnalysisForVisibleSeries().catch(() => {});
      requestChartRender(false);
    });
    document.getElementById("macdToggle").addEventListener("click", () => {
      showMacdOscillator = !showMacdOscillator;
      saveState();
      syncMacdToggleButton();
      const mainRange = document.getElementById("chart")?._fullLayout?.xaxis?.range?.slice() || null;
      renderMacdChart(mainRange).catch((err) => {
        setMessage(msgEl, err.message || "MACD 차트 렌더링 오류", true);
      });
    });
    if (showAiForecast) refreshAiAnalysisForVisibleSeries().catch(() => {});

    appUiBindingsModule.bindHoverToggle({
      button: document.getElementById("hoverToggle"),
      chartElements: [
        document.getElementById("chart"),
        document.getElementById("chart-macd"),
        document.getElementById("chart-adr"),
      ],
      getEnabled: () => hoverShowPopup,
      setEnabled: (value) => { hoverShowPopup = value; },
      saveState,
      requestChartRender,
    });

    appUiBindingsModule.bindDisclosureToggle({
      button: document.getElementById("disclosureToggle"),
      getEnabled: () => showDisclosures,
      setEnabled: (value) => { showDisclosures = value; },
      markerCount: () => lastDisclosureTraceStats.markers,
      syncButton: syncDisclosureToggleButton,
      hidePopover: hideDisclosurePopover,
      saveState,
      applyFastState: applyDisclosureStateFast,
      requestChartRender,
    });

    appUiBindingsModule.bindCreditOffsetInput({
      input: document.getElementById("creditOffset"),
      getOffsetDays: () => CREDIT_OFFSET_DAYS,
      setOffsetDays: (value) => { CREDIT_OFFSET_DAYS = value; },
      saveState,
      requestChartRender,
    });

    appUiBindingsModule.bindManualRefresh({
      button: document.getElementById("refreshData"),
      setMessage: (message, isError) => setMessage(msgEl, message, isError),
      hasServiceWorkerController: () => Boolean(navigator.serviceWorker.controller),
      requestServiceWorkerDataRefresh,
      hasRuntimeDataLoaded,
      loadData,
      loadLastRuntimeSnapshot,
      renderChart,
      refreshRuntimeData: (options) => refreshRuntimeData(msgEl, options),
    });

    await waitForFirstPaint();
    setStartupLoaderProgress(84, "Refreshing latest data");
    try {
      if (restoredLastSnapshot) {
        await loadData(true, { mergeWithExisting: true });
      }
      let releaseStartupLoader = null;
      const criticalReady = new Promise((resolve) => { releaseStartupLoader = resolve; });
      refreshRuntimeData(msgEl, {
        awaitCriticalRender: true,
        onCriticalReady: () => releaseStartupLoader({ ok: true }),
      })
        .then((result) => {
          if (result?.cancelled) releaseStartupLoader({ ok: false });
        })
        .catch((refreshErr) => {
          setMessage(msgEl, `최신 데이터 갱신 오류: ${refreshErr.message}`, true);
          releaseStartupLoader({ ok: false });
        });
      await criticalReady;
    } catch (refreshErr) {
      setMessage(msgEl, `최신 데이터 갱신 오류: ${refreshErr.message}`, true);
    }
    setStartupLoaderProgress(100, "Ready");
  } catch (err) {
    setMessage(msgEl, err.message || "데이터를 가져오지 못했습니다.", true);
  } finally {
    hideStartupLoader();
    recordPerfSample("appStartup", startupPerfStartedAt, {
      historicalDataLoaded,
      restoredSnapshot: hasRuntimeDataLoaded(),
    });
    deferredPerformanceDiagnostics.scheduleAutomaticCapture({
      appVersion: APP_VERSION,
      buildVersion: APP_BUILD_VERSION,
    });
  }
}

boot();





