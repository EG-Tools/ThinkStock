import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, sw, playwrightConfig, dataPayload, marketData, chartInteractionMath, chartInteractionController, cacheRefreshPolicy, browserMarketClient, auxiliaryChartModel, mainChartRenderer, performanceMonitor, performanceDiagnostics, appUiBindings, runtimeSnapshotPolicy, appStorage, startupLoader, dataWorker, chartModelWorker, chartLoader, disclosurePolicy, disclosurePopover, serviceWorkerClient, runtimeRefresh, dataSeedLoader, deployWorkflow, plotlyBuilder, buildPagesData, dataBuildSupport, providerClients, providerContracts, providerSources, creditProcessing, disclosureProcessing, payloadOutput, sourcePipeline, buildReporting, plotlyBundle, appBundle] = await Promise.all([
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
  readFile(path.join(root, "docs", "modules", "performance-diagnostics.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-ui-bindings.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-snapshot-controller.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-storage.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "startup-loader.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-worker.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-worker.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-loader.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-policy.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-popover.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "service-worker-client.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-refresh-orchestrator.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-seed-loader.js"), "utf8"),
  readFile(path.join(root, ".github", "workflows", "deploy-pages.yml"), "utf8"),
  readFile(path.join(root, "scripts", "build_plotly_bundle.cjs"), "utf8"),
  readFile(path.join(root, "scripts", "build_pages_data.py"), "utf8"),
  readFile(path.join(root, "scripts", "data_build_support.py"), "utf8"),
  readFile(path.join(root, "scripts", "provider_clients.py"), "utf8"),
  readFile(path.join(root, "scripts", "provider_contracts.py"), "utf8"),
  readFile(path.join(root, "scripts", "provider_sources.py"), "utf8"),
  readFile(path.join(root, "scripts", "credit_processing.py"), "utf8"),
  readFile(path.join(root, "scripts", "disclosure_processing.py"), "utf8"),
  readFile(path.join(root, "scripts", "payload_output.py"), "utf8"),
  readFile(path.join(root, "scripts", "source_pipeline.py"), "utf8"),
  readFile(path.join(root, "scripts", "build_reporting.py"), "utf8"),
  stat(path.join(root, "docs", "vendor", "plotly-thinkstock-2.35.2.min.js")),
  stat(path.join(root, "docs", "assets", "app.bundle.min.js")),
]);
const [deferredDiagnostics, dataHealth, pagesEntry, styles, insiderTrades, workerIndex, workerRouter, kofiaClient, marketTimingService, marketTimingWorker, aiScenarioPaths, aiForecastWorker, chartRenderScheduler, optionalFeatureLoader, optionalFeatureRuntime, stockResearchApp, aiForecastCache, aiForecastQualityRuntime, chartModelCache, chartPointerRuntime, chartHoverRuntime, chartMarkerRuntime, auxiliaryChartRuntime, mainChartEvents, apiPeriods, settingsPanelRuntime, aiForecastTraces, runtimeRefreshOrchestrator, progressView, disclosureProgress] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "deferred-diagnostics.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-health.js"), "utf8"),
  readFile(path.join(root, "scripts", "pages-entry.mjs"), "utf8"),
  readFile(path.join(root, "docs", "styles.css"), "utf8"),
  readFile(path.join(root, "docs", "modules", "insider-trades.js"), "utf8"),
  readFile(path.join(root, "worker", "src", "index.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "request-router.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "kofia-client.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "market-timing-service.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "market-timing-worker.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-scenario-paths.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-forecast-worker.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-render-scheduler.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "optional-feature-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "optional-feature-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-app.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-forecast-cache.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-forecast-quality-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-cache.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-pointer-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-hover-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-marker-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "auxiliary-chart-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "main-chart-events.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "api-periods.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "settings-panel-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-forecast-traces.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-refresh-orchestrator.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "progress-view.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-progress.js"), "utf8"),
]);
const [aiForecastApp, runtimeDataApp, cacheMigrations, stockResearchContract, stockResearchStorage, stockResearchNavigation, stockResearchFilter, stockResearchHistoryCache, stockResearchWorkerClient, runtimeBootstrap, appStateController, controlStateView, cacheMaintenanceRuntime, runtimeSnapshotController, sharedRequestRegistry, chartUpdateCoordinator, webkitScopeRunner] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "ai-forecast-app.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-data-app.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "cache-migrations.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-contract.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-storage.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-navigation.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-filter.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-history-cache.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-worker-client.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-bootstrap.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-state-controller.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "control-state-view.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "cache-maintenance-runtime.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-snapshot-controller.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "shared-request-registry.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-update-coordinator.js"), "utf8"),
  readFile(path.join(root, "scripts", "run_webkit_scope.mjs"), "utf8"),
]);
const [packageJsonSource, publicDeploymentVerifier, chartViewportController, chartSessionState, chartSessionController, chartModelWorkerClient, runtimeDataTransaction, runtimeSourceHealth, pagesShellBuilder, vkospiDataSource] = await Promise.all([
  readFile(path.join(root, "package.json"), "utf8"),
  readFile(path.join(root, "scripts", "verify_pages_deployment.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-viewport-controller.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-session-controller.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-session-controller.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-worker-client.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-data-transaction.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-source-health.js"), "utf8"),
  readFile(path.join(root, "scripts", "prepare_pages_shell.py"), "utf8"),
  readFile(path.join(root, "docs", "data", "vkospi_data.json"), "utf8"),
]);
const [adminFeatureAccess, adminSessionHandler, adminSession, workerConfig] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "admin-feature-access.js"), "utf8"),
  readFile(path.join(root, "worker", "src", "admin-session-handler.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "admin-session.mjs"), "utf8"),
  readFile(path.join(root, "worker", "wrangler.jsonc"), "utf8"),
]);
const packageJson = JSON.parse(packageJsonSource);
const vkospiData = JSON.parse(vkospiDataSource);
const appBundleGzipBytes = gzipSync(await readFile(path.join(root, "docs", "assets", "app.bundle.min.js"))).byteLength;
const APP_BUNDLE_MAX_BYTES = 500_000;
const APP_BUNDLE_GZIP_MAX_BYTES = 175_000;
const precacheAssetsSource = sw.match(/const PRECACHE_ASSETS = \[([\s\S]*?)\];/)?.[1] || "";

const appVersion = app.match(/const APP_VERSION = "([0-9]+\.[0-9]+)";/)?.[1];
const htmlVersion = html.match(/id="appVersionText">([0-9]+\.[0-9]+)</)?.[1];
const htmlVersionCopies = [...html.matchAll(/data-app-version-copy>([0-9]+\.[0-9]+)</g)]
  .map((match) => match[1]);
assert.ok(appVersion, "APP_VERSION is missing from docs/app.js");
assert.equal(htmlVersion, appVersion, "docs/index.html and docs/app.js versions differ");
assert.ok(htmlVersionCopies.length > 0, "main page app version copy is missing");
assert.ok(htmlVersionCopies.every((version) => version === appVersion),
  "main page and settings app versions differ");
