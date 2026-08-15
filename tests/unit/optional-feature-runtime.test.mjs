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
  assert.deepEqual(new Set(loadedScripts), new Set([
    "./modules/api-periods.js",
    "./modules/release-notes.js",
  ]));
  assert.equal(loadedScripts.length, 2);
  assert.equal(featurePaths.get("ai-forecast").includes("./modules/ai-forecast-app.js"), true);
  assert.equal(featurePaths.get("ai-forecast").includes("./modules/broker-report-parser.js"), true);
  assert.equal(featurePaths.get("ai-forecast").includes("./modules/broker-report-worker-client.js"), true);
  assert.equal(featurePaths.get("ai-forecast").includes("./modules/broker-research-cache.js"), true);
  assert.equal(featurePaths.get("ai-forecast").includes("./modules/broker-research-runtime.js"), true);
  assert.equal(featurePaths.get("ai-forecast").includes("./modules/ai-forecast-cache.js"), true);
  assert.equal(featurePaths.get("ai-forecast").includes("./modules/ai-forecast-traces.js"), true);
  assert.equal(featurePaths.get("ai-forecast").includes("./modules/ai-context-profile.js"), true);
  assert.equal(featurePaths.get("market-timing").includes("./modules/ai-context-profile.js"), true);
});
