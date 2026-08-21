const ENABLE_E2E_DIAGNOSTICS = __THINKSTOCK_E2E_DIAGNOSTICS__;

const disclosurePolicy = globalThis.ThinkStockDisclosurePolicy;
if (!disclosurePolicy) throw new Error("Disclosure policy module failed to load");
const {
  classifyDisclosureType,
  shouldDisplayDisclosure,
  createDisclosureDataService,
} = disclosurePolicy;
const disclosureProgressModule = globalThis.ThinkStockDisclosureProgress;
if (!disclosureProgressModule) throw new Error("Disclosure progress module failed to load");
const disclosureProgress = disclosureProgressModule.createDisclosureProgress(globalThis, {
  getRoot: () => document.getElementById("disclosureProgress"),
  getText: () => document.getElementById("disclosureProgressText"),
  getBar: () => document.getElementById("disclosureProgressBar"),
});
const serviceWorkerClientModule = globalThis.ThinkStockServiceWorkerClient;
if (!serviceWorkerClientModule) throw new Error("Service worker client module failed to load");
const serviceWorkerClient = serviceWorkerClientModule.createServiceWorkerClient(globalThis);
const requestServiceWorkerDataRefresh = serviceWorkerClient.requestDataRefresh;
const scheduleServiceWorkerRegistration = serviceWorkerClient.scheduleRegistration;
const runtimeRefreshModule = globalThis.ThinkStockRuntimeRefresh;
if (!runtimeRefreshModule) throw new Error("Runtime refresh module failed to load");
const { retryOnce, runRefreshPhases, waitForDelay } = runtimeRefreshModule;
const runtimeRefreshOrchestratorModule = globalThis.ThinkStockRuntimeRefreshOrchestrator;
if (!runtimeRefreshOrchestratorModule) throw new Error("Runtime refresh orchestrator module failed to load");
const sharedRequestRegistryModule = globalThis.ThinkStockSharedRequestRegistry;
if (!sharedRequestRegistryModule) throw new Error("Shared request registry module failed to load");
const { mapWithConcurrency } = sharedRequestRegistryModule;
const appRequestRegistry = sharedRequestRegistryModule.createSharedRequestRegistry();
const dartRequestRuntimeModule = globalThis.ThinkStockDartRequestRuntime;
if (!dartRequestRuntimeModule) throw new Error("DART request runtime module failed to load");
const dartRequestRuntime = dartRequestRuntimeModule.createDartRequestRuntime(appRequestRegistry);
const adminFeatureAccessModule = globalThis.ThinkStockAdminFeatureAccess;
if (!adminFeatureAccessModule) throw new Error("Admin feature access module failed to load");
const adrDataModule = globalThis.ThinkStockAdrData;
if (!adrDataModule) throw new Error("ADR data module failed to load");
const runtimeDataAppModule = globalThis.ThinkStockRuntimeDataApp;
if (!runtimeDataAppModule) throw new Error("Runtime data app module failed to load");
const runtimeSourceHealthModule = globalThis.ThinkStockRuntimeSourceHealth;
if (!runtimeSourceHealthModule) throw new Error("Runtime source health module failed to load");
const runtimeBootstrapModule = globalThis.ThinkStockRuntimeBootstrap;
if (!runtimeBootstrapModule) throw new Error("Runtime bootstrap module failed to load");
const runtimeGatewayClientModule = globalThis.ThinkStockRuntimeGatewayClient;
if (!runtimeGatewayClientModule) throw new Error("Runtime gateway client module failed to load");
const runtimeIndexRefreshModule = globalThis.ThinkStockRuntimeIndexRefresh;
if (!runtimeIndexRefreshModule) throw new Error("Runtime index refresh module failed to load");
const dataFreshnessViewModule = globalThis.ThinkStockDataFreshnessView;
if (!dataFreshnessViewModule) throw new Error("Data freshness view module failed to load");
const dataFreshnessControllerModule = globalThis.ThinkStockDataFreshnessController;
if (!dataFreshnessControllerModule) throw new Error("Data freshness controller module failed to load");
const dataSeedLoaderModule = globalThis.ThinkStockDataSeedLoader;
if (!dataSeedLoaderModule) throw new Error("Data seed loader module failed to load");
const runtimeDataContract = globalThis.ThinkStockRuntimeDataContract;
if (!runtimeDataContract) throw new Error("Runtime data contract module failed to load");
const seriesIntegrityModule = globalThis.ThinkStockSeriesIntegrity;
if (!seriesIntegrityModule) throw new Error("Series integrity module failed to load");
const seriesTimelinePolicyModule = globalThis.ThinkStockSeriesTimelinePolicy;
if (!seriesTimelinePolicyModule) throw new Error("Series timeline policy module failed to load");
const marketCalendarModule = globalThis.ThinkStockMarketCalendar;
if (!marketCalendarModule) throw new Error("Market calendar module failed to load");
const {
  expectedLatestKoreanTradingDate,
  inspectDailyPriceHistoryDensity,
  isKoreanMarketPricePoint,
  isKoreanTradingDate,
  koreanDateText,
} = marketCalendarModule;
const runtimeFreshnessPolicyModule = globalThis.ThinkStockRuntimeFreshnessPolicy;
if (!runtimeFreshnessPolicyModule) throw new Error("Runtime freshness policy module failed to load");
const runtimeApiContractModule = globalThis.ThinkStockRuntimeApiContract;
if (!runtimeApiContractModule) throw new Error("Runtime API contract module failed to load");
const marketDataModule = globalThis.ThinkStockMarketData;
if (!marketDataModule) throw new Error("Market data module failed to load");
const {
  getSeriesColumns,
  copyDisplayNames,
  sanitizePricePayload: sanitizePricePayloadForSnapshot,
  sanitizeKoreanEquityPricePayload,
  mergeRowsPreservingExisting,
  mergeRowsPreferIncoming,
  mergePricePayloadPreservingExisting,
  mergePricePayloadPreferIncoming,
  normalizeTickerPricePoints,
  findTickerPriceRebaseSignal,
  mergeSources: mergeMarketDataSources,
  normalizeSeries,
  centeredScale,
  autoFitScales,
  resolveNormalizationBases,
  mergeFixedAutoScales,
  shiftIsoDateByDays,
  buildDenseMacroRows,
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
const {
  bindPointerDrag,
  createLatestFrameScheduler,
  createPointerFrameController,
  latestPointerSample,
} = chartInteractionControllerModule;
const chartPointerRuntimeModule = globalThis.ThinkStockChartPointerRuntime;
if (!chartPointerRuntimeModule) throw new Error("Chart pointer runtime module failed to load");
const chartSessionStateModule = globalThis.ThinkStockChartSessionState;
if (!chartSessionStateModule) throw new Error("Chart session state module failed to load");
const chartViewportControllerModule = globalThis.ThinkStockChartViewportController;
if (!chartViewportControllerModule) throw new Error("Chart viewport controller module failed to load");
const chartNavigationAppModule = globalThis.ThinkStockChartNavigationApp;
if (!chartNavigationAppModule) throw new Error("Chart navigation app module failed to load");
const chartCursorSyncModule = globalThis.ThinkStockChartCursorSync;
if (!chartCursorSyncModule) throw new Error("Chart cursor sync module failed to load");
const chartHoverRuntimeModule = globalThis.ThinkStockChartHoverRuntime;
if (!chartHoverRuntimeModule) throw new Error("Chart hover runtime module failed to load");
const chartLayoutPolicyModule = globalThis.ThinkStockChartLayoutPolicy;
if (!chartLayoutPolicyModule) throw new Error("Chart layout policy module failed to load");
const chartVisualFrameModule = globalThis.ThinkStockChartVisualFrame;
if (!chartVisualFrameModule) throw new Error("Chart visual frame module failed to load");
const chartDisplaySamplerModule = globalThis.ThinkStockChartDisplaySampler;
if (!chartDisplaySamplerModule) throw new Error("Chart display sampler failed to load");
const chartRelayoutQueueModule = globalThis.ThinkStockChartRelayoutQueue;
if (!chartRelayoutQueueModule) throw new Error("Chart relayout queue failed to load");
const chartCompositionViewportModule = globalThis.ThinkStockChartCompositionViewport;
if (!chartCompositionViewportModule) throw new Error("Chart composition viewport module failed to load");
const mainSeriesControllerModule = globalThis.ThinkStockMainSeriesController;
if (!mainSeriesControllerModule) throw new Error("Main series controller module failed to load");
const chartRenderTelemetryModule = globalThis.ThinkStockChartRenderTelemetry;
if (!chartRenderTelemetryModule) throw new Error("Chart render telemetry module failed to load");
const chartRenderSchedulerModule = globalThis.ThinkStockChartRenderScheduler;
if (!chartRenderSchedulerModule) throw new Error("Chart render scheduler module failed to load");
const chartUpdateCoordinatorModule = globalThis.ThinkStockChartUpdateCoordinator;
if (!chartUpdateCoordinatorModule) throw new Error("Chart update coordinator module failed to load");
const chartSessionControllerModule = globalThis.ThinkStockChartSessionController;
if (!chartSessionControllerModule) throw new Error("Chart session controller module failed to load");
const chartModelCacheModule = globalThis.ThinkStockChartModelCache;
if (!chartModelCacheModule) throw new Error("Chart model cache module failed to load");
const chartModelWorkerClientModule = globalThis.ThinkStockChartModelWorkerClient;
if (!chartModelWorkerClientModule) throw new Error("Chart model worker client module failed to load");
const tickerPriceRuntimeModule = globalThis.ThinkStockTickerPriceRuntime;
if (!tickerPriceRuntimeModule) throw new Error("Ticker price runtime module failed to load");
const chartEventLayerModule = globalThis.ThinkStockChartEventLayer;
if (!chartEventLayerModule) throw new Error("Chart event layer module failed to load");
const chartMarkerLayoutModule = globalThis.ThinkStockChartMarkerLayout;
if (!chartMarkerLayoutModule) throw new Error("Chart marker layout module failed to load");
const chartMarkerRuntimeModule = globalThis.ThinkStockChartMarkerRuntime;
if (!chartMarkerRuntimeModule) throw new Error("Chart marker runtime module failed to load");
const chartAdjustmentsModule = globalThis.ThinkStockChartAdjustments;
if (!chartAdjustmentsModule) throw new Error("Chart adjustments module failed to load");
const {
  defaultScale: defaultSeriesScale,
  resolveScale: resolveSeriesScale,
  transformValues: transformSeriesValues,
  offsetFromDrag,
  scaleFromDrag,
  fitRangeForTraces,
  expandRangeToContain,
} = chartAdjustmentsModule;
const browserMarketClientModule = globalThis.ThinkStockBrowserMarketClient;
if (!browserMarketClientModule) throw new Error("Browser market client module failed to load");
const auxiliaryChartModelModule = globalThis.ThinkStockAuxiliaryChartModel;
if (!auxiliaryChartModelModule) throw new Error("Auxiliary chart model module failed to load");
const {
  AUXILIARY_PANEL_KEYS,
  AUXILIARY_CHART_CONFIG,
  buildAuxiliaryPanelLayout,
  buildAuxiliaryChartModel: buildAuxiliaryChartModelSync,
  buildAuxiliaryViewportRanges,
  buildThresholdEnvelopeSeries,
  buildThresholdFillPolygons,
  NEWS_MOVING_AVERAGE_DAYS,
  NEWS_MOVING_AVERAGE_MIN_DAYS,
  NEWS_MOVING_AVERAGE_MAX_DAYS,
  normalizeNewsMovingAverageDays,
} = auxiliaryChartModelModule;
const {
  adrBandColor: ADR_BAND_COLOR,
  adrHighThreshold: ADR_HIGH_THRESH,
  adrLowThreshold: ADR_LOW_THRESH,
  adrZoneHighColor: ADR_ZONE_HIGH_COLOR,
  adrZoneLowColor: ADR_ZONE_LOW_COLOR,
  fearGreedHighThreshold: FEAR_GREED_HIGH_THRESH,
  fearGreedLowThreshold: FEAR_GREED_LOW_THRESH,
  newsSentimentHighThreshold: NEWS_SENTIMENT_HIGH_THRESH,
  newsSentimentLowThreshold: NEWS_SENTIMENT_LOW_THRESH,
  zoneHighFillColor: AUXILIARY_ZONE_HIGH_FILL_COLOR,
  zoneLowFillColor: AUXILIARY_ZONE_LOW_FILL_COLOR,
  seriesKeys: AUXILIARY_SERIES_KEYS,
} = AUXILIARY_CHART_CONFIG;
const auxiliaryChartRuntimeModule = globalThis.ThinkStockAuxiliaryChartRuntime;
if (!auxiliaryChartRuntimeModule) throw new Error("Auxiliary chart runtime module failed to load");
const mainChartRenderer = globalThis.ThinkStockMainChartRenderer;
if (!mainChartRenderer) throw new Error("Main chart renderer module failed to load");
const {
  buildCursorHoverMode,
  buildCursorLineAxisLayout,
  normalizeCursorLineMode,
} = mainChartRenderer;
const CURSOR_LINE_MODES = Object.freeze(["vertical", "horizontal", "cross"]);
const CHART_RIGHT_PADDING_MIN_DAYS = 0;
const CHART_RIGHT_PADDING_MAX_DAYS = 30;
const CURSOR_LINE_LABELS = Object.freeze({
  vertical: "세로 차트선 방식",
  horizontal: "가로 차트선 방식",
  cross: "십자 차트선 방식",
});
function normalizeChartRightPaddingDays(value) {
  const days = Math.round(Number(value) || 0);
  return Math.max(CHART_RIGHT_PADDING_MIN_DAYS, Math.min(CHART_RIGHT_PADDING_MAX_DAYS, days));
}
const mainChartEventsModule = globalThis.ThinkStockMainChartEvents;
if (!mainChartEventsModule) throw new Error("Main chart events module failed to load");
const coMovementModule = globalThis.ThinkStockCoMovement;
if (!coMovementModule) throw new Error("Co-movement module failed to load");
const {
  buildSummary: buildCoMovementSummary,
  sliceRowsByDateRange: sliceCoMovementRowsByDateRange,
} = coMovementModule;
const insiderTradesModule = globalThis.ThinkStockInsiderTrades;
if (!insiderTradesModule) throw new Error("Insider trades module failed to load");
const {
  buildMarkerTraces: buildInsiderMarkerTraces,
  mergeRows: mergeInsiderTradeRows,
  mergeRowsWithChange: mergeInsiderTradeRowsWithChange,
  netSameReporterTrades: netSameReporterInsiderTrades,
  sanitizeRows: sanitizeInsiderTradeRows,
} = insiderTradesModule;
const optionalFeatureLoaderModule = globalThis.ThinkStockOptionalFeatureLoader;
if (!optionalFeatureLoaderModule) throw new Error("Optional feature loader module failed to load");
const optionalFeatureRuntimeModule = globalThis.ThinkStockOptionalFeatureRuntime;
if (!optionalFeatureRuntimeModule) throw new Error("Optional feature runtime module failed to load");
let aiForecastAppModule = globalThis.ThinkStockAiForecastApp || null;
let aiForecastTracesModule = globalThis.ThinkStockAiForecastTraces || null;
const stockResearchContract = globalThis.ThinkStockStockResearchContract;
if (!stockResearchContract) throw new Error("Stock research contract failed to load");
const stockResearchAppModule = globalThis.ThinkStockStockResearchApp;
if (!stockResearchAppModule) throw new Error("Stock research app module failed to load");
let aiForecastCacheModule = globalThis.ThinkStockAiForecastCache || null;
let aiFeature = null;
let aiForecastApp = null;
const macdOscillatorModule = globalThis.ThinkStockMacdOscillator;
if (!macdOscillatorModule) throw new Error("MACD oscillator module failed to load");
const { buildMacdOscillator, thinMacdPoints } = macdOscillatorModule;
let marketTimingService = null;
const performanceMonitorModule = globalThis.ThinkStockPerformanceMonitor;
if (!performanceMonitorModule) throw new Error("Performance monitor module failed to load");
const performanceBudgetModule = globalThis.ThinkStockPerformanceBudget;
if (!performanceBudgetModule) throw new Error("Performance budget module failed to load");
const performanceMonitor = performanceMonitorModule.createPerformanceMonitor(globalThis);
const chartRenderTelemetry = chartRenderTelemetryModule.createChartRenderTelemetry(globalThis);
const initPerfDebugAccess = () => performanceMonitor.init();
const startPerfSample = () => performanceMonitor.startSample();
const recordPerfSample = (label, startedAt, meta = {}) => (
  performanceMonitor.recordSample(label, startedAt, meta)
);
const recordRuntimeError = (source, error, meta = {}) => (
  performanceMonitor.recordError(source, error, meta)
);
const deferredDiagnosticsModule = globalThis.ThinkStockDeferredDiagnostics;
if (!deferredDiagnosticsModule) throw new Error("Deferred diagnostics module failed to load");
const dataHealthModule = globalThis.ThinkStockDataHealth;
if (!dataHealthModule) throw new Error("Data health module failed to load");
const runtimeDataTransactionModule = globalThis.ThinkStockRuntimeDataTransaction;
if (!runtimeDataTransactionModule) throw new Error("Runtime data transaction module failed to load");
const runtimeSeriesQualityGateModule = globalThis.ThinkStockRuntimeSeriesQualityGate;
if (!runtimeSeriesQualityGateModule) throw new Error("Runtime series quality gate module failed to load");
const runtimeSeriesMergeModule = globalThis.ThinkStockRuntimeSeriesMerge;
if (!runtimeSeriesMergeModule) throw new Error("Runtime series merge module failed to load");
const runtimeMarketRefreshModule = globalThis.ThinkStockRuntimeMarketRefresh;
if (!runtimeMarketRefreshModule) throw new Error("Runtime market refresh module failed to load");
const appStorageModule = globalThis.ThinkStockAppStorage;
if (!appStorageModule) throw new Error("App storage module failed to load");
const appStateControllerModule = globalThis.ThinkStockAppStateController;
if (!appStateControllerModule) throw new Error("App state controller module failed to load");
const appCacheManagerModule = globalThis.ThinkStockAppCacheManager;
if (!appCacheManagerModule) throw new Error("App cache manager module failed to load");
const cacheLifecyclePolicyModule = globalThis.ThinkStockCacheLifecyclePolicy;
if (!cacheLifecyclePolicyModule) throw new Error("Cache lifecycle policy module failed to load");
const seriesCacheRetentionModule = globalThis.ThinkStockSeriesCacheRetention;
if (!seriesCacheRetentionModule) throw new Error("Series cache retention module failed to load");
const cacheMaintenanceRuntimeModule = globalThis.ThinkStockCacheMaintenanceRuntime;
if (!cacheMaintenanceRuntimeModule) throw new Error("Cache maintenance runtime module failed to load");
const tickerCacheInvalidationModule = globalThis.ThinkStockTickerCacheInvalidation;
if (!tickerCacheInvalidationModule) throw new Error("Ticker cache invalidation module failed to load");
const cacheMigrationsModule = globalThis.ThinkStockCacheMigrations;
if (!cacheMigrationsModule) throw new Error("Cache migrations module failed to load");
const cacheRecordHealthModule = globalThis.ThinkStockCacheRecordHealth;
if (!cacheRecordHealthModule) throw new Error("Cache record health module failed to load");
const runtimeSnapshotPolicyModule = globalThis.ThinkStockRuntimeSnapshotPolicy;
if (!runtimeSnapshotPolicyModule) throw new Error("Runtime snapshot policy module failed to load");
const runtimeSnapshotControllerModule = globalThis.ThinkStockRuntimeSnapshotController;
if (!runtimeSnapshotControllerModule) throw new Error("Runtime snapshot controller module failed to load");
const controlStateView = globalThis.ThinkStockControlStateView;
if (!controlStateView) throw new Error("Control state view module failed to load");
const appUiBindingsModule = globalThis.ThinkStockAppUiBindings;
if (!appUiBindingsModule) throw new Error("App UI bindings module failed to load");
let apiPeriodsModule = globalThis.ThinkStockApiPeriods || null;
let releaseNotesModule = globalThis.ThinkStockReleaseNotes || null;
let settingsPanelRuntimeModule = globalThis.ThinkStockSettingsPanelRuntime || null;
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
  vkospi: "VKOSPI",
  vix: "VIX",
};

const ADR_SERIES = ["adr_kospi", "adr_kosdaq"];
const FEAR_GREED_SERIES = ["fear_greed"];
const NEWS_SENTIMENT_SERIES = ["news_sentiment"];
const VKOSPI_SERIES = ["vkospi"];
const VIX_SERIES = ["vix"];
const VOLATILITY_SERIES = [...VKOSPI_SERIES, ...VIX_SERIES];
const MACD_STOCK_PATTERN = /^\d{6}\.(KS|KQ)$/;
const isForecastSeries = (value) => (
  ["^KS11", "^KQ11"].includes(String(value || "").trim().toUpperCase())
  || MACD_STOCK_PATTERN.test(String(value || "").trim().toUpperCase())
);
const CO_MOVEMENT_COMPARISONS = Object.freeze([
  { key: "^KS11", label: "코스피" },
  { key: "^KQ11", label: "코스닥" },
]);
const SUPPLEMENTAL_SERIES = [
  ...ADR_SERIES,
  ...FEAR_GREED_SERIES,
  ...NEWS_SENTIMENT_SERIES,
  ...VKOSPI_SERIES,
  ...VIX_SERIES,
];
const CORE_SERIES = ["leading_cycle", "^KS11", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"];
const FIXED_CORE_SERIES_COLORS = Object.freeze({
  leading_cycle: "#999999",
  customer_deposit: "#f59e0b",
  "^KS11": "#4ade80",
  kospi_credit: "#60a5fa",
  "^KQ11": "#f87171",
  kosdaq_credit: "#a78bfa",
});
const SERIES_COLORS = Object.freeze({
  ...FIXED_CORE_SERIES_COLORS,
  news_sentiment: "#22d3ee",
  adr_kospi: "#facc15",
  adr_kosdaq: "#f472b6",
  fear_greed: "#fb923c",
  vkospi: "#e5e7eb",
  vix: "#60a5fa",
});
const CUSTOM_RESERVED_COLORS = Object.freeze(CORE_SERIES.map((key) => FIXED_CORE_SERIES_COLORS[key]));
const CUSTOM_COLOR_MIN_FIXED_DISTANCE = 85;
const CUSTOM_COLOR_PALETTE = [
  "#d41111", "#d44211", "#a4d411", "#73d411", "#11d411", "#0da559",
  "#11d4d4", "#1173d4", "#1142d4", "#1111d4", "#4211d4", "#7311d4",
  "#a411d4", "#d411d4", "#d411a4", "#d41173", "#d41142", "#eeee2b",
  "#bdee2b", "#2beeee", "#2b2bee", "#ee2bee", "#f2f25a", "#89f5da",
];
const MAX_CUSTOM_STOCKS = 20;
const MAX_VISIBLE_MAIN_SERIES = 10;
const MAX_VISIBLE_MAIN_SERIES_MESSAGE = `최대 ${MAX_VISIBLE_MAIN_SERIES}개 까지만 추가됩니다.`;
const CUSTOM_STOCK_PRELOAD_CONCURRENCY = 3;
const STATE_KEY = "thinkstock-v5";
const API_SETTINGS_KEY = "thinkstock-api-v1";
const API_SETTINGS_SESSION_KEY = "thinkstock-api-session-v1";
const DART_GATEWAY_SETTINGS_KEY = "thinkstock-dart-gateway-v1";
const DART_GATEWAY_SETTINGS_SESSION_KEY = "thinkstock-dart-gateway-session-v1";
const ADMIN_SESSION_STORAGE_KEY = "thinkstock-admin-session-v1";
const ADMIN_DEVICE_STORAGE_KEY = "thinkstock-device-id-v1";
const ADMIN_ACCESS_MASK = "0".repeat(10);
const ADMIN_FEATURE_BUTTON_IDS = Object.freeze([
  "disclosureToggle",
  "insiderTradeToggle",
  "recessionToggle",
  "aiForecastToggle",
  "coMovementToggle",
  "stockResearchBtn",
]);
const runtimeStorageContract = globalThis.ThinkStockRuntimeFoundation?.storage;
if (!runtimeStorageContract) throw new Error("runtime storage contract failed to load");
const DATA_CACHE_DB_NAME = runtimeStorageContract.dbName;
const DATA_CACHE_DB_VERSION = runtimeStorageContract.dbVersion;
const DATA_CACHE_STORE_NAME = runtimeStorageContract.stores.snapshots;
const DATA_CACHE_RECORD_KEY = runtimeStorageContract.snapshotRecordKey;
const DATA_CACHE_LOCAL_KEY = runtimeStorageContract.localSnapshotKey;
const DATA_CACHE_SCHEMA_VERSION = 11;
const DATA_CACHE_MAX_AGE_DAYS = 7;
const RUNTIME_SNAPSHOT_FORMAT = "component-v1";
const RUNTIME_SNAPSHOT_COMPONENT_KEYS = Object.freeze({
  price: "component:price",
  macro: "component:macro",
  credit: "component:credit",
  adr: "component:adr",
  crisis: "component:crisis",
  disclosure: "component:disclosure",
});
const LOCAL_SNAPSHOT_MAX_ROWS = 900;
const LOCAL_SNAPSHOT_MAX_DISCLOSURES = 80;
const TICKER_PRICE_CACHE_STORE_NAME = runtimeStorageContract.stores.tickerPrices;
const TICKER_DISCLOSURE_CACHE_STORE_NAME = runtimeStorageContract.stores.tickerDisclosures;
const TICKER_AI_ANALYSIS_CACHE_STORE_NAME = runtimeStorageContract.stores.tickerAiAnalysis;
const TICKER_AI_FORECAST_CACHE_STORE_NAME = runtimeStorageContract.stores.tickerAiForecast;
const TICKER_AI_FORECAST_JOURNAL_STORE_NAME = runtimeStorageContract.stores.tickerAiForecastJournal;
const TICKER_RESEARCH_HISTORY_STORE_NAME = runtimeStorageContract.stores.tickerResearchHistory;
const STOCK_RESEARCH_RESULTS_STORE_NAME = runtimeStorageContract.stores.stockResearchResults;
const TICKER_BROKER_RESEARCH_STORE_NAME = runtimeStorageContract.stores.tickerBrokerResearch;
const GRANULAR_CACHE_SCHEMA_VERSION = 5;
const TICKER_DISCLOSURE_CACHE_SCHEMA_VERSION = 2;
const GRANULAR_CACHE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TICKER_AI_ANALYSIS_CACHE_MAX_AGE_DAYS = 2;
const AI_FORECAST_JOURNAL_QUEUE_MAX = 120;
const PRICE_CACHE_REBASE_RATIO_THRESHOLD = 1.8;
const PRICE_CACHE_REBASE_BOUNDARY_DAYS = 14;
const APP_VERSION = "2.98";
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
const cacheMigrator = cacheMigrationsModule.createCacheMigrator(globalThis, {
  markerKey: "thinkstock-cache-migrations-v1",
  currentVersion: 3,
  migrations: [
    {
      version: 1,
      migrate: ({ copyFirstAvailable }) => {
        copyFirstAvailable(STATE_KEY, ["thinkstock-v4", "thinkstock-v3", "thinkstock-v2", "thinkstock-v1"]);
      },
    },
    {
      version: 2,
      migrate: ({ updateJson }) => {
        updateJson(stockResearchContract.CACHE_KEY, (payload) => {
          const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
          return {
            ...payload,
            candidatePool: Array.isArray(payload.candidatePool) ? payload.candidatePool : candidates,
            candidateOrder: Array.isArray(payload.candidateOrder)
              ? payload.candidateOrder
              : candidates.map((candidate) => candidate?.ticker).filter(Boolean),
            candidatePageIndex: Math.max(0, Math.round(Number(payload.candidatePageIndex) || 0)),
            refreshCursor: Math.max(0, Math.round(Number(payload.refreshCursor) || 0)),
            incrementalDate: String(payload.incrementalDate || ""),
          };
        });
      },
    },
    {
      version: 3,
      migrate: ({ storage }) => {
        storage?.removeItem(API_SETTINGS_KEY);
        try { globalThis.sessionStorage?.removeItem(API_SETTINGS_SESSION_KEY); } catch (_) {}
      },
    },
  ],
});
const optionalFeatureLoader = optionalFeatureLoaderModule.createOptionalFeatureLoader(globalThis, {
  version: APP_BUILD_VERSION,
});
const optionalFeatureRuntime = optionalFeatureRuntimeModule.createOptionalFeatureRuntime(globalThis, {
  loader: optionalFeatureLoader,
  version: APP_BUILD_VERSION,
  buildMacdOscillator,
});
const runtimeDataApp = runtimeDataAppModule.createRuntimeDataApp(globalThis, {
  isAbortError,
  runRefresh: (messageElement, options) => runRuntimeDataRefresh(messageElement, options),
  sourceLedger: runtimeSourceHealthModule.createRuntimeSourceHealth(globalThis),
});
const dataFreshnessController = dataFreshnessControllerModule.createDataFreshnessController({
  dataHealth: dataHealthModule,
  view: dataFreshnessViewModule,
  runtimeDataApp,
  labelName,
});
const deferredPerformanceDiagnostics = deferredDiagnosticsModule.createDeferredDiagnostics(globalThis, {
  scriptUrl: `./modules/performance-diagnostics.js?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
  createOptions: {
    performanceApi: performanceMonitor.api,
    evaluateBudget: performanceBudgetModule.evaluatePerformanceBudget,
  },
});
const indexedCacheStore = appStorageModule.createIndexedCacheStore(globalThis, {
  dbName: DATA_CACHE_DB_NAME,
  dbVersion: DATA_CACHE_DB_VERSION,
  storeNames: [
    DATA_CACHE_STORE_NAME,
    TICKER_PRICE_CACHE_STORE_NAME,
    TICKER_DISCLOSURE_CACHE_STORE_NAME,
    TICKER_AI_ANALYSIS_CACHE_STORE_NAME,
    TICKER_AI_FORECAST_CACHE_STORE_NAME,
    TICKER_AI_FORECAST_JOURNAL_STORE_NAME,
    TICKER_RESEARCH_HISTORY_STORE_NAME,
    STOCK_RESEARCH_RESULTS_STORE_NAME,
    TICKER_BROKER_RESEARCH_STORE_NAME,
  ],
});
const tickerSeriesCacheRetention = seriesCacheRetentionModule.createSeriesCacheRetention({
  capacity: cacheLifecyclePolicyModule.USER_TICKER_CACHE_LIMIT,
});
let tickerSeriesCacheRetentionInitPromise = null;
let tickerPriceCacheMutationQueue = Promise.resolve();
const granularCacheMaintenance = cacheMaintenanceRuntimeModule.createCacheMaintenanceRuntime(globalThis, {
  store: indexedCacheStore,
  lifecyclePolicy: cacheLifecyclePolicyModule,
  pruneIntervalMs: GRANULAR_CACHE_PRUNE_INTERVAL_MS,
  storeNames: [
    TICKER_DISCLOSURE_CACHE_STORE_NAME,
    TICKER_AI_ANALYSIS_CACHE_STORE_NAME,
    TICKER_AI_FORECAST_CACHE_STORE_NAME,
    TICKER_AI_FORECAST_JOURNAL_STORE_NAME,
    TICKER_RESEARCH_HISTORY_STORE_NAME,
    TICKER_BROKER_RESEARCH_STORE_NAME,
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
const FEAR_GREED_LIVE_URL = "https://kospi.feargreedchart.com/api/?action=kospi-history";
const IS_E2E_RUNTIME = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("e2e");
const IS_LOCAL_RUNTIME = typeof window !== "undefined"
  && !IS_E2E_RUNTIME
  && window.location.protocol === "http:"
  && (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    || /^10\./.test(window.location.hostname)
    || /^192\.168\./.test(window.location.hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(window.location.hostname));
const DART_DISCLOSURE_CACHE_KEY = "thinkstock-dart-disclosure-cache-v1";
const DART_DISCLOSURE_CACHE_TTL_DAYS = 1;
const APP_CACHE_INDEXED_STORE_NAMES = Object.freeze([
  DATA_CACHE_STORE_NAME,
  TICKER_PRICE_CACHE_STORE_NAME,
  TICKER_DISCLOSURE_CACHE_STORE_NAME,
  TICKER_AI_ANALYSIS_CACHE_STORE_NAME,
  TICKER_AI_FORECAST_CACHE_STORE_NAME,
  TICKER_AI_FORECAST_JOURNAL_STORE_NAME,
  TICKER_RESEARCH_HISTORY_STORE_NAME,
  STOCK_RESEARCH_RESULTS_STORE_NAME,
  TICKER_BROKER_RESEARCH_STORE_NAME,
]);
const APP_CACHE_LOCAL_STORAGE_KEYS = Object.freeze([
  DATA_CACHE_LOCAL_KEY,
  DART_DISCLOSURE_CACHE_KEY,
  stockResearchContract.CACHE_KEY,
  stockResearchContract.CACHE_VARIANTS_KEY,
  stockResearchContract.CACHE_BYPASS_KEY,
]);
const APP_STATE_RESET_STORAGE_KEYS = Object.freeze([
  STATE_KEY,
  stockResearchContract.BLOCKED_KEY,
  stockResearchContract.MINIMUM_KEY,
  stockResearchContract.UNIVERSE_SIZE_KEY,
  "thinkstock-perf-debug",
]);
const appStateStore = appStorageModule.createJsonStore(globalThis, { key: STATE_KEY });
const runtimeSnapshotLocalStore = appStorageModule.createJsonStore(globalThis, { key: DATA_CACHE_LOCAL_KEY });
const disclosureRefreshStore = appStorageModule.createJsonStore(globalThis, { key: DART_DISCLOSURE_CACHE_KEY });
const appCacheManager = appCacheManagerModule.createAppCacheManager(globalThis, {
  indexedCacheStore,
  indexedStoreNames: APP_CACHE_INDEXED_STORE_NAMES,
  localStorageKeys: APP_CACHE_LOCAL_STORAGE_KEYS,
  cacheNamePrefix: "thinkstock-",
});
const DART_GATEWAY_URL = "https://thinkstock-api.keg0320.workers.dev";
const DART_GATEWAY_AUTH_CHECK_ENDPOINT = `${DART_GATEWAY_URL}/api/auth/check`;
const ADMIN_SESSION_ENDPOINT = IS_LOCAL_RUNTIME
  ? "/api/admin/session"
  : `${DART_GATEWAY_URL}/api/admin/session`;
const DART_GATEWAY_DISCLOSURE_ENDPOINT = `${DART_GATEWAY_URL}/api/dart/disclosures`;
const DART_GATEWAY_INSIDER_ENDPOINT = `${DART_GATEWAY_URL}/api/dart/insider-trades`;
const KRX_GATEWAY_PRICE_ENDPOINT = `${DART_GATEWAY_URL}/api/prices`;
const KRX_GATEWAY_PRICE_BATCH_ENDPOINT = `${DART_GATEWAY_URL}/api/prices/batch`;
const TICKER_HISTORY_ENDPOINT = IS_LOCAL_RUNTIME
  ? "./api/research/history"
  : `${DART_GATEWAY_URL}/api/research/history`;
const RUNTIME_GATEWAY_BOOTSTRAP_ENDPOINT = `${DART_GATEWAY_URL}/api/bootstrap`;
const KRX_GATEWAY_INDEX_ENDPOINT = `${DART_GATEWAY_URL}/api/indices`;
const ECOS_GATEWAY_MACRO_ENDPOINT = `${DART_GATEWAY_URL}/api/macro`;
const CREDIT_GATEWAY_ENDPOINT = `${DART_GATEWAY_URL}/api/credit`;
const ADR_GATEWAY_ENDPOINT = `${DART_GATEWAY_URL}/api/adr`;
const CRISIS_SIGNAL_GATEWAY_ENDPOINT = `${DART_GATEWAY_URL}/api/crisis-signal`;
const AI_ANALYSIS_ENDPOINT = `${DART_GATEWAY_URL}/api/analysis`;
const BROKER_REPORT_LIST_ENDPOINT = IS_LOCAL_RUNTIME
  ? "./api/broker-reports"
  : `${DART_GATEWAY_URL}/api/broker-reports`;
const BROKER_REPORT_PDF_ENDPOINT = IS_LOCAL_RUNTIME
  ? "./api/broker-report-pdf"
  : `${DART_GATEWAY_URL}/api/broker-report-pdf`;
const AI_FORECAST_JOURNAL_ENDPOINT = `${DART_GATEWAY_URL}/api/forecast-journal`;
const AI_MARKET_MODEL_URL = "./data/ai_market_model.json";
const AI_ROTATION_LEADER_TICKERS = Object.freeze(["005930.KS", "000660.KS"]);
const DART_VISIBLE_REFRESH_CONCURRENCY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_CHART_VIEW_SPAN_MS = DAY_MS * 7;
const NETWORK_REQUEST_TIMEOUT_MS = 12000;
const MAIN_CHART_MODEL_CACHE_MAX_WEIGHT = 400000;
const [ADR_RETRY_DELAY_MS = 3000, ADR_FINAL_RETRY_DELAY_MS = 15000] = runtimeFreshnessPolicyModule.retryDelaysMs("adr");
const DART_GATEWAY_REQUEST_TIMEOUT_MS = 90000;
const RECENT_DATA_MONTHS = 132;
const DEFAULT_DESKTOP_ACTIVE_MONTHS = 12;
const DEFAULT_PHONE_ACTIVE_MONTHS = 6;
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
const seedBundleParser = dataSeedLoaderModule.createSeedBundleParser(globalThis, {
  workerUrl: `./modules/data-worker.js?v=${encodeURIComponent(APP_BUILD_VERSION || "dev")}`,
  parseSync: parseSeedBundleSync,
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
const runtimeGatewayClient = runtimeGatewayClientModule.createRuntimeGatewayClient({
  isLocal: IS_LOCAL_RUNTIME,
  getAccessToken: getDartGatewayAccessToken,
  onUnauthorized: clearInvalidDartGatewayAccessToken,
  onContractError: (source, error, meta) => recordRuntimeError(source, error, meta),
  fetchWithTimeout,
  defaultTimeoutMs: NETWORK_REQUEST_TIMEOUT_MS,
  contract: runtimeDataContract,
  apiContract: runtimeApiContractModule,
  endpoints: {
    bootstrap: RUNTIME_GATEWAY_BOOTSTRAP_ENDPOINT,
    price: KRX_GATEWAY_PRICE_ENDPOINT,
    priceBatch: KRX_GATEWAY_PRICE_BATCH_ENDPOINT,
    indices: KRX_GATEWAY_INDEX_ENDPOINT,
    macro: ECOS_GATEWAY_MACRO_ENDPOINT,
    credit: CREDIT_GATEWAY_ENDPOINT,
    crisisSignal: CRISIS_SIGNAL_GATEWAY_ENDPOINT,
    disclosures: DART_GATEWAY_DISCLOSURE_ENDPOINT,
    insiderTrades: DART_GATEWAY_INSIDER_ENDPOINT,
  },
  localEndpoints: {
    indices: "./api/indices",
    macro: "./api/macro",
    credit: "./api/credit",
    crisisSignal: "./api/crisis-signal",
    disclosures: "./api/dart/disclosures",
    insiderTrades: "./api/dart/insider-trades",
  },
});

async function ensureAiFeatureModules() {
  if (!aiFeature) {
    aiFeature = await optionalFeatureRuntime.ensureAi();
    aiForecastAppModule = aiFeature.app;
    aiForecastCacheModule = aiFeature.cache;
    aiForecastTracesModule = aiFeature.traces;
  }
  if (!aiForecastApp) {
    aiForecastApp = aiForecastAppModule.createAiForecastApp(globalThis, {
      workerUrl: `./modules/ai-forecast-worker.js?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
      buildFallback: (options) => aiFeature?.forecast?.buildForecast(options) || null,
    });
  }
  return aiFeature.forecast;
}

