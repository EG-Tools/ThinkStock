import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, sw, playwrightConfig, dataPayload, marketData, chartInteractionMath, chartInteractionController, cacheRefreshPolicy, browserMarketClient, auxiliaryChartModel, mainChartRenderer, performanceMonitor, appStorage, startupLoader, dataWorker, chartModelWorker, chartLoader, disclosurePolicy, disclosurePopover, dartDisclosure, serviceWorkerClient, runtimeRefresh, dataSeedLoader, deployWorkflow, plotlyBuilder, buildPagesData, dataBuildSupport, providerClients, providerContracts, sourcePipeline, buildReporting, plotlyBundle, appBundle] = await Promise.all([
  readFile(path.join(root, "docs", "app.js"), "utf8"),
  readFile(path.join(root, "docs", "index.html"), "utf8"),
  readFile(path.join(root, "docs", "sw.js"), "utf8"),
  readFile(path.join(root, "playwright.config.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-payload.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "market-data.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-interaction-math.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-interaction-controller.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "cache-refresh-policy.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "browser-market-client.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "auxiliary-chart-model.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "main-chart-renderer.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "performance-monitor.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-storage.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "startup-loader.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-worker.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-worker.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-loader.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-policy.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-popover.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "dart-disclosure.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "service-worker-client.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-refresh.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-seed-loader.js"), "utf8"),
  readFile(path.join(root, ".github", "workflows", "deploy-pages.yml"), "utf8"),
  readFile(path.join(root, "scripts", "build_plotly_bundle.cjs"), "utf8"),
  readFile(path.join(root, "scripts", "build_pages_data.py"), "utf8"),
  readFile(path.join(root, "scripts", "data_build_support.py"), "utf8"),
  readFile(path.join(root, "scripts", "provider_clients.py"), "utf8"),
  readFile(path.join(root, "scripts", "provider_contracts.py"), "utf8"),
  readFile(path.join(root, "scripts", "source_pipeline.py"), "utf8"),
  readFile(path.join(root, "scripts", "build_reporting.py"), "utf8"),
  stat(path.join(root, "docs", "vendor", "plotly-thinkstock-2.35.2.min.js")),
  stat(path.join(root, "docs", "assets", "app.bundle.min.js")),
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
];
requiredIds.forEach((id) => assert.ok(ids.includes(id), `required UI element is missing: ${id}`));

[
  "./index.html",
  "./styles.css",
  "./assets/app.bundle.min.js?v=dev",
  "./modules/data-payload.js?v=dev",
  "./modules/market-data.js?v=dev",
  "./modules/cache-refresh-policy.js?v=dev",
  "./modules/auxiliary-chart-model.js?v=dev",
  "./modules/data-worker.js?v=dev",
  "./modules/chart-model-worker.js?v=dev",
  "./vendor/plotly-thinkstock-2.35.2.min.js?v=dev",
  "./data/prices_recent.json",
  "./data/macro_data_recent.json",
  "./data/credit_data_recent.json",
  "./data/adr_data_recent.json",
  "./data/data_manifest.json",
  "./data/disclosures.json",
].forEach((asset) => assert.ok(sw.includes(`"${asset}"`), `service worker precache is missing: ${asset}`));

assert.ok(app.includes("function isDirectDisclosureTap"), "iPhone disclosure tap guard is missing");
assert.ok(app.includes("ThinkStockDisclosurePolicy"), "disclosure policy module is not wired into the app");
assert.ok(app.includes("ThinkStockDisclosurePopover"), "disclosure popover module is not wired into the app");
assert.ok(disclosurePopover.includes("createDisclosurePopover"), "disclosure popover module is incomplete");
assert.ok(!app.includes("function ensureDisclosurePopover("), "disclosure popover implementation still lives in app.js");
assert.ok(app.includes("ThinkStockDartDisclosure"), "DART disclosure module is not wired into the app");
assert.ok(app.includes("ThinkStockServiceWorkerClient"), "service worker client module is not wired into the app");
assert.ok(serviceWorkerClient.includes("createServiceWorkerClient"), "service worker client module is incomplete");
assert.ok(app.includes("ThinkStockRuntimeRefresh"), "runtime refresh module is not wired into the app");
assert.ok(runtimeRefresh.includes("runRefreshPhases"), "runtime refresh phase runner is incomplete");
assert.ok(app.includes("ThinkStockDataSeedLoader"), "data seed loader module is not wired into the app");
assert.ok(dataSeedLoader.includes("fetchSegmentedSeedText"), "data seed loader module is incomplete");
assert.ok(dataSeedLoader.includes("fetchDataManifest") && dataSeedLoader.includes("manifestSegmentPath"),
  "segmented data manifest is not consumed by the app");
assert.ok(!app.includes("async function fetchSeedText("), "seed network loading still lives in app.js");
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
assert.ok(app.includes("ThinkStockChartInteractionMath"), "chart interaction math module is not wired into the app");
assert.ok(chartInteractionMath.includes("axisPixelToXValue") && chartInteractionMath.includes("interpolateTraceYAtMs"),
  "chart interaction math module is incomplete");
assert.ok(app.includes("ThinkStockChartInteractionController"), "chart interaction controller module is not wired into the app");
assert.ok(chartInteractionController.includes("createPointerFrameController"), "chart interaction controller module is incomplete");
assert.ok(app.includes("buildLineHitIndex") && app.includes("lineHitIndexMatches"),
  "cached line hit index is not wired into the app");
assert.ok(sw.includes("ThinkStockCacheRefreshPolicy"), "service worker cache refresh policy is not wired");
assert.ok(cacheRefreshPolicy.includes("runWithConcurrency") && cacheRefreshPolicy.includes("planDataRefreshRequests"),
  "service worker cache refresh policy is incomplete");
assert.ok(!app.includes("function getChartInteractionGeometry("), "chart interaction geometry still lives in app.js");
assert.ok(app.includes("ThinkStockBrowserMarketClient"), "browser market client is not wired into the app");
assert.ok(browserMarketClient.includes("fetchYahooHistorySeries") && browserMarketClient.includes("fetchLatestKrxCoreIndexRows"),
  "browser market client is incomplete");
assert.ok(!app.includes("function fetchYahooHistorySeries(") && !app.includes("function fetchKrxIndexPoint("),
  "browser market requests still live in app.js");
assert.ok(app.includes("ThinkStockAuxiliaryChartModel"), "auxiliary chart model module is not wired into the app");
assert.ok(auxiliaryChartModel.includes("buildAuxiliaryChartModel") && auxiliaryChartModel.includes("buildThresholdZones"), "auxiliary chart model module is incomplete");
assert.ok(chartModelWorker.includes('type === "buildAuxiliaryChartModel"'), "auxiliary chart model is not built in the worker");
assert.ok(disclosurePolicy.includes("shouldDisplayDisclosure"), "disclosure policy filter is missing");
assert.ok(disclosurePopover.includes("disclosure-title-link"), "disclosure title links are missing");
assert.ok(html.includes('data-series="customer_deposit"'), "customer deposit toggle is missing");
assert.ok(!html.includes('data-series="news_sentiment"'), "news sentiment must not remain in the main-chart toggles");
assert.ok(buildPagesData.includes("getSecuritiesMarketTotalCapitalInfo"), "server customer deposit endpoint is missing");
assert.ok(app.includes('name: "뉴스심리"'), "news sentiment auxiliary trace is missing");
assert.ok(app.includes('yaxis: "y3"'), "news sentiment auxiliary axis is missing");
assert.ok(app.includes('text: "비관"'), "news sentiment pessimism guide is missing");
assert.ok(app.includes('text: "낙관"'), "news sentiment optimism guide is missing");
assert.ok(app.includes("CUSTOM_STOCK_PRELOAD_CONCURRENCY"), "custom stock preload concurrency guard is missing");
assert.ok(runtimeRefresh.includes("const criticalPromise") && runtimeRefresh.includes("const supplementalPromise"), "refresh phases do not start in parallel");
assert.ok(app.includes("coreIndexTask") && app.includes("preloadTask"), "price refresh tasks still run serially");
assert.ok(!app.includes("ecos.bok.or.kr/api/") && !app.includes("kosis.kr/openapi/"),
  "ECOS or KOSIS is still called directly from the browser");
assert.ok(!app.includes("ecosApiKey") && !app.includes("kosisApiKey") && !app.includes("apiSettings."),
  "server-refreshed API keys must not remain in browser storage");
assert.ok(!html.includes('type="password"') && !html.includes("dartProxyEnabledInput"),
  "server-refreshed API keys must not be requested in the browser");
assert.ok(deployWorkflow.includes("KOSIS_API_KEY: ${{ secrets.KOSIS_API_KEY }}")
  && buildPagesData.includes("fetch_kosis_leading_cycle")
  && providerContracts.includes("def kosis_rows("),
  "KOSIS server-side fallback is incomplete");
assert.ok(deployWorkflow.includes("KRX_API_KEY: ${{ secrets.KRX_API_KEY }}")
  && buildPagesData.includes("def fetch_krx_universe(")
  && app.includes("./data/krx_universe.json"),
  "KRX server-side universe is incomplete");
assert.ok(buildPagesData.includes("def fetch_dart_market_disclosures(")
  && app.includes("clearLegacyBrowserApiSettings()")
  && !app.includes("opendart.fss.or.kr/api/"),
  "DART browser secret removal or market seed is incomplete");
assert.ok(app.includes('name: "공포탐욕"') && app.includes('yaxis: "y2"'), "fear-greed auxiliary panel is missing");
assert.ok(app.includes("lastAdrRenderKey === renderKey"), "ADR render fast path is missing");
assert.ok(chartLoader.includes("plotly-thinkstock-2.35.2.min.js"), "ThinkStock Plotly bundle is not configured");
assert.ok(plotlyBundle.size < 950_000, `ThinkStock Plotly bundle is too large: ${plotlyBundle.size} bytes`);
assert.ok(plotlyBuilder.includes("stats.hasErrors()") && plotlyBuilder.includes("process.exitCode = 1"),
  "Plotly vendor build does not fail closed");
assert.ok(deployWorkflow.includes("npm run vendor:sync"),
  "deployment does not rebuild the custom Plotly bundle");
assert.ok(html.includes("./assets/app.bundle.min.js?v=dev"), "optimized app bundle is not loaded");
assert.equal([...html.matchAll(/<script\b/g)].length, 1, "runtime scripts are not bundled");
assert.ok(appBundle.size < 260_000, `app bundle is too large: ${appBundle.size} bytes`);
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
assert.ok(performanceMonitor.includes('observe({ type: "longtask", buffered: true })'),
  "browser long-task diagnostics are missing");
assert.ok(!app.includes("let perfSamples") && !app.includes("function startPerfFrameMonitor("), "performance diagnostics still live in app.js");
assert.ok(app.includes("ThinkStockAppStorage"), "app storage module is not wired into the app");
assert.ok(appStorage.includes("createApiSettingsStore") && appStorage.includes("createIndexedCacheStore"), "app storage module is incomplete");
assert.ok(!app.includes("function openRuntimeCacheDb(") && !app.includes("function sanitizeApiSettings("), "storage implementation still lives in app.js");
assert.ok(app.includes("ThinkStockStartupLoader"), "startup loader module is not wired into the app");
assert.ok(startupLoader.includes("createStartupLoader") && startupLoader.includes("requestAnimationFrame"), "startup loader module is incomplete");
assert.ok(!app.includes("function ensureStartupLoader(") && !app.includes("startupLoaderDisplayProgress"), "startup loader implementation still lives in app.js");
assert.ok(app.includes("runtimeRefreshController.abort"), "superseded runtime refreshes are not cancelled");
assert.ok(app.includes("function cancelStaleChartModelWorkerRequest()"), "stale chart worker cancellation is missing");
assert.ok(app.includes("getChartInteractionGeometry(sourceEl)"), "pointer geometry is not shared per frame");
assert.ok(app.includes('addEventListener("pointermove"') && app.includes("getCoalescedEvents"),
  "chart input is not using the unified pointer pipeline");
assert.ok(!app.includes('addEventListener("touchmove"') && !app.includes('addEventListener("mousedown"'),
  "legacy chart input listeners remain");
assert.ok(app.includes("function applyDisclosureStateFast("), "disclosure-only updates still require a full chart render");
assert.ok(app.includes("function applyMainChartRender(") && app.includes("mainChartPartialUpdateCount"),
  "main chart partial update fast path is missing");
assert.ok(app.includes("ThinkStockMainChartRenderer")
  && mainChartRenderer.includes("await plotly.update(")
  && mainChartRenderer.includes("relayoutPayload(layout)"),
  "main chart renderer module is incomplete");
assert.ok(!app.includes("function mainChartRestylePayload(")
  && !app.includes("function canApplyMainChartPartialUpdate("),
  "main chart rendering implementation still lives in app.js");
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
assert.ok(sw.includes("DATA_CACHE_PREFIX") && sw.includes('digest("SHA-256"') && sw.includes("-staging"),
  "service worker does not stage and verify manifest revisions");
assert.ok(sw.includes("planManifestRefreshEntries") && sw.includes("reusableKeys"),
  "service worker does not reuse unchanged manifest segments");
assert.ok(sw.includes('const DATA_CACHE_PREFIX = "thinkstock-data-v1-"')
  && sw.includes("planActivationCacheCleanup"),
  "service worker data cache does not survive shell deployments");
assert.ok(sw.includes("function dataCacheFirst("),
  "validated data cache is not preferred after an atomic refresh");
assert.ok(!sw.includes(".map((req) => cache.delete(req))"), "service worker still deletes data before refresh");
assert.ok(playwrightConfig.includes('name: "webkit-sw"') && playwrightConfig.includes('serviceWorkers: "allow"'),
  "service-worker-aware WebKit coverage is missing");
assert.ok(deployWorkflow.indexOf("npm ci") < deployWorkflow.indexOf("npm test"),
  "Node dependencies must be installed before web validation");
assert.ok(deployWorkflow.includes("actions/checkout@v6")
  && deployWorkflow.includes("actions/cache@v5")
  && deployWorkflow.includes("actions/setup-python@v6")
  && deployWorkflow.includes("actions/configure-pages@v6")
  && deployWorkflow.includes("actions/upload-pages-artifact@v5")
  && deployWorkflow.includes("actions/deploy-pages@v5"),
  "GitHub Actions are not on the Node 24 compatible majors");
assert.ok(deployWorkflow.includes("--requirement requirements-pages.txt"),
  "Pages build dependencies are not installed from the lock file");
assert.ok(deployWorkflow.includes('cron: "35 3 * * 0"'), "weekly full Pages data rebuild is missing");
assert.ok(deployWorkflow.includes("PAGES_FULL_REBUILD:"), "Pages full rebuild mode is not configured");
assert.ok(deployWorkflow.includes('cache: "pip"'), "Python dependency caching is missing");
assert.ok(deployWorkflow.includes("Publish Data Build Health"), "Pages data health summary is missing");
assert.ok(deployWorkflow.includes("validate-web:")
  && deployWorkflow.includes("- validate-web"),
  "web validation and data build must complete before deployment");
assert.ok(deployWorkflow.includes("Prepare Slim Pages Artifact")
  && deployWorkflow.includes("path: ./.pages-artifact"),
  "slim Pages artifact staging is missing");
assert.ok(buildPagesData.includes("detect_price_rebases") && buildPagesData.includes("disclosure_start_dates"),
  "incremental Pages data policies are not wired into the builder");
assert.ok(buildPagesData.includes("SourcePipeline") && buildPagesData.includes("build_dart_corp_code_payloads"),
  "Pages source health or sharded DART payload is missing");
assert.ok(app.includes('stock-to-corp-shards-v1') && app.includes("dartCorpCodeLoadedShards"),
  "DART corp code shards are not loaded lazily");
assert.ok(providerContracts.includes("freesis_rows")
  && providerContracts.includes("fear_greed_rows")
  && providerContracts.includes("adr_series_points")
  && providerContracts.includes("yahoo_close_columns"),
  "remaining provider response contracts are incomplete");
assert.ok(dataBuildSupport.includes("PRICE_OVERLAP_DAYS") && dataBuildSupport.includes("DART_OVERLAP_DAYS"),
  "incremental overlap policies are incomplete");
assert.ok(providerClients.includes("class RetryingHttpClient") && providerClients.includes("fetch_yahoo_prices"),
  "shared provider clients are incomplete");
assert.ok(providerClients.includes('"beginBasDt"') && providerClients.includes("stopped_early"),
  "KOFIA incremental pagination is incomplete");
assert.ok(sourcePipeline.includes("class SourcePipeline") && buildPagesData.includes("pipeline.run("),
  "provider source pipeline is not wired into the builder");
assert.ok(buildReporting.includes("BUILD_HISTORY_LIMIT = 20") && buildReporting.includes("summarize_build_trend"),
  "build health history is incomplete");

console.log(`Pages app validation passed (version ${appVersion}, ${ids.length} unique IDs).`);
