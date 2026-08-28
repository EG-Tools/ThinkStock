import {
  createAppBootstrapOrchestrator,
  createApplicationLifecycleRuntime,
  createFeatureLifecycleDescriptors,
  createLazyRuntimeRegistry,
  createStartupLoader,
  createStartupTaskRuntime,
} from "./modules/app-bootstrap-orchestrator.mjs";
import * as adminFeatureAccessModule from "./modules/admin-feature-access.mjs";
import * as backgroundStockRefreshModule from "./modules/background-stock-refresh.mjs";
import {
  APP_RUNTIME_KEYS,
  ADR_SERIES,
  BASE_DISPLAY_NAMES,
  CHART_RIGHT_PADDING_MAX_DAYS,
  CHART_RIGHT_PADDING_MIN_DAYS,
  CO_MOVEMENT_COMPARISONS,
  CUSTOM_STOCK_PRELOAD_CONCURRENCY,
  CURSOR_LINE_LABELS,
  CURSOR_LINE_MODES,
  FEAR_GREED_SERIES,
  MAIN_CHART_FINGERPRINT_CACHE_MAX_ENTRIES,
  MAIN_CHART_MODEL_CACHE_MAX_ENTRIES,
  MAIN_CHART_MODEL_CACHE_MAX_WEIGHT,
  MAX_CUSTOM_STOCKS,
  MAX_VISIBLE_MAIN_SERIES,
  NEWS_SENTIMENT_SERIES,
  STARTUP_INTERACTION_SETTLE_MS,
  STOCK_TICKER_PATTERN,
  SUPPLEMENTAL_SERIES,
  VIX_SERIES,
  VKOSPI_SERIES,
  VOLATILITY_SERIES,
  createChartApplicationControlConfig,
  isForecastSeries,
  normalizeChartRightPaddingDays,
} from "./modules/app-control-config.mjs";
import * as appStateControllerModule from "./modules/app-state-controller.mjs";
import {
  createAppDataRevisionBridge,
  createAppDataStore,
} from "./modules/app-data-store.mjs";
import * as appStorageModule from "./modules/app-storage.mjs";
import * as appUiBindingsModule from "./modules/app-ui-bindings.mjs";
import * as cacheMaintenanceRuntimeModule from "./modules/cache-maintenance-runtime.mjs";
import * as cacheLifecyclePolicyModule from "./modules/cache-lifecycle-policy.mjs";
import * as chartCursorSyncModule from "./modules/chart-cursor-sync.mjs";
import * as chartEventLayerModule from "./modules/chart-event-layer.mjs";
import * as chartHoverRuntimeModule from "./modules/chart-hover-runtime.mjs";
import * as chartInteractionControllerModule from "./modules/chart-interaction-controller.mjs";
import * as chartInteractionMath from "./modules/chart-interaction-math.mjs";
import auxiliaryChartContract from "./modules/auxiliary-chart-contract.mjs";
import chartAdjustmentsModule from "./modules/chart-adjustments.mjs";
import chartDisplaySamplerModule from "./modules/chart-display-sampler.mjs";
import dataPayloadModule from "./modules/data-payload.mjs";
import macdOscillatorModule from "./modules/macd-oscillator.mjs";
import mainChartModelModule from "./modules/main-chart-model.mjs";
import marketDataModule from "./modules/market-data.mjs";
import { chartLoader as chartLoaderModule } from "./modules/chart-loader.mjs";
import {
  chartMarkerLayout as chartMarkerLayoutModule,
  chartMarkerRuntime as chartMarkerRuntimeModule,
} from "./modules/chart-marker-runtime.mjs";
import { mainChartRenderer } from "./modules/main-chart-renderer.mjs";
import * as chartModelCacheModule from "./modules/chart-model-cache.mjs";
import * as chartModelWorkerClientModule from "./modules/chart-model-worker-client.mjs";
import * as chartNavigationAppModule from "./modules/chart-navigation-app.mjs";
import * as chartPointerRuntimeModule from "./modules/chart-pointer-runtime.mjs";
import * as chartRenderContractModule from "./modules/chart-render-contract.mjs";
import * as chartSessionControllerModule from "./modules/chart-session-controller.mjs";
import {
  createChartSeriesTransformRuntime,
  createSeriesTransformGestureRuntime,
} from "./modules/chart-series-transform-runtime.mjs";
import * as chartUpdateCoordinatorModule from "./modules/chart-update-coordinator.mjs";
import * as chartViewportControllerModule from "./modules/chart-viewport-controller.mjs";
import { createBrowserMarketClient } from "./modules/browser-market-client.mjs";
import {
  appendCacheBust,
  createFetchWithTimeout,
  isAbortError,
  throwIfAborted,
} from "./modules/browser-request-runtime.mjs";
import * as controlStateView from "./modules/control-state-view.mjs";
import * as dataFreshnessControllerModule from "./modules/data-freshness-controller.mjs";
import * as dataSeedLoaderModule from "./modules/data-seed-loader.mjs";
import * as dataHealthModule from "./modules/data-health.mjs";
import {
  classifyDisclosureType,
  createDisclosureDataService,
  createDisclosureStateController,
  createTickerDisclosureCache,
  shouldDisplayDisclosure,
} from "./modules/disclosure-policy.mjs";
import * as mainChartEventsModule from "./modules/main-chart-events.mjs";
import {
  createAppFeatureRuntime,
  createDeferredDiagnosticsFacade,
  createOptionalFeatureLoader,
  createOptionalFeatureRuntime,
  resolveTickerDartPreloadPlan,
} from "./modules/optional-feature-runtime.mjs";
import * as performanceMonitorModule from "./modules/performance-monitor.mjs";
import * as runtimeIndexRefreshModule from "./modules/runtime-index-refresh.mjs";
import * as runtimeGatewayClientModule from "./modules/runtime-gateway-client.mjs";
import * as runtimeBootstrapModule from "./modules/runtime-bootstrap.mjs";
import * as runtimeDataAppModule from "./modules/runtime-data-app.mjs";
import * as runtimeDataTransactionModule from "./modules/runtime-data-transaction.mjs";
import * as runtimeMarketRefreshModule from "./modules/runtime-market-refresh.mjs";
import * as runtimeRefreshOrchestratorModule from "./modules/runtime-refresh-orchestrator.mjs";
import * as runtimeSeriesMergeModule from "./modules/runtime-series-merge.mjs";
import * as runtimeSeriesQualityGateModule from "./modules/runtime-series-quality-gate.mjs";
import * as runtimeSnapshotControllerModule from "./modules/runtime-snapshot-controller.mjs";
import * as runtimeSourceHealthModule from "./modules/runtime-source-health.mjs";
import {
  CORE_SERIES,
  CUSTOM_COLOR_MIN_FIXED_DISTANCE,
  CUSTOM_COLOR_MIN_FIXED_HUE_DISTANCE,
  CUSTOM_COLOR_PALETTE,
  CUSTOM_RESERVED_COLORS,
  SERIES_COLORS,
  createSeriesColorResolver,
  customStockColorRandom as randomCustomStockColor,
} from "./modules/series-color-policy.mjs";
import * as seriesCacheRetentionModule from "./modules/series-cache-retention.mjs";
import { createServiceWorkerClient } from "./modules/service-worker-client.mjs";
import {
  createSharedRequestRegistry,
  mapWithConcurrency,
} from "./modules/shared-request-registry.mjs";
import {
  createStockResearchApp,
  stockResearchContract,
} from "./modules/stock-research-app.mjs";
import {
  createPreferredTickerHistoryFetcher,
  createTickerPriceAppRuntime,
} from "./modules/ticker-price-app-runtime.mjs";
import { createTickerCacheInvalidationContract } from "./modules/ticker-cache-invalidation.mjs";
import tickerPriceRuntimeModule from "./modules/ticker-price-runtime.mjs";
import { createTaskProgress } from "./modules/task-progress-runtime.mjs";
import {
  createChartTargetRuntime,
  findPriorityChartTarget,
  openPriorityChartTarget,
} from "./modules/chart-target-activation.mjs";
import * as adrDataModule from "../shared/adr-data.mjs";
import * as marketCalendarModule from "../shared/market-calendar.mjs";
import * as runtimeApiContractModule from "../shared/runtime-api-contract.mjs";
import * as runtimeDataContract from "../shared/runtime-data-contract.mjs";
import { RUNTIME_STORAGE_CONTRACT } from "../shared/runtime-foundation.mjs";
import * as runtimeFreshnessPolicyModule from "../shared/runtime-freshness-policy.mjs";
import * as seriesIntegrityModule from "../shared/series-integrity.mjs";
import * as seriesTimelinePolicyModule from "../shared/series-timeline-policy.mjs";