async function ensureMarketTimingFeature() {
  if (!marketTimingService) marketTimingService = await optionalFeatureRuntime.ensureMarketTiming();
  return marketTimingService;
}
const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const normalizeCreditRows = (rows) => runtimeSeriesMergeModule.normalizeCreditInputRows(
  rows,
  CREDIT_COLS,
);
const normalizeCrisisSignalRows = (rows) => runtimeSeriesMergeModule.normalizeCrisisRows(rows);
const sameNullableNumber = (left, right) => runtimeSeriesMergeModule.sameNullableNumber(left, right);
async function fetchPreferredTickerHistory(ticker, requestOptions = {}) {
  const key = String(ticker || "").trim().toUpperCase();
  if (!/^\d{6}\.(KS|KQ)$/.test(key)) return [];
  const sinceDate = String(requestOptions.sinceDate || "").slice(0, 10);
  const query = new URLSearchParams({ ticker: key });
  if (sinceDate) query.set("since", sinceDate);
  else query.set("full", "1");
  const headers = {};
  if (!IS_LOCAL_RUNTIME) {
    const accessToken = getDartGatewayAccessToken();
    if (!accessToken) throw new Error("Think Stock access token is unavailable");
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const response = await fetchWithTimeout(
    appendCacheBust(`${TICKER_HISTORY_ENDPOINT}?${query}`),
    { cache: "no-store", headers, signal: requestOptions.signal || null },
    NETWORK_REQUEST_TIMEOUT_MS,
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || `Price history HTTP ${response.status}`);
  }
  return normalizeTickerPricePointsForTicker(payload.rows, key);
}
const browserMarketClient = browserMarketClientModule.createBrowserMarketClient({
  fetchJson: (...args) => fetchJsonWithProxyFallback(...args),
  appendCacheBust,
  shiftDays,
  toNumber: toNum,
  dayMs: DAY_MS,
  fetchLatestPrice: fetchLatestKrxTickerSeries,
  fetchPreferredHistory: fetchPreferredTickerHistory,
  validateHistory: (points, requestOptions = {}) => {
    if (requestOptions.sinceDate || points.length < 24) return true;
    const latestDate = String(points.at(-1)?.date || "").slice(0, 10);
    return inspectDailyPriceHistoryDensity(points, {
      beforeDate: shiftDays(latestDate, -(365 * 5)),
    }).dense;
  },
  isValidPricePoint: ({ ticker, date, volume }) => {
    const isKoreanEquity = /^\d{6}\.(KS|KQ)$/.test(String(ticker || "").toUpperCase());
    return !isKoreanEquity || isKoreanMarketPricePoint(date, volume);
  },
});
const {
  fetchTickerHistorySeries,
  mergePriceSeries,
} = browserMarketClient;
const POPUP_NUMBER_FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
const formatActualValue = (v) => (Number.isFinite(v) ? POPUP_NUMBER_FORMAT.format(v) : "N/A");
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const labelName = (key) => DISPLAY_NAMES[key] || key;
function customStockColorRandom() {
  try {
    const values = new Uint32Array(1);
    globalThis.crypto?.getRandomValues?.(values);
    if (values[0] > 0) return values[0] / 4294967296;
  } catch (_) {
    // Math.random is sufficient when secure browser randomness is unavailable.
  }
  return Math.random();
}
function assignColorsToCustomStocks(stocks) {
  return appStateControllerModule.assignCustomStockColors(stocks, {
    palette: CUSTOM_COLOR_PALETTE,
    reservedColors: CUSTOM_RESERVED_COLORS,
    minimumDistance: CUSTOM_COLOR_MIN_FIXED_DISTANCE,
    previousColorsByTicker: recentlyRemovedCustomStockColors,
    random: customStockColorRandom,
  });
}
function fallbackCustomColor(ticker) {
  const hash = [...String(ticker || "")]
    .reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 0);
  return CUSTOM_COLOR_PALETTE[hash % CUSTOM_COLOR_PALETTE.length];
}
function customColorForTicker(key) {
  const stock = customStocks.find((item) => item.ticker === key);
  if (!stock) return null;
  return appStateControllerModule.normalizeHexColor(stock.color) || fallbackCustomColor(key);
}
const seriesColor = (key) => SERIES_COLORS[key] || customColorForTicker(key) || "#888";
const toUtcMs = (d) => Date.parse(`${d}T00:00:00Z`);
const isTouchDevice = () => typeof window !== "undefined"
  && (("ontouchstart" in window) || ((navigator && navigator.maxTouchPoints) > 0));
const isPhoneDevice = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const userAgent = String(navigator.userAgent || "");
  if (/iPhone|iPod|Windows Phone|Android.+Mobile/i.test(userAgent)) return true;
  const shortestScreenEdge = Math.min(
    Number(window.screen?.width) || Number.POSITIVE_INFINITY,
    Number(window.screen?.height) || Number.POSITIVE_INFINITY,
  );
  return isTouchDevice() && shortestScreenEdge <= 600;
};
const getDefaultActiveMonths = () => (
  isPhoneDevice() ? DEFAULT_PHONE_ACTIVE_MONTHS : DEFAULT_DESKTOP_ACTIVE_MONTHS
);
const chartLoaderModule = globalThis.ThinkStockChartLoader;
if (!chartLoaderModule?.ensurePlotlyReady) throw new Error("Chart loader module failed to load");
const PLOTLY_CONFIG = chartLoaderModule.PLOTLY_CONFIG;
function plotlyHoverLabel(fontSize) {
  return chartLoaderModule.hoverLabel(chartSession.hoverShowPopup, fontSize);
}

const ensurePlotlyReady = chartLoaderModule.ensurePlotlyReady;
const LINE_DRAG_TOLERANCE_PX = 14;
const LINE_DRAG_TOUCH_TOLERANCE_PX = 24;
const AI_REPORT_LINE_HIT_TOLERANCE_PX = 10;
const AI_REPORT_LINE_TOUCH_HIT_TOLERANCE_PX = 20;
const LINE_HIGHLIGHT_EXTRA_WIDTH = 2;
const LINE_HIT_TEST_INTERVAL_MS = 50;
const CHART_GEOMETRY_CACHE_MS = 240;
const HANDLE_UPDATE_DEBOUNCE_MS = 40;
const DISCLOSURE_HOVER_DELAY_MS = 90;
const SNAPSHOT_SAVE_IDLE_TIMEOUT_MS = 3500;
const MAIN_LINE_TRACE_TYPE = "scatter";
const MAIN_CHART_PRESERVE_DAILY_POINTS = true;
const MAIN_CHART_MIN_DISPLAY_POINTS = 720;
const MAIN_CHART_MOBILE_MIN_DISPLAY_POINTS = 420;
const MAIN_CHART_MAX_DISPLAY_POINTS = 1500;
const MAIN_CHART_POINTS_PER_PIXEL = 1.45;
const MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_DESKTOP = 6500;
const MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_MOBILE = 2800;
const INTERACTION_RENDER_DELAY_MS = 260;
const DISCLOSURE_TRACE_NAME = "공시";
const DISCLOSURE_ICON_TEXT = "◆";
const CRISIS_SIGNAL_COLOR = "#60a5fa";
const MARKET_TIMING_BUY_COLOR = "#f9a8d4";
const MARKET_TIMING_SELL_COLOR = "#7dd3fc";
const TIMING_MARKER_GAP_MULTIPLIER = 1.1;
const DISCLOSURE_MARKER_COLOR = "#fde047";
const DISCLOSURE_MARKER_HOVER_LINE_COLOR = "#fef3c7";
const DISCLOSURE_TEXT_SIZE = 13;
const DISCLOSURE_TEXT_HOVER_SIZE = 17;
const DISCLOSURE_MOUSE_HIT_RADIUS_PX = 22;
const DISCLOSURE_TOUCH_HIT_RADIUS_PX = 30;
const EVENT_MARKER_GAP_RATIO = 0.02;
const INSIDER_MARKER_LINE_GAP_RATIO = 1.7;
const PAIRED_INSIDER_BUY_OFFSET_RATIO = 0.3;
const PAIRED_INSIDER_SELL_OFFSET_RATIO = 0.95;
const INSIDER_TIMING_COLLISION_DISTANCE_RATIO = 0.9;
const INSIDER_TIMING_COLLISION_OFFSET_RATIO = 2.2;

