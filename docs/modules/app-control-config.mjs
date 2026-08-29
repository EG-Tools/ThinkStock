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
  stockSelection: "stock-selection",
  runtimeSnapshot: "runtime-snapshot",
  viewportRelayout: "viewport-relayout",
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
export const MAX_CUSTOM_STOCKS = 20;
export const MAX_VISIBLE_MAIN_SERIES = 10;
export const CUSTOM_STOCK_PRELOAD_CONCURRENCY = 3;
export const STARTUP_INTERACTION_SETTLE_MS = 1600;
export const MAIN_CHART_MODEL_CACHE_MAX_ENTRIES = 10;
export const MAIN_CHART_MODEL_CACHE_MAX_WEIGHT = 800000;
export const MAIN_CHART_FINGERPRINT_CACHE_MAX_ENTRIES = 12;

export function isForecastSeries(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return ["^KS11", "^KQ11"].includes(ticker) || STOCK_TICKER_PATTERN.test(ticker);
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
          session.pendingAutoChartFitExpandOnly = false;
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
