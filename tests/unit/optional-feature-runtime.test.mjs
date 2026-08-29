import assert from "node:assert/strict";
import test from "node:test";

import {
  createOptionalFeatureLoader,
  createOptionalFeatureRuntime,
} from "../../docs/modules/optional-feature-runtime.mjs";

test("loads each optional feature only once and creates one timing service", async () => {
  const loaded = [];
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
    ThinkStockCoMovement: { createCoMovementPanelController() {} },
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
  const settingsFeature = {
    apiPeriods: { API_PERIODS: [] },
    releaseNotes: { RELEASES: [] },
    runtime: { createSettingsPanelRuntime() {} },
  };
  const dartFeature = {
    disclosurePopover: { createDisclosurePopover() {} },
    insiderTrades: { buildMarkerTraces() {} },
    requestRuntime: { createDartRequestRuntime() {} },
  };
  const epsChart = { createEpsDataController() {} };
  const macd = { buildMacdOscillator() {} };
  const auxiliaryChartRuntime = { createAuxiliaryChartRuntime() {} };
  const auxiliaryChartFeature = {
    macd,
    runtime: auxiliaryChartRuntime,
    model: { buildAuxiliaryChartModel() {} },
  };
  const deferredDiagnostics = { createDeferredDiagnostics() {} };
  const dataFreshnessFeature = {
    createController() {},
    dataHealth: { buildFreshnessItems() {} },
  };
  const analyticsCoreFeature = {
    math: { mean() {} },
    contextProfile: {
      buildContextProfile() {},
      buildStructuralStockProfile() {},
    },
  };
  const marketTimingFeature = {
    coMovement: scope.ThinkStockCoMovement,
    evaluation: scope.ThinkStockMarketTimingEvaluation,
    macd,
    service: scope.ThinkStockMarketTimingService,
    timing: scope.ThinkStockMarketTiming,
  };
  scope.ThinkStockAiFeature = Object.freeze({
    analysis: scope.ThinkStockAiAnalysisCache,
    app: scope.ThinkStockAiForecastApp,
    brokerParser: scope.ThinkStockBrokerReportParser,
    brokerResearch: scope.ThinkStockBrokerResearchCache,
    brokerRuntime: scope.ThinkStockBrokerResearchRuntime,
    brokerWorker: scope.ThinkStockBrokerReportWorkerClient,
    cache: scope.ThinkStockAiForecastCache,
    calibration: scope.ThinkStockAiForecastCalibration,
    forecast: scope.ThinkStockAiForecast,
    journal: scope.ThinkStockAiForecastJournal,
    qualityRuntime: scope.ThinkStockAiForecastQualityRuntime,
    traces: scope.ThinkStockAiForecastTraces,
  });
  scope.ThinkStockStockResearchFeature = Object.freeze({
    controller: scope.ThinkStockStockResearchController,
    research: scope.ThinkStockStockResearch,
  });
  const aiFeature = scope.ThinkStockAiFeature;
  const brokerResearchFeature = Object.freeze({
    cache: scope.ThinkStockBrokerResearchCache,
    parser: scope.ThinkStockBrokerReportParser,
    runtime: scope.ThinkStockBrokerResearchRuntime,
    worker: scope.ThinkStockBrokerReportWorkerClient,
  });
  const stockResearchFeature = scope.ThinkStockStockResearchFeature;
  const runtime = createOptionalFeatureRuntime(scope, {
    version: "2.34",
    loader: {
      loadModuleFeature: async (name, path, select) => {
        loaded.push(name);
        featurePaths.set(name, [path]);
        const module = name === "dart-events"
          ? { dartFeature }
          : name === "analytics-core"
            ? { analyticsCoreFeature }
          : name === "ai-forecast"
            ? { aiFeature }
          : name === "broker-research"
            ? { brokerResearchFeature }
          : name === "auxiliary-chart"
            ? { auxiliaryChartFeature }
          : name === "eps-chart"
          ? { epsChart }
          : name === "market-timing"
            ? { marketTimingFeature }
          : name === "stock-research"
            ? { stockResearchFeature }
          : name === "diagnostics-runtime"
            ? { deferredDiagnostics }
          : name === "data-freshness"
            ? { dataFreshnessFeature }
            : { settingsFeature };
        return select(module);
      },
    },
  });

  assert.equal(await runtime.ensureAi(), await runtime.ensureAi());
  assert.equal(scope.ThinkStockAiForecastMath, undefined);
  assert.equal(scope.ThinkStockAiContextProfile, undefined);
  assert.equal(
    await runtime.ensureBrokerResearch(),
    await runtime.ensureBrokerResearch(),
  );
  assert.equal(
    await runtime.ensureAuxiliaryChart(),
    await runtime.ensureAuxiliaryChart(),
  );
  assert.equal(await runtime.ensureDart(), await runtime.ensureDart());
  assert.equal(await runtime.ensureDiagnostics(), await runtime.ensureDiagnostics());
  assert.equal(await runtime.ensureDataFreshness(), await runtime.ensureDataFreshness());
  assert.equal(await runtime.ensureEps(), await runtime.ensureEps());
  assert.equal(await runtime.ensureCoMovement(), await runtime.ensureCoMovement());
  const timingService = await runtime.ensureMarketTiming();
  assert.equal(timingService, await runtime.ensureMarketTiming());
  assert.equal(
    timingService.options.buildStructuralStockProfile,
    analyticsCoreFeature.contextProfile.buildStructuralStockProfile,
  );
  assert.equal(timingService.options.buildMacdOscillator, macd.buildMacdOscillator);
  assert.equal(await runtime.ensureStockResearch(), await runtime.ensureStockResearch());
  assert.equal(await runtime.ensureSettings(), await runtime.ensureSettings());
  assert.deepEqual(loaded, [
    "ai-forecast",
    "broker-research",
    "auxiliary-chart",
    "dart-events",
    "diagnostics-runtime",
    "data-freshness",
    "eps-chart",
    "market-timing",
    "analytics-core",
    "stock-research",
    "settings",
  ]);
  assert.deepEqual(featurePaths.get("analytics-core"), ["./assets/analytics-core-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("ai-forecast"), ["./assets/ai-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("broker-research"), ["./assets/broker-research-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("auxiliary-chart"), ["./assets/auxiliary-chart-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("dart-events"), ["./assets/dart-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("diagnostics-runtime"), ["./assets/diagnostics-runtime-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("data-freshness"), ["./assets/data-freshness-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("eps-chart"), ["./assets/eps-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("market-timing"), ["./assets/market-timing-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("stock-research"), ["./assets/stock-research-feature.bundle.min.js"]);
  assert.deepEqual(featurePaths.get("settings"), ["./assets/settings-feature.bundle.min.js"]);
});

test("module feature loader imports one versioned ESM bundle and retries failures", async () => {
  const imported = [];
  let fail = true;
  const loader = createOptionalFeatureLoader({}, {
    document: { baseURI: "https://example.test/ThinkStock/", scripts: [] },
    version: "3.12",
    importModule: async (url) => {
      imported.push(url);
      if (fail) {
        fail = false;
        throw new Error("network retry");
      }
      return { feature: { ready: true } };
    },
  });

  await assert.rejects(
    loader.loadModuleFeature("example", "./assets/example.js", (module) => module.feature),
    /network retry/,
  );
  const first = loader.loadModuleFeature("example", "./assets/example.js", (module) => module.feature);
  const second = loader.loadModuleFeature("example", "./assets/example.js", (module) => module.feature);

  assert.equal(first, second);
  assert.deepEqual(await first, { ready: true });
  assert.equal(imported.length, 2);
  assert.match(imported[1], /example\.js\?v=3\.12$/);
});