let pricePayload = null;
let macroRows = [];
let creditRows = [];   // KOFIA credit balance seed data (credit_data.json)
let crisisRows = [];
let disclosureRows = [];
let disclosureManifest = null;
let disclosureSeedLoadedTickers = new Set();
let insiderTradeRows = [];
let insiderTradeLoadedTickers = new Set();
let insiderTradeRefreshTimer = 0;
let insiderTradePendingTickers = new Set();
let dartCorpCodeMap = new Map();
let dartCorpCodeMapLoaded = false;
let dartCorpCodeManifest = null;
let dartCorpCodeLoadedShards = new Set();
let customStocks = [];
const recentlyRemovedCustomStockColors = new Map();
let runtimeBootstrapService = null;
let stockResearchApp = null;
let krxUniverse = [];
let krxUniverseLoaded = false;
let krxUniverseLoading = false;
let stockSuggestItems = [];
let stockSuggestActiveIndex = -1;
let loadingCustomStocks = new Set();
const tickerPriceStatusStore = tickerPriceRuntimeModule.createStatusStore({
  tickerPattern: MACD_STOCK_PATTERN,
});
const tickerVolumeSeriesByTicker = new Map();
let tickerPricePayloadController = null;
let tickerSeriesLoader = null;
let currentDisclosureHighlight = null;
let lastDisclosureTraceStats = { total: 0, candidates: 0, markers: 0 };
let lastInsiderTradeTraceStats = { total: 0, candidates: 0, markers: 0 };
let baseTraceValues = {};
let adrFinalRetryController = null;
let chartVisualFrameCoordinator = null;
let coMovementFrameScheduler = null;
let chartMarkerRuntime = null;
let historicalDataLoaded = false;
let historicalDataLoadPromise = null;
const mainChartCalcCache = chartModelCacheModule.createChartModelCache({
  maxEntries: 3,
  maxWeight: MAIN_CHART_MODEL_CACHE_MAX_WEIGHT,
  getWeight: chartModelCacheModule.estimateMainChartModelWeight,
});
const mainChartSourceFingerprintCache = chartModelCacheModule.createSourceFingerprintCache({
  fingerprint: seriesIntegrityModule.fingerprintDatedSeries,
  maxEntries: 2,
});
let lastMainChartModelCacheHit = false;
let lastMainChartModelSource = "none";
let lastAuxiliaryChartModelSource = "none";
let auxiliaryChartCalcCache = null;
let auxiliaryChartCalcPending = null;
let chartModelWorkerClient = null;
let mainChartMacroBoundsCache = { revision: "", rows: [] };
let partialDisclosureUpdateCount = 0;
let mainChartSkippedRenderCount = 0;
let mainChartPartialUpdateCount = 0;
let mainChartFullRenderCount = 0;
let lastMainChartRenderMode = "none";
let chartRenderGeneration = 0;
let chartSyncing = false;   // relayout sync loop guard
let adminAccessGranted = false;
let adminFeatureControlsReady = false;
let adminFeatureAccess = null;
let lastRecessionSignalCount = 0;
let lastMarketTimingBuyCount = 0;
let lastMarketTimingSellCount = 0;
let trimAiForecastRangeOnNextRender = false;
let revealAiForecastRangeOnNextRender = false;
let restoreAiForecastViewportOnNextRender = null;
let aiForecastEntryViewport = null;
let chartViewportInteractionRevision = 0;
let aiForecastToggleRevision = 0;
let lastAiForecastTraceCount = 0;
let aiAnalysisByTicker = new Map();
let aiAnalysisPendingTickers = new Set();
let brokerResearchByTicker = new Map();
let brokerResearchPendingTickers = new Set();
let brokerResearchService = null;
let aiContextPendingTickers = new Set();
let aiRotationSeriesByTicker = new Map();
let aiRotationSeriesPromise = null;
let aiRotationSeriesLoadSettled = false;
let aiMarketModel = null;
let aiMarketModelPromise = null;
let aiMarketModelLoadSettled = false;
let aiForecastTargetSeries = new Set();
let aiForecastTargetRevision = 0;
let aiForecastResultBySeries = new Map();
let aiForecastQualityRuntime = null;
let aiForecastCacheService = null;
let aiForecastDeferredSeries = new Set();
let aiForecastCalculationCounts = new Map();
let aiForecastUnavailableMessageKeys = new Set();
let aiForecastDeferredRenderId = 0;
let macdModelCache = new Map();
let isHandleDragging = false;
let isHandlePointerActive = false;
const chartSession = chartSessionStateModule.createChartSessionState({
  activeMonths: getDefaultActiveMonths(),
  hiddenSeries: new Set(["customer_deposit", "kospi_credit", "^KQ11", "kosdaq_credit"]),
  hiddenAuxiliarySeries: new Set(),
  hiddenAuxiliaryPanels: new Set(),
  auxiliaryPanelOrder: [...AUXILIARY_PANEL_KEYS],
  seriesOffsets: {},
  seriesScales: {},
  currentSelected: [],
  currentRows: [],
  currentStart: "",
  currentEnd: "",
  currentDataStart: "",
  currentDataEnd: "",
  currentMainChartModel: null,
  hoverShowPopup: false,
  cursorLineMode: "vertical",
  chartRightPaddingDays: 0,
  newsSentimentMovingAverageDays: NEWS_MOVING_AVERAGE_DAYS,
  showDisclosures: true,
  showInsiderTrades: false,
  showCoMovement: false,
  showChartTools: true,
  showChartHandles: true,
  showRecessionSignals: false,
  showAiForecast: false,
  pinnedXRange: null,
  userViewportPinned: false,
  autoChartReset: true,
  lockedChartFrame: null,
  lockedHistoryYRange: null,
  viewportNormalizationFrame: null,
  pendingAutoChartFit: false,
  pendingAutoChartFitExpandOnly: false,
  pendingCompositionViewport: null,
});
const mainChartControlView = appUiBindingsModule.createMainChartControlView(globalThis, {
  state: chartSession,
  controlStateView,
  cursorLineLabels: CURSOR_LINE_LABELS,
  normalizeCursorLineMode,
  normalizeNewsMovingAverageDays,
  newsMovingAverageMinDays: NEWS_MOVING_AVERAGE_MIN_DAYS,
  newsMovingAverageMaxDays: NEWS_MOVING_AVERAGE_MAX_DAYS,
  applyHandlesContainer: chartLayoutPolicyModule.applyContainer,
  getSignalCounts: () => ({
    buy: lastMarketTimingBuyCount,
    sell: lastMarketTimingSellCount,
    recession: lastRecessionSignalCount,
  }),
  resolveCoMovementTarget,
  labelName,
});
let hoverSyncing = false;
let cursorSyncing = false;
let mainChartRenderScheduler = null;
let mainSeriesController = null;
let chartUpdateCoordinator = null;
let chartSessionController = null;
let chartPointerRuntime = null;
let chartHoverRuntime = null;
let auxiliaryChartRuntime = null;
let mainChartEvents = null;
let settingsPanelRuntime = null;
let settingsPanelLoadPromise = null;
let runtimeSeriesController = null;
let aiForecastTracesRuntime = null;
let runtimeRefreshOrchestrator = null;
let viewportRelayoutQueue = null;
let handleUpdateTimer = 0;
let disclosureHoverTimer = 0;
let pendingDisclosureHoverData = null;
let disclosureGroupStore = new Map();
let lineHitIndexCache = new WeakMap();
let aiReportLineHitIndexCache = new WeakMap();
let chartRangeSyncController = null;
let chartCursorSyncController = null;
let chartNavigationController = null;
const chartDataRangeCache = chartViewportControllerModule.createDataRangeCache({
  toMilliseconds: toMsSafe,
  shouldInclude: (trace) => !(
    trace?.visible === "legendonly"
    || trace?.meta?.isDisclosureTrace
    || trace?.meta?.isInsiderTradeTrace
    || trace?.meta?.isAiForecastTrace
    || trace?.meta?.isAiForecastScenarioTrace
  ),
});
const chartAiForecastRangeCache = chartViewportControllerModule.createDataRangeCache({
  toMilliseconds: toMsSafe,
  shouldInclude: (trace) => (
    trace?.visible !== "legendonly"
    && trace?.meta?.isAiForecastScenarioTrace
  ),
});
let suppressPlotlyClickUntil = 0;
let hoveredLineTraceIndex = null;
let activeLineTraceIndex = null;
let appliedLineHighlightTraceIndex = null;
let lastVisibleStockSeriesKey = "";
let isViewportDragging = false;
let isWheelZooming = false;
let useViewportEventMarkerGap = false;
let runtimeSnapshotController = null;
let tickerCacheInvalidator = null;
let lineHighlightDomUpdateCount = 0;
let disclosureHighlightDomUpdateCount = 0;
let dataFreshnessRenderFrame = 0;
function initE2eDebugAccess() {
  if (!ENABLE_E2E_DIAGNOSTICS) return;
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
      getHiddenAuxiliarySeries() {
        return [...chartSession.hiddenAuxiliarySeries].sort();
      },
      getChartRenderGeneration() {
        return chartRenderGeneration;
      },
      getRefreshPhaseStats() {
        return runtimeDataApp.getPhaseStats();
      },
      getCrisisSignalStats() {
        const entries = collectCrisisSignalEntries(crisisRows);
        return {
          rows: crisisRows.length,
          entries: entries.length,
          visibleEntries: entries.filter((row) => row.date >= chartSession.currentStart && row.date <= chartSession.currentEnd).length,
          enabled: chartSession.showRecessionSignals,
          renderedMarkers: lastRecessionSignalCount,
          buyMarkers: lastMarketTimingBuyCount,
          sellMarkers: lastMarketTimingSellCount,
          firstDate: crisisRows[0]?.date || "",
          latestDate: crisisRows.at(-1)?.date || "",
        };
      },
      getTimingMarkerPixelGaps() {
        const chart = document.getElementById("chart");
        const axis = chart?._fullLayout?.yaxis;
        const models = chartSession.currentMainChartModel?.seriesModels || [];
        const selected = chartSession.currentMainChartModel?.selected || [];
        if (!axis || typeof axis.d2p !== "function" || !models.length) return [];
        const pointIndex = buildDisclosurePointIndex(models, new Set(selected));
        return (chart.data || []).flatMap((trace) => {
          if (!trace?.meta?.isMarketTimingBuyTrace && !trace?.meta?.isMarketTimingSellTrace) return [];
          return (trace.x || []).flatMap((date, index) => {
            const ticker = selected.find((series) => labelName(series) === trace.customdata?.[index]?.[0]);
            const point = findPointOnOrAfterDate(date, ticker, pointIndex, 4);
            const markerY = Number(trace.y?.[index]);
            return point && Number.isFinite(markerY)
              ? [Math.abs(axis.d2p(markerY) - axis.d2p(point.y))]
              : [];
          });
        });
      },
      getInsiderTradeState() {
        return {
          enabled: chartSession.showInsiderTrades,
          rows: insiderTradeRows.length,
          loadedTickers: [...insiderTradeLoadedTickers],
          pendingTickers: [...insiderTradePendingTickers],
          visibleTickers: visibleDisclosureTargetTickers(),
          gatewayReady: canUseDartGateway(),
        };
      },
      getDisclosureProgressState() {
        return {
          enabled: chartSession.showDisclosures,
          pendingTickers: dartRequestRuntime.identities("disclosure-refresh").sort(),
          ...disclosureProgress.snapshot(),
        };
      },
      getAiForecastState() {
        return {
          enabled: chartSession.showAiForecast,
          targets: [...aiForecastTargetSeries].sort(),
          deferredTargets: [...aiForecastDeferredSeries].sort(),
          cachedTargets: [...aiForecastResultBySeries.keys()].sort(),
          cacheInputKeys: Object.fromEntries([...aiForecastResultBySeries.entries()]
            .map(([series, entry]) => [series, entry?.inputKey || ""])),
          calculationCounts: Object.fromEntries(aiForecastCalculationCounts),
          inputsPending: aiForecastInputsPending(),
          marketModelSettled: aiMarketModelLoadSettled,
          analysisPending: activeAiAnalysisTickers()
            .filter((ticker) => aiAnalysisPendingTickers.has(ticker))
            .sort(),
          quality: summarizeAiForecastQualityDiagnostics(),
          renderedTargets: [...new Set((document.getElementById("chart")?.data || [])
            .filter((trace) => trace?.meta?.isAiForecastTrace)
            .map((trace) => String(trace?.meta?.seriesKey || "")))]
            .filter(Boolean)
            .sort(),
        };
      },
      getChartWorkerStats() {
        const workerStats = chartModelWorkerClient?.stats?.() || {};
        return {
          dispatched: Number(workerStats.dispatched) || 0,
          sourceTransfers: Number(workerStats.sourceTransfers) || 0,
          superseded: Number(workerStats.superseded) || 0,
          partialDisclosureUpdates: partialDisclosureUpdateCount,
          skippedChartRenders: mainChartSkippedRenderCount,
          partialChartUpdates: mainChartPartialUpdateCount,
          fullChartRenders: mainChartFullRenderCount,
          lastChartRenderMode: lastMainChartRenderMode,
          renderTelemetry: chartRenderTelemetry.snapshot(),
          scheduler: mainChartRenderScheduler?.stats?.() || null,
          coordinator: chartUpdateCoordinator?.stats?.() || null,
          modelCache: mainChartCalcCache.stats(),
          sourceFingerprintCache: mainChartSourceFingerprintCache.stats(),
          dispatchByType: { ...(workerStats.dispatchByType || {}) },
          activeType: workerStats.activeType || "",
          queuedTypes: [...(workerStats.queuedTypes || [])],
        };
      },
      getRuntimeSnapshotStats() {
        return {
          ...getRuntimeSnapshotController().stats(),
          revisions: getDataRevisions(),
        };
      },
      getCacheCleanupStats() {
        return { ...granularCacheMaintenance.stats() };
      },
      getHighlightStats() {
        return {
          lineDomUpdates: lineHighlightDomUpdateCount,
          disclosureDomUpdates: disclosureHighlightDomUpdateCount,
        };
      },
      getSeriesTransforms() {
        return {
          offsets: { ...chartSession.seriesOffsets },
          scales: { ...chartSession.seriesScales },
        };
      },
      applyNewsSentimentForTest(rows) {
        const result = applyNewsSentimentLiveRows(rows);
        if (result.updated > 0) {
          mainChartCalcCache.clear();
          invalidateAdrChartRender();
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
      async loadHistoricalDataForTest() {
        const visibleRange = getCurrentXRangeMs(document.getElementById("chart"));
        await ensureHistoricalDataLoaded(false);
        if (visibleRange) chartSession.pinnedXRange = visibleRange.map((value) => new Date(value).toISOString());
        await runMainChartRender(true);
        return historicalDataLoaded;
      },
      getActiveMonths() {
        return chartSession.activeMonths;
      },
      async setActiveMonthsForTest(value) {
        chartSession.activeMonths = Math.max(1, Math.min(360, Number(value) || getDefaultActiveMonths()));
        chartSession.pinnedXRange = null;
        chartSession.userViewportPinned = false;
        if (chartSession.activeMonths > RECENT_DATA_MONTHS) await ensureHistoricalDataLoaded(false);
        await runMainChartRender(false);
        return chartSession.activeMonths;
      },
      async setViewportRangeForTest(range) {
        const startMs = Number(range?.[0]);
        const endMs = Number(range?.[1]);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
        cancelLatestViewportAnimation();
        applySyncedXRangeMs(startMs, endMs, {
          source: "e2e-range",
          fit: false,
          liveFit: false,
          userInitiated: false,
        });
        await getChartRangeSyncController().flush();
        return getCurrentXRangeMs(document.getElementById("chart"));
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
        const yaxis = trace?.yaxis === "y2"
          ? chart?._fullLayout?.yaxis2
          : chart?._fullLayout?.yaxis;
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
function applyCustomStockDisplayNames() {
  customStocks.forEach((item) => {
    if (item?.ticker && item?.name) DISPLAY_NAMES[item.ticker] = item.name;
  });
}

let appStateController = null;
function getAppStateController() {
  if (appStateController) return appStateController;
  appStateController = appStateControllerModule.createAppStateController({
    state: chartSession,
    store: appStateStore,
    panelKeys: AUXILIARY_PANEL_KEYS,
    seriesKeys: AUXILIARY_SERIES_KEYS,
    maxCustomStocks: MAX_CUSTOM_STOCKS,
    normalizeCursorLineMode,
    normalizeChartRightPaddingDays,
    normalizeNewsMovingAverageDays,
    getCustomStocks: () => customStocks,
    setCustomStocks: (value) => { customStocks = value; },
    applyCustomStockDisplayNames,
    getCreditOffset: () => CREDIT_OFFSET_DAYS,
    setCreditOffset: (value) => { CREDIT_OFFSET_DAYS = value; },
  });
  return appStateController;
}

function saveState() {
  return getAppStateController().save();
}

function loadState() {
  const controller = getAppStateController();
  const loaded = controller.load({ allowActiveMonths: IS_E2E_RUNTIME });
  if (!loaded || !customStocks.length) return loaded;
  const coloredStocks = assignColorsToCustomStocks(customStocks);
  const colorsChanged = coloredStocks.some((stock, index) => stock.color !== customStocks[index]?.color);
  customStocks = coloredStocks;
  if (colorsChanged) controller.save();
  return loaded;
}

const disclosureDataService = createDisclosureDataService({
  classifyType: classifyDisclosureType,
  shouldDisplay: shouldDisplayDisclosure,
  labelName,
  refreshCacheKey: DART_DISCLOSURE_CACHE_KEY,
  refreshCacheTtlMs: DART_DISCLOSURE_CACHE_TTL_DAYS * DAY_MS,
  refreshStore: disclosureRefreshStore,
});

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
  return dartRequestRuntime.run("corp-manifest", "global", async () => {
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
  }, { force: forceNetwork });
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
  return dartRequestRuntime.run("corp-shard", prefix, async () => {
    const path = `./${String(relativePath).replace(/^\.?\//, "")}`;
    const text = await fetchSeedText(path, forceNetwork);
    if (!text) return false;
    const payload = JSON.parse(text);
    if (payload?.format !== "stock-to-corp-shard-v1" || !payload?.codes) return false;
    mergeDartCorpCodeRows(payload.codes);
    dartCorpCodeLoadedShards.add(prefix);
    return dartCorpCodeMap.has(code);
  }, { force: forceNetwork });
}

function getDataRevisions() {
  return runtimeSnapshotRevisionTracker.getRevisions();
}

function markDataChanged(...names) {
  runtimeSnapshotRevisionTracker.markChanged(names);
  scheduleDataFreshnessRender();
}

function applySnapshotRevisions(revisions, loadedNames) {
  runtimeSnapshotRevisionTracker.applyRevisions(revisions, loadedNames);
}

function sanitizeRuntimePricePayload(raw) {
  return sanitizeKoreanEquityPricePayload(raw, {
    isTradingDate: (date) => isKoreanTradingDate(date),
  });
}

function getSnapshotComponent(name) {
  return runtimeSnapshotRevisionTracker.getComponent(name, () => {
    if (name === "price") return sanitizeRuntimePricePayload(pricePayload);
    if (name === "macro") return normalizePayloadRecords(macroRows);
    if (name === "credit") return normalizeCreditRows(creditRows);
    if (name === "adr") return normalizePayloadRecords(adrRows);
    if (name === "crisis") return normalizeCrisisSignalRows(crisisRows);
    if (name === "disclosure") return sanitizeDisclosureRows(disclosureRows);
    return null;
  });
}

function buildRuntimeDataSnapshot() {
  if (!hasRuntimeDataLoaded() && !disclosureRows.length) return null;
  const revisions = getDataRevisions();
  const persistedRevisions = getRuntimeSnapshotController().persistedRevisions();
  const components = {};
  Object.keys(RUNTIME_SNAPSHOT_COMPONENT_KEYS).forEach((name) => {
    if (Number(persistedRevisions[name]) === Number(revisions[name])) return;
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

  const safePricePayload = sanitizeRuntimePricePayload(snapshot.pricePayload);
  const safeMacroRows = normalizePayloadRecords(snapshot.macroRows);
  const safeCreditRows = normalizeCreditRows(snapshot.creditRows);
  const safeAdrRows = normalizePayloadRecords(snapshot.adrRows);
  const safeCrisisRows = normalizeCrisisSignalRows(snapshot.crisisRows);
  const safeDisclosureRows = sanitizeDisclosureRows(snapshot.disclosureRows);

  // A restored view cannot render without prices; reload the seed instead of accepting a partial snapshot.
  if (!safePricePayload?.records?.length) return false;
  if (!safePricePayload && !safeMacroRows.length && !safeCreditRows.length && !safeAdrRows.length && !safeCrisisRows.length && !safeDisclosureRows.length) return false;
  const snapshotComponents = {
    price: safePricePayload,
    macro: safeMacroRows,
    credit: safeCreditRows,
    adr: safeAdrRows,
    crisis: safeCrisisRows,
  };
  for (const [name, value] of Object.entries(snapshotComponents)) {
    const wasIncluded = name === "price" || Array.isArray(snapshot[`${name}Rows`]);
    if (!wasIncluded) continue;
    if (!runtimeSeriesQualityGateModule.validateSnapshotComponent(name, value).ok) return false;
  }

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
  if (Array.isArray(snapshot.crisisRows)) {
    crisisRows = safeCrisisRows;
    loadedNames.push("crisis");
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
              : name === "crisis" ? safeCrisisRows
                : safeDisclosureRows,
    );
  });
  historicalDataLoaded = hasHistoricalDataCoverage();
  getRuntimeSnapshotController().markRestored(
    getRuntimeDataSignature(),
    snapshot._persistedRevisions || {},
  );
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

async function readLifecycleCacheRecord(storeName, key) {
  return granularCacheMaintenance.readActiveRecord(storeName, key);
}

const readAllIndexedDbRecords = (storeName) => (
  indexedCacheStore.readAllRecords(storeName)
);

const writeIndexedDbRecord = (storeName, key, value) => (
  indexedCacheStore.writeRecord(storeName, key, value)
);

const deleteIndexedDbRecord = (storeName, key) => (
  indexedCacheStore.deleteRecord(storeName, key)
);

async function ensureTickerSeriesCacheRetention() {
  if (tickerSeriesCacheRetention.isInitialized()) return tickerSeriesCacheRetention.stats();
  if (!tickerSeriesCacheRetentionInitPromise) {
    tickerSeriesCacheRetentionInitPromise = readAllIndexedDbRecords(TICKER_PRICE_CACHE_STORE_NAME)
      .then((records) => {
        tickerSeriesCacheRetention.initialize(records);
        return tickerSeriesCacheRetention.stats();
      })
      .catch(() => {
        tickerSeriesCacheRetention.initialize([]);
        return tickerSeriesCacheRetention.stats();
      })
      .finally(() => { tickerSeriesCacheRetentionInitPromise = null; });
  }
  return tickerSeriesCacheRetentionInitPromise;
}

function runTickerPriceCacheMutation(operation) {
  const task = tickerPriceCacheMutationQueue.then(operation, operation);
  tickerPriceCacheMutationQueue = task.catch(() => {});
  return task;
}

async function removeTickerPriceCacheRecord(key) {
  const normalized = String(key || "").trim().toUpperCase();
  if (!normalized) return false;
  return runTickerPriceCacheMutation(async () => {
    await ensureTickerSeriesCacheRetention();
    await deleteIndexedDbRecord(TICKER_PRICE_CACHE_STORE_NAME, normalized);
    tickerSeriesCacheRetention.noteRemoved(normalized);
    return true;
  });
}

async function removeInvalidGranularCacheRecord(storeName, key) {
  return granularCacheMaintenance.removeInvalidRecord(storeName, key);
}

async function pruneGranularCacheStore(storeName, maxRecords = null) {
  return granularCacheMaintenance.pruneStore(storeName, maxRecords);
}

function scheduleGranularCachePrune(
  storeName,
  maxRecords = null,
  delayMs = 2500,
) {
  return granularCacheMaintenance.schedulePrune(storeName, maxRecords, delayMs);
}

function scheduleGranularCacheCleanup() {
  granularCacheMaintenance.scheduleAll().forEach((task) => task.catch(() => {}));
}

function readRuntimeSnapshotFromLocalStorage() {
  return runtimeSnapshotLocalStore.read(null);
}

function getAdminFeatureAccess() {
  if (adminFeatureAccess) return adminFeatureAccess;
  adminFeatureAccess = adminFeatureAccessModule.createAdminFeatureAccess(globalThis, {
    sessionKey: ADMIN_SESSION_STORAGE_KEY,
    deviceKey: ADMIN_DEVICE_STORAGE_KEY,
    requestSession: requestAdminSession,
    buttonIds: ADMIN_FEATURE_BUTTON_IDS,
    controlsReady: () => adminFeatureControlsReady,
    getElement: (id) => document.getElementById(id),
    onStateChange: (enabled) => { adminAccessGranted = Boolean(enabled); },
  });
  return adminFeatureAccess;
}

function loadAdminAccessState() {
  return getAdminFeatureAccess().load();
}

async function restoreAdminAccessState() {
  const previous = adminAccessGranted;
  const result = await getAdminFeatureAccess().restore();
  if (previous !== adminAccessGranted) applyAdminAccessEffects();
  else syncAdminFeatureAccess();
  return result;
}

function enforceGeneralModeState() {
  if (adminAccessGranted) return;
  chartSession.showDisclosures = false;
  chartSession.showRecessionSignals = false;
  chartSession.showCoMovement = false;
  chartSession.showInsiderTrades = false;
  if (chartSession.showAiForecast) aiForecastToggleRevision += 1;
  chartSession.showAiForecast = false;
  refreshAiForecastTargets();
  revealAiForecastRangeOnNextRender = false;
  trimAiForecastRangeOnNextRender = true;
  restoreAiForecastViewportOnNextRender = null;
  aiForecastEntryViewport = null;
  stopAiForecastProgress();
}

function syncAdminFeatureAccess() {
  return getAdminFeatureAccess().sync();
}

function applyAdminAccessEffects(options = {}) {
  if (!adminAccessGranted) enforceGeneralModeState();
  syncRecessionToggleButton();
  syncCoMovementToggleButton();
  syncAiForecastToggleButton();
  syncDisclosureToggleButton();
  syncInsiderTradeToggleButton(0);
  syncAdminFeatureAccess();
  renderCoMovementPanel();
  saveState();
  if (options.render !== false) requestChartCompositionUpdate();
}

async function authenticateAdminAccess(code) {
  const result = await getAdminFeatureAccess().authenticate(code);
  if (result.ok) applyAdminAccessEffects();
  return result;
}

function clearAdminAccessState() {
  getAdminFeatureAccess().clear();
  applyAdminAccessEffects();
}

function writeRuntimeSnapshotToLocalStorage(snapshot) {
  runtimeSnapshotLocalStore.write(snapshot);
}

function deleteRuntimeSnapshotFromLocalStorage() {
  runtimeSnapshotLocalStore.remove();
}

function isChartInteractionBusy() {
  return Boolean(
    isViewportDragging
    || isWheelZooming
    || isHandleDragging
    || chartVisualFrameCoordinator?.hasPending?.()
    || chartCursorSyncController?.isBusy?.()
    || viewportRelayoutQueue?.isBusy?.()
  );
}

function getRuntimeSnapshotController() {
  if (runtimeSnapshotController) return runtimeSnapshotController;
  runtimeSnapshotController = runtimeSnapshotControllerModule.createRuntimeSnapshotController(globalThis, {
    idleTimeoutMs: SNAPSHOT_SAVE_IDLE_TIMEOUT_MS,
    getSignature: getRuntimeDataSignature,
    buildSnapshot: buildRuntimeDataSnapshot,
    buildFallbackSnapshot: buildCompactLocalSnapshot,
    applySnapshot: applyRuntimeDataSnapshot,
    readPrimary: readRuntimeSnapshotFromIndexedDb,
    writePrimary: writeRuntimeSnapshotToIndexedDb,
    deletePrimary: deleteRuntimeSnapshotFromIndexedDb,
    readFallback: readRuntimeSnapshotFromLocalStorage,
    writeFallback: writeRuntimeSnapshotToLocalStorage,
    deleteFallback: deleteRuntimeSnapshotFromLocalStorage,
    isInteractionBusy: isChartInteractionBusy,
  });
  return runtimeSnapshotController;
}

function readLastRuntimeSnapshot() {
  return getRuntimeSnapshotController().read();
}

function clearLastRuntimeSnapshot() {
  return getRuntimeSnapshotController().clear();
}

function saveLastRuntimeSnapshot() {
  return getRuntimeSnapshotController().save();
}

function scheduleLastRuntimeSnapshotSave(delayMs = 1500) {
  getRuntimeSnapshotController().schedule(delayMs);
}

function loadLastRuntimeSnapshot() {
  return getRuntimeSnapshotController().load();
}

function bindRuntimeSnapshotExitSave() {
  return getRuntimeSnapshotController().bindExitSave();
}

async function clearAllAppCaches() {
  await getRuntimeSnapshotController().prepareForClear();
  try {
    await stockResearchApp?.clearCache({ bypassSummary: false, clearHistory: false });
  } catch (_) {}
  await appCacheManager.clear();
  tickerSeriesCacheRetention.reset();
}

function resetStoredAppState() {
  APP_STATE_RESET_STORAGE_KEYS.forEach((key) => {
    try { globalThis.localStorage?.removeItem(key); } catch (_) {}
  });
}

function syncApiOptionsButton() {
  controlStateView.syncControl(document.getElementById("apiOptionsBtn"), {
    classes: { "is-configured": canUseDartGateway() },
  });
}

function getDartGatewayAccessToken() {
  return String(dartGatewaySettingsStore.load()?.accessToken || "").trim();
}

function canUseDartGateway() {
  return IS_LOCAL_RUNTIME || Boolean(getDartGatewayAccessToken());
}

function normalizeTickerPriceStatus(ticker, value = {}) {
  return tickerPriceStatusStore.normalize(ticker, value);
}

function setTickerPriceStatus(ticker, value = {}) {
  const status = tickerPriceStatusStore.set(ticker, value);
  if (!status) return null;
  scheduleDataFreshnessRender();
  return status;
}

function visibleTickerPriceStatus() {
  return tickerPriceStatusStore.visible(visibleStockSeriesKeys(), lastVisibleStockSeriesKey);
}

async function fetchLatestKrxTickerSeries(ticker, options = {}) {
  const key = String(ticker || "").toUpperCase();
  if (!/^\d{6}\.(KS|KQ)$/.test(key) || !canUseDartGateway()) return [];
  try {
    const payload = await runtimeGatewayClient.fetchPrice(key, {
      forceNetwork: Boolean(options?.forceNetwork),
      signal: options?.signal || null,
      timeoutMs: NETWORK_REQUEST_TIMEOUT_MS,
    });
    setTickerPriceStatus(key, {
      source: payload.source,
      latestDate: payload.latestDate,
      marketDate: payload.marketDate,
      expectedDate: payload.expectedDate,
      cached: payload.cached,
      stale: payload.stale,
      crossCheck: payload.crossCheck,
      warning: payload.warning,
    });
    return (Array.isArray(payload.records) ? payload.records : [])
      .map((point) => ({ date: String(point?.date || "").slice(0, 10), close: toNum(point?.close) }))
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && point.close !== null && point.close > 0);
  } catch (error) {
    if (isAbortError(error) || options?.signal?.aborted) throw error;
    const previous = tickerPriceStatusStore.get(key) || {};
    setTickerPriceStatus(key, {
      ...previous,
      source: previous.source || "LOCAL_CACHE",
      localCache: true,
      cached: true,
      stale: true,
      warning: `최신 가격 갱신 실패: ${error?.message || error}`,
    });
    throw error;
  }
}

async function validateDartGatewayAccessToken(accessToken) {
  const response = await fetchWithTimeout(DART_GATEWAY_AUTH_CHECK_ENDPOINT, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${String(accessToken || "").trim()}` },
  }, NETWORK_REQUEST_TIMEOUT_MS);
  const payload = await response.json().catch(() => null);
  return { ok: response.ok && payload?.ok === true, status: response.status };
}

function clearInvalidDartGatewayAccessToken() {
  try { dartGatewaySettingsStore.clear(); } catch (_) {}
  syncApiOptionsButton();
}

function renderAppVersionLabel() {
  const labels = [
    document.getElementById("appVersionText"),
    ...document.querySelectorAll("[data-app-version-copy]"),
  ].filter(Boolean);
  labels.forEach((el) => {
    el.textContent = APP_VERSION;
    el.title = `Build ${APP_BUILD_VERSION}`;
  });
}

async function requestAdminSession(payload) {
  const headers = { "Content-Type": "application/json" };
  if (!IS_LOCAL_RUNTIME) {
    const accessToken = getDartGatewayAccessToken();
    const allowMockedE2eRequest = ENABLE_E2E_DIAGNOSTICS && IS_E2E_RUNTIME;
    if (!accessToken && !allowMockedE2eRequest) return { ok: false, status: 401 };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  }
  try {
    const response = await fetchWithTimeout(ADMIN_SESSION_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify(payload || {}),
    }, NETWORK_REQUEST_TIMEOUT_MS);
    const body = await response.json().catch(() => null);
    return {
      ...(body && typeof body === "object" ? body : {}),
      ok: response.ok && body?.ok === true,
      status: response.status,
    };
  } catch (_) {
    return { ok: false, status: 0 };
  }
}

function setMessage(msgEl, lines, isError = false) {
  controlStateView.renderMessage(msgEl, lines, { error: isError, escape: escapeHtml });
}

function syncDisclosureToggleButton() {
  controlStateView.syncControl(document.getElementById("disclosureToggle"), {
    active: chartSession.showDisclosures,
    pressed: chartSession.showDisclosures,
    text: "공시",
    title: chartSession.showDisclosures ? "공시 마커 켜짐" : "공시 마커 꺼짐",
  });
}

function setRuntimeRefreshStatus(state, detail = "") {
  runtimeDataApp.setStatus(state, detail);
}

function scheduleDataFreshnessRender() {
  if (dataFreshnessRenderFrame) return;
  dataFreshnessRenderFrame = requestAnimationFrame(() => {
    dataFreshnessRenderFrame = 0;
    renderDataFreshness();
  });
}

function renderDataFreshness() {
  const el = document.getElementById("dataFreshness");
  if (!el) return;
  if (dataFreshnessRenderFrame) {
    cancelAnimationFrame(dataFreshnessRenderFrame);
    dataFreshnessRenderFrame = 0;
  }

  const selectedPriceStatus = visibleTickerPriceStatus();
  const renderSignature = [
    new Date().toISOString().slice(0, 10),
    dataRevisionSignature("price", "macro", "credit", "adr", "crisis"),
    JSON.stringify(selectedPriceStatus || null),
  ].join("|");
  dataFreshnessController.render(el, {
    renderSignature,
    priceStatus: selectedPriceStatus,
    pricePayload,
    macroRows,
    creditRows,
    adrRows,
    crisisRows,
    creditKeys: CREDIT_COLS,
    adrKeys: ADR_SERIES,
    fearGreedKeys: FEAR_GREED_SERIES,
    volatilityKeys: VOLATILITY_SERIES,
  });
}

async function fetchLatestKrxTickerSeriesBatch(tickers, options = {}) {
  return getRuntimeBootstrapService().fetchLatestPriceSeriesBatch(tickers, options);
}

function getSettingsPanelRuntime() {
  if (settingsPanelRuntime) return settingsPanelRuntime;
  if (!settingsPanelRuntimeModule || !apiPeriodsModule || !releaseNotesModule) {
    throw new Error("Settings panel modules are not loaded");
  }
  settingsPanelRuntime = settingsPanelRuntimeModule.createSettingsPanelRuntime(globalThis, {
    ADMIN_ACCESS_MASK,
    APP_BUILD_VERSION,
    APP_VERSION,
    NEWS_MOVING_AVERAGE_MIN_DAYS,
    NEWS_MOVING_AVERAGE_MAX_DAYS,
    CHART_RIGHT_PADDING_MIN_DAYS,
    CHART_RIGHT_PADDING_MAX_DAYS,
    STOCK_RESEARCH_UNIVERSE_MIN: stockResearchContract.UNIVERSE_SIZE_LOW,
    STOCK_RESEARCH_UNIVERSE_MAX: stockResearchContract.UNIVERSE_SIZE_HIGH,
    STOCK_RESEARCH_UNIVERSE_STEP: stockResearchContract.UNIVERSE_SIZE_STEP,
    apiPeriodsModule,
    releaseNotesModule,
    appCacheManager,
    authenticateAdminAccess,
    clearAdminAccessState,
    clearAllAppCaches,
    dartGatewaySettingsStore,
    deferredPerformanceDiagnostics,
    disclosureRefreshStore,
    getAdminAccessGranted: () => adminAccessGranted,
    getBlockedStockCount: () => stockResearchApp?.getBlockedCount?.() || 0,
    getCursorLineMode: () => chartSession.cursorLineMode,
    getChartRightPaddingDays: () => chartSession.chartRightPaddingDays,
    getNewsSentimentMovingAverageDays: () => chartSession.newsSentimentMovingAverageDays,
    getStockResearchUniverseSize: () => stockResearchApp?.getUniverseSize?.()
      ?? stockResearchContract.UNIVERSE_SIZE_DEFAULT,
    getDartGatewayAccessToken,
    getRuntimeDiagnosticState: buildRuntimeDiagnosticAppState,
    resetStoredAppState,
    setMessage,
    setCursorLineMode,
    setChartRightPaddingDays,
    setNewsSentimentMovingAverageDays,
    setStockResearchUniverseSize: (value) => stockResearchApp?.setUniverseSize?.(value)
      ?? stockResearchContract.UNIVERSE_SIZE_DEFAULT,
    syncApiOptionsButton,
    validateDartGatewayAccessToken,
  });
  return settingsPanelRuntime;
}

function ensureSettingsPanelRuntime() {
  if (settingsPanelRuntime) return Promise.resolve(settingsPanelRuntime);
  if (!settingsPanelLoadPromise) {
    settingsPanelLoadPromise = optionalFeatureRuntime.ensureSettings().then((feature) => {
      apiPeriodsModule = feature.apiPeriods;
      releaseNotesModule = feature.releaseNotes;
      settingsPanelRuntimeModule = feature.runtime;
      return getSettingsPanelRuntime();
    }).finally(() => { settingsPanelLoadPromise = null; });
  }
  return settingsPanelLoadPromise;
}

function setupApiSettingsPanel(msgEl) {
  const openButton = document.getElementById("apiOptionsBtn");
  if (!openButton || openButton.dataset.settingsLazyBound === "1") return;
  openButton.dataset.settingsLazyBound = "1";
  const openSettings = async () => {
    if (openButton.getAttribute("aria-busy") === "true") return;
    openButton.setAttribute("aria-busy", "true");
    try {
      const runtime = await ensureSettingsPanelRuntime();
      openButton.removeEventListener("click", openSettings);
      runtime.setup(msgEl);
      runtime.open();
    } catch (error) {
      setMessage(msgEl, `Settings load failed: ${error.message}`, true);
    } finally {
      openButton.removeAttribute("aria-busy");
    }
  };
  openButton.addEventListener("click", openSettings);
}

function scheduleApiPeriodReminderLoad() {
  const load = () => ensureSettingsPanelRuntime()
    .then((runtime) => runtime.scheduleApiPeriodReminder())
    .catch((error) => recordRuntimeError("settings-reminder-load", error));
  setTimeout(load, 1200);
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

function hasHistoricalDataCoverage() {
  return runtimeSnapshotPolicyModule.hasCoreHistoricalCoverage({
    price: pricePayload?.records,
    macro: macroRows,
    credit: creditRows,
  }, RECENT_DATA_MONTHS);
}


function getChartHoverRuntime() {
  if (chartHoverRuntime) return chartHoverRuntime;
  chartHoverRuntime = chartHoverRuntimeModule.createChartHoverRuntime(globalThis, {
    findNearestHoverPoint,
    getTraceTimeMsArray,
    toMsSafe,
    onSyncingChange: (value) => { hoverSyncing = Boolean(value); },
  });
  return chartHoverRuntime;
}

function syncHoverToChart(targetEl, xValue) {
  getChartHoverRuntime().syncHoverToChart(targetEl, xValue);
}

function nearestMainLineDate(chartEl, xValue) {
  return getChartHoverRuntime().nearestMainLineDate(chartEl, xValue);
}

function configureExactDateEventHover(chartEl, eventData) {
  getChartHoverRuntime().configureExactDateEventHover(chartEl, eventData);
}

function clearHoverOnChart(targetEl) {
  getChartHoverRuntime().clearHoverOnChart(targetEl);
}

function getChartCursorSyncController() {
  if (chartCursorSyncController) return chartCursorSyncController;
  chartCursorSyncController = chartCursorSyncModule.createCursorSyncController(window, {
    geometryTtlMs: CHART_GEOMETRY_CACHE_MS,
    getMode: () => chartSession.cursorLineMode,
    getTargets: () => [
      document.getElementById("chart"),
      document.getElementById("chart-macd"),
      document.getElementById("chart-adr"),
    ].filter((element) => element && !element.hidden),
  });
  return chartCursorSyncController;
}

function scheduleSyncedCursor(
  xValue,
  sourceEl,
  sourceClientX,
  sourceLocalX = null,
  sourceClientY = null,
  sourceLocalY = null,
) {
  getChartCursorSyncController().schedule({
    xValue,
    sourceElement: sourceEl,
    sourceClientX,
    sourceLocalPixel: sourceLocalX,
    sourceClientY,
    sourceLocalYPixel: sourceLocalY,
  });
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

function getChartDataRangeMs(sourceEl) {
  return chartDataRangeCache.get(sourceEl);
}

function chartRightPaddingMs() {
  return normalizeChartRightPaddingDays(chartSession.chartRightPaddingDays) * DAY_MS;
}

function extendChartRangeRight(range) {
  if (!Array.isArray(range) || range.length < 2) return range;
  const start = Number(range[0]);
  const end = Number(range[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return range;
  return [start, end + chartRightPaddingMs()];
}

function getChartNavigationDataRangeMs(sourceEl) {
  const observedRange = getChartDataRangeMs(sourceEl);
  if (!chartSession.showAiForecast) return extendChartRangeRight(observedRange);
  const forecastRange = chartAiForecastRangeCache.get(sourceEl);
  if (!observedRange) return extendChartRangeRight(forecastRange);
  if (!forecastRange) return extendChartRangeRight(observedRange);
  return extendChartRangeRight([
    Math.min(observedRange[0], forecastRange[0]),
    Math.max(observedRange[1], forecastRange[1]),
  ]);
}

function isLatestChartViewport() {
  const element = document.getElementById("chart");
  const viewRange = getCurrentXRangeMs(element);
  const dataRange = getChartDataRangeMs(element);
  if (!viewRange || !dataRange) return true;
  const tolerance = Math.max(DAY_MS * 3, (dataRange[1] - dataRange[0]) * 0.001);
  return viewRange[1] >= dataRange[1] - tolerance;
}

function getChartNavigationController() {
  if (chartNavigationController) return chartNavigationController;
  chartNavigationController = chartNavigationAppModule.createChartNavigation(globalThis, {
    viewport: chartViewportControllerModule,
    dayMs: DAY_MS,
    minimumSpan: MIN_CHART_VIEW_SPAN_MS,
    getElement: () => document.getElementById("chart"),
    getMessageElement: () => document.getElementById("chartNavigationMessage"),
    getCurrentRange: getCurrentXRangeMs,
    getDataRange: getChartNavigationDataRangeMs,
    isHistoryReady: () => historicalDataLoaded && hasHistoricalDataCoverage(),
    loadHistory: () => ensureHistoricalDataLoaded(false),
    afterHistoryLoaded: async (visibleRange) => {
      if (visibleRange) chartSession.pinnedXRange = visibleRange.map((value) => new Date(value).toISOString());
      await runMainChartRender(Boolean(visibleRange));
    },
    captureNormalization: captureViewportNormalizationFrame,
    onError: (error) => recordRuntimeError("full-history-navigation", error),
    applyRange: applySyncedXRangeMs,
    applyResetPolicy: applyChartResetPolicy,
    isAutoScale: () => chartSession.autoChartReset,
    getRightPaddingMs: chartRightPaddingMs,
    isInteractionBusy: () => isHandleDragging || isViewportDragging,
    setViewportDragging: (value) => { isViewportDragging = Boolean(value); },
    setViewportPinned: (value) => { chartSession.userViewportPinned = Boolean(value); },
    updateActiveMonths: (months) => {
      chartSession.activeMonths = months;
      saveState();
    },
    shiftMonths,
    toMilliseconds: toUtcMs,
  });
  return chartNavigationController;
}

function showChartNavigationMessage(message, durationMs = 3000) {
  return getChartNavigationController().showMessage(message, durationMs);
}

function showAiForecastUnavailable(items = []) {
  const unavailable = (Array.isArray(items) ? items : [items])
    .filter((item) => item?.series && item?.available === false);
  if (!unavailable.length || !chartSession.showAiForecast) return;
  const key = [
    aiForecastToggleRevision,
    aiForecastTargetRevision,
    ...unavailable
      .map((item) => `${item.series}:${item.reasonCode || "unknown"}`)
      .sort(),
  ].join("|");
  if (aiForecastUnavailableMessageKeys.has(key)) return;
  aiForecastUnavailableMessageKeys.add(key);
  if (aiForecastUnavailableMessageKeys.size > 48) {
    aiForecastUnavailableMessageKeys = new Set([...aiForecastUnavailableMessageKeys].slice(-24));
  }

  const first = unavailable[0];
  const subject = unavailable.length > 1
    ? `${labelName(first.series)} 외 ${unavailable.length - 1}종`
    : labelName(first.series);
  const reasonCodes = new Set(unavailable.map((item) => item.reasonCode));
  let reason = "학습 데이터 품질 부족";
  if (reasonCodes.size === 1 && reasonCodes.has("insufficient-history")) reason = "가격 이력 3년 미만";
  else if (reasonCodes.size === 1 && reasonCodes.has("unsupported-series")) reason = "지원하지 않는 차트";
  showChartNavigationMessage(`${subject} · AI 계산 불가: ${reason}`, 3000);
}

function ensureFullHistoryDataReady() {
  return getChartNavigationController().ensureHistoryReady();
}

function zoomChartViewport(direction, source = "button-zoom", options = {}) {
  return getChartNavigationController().zoom(direction, source, options);
}

function cancelLatestViewportAnimation() {
  return getChartNavigationController().cancelLatestAnimation();
}

function showLatestChartPeriod(months, source = "range-preset") {
  return getChartNavigationController().showLatestPeriod(months, source);
}

function slideChartViewportToLatest(source = "latest-slide") {
  return getChartNavigationController().slideToLatest(source);
}

function clampChartViewportToObservedData() {
  const el = document.getElementById("chart");
  const viewRange = getCurrentXRangeMs(el);
  const dataRange = getChartDataRangeMs(el);
  if (!viewRange || !dataRange || viewRange[1] <= dataRange[1]) return false;

  const start = Math.min(viewRange[0], dataRange[1] - DAY_MS);
  chartSession.pinnedXRange = [
    new Date(start).toISOString(),
    new Date(dataRange[1]).toISOString(),
  ];
  return true;
}

function captureAiForecastEntryViewport() {
  const range = getCurrentXRangeMs(document.getElementById("chart"));
  aiForecastEntryViewport = range
    ? {
      range: [...range],
      interactionRevision: chartViewportInteractionRevision,
      userViewportPinned: chartSession.userViewportPinned,
    }
    : null;
  restoreAiForecastViewportOnNextRender = null;
}

function queueAiForecastEntryViewportRestore() {
  const snapshot = aiForecastEntryViewport;
  aiForecastEntryViewport = null;
  if (!snapshot || snapshot.interactionRevision !== chartViewportInteractionRevision) {
    restoreAiForecastViewportOnNextRender = null;
    return false;
  }
  restoreAiForecastViewportOnNextRender = snapshot;
  return true;
}

function viewportRangeFromRelayout(payload) {
  if (!payload || typeof payload !== "object") return null;
  const pair = Array.isArray(payload["xaxis.range"])
    ? payload["xaxis.range"].slice(0, 2)
    : [payload["xaxis.range[0]"], payload["xaxis.range[1]"]];
  return pair.length === 2 && pair.every((value) => value != null) ? pair : null;
}

function buildMacdViewportYRange(el, xRange) {
  if (!el?.data || !Array.isArray(xRange)) return null;
  const fitted = fitRangeForTraces(
    el.data.filter((trace) => trace?.meta?.macdSeriesKey),
    xRange,
    { paddingRatio: 0.08, minimumPadding: 0.02 },
  );
  if (!fitted) return null;
  const maxAbs = Math.max(0.02, Math.abs(fitted[0]), Math.abs(fitted[1]));
  return [-maxAbs, maxAbs];
}

function buildAuxiliaryViewportRelayout(model, xRange, targetEl = null) {
  if (!model || !Array.isArray(xRange) || !targetEl?.data) return null;
  const ranges = buildAuxiliaryViewportRanges(model, xRange, {
    adrLowThreshold: ADR_LOW_THRESH,
    adrHighThreshold: ADR_HIGH_THRESH,
    newsLowThreshold: NEWS_SENTIMENT_LOW_THRESH,
    newsHighThreshold: NEWS_SENTIMENT_HIGH_THRESH,
  });
  const payload = {};
  const addRange = (seriesKeys, range) => {
    const trace = targetEl.data.find((candidate) => (
      candidate.visible !== false
      && seriesKeys.includes(candidate.meta?.auxiliarySeriesKey)
    ));
    if (!trace || !Array.isArray(range)) return;
    const axisReference = trace.yaxis || "y";
    const axisKey = axisReference === "y" ? "yaxis" : `yaxis${axisReference.slice(1)}`;
    payload[`${axisKey}.range[0]`] = range[0];
    payload[`${axisKey}.range[1]`] = range[1];
    payload[`${axisKey}.autorange`] = false;
  };
  addRange([AUXILIARY_SERIES_KEYS.adrKospi, AUXILIARY_SERIES_KEYS.adrKosdaq], ranges.adr);
  addRange([AUXILIARY_SERIES_KEYS.newsSentiment], ranges.news);
  addRange([AUXILIARY_SERIES_KEYS.vkospi, AUXILIARY_SERIES_KEYS.vix], ranges.vkospi);
  return Object.keys(payload).length ? payload : null;
}

function addViewportYRangeToRelayout(targetEl, payload) {
  if (!chartSession.autoChartReset || !targetEl || !payload) return payload;
  const xRange = viewportRangeFromRelayout(payload);
  if (!xRange) return payload;
  if (targetEl.id === "chart-macd") {
    const range = buildMacdViewportYRange(targetEl, xRange);
    return range
      ? {
          ...payload,
          "yaxis.range[0]": range[0],
          "yaxis.range[1]": range[1],
          "yaxis.autorange": false,
        }
      : payload;
  }
  if (targetEl.id === "chart-adr") {
    const yPayload = buildAuxiliaryViewportRelayout(auxiliaryChartCalcCache?.model, xRange, targetEl);
    return yPayload ? { ...payload, ...yPayload } : payload;
  }
  return payload;
}

function getChartRangeSyncController() {
  if (chartRangeSyncController) return chartRangeSyncController;
  chartRangeSyncController = chartViewportControllerModule.createRangeSyncController(window, {
    applyRange: async ({ startMs, endMs, meta }) => {
      const perfStartedAt = startPerfSample();
      const mainEl = document.getElementById("chart");
      const macdEl = document.getElementById("chart-macd");
      const adrEl = document.getElementById("chart-adr");
      const r0 = new Date(startMs).toISOString();
      const r1 = new Date(endMs).toISOString();
      const payload = { "xaxis.range[0]": r0, "xaxis.range[1]": r1 };
      const updateMain = Boolean(mainEl?.data && !xRangeMatches(mainEl, r0, r1));
      const updateMacd = Boolean(macdEl?.data && !macdEl.hidden && !xRangeMatches(macdEl, r0, r1));
      const updateAdr = Boolean(adrEl?.data && !xRangeMatches(adrEl, r0, r1));
      if (!updateMain && !updateMacd && !updateAdr) return;
      let mainPayload = payload;
      if (updateMain && meta?.liveFit && chartSession.autoChartReset) {
        const primaryTraces = mainEl.data.filter((trace) => (
          trace?.meta?.seriesKey
          && !trace?.meta?.isDisclosureTrace
          && !trace?.meta?.isInsiderTradeTrace
        ));
        const fittedYRange = fitRangeForTraces(primaryTraces, [r0, r1], {
          paddingRatio: 0.08,
          minimumPadding: 0.6,
        });
        if (fittedYRange) {
          mainPayload = {
            ...payload,
            "yaxis.range[0]": fittedYRange[0],
            "yaxis.range[1]": fittedYRange[1],
            "yaxis.autorange": false,
          };
          useViewportEventMarkerGap = true;
          lineHitIndexCache.delete(mainEl);
          chartEventLayerModule.invalidateMarkerPixels(mainEl);
        }
      }
      chartSyncing = true;
      try {
        const tasks = [];
        if (updateMain) tasks.push(Plotly.relayout(mainEl, mainPayload));
        if (updateMacd) {
          tasks.push(Plotly.relayout(macdEl, addViewportYRangeToRelayout(macdEl, payload)));
        }
        if (updateAdr) {
          tasks.push(Plotly.relayout(adrEl, addViewportYRangeToRelayout(adrEl, payload)));
        }
        await Promise.allSettled(tasks);
      } finally {
        chartSyncing = false;
      }
      recordPerfSample("viewportRangeSync", perfStartedAt, {
        main: updateMain,
        macd: updateMacd,
        auxiliary: updateAdr,
        liveFit: Boolean(meta?.liveFit),
      });
      scheduleHandleUpdate(0);
      if (chartSession.showCoMovement) scheduleCoMovementPanelRender();
      if (meta?.fit !== false) applyChartResetPolicy("viewport");
    },
    onError: (error) => recordRuntimeError("chart-range-sync", error),
  });
  return chartRangeSyncController;
}

function applySyncedXRangeMs(startMs, endMs, meta = {}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;
  if (chartNavigationController?.isAnimating() && meta.source !== "latest-slide") {
    cancelLatestViewportAnimation();
  }
  viewportRelayoutQueue?.cancelPending?.();
  chartSession.pinnedXRange = [new Date(startMs).toISOString(), new Date(endMs).toISOString()];
  if (meta.userInitiated !== false) {
    chartViewportInteractionRevision += 1;
    captureViewportNormalizationFrame();
    chartSession.userViewportPinned = true;
  }
  return getChartRangeSyncController().schedule(startMs, endMs, meta);
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
  if (!viewportRelayoutQueue) {
    viewportRelayoutQueue = chartRelayoutQueueModule.createLatestKeyedFrameQueue(window, {
      apply: async (pending) => {
        const tasks = pending.map(({ targetEl: el, payload: nextPayload }) => {
          if (!el?.data) return null;
          const r0 = nextPayload["xaxis.range[0]"];
          const r1 = nextPayload["xaxis.range[1]"];
          if (r0 != null && r1 != null && xRangeMatches(el, r0, r1)) return null;
          try {
            return Promise.resolve(Plotly.relayout(
              el,
              addViewportYRangeToRelayout(el, nextPayload),
            )).catch(() => {});
          } catch (_) {
            return null;
          }
        }).filter(Boolean);
        if (!tasks.length) return;
        chartSyncing = true;
        try {
          await Promise.allSettled(tasks);
        } finally {
          chartSyncing = false;
          scheduleHandleUpdate(0);
        }
      },
      onError: (error) => recordRuntimeError("viewport-relayout-queue", error),
    });
  }
  viewportRelayoutQueue.schedule(targetEl.id || "auxiliary", { targetEl, payload });
}

function syncInsiderTradeToggleButton() {
  const button = document.getElementById("insiderTradeToggle");
  if (!button) return;
  const pending = insiderTradePendingTickers.size;
  controlStateView.syncControl(button, {
    active: chartSession.showInsiderTrades,
    pressed: chartSession.showInsiderTrades,
    busy: pending > 0,
    text: "내부거래",
    title: chartSession.showInsiderTrades
      ? (pending ? `DART 내부거래 불러오는 중 - ${pending}개 종목` : "DART 최근 3년 내부거래 켜짐")
      : "DART 최근 3년 내부거래 꺼짐",
  });
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
  if (!lineHitIndexMatches(index, el.data, chartSession.currentSelected)) {
    index = buildLineHitIndex(el.data, chartSession.currentSelected);
    lineHitIndexCache.set(el, index);
  }
  return findNearestLineTarget(index, targetMs, localY, ya, tolerance);
}

function findAiForecastReportAtClientPoint(el, clientX, clientY, isTouch = false, geometry = null) {
  const mainEl = document.getElementById("chart");
  if (!el || el !== mainEl || !el._fullLayout || !Array.isArray(el.data)) return null;
  if (typeof aiForecastTracesModule?.isThickestAiScenarioTrace !== "function") return null;

  const xa = geometry?.xa || el._fullLayout.xaxis;
  const ya = geometry?.ya || el._fullLayout.yaxis;
  if (!xa || !ya) return null;
  const rect = geometry?.rect || el.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (localX < xa._offset || localX > xa._offset + xa._length
    || localY < ya._offset || localY > ya._offset + ya._length) return null;

  const targetMs = toMsSafe(axisPixelToXValue(el, clientX, false, geometry));
  if (!Number.isFinite(targetMs)) return null;
  const traceKeys = el.data.map((trace, traceIndex) => (
    aiForecastTracesModule.isThickestAiScenarioTrace(trace)
      && trace?.meta?.representativeReport
      ? `ai-report:${traceIndex}`
      : ""
  ));
  let index = aiReportLineHitIndexCache.get(el);
  if (!lineHitIndexMatches(index, el.data, traceKeys)) {
    index = buildLineHitIndex(el.data, traceKeys);
    aiReportLineHitIndexCache.set(el, index);
  }
  const tolerance = isTouch
    ? AI_REPORT_LINE_TOUCH_HIT_TOLERANCE_PX
    : AI_REPORT_LINE_HIT_TOLERANCE_PX;
  const target = findNearestLineTarget(index, targetMs, localY, ya, tolerance);
  return target ? { traceIndex: target.traceIndex } : null;
}

function openAiForecastReportHit(el, hit, sourceEvent) {
  const trace = el?.data?.[hit?.traceIndex];
  if (!trace) return false;
  return handleAiForecastClick({
    event: sourceEvent,
    points: [{ curveNumber: hit.traceIndex, data: trace }],
  });
}

function clearAutoResetSeriesTransforms(seriesKey = "") {
  if (!chartSession.autoChartReset) return false;
  let changed = false;
  if (seriesKey) {
    changed = Object.hasOwn(chartSession.seriesOffsets, seriesKey)
      || Object.hasOwn(chartSession.seriesScales, seriesKey);
    delete chartSession.seriesOffsets[seriesKey];
    delete chartSession.seriesScales[seriesKey];
  } else {
    changed = Object.keys(chartSession.seriesOffsets).length > 0
      || Object.keys(chartSession.seriesScales).length > 0;
    chartSession.seriesOffsets = {};
    chartSession.seriesScales = {};
  }
  if (changed) mainChartCalcCache.clear();
  return changed;
}

function getChartSessionController() {
  if (chartSessionController) return chartSessionController;
  chartSessionController = chartSessionControllerModule.createChartSessionController(globalThis, {
    state: chartSession,
    getVisibleRange: () => getCurrentXRangeMs(document.getElementById("chart")),
    clearTransforms: () => clearAutoResetSeriesTransforms(),
    captureLockedRange: captureLockedHistoryYRange,
    fitCurrentViewport: fitCurrentChartRatio,
    isInteractionBusy: () => isViewportDragging || isHandleDragging,
  });
  return chartSessionController;
}

function applyChartResetPolicy(change, delay = 100) {
  return getChartSessionController().applyResetPolicy(change, delay);
}

function setAutoChartReset(enabled) {
  return getChartSessionController().setAutoScale(enabled);
}

function isTimingSignalTrace(trace) {
  return Boolean(
    trace?.meta?.isCrisisSignalTrace
    || trace?.meta?.isMarketTimingBuyTrace
    || trace?.meta?.isMarketTimingSellTrace
  );
}

function isInteractiveChartMarkerTrace(trace) {
  return Boolean(trace?.meta?.isDisclosureTrace || isTimingSignalTrace(trace));
}

function findDisclosureMarkerAtClientPoint(el, clientX, clientY, isTouch = false, geometry = null) {
  return chartEventLayerModule.findMarkerAtClientPoint(el, clientX, clientY, {
    geometry,
    iconText: DISCLOSURE_ICON_TEXT,
    cacheKey: "interactive-markers",
    tracePredicate: isInteractiveChartMarkerTrace,
    isTouch,
    mouseRadius: DISCLOSURE_MOUSE_HIT_RADIUS_PX,
    touchRadius: DISCLOSURE_TOUCH_HIT_RADIUS_PX,
  });
}

function openDisclosureMarkerHit(el, hit, sourceEvent) {
  const trace = el?.data?.[hit?.traceIndex];
  if (isTimingSignalTrace(trace)) {
    const yAxis = trace?.yaxis === "y2" ? el?._fullLayout?.yaxis2 : el?._fullLayout?.yaxis;
    return handleTimingSignalClick({
      event: sourceEvent,
      points: [{
        data: trace,
        x: trace?.x?.[hit.pointIndex],
        y: trace?.y?.[hit.pointIndex],
        customdata: trace?.customdata?.[hit.pointIndex],
        xaxis: el?._fullLayout?.xaxis,
        yaxis: yAxis,
      }],
    });
  }
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

function visibleStockSeriesKeys() {
  return customStocks
    .map((item) => String(item?.ticker || "").toUpperCase())
    .filter((ticker) => MACD_STOCK_PATTERN.test(ticker) && !chartSession.hiddenSeries.has(ticker));
}

function mainChartSeriesKeys() {
  return [
    ...CORE_SERIES,
    ...customStocks.map((item) => String(item?.ticker || "").toUpperCase()),
  ];
}

function getMainSeriesController() {
  if (mainSeriesController) return mainSeriesController;
  mainSeriesController = mainSeriesControllerModule.createMainSeriesController({
    hiddenSeries: chartSession.hiddenSeries,
    maximumVisible: MAX_VISIBLE_MAIN_SERIES,
    getSeriesKeys: mainChartSeriesKeys,
    onLimit: () => showChartNavigationMessage(MAX_VISIBLE_MAIN_SERIES_MESSAGE, 3000),
  });
  return mainSeriesController;
}

function visibleMainChartSeriesKeys() {
  return getMainSeriesController().visibleKeys();
}

function setMainChartSeriesVisible(seriesKey, visible, options = {}) {
  return getMainSeriesController().setVisible(seriesKey, visible, options);
}

function enforceMainChartSeriesLimit() {
  return getMainSeriesController().enforceLimit();
}

function resolveCoMovementTarget() {
  lastVisibleStockSeriesKey = getMainSeriesController().resolveVisibleStock(
    lastVisibleStockSeriesKey,
    (key) => MACD_STOCK_PATTERN.test(key),
  );
  return lastVisibleStockSeriesKey;
}

function noteStockVisibilityChange(seriesKey) {
  const ticker = String(seriesKey || "").toUpperCase();
  if (!MACD_STOCK_PATTERN.test(ticker)) return;
  if (chartSession.hiddenSeries.has(ticker)) {
    if (lastVisibleStockSeriesKey === ticker) lastVisibleStockSeriesKey = "";
  } else {
    lastVisibleStockSeriesKey = ticker;
  }
}

function selectCoMovementTarget(seriesKey) {
  const ticker = String(seriesKey || "").toUpperCase();
  if (!chartSession.showCoMovement || !MACD_STOCK_PATTERN.test(ticker) || chartSession.hiddenSeries.has(ticker)) return;
  if (lastVisibleStockSeriesKey === ticker) return;
  lastVisibleStockSeriesKey = ticker;
  renderCoMovementPanel();
}

function syncChartResetToggleButton() {
  return mainChartControlView.syncScale();
}

function syncCursorLineModeControls() {
  return mainChartControlView.syncCursorLine();
}

function setCursorLineMode(mode, options = {}) {
  const normalized = normalizeCursorLineMode(mode);
  const changed = chartSession.cursorLineMode !== normalized;
  chartSession.cursorLineMode = normalized;
  syncCursorLineModeControls();
  if (!changed) return normalized;
  getChartCursorSyncController().refresh?.();
  saveState();
  if (options.render !== false) {
    requestChartRender(true, { deferDuringInteraction: false });
  }
  return normalized;
}

function setChartRightPaddingDays(value, options = {}) {
  const days = normalizeChartRightPaddingDays(value);
  const changed = chartSession.chartRightPaddingDays !== days;
  const wasLatest = isLatestChartViewport();
  chartSession.chartRightPaddingDays = days;
  if (!changed) return days;
  saveState();
  if (options.render !== false) {
    requestChartRender(!wasLatest, {
      deferDuringInteraction: false,
      reason: "right-padding",
      updateClass: "viewport",
    });
  }
  return days;
}

function cycleCursorLineMode() {
  const current = CURSOR_LINE_MODES.indexOf(normalizeCursorLineMode(chartSession.cursorLineMode));
  return setCursorLineMode(CURSOR_LINE_MODES[(current + 1) % CURSOR_LINE_MODES.length]);
}

function syncNewsSentimentMovingAverageControls() {
  return mainChartControlView.syncNewsMovingAverage();
}

function setNewsSentimentMovingAverageDays(value, options = {}) {
  const days = normalizeNewsMovingAverageDays(value);
  const changed = chartSession.newsSentimentMovingAverageDays !== days;
  chartSession.newsSentimentMovingAverageDays = days;
  syncNewsSentimentMovingAverageControls();
  if (!changed) return days;
  auxiliaryChartCalcCache = null;
  invalidateAdrChartRender();
  saveState();
  if (options.render !== false) {
    const xRange = document.getElementById("chart")?._fullLayout?.xaxis?.range?.slice() || null;
    Promise.resolve(renderAdrChart(xRange)).catch((error) => {
      recordRuntimeError("news-sentiment-moving-average", error, { days });
    });
  }
  return days;
}

function mainChartHorizontalMargin() {
  return chartLayoutPolicyModule.resolve(chartSession.showChartHandles).mainMargin;
}

function auxiliaryChartHorizontalMargin() {
  return chartLayoutPolicyModule.resolve(chartSession.showChartHandles).auxiliaryMargin;
}

function syncChartHandlesToggleButton() {
  return mainChartControlView.syncHandles();
}

async function applyChartHandlesLayout() {
  syncChartHandlesToggleButton();
  if (typeof window.Plotly?.relayout !== "function") return;
  const margin = mainChartHorizontalMargin();
  const charts = ["chart", "chart-macd", "chart-adr"]
    .map((id) => document.getElementById(id))
    .filter((chart) => chart?.data);
  if (!charts.length) return;
  chartSyncing = true;
  try {
    await Promise.allSettled(charts.map((chart) => (
      Plotly.relayout(chart, { "margin.l": margin, "margin.r": margin })
    )));
  } finally {
    chartSyncing = false;
    if (chartSession.showChartHandles) scheduleHandleUpdate(0);
  }
}

function syncRecessionToggleButton() {
  return mainChartControlView.syncSignal();
}

function syncCoMovementToggleButton() {
  return mainChartControlView.syncCoMovement();
}

function renderCoMovementPanel() {
  const panel = document.getElementById("coMovementPanel");
  if (!panel) return;
  const targetKey = resolveCoMovementTarget();
  const rows = chartSession.currentMainChartModel?.rows;
  syncCoMovementToggleButton();
  if (!chartSession.showCoMovement || !targetKey || !rows?.length) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }

  const chartRange = getCurrentXRangeMs(document.getElementById("chart"));
  let visibleRows = rows;
  let requestedMonths = chartSession.activeMonths;
  if (chartRange) {
    visibleRows = sliceCoMovementRowsByDateRange(rows, chartRange);
    const spanDays = Math.max(1, (chartRange[1] - chartRange[0]) / DAY_MS);
    if (spanDays <= 45) {
      const tradingDays = visibleRows.reduce((count, row) => (
        toNum(row?.[targetKey]) !== null ? count + 1 : count
      ), 0);
      requestedMonths = Math.max(1, tradingDays) / (365.2425 / 12);
    } else {
      requestedMonths = spanDays / (365.2425 / 12);
    }
  }

  const summary = buildCoMovementSummary({
    rows: visibleRows,
    targetKey,
    targetName: labelName(targetKey),
    requestedMonths,
    comparisons: CO_MOVEMENT_COMPARISONS,
  });
  if (!summary) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }

  const title = document.createElement("strong");
  title.className = "co-movement-title";
  title.textContent = `${summary.targetName} ${summary.periodLabel}`;
  const nodes = [title];
  summary.comparisons.forEach((comparison) => {
    const metric = document.createElement("span");
    metric.className = "co-movement-metric";
    metric.append(`${comparison.label} `);
    const value = document.createElement("b");
    value.textContent = Number.isFinite(comparison.rate) ? `${comparison.rate}%` : "--";
    metric.append(value);
    metric.title = comparison.samples
      ? `${comparison.startDate}~${comparison.endDate}, ${comparison.samples}회 변화 비교`
      : "비교 가능한 데이터가 부족합니다.";
    nodes.push(metric);
  });
  panel.replaceChildren(...nodes);
  panel.setAttribute("aria-label", nodes.map((node) => node.textContent).join(", "));
  panel.hidden = false;
}

function scheduleCoMovementPanelRender() {
  if (!coMovementFrameScheduler) {
    coMovementFrameScheduler = createLatestFrameScheduler(window, renderCoMovementPanel);
  }
  coMovementFrameScheduler.schedule(true);
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

  const startOffset = chartSession.seriesOffsets[target.seriesKey] || 0;
  const lockedXRange = getCurrentMainXRange();
  let moved = false;

  suppressPlotlyClickUntil = Date.now() + 500;
  isHandleDragging = true;
  setActiveLineTarget(target);
  el.classList.add("is-line-dragging");
  clearHoverOnChart(el);
  lockCurrentYAxisRange();

  function onMove(clientY) {
    const dy = clientY - startClientY;
    if (Math.abs(dy) >= 3) moved = true;
    chartSession.seriesOffsets[target.seriesKey] = offsetFromDrag(startOffset, startClientY, clientY, ya);
    restyleLive(target.traceIndex, target.seriesKey);
  }

  function onEnd(clientY) {
    clearHoverOnChart(el);
    el.classList.remove("is-line-dragging");
    isHandleDragging = false;
    setActiveLineTarget(null);
    if (lockedXRange) chartSession.pinnedXRange = [...lockedXRange];
    if (!moved || Math.abs(clientY - startClientY) < 3) {
      chartSession.seriesOffsets[target.seriesKey] = startOffset;
      restyleLive(target.traceIndex, target.seriesKey);
      finishTraceYEdit(false, target.seriesKey, { preserveTransform: true });
      selectCoMovementTarget(target.seriesKey);
      return;
    }
    finishTraceYEdit(true, target.seriesKey, { preserveTransform: true });
  }

  addDragListeners(pointerId, onMove, onEnd);
  return true;
}

function getChartPointerRuntime() {
  if (chartPointerRuntime) return chartPointerRuntime;
  const interactionState = {
    get handleDragging() { return isHandleDragging; },
    get viewportDragging() { return isViewportDragging; },
    set viewportDragging(value) { isViewportDragging = Boolean(value); },
    get wheelZooming() { return isWheelZooming; },
    set wheelZooming(value) { isWheelZooming = Boolean(value); },
    get suppressPlotlyClickUntil() { return suppressPlotlyClickUntil; },
    set suppressPlotlyClickUntil(value) { suppressPlotlyClickUntil = Number(value) || 0; },
  };
  chartPointerRuntime = chartPointerRuntimeModule.createChartPointerRuntime(globalThis, {
    CHART_GEOMETRY_CACHE_MS,
    DAY_MS,
    LINE_HIT_TEST_INTERVAL_MS,
    MIN_CHART_VIEW_SPAN_MS,
    applyChartResetPolicy,
    applySyncedXRangeMs,
    axisPixelToXValue,
    beginLineOffsetDrag,
    chartSession,
    chartViewportControllerModule,
    clearHoverOnChart,
    createPointerFrameController,
    ensureFullHistoryDataReady,
    findAiForecastReportAtClientPoint,
    findDisclosureMarkerAtClientPoint,
    findNearestLineDragTarget,
    getChartCursorSyncController,
    getChartInteractionGeometry,
    getChartNavigationDataRangeMs,
    getChartRangeSyncController,
    getCurrentXRangeMs,
    hideDisclosurePopover,
    interactionState,
    isTouchDevice,
    latestPointerSample,
    nearestMainLineDate,
    openAiForecastReportHit,
    openDisclosureMarkerHit,
    recordPerfSample,
    resetDisclosureHoverHighlight,
    scheduleDisclosureHoverHighlight,
    scheduleSyncedCursor,
    setHoveredLineTarget,
    showChartNavigationMessage,
    startPerfSample,
    syncHoverToChart,
    zoomChartViewport,
  });
  return chartPointerRuntime;
}

function bindCursorMoveSync() {
  getChartPointerRuntime().bind();
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
    const isVisible = isAvailable && !chartSession.hiddenSeries.has(key);
    btn.disabled = !isAvailable;
    btn.classList.toggle("is-disabled", !isAvailable);
    btn.classList.toggle("is-on", isVisible);
    btn.classList.toggle("is-off", isAvailable && !isVisible);
  });
}

function bindSeriesToggleBoard() {
  document.querySelectorAll(".series-toggle-btn").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const key = btn.dataset.series;
      if (!key || btn.disabled) return;
      const becomingVisible = chartSession.hiddenSeries.has(key);
      if (becomingVisible) {
        if (!setMainChartSeriesVisible(key, true)) return;
        clearAutoResetSeriesTransforms(key);
      } else {
        setMainChartSeriesVisible(key, false);
      }
      noteStockVisibilityChange(key);
      setAiForecastTargetVisibility(key, becomingVisible);
      if (becomingVisible && chartSession.showAiForecast && isForecastSeries(String(key).toUpperCase())) {
        startAiForecastProgress();
        if (MACD_STOCK_PATTERN.test(String(key).toUpperCase())) {
          refreshAiAnalysisForVisibleSeries().catch(() => {});
        }
      }
      requestChartCompositionUpdate();
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
        <button class="stock-remove-btn" type="button" data-remove-series="${escapeHtml(ticker)}" aria-label="${escapeHtml(name)} remove">&times;</button>
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
  const removedStock = customStocks.find((item) => item.ticker === ticker);
  const before = customStocks.length;
  customStocks = customStocks.filter((item) => item.ticker !== ticker);
  if (customStocks.length === before) return;
  const removedColor = appStateControllerModule.normalizeHexColor(removedStock?.color);
  if (removedColor) {
    recentlyRemovedCustomStockColors.delete(ticker);
    recentlyRemovedCustomStockColors.set(ticker, removedColor);
    if (recentlyRemovedCustomStockColors.size > 100) {
      recentlyRemovedCustomStockColors.delete(recentlyRemovedCustomStockColors.keys().next().value);
    }
  }
  if (lastVisibleStockSeriesKey === ticker) lastVisibleStockSeriesKey = "";
  chartSession.hiddenSeries.delete(ticker);
  delete chartSession.seriesOffsets[ticker];
  delete chartSession.seriesScales[ticker];
  delete DISPLAY_NAMES[ticker];
  loadingCustomStocks.delete(ticker);
  setAiForecastTargetVisibility(ticker, false);
  clearTickerSeriesFromPricePayload(ticker);
  renderCustomStockButtons();
  requestChartCompositionUpdate();
}

function clearTickerSeriesFromPricePayload(ticker) {
  getTickerPricePayloadController().clear(ticker);
}

let krxUniversePromise = null;

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
  return getTickerPricePayloadController().merge(ticker, points);
}

function getLatestTickerDateFromPricePayload(ticker) {
  return getTickerPricePayloadController().latestDate(ticker);
}

function getTickerPricePointsFromPayload(ticker) {
  return getTickerPricePayloadController().points(ticker);
}

function hasTickerVolumeHistory(ticker) {
  return getTickerPricePayloadController().hasVolumeHistory(ticker);
}

function normalizeTickerPricePointsForTicker(points, ticker = "") {
  const key = String(ticker || "").trim().toUpperCase();
  const normalized = normalizeTickerPricePoints(points);
  if (!/^\d{6}\.(KS|KQ)$/.test(key)) return normalized;
  return normalized.filter((point) => isKoreanMarketPricePoint(point.date, point.volume));
}

function getTickerPricePayloadController() {
  if (tickerPricePayloadController) return tickerPricePayloadController;
  tickerPricePayloadController = tickerPriceRuntimeModule.createPayloadController({
    getPayload: () => pricePayload,
    setPayload: (value) => { pricePayload = value; },
    volumesByTicker: tickerVolumeSeriesByTicker,
    toNumber: toNum,
    normalizePoints: normalizeTickerPricePointsForTicker,
    sameNumber: sameNullableNumber,
    assertPoints: (options) => runtimeSeriesQualityGateModule.assertPricePoints(options),
    displayName: (ticker) => DISPLAY_NAMES[ticker] || ticker,
    onClear: invalidateAiForecastCache,
    onChanged: () => markDataChanged("price"),
  });
  return tickerPricePayloadController;
}

function isTickerPriceCacheFresh(latestDate, ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  const expectedDate = expectedLatestKoreanTradingDate(new Date());
  const benchmark = key.endsWith(".KQ") ? "^KQ11" : "^KS11";
  return tickerPriceRuntimeModule.isCacheFresh({
    latestDate,
    expectedDate,
    benchmarkDate: getLatestTickerDateFromPricePayload(benchmark),
    status: tickerPriceStatusStore.get(key),
    nowMs: Date.now(),
    maxAgeMs: DAY_MS,
  });
}

async function readTickerPriceCache(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  if (!key) return null;
  try {
    await ensureTickerSeriesCacheRetention();
    const record = await readLifecycleCacheRecord(TICKER_PRICE_CACHE_STORE_NAME, key);
    if (!record) {
      tickerSeriesCacheRetention.noteRemoved(key);
      return null;
    }
    const points = normalizeTickerPricePointsForTicker(record.points, key);
    const contentFingerprint = seriesIntegrityModule.fingerprintDatedSeries(
      points,
      ["close", "volume"],
      { tail: 96, logicVersion: "ticker-price-cache-v1" },
    );
    const issue = cacheRecordHealthModule.granularRecordIssue(record, {
      schema: GRANULAR_CACHE_SCHEMA_VERSION,
      key,
      contentCount: points.length,
      latestDate: points.at(-1)?.date || "",
      contentFingerprint,
      source: "ticker-price",
      revision: String(GRANULAR_CACHE_SCHEMA_VERSION),
    });
    if (issue) {
      await removeTickerPriceCacheRecord(key);
      return null;
    }
    tickerSeriesCacheRetention.noteAccess(key);
    const nextRecord = cacheLifecyclePolicyModule.withCacheMetadata({
      ...record,
      points,
      historyCoverage: tickerPriceRuntimeModule.normalizeHistoryCoverage(record.historyCoverage),
      contentFingerprint,
    }, {
      source: "ticker-price",
      asOf: points.at(-1)?.date || "",
      revision: String(GRANULAR_CACHE_SCHEMA_VERSION),
      contentFingerprint,
      now: Date.now(),
      touch: true,
    });
    if (!record.contentFingerprint || !record.cacheMeta) {
      await writeIndexedDbRecord(TICKER_PRICE_CACHE_STORE_NAME, key, nextRecord).catch(() => {});
      tickerSeriesCacheRetention.noteStored(key, nextRecord);
    }
    return nextRecord;
  } catch (_) {
    return null;
  }
}

function normalizeResearchHistoryCacheForTicker(value, ticker) {
  return tickerPriceRuntimeModule.normalizeResearchHistoryCache(
    value,
    ticker,
    normalizeTickerPricePointsForTicker,
  );
}

function tickerPriceCacheToResearchHistory(value, ticker) {
  return tickerPriceRuntimeModule.priceCacheToResearchHistory(
    value,
    ticker,
    normalizeTickerPricePointsForTicker,
    { priceSchema: GRANULAR_CACHE_SCHEMA_VERSION },
  );
}

async function readSharedResearchHistoryCache(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  if (!key) return null;
  try {
    const researchRecord = normalizeResearchHistoryCacheForTicker(
      await readLifecycleCacheRecord(TICKER_RESEARCH_HISTORY_STORE_NAME, key),
      key,
    );
    if (researchRecord) return researchRecord;
    return tickerPriceCacheToResearchHistory(await readTickerPriceCache(key), key);
  } catch (_) {
    return null;
  }
}

async function readSharedResearchHistoryCaches(tickers) {
  const keys = [...new Set((Array.isArray(tickers) ? tickers : [])
    .map((ticker) => String(ticker || "").trim().toUpperCase())
    .filter(Boolean))];
  const result = new Map();
  if (!keys.length) return result;
  try {
    const researchRecords = await indexedCacheStore.readRecords(TICKER_RESEARCH_HISTORY_STORE_NAME, keys);
    if (researchRecords instanceof Map) {
      researchRecords.forEach((value, key) => {
        if (cacheLifecyclePolicyModule.recordLifecycle(value, TICKER_RESEARCH_HISTORY_STORE_NAME) !== "active") return;
        const normalized = normalizeResearchHistoryCacheForTicker(value, key);
        if (normalized) result.set(key, normalized);
      });
    }
    const missing = keys.filter((key) => !result.has(key));
    if (!missing.length) return result;
    const priceRecords = await indexedCacheStore.readRecords(TICKER_PRICE_CACHE_STORE_NAME, missing);
    if (priceRecords instanceof Map) {
      priceRecords.forEach((value, key) => {
        if (cacheLifecyclePolicyModule.recordLifecycle(value, TICKER_PRICE_CACHE_STORE_NAME) !== "active") return;
        const normalized = tickerPriceCacheToResearchHistory(value, key);
        if (normalized) result.set(key, normalized);
      });
    }
  } catch (_) {
    // A failed cache read falls through to the normal history endpoint.
  }
  return result;
}

async function writeTickerPriceCache(ticker, points, displayName = "", options = {}) {
  const key = String(ticker || "").trim().toUpperCase();
  const normalized = normalizeTickerPricePointsForTicker(points, key);
  if (!key || !normalized.length) return false;
  return runTickerPriceCacheMutation(async () => {
    await ensureTickerSeriesCacheRetention();
    const now = Date.now();
    const historyCoverage = tickerPriceRuntimeModule.normalizeHistoryCoverage(options.historyCoverage);
    const contentFingerprint = seriesIntegrityModule.fingerprintDatedSeries(
      normalized,
      ["close", "volume"],
      { tail: 96, logicVersion: "ticker-price-cache-v1" },
    );
    const record = cacheLifecyclePolicyModule.withCacheMetadata({
      schema: GRANULAR_CACHE_SCHEMA_VERSION,
      ticker: key,
      displayName: String(displayName || DISPLAY_NAMES[key] || key).trim(),
      savedAt: now,
      lastAccessed: now,
      latestDate: normalized[normalized.length - 1].date,
      historyCoverage,
      contentFingerprint,
      status: normalizeTickerPriceStatus(key, tickerPriceStatusStore.get(key) || {
        source: "LOCAL_CACHE",
        latestDate: normalized[normalized.length - 1].date,
        localCache: true,
      }),
      points: normalized,
    }, {
      source: "ticker-price",
      asOf: normalized.at(-1)?.date || "",
      revision: String(GRANULAR_CACHE_SCHEMA_VERSION),
      contentFingerprint,
      now,
      savedAt: now,
      touch: true,
    });
    const admission = tickerSeriesCacheRetention.planAdmission(key);
    if (admission.rankingRequired) {
      if (admission.touchUpdates.length) {
        await indexedCacheStore.writeRecords(
          TICKER_PRICE_CACHE_STORE_NAME,
          admission.touchUpdates.map(({ key: touchedKey, record: touchedRecord }) => [touchedKey, touchedRecord]),
        ).catch(() => {});
      }
      for (const evictKey of admission.evictKeys) {
        await deleteIndexedDbRecord(TICKER_PRICE_CACHE_STORE_NAME, evictKey);
      }
    }
    await writeIndexedDbRecord(TICKER_PRICE_CACHE_STORE_NAME, key, record);
    tickerSeriesCacheRetention.commitAdmission(key, record, admission.evictKeys);
    return true;
  }).catch(() => false);
}

async function applyTickerPriceCache(ticker, displayName = "") {
  const key = String(ticker || "").trim().toUpperCase();
  const record = await readTickerPriceCache(key);
  if (!record) return { applied: false, count: 0, latestDate: "" };
  if (displayName || record.displayName) {
    DISPLAY_NAMES[key] = displayName || record.displayName;
  }
  mergeTickerSeriesIntoPricePayload(key, record.points);
  setTickerPriceStatus(key, {
    ...(record.status || {}),
    source: record.status?.source || "LOCAL_CACHE",
    latestDate: record.latestDate || record.points[record.points.length - 1]?.date || "",
    cached: true,
    localCache: true,
  });
  return {
    applied: true,
    count: record.points.length,
    latestDate: record.latestDate || record.points[record.points.length - 1]?.date || "",
    historyCoverage: tickerPriceRuntimeModule.normalizeHistoryCoverage(record.historyCoverage),
  };
}

function getTickerCacheInvalidator() {
  if (tickerCacheInvalidator) return tickerCacheInvalidator;
  tickerCacheInvalidator = tickerCacheInvalidationModule.createTickerCacheInvalidator({
    remove: (storeName, ticker) => (storeName === TICKER_PRICE_CACHE_STORE_NAME
      ? removeTickerPriceCacheRecord(ticker)
      : deleteIndexedDbRecord(storeName, ticker)),
    clearMemory: (ticker, context = {}) => {
      const stores = new Set(context.stores || []);
      const sources = new Set(context.changedSources || []);
      if (stores.has(TICKER_AI_ANALYSIS_CACHE_STORE_NAME)) aiAnalysisByTicker.delete(ticker);
      if (stores.has(TICKER_AI_FORECAST_CACHE_STORE_NAME)) invalidateAiForecastCache(ticker);
      if (sources.has("price")) {
        aiForecastQualityRuntime?.invalidateTicker(ticker);
        macdModelCache.delete(ticker);
      }
    },
  });
  return tickerCacheInvalidator;
}

async function applyResearchHistoryPriceCache(ticker, displayName = "") {
  const key = String(ticker || "").trim().toUpperCase();
  const record = normalizeResearchHistoryCacheForTicker(
    await readLifecycleCacheRecord(TICKER_RESEARCH_HISTORY_STORE_NAME, key).catch(() => null),
    key,
  );
  if (!record) return { applied: false, count: 0, latestDate: "" };
  if (displayName) DISPLAY_NAMES[key] = displayName;
  mergeTickerSeriesIntoPricePayload(key, record.rows);
  setTickerPriceStatus(key, {
    source: "RESEARCH_CACHE",
    latestDate: record.latestDate,
    cached: true,
    localCache: true,
  });
  await writeTickerPriceCache(key, record.rows, displayName, {
    historyCoverage: tickerPriceRuntimeModule.HISTORY_COVERAGE_PARTIAL,
  });
  return {
    applied: true,
    count: record.rows.length,
    latestDate: record.latestDate,
    researchCache: true,
    historyCoverage: tickerPriceRuntimeModule.HISTORY_COVERAGE_PARTIAL,
  };
}

async function applySharedTickerPriceCache(ticker, displayName = "") {
  const priceCache = await applyTickerPriceCache(ticker, displayName);
  return priceCache.applied ? priceCache : applyResearchHistoryPriceCache(ticker, displayName);
}

function getTickerSeriesLoader() {
  if (tickerSeriesLoader) return tickerSeriesLoader;
  tickerSeriesLoader = tickerPriceRuntimeModule.createSeriesLoader({
    applySharedCache: applySharedTickerPriceCache,
    assessPriceUpdate: (existingPoints, points, { rebaseSignal }) => (
      tickerCacheInvalidationModule.assessPriceUpdate(existingPoints, points, {
        rebaseSignal,
        ratioThreshold: PRICE_CACHE_REBASE_RATIO_THRESHOLD,
        boundaryDays: PRICE_CACHE_REBASE_BOUNDARY_DAYS,
        maximumBoundaryDays: PRICE_CACHE_REBASE_BOUNDARY_DAYS,
      })
    ),
    clearSeries: clearTickerSeriesFromPricePayload,
    displayName: (key) => DISPLAY_NAMES[key] || "",
    fetchHistory: fetchTickerHistorySeries,
    fetchLatest: fetchLatestKrxTickerSeries,
    findRebaseSignal: (existingPoints, points) => findTickerPriceRebaseSignal(existingPoints, points, {
      ratioThreshold: PRICE_CACHE_REBASE_RATIO_THRESHOLD,
      boundaryDays: PRICE_CACHE_REBASE_BOUNDARY_DAYS,
    }),
    getPoints: getTickerPricePointsFromPayload,
    getStatus: (key) => tickerPriceStatusStore.get(key),
    hasSeries: (key) => (pricePayload?.records || []).some((row) => toNum(row?.[key]) !== null),
    hasVolumeHistory: hasTickerVolumeHistory,
    invalidateCache: (key, assessment) => getTickerCacheInvalidator().invalidate(key, assessment),
    isAbortError,
    isCacheFresh: isTickerPriceCacheFresh,
    latestDate: getLatestTickerDateFromPricePayload,
    mergePoints: mergeTickerSeriesIntoPricePayload,
    normalizePoints: normalizeTickerPricePointsForTicker,
    setStatus: setTickerPriceStatus,
    throwIfAborted,
    writeCache: writeTickerPriceCache,
  });
  return tickerSeriesLoader;
}

function ensureCustomTickerSeriesLoaded(ticker, options = {}) {
  return getTickerSeriesLoader().load(ticker, options);
}

const runtimeIndexRefreshService = runtimeIndexRefreshModule.createRuntimeIndexRefreshService({
  canUseGateway: canUseDartGateway,
  fetchWithTimeout,
  gatewayClient: runtimeGatewayClient,
  getPricePayload: () => pricePayload,
  isAbortError,
  isLocalRuntime: IS_LOCAL_RUNTIME,
  isRetryableError: runtimeRefreshModule.isRetryableRuntimeError,
  appVersion: APP_VERSION,
  labelName,
  mergeTickerSeries: mergeTickerSeriesIntoPricePayload,
  validateTickerPoints: (ticker, points, validationOptions) => (
    runtimeSeriesQualityGateModule.assertPricePoints({
      ticker,
      currentPayload: pricePayload,
      incomingPoints: points,
      referenceDates: validationOptions?.referenceDates,
    })
  ),
  throwIfAborted,
  timeoutMs: NETWORK_REQUEST_TIMEOUT_MS,
  toNumber: toNum,
});

function refreshCoreIndexSeries(options = {}) {
  return runtimeIndexRefreshService.refresh(options);
}

function getRuntimeBootstrapService() {
  if (runtimeBootstrapService) return runtimeBootstrapService;
  runtimeBootstrapService = runtimeBootstrapModule.createRuntimeBootstrapService({
    canUseGateway: canUseDartGateway,
    gatewayClient: runtimeGatewayClient,
    getCustomStocks: () => customStocks,
    getPricePayload: () => pricePayload,
    getTickerStatus: (ticker) => tickerPriceStatusStore.get(ticker),
    isAbortError,
    isHidden: (ticker) => chartSession.hiddenSeries.has(ticker),
    latestDatesByTicker: runtimeIndexRefreshModule.latestDatesByTicker,
    mapWithConcurrency,
    setTickerStatus: setTickerPriceStatus,
    timeoutMs: NETWORK_REQUEST_TIMEOUT_MS,
    toNumber: toNum,
  });
  return runtimeBootstrapService;
}

function fetchCriticalRuntimeBootstrap(options = {}) {
  return getRuntimeBootstrapService().fetchCritical(options);
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

  const trackAiProgress = chartSession.showAiForecast
    && visibleMainChartSeriesKeys().length < MAX_VISIBLE_MAIN_SERIES;
  if (trackAiProgress) {
    aiContextPendingTickers.add(candidate.ticker);
    startAiForecastProgress();
    setAiForecastProgress(5, `${candidate.name} 가격 준비`);
    syncAiForecastToggleButton();
  }
  loadingCustomStocks.add(candidate.ticker);
  try {
    DISPLAY_NAMES[candidate.ticker] = candidate.name;
    const initialLoad = await ensureCustomTickerSeriesLoaded(candidate.ticker, {
      displayName: candidate.name,
      returnAfterCache: true,
    });
    if (trackAiProgress && chartSession.showAiForecast) {
      setAiForecastProgress(14, `${candidate.name} 분석 자료 준비`);
    }

    const activateOnAdd = visibleMainChartSeriesKeys().length < MAX_VISIBLE_MAIN_SERIES;
    customStocks = assignColorsToCustomStocks([
      ...customStocks,
      {
        ticker: candidate.ticker,
        name: candidate.name,
        code: candidate.code,
        market: candidate.market,
      },
    ]);

    if (activateOnAdd) {
      chartSession.hiddenSeries.delete(candidate.ticker);
      clearAutoResetSeriesTransforms(candidate.ticker);
    } else {
      chartSession.hiddenSeries.add(candidate.ticker);
    }
    setAiForecastTargetVisibility(candidate.ticker, activateOnAdd);
    noteStockVisibilityChange(candidate.ticker);
    renderCustomStockButtons();
    saveState();
    const disclosureTask = preloadTickerDartData(candidate.ticker, msgEl);
    if (activateOnAdd && chartSession.showAiForecast) {
      if (!aiContextPendingTickers.has(candidate.ticker)) {
        aiContextPendingTickers.add(candidate.ticker);
        startAiForecastProgress();
      }
      setAiForecastProgress(18, `${candidate.name} 공시·실적·컨센서스 준비`);
      Promise.allSettled([
        requestAiAnalysisForTicker(candidate.ticker),
        Promise.resolve(disclosureTask),
        loadAiRotationLeaderSeries(),
      ]).finally(() => {
        aiContextPendingTickers.delete(candidate.ticker);
        syncAiForecastToggleButton();
        if (chartSession.showAiForecast) {
          setAiForecastProgress(38, `${candidate.name} AI 재계산 준비`);
          requestAiForecastRender(lastAiForecastTraceCount > 0);
        }
      });
    } else {
      aiContextPendingTickers.delete(candidate.ticker);
      syncAiForecastToggleButton();
      if (trackAiProgress && !aiContextPendingTickers.size) stopAiForecastProgress();
    }
    requestChartCompositionUpdate();
    if (initialLoad?.deferredRefresh) {
      ensureCustomTickerSeriesLoaded(candidate.ticker, { displayName: candidate.name })
        .then(() => requestChartCompositionUpdate())
        .catch(() => {});
    }
    if (!activateOnAdd) showChartNavigationMessage(MAX_VISIBLE_MAIN_SERIES_MESSAGE, 3000);
    setMessage(msgEl, [`${candidate.name} 종목이 추가되었습니다.`]);
  } catch (err) {
    aiContextPendingTickers.delete(candidate.ticker);
    syncAiForecastToggleButton();
    if (trackAiProgress && !aiContextPendingTickers.size) stopAiForecastProgress();
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
  const forceRefresh = Boolean(options?.forceRefresh);
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const scope = ["visible", "hidden"].includes(options?.scope) ? options.scope : "all";
  const items = customStocks.filter((item) => {
    const hidden = chartSession.hiddenSeries.has(String(item?.ticker || "").toUpperCase());
    if (scope === "visible") return !hidden;
    if (scope === "hidden") return hidden;
    return true;
  });
  if (!items.length) return { failedNames: [], processed: 0, scope };
  const perfStartedAt = startPerfSample();
  let latestPointsByTicker = null;
  if (items.length && canUseDartGateway()) {
    try {
      latestPointsByTicker = await fetchLatestKrxTickerSeriesBatch(
        items.map((item) => item.ticker),
        { forceNetwork: forceRefresh, signal, payload: options?.priceBatchPayload || null },
      );
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      // Older Worker deployments can fall back to the existing per-ticker endpoint.
      latestPointsByTicker = null;
    }
  }
  const results = await mapWithConcurrency(items, CUSTOM_STOCK_PRELOAD_CONCURRENCY, async (item) => {
    const hadExisting = (pricePayload?.records || []).some((row) => toNum(row?.[item.ticker]) !== null);
    try {
      await ensureCustomTickerSeriesLoaded(item.ticker, {
        forceRefresh,
        displayName: item.name,
        signal,
        ...(latestPointsByTicker ? { latestPoints: latestPointsByTicker.get(item.ticker) || [] } : {}),
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
    scope,
  });

  if (!failed.length) return { failedNames: [], processed: items.length, scope };

  customStocks = customStocks.filter((item) => !failed.includes(item.ticker));
  failed.forEach((ticker) => {
    if (lastVisibleStockSeriesKey === ticker) lastVisibleStockSeriesKey = "";
    chartSession.hiddenSeries.delete(ticker);
    delete chartSession.seriesOffsets[ticker];
    delete chartSession.seriesScales[ticker];
    delete DISPLAY_NAMES[ticker];
  });
  renderCustomStockButtons();
  saveState();
  return { failedNames, processed: items.length, scope };
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

function getChartModelWorkerClient() {
  if (chartModelWorkerClient) return chartModelWorkerClient;
  chartModelWorkerClient = chartModelWorkerClientModule.createChartModelWorkerClient(globalThis, {
    workerUrl: () => `./modules/chart-model-worker.js?v=${encodeURIComponent(APP_BUILD_VERSION || "dev")}`,
    timeoutMs: 10000,
  });
  return chartModelWorkerClient;
}

function mainChartMacroBoundsRows() {
  const revision = [
    dataRevisionSignature("macro"),
    macroRows.length,
    String(macroRows.at(-1)?.date || ""),
  ].join("|");
  if (mainChartMacroBoundsCache.revision !== revision) {
    mainChartMacroBoundsCache = {
      revision,
      rows: macroRows.filter((row) => Number.isFinite(toNum(row?.leading_cycle))),
    };
  }
  return mainChartMacroBoundsCache.rows;
}

function prepareMainChartRenderInputs(el, preserveZoom) {
  const priceRows = pricePayload?.records || [];
  const today = new Date().toISOString().slice(0, 10);
  const { minDate, maxDate } = mainChartRenderer.dateBounds(
    [priceRows, mainChartMacroBoundsRows(), creditRows],
    today,
  );
  const end = maxDate;
  const requestedStart = shiftMonths(end, chartSession.activeMonths);
  const start = requestedStart < minDate ? minDate : requestedStart;
  const dataStart = [minDate, shiftMonths(maxDate, 360)].sort().at(-1);
  const dataEnd = maxDate;
  const preservedFrameRange = preserveZoom ? getCurrentXRangeMs(el) : null;
  const frameStart = preservedFrameRange
    ? new Date(Math.max(toUtcMs(dataStart), preservedFrameRange[0])).toISOString().slice(0, 10)
    : start;
  const frameEnd = preservedFrameRange
    ? new Date(Math.min(toUtcMs(dataEnd), preservedFrameRange[1])).toISOString().slice(0, 10)
    : end;
  const allowedSeries = new Set([
    ...CORE_SERIES,
    ...customStocks.map((item) => item.ticker),
  ]);
  const visibleSeriesCount = [...allowedSeries]
    .filter((key) => !SUPPLEMENTAL_SERIES.includes(key) && !chartSession.hiddenSeries.has(key))
    .length;
  return {
    allowedSeries,
    dataEnd,
    dataStart,
    displayBudget: getMainChartDisplayPointBudget(el, visibleSeriesCount),
    end,
    frameEnd,
    frameStart,
    priceRows,
    start,
  };
}

function requestChartModelFromWorker(payload, type = "buildMainChartModel") {
  return getChartModelWorkerClient().request(payload, type);
}

function getMainChartSourceFingerprint(priceRows, allowedSeries) {
  return mainChartSourceFingerprintCache.resolve(
    priceRows,
    [...(allowedSeries || [])],
    dataRevisionSignature("price"),
    { tail: 520, logicVersion: "main-chart-source-v3" },
  );
}

function getMainChartCalcCacheKey(
  priceRows,
  dataStart,
  dataEnd,
  frameStart,
  frameEnd,
  allowedSeries,
  displayBudget,
) {
  const priceFingerprint = getMainChartSourceFingerprint(priceRows, allowedSeries);
  return [
    dataStart,
    dataEnd,
    frameStart,
    frameEnd,
    chartSession.activeMonths,
    CREDIT_OFFSET_DAYS,
    priceFingerprint,
    dataRevisionSignature("macro", "credit"),
    customStocks.map((item) => `${item.ticker}:${item.color || ""}`).join(","),
    [...chartSession.hiddenSeries].sort().join(","),
    sortedObjectSignature(chartSession.seriesOffsets),
    sortedObjectSignature(chartSession.seriesScales),
    chartSession.autoChartReset ? "auto-frame" : [
      sortedObjectSignature(chartSession.lockedChartFrame?.normBases || {}),
      sortedObjectSignature(chartSession.lockedChartFrame?.autoScales || {}),
    ].join("|"),
    displayBudget,
    MAIN_CHART_PRESERVE_DAILY_POINTS ? "daily-points" : "sampled-points",
  ].join("::");
}

function setupStockResearch(msgEl) {
  stockResearchApp = stockResearchAppModule.createStockResearchApp(globalThis, {
    ensureFeature: () => optionalFeatureRuntime.ensureStockResearch(),
    canRun: () => adminAccessGranted,
    onError: (message) => setMessage(msgEl, message, true),
    controllerOptions: () => ({
      isLocalRuntime: IS_LOCAL_RUNTIME,
      gatewayBaseUrl: DART_GATEWAY_URL,
      getAccessToken: getDartGatewayAccessToken,
      fetchWithTimeout,
      requestTimeoutMs: DART_GATEWAY_REQUEST_TIMEOUT_MS,
      workerUrl: `./modules/stock-research-worker.js?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
      canRun: () => adminAccessGranted,
      getData: () => ({ priceRecords: pricePayload?.records, adrRows, macroRows, creditRows, crisisRows }),
    historyCache: {
        read: readSharedResearchHistoryCache,
        readMany: readSharedResearchHistoryCaches,
        write: (ticker, record) => writeIndexedDbRecord(TICKER_RESEARCH_HISTORY_STORE_NAME, ticker, record),
        writeMany: (entries) => indexedCacheStore.writeRecords(
          TICKER_RESEARCH_HISTORY_STORE_NAME,
          entries,
        ),
        clear: () => indexedCacheStore.clearStore(TICKER_RESEARCH_HISTORY_STORE_NAME),
      prune: () => scheduleGranularCachePrune(TICKER_RESEARCH_HISTORY_STORE_NAME, 420),
    },
    resultCache: {
      read: (key) => indexedCacheStore.readRecord(STOCK_RESEARCH_RESULTS_STORE_NAME, key),
      write: (key, value) => indexedCacheStore.writeRecord(STOCK_RESEARCH_RESULTS_STORE_NAME, key, value),
      clear: () => indexedCacheStore.clearStore(STOCK_RESEARCH_RESULTS_STORE_NAME),
    },
      isAdded: (ticker) => customStocks.some((item) => item.ticker === ticker),
      addStock: (candidate) => addCustomStock(candidate, msgEl),
      removeStock: (ticker) => removeCustomStock(ticker),
    }),
  });
  stockResearchApp.setup();
}

