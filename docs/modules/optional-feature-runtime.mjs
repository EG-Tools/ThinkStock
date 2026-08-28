import { createIdleResourceLifecycle } from "./worker-lifecycle.mjs";

function createDeferredDiagnosticsFacade(scope = globalThis, options = {}) {
  const registry = options.registry;
  const optional = options.optional;
  const scheduler = options.scheduler;
  const runtimeKey = String(options.runtimeKey || "deferred-diagnostics");
  if (!registry?.getAsync || !registry?.peek || !optional?.ensureDiagnostics) {
    throw new Error("deferred diagnostics dependencies are incomplete");
  }

  function getRuntime() {
    return registry.getAsync(runtimeKey, async () => {
      const feature = await optional.ensureDiagnostics();
      if (!feature?.createDeferredDiagnostics) {
        throw new Error("Performance diagnostics runtime is not loaded");
      }
      return feature.createDeferredDiagnostics(scope, {
        createOptions: { performanceApi: options.performanceApi },
        getScheduler: () => scheduler,
      });
    }, (runtime) => runtime?.cancelScheduledCapture?.());
  }

  return Object.freeze({
    ensure: async () => (await getRuntime()).ensure(),
    cancelScheduledCapture() {
      scheduler?.cancel?.("performance-diagnostics-runtime-load");
      registry.peek(runtimeKey)?.cancelScheduledCapture?.();
    },
    scheduleAutomaticCapture(metadata = {}, scheduleOptions = {}) {
      const delayMs = Math.max(1000, Number(scheduleOptions.delayMs) || 30000);
      scheduler?.enqueue?.("performance-diagnostics-runtime-load", async () => {
        const runtime = await getRuntime();
        const diagnostics = await runtime.ensure();
        return diagnostics.startAutomaticCapture(metadata, scheduleOptions.captureOptions || {});
      }, {
        delayMs,
        priority: Number(scheduleOptions.priority) || -50,
      }).catch(() => {});
    },
  });
}

function createAppFeatureRuntime(options = {}) {
  const registry = options.registry;
  const keys = options.keys || {};
  const optional = options.optional;
  if (!registry?.get || !registry?.getAsync || !registry?.peek) {
    throw new Error("app runtime registry is required");
  }
  if (!optional?.ensureAi || !optional?.ensureBrokerResearch
    || !optional?.ensureDart || !optional?.ensureEps
    || !optional?.ensureMarketTiming) {
    throw new Error("optional feature runtime is incomplete");
  }

  const getAi = () => registry.peek(keys.aiFeature);
  const getAiApp = () => registry.peek(keys.aiForecastApp);
  const getBrokerResearch = () => registry.peek(keys.brokerResearchFeature);
  const getDart = () => registry.peek(keys.dartFeature);
  const dartTickerPattern = options.dartTickerPattern instanceof RegExp
    ? options.dartTickerPattern
    : /^\d{6}\.(KS|KQ)$/;

  function requireFeature(value, label) {
    if (!value) throw new Error(`${label} feature is not loaded`);
    return value;
  }

  async function ensureAi() {
    const feature = await registry.getAsync(keys.aiFeature, () => optional.ensureAi());
    registry.get(
      keys.aiForecastApp,
      () => options.createAiApp?.(feature),
      (runtime) => runtime?.cancelCalculations?.(),
    );
    return feature.forecast;
  }

  async function ensureDart() {
    return registry.getAsync(keys.dartFeature, () => optional.ensureDart());
  }

  function normalizeDartTicker(value) {
    const requestRuntime = getDart()?.requestRuntime;
    if (typeof requestRuntime?.normalizeDartTicker === "function") {
      return requestRuntime.normalizeDartTicker(value, dartTickerPattern);
    }
    const ticker = String(value || "").trim().toUpperCase();
    return dartTickerPattern.test(ticker) ? ticker : "";
  }

  async function callDartRequestRuntime(method, args) {
    const feature = await ensureDart();
    const operation = feature?.requestRuntime?.[method];
    if (typeof operation !== "function") throw new Error(`DART request operation is unavailable: ${method}`);
    return operation(...args);
  }

  async function ensureBrokerResearch() {
    return registry.getAsync(
      keys.brokerResearchFeature,
      () => optional.ensureBrokerResearch(),
    );
  }

  function getDartRequests() {
    return registry.get(keys.dartRequests, () => (
      requireFeature(getDart(), "DART").requestRuntime.createDartRequestRuntime(options.requestRegistry)
    ));
  }

  async function ensureEps() {
    return registry.getAsync(keys.epsFeature, async () => {
      const [, , eps] = await Promise.all([
        ensureAi(),
        ensureDart(),
        optional.ensureEps(),
      ]);
      return eps;
    });
  }

  async function ensureMarketTiming() {
    return registry.getAsync(keys.marketTiming, () => optional.ensureMarketTiming());
  }

  return Object.freeze({
    ensureAi,
    ensureBrokerResearch,
    ensureDart,
    ensureEps,
    ensureMarketTiming,
    getAi,
    getAiApp,
    getBrokerResearch,
    getDart,
    getDartRequests,
    fetchProgressiveRecords: (...args) => callDartRequestRuntime("fetchProgressiveRecords", args),
    mergeInsiderRowsWithChange: (existing, incoming) => (
      requireFeature(getDart(), "DART").insiderTrades.mergeRowsWithChange(existing, incoming)
    ),
    normalizeDartTicker,
    requireAi: () => requireFeature(getAi(), "AI"),
    requireBrokerResearch: () => requireFeature(getBrokerResearch(), "Broker research"),
    requireDart: () => requireFeature(getDart(), "DART"),
    resolveDartCompanyContext: (...args) => callDartRequestRuntime("resolveDartCompanyContext", args),
    sanitizeInsiderRows: (rows) => requireFeature(getDart(), "DART").insiderTrades.sanitizeRows(rows),
    toDartGatewayError: (error) => getDart()?.requestRuntime?.toDartGatewayError?.(error) || error,
  });
}

