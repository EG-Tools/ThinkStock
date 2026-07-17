import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, sw, playwrightConfig, dataPayload, marketData, auxiliaryChartModel, performanceMonitor, appStorage, startupLoader, dataWorker, chartModelWorker, chartLoader, disclosurePolicy, dartDisclosure, serviceWorkerClient, runtimeRefresh, deployWorkflow, buildPagesData, dataBuildSupport, providerClients, plotlyBundle] = await Promise.all([
  readFile(path.join(root, "docs", "app.js"), "utf8"),
  readFile(path.join(root, "docs", "index.html"), "utf8"),
  readFile(path.join(root, "docs", "sw.js"), "utf8"),
  readFile(path.join(root, "playwright.config.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-payload.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "market-data.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "auxiliary-chart-model.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "performance-monitor.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-storage.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "startup-loader.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-worker.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-worker.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-loader.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-policy.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "dart-disclosure.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "service-worker-client.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-refresh.js"), "utf8"),
  readFile(path.join(root, ".github", "workflows", "deploy-pages.yml"), "utf8"),
  readFile(path.join(root, "scripts", "build_pages_data.py"), "utf8"),
  readFile(path.join(root, "scripts", "data_build_support.py"), "utf8"),
  readFile(path.join(root, "scripts", "provider_clients.py"), "utf8"),
  stat(path.join(root, "docs", "vendor", "plotly-basic-2.35.2.min.js")),
]);

const appVersion = app.match(/const APP_VERSION = "([0-9]+\.[0-9]+)";/)?.[1];
const htmlVersion = html.match(/id="appVersionText">([0-9]+\.[0-9]+)</)?.[1];
assert.ok(appVersion, "APP_VERSION is missing from docs/app.js");
assert.equal(htmlVersion, appVersion, "docs/index.html and docs/app.js versions differ");

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "docs/index.html contains duplicate element IDs");

const requiredIds = [
  "chart",
  "chart-adr",
  "messageArea",
  "dataFreshness",
  "stockSearchInput",
  "disclosureToggle",
  "refreshData",
  "apiSettingsModal",
  "dartApiInput",
];
requiredIds.forEach((id) => assert.ok(ids.includes(id), `required UI element is missing: ${id}`));

[
  "./index.html",
  "./styles.css",
  "./modules/data-payload.js?v=dev",
  "./modules/market-data.js?v=dev",
  "./modules/auxiliary-chart-model.js?v=dev",
  "./modules/performance-monitor.js?v=dev",
  "./modules/app-storage.js?v=dev",
  "./modules/startup-loader.js?v=dev",
  "./modules/chart-loader.js?v=dev",
  "./modules/disclosure-policy.js?v=dev",
  "./modules/dart-disclosure.js?v=dev",
  "./modules/service-worker-client.js?v=dev",
  "./modules/runtime-refresh.js?v=dev",
  "./modules/data-worker.js?v=dev",
  "./modules/chart-model-worker.js?v=dev",
  "./app.js?v=dev",
  "./vendor/plotly-basic-2.35.2.min.js",
  "./data/prices_recent.json",
  "./data/macro_data_recent.json",
  "./data/credit_data_recent.json",
  "./data/adr_data_recent.json",
  "./data/disclosures.json",
].forEach((asset) => assert.ok(sw.includes(`"${asset}"`), `service worker precache is missing: ${asset}`));