function getChartModelDataKey(priceRows, allowedSeries) {
  return [
    getMainChartSourceFingerprint(priceRows, allowedSeries),
    dataRevisionSignature("macro", "credit"),
  ].join("|");
}

function finiteSeriesMap(source) {
  return Object.fromEntries(Object.entries(source || {}).filter(([, value]) => (
    Number.isFinite(Number(value)) && Math.abs(Number(value)) > 1e-9
  )));
}

function captureLockedChartFrame(model = chartSession.currentMainChartModel) {
  if (chartSession.autoChartReset || !model) return;
  const mergedAutoScales = {
    ...finiteSeriesMap(model.autoScales),
    ...finiteSeriesMap(chartSession.lockedChartFrame?.autoScales),
  };
  chartSession.lockedChartFrame = {
    // Existing entries win so moving the history window cannot silently rebase a visible series.
    normBases: {
      ...finiteSeriesMap(model.normBases),
      ...finiteSeriesMap(chartSession.lockedChartFrame?.normBases),
    },
    autoScales: mergedAutoScales,
  };
}

function captureLockedHistoryYRange() {
  if (chartSession.autoChartReset) return;
  captureLockedChartFrame();
  const range = document.getElementById("chart")?._fullLayout?.yaxis?.range;
  if (Array.isArray(range) && range.length >= 2 && range.every((value) => Number.isFinite(Number(value)))) {
    chartSession.lockedHistoryYRange = [Number(range[0]), Number(range[1])];
  }
}

