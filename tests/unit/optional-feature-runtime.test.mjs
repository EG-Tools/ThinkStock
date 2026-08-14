import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/optional-feature-runtime.js");

test("loads each optional feature only once and creates one timing service", async () => {
  const loaded = [];
  const scope = {
    ThinkStockAiForecast: { buildForecast() {} },
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
  };
  const runtime = globalThis.ThinkStockOptionalFeatureRuntime.createOptionalFeatureRuntime(scope, {
    version: "2.34",
    buildMacdOscillator() {},
    loader: {
      loadFeature: async (name, _paths, validate) => {
        loaded.push(name);
        assert.equal(validate(), true);
      },
    },
  });

  assert.equal(await runtime.ensureAi(), await runtime.ensureAi());
  assert.equal(await runtime.ensureMarketTiming(), await runtime.ensureMarketTiming());
  assert.equal(await runtime.ensureStockResearch(), await runtime.ensureStockResearch());
  assert.deepEqual(loaded, ["ai-forecast", "market-timing", "stock-research"]);
});