assert.ok(app.includes("function isDirectDisclosureTap"), "iPhone disclosure tap guard is missing");
assert.ok(app.includes("ThinkStockDisclosurePolicy"), "disclosure policy module is not wired into the app");
assert.ok(app.includes("ThinkStockDartDisclosure"), "DART disclosure module is not wired into the app");
assert.ok(app.includes("ThinkStockServiceWorkerClient"), "service worker client module is not wired into the app");
assert.ok(serviceWorkerClient.includes("createServiceWorkerClient"), "service worker client module is incomplete");
assert.ok(app.includes("ThinkStockRuntimeRefresh"), "runtime refresh module is not wired into the app");
assert.ok(runtimeRefresh.includes("runRefreshPhases"), "runtime refresh phase runner is incomplete");
assert.ok(app.includes("criticalTasks: [coreIndexTask, preloadTask, liveTask]"), "critical startup refresh tasks are not grouped");
assert.ok(app.includes("supplementalTasks: [adrTask, fearGreedTask, dartTask]"), "supplemental refresh tasks are not grouped");
assert.ok(app.includes("awaitCriticalRender: true") && app.includes("onCriticalReady"), "startup loader does not wait for the critical render phase");
assert.ok(dartDisclosure.includes("fetchForMarkets") && dartDisclosure.includes("fetchForTicker"), "DART disclosure fetch service is incomplete");
assert.ok(dartDisclosure.includes("rememberRefresh") && dartDisclosure.includes("mergeRows"), "DART disclosure cache service is incomplete");
assert.ok(!app.includes("function fetchDartDisclosurePage("), "DART page fetching still lives in app.js");
assert.ok(app.includes("ThinkStockDataPayload"), "data payload module is not wired into the app");
assert.ok(dataPayload.includes("rowsFromColumnarPayload"), "shared columnar payload parser is missing");
assert.ok(dataWorker.includes('importScripts("./data-payload.js?v=dev")'), "data worker does not reuse the shared payload parser");
assert.ok(app.includes("ThinkStockMarketData"), "market data module is not wired into the app");
assert.ok(marketData.includes("mergeSources") && marketData.includes("findTickerPriceRebaseSignal"), "market data module is incomplete");
assert.ok(chartModelWorker.includes('importScripts("./market-data.js?v=dev")'), "chart worker does not reuse the market data module");
assert.ok(chartModelWorker.includes('importScripts("./auxiliary-chart-model.js?v=dev")'), "chart worker does not reuse the auxiliary chart model module");
assert.ok(!app.includes("function mergeSources(") && !app.includes("function findTickerPriceRebaseSignal("), "market data logic still lives in app.js");
assert.ok(app.includes("ThinkStockAuxiliaryChartModel"), "auxiliary chart model module is not wired into the app");
assert.ok(auxiliaryChartModel.includes("buildAuxiliaryChartModel") && auxiliaryChartModel.includes("buildThresholdZones"), "auxiliary chart model module is incomplete");
assert.ok(chartModelWorker.includes('type === "buildAuxiliaryChartModel"'), "auxiliary chart model is not built in the worker");
assert.ok(disclosurePolicy.includes("shouldDisplayDisclosure"), "disclosure policy filter is missing");
assert.ok(app.includes("disclosure-title-link"), "disclosure title links are missing");
assert.ok(html.includes('data-series="customer_deposit"'), "customer deposit toggle is missing");
assert.ok(!html.includes('data-series="news_sentiment"'), "news sentiment must not remain in the main-chart toggles");
assert.ok(app.includes("getSecuritiesMarketTotalCapitalInfo"), "customer deposit API endpoint is missing");
assert.ok(app.includes('name: "뉴스심리"'), "news sentiment auxiliary trace is missing");
assert.ok(app.includes('yaxis: "y3"'), "news sentiment auxiliary axis is missing");
assert.ok(app.includes('text: "비관"'), "news sentiment pessimism guide is missing");
assert.ok(app.includes('text: "낙관"'), "news sentiment optimism guide is missing");
assert.ok(app.includes("CUSTOM_STOCK_PRELOAD_CONCURRENCY"), "custom stock preload concurrency guard is missing");
assert.ok(runtimeRefresh.includes("const criticalPromise") && runtimeRefresh.includes("const supplementalPromise"), "refresh phases do not start in parallel");
assert.ok(app.includes("coreIndexTask") && app.includes("preloadTask"), "price refresh tasks still run serially");
assert.ok(app.includes("Promise.allSettled([\n    apiSettings.ecosApiKey"), "macro and credit APIs still run serially");
assert.ok(app.includes('name: "공포탐욕"') && app.includes('yaxis: "y2"'), "fear-greed auxiliary panel is missing");
assert.ok(app.includes("lastAdrRenderKey === renderKey"), "ADR render fast path is missing");
assert.ok(chartLoader.includes("plotly-basic-2.35.2.min.js"), "Plotly basic bundle is not configured");
assert.ok(plotlyBundle.size < 1_500_000, `Plotly bundle is too large: ${plotlyBundle.size} bytes`);
assert.ok(app.includes('const MAIN_LINE_TRACE_TYPE = "scatter";'), "main chart is not using the SVG scatter path");
assert.ok(app.includes("MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_MOBILE"), "adaptive mobile chart budget is missing");
assert.ok(app.includes("const plotlyReadyTask = ensurePlotlyReady()"), "Plotly is not prepared in parallel during boot");
assert.ok(app.includes('hovermode: hoverShowPopup ? "x unified" : false'), "disabled hover still runs Plotly hit testing");
assert.ok(app.includes("function getRuntimeDataSignature()"), "runtime snapshot deduplication is missing");
assert.ok(app.includes('const RUNTIME_SNAPSHOT_FORMAT = "component-v1";'), "component snapshot format is missing");
assert.ok(appStorage.includes('const transaction = db.transaction(storeName, "readwrite");')
  && appStorage.includes("deleteKeys.forEach((key) => store.delete(key))"), "single-transaction IndexedDB cleanup is missing");