function captureViewportNormalizationFrame(model = chartSession.currentMainChartModel) {
  if (chartSession.viewportNormalizationFrame || !model) return chartSession.viewportNormalizationFrame;
  chartSession.viewportNormalizationFrame = {
    normBases: finiteSeriesMap(model.normBases),
    autoScales: finiteSeriesMap(model.autoScales),
  };
  return chartSession.viewportNormalizationFrame;
}

function buildMainChartModel(priceRows, dataStart, dataEnd, frameStart, frameEnd, allowedSeries) {
  const { rows, macroCols, liveCols } = mergeMarketDataSources({
    priceRows,
    macroRows,
    creditRows,
    creditCols: CREDIT_COLS,
    start: dataStart,
    end: dataEnd,
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

  const calculationRows = rows.filter((row) => row.date >= frameStart && row.date <= frameEnd);
  const frameRows = calculationRows.length ? calculationRows : rows;
  const fixedFrame = chartSession.viewportNormalizationFrame || (chartSession.autoChartReset ? null : chartSession.lockedChartFrame);
  const commonNormBases = resolveNormalizationBases(frameRows, selected, fixedFrame?.normBases);

  const visibleForAuto = selected.filter((s) => !chartSession.hiddenSeries.has(s));
  const autoScales = mergeFixedAutoScales(autoFitScales(
    frameRows,
    visibleForAuto.length ? visibleForAuto : selected,
    commonNormBases,
  ), fixedFrame?.autoScales);
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

    const offset = chartSession.seriesOffsets[series] || 0;
    const userScale = resolveSeriesScale(chartSession.seriesScales, series);
    values = transformSeriesValues(values, userScale, offset);

    return { series, rawTexts, baseLineWidth, xValues, values, baseValues };
  });

  return { rows, allSeries, selected, seriesModels, normBases: commonNormBases, autoScales };
}

async function buildMainChartModelOffThread(
  priceRows,
  dataStart,
  dataEnd,
  frameStart,
  frameEnd,
  allowedSeries,
  displayBudget,
) {
  const fixedFrame = chartSession.viewportNormalizationFrame || (chartSession.autoChartReset ? null : chartSession.lockedChartFrame);
  const result = await requestChartModelFromWorker({
    datasetKey: getChartModelDataKey(priceRows, allowedSeries),
    sources: { priceRows, macroRows, creditRows },
    creditCols: [...CREDIT_COLS],
    creditOffsetDays: CREDIT_OFFSET_DAYS,
    start: dataStart,
    end: dataEnd,
    frameStart,
    frameEnd,
    allowedSeries: [...allowedSeries],
    priorityOrder: getSeriesPriorityOrder(),
    displayNames: { ...DISPLAY_NAMES },
    hiddenSeries: [...chartSession.hiddenSeries],
    seriesOffsets: { ...chartSession.seriesOffsets },
    seriesScales: { ...chartSession.seriesScales },
    fixedNormBases: fixedFrame ? { ...(fixedFrame.normBases || {}) } : null,
    fixedAutoScales: fixedFrame ? { ...(fixedFrame.autoScales || {}) } : null,
    displayBudget,
    preserveDailyPoints: MAIN_CHART_PRESERVE_DAILY_POINTS,
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
    normBases: result.normBases && typeof result.normBases === "object" ? result.normBases : {},
    autoScales: result.autoScales && typeof result.autoScales === "object" ? result.autoScales : {},
    displayIndexes: Array.isArray(result.displayIndexes) ? result.displayIndexes : null,
  };
}

async function getMainChartModel(
  priceRows,
  dataStart,
  dataEnd,
  frameStart,
  frameEnd,
  allowedSeries,
  displayBudget,
) {
  const key = getMainChartCalcCacheKey(
    priceRows,
    dataStart,
    dataEnd,
    frameStart,
    frameEnd,
    allowedSeries,
    displayBudget,
  );
  const request = mainChartCalcCache.resolve(key, async () => {
    let model = null;
    try {
      model = await buildMainChartModelOffThread(
        priceRows,
        dataStart,
        dataEnd,
        frameStart,
        frameEnd,
        allowedSeries,
        displayBudget,
      );
      if (!model) return null;
      lastMainChartModelSource = "worker";
    } catch (_) {
      model = buildMainChartModel(
        priceRows,
        dataStart,
        dataEnd,
        frameStart,
        frameEnd,
        allowedSeries,
      );
      lastMainChartModelSource = "sync";
      model.displayIndexes = buildMainChartDisplayIndexes(
        model.rows,
        model.seriesModels,
        model.selected,
        displayBudget,
        MAIN_CHART_PRESERVE_DAILY_POINTS,
      );
    }
    model.renderRevision = key;
    return model;
  });
  lastMainChartModelCacheHit = request.status !== "miss";
  return request.promise;
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

function buildMainChartDisplayIndexes(rows, seriesModels, selected, budget, preserveDailyPoints = false) {
  return chartDisplaySamplerModule.buildDisplayIndexes(
    rows,
    seriesModels,
    selected,
    chartSession.hiddenSeries,
    budget,
    preserveDailyPoints,
  );
}

function updateHandles() {
  if (isHandleDragging || isHandlePointerActive) return;
  if (!chartSession.showChartHandles) {
    document.getElementById("y-handles")?.remove();
    return;
  }
  const el = document.getElementById("chart");
  const ya = el?._fullLayout?.yaxis;
  const xa = el?._fullLayout?.xaxis;
  if (!el || !ya?._length || !xa?._length || !Array.isArray(el.data)) return;

  let container = document.getElementById("y-handles");
  if (!container) {
    container = document.createElement("div");
    container.id = "y-handles";
    el.appendChild(container);
  }
  container.replaceChildren();
  const rightX = xa._offset + xa._length + 6;

  el.data.forEach((trace, traceIndex) => {
    const seriesKey = String(trace?.meta?.seriesKey || "");
    if (!mainChartRenderer.isSeriesHandleTrace(trace, baseTraceValues)) return;
    const { first, last } = mainChartRenderer.visibleEndpointValues(trace, trace.y, xa.range);
    if (!Number.isFinite(first) || !Number.isFinite(last)) return;
    const toPixelY = (value) => {
      if (typeof ya.l2p === "function") return ya._offset + ya.l2p(value);
      const span = Number(ya.range?.[1]) - Number(ya.range?.[0]);
      if (!Number.isFinite(span) || Math.abs(span) < 1e-9) return Number.NaN;
      return ya._offset + ya._length * (1 - ((value - ya.range[0]) / span));
    };
    const leftPixelY = toPixelY(first);
    const rightPixelY = toPixelY(last);
    if (!Number.isFinite(leftPixelY) || !Number.isFinite(rightPixelY)) return;
    const color = trace?.line?.color || SERIES_COLORS[seriesKey] || "#d4d4d4";

    const leftHandle = document.createElement("div");
    leftHandle.className = "y-handle y-handle-left";
    leftHandle.style.top = `${leftPixelY - 7}px`;
    leftHandle.style.backgroundColor = color;
    leftHandle.title = `${labelName(seriesKey)} (위치)`;
    leftHandle.dataset.seriesKey = seriesKey;
    guardHandlePointer(leftHandle);
    container.appendChild(leftHandle);

    const rightHandle = document.createElement("div");
    rightHandle.className = "y-handle y-handle-right";
    rightHandle.style.top = `${rightPixelY - 7}px`;
    rightHandle.style.left = `${rightX}px`;
    rightHandle.style.backgroundColor = color;
    rightHandle.title = `${labelName(seriesKey)} (스케일)`;
    rightHandle.dataset.seriesKey = seriesKey;
    guardHandlePointer(rightHandle);
    container.appendChild(rightHandle);

    setupOffsetDrag(leftHandle, traceIndex, seriesKey, leftPixelY, ya, rightHandle, rightPixelY);
    setupScaleDrag(rightHandle, traceIndex, seriesKey, rightPixelY, ya);
  });
}

function guardHandlePointer(handle) {
  handle.addEventListener("pointerenter", () => {
    isHandlePointerActive = true;
  });
  handle.addEventListener("pointerleave", () => {
    if (isHandleDragging) return;
    isHandlePointerActive = false;
    scheduleHandleUpdate(0);
  });
}

function computeFinalValues(seriesKey) {
  const base = baseTraceValues[seriesKey];
  if (!base) return null;
  return transformSeriesValues(
    base,
    resolveSeriesScale(chartSession.seriesScales, seriesKey),
    chartSession.seriesOffsets[seriesKey] || 0,
  );
}

function mainSeriesTraceIndex(el, seriesKey, preferredIndex = null) {
  const preferred = Number.isInteger(preferredIndex) ? el?.data?.[preferredIndex] : null;
  if (
    preferred?.meta?.seriesKey === seriesKey
    && !preferred?.meta?.isAiForecastTrace
    && !preferred?.meta?.isAiForecastBand
    && !preferred?.meta?.isAiForecastScenarioTrace
  ) return preferredIndex;
  return (el?.data || []).findIndex((trace) => (
    trace?.meta?.seriesKey === seriesKey
    && !trace?.meta?.isAiForecastTrace
    && !trace?.meta?.isAiForecastBand
    && !trace?.meta?.isAiForecastScenarioTrace
  ));
}

function positionSeriesHandles(el, seriesKey, values) {
  if (!chartSession.showChartHandles) return;
  const yAxis = el?._fullLayout?.yaxis;
  const xAxis = el?._fullLayout?.xaxis;
  if (!yAxis || !xAxis || !Array.isArray(values)) return;
  const traceIndex = mainSeriesTraceIndex(el, seriesKey);
  const trace = traceIndex >= 0 ? el.data[traceIndex] : null;
  const { first, last } = mainChartRenderer.visibleEndpointValues(trace, values, xAxis.range);
  const handles = [...document.querySelectorAll("#y-handles .y-handle")]
    .filter((handle) => handle.dataset.seriesKey === seriesKey);
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    handles.forEach((handle) => { handle.hidden = true; });
    return;
  }
  const toTop = (value) => {
    if (typeof yAxis.l2p === "function") return yAxis._offset + yAxis.l2p(value) - 7;
    const span = Number(yAxis.range?.[1]) - Number(yAxis.range?.[0]);
    if (!Number.isFinite(span) || Math.abs(span) < 1e-9) return Number.NaN;
    return yAxis._offset + yAxis._length * (1 - ((value - yAxis.range[0]) / span)) - 7;
  };
  handles.forEach((handle) => {
    handle.hidden = false;
    const top = handle.classList.contains("y-handle-left") ? toTop(first) : toTop(last);
    if (Number.isFinite(top)) handle.style.top = `${top}px`;
  });
}

function appendEventMarkerYUpdates(el, traceIndexes, yUpdates) {
  const args = [
    chartSession.currentMainChartModel.selected,
    chartSession.currentMainChartModel.seriesModels,
    chartSession.currentDataStart,
    chartSession.currentDataEnd,
    chartSession.currentStart,
    chartSession.currentEnd,
  ];
  const markerFrame = (
    chartSession.showInsiderTrades
    || chartSession.showDisclosures
    || chartSession.showRecessionSignals
  ) ? createEventMarkerFrame(...args) : null;
  const result = chartMarkerLayoutModule.collectYUpdates(el, [
    {
      id: "insider",
      enabled: chartSession.showInsiderTrades,
      matches: (trace) => trace?.meta?.isInsiderTradeTrace,
      keyOf: (trace) => trace?.meta?.insiderTradeSide,
      build: () => buildInsiderTradeTraces(...args, markerFrame),
    },
    {
      id: "disclosure",
      enabled: chartSession.showDisclosures,
      matches: (trace) => trace?.meta?.isDisclosureTrace,
      build: () => buildDisclosureTrace(...args, markerFrame),
    },
    {
      id: "crisis",
      enabled: chartSession.showRecessionSignals,
      matches: (trace) => trace?.meta?.isCrisisSignalTrace,
      build: () => buildCrisisSignalTrace(...args, markerFrame),
    },
    {
      id: "timing-buy",
      enabled: chartSession.showRecessionSignals,
      matches: (trace) => trace?.meta?.isMarketTimingBuyTrace,
      build: () => buildMarketTimingBuyTrace(...args, markerFrame),
    },
    {
      id: "timing-sell",
      enabled: chartSession.showRecessionSignals,
      matches: (trace) => trace?.meta?.isMarketTimingSellTrace,
      build: () => buildMarketTimingSellTrace(...args, markerFrame),
    },
  ]);
  traceIndexes.push(...result.traceIndexes);
  yUpdates.push(...result.yUpdates);
  return {
    structureChanged: result.structureChanged,
    disclosureUpdated: result.updated.includes("disclosure"),
  };
}

async function applyChartVisualFrame(frame) {
  const el = document.getElementById("chart");
  if (!el?.data || !window.Plotly) return;
  const traceIndexes = [];
  const yUpdates = [];
  (frame.series || []).forEach(({ seriesKey, traceIndex: preferredIndex }) => {
    const traceIndex = mainSeriesTraceIndex(el, seriesKey, preferredIndex);
    const newY = computeFinalValues(seriesKey);
    if (traceIndex < 0 || !newY) return;
    traceIndexes.push(traceIndex);
    yUpdates.push(newY);
    updateCurrentMainChartSeriesTransform(seriesKey);
    positionSeriesHandles(el, seriesKey, newY);
  });

  const eventUpdate = frame.markers && chartSession.currentMainChartModel?.seriesModels?.length
    ? appendEventMarkerYUpdates(el, traceIndexes, yUpdates)
    : { structureChanged: false, disclosureUpdated: false };
  if (eventUpdate.disclosureUpdated) partialDisclosureUpdateCount += 1;
  if (traceIndexes.length) {
    lineHitIndexCache.delete(el);
    chartEventLayerModule.invalidateMarkerPixels(el);
    await Plotly.restyle(el, { y: yUpdates }, traceIndexes);
  }
  if (frame.handles && !(frame.series || []).length) updateHandles();
  if (eventUpdate.structureChanged) requestChartRender(true, { reason: "event-structure" });
}

function getChartVisualFrameCoordinator() {
  if (!chartVisualFrameCoordinator) {
    chartVisualFrameCoordinator = chartVisualFrameModule.createCoordinator(window, {
      applyFrame: applyChartVisualFrame,
      onError: recordRuntimeError,
    });
  }
  return chartVisualFrameCoordinator;
}

function restyleLive(traceIndex, seriesKey) {
  getChartVisualFrameCoordinator().schedule({
    seriesKey,
    traceIndex,
    markers: chartSession.showInsiderTrades || chartSession.showDisclosures || chartSession.showRecessionSignals,
    handles: true,
    reason: "series-transform",
  });
}

function finishTraceYEdit(rebuildForDisclosures = true, seriesKey = "", options = {}) {
  getChartVisualFrameCoordinator().flush();
  saveState();
  if (chartSession.autoChartReset && options.preserveTransform === true) {
    // Preserve the visible amplitude; grow the viewport only when the edit would clip a trace.
    chartSession.pendingAutoChartFit = true;
    chartSession.pendingAutoChartFitExpandOnly = true;
    requestChartRender(true, {
      deferDuringInteraction: false,
      reason: "series-transform",
      updateClass: "transform",
    });
    return;
  }
  if (applyChartResetPolicy("manual")) {
    requestChartRender(true, {
      deferDuringInteraction: false,
      reason: "series-transform-reset",
      updateClass: "transform",
    });
    return;
  }
  if (chartSession.showAiForecast) {
    requestAiForecastRender(true);
    return;
  }
  updateHandles();
  saveLastRuntimeSnapshot().catch(() => {});
}


function lockCurrentYAxisRange() {
  const el = document.getElementById("chart");
  const range = el?._fullLayout?.yaxis?.range;
  if (!el || !Array.isArray(range) || range.length < 2) return;
  const lockedRange = [range[0], range[1]];
  useViewportEventMarkerGap = true;
  if (el.layout?.yaxis) {
    el.layout.yaxis.autorange = false;
    el.layout.yaxis.range = [...lockedRange];
  }
  return Plotly.relayout(el, {
    "yaxis.range[0]": lockedRange[0],
    "yaxis.range[1]": lockedRange[1],
    "yaxis.autorange": false,
  });
}

function getCurrentMainXRange() {
  const range = document.getElementById("chart")?._fullLayout?.xaxis?.range;
  if (!Array.isArray(range) || range.length < 2) return null;
  return [range[0], range[1]];
}

function setupOffsetDrag(handle, traceIndex, seriesKey, basePixelY, ya, pairedHandle, pairedPixelY) {
  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const startOffset = chartSession.seriesOffsets[seriesKey] || 0;
    const startClientY = event.clientY;
    const lockedXRange = getCurrentMainXRange();
    isHandlePointerActive = true;
    isHandleDragging = true;
    handle.classList.add("dragging");
    lockCurrentYAxisRange();

    addDragListeners(event.pointerId, (clientY) => {
      const dy = clientY - startClientY;
      chartSession.seriesOffsets[seriesKey] = offsetFromDrag(startOffset, startClientY, clientY, ya);
      handle.style.top = `${basePixelY + dy - 7}px`;
      if (pairedHandle) pairedHandle.style.top = `${pairedPixelY + dy - 7}px`;
      restyleLive(traceIndex, seriesKey);
    }, (clientY) => {
      handle.classList.remove("dragging");
      isHandleDragging = false;
      isHandlePointerActive = false;
      if (lockedXRange) chartSession.pinnedXRange = [...lockedXRange];
      if (Math.abs(clientY - startClientY) < 3) {
        chartSession.seriesOffsets[seriesKey] = startOffset;
        const becomingVisible = chartSession.hiddenSeries.has(seriesKey);
        if (!setMainChartSeriesVisible(seriesKey, becomingVisible)) return;
        noteStockVisibilityChange(seriesKey);
        requestChartCompositionUpdate();
        return;
      }
      finishTraceYEdit(true, seriesKey, { preserveTransform: true });
    });
  }, { passive: false });
}

function setupScaleDrag(handle, traceIndex, seriesKey, basePixelY, ya) {
  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const startScale = resolveSeriesScale(chartSession.seriesScales, seriesKey);
    const startClientY = event.clientY;
    const lockedXRange = getCurrentMainXRange();
    isHandlePointerActive = true;
    isHandleDragging = true;
    handle.classList.add("dragging");
    lockCurrentYAxisRange();

    addDragListeners(event.pointerId, (clientY) => {
      const dy = clientY - startClientY;
      chartSession.seriesScales[seriesKey] = scaleFromDrag(startScale, startClientY, clientY);
      handle.style.top = `${basePixelY + dy - 7}px`;
      restyleLive(traceIndex, seriesKey);
    }, () => {
      handle.classList.remove("dragging");
      isHandleDragging = false;
      isHandlePointerActive = false;
      if (lockedXRange) chartSession.pinnedXRange = [...lockedXRange];
      finishTraceYEdit(true, seriesKey, { preserveTransform: true });
    });
  }, { passive: false });
}

function addDragListeners(pointerId, onMove, onEnd) {
  return bindPointerDrag(document, { pointerId, onMove, onEnd });
}

function visibleLineDataRangeMs(traces) {
  const range = chartCompositionViewportModule.visibleLineDataRangeMs(traces, {
    toMilliseconds: toMsSafe,
  })?.range || null;
  return extendChartRangeRight(range);
}

function queueAutoCompositionViewport(forceFitFull = false) {
  const element = document.getElementById("chart");
  chartSession.pendingCompositionViewport = chartCompositionViewportModule.captureCompositionViewport({
    autoScale: chartSession.autoChartReset,
    element,
    forceFitFull,
    getViewRange: getCurrentXRangeMs,
    timelinePolicy: seriesTimelinePolicyModule,
    toMilliseconds: toMsSafe,
    rightPaddingMs: chartRightPaddingMs(),
  });
}

function requestChartCompositionUpdate(options = {}) {
  return getChartUpdateCoordinator().requestComposition(options);
}

function fitCurrentChartRatio(options = {}) {
  const el = document.getElementById("chart");
  if (!el?._fullLayout?.yaxis || !window.Plotly) return false;
  const xRange = getCurrentMainXRange();
  const primaryTraces = (el.data || []).filter((trace) => (
    trace?.meta?.seriesKey && !trace?.meta?.isDisclosureTrace && !trace?.meta?.isInsiderTradeTrace
  ));
  const fittedYRange = fitRangeForTraces(primaryTraces, xRange, {
    paddingRatio: 0.08,
    minimumPadding: 0.6,
  });
  const yRange = options.expandOnly
    ? expandRangeToContain(el._fullLayout.yaxis.range, fittedYRange)
    : fittedYRange;
  if (!yRange) return false;
  if (xRange) chartSession.pinnedXRange = [...xRange];
  useViewportEventMarkerGap = true;
  lineHitIndexCache.delete(el);
  chartEventLayerModule.invalidateMarkerPixels(el);
  return Promise.resolve(Plotly.relayout(el, {
    "yaxis.range[0]": yRange[0],
    "yaxis.range[1]": yRange[1],
    "yaxis.autorange": false,
  })).then(() => {
    getChartVisualFrameCoordinator().schedule({
      markers: chartSession.showDisclosures || chartSession.showInsiderTrades || chartSession.showRecessionSignals,
      reason: "axis-range",
    });
    saveLastRuntimeSnapshot().catch(() => {});
    return true;
  });
}

function tracesExceedVisibleYRange(traces, xRange, yRange) {
  const current = Array.isArray(yRange) ? yRange.slice(0, 2).map(Number) : [];
  if (current.length < 2 || !current.every(Number.isFinite)) return false;
  const required = fitRangeForTraces(traces, xRange, {
    paddingRatio: 0.08,
    minimumPadding: 0.6,
  });
  if (!required) return false;
  const low = Math.min(...current);
  const high = Math.max(...current);
  const tolerance = Math.max(0.05, (high - low) * 0.002);
  return required[0] < low - tolerance || required[1] > high + tolerance;
}

function getChartMarkerRuntime() {
  if (chartMarkerRuntime) return chartMarkerRuntime;
  chartMarkerRuntime = chartMarkerRuntimeModule.createChartMarkerRuntime(globalThis, {
    colors: {
      crisis: CRISIS_SIGNAL_COLOR,
      disclosure: DISCLOSURE_MARKER_COLOR,
      timingBuy: MARKET_TIMING_BUY_COLOR,
      timingSell: MARKET_TIMING_SELL_COLOR,
    },
    constants: {
      disclosureIconText: DISCLOSURE_ICON_TEXT,
      disclosureTextSize: DISCLOSURE_TEXT_SIZE,
      disclosureTraceName: DISCLOSURE_TRACE_NAME,
      eventMarkerGapRatio: EVENT_MARKER_GAP_RATIO,
      insiderLineGapRatio: INSIDER_MARKER_LINE_GAP_RATIO,
      insiderTimingCollisionDistanceRatio: INSIDER_TIMING_COLLISION_DISTANCE_RATIO,
      insiderTimingCollisionOffsetRatio: INSIDER_TIMING_COLLISION_OFFSET_RATIO,
      pairedInsiderBuyOffsetRatio: PAIRED_INSIDER_BUY_OFFSET_RATIO,
      pairedInsiderSellOffsetRatio: PAIRED_INSIDER_SELL_OFFSET_RATIO,
      timingGapMultiplier: TIMING_MARKER_GAP_MULTIPLIER,
    },
    chartEventLayer: chartEventLayerModule,
    chartSession,
    buildInsiderMarkerTraces,
    dataRevisionSignature,
    ensureMarketTimingFeature,
    escapeHtml,
    getAdrRows: () => adrRows,
    getCreditRows: () => creditRows,
    getCrisisRows: () => crisisRows,
    getCustomStocks: () => customStocks,
    getDisclosureRows: () => disclosureRows,
    getInsiderTradeRows: () => insiderTradeRows,
    getMacroRows: () => macroRows,
    getMarketTimingService: () => marketTimingService,
    getPricePayload: () => pricePayload,
    getTickerVolumeSeriesByTicker: () => tickerVolumeSeriesByTicker,
    getUseViewportMarkerGap: () => useViewportEventMarkerGap,
    getViewportYRange: () => document.getElementById("chart")?._fullLayout?.yaxis?.range,
    isForecastSeries,
    labelName,
    netSameReporterInsiderTrades,
    recordPerfSample,
    recordRuntimeError,
    seriesColor,
    startPerfSample,
    toNum,
    toUtcMs,
  });
  return chartMarkerRuntime;
}