function resolveTickerDartPreloadPlan(state = {}) {
  const disclosures = state.showDisclosures === true || state.showAiForecast === true;
  const insiders = state.showInsiderTrades === true;
  return Object.freeze({
    disclosures,
    insiders,
    required: disclosures || insiders,
  });
}

// Feature bundles stay lazy while their coordinator uses a standard module boundary.
function createOptionalFeatureRuntime(scope = globalThis, options = {}) {
    const loader = options.loader;
    if (!loader?.loadModuleFeature) throw new Error("optional feature loader is required");
    const version = String(options.version || "dev");
    let analyticsCore = null;
    let analyticsCoreTask = null;
    let ai = null;
    let auxiliaryChart = null;
    let brokerResearch = null;
    let coMovement = null;
    let diagnostics = null;
    let dart = null;
    let eps = null;
    let marketTimingBundle = null;
    let marketTimingService = null;
    let stockResearch = null;
    let settings = null;

    function ensureAnalyticsCore() {
      if (analyticsCore) return Promise.resolve(analyticsCore);
      if (analyticsCoreTask) return analyticsCoreTask;
      analyticsCoreTask = loader.loadModuleFeature(
        "analytics-core",
        "./assets/analytics-core-feature.bundle.min.js",
        (module) => module.analyticsCoreFeature || module.default,
      )
        .then((feature) => {
          if (!feature?.math || !feature?.contextProfile) {
            throw new Error("analytics-core 기능 초기화에 실패했습니다.");
          }
          analyticsCore = feature;
          return feature;
        })
        .catch((error) => {
          analyticsCoreTask = null;
          throw error;
        });
      return analyticsCoreTask;
    }

    async function withAnalyticsCoreCompatibility(task) {
      const feature = await ensureAnalyticsCore();
      const previousMath = scope.ThinkStockAiForecastMath;
      const previousContext = scope.ThinkStockAiContextProfile;
      scope.ThinkStockAiForecastMath = feature.math;
      scope.ThinkStockAiContextProfile = feature.contextProfile;
      try {
        return await task();
      } finally {
        if (previousMath === undefined) delete scope.ThinkStockAiForecastMath;
        else scope.ThinkStockAiForecastMath = previousMath;
        if (previousContext === undefined) delete scope.ThinkStockAiContextProfile;
        else scope.ThinkStockAiContextProfile = previousContext;
      }
    }

    async function ensureAi() {
      if (ai) return ai;
      ai = await withAnalyticsCoreCompatibility(() => loader.loadModuleFeature(
          "ai-forecast",
          "./assets/ai-feature.bundle.min.js",
          (module) => module.aiFeature || module.default,
        ));
      return ai;
    }

    async function ensureAuxiliaryChart() {
      if (auxiliaryChart) return auxiliaryChart;
      auxiliaryChart = await loader.loadModuleFeature(
        "auxiliary-chart",
        "./assets/auxiliary-chart-feature.bundle.min.js",
        (module) => module.auxiliaryChartFeature || module.default,
      );
      return auxiliaryChart;
    }

    async function ensureBrokerResearch() {
      if (brokerResearch) return brokerResearch;
      brokerResearch = await loader.loadModuleFeature(
        "broker-research",
        "./assets/broker-research-feature.bundle.min.js",
        (module) => module.brokerResearchFeature || module.default,
      );
      return brokerResearch;
    }

    async function ensureEps() {
      if (eps) return eps;
      eps = await loader.loadModuleFeature(
        "eps-chart",
        "./assets/eps-feature.bundle.min.js",
        (module) => module.epsChart || module.default,
      );
      return eps;
    }

    async function ensureDiagnostics() {
      if (diagnostics) return diagnostics;
      diagnostics = await loader.loadModuleFeature(
        "diagnostics-runtime",
        "./assets/diagnostics-runtime-feature.bundle.min.js",
        (module) => module.deferredDiagnostics || module.default,
      );
      return diagnostics;
    }

    async function ensureDart() {
      if (dart) return dart;
      dart = await loader.loadModuleFeature(
        "dart-events",
        "./assets/dart-feature.bundle.min.js",
        (module) => module.dartFeature || module.default,
      );
      return dart;
    }

    async function ensureMarketTimingBundle() {
      if (marketTimingBundle) return marketTimingBundle;
      marketTimingBundle = loader.loadModuleFeature(
        "market-timing",
        "./assets/market-timing-feature.bundle.min.js",
        (module) => module.marketTimingFeature || module.default,
      )
        .catch((error) => {
          marketTimingBundle = null;
          throw error;
        });
      return marketTimingBundle;
    }

    async function ensureCoMovement() {
      if (coMovement) return coMovement;
      const bundle = await ensureMarketTimingBundle();
      coMovement = bundle.coMovement;
      return coMovement;
    }

    async function ensureMarketTiming() {
      if (marketTimingService) return marketTimingService;
      const [bundle, analytics] = await Promise.all([
        ensureMarketTimingBundle(),
        ensureAnalyticsCore(),
      ]);
      marketTimingService = bundle.service.createMarketTimingService(scope, {
      workerUrl: `./assets/market-timing-worker.bundle.min.js?v=${encodeURIComponent(version)}`,
        buildMacdOscillator: options.buildMacdOscillator,
        buildMarketTimingSignals: bundle.timing.buildMarketTimingSignals,
        buildKoreanVolatilityTimingRows: bundle.timing.buildKoreanVolatilityTimingRows,
        buildExternalVolatilityTimingRows: bundle.timing.buildExternalVolatilityTimingRows,
        behaviorPolicy: bundle.timing.PROMOTED_RUNTIME_BEHAVIOR_POLICY,
        evaluateMarketTimingModel: bundle.evaluation.evaluateMarketTimingModel,
        summarizeMarketTimingQuality: bundle.evaluation.summarizeMarketTimingQuality,
        buildStructuralStockProfile: analytics.contextProfile.buildStructuralStockProfile,
        createIdleResourceLifecycle,
        cache: options.marketTimingCache || null,
      });
      return marketTimingService;
    }

    async function ensureStockResearch() {
      if (stockResearch) return stockResearch;
      stockResearch = await loader.loadModuleFeature(
        "stock-research",
        "./assets/stock-research-feature.bundle.min.js",
        (module) => module.stockResearchFeature || module.default,
      );
      return stockResearch;
    }

    async function ensureSettings() {
      if (settings) return settings;
      settings = await loader.loadModuleFeature(
        "settings",
        "./assets/settings-feature.bundle.min.js",
        (module) => module.settingsFeature || module.default,
      );
      return settings;
    }

    return Object.freeze({
      ensureAi,
      ensureAuxiliaryChart,
      ensureBrokerResearch,
      ensureCoMovement,
      ensureDart,
      ensureDiagnostics,
      ensureEps,
      ensureMarketTiming,
      ensureSettings,
      ensureStockResearch,
    });
  }