assert.ok(!app.includes("function rowsSignature("), "sampled row signatures can leave stale chart data");
assert.ok(app.includes("function dataRevisionSignature("), "explicit data revisions are missing");
assert.ok(app.includes("function getTraceLinePaths("), "DOM-only line highlighting is missing");
assert.ok(!app.includes('Plotly.restyle(el, { "line.width"'), "line hover still triggers Plotly restyle");
assert.ok(app.includes("ThinkStockPerformanceMonitor"), "performance monitor module is not wired into the app");
assert.ok(performanceMonitor.includes("createPerformanceMonitor") && performanceMonitor.includes("p95FrameGap"), "performance monitor module is incomplete");
assert.ok(performanceMonitor.includes("gap < frameGapIgnoreMs"), "suspended tabs still pollute frame timing diagnostics");
assert.ok(!app.includes("let perfSamples") && !app.includes("function startPerfFrameMonitor("), "performance diagnostics still live in app.js");
assert.ok(app.includes("ThinkStockAppStorage"), "app storage module is not wired into the app");
assert.ok(appStorage.includes("createApiSettingsStore") && appStorage.includes("createIndexedCacheStore"), "app storage module is incomplete");
assert.ok(!app.includes("function openRuntimeCacheDb(") && !app.includes("function sanitizeApiSettings("), "storage implementation still lives in app.js");
assert.ok(app.includes("ThinkStockStartupLoader"), "startup loader module is not wired into the app");
assert.ok(startupLoader.includes("createStartupLoader") && startupLoader.includes("requestAnimationFrame"), "startup loader module is incomplete");
assert.ok(!app.includes("function ensureStartupLoader(") && !app.includes("startupLoaderDisplayProgress"), "startup loader implementation still lives in app.js");
assert.ok(app.includes("runtimeRefreshController.abort"), "superseded runtime refreshes are not cancelled");
assert.ok(app.includes("function cancelStaleChartModelWorkerRequest()"), "stale chart worker cancellation is missing");
assert.ok(app.includes("function getChartInteractionGeometry("), "pointer geometry is not shared per frame");
assert.ok(app.includes("function applyDisclosureStateFast("), "disclosure-only updates still require a full chart render");
assert.ok(app.includes('const DISCLOSURE_ICON_TEXT = "◆";'), "disclosure icon is not configured");
assert.ok(app.includes("fetchSegmentedSeedText"), "segmented data loading is missing");
assert.ok(app.includes("ensureHistoricalDataLoaded"), "historical lazy loading is missing");
assert.ok(app.includes("requestChartModelFromWorker"), "chart model worker client is missing");
assert.ok(app.includes("initE2eDebugAccess"), "WebKit test diagnostics are missing");
assert.ok(app.includes("scheduleServiceWorkerRegistration();"), "service worker registration is not started during boot");
assert.ok(!app.includes("function requestServiceWorkerDataRefresh("), "service worker messaging still lives in app.js");
assert.ok(sw.includes("function cacheFirst("), "service worker cache-first strategy is missing");
assert.ok(sw.includes("isVersionedAssetUrl(url)"), "versioned assets are not using immutable caching");
assert.ok(sw.includes("NETWORK_FIRST_TIMEOUT_MS = 3500"), "service worker network fallback deadline is missing");
assert.ok(sw.includes("Promise.allSettled(PRECACHE_ASSETS"), "service worker precache is not failure-isolated");
assert.ok(sw.includes("refreshCachedDataAtomically"), "service worker data refresh is not atomic");
assert.ok(!sw.includes(".map((req) => cache.delete(req))"), "service worker still deletes data before refresh");
assert.ok(playwrightConfig.includes('name: "webkit-sw"') && playwrightConfig.includes('serviceWorkers: "allow"'),
  "service-worker-aware WebKit coverage is missing");
assert.ok(deployWorkflow.includes('cron: "35 3 * * 0"'), "weekly full Pages data rebuild is missing");
assert.ok(deployWorkflow.includes("PAGES_FULL_REBUILD:"), "Pages full rebuild mode is not configured");
assert.ok(deployWorkflow.includes('cache: "pip"'), "Python dependency caching is missing");
assert.ok(buildPagesData.includes("detect_price_rebases") && buildPagesData.includes("disclosure_start_dates"),
  "incremental Pages data policies are not wired into the builder");
assert.ok(dataBuildSupport.includes("PRICE_OVERLAP_DAYS") && dataBuildSupport.includes("DART_OVERLAP_DAYS"),
  "incremental overlap policies are incomplete");
assert.ok(providerClients.includes("class RetryingHttpClient") && providerClients.includes("fetch_yahoo_prices"),
  "shared provider clients are incomplete");

console.log(`Pages app validation passed (version ${appVersion}, ${ids.length} unique IDs).`);