const disclosureProgress = createTaskProgress(globalThis, {
  defaultLabel: "공시",
  getRoot: () => document.getElementById("disclosureProgress"),
  getText: () => document.getElementById("disclosureProgressText"),
  getBar: () => document.getElementById("disclosureProgressBar"),
  resolveAnchor: (key, label) => {
    const taskKey = String(key || "").trim().toLowerCase();
    if (taskKey.startsWith("insider:")) return "insider";
    if (taskKey.startsWith("disclosure:")) return "disclosure";
    return String(label || "").includes("내부거래") ? "insider" : "disclosure";
  },
});
const epsProgress = createTaskProgress(globalThis, {
  defaultLabel: "EPS",
  getRoot: () => document.getElementById("epsProgress"),
  getText: () => document.getElementById("epsProgressText"),
  getBar: () => document.getElementById("epsProgressBar"),
  anchor: "eps",
});
const serviceWorkerClient = createServiceWorkerClient(globalThis);
const requestServiceWorkerDataRefresh = serviceWorkerClient.requestDataRefresh;
const scheduleServiceWorkerRegistration = serviceWorkerClient.scheduleRegistration;
const {
  retryOnce,
  runRefreshPhases,
  waitForRetryDelay: waitForDelay,
} = runtimeRefreshOrchestratorModule;
const appRequestRegistry = createSharedRequestRegistry();
const appRuntimeRegistry = createLazyRuntimeRegistry();
const {
  expectedLatestKoreanTradingDate,
  inspectDailyPriceHistoryDensity,
  isKoreanMarketPricePoint,
  isKoreanTradingDate,
  koreanDateText,
} = marketCalendarModule;
const {
  shiftIsoDateByDays: shiftDays,
  shiftIsoDateByMonths: shiftMonths,
} = marketDataModule;
const {
  getSeriesColumns,
  sanitizeKoreanEquityPricePayload,
  mergeRowsPreservingExisting,
  mergeRowsPreferIncoming,
  mergePricePayloadPreservingExisting,
  mergePricePayloadPreferIncoming,
  normalizeTickerPricePoints,
  findTickerPriceRebaseSignal,
  buildDenseMacroRows,
} = marketDataModule;
const {
  toMsSafe,
  getTraceTimeMsArray,
  findNearestHoverPoint,
  getChartInteractionGeometry,
  axisPixelToXValue,
  xRangeMatches,
  interpolateTraceYAtMs,
  buildLineHitIndex,
  lineHitIndexMatches,
  findNearestLineTarget,
  findNearestMarkerTarget,
} = chartInteractionMath;
const {
  createPointerFrameController,
  createSeriesTransformDragController,
  latestPointerSample,
} = chartInteractionControllerModule;
const {
  resolveScale: resolveSeriesScale,
  transformValues: transformSeriesValues,
  transformValuesInto: transformSeriesValuesInto,
  invertTransformValues: invertSeriesTransform,
  offsetFromDrag,
  scaleFromDrag,
  fitRangeForTraces,
  expandRangeToContain,
} = chartAdjustmentsModule;
const {
  AUXILIARY_PANEL_KEYS,
  AUXILIARY_CHART_CONFIG,
  NEWS_MOVING_AVERAGE_DAYS,
  NEWS_MOVING_AVERAGE_MIN_DAYS,
  NEWS_MOVING_AVERAGE_MAX_DAYS,
  normalizeNewsMovingAverageDays,
} = auxiliaryChartContract;
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
const {
  buildCursorHoverMode,
  buildCursorLineAxisLayout,
  normalizeCursorLineMode,
} = mainChartRenderer;
const buildInsiderMarkerTraces = (...args) => (
  appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartFeature)?.insiderTrades?.buildMarkerTraces?.(...args) || []
);
const netSameReporterInsiderTrades = (rows) => (
  appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartFeature)?.insiderTrades?.netSameReporterTrades?.(rows)
  || (Array.isArray(rows) ? rows : [])
);
const { buildMacdOscillator, thinMacdPoints } = macdOscillatorModule;
const performanceMonitor = performanceMonitorModule.createPerformanceMonitor(globalThis);
const chartRenderTelemetry = performanceMonitorModule.createChartRenderTelemetry(globalThis);
const initPerformanceMonitor = () => performanceMonitor.init();
const startPerfSample = () => performanceMonitor.startSample();
const recordPerfSample = (label, startedAt, meta = {}) => (
  performanceMonitor.recordSample(label, startedAt, meta)
);
const recordRuntimeError = (source, error, meta = {}) => (
  performanceMonitor.recordError(source, error, meta)
);
const tickerCacheInvalidationModule = createTickerCacheInvalidationContract(cacheLifecyclePolicyModule);
const cacheRecordHealthModule = cacheLifecyclePolicyModule;
const backgroundTaskScheduler = backgroundStockRefreshModule.createBackgroundTaskScheduler(globalThis, {
  isInteractionBusy: () => isChartInteractionBusy(),
});
const startupTaskRuntime = createStartupTaskRuntime({
  scheduler: backgroundTaskScheduler,
  recordError: recordRuntimeError,
});
const runAfterStartupVisualReady = startupTaskRuntime.defer;
const startupLoader = createStartupLoader(globalThis, {
  onComplete: ({ startedAt } = {}) => {
    startupTaskRuntime.release();
    recordPerfSample("startup:visual", startedAt);
  },
});
const DISPLAY_NAMES = { ...BASE_DISPLAY_NAMES };
const MAX_VISIBLE_MAIN_SERIES_MESSAGE = `최대 ${MAX_VISIBLE_MAIN_SERIES}개 까지만 추가됩니다.`;
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
  "epsToggle",
  "insiderTradeToggle",
  "recessionToggle",
  "aiForecastToggle",
  "coMovementToggle",
  "stockResearchBtn",
]);
const runtimeStorageContract = RUNTIME_STORAGE_CONTRACT;
if (!runtimeStorageContract) throw new Error("runtime storage contract failed to load");
const DATA_CACHE_DB_NAME = runtimeStorageContract.dbName;
const DATA_CACHE_DB_VERSION = runtimeStorageContract.dbVersion;
const DATA_CACHE_STORE_NAME = runtimeStorageContract.stores.snapshots;
const DATA_CACHE_RECORD_KEY = runtimeStorageContract.snapshotRecordKey;
const DATA_CACHE_LOCAL_KEY = runtimeStorageContract.localSnapshotKey;
const DATA_CACHE_SCHEMA_VERSION = 12;
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
const TICKER_TIMING_MODEL_STORE_NAME = runtimeStorageContract.stores.tickerTimingModels;
const GRANULAR_CACHE_SCHEMA_VERSION = 6;
const TICKER_DISCLOSURE_CACHE_SCHEMA_VERSION = 2;
const GRANULAR_CACHE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GRANULAR_CACHE_MAINTENANCE_KEY = "thinkstock-cache-maintenance-v1";
const TICKER_AI_ANALYSIS_CACHE_MAX_AGE_DAYS = 2;
const AI_FORECAST_JOURNAL_QUEUE_MAX = 120;
const PRICE_CACHE_REBASE_RATIO_THRESHOLD = tickerPriceRuntimeModule.CORPORATE_ACTION_RATIO_THRESHOLD;
const PRICE_CACHE_REBASE_BOUNDARY_DAYS = tickerPriceRuntimeModule.CORPORATE_ACTION_MAX_BOUNDARY_DAYS;
const APP_VERSION = "3.22";
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
const cacheMigrator = cacheMaintenanceRuntimeModule.createCacheMigrator(globalThis, {
  markerKey: "thinkstock-cache-migrations-v1",
  currentVersion: 4,
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
    {
      version: 4,
      migrate: ({ storage }) => {
        ["thinkstock-v1", "thinkstock-v2", "thinkstock-v3", "thinkstock-v4"]
          .forEach((key) => storage?.removeItem(key));
      },
    },
  ],
});
const optionalFeatureLoader = createOptionalFeatureLoader(globalThis, {
  version: APP_BUILD_VERSION,
});
const optionalFeatureRuntime = createOptionalFeatureRuntime(globalThis, {
  loader: optionalFeatureLoader,
  version: APP_BUILD_VERSION,
  buildMacdOscillator,
  marketTimingCache: {
    readMany: (tickers) => indexedCacheStore.readRecords(TICKER_TIMING_MODEL_STORE_NAME, tickers),
    writeMany: (entries) => indexedCacheStore.writeRecords(TICKER_TIMING_MODEL_STORE_NAME, entries),
  },
});
const runtimeDataApp = runtimeDataAppModule.createRuntimeDataApp(globalThis, {
  isAbortError,
  runRefresh: (messageElement, options) => getRuntimeRefreshOrchestrator().run(messageElement, options),
  sourceLedger: runtimeSourceHealthModule.createRuntimeSourceHealth(globalThis, {
    persistDelayMs: 350,
  }),
});
const dataFreshnessController = dataFreshnessControllerModule.createDataFreshnessController({
  dataHealth: dataHealthModule,
  runtimeDataApp,
  labelName,
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
    TICKER_TIMING_MODEL_STORE_NAME,
  ],
});
const tickerSeriesCacheRetention = seriesCacheRetentionModule.createSeriesCacheRetention({
  capacity: cacheLifecyclePolicyModule.USER_TICKER_CACHE_LIMIT,
});
let tickerSeriesCacheRetentionInitPromise = null;
let tickerPriceCacheMutationQueue = Promise.resolve();
function scheduleDeferredServiceWorkerRegistration() {
  backgroundTaskScheduler.enqueue(
    "service-worker-registration",
    scheduleServiceWorkerRegistration,
    { delayMs: 3000, group: "app-maintenance", priority: -20 },
  ).catch(() => {});
}
const deferredPerformanceDiagnostics = createDeferredDiagnosticsFacade(globalThis, {
  registry: appRuntimeRegistry,
  runtimeKey: APP_RUNTIME_KEYS.deferredDiagnostics,
  optional: optionalFeatureRuntime,
  scheduler: backgroundTaskScheduler,
  performanceApi: performanceMonitor.api,
});
const runtimeRefreshRenderBatcher = runtimeRefreshOrchestratorModule.createRuntimeRefreshRenderBatcher({
  scheduler: backgroundTaskScheduler,
  // Supplemental data must not replace a range the user already selected.
  renderMain: () => runMainChartRender(true),
  renderAuxiliary: () => renderAdrChart(document.getElementById("chart")?._fullLayout?.xaxis?.range?.slice() || null),
  renderDisclosure: queueDisclosureTraceRefresh,
  onError: (error) => recordRuntimeError("runtime-refresh-render", error),
});
const granularCacheMaintenance = cacheMaintenanceRuntimeModule.createCacheMaintenanceRuntime(globalThis, {
  store: indexedCacheStore,
  lifecyclePolicy: cacheLifecyclePolicyModule,
  pruneIntervalMs: GRANULAR_CACHE_PRUNE_INTERVAL_MS,
  scheduler: backgroundTaskScheduler,
  stateStore: appStorageModule.createJsonStore(globalThis, {
    key: GRANULAR_CACHE_MAINTENANCE_KEY,
  }),
  repairVersions: {
    [TICKER_PRICE_CACHE_STORE_NAME]: `price-${GRANULAR_CACHE_SCHEMA_VERSION}`,
    [TICKER_TIMING_MODEL_STORE_NAME]: "timing-2",
  },
  validators: {
    [TICKER_PRICE_CACHE_STORE_NAME]: (record, key) => (
      Number(record?.schema) === GRANULAR_CACHE_SCHEMA_VERSION
      && String(record?.ticker || "").toUpperCase() === String(key || "").toUpperCase()
      && tickerPriceRuntimeModule.inspectPriceHistoryIntegrity(record?.points).clean
    ),
    [TICKER_TIMING_MODEL_STORE_NAME]: (record, key) => (
      Number(record?.schema) === 1
      && String(record?.ticker || "").toUpperCase() === String(key || "").toUpperCase()
      && record?.model && typeof record.model === "object"
      && typeof record?.fingerprint === "string"
    ),
  },
  storeNames: [
    TICKER_PRICE_CACHE_STORE_NAME,
    TICKER_DISCLOSURE_CACHE_STORE_NAME,
    TICKER_AI_ANALYSIS_CACHE_STORE_NAME,
    TICKER_AI_FORECAST_CACHE_STORE_NAME,
    TICKER_AI_FORECAST_JOURNAL_STORE_NAME,
    TICKER_RESEARCH_HISTORY_STORE_NAME,
    STOCK_RESEARCH_RESULTS_STORE_NAME,
    TICKER_BROKER_RESEARCH_STORE_NAME,
    TICKER_TIMING_MODEL_STORE_NAME,
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
const runtimeSnapshotRevisionTracker = runtimeSnapshotControllerModule.createRevisionTracker(
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
  TICKER_TIMING_MODEL_STORE_NAME,
]);
const APP_CACHE_LOCAL_STORAGE_KEYS = Object.freeze([
  DATA_CACHE_LOCAL_KEY,
  DART_DISCLOSURE_CACHE_KEY,
  GRANULAR_CACHE_MAINTENANCE_KEY,
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
const DART_GATEWAY_URL = "https://thinkstock-api.keg0320.workers.dev";
const DART_GATEWAY_AUTH_CHECK_ENDPOINT = `${DART_GATEWAY_URL}/api/auth/check`;
const ADMIN_SESSION_ENDPOINT = IS_LOCAL_RUNTIME
  ? "/api/admin/session"
  : `${DART_GATEWAY_URL}/api/admin/session`;
const DART_GATEWAY_DISCLOSURE_ENDPOINT = `${DART_GATEWAY_URL}/api/dart/disclosures`;
const DART_GATEWAY_EPS_ENDPOINT = `${DART_GATEWAY_URL}/api/dart/eps-history`;
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
const AI_ANALYSIS_ENDPOINT = IS_LOCAL_RUNTIME ? "./api/analysis" : `${DART_GATEWAY_URL}/api/analysis`;
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
const [ADR_RETRY_DELAY_MS = 3000, ADR_FINAL_RETRY_DELAY_MS = 15000] = runtimeFreshnessPolicyModule.retryDelaysMs("adr");
const DART_GATEWAY_REQUEST_TIMEOUT_MS = 90000;
const RECENT_DATA_MONTHS = 132;
const DEFAULT_DESKTOP_ACTIVE_MONTHS = 12;
const DEFAULT_PHONE_ACTIVE_MONTHS = 6;
const fetchWithTimeout = createFetchWithTimeout({
  defaultTimeoutMs: NETWORK_REQUEST_TIMEOUT_MS,
});
const dataSeedLoader = dataSeedLoaderModule.createDataSeedLoader({
  fetchWithTimeout,
  appendCacheBust,
});
const seedBundleParser = dataSeedLoaderModule.createSeedBundleParser(globalThis, {
    workerUrl: `./modules/data-worker.mjs?v=${encodeURIComponent(APP_BUILD_VERSION || "dev")}`,
  parseSync: parseSeedBundleSync,
});
const seedBundleLoader = dataSeedLoaderModule.createSeedBundleLoader({
  seedLoader: dataSeedLoader,
  parser: seedBundleParser,
});
const {
  fetchSeedText,
} = dataSeedLoader;
const dartCorpCodeRegistry = dataSeedLoaderModule.createShardedCorpCodeRegistry({
  fetchText: fetchSeedText,
  runRequest: async (kind, identity, factory, options) => {
    await ensureDartFeatureModules();
    return getDartRequestRuntime().run(kind, identity, factory, options);
  },
});

const runtimeGatewayClient = runtimeGatewayClientModule.createRuntimeGatewayClient({
  requestRegistry: appRequestRegistry,
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
    epsHistory: DART_GATEWAY_EPS_ENDPOINT,
    insiderTrades: DART_GATEWAY_INSIDER_ENDPOINT,
  },
  localEndpoints: {
    indices: "./api/indices",
    macro: "./api/macro",
    credit: "./api/credit",
    crisisSignal: "./api/crisis-signal",
    disclosures: "./api/dart/disclosures",
    epsHistory: "./api/dart/eps-history",
    insiderTrades: "./api/dart/insider-trades",
  },
});

const appFeatures = createAppFeatureRuntime({
  registry: appRuntimeRegistry,
  keys: APP_RUNTIME_KEYS,
  optional: optionalFeatureRuntime,
  requestRegistry: appRequestRegistry,
  dartTickerPattern: STOCK_TICKER_PATTERN,
  createAiApp: (feature) => feature.app.createAiForecastApp(globalThis, {
    workerUrl: `./assets/ai-forecast-worker.bundle.min.js?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
      buildFallback: (options) => feature.forecast?.buildForecast(options) || null,
      createProgressView: controlStateView.createProgressView,
  }),
});
const ensureAiFeatureModules = appFeatures.ensureAi;
const getLoadedAiFeature = appFeatures.getAi;
const getLoadedAiForecastApp = appFeatures.getAiApp;
const requireLoadedAiFeature = appFeatures.requireAi;
const ensureBrokerResearchFeature = appFeatures.ensureBrokerResearch;
const requireLoadedBrokerResearchFeature = appFeatures.requireBrokerResearch;
const ensureDartFeatureModules = appFeatures.ensureDart;
const getLoadedDartFeature = appFeatures.getDart;
const requireLoadedDartFeature = appFeatures.requireDart;
const getDartRequestRuntime = appFeatures.getDartRequests;
const normalizeDartTicker = appFeatures.normalizeDartTicker;
const resolveDartCompanyContext = appFeatures.resolveDartCompanyContext;
const fetchProgressiveRecords = appFeatures.fetchProgressiveRecords;
const toDartGatewayError = appFeatures.toDartGatewayError;
const sanitizeInsiderTradeRows = appFeatures.sanitizeInsiderRows;
const mergeInsiderTradeRowsWithChange = appFeatures.mergeInsiderRowsWithChange;

const ensureEpsFeatureModules = appFeatures.ensureEps;
const ensureMarketTimingFeature = appFeatures.ensureMarketTiming;
const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const normalizeCreditRows = (rows) => runtimeSeriesMergeModule.normalizeCreditInputRows(
  rows,
  CREDIT_COLS,
);
const normalizeCrisisSignalRows = (rows) => runtimeSeriesMergeModule.normalizeCrisisRows(rows);
const sameNullableNumber = (left, right) => runtimeSeriesMergeModule.sameNullableNumber(left, right);
const fetchPreferredTickerHistory = createPreferredTickerHistoryFetcher({
  endpoint: TICKER_HISTORY_ENDPOINT,
  fetchWithTimeout,
  appendCacheBust,
  isLocalRuntime: IS_LOCAL_RUNTIME,
  getAccessToken: getDartGatewayAccessToken,
  normalizePoints: (rows, ticker) => normalizeTickerPricePointsForTicker(rows, ticker),
  timeoutMs: NETWORK_REQUEST_TIMEOUT_MS,
});
const browserMarketClient = createBrowserMarketClient({
  fetchJson: (...args) => fetchJsonWithProxyFallback(...args),
  appendCacheBust,
  shiftDays,
  toNumber: toNum,
  dayMs: DAY_MS,
  fetchLatestPrice: fetchLatestKrxTickerSeries,
  fetchPreferredHistory: fetchPreferredTickerHistory,
  filterLatestTailPoints: tickerPriceRuntimeModule.filterLatestTailPoints,
  inspectHistoryIntegrity: (points) => tickerPriceRuntimeModule.inspectPriceHistoryIntegrity(points),
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
const customStockColorRandom = () => randomCustomStockColor(globalThis);
const seriesColor = createSeriesColorResolver({
  fixedColors: SERIES_COLORS,
  getStocks: () => customStocks,
  normalizeHexColor: appStateControllerModule.normalizeHexColor,
  palette: CUSTOM_COLOR_PALETTE,
});
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
const PLOTLY_CONFIG = chartLoaderModule.PLOTLY_CONFIG;
const interactiveMarkerHitRadius = chartEventLayerModule.interactiveMarkerHitRadius;
function plotlyHoverLabel(fontSize) {
  return chartLoaderModule.hoverLabel(chartSession.hoverShowPopup, fontSize);
}

const ensurePlotlyReady = chartLoaderModule.ensurePlotlyReady;
const LINE_DRAG_TOLERANCE_PX = 14;
const LINE_DRAG_TOUCH_TOLERANCE_PX = 24;
const AI_REPORT_LINE_HIT_TOLERANCE_PX = 10;
const AI_REPORT_LINE_TOUCH_HIT_TOLERANCE_PX = 20;
const LINE_HIT_TEST_INTERVAL_MS = 50;
const CHART_GEOMETRY_CACHE_MS = 240;
const HOVER_IDLE_DELAY_MS = 180;
const HANDLE_UPDATE_DEBOUNCE_MS = 40;
const SNAPSHOT_SAVE_IDLE_TIMEOUT_MS = 3500;
const MAIN_LINE_TRACE_TYPE = "scatter";
const MAIN_CHART_PRESERVE_DAILY_POINTS = true;
const CHART_VIEWPORT_BUFFER_RATIO = 2;
const CHART_VIEWPORT_MIN_BUFFER_MS = DAY_MS * 45;
const MAIN_CHART_MIN_DISPLAY_POINTS = 720;
const MAIN_CHART_MOBILE_MIN_DISPLAY_POINTS = 420;
const MAIN_CHART_MAX_DISPLAY_POINTS = 1500;
const MAIN_CHART_POINTS_PER_PIXEL = 1.45;
const MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_DESKTOP = 6500;
const MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_MOBILE = 2800;
const INTERACTION_RENDER_DELAY_MS = 260;

const appData = createAppDataStore();
const appDataRevisionBridge = createAppDataRevisionBridge(appData, {
  markChanged: (components) => runtimeSnapshotRevisionTracker.markChanged(components),
  onChanged: scheduleDataFreshnessRender,
});
let disclosureManifest = null;
let disclosureSeedLoadedTickers = new Set();
let customStocks = [];
let customStockColorsChangedOnLoad = false;
let krxUniverse = [];
let krxUniverseLoaded = false;
const tickerPriceStatusStore = tickerPriceRuntimeModule.createStatusStore({
  tickerPattern: STOCK_TICKER_PATTERN,
});
const tickerVolumeSeriesByTicker = new Map();
const eventMarkerRenderState = chartMarkerRuntimeModule.createEventMarkerRenderState();
let baseTraceValues = {};
const chartSeriesTransformRuntime = createChartSeriesTransformRuntime({
  baseValuesFor: (seriesKey) => baseTraceValues[seriesKey],
  describeTrace: (trace) => mainChartRenderer.chartOverlayDescriptor(trace),
  resolveOffset: (seriesKey) => chartSession.seriesOffsets[seriesKey] || 0,
  resolveScale: (seriesKey) => resolveSeriesScale(chartSession.seriesScales, seriesKey),
  transformValuesInto: transformSeriesValuesInto,
});
let adrFinalRetryController = null;
let historicalDataLoaded = false;
let historicalDataLoadPromise = null;
const mainChartCalcCache = chartModelCacheModule.createChartModelCache({
  maxEntries: MAIN_CHART_MODEL_CACHE_MAX_ENTRIES,
  maxWeight: MAIN_CHART_MODEL_CACHE_MAX_WEIGHT,
  getWeight: chartModelCacheModule.estimateMainChartModelWeight,
});
const mainChartSourceFingerprintCache = chartModelCacheModule.createSourceFingerprintCache({
  fingerprint: seriesIntegrityModule.fingerprintDatedSeries,
  maxEntries: MAIN_CHART_FINGERPRINT_CACHE_MAX_ENTRIES,
});
let lastMainChartModelCacheHit = false;
let lastMainChartModelSource = "none";
let mainChartMacroBoundsCache = { revision: "", rows: [] };
let chartSyncing = false;   // relayout sync loop guard
const plotlyUpdateRuntime = chartUpdateCoordinatorModule.createPlotlyUpdateRuntime(window, {
  onBusyChange: (value) => { chartSyncing = Boolean(value); },
  onError: (error, label) => recordRuntimeError(label, error),
});
let adminAccessGranted = false;
let adminFeatureControlsReady = false;
let lastRecessionSignalCount = 0;
let lastMarketTimingBuyCount = 0;
let lastMarketTimingSellCount = 0;
let chartViewportInteractionRevision = 0;
let aiForecastToggleRevision = 0;
let lastAiForecastTraceCount = 0;
let aiAnalysisByTicker = new Map();
let aiAnalysisPendingTickers = new Set();
const EMPTY_BROKER_RESEARCH_BY_TICKER = new Map();
const EMPTY_BROKER_RESEARCH_PENDING_TICKERS = new Set();
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
let aiForecastDeferredSeries = new Set();
let aiForecastCalculationCounts = new Map();
let aiForecastUnavailableMessageKeys = new Set();
let aiForecastDeferredRenderId = 0;
const macdModelCache = chartModelCacheModule.createSeriesDerivedCache({ maxEntries: 40 });
let isHandleDragging = false;
let isHandlePointerActive = false;
const chartSession = chartSessionControllerModule.createChartSessionState({
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
  showEps: false,
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
  applyHandlesContainer: chartViewportControllerModule.applyContainer,
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
let handleUpdateTimer = 0;

function getChartTargetRuntime() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartTarget, () => createChartTargetRuntime({
    getMainElement: () => document.getElementById("chart"),
    getBaseTraceValues: () => baseTraceValues,
    axisPixelToXValue,
    toMilliseconds: toMsSafe,
    adjustableSeriesKeys: mainChartRenderer.adjustableSeriesKeys,
    buildLineHitIndex,
    lineHitIndexMatches,
    findNearestLineTarget,
    findNearestMarkerTarget,
    interactiveMarkerHitRadius,
    findMarkerAtClientPoint: chartEventLayerModule.findMarkerAtClientPoint,
    invalidateMarkerPixels: chartEventLayerModule.invalidateMarkerPixels,
    isAiReportTrace: (trace) => getLoadedAiFeature()?.traces?.isThickestAiScenarioTrace?.(trace),
    isInteractiveEventMarkerTrace: chartMarkerRuntimeModule.isDirectlyInteractiveEventMarkerTrace,
    buildEventMarkerPopoverGroup: chartMarkerRuntimeModule.buildEventMarkerPopoverGroup,
    showEventMarkerPopover: showDisclosurePopover,
    openAiForecastReport: (eventData) => handleAiForecastClick(eventData),
    lineTolerancePx: LINE_DRAG_TOLERANCE_PX,
    lineTouchTolerancePx: LINE_DRAG_TOUCH_TOLERANCE_PX,
    aiReportTolerancePx: AI_REPORT_LINE_HIT_TOLERANCE_PX,
    aiReportTouchTolerancePx: AI_REPORT_LINE_TOUCH_HIT_TOLERANCE_PX,
  }));
}

function invalidateChartInteractionCaches(element, options = {}) {
  getChartTargetRuntime().invalidate(element, options);
}
const chartDataRangeCache = chartViewportControllerModule.createDataRangeCache({
  toMilliseconds: toMsSafe,
  shouldInclude: (trace) => trace?.visible !== "legendonly"
    && mainChartRenderer.chartOverlayDescriptor(trace).rangeRole === "historical",
});
const chartFutureOverlayRangeCache = chartViewportControllerModule.createDataRangeCache({
  toMilliseconds: toMsSafe,
  shouldInclude: (trace) => trace?.visible !== "legendonly"
    && mainChartRenderer.chartOverlayDescriptor(trace).rangeRole === "future",
});
let suppressPlotlyClickUntil = 0;
let hoveredLineTraceIndex = null;
let activeLineTraceIndex = null;
let appliedLineHighlightTraceIndex = null;
let lastVisibleStockSeriesKey = "";
let isViewportDragging = false;
let isWheelZooming = false;
let useViewportEventMarkerGap = false;
const epsRefreshOnNextAdd = new Set();
let lineHighlightDomUpdateCount = 0;
let dataFreshnessRenderFrame = 0;
const initE2eDebugAccess = __THINKSTOCK_E2E_DIAGNOSTICS__
  ? function initE2eDebugAccessForTests() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("e2e") !== "1") return;
    window.ThinkStockE2E = {
      getPerformanceApi() {
        return performanceMonitor.api;
      },
      getChartModelSource() {
        return lastMainChartModelSource;
      },
      getAuxiliaryChartModelSource() {
        return appRuntimeRegistry.peek(APP_RUNTIME_KEYS.auxiliaryChart)
          ?.stats?.().modelSource || "none";
      },
      getHiddenAuxiliarySeries() {
        return [...chartSession.hiddenAuxiliarySeries].sort();
      },
      getChartRenderGeneration() {
        return appRuntimeRegistry.peek(APP_RUNTIME_KEYS.mainChartScheduler)
          ?.stats?.().lastTransactionId || 0;
      },
      getRefreshPhaseStats() {
        return runtimeDataApp.getPhaseStats();
      },
      getCrisisSignalStats() {
        const entries = collectCrisisSignalEntries(appData.crisisRows);
        return {
          rows: appData.crisisRows.length,
          entries: entries.length,
          visibleEntries: entries.filter((row) => row.date >= chartSession.currentStart && row.date <= chartSession.currentEnd).length,
          enabled: chartSession.showRecessionSignals,
          renderedMarkers: lastRecessionSignalCount,
          buyMarkers: lastMarketTimingBuyCount,
          sellMarkers: lastMarketTimingSellCount,
          firstDate: appData.crisisRows[0]?.date || "",
          latestDate: appData.crisisRows.at(-1)?.date || "",
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
        const eventState = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartEvents)?.snapshot?.() || {
          loadedTickers: [],
          pendingTickers: [],
        };
        return {
          enabled: chartSession.showInsiderTrades,
          rows: appData.insiderTradeRows.length,
          ...eventState,
          gatewayReady: canUseDartGateway(),
        };
      },
      getDisclosureProgressState() {
        return {
          enabled: chartSession.showDisclosures,
          pendingTickers: appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartRequests)
            ?.identities("disclosure-refresh").sort() || [],
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
            .filter((trace) => mainChartRenderer.chartOverlayDescriptor(trace).kind === "ai-scenario")
            .map((trace) => String(trace?.meta?.seriesKey || "")))]
            .filter(Boolean)
            .sort(),
        };
      },
      getChartWorkerStats() {
        const workerStats = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartModelWorker)?.stats?.() || {};
        const renderTelemetry = chartRenderTelemetry.snapshot();
        const renderCounts = renderTelemetry.counts || {};
        return {
          dispatched: Number(workerStats.dispatched) || 0,
          sourceTransfers: Number(workerStats.sourceTransfers) || 0,
          superseded: Number(workerStats.superseded) || 0,
          partialDisclosureUpdates: eventMarkerRenderState.partialUpdateCount,
          skippedChartRenders: Number(renderCounts.skipped) || 0,
          partialChartUpdates: (Number(renderCounts.partial) || 0) + (Number(renderCounts.structural) || 0),
          fullChartRenders: Number(renderCounts.full) || 0,
          lastChartRenderMode: renderTelemetry.recent?.at(-1)?.mode || "none",
          renderTelemetry,
          scheduler: appRuntimeRegistry.peek(APP_RUNTIME_KEYS.mainChartScheduler)?.stats?.() || null,
          coordinator: appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartUpdates)?.stats?.() || null,
          visualFrames: appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartVisualFrame)?.stats?.() || null,
          viewportWindowCache: appRuntimeRegistry.peek(APP_RUNTIME_KEYS.mainViewportWindow)?.stats?.() || null,
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
          componentCache: runtimeSnapshotRevisionTracker.stats(),
          revisions: getDataRevisions(),
        };
      },
      getRuntimeStorageContract() {
        return RUNTIME_STORAGE_CONTRACT;
      },
      getRuntimeDiagnosticState() {
        return buildRuntimeDiagnosticAppState();
      },
      getCacheCleanupStats() {
        return { ...granularCacheMaintenance.stats() };
      },
      getHighlightStats() {
        return {
          lineDomUpdates: lineHighlightDomUpdateCount,
          disclosureDomUpdates: eventMarkerRenderState.highlightDomUpdateCount,
          eventMarkerDomUpdates: eventMarkerRenderState.highlightDomUpdateCount,
        };
      },
      getSeriesTransforms() {
        return {
          offsets: { ...chartSession.seriesOffsets },
          scales: { ...chartSession.seriesScales },
        };
      },
      getLineDragTargetAt(clientX, clientY) {
        const chart = document.getElementById("chart");
        const target = findNearestLineDragTarget(chart, Number(clientX), Number(clientY), false);
        return target ? { ...target } : null;
      },
      applyNewsSentimentForTest(rows) {
        const result = applyNewsSentimentLiveRows(rows);
        if (result.updated > 0) {
          mainChartCalcCache.clear();
          invalidateAdrChartRender();
          requestChartRender(false, {
            reason: "test-news-sentiment",
            updateClass: "data",
          });
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
        const months = Math.max(1, Math.min(360, Number(value) || getDefaultActiveMonths()));
        const navigation = getChartNavigationController();
        if (months > RECENT_DATA_MONTHS) {
          await navigation.ensureHistoryReady();
          await settleChartViewport();
        }
        const applied = navigation.showLatestPeriod(months, "range-preset");
        if (applied) {
          await settleChartViewport();
        } else {
          chartSession.activeMonths = months;
          chartSession.pinnedXRange = null;
          chartSession.pendingCompositionViewport = null;
          chartSession.userViewportPinned = false;
          await runMainChartRender(false);
        }
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
        return dartCorpCodeRegistry.size();
      },
      async loadDartCorpCodeForTest(stockCode) {
        const loaded = await ensureDartCorpCodeMapLoaded(stockCode);
        return {
          loaded,
          corpCode: dartCorpCodeRegistry.get(stockCode)?.corp_code || "",
          shards: dartCorpCodeRegistry.loadedShards(),
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
        return handleEventMarkerClick({
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
  : () => {};

/* localStorage persistence */
function getCustomStockLifecycle() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.customStockLifecycle, () => (
    appStateControllerModule.createCustomStockLifecycle({
      initialStocks: customStocks,
      maxStocks: MAX_CUSTOM_STOCKS,
      maxRemovedColors: 100,
      assignColors: (stocks, context) => appStateControllerModule.assignCustomStockColors(stocks, {
        palette: CUSTOM_COLOR_PALETTE,
        reservedColors: CUSTOM_RESERVED_COLORS,
        minimumDistance: CUSTOM_COLOR_MIN_FIXED_DISTANCE,
        minimumHueDistance: CUSTOM_COLOR_MIN_FIXED_HUE_DISTANCE,
        previousColorsByTicker: context.removedColors,
        random: customStockColorRandom,
      }),
      onChange: (stocks) => { customStocks = stocks; },
    })
  ));
}

function applyCustomStockDisplayNames() {
  customStocks.forEach((item) => {
    if (item?.ticker && item?.name) DISPLAY_NAMES[item.ticker] = item.name;
  });
}

function getAppStateController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.appState, () => (
    appStateControllerModule.createAppStateController({
      state: chartSession,
      store: appStateStore,
      panelKeys: AUXILIARY_PANEL_KEYS,
      seriesKeys: AUXILIARY_SERIES_KEYS,
      maxCustomStocks: MAX_CUSTOM_STOCKS,
      normalizeCursorLineMode,
      normalizeChartRightPaddingDays,
      normalizeNewsMovingAverageDays,
      getCustomStocks: () => customStocks,
      setCustomStocks: (value) => {
        const beforeColors = (value || []).map((stock) => appStateControllerModule.normalizeHexColor(stock?.color));
        const normalized = getCustomStockLifecycle().replace(value);
        customStockColorsChangedOnLoad = normalized.some((stock, index) => (
          stock.color !== beforeColors[index]
        ));
      },
      applyCustomStockDisplayNames,
      getCreditOffset: () => CREDIT_OFFSET_DAYS,
      setCreditOffset: (value) => { CREDIT_OFFSET_DAYS = value; },
    })
  ));
}

function saveState() {
  return getAppStateController().save();
}

function loadState() {
  const controller = getAppStateController();
  customStockColorsChangedOnLoad = false;
  const loaded = controller.load({ allowActiveMonths: IS_E2E_RUNTIME });
  if (loaded && customStockColorsChangedOnLoad) controller.save();
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

function setDartCorpCodeRows(records) {
  return dartCorpCodeRegistry.replace(records);
}

function dartCorpCodeFor(stockCode) {
  return String(dartCorpCodeRegistry.get(stockCode)?.corp_code || "");
}

async function ensureDartCorpCodeMapLoaded(stockCode = "", forceNetwork = false) {
  return dartCorpCodeRegistry.ensure(stockCode, forceNetwork);
}

function getDataRevisions() {
  return runtimeSnapshotRevisionTracker.getRevisions();
}

function applySnapshotRevisions(revisions, loadedNames) {
  runtimeSnapshotRevisionTracker.applyRevisions(revisions, loadedNames);
}

function sanitizeRuntimePricePayload(raw) {
  return sanitizeKoreanEquityPricePayload(raw, {
    isTradingDate: (date) => isKoreanTradingDate(date),
  });
}

const runtimeSnapshotComponentContract = runtimeSnapshotControllerModule.createSnapshotComponentContract({
  price: {
    snapshotKey: "pricePayload",
    dataKey: "pricePayload",
    required: true,
    normalize: sanitizeRuntimePricePayload,
    validate: (value) => Boolean(value?.records?.length)
      && tickerPriceRuntimeModule.inspectPricePayloadIntegrity(value).clean
      && runtimeSeriesQualityGateModule.validateSnapshotComponent("price", value).ok,
  },
  macro: {
    snapshotKey: "macroRows",
    dataKey: "macroRows",
    isIncluded: Array.isArray,
    normalize: normalizePayloadRecords,
    validate: (value) => runtimeSeriesQualityGateModule.validateSnapshotComponent("macro", value).ok,
  },
  credit: {
    snapshotKey: "creditRows",
    dataKey: "creditRows",
    isIncluded: Array.isArray,
    normalize: normalizeCreditRows,
    validate: (value) => runtimeSeriesQualityGateModule.validateSnapshotComponent("credit", value).ok,
  },
  adr: {
    snapshotKey: "adrRows",
    dataKey: "adrRows",
    isIncluded: Array.isArray,
    normalize: normalizePayloadRecords,
    validate: (value) => runtimeSeriesQualityGateModule.validateSnapshotComponent("adr", value).ok,
  },
  crisis: {
    snapshotKey: "crisisRows",
    dataKey: "crisisRows",
    isIncluded: Array.isArray,
    normalize: normalizeCrisisSignalRows,
    validate: (value) => runtimeSeriesQualityGateModule.validateSnapshotComponent("crisis", value).ok,
  },
  disclosure: {
    snapshotKey: "disclosureRows",
    dataKey: "disclosureRows",
    isIncluded: Array.isArray,
    normalize: sanitizeDisclosureRows,
  },
});

function getSnapshotComponent(name) {
  return runtimeSnapshotRevisionTracker.getComponent(
    name,
    () => runtimeSnapshotComponentContract.normalizeCurrent(name, appData),
  );
}

async function buildRuntimeDataSnapshot(taskContext = null) {
  if (!hasRuntimeDataLoaded() && !appData.disclosureRows.length) return null;
  const revisions = getDataRevisions();
  const persistedRevisions = getRuntimeSnapshotController().persistedRevisions();
  const components = {};
  for (const name of Object.keys(RUNTIME_SNAPSHOT_COMPONENT_KEYS)) {
    if (Number(persistedRevisions[name]) === Number(revisions[name])) continue;
    components[name] = getSnapshotComponent(name);
    await taskContext?.checkpoint?.();
  }
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
  return runtimeSnapshotControllerModule.buildCompactSnapshot({
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
  return runtimeSnapshotControllerModule.buildSignature(
    historicalDataLoaded,
    Object.keys(RUNTIME_SNAPSHOT_COMPONENT_KEYS),
    getDataRevisions(),
  );
}

function isRuntimeSnapshotUsable(snapshot) {
  return runtimeSnapshotControllerModule.isSnapshotUsable(snapshot, {
    schemaVersion: DATA_CACHE_SCHEMA_VERSION,
    futureToleranceMs: DAY_MS,
    maxAgeMs: DATA_CACHE_MAX_AGE_DAYS * DAY_MS,
  });
}

function applyRuntimeDataSnapshot(snapshot) {
  if (!isRuntimeSnapshotUsable(snapshot)) return false;
  const restored = runtimeSnapshotComponentContract.prepareRestore(snapshot);
  if (!restored.ok) return false;

  Object.assign(DISPLAY_NAMES, restored.values.price?.display_names || {});
  appData.patch(restored.patch, { silent: true });
  const loadedNames = [...restored.loadedNames];
  applySnapshotRevisions(snapshot.revisions, loadedNames);
  loadedNames.forEach((name) => {
    runtimeSnapshotRevisionTracker.seedComponent(name, restored.values[name]);
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
    appData.pricePayload?.records?.length
    || appData.macroRows?.length
    || appData.creditRows?.length
    || appData.adrRows?.length
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

const readIndexedDbRecordMetadata = (storeName, fields) => (
  indexedCacheStore.readRecordMetadata(storeName, fields)
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
    tickerSeriesCacheRetentionInitPromise = readIndexedDbRecordMetadata(
      TICKER_PRICE_CACHE_STORE_NAME,
      ["ticker", "lastAccessed", "savedAt"],
    )
      .then((records) => {
        tickerSeriesCacheRetention.initialize(records.map((record) => ({
          ...record,
          ticker: String(record?.ticker || record?.key || ""),
        })));
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

function readRuntimeSnapshotFromLocalStorage() {
  return runtimeSnapshotLocalStore.read(null);
}

function getAdminFeatureAccess() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.adminFeatureAccess, () => (
    adminFeatureAccessModule.createAdminFeatureAccess(globalThis, {
      sessionKey: ADMIN_SESSION_STORAGE_KEY,
      deviceKey: ADMIN_DEVICE_STORAGE_KEY,
      requestSession: requestAdminSession,
      buttonIds: ADMIN_FEATURE_BUTTON_IDS,
      controlsReady: () => adminFeatureControlsReady,
      getElement: (id) => document.getElementById(id),
      onStateChange: (enabled) => { adminAccessGranted = Boolean(enabled); },
    })
  ));
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
  chartSession.showEps = false;
  chartSession.showRecessionSignals = false;
  chartSession.showCoMovement = false;
  chartSession.showInsiderTrades = false;
  if (chartSession.showAiForecast) aiForecastToggleRevision += 1;
  chartSession.showAiForecast = false;
  refreshAiForecastTargets();
  getFutureOverlayController().reset({ trim: true });
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
  syncEpsToggleButton();
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
    || appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartCursorSync)?.isBusy?.()
    || appRuntimeRegistry.peek(APP_RUNTIME_KEYS.viewportRelayout)?.isBusy?.()
  );
}

function getRuntimeSnapshotController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.runtimeSnapshot, () => (
    runtimeSnapshotControllerModule.createRuntimeSnapshotController(globalThis, {
      idleTimeoutMs: SNAPSHOT_SAVE_IDLE_TIMEOUT_MS,
      scheduler: backgroundTaskScheduler,
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
    })
  ));
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

async function clearAllAppCaches(cacheManager = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.appCacheManager)) {
  if (!cacheManager?.clear) throw new Error("캐시 관리 기능을 준비하지 못했습니다.");
  await getRuntimeSnapshotController().prepareForClear();
  try {
    await appRuntimeRegistry.peek(APP_RUNTIME_KEYS.stockResearch)
      ?.clearCache({ bypassSummary: false, clearHistory: false });
  } catch (_) {}
  await cacheManager.clear();
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
    const allowMockedE2eRequest = __THINKSTOCK_E2E_DIAGNOSTICS__ && IS_E2E_RUNTIME;
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
function visibleEpsTickers() {
  const modelTickers = (chartSession.currentMainChartModel?.seriesModels || [])
    .map((model) => String(model?.series || "").trim().toUpperCase());
  const candidates = modelTickers.length
    ? modelTickers
    : customStocks.map((stock) => String(stock?.ticker || "").trim().toUpperCase());
  return [...new Set(candidates)].filter((ticker) => STOCK_TICKER_PATTERN.test(ticker)
    && !chartSession.hiddenSeries.has(ticker));
}
function syncEpsToggleButton() {
  const pendingCount = visibleEpsTickers()
    .filter((ticker) => aiAnalysisPendingTickers.has(ticker)).length;
  controlStateView.syncControl(document.getElementById("epsToggle"), {
    active: chartSession.showEps,
    pressed: chartSession.showEps,
    busy: chartSession.showEps && pendingCount > 0,
    text: "EPS",
    title: chartSession.showEps
      ? (pendingCount > 0 ? `EPS 자료 준비 중 - ${pendingCount}개` : "분기 EPS 흐름 켜짐")
      : "분기 EPS 흐름",
  });
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
    pricePayload: appData.pricePayload,
    macroRows: appData.macroRows,
    creditRows: appData.creditRows,
    adrRows: appData.adrRows,
    crisisRows: appData.crisisRows,
    creditKeys: CREDIT_COLS,
    adrKeys: ADR_SERIES,
    fearGreedKeys: FEAR_GREED_SERIES,
    volatilityKeys: VOLATILITY_SERIES,
  });
}

async function fetchLatestKrxTickerSeriesBatch(tickers, options = {}) {
  return getRuntimeBootstrapService().fetchLatestPriceSeriesBatch(tickers, options);
}

function ensureSettingsPanelRuntime() {
  return appRuntimeRegistry.getAsync(APP_RUNTIME_KEYS.settingsPanel, async () => {
    const feature = await optionalFeatureRuntime.ensureSettings();
    if (!feature?.runtime?.createSettingsPanelRuntime
      || !feature.apiPeriods
      || !feature.cacheManager?.createAppCacheManager
      || !feature.releaseNotes) {
      throw new Error("Settings panel modules are not loaded");
    }
    const appCacheManager = appRuntimeRegistry.get(APP_RUNTIME_KEYS.appCacheManager, () => (
      feature.cacheManager.createAppCacheManager(globalThis, {
        indexedCacheStore,
        indexedStoreNames: APP_CACHE_INDEXED_STORE_NAMES,
        localStorageKeys: APP_CACHE_LOCAL_STORAGE_KEYS,
        cacheNamePrefix: "thinkstock-",
      })
    ));
    return feature.runtime.createSettingsPanelRuntime(globalThis, {
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
      apiPeriodsModule: feature.apiPeriods,
      releaseNotesModule: feature.releaseNotes,
      appCacheManager,
      controlStateView,
      authenticateAdminAccess,
      clearAdminAccessState,
      clearAllAppCaches: () => clearAllAppCaches(appCacheManager),
      dartGatewaySettingsStore,
      deferredPerformanceDiagnostics,
      disclosureRefreshStore,
      getAdminAccessGranted: () => adminAccessGranted,
      getBlockedStockCount: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.stockResearch)
        ?.getBlockedCount?.() || 0,
      getCursorLineMode: () => chartSession.cursorLineMode,
      getChartRightPaddingDays: () => chartSession.chartRightPaddingDays,
      getNewsSentimentMovingAverageDays: () => chartSession.newsSentimentMovingAverageDays,
      getStockResearchUniverseSize: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.stockResearch)
        ?.getUniverseSize?.()
        ?? stockResearchContract.UNIVERSE_SIZE_DEFAULT,
      getDartGatewayAccessToken,
      getRuntimeDiagnosticState: buildRuntimeDiagnosticAppState,
      resetStoredAppState,
      setMessage,
      setCursorLineMode,
      setChartRightPaddingDays,
      setNewsSentimentMovingAverageDays,
      setStockResearchUniverseSize: (value) => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.stockResearch)
        ?.setUniverseSize?.(value)
        ?? stockResearchContract.UNIVERSE_SIZE_DEFAULT,
      syncApiOptionsButton,
      validateDartGatewayAccessToken,
    });
  });
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
  ensureSettingsPanelRuntime()
    .then((runtime) => runtime.scheduleApiPeriodReminder())
    .catch((error) => recordRuntimeError("settings-reminder-load", error));
}

function hasHistoricalDataCoverage() {
  return runtimeSnapshotControllerModule.hasCoreHistoricalCoverage({
    price: appData.pricePayload?.records,
    macro: appData.macroRows,
    credit: appData.creditRows,
  }, RECENT_DATA_MONTHS);
}


function getChartHoverRuntime() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartHover, () => (
    chartHoverRuntimeModule.createChartHoverRuntime(globalThis, {
    findNearestHoverPoint,
    getTraceTimeMsArray,
    toMsSafe,
    onSyncingChange: (value) => { hoverSyncing = Boolean(value); },
    })
  ));
}

function syncHoverToChart(targetEl, xValue) {
  getChartHoverRuntime().syncHoverToChart(targetEl, xValue);
}

function normalizeHoverPopupIndent(targetEl) {
  return getChartHoverRuntime().normalizeHoverPopupIndent(targetEl);
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
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartCursorSync, () => (
    chartCursorSyncModule.createCursorSyncController(window, {
    geometryTtlMs: CHART_GEOMETRY_CACHE_MS,
    getMode: () => chartSession.cursorLineMode,
    getTargets: () => [
      document.getElementById("chart"),
      document.getElementById("chart-macd"),
      document.getElementById("chart-adr"),
    ].filter((element) => element && !element.hidden),
    })
  ));
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
  if (!chartSession.showAiForecast && !chartSession.showEps) return extendChartRangeRight(observedRange);
  const forecastRange = chartFutureOverlayRangeCache.get(sourceEl);
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
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartNavigation, () => (
    chartNavigationAppModule.createChartNavigation(globalThis, {
    viewport: chartViewportControllerModule,
    dayMs: DAY_MS,
    minimumSpan: MIN_CHART_VIEW_SPAN_MS,
    getElement: () => document.getElementById("chart"),
    getMessageElement: () => document.getElementById("chartNavigationMessage"),
    getCurrentRange: getCurrentXRangeMs,
    getDataRange: getChartNavigationDataRangeMs,
    isHistoryReady: () => historicalDataLoaded
      && hasHistoricalDataCoverage()
      && visibleCustomTickerHistoriesReady(),
    loadHistory: async () => {
      const [sharedReady, tickerReady] = await Promise.all([
        ensureHistoricalDataLoaded(false),
        ensureVisibleCustomTickerHistoriesReady(),
      ]);
      return sharedReady && tickerReady;
    },
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
      chartSession.pendingCompositionViewport = null;
      saveState();
    },
    requestRender: ({ preserveZoom = true, range = null, ...requestOptions } = {}) => {
      const request = () => requestChartRender(preserveZoom, {
        deferDuringInteraction: false,
        ...requestOptions,
      });
      // A range preset first changes Plotly's visible range, then rebuilds the
      // buffered viewport. Rendering before the relayout settles would sample
      // the old window and leave the newly revealed history empty.
      if (requestOptions.reason === "range-preset") {
        const requestedRange = Array.isArray(range) && range.length === 2
          ? range.map(Number)
          : null;
        return getChartRangeSyncController().flush().then(() => {
          request();
          return getMainChartRenderScheduler().whenSettled();
        }).then(async () => {
          if (requestedRange?.every(Number.isFinite) && requestedRange[1] > requestedRange[0]) {
            chartSession.pinnedXRange = requestedRange.map((value) => new Date(value).toISOString());
            getChartRangeSyncController().schedule(requestedRange[0], requestedRange[1], {
              source: "range-preset-finalize",
              fit: false,
              liveFit: chartSession.autoChartReset,
              userInitiated: false,
            });
            await getChartRangeSyncController().flush();
          }
          await refreshLoadedChartCompanions();
        });
      }
      return request();
    },
    shiftMonths,
    toMilliseconds: toUtcMs,
    })
  ));
}

async function settleChartViewport() {
  await appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartNavigation)?.whenRangeSettled?.();
  await appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartRangeSync)?.flush?.();
  await appRuntimeRegistry.peek(APP_RUNTIME_KEYS.mainChartScheduler)?.whenSettled?.();
  await appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartRangeSync)?.flush?.();
  flushLoadedCoMovementPanel();
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

function getFutureOverlayController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.futureOverlay, () => (
    chartViewportControllerModule.createFutureOverlayController({
      toMilliseconds: toMsSafe,
      getPinnedRange: () => chartSession.pinnedXRange,
      getCurrentRange: () => getCurrentXRangeMs(document.getElementById("chart")),
      getInteractionRevision: () => chartViewportInteractionRevision,
      getUserViewportPinned: () => chartSession.userViewportPinned,
      clampToObservedData: clampChartViewportToObservedData,
    })
  ));
}

function finishFutureOverlayDisable(kind) {
  return getFutureOverlayController().disable(kind, {
    ai: chartSession.showAiForecast,
    eps: chartSession.showEps,
  });
}

function addViewportYRangeToRelayout(targetEl, payload) {
  return appRuntimeRegistry.peek(APP_RUNTIME_KEYS.auxiliaryChart)
    ?.addViewportYRangeToRelayout?.(targetEl, payload) || payload;
}

function getChartRangeSyncController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartRangeSync, () => (
    chartViewportControllerModule.createLinkedRangeSyncController(window, {
      applyRange: async ({ startMs, endMs, meta }) => {
        if (meta?.source === "range-preset") {
          const renderScheduler = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.mainChartScheduler);
          if (renderScheduler?.isRendering()) await renderScheduler.whenSettled();
        }
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
        let refreshViewportMarkers = false;
        if (updateMain && meta?.liveFit && chartSession.autoChartReset) {
          const primaryTraces = mainEl.data.filter((trace) => (
            trace?.meta?.seriesKey
            && !trace?.meta?.isDisclosureTrace
            && !trace?.meta?.isInsiderTradeTrace
            && !trace?.meta?.isGroupedHoverTrace
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
            invalidateChartInteractionCaches(mainEl);
            refreshViewportMarkers = chartSession.showDisclosures
              || chartSession.showInsiderTrades
              || chartSession.showRecessionSignals;
          }
        }
        // Keep the main chart on the interaction-critical path. Companion Plotly
        // charts consume only their newest queued range, so a slow auxiliary
        // relayout cannot throttle the next main pan or pinch frame.
        if (updateMain) {
          await plotlyUpdateRuntime.relayout(mainEl, mainPayload, {
            label: "viewport-range-sync-main",
          });
        }
        if (updateMacd) scheduleViewportRangeSync(macdEl, payload);
        if (updateAdr) scheduleViewportRangeSync(adrEl, payload);
        recordPerfSample("viewportRangeSync", perfStartedAt, {
          main: updateMain,
          macd: updateMacd,
          auxiliary: updateAdr,
          liveFit: Boolean(meta?.liveFit),
          companionsQueued: Number(updateMacd) + Number(updateAdr),
        });
        if (updateMain) {
          chartVisualFrameCoordinator?.schedule({
            markers: refreshViewportMarkers,
            handles: true,
            reason: "viewport-axis-range",
          });
        }
        if (chartSession.showCoMovement) renderCoMovementPanel({ deferred: true });
        if (meta?.fit !== false) applyChartResetPolicy("viewport");
      },
      getCompanionQueue: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.viewportRelayout),
      onError: (error) => recordRuntimeError("chart-range-sync", error),
    })
  ));
}

function applySyncedXRangeMs(startMs, endMs, meta = {}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;
  if (appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartNavigation)?.isAnimating()
    && meta.source !== "latest-slide") {
    cancelLatestViewportAnimation();
  }
  appRuntimeRegistry.peek(APP_RUNTIME_KEYS.viewportRelayout)?.cancelPending?.();
  chartSession.pinnedXRange = [new Date(startMs).toISOString(), new Date(endMs).toISOString()];
  if (meta.userInitiated !== false) {
    chartViewportInteractionRevision += 1;
    captureViewportNormalizationFrame();
    chartSession.userViewportPinned = true;
  }
  scheduleViewportWindowRender(startMs, endMs);
  return getChartRangeSyncController().schedule(startMs, endMs, meta);
}

function scheduleHandleUpdate(delay = HANDLE_UPDATE_DEBOUNCE_MS) {
  if (handleUpdateTimer) clearTimeout(handleUpdateTimer);
  handleUpdateTimer = 0;
  const scheduleFrame = () => chartVisualFrameCoordinator.schedule({
    handles: true,
    reason: "handle-update",
  });
  if (delay > 0) {
    handleUpdateTimer = setTimeout(() => {
      handleUpdateTimer = 0;
      scheduleFrame();
    }, delay);
    return;
  }
  scheduleFrame();
}

function getViewportRelayoutQueue() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.viewportRelayout, () => (
    chartUpdateCoordinatorModule.createLatestKeyedFrameQueue(window, {
      apply: async (pending) => {
        const entries = pending.flatMap(({ targetEl: el, payload: nextPayload }) => {
          if (!el?.data) return null;
          const r0 = nextPayload["xaxis.range[0]"];
          const r1 = nextPayload["xaxis.range[1]"];
          if (r0 != null && r1 != null && xRangeMatches(el, r0, r1)) return [];
          return [{
            element: el,
            payload: addViewportYRangeToRelayout(el, nextPayload),
          }];
        });
        if (!entries.length) return;
        await plotlyUpdateRuntime.relayoutMany(entries, {
          label: "viewport-relayout-queue",
          settle: true,
        });
        chartVisualFrameCoordinator?.schedule({
          handles: true,
          reason: "viewport-relayout",
        });
      },
      onError: (error) => recordRuntimeError("viewport-relayout-queue", error),
    })
  ));
}

function scheduleViewportRangeSync(targetEl, payload) {
  if (!targetEl?.data || !payload) return;
  getViewportRelayoutQueue().schedule(targetEl.id || "auxiliary", { targetEl, payload });
}

function syncInsiderTradeToggleButton() {
  const button = document.getElementById("insiderTradeToggle");
  if (!button) return;
  const pending = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartEvents)?.pendingInsiderCount?.() || 0;
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
  return getChartTargetRuntime().findNearestLineDragTarget(
    el,
    clientX,
    clientY,
    isTouch,
    geometry,
  );
}
function findAiForecastReportAtClientPoint(el, clientX, clientY, isTouch = false, geometry = null) {
  return getChartTargetRuntime().findAiForecastReportAtClientPoint(
    el,
    clientX,
    clientY,
    isTouch,
    geometry,
  );
}

function openAiForecastReportHit(el, hit, sourceEvent) {
  return getChartTargetRuntime().openAiForecastReportHit(el, hit, sourceEvent);
}

function clearSeriesTransformsAndInvalidate(seriesKey = "") {
  const changed = chartSessionControllerModule.clearSeriesTransforms(chartSession, seriesKey);
  if (!changed) return false;
  mainChartCalcCache.clear();
  mainChartRenderer.invalidateRenderFingerprint(document.getElementById("chart"));
  return true;
}

function clearAutoResetSeriesTransforms(seriesKey = "") {
  if (!chartSession.autoChartReset) return false;
  return clearSeriesTransformsAndInvalidate(seriesKey);
}

function clearRemovedSeriesTransforms(seriesKey) {
  return clearSeriesTransformsAndInvalidate(seriesKey);
}

function getChartSessionController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartSession, () => (
    chartSessionControllerModule.createChartSessionController(globalThis, {
    state: chartSession,
    getVisibleRange: () => getCurrentXRangeMs(document.getElementById("chart")),
    clearTransforms: () => clearAutoResetSeriesTransforms(),
    captureLockedRange: captureLockedHistoryYRange,
    fitCurrentViewport: fitCurrentChartRatio,
    isInteractionBusy: () => isViewportDragging || isHandleDragging,
    })
  ));
}

function applyChartResetPolicy(change, delay = 100) {
  return getChartSessionController().applyResetPolicy(change, delay);
}

function setAutoChartReset(enabled) {
  const transformedSeries = enabled ? [...new Set([
    ...Object.keys(chartSession.seriesOffsets || {}),
    ...Object.keys(chartSession.seriesScales || {}),
  ])] : [];
  const result = getChartSessionController().setAutoScale(enabled);
  if (result.enabled) {
    // Keep event spacing tied to the visible axis while the reset render fits
    // that same viewport. Falling back to the buffered data span can place
    // markers far from their line after a zoomed auto-scale reset.
    useViewportEventMarkerGap = true;
    // Restore the visible traces immediately. The full model refresh can finish in
    // the background without leaving a transformed line on screen in the meantime.
    const element = document.getElementById("chart");
    transformedSeries.forEach((seriesKey) => {
      const traceIndex = mainSeriesTraceIndex(element, seriesKey);
      if (traceIndex >= 0) {
        restyleLive(traceIndex, seriesKey, { commit: true });
      }
    });
    if (transformedSeries.length) chartVisualFrameCoordinator.flush();
  }
  return result;
}

function isInteractiveChartMarkerTrace(trace) {
  return getChartTargetRuntime().isInteractiveEventMarkerTrace(trace);
}

function findEventMarkerAtClientPoint(el, clientX, clientY, isTouch = false, geometry = null) {
  return getChartTargetRuntime().findEventMarkerAtClientPoint(
    el,
    clientX,
    clientY,
    isTouch,
    geometry,
  );
}

function openEventMarkerHit(el, hit, sourceEvent) {
  return getChartTargetRuntime().openEventMarkerHit(el, hit, sourceEvent);
}

function getTraceBaseLineWidth(trace) {
  const metaWidth = toNum(trace?.meta?.baseLineWidth);
  if (metaWidth !== null) return metaWidth;
  const lineWidth = toNum(trace?.line?.width);
  return lineWidth !== null ? lineWidth : 1;
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
  const nextWidth = chartEventLayerModule.interactiveLineWidth(baseWidth, highlighted);
  const paths = getTraceLinePaths(el, traceIndex);
  const group = paths[0]?.closest(".trace.scatter");
  if (trace.meta?.isEpsTrace && group) group.classList.toggle("is-eps-point-highlighted", highlighted);
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
    .filter((ticker) => STOCK_TICKER_PATTERN.test(ticker) && !chartSession.hiddenSeries.has(ticker));
}

function mainChartSeriesKeys() {
  return [
    ...CORE_SERIES,
    ...customStocks.map((item) => String(item?.ticker || "").toUpperCase()),
  ];
}

function getMainSeriesController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.mainSeries, () => (
    chartSessionControllerModule.createMainSeriesController({
    hiddenSeries: chartSession.hiddenSeries,
    maximumVisible: MAX_VISIBLE_MAIN_SERIES,
    getSeriesKeys: mainChartSeriesKeys,
    onLimit: () => showChartNavigationMessage(MAX_VISIBLE_MAIN_SERIES_MESSAGE, 3000),
    })
  ));
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
    (key) => STOCK_TICKER_PATTERN.test(key),
  );
  return lastVisibleStockSeriesKey;
}

function noteStockVisibilityChange(seriesKey) {
  const ticker = String(seriesKey || "").toUpperCase();
  if (!STOCK_TICKER_PATTERN.test(ticker)) return;
  if (chartSession.hiddenSeries.has(ticker)) {
    if (lastVisibleStockSeriesKey === ticker) lastVisibleStockSeriesKey = "";
  } else {
    lastVisibleStockSeriesKey = ticker;
  }
}

function selectCoMovementTarget(seriesKey) {
  const ticker = String(seriesKey || "").toUpperCase();
  if (!chartSession.showCoMovement || !STOCK_TICKER_PATTERN.test(ticker) || chartSession.hiddenSeries.has(ticker)) return;
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
    requestChartRender(true, {
      deferDuringInteraction: false,
      reason: "cursor-line-mode",
      updateClass: "viewport",
    });
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
  return chartViewportControllerModule.resolve(chartSession.showChartHandles).mainMargin;
}

function auxiliaryChartHorizontalMargin() {
  return chartViewportControllerModule.resolve(chartSession.showChartHandles).auxiliaryMargin;
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
  await plotlyUpdateRuntime.relayoutMany(charts.map((chart) => ({
    element: chart,
    payload: { "margin.l": margin, "margin.r": margin },
  })), { label: "chart-handle-layout", settle: true });
  if (chartSession.showChartHandles) scheduleHandleUpdate(0);
}

function syncRecessionToggleButton() {
  return mainChartControlView.syncSignal();
}

function syncCoMovementToggleButton() {
  return mainChartControlView.syncCoMovement();
}

async function getCoMovementPanelController() {
  return appRuntimeRegistry.getAsync(APP_RUNTIME_KEYS.coMovementPanel, async () => {
    const coMovementModule = await optionalFeatureRuntime.ensureCoMovement();
    return coMovementModule.createPanelController(window, {
      panel: document.getElementById("coMovementPanel"),
      syncControl: syncCoMovementToggleButton,
      readState: () => {
        const targetKey = resolveCoMovementTarget();
        const model = chartSession.currentMainChartModel;
        const pinnedRange = Array.isArray(chartSession.pinnedXRange)
          ? chartSession.pinnedXRange.slice(0, 2).map(toMsSafe)
          : null;
        return {
          enabled: chartSession.showCoMovement,
          targetKey,
          targetName: labelName(targetKey),
          rows: model?.rows,
          revision: model?.renderRevision,
          range: pinnedRange?.length === 2 && pinnedRange.every(Number.isFinite)
            ? pinnedRange
            : getCurrentXRangeMs(document.getElementById("chart")),
          requestedMonths: chartSession.activeMonths,
          comparisons: CO_MOVEMENT_COMPARISONS,
        };
      },
    });
  });
}

async function renderCoMovementPanel(options = {}) {
  if (!chartSession.showCoMovement) {
    const panel = document.getElementById("coMovementPanel");
    if (panel) panel.hidden = true;
    syncCoMovementToggleButton();
    return null;
  }
  try {
    const controller = await getCoMovementPanelController();
    return options.deferred === true
      ? controller.requestDeferred()
      : controller.request();
  } catch (error) {
    recordRuntimeError("co-movement-panel", error);
    return null;
  }
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

function beginSeriesTransformInteraction({ element, handle, lineTarget, trackHandlePointer = false } = {}) {
  const lockedXRange = getCurrentMainXRange();
  isHandleDragging = true;
  if (trackHandlePointer) isHandlePointerActive = true;
  handle?.classList.add("dragging");
  if (lineTarget) {
    setActiveLineTarget(lineTarget);
    element?.classList.add("is-line-dragging");
    clearHoverOnChart(element);
  }
  lockCurrentYAxisRange();
  return lockedXRange;
}

function endSeriesTransformInteraction({ element, handle, lineTarget, trackHandlePointer = false, lockedXRange } = {}) {
  handle?.classList.remove("dragging");
  if (lineTarget) {
    clearHoverOnChart(element);
    element?.classList.remove("is-line-dragging");
    setActiveLineTarget(null);
  }
  isHandleDragging = false;
  if (trackHandlePointer) isHandlePointerActive = false;
  if (lockedXRange) chartSession.pinnedXRange = [...lockedXRange];
}

function beginLineOffsetDrag(el, target, startClientY, pointerId) {
  const ya = el?._fullLayout?.yaxis;
  const range = ya?.range;
  if (!target || !ya || !Array.isArray(range) || range.length < 2 || !ya._length) return false;

  suppressPlotlyClickUntil = Date.now() + 500;
  return getSeriesTransformGestureRuntime().startOffset({
    pointerId,
    startClientY,
    traceIndex: target.traceIndex,
    seriesKey: target.seriesKey,
    axis: ya,
    beginOptions: { element: el, lineTarget: target },
    onClick: ({ startValue }) => {
      chartSession.seriesOffsets[target.seriesKey] = startValue;
      restyleLive(target.traceIndex, target.seriesKey, { commit: true });
      finishTraceYEdit(false, target.seriesKey, { preserveTransform: true });
      selectCoMovementTarget(target.seriesKey);
    },
    onCommit: () => finishTraceYEdit(true, target.seriesKey, { preserveTransform: true }),
  });
}

function getChartPointerRuntime() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartPointer, () => {
    const interactionState = {
      get handleDragging() { return isHandleDragging; },
      get viewportDragging() { return isViewportDragging; },
      set viewportDragging(value) { isViewportDragging = Boolean(value); },
      get wheelZooming() { return isWheelZooming; },
      set wheelZooming(value) { isWheelZooming = Boolean(value); },
      get suppressPlotlyClickUntil() { return suppressPlotlyClickUntil; },
      set suppressPlotlyClickUntil(value) { suppressPlotlyClickUntil = Number(value) || 0; },
    };
    return chartPointerRuntimeModule.createChartPointerRuntime(globalThis, {
      CHART_GEOMETRY_CACHE_MS,
      DAY_MS,
      HOVER_IDLE_DELAY_MS,
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
      findEventMarkerAtClientPoint,
      findNearestLineDragTarget,
      getChartCursorSyncController,
      getChartInteractionGeometry,
      getChartNavigationDataRangeMs,
      getChartRangeSyncController,
      getCurrentXRangeMs,
      hideDisclosurePopover,
      interactionState,
      isCurrentRange: (element, start, end) => xRangeMatches(element, start, end),
      isTouchDevice,
      latestPointerSample,
      nearestMainLineDate,
      openAiForecastReportHit,
      openEventMarkerHit,
      recordPerfSample,
      resetEventMarkerHoverHighlight,
      scheduleEventMarkerHoverHighlight,
      scheduleSyncedCursor,
      setHoveredLineTarget,
      showChartNavigationMessage,
      startPerfSample,
      syncHoverToChart,
      zoomChartViewport,
    });
  });
}

function bindCursorMoveSync() {
  getChartPointerRuntime().bind();
}


const {
  normalizePayloadRecords,
  rowsFromColumnarPayload,
  parsePayloadText,
  parseMacroPayload,
  normalizeDisclosureRows: normalizeDisclosureSeedRows,
} = dataPayloadModule;

function getSeriesPriorityOrder() {
  const customOrder = customStocks.map((item) => item.ticker);
  return [
    ...CORE_SERIES,
    ...customOrder,
    ...SUPPLEMENTAL_SERIES,
  ];
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
  if (document.documentElement.dataset.seriesToggleBound === "1") return;
  document.documentElement.dataset.seriesToggleBound = "1";
  document.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".series-toggle-btn");
    if (!btn || btn.disabled) return;
    const key = btn.dataset.series;
    if (!key) return;
    const becomingVisible = chartSession.hiddenSeries.has(key);
    if (becomingVisible) {
      if (!setMainChartSeriesVisible(key, true)) return;
      clearAutoResetSeriesTransforms(key);
    } else {
      setMainChartSeriesVisible(key, false);
    }
    noteStockVisibilityChange(key);
    setAiForecastTargetVisibility(key, becomingVisible);
    if (becomingVisible && STOCK_TICKER_PATTERN.test(String(key).toUpperCase())) {
      const stock = customStocks.find((item) => item.ticker === key);
      const displayName = stock?.name || DISPLAY_NAMES[key] || key;
      ensureCustomTickerSeriesLoaded(key, { displayName, returnAfterCache: true })
        .then((initialLoad) => {
          requestChartCompositionUpdate();
          if (!initialLoad?.deferredRefresh) return;
          scheduleVisibleStockHistoryRefresh(key, displayName);
        })
        .catch(() => {});
    } else if (!becomingVisible && STOCK_TICKER_PATTERN.test(String(key).toUpperCase())) {
      cancelVisibleStockHistoryRefresh(key);
    }
    if (becomingVisible && chartSession.showAiForecast && isForecastSeries(String(key).toUpperCase())) {
      startAiForecastProgress();
      if (STOCK_TICKER_PATTERN.test(String(key).toUpperCase())) {
        refreshAiAnalysisForVisibleSeries().catch(() => {});
      }
    }
    requestChartCompositionUpdate();
  });
}

function getStockSelectionView() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.stockSelection, () => (
    appUiBindingsModule.createStockSelectionView(globalThis, {
      escapeHtml,
      seriesColor,
      onRemove: removeCustomStock,
    })
  ));
}

function renderCustomStockButtons() {
  getStockSelectionView().renderStocks(customStocks);
  bindSeriesToggleBoard();
}

function removeCustomStock(ticker) {
  if (!getCustomStockLifecycle().remove(ticker)) return;
  cancelVisibleStockHistoryRefresh(ticker);
  cancelTickerDartRequests(ticker);
  epsRefreshOnNextAdd.add(String(ticker || "").trim().toUpperCase());
  if (lastVisibleStockSeriesKey === ticker) lastVisibleStockSeriesKey = "";
  chartSession.hiddenSeries.delete(ticker);
  clearRemovedSeriesTransforms(ticker);
  delete DISPLAY_NAMES[ticker];
  setAiForecastTargetVisibility(ticker, false);
  clearTickerSeriesFromPricePayload(ticker);
  renderCustomStockButtons();
  requestChartCompositionUpdate();
}

function clearTickerSeriesFromPricePayload(ticker) {
  tickerPriceAppRuntime.clearSeries(ticker);
}

let krxUniversePromise = null;

async function ensureKrxUniverseLoaded() {
  if (krxUniverseLoaded && krxUniverse.length) return;
  if (krxUniversePromise) {
    await krxUniversePromise;
    return;
  }

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

const tickerPriceAppRuntime = createTickerPriceAppRuntime({
  tickerPriceRuntime: tickerPriceRuntimeModule,
  tickerCacheInvalidation: tickerCacheInvalidationModule,
  cacheLifecycle: cacheLifecyclePolicyModule,
  requestRegistry: appRequestRegistry,
  getPayload: () => appData.pricePayload,
  setPayload: (value) => { appData.pricePayload = value; },
  volumesByTicker: tickerVolumeSeriesByTicker,
  toNumber: toNum,
  sameNumber: sameNullableNumber,
  normalizePricePoints: normalizeTickerPricePoints,
  isMarketPricePoint: isKoreanMarketPricePoint,
  expectedLatestTradingDate: expectedLatestKoreanTradingDate,
  isTradingDate: isKoreanTradingDate,
  historyOverlapDays: 21,
  getDisplayName: (ticker) => DISPLAY_NAMES[ticker] || "",
  setDisplayName: (ticker, value) => { DISPLAY_NAMES[ticker] = value; },
  onClearSeries: invalidateAiForecastCache,
  onPayloadChanged: () => appData.touch("pricePayload"),
  assertPricePoints: (assertOptions) => runtimeSeriesQualityGateModule.assertPricePoints(assertOptions),
  getStatus: (ticker) => tickerPriceStatusStore.get(ticker),
  setStatus: setTickerPriceStatus,
  priceStoreName: TICKER_PRICE_CACHE_STORE_NAME,
  researchStoreName: TICKER_RESEARCH_HISTORY_STORE_NAME,
  cacheSchema: GRANULAR_CACHE_SCHEMA_VERSION,
  ensureRetention: ensureTickerSeriesCacheRetention,
  retention: tickerSeriesCacheRetention,
  runCacheMutation: runTickerPriceCacheMutation,
  readLifecycleRecord: readLifecycleCacheRecord,
  readRecords: (storeName, keys) => indexedCacheStore.readRecords(storeName, keys),
  writeRecord: writeIndexedDbRecord,
  writeRecords: (storeName, entries) => indexedCacheStore.writeRecords(storeName, entries),
  deleteRecord: deleteIndexedDbRecord,
  fingerprintDatedSeries: seriesIntegrityModule.fingerprintDatedSeries,
  recordIssue: cacheRecordHealthModule.granularRecordIssue,
  withCacheMetadata: cacheLifecyclePolicyModule.withCacheMetadata,
  normalizeStatus: normalizeTickerPriceStatus,
  clearDerivedMemory: (ticker, context = {}) => {
    const stores = new Set(context.stores || []);
    const sources = new Set(context.changedSources || []);
    if (stores.has(TICKER_AI_ANALYSIS_CACHE_STORE_NAME)) aiAnalysisByTicker.delete(ticker);
    if (stores.has(TICKER_AI_FORECAST_CACHE_STORE_NAME)) invalidateAiForecastCache(ticker);
    if (stores.has(TICKER_TIMING_MODEL_STORE_NAME)) {
      appRuntimeRegistry.peek(APP_RUNTIME_KEYS.marketTiming)?.invalidate?.(ticker);
    }
    if (sources.has("price")) {
      appRuntimeRegistry.peek(APP_RUNTIME_KEYS.aiForecastQuality)?.invalidateTicker?.(ticker);
      macdModelCache.invalidate(ticker);
    }
  },
  fetchHistory: fetchTickerHistorySeries,
  fetchLatest: fetchLatestKrxTickerSeries,
  findRebaseSignal: findTickerPriceRebaseSignal,
  rebaseRatioThreshold: PRICE_CACHE_REBASE_RATIO_THRESHOLD,
  rebaseBoundaryDays: PRICE_CACHE_REBASE_BOUNDARY_DAYS,
  isAbortError,
  throwIfAborted,
  dayMs: DAY_MS,
});

const {
  mergeSeries: mergeTickerSeriesIntoPricePayload,
  latestDate: getLatestTickerDateFromPricePayload,
  points: getTickerPricePointsFromPayload,
  normalizePointsForTicker: normalizeTickerPricePointsForTicker,
  readPriceCache: readTickerPriceCache,
  readResearchHistory: readSharedResearchHistoryCache,
  readResearchHistories: readSharedResearchHistoryCaches,
  writePriceCache: writeTickerPriceCache,
} = tickerPriceAppRuntime;

const tickerIsHidden = (item) => chartSession.hiddenSeries.has(item.ticker);
const visibleCustomTickerHistoriesReady = () => tickerPriceAppRuntime.visibleReady(customStocks, tickerIsHidden);
const ensureVisibleCustomTickerHistoriesReady = () => tickerPriceAppRuntime.ensureVisible(customStocks, tickerIsHidden);
const ensureCustomTickerSeriesLoaded = (ticker, options = {}) => tickerPriceAppRuntime.load(ticker, options);
const runtimeIndexRefreshService = runtimeIndexRefreshModule.createRuntimeIndexRefreshService({
  canUseGateway: canUseDartGateway,
  fetchWithTimeout,
  gatewayClient: runtimeGatewayClient,
  getPricePayload: () => appData.pricePayload,
  isAbortError,
  isLocalRuntime: IS_LOCAL_RUNTIME,
  isRetryableError: runtimeRefreshOrchestratorModule.isRetryableRuntimeError,
  appVersion: APP_VERSION,
  labelName,
  mergeTickerSeries: mergeTickerSeriesIntoPricePayload,
  validateTickerPoints: (ticker, points, validationOptions) => (
    runtimeSeriesQualityGateModule.assertPricePoints({
      ticker,
      currentPayload: appData.pricePayload,
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
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.runtimeBootstrap, () => (
    runtimeBootstrapModule.createRuntimeBootstrapService({
      canUseGateway: canUseDartGateway,
      gatewayClient: runtimeGatewayClient,
      getCustomStocks: () => customStocks,
      getPricePayload: () => appData.pricePayload,
      getTickerStatus: (ticker) => tickerPriceStatusStore.get(ticker),
      isAbortError,
      isHidden: (ticker) => chartSession.hiddenSeries.has(ticker),
      latestDatesByTicker: runtimeIndexRefreshModule.latestDatesByTicker,
      mapWithConcurrency,
      setTickerStatus: setTickerPriceStatus,
      timeoutMs: NETWORK_REQUEST_TIMEOUT_MS,
      toNumber: toNum,
    })
  ));
}

function fetchCriticalRuntimeBootstrap(options = {}) {
  return getRuntimeBootstrapService().fetchCritical(options);
}

async function addCustomStock(candidate, msgEl) {
  const admission = getCustomStockLifecycle().beginAdd(candidate);
  if (!admission.ok) {
    if (admission.reason === "invalid" || admission.reason === "loading") return;
    if (admission.reason === "duplicate") {
      setMessage(msgEl, ["이미 추가된 종목입니다."], true);
      return;
    }
    if (admission.reason === "limit") {
      setMessage(msgEl, [`종목은 최대 ${MAX_CUSTOM_STOCKS}개까지 추가할 수 있습니다.`], true);
    }
    return;
  }
  const stockCandidate = admission.stock;

  if (!stockCandidate) return;

  const trackAiProgress = chartSession.showAiForecast
    && visibleMainChartSeriesKeys().length < MAX_VISIBLE_MAIN_SERIES;
  if (trackAiProgress) {
    aiContextPendingTickers.add(stockCandidate.ticker);
    startAiForecastProgress();
    setAiForecastProgress(5, `${stockCandidate.name} 가격 준비`);
    syncAiForecastToggleButton();
  }
  try {
    DISPLAY_NAMES[stockCandidate.ticker] = stockCandidate.name;
    const initialLoad = await ensureCustomTickerSeriesLoaded(stockCandidate.ticker, {
      displayName: stockCandidate.name,
      returnAfterCache: true,
    });
    if (trackAiProgress && chartSession.showAiForecast) {
      setAiForecastProgress(14, `${stockCandidate.name} 분석 자료 준비`);
    }

    const activateOnAdd = visibleMainChartSeriesKeys().length < MAX_VISIBLE_MAIN_SERIES;
    const committedStock = getCustomStockLifecycle().commitAdd(stockCandidate);
    if (!committedStock) throw new Error("종목 목록 갱신이 중단되었습니다.");
    epsRefreshOnNextAdd.add(stockCandidate.ticker);

    if (activateOnAdd) {
      chartSession.hiddenSeries.delete(stockCandidate.ticker);
      clearAutoResetSeriesTransforms(stockCandidate.ticker);
    } else {
      chartSession.hiddenSeries.add(stockCandidate.ticker);
    }
    setAiForecastTargetVisibility(stockCandidate.ticker, activateOnAdd);
    noteStockVisibilityChange(stockCandidate.ticker);
    renderCustomStockButtons();
    saveState();
    const disclosureTask = preloadTickerDartData(stockCandidate.ticker, msgEl);
    if (activateOnAdd && chartSession.showEps) {
      ensureEpsFeatureModules()
        .then(() => prepareVisibleEpsData({ tickers: [stockCandidate.ticker] }))
        .catch((error) => recordRuntimeError(`eps-add:${stockCandidate.ticker}`, error));
    }
    if (activateOnAdd && chartSession.showAiForecast) {
      if (!aiContextPendingTickers.has(stockCandidate.ticker)) {
        aiContextPendingTickers.add(stockCandidate.ticker);
        startAiForecastProgress();
      }
      setAiForecastProgress(18, `${stockCandidate.name} 공시·실적·컨센서스 준비`);
      Promise.allSettled([
        requestAiAnalysisForTicker(stockCandidate.ticker),
        requestBrokerResearchForTicker(stockCandidate.ticker),
        Promise.resolve(disclosureTask),
        loadAiRotationLeaderSeries(),
      ]).finally(() => {
        aiContextPendingTickers.delete(stockCandidate.ticker);
        syncAiForecastToggleButton();
        if (chartSession.showAiForecast) {
          setAiForecastProgress(38, `${stockCandidate.name} AI 재계산 준비`);
          requestAiForecastRender();
        }
      });
    } else {
      aiContextPendingTickers.delete(stockCandidate.ticker);
      syncAiForecastToggleButton();
      if (trackAiProgress && !aiContextPendingTickers.size) stopAiForecastProgress();
    }
    requestChartCompositionUpdate();
    if (initialLoad?.deferredRefresh) {
      scheduleVisibleStockHistoryRefresh(stockCandidate.ticker, stockCandidate.name);
    }
    if (!activateOnAdd) showChartNavigationMessage(MAX_VISIBLE_MAIN_SERIES_MESSAGE, 3000);
    setMessage(msgEl, [`${stockCandidate.name} 종목이 추가되었습니다.`]);
  } catch (err) {
    aiContextPendingTickers.delete(stockCandidate.ticker);
    syncAiForecastToggleButton();
    if (trackAiProgress && !aiContextPendingTickers.size) stopAiForecastProgress();
    if (!getCustomStockLifecycle().has(stockCandidate.ticker)) {
      delete DISPLAY_NAMES[stockCandidate.ticker];
    }
    setMessage(msgEl, `종목 추가 중 오류가 발생했습니다: ${err.message}`, true);
  } finally {
    getCustomStockLifecycle().finishAdd(stockCandidate.ticker);
  }
}

function setupStockAddPanel(msgEl) {
  appUiBindingsModule.bindStockSearchPanel(globalThis, {
    view: getStockSelectionView(),
    loadUniverse: ensureKrxUniverseLoaded,
    filterUniverse: filterKrxUniverse,
    onSubmit: (item) => addCustomStock(item, msgEl),
    onError: (error) => {
      setMessage(msgEl, `종목 검색 목록을 불러오지 못했습니다: ${error.message}`, true);
    },
  });
}

let customStockPreloader = null;
function getCustomStockPreloader() {
  if (customStockPreloader) return customStockPreloader;
  customStockPreloader = backgroundStockRefreshModule.createCustomStockPreloader({
    visibleConcurrency: CUSTOM_STOCK_PRELOAD_CONCURRENCY,
    getItems: (scope) => getCustomStockLifecycle().select(
      scope,
      (ticker) => chartSession.hiddenSeries.has(ticker),
    ),
    hasExisting: (ticker) => (appData.pricePayload?.records || [])
      .some((row) => toNum(row?.[ticker]) !== null),
    canFetchLatestBatch: canUseDartGateway,
    fetchLatestBatch: fetchLatestKrxTickerSeriesBatch,
    loadSeries: ensureCustomTickerSeriesLoaded,
    setDisplayName: (ticker, name) => { DISPLAY_NAMES[ticker] = name; },
    removeFailed: (failed) => {
      getCustomStockLifecycle().removeMany(failed, { rememberColor: false });
      failed.forEach((ticker) => {
        if (lastVisibleStockSeriesKey === ticker) lastVisibleStockSeriesKey = "";
        chartSession.hiddenSeries.delete(ticker);
        clearRemovedSeriesTransforms(ticker);
        delete DISPLAY_NAMES[ticker];
      });
      renderCustomStockButtons();
      saveState();
    },
    startPerformance: startPerfSample,
    recordPerformance: recordPerfSample,
    isAbortError,
    throwIfAborted,
  });
  return customStockPreloader;
}

function preloadCustomStocks(options = {}) {
  return getCustomStockPreloader().preload(options);
}

function cancelVisibleStockHistoryRefresh(ticker) {
  return getVisibleStockHistoryRefresh().cancel(ticker);
}

function scheduleVisibleStockHistoryRefresh(ticker, displayName = "") {
  return getVisibleStockHistoryRefresh().schedule(ticker, displayName);
}

function getVisibleStockHistoryRefresh() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.visibleStockHistoryRefresh, () => (
    backgroundStockRefreshModule.createVisibleStockHistoryRefresh({
      scheduler: backgroundTaskScheduler,
      preload: preloadCustomStocks,
      hasTicker: (ticker) => getCustomStockLifecycle().has(ticker),
      isVisible: (ticker) => !chartSession.hiddenSeries.has(ticker),
      onUpdated: requestChartCompositionUpdate,
      isAbortError,
      onError: (error, details) => {
        recordRuntimeError(`visible-stock-history:${details.ticker}`, error, {
          displayName: details.displayName,
        });
      },
    })
  ));
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
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartModelWorker, () => (
    chartModelWorkerClientModule.createChartModelWorkerClient(globalThis, {
      workerUrl: () => `./modules/chart-model-worker.mjs?v=${encodeURIComponent(APP_BUILD_VERSION || "dev")}`,
      workerType: "module",
      workerName: "thinkstock-chart-model",
      timeoutMs: 10000,
    })
  ));
}

function mainChartMacroBoundsRows() {
  const revision = [
    dataRevisionSignature("macro"),
    appData.macroRows.length,
    String(appData.macroRows.at(-1)?.date || ""),
  ].join("|");
  if (mainChartMacroBoundsCache.revision !== revision) {
    mainChartMacroBoundsCache = {
      revision,
      rows: appData.macroRows.filter((row) => Number.isFinite(toNum(row?.leading_cycle))),
    };
  }
  return mainChartMacroBoundsCache.rows;
}

function getMainViewportWindowController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.mainViewportWindow, () => (
    chartDisplaySamplerModule.createViewportWindowController(globalThis, {
      bufferRatio: CHART_VIEWPORT_BUFFER_RATIO,
      dayMs: DAY_MS,
      minimumBufferMs: CHART_VIEWPORT_MIN_BUFFER_MS,
      requestRender: ({ outside }) => requestChartRender(true, {
        deferDuringInteraction: !outside,
        reason: "viewport-window",
        updateClass: "viewport",
      }),
    })
  ));
}

function currentEventMarkerArguments(model = chartSession.currentMainChartModel) {
  return getMainViewportWindowController().eventArguments(model, {
    start: chartSession.currentStart || chartSession.currentDataStart,
    end: chartSession.currentEnd || chartSession.currentDataEnd,
  });
}

function scheduleViewportWindowRender(startMs, endMs) {
  return getMainViewportWindowController().schedule(startMs, endMs);
}

function prepareMainChartRenderInputs(el, preserveZoom) {
  const priceRows = appData.pricePayload?.records || [];
  return mainChartModelModule.buildMainChartRenderInputs({
    activeMonths: chartSession.activeMonths,
    boundRows: [mainChartMacroBoundsRows(), appData.creditRows],
    coreSeries: CORE_SERIES,
    customSeries: customStocks.map((item) => item.ticker),
    dateBounds: mainChartRenderer.dateBounds,
    fallbackDate: new Date().toISOString().slice(0, 10),
    hiddenSeries: chartSession.hiddenSeries,
    preservedFrameRange: preserveZoom ? getCurrentXRangeMs(el) : null,
    priceRows,
    resolveDisplayBudget: (visibleSeriesCount) => (
      getMainChartDisplayPointBudget(el, visibleSeriesCount)
    ),
    shiftMonths,
    supplementalSeries: SUPPLEMENTAL_SERIES,
    toUtcMs,
  });
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

function currentFixedChartFrame() {
  return chartSession.viewportNormalizationFrame || (
    chartSession.autoChartReset ? null : chartSession.lockedChartFrame
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
  const fixedFrame = currentFixedChartFrame();
  const fixedFrameSignature = fixedFrame ? [
    sortedObjectSignature(fixedFrame.normBases || {}),
    sortedObjectSignature(fixedFrame.autoScales || {}),
  ].join("|") : "";
  return mainChartModelModule.mainChartCalcCacheKey({
    activeMonths: chartSession.activeMonths,
    chartFrameSignature: fixedFrameSignature || "auto-frame",
    creditOffsetDays: CREDIT_OFFSET_DAYS,
    customStocksSignature: customStocks.map((item) => `${item.ticker}:${item.color || ""}`).join(","),
    dataStart,
    dataEnd,
    displayBudget,
    // Fixed normalization makes the model independent of horizontal movement;
    // the viewport window owns the visible date slice.
    frameStart: fixedFrameSignature ? "fixed-frame" : frameStart,
    frameEnd: fixedFrameSignature ? "fixed-frame" : frameEnd,
    hiddenSeriesSignature: [...chartSession.hiddenSeries].sort().join(","),
    offsetsSignature: sortedObjectSignature(chartSession.seriesOffsets),
    preserveDailyPoints: MAIN_CHART_PRESERVE_DAILY_POINTS,
    priceFingerprint,
    scalesSignature: sortedObjectSignature(chartSession.seriesScales),
    supplementalRevision: dataRevisionSignature("macro", "credit"),
  });
}

function setupStockResearch(msgEl) {
  const researchApp = appRuntimeRegistry.get(APP_RUNTIME_KEYS.stockResearch, () => (
    createStockResearchApp(globalThis, {
      ensureFeature: () => optionalFeatureRuntime.ensureStockResearch(),
      canRun: () => adminAccessGranted,
      onError: (message) => setMessage(msgEl, message, true),
      controllerOptions: () => ({
        cacheLifecycle: cacheLifecyclePolicyModule,
        tickerPriceRuntime: tickerPriceRuntimeModule,
        isLocalRuntime: IS_LOCAL_RUNTIME,
        gatewayBaseUrl: DART_GATEWAY_URL,
        getAccessToken: getDartGatewayAccessToken,
        fetchWithTimeout,
        requestTimeoutMs: DART_GATEWAY_REQUEST_TIMEOUT_MS,
        getExpectedLatestTradingDate: () => {
          const testDate = __THINKSTOCK_E2E_DIAGNOSTICS__
            ? String(globalThis.__THINKSTOCK_E2E_LATEST_TRADING_DATE__ || "").slice(0, 10)
            : "";
          return /^\d{4}-\d{2}-\d{2}$/.test(testDate)
            ? testDate
            : expectedLatestKoreanTradingDate(new Date());
        },
        workerUrl: `./assets/stock-research-worker.bundle.min.js?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
        canRun: () => adminAccessGranted,
        createProgressView: controlStateView.createProgressView,
        getData: () => ({
          priceRecords: appData.pricePayload?.records,
          adrRows: appData.adrRows,
          macroRows: appData.macroRows,
          creditRows: appData.creditRows,
          crisisRows: appData.crisisRows,
        }),
        historyCache: {
          read: readSharedResearchHistoryCache,
          readMany: readSharedResearchHistoryCaches,
          write: (ticker, record) => writeIndexedDbRecord(
            TICKER_RESEARCH_HISTORY_STORE_NAME,
            ticker,
            record,
          ),
          writeMany: (entries) => indexedCacheStore.writeRecords(
            TICKER_RESEARCH_HISTORY_STORE_NAME,
            entries,
          ),
          clear: () => indexedCacheStore.clearStore(TICKER_RESEARCH_HISTORY_STORE_NAME),
          prune: () => scheduleGranularCachePrune(TICKER_RESEARCH_HISTORY_STORE_NAME, 420),
        },
        resultCache: {
          read: (key) => indexedCacheStore.readRecord(STOCK_RESEARCH_RESULTS_STORE_NAME, key),
          write: (key, value) => indexedCacheStore.writeRecord(
            STOCK_RESEARCH_RESULTS_STORE_NAME,
            key,
            value,
          ),
          clear: () => indexedCacheStore.clearStore(STOCK_RESEARCH_RESULTS_STORE_NAME),
        },
        timingCache: {
          readMany: (tickers) => indexedCacheStore.readRecords(TICKER_TIMING_MODEL_STORE_NAME, tickers),
          writeMany: (entries) => indexedCacheStore.writeRecords(TICKER_TIMING_MODEL_STORE_NAME, entries),
        },
        isAdded: (ticker) => customStocks.some((item) => item.ticker === ticker),
        addStock: (candidate) => addCustomStock(candidate, msgEl),
        removeStock: (ticker) => removeCustomStock(ticker),
      }),
    })
  ));
  researchApp.setup();
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

function buildMainChartModelConfig(
  dataStart,
  dataEnd,
  frameStart,
  frameEnd,
  allowedSeries,
  displayBudget,
) {
  const fixedFrame = currentFixedChartFrame();
  return {
    creditCols: CREDIT_COLS,
    creditOffsetDays: CREDIT_OFFSET_DAYS,
    start: dataStart,
    end: dataEnd,
    frameStart,
    frameEnd,
    allowedSeries: [...allowedSeries],
    excludedSeries: [...SUPPLEMENTAL_SERIES],
    priorityOrder: getSeriesPriorityOrder(),
    displayNames: { ...DISPLAY_NAMES },
    hiddenSeries: [...chartSession.hiddenSeries],
    seriesOffsets: { ...chartSession.seriesOffsets },
    seriesScales: { ...chartSession.seriesScales },
    fixedNormBases: fixedFrame ? { ...(fixedFrame.normBases || {}) } : null,
    fixedAutoScales: fixedFrame ? { ...(fixedFrame.autoScales || {}) } : null,
    displayBudget,
    preserveDailyPoints: MAIN_CHART_PRESERVE_DAILY_POINTS,
  };
}

function buildMainChartModel(
  priceRows,
  dataStart,
  dataEnd,
  frameStart,
  frameEnd,
  allowedSeries,
  displayBudget,
) {
  return mainChartModelModule.buildMainChartModel({
    ...buildMainChartModelConfig(
      dataStart,
      dataEnd,
      frameStart,
      frameEnd,
      allowedSeries,
      displayBudget,
    ),
    priceRows,
    macroRows: appData.macroRows,
    creditRows: appData.creditRows,
  });
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
  const result = await requestChartModelFromWorker({
    ...buildMainChartModelConfig(
      dataStart,
      dataEnd,
      frameStart,
      frameEnd,
      allowedSeries,
      displayBudget,
    ),
    datasetKey: getChartModelDataKey(priceRows, allowedSeries),
    sources: {
      priceRows,
      macroRows: appData.macroRows,
      creditRows: appData.creditRows,
    },
  });
  if (!result) return null;
  const model = chartRenderContractModule.normalizeMainChartModel(result);
  if (!model) throw new Error("chart worker returned an invalid model");
  return model;
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
        displayBudget,
      );
      lastMainChartModelSource = "sync";
    }
    const normalized = chartRenderContractModule.normalizeMainChartModel(model);
    if (!normalized) throw new Error("main chart model contract failed");
    normalized.renderRevision = key;
    return normalized;
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

