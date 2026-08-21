import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/optional-feature-runtime.js");

test("loads each optional feature only once and creates one timing service", async () => {
  const loaded = [];
  const loadedScripts = [];
  const featurePaths = new Map();
  const scope = {
    ThinkStockBrokerReportParser: { PARSER_REVISION: "quant-v1" },
    ThinkStockBrokerReportWorkerClient: { createBrokerReportWorkerClient() {} },
    ThinkStockBrokerResearchCache: { createBrokerResearchCache() {} },
    ThinkStockBrokerResearchRuntime: { createBrokerResearchRuntime() {} },
    ThinkStockAiForecast: { buildForecast() {} },
    ThinkStockAiForecastApp: { createAiForecastApp() {} },
    ThinkStockAiForecastCache: { createAiForecastCache() {} },
    ThinkStockAiForecastInputCache: { createAiForecastInputCache() {} },
    ThinkStockAiForecastTraces: { buildAiForecastTraces() {} },
    ThinkStockAiAnalysisCache: { SCHEMA_VERSION: 1 },
    ThinkStockAiForecastJournal: { SCHEMA_VERSION: 1 },
    ThinkStockAiForecastCalibration: { buildCalibrationProfile() {} },
    ThinkStockAiForecastQualityRuntime: { createAiForecastQualityRuntime() {} },
    ThinkStockMarketTimingEvaluation: { evaluateMarketTimingModel() {} },
    ThinkStockMarketTiming: { buildMarketTimingSignals() {} },
    ThinkStockMarketTimingService: {
      createMarketTimingService: (_scope, options) => ({ options }),
    },
    ThinkStockStockResearchContract: { CALCULATION_VERSION: "v1" },
    ThinkStockStockResearchStorage: { CACHE_SCHEMA: 1 },
    ThinkStockStockResearchNavigation: { DISPLAY_LIMIT: 5 },
    ThinkStockStockResearchFilter: { candidateMeetsSignalMinimum() {} },
    ThinkStockStockResearchHistoryCache: { normalizeHistoryCacheRecord() {} },
    ThinkStockStockResearchWorkerClient: { createWorkerLane() {} },
    ThinkStockStockResearch: { STRATEGY_VERSION: "v1" },
    ThinkStockStockResearchController: { createController() {} },
    ThinkStockApiPeriods: { API_PERIODS: [] },
    ThinkStockReleaseNotes: { RELEASES: [] },
    ThinkStockSettingsPanelRuntime: { createSettingsPanelRuntime() {} },
  };
  const runtime = globalThis.ThinkStockOptionalFeatureRuntime.createOptionalFeatureRuntime(scope, {
    version: "2.34",
    buildMacdOscillator() {},
    loader: {
      loadScript: async (path) => {
        loadedScripts.push(path);
      },
      loadFeature: async (name, paths, validate) => {
        loaded.push(name);
        featurePaths.set(name, paths);
        assert.equal(validate(), true);
      },
    },
  });

  assert.equal(await runtime.ensureAi(), await runtime.ensureAi());
  assert.equal(await runtime.ensureMarketTiming(), await runtime.ensureMarketTiming());
  assert.equal(await runtime.ensureStockResearch(), await runtime.ensureStockResearch());
  assert.equal(await runtime.ensureSettings(), await runtime.ensureSettings());
  assert.deepEqual(loaded, ["ai-forecast", "market-timing", "stock-research", "settings"]);
  assert.deepEqual(loadedScripts, []);
  assert.deepEqual(featurePaths.get("ai-forecast"), ["./assets/ai-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("market-timing"), ["./assets/market-timing-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("stock-research"), ["./assets/stock-research-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("settings"), ["./assets/settings-feature.bundle.min.js"]);
});
