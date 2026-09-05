import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_RUNTIME_KEYS,
  ADR_SERIES,
  BASE_DISPLAY_NAMES,
  BASE_HOVER_NAMES,
  BASE_SERIES_HELP_NAMES,
  CHART_RIGHT_PADDING_MAX_DAYS,
  CURSOR_LINE_LABELS,
  CURSOR_LINE_MODES,
  DEFAULT_HIDDEN_MAIN_SERIES,
  MAIN_CHART_FINGERPRINT_CACHE_MAX_ENTRIES,
  MAIN_CHART_MODEL_CACHE_MAX_ENTRIES,
  MAIN_CHART_MODEL_CACHE_MAX_WEIGHT,
  MAIN_MACRO_SERIES,
  MARKET_INDEX_SERIES,
  MAX_CUSTOM_STOCKS,
  MAX_VISIBLE_MAIN_SERIES,
  OPTIMIZED_VISIBLE_MAIN_SERIES,
  STOCK_TICKER_PATTERN,
  createChartApplicationControlConfig,
  isForecastSeries,
  isMarketPriceSeries,
  normalizeChartRightPaddingDays,
  resolveMainChartDisplayPointBudget,
  resolveAppBuildVersion,
  seriesSupportsFeature,
} from "../../docs/modules/app-control-config.mjs";

function createContext() {
  const calls = [];
  const noop = () => {};
  const context = new Proxy({
    calls,
    chartSession: {
      autoChartReset: true,
      pendingAutoChartFit: false,
      showAiForecast: false,
      showDisclosures: false,
      showEps: false,
      showInsiderTrades: false,
      showRecessionSignals: false,
    },
    isAdminAccessGranted: () => true,
    canEnableDartFeature: () => true,
    enableFutureOverlay: (kind) => calls.push(`enable-${kind}`),
    withAiForecastRenderHold: async (task) => {
      calls.push("ai-hold-start");
      const result = await task();
      calls.push("ai-hold-end");
      return result;
    },
    ensureEpsFeatureModules: noop,
    prepareVisibleEpsData: async () => calls.push("prepare-eps"),
    resetEpsDataController: () => calls.push("reset-eps"),
    finishFutureOverlayDisable: (kind) => calls.push(`disable-${kind}`),
    disclosureMarkerCount: () => 0,
    insiderMarkerCount: () => 0,
    getCreditOffsetDays: () => -2,
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return noop;
    },
  });
  return context;
}

test("builds control bindings from explicit application dependencies", async () => {
  const context = createContext();
  const config = createChartApplicationControlConfig(context);

  assert.equal(config.mainTools.state, context.chartSession);
  assert.equal(config.eps.canToggle(), true);
  assert.equal(config.eps.canEnable(), true);
  config.eps.setEnabled(true);
  await config.eps.onEnabled();
  assert.equal(context.chartSession.showEps, true);
  assert.equal(context.chartSession.pendingAutoChartFit, true);
  assert.deepEqual(context.calls, ["enable-eps", "prepare-eps"]);

  config.eps.onDisabled();
  assert.deepEqual(context.calls.slice(-2), ["reset-eps", "disable-eps"]);
});

test("keeps disclosure access governed by the shared administrator predicate", () => {
  const context = createContext();
  context.isAdminAccessGranted = () => false;
  const config = createChartApplicationControlConfig(context);

  config.disclosure.setEnabled(true);
  assert.equal(context.chartSession.showDisclosures, false);
});

test("cancels signal progress when timing signals are disabled", () => {
  const context = createContext();
  context.cancelSignalProgress = () => context.calls.push("cancel-signal-progress");
  const config = createChartApplicationControlConfig(context);

  config.signal.onDisabled();

  assert.deepEqual(context.calls, ["cancel-signal-progress"]);
});

test("confirming signal inputs reuses the shared runtime refresh", async () => {
  const context = createContext();
  context.refreshRuntimeData = async (options) => context.calls.push([
    "confirm-signal-inputs",
    options,
  ]);
  const config = createChartApplicationControlConfig(context);

  await config.signal.onEnabled();

  assert.deepEqual(context.calls, [[
    "confirm-signal-inputs",
    { requireDerivedInputs: true },
  ]]);
});

test("waits for AI inputs before requesting the final composition", async () => {
  const context = createContext();
  context.prepareHistoricalDataForAiForecast = async () => context.calls.push("ai-history");
  context.refreshAiAnalysisForVisibleSeries = async () => context.calls.push("ai-analysis");
  context.loadAiMarketModel = async () => context.calls.push("ai-market");
  context.showVisibleAiForecastAvailability = () => context.calls.push("ai-availability");
  const config = createChartApplicationControlConfig(context);

  config.ai.setEnabled(true);
  await config.ai.onEnabled();

  assert.equal(context.chartSession.showAiForecast, true);
  assert.deepEqual(context.calls, [
    "enable-ai",
    "ai-availability",
    "ai-hold-start",
    "ai-history",
    "ai-analysis",
    "ai-market",
    "ai-hold-end",
  ]);
});

