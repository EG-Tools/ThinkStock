(function initThinkStockOptionalFeatureRuntime(globalScope) {
  "use strict";

  function createOptionalFeatureRuntime(scope = globalScope, options = {}) {
    const loader = options.loader;
    if (!loader?.loadFeature) throw new Error("optional feature loader is required");
    const version = String(options.version || "dev");
    let ai = null;
    let marketTimingService = null;
    let stockResearch = null;

    async function ensureAi() {
      if (ai) return ai;
      await loader.loadFeature("ai-forecast", [
        "./modules/ai-forecast-math.js",
        "./modules/ai-forecast-model.js",
        "./modules/ai-scenario-paths.js",
        "./modules/ai-forecast-scenarios.js",
        "./modules/ai-forecast.js",
        "./modules/ai-analysis-cache.js",
        "./modules/ai-forecast-journal.js",
        "./modules/ai-forecast-calibration.js",
        "./modules/ai-forecast-quality-runtime.js",
      ], () => Boolean(
        scope.ThinkStockAiForecast
        && scope.ThinkStockAiAnalysisCache
        && scope.ThinkStockAiForecastJournal
        && scope.ThinkStockAiForecastCalibration
        && scope.ThinkStockAiForecastQualityRuntime
      ));
      ai = Object.freeze({
        analysis: scope.ThinkStockAiAnalysisCache,
        forecast: scope.ThinkStockAiForecast,
        journal: scope.ThinkStockAiForecastJournal,
        calibration: scope.ThinkStockAiForecastCalibration,
        qualityRuntime: scope.ThinkStockAiForecastQualityRuntime,
      });
      return ai;
    }

    async function ensureMarketTiming() {
      if (marketTimingService) return marketTimingService;
      await loader.loadFeature("market-timing", [
        "./modules/market-timing-evaluation.js",
        "./modules/market-timing.js",
        "./modules/market-timing-service.js",
      ], () => Boolean(
        scope.ThinkStockMarketTimingEvaluation
        && scope.ThinkStockMarketTiming
        && scope.ThinkStockMarketTimingService
      ));
      marketTimingService = scope.ThinkStockMarketTimingService.createMarketTimingService(scope, {
        workerUrl: `./modules/market-timing-worker.js?v=${encodeURIComponent(version)}`,
        buildMacdOscillator: options.buildMacdOscillator,
        buildMarketTimingSignals: scope.ThinkStockMarketTiming.buildMarketTimingSignals,
        evaluateMarketTimingModel: scope.ThinkStockMarketTimingEvaluation.evaluateMarketTimingModel,
        summarizeMarketTimingQuality: scope.ThinkStockMarketTimingEvaluation.summarizeMarketTimingQuality,
      });
      return marketTimingService;
    }

    async function ensureStockResearch() {
      if (stockResearch) return stockResearch;
      const contractPaths = scope.ThinkStockStockResearchContract
        ? []
        : ["./modules/stock-research-contract.js"];
      await loader.loadFeature("stock-research", [
        ...contractPaths,
        "./modules/stock-research-storage.js",
        "./modules/stock-research-navigation.js",
        "./modules/stock-research-filter.js",
        "./modules/stock-research-history-cache.js",
        "./modules/stock-research-worker-client.js",
        "./modules/stock-research.js",
        "./modules/stock-research-controller.js",
      ], () => Boolean(
        scope.ThinkStockStockResearchContract
        && scope.ThinkStockStockResearchStorage
        && scope.ThinkStockStockResearchNavigation
        && scope.ThinkStockStockResearchFilter
        && scope.ThinkStockStockResearchHistoryCache
        && scope.ThinkStockStockResearchWorkerClient
        && scope.ThinkStockStockResearch
        && scope.ThinkStockStockResearchController
      ));
      stockResearch = Object.freeze({
        controller: scope.ThinkStockStockResearchController,
        research: scope.ThinkStockStockResearch,
      });
      return stockResearch;
    }

    return Object.freeze({ ensureAi, ensureMarketTiming, ensureStockResearch });
  }

  globalScope.ThinkStockOptionalFeatureRuntime = Object.freeze({ createOptionalFeatureRuntime });
}(typeof self !== "undefined" ? self : globalThis));

// Optional script loading is owned by the optional-feature runtime.
(function initThinkStockOptionalFeatureLoader(globalScope) {
  "use strict";

  function createOptionalFeatureLoader(scope = globalScope, options = {}) {
    const documentRef = options.document || scope.document;
    const version = String(options.version || "dev");
    const loadedScripts = new Map();
    const featureTasks = new Map();

    function versionedUrl(path) {
      const url = new URL(String(path || ""), documentRef.baseURI);
      if (!url.searchParams.has("v")) url.searchParams.set("v", version);
      return url.toString();
    }

    function loadScript(path) {
      const url = versionedUrl(path);
      if (loadedScripts.has(url)) return loadedScripts.get(url);
      const existing = [...documentRef.scripts].find((script) => script.src === url);
      if (existing?.dataset?.loaded === "1") return Promise.resolve(url);
      const task = new Promise((resolve, reject) => {
        const script = existing || documentRef.createElement("script");
        const cleanup = () => {
          script.removeEventListener("load", onLoad);
          script.removeEventListener("error", onError);
        };
        const onLoad = () => {
          cleanup();
          script.dataset.loaded = "1";
          resolve(url);
        };
        const onError = () => {
          cleanup();
          loadedScripts.delete(url);
          if (!existing) script.remove();
          reject(new Error(`선택 기능을 불러오지 못했습니다: ${path}`));
        };
        script.addEventListener("load", onLoad, { once: true });
        script.addEventListener("error", onError, { once: true });
        if (!existing) {
          script.src = url;
          script.async = true;
          documentRef.head.appendChild(script);
        }
      });
      loadedScripts.set(url, task);
      return task;
    }

    function loadFeature(name, paths, validate = null) {
      const key = String(name || "feature");
      if (featureTasks.has(key)) return featureTasks.get(key);
      const task = (async () => {
        for (const path of paths || []) await loadScript(path);
        if (typeof validate === "function" && !validate()) {
          throw new Error(`${key} 기능 초기화에 실패했습니다.`);
        }
        return true;
      })().catch((error) => {
        featureTasks.delete(key);
        throw error;
      });
      featureTasks.set(key, task);
      return task;
    }

    return Object.freeze({
      isLoaded: (name) => featureTasks.has(String(name || "feature")),
      loadFeature,
      loadScript,
    });
  }

  globalScope.ThinkStockOptionalFeatureLoader = Object.freeze({
    createOptionalFeatureLoader,
  });
}(typeof self !== "undefined" ? self : globalThis));
