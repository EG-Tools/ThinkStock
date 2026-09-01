export const APP_RUNTIME_KEYS = Object.freeze({
  adminFeatureAccess: "admin-feature-access",
  appCacheManager: "app-cache-manager",
  auxiliaryChart: "auxiliary-chart",
  auxiliaryChartRender: "auxiliary-chart-render",
  backgroundStockRefresh: "background-stock-refresh",
  appState: "app-state",
  brokerResearch: "broker-research",
  brokerResearchFeature: "broker-research-feature",
  chartCursorSync: "chart-cursor-sync",
  chartHover: "chart-hover",
  chartMarker: "chart-marker",
  chartModelWorker: "chart-model-worker",
  chartNavigation: "chart-navigation",
  chartPointer: "chart-pointer",
  chartRangeSync: "chart-range-sync",
  chartSession: "chart-session",
  chartTarget: "chart-target",
  chartUpdates: "chart-updates",
  chartVisualFrame: "chart-visual-frame",
  coMovementPanel: "co-movement-panel",
  customStockLifecycle: "custom-stock-lifecycle",
  dataFreshness: "data-freshness",
  dartEvents: "dart-events",
  dartFeature: "dart-feature",
  dartRequests: "dart-requests",
  deferredDiagnostics: "deferred-diagnostics",
  disclosureCache: "disclosure-cache",
  disclosurePopover: "disclosure-popover",
  disclosureState: "disclosure-state",
  epsData: "eps-data",
  epsFeature: "eps-feature",
  aiFeature: "ai-feature",
  aiForecastApp: "ai-forecast-app",
  aiForecastCache: "ai-forecast-cache",
  aiForecastQuality: "ai-forecast-quality",
  aiForecastRenderFrame: "ai-forecast-render-frame",
  aiForecastTraces: "ai-forecast-traces",
  futureOverlay: "future-overlay",
  mainChartEvents: "main-chart-events",
  mainChartScheduler: "main-chart-scheduler",
  progressiveChartComposition: "progressive-chart-composition",
  mainSeries: "main-series",
  mainViewportWindow: "main-viewport-window",
  marketTiming: "market-timing",
  runtimeBootstrap: "runtime-bootstrap",
  runtimeMarketRefresh: "runtime-market-refresh",
  runtimeRefresh: "runtime-refresh",
  runtimeSeries: "runtime-series",
  seriesTransformDrag: "series-transform-drag",
  seriesTransformGesture: "series-transform-gesture",
  settingsPanel: "settings-panel",
  stockResearch: "stock-research",
  stockResearchPopover: "stock-research-popover",
  stockSelection: "stock-selection",
  runtimeSnapshot: "runtime-snapshot",
  visibleStockHistoryRefresh: "visible-stock-history-refresh",
});

export const CURSOR_LINE_MODES = Object.freeze(["vertical", "horizontal", "cross"]);
export const CURSOR_LINE_LABELS = Object.freeze({
  vertical: "세로 차트선 방식",
  horizontal: "가로 차트선 방식",
  cross: "십자 차트선 방식",
});
export const CHART_RIGHT_PADDING_MIN_DAYS = 0;
export const CHART_RIGHT_PADDING_MAX_DAYS = 30;