// Optional script loading is owned by the optional-feature runtime.
function createOptionalFeatureLoader(scope = globalThis, options = {}) {
    const documentRef = options.document || scope.document;
    const version = String(options.version || "dev");
    const importModule = options.importModule || ((url) => import(url));
    const featureTasks = new Map();

    function versionedUrl(path) {
      const url = new URL(String(path || ""), documentRef.baseURI);
      if (!url.searchParams.has("v")) url.searchParams.set("v", version);
      return url.toString();
    }

    function loadModuleFeature(name, path, select = null) {
      const key = String(name || "feature");
      if (featureTasks.has(key)) return featureTasks.get(key);
      const task = importModule(versionedUrl(path))
        .then((module) => {
          const value = typeof select === "function" ? select(module) : (module.default || module);
          if (!value) throw new Error(`${key} 기능 초기화에 실패했습니다.`);
          return value;
        })
        .catch((error) => {
          featureTasks.delete(key);
          throw error;
        });
      featureTasks.set(key, task);
      return task;
    }

    return Object.freeze({
      isLoaded: (name) => featureTasks.has(String(name || "feature")),
      loadModuleFeature,
    });
  }

export {
  createAppFeatureRuntime,
  createDeferredDiagnosticsFacade,
  createOptionalFeatureLoader,
  createOptionalFeatureRuntime,
  resolveTickerDartPreloadPlan,
};