test("owns stable runtime keys and chart control limits outside app.js", () => {
  assert.equal(APP_RUNTIME_KEYS.chartSession, "chart-session");
  assert.equal(APP_RUNTIME_KEYS.progressiveChartComposition, "progressive-chart-composition");
  assert.equal(APP_RUNTIME_KEYS.visibleStockHistoryRefresh, "visible-stock-history-refresh");
  assert.equal(Object.isFrozen(APP_RUNTIME_KEYS), true);
  assert.deepEqual(CURSOR_LINE_MODES, ["vertical", "horizontal", "cross"]);
  assert.equal(CURSOR_LINE_LABELS.cross, "십자 차트선 방식");
  assert.equal(CHART_RIGHT_PADDING_MAX_DAYS, 30);
  assert.equal(normalizeChartRightPaddingDays(-3), 0);
  assert.equal(normalizeChartRightPaddingDays(12.6), 13);
  assert.equal(normalizeChartRightPaddingDays(99), 30);
  assert.equal(MAX_CUSTOM_STOCKS, 20);
  assert.equal(MAX_VISIBLE_MAIN_SERIES, 10);
  assert.equal(OPTIMIZED_VISIBLE_MAIN_SERIES, 5);
  assert.equal(MAIN_CHART_MODEL_CACHE_MAX_ENTRIES, 10);
  assert.equal(MAIN_CHART_MODEL_CACHE_MAX_WEIGHT, 800000);
  assert.equal(MAIN_CHART_FINGERPRINT_CACHE_MAX_ENTRIES, 12);
  assert.equal(resolveMainChartDisplayPointBudget(1000, 1, false), 1450);
  assert.equal(resolveMainChartDisplayPointBudget(1000, 5, false), 1300);
  assert.equal(resolveMainChartDisplayPointBudget(390, 10, true), 420);
  assert.deepEqual(ADR_SERIES, ["adr_kospi", "adr_kosdaq"]);
  assert.equal(BASE_DISPLAY_NAMES["^KS11"], "코스피");
  assert.equal(Object.isFrozen(BASE_DISPLAY_NAMES), true);
  assert.equal(BASE_HOVER_NAMES.t10y1y, "미국채 10년/1년 금리차");
  assert.equal(BASE_HOVER_NAMES.us_credit_spread, "미국 회사채 3년/국채 3년 금리차");
  assert.equal(
    BASE_SERIES_HELP_NAMES.leading_cycle,
    "한국은행 선행지수 순환변동치\n공개일 기준",
  );
  assert.equal(
    BASE_SERIES_HELP_NAMES.us_credit_spread,
    "미국 회사채(투자등급) 1-3년/미국채 3년 금리차\n최근 일별 · 과거 월간",
  );
  assert.deepEqual(Object.keys(BASE_SERIES_HELP_NAMES), [
    "leading_cycle",
    "t10y1y",
    "us_credit_spread",
    "customer_deposit",
    "kospi_credit",
    "kosdaq_credit",
  ]);
  assert.equal(BASE_SERIES_HELP_NAMES.customer_deposit, "2일 후행");
  assert.equal(BASE_SERIES_HELP_NAMES.kospi_credit, "2일 후행");
  assert.equal(BASE_SERIES_HELP_NAMES.kosdaq_credit, "2일 후행");
  assert.equal(Object.isFrozen(BASE_HOVER_NAMES), true);
  assert.equal(Object.isFrozen(BASE_SERIES_HELP_NAMES), true);
  assert.deepEqual(MARKET_INDEX_SERIES, ["^KS11", "^KQ11"]);
  assert.deepEqual(MAIN_MACRO_SERIES, [
    "leading_cycle",
    "t10y1y",
    "us_credit_spread",
    "customer_deposit",
    "kospi_credit",
    "kosdaq_credit",
  ]);
  assert.deepEqual(DEFAULT_HIDDEN_MAIN_SERIES, [
    "leading_cycle",
    "t10y1y",
    "us_credit_spread",
    "customer_deposit",
    "kospi_credit",
    "kosdaq_credit",
    "^KQ11",
  ]);
  assert.equal(isMarketPriceSeries("005930.KS"), true);
  assert.equal(isMarketPriceSeries("^KS11"), true);
  assert.equal(seriesSupportsFeature("005930.KS", "co-movement"), true);
  assert.equal(seriesSupportsFeature("^KS11", "co-movement"), true);
  assert.equal(seriesSupportsFeature("^KQ11", "signal"), true);
  assert.equal(seriesSupportsFeature("005930.KS", "disclosure"), true);
  assert.equal(seriesSupportsFeature("^KS11", "disclosure"), false);
  assert.equal(seriesSupportsFeature("leading_cycle", "signal"), false);
  assert.equal(seriesSupportsFeature("t10y1y", "ai"), false);
  assert.equal(seriesSupportsFeature("customer_deposit", "co-movement"), false);
  assert.equal(seriesSupportsFeature("leading_cycle", "scale"), true);
  assert.equal(isForecastSeries("005930.KS"), true);
  assert.equal(isForecastSeries("^KQ11"), true);
  assert.equal(isForecastSeries("leading_cycle"), false);
  assert.equal(STOCK_TICKER_PATTERN.test("218410.KQ"), true);
});

test("resolves the stamped build version outside the application composition root", () => {
  const scope = {
    location: { href: "https://example.test/ThinkStock/" },
    document: {
      currentScript: null,
      scripts: [
        { src: "https://example.test/ThinkStock/vendor.js" },
        { src: "https://example.test/ThinkStock/assets/app.bundle.min.js?v=build-327" },
      ],
    },
  };
  assert.equal(resolveAppBuildVersion(scope), "build-327");
  scope.document.scripts[1].src = "https://example.test/ThinkStock/assets/app.bundle.min.js?v=dev&asset=abc123";
  assert.equal(resolveAppBuildVersion(scope), "dev-abc123");
  assert.equal(resolveAppBuildVersion({ document: { scripts: [] } }), "dev");
});