export const STOCK_TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
export const MARKET_INDEX_SERIES = Object.freeze(["^KS11", "^KQ11"]);
export const MAIN_MACRO_SERIES = Object.freeze([
  "leading_cycle",
  "t10y1y",
  "us_credit_spread",
  "customer_deposit",
  "kospi_credit",
  "kosdaq_credit",
]);
export const DEFAULT_HIDDEN_MAIN_SERIES = Object.freeze([
  ...MAIN_MACRO_SERIES,
  "^KQ11",
]);
export const CORE_SERIES = Object.freeze([
  "leading_cycle",
  "t10y1y",
  "^KS11",
  "^KQ11",
  "us_credit_spread",
  "customer_deposit",
  "kospi_credit",
  "kosdaq_credit",
]);
export const FIXED_CORE_SERIES_COLORS = Object.freeze({
  leading_cycle: "#929292",
  t10y1y: "#cf7777",
  "^KS11": "#ce9668",
  "^KQ11": "#c9b65e",
  us_credit_spread: "#75ad7f",
  customer_deposit: "#64ada9",
  kospi_credit: "#6f91bd",
  kosdaq_credit: "#9680b8",
});
export const SERIES_COLORS = Object.freeze({
  ...FIXED_CORE_SERIES_COLORS,
  news_sentiment: "#22d3ee",
  adr_kospi: "#facc15",
  adr_kosdaq: "#f472b6",
  fear_greed: "#fb923c",
  vkospi: "#e5e7eb",
  vix: "#60a5fa",
});
export const CUSTOM_RESERVED_COLORS = Object.freeze(
  CORE_SERIES.map((key) => FIXED_CORE_SERIES_COLORS[key]),
);
export const CUSTOM_COLOR_MIN_FIXED_DISTANCE = 90;
export const CUSTOM_COLOR_MIN_FIXED_HUE_DISTANCE = 10;
export const CUSTOM_COLOR_PALETTE = Object.freeze([
  "#d41111", "#d44211", "#a4d411", "#73d411", "#11d411", "#0da559",
  "#11d4d4", "#1173d4", "#1142d4", "#1111d4", "#4211d4", "#7311d4",
  "#a411d4", "#d411d4", "#d411a4", "#d41173", "#d41142", "#eeee2b",
  "#bdee2b", "#2beeee", "#2b2bee", "#ee2bee", "#f2f25a", "#89f5da",
  "#9707b0", "#67b007", "#f73be1", "#bff73b", "#14f5df", "#f51481",
  "#11a2a7", "#9e1a5a", "#76f514", "#d709bf",
]);
const marketIndexSeries = new Set(MARKET_INDEX_SERIES);
const mainMacroSeries = new Set(MAIN_MACRO_SERIES);
export const ADR_SERIES = Object.freeze(["adr_kospi", "adr_kosdaq"]);
export const FEAR_GREED_SERIES = Object.freeze(["fear_greed"]);
export const NEWS_SENTIMENT_SERIES = Object.freeze(["news_sentiment"]);
export const VKOSPI_SERIES = Object.freeze(["vkospi"]);
export const VIX_SERIES = Object.freeze(["vix"]);
export const VOLATILITY_SERIES = Object.freeze([...VKOSPI_SERIES, ...VIX_SERIES]);
export const CO_MOVEMENT_COMPARISONS = Object.freeze([
  Object.freeze({ key: "^KS11", label: "코스피" }),
  Object.freeze({ key: "^KQ11", label: "코스닥" }),
]);
export const SUPPLEMENTAL_SERIES = Object.freeze([
  ...ADR_SERIES,
  ...FEAR_GREED_SERIES,
  ...NEWS_SENTIMENT_SERIES,
  ...VKOSPI_SERIES,
  ...VIX_SERIES,
]);
export const BASE_DISPLAY_NAMES = Object.freeze({
  leading_cycle: "선행순환변동",
  t10y1y: "장단기금리차",
  us_credit_spread: "신용스프레드",
  news_sentiment: "뉴스심리",
  customer_deposit: "고객예탁금",
  kospi_credit: "코스피 신용",
  kosdaq_credit: "코스닥 신용",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  adr_kospi: "ADR K",
  adr_kosdaq: "ADR KQ",
  fear_greed: "공포탐욕",
  vkospi: "VKOSPI",
  vix: "VIX",
});
export const BASE_HOVER_NAMES = Object.freeze({
  leading_cycle: "한국 선행지수 순환변동치",
  t10y1y: "미국채 10년/1년 금리차",
  us_credit_spread: "미국 회사채 3년/국채 3년 금리차",
});
export const BASE_SERIES_HELP_NAMES = Object.freeze({
  leading_cycle: "한국은행 선행지수 순환변동치\n2달 후행",
  t10y1y: "미국채 10년/1년 금리차",
  us_credit_spread: "미국 회사채(투자등급) 1-3년/미국채 3년 금리차\n최근 일별 · 과거 월간",
  customer_deposit: "2일 후행",
  kospi_credit: "2일 후행",
  kosdaq_credit: "2일 후행",
});
export const STACKED_HOVER_PRICE_SERIES = Object.freeze([
  "leading_cycle",
  "t10y1y",
  "us_credit_spread",
]);
export const MAX_CUSTOM_STOCKS = 20;
export const MAX_VISIBLE_MAIN_SERIES = 10;
export const OPTIMIZED_VISIBLE_MAIN_SERIES = 5;
export const CUSTOM_STOCK_PRELOAD_CONCURRENCY = 3;
export const STARTUP_INTERACTION_SETTLE_MS = 1600;
export const STARTUP_POST_VISUAL_QUIET_MS = 650;
export const MAIN_CHART_MODEL_CACHE_MAX_ENTRIES = 10;
export const MAIN_CHART_MODEL_CACHE_MAX_WEIGHT = 800000;
export const MAIN_CHART_FINGERPRINT_CACHE_MAX_ENTRIES = 12;