assert.ok(app.includes("const MAX_VISIBLE_MAIN_SERIES = 10;"), "main chart series limit must remain ten");
assert.ok(
  html.includes("본 서비스는 한국거래소 통계정보를 사용합니다.") && styles.includes(".data-attribution"),
  "KRX data attribution is missing",
);
[
  "http://www.adrinfo.kr/chart",
  "https://kospi.feargreedchart.com/",
  "https://ecos.bok.or.kr/",
  "https://data.krx.co.kr/",
  "https://freesis.kofia.or.kr/",
  "https://www.data.go.kr/",
  "https://opendart.fss.or.kr/",
  "https://fred.stlouisfed.org/",
  "https://finance.naver.com/",
  "https://finance.yahoo.com/",
  "https://www.stockplus.com/m/stocks/KOREA-O2901P",
].forEach((sourceUrl) => {
  assert.ok(html.includes(`href="${sourceUrl}"`), `data source link is missing: ${sourceUrl}`);
});
assert.equal(vkospiData.format, "records-v1", "VKOSPI data format is invalid");
assert.ok(Array.isArray(vkospiData.records), "VKOSPI records are missing");
assert.ok(vkospiData.records.length >= 4000, "VKOSPI history was unexpectedly truncated");
const bundledVkospiRecords = vkospiData.records.filter((record) => (
  Number.isFinite(record?.vkospi) && record.vkospi > 0
));
const bundledVixRecords = vkospiData.records.filter((record) => (
  Number.isFinite(record?.vix) && record.vix > 0
));
assert.ok(bundledVkospiRecords.length >= 4000, "VKOSPI history was unexpectedly truncated");
assert.ok(bundledVixRecords.length >= 1900, "VIX history was unexpectedly truncated");
assert.equal(
  bundledVkospiRecords[0]?.date,
  "2010-01-04",
  "VKOSPI history must begin at the KRX-supported start date",
);
assert.equal(bundledVixRecords[0]?.date, "1990-01-03", "VIX history must retain its FRED start date");
assert.equal(vkospiData.records[0]?.date, vkospiData.first_date, "volatility first-date metadata is invalid");
assert.equal(vkospiData.records.at(-1)?.date, vkospiData.latest_date, "VKOSPI latest-date metadata is invalid");
assert.match(vkospiData.source || "", /KRX/, "VKOSPI source must retain KRX attribution");
assert.match(vkospiData.source || "", /증권플러스/, "VKOSPI historical fallback attribution is missing");
assert.match(vkospiData.sources?.vix || "", /FRED VIXCLS/, "VIX source attribution is missing");
for (let index = 0; index < vkospiData.records.length; index += 1) {
  const record = vkospiData.records[index];
  assert.match(record.date || "", /^\d{4}-\d{2}-\d{2}$/, `VKOSPI record ${index} has an invalid date`);
  const validVkospi = Number.isFinite(record.vkospi) && record.vkospi > 0;
  const validVix = Number.isFinite(record.vix) && record.vix > 0;
  assert.ok(validVkospi || validVix, `volatility record ${record.date} has no valid value`);
  assert.notEqual(record.vkospi, 0, `VKOSPI record ${record.date} contains a zero sentinel`);
  assert.notEqual(record.vix, 0, `VIX record ${record.date} contains a zero sentinel`);
  if (index === 0) continue;
  const previousDate = vkospiData.records[index - 1].date;
  assert.ok(record.date > previousDate, `VKOSPI dates are duplicated or unsorted at ${record.date}`);
  const gapDays = (Date.parse(`${record.date}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)) / 86400000;
  assert.ok(gapDays <= 20, `VKOSPI history has an unexpected ${gapDays}-day gap after ${previousDate}`);
}
assert.ok(
  html.includes('class="main-chart-wrap"')
    && html.includes('id="resetHandles"')
    && html.includes("chart-reset-btn"),
  "chart reset button is not positioned in the main chart",
);
assert.ok(
  html.includes('class="refresh-btn chart-refresh-btn"'),
  "refresh button is not positioned in the main chart",
);
assert.ok(html.includes("chart-progress disclosure-progress")
  && html.includes("chart-progress ai-forecast-progress")
  && styles.includes(".chart-progress-track > i")
  && styles.includes("--chart-ui-progress-fill"),
"AI and DART progress components do not share one visual system");
assert.ok(pagesEntry.includes('import "../docs/modules/progress-view.js"')
  && aiForecastApp.includes("ThinkStockProgressView")
  && disclosureProgress.includes("ThinkStockProgressView")
  && progressView.includes("createProgressView"),
"AI and DART progress behavior does not share one DOM view");
assert.ok(html.includes("chart-toggle reset-btn")
  && html.includes("chart-toggle hover-toggle-btn")
  && styles.includes(".chart-toggle.is-active"),
"chart toggle components do not share one state style");
assert.ok(html.includes("chart-help-message runtime-refresh-status")
  && html.includes("chart-help-message chart-navigation-message")
  && styles.includes("--chart-ui-help-duration"),
"chart help messages do not share one visual system");

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "docs/index.html contains duplicate element IDs");

const requiredIds = [
  "chart",
  "chart-adr",
  "messageArea",
  "dataFreshness",
  "resetHandles",
  "chartHandlesToggle",
  "recessionToggle",
  "stockSearchInput",
  "disclosureToggle",
  "insiderTradeToggle",
  "refreshData",
  "chartRangeControls",
  "chartRange6Months",
  "chartRange1Year",
  "chartRange3Years",
  "chartJumpLatest",
  "chartNavigationMessage",
  "apiSettingsModal",
  "dartGatewayTokenInput",
  "dartGatewayTokenSaveBtn",
  "releaseNotesBtn",
  "releaseNotesPanel",
  "releaseNotesVersion",
  "releaseNotesList",
  "apiPeriodBtn",
  "apiPeriodPanel",
  "apiPeriodRows",
  "stockResearchBtn",
  "stockResearchModal",
  "stockResearchRefreshBtn",
  "stockResearchMinimumDecrease",
  "stockResearchMinimumValue",
  "stockResearchMinimumIncrease",
  "stockResearchList",
  "stockResearchModalBlockedClearBtn",
  "appCacheBtn",
  "appCachePanel",
  "appCacheDeleteBtn",
  "appStateResetBtn",
];
requiredIds.forEach((id) => assert.ok(ids.includes(id), `required UI element is missing: ${id}`));
assert.ok(!html.includes('class="range-btn"'), "legacy month range buttons must be removed");
assert.ok(!html.includes("chartRangeStepper")
  && !html.includes("rangeExpand")
  && !html.includes("rangeContract")
  && !html.includes("chartZoomIn")
  && !html.includes("chartZoomOut")
  && !html.includes("chartHistorySlider")
  && !appUiBindings.includes("bindHistorySlider")
  && !appUiBindings.includes("resolveHistoryWindow"),
  "legacy range controls must be removed");

[
  "hoverToggle",
  "chartToolsToggle",
  "chartHandlesToggle",
  "creditOffset",
  "stockResearchBtn",
  "apiOptionsBtn",
].reduce((previousIndex, id) => {
  const index = html.indexOf(`id="${id}"`);
  assert.ok(index > previousIndex, `top control order is incorrect at ${id}`);
  return index;
}, -1);

[
  "resetHandles",
  "coMovementToggle",
  "insiderTradeToggle",
  "disclosureToggle",
  "recessionToggle",
  "aiForecastToggle",
].reduce((previousIndex, id) => {
  const index = html.indexOf(`id="${id}"`);
  assert.ok(index > previousIndex, `main chart control order is incorrect at ${id}`);
  return index;
}, -1);
assert.ok(pagesEntry.includes('import "../docs/modules/insider-trades.js"'),
  "insider trade module is not included in the app bundle");
assert.ok(app.includes("ThinkStockInsiderTrades")
  && app.includes("DART_GATEWAY_INSIDER_ENDPOINT")
  && app.includes("buildInsiderTradeTraces")
  && app.includes("showInsiderTrades"),
"insider trade UI and chart integration is incomplete");
assert.ok(insiderTrades.includes('"triangle-up"')
  && insiderTrades.includes('"triangle-down"')
  && insiderTrades.includes('const BUY_COLOR = "#b91c1c"')
  && insiderTrades.includes('const SELL_COLOR = "#1d4ed8"'),
"insider buy/sell marker styling is incomplete");
assert.ok(!/(^|\n)\.cartesianlayer \.point \{ display: none !important; \}/.test(styles)
  && styles.includes(".chart-frame-adr .cartesianlayer .point { display: none !important; }"),
"global point-marker hiding must not suppress insider trade triangles");
assert.ok(workerIndex.includes("DART_ELESTOCK_URL")
  && workerIndex.includes('route.id === "insider-trades"')
  && workerRouter.includes('path: "/api/dart/insider-trades"')
  && workerIndex.includes("LOOKBACK_YEARS")
  && workerIndex.includes("`insider:${ticker}`"),
"DART insider trade gateway or three-year cache policy is incomplete");

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
  "./modules/macd-oscillator.js?v=dev",
  "./vendor/plotly-thinkstock-2.35.2.min.js?v=dev",
  "./data/prices_recent.json",
  "./data/macro_data_recent.json",
  "./data/credit_data_recent.json",
  "./data/adr_data_recent.json",
  "./data/vkospi_data.json",
  "./data/data_manifest.json",
  "./data/disclosures.json",
].forEach((asset) => assert.ok(sw.includes(`"${asset}"`), `service worker precache is missing: ${asset}`));
const optionalFeatureAssets = [...optionalFeatureRuntime.matchAll(/"(\.\/modules\/[a-z0-9-]+\.js)"/g)]
  .map((match) => match[1]);
optionalFeatureAssets.forEach((asset) => {
  assert.ok(!precacheAssetsSource.includes(`"${asset}?v=dev"`), `optional feature must load on demand: ${asset}`);
  assert.ok(sw.includes(`"${asset.slice(1)}"`), `optional feature is not version-cacheable: ${asset}`);
});
[
  "./modules/stock-research-worker.js",
  "./modules/market-timing-worker.js",
  "./modules/ai-forecast-worker.js",
].forEach((asset) => {
  assert.ok(!precacheAssetsSource.includes(`"${asset}?v=dev"`), `optional worker must load on demand: ${asset}`);
  assert.ok(sw.includes(`"${asset.slice(1)}"`), `optional worker is not version-cacheable: ${asset}`);
});
assert.ok(!precacheAssetsSource.includes('"./data/ai_market_model.json"'),
  "AI market model must load on demand");
assert.ok(aiForecastWorker.includes("new URL(self.location.href).search")
  && marketTimingWorker.includes("new URL(self.location.href).search"),
"optional workers do not share their versioned cache key with dependencies");

assert.ok(app.includes("function isDirectDisclosureTap"), "iPhone disclosure tap guard is missing");
assert.ok(app.includes("ThinkStockDisclosurePolicy"), "disclosure policy module is not wired into the app");
assert.ok(app.includes("ThinkStockDisclosurePopover"), "disclosure popover module is not wired into the app");
assert.ok(disclosurePopover.includes("createDisclosurePopover"), "disclosure popover module is incomplete");
assert.ok(!app.includes("function ensureDisclosurePopover("), "disclosure popover implementation still lives in app.js");
assert.ok(app.includes("ThinkStockServiceWorkerClient"), "service worker client module is not wired into the app");
assert.ok(serviceWorkerClient.includes("createServiceWorkerClient"), "service worker client module is incomplete");
assert.ok(app.includes("ThinkStockRuntimeRefresh"), "runtime refresh module is not wired into the app");
assert.ok(runtimeRefresh.includes("runRefreshPhases"), "runtime refresh phase runner is incomplete");
assert.ok(app.includes("ThinkStockRuntimeRefreshOrchestrator")
  && pagesEntry.includes('import "../docs/modules/runtime-refresh-orchestrator.js"')
  && runtimeRefreshOrchestrator.includes("createRuntimeRefreshOrchestrator")
  && runtimeRefreshOrchestrator.includes("planRuntimeRefreshRendering"),
"runtime refresh orchestration is not separated from app.js");
assert.ok(app.includes("ThinkStockDataSeedLoader"), "data seed loader module is not wired into the app");
assert.ok(dataSeedLoader.includes("fetchSegmentedSeedText"), "data seed loader module is incomplete");
assert.ok(dataSeedLoader.includes("fetchDataManifest") && dataSeedLoader.includes("manifestSegmentPath"),
  "segmented data manifest is not consumed by the app");
assert.ok(!app.includes("async function fetchSeedText("), "seed network loading still lives in app.js");
assert.ok(runtimeRefreshOrchestrator.includes('criticalTask("indices", coreIndexTask)')
  && runtimeRefreshOrchestrator.includes('criticalTask("prices-visible", preloadTask)')
  && runtimeRefreshOrchestrator.includes("const criticalTotal = 2;"),
"critical startup refresh tasks are not grouped");
assert.ok(runtimeRefreshOrchestrator.includes("supplementalTasks: [")
  && runtimeRefreshOrchestrator.includes("hiddenPriceTask,")
  && runtimeRefreshOrchestrator.includes('scope: "hidden"'),
"supplemental refresh tasks do not defer hidden stock prices");
assert.ok(runtimeRefreshOrchestrator.includes('reportCriticalProgress("chart", 96)')
  && runtimeDataApp.includes("onCriticalProgress: flow.onCriticalProgress"),
"startup progress does not follow critical refresh completion");
assert.ok(runtimeDataApp.includes("awaitCriticalRender: true")
  && runtimeDataApp.includes("onCriticalReady"),
"startup loader does not wait for the critical render phase");
assert.ok(disclosurePolicy.includes("createDisclosureDataService")
  && app.includes("const disclosureDataService = createDisclosureDataService"),
  "disclosure data handling is not separated from app.js");
assert.ok(!app.includes("ThinkStockDartDisclosure")
  && !sw.includes('"/modules/dart-disclosure.js"'),
"obsolete browser-side DART client is still shipped");
assert.ok(!app.includes("function fetchDartDisclosurePage("), "DART page fetching still lives in app.js");
assert.ok(app.includes("ThinkStockDataPayload"), "data payload module is not wired into the app");
assert.ok(app.includes("ThinkStockOptionalFeatureRuntime")
  && optionalFeatureRuntime.includes("ThinkStockMarketTimingService")
  && marketTimingService.includes("createMarketTimingService")
  && marketTimingService.includes("buildTimingModels"),
"market timing worker service is not wired into the app");
assert.ok(!pagesEntry.includes('import "../docs/modules/market-timing-service.js"')
  && optionalFeatureRuntime.includes('loader.loadFeature("market-timing"')
  && marketTimingWorker.includes("buildTimingModels")
  && marketTimingWorker.includes("source cache miss"),
"market timing must load on demand and calculate in its worker");
assert.ok(!app.includes("marketTimingModelCache = new Map()"),
  "market timing model cache still lives in app.js");
assert.ok(!pagesEntry.includes('import "../docs/modules/ai-scenario-paths.js"')
  && optionalFeatureRuntime.includes('loader.loadFeature("ai-forecast"')
  && aiForecastWorker.includes("./ai-forecast-math.js")
  && aiForecastWorker.includes("./ai-forecast-model.js")
  && aiForecastWorker.includes("./ai-scenario-paths.js")
  && aiForecastWorker.includes("./ai-forecast-scenarios.js")
  && aiForecastWorker.includes("./ai-forecast.js")
  && aiScenarioPaths.includes("buildHistoricalPathLibrary")
  && aiScenarioPaths.includes("buildScenarioMorphologies"),
"AI scenario modules must load on demand and stay shared with the forecast worker");
assert.ok(pagesEntry.includes('import "../docs/modules/ai-forecast-app.js"')
  && app.includes("ThinkStockAiForecastApp")
  && aiForecastApp.includes("cancelCalculations")
  && aiForecastApp.includes("progressActive")
  && !app.includes("let aiForecastWorker"),
"AI worker and progress orchestration is not separated from app.js");
assert.ok(pagesEntry.includes('import "../docs/modules/ai-forecast-traces.js"')
  && app.includes("ThinkStockAiForecastTraces")
  && aiForecastTraces.includes("createAiForecastTraces")
  && aiForecastTraces.includes("isPrimaryAiScenario"),
"AI forecast trace assembly is not separated from app.js");
assert.ok(dataPayload.includes("rowsFromColumnarPayload"), "shared columnar payload parser is missing");
assert.ok(dataWorker.includes('importScripts("./data-payload.js?v=dev")'), "data worker does not reuse the shared payload parser");
assert.ok(app.includes("ThinkStockMarketData"), "market data module is not wired into the app");
assert.ok(marketData.includes("mergeSources") && marketData.includes("findTickerPriceRebaseSignal"), "market data module is incomplete");
assert.ok(chartModelWorker.includes('importScripts("./market-data.js?v=dev")'), "chart worker does not reuse the market data module");
assert.ok(
  marketData.includes("shiftIsoDateByDays")
    && chartModelWorker.includes("creditCols.includes(series)")
    && app.includes("CREDIT_COLS.includes(series)"),
  "credit offset must shift only the credit trace dates",
);
assert.ok(chartModelWorker.includes('importScripts("./auxiliary-chart-model.js?v=dev")'), "chart worker does not reuse the auxiliary chart model module");
assert.ok(!app.includes("function mergeSources(") && !app.includes("function findTickerPriceRebaseSignal("), "market data logic still lives in app.js");
assert.ok(app.includes("ThinkStockChartInteractionMath"), "chart interaction math module is not wired into the app");
assert.ok(chartInteractionMath.includes("axisPixelToXValue") && chartInteractionMath.includes("interpolateTraceYAtMs"),
  "chart interaction math module is incomplete");
assert.ok(app.includes("ThinkStockChartInteractionController"), "chart interaction controller module is not wired into the app");
assert.ok(chartInteractionController.includes("createPointerFrameController"), "chart interaction controller module is incomplete");
assert.ok(app.includes("ThinkStockChartSessionController")
  && chartSessionController.includes("setAutoScale")
  && !app.includes("CHART_WORKER_STALE_CANCEL_MS"),
"chart state transitions are not centralized or stale worker cancellation remains");
assert.ok(app.includes("ThinkStockChartModelWorkerClient")
  && chartModelWorkerClient.includes("active.superseded")
  && chartModelWorkerClient.includes("dispatchNext"),
"latest-wins chart worker client is not wired into the app");
assert.ok(app.includes("ThinkStockRuntimeDataTransaction")
  && runtimeDataTransaction.includes("assertSeriesRows")
  && runtimeDataTransaction.includes("introduced-anomaly"),
"runtime data is not validated before atomic commit");
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
assert.ok(app.includes("ThinkStockAuxiliaryChartRuntime")
  && pagesEntry.includes('import "../docs/modules/auxiliary-chart-runtime.js"')
  && auxiliaryChartRuntime.includes("createAuxiliaryChartRuntime"),
"auxiliary chart runtime module is not wired into the app");
assert.ok(chartModelWorker.includes('type === "buildAuxiliaryChartModel"'), "auxiliary chart model is not built in the worker");
assert.ok(disclosurePolicy.includes("shouldDisplayDisclosure"), "disclosure policy filter is missing");
assert.ok(disclosurePopover.includes("disclosure-title-link"), "disclosure title links are missing");
assert.ok(html.includes('data-series="customer_deposit"'), "customer deposit toggle is missing");
assert.ok(!html.includes('data-series="news_sentiment"'), "news sentiment must not remain in the main-chart toggles");
assert.ok(buildPagesData.includes("getSecuritiesMarketTotalCapitalInfo"), "server customer deposit endpoint is missing");
assert.ok(auxiliaryChartRuntime.includes('name: "뉴스심리"') && !auxiliaryChartRuntime.includes("뉴스심리 20일 이동평균"),
  "news sentiment auxiliary trace label is not simplified");
assert.ok(auxiliaryChartRuntime.includes("yaxis: panelLayout.axes.newsSentiment"),
  "news sentiment dynamic auxiliary axis is missing");
assert.ok(auxiliaryChartRuntime.includes('name: "VKOSPI"')
  && auxiliaryChartRuntime.includes("yaxis: panelLayout.axes.vkospi"), "VKOSPI dynamic auxiliary axis is missing");
assert.ok(auxiliaryChartRuntime.includes('name: "VIX"')
  && auxiliaryChartRuntime.includes('text: "변동성"')
  && auxiliaryChartRuntime.includes("AUXILIARY_SERIES_KEYS.vix"),
"combined VKOSPI/VIX volatility panel is missing");
assert.ok(auxiliaryChartRuntime.includes('text: "공포"'), "fear guide is missing");
assert.ok(auxiliaryChartRuntime.includes('text: "탐욕"'), "greed guide is missing");
assert.ok(auxiliaryChartRuntime.includes('text: "부정"'), "news sentiment negative guide is missing");
assert.ok(auxiliaryChartRuntime.includes('text: "긍정"'), "news sentiment positive guide is missing");
assert.ok(app.includes("CUSTOM_STOCK_PRELOAD_CONCURRENCY"), "custom stock preload concurrency guard is missing");
assert.ok(runtimeRefresh.includes("const criticalPromise") && runtimeRefresh.includes("const supplementalPromise"), "refresh phases do not start in parallel");
assert.ok(runtimeRefreshOrchestrator.includes("coreIndexTask")
  && runtimeRefreshOrchestrator.includes("preloadTask"),
"price refresh tasks still run serially");
assert.ok(!app.includes("ecos.bok.or.kr/api/") && !app.includes("kosis.kr/openapi/"),
  "ECOS or KOSIS is still called directly from the browser");
assert.ok(!app.includes("ecosApiKey") && !app.includes("kosisApiKey") && !app.includes("apiSettings."),
  "server-refreshed API keys must not remain in browser storage");
assert.ok(html.includes('id="dartGatewayTokenInput" type="password"')
  && !html.includes("dartProxyEnabledInput")
  && !html.includes("DART API 키"),
"only the private gateway access token may be requested in the browser");
assert.ok(deployWorkflow.includes("KOSIS_API_KEY: ${{ secrets.KOSIS_API_KEY }}")
  && buildPagesData.includes("fetch_kosis_leading_cycle")
  && providerContracts.includes("def kosis_rows("),
  "KOSIS server-side fallback is incomplete");
assert.ok(deployWorkflow.includes("KRX_API_KEY: ${{ secrets.KRX_API_KEY }}")
  && buildPagesData.includes("def fetch_krx_universe(")
  && app.includes("./data/krx_universe.json"),
  "KRX server-side universe is incomplete");
assert.ok(buildPagesData.includes("def fetch_dart_market_disclosures(")
  && app.includes("storage?.removeItem(API_SETTINGS_KEY)")
  && app.includes("sessionStorage?.removeItem(API_SETTINGS_SESSION_KEY)")
  && !app.includes("clearLegacyBrowserApiSettings")
  && !app.includes("opendart.fss.or.kr/api/"),
  "DART browser secret removal or market seed is incomplete");
assert.ok(app.includes("runtimeGatewayClient.fetchDisclosures(")
  && app.includes("runtimeGatewayClient.fetchInsiderTrades("),
"DART disclosures and insider trades do not share the runtime gateway client");
assert.ok(auxiliaryChartRuntime.includes('name: "공포탐욕"')
  && auxiliaryChartRuntime.includes("yaxis: panelLayout.axes.fearGreed"),
"fear-greed dynamic auxiliary panel is missing");
assert.ok(auxiliaryChartRuntime.includes("lastAdrRenderKey === renderKey"), "ADR render fast path is missing");
assert.ok(auxiliaryChartRuntime.includes("syncAuxiliaryRepresentativeToggles")
  && auxiliaryChartRuntime.includes("toggleAuxiliarySeries")
  && auxiliaryChartRuntime.includes("hiddenAuxiliarySeries"),
"auxiliary chart representative toggles are not wired");
assert.ok(chartPointerRuntime.includes(".legend, .modebar-container"),
  "chart drag handling can intercept auxiliary legend controls");
assert.ok(styles.includes(".auxiliary-representative-toggle")
  && styles.includes("cursor: pointer"),
"auxiliary chart controls do not expose a pointer cursor");
assert.ok(pagesEntry.includes('import "../docs/modules/app-state-controller.js"')
  && app.includes("ThinkStockAppStateController")
  && appStateController.includes("hiddenAuxiliarySeries: [...state.hiddenAuxiliarySeries]")
  && appStateController.includes("Array.isArray(persisted.hiddenAuxiliarySeries)"),
  "auxiliary chart visibility is not persisted");
assert.ok(pagesEntry.includes('import "../docs/modules/control-state-view.js"')
  && app.includes("ThinkStockControlStateView")
  && controlStateView.includes("function syncControl("),
  "common toggle and loading state view is not wired");
assert.ok(pagesEntry.includes('import "../docs/modules/cache-maintenance-runtime.js"')
  && app.includes("ThinkStockCacheMaintenanceRuntime")
  && cacheMaintenanceRuntime.includes("function createCacheMaintenanceRuntime("),
  "granular cache maintenance is not separated from app.js");
assert.ok(pagesEntry.includes('import "../docs/modules/runtime-snapshot-controller.js"')
  && app.includes("ThinkStockRuntimeSnapshotController")
  && runtimeSnapshotController.includes("function createRuntimeSnapshotController("),
  "runtime snapshot lifecycle is not separated from app.js");
assert.ok(pagesEntry.includes('import "../docs/modules/shared-request-registry.js"')
  && sharedRequestRegistry.includes("function createSharedRequestRegistry("),
  "shared runtime request deduplication is not loaded");
assert.ok(chartUpdateCoordinator.includes("function shouldUpdateAuxiliary(")
  && app.includes("chartUpdateCoordinatorModule.shouldUpdateAuxiliary"),
  "main-only chart updates still invalidate every auxiliary panel");
assert.ok(pagesEntry.includes('import "../docs/modules/chart-model-cache.js"')
  && app.includes("ThinkStockChartModelCache")
  && chartModelCache.includes("function createChartModelCache(")
  && chartModelCache.includes("function createSourceFingerprintCache(")
  && chartModelCache.includes('status: "coalesced"'),
  "recent chart compositions are not cached across visibility toggles");
assert.ok(chartLoader.includes("plotly-thinkstock-2.35.2.min.js"), "ThinkStock Plotly bundle is not configured");
assert.ok(plotlyBundle.size < 950_000, `ThinkStock Plotly bundle is too large: ${plotlyBundle.size} bytes`);
assert.ok(plotlyBuilder.includes("stats.hasErrors()") && plotlyBuilder.includes("process.exitCode = 1"),
  "Plotly vendor build does not fail closed");
assert.ok(plotlyBuilder.includes('createHash("sha256")')
  && plotlyBuilder.includes("reusableBundle(header)"),
  "Plotly vendor build does not reuse a fingerprinted bundle");
assert.ok(deployWorkflow.includes("npm run vendor:sync"),
  "deployment does not rebuild the custom Plotly bundle");
assert.ok(html.includes("./assets/app.bundle.min.js?v=dev"), "optimized app bundle is not loaded");
assert.equal([...html.matchAll(/<script\b/g)].length, 1, "runtime scripts are not bundled");
assert.ok(appBundle.size < APP_BUNDLE_MAX_BYTES, `initial app bundle is too large: ${appBundle.size} bytes`);
assert.ok(appBundleGzipBytes < APP_BUNDLE_GZIP_MAX_BYTES,
  `compressed initial app bundle is too large: ${appBundleGzipBytes} bytes`);
assert.ok(pagesEntry.includes('import "../docs/modules/chart-render-scheduler.js"')
  && chartRenderScheduler.includes("createChartRenderScheduler")
  && !app.includes("let renderChartRafId"),
"chart render scheduling is not separated from app.js");
assert.ok(pagesEntry.includes('import "../docs/modules/chart-session-controller.js"')
  && chartSessionState.includes("createChartSessionState")
  && app.includes("const chartSession = chartSessionStateModule.createChartSessionState"),
"chart viewport and visibility state are not centralized");
assert.ok(pagesEntry.includes('import "../docs/modules/chart-hover-runtime.js"')
  && chartHoverRuntime.includes("createChartHoverRuntime")
  && app.includes("chartHoverRuntimeModule.createChartHoverRuntime")
  && !app.includes("let pendingHoverSync"),
"chart hover synchronization is not separated from app.js");
assert.ok(pagesEntry.includes('import "../docs/modules/optional-feature-runtime.js"')
  && pagesEntry.includes('import "../docs/modules/stock-research-contract.js"')
  && pagesEntry.includes('import "../docs/modules/stock-research-app.js"')
  && optionalFeatureLoader.includes("loadFeature")
  && optionalFeatureRuntime.includes('loader.loadFeature("stock-research"')
  && optionalFeatureRuntime.includes('"./modules/stock-research-contract.js"')
  && optionalFeatureRuntime.includes('"./modules/stock-research-storage.js"')
  && optionalFeatureRuntime.includes('"./modules/stock-research-navigation.js"')
  && optionalFeatureRuntime.includes('"./modules/stock-research-filter.js"')
  && optionalFeatureRuntime.includes('"./modules/stock-research-history-cache.js"')
  && optionalFeatureRuntime.includes('"./modules/stock-research-worker-client.js"')
  && stockResearchContract.includes("CALCULATION_VERSION")
  && stockResearchContract.includes("CACHE_FORMAT_SCHEMA")
  && stockResearchApp.includes("createStockResearchApp")
  && stockResearchApp.includes("ThinkStockStockResearchContract")
  && stockResearchStorage.includes("loadBlocked")
  && stockResearchStorage.includes("calculationVersion")
  && stockResearchNavigation.includes("diffUniverseState")
  && stockResearchNavigation.includes("candidateSignalFingerprint")
  && stockResearchFilter.includes("candidateMatchesTodayFilter")
  && stockResearchHistoryCache.includes("mergeResearchHistoryPayload")
  && stockResearchWorkerClient.includes("createWorkerLane")
  && !pagesEntry.includes('import "../docs/modules/stock-research-controller.js"'),
"optional features are still part of the initial bundle");
assert.ok(pagesEntry.includes('import "../docs/modules/ai-forecast-cache.js"')
  && aiForecastCache.includes("matchesInput")
  && app.includes("TICKER_AI_FORECAST_CACHE_STORE_NAME"),
"AI input-fingerprint cache is incomplete");
assert.ok(!pagesEntry.includes('import "../docs/modules/ai-forecast-quality-runtime.js"')
  && optionalFeatureRuntime.includes('"./modules/ai-forecast-quality-runtime.js"')
  && app.includes("ThinkStockAiForecastQualityRuntime")
  && aiForecastQualityRuntime.includes("function createAiForecastQualityRuntime(")
  && !app.includes("aiForecastCalibrationPoolPromise"),
"AI forecast journal and quality orchestration is not separated from app.js");
assert.equal(packageJson.scripts?.["backtest:ai:verify"],
  "node scripts/run_ai_walkforward_validation.mjs",
  "AI walk-forward regression guard is not wired to one command");
assert.ok(app.includes('const MAIN_LINE_TRACE_TYPE = "scatter";'), "main chart is not using the SVG scatter path");
assert.ok(app.includes("MAIN_CHART_TOTAL_VISIBLE_POINT_TARGET_MOBILE"), "adaptive mobile chart budget is missing");
assert.ok(app.includes("const plotlyReadyTask = ensurePlotlyReady()"), "Plotly is not prepared in parallel during boot");
assert.ok(mainChartRenderer.includes("function buildCursorHoverMode")
  && mainChartRenderer.includes("if (!hoverShowPopup) return false;")
  && mainChartRenderer.includes("hovermode: buildCursorHoverMode(hoverShowPopup, cursorLineMode)"),
"disabled hover still runs Plotly hit testing");
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
assert.ok(app.includes("ThinkStockDeferredDiagnostics")
  && deferredDiagnostics.includes("createDeferredDiagnostics")
  && performanceDiagnostics.includes("createPerformanceDiagnostics")
  && performanceDiagnostics.includes("readStorageState"),
  "persistent performance diagnostics are incomplete");
assert.ok(performanceDiagnostics.includes("startAutomaticCapture")
  && deferredDiagnostics.includes("scheduleAutomaticCapture")
  && performanceMonitor.includes("diagnosticSamples"),
  "automatic local performance history is incomplete");
assert.ok(!pagesEntry.includes('import "../docs/modules/performance-diagnostics.js"')
  && pagesEntry.includes('import "../docs/modules/deferred-diagnostics.js"'),
  "performance diagnostics must stay out of the initial bundle");
assert.ok(sw.includes('"/modules/performance-diagnostics.js"')
  && !precacheAssetsSource.includes("./modules/performance-diagnostics.js"),
  "deferred performance diagnostics cache policy is incorrect");
assert.ok(app.includes("ThinkStockDataHealth")
  && dataHealth.includes("buildFreshnessItems")
  && dataHealth.includes("detectRecentChanges"),
  "shared data health checks are incomplete");
assert.ok(!app.includes("function dateSpanForRows(") && !app.includes("function daysSinceDate("),
  "data health logic still lives in app.js");
assert.ok(app.includes("ThinkStockAppUiBindings")
  && appUiBindings.includes("bindManualRefresh")
  && appUiBindings.includes("bindChartRangeControls"),
  "boot UI event bindings are not separated from app.js");
assert.ok(app.includes("ThinkStockSettingsPanelRuntime")
  && app.includes("ThinkStockApiPeriods")
  && pagesEntry.includes('import "../docs/modules/api-periods.js"')
  && pagesEntry.includes('import "../docs/modules/settings-panel-runtime.js"')
  && apiPeriods.includes("createReminderStore")
  && apiPeriods.includes("파생상품지수 시세정보")
  && settingsPanelRuntime.includes("createSettingsPanelRuntime")
  && !app.includes("const syncAppCacheButton = async"),
"settings panel event binding is not separated from app.js");
assert.ok(app.includes("ThinkStockRuntimeSnapshotPolicy")
  && runtimeSnapshotPolicy.includes("createRevisionTracker")
  && runtimeSnapshotPolicy.includes("isSnapshotUsable")
  && runtimeSnapshotPolicy.includes("hasCoreHistoricalCoverage"),
  "runtime snapshot policy module is incomplete");
assert.ok(performanceMonitor.includes("gap < frameGapIgnoreMs"), "suspended tabs still pollute frame timing diagnostics");
assert.ok(performanceMonitor.includes('observe({ type: "longtask", buffered: true })'),
  "browser long-task diagnostics are missing");
assert.ok(!app.includes("let perfSamples") && !app.includes("function startPerfFrameMonitor("), "performance diagnostics still live in app.js");
assert.ok(app.includes("ThinkStockAppStorage"), "app storage module is not wired into the app");
assert.ok(appStorage.includes("createApiSettingsStore")
  && appStorage.includes("createIndexedCacheStore")
  && appStorage.includes("createJsonStore"), "app storage module is incomplete");
assert.ok(!app.includes("function openRuntimeCacheDb(") && !app.includes("function sanitizeApiSettings("), "storage implementation still lives in app.js");
assert.ok(app.includes("ThinkStockCacheMigrations")
  && pagesEntry.includes('import "../docs/modules/cache-migrations.js"')
  && cacheMigrations.includes("copyFirstAvailable")
  && app.includes("cacheMigrator.run();"),
"cache migration flow is incomplete");
assert.ok(app.includes("ThinkStockStartupLoader"), "startup loader module is not wired into the app");
assert.ok(startupLoader.includes("createStartupLoader") && startupLoader.includes("requestAnimationFrame"), "startup loader module is incomplete");
assert.ok(!app.includes("function ensureStartupLoader(") && !app.includes("startupLoaderDisplayProgress"), "startup loader implementation still lives in app.js");
assert.ok(app.includes("ThinkStockRuntimeDataApp")
  && pagesEntry.includes('import "../docs/modules/runtime-data-app.js"')
  && runtimeDataApp.includes("refreshController.abort")
  && runtimeDataApp.includes("prepareInitialData")
  && !app.includes("let runtimeRefreshController"),
"runtime data orchestration or superseded refresh cancellation is incomplete");
assert.ok(app.includes("ThinkStockRuntimeSourceHealth")
  && pagesEntry.includes('import "../docs/modules/runtime-source-health.js"')
  && runtimeSourceHealth.includes("createRuntimeSourceHealth")
  && runtimeRefreshOrchestrator.includes("canAttemptSource"),
"persistent runtime source recovery is incomplete");
assert.ok(app.includes("ThinkStockRuntimeBootstrap")
  && pagesEntry.includes('import "../docs/modules/runtime-bootstrap.js"')
  && runtimeBootstrap.includes("fetchLatestPriceSeriesBatch")
  && runtimeBootstrap.includes("fetchCritical"),
"runtime bootstrap batching is not separated from app.js");
assert.ok(!app.includes("function cancelStaleChartModelWorkerRequest()")
  && chartModelWorkerClient.includes("active.superseded")
  && chartModelWorkerClient.includes("request.resolve(null)"),
"chart worker does not use persistent latest-wins scheduling");
assert.ok(app.includes("ThinkStockChartPointerRuntime")
  && pagesEntry.includes('import "../docs/modules/chart-pointer-runtime.js"')
  && chartPointerRuntime.includes("getChartInteractionGeometry(sourceEl)"),
"pointer geometry is not shared per frame");
assert.ok(app.includes("buildRenderViewportPlan")
  && pagesEntry.includes('import "../docs/modules/chart-viewport-controller.js"')
  && chartViewportController.includes("function buildRenderViewportPlan"),
"main chart viewport planning is not separated from renderChart");
assert.ok(app.includes("ThinkStockChartMarkerRuntime")
  && pagesEntry.includes('import "../docs/modules/chart-marker-runtime.js"')
  && chartMarkerRuntime.includes("createFrame")
  && chartMarkerRuntime.includes("buildDisclosure")
  && chartMarkerRuntime.includes("buildInsider"),
"chart marker rendering is not separated or sharing one frame");
assert.ok(app.includes("bindPointerDrag")
  && chartInteractionController.includes('addEventListener("pointermove"')
  && chartInteractionController.includes("getCoalescedEvents"),
  "chart input is not using the unified pointer pipeline");
assert.ok(!`${app}\n${chartPointerRuntime}`.includes('addEventListener("touchmove"')
  && !`${app}\n${chartPointerRuntime}`.includes('addEventListener("mousedown"'),
  "legacy chart input listeners remain");
assert.ok(app.includes("function applyDisclosureStateFast("), "disclosure-only updates still require a full chart render");
assert.ok(app.includes("function applyMainChartRender(") && app.includes("mainChartPartialUpdateCount"),
  "main chart partial update fast path is missing");
assert.ok(app.includes("ThinkStockMainChartRenderer")
  && mainChartRenderer.includes("await plotly.update(")
  && mainChartRenderer.includes("relayoutPayload(layout)")
  && mainChartRenderer.includes("buildLineTraces")
  && mainChartRenderer.includes("buildLayout"),
  "main chart renderer module is incomplete");
assert.ok(app.includes("ThinkStockMainChartEvents")
  && pagesEntry.includes('import "../docs/modules/main-chart-events.js"')
  && mainChartEvents.includes("createMainChartEvents")
  && mainChartEvents.includes('element.on("plotly_relayout"'),
"main chart event binding is not separated from app.js");
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
assert.ok(sw.includes('url.pathname.includes("/api/")'),
  "local API requests must bypass the service worker cache");
assert.ok(!sw.includes(".map((req) => cache.delete(req))"), "service worker still deletes data before refresh");
assert.ok(playwrightConfig.includes('name: "webkit-sw"') && playwrightConfig.includes('serviceWorkers: "allow"'),
  "service-worker-aware WebKit coverage is missing");
assert.ok(playwrightConfig.includes('name: "webkit"')
  && deployWorkflow.includes("target: mobile")
  && deployWorkflow.includes("target: desktop")
  && deployWorkflow.includes("run_webkit_scope.mjs ${{ matrix.target }} ${{ inputs.verification_scope }}")
  && webkitScopeRunner.includes('mode === "desktop"')
  && webkitScopeRunner.includes('args.push("--project=webkit-desktop")')
  && webkitScopeRunner.includes('args.push("--project=webkit")'),
  "iPhone WebKit is not covered by deployment validation");
assert.ok(deployWorkflow.indexOf("npm ci") < deployWorkflow.indexOf("npm run test:unit:built"),
  "Node dependencies must be installed before web validation");
assert.equal((deployWorkflow.match(/npm run build:web/g) || []).length, 1,
  "deployment must build the web app exactly once");
assert.ok(deployWorkflow.includes("needs: build-web-artifact")
  && deployWorkflow.includes("needs: [build-web-artifact, prepare-data]")
  && (deployWorkflow.match(/name: thinkstock-pages-shell/g) || []).length >= 3,
"validation jobs must reuse the single built web artifact");
assert.ok(packageJson.scripts?.["test:unit:built"]
  && packageJson.scripts?.["test:webkit:mobile:built"]
  && packageJson.scripts?.["test:webkit:desktop:built"]
  && packageJson.scripts?.["test:webkit:sw:built"],
"prebuilt validation commands are incomplete");
assert.ok(deployWorkflow.includes("actions/checkout@v6")
  && deployWorkflow.includes("actions/cache@v5")
  && deployWorkflow.includes("actions/setup-python@v6")
  && deployWorkflow.includes("actions/configure-pages@v6")
  && deployWorkflow.includes("actions/upload-pages-artifact@v5")
  && deployWorkflow.includes("actions/deploy-pages@v5"),
  "GitHub Actions are not on the Node 24 compatible majors");
assert.ok(deployWorkflow.includes("--requirement requirements-pages.txt"),
  "Pages build dependencies are not installed from the lock file");
assert.ok(!deployWorkflow.includes("DART_API_KEY:")
  && deployWorkflow.includes('PAGES_FULL_REBUILD: "0"'),
"scheduled Pages builds must not perform full-market DART refreshes");
assert.ok(deployWorkflow.includes('cache: "pip"'), "Python dependency caching is missing");
assert.ok(deployWorkflow.includes("Publish Data Build Health"), "Pages data health summary is missing");
assert.ok(!deployWorkflow.includes("validate-web:")
  && deployWorkflow.includes("Validate Built Web App")
  && deployWorkflow.includes("validate-webkit:")
  && deployWorkflow.includes("build-web-artifact:")
  && deployWorkflow.includes("prepare-data:")
  && deployWorkflow.includes("assemble-artifact:")
  && deployWorkflow.includes("needs: [build-web-artifact, validate-webkit, assemble-artifact]")
  && deployWorkflow.includes("always() && needs.build-web-artifact.result == 'success'")
  && deployWorkflow.includes("needs.validate-webkit.result == 'success'")
  && deployWorkflow.includes("needs.assemble-artifact.result == 'success'"),
  "parallel validation and artifact preparation must all gate deployment");
assert.ok(deployWorkflow.includes("refresh_data:")
  && deployWorkflow.includes("if: ${{ inputs.refresh_data }}")
  && deployWorkflow.includes("name: thinkstock-pages-data")
  && deployWorkflow.includes("actions/download-artifact@v8")
  && deployWorkflow.includes("actions/upload-artifact@v7"),
  "UI deployment must reuse bundled data unless an explicit data refresh is requested");
assert.ok(deployWorkflow.includes("Prepare Pages Artifact")
  && deployWorkflow.includes("path: ./.pages-artifact"),
  "slim Pages artifact staging is missing");
assert.ok(deployWorkflow.includes("Prepare Data-Free Pages Shell")
  && deployWorkflow.includes("path: pages-shell")
  && pagesShellBuilder.includes('ignore=shutil.ignore_patterns("data")'),
"UI build artifact still duplicates the immutable Pages data bundle");
assert.ok(deployWorkflow.includes("verify-public:")
  && deployWorkflow.includes("always() && needs.deploy.result == 'success'")
  && deployWorkflow.includes("Verify Public Pages Release")
  && publicDeploymentVerifier.includes("verifyPagesDeployment")
  && publicDeploymentVerifier.includes("public app bundle does not match the release"),
"public deployment verification is incomplete");
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
assert.ok(buildPagesData.includes("from provider_sources import")
  && providerSources.includes("def fetch_ecos_leading_cycle(")
  && providerSources.includes("def fetch_krx_universe("),
  "external data provider sources are not separated from the payload builder");
assert.ok(buildPagesData.includes("from disclosure_processing import")
  && disclosureProcessing.includes("def normalize_disclosure_records(")
  && buildPagesData.includes("from credit_processing import")
  && creditProcessing.includes("def merge_credit_seed_with_incremental_tail(")
  && buildPagesData.includes("from payload_output import")
  && payloadOutput.includes("def write_columnar_payload_or_keep("),
  "disclosure processing or payload output is not separated from the builder");
assert.ok(buildReporting.includes("detect_output_anomalies")
  && buildReporting.includes("series_latest_values"),
  "cross-build output anomaly reporting is incomplete");
assert.ok(providerClients.includes('"beginBasDt"') && providerClients.includes("stopped_early"),
  "KOFIA incremental pagination is incomplete");
assert.ok(workerIndex.includes('from "./kofia-client.mjs"')
  && kofiaClient.includes("createKofiaClient")
  && kofiaClient.includes("mergeAvailableSources")
  && kofiaClient.includes("fetchKofiaCreditAndDepositRows"),
"Worker KOFIA parsing and fallback are not separated from the request router");
assert.ok(sourcePipeline.includes("class SourcePipeline") && buildPagesData.includes("pipeline.run("),
  "provider source pipeline is not wired into the builder");
assert.ok(buildReporting.includes("BUILD_HISTORY_LIMIT = 20") && buildReporting.includes("summarize_build_trend"),
  "build health history is incomplete");

const publicAdminSources = `${app}\n${settingsPanelRuntime}\n${adminFeatureAccess}\n${appBundle}`;
assert.ok(!/ADMIN_ACCESS_HASH|expectedHash/.test(publicAdminSources),
  "public browser code must not contain an administrator hash");
assert.ok(!/[\"'][a-f0-9]{64}[\"']/i.test(publicAdminSources),
  "public browser code contains a hard-coded SHA-256 value");
assert.ok(!/(?:ADMIN|MANAGER)[A-Z0-9_]*\s*=\s*[\"']\d{10}[\"']/i.test(publicAdminSources),
  "public browser code contains a hard-coded administrator code");
assert.ok(adminFeatureAccess.includes("requestSession")
  && adminFeatureAccess.includes("sessionToken")
  && adminFeatureAccess.includes("deviceId")
  && !adminFeatureAccess.includes('subtle.digest("SHA-256"'),
"administrator access must use a server-issued, device-bound session");
assert.ok(workerRouter.includes('path: "/api/admin/session"')
  && workerIndex.includes("adminSessionResponse")
  && adminSessionHandler.includes("verifyAdminSession")
  && adminSession.includes('const TOKEN_VERSION = "v1"')
  && adminSession.includes('name: "HMAC"'),
"Cloudflare administrator session routing or signing is incomplete");
[
  "THINKSTOCK_ADMIN_CODE",
  "THINKSTOCK_ADMIN_SESSION_SECRET",
].forEach((secretName) => {
  assert.ok(workerConfig.includes(`\"${secretName}\"`), `Worker secret is not declared: ${secretName}`);
});
assert.ok(!/\"(?:THINKSTOCK_ADMIN_CODE|THINKSTOCK_ADMIN_SESSION_SECRET)\"\s*:\s*\"[^\"]+\"/.test(workerConfig),
  "Worker administrator secret values must not be committed");
assert.ok(!/THINKSTOCK_LEGACY_ADMIN_HASH|THINKSTOCK_ADMIN_MIGRATION_UNTIL/.test(
  `${app}\n${adminFeatureAccess}\n${adminSessionHandler}\n${workerConfig}`,
), "retired administrator migration secrets remain in the active product");
assert.ok(!/request\([\"']migrate[\"']|action\s*===\s*[\"']migrate[\"']/.test(
  `${adminFeatureAccess}\n${adminSessionHandler}`,
), "retired administrator migration requests remain active");

console.log(`Pages app validation passed (version ${appVersion}, ${ids.length} unique IDs).`);