function updateHandles(frameGeometry = null) {
  if (isViewportDragging || isWheelZooming) {
    scheduleHandleUpdate(HANDLE_UPDATE_DEBOUNCE_MS);
    return;
  }
  if (isHandleDragging || isHandlePointerActive) return;
  if (!chartSession.showChartHandles) {
    document.getElementById("y-handles")?.remove();
    return;
  }
  const el = document.getElementById("chart");
  const ya = frameGeometry?.ya || el?._fullLayout?.yaxis;
  const xa = frameGeometry?.xa || el?._fullLayout?.xaxis;
  if (!el || !ya?._length || !xa?._length || !Array.isArray(el.data)) return;

  let container = document.getElementById("y-handles");
  if (!container) {
    container = document.createElement("div");
    container.id = "y-handles";
    el.appendChild(container);
  }
  const layout = mainChartRenderer.buildHandleLayouts(el.data, baseTraceValues, xa, ya, SERIES_COLORS, {
    interpolateAtMs: interpolateTraceYAtMs,
  });
  if (container.dataset.layoutSignature === layout.signature) return;
  container.replaceChildren();
  const pairs = new Map();
  layout.items.forEach(({ traceIndex, seriesKey, leftY, rightY, rightX, color, isEps, handleLabel }) => {
    const leftHandle = document.createElement("div");
    leftHandle.className = "y-handle y-handle-left";
    if (isEps) leftHandle.classList.add("y-handle-eps");
    leftHandle.style.top = `${leftY - 7}px`;
    if (isEps) {
      leftHandle.style.borderColor = color;
      leftHandle.style.backgroundColor = "transparent";
    } else {
      leftHandle.style.backgroundColor = color;
    }
    const title = handleLabel || labelName(seriesKey);
    leftHandle.title = `${title} (위치)`;
    leftHandle.dataset.seriesKey = seriesKey;
    guardHandlePointer(leftHandle);
    container.appendChild(leftHandle);
    const rightHandle = document.createElement("div");
    rightHandle.className = "y-handle y-handle-right";
    if (isEps) rightHandle.classList.add("y-handle-eps");
    rightHandle.style.top = `${rightY - 7}px`;
    rightHandle.style.left = `${rightX}px`;
    if (isEps) {
      rightHandle.style.borderColor = color;
      rightHandle.style.backgroundColor = "transparent";
    } else {
      rightHandle.style.backgroundColor = color;
    }
    rightHandle.title = `${title} (스케일)`;
    rightHandle.dataset.seriesKey = seriesKey;
    guardHandlePointer(rightHandle);
    container.appendChild(rightHandle);
    pairs.set(seriesKey, [leftHandle, rightHandle]);
    setupOffsetDrag(leftHandle, traceIndex, seriesKey, leftY, ya, rightHandle, rightY, {
      clickTogglesVisibility: !isEps,
    });
    setupScaleDrag(rightHandle, traceIndex, seriesKey, rightY, ya);
  });
  container._thinkstockHandlePairs = pairs;
  container.dataset.layoutSignature = layout.signature;
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

function computeFinalValues(seriesKey, traceIndex = -1, element = null) {
  return chartSeriesTransformRuntime.computeSeriesValues(seriesKey, traceIndex, element);
}

function mainSeriesTraceIndex(el, seriesKey, preferredIndex = null) {
  return chartSeriesTransformRuntime.findAdjustableSeriesTraceIndex(
    el?.data,
    seriesKey,
    preferredIndex,
  );
}

function positionSeriesHandles(el, seriesKey, values, frameGeometry = null) {
  if (!chartSession.showChartHandles) return;
  const yAxis = frameGeometry?.ya || el?._fullLayout?.yaxis;
  const xAxis = frameGeometry?.xa || el?._fullLayout?.xaxis;
  if (!yAxis || !xAxis || !Array.isArray(values)) return;
  const traceIndex = mainSeriesTraceIndex(el, seriesKey);
  const trace = traceIndex >= 0 ? el.data[traceIndex] : null;
  const { first, last } = mainChartRenderer.visibleEndpointValues(
    trace,
    values,
    xAxis.range,
    interpolateTraceYAtMs,
  );
  const handles = document.getElementById("y-handles")?._thinkstockHandlePairs?.get(seriesKey) || [];
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
  document.getElementById("y-handles")?.removeAttribute("data-layout-signature");
}

function currentEventMarkerSpecs(args = currentEventMarkerArguments(), options = {}) {
  const enabled = {
    disclosure: chartSession.showDisclosures,
    insider: chartSession.showInsiderTrades,
    timing: chartSession.showRecessionSignals,
  };
  const markerFrame = Object.values(enabled).some(Boolean)
    ? createEventMarkerFrame(...args, options)
    : null;
  return chartMarkerRuntimeModule.createEventMarkerSpecs({
    crisis: {
      enabled: enabled.timing,
      build: () => buildCrisisSignalTrace(...args, markerFrame),
    },
    "timing-buy": {
      enabled: enabled.timing,
      build: () => buildMarketTimingBuyTrace(...args, markerFrame),
    },
    "timing-sell": {
      enabled: enabled.timing,
      build: () => buildMarketTimingSellTrace(...args, markerFrame),
    },
    insider: {
      enabled: enabled.insider,
      build: () => buildInsiderTradeTraces(...args, markerFrame),
    },
    disclosure: {
      enabled: enabled.disclosure,
      build: () => buildDisclosureTrace(...args, markerFrame),
    },
  });
}

function appendEventMarkerYUpdates(el, traceIndexes, yUpdates, options = {}) {
  const args = currentEventMarkerArguments();
  const result = chartMarkerLayoutModule.collectYUpdates(el, currentEventMarkerSpecs(args, options));
  traceIndexes.push(...result.traceIndexes);
  yUpdates.push(...result.yUpdates);
  return {
    structureChanged: result.structureChanged,
    disclosureUpdated: result.updated.includes("disclosure"),
  };
}

const applyChartVisualFrame = chartUpdateCoordinatorModule.createSeriesFrameApplier({
  getElement: () => document.getElementById("chart"), getPlotly: () => window.Plotly,
  restyle: (element, update, indexes, options) => (
    plotlyUpdateRuntime.restyle(element, update, indexes, options)
  ),
  resolveTraceIndex: mainSeriesTraceIndex, computeValues: computeFinalValues,
  collectMarkerUpdates: chartMarkerLayoutModule.collectSeriesYDeltaUpdates,
  collectLinkedTraceUpdates: (element, { seriesKey }) => (
    chartSeriesTransformRuntime.collectLinkedSeriesYUpdates(element?.data, seriesKey)
  ),
  commitSeries: updateCurrentMainChartSeriesTransform,
  groupedHoverUpdate: mainChartRenderer.groupedHoverYUpdate,
  readGeometry: (element) => ({
    xa: element?._fullLayout?.xaxis || null,
    ya: element?._fullLayout?.yaxis || null,
  }),
  positionHandles: positionSeriesHandles,
  hasEventModel: () => Boolean(chartSession.currentMainChartModel?.seriesModels?.length),
  appendEventUpdates: appendEventMarkerYUpdates,
  onDisclosureUpdated: () => { eventMarkerRenderState.partialUpdateCount += 1; },
  invalidateInteractionCaches: invalidateChartInteractionCaches,
  invalidateRenderState: mainChartRenderer.invalidateRenderFingerprint,
  updateHandles,
  requestStructureRender: () => requestChartRender(true, { reason: "event-structure" }),
});
const chartVisualFrameCoordinator = appRuntimeRegistry.get(
  APP_RUNTIME_KEYS.chartVisualFrame,
  () => chartUpdateCoordinatorModule.createCoordinator(window, {
    applyFrame: applyChartVisualFrame,
    onError: (error) => recordRuntimeError("chart-visual-frame", error),
  }),
);
function restyleLive(traceIndex, seriesKey, options = {}) {
  const commit = options.commit === true;
  const hasVisibleEventMarkers = !seriesKey.startsWith("eps:")
    && (chartSession.showInsiderTrades
      || chartSession.showDisclosures
      || chartSession.showRecessionSignals);
  chartVisualFrameCoordinator.schedule({
    seriesKey,
    traceIndex,
    commit,
    markers: hasVisibleEventMarkers,
    handles: true,
    reason: "series-transform",
  });
}

function getSeriesTransformDragController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.seriesTransformDrag, () => (
    createSeriesTransformDragController({
      target: document,
      beginInteraction: beginSeriesTransformInteraction,
      endInteraction: endSeriesTransformInteraction,
      scheduleFrame: restyleLive,
    })
  ));
}