export function customStockColorRandom(scope = globalThis) {
  try {
    const values = new Uint32Array(1);
    scope.crypto?.getRandomValues?.(values);
    if (values[0] > 0) return values[0] / 4294967296;
  } catch (_) {
    // A visual color choice does not require cryptographic randomness.
  }
  return Math.random();
}

export function fallbackCustomColor(ticker, palette = CUSTOM_COLOR_PALETTE) {
  const colors = Array.isArray(palette) && palette.length ? palette : CUSTOM_COLOR_PALETTE;
  const hash = [...String(ticker || "")]
    .reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 0);
  return colors[hash % colors.length];
}

export function createSeriesColorResolver(options = {}) {
  const fixedColors = options.fixedColors || SERIES_COLORS;
  const palette = options.palette || CUSTOM_COLOR_PALETTE;
  const getStocks = typeof options.getStocks === "function" ? options.getStocks : () => [];
  const normalizeHexColor = typeof options.normalizeHexColor === "function"
    ? options.normalizeHexColor
    : (value) => String(value || "").trim();
  const fallback = String(options.fallback || "#888");

  return function seriesColor(key) {
    const seriesKey = String(key || "");
    if (fixedColors[seriesKey]) return fixedColors[seriesKey];
    const stock = (getStocks() || []).find((item) => item?.ticker === seriesKey);
    if (!stock) return fallback;
    return normalizeHexColor(stock.color) || fallbackCustomColor(seriesKey, palette);
  };
}

export function resolveMainChartDisplayPointBudget(width, visibleSeriesCount = 1, mobile = false) {
  const viewportWidth = Math.max(320, Math.round(Number(width) || 390));
  const minimum = mobile ? 420 : 720;
  const totalTarget = mobile ? 2800 : OPTIMIZED_VISIBLE_MAIN_SERIES * 1300;
  return Math.max(
    minimum,
    Math.min(1500, Math.round(viewportWidth * 1.45), Math.round(totalTarget / Math.max(1, visibleSeriesCount))),
  );
}

export function isMarketPriceSeries(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return marketIndexSeries.has(ticker) || STOCK_TICKER_PATTERN.test(ticker);
}

/** One target policy for features drawn over the main chart. */
export function seriesSupportsFeature(value, feature) {
  const ticker = String(value || "").trim().toUpperCase();
  if (!ticker) return false;
  if (String(feature || "") === "scale") return true;
  if (mainMacroSeries.has(ticker)) return false;
  if (["disclosure", "insider", "eps", "company-analysis"].includes(String(feature || ""))) {
    return STOCK_TICKER_PATTERN.test(ticker);
  }
  if (["co-movement", "signal", "ai"].includes(String(feature || ""))) {
    return isMarketPriceSeries(ticker);
  }
  return false;
}