function createEventMarkerFrame(
  selected,
  seriesModels,
  start,
  end,
  markerStart = start,
  markerEnd = end,
) {
  return getChartMarkerRuntime().createFrame({
    selected,
    seriesModels,
    start,
    end,
    markerStart,
    markerEnd,
  });
}

function buildDisclosurePointIndex(seriesModels, tickers) {
  return chartEventLayerModule.buildPointIndex(seriesModels, tickers, toUtcMs);
}

function findPointOnOrAfterDate(eventDate, ticker, pointIndex, maxDays = 14) {
  return chartMarkerRuntimeModule.findPointOnOrAfterDate(eventDate, ticker, pointIndex, maxDays);
}

function collectCrisisSignalEntries(rows) {
  return chartMarkerRuntimeModule.collectCrisisSignalEntries(rows);
}

function buildCrisisSignalTrace(
  selected,
  seriesModels,
  start,
  end,
  markerStart = start,
  markerEnd = end,
  markerFrame = null,
) {
  const frame = markerFrame || createEventMarkerFrame(
    selected,
    seriesModels,
    start,
    end,
    markerStart,
    markerEnd,
  );
  const result = getChartMarkerRuntime().buildCrisis(frame);
  lastRecessionSignalCount = result.count;
  return result.trace;
}

async function prepareMarketTimingModels(selected, seriesModels) {
  return getChartMarkerRuntime().prepareMarketTimingModels(selected, seriesModels);
}

function buildMarketTimingBuyTrace(
  selected,
  seriesModels,
  start,
  end,
  markerStart = start,
  markerEnd = end,
  markerFrame = null,
) {
  const frame = markerFrame || createEventMarkerFrame(
    selected,
    seriesModels,
    start,
    end,
    markerStart,
    markerEnd,
  );
  const result = getChartMarkerRuntime().buildTimingBuy(frame);
  lastMarketTimingBuyCount = result.count;
  return result.trace;
}

function buildMarketTimingSellTrace(
  selected,
  seriesModels,
  start,
  end,
  markerStart = start,
  markerEnd = end,
  markerFrame = null,
) {
  const frame = markerFrame || createEventMarkerFrame(
    selected,
    seriesModels,
    start,
    end,
    markerStart,
    markerEnd,
  );
  const result = getChartMarkerRuntime().buildTimingSell(frame);
  lastMarketTimingSellCount = result.count;
  return result.trace;
}

function buildDisclosureTrace(
  selected,
  seriesModels,
  start,
  end,
  markerStart = start,
  markerEnd = end,
  markerFrame = null,
) {
  const frame = markerFrame || createEventMarkerFrame(
    selected,
    seriesModels,
    start,
    end,
    markerStart,
    markerEnd,
  );
  const result = getChartMarkerRuntime().buildDisclosure(frame);
  lastDisclosureTraceStats = result.stats;
  disclosureGroupStore = result.groups;
  return result.trace;
}

function buildInsiderTradeTraces(
  selected,
  seriesModels,
  start,
  end,
  markerStart = start,
  markerEnd = end,
  markerFrame = null,
) {
  const frame = markerFrame || createEventMarkerFrame(
    selected,
    seriesModels,
    start,
    end,
    markerStart,
    markerEnd,
  );
  const result = getChartMarkerRuntime().buildInsider(frame);
  lastInsiderTradeTraceStats = result.stats;
  return result.traces;
}

function updateCurrentMainChartSeriesTransform(seriesKey) {
  if (!seriesKey || !chartSession.currentMainChartModel?.seriesModels) return true;
  const model = chartSession.currentMainChartModel.seriesModels.find((item) => item.series === seriesKey);
  if (!model || !Array.isArray(model.baseValues)) return false;
  model.values = transformSeriesValues(
    model.baseValues,
    resolveSeriesScale(chartSession.seriesScales, seriesKey),
    chartSession.seriesOffsets[seriesKey] || 0,
  );
  return true;
}

function refreshDisclosureTraceFast(seriesKey = "") {
  const el = document.getElementById("chart");
  if (
    !chartSession.showDisclosures
    || !window.Plotly
    || !el?.data
    || !chartSession.currentMainChartModel?.seriesModels?.length
    || !chartSession.currentStart
    || !chartSession.currentEnd
  ) return false;
  if (!updateCurrentMainChartSeriesTransform(seriesKey)) return false;

  const nextTrace = buildDisclosureTrace(
    chartSession.currentMainChartModel.selected,
    chartSession.currentMainChartModel.seriesModels,
    chartSession.currentDataStart,
    chartSession.currentDataEnd,
    chartSession.currentStart,
    chartSession.currentEnd,
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

  mainChartCalcCache.clear();
  partialDisclosureUpdateCount += 1;
  hideDisclosurePopover();
  chartEventLayerModule.invalidateMarkerPixels(el);
  Promise.resolve(task)
    .then(() => {
      syncDisclosureToggleButton(lastDisclosureTraceStats.markers);
      scheduleLastRuntimeSnapshotSave();
    })
    .catch(() => requestChartRender());
  return true;
}

function applyDisclosureStateFast(seriesKey = "") {
  if (chartSession.showDisclosures) return refreshDisclosureTraceFast(seriesKey);
  const el = document.getElementById("chart");
  if (!window.Plotly || !el?.data) return false;
  const traceIndex = el.data.findIndex((trace) => trace?.meta?.isDisclosureTrace);
  hideDisclosurePopover();
  clearDisclosureHoverTimer();
  currentDisclosureHighlight = null;
  lastDisclosureTraceStats = { total: disclosureRows.length, candidates: 0, markers: 0 };
  syncDisclosureToggleButton(0);
  if (traceIndex < 0) return true;
  chartEventLayerModule.invalidateMarkerPixels(el);
  Promise.resolve(Plotly.deleteTraces(el, traceIndex))
    .then(() => {
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

function handleAiForecastClick(evtData) {
  const selected = aiForecastTracesModule.representativeReportFromForecastClick?.(evtData);
  if (!selected) return false;
  const { point, report } = selected;
  const series = String(point?.data?.meta?.seriesKey || "");
  const displayName = aiForecastTracesModule.withoutStockCode?.(labelName(series)) || labelName(series);
  const reportTitle = aiForecastTracesModule.withoutStockCode?.(report.title) || report.title;
  showDisclosurePopover({
    name: report.broker
      ? `${displayName} · ${report.broker}`
      : `${displayName} · 참고 리포트`,
    plotDate: report.publishedDate,
    events: [{ title: reportTitle, url: report.sourceUrl }],
  }, evtData.event);
  return true;
}

function handleTimingSignalClick(evtData) {
  const point = evtData?.points?.find((candidate) => (
    candidate?.data?.meta?.isMarketTimingBuyTrace
    || candidate?.data?.meta?.isMarketTimingSellTrace
    || candidate?.data?.meta?.isCrisisSignalTrace
  ));
  if (!point || !isDirectDisclosureTap(evtData, point)) return false;
  const group = chartMarkerRuntimeModule.buildTimingSignalPopoverGroup(point);
  if (!group) return false;
  showDisclosurePopover(group, evtData.event);
  return true;
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

function setDisclosureTextHighlighted(chartEl, traceIndex, pointIndex, highlighted) {
  const disclosureTrace = chartEl.data?.[traceIndex]
    || chartEl.data?.find((trace) => trace?.meta?.isDisclosureTrace);
  const xAxis = chartEl?._fullLayout?.xaxis;
  const yAxis = disclosureTrace?.yaxis === "y2" ? chartEl?._fullLayout?.yaxis2 : chartEl?._fullLayout?.yaxis;
  const chartRect = chartEl.getBoundingClientRect?.();
  const markerX = Number(xAxis?._offset || 0) + Number(xAxis?.d2p?.(disclosureTrace?.x?.[pointIndex]));
  const markerY = Number(yAxis?._offset || 0) + Number(yAxis?.d2p?.(disclosureTrace?.y?.[pointIndex]));
  const nodes = getDisclosureTextNodes(chartEl);
  const node = Number.isFinite(markerX) && Number.isFinite(markerY) && chartRect
    ? nodes.reduce((nearest, candidate) => {
      const rect = candidate.getBoundingClientRect?.();
      if (!rect) return nearest;
      const distance = Math.hypot(
        rect.left + rect.width * 0.5 - chartRect.left - markerX,
        rect.top + rect.height * 0.5 - chartRect.top - markerY,
      );
      return !nearest || distance < nearest.distance ? { candidate, distance } : nearest;
    }, null)?.candidate
    : nodes[pointIndex];
  if (!node || !disclosureTrace) return false;
  const size = highlighted ? DISCLOSURE_TEXT_HOVER_SIZE : DISCLOSURE_TEXT_SIZE;
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
  const traceIndex = currentDisclosureHighlight.traceIndex;
  const pointIndex = currentDisclosureHighlight.pointIndex;
  currentDisclosureHighlight = null;
  setDisclosureTextHighlighted(chartEl, traceIndex, pointIndex, false);
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
  setDisclosureTextHighlighted(chartEl, traceIndex, pointIndex, true);
}

function collectVisibleAiForecastSeries() {
  const models = chartSession.currentMainChartModel?.seriesModels || [];
  return [...new Set(models
    .map((model) => String(model?.series || "").toUpperCase())
    .filter((series) => isForecastSeries(series) && !chartSession.hiddenSeries.has(series)))];
}

function cancelAiForecastCalculations() {
  aiForecastApp?.cancelCalculations?.();
}

function refreshAiForecastTargets() {
  const next = new Set(chartSession.showAiForecast ? collectVisibleAiForecastSeries() : []);
  const changed = next.size !== aiForecastTargetSeries.size
    || [...next].some((series) => !aiForecastTargetSeries.has(series));
  if (!changed) return false;
  aiForecastTargetSeries = next;
  aiForecastDeferredSeries = new Set(
    [...aiForecastDeferredSeries].filter((series) => next.has(series)),
  );
  aiForecastTargetRevision += 1;
  cancelAiForecastCalculations();
  return true;
}

function setAiForecastTargetVisibility(series, visible) {
  const key = String(series || "").toUpperCase();
  if (!chartSession.showAiForecast || !isForecastSeries(key)) return false;
  const next = new Set(aiForecastTargetSeries);
  if (visible) next.add(key);
  else next.delete(key);
  const changed = next.size !== aiForecastTargetSeries.size
    || [...next].some((item) => !aiForecastTargetSeries.has(item));
  if (!changed) return false;
  aiForecastTargetSeries = next;
  if (visible) {
    aiForecastDeferredSeries.add(key);
    if (isLatestChartViewport()) {
      revealAiForecastRangeOnNextRender = true;
      trimAiForecastRangeOnNextRender = false;
    }
  }
  else aiForecastDeferredSeries.delete(key);
  aiForecastTargetRevision += 1;
  cancelAiForecastCalculations();
  return true;
}

function activeAiAnalysisTickers() {
  return [...aiForecastTargetSeries]
    .filter((ticker) => /^\d{6}\.(KS|KQ)$/.test(ticker));
}

async function loadAiMarketModel() {
  if (aiMarketModel) return aiMarketModel;
  if (aiMarketModelPromise) return aiMarketModelPromise;
  aiMarketModelLoadSettled = false;
  aiMarketModelPromise = fetchWithTimeout(AI_MARKET_MODEL_URL, { cache: "no-cache" }, 20000)
    .then(async (response) => {
      if (!response.ok) throw new Error(`AI market model HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || !payload.horizons) {
        throw new Error("Invalid AI market model");
      }
      aiMarketModel = payload;
      setAiForecastProgress(20, "시장 학습 모델 준비");
      return payload;
    })
    .catch(() => null)
    .finally(() => {
      aiMarketModelPromise = null;
      aiMarketModelLoadSettled = true;
      if (chartSession.showAiForecast) requestAiForecastRender(lastAiForecastTraceCount > 0);
    });
  return aiMarketModelPromise;
}

function setAiForecastProgress(value, label = "AI 계산") {
  aiForecastApp?.setProgress?.(value, label);
}

function resetAiForecastProgress(label = "AI 계산 준비") {
  aiForecastApp?.resetProgress?.(label);
}

function waitForAiProgressPaint(delay = 0) {
  return aiForecastApp?.waitForProgressPaint?.(delay) || Promise.resolve();
}

function startAiForecastProgress() {
  aiForecastApp?.startProgress?.();
}

function finishAiForecastProgress() {
  aiForecastApp?.finishProgress?.();
}

function stopAiForecastProgress() {
  aiForecastApp?.stopProgress?.();
}

function getAiForecastCacheService() {
  if (aiForecastCacheService) return aiForecastCacheService;
  if (!aiForecastCacheModule) throw new Error("AI forecast cache is not loaded");
  aiForecastCacheService = aiForecastCacheModule.createForecastCache({
    memory: aiForecastResultBySeries,
    maxMemory: 24,
    read: (ticker) => readLifecycleCacheRecord(TICKER_AI_FORECAST_CACHE_STORE_NAME, ticker),
    write: (ticker, record) => writeIndexedDbRecord(TICKER_AI_FORECAST_CACHE_STORE_NAME, ticker, record),
    remove: (ticker) => deleteIndexedDbRecord(TICKER_AI_FORECAST_CACHE_STORE_NAME, ticker),
    prune: () => scheduleGranularCachePrune(TICKER_AI_FORECAST_CACHE_STORE_NAME),
  });
  return aiForecastCacheService;
}

function invalidateAiForecastCache(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  if (!key) return false;
  aiForecastResultBySeries.delete(key);
  aiForecastCalculationCounts.delete(key);
  if (aiForecastCacheService) return aiForecastCacheService.invalidate(key);
  deleteIndexedDbRecord(TICKER_AI_FORECAST_CACHE_STORE_NAME, key).catch(() => {});
  return true;
}

function runAiForecast(options) {
  return aiForecastApp?.run?.(options) || Promise.resolve(null);
}

async function readAiAnalysisCacheForTicker(ticker) {
  try {
    await ensureAiFeatureModules();
    const stored = await readLifecycleCacheRecord(TICKER_AI_ANALYSIS_CACHE_STORE_NAME, ticker);
    if (!stored) return null;
    const normalized = aiFeature.analysis.normalizeAnalysisRecord(ticker, stored, null, Date.now());
    const issue = cacheRecordHealthModule.granularRecordIssue(stored, {
      schema: aiFeature.analysis.SCHEMA_VERSION,
      key: ticker,
      requireContent: false,
      source: "ai-analysis",
      revision: String(aiFeature.analysis.SCHEMA_VERSION),
      contentFingerprint: normalized?.contentFingerprint || "",
    });
    if (issue || !normalized) {
      await removeInvalidGranularCacheRecord(TICKER_AI_ANALYSIS_CACHE_STORE_NAME, ticker);
      return null;
    }
    return normalized;
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
  if (!aiFeature?.analysis?.isAnalysisFresh) return false;
  const savedAt = Number(analysis?.savedAt);
  return aiFeature.analysis.isAnalysisFresh(analysis, TICKER_AI_ANALYSIS_CACHE_MAX_AGE_DAYS * DAY_MS)
    && koreanDateText(new Date(savedAt)) === koreanDateText();
}

function getBrokerResearchService() {
  if (brokerResearchService) return brokerResearchService;
  if (!aiFeature?.brokerResearch || !aiFeature?.brokerParser) {
    throw new Error("Broker research feature is not loaded");
  }
  const parser = aiFeature.brokerParser;
  const revision = `${aiFeature.brokerResearch.CACHE_SCHEMA}:${parser.PARSER_REVISION}`;
  brokerResearchService = aiFeature.brokerRuntime.createBrokerResearchRuntime(globalThis, {
    cacheModule: aiFeature.brokerResearch,
    parser,
    workerModule: aiFeature.brokerWorker,
    listEndpoint: BROKER_REPORT_LIST_ENDPOINT,
    pdfEndpoint: BROKER_REPORT_PDF_ENDPOINT,
    fetchWithTimeout,
    getAsOfDate: koreanDateText,
    getHeaders: () => {
      if (IS_LOCAL_RUNTIME) return {};
      const token = getDartGatewayAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    workerUrl: new URL(
      `./modules/broker-report-worker.js?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
      document.baseURI,
    ).toString(),
    workerTimeoutMs: 30000,
    pdfModuleUrl: new URL(`./vendor/pdf.min.mjs?v=${encodeURIComponent(APP_BUILD_VERSION)}`, document.baseURI).toString(),
    pdfWorkerUrl: new URL(`./vendor/pdf.worker.min.mjs?v=${encodeURIComponent(APP_BUILD_VERSION)}`, document.baseURI).toString(),
    read: (ticker) => readLifecycleCacheRecord(TICKER_BROKER_RESEARCH_STORE_NAME, ticker),
    write: (ticker, record) => writeIndexedDbRecord(
      TICKER_BROKER_RESEARCH_STORE_NAME,
      ticker,
      cacheLifecyclePolicyModule.withCacheMetadata(record, {
        source: "broker-research",
        revision,
        asOf: record.latestDate || record.checkedDate,
        contentFingerprint: parser.reportSummaryFingerprint(record.summary),
      }),
    ),
  });
  return brokerResearchService;
}

async function requestBrokerResearchForTicker(ticker, options = {}) {
  await ensureAiFeatureModules();
  const target = String(ticker || "").trim().toUpperCase();
  if (!/^\d{6}\.(KS|KQ)$/.test(target)) return null;
  const requestKey = `broker-research:${target}`;
  const forceNetwork = options.forceNetwork === true;
  return appRequestRegistry.run(requestKey, async () => {
    brokerResearchPendingTickers.add(target);
    syncAiForecastToggleButton();
    try {
    const existingRecord = await readLifecycleCacheRecord(
      TICKER_BROKER_RESEARCH_STORE_NAME,
      target,
    ).catch(() => null);
    if (existingRecord?.summary && !brokerResearchByTicker.has(target)) {
      brokerResearchByTicker.set(
        target,
        aiFeature.brokerRuntime.toReferenceOnlySummary(existingRecord.summary, null, koreanDateText()),
      );
    }
    const record = await getBrokerResearchService().loadTicker(target, {
      asOfDate: koreanDateText(),
      forceNetwork,
      referenceOnly: true,
      listRefreshAfterDays: 1,
      existingRecord,
      onProgress: (progress, label) => {
        if (!chartSession.showAiForecast) return;
        const mapped = 12 + Math.round((Math.max(0, Math.min(100, Number(progress) || 0)) / 100) * 22);
        setAiForecastProgress(mapped, `${labelName(target)} ${label}`);
      },
      onReferenceReport: (referenceReport) => {
        if (!referenceReport?.sourceUrl) return;
        const current = brokerResearchByTicker.get(target) || existingRecord?.summary || null;
        brokerResearchByTicker.set(
          target,
          aiFeature.brokerRuntime.mergeReferenceSummary(current, referenceReport, koreanDateText()),
        );
        if (chartSession.showAiForecast) requestAiForecastRender(lastAiForecastTraceCount > 0);
      },
    });
    const currentReference = brokerResearchByTicker.get(target)?.representativeReports?.reference || null;
    const finalSummary = aiFeature.brokerRuntime.mergeReferenceSummary(
      record?.summary || null,
      currentReference,
      koreanDateText(),
    );
    brokerResearchByTicker.set(target, finalSummary);
    return finalSummary;
    } catch (_) {
      if (!brokerResearchByTicker.has(target)) brokerResearchByTicker.set(target, null);
      return brokerResearchByTicker.get(target) || null;
    } finally {
      brokerResearchPendingTickers.delete(target);
      syncAiForecastToggleButton();
      if (chartSession.showAiForecast) requestAiForecastRender(lastAiForecastTraceCount > 0);
    }
  }, {
    tag: forceNetwork ? "force" : "normal",
    afterCurrent: forceNetwork && appRequestRegistry.has(requestKey)
      && appRequestRegistry.tag(requestKey) !== "force",
  });
}

async function requestAiAnalysisForTicker(ticker, options = {}) {
  await ensureAiFeatureModules();
  const target = String(ticker || "").trim().toUpperCase();
  const forceNetwork = Boolean(options.forceNetwork);
  if (!/^\d{6}\.(KS|KQ)$/.test(target)) return null;
  const initialMemoryAnalysis = aiAnalysisByTicker.get(target) || null;
  if (!forceNetwork && aiAnalysisIsFresh(initialMemoryAnalysis)) return initialMemoryAnalysis;
  const requestKey = `ai-analysis:${target}`;
  return appRequestRegistry.run(requestKey, async () => {
    aiAnalysisPendingTickers.add(target);
    if (chartSession.showAiForecast) setAiForecastProgress(20, `${labelName(target)} 저장 분석 확인`);
    syncAiForecastToggleButton();
    const memoryAnalysis = aiAnalysisByTicker.get(target) || initialMemoryAnalysis;
    try {
    let cached = memoryAnalysis || await readAiAnalysisCacheForTicker(target);
    if (cached) {
      aiAnalysisByTicker.set(target, cached);
      if (chartSession.showAiForecast) requestAiForecastRender(lastAiForecastTraceCount > 0);
      if (!forceNetwork && aiAnalysisIsFresh(cached)) return cached;
    }
    if (!canUseDartGateway()) return cached;

    if (chartSession.showAiForecast) setAiForecastProgress(26, `${labelName(target)} 실적·컨센서스 수집`);
    const refreshQuery = forceNetwork ? "&refresh=1" : "";
    const response = await fetchWithTimeout(`${AI_ANALYSIS_ENDPOINT}?ticker=${encodeURIComponent(target)}${refreshQuery}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${getDartGatewayAccessToken()}` },
    }, 25000);
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) return null;
    const analysis = aiFeature.analysis.normalizeAnalysisRecord(target, payload, cached, Date.now());
    if (!analysis) return cached;
    aiAnalysisByTicker.set(target, analysis);
    if (chartSession.showAiForecast) setAiForecastProgress(33, `${labelName(target)} 분석 자료 저장`);
    await saveAiAnalysisCacheForTicker(target, analysis);
    return analysis;
    } catch (_) {
      return aiAnalysisByTicker.get(target) || memoryAnalysis;
    } finally {
      aiAnalysisPendingTickers.delete(target);
      syncAiForecastToggleButton();
      if (chartSession.showAiForecast) requestAiForecastRender(lastAiForecastTraceCount > 0);
    }
  }, {
    tag: forceNetwork ? "force" : "normal",
    afterCurrent: forceNetwork && appRequestRegistry.has(requestKey)
      && appRequestRegistry.tag(requestKey) !== "force",
  });
}

function aiRotationCandidatesForForecast() {
  return AI_ROTATION_LEADER_TICKERS.map((ticker) => {
    const points = aiRotationSeriesByTicker.get(ticker) || getTickerPricePointsFromPayload(ticker);
    return {
      series: ticker,
      dates: points.map((point) => point.date),
      prices: points.map((point) => point.close),
    };
  }).filter((candidate) => candidate.dates.length > 20);
}

async function loadAiRotationLeaderSeries() {
  if (aiRotationSeriesLoadSettled && aiRotationSeriesByTicker.size) {
    return aiRotationSeriesByTicker.size;
  }
  if (aiRotationSeriesPromise) return aiRotationSeriesPromise;
  aiRotationSeriesPromise = (async () => {
    for (let index = 0; index < AI_ROTATION_LEADER_TICKERS.length; index += 1) {
      const ticker = AI_ROTATION_LEADER_TICKERS[index];
      if (chartSession.showAiForecast) {
        setAiForecastProgress(28 + (index * 3), "시장 주도력 비교자료 확인");
      }
      let points = mergePriceSeries(
        getTickerPricePointsFromPayload(ticker),
        aiRotationSeriesByTicker.get(ticker),
      );
      const cached = await readTickerPriceCache(ticker);
      points = mergePriceSeries(points, cached?.points);
      if (points.length < 504) {
        try {
          const fetched = await fetchTickerHistorySeries(ticker);
          points = mergePriceSeries(points, fetched);
          if (points.length) await writeTickerPriceCache(ticker, points, labelName(ticker), {
            historyCoverage: tickerPriceRuntimeModule.HISTORY_COVERAGE_FULL,
          });
        } catch (_) {
          // The forecast remains usable with one leader or cached history.
        }
      }
      if (points.length) aiRotationSeriesByTicker.set(ticker, points);
    }
    return aiRotationSeriesByTicker.size;
  })().finally(() => {
    aiRotationSeriesPromise = null;
    aiRotationSeriesLoadSettled = true;
    syncAiForecastToggleButton();
    if (chartSession.showAiForecast) requestAiForecastRender(lastAiForecastTraceCount > 0);
  });
  syncAiForecastToggleButton();
  return aiRotationSeriesPromise;
}

async function refreshAiAnalysisForVisibleSeries(options = {}) {
  if (!chartSession.showAiForecast) return 0;
  const tickers = activeAiAnalysisTickers();
  const before = aiAnalysisByTicker.size;
  const brokerRefresh = (tickers.length
    ? mapWithConcurrency(tickers, 2, (ticker) => requestBrokerResearchForTicker(ticker, options))
    : Promise.resolve([])).catch(() => {
    // Broker reports are optional evidence. The base forecast must remain immediately usable.
    return [];
  });
  let brokerWaitTimer = 0;
  const brokerSoftWait = Promise.race([
    brokerRefresh,
    new Promise((resolve) => {
      brokerWaitTimer = setTimeout(() => resolve([]), 6000);
    }),
  ]).finally(() => clearTimeout(brokerWaitTimer));
  await Promise.all([
    tickers.length
      ? mapWithConcurrency(tickers, 2, (ticker) => requestAiAnalysisForTicker(ticker, options))
      : Promise.resolve([]),
    loadAiRotationLeaderSeries(),
    brokerSoftWait,
  ]);
  setAiForecastProgress(35, "실적·컨센서스 준비");
  return Math.max(0, aiAnalysisByTicker.size - before);
}

function getAiForecastQualityRuntime() {
  if (aiForecastQualityRuntime) return aiForecastQualityRuntime;
  const qualityRuntimeModule = aiFeature?.qualityRuntime || globalThis.ThinkStockAiForecastQualityRuntime;
  if (!qualityRuntimeModule) throw new Error("AI forecast quality runtime is not loaded");
  aiForecastQualityRuntime = qualityRuntimeModule.createAiForecastQualityRuntime(globalThis, {
    getFeature: () => aiFeature,
    readTicker: (ticker) => readLifecycleCacheRecord(
      TICKER_AI_FORECAST_JOURNAL_STORE_NAME,
      ticker,
    ),
    writeTicker: (ticker, payload) => writeIndexedDbRecord(
      TICKER_AI_FORECAST_JOURNAL_STORE_NAME,
      ticker,
      payload,
    ),
    readAll: () => readAllIndexedDbRecords(TICKER_AI_FORECAST_JOURNAL_STORE_NAME),
    isActivePayload: (payload) => cacheLifecyclePolicyModule.recordLifecycle(
      payload,
      TICKER_AI_FORECAST_JOURNAL_STORE_NAME,
    ) === "active",
    schedulePrune: () => scheduleGranularCachePrune(TICKER_AI_FORECAST_JOURNAL_STORE_NAME),
    isRemoteEnabled: canUseDartGateway,
    readRemote: async (ticker) => {
      const response = await fetchWithTimeout(
        `${AI_FORECAST_JOURNAL_ENDPOINT}?ticker=${encodeURIComponent(ticker)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${getDartGatewayAccessToken()}` },
        },
        15000,
      );
      const payload = await response.json().catch(() => null);
      return response.ok ? payload : [];
    },
    writeRemote: async (ticker, records) => {
      const response = await fetchWithTimeout(AI_FORECAST_JOURNAL_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${getDartGatewayAccessToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ticker, records }),
      }, 15000);
      return response.ok;
    },
    maxQueued: AI_FORECAST_JOURNAL_QUEUE_MAX,
  });
  return aiForecastQualityRuntime;
}

async function applyAiForecastJournalCalibration(ticker, forecast, historyRows, forecastOptions) {
  return getAiForecastQualityRuntime().calibrate(ticker, forecast, historyRows, forecastOptions);
}

function summarizeAiForecastQualityDiagnostics() {
  return aiForecastQualityRuntime?.summarizeDiagnostics?.()
    || { seriesCount: 0, statuses: {}, weakSeries: [], byContext: {}, series: {} };
}

function buildRuntimeDiagnosticAppState() {
  return {
    chartRender: chartRenderTelemetry.snapshot(),
    chartScheduler: mainChartRenderScheduler?.stats?.() || null,
    chartUpdates: chartUpdateCoordinator?.stats?.() || null,
    aiForecast: {
      cache: aiForecastCacheService?.stats?.() || null,
      quality: summarizeAiForecastQualityDiagnostics(),
      journal: aiForecastQualityRuntime?.stats?.() || null,
    },
    chartModelCache: mainChartCalcCache.stats(),
    marketTiming: marketTimingService?.stats?.().quality || null,
    runtimeSources: runtimeSourceHealthModule.summarizeSourceStates(
      runtimeDataApp.getSourceStates(),
    ),
  };
}

async function syncAiForecastJournal(ticker, forecast, historyRows) {
  return getAiForecastQualityRuntime().sync(ticker, forecast, historyRows);
}

function queueAiForecastJournalSync(ticker, forecast, historyRows) {
  return getAiForecastQualityRuntime().queue(ticker, forecast, historyRows);
}

function disclosureTargetTickers() {
  return [...new Set(customStocks
    .map((item) => String(item?.ticker || "").trim().toUpperCase())
    .filter((ticker) => /^[0-9]{6}\.(KS|KQ)$/.test(ticker)))];
}

function visibleDisclosureTargetTickers() {
  return disclosureTargetTickers().filter((ticker) => !chartSession.hiddenSeries.has(ticker));
}