function getSeriesTransformGestureRuntime() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.seriesTransformGesture, () => (
    createSeriesTransformGestureRuntime({
      getDragController: getSeriesTransformDragController,
      offsetFromDrag,
      resolveOffset: (seriesKey) => chartSession.seriesOffsets[seriesKey] || 0,
      resolveScale: (seriesKey) => resolveSeriesScale(chartSession.seriesScales, seriesKey),
      scaleFromDrag,
      setOffset: (seriesKey, value) => { chartSession.seriesOffsets[seriesKey] = value; },
      setScale: (seriesKey, value) => { chartSession.seriesScales[seriesKey] = value; },
    })
  ));
}

async function finishTraceYEdit(rebuildForDisclosures = true, seriesKey = "", options = {}) {
  chartVisualFrameCoordinator.flush();
  await chartVisualFrameCoordinator.whenSettled();
  saveState();
  if (chartSession.autoChartReset && options.preserveTransform === true) {
    // The live frame already committed the series. Fit the axis and dated marker
    // offsets in one Plotly transaction instead of rebuilding the whole chart.
    await fitCurrentChartRatio({ expandOnly: true, syncMarkers: true });
    return;
  }
  if (seriesKey.startsWith("eps:")) {
    scheduleHandleUpdate(0);
    saveLastRuntimeSnapshot().catch(() => {});
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
    requestAiForecastRender();
    return;
  }
  scheduleHandleUpdate(0);
  saveLastRuntimeSnapshot().catch(() => {});
}