export function isForecastSeries(value) {
  return seriesSupportsFeature(value, "ai");
}

export function normalizeChartRightPaddingDays(value) {
  const days = Math.round(Number(value) || 0);
  return Math.max(CHART_RIGHT_PADDING_MIN_DAYS, Math.min(CHART_RIGHT_PADDING_MAX_DAYS, days));
}

export function resolveAppBuildVersion(scope = globalThis, assetName = "app.bundle.min.js") {
  try {
    const documentRef = scope?.document;
    const script = documentRef?.currentScript
      || [...(documentRef?.scripts || [])].find((node) => String(node?.src || "").includes(`/${assetName}`));
    const src = String(script?.src || "");
    return src ? (new URL(src, scope?.location?.href || "http://localhost/").searchParams.get("v") || "dev") : "dev";
  } catch (_) {
    return "dev";
  }
}

/**
 * Builds the UI binding contract without owning application state. Keeping this
 * wiring here prevents the startup function from growing for every new toggle.
 *
 * @param {object} context
 * @returns {object}
 */
export function createChartApplicationControlConfig(context) {
  const c = context;
  const session = c.chartSession;

  return {
    range: {
      selectMonths: c.showLatestChartPeriod,
      jumpLatest: c.slideChartViewportToLatest,
    },
    cycleCursorLineMode: c.cycleCursorLineMode,
    mainTools: {
      state: session,
      canUseCoMovement: c.isAdminAccessGranted,
      setAutoScale: c.setAutoChartReset,
      syncScale: c.syncChartResetToggleButton,
      syncCoMovement: c.syncCoMovementToggleButton,
      renderCoMovement: c.renderCoMovementPanel,
      getVisibleRange: c.getVisibleMainRange,
      applyHandlesLayout: c.applyChartHandlesLayout,
      saveState: c.saveState,
      requestChartRender: () => c.requestChartRender(true, { deferDuringInteraction: false }),
      onHandlesError: (error) => c.recordRuntimeError("chart-handles-layout", error),
    },
    signal: {
      canToggle: c.isAdminAccessGranted,
      getEnabled: () => session.showRecessionSignals,
      setEnabled: (value) => { session.showRecessionSignals = value; },
      prepare: c.ensureMarketTimingFeature,
      syncButton: c.syncRecessionToggleButton,
      onError: (error) => c.setMessage(`타이밍 준비 오류: ${error.message}`, true),
      onDisabled: c.cancelSignalProgress,
      onChanged: c.requestChartCompositionUpdate,
    },
    ai: {
      canToggle: c.isAdminAccessGranted,
      getEnabled: () => session.showAiForecast,
      setEnabled: (value) => {
        c.onAiToggleRevision();
        session.showAiForecast = value;
        if (value) c.clearAiForecastDeferredSeries();
        c.refreshAiForecastTargets();
      },
      prepare: c.ensureAiFeatureModules,
      beforeEnable: c.settleChartViewport,
      syncButton: c.syncAiForecastToggleButton,
      onEnabled: async () => {
        c.enableFutureOverlay("ai");
        c.startAiForecastProgress();
        c.showVisibleAiForecastAvailability?.();
        // The final composition must observe the inputs loaded for this toggle.
        // Fire-and-forget work could otherwise finish after an older render and
        // leave a cached forecast without its analysis evidence until retoggled.
        await c.withAiForecastRenderHold(() => Promise.allSettled([
          c.prepareHistoricalDataForAiForecast(),
          c.refreshAiAnalysisForVisibleSeries(),
          c.loadAiMarketModel(),
        ]));
      },
      onDisabled: () => {
        c.stopAiForecastProgress();
        c.finishFutureOverlayDisable("ai");
      },
      onError: (error) => c.setMessage(`AI 기능 준비 오류: ${error.message}`, true),
      onChanged: c.requestFutureOverlayCompositionUpdate,
    },
    hover: {
      getEnabled: () => session.hoverShowPopup,
      setEnabled: (value) => { session.hoverShowPopup = value; },
      saveState: c.saveState,
      requestChartRender: c.requestChartRender,
    },
    disclosure: {
      getEnabled: () => session.showDisclosures,
      setEnabled: (value) => { session.showDisclosures = c.isAdminAccessGranted() && value; },
      markerCount: c.disclosureMarkerCount,
      syncButton: c.syncDisclosureToggleButton,
      hidePopover: c.hideDisclosurePopover,
      onEnabled: c.prepareVisibleDisclosureData,
      onDisabled: () => c.cancelDartLayerProgress("disclosure-refresh", "disclosure"),
      onError: (error) => c.recordRuntimeError("disclosure-toggle-load", error),
      saveState: c.saveState,
      applyFastState: c.applyDisclosureStateFast,
      requestChartRender: c.requestChartRender,
    },
    eps: {
      canToggle: c.isAdminAccessGranted,
      canEnable: () => c.canEnableDartFeature("EPS"),
      getEnabled: () => session.showEps,
      setEnabled: (value) => { session.showEps = value; },
      prepare: c.ensureEpsFeatureModules,
      beforeEnable: c.settleChartViewport,
      syncButton: c.syncEpsToggleButton,
      saveState: c.saveState,
      onEnabled: async () => {
        c.enableFutureOverlay("eps");
        if (session.autoChartReset) {
          session.pendingAutoChartFit = true;
        }
        await c.prepareVisibleEpsData({ render: false });
      },
      onDisabled: () => {
        c.resetEpsDataController();
        c.finishFutureOverlayDisable("eps");
      },
      onError: (error) => c.setMessage(`EPS 조회 오류: ${error.message}`, true),
      onChanged: c.requestFutureOverlayCompositionUpdate,
    },
    insider: {
      canToggle: c.isAdminAccessGranted,
      canEnable: () => c.canEnableDartFeature("내부거래"),
      getEnabled: () => session.showInsiderTrades,
      setEnabled: (value) => { session.showInsiderTrades = value; },
      syncButton: () => c.syncInsiderTradeToggleButton(
        session.showInsiderTrades ? c.insiderMarkerCount() : 0,
      ),
      saveState: c.saveState,
      onDisabled: () => c.cancelDartLayerProgress("insider", "insider"),
      onEnabled: async () => {
        const count = await c.refreshInsiderTradesForVisibleSeries();
        c.setMessage(count > 0
          ? `DART 최근 3년 내부거래 ${count}건을 표시했습니다.`
          : "현재 표시 종목에는 최근 3년 내부거래가 없습니다.");
      },
      onError: (error) => c.setMessage(`내부거래 조회 오류: ${error.message}`, true),
      onChanged: () => c.requestChartRender(true, {
        deferDuringInteraction: false,
        reason: "insider-toggle",
        updateClass: "markers",
      }),
    },
    creditOffset: {
      getOffsetDays: c.getCreditOffsetDays,
      setOffsetDays: c.setCreditOffsetDays,
      saveState: c.saveState,
      requestChartRender: c.requestChartRender,
    },
    refresh: {
      setMessage: c.setMessage,
      hasServiceWorkerController: c.hasServiceWorkerController,
      requestServiceWorkerDataRefresh: c.requestServiceWorkerDataRefresh,
      hasRuntimeDataLoaded: c.hasRuntimeDataLoaded,
      loadData: c.loadData,
      loadLastRuntimeSnapshot: c.loadLastRuntimeSnapshot,
      renderChart: c.renderChart,
      refreshRuntimeData: c.refreshRuntimeData,
    },
  };
}