async function prepareVisibleDisclosureData(msgEl) {
  const targets = visibleDisclosureTargetTickers();
  if (!targets.length) return [];
  return Promise.allSettled(targets.map((ticker) => (
    requestDartDisclosureRefreshForTicker(ticker, msgEl)
  )));
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
  if (!IS_LOCAL_RUNTIME && !accessToken) throw new Error("설정에서 Think Stock 접속 코드를 먼저 저장해 주세요.");
  const latestDate = disclosureRowsForTicker(targetTicker).at(-1)?.date || "";
  let sinceDate = latestDate;
  let page = 1;
  let collected = [];
  while (page) {
    let payload;
    try {
      payload = await runtimeGatewayClient.fetchDisclosures({
        ticker: targetTicker,
        corpCode,
        progressive: true,
        since: sinceDate,
        page,
      }, {
        forceNetwork: options?.forceNetwork,
        signal: options?.signal || null,
        timeoutMs: DART_GATEWAY_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.status === 401) {
        const authError = new Error("Think Stock 접속 코드가 만료되었거나 올바르지 않습니다. 설정에서 다시 저장해 주세요.");
        authError.status = 401;
        throw authError;
      }
      if (error?.status) throw error;
      throw new Error("ThinkStock DART 중계 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (payload?.ok === false) {
      const detail = String(payload?.error || "").trim();
      throw new Error(detail || "ThinkStock DART 중계 서버가 응답하지 않습니다.");
    }
    const batch = sanitizeDisclosureRows(payload?.records || []);
    collected = mergeDisclosureRows(collected, batch);
    await options?.onBatch?.(batch, {
      page: Number(payload?.page || page),
      totalPages: Math.max(1, Number(payload?.totalPages || 1)),
      complete: payload?.nextPage === null || payload?.complete === true,
      accumulatedCount: Number(payload?.accumulatedCount || collected.length),
      cached: payload?.cached === true,
    });
    if (payload?.checkedFrom) sinceDate = String(payload.checkedFrom).slice(0, 10);
    const nextPage = Number(payload?.nextPage || 0);
    page = Number.isInteger(nextPage) && nextPage > page ? nextPage : 0;
  }
  return collected;
}

function insiderTradeRowsForTicker(ticker) {
  const target = String(ticker || "").trim().toUpperCase();
  return sanitizeInsiderTradeRows(insiderTradeRows.filter((row) => row.ticker === target));
}

async function requestInsiderTradesForTicker(ticker, options = {}) {
  const target = String(ticker || "").trim().toUpperCase();
  if (!/^[0-9]{6}\.(KS|KQ)$/.test(target)) return [];
  if (!options.forceNetwork && insiderTradeLoadedTickers.has(target)) {
    return insiderTradeRowsForTicker(target);
  }
  const name = labelName(target);
  const progressKey = `insider:${target}`;
  const trackProgress = chartSession.showInsiderTrades && options.trackProgress !== false;
  if (trackProgress && dartRequestRuntime.has("insider", target)) {
    disclosureProgress.begin(progressKey, `${name} 내부거래`);
    disclosureProgress.update(progressKey, 0.1, `${name} 내부거래`);
  }
  const task = dartRequestRuntime.run("insider", target, async (requestSignal) => {
    if (trackProgress) disclosureProgress.begin(progressKey, `${name} 내부거래`);
    insiderTradePendingTickers.add(target);
    syncInsiderTradeToggleButton(lastInsiderTradeTraceStats.markers);
    if (trackProgress) disclosureProgress.update(progressKey, 0.12, `${name} 내부거래`);
    const stockCode = target.slice(0, 6);
    const corpCodeLoaded = await ensureDartCorpCodeMapLoaded(stockCode);
    const corpCode = String(dartCorpCodeMap.get(stockCode)?.corp_code || "");
    if (!corpCodeLoaded || !corpCode) {
      throw new Error("DART 회사코드를 찾지 못했습니다. 배포 데이터 갱신 후 다시 시도해 주세요.");
    }
    if (trackProgress) disclosureProgress.update(progressKey, 0.32, `${name} 내부거래`);
    const accessToken = getDartGatewayAccessToken();
    if (!IS_LOCAL_RUNTIME && !accessToken) throw new Error("설정에서 Think Stock 접속 코드를 먼저 저장해 주세요.");
    let payload;
    try {
      payload = await runtimeGatewayClient.fetchInsiderTrades({ ticker: target, corpCode }, {
        forceNetwork: options.forceNetwork,
        signal: requestSignal,
        timeoutMs: DART_GATEWAY_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.status === 401) {
        throw new Error("Think Stock 접속 코드가 만료되었거나 올바르지 않습니다. 설정에서 다시 저장해 주세요.");
      }
      if (error?.status) throw error;
      throw new Error("ThinkStock DART 중계 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (trackProgress) disclosureProgress.update(progressKey, 0.78, `${name} 내부거래`);
    if (payload?.ok === false) {
      throw new Error(String(payload?.error || "DART 내부거래 데이터를 가져오지 못했습니다."));
    }
    const rows = sanitizeInsiderTradeRows(payload?.records || []);
    if (trackProgress) disclosureProgress.update(progressKey, 0.92, `${name} 내부거래`);
    const merged = mergeInsiderTradeRowsWithChange(insiderTradeRows, rows);
    insiderTradeRows = merged.rows;
    insiderTradeLoadedTickers.add(target);
    if (merged.changed) queueEventMarkerRefresh("insider");
    return rows;
  }, {
    force: options.forceNetwork === true,
    signal: options.signal || null,
  }).finally(() => {
    insiderTradePendingTickers.delete(target);
    syncInsiderTradeToggleButton(lastInsiderTradeTraceStats.markers);
    if (trackProgress) disclosureProgress.complete(progressKey, `${name} 내부거래`);
  });
  return task;
}

async function refreshInsiderTradesForVisibleSeries(options = {}) {
  if (!chartSession.showInsiderTrades || !canUseDartGateway()) return 0;
  const tickers = visibleDisclosureTargetTickers();
  if (!tickers.length) return 0;
  const results = await mapWithConcurrency(
    tickers,
    DART_VISIBLE_REFRESH_CONCURRENCY,
    async (ticker) => {
      try {
        return { ticker, rows: await requestInsiderTradesForTicker(ticker, options) };
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted) throw error;
        return { ticker, rows: [], error };
      }
    },
  );
  const failures = results.filter((result) => result?.error);
  failures.forEach((result) => recordRuntimeError(`insider:${result.ticker}`, result.error));
  if (failures.length === results.length) throw failures[0].error;
  return results.reduce((count, result) => count + (result?.rows?.length || 0), 0);
}

function queueInsiderTradeRefresh() {
  if (!chartSession.showInsiderTrades || !canUseDartGateway()) {
    if (insiderTradeRefreshTimer) clearTimeout(insiderTradeRefreshTimer);
    insiderTradeRefreshTimer = 0;
    return;
  }
  const missing = visibleDisclosureTargetTickers().filter((ticker) => (
    !insiderTradeLoadedTickers.has(ticker) && !dartRequestRuntime.has("insider", ticker)
  ));
  if (!missing.length || insiderTradeRefreshTimer) return;
  insiderTradeRefreshTimer = setTimeout(() => {
    insiderTradeRefreshTimer = 0;
    refreshInsiderTradesForVisibleSeries()
      .catch(() => {});
  }, 0);
}

function syncAiForecastToggleButton(traceCount = lastAiForecastTraceCount) {
  const button = document.getElementById("aiForecastToggle");
  if (!button) return;
  const count = Number(traceCount) || 0;
  const pendingTickers = new Set([
    ...activeAiAnalysisTickers().filter((ticker) => aiAnalysisPendingTickers.has(ticker)),
    ...aiContextPendingTickers,
  ]);
  const pendingCount = pendingTickers.size + (aiRotationSeriesPromise ? 1 : 0);
  controlStateView.syncControl(button, {
    active: chartSession.showAiForecast,
    pressed: chartSession.showAiForecast,
    busy: pendingCount > 0,
    title: chartSession.showAiForecast
      ? (pendingCount > 0
        ? `종목 실적 분석 준비 중 - ${pendingCount}개`
        : (count > 0
        ? `6개월 AI 가상 흐름 켜짐 - ${count}개 종목 (상대 가중치·실제 확률 아님)`
        : "AI 분석에는 종목별로 최소 3년의 가격 이력이 필요합니다."))
      : "6개월 AI 가상 흐름 (실험 상대 가중치·투자 판단용 아님)",
  });
}

function mergeDisclosureRows(existingRows, incomingRows) {
  return disclosureDataService.mergeRows(existingRows, incomingRows);
}

function mergeDisclosureRowsIntoState(incomingRows) {
  const result = disclosureDataService.mergeRowsWithChange(disclosureRows, incomingRows);
  disclosureRows = result.rows;
  if (result.changed) markDataChanged("disclosure");
  return result;
}

function getDartDisclosureRefreshCacheEntry(ticker) {
  return disclosureDataService.getRefreshCacheEntry(ticker);
}

function rememberDartDisclosureRefresh(ticker, info) {
  disclosureDataService.rememberRefresh(ticker, info);
}

function hasFreshDartDisclosureRefresh(ticker) {
  return Boolean(disclosureDataService.getRefreshCacheEntry(ticker));
}

function disclosureRowsForTicker(ticker) {
  const target = String(ticker || "").trim().toUpperCase();
  return sanitizeDisclosureRows(disclosureRows.filter((row) => row.ticker === target));
}

async function readTickerDisclosureCache(ticker) {
  return getTickerDisclosureCache().read(ticker);
}

async function writeTickerDisclosureCache(ticker, rows) {
  return getTickerDisclosureCache().write(ticker, rows);
}

let tickerDisclosureCache = null;

function getTickerDisclosureCache() {
  if (tickerDisclosureCache) return tickerDisclosureCache;
  tickerDisclosureCache = disclosurePolicy.createTickerDisclosureCache({
    schema: TICKER_DISCLOSURE_CACHE_SCHEMA_VERSION,
    source: "ticker-disclosures",
    sanitizeRows: sanitizeDisclosureRows,
    readRecord: (ticker) => readLifecycleCacheRecord(TICKER_DISCLOSURE_CACHE_STORE_NAME, ticker),
    writeRecord: (ticker, record) => writeIndexedDbRecord(
      TICKER_DISCLOSURE_CACHE_STORE_NAME,
      ticker,
      record,
    ),
    removeInvalid: (ticker) => removeInvalidGranularCacheRecord(
      TICKER_DISCLOSURE_CACHE_STORE_NAME,
      ticker,
    ),
    recordIssue: (record, options) => cacheRecordHealthModule.granularRecordIssue(record, options),
    contentFingerprint: (rows) => cacheLifecyclePolicyModule.contentFingerprint(rows.map((row) => ({
      ticker: row.ticker,
      date: row.date,
      receiptNo: row.receiptNo,
      title: row.title,
      summary: row.summary,
    }))),
    withMetadata: (record, metadata) => cacheLifecyclePolicyModule.withCacheMetadata(record, {
      source: metadata.source,
      asOf: metadata.latestDate,
      revision: metadata.revision,
      contentFingerprint: metadata.contentFingerprint,
      now: metadata.now,
      savedAt: record.savedAt,
      touch: metadata.touch,
    }),
    shouldTouch: (lastAccessed, now) => tickerPriceRuntimeModule.shouldTouchCacheRecord(
      lastAccessed,
      now,
      DAY_MS,
    ),
    schedulePrune: () => {
      scheduleGranularCachePrune(TICKER_DISCLOSURE_CACHE_STORE_NAME).catch(() => {});
    },
  });
  return tickerDisclosureCache;
}

async function applyTickerDisclosureCache(ticker) {
  const record = await readTickerDisclosureCache(ticker);
  if (!record) return { applied: false, added: 0, latestDate: "" };
  const merged = mergeDisclosureRowsIntoState(record.rows);
  return {
    applied: true,
    added: merged.added,
    latestDate: record.latestDate || record.rows[record.rows.length - 1]?.date || "",
  };
}

function getDisclosureSeedTickers() {
  return disclosureTargetTickers();
}

async function fetchDisclosureSeedForTicker(ticker, forceNetwork = false) {
  const target = String(ticker || "").trim().toUpperCase();
  const relativePath = String(disclosureManifest?.files?.[target] || "").trim();
  if (!relativePath) return { ticker: target, added: 0, seeded: false, latestDate: "" };

  const text = await fetchSeedText(relativePath, forceNetwork);
  const payload = parsePayloadText(text);
  const rows = normalizeDisclosureSeedRows(payload?.records || [])
    .filter((row) => row.ticker === target);
  const merged = mergeDisclosureRowsIntoState(rows);
  if (rows.length) {
    await writeTickerDisclosureCache(target, disclosureRowsForTicker(target));
  }
  return {
    ticker: target,
    added: merged.added,
    seeded: true,
    latestDate: rows.at(-1)?.date || "",
  };
}

async function ensureDisclosureSeedForTicker(ticker, forceNetwork = false) {
  const target = String(ticker || "").trim().toUpperCase();
  if (!/^[0-9]{6}\.(KS|KQ)$/.test(target)) return { ticker: target, added: 0 };
  if (disclosureSeedLoadedTickers.has(target) && !forceNetwork) return { ticker: target, added: 0 };
  return dartRequestRuntime.run("disclosure-seed", target, async () => {
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
  }, { force: forceNetwork }).catch(() => ({ ticker: target, added: 0 }));
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
  const beforeCount = disclosureRows.length;
  let servedFromCache = false;
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
      onBatch: async (batch, progress) => {
        servedFromCache = servedFromCache || progress?.cached === true;
        if (batch.length) {
          mergeDisclosureRowsIntoState(batch);
        }
        await options?.onBatch?.(batch, progress);
      },
    })
    : await fetchDartDisclosuresLive(apiKey, { signal });
  throwIfAborted(signal);
  mergeDisclosureRowsIntoState(liveRows);
  const latestDate = targetTicker
    ? (disclosureRowsForTicker(targetTicker).at(-1)?.date || "")
    : (disclosureRows.at(-1)?.date || "");
  const info = {
    fetched: liveRows.length,
    added: Math.max(0, disclosureRows.length - beforeCount),
    latestDate,
    cached: servedFromCache,
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

async function refreshDartDisclosuresForVisibleTickersFromApi(apiKey, options = {}) {
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const tickers = visibleDisclosureTargetTickers();
  const uniqueTickers = [...new Set(tickers)];
  const beforeCount = disclosureRows.length;
  const incomingRows = [];
  const failed = [];
  let authFailure = false;
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
      if (result.error.status === 401) authFailure = true;
      else failed.push(`${labelName(result.ticker)}: ${result.error.message}`);
      return;
    }
    if (result.cached) {
      cached += 1;
      return;
    }
    incomingRows.push(...(result.rows || []));
  });

  mergeDisclosureRowsIntoState(incomingRows);
  uniqueTickers.forEach((ticker) => {
    writeTickerDisclosureCache(ticker, disclosureRowsForTicker(ticker)).catch(() => {});
  });

  const latestDate = disclosureRows.length ? disclosureRows[disclosureRows.length - 1].date : "";
  return {
    fetched: incomingRows.length,
    added: Math.max(0, disclosureRows.length - beforeCount),
    latestDate,
    failed: authFailure
      ? ["Think Stock 접속 코드가 올바르지 않습니다. 설정에서 다시 저장해 주세요."]
      : failed,
    cached,
  };
}

function requestDartDisclosureRefreshForTicker(ticker, msgEl) {
  const target = String(ticker || "").trim().toUpperCase();
  if (!/^[0-9]{6}\.(KS|KQ)$/.test(target)) return;
  const name = labelName(target);
  const progressKey = `disclosure:${target}`;
  const trackProgress = chartSession.showDisclosures;
  if (trackProgress) disclosureProgress.begin(progressKey, `${name} 공시`);
  const task = dartRequestRuntime.run("disclosure-refresh", target, (requestSignal) => ensureDisclosureSeedForTicker(target)
    .then(async (seedInfo) => {
      if (trackProgress) disclosureProgress.update(progressKey, 0.2, `${name} 공시`);
      if (seedInfo?.added > 0) {
        queueDisclosureTraceRefresh();
      }
      if (canUseDartGateway()) {
        const refreshOptions = {
          forceNetwork: false,
          signal: requestSignal,
          onBatch: async (_batch, progress) => {
            // Coalesce streamed pages until the current line render has finished.
            if (chartSession.currentMainChartModel?.seriesModels?.length) queueDisclosureTraceRefresh();
            if (chartSession.showAiForecast && aiContextPendingTickers.has(target)) {
              const ratio = Math.max(0, Math.min(1,
                Number(progress.page || 0) / Math.max(1, Number(progress.totalPages || 1))));
              setAiForecastProgress(20 + (ratio * 10), `${name} 최신 공시 확인`);
            }
            if (trackProgress) {
              const ratio = Math.max(0, Math.min(1,
                Number(progress.page || 0) / Math.max(1, Number(progress.totalPages || 1))));
              disclosureProgress.update(progressKey, 0.2 + (ratio * 0.75), `${name} 공시`);
            }
            const pageText = progress.cached
              ? "저장된 공시를 불러왔습니다."
              : `최신 공시 확인 중 ${progress.page}/${progress.totalPages}`;
            setMessage(msgEl, [`${name} 종목이 추가되었습니다.`, pageText]);
          },
        };
        const refreshInfo = await refreshDartDisclosuresFromApi("gateway", target, refreshOptions);
        if (refreshInfo?.added > 0 || refreshInfo?.fetched > 0) {
          queueDisclosureTraceRefresh();
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
    }), {
      signal: null,
    }).finally(() => {
      if (trackProgress) disclosureProgress.complete(progressKey, `${name} 공시`);
    });
  return task;
}

function isEventMarkerLayerEnabled(layer) {
  return layer === "insider" ? chartSession.showInsiderTrades : chartSession.showDisclosures;
}

function getChartUpdateCoordinator() {
  if (chartUpdateCoordinator) return chartUpdateCoordinator;
  chartUpdateCoordinator = chartUpdateCoordinatorModule.createChartUpdateCoordinator(globalThis, {
    eventLayers: ["disclosure", "insider"],
    requestRender: (preserveZoom, options) => (
      getMainChartRenderScheduler().request(preserveZoom, options)
    ),
    requestMarkerFrame: (options) => getChartVisualFrameCoordinator().schedule({
      markers: true,
      reason: options?.reason || "event-marker-data",
    }),
    isRendering: () => Boolean(mainChartRenderScheduler?.isRendering()),
    isEventLayerEnabled: isEventMarkerLayerEnabled,
    prepareComposition: queueAutoCompositionViewport,
    applyResetPolicy: applyChartResetPolicy,
    persistState: saveState,
  });
  return chartUpdateCoordinator;
}

function queueEventMarkerRefresh(layer) {
  return getChartUpdateCoordinator().queueEvent(layer);
}

function queueDisclosureTraceRefresh() {
  queueEventMarkerRefresh("disclosure");
}

function markEventMarkerRenderApplied(revisions) {
  return getChartUpdateCoordinator().markEventsApplied(revisions);
}

function flushQueuedEventMarkerRefresh() {
  return getChartUpdateCoordinator().flush();
}

function preloadTickerDartData(ticker, msgEl) {
  const target = String(ticker || "").trim().toUpperCase();
  const disclosureTask = requestDartDisclosureRefreshForTicker(target, msgEl);
  const disclosureReady = Promise.resolve(disclosureTask).catch(() => undefined);
  if (!canUseDartGateway()) return disclosureReady;
  // Prioritize the visible disclosure markers. The quieter insider-data request
  // begins immediately afterward, avoiding competing gateway authentication.
  disclosureReady
    .then(() => requestInsiderTradesForTicker(target))
    .catch(() => {
      // The chart remains usable when a newly added ticker has no DART trade records.
    });
  return disclosureReady;
}

function aiForecastInputsPending() {
  return Boolean(
    historicalDataLoadPromise
    || aiRotationSeriesPromise
    || aiContextPendingTickers.size
    || aiForecastDeferredSeries.size
    || activeAiAnalysisTickers().some((ticker) => aiAnalysisPendingTickers.has(ticker))
  );
}

function aiForecastContextPendingForSeries(series) {
  const key = String(series || "").toUpperCase();
  return Boolean(
    historicalDataLoadPromise
    || !aiMarketModelLoadSettled
    || aiMarketModelPromise
    || aiRotationSeriesPromise
    || aiContextPendingTickers.has(key)
    || (aiAnalysisPendingTickers.has(key) && !aiAnalysisByTicker.has(key))
  );
}

function scheduleDeferredAiForecastRender(seriesModels) {
  if (!chartSession.showAiForecast || aiForecastDeferredRenderId) return false;
  const available = new Set((seriesModels || []).map((model) => String(model?.series || "").toUpperCase()));
  const ready = [...aiForecastDeferredSeries].filter((series) => (
    aiForecastTargetSeries.has(series)
    && available.has(series)
    && !aiContextPendingTickers.has(series)
    && (!aiAnalysisPendingTickers.has(series) || aiAnalysisByTicker.has(series))
  ));
  if (!ready.length) return false;
  aiForecastDeferredRenderId = requestAnimationFrame(() => {
    aiForecastDeferredRenderId = 0;
    ready.forEach((series) => aiForecastDeferredSeries.delete(series));
    if (chartSession.showAiForecast) requestAiForecastRender(true);
  });
  return true;
}

/* Main chart */

async function applyMainChartRender(el, traces, layout, invalidation = {}) {
  const telemetryToken = chartRenderTelemetry.begin(invalidation);
  const partialCandidate = mainChartRenderer.canApplyPartialUpdate(el, traces)
    || mainChartRenderer.canReconcileTraceStructure(el, traces);
  if (partialCandidate) chartSyncing = true;
  let result;
  try {
    result = await mainChartRenderer.render(
      Plotly,
      el,
      traces,
      layout,
      PLOTLY_CONFIG,
      { invalidation },
    );
  } finally {
    if (partialCandidate) chartSyncing = false;
  }
  if (result.mode === "skipped") mainChartSkippedRenderCount += 1;
  else if (["partial", "structural"].includes(result.mode)) mainChartPartialUpdateCount += 1;
  else mainChartFullRenderCount += 1;
  chartRenderTelemetry.complete(telemetryToken, result);
  lastMainChartRenderMode = result.mode;
  return lastMainChartRenderMode;
}

function getMainChartRenderScheduler() {
  if (mainChartRenderScheduler) return mainChartRenderScheduler;
  mainChartRenderScheduler = chartRenderSchedulerModule.createChartRenderScheduler(globalThis, {
    deferDelayMs: INTERACTION_RENDER_DELAY_MS,
    isInteractionBusy: isChartInteractionBusy,
    render: async (...args) => {
      await getChartVisualFrameCoordinator().whenSettled();
      return renderChart(...args);
    },
    afterBatch: () => {
      if (!chartSession.pendingAutoChartFit) return;
      const expandOnly = chartSession.pendingAutoChartFitExpandOnly;
      chartSession.pendingAutoChartFit = false;
      chartSession.pendingAutoChartFitExpandOnly = false;
      if (chartSession.autoChartReset) fitCurrentChartRatio({ expandOnly });
    },
    afterSettled: flushQueuedEventMarkerRefresh,
    onError: (err) => {
      const msgEl = document.getElementById("messageArea");
      setMessage(msgEl, err.message || "차트 렌더링 오류", true);
    },
  });
  return mainChartRenderScheduler;
}

function requestChartRender(preserveZoom = true, options = {}) {
  return getChartUpdateCoordinator().requestRender(preserveZoom, options);
}

function requestAiForecastRender(preserveZoom = true) {
  return requestChartRender(preserveZoom, {
    deferDuringInteraction: false,
    reason: "ai-forecast",
    updateClass: "forecast",
  });
}

function renderChartWhenIdleOrNow(preserveZoom = true) {
  return getMainChartRenderScheduler().runWhenIdleOrNow(preserveZoom);
}

function runMainChartRender(preserveZoom = true) {
  return getMainChartRenderScheduler().run(preserveZoom);
}

function aiForecastHistoryRows(series) {
  const source = Array.isArray(pricePayload?.records) ? pricePayload.records : [];
  return source.filter((row) => (
    /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "").slice(0, 10))
    && Number.isFinite(toNum(row?.[series]))
    && toNum(row?.[series]) > 0
  ));
}

function getAiForecastTracesRuntime() {
  if (aiForecastTracesRuntime) return aiForecastTracesRuntime;
  const state = {
    get aiAnalysisByTicker() { return aiAnalysisByTicker; },
    get aiAnalysisPendingTickers() { return aiAnalysisPendingTickers; },
    get brokerResearchByTicker() { return brokerResearchByTicker; },
    get brokerResearchPendingTickers() { return brokerResearchPendingTickers; },
    get aiContextPendingTickers() { return aiContextPendingTickers; },
    get aiFeature() { return aiFeature; },
    get aiForecastCalculationCounts() { return aiForecastCalculationCounts; },
    get aiForecastDeferredSeries() { return aiForecastDeferredSeries; },
    get aiForecastResultBySeries() { return aiForecastResultBySeries; },
    get aiForecastTargetRevision() { return aiForecastTargetRevision; },
    get aiForecastTargetSeries() { return aiForecastTargetSeries; },
    get aiMarketModel() { return aiMarketModel; },
    get aiMarketModelLoadSettled() { return aiMarketModelLoadSettled; },
    get adrRows() { return adrRows; },
    get creditRows() { return creditRows; },
    get crisisRows() { return crisisRows; },
    get macroRows() { return macroRows; },
    set lastAiForecastTraceCount(value) { lastAiForecastTraceCount = Number(value) || 0; },
  };
  aiForecastTracesRuntime = aiForecastTracesModule.createAiForecastTraces({
    MAIN_LINE_TRACE_TYPE,
    aiForecastApp,
    aiForecastContextPendingForSeries,
    aiForecastHistoryRows,
    aiForecastInputsPending,
    aiRotationCandidatesForForecast,
    applyAiForecastJournalCalibration,
    chartSession,
    currentDate: koreanDateText,
    disclosureRowsForTicker,
    ensureAiFeatureModules,
    escapeHtml,
    formatActualValue,
    getAiForecastCacheService,
    getMacdModelForSeries,
    getStructuralProfile: (series) => (
      marketTimingService?.get(series)?.contextProfile?.structural || null
    ),
    fingerprintDatedSeries: seriesIntegrityModule.fingerprintDatedSeries,
    getPriceSourceRevision: () => dataRevisionSignature("price"),
    labelName,
    queueAiForecastJournalSync,
    resetAiForecastProgress,
    runAiForecast,
    setAiForecastProgress,
    showAiForecastUnavailable,
    startAiForecastProgress,
    state,
    syncAiForecastToggleButton,
    waitForAiProgressPaint,
  });
  return aiForecastTracesRuntime;
}

async function buildAiForecastTraces(rows, seriesModels) {
  if (!chartSession.showAiForecast) return [];
  await ensureAiFeatureModules();
  return getAiForecastTracesRuntime().build(rows, seriesModels);
}

function getMainChartEvents() {
  if (mainChartEvents) return mainChartEvents;
  const interactionState = {
    get chartSyncing() { return chartSyncing; },
    get cursorSyncing() { return cursorSyncing; },
    get hoverSyncing() { return hoverSyncing; },
    get isHandleDragging() { return isHandleDragging; },
    get suppressPlotlyClickUntil() { return suppressPlotlyClickUntil; },
    get useViewportEventMarkerGap() { return useViewportEventMarkerGap; },
    set useViewportEventMarkerGap(value) { useViewportEventMarkerGap = Boolean(value); },
  };
  mainChartEvents = mainChartEventsModule.createMainChartEvents(globalThis, {
    HANDLE_UPDATE_DEBOUNCE_MS,
    MAX_VISIBLE_MAIN_SERIES_MESSAGE,
    chartSession,
    clearAutoResetSeriesTransforms,
    clearHoverOnChart,
    configureExactDateEventHover,
    enforceMainChartSeriesLimit,
    handleAiForecastClick,
    handleDisclosureClick,
    handleTimingSignalClick,
    hideDisclosurePopover,
    interactionState,
    isTouchDevice,
    noteStockVisibilityChange,
    refreshAiForecastTargets,
    renderCoMovementPanel,
    requestChartCompositionUpdate,
    resetDisclosureHoverHighlight,
    scheduleDisclosureHoverHighlight,
    scheduleHandleUpdate,
    scheduleViewportRangeSync,
    setAiForecastTargetVisibility,
    setMainChartSeriesVisible,
    showChartNavigationMessage,
    syncHoverToChart,
    toMsSafe,
  });
  return mainChartEvents;
}

async function renderChart(preserveZoom = true, invalidation = {}) {
  const perfStartedAt = startPerfSample();
  const aiToggleRevisionAtStart = aiForecastToggleRevision;
  if (!preserveZoom) useViewportEventMarkerGap = false;
  const el = document.getElementById("chart");
  const msgEl = document.getElementById("messageArea");
  const currentYRange = el?._fullLayout?.yaxis?.range;
  const lockedYRangeForRender = !chartSession.autoChartReset
    && Array.isArray(chartSession.lockedHistoryYRange || currentYRange)
    ? [...(chartSession.lockedHistoryYRange || currentYRange)].map(Number)
    : null;
  if (!window.Plotly) {
    try {
      await ensurePlotlyReady();
    } catch (err) {
      setMessage(msgEl, err.message || "차트 엔진을 불러오지 못했습니다.", true);
      return;
    }
  }
  const renderGeneration = ++chartRenderGeneration;
  const eventMarkerRevisionsAtStart = getChartUpdateCoordinator().eventRevisions();
  const {
    allowedSeries,
    dataEnd,
    dataStart,
    displayBudget,
    end,
    frameEnd,
    frameStart,
    priceRows,
    start,
  } = prepareMainChartRenderInputs(el, preserveZoom);
  const model = await getMainChartModel(
    priceRows,
    dataStart,
    dataEnd,
    frameStart,
    frameEnd,
    allowedSeries,
    displayBudget,
  );
  if (!model || renderGeneration !== chartRenderGeneration || invalidation.shouldAbort?.()) return;
  const { rows, allSeries, selected, seriesModels } = model;
  chartSession.currentMainChartModel = model;
  captureLockedChartFrame(model);
  chartSession.currentRows = rows;
  chartSession.currentStart = frameStart;
  chartSession.currentEnd = frameEnd;
  chartSession.currentDataStart = String(rows[0]?.date || dataStart).slice(0, 10);
  chartSession.currentDataEnd = String(rows.at(-1)?.date || dataEnd).slice(0, 10);
  syncSeriesToggleBoard(allSeries);
  chartSession.currentSelected = [...selected];
  queueInsiderTradeRefresh();
  if (!chartSession.showDisclosures) hideDisclosurePopover();
  hoveredLineTraceIndex = null;
  activeLineTraceIndex = null;
  appliedLineHighlightTraceIndex = null;
  currentDisclosureHighlight = null;
  el.classList.remove("is-line-hovering", "is-line-dragging", "is-disclosure-hovering");

  if (!rows.length || !selected.length) {
    markEventMarkerRenderApplied(eventMarkerRevisionsAtStart);
    msgEl.innerHTML = '<div class="message error">표시할 데이터가 없습니다.</div>';
    return;
  }
  msgEl.innerHTML = "";

  const displayIndexes = model.displayIndexes;
  const displayPointCount = displayIndexes ? displayIndexes.length : rows.length;
  const lineTraceModel = mainChartRenderer.buildLineTraces({
    seriesModels,
    displayIndexes,
    displayPointCount,
    hiddenSeries: chartSession.hiddenSeries,
    lineTraceType: MAIN_LINE_TRACE_TYPE,
    hoverShowPopup: chartSession.hoverShowPopup,
    labelName,
    renderRevision: model.renderRevision,
    seriesColor,
  });
  const traces = lineTraceModel.traces;
  Object.assign(baseTraceValues, lineTraceModel.baseValuesBySeries);

  const [aiForecastTraces] = await Promise.all([
    buildAiForecastTraces(rows, seriesModels),
    prepareMarketTimingModels(selected, seriesModels),
  ]);
  if (renderGeneration !== chartRenderGeneration
    || aiToggleRevisionAtStart !== aiForecastToggleRevision
    || invalidation.shouldAbort?.()) return;
  traces.push(...aiForecastTraces);

  const markerArguments = [selected, seriesModels, chartSession.currentDataStart, chartSession.currentDataEnd, frameStart, frameEnd];
  const hasEventMarkerLayer = (
    chartSession.showInsiderTrades
    || chartSession.showDisclosures
    || chartSession.showRecessionSignals
  );
  const markerFrame = hasEventMarkerLayer ? createEventMarkerFrame(...markerArguments) : null;
  if (chartSession.showRecessionSignals) {
    const crisisSignalTrace = buildCrisisSignalTrace(...markerArguments, markerFrame);
    if (crisisSignalTrace) traces.push(crisisSignalTrace);
    const marketTimingBuyTrace = buildMarketTimingBuyTrace(...markerArguments, markerFrame);
    if (marketTimingBuyTrace) traces.push(marketTimingBuyTrace);
    const marketTimingSellTrace = buildMarketTimingSellTrace(...markerArguments, markerFrame);
    if (marketTimingSellTrace) traces.push(marketTimingSellTrace);
  } else {
    lastRecessionSignalCount = 0;
    lastMarketTimingBuyCount = 0;
    lastMarketTimingSellCount = 0;
  }
  syncRecessionToggleButton();

  if (!chartSession.showInsiderTrades) {
    lastInsiderTradeTraceStats = { total: insiderTradeRows.length, candidates: 0, markers: 0 };
  }
  const insiderTraces = chartSession.showInsiderTrades
    ? buildInsiderTradeTraces(...markerArguments, markerFrame)
    : [];
  traces.push(...insiderTraces);
  syncInsiderTradeToggleButton(lastInsiderTradeTraceStats.markers);

  if (!chartSession.showDisclosures) {
    lastDisclosureTraceStats = { total: disclosureRows.length, candidates: 0, markers: 0 };
  }
  const disclosureTrace = chartSession.showDisclosures
    ? buildDisclosureTrace(...markerArguments, markerFrame)
    : null;
  if (disclosureTrace) traces.push(disclosureTrace);
  syncDisclosureToggleButton(lastDisclosureTraceStats.markers);
  const nextVisibleDataRange = visibleLineDataRangeMs(traces);

  const viewportPlan = chartViewportControllerModule.buildRenderViewportPlan({
    preserveZoom,
    autoChartReset: chartSession.autoChartReset,
    pinnedXRange: chartSession.pinnedXRange,
    userViewportPinned: chartSession.userViewportPinned,
    currentXRange: el._fullLayout?.xaxis?.range,
    currentYRange: el._fullLayout?.yaxis?.range,
    lockedYRange: lockedYRangeForRender,
    pendingCompositionViewport: chartSession.pendingCompositionViewport,
    nextVisibleDataRange,
    restoreAiForecastViewport: restoreAiForecastViewportOnNextRender,
    showAiForecast: chartSession.showAiForecast,
    aiForecastTraces,
    revealAiForecastRange: revealAiForecastRangeOnNextRender,
    trimAiForecastRange: trimAiForecastRangeOnNextRender,
    observedStart: start,
    observedEnd: end,
    rightPaddingMs: chartRightPaddingMs(),
    toMilliseconds: toMsSafe,
  });
  chartSession.pinnedXRange = viewportPlan.pinnedXRange;
  chartSession.userViewportPinned = viewportPlan.userViewportPinned;
  chartSession.pendingCompositionViewport = viewportPlan.pendingCompositionViewport;
  restoreAiForecastViewportOnNextRender = viewportPlan.restoreAiForecastViewport;
  revealAiForecastRangeOnNextRender = viewportPlan.revealAiForecastRange;
  trimAiForecastRangeOnNextRender = viewportPlan.trimAiForecastRange;
  const {
    defaultXRange,
    forecastEnd,
    savedXRange,
    savedYRange,
  } = viewportPlan;
  const fittedDefaultYRange = savedYRange ? null : fitRangeForTraces(
    traces.filter((trace) => Number.isFinite(trace?.meta?.sourcePointCount)),
    defaultXRange,
    { paddingRatio: 0.08, minimumPadding: 0.6 },
  );
  const longRangeTicks = mainChartRenderer.buildLongRangeTicks({
    start,
    end: forecastEnd,
    xRange: savedXRange,
    dayMs: DAY_MS,
    toMs: toMsSafe,
  });

  clearDisclosureHoverTimer();
  currentDisclosureHighlight = null;
  hoveredLineTraceIndex = null;
  activeLineTraceIndex = null;
  appliedLineHighlightTraceIndex = null;
  const layout = mainChartRenderer.buildLayout({
    horizontalMargin: mainChartHorizontalMargin(),
    hoverShowPopup: chartSession.hoverShowPopup,
    cursorLineMode: chartSession.cursorLineMode,
    hoverlabel: plotlyHoverLabel(),
    xRange: savedXRange,
    defaultXRange,
    yRange: savedYRange,
    fittedYRange: fittedDefaultYRange,
    longRangeTicks,
  });
  if (invalidation.shouldAbort?.()) return;
  const renderMode = await applyMainChartRender(el, traces, layout, invalidation);
  const renderedFrameRange = getCurrentXRangeMs(el);
  if (renderedFrameRange) {
    chartSession.currentStart = new Date(renderedFrameRange[0]).toISOString().slice(0, 10);
    chartSession.currentEnd = new Date(renderedFrameRange[1]).toISOString().slice(0, 10);
  }
  renderCoMovementPanel();
  markEventMarkerRenderApplied(eventMarkerRevisionsAtStart);
  if (chartSession.autoChartReset && aiForecastTraces.length && tracesExceedVisibleYRange(
    aiForecastTraces,
    el?._fullLayout?.xaxis?.range,
    el?._fullLayout?.yaxis?.range,
  )) {
    // AI context often completes after the initial composition fit has already been consumed.
    chartSession.pendingAutoChartFit = true;
    chartSession.pendingAutoChartFitExpandOnly = false;
  }
  scheduleDeferredAiForecastRender(seriesModels);
  if (aiToggleRevisionAtStart !== aiForecastToggleRevision) {
    requestChartRender(true, { deferDuringInteraction: false });
    return;
  }
  if (!chartSession.autoChartReset && !chartSession.lockedHistoryYRange) captureLockedHistoryYRange();

  getMainChartEvents().bind(el);

  const mainRangeForAdr = el._fullLayout?.xaxis?.range?.slice() || (savedXRange ? [...savedXRange] : null);
  if (!invalidation.shouldAbort?.() && chartUpdateCoordinatorModule.shouldUpdateAuxiliary(invalidation)) {
    await Promise.allSettled([
      renderMacdChart(mainRangeForAdr ? [...mainRangeForAdr] : null),
      renderAdrChart(mainRangeForAdr ? [...mainRangeForAdr] : null),
    ]);
  }
  bindCursorMoveSync();
  scheduleHandleUpdate(0);
  recordPerfSample("renderChart", perfStartedAt, {
    rows: rows.length,
    displayRows: displayPointCount,
    series: selected.length,
    disclosures: lastDisclosureTraceStats.markers,
    cacheHit: lastMainChartModelCacheHit,
    modelSource: lastMainChartModelSource,
    renderMode,
  });
  const aiInputsReady = aiMarketModelLoadSettled
    && !aiForecastInputsPending();
  if (chartSession.showAiForecast && aiInputsReady) finishAiForecastProgress();
}

function getMacdModelForSeries(series) {
  const ticker = String(series || "").toUpperCase();
  if (!MACD_STOCK_PATTERN.test(ticker)) return null;
  const records = Array.isArray(pricePayload?.records) ? pricePayload.records : [];
  const cacheKey = [
    ticker,
    seriesIntegrityModule.fingerprintDatedSeries(
      records,
      [ticker],
      { tail: 520, logicVersion: "macd-v2" },
    ),
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

function getAuxiliaryChartRuntime() {
  if (auxiliaryChartRuntime) return auxiliaryChartRuntime;
  const dataState = {
    get pricePayload() { return pricePayload; },
    get adrRows() { return adrRows; },
    get macroRows() { return macroRows; },
  };
  const syncState = {
    get chartSyncing() { return chartSyncing; },
    set chartSyncing(value) { chartSyncing = Boolean(value); },
    get hoverSyncing() { return hoverSyncing; },
    get cursorSyncing() { return cursorSyncing; },
  };
  auxiliaryChartRuntime = auxiliaryChartRuntimeModule.createAuxiliaryChartRuntime(globalThis, {
    ADR_HIGH_THRESH,
    ADR_LOW_THRESH,
    ADR_BAND_COLOR,
    ADR_ZONE_HIGH_COLOR,
    ADR_ZONE_LOW_COLOR,
    AUXILIARY_PANEL_KEYS,
    AUXILIARY_SERIES_KEYS,
    FEAR_GREED_HIGH_THRESH,
    FEAR_GREED_LOW_THRESH,
    MACD_STOCK_PATTERN,
    NEWS_SENTIMENT_HIGH_THRESH,
    NEWS_SENTIMENT_LOW_THRESH,
    PLOTLY_CONFIG,
    SERIES_COLORS,
    addViewportYRangeToRelayout,
    auxiliaryChartHorizontalMargin,
    buildAdrZoneTraces,
    buildCursorHoverMode,
    buildCursorLineAxisLayout,
    buildThresholdEnvelopeSeries,
    buildThresholdZoneFillTraces,
    buildAuxiliaryPanelLayout,
    buildAuxiliaryViewportRanges,
    buildMacdViewportYRange,
    chartSession,
    clearHoverOnChart,
    dataRevisionSignature,
    dataState,
    findEarliestAuxiliaryDate,
    findLatestAuxiliaryDate,
    getAuxiliaryChartModel,
    getAuxiliaryChartModelSource: () => lastAuxiliaryChartModelSource,
    getMacdModelForSeries,
    isTouchDevice,
    labelName,
    plotlyHoverLabel,
    persistState: saveState,
    recordPerfSample,
    scheduleViewportRangeSync,
    setNewsSentimentMovingAverageDays,
    seriesColor,
    startPerfSample,
    syncHoverToChart,
    syncState,
    thinMacdPoints,
    xRangeMatches,
  });
  return auxiliaryChartRuntime;
}

function invalidateAdrChartRender() {
  auxiliaryChartRuntime?.invalidateAdr();
}

function renderMacdChart(xRange) {
  return getAuxiliaryChartRuntime().renderMacdChart(xRange);
}

function buildThresholdZoneFillTraces(dates, values, legendName, seriesKey = "", options = {}) {
  const sourceValues = (Array.isArray(values) ? values : []).map((value) => (
    value !== null && Number.isFinite(Number(value)) ? Number(value) : null
  ));
  const base = {
    type: "scatter",
    mode: "lines",
    connectgaps: false,
    visible: seriesKey && chartSession.hiddenAuxiliarySeries.has(seriesKey) ? "legendonly" : true,
  };
  const noHover = { hoverinfo: "skip", hovertemplate: undefined };
  const lowThreshold = Number(options.lowThreshold ?? ADR_LOW_THRESH);
  const highThreshold = Number(options.highThreshold ?? ADR_HIGH_THRESH);
  const zoneGroup = String(options.zoneGroup || seriesKey || "");
  const lowTraces = options.includeLow === false ? []
    : buildThresholdFillPolygons(dates, sourceValues, lowThreshold, "low").map((polygon) => ({
      ...base,
      x: polygon.dates,
      y: polygon.values,
      name: legendName,
      meta: {
        ...(seriesKey ? { auxiliarySeriesKey: seriesKey } : {}),
        auxiliaryZoneGroup: zoneGroup,
        auxiliaryZoneFill: "low",
      },
      showlegend: false,
      line: { color: "transparent", width: 0 },
      fill: "toself",
      fillcolor: AUXILIARY_ZONE_LOW_FILL_COLOR,
      ...noHover,
    }));
  const highTraces = options.includeHigh === false ? []
    : buildThresholdFillPolygons(dates, sourceValues, highThreshold, "high").map((polygon) => ({
      ...base,
      x: polygon.dates,
      y: polygon.values,
      name: legendName,
      meta: {
        ...(seriesKey ? { auxiliarySeriesKey: seriesKey } : {}),
        auxiliaryZoneGroup: zoneGroup,
        auxiliaryZoneFill: "high",
      },
      showlegend: false,
      line: { color: "transparent", width: 0 },
      fill: "toself",
      fillcolor: AUXILIARY_ZONE_HIGH_FILL_COLOR,
      ...noHover,
    }));
  return [...lowTraces, ...highTraces];
}

function buildAdrZoneTraces(dates, values, mainColor, legendName, seriesKey, options = {}) {
  const sourceValues = (Array.isArray(values) ? values : []).map((value) => (
    value !== null && Number.isFinite(Number(value)) ? Number(value) : null
  ));
  const base = {
    x: dates,
    type: "scatter",
    mode: "lines",
    connectgaps: false,
    meta: { auxiliarySeriesKey: seriesKey },
    visible: chartSession.hiddenAuxiliarySeries.has(seriesKey) ? "legendonly" : true,
  };
  const noHover = { hoverinfo: "skip", hovertemplate: undefined };
  const fillTraces = options.includeFill === false
    ? []
    : buildThresholdZoneFillTraces(dates, sourceValues, legendName, seriesKey, options);

  return [
    ...fillTraces,
    { ...base, y: sourceValues, name: legendName, showlegend: false,
      line: { color: mainColor, width: 2 }, ...noHover },
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

function findEarliestAuxiliaryDate(rows, key = "") {
  for (let index = 0; index < (rows?.length || 0); index += 1) {
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
    newsMovingAverageDays: chartSession.newsSentimentMovingAverageDays,
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

function renderAdrChart(xRange) {
  return getAuxiliaryChartRuntime().renderAdrChart(xRange);
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
function runtimePoliciesFor(keys) {
  return runtimeSeriesQualityGateModule.policiesFor(keys);
}

function validateRuntimeSeriesCandidate(label, currentRows, candidateRows, incomingRows, keys, options = {}) {
  return runtimeSeriesQualityGateModule.assertRows({
    label,
    currentRows,
    candidateRows,
    incomingRows,
    keys,
    policies: runtimePoliciesFor(keys),
    ...options,
  });
}

function getRuntimeSeriesController() {
  if (runtimeSeriesController) return runtimeSeriesController;
  runtimeSeriesController = runtimeSeriesMergeModule.createRuntimeSeriesController({
    creditKeys: CREDIT_COLS,
    buildDenseMacroRows,
    getPriceDates: () => (pricePayload?.records || []).map((row) => row?.date).filter(Boolean),
    getRows: (name) => ({ macro: macroRows, credit: creditRows, crisis: crisisRows, adr: adrRows }[name]),
    setRows: (name, rows) => {
      if (name === "macro") macroRows = rows;
      else if (name === "credit") creditRows = rows;
      else if (name === "crisis") crisisRows = rows;
      else if (name === "adr") adrRows = rows;
    },
    markChanged: markDataChanged,
    policiesFor: runtimePoliciesFor,
    validate: validateRuntimeSeriesCandidate,
  });
  return runtimeSeriesController;
}

const applyNewsSentimentLiveRows = (...args) => (
  getRuntimeSeriesController().applyNewsSentimentLiveRows(...args)
);

let runtimeMarketRefresh = null;
function getRuntimeMarketRefresh() {
  if (runtimeMarketRefresh) return runtimeMarketRefresh;
  runtimeMarketRefresh = runtimeMarketRefreshModule.createRuntimeMarketRefresh({
    gateway: runtimeGatewayClient,
    timeoutMs: DART_GATEWAY_REQUEST_TIMEOUT_MS,
    isLocal: IS_LOCAL_RUNTIME,
    canUseGateway: canUseDartGateway,
    creditKeys: CREDIT_COLS,
    vkospiSeries: VKOSPI_SERIES,
    vixSeries: VIX_SERIES,
    getPricePayload: () => pricePayload,
    getCreditRows: () => creditRows,
    getSeriesController: getRuntimeSeriesController,
    policiesFor: runtimePoliciesFor,
  });
  return runtimeMarketRefresh;
}

const applyVkospiLiveRows = (...args) => getRuntimeMarketRefresh().applyVkospiRows(...args);
const applyVixLiveRows = (...args) => getRuntimeMarketRefresh().applyVixRows(...args);
const refreshEcosMacroFromGateway = (...args) => getRuntimeMarketRefresh().refreshMacro(...args);
const refreshCreditFromGateway = (...args) => getRuntimeMarketRefresh().refreshCredit(...args);
const refreshCrisisSignalFromGateway = (...args) => getRuntimeMarketRefresh().refreshCrisis(...args);

function refreshSourceWithRetry(kind, task, signal = null) {
  return runtimeFreshnessPolicyModule.executeRuntimeSourcePlan(kind, {
    primary: () => task(),
  }, {
    signal,
    isRetryable: runtimeRefreshModule.isRetryableRuntimeError,
  }).then((result) => result.value);
}
function applyAdrLiveRows(incomingRows) {
  const result = adrDataModule.mergeAdrLiveRows(adrRows, incomingRows);
  if (result.changed) {
    const validation = validateRuntimeSeriesCandidate(
      "ADR",
      adrRows,
      result.rows,
      incomingRows,
      ADR_SERIES,
    );
    adrRows = validation.rows || result.rows;
    markDataChanged("adr");
  }
  return result;
}

function latestAdrBenchmarkDate() {
  return ["^KS11", "^KQ11"]
    .map((ticker) => getLatestTickerDateFromPricePayload(ticker))
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function isAdrSourceDelayed(sourceLatestDate, upstreamDelayed = false) {
  const benchmarkDate = latestAdrBenchmarkDate();
  if (benchmarkDate) return !sourceLatestDate || sourceLatestDate < benchmarkDate;
  return upstreamDelayed;
}

async function fetchAdrJsonEndpoint(endpoint, signal, headers = {}) {
  const response = await fetchWithTimeout(endpoint, {
    cache: "no-store",
    headers,
    signal,
  }, DART_GATEWAY_REQUEST_TIMEOUT_MS);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload.rows)) {
    if (response.status === 401) clearInvalidDartGatewayAccessToken();
    throw new Error(payload?.error || `ADR HTTP ${response.status}`);
  }
  throwIfAborted(signal);
  const sourceLatestDate = String(payload.latestDate || payload.rows.at(-1)?.date || "").slice(0, 10);
  return {
    ...applyAdrLiveRows(payload.rows),
    sourceLatestDate,
    stale: payload.stale === true,
    delayed: isAdrSourceDelayed(sourceLatestDate, payload.delayed === true),
  };
}

async function refreshAdrFromWeb(signal = null, forceNetwork = false) {
  let endpointError = null;
  const endpoint = IS_LOCAL_RUNTIME
    ? appendCacheBust(`./api/adr${forceNetwork ? "?refresh=1" : ""}`)
    : (canUseDartGateway()
      ? `${ADR_GATEWAY_ENDPOINT}${forceNetwork ? "?refresh=1" : ""}`
      : "");
  if (endpoint) {
    try {
      const result = await fetchAdrJsonEndpoint(
        endpoint,
        signal,
        IS_LOCAL_RUNTIME ? {} : { Authorization: `Bearer ${getDartGatewayAccessToken()}` },
      );
      if (!result.stale && !result.delayed) return result;
      endpointError = new Error(result.delayed
        ? `ADR 최신 날짜 지연(${result.sourceLatestDate || "없음"})`
        : "ADR Worker returned cached stale data");
      endpointError.retryable = true;
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      endpointError = error;
    }
  }

  try {
    const sourceUrl = appendCacheBust(ADR_SOURCE_URL);
    const proxyUrl = CORS_PROXY + encodeURIComponent(sourceUrl);
    const response = await fetchWithTimeout(proxyUrl, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`adrinfo.kr 응답 오류: ${response.status}`);
    const rows = adrDataModule.parseAdrChartRows(await response.text());
    if (!rows.length) throw new Error("ADR data parse failed. Source format may have changed.");
    throwIfAborted(signal);
    const result = applyAdrLiveRows(rows);
    const sourceLatestDate = rows.at(-1)?.date || "";
    if (isAdrSourceDelayed(sourceLatestDate)) {
      const delayedError = new Error(`ADR 최신 날짜 지연(${sourceLatestDate || "없음"})`);
      delayedError.retryable = true;
      throw delayedError;
    }
    return { ...result, sourceLatestDate, delayed: false, stale: false };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    const combined = new Error([endpointError?.message, error?.message].filter(Boolean).join(" / "));
    combined.retryable = true;
    throw combined;
  }
}

function isRetryableAdrRefreshError(error) {
  const message = String(error?.message || error || "");
  return error?.retryable === true
    || /\b(?:403|408|425|429|500|502|503|504)\b|failed to fetch|fetch failed|network|timed?\s*out|timeout/i.test(message);
}

function refreshAdrFromWebWithRetry(signal = null, forceNetwork = false) {
  return retryOnce(
    () => refreshAdrFromWeb(signal, forceNetwork),
    {
      delayMs: ADR_RETRY_DELAY_MS,
      signal,
      shouldRetry: (error) => !isAbortError(error) && isRetryableAdrRefreshError(error),
    },
  );
}

function cancelAdrFinalRetry() {
  if (!adrFinalRetryController) return;
  const reason = new Error("Superseded by a newer ADR refresh");
  reason.name = "AbortError";
  adrFinalRetryController.abort(reason);
  adrFinalRetryController = null;
}

function scheduleAdrFinalRetry(forceNetwork = false) {
  cancelAdrFinalRetry();
  const controller = new AbortController();
  adrFinalRetryController = controller;

  void (async () => {
    try {
      await waitForDelay(ADR_FINAL_RETRY_DELAY_MS, controller.signal);
      const revisionsBefore = getDataRevisions();
      const { changed, latestDate } = await refreshAdrFromWeb(controller.signal, forceNetwork);
      if (adrFinalRetryController !== controller || controller.signal.aborted) return;
      await applyRuntimeRefreshChanges(revisionsBefore, { awaitMainRender: false });
      renderDataFreshness();
      scheduleLastRuntimeSnapshotSave(1200);
      setRuntimeRefreshStatus(
        "ready",
        changed > 0 ? `ADR ${changed}건 백그라운드 반영(~ ${latestDate})` : "ADR 최신값 확인 완료",
      );
    } catch (error) {
      if (adrFinalRetryController !== controller || isAbortError(error) || controller.signal.aborted) return;
      setRuntimeRefreshStatus("ready", "ADR 연결 지연 · 저장된 값 유지");
    } finally {
      if (adrFinalRetryController === controller) adrFinalRetryController = null;
    }
  })();
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
    vkospiRows: parseMacroPayload(texts.vkospiText),
    disclosurePayload,
    disclosureRows: normalizeDisclosureSeedRows(disclosurePayload?.records || []),
  };
}

async function refreshFearGreedFromWeb(signal = null) {
  const payload = await fetchJsonWithProxyFallback(
    appendCacheBust(IS_LOCAL_RUNTIME ? "./api/fear-greed" : FEAR_GREED_LIVE_URL),
    { signal },
    { allowProxy: false },
  );
  throwIfAborted(signal);
  const liveRows = marketDataModule.normalizeFearGreedRows(payload);
  if (!liveRows.length) {
    throw new Error("공포탐욕 응답 형식이 올바르지 않습니다.");
  }
  const result = runtimeSeriesMergeModule.mergeDatedSeries({
    sourceRows: adrRows,
    incomingRows: liveRows,
    keys: FEAR_GREED_SERIES,
    policies: runtimePoliciesFor(FEAR_GREED_SERIES),
  });
  if (result.updated) {
    const validation = validateRuntimeSeriesCandidate(
      "fear greed",
      adrRows,
      result.rows,
      liveRows,
      FEAR_GREED_SERIES,
    );
    adrRows = validation.rows || result.rows;
    markDataChanged("adr");
  }
  return { added: result.updated, latestDate: result.latestDate };
}

async function loadData(forceNetwork = false, options = {}) {
  const mergeWithExisting = Boolean(options?.mergeWithExisting);
  const preserveExisting = Boolean(options?.preserveExisting);
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
  const [priceSeed, macroSeed, creditSeed, adrSeed, vkospiText, disclosureText] = await Promise.all([
    fetchSegmentedSeedText("./data/prices.json", segment, forceNetwork),
    fetchSegmentedSeedText("./data/macro_data.json", segment, forceNetwork),
    fetchSegmentedSeedText("./data/credit_data.json", segment, forceNetwork),
    fetchSegmentedSeedText("./data/adr_data.json", segment, forceNetwork),
    fetchSeedText("./data/vkospi_data.json", forceNetwork),
    includeDisclosures ? fetchSeedText("./data/disclosures.json", forceNetwork) : Promise.resolve(null),
  ]);
  const coreSeeds = [priceSeed, macroSeed, creditSeed, adrSeed];
  const allCoreSeedsLoaded = coreSeeds.every((seed) => Boolean(seed.text));
  const allUsedFullFallback = coreSeeds.every((seed) => seed.usedFullFallback);
  const priceText = priceSeed.text;
  const macroText = macroSeed.text;
  const creditText = creditSeed.text;
  const adrText = adrSeed.text;

  const parsed = await seedBundleParser.parse({
    priceText,
    macroText,
    creditText,
    adrText,
    vkospiText,
    disclosureText,
  });
  if (parsed.pricePayload?.records?.length) {
    pricePayload = mergeWithExisting
      ? (preserveExisting
        ? mergePricePayloadPreservingExisting(pricePayload, parsed.pricePayload)
        : mergePricePayloadPreferIncoming(pricePayload, parsed.pricePayload))
      : parsed.pricePayload;
    Object.assign(DISPLAY_NAMES, pricePayload.display_names || {});
    markDataChanged("price");
  }

  if (parsed.macroRows?.length) {
    macroRows = mergeWithExisting
      ? (preserveExisting
        ? mergeRowsPreservingExisting(macroRows, parsed.macroRows)
        : mergeRowsPreferIncoming(macroRows, parsed.macroRows))
      : parsed.macroRows;
    markDataChanged("macro");
  }

  if (parsed.creditRows?.length) {
    creditRows = mergeWithExisting
      ? normalizeCreditRows((preserveExisting ? mergeRowsPreservingExisting : mergeRowsPreferIncoming)(
        creditRows,
        parsed.creditRows,
      ))
      : normalizeCreditRows(parsed.creditRows);
    markDataChanged("credit");
  }

  if (parsed.adrRows?.length) {
    adrRows = mergeWithExisting
      ? (preserveExisting
        ? mergeRowsPreservingExisting(adrRows, parsed.adrRows)
        : mergeRowsPreferIncoming(adrRows, parsed.adrRows))
      : parsed.adrRows;
    markDataChanged("adr");
  }

  if (parsed.vkospiRows?.length) {
    adrRows = preserveExisting
      ? mergeRowsPreservingExisting(adrRows, parsed.vkospiRows)
      : mergeRowsPreferIncoming(adrRows, parsed.vkospiRows);
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
    || parsed.vkospiRows?.length
  );
  if (loadedAny && ((segment === "history" && allCoreSeedsLoaded) || allUsedFullFallback)) {
    historicalDataLoaded = hasHistoricalDataCoverage();
  }
  return { segment, loadedAny, historicalDataLoaded, usedFullFallback: allUsedFullFallback };
}

async function ensureHistoricalDataLoaded(forceNetwork = false) {
  if (historicalDataLoaded && hasHistoricalDataCoverage()) return true;
  historicalDataLoaded = false;
  if (historicalDataLoadPromise) return historicalDataLoadPromise;

  historicalDataLoadPromise = loadData(forceNetwork, {
    mergeWithExisting: true,
    preserveExisting: true,
    segment: "history",
    includeDisclosures: false,
  }).then((result) => {
    if (!result.loadedAny || !result.historicalDataLoaded) {
      throw new Error("과거 데이터 묶음을 불러오지 못했습니다.");
    }
    mainChartCalcCache.clear();
    invalidateAdrChartRender();
    return true;
  }).finally(() => {
    historicalDataLoadPromise = null;
  });

  return historicalDataLoadPromise;
}

function scheduleHistoricalDataPreload() {
  if (IS_E2E_RUNTIME) return;
  const preload = () => {
    if (historicalDataLoaded && hasHistoricalDataCoverage()) return;
    // Extend the draggable timeline without changing the visible period or chart frame.
    ensureHistoricalDataLoaded(false)
      .then(() => {
        const visibleRange = getCurrentXRangeMs(document.getElementById("chart"));
        if (visibleRange) chartSession.pinnedXRange = visibleRange.map((value) => new Date(value).toISOString());
        requestChartRender(true, { deferDuringInteraction: true });
      })
      .catch((error) => {
        recordRuntimeError("historical-data-preload", error);
      });
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(preload, { timeout: 5000 });
  } else {
    setTimeout(preload, 2500);
  }
}

function prepareHistoricalDataForAiForecast() {
  if (historicalDataLoaded && hasHistoricalDataCoverage()) return Promise.resolve(true);
  const lockedViewportRange = !chartSession.autoChartReset ? getCurrentMainXRange() : null;
  setAiForecastProgress(8, "전체 과거 학습 데이터 준비");
  return ensureHistoricalDataLoaded(false)
    .catch(() => false)
    .finally(() => {
      // Loading AI training history must not replace a viewport the user explicitly locked.
      if (!chartSession.autoChartReset && lockedViewportRange) chartSession.pinnedXRange = [...lockedViewportRange];
      if (chartSession.showAiForecast) requestChartRender(!chartSession.autoChartReset, { deferDuringInteraction: false });
    });
}

async function applyRuntimeRefreshChanges(revisionsBefore, options = {}) {
  const revisionsAfter = getDataRevisions();
  const {
    mainDataChanged,
    adrDataChanged,
    disclosureDataChanged,
    renderAuxiliaryOnly,
    renderDisclosureOnly,
  } = runtimeRefreshOrchestratorModule.planRuntimeRefreshRendering(
    revisionsBefore,
    revisionsAfter,
  );
  if (adrDataChanged) invalidateAdrChartRender();
  if (mainDataChanged) {
    if (chartSession.autoChartReset) {
      chartSession.pendingAutoChartFit = true;
      chartSession.pendingAutoChartFitExpandOnly = false;
    }
    if (options.awaitMainRender) await runMainChartRender(false);
    else renderChartWhenIdleOrNow(false);
  }
  if (renderAuxiliaryOnly) {
    const mainEl = document.getElementById("chart");
    renderAdrChart(mainEl?._fullLayout?.xaxis?.range?.slice() || null);
  }
  if (renderDisclosureOnly) queueDisclosureTraceRefresh();
  return { revisionsAfter, mainDataChanged, adrDataChanged, disclosureDataChanged };
}

function getRuntimeRefreshOrchestrator() {
  if (runtimeRefreshOrchestrator) return runtimeRefreshOrchestrator;
  const state = {
    get disclosureRows() { return disclosureRows; },
    get lastDisclosureTraceStats() { return lastDisclosureTraceStats; },
  };
  runtimeRefreshOrchestrator = runtimeRefreshOrchestratorModule.createRuntimeRefreshOrchestrator({
    applyRuntimeRefreshChanges,
    canUseDartGateway,
    cancelAdrFinalRetry,
    chartSession,
    getDataRevisions,
    isAbortError,
    isRetryableAdrRefreshError,
    preloadCustomStocks,
    recordPerfSample,
    refreshAdrFromWebWithRetry,
    refreshCoreIndexSeries,
    refreshCreditFromGateway,
    refreshCrisisSignalFromGateway,
    refreshDartDisclosuresForVisibleTickersFromApi,
    refreshEcosMacroFromGateway,
    refreshFearGreedFromWeb,
    fetchCriticalRuntimeBootstrap,
    refreshSourceWithRetry,
    runRefreshPhases,
    runtimeDataApp,
    scheduleAdrFinalRetry,
    scheduleLastRuntimeSnapshotSave,
    setMessage,
    setRuntimeRefreshStatus,
    startPerfSample,
    state,
    throwIfAborted,
  });
  return runtimeRefreshOrchestrator;
}

function runRuntimeDataRefresh(msgEl, options = {}) {
  return getRuntimeRefreshOrchestrator().run(msgEl, options);
}

async function refreshRuntimeData(msgEl, options = {}) {
  return runtimeDataApp.refresh(msgEl, options);
}

function waitForFirstPaint() {
  return runtimeDataApp.waitForFirstPaint();
}

async function boot() {
  const startupPerfStartedAt = startPerfSample();
  const msgEl = document.getElementById("messageArea");
  scheduleServiceWorkerRegistration();
  showStartupLoader();
  setStartupLoaderProgress(4, "Preparing");
  initPerfDebugAccess();
  initE2eDebugAccess();
  cacheMigrator.run();
  loadAdminAccessState();
  loadState();
  appUiBindingsModule.bindChartToolsToggle({
    button: document.getElementById("chartToolsToggle"),
    container: document.querySelector(".main-chart-wrap"),
    getEnabled: () => chartSession.showChartTools,
    setEnabled: (value) => { chartSession.showChartTools = value; },
    saveState,
  });
  enforceMainChartSeriesLimit();
  enforceGeneralModeState();
  renderCustomStockButtons();
  setupStockAddPanel(msgEl);
  setupStockResearch(msgEl);
  setupApiSettingsPanel(msgEl);
  scheduleApiPeriodReminderLoad();
  syncApiOptionsButton();
  renderAppVersionLabel();
  syncChartResetToggleButton();
  syncChartHandlesToggleButton();
  syncCursorLineModeControls();
  syncNewsSentimentMovingAverageControls();
  syncRecessionToggleButton();
  syncCoMovementToggleButton();
  syncAiForecastToggleButton();
  syncDisclosureToggleButton();
  syncInsiderTradeToggleButton(0);
  syncAdminFeatureAccess();
  bindRuntimeSnapshotExitSave();
  scheduleGranularCacheCleanup();
  setStartupLoaderProgress(10, "Preparing");
  const plotlyReadyTask = ensurePlotlyReady()
    .then((plotly) => ({ plotly, error: null }))
    .catch((error) => ({ plotly: null, error }));
  try {
    const restoredLastSnapshot = await runtimeDataApp.prepareInitialData({
      restoreSnapshot: loadLastRuntimeSnapshot,
      loadSeed: () => loadData(true),
      needsHistorical: () => chartSession.activeMonths > RECENT_DATA_MONTHS && !historicalDataLoaded,
      loadHistorical: () => ensureHistoricalDataLoaded(true),
      onHistoricalError: () => {
        chartSession.activeMonths = getDefaultActiveMonths();
        setMessage(msgEl, [`과거 데이터 로딩에 실패해 최신 ${chartSession.activeMonths}개월 범위로 시작합니다.`], true);
      },
      plotlyReady: plotlyReadyTask,
      renderMain: async () => {
        await runMainChartRender(false);
        if (chartSession.autoChartReset) await fitCurrentChartRatio();
      },
      setProgress: setStartupLoaderProgress,
    });

    appUiBindingsModule.bindChartRangeControls({
      rangeButtons: [
        document.getElementById("chartRange6Months"),
        document.getElementById("chartRange1Year"),
        document.getElementById("chartRange3Years"),
      ],
      latestButton: document.getElementById("chartJumpLatest"),
      selectMonths: showLatestChartPeriod,
      jumpLatest: slideChartViewportToLatest,
    });
    document.getElementById("chartCursorModeBtn")?.addEventListener("click", cycleCursorLineMode);

    appUiBindingsModule.bindMainChartToolActions({
      state: chartSession,
      scaleButton: document.getElementById("resetHandles"),
      coMovementButton: document.getElementById("coMovementToggle"),
      handlesButton: document.getElementById("chartHandlesToggle"),
      canUseCoMovement: () => adminAccessGranted,
      setAutoScale: setAutoChartReset,
      syncScale: syncChartResetToggleButton,
      syncCoMovement: syncCoMovementToggleButton,
      renderCoMovement: renderCoMovementPanel,
      getVisibleRange: () => getCurrentXRangeMs(document.getElementById("chart")),
      applyHandlesLayout: applyChartHandlesLayout,
      saveState,
      requestChartRender: () => requestChartRender(true, { deferDuringInteraction: false }),
      onHandlesError: (error) => recordRuntimeError("chart-handles-layout", error),
    });
    document.getElementById("recessionToggle")?.addEventListener("click", async (event) => {
      if (!adminAccessGranted) return;
      const button = event.currentTarget;
      if (button.getAttribute("aria-busy") === "true") return;
      if (!chartSession.showRecessionSignals) {
        button.setAttribute("aria-busy", "true");
        try {
          await ensureMarketTimingFeature();
        } catch (error) {
          setMessage(msgEl, `타이밍 준비 오류: ${error.message}`, true);
          return;
        } finally {
          button.setAttribute("aria-busy", "false");
        }
      }
      chartSession.showRecessionSignals = !chartSession.showRecessionSignals;
      syncRecessionToggleButton();
      requestChartCompositionUpdate();
    });
    document.getElementById("aiForecastToggle").addEventListener("click", async (event) => {
      if (!adminAccessGranted) return;
      const button = event.currentTarget;
      if (button.getAttribute("aria-busy") === "true") return;
      if (!chartSession.showAiForecast) {
        button.setAttribute("aria-busy", "true");
        try {
          await ensureAiFeatureModules();
        } catch (error) {
          setMessage(msgEl, `AI 기능 준비 오류: ${error.message}`, true);
          return;
        } finally {
          button.setAttribute("aria-busy", "false");
        }
      }
      aiForecastToggleRevision += 1;
      if (!chartSession.showAiForecast) captureAiForecastEntryViewport();
      chartSession.showAiForecast = !chartSession.showAiForecast;
      if (chartSession.showAiForecast) {
        aiForecastDeferredSeries.clear();
      }
      refreshAiForecastTargets();
      syncAiForecastToggleButton();
      if (chartSession.showAiForecast) {
        revealAiForecastRangeOnNextRender = true;
        trimAiForecastRangeOnNextRender = false;
        startAiForecastProgress();
        prepareHistoricalDataForAiForecast().catch(() => {});
        refreshAiAnalysisForVisibleSeries().catch(() => {});
        loadAiMarketModel().catch(() => {});
      } else {
        revealAiForecastRangeOnNextRender = false;
        stopAiForecastProgress();
        const restoreEntryViewport = queueAiForecastEntryViewportRestore();
        trimAiForecastRangeOnNextRender = !restoreEntryViewport;
        if (!restoreEntryViewport) clampChartViewportToObservedData();
      }
      requestChartCompositionUpdate();
    });
    if (chartSession.showAiForecast) {
      startAiForecastProgress();
      prepareHistoricalDataForAiForecast().catch(() => {});
      refreshAiAnalysisForVisibleSeries().catch(() => {});
      loadAiMarketModel().catch(() => {});
    }

    appUiBindingsModule.bindHoverToggle({
      button: document.getElementById("hoverToggle"),
      chartElements: [
        document.getElementById("chart"),
        document.getElementById("chart-macd"),
        document.getElementById("chart-adr"),
      ],
      getEnabled: () => chartSession.hoverShowPopup,
      setEnabled: (value) => { chartSession.hoverShowPopup = value; },
      saveState,
      requestChartRender,
    });

    appUiBindingsModule.bindDisclosureToggle({
      button: document.getElementById("disclosureToggle"),
      getEnabled: () => chartSession.showDisclosures,
      setEnabled: (value) => { chartSession.showDisclosures = adminAccessGranted && value; },
      markerCount: () => lastDisclosureTraceStats.markers,
      syncButton: syncDisclosureToggleButton,
      hidePopover: hideDisclosurePopover,
      onEnabled: () => prepareVisibleDisclosureData(msgEl),
      onDisabled: () => {
        const pending = new Set([
          ...disclosureTargetTickers(),
          ...dartRequestRuntime.identities("disclosure-refresh"),
        ]);
        pending.forEach((ticker) => disclosureProgress.cancel(`disclosure:${ticker}`));
      },
      onError: (error) => recordRuntimeError("disclosure-toggle-load", error),
      saveState,
      applyFastState: applyDisclosureStateFast,
      requestChartRender,
    });

    const insiderTradeToggle = document.getElementById("insiderTradeToggle");
    syncInsiderTradeToggleButton(lastInsiderTradeTraceStats.markers);
    if (insiderTradeToggle) {
      insiderTradeToggle.onclick = async () => {
        if (!adminAccessGranted) return;
        if (insiderTradeToggle.getAttribute("aria-busy") === "true") return;
        if (chartSession.showInsiderTrades) {
          chartSession.showInsiderTrades = false;
          const pending = new Set([
            ...disclosureTargetTickers(),
            ...dartRequestRuntime.identities("insider"),
          ]);
          pending.forEach((ticker) => disclosureProgress.cancel(`insider:${ticker}`));
          syncInsiderTradeToggleButton(0);
          saveState();
          requestChartRender();
          return;
        }
        if (!canUseDartGateway()) {
          setMessage(msgEl, ["내부거래를 보려면 설정에서 Think Stock 접속 코드를 먼저 저장해 주세요."], true);
          return;
        }
        chartSession.showInsiderTrades = true;
        syncInsiderTradeToggleButton(0);
        saveState();
        try {
          const count = await refreshInsiderTradesForVisibleSeries();
          setMessage(msgEl, count > 0
            ? [`DART 최근 3년 내부거래 ${count}건을 표시했습니다.`]
            : ["현재 표시 종목에는 최근 3년 내부거래가 없습니다."]);
        } catch (error) {
          setMessage(msgEl, [`내부거래 조회 오류: ${error.message}`], true);
        }
        requestChartRender();
      };
      insiderTradeToggle.dataset.bound = "1";
    }

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
      refreshRuntimeData: async (options) => {
        await refreshRuntimeData(msgEl, options);
        // A manual refresh may coalesce several data renders. Settle the last one,
        // then fit the final trace values rather than an intermediate frame.
        await runMainChartRender(true);
        if (chartSession.autoChartReset) await fitCurrentChartRatio();
        if (chartSession.showAiForecast) {
          const needsDailyAnalysis = activeAiAnalysisTickers()
            .some((ticker) => !aiAnalysisIsFresh(aiAnalysisByTicker.get(ticker)));
          if (needsDailyAnalysis) startAiForecastProgress();
          await refreshAiAnalysisForVisibleSeries({ forceNetwork: true });
        }
        if (chartSession.showInsiderTrades && canUseDartGateway()) {
          await refreshInsiderTradesForVisibleSeries({ forceNetwork: true });
          requestChartRender();
        }
      },
    });

    adminFeatureControlsReady = true;
    syncAdminFeatureAccess();
    restoreAdminAccessState().catch(() => {});

    await waitForFirstPaint();
    setStartupLoaderProgress(84, "Refreshing latest data");
    try {
      await runtimeDataApp.refreshDuringStartup(msgEl, {
        restoredSnapshot: restoredLastSnapshot,
        mergeSeed: () => loadData(true, { mergeWithExisting: true, preserveExisting: true }),
        onError: (refreshErr) => {
          setMessage(msgEl, `최신 데이터 갱신 오류: ${refreshErr.message}`, true);
        },
        onCriticalProgress: (progress) => {
          const percent = Number(progress?.percent);
          if (Number.isFinite(percent)) {
            setStartupLoaderProgress(percent, progress?.source || "");
          }
        },
      });
      if (chartSession.autoChartReset) await fitCurrentChartRatio();
    } catch (refreshErr) {
      setMessage(msgEl, `최신 데이터 갱신 오류: ${refreshErr.message}`, true);
    }
    setStartupLoaderProgress(100, "Ready");
  } catch (err) {
    setMessage(msgEl, err.message || "데이터를 가져오지 못했습니다.", true);
  } finally {
    hideStartupLoader();
    scheduleHistoricalDataPreload();
    recordPerfSample("appStartup", startupPerfStartedAt, {
      historicalDataLoaded,
      restoredSnapshot: hasRuntimeDataLoaded(),
    });
    deferredPerformanceDiagnostics.scheduleAutomaticCapture({
      appVersion: APP_VERSION,
      buildVersion: APP_BUILD_VERSION,
    }, {
      captureOptions: {
        metadataProvider: () => ({ appState: buildRuntimeDiagnosticAppState() }),
      },
    });
  }
}

boot();