function lockCurrentYAxisRange() {
  const el = document.getElementById("chart");
  const range = el?._fullLayout?.yaxis?.range;
  if (!el || !Array.isArray(range) || range.length < 2) return;
  const lockedRange = [range[0], range[1]];
  useViewportEventMarkerGap = true;
  const layoutRange = el.layout?.yaxis?.range;
  const alreadyLocked = el.layout?.yaxis?.autorange === false
    && Array.isArray(layoutRange)
    && layoutRange.length >= 2
    && layoutRange.every((value, index) => Math.abs(Number(value) - Number(lockedRange[index])) < 1e-9);
  if (el.layout?.yaxis) {
    el.layout.yaxis.autorange = false;
    el.layout.yaxis.range = [...lockedRange];
  }
  // Avoid racing the first live trace/marker frame with a redundant Plotly
  // relayout. The rendered axis is already locked in the normal chart state.
  if (alreadyLocked) return Promise.resolve();
  return plotlyUpdateRuntime.relayout(el, {
    "yaxis.range[0]": lockedRange[0],
    "yaxis.range[1]": lockedRange[1],
    "yaxis.autorange": false,
  }, { label: "lock-main-y-range" });
}

function getCurrentMainXRange() {
  const range = document.getElementById("chart")?._fullLayout?.xaxis?.range;
  if (!Array.isArray(range) || range.length < 2) return null;
  return [range[0], range[1]];
}

function setupOffsetDrag(
  handle,
  traceIndex,
  seriesKey,
  basePixelY,
  ya,
  pairedHandle,
  pairedPixelY,
  options = {},
) {
  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const startClientY = event.clientY;
    getSeriesTransformGestureRuntime().startOffset({
      pointerId: event.pointerId,
      startClientY,
      traceIndex,
      seriesKey,
      axis: ya,
      beginOptions: { handle, trackHandlePointer: true },
      updatePosition: (clientY) => {
      const dy = clientY - startClientY;
      handle.style.top = `${basePixelY + dy - 7}px`;
      if (pairedHandle) pairedHandle.style.top = `${pairedPixelY + dy - 7}px`;
      },
      onClick: ({ startValue }) => {
        chartSession.seriesOffsets[seriesKey] = startValue;
        if (options.clickTogglesVisibility === false) {
          restyleLive(traceIndex, seriesKey, { commit: true });
          scheduleHandleUpdate(0);
          return;
        }
        const becomingVisible = chartSession.hiddenSeries.has(seriesKey);
        if (!setMainChartSeriesVisible(seriesKey, becomingVisible)) return;
        noteStockVisibilityChange(seriesKey);
        requestChartCompositionUpdate();
      },
      onCommit: () => finishTraceYEdit(true, seriesKey, { preserveTransform: true }),
    });
  }, { passive: false });
}

function setupScaleDrag(handle, traceIndex, seriesKey, basePixelY, ya) {
  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const startClientY = event.clientY;
    getSeriesTransformGestureRuntime().startScale({
      pointerId: event.pointerId,
      startClientY,
      traceIndex,
      seriesKey,
      beginOptions: { handle, trackHandlePointer: true },
      updatePosition: (clientY) => {
      const dy = clientY - startClientY;
      handle.style.top = `${basePixelY + dy - 7}px`;
      },
      onCommit: () => finishTraceYEdit(true, seriesKey, { preserveTransform: true }),
    });
  }, { passive: false });
}

function visibleLineDataRangeMs(traces) {
  const fullRanges = (Array.isArray(traces) ? traces : []).flatMap((trace) => {
    if (trace?.visible === "legendonly") return [];
    const start = Number(trace?.meta?.fullDataStartMs);
    const end = Number(trace?.meta?.fullDataEndMs);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [[start, end]] : [];
  });
  const range = fullRanges.length ? [
    Math.min(...fullRanges.map((value) => value[0])),
    Math.max(...fullRanges.map((value) => value[1])),
  ] : chartViewportControllerModule.visibleLineDataRangeMs(traces, {
    toMilliseconds: toMsSafe,
  })?.range || null;
  return extendChartRangeRight(range);
}

function queueAutoCompositionViewport(forceFitFull = false, options = {}) {
  const element = document.getElementById("chart");
  if (chartSession.autoChartReset) {
    // Composition changes are fitted from the final adjustable trace set in one pass.
    chartSession.pendingAutoChartFit = true;
    chartSession.pendingAutoChartFitExpandOnly = false;
  }
  if (options.preserveFutureOverlayViewport) {
    chartSession.pendingCompositionViewport = null;
    return;
  }
  chartSession.pendingCompositionViewport = chartViewportControllerModule.captureCompositionViewport({
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
  const preserveFutureOverlayViewport = options.preserveFutureOverlayViewport
    ?? (chartSession.showAiForecast || chartSession.showEps);
  return getChartUpdateCoordinator().requestComposition({
    ...options,
    preserveFutureOverlayViewport,
  });
}

function requestFutureOverlayCompositionUpdate() {
  return requestChartCompositionUpdate({
    preserveFutureOverlayViewport: true,
    reason: "future-overlay-composition",
  });
}

async function fitCurrentChartRatio(options = {}) {
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
  invalidateChartInteractionCaches(el);
  const layoutUpdate = {
    "yaxis.range[0]": yRange[0],
    "yaxis.range[1]": yRange[1],
    "yaxis.autorange": false,
  };
  const markerTraceIndexes = [];
  const markerYUpdates = [];
  const hasEventMarkers = chartSession.showDisclosures
    || chartSession.showInsiderTrades
    || chartSession.showRecessionSignals;
  const markerUpdate = options.syncMarkers !== false && hasEventMarkers
    ? appendEventMarkerYUpdates(el, markerTraceIndexes, markerYUpdates, { viewportRange: yRange })
    : { structureChanged: false, disclosureUpdated: false };

  if (markerTraceIndexes.length && !markerUpdate.structureChanged) {
    await plotlyUpdateRuntime.update(
      el,
      { y: markerYUpdates },
      layoutUpdate,
      markerTraceIndexes,
      { label: "fit-main-range-markers" },
    );
    if (markerUpdate.disclosureUpdated) eventMarkerRenderState.partialUpdateCount += 1;
  } else {
    await plotlyUpdateRuntime.relayout(el, layoutUpdate, { label: "fit-main-range" });
    if (markerUpdate.structureChanged) {
      requestChartRender(true, {
        deferDuringInteraction: false,
        reason: "event-structure",
        updateClass: "markers",
      });
    }
  }
  scheduleHandleUpdate(0);
  saveLastRuntimeSnapshot().catch(() => {});
  return true;
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
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartMarker, () => (
    chartMarkerRuntimeModule.createChartMarkerRuntime(globalThis, {
    chartEventLayer: chartEventLayerModule,
    chartSession,
    buildInsiderMarkerTraces,
    dataRevisionSignature,
    ensureMarketTimingFeature,
    escapeHtml,
    getAdrRows: () => appData.adrRows,
    getCreditRows: () => appData.creditRows,
    getCrisisRows: () => appData.crisisRows,
    getDisclosureRows: () => appData.disclosureRows,
    getInsiderTradeRows: () => appData.insiderTradeRows,
    getMacroRows: () => appData.macroRows,
    getMarketTimingService: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.marketTiming),
    getPricePayload: () => appData.pricePayload,
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
    })
  ));
}

function createEventMarkerFrame(
  selected,
  seriesModels,
  start,
  end,
  markerStart = start,
  markerEnd = end,
  options = {},
) {
  return getChartMarkerRuntime().createFrame({
    selected,
    seriesModels,
    start,
    end,
    markerStart,
    markerEnd,
    viewportRange: options.viewportRange,
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
  eventMarkerRenderState.disclosureStats = result.stats;
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
  eventMarkerRenderState.insiderStats = result.stats;
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

function applyDisclosureStateFast() {
  const el = document.getElementById("chart");
  hideDisclosurePopover();
  eventMarkerRenderState.highlight = null;
  if (!chartSession.showDisclosures) {
    eventMarkerRenderState.disclosureStats = {
      total: appData.disclosureRows.length,
      candidates: 0,
      markers: 0,
    };
    syncDisclosureToggleButton(0);
  }
  if (!window.Plotly || !Array.isArray(el?.data)) return false;
  invalidateChartInteractionCaches(el);
  requestChartRender(true, {
    deferDuringInteraction: false,
    reason: "disclosure-toggle",
    updateClass: "markers",
  });
  return true;
}

function getDisclosurePopover() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.disclosurePopover, () => (
    requireLoadedDartFeature().popover.createDisclosurePopover(globalThis, {
      chartId: "chart",
      escapeHtml,
      fallbackName: (group) => labelName(group?.ticker),
      onLinkAction: (item) => {
        if (item?.linkAction !== "broker-report") return false;
        try {
          return getBrokerResearchApp().openReport({
            reportId: item.reportId,
            source: item.source,
            sourceUrl: item.url,
          });
        } catch (_) {
          return false;
        }
      },
    })
  ), (popover) => popover?.destroy?.());
}

function hideDisclosurePopover() {
  appRuntimeRegistry.peek(APP_RUNTIME_KEYS.disclosurePopover)?.hide?.();
}

function showDisclosurePopover(group, sourceEvent) {
  const loaded = getLoadedDartFeature();
  if (loaded) return getDisclosurePopover().show(group, sourceEvent);
  ensureDartFeatureModules()
    .then(() => getDisclosurePopover().show(group, sourceEvent))
    .catch((error) => recordRuntimeError("disclosure-popover-load", error));
  return true;
}

function isDirectEventMarkerTap(evtData, point) {
  const sourceEvent = evtData?.event;
  const chart = document.getElementById("chart");
  return chartEventLayerModule.isPlotlyPointAtClientPoint(chart, point, sourceEvent, {
    isTouch: isTouchDevice(),
  });
}

function handleEventMarkerClick(evtData) {
  const point = evtData?.points?.find((candidate) => isInteractiveChartMarkerTrace(candidate?.data));
  if (!point || !isDirectEventMarkerTap(evtData, point)) return false;
  const group = chartMarkerRuntimeModule.buildEventMarkerPopoverGroup(point);
  return group ? showDisclosurePopover(group, evtData.event) : false;
}

function handlePriorityChartClick(evtData) {
  const chart = document.getElementById("chart");
  const sourceEvent = evtData?.event;
  if (chart && Number.isFinite(Number(sourceEvent?.clientX))
    && Number.isFinite(Number(sourceEvent?.clientY))) {
    const geometry = getChartInteractionGeometry(chart);
    const target = findPriorityChartTarget(
      chart,
      sourceEvent.clientX,
      sourceEvent.clientY,
      isTouchDevice(),
      geometry,
      { findEventMarkerAtClientPoint, findAiForecastReportAtClientPoint },
    );
    if (target && openPriorityChartTarget(chart, target, sourceEvent, {
      openAiForecastReportHit,
      openEventMarkerHit,
    })) return true;
  }
  return handleEventMarkerClick(evtData) || Boolean(handleAiForecastClick?.(evtData));
}

function handleAiForecastClick(evtData) {
  const tracesModule = getLoadedAiFeature()?.traces;
  const selected = tracesModule?.representativeReportFromForecastClick?.(evtData);
  if (!selected) return false;
  const { point, reports } = selected;
  const series = String(point?.data?.meta?.seriesKey || "");
  const displayName = tracesModule.withoutStockCode?.(labelName(series)) || labelName(series);
  const shortDate = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1].slice(2)}.${match[2]}.${match[3]}` : "";
  };
  const shortTitle = (value, maximum = 16) => {
    const title = tracesModule.withoutStockCode?.(value) || String(value || "").trim();
    const characters = [...title];
    return characters.length > maximum ? `${characters.slice(0, maximum).join("")}...` : title;
  };
  showDisclosurePopover({
    name: `${displayName} · 최신 리포트`,
    plotDate: "",
    events: reports.slice(0, 3).map((report) => ({
      caption: `${shortDate(report.publishedDate)} ${String(report.broker || "").trim()}`.trim(),
      linkAction: "broker-report",
      reportId: report.reportId,
      source: report.source,
      title: shortTitle(report.title),
      url: report.sourceUrl,
    })),
  }, evtData.event);
  return true;
}

function findEventMarkerPoint(evtData) {
  return evtData?.points?.find((point) => isInteractiveChartMarkerTrace(point?.data)) || null;
}

function setEventMarkerHighlighted(chartEl, traceIndex, pointIndex, highlighted) {
  const updated = chartEventLayerModule.setMarkerHighlighted(
    chartEl,
    traceIndex,
    pointIndex,
    highlighted,
    {
      fallbackFill: chartMarkerRuntimeModule.CHART_MARKER_DEFAULTS.colors.disclosure,
      fallbackSize: chartMarkerRuntimeModule.CHART_MARKER_DEFAULTS.constants.disclosureTextSize,
      highlightSizeDelta: chartMarkerRuntimeModule.CHART_MARKER_DEFAULTS.highlightSizeDelta,
    },
  );
  if (updated) eventMarkerRenderState.highlightDomUpdateCount += 1;
  return updated;
}

function resetEventMarkerHoverHighlight(chartEl = document.getElementById("chart")) {
  if (!chartEl || !eventMarkerRenderState.highlight) return;
  const traceIndex = eventMarkerRenderState.highlight.traceIndex;
  const pointIndex = eventMarkerRenderState.highlight.pointIndex;
  eventMarkerRenderState.highlight = null;
  setEventMarkerHighlighted(chartEl, traceIndex, pointIndex, false);
}

function scheduleEventMarkerHoverHighlight(evtData) {
  if (isViewportDragging || isHandleDragging) return;
  const chartEl = document.getElementById("chart");
  const point = findEventMarkerPoint(evtData);
  if (!chartEl || !point) {
    resetEventMarkerHoverHighlight(chartEl);
    return;
  }

  const traceIndex = point.curveNumber;
  const pointIndex = point.pointIndex ?? point.pointNumber;
  if (
    eventMarkerRenderState.highlight
    && eventMarkerRenderState.highlight.traceIndex === traceIndex
    && eventMarkerRenderState.highlight.pointIndex === pointIndex
  ) {
    return;
  }

  highlightEventMarkerHoverPoint(evtData);
}

function highlightEventMarkerHoverPoint(evtData) {
  const chartEl = document.getElementById("chart");
  const point = findEventMarkerPoint(evtData);
  if (!chartEl || !point) {
    resetEventMarkerHoverHighlight(chartEl);
    return;
  }

  const traceIndex = point.curveNumber;
  const pointIndex = point.pointIndex ?? point.pointNumber;
  const count = Array.isArray(point.data?.x) ? point.data.x.length : 0;
  if (!Number.isInteger(traceIndex) || !Number.isInteger(pointIndex) || count <= 0) return;
  if (
    eventMarkerRenderState.highlight
    && eventMarkerRenderState.highlight.traceIndex === traceIndex
    && eventMarkerRenderState.highlight.pointIndex === pointIndex
  ) {
    return;
  }

  resetEventMarkerHoverHighlight(chartEl);

  eventMarkerRenderState.highlight = { traceIndex, pointIndex };
  setEventMarkerHighlighted(chartEl, traceIndex, pointIndex, true);
}

function collectVisibleAiForecastSeries() {
  const models = chartSession.currentMainChartModel?.seriesModels || [];
  return [...new Set(models
    .map((model) => String(model?.series || "").toUpperCase())
    .filter((series) => isForecastSeries(series) && !chartSession.hiddenSeries.has(series)))];
}

function cancelAiForecastCalculations() {
  getLoadedAiForecastApp()?.cancelCalculations?.();
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
      getFutureOverlayController().requestReveal("ai");
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
      if (chartSession.showAiForecast) requestAiForecastRender();
    });
  return aiMarketModelPromise;
}

function setAiForecastProgress(value, label = "AI 계산") {
  getLoadedAiForecastApp()?.setProgress?.(value, label);
}

function resetAiForecastProgress(label = "AI 계산 준비") {
  getLoadedAiForecastApp()?.resetProgress?.(label);
}

function waitForAiProgressPaint(delay = 0) {
  return getLoadedAiForecastApp()?.waitForProgressPaint?.(delay) || Promise.resolve();
}

function startAiForecastProgress() {
  getLoadedAiForecastApp()?.startProgress?.();
}

function finishAiForecastProgress() {
  getLoadedAiForecastApp()?.finishProgress?.();
}

function stopAiForecastProgress() {
  getLoadedAiForecastApp()?.stopProgress?.();
}

function getAiForecastCacheService() {
  const cacheModule = requireLoadedAiFeature().cache;
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.aiForecastCache, () => (
    cacheModule.createForecastCache({
      memory: aiForecastResultBySeries,
      maxMemory: 24,
      read: (ticker) => readLifecycleCacheRecord(TICKER_AI_FORECAST_CACHE_STORE_NAME, ticker),
      write: (ticker, record) => writeIndexedDbRecord(TICKER_AI_FORECAST_CACHE_STORE_NAME, ticker, record),
      remove: (ticker) => deleteIndexedDbRecord(TICKER_AI_FORECAST_CACHE_STORE_NAME, ticker),
      prune: () => scheduleGranularCachePrune(TICKER_AI_FORECAST_CACHE_STORE_NAME),
    })
  ));
}

function invalidateAiForecastCache(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  if (!key) return false;
  aiForecastResultBySeries.delete(key);
  aiForecastCalculationCounts.delete(key);
  const cacheService = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.aiForecastCache);
  if (cacheService) return cacheService.invalidate(key);
  deleteIndexedDbRecord(TICKER_AI_FORECAST_CACHE_STORE_NAME, key).catch(() => {});
  return true;
}

function runAiForecast(options) {
  return getLoadedAiForecastApp()?.run?.(options) || Promise.resolve(null);
}

async function readAiAnalysisCacheForTicker(ticker) {
  try {
    await ensureAiFeatureModules();
    const feature = requireLoadedAiFeature();
    const stored = await readLifecycleCacheRecord(TICKER_AI_ANALYSIS_CACHE_STORE_NAME, ticker);
    if (!stored) return null;
    const normalized = feature.analysis.normalizeAnalysisRecord(ticker, stored, null, Date.now());
    const issue = cacheRecordHealthModule.granularRecordIssue(stored, {
      schema: feature.analysis.SCHEMA_VERSION,
      key: ticker,
      requireContent: false,
      source: "ai-analysis",
      revision: feature.analysis.COMPANY_ANALYSIS_CACHE_REVISION,
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
  const analysisModule = getLoadedAiFeature()?.analysis;
  if (!analysisModule?.isAnalysisFresh) return false;
  const savedAt = Number(analysis?.savedAt);
  return analysisModule.isAnalysisFresh(analysis, TICKER_AI_ANALYSIS_CACHE_MAX_AGE_DAYS * DAY_MS)
    && koreanDateText(new Date(savedAt)) === koreanDateText();
}
function aiAnalysisHasEps(analysis) {
  return Array.isArray(analysis?.financials)
    && analysis.financials.some((record) => Number.isFinite(Number(record?.eps)));
}
const aiAnalysisHasCurrentEpsCoverage = (analysis) => (
  getLoadedAiFeature()?.analysis?.hasCurrentFinancialSummary?.(analysis) === true
);
function getBrokerResearchApp() {
  const feature = requireLoadedBrokerResearchFeature();
  if (!feature.cache || !feature.parser) {
    throw new Error("Broker research feature is not loaded");
  }
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.brokerResearch, () => (
    feature.runtime.createBrokerResearchApp(globalThis, {
      cacheModule: feature.cache,
      parser: feature.parser,
      workerModule: feature.worker,
      requestRegistry: appRequestRegistry,
      listEndpoint: BROKER_REPORT_LIST_ENDPOINT,
      pdfEndpoint: BROKER_REPORT_PDF_ENDPOINT,
      fetchWithTimeout,
      getAsOfDate: koreanDateText,
      getTickerName: labelName,
      getHeaders: () => {
        if (IS_LOCAL_RUNTIME) return {};
        const token = getDartGatewayAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
      workerUrl: new URL(
        `./modules/broker-report-worker.mjs?v=${encodeURIComponent(APP_BUILD_VERSION)}`,
        document.baseURI,
      ).toString(),
      workerTimeoutMs: 30000,
      pdfModuleUrl: new URL(`./vendor/pdf.min.mjs?v=${encodeURIComponent(APP_BUILD_VERSION)}`, document.baseURI).toString(),
      pdfWorkerUrl: new URL(`./vendor/pdf.worker.min.mjs?v=${encodeURIComponent(APP_BUILD_VERSION)}`, document.baseURI).toString(),
      readRecord: (ticker) => readLifecycleCacheRecord(TICKER_BROKER_RESEARCH_STORE_NAME, ticker),
      writeRecord: (ticker, record, metadata) => writeIndexedDbRecord(
        TICKER_BROKER_RESEARCH_STORE_NAME,
        ticker,
        cacheLifecyclePolicyModule.withCacheMetadata(record, metadata),
      ),
      onStateChange: () => syncAiForecastToggleButton(),
      onSummaryChange: () => {
        if (chartSession.showAiForecast) requestAiForecastRender();
      },
    })
  ), (runtime) => runtime?.dispose?.());
}

async function requestBrokerResearchForTicker(ticker, options = {}) {
  await ensureBrokerResearchFeature();
  const target = String(ticker || "").trim().toUpperCase();
  if (!/^\d{6}\.(KS|KQ)$/.test(target)) return null;
  return getBrokerResearchApp().request(target, {
    forceNetwork: options.forceNetwork === true,
    onProgress: (progress, label) => {
      if (!chartSession.showAiForecast) return;
      const mapped = 12 + Math.round((Math.max(0, Math.min(100, Number(progress) || 0)) / 100) * 22);
      setAiForecastProgress(mapped, `${labelName(target)} ${label}`);
    },
  });
}

async function requestAiAnalysisForTicker(ticker, options = {}) {
  await ensureAiFeatureModules();
  const feature = requireLoadedAiFeature();
  const target = String(ticker || "").trim().toUpperCase();
  const forceNetwork = Boolean(options.forceNetwork);
  const requireEps = options.requireEps === true;
  const deferForecastRender = options.deferForecastRender === true;
  if (!/^\d{6}\.(KS|KQ)$/.test(target)) return null;
  const initialMemoryAnalysis = aiAnalysisByTicker.get(target) || null;
  if (!forceNetwork
    && aiAnalysisIsFresh(initialMemoryAnalysis)
    && (!requireEps || aiAnalysisHasCurrentEpsCoverage(initialMemoryAnalysis))) return initialMemoryAnalysis;
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
      if (chartSession.showAiForecast && !deferForecastRender) {
        requestAiForecastRender();
      }
      if (!forceNetwork
        && aiAnalysisIsFresh(cached)
        && (!requireEps || aiAnalysisHasCurrentEpsCoverage(cached))) return cached;
    }
    if (!canUseDartGateway()) return cached;

    if (chartSession.showAiForecast) setAiForecastProgress(26, `${labelName(target)} 실적·컨센서스 수집`);
    const refreshQuery = forceNetwork || (requireEps && !aiAnalysisHasCurrentEpsCoverage(cached))
      ? "&refresh=1"
      : "";
    const response = await fetchWithTimeout(`${AI_ANALYSIS_ENDPOINT}?ticker=${encodeURIComponent(target)}${refreshQuery}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${getDartGatewayAccessToken()}` },
    }, 25000);
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) return null;
    if (Number(payload?.analysisContractVersion)
      < Number(feature.analysis.COMPANY_ANALYSIS_CONTRACT_VERSION)) return cached;
    if (!feature.analysis.hasCurrentFinancialSummary(payload)) return cached;
    const analysis = feature.analysis.normalizeAnalysisRecord(target, payload, cached, Date.now());
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
      syncEpsToggleButton();
      if (chartSession.showAiForecast && !deferForecastRender) {
        requestAiForecastRender();
      }
    }
  }, {
    tag: forceNetwork ? "force" : "normal",
    afterCurrent: forceNetwork && appRequestRegistry.has(requestKey)
      && appRequestRegistry.tag(requestKey) !== "force",
  });
}
function getEpsDataController() {
  const existing = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.epsData);
  if (existing) return existing;
  const epsChartModule = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.epsFeature);
  if (!epsChartModule) throw new Error("EPS chart module is not loaded");
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.epsData, () => (
    epsChartModule.createEpsDataController(globalThis, {
    canUseGateway: canUseDartGateway,
    consumeForcedCurrent: (ticker) => epsRefreshOnNextAdd.delete(ticker),
    ensureCurrent: (ticker, options) => requestAiAnalysisForTicker(ticker, options),
    fetchYear: (request, options) => runtimeGatewayClient.fetchEpsHistory(request, options),
    getAnalysis: (ticker) => aiAnalysisByTicker.get(ticker),
    getVisibleTickers: visibleEpsTickers,
    hasEps: aiAnalysisHasEps,
    hasHistoryCoverage: (analysis, range, version) => (
      getLoadedAiFeature()?.analysis?.hasDartEpsHistoryCoverage?.(analysis, range, version) === true
    ),
    isAbortError,
    isEnabled: () => chartSession.showEps,
    isHidden: (ticker) => chartSession.hiddenSeries.has(ticker),
    isPending: (ticker) => aiAnalysisPendingTickers.has(ticker),
    labelName,
    mapWithConcurrency,
    needsCurrent: (ticker) => !aiAnalysisIsFresh(aiAnalysisByTicker.get(ticker))
      || !aiAnalysisHasCurrentEpsCoverage(aiAnalysisByTicker.get(ticker)),
    normalizeAnalysis: (ticker, payload, previous) => (
      requireLoadedAiFeature().analysis.normalizeAnalysisRecord(ticker, payload, previous, Date.now())
    ),
    onError: recordRuntimeError,
    onPrepared: (loadedCount, options, result = {}) => {
      const changedCount = Math.max(0, Number(result.changedCount) || 0);
      if (chartSession.showEps && changedCount && chartSession.autoChartReset) {
        chartSession.pendingAutoChartFit = true;
        chartSession.pendingAutoChartFitExpandOnly = false;
      }
      if (chartSession.showEps && changedCount && options.render !== false) {
        requestChartCompositionUpdate();
      }
    },
    progress: epsProgress,
    readAnalysis: readAiAnalysisCacheForTicker,
    resolveCorpCode: async (ticker) => {
      const stockCode = ticker.slice(0, 6);
      return await ensureDartCorpCodeMapLoaded(stockCode)
        ? dartCorpCodeFor(stockCode) : "";
    },
      runRequest: (ticker, factory, options) => getDartRequestRuntime().run("eps-history", ticker, factory, {
      force: options.forceNetwork === true,
      signal: options.signal,
    }),
    saveAnalysis: saveAiAnalysisCacheForTicker,
    setAnalysis: (ticker, analysis) => aiAnalysisByTicker.set(ticker, analysis),
    setPending: (ticker, pending) => pending
      ? aiAnalysisPendingTickers.add(ticker) : aiAnalysisPendingTickers.delete(ticker),
    sync: syncEpsToggleButton,
    throwIfAborted,
    today: koreanDateText,
    })
  ));
}
const prepareVisibleEpsData = async (options = {}) => {
  await ensureEpsFeatureModules();
  return getEpsDataController().prepare(options);
};
const scheduleVisibleEpsData = () => (
  appRuntimeRegistry.peek(APP_RUNTIME_KEYS.epsFeature)
    ? getEpsDataController().schedule()
    : undefined
);
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
    if (chartSession.showAiForecast) requestAiForecastRender();
  });
  syncAiForecastToggleButton();
  return aiRotationSeriesPromise;
}

async function refreshAiAnalysisForVisibleSeries(options = {}) {
  if (!chartSession.showAiForecast) return 0;
  const tickers = activeAiAnalysisTickers();
  const before = aiAnalysisByTicker.size;
  const ownedPendingTickers = tickers.filter((ticker) => !aiContextPendingTickers.has(ticker));
  ownedPendingTickers.forEach((ticker) => aiContextPendingTickers.add(ticker));
  syncAiForecastToggleButton();
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
  try {
    await Promise.all([
      tickers.length
        ? mapWithConcurrency(tickers, 2, (ticker) => requestAiAnalysisForTicker(ticker, {
            ...options,
            deferForecastRender: true,
          }))
        : Promise.resolve([]),
      loadAiRotationLeaderSeries(),
      brokerSoftWait,
    ]);
    setAiForecastProgress(35, "실적·컨센서스 준비");
    return Math.max(0, aiAnalysisByTicker.size - before);
  } finally {
    ownedPendingTickers.forEach((ticker) => aiContextPendingTickers.delete(ticker));
    syncAiForecastToggleButton();
    if (chartSession.showAiForecast) requestAiForecastRender();
  }
}

function getAiForecastQualityRuntime() {
  const feature = requireLoadedAiFeature();
  const qualityRuntimeModule = feature.qualityRuntime;
  if (!qualityRuntimeModule) throw new Error("AI forecast quality runtime is not loaded");
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.aiForecastQuality, () => (
    qualityRuntimeModule.createAiForecastQualityRuntime(globalThis, {
    getFeature: getLoadedAiFeature,
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
    })
  ));
}

async function applyAiForecastJournalCalibration(ticker, forecast, historyRows, forecastOptions) {
  return getAiForecastQualityRuntime().calibrate(ticker, forecast, historyRows, forecastOptions);
}

function summarizeAiForecastQualityDiagnostics() {
  return appRuntimeRegistry.peek(APP_RUNTIME_KEYS.aiForecastQuality)?.summarizeDiagnostics?.()
    || { seriesCount: 0, statuses: {}, weakSeries: [], byContext: {}, series: {} };
}

const runtimeDiagnosticStateCollector = performanceMonitorModule.createRuntimeDiagnosticStateCollector({
  backgroundTasks: () => backgroundTaskScheduler.stats(),
  startupVisualReady: () => startupTaskRuntime.isReleased(),
  startupDeferredTasks: () => startupTaskRuntime.pendingCount(),
  refreshPhases: () => runtimeDataApp.getPhaseStats(),
  refreshStatus: () => runtimeDataApp.getStatus(),
  chartRender: () => chartRenderTelemetry.snapshot(),
  chartScheduler: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.mainChartScheduler)?.stats?.() || null,
  chartUpdates: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartUpdates)?.stats?.() || null,
  chartVisualFrames: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.chartVisualFrame)?.stats?.() || null,
  viewportWindowCache: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.mainViewportWindow)?.stats?.() || null,
  chartHoverCache: () => mainChartRenderer.groupedHoverCacheStats(),
  auxiliaryChart: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.auxiliaryChart)?.stats?.() || null,
  aiForecast: () => {
    const cache = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.aiForecastCache);
    const quality = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.aiForecastQuality);
    return {
      cache: cache?.stats?.() || null,
      quality: summarizeAiForecastQualityDiagnostics(),
      journal: quality?.stats?.() || null,
    };
  },
  chartModelCache: () => mainChartCalcCache.stats(),
  chartSourceFingerprintCache: () => mainChartSourceFingerprintCache.stats(),
  runtimeSnapshot: () => ({
    ...getRuntimeSnapshotController().stats(),
    componentCache: runtimeSnapshotRevisionTracker.stats(),
  }),
  tickerSeriesCache: () => tickerSeriesCacheRetention.stats(),
  marketTiming: () => appRuntimeRegistry.peek(APP_RUNTIME_KEYS.marketTiming)?.stats?.().quality || null,
  runtimeSources: () => runtimeSourceHealthModule.summarizeSourceStates(
    runtimeDataApp.getSourceStates(),
  ),
}, {
  onError: (error, section) => recordRuntimeError(`runtime-diagnostics:${section}`, error),
});

function buildRuntimeDiagnosticAppState() {
  return runtimeDiagnosticStateCollector.snapshot();
}

function queueAiForecastJournalSync(ticker, forecast, historyRows) {
  return getAiForecastQualityRuntime().queue(ticker, forecast, historyRows);
}

function disclosureTargetTickers() {
  const lifecycle = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartEvents);
  return lifecycle?.targetTickers?.()
    || customStocks.map((stock) => normalizeDartTicker(stock.ticker)).filter(Boolean);
}

function visibleDisclosureTargetTickers() {
  const lifecycle = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartEvents);
  return lifecycle?.targetTickers?.({ visible: true })
    || customStocks
      .map((stock) => normalizeDartTicker(stock.ticker))
      .filter((ticker) => ticker && !chartSession.hiddenSeries.has(ticker));
}

function getDartEventLifecycle() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.dartEvents, () => (
    requireLoadedDartFeature().requestRuntime.createDartEventLifecycle(globalThis, {
      concurrency: DART_VISIBLE_REFRESH_CONCURRENCY,
      getStocks: () => customStocks,
      isHidden: (ticker) => chartSession.hiddenSeries.has(ticker),
      isInsiderEnabled: () => chartSession.showInsiderTrades,
      canUseGateway: canUseDartGateway,
      hasRequest: (kind, ticker) => getDartRequestRuntime().has(kind, ticker),
      mapWithConcurrency,
      requestDisclosure: requestDartDisclosureRefreshForTicker,
      requestInsider: requestInsiderTradesForTicker,
      isAbortError,
      recordError: recordRuntimeError,
      onPendingChange: syncInsiderTradeToggleButton,
    })
  ));
}

async function prepareVisibleDisclosureData(msgEl) {
  await ensureDartFeatureModules();
  return getDartEventLifecycle().prepareVisibleDisclosures(msgEl);
}

function cancelDartLayerProgress(kind, prefix) {
  const runtime = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartRequests);
  const tickers = new Set([
    ...disclosureTargetTickers(),
    ...(runtime?.identities(kind) || []),
  ]);
  tickers.forEach((ticker) => disclosureProgress.cancel(`${prefix}:${ticker}`));
  const disclosureStillFeedsAi = kind === "disclosure-refresh" && chartSession.showAiForecast;
  if (!disclosureStillFeedsAi) runtime?.cancelKind?.(kind);
}

function cancelTickerDartRequests(tickerValue) {
  const ticker = normalizeDartTicker(tickerValue);
  if (!ticker) return false;
  const runtime = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.dartRequests);
  disclosureProgress.cancel(`disclosure:${ticker}`);
  disclosureProgress.cancel(`insider:${ticker}`);
  const disclosureCancelled = runtime?.cancel?.("disclosure-refresh", ticker) === true;
  const insiderCancelled = runtime?.cancel?.("insider", ticker) === true;
  return disclosureCancelled || insiderCancelled;
}

async function fetchDartDisclosuresLive(options = {}) {
  await ensureDartFeatureModules();
  const results = await mapWithConcurrency(
    disclosureTargetTickers(),
    DART_VISIBLE_REFRESH_CONCURRENCY,
    (ticker) => fetchDartDisclosuresForTickerLive(ticker, options),
  );
  return sanitizeDisclosureRows(results.flat());
}

async function fetchDartDisclosuresForTickerLive(ticker, options = {}) {
  await ensureDartFeatureModules();
  const context = await resolveDartCompanyContext(ticker, {
    ensureCorpCode: ensureDartCorpCodeMapLoaded,
    getCorpCode: dartCorpCodeFor,
    requireAccessToken: !IS_LOCAL_RUNTIME,
    getAccessToken: getDartGatewayAccessToken,
  });
  if (!context) return [];
  const { ticker: targetTicker, corpCode } = context;
  const latestDate = disclosureRowsForTicker(targetTicker).at(-1)?.date || "";
  return fetchProgressiveRecords({
    since: latestDate,
    normalizeRecords: sanitizeDisclosureRows,
    mergeRecords: mergeDisclosureRows,
    onBatch: options?.onBatch,
    createResponseError: (payload) => {
      const detail = String(payload?.error || "").trim();
      return new Error(detail || "ThinkStock DART 중계 서버가 응답하지 않습니다.");
    },
    fetchPage: async ({ page, since }) => {
      try {
        return await runtimeGatewayClient.fetchDisclosures({
          ticker: targetTicker,
          corpCode,
          progressive: true,
          since,
          page,
        }, {
          forceNetwork: options?.forceNetwork,
          signal: options?.signal || null,
          timeoutMs: DART_GATEWAY_REQUEST_TIMEOUT_MS,
        });
      } catch (error) {
        throw toDartGatewayError(error);
      }
    },
  });
}

function insiderTradeRowsForTicker(ticker) {
  const target = String(ticker || "").trim().toUpperCase();
  return sanitizeInsiderTradeRows(appData.insiderTradeRows.filter((row) => row.ticker === target));
}

async function requestInsiderTradesForTicker(ticker, options = {}) {
  await ensureDartFeatureModules();
  const target = normalizeDartTicker(ticker);
  if (!target) return [];
  const eventLifecycle = getDartEventLifecycle();
  if (!options.forceNetwork && eventLifecycle.isInsiderLoaded(target)) {
    return insiderTradeRowsForTicker(target);
  }
  const name = labelName(target);
  const progressKey = `insider:${target}`;
  const trackProgress = chartSession.showInsiderTrades && options.trackProgress !== false;
  await ensureDartFeatureModules();
  return getDartRequestRuntime().runTracked("insider", target, async (requestSignal, progress) => {
    eventLifecycle.setInsiderPending(target, true);
    const context = await resolveDartCompanyContext(target, {
      ensureCorpCode: ensureDartCorpCodeMapLoaded,
      getCorpCode: dartCorpCodeFor,
      requireAccessToken: !IS_LOCAL_RUNTIME,
      getAccessToken: getDartGatewayAccessToken,
    });
    progress.update(0.32);
    let payload;
    try {
      payload = await runtimeGatewayClient.fetchInsiderTrades({ ticker: target, corpCode: context.corpCode }, {
        forceNetwork: options.forceNetwork,
        signal: requestSignal,
        timeoutMs: DART_GATEWAY_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw toDartGatewayError(error);
    }
    progress.update(0.78);
    if (payload?.ok === false) {
      throw new Error(String(payload?.error || "DART 내부거래 데이터를 가져오지 못했습니다."));
    }
    const rows = sanitizeInsiderTradeRows(payload?.records || []);
    progress.update(0.92);
    const merged = mergeInsiderTradeRowsWithChange(appData.insiderTradeRows, rows);
    appData.insiderTradeRows = merged.rows;
    eventLifecycle.markInsiderLoaded(target);
    if (merged.changed) queueEventMarkerRefresh("insider");
    return rows;
  }, {
    force: options.forceNetwork === true,
    signal: options.signal || null,
    progress: disclosureProgress,
    progressKey,
    progressLabel: `${name} 내부거래`,
    trackProgress,
    initialProgress: 0.12,
  }).finally(() => {
    eventLifecycle.setInsiderPending(target, false);
  });
}

function refreshInsiderTradesForVisibleSeries(options = {}) {
  return ensureDartFeatureModules()
    .then(() => getDartEventLifecycle().refreshVisibleInsiders(options));
}

function queueInsiderTradeRefresh() {
  if (!chartSession.showInsiderTrades) return false;
  ensureDartFeatureModules()
    .then(() => getDartEventLifecycle().scheduleInsiderRefresh())
    .catch((error) => recordRuntimeError("insider-feature-load", error));
  return true;
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
  return getDisclosureStateController().merge(incomingRows);
}

function disclosureRowsForTicker(ticker) {
  return getDisclosureStateController().rowsForTicker(ticker);
}

function getTickerDisclosureCache() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.disclosureCache, () => (
    createTickerDisclosureCache({
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
    })
  ));
}

function getDisclosureStateController() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.disclosureState, () => (
    createDisclosureStateController({
      dataService: disclosureDataService,
      getRows: () => appData.disclosureRows,
      setRows: (rows) => { appData.disclosureRows = rows; },
      getTickerCache: getTickerDisclosureCache,
    })
  ));
}

async function applyTickerDisclosureCache(ticker) {
  return getDisclosureStateController().applyTickerCache(ticker);
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
    await getDisclosureStateController().writeTicker(target);
  }
  return {
    ticker: target,
    added: merged.added,
    seeded: true,
    latestDate: rows.at(-1)?.date || "",
  };
}

async function ensureDisclosureSeedForTicker(ticker, forceNetwork = false) {
  const target = normalizeDartTicker(ticker);
  if (!target) return { ticker: "", added: 0 };
  if (disclosureSeedLoadedTickers.has(target) && !forceNetwork) return { ticker: target, added: 0 };
  await ensureDartFeatureModules();
  return getDartRequestRuntime().run("disclosure-seed", target, async () => {
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
  const targets = [...new Set((tickers || []).map((ticker) => normalizeDartTicker(ticker)).filter(Boolean))];
  const results = await mapWithConcurrency(
    targets,
    DART_VISIBLE_REFRESH_CONCURRENCY,
    (ticker) => ensureDisclosureSeedForTicker(ticker, forceNetwork),
  );
  return results.reduce((sum, result) => sum + (result?.added || 0), 0);
}

async function refreshDartDisclosuresFromApi(ticker = "", options = {}) {
  await ensureDartFeatureModules();
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const targetTicker = String(ticker || "").trim().toUpperCase();
  const beforeCount = appData.disclosureRows.length;
  let servedFromCache = false;
  const disclosureState = getDisclosureStateController();
  if (targetTicker && !options.forceNetwork && disclosureState.hasFreshRefresh(targetTicker)) {
    const cached = disclosureState.getRefreshEntry(targetTicker);
    return {
      fetched: 0,
      added: 0,
      latestDate: cached?.latestDate || "",
      cached: true,
    };
  }
  const liveRows = ticker
    ? await fetchDartDisclosuresForTickerLive(targetTicker, {
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
    : await fetchDartDisclosuresLive({ signal });
  throwIfAborted(signal);
  mergeDisclosureRowsIntoState(liveRows);
  const latestDate = targetTicker
    ? (disclosureRowsForTicker(targetTicker).at(-1)?.date || "")
    : (appData.disclosureRows.at(-1)?.date || "");
  const info = {
    fetched: liveRows.length,
    added: Math.max(0, appData.disclosureRows.length - beforeCount),
    latestDate,
    cached: servedFromCache,
  };
  if (targetTicker) {
    disclosureState.rememberRefresh(targetTicker, info);
    disclosureState.writeTicker(targetTicker).catch(() => {});
  } else {
    disclosureState.writeTickers(liveRows.map((row) => row.ticker));
  }
  return info;
}

async function refreshDartDisclosuresForVisibleTickersFromApi(options = {}) {
  await ensureDartFeatureModules();
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const tickers = visibleDisclosureTargetTickers();
  const uniqueTickers = [...new Set(tickers)];
  const beforeCount = appData.disclosureRows.length;
  const incomingRows = [];
  const failed = [];
  let authFailure = false;
  let cached = 0;
  const disclosureState = getDisclosureStateController();

  const results = await mapWithConcurrency(uniqueTickers, DART_VISIBLE_REFRESH_CONCURRENCY, async (ticker) => {
    try {
      if (!options.forceNetwork && disclosureState.hasFreshRefresh(ticker)) {
        return { ticker, rows: [], cached: true };
      }
      const rows = await fetchDartDisclosuresForTickerLive(ticker, {
        signal,
        forceNetwork: options.forceNetwork,
      });
      throwIfAborted(signal);
      disclosureState.rememberRefresh(ticker, {
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
  disclosureState.writeTickers(uniqueTickers);

  const latestDate = appData.disclosureRows.length ? appData.disclosureRows[appData.disclosureRows.length - 1].date : "";
  return {
    fetched: incomingRows.length,
    added: Math.max(0, appData.disclosureRows.length - beforeCount),
    latestDate,
    failed: authFailure
      ? ["Think Stock 접속 코드가 올바르지 않습니다. 설정에서 다시 저장해 주세요."]
      : failed,
    cached,
  };
}

function requestDartDisclosureRefreshForTicker(ticker, msgEl) {
  const target = normalizeDartTicker(ticker);
  if (!target) return;
  const name = labelName(target);
  const progressKey = `disclosure:${target}`;
  const trackProgress = chartSession.showDisclosures;
  return ensureDartFeatureModules().then(() => getDartRequestRuntime().runTracked(
    "disclosure-refresh",
    target,
    async (requestSignal, progressTask) => {
    const seedInfo = await ensureDisclosureSeedForTicker(target);
    progressTask.update(0.2);
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
            const ratio = Math.max(0, Math.min(1,
              Number(progress.page || 0) / Math.max(1, Number(progress.totalPages || 1))));
            progressTask.update(0.2 + (ratio * 0.75));
            const pageText = progress.cached
              ? "저장된 공시를 불러왔습니다."
              : `최신 공시 확인 중 ${progress.page}/${progress.totalPages}`;
            setMessage(msgEl, [`${name} 종목이 추가되었습니다.`, pageText]);
          },
      };
      const refreshInfo = await refreshDartDisclosuresFromApi(target, refreshOptions);
      if (refreshInfo?.added > 0 || refreshInfo?.fetched > 0) {
        queueDisclosureTraceRefresh();
      }
    }
    scheduleLastRuntimeSnapshotSave();
    const rows = disclosureRowsForTicker(target);
    setMessage(msgEl, rows.length
      ? [`${name} 종목을 추가했습니다.`, `주요 공시 ${rows.length}건을 반영했습니다.`]
      : [`${name} 종목을 추가했습니다.`, "표시할 주요 공시가 없거나 다음 공시 갱신을 기다리는 중입니다."]);
    }, {
    signal: null,
    progress: disclosureProgress,
    progressKey,
    progressLabel: `${name} 공시`,
    trackProgress,
    },
  )).catch((error) => {
    setMessage(msgEl, [
      `${name} 종목은 추가됐지만 최신 DART 공시를 확인하지 못했습니다.`,
      error.message,
    ], true);
  });
}

function isEventMarkerLayerEnabled(layer) {
  if (layer === "insider") return chartSession.showInsiderTrades;
  if (layer === "timing") return chartSession.showRecessionSignals;
  return layer === "disclosure" && chartSession.showDisclosures;
}

function getChartUpdateCoordinator() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.chartUpdates, () => (
    chartUpdateCoordinatorModule.createChartUpdateCoordinator(globalThis, {
    eventLayers: ["disclosure", "insider", "timing"],
    requestRender: (preserveZoom, options) => (
      getMainChartRenderScheduler().request(preserveZoom, options)
    ),
    requestMarkerFrame: (requestOptions) => chartVisualFrameCoordinator.schedule({
      markers: true,
      handles: true,
      reason: requestOptions?.reason || "event-marker-data",
    }),
    isRendering: () => Boolean(
      appRuntimeRegistry.peek(APP_RUNTIME_KEYS.mainChartScheduler)?.isRendering(),
    ),
    isEventLayerEnabled: isEventMarkerLayerEnabled,
    prepareComposition: queueAutoCompositionViewport,
    applyResetPolicy: applyChartResetPolicy,
    persistState: saveState,
    })
  ));
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
  const target = normalizeDartTicker(ticker);
  if (!target) return Promise.resolve();
  const plan = resolveTickerDartPreloadPlan(chartSession);
  if (!plan.required) return Promise.resolve({ skipped: true });
  const disclosureTask = plan.disclosures
    ? requestDartDisclosureRefreshForTicker(target, msgEl)
    : Promise.resolve();
  const disclosureReady = Promise.resolve(disclosureTask).catch(() => undefined);
  if (!plan.insiders || !canUseDartGateway()) return disclosureReady;
  // Let disclosures start first, but never make insider data wait on a slow disclosure response.
  globalThis.setTimeout(() => {
    if (!chartSession.showInsiderTrades
      || !canUseDartGateway()
      || !customStocks.some((stock) => stock.ticker === target)) return;
    requestInsiderTradesForTicker(target, {
      trackProgress: true,
    }).catch(() => {});
  }, 250);
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
    if (chartSession.showAiForecast) requestAiForecastRender();
  });
  return true;
}

/* Main chart */

async function applyMainChartRender(el, traces, layout, invalidation = {}) {
  return getMainChartRenderScheduler().apply(el, traces, layout, invalidation);
}

function getMainChartRenderScheduler() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.mainChartScheduler, () => (
    chartUpdateCoordinatorModule.createMainChartRenderRuntime(globalThis, {
      renderer: mainChartRenderer,
      updateRuntime: plotlyUpdateRuntime,
      telemetry: chartRenderTelemetry,
      getPlotly: () => Plotly,
      config: PLOTLY_CONFIG,
      beforeScheduledRender: () => chartVisualFrameCoordinator.whenSettled(),
      render: renderChart,
      schedulerOptions: {
        deferDelayMs: INTERACTION_RENDER_DELAY_MS,
        isInteractionBusy: isChartInteractionBusy,
        afterBatch: () => {
          if (!chartSession.pendingAutoChartFit) return;
          const expandOnly = chartSession.pendingAutoChartFitExpandOnly;
          chartSession.pendingAutoChartFit = false;
          chartSession.pendingAutoChartFitExpandOnly = false;
          if (chartSession.autoChartReset) return fitCurrentChartRatio({ expandOnly });
        },
        afterSettled: flushQueuedEventMarkerRefresh,
        onError: (err) => {
          const msgEl = document.getElementById("messageArea");
          setMessage(msgEl, err.message || "차트 렌더링 오류", true);
        },
      },
    })
  ));
}

function requestChartRender(preserveZoom = true, options = {}) {
  return getChartUpdateCoordinator().requestRender(preserveZoom, options);
}

function requestAiForecastRender() {
  const render = () => requestChartRender(true, {
      deferDuringInteraction: false,
      reason: "ai-forecast",
      updateClass: "forecast",
    });
  const aiApp = getLoadedAiForecastApp();
  return aiApp?.requestRender ? aiApp.requestRender(render) : render();
}

function withAiForecastRenderHold(task) {
  const aiApp = getLoadedAiForecastApp();
  return aiApp?.withRenderHold
    ? aiApp.withRenderHold(task, { flush: false })
    : task();
}

function renderChartWhenIdleOrNow(preserveZoom = true) {
  return getMainChartRenderScheduler().runWhenIdleOrNow(preserveZoom);
}

function runMainChartRender(preserveZoom = true) {
  return getMainChartRenderScheduler().run(preserveZoom);
}

function aiForecastHistoryRows(series) {
  const source = Array.isArray(appData.pricePayload?.records) ? appData.pricePayload.records : [];
  return source.filter((row) => (
    /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "").slice(0, 10))
    && Number.isFinite(toNum(row?.[series]))
    && toNum(row?.[series]) > 0
  ));
}

function getAiForecastTracesRuntime() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.aiForecastTraces, () => {
    const feature = requireLoadedAiFeature();
    const forecastApp = getLoadedAiForecastApp();
    if (!forecastApp) throw new Error("AI forecast app is not loaded");
    const state = {
      get aiAnalysisByTicker() { return aiAnalysisByTicker; },
      get aiAnalysisPendingTickers() { return aiAnalysisPendingTickers; },
      get brokerResearchByTicker() {
        return appRuntimeRegistry.peek(APP_RUNTIME_KEYS.brokerResearch)?.summaries
          || EMPTY_BROKER_RESEARCH_BY_TICKER;
      },
      get brokerResearchPendingTickers() {
        return appRuntimeRegistry.peek(APP_RUNTIME_KEYS.brokerResearch)?.pendingTickers
          || EMPTY_BROKER_RESEARCH_PENDING_TICKERS;
      },
      get aiContextPendingTickers() { return aiContextPendingTickers; },
      get aiFeature() { return getLoadedAiFeature(); },
      get aiForecastCalculationCounts() { return aiForecastCalculationCounts; },
      get aiForecastDeferredSeries() { return aiForecastDeferredSeries; },
      get aiForecastResultBySeries() { return aiForecastResultBySeries; },
      get aiForecastTargetRevision() { return aiForecastTargetRevision; },
      get aiForecastTargetSeries() { return aiForecastTargetSeries; },
      get aiMarketModel() { return aiMarketModel; },
      get aiMarketModelLoadSettled() { return aiMarketModelLoadSettled; },
      get adrRows() { return appData.adrRows; },
      get creditRows() { return appData.creditRows; },
      get crisisRows() { return appData.crisisRows; },
      get macroRows() { return appData.macroRows; },
      set lastAiForecastTraceCount(value) { lastAiForecastTraceCount = Number(value) || 0; },
    };
    return feature.traces.createAiForecastTraces({
      MAIN_LINE_TRACE_TYPE,
      aiForecastApp: forecastApp,
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
        appRuntimeRegistry.peek(APP_RUNTIME_KEYS.marketTiming)?.get(series)?.contextProfile?.structural || null
      ),
      fingerprintDatedSeries: seriesIntegrityModule.fingerprintDatedSeries,
      getPriceSourceRevision: () => dataRevisionSignature("price"),
      inputCacheModule: feature.inputCache,
      invertSeriesTransform,
      labelName,
      queueAiForecastJournalSync,
      resolveScenarioPresentation: feature.scenarios?.resolveScenarioPresentation,
      resetAiForecastProgress,
      runAiForecast,
      setAiForecastProgress,
      showAiForecastUnavailable,
      startAiForecastProgress,
      state,
      syncAiForecastToggleButton,
      waitForAiProgressPaint,
    });
  });
}
async function buildAiForecastTraces(rows, seriesModels) {
  if (!chartSession.showAiForecast) return [];
  await ensureAiFeatureModules();
  return getAiForecastTracesRuntime().build(rows, seriesModels);
}
function buildEpsTraceModel(seriesModels) {
  const epsChartModule = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.epsFeature);
  if (!chartSession.showEps || !epsChartModule) return { traces: [], baseValuesBySeries: {} };
  return epsChartModule.buildEpsTraceModel({
    analysesByTicker: aiAnalysisByTicker,
    seriesModels,
    hiddenSeries: chartSession.hiddenSeries,
    lineTraceType: MAIN_LINE_TRACE_TYPE,
    hoverShowPopup: chartSession.hoverShowPopup,
    labelName,
    seriesColor,
    seriesScales: chartSession.seriesScales,
    seriesOffsets: chartSession.seriesOffsets,
    transformValues: transformSeriesValues,
  });
}
function buildCurrentEventMarkerTraces(markerArguments) {
  if (!chartSession.showRecessionSignals) {
    lastRecessionSignalCount = 0;
    lastMarketTimingBuyCount = 0;
    lastMarketTimingSellCount = 0;
  }
  if (!chartSession.showInsiderTrades) {
    eventMarkerRenderState.insiderStats = {
      total: appData.insiderTradeRows.length,
      candidates: 0,
      markers: 0,
    };
  }
  if (!chartSession.showDisclosures) {
    eventMarkerRenderState.disclosureStats = {
      total: appData.disclosureRows.length,
      candidates: 0,
      markers: 0,
    };
  }

  const traces = chartMarkerRuntimeModule.materializeEventMarkerTraces(
    currentEventMarkerSpecs(markerArguments),
  );
  syncRecessionToggleButton();
  syncInsiderTradeToggleButton(eventMarkerRenderState.insiderStats.markers);
  syncDisclosureToggleButton(eventMarkerRenderState.disclosureStats.markers);
  return traces;
}

function prependGroupedHoverTraces(traces, seriesOrder, eventRevisions = null) {
  traces.unshift(...mainChartRenderer.buildGroupedHoverTraces({
    enabled: chartSession.hoverShowPopup,
    traces,
    seriesOrder,
    labelName,
    revision: eventRevisions
      ? Object.entries(eventRevisions).sort(([left], [right]) => left.localeCompare(right)).join("|")
      : "",
  }));
  return traces;
}

async function applyEventMarkerOnlyRender(el, invalidation, eventMarkerRevisionsAtStart, perfStartedAt) {
  if (!mainChartRenderer.isMarkerOnlyInvalidation(invalidation)) return false;
  const model = chartSession.currentMainChartModel;
  if (!model?.selected?.length || !model?.seriesModels?.length || !Array.isArray(el?.data)) return false;
  const disclosureWasPresent = el.data.some((trace) => trace?.meta?.isDisclosureTrace);
  const staticTraces = el.data.filter((trace) => !mainChartRenderer.isEventMarkerTrace(trace));
  if (!staticTraces.length) return false;
  const markerArguments = currentEventMarkerArguments(model);
  const traces = [
    ...staticTraces.filter((trace) => !trace?.meta?.isGroupedHoverTrace),
    ...buildCurrentEventMarkerTraces(markerArguments),
  ];
  prependGroupedHoverTraces(traces, model.selected, eventMarkerRevisionsAtStart);
  if (invalidation.shouldAbort?.()) return true;
  const renderMode = await applyMainChartRender(el, traces, el.layout || {}, invalidation);
  if (chartSession.showDisclosures || disclosureWasPresent) {
    eventMarkerRenderState.partialUpdateCount += 1;
  }
  invalidateChartInteractionCaches(el);
  markEventMarkerRenderApplied(eventMarkerRevisionsAtStart);
  getMainChartEvents().bind(el);
  scheduleHandleUpdate(0);
  recordPerfSample("renderChart", perfStartedAt, {
    rows: model.rows?.length || 0,
    displayRows: model.displayIndexes?.length || model.rows?.length || 0,
    series: model.selected.length,
    disclosures: eventMarkerRenderState.disclosureStats.markers,
    groupedHoverCache: mainChartRenderer.groupedHoverCacheStats(),
    markerOnly: true,
    renderMode,
  });
  return true;
}

function getMainChartEvents() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.mainChartEvents, () => {
    const interactionState = {
      get chartSyncing() { return chartSyncing; },
      get cursorSyncing() { return cursorSyncing; },
      get hoverSyncing() { return hoverSyncing; },
      get isHandleDragging() { return isHandleDragging; },
      get suppressPlotlyClickUntil() { return suppressPlotlyClickUntil; },
      get useViewportEventMarkerGap() { return useViewportEventMarkerGap; },
      set useViewportEventMarkerGap(value) { useViewportEventMarkerGap = Boolean(value); },
    };
    return mainChartEventsModule.createMainChartEvents(globalThis, {
      HANDLE_UPDATE_DEBOUNCE_MS,
      MAX_VISIBLE_MAIN_SERIES_MESSAGE,
      chartSession,
      clearAutoResetSeriesTransforms,
      clearHoverOnChart,
      configureExactDateEventHover,
      enforceMainChartSeriesLimit,
      handlePriorityChartClick,
      hideDisclosurePopover,
      interactionState,
      isTouchDevice,
      noteStockVisibilityChange,
      normalizeHoverPopupIndent,
      refreshAiForecastTargets,
      renderCoMovementPanel,
      requestChartCompositionUpdate,
      scheduleHandleUpdate,
      scheduleViewportWindowRender,
      scheduleViewportRangeSync,
      setAiForecastTargetVisibility,
      setMainChartSeriesVisible,
      showChartNavigationMessage,
      syncHoverToChart,
      toMsSafe,
    });
  });
}

function resetMainChartInteractionRenderState(element) {
  hoveredLineTraceIndex = null;
  activeLineTraceIndex = null;
  appliedLineHighlightTraceIndex = null;
  eventMarkerRenderState.highlight = null;
  element?.classList?.remove("is-line-hovering", "is-line-dragging", "is-event-marker-hovering");
}

async function renderChart(preserveZoom = true, invalidation = {}) {
  const perfStartedAt = startPerfSample();
  const renderGuard = chartUpdateCoordinatorModule.createMainChartRenderGuard({
    getAiRevision: () => aiForecastToggleRevision,
    getViewportRevision: () => chartViewportInteractionRevision,
    requestViewportRender: () => requestChartRender(true, {
      reason: "viewport-revision",
      updateClass: "viewport",
    }),
  });
  const queueCurrentViewportRender = renderGuard.queueCurrentViewportRender;
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
  const eventMarkerRevisionsAtStart = getChartUpdateCoordinator().eventRevisions();
  if (await applyEventMarkerOnlyRender(
    el,
    invalidation,
    eventMarkerRevisionsAtStart,
    perfStartedAt,
  )) return;
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
  if (!model || invalidation.shouldAbort?.()) return;
  const { rows, selected, seriesModels } = model;
  const viewportSlice = getMainViewportWindowController().build(model, [frameStart, frameEnd]);
  // Live handle/line transforms belong to the viewport session, not the reusable calculation cache.
  chartUpdateCoordinatorModule.hydrateMainChartSession(chartSession, model, {
    captureLockedFrame: captureLockedChartFrame,
    createSessionModel: mainChartModelModule.createMainChartSessionModel,
    dataEnd,
    dataStart,
    frameEnd,
    frameStart,
    syncSeries: syncSeriesToggleBoard,
  });
  const shouldHydrateChartData = chartUpdateCoordinatorModule.shouldHydrateChartData(invalidation);
  if (shouldHydrateChartData) queueInsiderTradeRefresh();
  if (!chartSession.showDisclosures) hideDisclosurePopover();
  resetMainChartInteractionRenderState(el);

  if (!rows.length || !selected.length) {
    markEventMarkerRenderApplied(eventMarkerRevisionsAtStart);
    msgEl.innerHTML = '<div class="message error">표시할 데이터가 없습니다.</div>';
    return;
  }
  msgEl.innerHTML = "";

  const frame = await chartUpdateCoordinatorModule.buildMainChartRenderFrame({
    element: el,
    renderer: mainChartRenderer,
    model,
    invalidation,
    baseValuesBySeries: baseTraceValues,
    visibleLineDataRangeMs,
    shouldAbort: () => renderGuard.shouldAbort(invalidation),
    composition: {
      displayIndexes: viewportSlice.displayIndexes,
      hiddenSeries: chartSession.hiddenSeries,
      lineTraceType: MAIN_LINE_TRACE_TYPE,
      hoverShowPopup: chartSession.hoverShowPopup,
      labelName,
      renderRevision: `${model.renderRevision || ""}|window:${viewportSlice.window?.key || "full"}`,
      seriesColor,
      buildEpsTraceModel,
      buildAiForecastTraces,
      // Viewport, transform, and forecast-only frames reuse prepared timing data.
      prepareEventModels: shouldHydrateChartData ? prepareMarketTimingModels : null,
      buildEventArguments: currentEventMarkerArguments,
      buildEventTraces: buildCurrentEventMarkerTraces,
      eventRevisions: eventMarkerRevisionsAtStart,
      hasPendingEvents: getChartUpdateCoordinator().hasPendingEvents(),
    },
    viewport: {
      controller: chartViewportControllerModule,
      preserveZoom,
      autoChartReset: chartSession.autoChartReset,
      pinnedXRange: chartSession.pinnedXRange,
      userViewportPinned: chartSession.userViewportPinned,
      currentXRange: el._fullLayout?.xaxis?.range,
      currentYRange: chartSession.pendingAutoChartFit && !chartSession.pendingAutoChartFitExpandOnly
        ? null
        : el._fullLayout?.yaxis?.range,
      lockedYRange: lockedYRangeForRender,
      pendingCompositionViewport: chartSession.pendingCompositionViewport,
      futurePlanState: getFutureOverlayController().planState(),
      showAiForecast: chartSession.showAiForecast,
      showEps: chartSession.showEps,
      observedStart: start,
      observedEnd: end,
      rightPaddingMs: chartRightPaddingMs(),
      futureRevealLatestToleranceMs: Math.max(
        DAY_MS * 3,
        Math.max(0, toMsSafe(end) - toMsSafe(start)) * 0.001,
      ),
      toMilliseconds: toMsSafe,
      fitRangeForTraces,
      dayMs: DAY_MS,
      horizontalMargin: mainChartHorizontalMargin(),
      cursorLineMode: chartSession.cursorLineMode,
      hoverlabel: plotlyHoverLabel(),
    },
  });
  if (!frame) {
    queueCurrentViewportRender();
    return;
  }
  const {
    displayPointCount,
    layout,
    traces,
    viewportPlan,
  } = frame;
  if (queueCurrentViewportRender()) return;
  chartUpdateCoordinatorModule.applyMainChartViewportPlan(
    chartSession,
    viewportPlan,
    (plan) => getFutureOverlayController().applyPlan(plan),
  );
  resetMainChartInteractionRenderState(el);
  if (invalidation.shouldAbort?.() || queueCurrentViewportRender()) return;
  const renderMode = await applyMainChartRender(el, traces, layout, invalidation);
  if (queueCurrentViewportRender()) return;
  const renderedFrameRange = getCurrentXRangeMs(el);
  const finalizedFrame = chartUpdateCoordinatorModule.finalizeMainChartFrameState(
    chartSession,
    frame,
    {
      renderedRange: renderedFrameRange,
      tracesExceedVisibleYRange,
      xRange: el?._fullLayout?.xaxis?.range,
      yRange: el?._fullLayout?.yaxis?.range,
    },
  );
  const coMovementPanelController = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.coMovementPanel);
  if (chartSession.showCoMovement && !coMovementPanelController) {
    void renderCoMovementPanel();
  } else {
    coMovementPanelController?.flush();
  }
  markEventMarkerRenderApplied(eventMarkerRevisionsAtStart);
  scheduleDeferredAiForecastRender(seriesModels);
  if (shouldHydrateChartData) scheduleVisibleEpsData();
  if (renderGuard.aiChanged()) {
    requestChartRender(true, {
      deferDuringInteraction: false,
      reason: "ai-toggle-revision",
      updateClass: "forecast",
    });
    return;
  }
  if (!chartSession.autoChartReset && !chartSession.lockedHistoryYRange) captureLockedHistoryYRange();

  getMainChartEvents().bind(el);

  const mainRangeForAdr = finalizedFrame.mainRange;
  // Main and auxiliary charts keep independent render fingerprints. A main
  // no-op must not suppress an auxiliary-only data or viewport-buffer update.
  if (!invalidation.shouldAbort?.()
    && chartUpdateCoordinatorModule.shouldUpdateAuxiliary(invalidation)) {
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
    disclosures: eventMarkerRenderState.disclosureStats.markers,
    groupedHoverCache: mainChartRenderer.groupedHoverCacheStats(),
    lineDataCache: mainChartRenderer.lineDataCacheStats(),
    viewportWindowCache: getMainViewportWindowController().stats(),
    cacheHit: lastMainChartModelCacheHit,
    modelSource: lastMainChartModelSource,
    renderMode,
    updateClasses: [...(invalidation.updateClasses || [])],
  });
  const aiInputsReady = aiMarketModelLoadSettled
    && !aiForecastInputsPending();
  if (chartSession.showAiForecast && aiInputsReady) finishAiForecastProgress();
}

function getMacdModelForSeries(series) {
  const ticker = String(series || "").toUpperCase();
  if (!STOCK_TICKER_PATTERN.test(ticker)) return null;
  const records = Array.isArray(appData.pricePayload?.records) ? appData.pricePayload.records : [];
  const sourceFingerprint = seriesIntegrityModule.fingerprintDatedSeries(
      records,
      [ticker],
      { tail: 520, logicVersion: "macd-v2" },
    );
  return macdModelCache.resolve(ticker, sourceFingerprint, () => buildMacdOscillator({
    dates: records.map((row) => row?.date),
    prices: records.map((row) => row?.[ticker]),
  }));
}

async function getAuxiliaryChartRuntime() {
  return appRuntimeRegistry.getAsync(APP_RUNTIME_KEYS.auxiliaryChart, async () => {
    const auxiliaryChartFeature = await optionalFeatureRuntime.ensureAuxiliaryChart();
    const auxiliaryChartRuntimeModule = auxiliaryChartFeature.runtime;
    const auxiliaryChartModelModule = auxiliaryChartFeature.model;
    if (!auxiliaryChartRuntimeModule?.createAuxiliaryChartRuntime || !auxiliaryChartModelModule) {
      throw new Error("보조차트 기능 모듈을 불러오지 못했습니다.");
    }
    const dataState = {
      get pricePayload() { return appData.pricePayload; },
      get adrRows() { return appData.adrRows; },
      get macroRows() { return appData.macroRows; },
    };
    const syncState = {
      get chartSyncing() { return chartSyncing; },
      set chartSyncing(value) { chartSyncing = Boolean(value); },
      get hoverSyncing() { return hoverSyncing; },
      get cursorSyncing() { return cursorSyncing; },
    };
    return auxiliaryChartRuntimeModule.createAuxiliaryChartRuntime(globalThis, {
      ADR_HIGH_THRESH,
      ADR_LOW_THRESH,
      ADR_BAND_COLOR,
      ADR_ZONE_HIGH_COLOR,
      ADR_ZONE_LOW_COLOR,
      AUXILIARY_ZONE_HIGH_FILL_COLOR,
      AUXILIARY_ZONE_LOW_FILL_COLOR,
      AUXILIARY_PANEL_KEYS,
      AUXILIARY_SERIES_KEYS,
      FEAR_GREED_HIGH_THRESH,
      FEAR_GREED_LOW_THRESH,
      MACD_STOCK_PATTERN: STOCK_TICKER_PATTERN,
      NEWS_SENTIMENT_HIGH_THRESH,
      NEWS_SENTIMENT_LOW_THRESH,
      SERIES_COLORS,
      auxiliaryChartHorizontalMargin,
      buildCursorHoverMode,
      buildCursorLineAxisLayout,
      buildThresholdEnvelopeSeries: auxiliaryChartModelModule.buildThresholdEnvelopeSeries,
      buildThresholdFillPolygons: auxiliaryChartModelModule.buildThresholdFillPolygons,
      buildAuxiliaryPanelLayout: auxiliaryChartModelModule.buildAuxiliaryPanelLayout,
      buildAuxiliaryViewportRanges: auxiliaryChartModelModule.buildAuxiliaryViewportRanges,
      chartDisplaySampler: chartDisplaySamplerModule,
      chartSession,
      clearHoverOnChart,
      dataRevisionSignature,
      dataState,
      requestAuxiliaryChartModel: (payload) => requestChartModelFromWorker(
        payload,
        "buildAuxiliaryChartModel",
      ),
      buildAuxiliaryChartModel: auxiliaryChartModelModule.buildAuxiliaryChartModel,
      normalizeAuxiliaryChartModel: chartRenderContractModule.normalizeAuxiliaryChartModel,
      getMacdModelForSeries,
      fitRangeForTraces,
      isTouchDevice,
      labelName,
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
  });
}

function invalidateAdrChartRender() {
  appRuntimeRegistry.peek(APP_RUNTIME_KEYS.auxiliaryChart)?.invalidateAdr();
}

function renderMacdChart(xRange) {
  return getAuxiliaryChartRuntime().then((runtime) => runtime.renderMacdChart(xRange));
}

const ADR_SOURCE_URL = "http://www.adrinfo.kr/chart";
const CORS_PROXY     = "https://corsproxy.io/?url=";

function renderAdrChart(xRange) {
  return getAuxiliaryChartRuntime().then((runtime) => runtime.renderAdrChart(xRange));
}

async function refreshLoadedAuxiliaryViewport() {
  const runtime = appRuntimeRegistry.peek(APP_RUNTIME_KEYS.auxiliaryChart);
  const mainElement = document.getElementById("chart");
  const xRange = Array.isArray(chartSession.pinnedXRange)
    ? chartSession.pinnedXRange.slice(0, 2)
    : mainElement?._fullLayout?.xaxis?.range?.slice(0, 2);
  if (!runtime || xRange?.length !== 2) return;
  await Promise.allSettled([
    runtime.renderMacdChart([...xRange]),
    runtime.renderAdrChart([...xRange]),
  ]);
}

async function refreshLoadedChartCompanions() {
  await refreshLoadedAuxiliaryViewport();
  flushLoadedCoMovementPanel();
}

function flushLoadedCoMovementPanel() {
  if (!chartSession.showCoMovement) return null;
  return appRuntimeRegistry.peek(APP_RUNTIME_KEYS.coMovementPanel)?.flush?.() || null;
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
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.runtimeSeries, () => (
    runtimeSeriesMergeModule.createRuntimeSeriesController({
    creditKeys: CREDIT_COLS,
    buildDenseMacroRows,
    getPriceDates: () => (appData.pricePayload?.records || []).map((row) => row?.date).filter(Boolean),
    getRows: (name) => ({ macro: appData.macroRows, credit: appData.creditRows, crisis: appData.crisisRows, adr: appData.adrRows }[name]),
    setRows: (name, rows) => {
      if (name === "macro") appData.macroRows = rows;
      else if (name === "credit") appData.creditRows = rows;
      else if (name === "crisis") appData.crisisRows = rows;
      else if (name === "adr") appData.adrRows = rows;
    },
    policiesFor: runtimePoliciesFor,
    validate: validateRuntimeSeriesCandidate,
    })
  ));
}

const applyNewsSentimentLiveRows = (...args) => (
  getRuntimeSeriesController().applyNewsSentimentLiveRows(...args)
);

function getRuntimeMarketRefresh() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.runtimeMarketRefresh, () => (
    runtimeMarketRefreshModule.createRuntimeMarketRefresh({
      gateway: runtimeGatewayClient,
      timeoutMs: DART_GATEWAY_REQUEST_TIMEOUT_MS,
      isLocal: IS_LOCAL_RUNTIME,
      canUseGateway: canUseDartGateway,
      creditKeys: CREDIT_COLS,
      vkospiSeries: VKOSPI_SERIES,
      vixSeries: VIX_SERIES,
      getPricePayload: () => appData.pricePayload,
      getCreditRows: () => appData.creditRows,
      getSeriesController: getRuntimeSeriesController,
      policiesFor: runtimePoliciesFor,
    })
  ));
}

const refreshEcosMacroFromGateway = (...args) => getRuntimeMarketRefresh().refreshMacro(...args);
const refreshCreditFromGateway = (...args) => getRuntimeMarketRefresh().refreshCredit(...args);
const refreshCrisisSignalFromGateway = (...args) => getRuntimeMarketRefresh().refreshCrisis(...args);

function refreshSourceWithRetry(kind, task, signal = null) {
  return runtimeFreshnessPolicyModule.executeRuntimeSourcePlan(kind, {
    primary: () => task(),
  }, {
    signal,
    isRetryable: runtimeRefreshOrchestratorModule.isRetryableRuntimeError,
  }).then((result) => result.value);
}
function applyAdrLiveRows(incomingRows) {
  const result = adrDataModule.mergeAdrLiveRows(appData.adrRows, incomingRows);
  if (result.changed) {
    const validation = validateRuntimeSeriesCandidate(
      "ADR",
      appData.adrRows,
      result.rows,
      incomingRows,
      ADR_SERIES,
    );
    appData.adrRows = validation.rows || result.rows;
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
    sourceRows: appData.adrRows,
    incomingRows: liveRows,
    keys: FEAR_GREED_SERIES,
    policies: runtimePoliciesFor(FEAR_GREED_SERIES),
  });
  if (result.updated) {
    const validation = validateRuntimeSeriesCandidate(
      "fear greed",
      appData.adrRows,
      result.rows,
      liveRows,
      FEAR_GREED_SERIES,
    );
    appData.adrRows = validation.rows || result.rows;
  }
  return { added: result.updated, latestDate: result.latestDate };
}

async function loadData(forceNetwork = false, options = {}) {
  const mergeWithExisting = Boolean(options?.mergeWithExisting);
  const preserveExisting = Boolean(options?.preserveExisting);
  const segment = options?.segment === "history" ? "history" : "recent";
  const includeDisclosures = options?.includeDisclosures !== false;
  const {
    parsed,
    allCoreSeedsLoaded,
    allUsedFullFallback,
  } = await seedBundleLoader.load({
    segment,
    forceNetwork,
    includeDisclosures,
  });
  const seedMerge = runtimeDataTransactionModule.mergeRuntimeSeedComponents({
    current: appData.snapshot([
      "pricePayload",
      "macroRows",
      "creditRows",
      "adrRows",
      "disclosureRows",
    ]),
    parsed,
    mergeWithExisting,
    preserveExisting,
    operations: {
      mergeDisclosureRows,
      mergePricePayloadPreferIncoming,
      mergePricePayloadPreservingExisting,
      mergeRowsPreferIncoming,
      mergeRowsPreservingExisting,
      normalizeCreditRows,
      sanitizeDisclosureRows,
    },
  });
  appData.patch(seedMerge.components);
  Object.assign(DISPLAY_NAMES, appData.pricePayload.display_names || {});

  if (parsed.disclosurePayload?.format === "by-ticker-v1") {
    disclosureManifest = parsed.disclosurePayload;
    if (!mergeWithExisting) {
      if (appData.disclosureRows.length) {
        appData.disclosureRows = [];
      }
      disclosureSeedLoadedTickers = new Set();
    }
    await ensureDisclosureSeedsForTickers(disclosureTargetTickers(), forceNetwork);
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

function prepareHistoricalDataForAiForecast() {
  if (historicalDataLoaded && hasHistoricalDataCoverage()) return Promise.resolve(true);
  const lockedViewportRange = !chartSession.autoChartReset ? getCurrentMainXRange() : null;
  setAiForecastProgress(8, "전체 과거 학습 데이터 준비");
  return ensureHistoricalDataLoaded(false)
    .catch(() => false)
    .finally(() => {
      // Loading AI training history must not replace a viewport the user explicitly locked.
      if (!chartSession.autoChartReset && lockedViewportRange) chartSession.pinnedXRange = [...lockedViewportRange];
      if (chartSession.showAiForecast) {
        requestChartRender(!chartSession.autoChartReset, {
          deferDuringInteraction: false,
          reason: "ai-history-data",
          updateClass: "data",
        });
      }
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
  if (mainDataChanged && chartSession.autoChartReset) {
    chartSession.pendingAutoChartFit = true;
    chartSession.pendingAutoChartFitExpandOnly = false;
  }
  if (options.backgroundBatch) {
    const shouldRender = mainDataChanged || renderAuxiliaryOnly || renderDisclosureOnly;
    if (shouldRender) {
      const renderTask = runtimeRefreshRenderBatcher.schedule({
        main: mainDataChanged,
        auxiliary: renderAuxiliaryOnly,
        disclosure: renderDisclosureOnly,
      });
      if (options.awaitBackgroundBatch) await renderTask;
    }
    return { revisionsAfter, mainDataChanged, adrDataChanged, disclosureDataChanged };
  }
  if (mainDataChanged) {
    const preserveViewport = chartSession.userViewportPinned
      || chartSession.showAiForecast
      || chartSession.showEps;
    if (options.awaitMainRender) await runMainChartRender(preserveViewport);
    else renderChartWhenIdleOrNow(preserveViewport);
  }
  if (renderAuxiliaryOnly) {
    const mainEl = document.getElementById("chart");
    renderAdrChart(mainEl?._fullLayout?.xaxis?.range?.slice() || null);
  }
  if (renderDisclosureOnly) queueDisclosureTraceRefresh();
  return { revisionsAfter, mainDataChanged, adrDataChanged, disclosureDataChanged };
}

function getBackgroundStockRefresh() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.backgroundStockRefresh, () => (
    backgroundStockRefreshModule.createBackgroundStockRefresh(globalThis, {
      scheduler: backgroundTaskScheduler,
      targetBatchSize: 6,
      getTargets: () => getCustomStockLifecycle().select(
        "hidden",
        (ticker) => chartSession.hiddenSeries.has(ticker),
      ).map((item) => item.ticker),
      hasHidden: () => getCustomStockLifecycle().select(
        "hidden",
        (ticker) => chartSession.hiddenSeries.has(ticker),
      ).length > 0,
      refresh: preloadCustomStocks,
      onError: (error) => recordRuntimeError("hidden-stock-refresh", error),
    })
  ));
}

function getRuntimeRefreshOrchestrator() {
  return appRuntimeRegistry.get(APP_RUNTIME_KEYS.runtimeRefresh, () => {
    const state = {
      get disclosureRows() { return appData.disclosureRows; },
      get lastDisclosureTraceStats() { return eventMarkerRenderState.disclosureStats; },
    };
    return runtimeRefreshOrchestratorModule.createRuntimeRefreshOrchestrator({
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
      scheduleSupplementalTask: startupTaskRuntime.scheduleSupplemental,
      scheduleHiddenStockRefresh: (refreshOptions) => getBackgroundStockRefresh().schedule(refreshOptions),
      scheduleLastRuntimeSnapshotSave,
      setMessage,
      setRuntimeRefreshStatus,
      startPerfSample,
      state,
      throwIfAborted,
      waitForStartupVisualReady: () => new Promise((resolve) => {
        runAfterStartupVisualReady(resolve, { userVisible: true });
      }),
    });
  });
}

function canEnableDartFeature(messageElement, featureName) {
  if (canUseDartGateway()) return true;
  setMessage(
    messageElement,
    [`${featureName}를 보려면 설정에서 Think Stock 접속 코드를 먼저 저장해 주세요.`],
    true,
  );
  return false;
}

function bindApplicationControls(messageElement) {
  const controlConfig = createChartApplicationControlConfig({
    chartSession,
    showLatestChartPeriod,
    slideChartViewportToLatest,
    cycleCursorLineMode,
    isAdminAccessGranted: () => adminAccessGranted,
    setAutoChartReset,
    syncChartResetToggleButton,
    syncCoMovementToggleButton,
    renderCoMovementPanel,
    getVisibleMainRange: () => getCurrentXRangeMs(document.getElementById("chart")),
    applyChartHandlesLayout,
    saveState,
    requestChartRender,
    recordRuntimeError,
    ensureMarketTimingFeature,
    syncRecessionToggleButton,
    setMessage: (message, isError) => setMessage(messageElement, message, isError),
    requestChartCompositionUpdate,
    onAiToggleRevision: () => { aiForecastToggleRevision += 1; },
    clearAiForecastDeferredSeries: () => aiForecastDeferredSeries.clear(),
    refreshAiForecastTargets,
    ensureAiFeatureModules,
    settleChartViewport,
    syncAiForecastToggleButton,
    enableFutureOverlay: (kind) => getFutureOverlayController().enable(kind),
    startAiForecastProgress,
    prepareHistoricalDataForAiForecast,
    refreshAiAnalysisForVisibleSeries,
    loadAiMarketModel,
    withAiForecastRenderHold,
    stopAiForecastProgress,
    finishFutureOverlayDisable,
    requestFutureOverlayCompositionUpdate,
    disclosureMarkerCount: () => eventMarkerRenderState.disclosureStats.markers,
    syncDisclosureToggleButton,
    hideDisclosurePopover,
    prepareVisibleDisclosureData: () => prepareVisibleDisclosureData(messageElement),
    cancelDartLayerProgress,
    applyDisclosureStateFast,
    canEnableDartFeature: (featureName) => canEnableDartFeature(messageElement, featureName),
    ensureEpsFeatureModules,
    syncEpsToggleButton,
    prepareVisibleEpsData,
    resetEpsDataController: () => getEpsDataController().reset(),
    insiderMarkerCount: () => eventMarkerRenderState.insiderStats.markers,
    syncInsiderTradeToggleButton,
    refreshInsiderTradesForVisibleSeries,
    getCreditOffsetDays: () => CREDIT_OFFSET_DAYS,
    setCreditOffsetDays: (value) => { CREDIT_OFFSET_DAYS = value; },
    hasServiceWorkerController: () => Boolean(navigator.serviceWorker.controller),
    requestServiceWorkerDataRefresh,
    hasRuntimeDataLoaded,
    loadData,
    loadLastRuntimeSnapshot,
    renderChart,
    refreshRuntimeData: (options) => applicationLifecycle.refreshRuntime(messageElement, options),
  });
  appUiBindingsModule.bindChartApplicationControls(globalThis, controlConfig);
}

const applicationFeatureLifecycle = createFeatureLifecycleDescriptors([
  {
    name: "dart",
    enabled: () => chartSession.showDisclosures || chartSession.showInsiderTrades,
    restore: () => ensureDartFeatureModules()
      .then(() => {
        if (chartSession.showInsiderTrades) queueInsiderTradeRefresh();
      })
      .catch((error) => recordRuntimeError("dart-feature-load", error)),
  },
  {
    name: "ai",
    enabled: () => chartSession.showAiForecast,
    refresh: async () => {
      const needsDailyAnalysis = activeAiAnalysisTickers()
        .some((ticker) => !aiAnalysisIsFresh(aiAnalysisByTicker.get(ticker)));
      if (needsDailyAnalysis) startAiForecastProgress();
      await refreshAiAnalysisForVisibleSeries({ forceNetwork: true });
    },
    restore: () => {
      startAiForecastProgress();
      prepareHistoricalDataForAiForecast().catch(() => {});
      refreshAiAnalysisForVisibleSeries().catch(() => {});
      loadAiMarketModel().catch(() => {});
    },
  },
  {
    name: "eps",
    enabled: () => chartSession.showEps,
    refresh: async () => {
      await prepareVisibleEpsData({ forceNetwork: true, render: false });
      if (getEpsDataController().lastPrepareResult().changedCount > 0) {
        requestChartCompositionUpdate();
      }
    },
  },
  {
    name: "insider",
    enabled: () => chartSession.showInsiderTrades && canUseDartGateway(),
    refresh: () => refreshInsiderTradesForVisibleSeries({ forceNetwork: true }),
  },
]);

const applicationLifecycle = createApplicationLifecycleRuntime({
  setupSteps: [
    () => initPerformanceMonitor(),
    () => initE2eDebugAccess(),
    () => cacheMigrator.run(),
    () => loadAdminAccessState(),
    () => loadState(),
    () => appUiBindingsModule.bindChartToolsToggle({
      button: document.getElementById("chartToolsToggle"),
      container: document.querySelector(".main-chart-wrap"),
      getEnabled: () => chartSession.showChartTools,
      setEnabled: (value) => { chartSession.showChartTools = value; },
      saveState,
    }),
    () => enforceMainChartSeriesLimit(),
    () => enforceGeneralModeState(),
    () => renderCustomStockButtons(),
    (messageElement) => setupStockAddPanel(messageElement),
    (messageElement) => setupStockResearch(messageElement),
    (messageElement) => setupApiSettingsPanel(messageElement),
    () => runAfterStartupVisualReady(scheduleApiPeriodReminderLoad, { userVisible: true }),
    () => syncApiOptionsButton(),
    () => renderAppVersionLabel(),
    () => syncChartResetToggleButton(),
    () => syncChartHandlesToggleButton(),
    () => syncCursorLineModeControls(),
    () => syncNewsSentimentMovingAverageControls(),
    () => syncRecessionToggleButton(),
    () => syncCoMovementToggleButton(),
    () => syncAiForecastToggleButton(),
    () => syncDisclosureToggleButton(),
    () => syncEpsToggleButton(),
    () => syncInsiderTradeToggleButton(0),
    () => syncAdminFeatureAccess(),
    () => bindRuntimeSnapshotExitSave(),
    () => runAfterStartupVisualReady(() => (
      granularCacheMaintenance.scheduleAll(45000).forEach((task) => task.catch(() => {}))
    )),
  ],
  initialData: {
    runtime: runtimeDataApp,
    restoreSnapshot: loadLastRuntimeSnapshot,
    loadSeed: () => loadData(true),
    needsHistorical: () => chartSession.activeMonths > RECENT_DATA_MONTHS && !historicalDataLoaded,
    loadHistorical: () => ensureHistoricalDataLoaded(true),
    onHistoricalError: (messageElement) => {
      chartSession.activeMonths = getDefaultActiveMonths();
      setMessage(
        messageElement,
        [`과거 데이터 로딩에 실패해 최신 ${chartSession.activeMonths}개월 범위로 시작합니다.`],
        true,
      );
    },
    shouldPreserveViewport: () => chartViewportInteractionRevision > 0
      || chartSession.userViewportPinned
      || chartSession.showAiForecast
      || chartSession.showEps,
    renderMain: runMainChartRender,
    shouldAutoFit: () => chartSession.autoChartReset,
    fitCurrentChart: fitCurrentChartRatio,
    setProgress: startupLoader.setProgress,
  },
  refresh: {
    runData: (messageElement, options) => runtimeDataApp.refresh(messageElement, options),
    renderMain: runMainChartRender,
    shouldAutoFit: () => chartSession.autoChartReset,
    fitCurrentChart: fitCurrentChartRatio,
  },
  optionalRefreshes: applicationFeatureLifecycle.optionalRefreshes,
  restoredActivations: applicationFeatureLifecycle.restoredActivations,
  scheduleRestoredActivation: (task, { feature, index } = {}) => (
    runAfterStartupVisualReady(task, {
      delayMs: 120 + ((Number(index) || 0) * 120),
      priority: -5 - (Number(index) || 0),
      taskName: String(feature?.name || "restored-feature"),
    })
  ),
  afterActivation: () => {
    adminFeatureControlsReady = true;
    syncAdminFeatureAccess();
    restoreAdminAccessState().catch(() => {});
  },
  cleanupSteps: [
    () => {
      if (handleUpdateTimer) clearTimeout(handleUpdateTimer);
      handleUpdateTimer = 0;
    },
    () => runtimeDataApp.dispose?.(),
    () => startupTaskRuntime.dispose?.(),
    () => seedBundleParser.dispose?.(),
    () => deferredPerformanceDiagnostics.cancelScheduledCapture?.(),
    () => granularCacheMaintenance.dispose?.(),
    () => disclosureProgress.dispose?.(),
    () => epsProgress.dispose?.(),
    () => appDataRevisionBridge.dispose?.(),
    () => appRuntimeRegistry.disposeAll(),
    () => backgroundTaskScheduler.dispose?.(),
  ],
  onCleanupError: (error) => recordRuntimeError("application-cleanup", error),
});

const appBootstrap = createAppBootstrapOrchestrator({
  document,
  scheduleServiceWorker: () => runAfterStartupVisualReady(scheduleDeferredServiceWorkerRegistration),
  loader: {
    show: startupLoader.show,
    hide: startupLoader.hide,
    progress: startupLoader.setProgress,
  },
  performance: {
    start: startPerfSample,
    finishPhase: (label, startedAt) => recordPerfSample(`startup:${label}`, startedAt),
    finish: (startedAt) => recordPerfSample("appStartup", startedAt, {
      historicalDataLoaded,
      restoredSnapshot: hasRuntimeDataLoaded(),
    }),
  },
  setup: applicationLifecycle.setup,
  preparePlotly: ensurePlotlyReady,
  prepareInitialData: applicationLifecycle.prepareInitialData,
  bindControls: bindApplicationControls,
  afterControls: applicationLifecycle.activateRestoredFeatures,
  waitForFirstPaint: () => runtimeDataApp.waitForFirstPaint(),
  refreshDuringStartup: ({ messageElement, restoredSnapshot }) => (
    runtimeDataApp.refreshDuringStartup(messageElement, {
      restoredSnapshot,
      mergeSeed: () => loadData(true, { mergeWithExisting: true, preserveExisting: true }),
      onError: (error) => {
        setMessage(messageElement, `최신 데이터 갱신 오류: ${error.message}`, true);
      },
      onCriticalProgress: (progress) => {
        const percent = Number(progress?.percent);
        if (Number.isFinite(percent)) {
      startupLoader.setProgress(percent, progress?.source || "");
        }
      },
      settleAfterCriticalMs: STARTUP_INTERACTION_SETTLE_MS,
    })
  ),
  afterStartupRefresh: async () => {
    if (chartSession.autoChartReset) await fitCurrentChartRatio();
  },
  onRefreshError: (messageElement, error) => {
    setMessage(messageElement, `최신 데이터 갱신 오류: ${error.message}`, true);
  },
  onError: (messageElement, error) => {
    setMessage(messageElement, error.message || "데이터를 가져오지 못했습니다.", true);
  },
  scheduleDiagnostics: () => runAfterStartupVisualReady(() => {
    deferredPerformanceDiagnostics.scheduleAutomaticCapture({
      appVersion: APP_VERSION,
      buildVersion: APP_BUILD_VERSION,
    }, {
      captureOptions: {
        captureOnIdle: false,
        metadataProvider: () => ({ appState: buildRuntimeDiagnosticAppState() }),
      },
    });
  }),
});

appBootstrap.boot();
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) applicationLifecycle.dispose();
});





