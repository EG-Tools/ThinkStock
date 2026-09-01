import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { stylesheetSourceNames } from "./pages-stylesheet-config.mjs";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, sw, playwrightConfig, dataPayload, marketData, chartInteractionMath, chartInteractionController, cacheRefreshPolicy, browserMarketClient, auxiliaryChartModel, mainChartRenderer, performanceMonitor, performanceDiagnostics, appUiBindings, runtimeSnapshotPolicy, appStorage, dataWorker, chartModelWorker, chartModelWorkerRuntime, chartLoader, disclosurePolicy, disclosurePopover, serviceWorkerClient, runtimeRefresh, dataSeedLoader, deployWorkflow, plotlyBuilder, buildPagesData, dataBuildSupport, providerClients, providerContracts, providerSources, creditProcessing, disclosureProcessing, payloadOutput, sourcePipeline, buildReporting, plotlyBundle, appBundle] = await Promise.all([
  readFile(path.join(root, "docs", "app.js"), "utf8"),
  readFile(path.join(root, "docs", "index.html"), "utf8"),
  readFile(path.join(root, "docs", "sw.js"), "utf8"),
  readFile(path.join(root, "playwright.config.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-payload.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "market-data.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-interaction-math.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-interaction-controller.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "cache-refresh-policy.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "browser-market-client.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "auxiliary-chart-model.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "main-chart-renderer.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "performance-monitor.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "performance-diagnostics.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-ui-bindings.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-snapshot-controller.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-storage.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-worker.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-worker.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-worker-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-loader.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-policy.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-popover.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "service-worker-client.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-refresh-orchestrator.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-seed-loader.mjs"), "utf8"),
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
const [dataHealth, pagesEntry, styles, insiderTrades, workerIndex, workerRouter, workerDartHandler, kofiaClient, marketTimingService, marketTimingWorker, aiScenarioPaths, aiForecastWorker, optionalFeatureRuntime, stockResearchApp, aiForecastCache, aiForecastQualityRuntime, chartModelCache, chartPointerRuntime, chartHoverRuntime, chartMarkerRuntime, auxiliaryChartRuntime, mainChartEvents, apiPeriods, settingsPanelRuntime, aiForecastTraces, runtimeRefreshOrchestrator, progressView, mainChartModel, chartEventLayer] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "data-health.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "pages-entry.mjs"), "utf8"),
  readFile(path.join(root, "docs", "styles.css"), "utf8"),
  readFile(path.join(root, "docs", "modules", "insider-trades.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "index.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "request-router.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "dart-handler.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "kofia-client.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "market-timing-service.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "market-timing-worker.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-scenario-paths.js"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "ai-forecast-worker.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "optional-feature-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-app.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-forecast-cache.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-forecast-quality-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-cache.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-pointer-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-hover-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-marker-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "auxiliary-chart-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "main-chart-events.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "api-periods.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "settings-panel-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "ai-forecast-traces.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-refresh-orchestrator.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "control-state-view.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "main-chart-model.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-event-layer.mjs"), "utf8"),
]);
const optionalFeatureLoader = optionalFeatureRuntime;
const tickerPriceAppRuntime = await readFile(
  path.join(root, "docs", "modules", "ticker-price-app-runtime.mjs"),
  "utf8",
);
const tickerPriceRuntime = await readFile(
  path.join(root, "docs", "modules", "ticker-price-runtime.mjs"),
  "utf8",
);
const tickerCacheInvalidation = await readFile(
  path.join(root, "docs", "modules", "ticker-cache-invalidation.mjs"),
  "utf8",
);
const taskProgressRuntime = await readFile(
  path.join(root, "docs", "modules", "task-progress-runtime.mjs"),
  "utf8",
);
const stockResearchWorkerRuntime = await readFile(
  path.join(root, "docs", "modules", "stock-research-worker-runtime.mjs"),
  "utf8",
);
const marketTiming = await readFile(
  path.join(root, "docs", "modules", "market-timing.mjs"),
  "utf8",
);
const marketTimingEvaluation = await readFile(
  path.join(root, "docs", "modules", "market-timing-evaluation.mjs"),
  "utf8",
);
const dartFeatureEntry = await readFile(
  path.join(root, "scripts", "feature-entries", "dart-feature.mjs"),
  "utf8",
);
const chartRenderContract = await readFile(
  path.join(root, "docs", "modules", "chart-render-contract.mjs"),
  "utf8",
);
const applicationLifecycleRuntime = await readFile(
  path.join(root, "docs", "modules", "app-bootstrap-orchestrator.mjs"),
  "utf8",
);
const [aiForecastApp, brokerResearchRuntime, runtimeDataApp, stockResearchContract, stockResearchStorage, stockResearchNavigation, stockResearchFilter, stockResearchHistoryCache, stockResearchWorkerClient, runtimeMarketRefresh, appStateController, controlStateView, dataFreshnessController, cacheMaintenanceRuntime, runtimeSnapshotController, sharedRequestRegistry, chartUpdateCoordinator, webkitScopeRunner] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "ai-forecast-app.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "broker-research-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-data-app.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-contract.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-storage.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-navigation.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-filter.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-history-cache.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "stock-research-worker-client.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-market-refresh.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-state-controller.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "control-state-view.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "data-freshness-controller.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "cache-maintenance-runtime.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-snapshot-controller.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "shared-request-registry.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-update-coordinator.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "run_webkit_scope.mjs"), "utf8"),
]);
const [packageJsonSource, publicDeploymentVerifier, chartViewportController, chartSessionState, chartSessionController, chartModelWorkerClient, runtimeDataTransaction, runtimeSourceHealth, pagesShellBuilder, vkospiDataSource] = await Promise.all([
  readFile(path.join(root, "package.json"), "utf8"),
  readFile(path.join(root, "scripts", "verify_pages_deployment.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-viewport-controller.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-session-controller.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-session-controller.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-model-worker-client.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-data-transaction.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "runtime-source-health.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "prepare_pages_shell.py"), "utf8"),
  readFile(path.join(root, "docs", "data", "vkospi_data.json"), "utf8"),
]);
const [adminFeatureAccess, adminSessionHandler, adminSession, workerConfig] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "admin-feature-access.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "admin-session-handler.mjs"), "utf8"),
  readFile(path.join(root, "worker", "src", "admin-session.mjs"), "utf8"),
  readFile(path.join(root, "worker", "wrangler.jsonc"), "utf8"),
]);
const [analyticsCoreFeatureEntry, aiFeatureEntry, auxiliaryChartFeatureEntry, brokerResearchFeatureEntry, dataFreshnessFeatureEntry, diagnosticsRuntimeFeatureEntry, epsFeatureEntry, marketTimingFeatureEntry, settingsFeatureEntry, stockResearchFeatureEntry, stockResearchWorkerEntry] = await Promise.all([
  readFile(path.join(root, "scripts", "feature-entries", "analytics-core-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "ai-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "auxiliary-chart-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "broker-research-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "data-freshness-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "diagnostics-runtime-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "eps-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "market-timing-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "settings-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "stock-research-feature.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "feature-entries", "stock-research-worker.mjs"), "utf8"),
]);
const [appBootstrapOrchestrator, appControlConfig, buildPagesBundle, ...stylesheetSources] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "app-bootstrap-orchestrator.mjs"), "utf8"),
  readFile(path.join(root, "docs", "modules", "app-control-config.mjs"), "utf8"),
  readFile(path.join(root, "scripts", "build_pages_bundle.mjs"), "utf8"),
  ...stylesheetSourceNames.map((name) => (
    readFile(path.join(root, "docs", "styles-src", name), "utf8")
  )),
]);
const packageJson = JSON.parse(packageJsonSource);
const vkospiData = JSON.parse(vkospiDataSource);
const appBundleGzipBytes = gzipSync(
  await readFile(path.join(root, "docs", "assets", "app.bundle.min.js")),
  { level: 9 },
).byteLength;
// Keep validation aligned with the build ceiling so one accepted bundle cannot
// fail later only because the two release gates use different byte limits.
const APP_SOURCE_MAX_LINES = 8_200;
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
assert.equal(
  styles.trimEnd(),
  stylesheetSources.map((source) => source.trimEnd()).join("\n\n"),
  "generated styles.css is out of sync with its role-based sources",
);
assert.ok(buildPagesBundle.includes('from "./pages-stylesheet-config.mjs"')
  && buildPagesBundle.includes("buildStylesheet()"),
"role-based stylesheet sources are not wired into the web build");
assert.ok(
  app.includes('from "./modules/app-bootstrap-orchestrator.mjs"')
    && app.includes('from "./modules/app-control-config.mjs"')
    && app.includes("createChartApplicationControlConfig({")
    && app.includes("createAppBootstrapOrchestrator({")
    && app.includes("createLazyRuntimeRegistry")
    && app.includes("const startupTaskRuntime = createStartupTaskRuntime({")
    && app.includes("waitForStartupVisualReady: startupTaskRuntime.whenReleased")
    && !app.includes("scheduleSupplementalTask: startupTaskRuntime.scheduleSupplemental")
    && !app.includes("async function boot()"),
  "app startup and control wiring are not using the standard module boundary",
);
assert.ok(appBootstrapOrchestrator.includes("createAppBootstrapOrchestrator")
  && appBootstrapOrchestrator.includes("createStartupLoader")
  && appBootstrapOrchestrator.includes("createLazyRuntimeRegistry")
  && !appBootstrapOrchestrator.includes("requireAppModule")
  && appControlConfig.includes("createChartApplicationControlConfig")
  && app.includes("appRuntimeRegistry"),
"standard application orchestration modules are incomplete");
assert.ok(
  app.includes("shouldHydrateChartData(invalidation)")
    && !app.includes("queueInsiderTradeRefresh")
    && app.includes("restoreDart: restoreVisibleDartLayers")
    && app.includes("if (shouldHydrateChartData) scheduleVisibleEpsData()")
    && app.includes("prepareEventModels: shouldHydrateChartData ? prepareMarketTimingModels : null"),
  "viewport-only chart updates must not restart DART or EPS data hydration",
);
assert.ok(
  appControlConfig.includes("export const MAX_VISIBLE_MAIN_SERIES = 10;")
    && app.includes("MAX_VISIBLE_MAIN_SERIES"),
  "main chart series limit must remain ten",
);
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
  && html.includes("chart-progress signal-progress")
  && html.includes("ui-progress-track chart-progress-track")
  && html.includes('class="ui-progress-fill"')
  && styles.includes(".ui-progress-fill")
  && styles.includes("--chart-ui-progress-fill"),
"AI and DART progress components do not share one visual system");
assert.ok(app.includes('from "./modules/task-progress-runtime.mjs"')
  && app.includes("createTaskProgress")
  && taskProgressRuntime.includes('from "./control-state-view.mjs"')
  && taskProgressRuntime.includes("createProgressView")
  && taskProgressRuntime.includes("createDisclosureProgress")
  && aiForecastApp.includes("options.createProgressView")
  && progressView.includes("createProgressView"),
"AI and DART progress behavior does not share one DOM view");
assert.ok(html.includes("chart-toggle reset-btn")
  && html.includes("chart-toggle hover-toggle-btn")
  && styles.includes(".chart-toggle.is-active"),
"chart toggle components do not share one state style");
assert.ok(html.includes("ui-fade-message chart-help-message runtime-refresh-status")
  && html.includes("ui-fade-message chart-help-message chart-navigation-message")
  && styles.includes(".ui-fade-message.is-fading")
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
  "signalProgress",
  "signalProgressText",
  "signalProgressBar",
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
  "releaseNotesSize",
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
assert.ok(dartFeatureEntry.includes('from "../../docs/modules/insider-trades.mjs"')
  && app.includes("DART_GATEWAY_INSIDER_ENDPOINT")
  && app.includes("buildInsiderMarkerTraces")
  && app.includes("showInsiderTrades"),
"insider trade UI and chart integration is incomplete");
assert.ok(insiderTrades.includes('const BUY_MARKER_TEXT = "▲"')
  && insiderTrades.includes('const SELL_MARKER_TEXT = "▼"')
  && insiderTrades.includes('const BUY_COLOR = "#b91c1c"')
  && insiderTrades.includes('const SELL_COLOR = "#1d4ed8"'),
"insider buy/sell marker styling is incomplete");
assert.ok(!/(^|\n)\.cartesianlayer \.point \{ display: none !important; \}/.test(styles)
  && !/(^|\n)\.cartesianlayer \.textpoint \{[^}]*display:\s*none/i.test(styles)
  && styles.includes(".chart-frame-adr .cartesianlayer .point { display: none !important; }"),
"global marker hiding must not suppress insider trade triangles");
assert.ok(workerDartHandler.includes("DART_ELESTOCK_URL")
  && workerIndex.includes('"insider-trades":')
  && workerIndex.includes("dispatchRequestRoute(route, ROUTE_HANDLERS")
  && workerRouter.includes('path: "/api/dart/insider-trades"')
  && workerDartHandler.includes("LOOKBACK_YEARS")
  && workerDartHandler.includes("`insider:${ticker}`"),
"DART insider trade gateway or three-year cache policy is incomplete");

[
  "./index.html",
  "./styles.css",
  "./assets/app.bundle.min.js?v=dev",
  "./modules/data-payload.mjs?v=dev",
  "./modules/market-data.mjs?v=dev",
  "./modules/chart-adjustments.mjs?v=dev",
  "./modules/auxiliary-chart-contract.mjs?v=dev",
  "./modules/chart-display-sampler.mjs?v=dev",
  "./modules/main-chart-model.mjs?v=dev",
  "./modules/cache-refresh-policy.js?v=dev",
  "./modules/auxiliary-chart-model.mjs?v=dev",
  "./modules/data-worker.mjs?v=dev",
  "./modules/chart-model-worker.mjs?v=dev",
  "./modules/chart-model-worker-runtime.mjs?v=dev",
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
  "./assets/stock-research-worker.bundle.min.js",
  "./assets/market-timing-worker.bundle.min.js",
  "./assets/ai-forecast-worker.bundle.min.js",
].forEach((asset) => {
  assert.ok(!precacheAssetsSource.includes(`"${asset}?v=dev"`), `optional worker must load on demand: ${asset}`);
  assert.ok(sw.includes(`"${asset.slice(1)}"`), `optional worker is not version-cacheable: ${asset}`);
});
assert.ok(!precacheAssetsSource.includes('"./data/ai_market_model.json"'),
  "AI market model must load on demand");
assert.ok(aiForecastWorker.includes("globalThis.onmessage")
  && marketTimingWorker.includes("globalThis.onmessage")
  && !aiForecastWorker.includes("importScripts(")
  && !marketTimingWorker.includes("importScripts(")
  && buildPagesBundle.includes('entry: "ai-forecast-worker.mjs"')
  && buildPagesBundle.includes('output: "ai-forecast-worker.bundle.min.js"')
  && buildPagesBundle.includes('entry: "market-timing-worker.mjs"')
  && buildPagesBundle.includes('output: "market-timing-worker.bundle.min.js"'),
"optional workers do not use one bundled dependency graph");

assert.ok(app.includes("function isDirectEventMarkerTap")
  && chartMarkerRuntime.includes("isDirectlyInteractiveEventMarkerTrace"),
"iPhone event-marker tap guard is missing");
  assert.ok(app.includes('from "./modules/disclosure-policy.mjs"'), "disclosure policy module is not wired into the app");
assert.ok(dartFeatureEntry.includes('from "../../docs/modules/disclosure-popover.mjs"')
  && optionalFeatureRuntime.includes("ensureDart"),
"disclosure popover module is not wired into the app");
assert.ok(disclosurePopover.includes("createDisclosurePopover"), "disclosure popover module is incomplete");
assert.ok(insiderTrades.includes('from "./chart-render-contract.mjs"')
  && !insiderTrades.includes("chart-marker-runtime.mjs")
  && !disclosurePopover.includes("task-progress-runtime.mjs")
  && chartRenderContract.includes("buildEventMarkerTextFont"),
"deferred DART bundle duplicates shared chart marker or progress runtimes");
assert.ok(!app.includes("function ensureDisclosurePopover("), "disclosure popover implementation still lives in app.js");
  assert.ok(app.includes('from "./modules/service-worker-client.mjs"'), "service worker client module is not wired into the app");
assert.ok(serviceWorkerClient.includes("createServiceWorkerClient"), "service worker client module is incomplete");
assert.ok(app.includes('from "./modules/runtime-refresh-orchestrator.mjs"'), "runtime refresh module is not wired into the app");
assert.ok(runtimeRefresh.includes("runRefreshPhases"), "runtime refresh phase runner is incomplete");
assert.ok(app.includes('from "./modules/runtime-refresh-orchestrator.mjs"')
  && runtimeRefreshOrchestrator.includes("createRuntimeRefreshOrchestrator")
  && runtimeRefreshOrchestrator.includes("planRuntimeRefreshRendering"),
"runtime refresh orchestration is not separated from app.js");
assert.ok(app.includes('from "./modules/data-seed-loader.mjs"'), "data seed loader module is not wired into the app");
assert.ok(dataSeedLoader.includes("fetchSegmentedSeedText"), "data seed loader module is incomplete");
assert.ok(dataSeedLoader.includes("fetchDataManifest") && dataSeedLoader.includes("manifestSegmentPath"),
  "segmented data manifest is not consumed by the app");
assert.ok(!app.includes("async function fetchSeedText("), "seed network loading still lives in app.js");
assert.ok(runtimeRefreshOrchestrator.includes("planCriticalRefresh({")
  && runtimeRefreshOrchestrator.includes("...(refreshIndices ? [criticalTask(\"indices\", coreIndexTask)] : [])")
  && runtimeRefreshOrchestrator.includes("...(refreshVisiblePrices ? [criticalTask(\"prices-visible\", preloadTask)] : [])")
  && runtimeRefreshOrchestrator.includes("startSupplementalAfterCritical: true"),
"critical startup refresh is not planned before supplemental inputs");
assert.ok(runtimeRefreshOrchestrator.includes("supplementalTasks: foregroundSourceTasks.map")
  && runtimeRefreshOrchestrator.includes("shouldScheduleHiddenStockRefresh(options)")
  && !runtimeRefreshOrchestrator.includes("hiddenPriceTask,")
  && app.includes("initialLoad = await ensureCustomTickerSeriesLoaded(key, {")
  && app.includes("latestOnly: hasPriceData,")
  && app.includes("requireFullHistory: !hasPriceData,")
  && app.includes("returnAfterCache: !pricePlan.shouldRefresh,"),
"hidden stock prices are not deferred until the stock becomes visible");
assert.ok(runtimeRefreshOrchestrator.includes('reportCriticalProgress("chart", 96)')
  && runtimeDataApp.includes("onCriticalProgress: flow.onCriticalProgress"),
"startup progress does not follow critical refresh completion");
assert.ok(runtimeDataApp.includes("deferSupplementalUntilReady: true")
  && runtimeRefreshOrchestrator.includes("beforeSupplemental:")
  && runtimeRefreshOrchestrator.includes("waitForStartupVisualReady")
  && app.includes("waitForStartupVisualReady: startupTaskRuntime.whenReleased")
  && !/createTaskKey\(\s*"startup-supplemental"/.test(appBootstrapOrchestrator),
"startup supplemental refreshes must begin after one shared visual-ready boundary");
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
assert.ok(app.includes("dataPayloadModule"), "data payload module is not wired into the app");
assert.ok(app.includes('from "./modules/optional-feature-runtime.mjs"')
  && !optionalFeatureRuntime.includes("ThinkStockOptionalFeatureRuntime")
  && optionalFeatureRuntime.includes("bundle.service.createMarketTimingService")
  && marketTimingService.includes("createMarketTimingService")
  && marketTimingService.includes("buildTimingModels"),
"market timing worker service is not wired into the app");
assert.ok(!pagesEntry.includes('import "../docs/modules/market-timing-service.mjs"')
  && !pagesEntry.includes('import "../docs/modules/co-movement.mjs"')
  && optionalFeatureRuntime.includes('loader.loadModuleFeature(')
  && optionalFeatureRuntime.includes('"analytics-core"')
  && optionalFeatureRuntime.includes('"./assets/analytics-core-feature.bundle.min.js"')
  && sw.includes('"/assets/analytics-core-feature.bundle.min.js"')
  && !precacheAssetsSource.includes("analytics-core-feature.bundle.min.js")
  && optionalFeatureRuntime.includes('loader.loadModuleFeature(')
  && optionalFeatureRuntime.includes('"market-timing"')
  && optionalFeatureRuntime.includes('"./assets/market-timing-feature.bundle.min.js"')
  && analyticsCoreFeatureEntry.includes('import "../../docs/modules/ai-forecast-math.js"')
  && analyticsCoreFeatureEntry.includes('import "../../docs/modules/ai-context-profile.js"')
  && analyticsCoreFeatureEntry.includes("export { analyticsCoreFeature }")
  && analyticsCoreFeatureEntry.includes('delete globalThis[name]')
  && !marketTimingFeatureEntry.includes('import "../../docs/modules/ai-forecast-math.js"')
  && !marketTimingFeatureEntry.includes('import "../../docs/modules/ai-context-profile.js"')
  && marketTimingFeatureEntry.includes('import { coMovement } from "../../docs/modules/co-movement.mjs"')
  && marketTimingFeatureEntry.includes('import timing from "../../docs/modules/market-timing.mjs"')
  && marketTimingFeatureEntry.includes('import evaluation from "../../docs/modules/market-timing-evaluation.mjs"')
  && marketTimingFeatureEntry.includes("export { marketTimingFeature }")
  && !marketTimingFeatureEntry.includes("globalThis.ThinkStockCoMovement = coMovement")
  && marketTimingFeatureEntry.includes('import service from "../../docs/modules/market-timing-service.mjs"')
  && marketTimingWorker.includes('../../docs/modules/market-timing.mjs')
  && marketTimingWorker.includes('../../docs/modules/market-timing-evaluation.mjs')
  && !marketTimingService.includes("ThinkStockMarketTiming")
  && !marketTiming.includes("globalThis.ThinkStockMarketTiming")
  && !marketTimingEvaluation.includes("globalThis.ThinkStockMarketTimingEvaluation")
  && marketTimingWorker.includes("buildTimingModels")
  && marketTimingWorker.includes("source cache miss"),
"market timing must load on demand and calculate in its worker");
assert.ok(!app.includes("marketTimingModelCache = new Map()"),
  "market timing model cache still lives in app.js");
assert.ok(!pagesEntry.includes('import "../docs/modules/ai-scenario-paths.js"')
  && optionalFeatureRuntime.includes('loader.loadModuleFeature(')
  && optionalFeatureRuntime.includes('"ai-forecast"')
  && optionalFeatureRuntime.includes('"./assets/ai-feature.bundle.min.js"')
  && !optionalFeatureRuntime.includes("withAnalyticsCoreCompatibility")
  && aiFeatureEntry.includes('import "../../docs/modules/ai-forecast-math.js"')
  && aiFeatureEntry.includes('import "../../docs/modules/ai-context-profile.js"')
  && aiFeatureEntry.includes('from "../../docs/modules/macd-oscillator.mjs"')
  && aiFeatureEntry.includes('import "../../docs/modules/ai-scenario-paths.js"')
  && aiForecastWorker.includes('../../docs/modules/ai-forecast-math.js')
  && aiForecastWorker.includes('../../docs/modules/ai-forecast-model.js')
  && aiForecastWorker.includes('../../docs/modules/ai-scenario-paths.js')
  && aiForecastWorker.includes('../../docs/modules/ai-forecast-scenarios.js')
  && aiForecastWorker.includes('../../docs/modules/ai-forecast.js')
  && aiScenarioPaths.includes("buildHistoricalPathLibrary")
  && aiScenarioPaths.includes("buildScenarioMorphologies"),
"AI scenario modules must load on demand and stay shared with the forecast worker");
assert.ok(!pagesEntry.includes('import "../docs/modules/eps-chart.mjs"')
  && optionalFeatureRuntime.includes("loader.loadModuleFeature(")
  && optionalFeatureRuntime.includes('"eps-chart"')
  && optionalFeatureRuntime.includes('"./assets/eps-feature.bundle.min.js"')
  && epsFeatureEntry.includes('import { epsChart } from "../../docs/modules/eps-chart.mjs"')
  && epsFeatureEntry.includes("export { epsChart }")
  && !epsFeatureEntry.includes("ThinkStockEpsChart")
  && app.includes("createAppFeatureRuntime({")
  && optionalFeatureRuntime.includes("optional.ensureEps()")
  && optionalFeatureRuntime.includes("Promise.all([")
  && sw.includes('"/assets/eps-feature.bundle.min.js"')
  && !precacheAssetsSource.includes("eps-feature.bundle.min.js"),
"EPS must load only when its default-off chart is enabled");
assert.ok(!app.includes('from "./modules/auxiliary-chart-runtime.mjs"')
  && !app.includes('from "./modules/macd-oscillator.mjs"')
  && optionalFeatureRuntime.includes('"auxiliary-chart"')
  && optionalFeatureRuntime.includes('"./assets/auxiliary-chart-feature.bundle.min.js"')
  && auxiliaryChartFeatureEntry.includes('from "../../docs/modules/auxiliary-chart-runtime.mjs"')
  && auxiliaryChartFeatureEntry.includes('from "../../docs/modules/macd-oscillator.mjs"')
  && auxiliaryChartFeatureEntry.includes("export { auxiliaryChartFeature, auxiliaryChartModel, auxiliaryChartRuntime, macd }")
  && app.includes("return getAuxiliaryChartRuntime().then((runtime) => runtime.renderAdrChart(xRange))")
  && sw.includes('"/assets/auxiliary-chart-feature.bundle.min.js"')
  && !precacheAssetsSource.includes("auxiliary-chart-feature.bundle.min.js"),
"auxiliary chart rendering must load after the first main chart frame");
assert.ok(!pagesEntry.includes('import "../docs/modules/ai-forecast-app.mjs"')
  && aiFeatureEntry.includes('from "../../docs/modules/ai-forecast-app.mjs"')
  && !aiFeatureEntry.includes("broker-research-runtime")
  && brokerResearchFeatureEntry.includes('from "../../docs/modules/broker-research-runtime.mjs"')
    && brokerResearchFeatureEntry.includes('import brokerReportParser from "../../docs/modules/broker-report-parser.mjs"')
    && brokerResearchFeatureEntry.includes('import brokerResearchCache from "../../docs/modules/broker-research-cache.mjs"')
  && brokerResearchFeatureEntry.includes("export { brokerResearchFeature }")
  && aiFeatureEntry.includes("export { aiFeature }")
  && !aiFeatureEntry.includes("globalThis.ThinkStockAiFeature =")
  && optionalFeatureRuntime.includes("module.aiFeature")
  && optionalFeatureRuntime.includes("module.brokerResearchFeature")
  && optionalFeatureRuntime.includes('"./assets/broker-research-feature.bundle.min.js"')
  && sw.includes('"/assets/broker-research-feature.bundle.min.js"')
  && !precacheAssetsSource.includes("broker-research-feature.bundle.min.js")
  && aiForecastApp.includes("cancelCalculations")
  && aiForecastApp.includes("progressActive")
  && aiForecastApp.includes("createSeriesRevisionCache")
  && brokerResearchRuntime.includes("createBrokerReportWorkerClient")
  && brokerResearchRuntime.includes("createBrokerResearchRuntime")
  && !aiForecastApp.includes("ThinkStockAiForecastApp")
  && !brokerResearchRuntime.includes("ThinkStockBrokerResearchRuntime")
  && !app.includes("let aiForecastWorker"),
"AI worker and progress orchestration is not separated from app.js");
assert.ok(!pagesEntry.includes('from "../docs/modules/ai-forecast-traces.mjs"')
  && aiFeatureEntry.includes('import aiForecastTraces from "../../docs/modules/ai-forecast-traces.mjs"')
  && app.includes("feature.traces.createAiForecastTraces")
  && app.includes("getLoadedAiFeature()?.traces")
  && aiForecastTraces.includes("createAiForecastTraces")
  && aiForecastTraces.includes("isPrimaryAiScenario"),
"AI forecast trace assembly is not separated from app.js");
assert.ok(dataPayload.includes("rowsFromColumnarPayload"), "shared columnar payload parser is missing");
assert.ok(dataWorker.includes('from "./data-payload.mjs?v=dev"')
  && dataPayload.includes("function attachDataWorker("),
"module data worker does not reuse the shared payload parser");
assert.ok(app.includes('import marketDataModule from "./modules/market-data.mjs"')
  && !app.includes("chart-core-modules.mjs"),
"market data module is not wired into the app");
assert.ok(marketData.includes("mergeSources") && marketData.includes("findTickerPriceRebaseSignal"), "market data module is incomplete");
assert.ok(mainChartModel.includes('import marketData from "./market-data.mjs"'), "chart model does not reuse the market data module");
assert.ok(chartModelWorker.includes('import mainChartModel from "./main-chart-model.mjs?v=dev"')
  && app.includes('import mainChartModelModule from "./modules/main-chart-model.mjs"')
  && app.includes('workerType: "module"'),
"browser and module worker do not share the main chart model");
assert.ok(
  marketData.includes("shiftIsoDateByDays")
    && mainChartModel.includes("creditCols.includes(series)")
    && mainChartModel.includes("shiftIsoDateByDays(date, -creditOffsetDays)"),
  "credit offset must shift only the credit trace dates",
);
assert.ok(!chartModelWorkerRuntime.includes("function buildMainChartModel(")
  && mainChartModel.includes("function buildMainChartModel("),
"main chart model calculation is duplicated in the worker");
assert.ok(mainChartModel.includes("function buildMainChartRenderInputs(")
  && mainChartModel.includes("function mainChartCalcCacheKey(")
  && !app.includes("function buildMainChartRenderInputs("),
"main chart render inputs and cache identity are not centralized");
assert.ok(chartModelWorker.includes('import auxiliaryChartModel from "./auxiliary-chart-model.mjs?v=dev"'), "chart worker does not reuse the auxiliary chart model module");
assert.ok(!app.includes("function mergeSources(") && !app.includes("function findTickerPriceRebaseSignal("), "market data logic still lives in app.js");
assert.ok(app.includes('from "./modules/chart-interaction-math.mjs"'), "chart interaction math module is not wired into the app");
assert.ok(chartInteractionMath.includes("axisPixelToXValue") && chartInteractionMath.includes("interpolateTraceYAtMs"),
  "chart interaction math module is incomplete");
assert.ok(app.includes('from "./modules/chart-interaction-controller.mjs"'), "chart interaction controller module is not wired into the app");
assert.ok(chartInteractionController.includes("createPointerFrameController"), "chart interaction controller module is incomplete");
assert.ok(app.includes('from "./modules/chart-session-controller.mjs"')
  && chartSessionController.includes("setAutoScale")
  && !app.includes("CHART_WORKER_STALE_CANCEL_MS"),
"chart state transitions are not centralized or stale worker cancellation remains");
assert.ok(app.includes('from "./modules/chart-model-worker-client.mjs"')
  && chartModelWorkerClient.includes("active.superseded")
  && chartModelWorkerClient.includes("dispatchNext"),
"latest-wins chart worker client is not wired into the app");
assert.ok(app.includes('from "./modules/runtime-data-transaction.mjs"')
  && runtimeDataTransaction.includes("assertSeriesRows")
  && runtimeDataTransaction.includes("introduced-anomaly"),
"runtime data is not validated before atomic commit");
assert.ok(app.includes("buildLineHitIndex") && app.includes("lineHitIndexMatches"),
  "cached line hit index is not wired into the app");
assert.ok(sw.includes("ThinkStockCacheRefreshPolicy"), "service worker cache refresh policy is not wired");
assert.ok(cacheRefreshPolicy.includes("runWithConcurrency") && cacheRefreshPolicy.includes("planDataRefreshRequests"),
  "service worker cache refresh policy is incomplete");
assert.ok(!app.includes("function getChartInteractionGeometry("), "chart interaction geometry still lives in app.js");
  assert.ok(app.includes('from "./modules/browser-market-client.mjs"'), "browser market client is not wired into the app");
assert.ok(browserMarketClient.includes("fetchYahooHistorySeries") && browserMarketClient.includes("fetchLatestKrxCoreIndexRows"),
  "browser market client is incomplete");
assert.ok(!app.includes("function fetchYahooHistorySeries(") && !app.includes("function fetchKrxIndexPoint("),
  "browser market requests still live in app.js");
assert.ok(!app.includes('import auxiliaryChartModelModule from "./modules/auxiliary-chart-model.mjs"')
  && app.includes('import auxiliaryChartContract from "./modules/auxiliary-chart-contract.mjs"')
  && auxiliaryChartFeatureEntry.includes('import auxiliaryChartModel from "../../docs/modules/auxiliary-chart-model.mjs"'),
"auxiliary chart model must stay behind its lazy feature while sharing the lightweight contract");
assert.ok(auxiliaryChartModel.includes("buildAuxiliaryChartModel") && auxiliaryChartModel.includes("buildThresholdZones"), "auxiliary chart model module is incomplete");
assert.ok(!app.includes('from "./modules/auxiliary-chart-runtime.mjs"')
  && app.includes("optionalFeatureRuntime.ensureAuxiliaryChart()")
  && !pagesEntry.includes("auxiliary-chart-runtime")
  && auxiliaryChartFeatureEntry.includes('from "../../docs/modules/auxiliary-chart-runtime.mjs"')
  && auxiliaryChartRuntime.includes("export const auxiliaryChartRuntime")
  && auxiliaryChartRuntime.includes("createAuxiliaryChartRuntime")
  && auxiliaryChartRuntime.includes("createAuxiliaryChartModelResolver")
  && auxiliaryChartRuntime.includes("buildAuxiliaryViewportRelayout")
  && auxiliaryChartRuntime.includes("sliceVisiblePanel")
  && auxiliaryChartRuntime.includes("controlsSignature")
  && !app.includes("function buildThresholdZoneFillTraces(")
  && !app.includes("function buildAuxiliaryViewportRelayout(")
  && !app.includes("async function getAuxiliaryChartModel("),
"auxiliary chart runtime module is not wired into the app");
assert.ok(auxiliaryChartRuntime.includes("function renderAuxiliaryPlot(")
  && auxiliaryChartRuntime.includes("await plotly.update(")
  && auxiliaryChartRuntime.includes("auxiliaryStructureSignature")
  && auxiliaryChartRuntime.includes("changedIndexes")
  && auxiliaryChartRuntime.includes('updateScope: "unchanged"'),
"auxiliary charts still rebuild unchanged panel structures");
assert.ok(chartModelWorkerRuntime.includes('type !== "buildAuxiliaryChartModel"')
  && chartModelWorkerRuntime.includes("auxiliaryChartModel.buildAuxiliaryChartModel"),
"auxiliary chart model is not built in the worker");
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
assert.ok(runtimeRefresh.includes("const criticalPromise")
  && runtimeRefresh.includes("startSupplementalAfterCritical")
  && runtimeRefresh.includes("runTaskFactoriesWithConcurrency")
  && runtimeRefreshOrchestrator.includes("supplementalConcurrency: options?.deferSupplementalUntilReady ? 2 : (forceNetwork ? 3 : 2)")
  && runtimeRefreshOrchestrator.includes("beforeSupplemental:")
  && runtimeRefreshOrchestrator.includes("waitForStartupVisualReady")
  && runtimeRefreshOrchestrator.includes("const applyPhaseChanges = async")
  && runtimeRefreshOrchestrator.includes("pendingDerivedInputChanged")
  && runtimeRefreshOrchestrator.includes("finalizeDerived: true")
  && !runtimeRefreshOrchestrator.includes("incrementalSupplementalRender")
  && runtimeRefreshOrchestrator.includes("supplementalTasks: foregroundSourceTasks.map")
  && !runtimeRefreshOrchestrator.includes("scheduleSupplementalTask(")
  && runtimeRefreshOrchestrator.includes("startSupplementalAfterCritical: true")
  && runtimeRefreshOrchestrator.includes("runTaskFactoriesWithConcurrency("),
"refresh phases do not preserve critical-first bounded startup work");
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
assert.ok(app.includes('from "./modules/app-state-controller.mjs"')
  && !pagesEntry.includes("app-state-controller")
  && appStateController.includes("hiddenAuxiliarySeries: [...state.hiddenAuxiliarySeries]")
  && appStateController.includes("Array.isArray(persisted.hiddenAuxiliarySeries)"),
  "auxiliary chart visibility is not persisted");
assert.ok(app.includes('from "./modules/control-state-view.mjs"')
  && controlStateView.includes("function syncControl("),
  "common toggle and loading state view is not wired");
assert.ok(app.includes('from "./modules/cache-maintenance-runtime.mjs"')
  && !pagesEntry.includes("cache-maintenance-runtime")
  && cacheMaintenanceRuntime.includes("function createCacheMaintenanceRuntime(")
  && cacheMaintenanceRuntime.includes("function createCacheMigrator(")
  && cacheMaintenanceRuntime.includes("readActiveRecord")
  && cacheMaintenanceRuntime.includes("copyFirstAvailable")
  && cacheMaintenanceRuntime.includes("schedulePrune"),
  "granular cache maintenance is not separated from app.js");
assert.ok(app.includes('from "./modules/runtime-snapshot-controller.mjs"')
  && runtimeSnapshotController.includes("function createRuntimeSnapshotController("),
  "runtime snapshot lifecycle is not separated from app.js");
assert.ok(app.includes('from "./modules/shared-request-registry.mjs"')
  && sharedRequestRegistry.includes("function createSharedRequestRegistry(")
  && sharedRequestRegistry.includes("entry.subscribers")
  && sharedRequestRegistry.includes("entry.controller.abort"),
  "shared runtime request deduplication is not loaded");
assert.ok(chartUpdateCoordinator.includes("function shouldUpdateAuxiliary(")
  && app.includes("chartUpdateCoordinatorModule.shouldUpdateAuxiliary"),
  "main-only chart updates still invalidate every auxiliary panel");
assert.ok(app.includes('from "./modules/chart-model-cache.mjs"')
  && !pagesEntry.includes("chart-model-cache")
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
assert.match(
  html,
  /\.\/assets\/app\.bundle\.min\.js\?v=dev&amp;build=\d+\.\d+&amp;asset=[a-f0-9]{12}/,
  "local app bundle content fingerprint is missing",
);
assert.equal([...html.matchAll(/<script\b/g)].length, 1, "runtime scripts are not bundled");
assert.ok(appBundle.size <= packageJson.thinkstockBuild.appBundleMaxBytes,
  `initial app bundle is too large: ${appBundle.size} bytes`);
assert.ok(appBundleGzipBytes <= packageJson.thinkstockBuild.appBundleGzipMaxBytes,
  `compressed initial app bundle is too large: ${appBundleGzipBytes} bytes`);
assert.ok(app.split(/\r?\n/).length <= APP_SOURCE_MAX_LINES,
  `docs/app.js exceeded ${APP_SOURCE_MAX_LINES} lines; move cohesive logic into an existing module`);
assert.ok(app.includes('from "./modules/chart-update-coordinator.mjs"')
  && !pagesEntry.includes("chart-render-scheduler")
  && chartUpdateCoordinator.includes("createChartRenderScheduler")
  && chartUpdateCoordinator.includes("createLatestKeyedFrameQueue")
  && chartUpdateCoordinator.includes("scheduleQueuedRender")
  && !pagesEntry.includes('import "../docs/modules/chart-relayout-queue.js"')
  && !app.includes("let renderChartRafId"),
"chart render scheduling is not separated from app.js");
assert.ok(!pagesEntry.includes("chart-session-controller")
  && chartSessionState.includes("createChartSessionState")
  && app.includes("const chartSession = chartSessionControllerModule.createChartSessionState"),
"chart viewport and visibility state are not centralized");
assert.ok(app.includes('from "./modules/chart-hover-runtime.mjs"')
  && !pagesEntry.includes("chart-hover-runtime")
  && chartHoverRuntime.includes("createChartHoverRuntime")
  && app.includes("chartHoverRuntimeModule.createChartHoverRuntime")
  && !app.includes("let pendingHoverSync"),
"chart hover synchronization is not separated from app.js");
assert.ok(app.includes('from "./modules/optional-feature-runtime.mjs"')
  && app.includes('from "./modules/stock-research-contract.js"')
  && !app.includes('from "./modules/stock-research-app.mjs"')
  && stockResearchApp.includes('import stockResearchContract from "./stock-research-contract.js"')
  && !stockResearchApp.includes('from "./stock-research-storage.js"')
  && stockResearchApp.includes("stockResearchContract.loadUniverseSize")
  && stockResearchApp.includes("stockResearchContract.saveUniverseSize")
  && !pagesEntry.includes('import "../docs/modules/stock-research-contract.js"')
  && !pagesEntry.includes('import "../docs/modules/stock-research-storage.js"')
  && !pagesEntry.includes('import "../docs/modules/stock-research-app.js"')
  && optionalFeatureLoader.includes("loadModuleFeature")
  && !optionalFeatureLoader.includes("function loadFeature(")
  && !optionalFeatureLoader.includes("function loadScript(")
  && optionalFeatureRuntime.includes('loader.loadModuleFeature(')
  && optionalFeatureRuntime.includes('"stock-research"')
  && optionalFeatureRuntime.includes('"./assets/stock-research-feature.bundle.min.js"')
  && stockResearchFeatureEntry.includes('import controller from "../../docs/modules/stock-research-controller.js"')
  && stockResearchFeatureEntry.includes('import research from "../../docs/modules/stock-research.js"')
  && stockResearchFeatureEntry.includes('import { createStockResearchApp } from "../../docs/modules/stock-research-app.mjs"')
  && stockResearchFeatureEntry.includes("createApp: createStockResearchApp")
  && !stockResearchFeatureEntry.includes("globalThis.ThinkStockStockResearchController")
  && !stockResearchFeatureEntry.includes("globalThis.ThinkStockStockResearch")
  && stockResearchFeatureEntry.includes("export { stockResearchFeature }")
  && !stockResearchFeatureEntry.includes("globalThis.ThinkStockStockResearchFeature =")
  && optionalFeatureRuntime.includes("module.stockResearchFeature")
  && stockResearchContract.includes("CALCULATION_VERSION")
  && stockResearchContract.includes("CACHE_FORMAT_SCHEMA")
  && stockResearchApp.includes("createStockResearchApp")
  && stockResearchApp.includes("stockResearchContract")
  && stockResearchStorage.includes("loadBlocked")
  && stockResearchStorage.includes("calculationVersion")
  && stockResearchNavigation.includes("diffUniverseState")
  && stockResearchNavigation.includes("candidateSignalFingerprint")
  && stockResearchFilter.includes("candidateMatchesTodayFilter")
  && stockResearchHistoryCache.includes("mergeResearchHistoryPayload")
  && stockResearchWorkerClient.includes("createWorkerLane")
  && !pagesEntry.includes('import "../docs/modules/stock-research-controller.js"'),
"optional features are still part of the initial bundle");
assert.ok(app.includes("./assets/stock-research-worker.bundle.min.js")
  && sw.includes('"/assets/stock-research-worker.bundle.min.js"')
  && buildPagesBundle.includes('entry: "stock-research-worker.mjs"')
  && buildPagesBundle.includes('output: "stock-research-worker.bundle.min.js"')
  && stockResearchWorkerEntry.includes("bindStockResearchWorker(globalThis, runtime)")
  && stockResearchWorkerRuntime.includes("scope.onmessage = onMessage")
  && stockResearchWorkerRuntime.includes("createStockResearchWorkerRuntime")
  && stockResearchFeatureEntry.includes("stock-research-controller.js")
  && app.includes("feature.controller.createControllerOptions({")
  && !stockResearchWorkerEntry.includes("importScripts("),
"stock research worker is not using one bundled dependency graph");
assert.ok(app.includes('from "./modules/ticker-price-app-runtime.mjs"')
  && app.includes('from "./modules/ticker-price-runtime.mjs"')
  && app.includes('from "./modules/ticker-cache-invalidation.mjs"')
  && app.includes("createTickerPriceAppRuntime({")
  && tickerPriceRuntime.includes("export default tickerPriceRuntime")
  && tickerCacheInvalidation.includes("createTickerCacheInvalidationContract")
  && stockResearchHistoryCache.includes("configureTickerPriceRuntime")
  && !app.includes("ThinkStockTickerPriceRuntime")
  && !app.includes("ThinkStockTickerCacheInvalidation")
  && !app.includes("function getTickerPriceCacheRepository(")
  && tickerPriceAppRuntime.includes("function applySharedCache(")
  && tickerPriceAppRuntime.includes("function getSeriesLoader(")
  && tickerPriceAppRuntime.includes("function getHistoryCoordinator("),
"ticker price and cache orchestration still lives in app.js");
assert.ok(!pagesEntry.includes("ai-forecast-cache")
  && aiFeatureEntry.includes('import aiForecastCache from "../../docs/modules/ai-forecast-cache.mjs"')
  && aiFeatureEntry.includes('import aiAnalysisCache from "../../docs/modules/ai-analysis-cache.mjs"')
  && aiFeatureEntry.includes("cache: aiForecastCache")
  && aiFeatureEntry.includes("analysis: aiAnalysisCache")
  && !aiFeatureEntry.includes("ThinkStockAiForecastCache")
  && !aiFeatureEntry.includes("ThinkStockAiAnalysisCache")
  && aiForecastCache.includes("matchesInput")
  && app.includes("TICKER_AI_FORECAST_CACHE_STORE_NAME"),
"AI input-fingerprint cache is incomplete");
assert.ok(!pagesEntry.includes('from "../docs/modules/ai-forecast-quality-runtime.mjs"')
  && aiFeatureEntry.includes('import aiForecastQualityRuntime from "../../docs/modules/ai-forecast-quality-runtime.mjs"')
  && app.includes("feature.qualityRuntime")
  && aiForecastQualityRuntime.includes("function createAiForecastQualityRuntime(")
  && !app.includes("aiForecastCalibrationPoolPromise"),
"AI forecast journal and quality orchestration is not separated from app.js");
assert.equal(packageJson.scripts?.["backtest:ai:verify"],
  "node scripts/run_ai_walkforward_validation.mjs",
  "AI walk-forward regression guard is not wired to one command");
assert.ok(app.includes('const MAIN_LINE_TRACE_TYPE = "scatter";'), "main chart is not using the SVG scatter path");
assert.ok(app.includes("resolveMainChartDisplayPointBudget(width, visibleSeriesCount, mobile)")
  && appControlConfig.includes("export function resolveMainChartDisplayPointBudget(")
  && appControlConfig.includes("const totalTarget = mobile ? 2800"),
"adaptive mobile chart budget is missing");
assert.ok(app.includes("preparePlotly: ensurePlotlyReady")
  && appBootstrapOrchestrator.includes("const plotlyReadyTask = Promise.resolve()")
  && appBootstrapOrchestrator.includes("prepareInitialData"),
"Plotly is not prepared in parallel during boot");
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
assert.ok(app.includes('from "./modules/performance-monitor.mjs"'), "performance monitor module is not wired into the app");
assert.ok(performanceMonitor.includes("createPerformanceMonitor")
  && performanceMonitor.includes("createChartRenderTelemetry")
  && performanceMonitor.includes("p95FrameGap"),
"performance monitor module is incomplete");
assert.ok(!app.includes('from "./modules/deferred-diagnostics.mjs"')
  && optionalFeatureRuntime.includes('"diagnostics-runtime"')
  && optionalFeatureRuntime.includes('"./assets/diagnostics-runtime-feature.bundle.min.js"')
  && diagnosticsRuntimeFeatureEntry.includes('from "../../docs/modules/performance-diagnostics.mjs"')
  && !diagnosticsRuntimeFeatureEntry.includes("deferred-diagnostics.mjs")
  && performanceDiagnostics.includes("createDeferredDiagnostics")
  && !performanceDiagnostics.includes("ThinkStockPerformanceDiagnostics")
  && performanceDiagnostics.includes("createPerformanceDiagnostics")
  && performanceDiagnostics.includes("readStorageState")
  && sw.includes('"/assets/diagnostics-runtime-feature.bundle.min.js"'),
  "persistent performance diagnostics are incomplete");
assert.ok(performanceDiagnostics.includes("startAutomaticCapture")
  && performanceDiagnostics.includes("scheduleAutomaticCapture")
  && performanceMonitor.includes("diagnosticSamples"),
  "automatic local performance history is incomplete");
assert.ok(!pagesEntry.includes("performance-diagnostics")
  && !pagesEntry.includes("deferred-diagnostics"),
  "performance diagnostics must stay out of the initial bundle");
assert.ok(!sw.includes("/modules/performance-diagnostics")
  && !precacheAssetsSource.includes("./assets/diagnostics-runtime-feature.bundle.min.js"),
  "deferred performance diagnostics cache policy is incorrect");
assert.ok(!app.includes('from "./modules/data-health.mjs"')
  && !app.includes('from "./modules/data-freshness-controller.mjs"')
  && optionalFeatureRuntime.includes('"data-freshness"')
  && optionalFeatureRuntime.includes('"./assets/data-freshness-feature.bundle.min.js"')
  && dataFreshnessFeatureEntry.includes('from "../../docs/modules/data-health.mjs"')
  && dataFreshnessFeatureEntry.includes('from "../../docs/modules/data-freshness-controller.mjs"')
  && dataFreshnessFeatureEntry.includes("export { dataFreshnessFeature }")
  && app.includes("getDataFreshnessController()")
  && sw.includes('"/assets/data-freshness-feature.bundle.min.js"')
  && !precacheAssetsSource.includes("data-freshness-feature.bundle.min.js")
  && dataHealth.includes("buildFreshnessItems")
  && dataHealth.includes("detectRecentChanges"),
  "shared data health checks are incomplete");
assert.ok(dataFreshnessController.includes("renderFreshness")
  && dataFreshnessController.includes("summarizeQuality"),
"data freshness controller and view are not using one lifecycle boundary");
assert.ok(!app.includes("function dateSpanForRows(") && !app.includes("function daysSinceDate("),
  "data health logic still lives in app.js");
assert.ok(app.includes('from "./modules/app-ui-bindings.mjs"')
  && appUiBindings.includes("bindManualRefresh")
  && appUiBindings.includes("bindChartRangeControls"),
  "boot UI event bindings are not separated from app.js");
assert.ok(!app.includes("ThinkStockSettingsPanelRuntime")
  && !app.includes("ThinkStockApiPeriods")
  && !pagesEntry.includes("api-periods")
  && !pagesEntry.includes("settings-panel-runtime")
  && optionalFeatureRuntime.includes("loader.loadModuleFeature(")
  && optionalFeatureRuntime.includes('"settings"')
  && optionalFeatureRuntime.includes('"./assets/settings-feature.bundle.min.js"')
  && !optionalFeatureRuntime.includes("scope.ThinkStockSettingsFeature")
  && settingsFeatureEntry.includes('from "../../docs/modules/api-periods.mjs"')
  && settingsFeatureEntry.includes('from "../../docs/modules/release-notes.mjs"')
  && settingsFeatureEntry.includes('from "../../docs/modules/settings-panel-runtime.mjs"')
  && settingsFeatureEntry.includes("export { settingsFeature }")
  && !settingsFeatureEntry.includes("ThinkStockSettingsFeature")
  && apiPeriods.includes('return "기간만료"')
  && apiPeriods.includes("파생상품지수 시세정보")
  && settingsPanelRuntime.includes("createSettingsPanelRuntime")
  && !app.includes("const syncAppCacheButton = async"),
"settings panel event binding is not separated from app.js");
assert.ok(app.includes('from "./modules/runtime-snapshot-controller.mjs"')
  && runtimeSnapshotPolicy.includes("createRevisionTracker")
  && runtimeSnapshotPolicy.includes("isSnapshotUsable")
  && runtimeSnapshotPolicy.includes("hasCoreHistoricalCoverage"),
  "runtime snapshot policy module is incomplete");
assert.ok(performanceDiagnostics.includes("gap < frameGapIgnoreMs"),
  "suspended tabs still pollute delayed frame timing diagnostics");
assert.ok(performanceDiagnostics.includes('observe({ type: "longtask", buffered: true })'),
  "delayed browser long-task diagnostics are missing");
assert.ok(performanceMonitor.includes("attachBrowserMetricsProvider")
  && !performanceMonitor.includes("PerformanceObserver")
  && !performanceMonitor.includes("requestAnimationFrame"),
"continuous browser observers still live in the main performance bundle");
assert.ok(!app.includes("let perfSamples") && !app.includes("function startPerfFrameMonitor("), "performance diagnostics still live in app.js");
assert.ok(app.includes('from "./modules/app-storage.mjs"'), "app storage module is not wired into the app");
assert.ok(appStorage.includes("createApiSettingsStore")
  && appStorage.includes("createIndexedCacheStore")
  && appStorage.includes("createJsonStore"), "app storage module is incomplete");
assert.ok(!app.includes("function openRuntimeCacheDb(") && !app.includes("function sanitizeApiSettings("), "storage implementation still lives in app.js");
assert.ok(app.includes('from "./modules/cache-maintenance-runtime.mjs"')
  && cacheMaintenanceRuntime.includes("copyFirstAvailable")
  && app.includes("cacheMigrator.run()"),
"cache migration flow is incomplete");
assert.ok(app.includes('from "./modules/admin-feature-access.mjs"')
  && app.includes('from "./modules/background-stock-refresh.mjs"')
  && app.includes('from "./modules/runtime-market-refresh.mjs"')
  && app.includes('from "./modules/series-cache-retention.mjs"'),
"small app services still rely on legacy globals");
assert.ok(app.includes("createStartupLoader")
  && appBootstrapOrchestrator.includes("requestAnimationFrame"),
"startup loader module is incomplete");
assert.ok(!app.includes("function ensureStartupLoader(") && !app.includes("startupLoaderDisplayProgress"), "startup loader implementation still lives in app.js");
assert.ok(app.includes('from "./modules/runtime-data-app.mjs"')
  && runtimeDataApp.includes("refreshController.abort")
  && runtimeDataApp.includes("prepareInitialData")
  && !app.includes("let runtimeRefreshController"),
"runtime data orchestration or superseded refresh cancellation is incomplete");
assert.ok(app.includes('from "./modules/runtime-source-health.mjs"')
  && runtimeSourceHealth.includes("createRuntimeSourceHealth")
  && runtimeRefreshOrchestrator.includes("canAttemptSource"),
"persistent runtime source recovery is incomplete");
assert.ok(app.includes('from "./modules/runtime-market-refresh.mjs"')
  && runtimeMarketRefresh.includes("fetchLatestPriceSeriesBatch")
  && runtimeMarketRefresh.includes("fetchCritical"),
"runtime bootstrap batching is not separated from app.js");
assert.ok(!app.includes("function cancelStaleChartModelWorkerRequest()")
  && chartModelWorkerClient.includes("active.superseded")
  && chartModelWorkerClient.includes("request.resolve(null)"),
"chart worker does not use persistent latest-wins scheduling");
assert.ok(app.includes('from "./modules/chart-pointer-runtime.mjs"')
  && !pagesEntry.includes("chart-pointer-runtime")
  && chartPointerRuntime.includes("getChartInteractionGeometry(sourceEl)"),
"pointer geometry is not shared per frame");
assert.ok(app.includes("createApplicationLifecycleRuntime")
  && app.includes('from "./modules/app-bootstrap-orchestrator.mjs"')
  && app.includes("if (!event.persisted) applicationLifecycle.dispose()")
  && app.includes("appRuntimeRegistry.disposeAll()")
  && applicationLifecycleRuntime.includes("if (disposed) return false")
  && applicationLifecycleRuntime.includes("cleanupSteps.forEach")
  && applicationLifecycleRuntime.includes("function disposeAll()")
  && applicationLifecycleRuntime.includes("pending.clear()")
  && applicationLifecycleRuntime.includes("values.forEach((entry)"),
"application runtime resources are not released on final page exit");
assert.ok(app.includes("chartUpdateCoordinatorModule.buildMainChartRenderFrame")
  && app.includes("chartUpdateCoordinatorModule.applyMainChartViewportPlan")
  && app.includes("chartUpdateCoordinatorModule.finalizeMainChartFrameState")
  && app.includes('from "./modules/chart-viewport-controller.mjs"')
  && !pagesEntry.includes("chart-viewport-controller")
  && chartViewportController.includes("function buildRenderViewportPlan")
  && chartViewportController.includes("createFutureOverlayController")
  && chartUpdateCoordinator.includes("viewport.controller.buildRenderViewportPlan")
  && chartUpdateCoordinator.includes("function applyMainChartViewportPlan")
  && chartUpdateCoordinator.includes("function finalizeMainChartFrameState")
  && app.includes("getFutureOverlayController"),
"main chart viewport planning is not separated from renderChart");
assert.ok(app.includes('from "./modules/chart-marker-runtime.mjs"')
  && !pagesEntry.includes("chart-marker-runtime")
  && chartMarkerRuntime.includes("export const chartMarkerRuntime")
  && chartMarkerRuntime.includes("export const chartMarkerLayout")
  && chartMarkerRuntime.includes("EVENT_MARKER_DESCRIPTORS")
  && chartMarkerRuntime.includes("materializeEventMarkerTraces")
  && chartMarkerRuntime.includes("createFrame")
  && chartMarkerRuntime.includes("buildDisclosure")
  && chartMarkerRuntime.includes("buildInsider")
  && chartMarkerRuntime.includes("buildTimingSignalPopoverGroup")
  && chartMarkerRuntime.includes("buildEventMarkerPopoverGroup")
  && app.includes("chartMarkerRuntimeModule.buildEventMarkerPopoverGroup(point)")
  && app.includes("currentEventMarkerSpecs")
  && !app.includes("매수 타이밍 · 투매 저점 확인"),
"chart marker rendering is not separated or sharing one frame");
assert.ok(app.includes("getSeriesTransformDragController")
  && chartInteractionController.includes("createSeriesTransformDragController")
  && chartInteractionController.includes('addEventListener("pointermove"')
  && chartInteractionController.includes("getCoalescedEvents"),
  "chart input is not using the unified pointer pipeline");
assert.ok(chartEventLayer.includes("traceMarkerNodes")
  && chartEventLayer.includes("setMarkerHighlighted")
  && app.includes("chartEventLayerModule.setMarkerHighlighted"),
"event marker highlighting is not using the shared DOM lookup cache");
assert.ok(!`${app}\n${chartPointerRuntime}`.includes('addEventListener("touchmove"')
  && !`${app}\n${chartPointerRuntime}`.includes('addEventListener("mousedown"'),
  "legacy chart input listeners remain");
assert.ok(app.includes("function applyDisclosureStateFast("), "disclosure-only updates still require a full chart render");
assert.ok(app.includes("function applyMainChartRender(")
  && app.includes("chartUpdateCoordinatorModule.createMainChartRenderRuntime")
  && app.includes("telemetry: chartRenderTelemetry")
  && chartUpdateCoordinator.includes("function createMainChartRenderRuntime(")
  && chartUpdateCoordinator.includes("options.telemetry?.begin?.")
  && chartUpdateCoordinator.includes("options.telemetry?.complete?.(telemetryToken, result)"),
"main chart render fast paths are not using shared telemetry");
assert.ok(app.includes('from "./modules/main-chart-renderer.mjs"')
  && !pagesEntry.includes("main-chart-renderer")
  && mainChartRenderer.includes("export const mainChartRenderer")
  && mainChartRenderer.includes("await plotly.update(")
  && mainChartRenderer.includes("relayoutPayload(layout)")
  && mainChartRenderer.includes("buildLineTraces")
  && mainChartRenderer.includes("buildLayout"),
  "main chart renderer module is incomplete");
assert.ok(mainChartRenderer.includes("function chartOverlayDescriptor(")
  && mainChartRenderer.includes("overlayKind")
  && chartHoverRuntime.includes(".hoverlayer > g.legend"),
  "chart overlays do not share classification or first-hover recovery");
assert.ok(app.includes('from "./modules/main-chart-events.mjs"')
  && !pagesEntry.includes("main-chart-events")
  && mainChartEvents.includes("createMainChartEvents")
  && mainChartEvents.includes('element.on("plotly_relayout"'),
"main chart event binding is not separated from app.js");
assert.ok(!app.includes("function mainChartRestylePayload(")
  && !app.includes("function canApplyMainChartPartialUpdate("),
  "main chart rendering implementation still lives in app.js");
assert.ok(chartMarkerRuntime.includes("const CHART_MARKER_DEFAULTS")
  && chartMarkerRuntime.includes('disclosureIconText: "◆"')
  && chartMarkerRuntime.includes("disclosureTextSize: 13")
  && chartMarkerRuntime.includes('mode: "text"')
  && chartMarkerRuntime.includes('constants.disclosureIconText || "◆"'),
"disclosure diamond marker is not configured");
assert.ok(app.includes("createSeedBundleLoader")
  && dataSeedLoader.includes("createSeedBundleLoader")
  && dataSeedLoader.includes("fetchSegmentedSeedText"),
"segmented data loading is not owned by the seed loader");
assert.ok(app.includes("ensureHistoricalDataLoaded"), "historical lazy loading is missing");
assert.ok(app.includes("mainChartModelResolver.resolve")
  && app.includes('"buildAuxiliaryChartModel"')
  && !app.includes("requestChartModelFromWorker")
  && chartModelWorkerClient.includes("createChartModelResolver"),
"chart model worker resolver is missing");
assert.ok(app.includes("initE2eDebugAccess"), "WebKit test diagnostics are missing");
assert.ok(/scheduleServiceWorker:\s*\(\)\s*=>\s*runAfterStartupVisualReady\(\s*scheduleDeferredServiceWorkerRegistration,/.test(app)
  && app.includes('"service-worker-registration"')
  && appBootstrapOrchestrator.includes("options.scheduleServiceWorker?.();"),
"service worker registration is not deferred until visual startup completes");
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
  && playwrightConfig.includes('name: "webkit-desktop"')
  && deployWorkflow.includes("matrix:")
  && deployWorkflow.includes("target: [mobile, desktop, sw]")
  && deployWorkflow.includes("run_webkit_scope.mjs ${{ matrix.target }} ${{ inputs.verification_scope }}")
  && webkitScopeRunner.includes('mode === "release"')
  && webkitScopeRunner.includes('args.push("--project=webkit", "--project=webkit-desktop", "--project=webkit-sw")')
  && webkitScopeRunner.includes('mode === "desktop"')
  && webkitScopeRunner.includes('args.push("--project=webkit-desktop")')
  && webkitScopeRunner.includes('args.push("--project=webkit")'),
  "iPhone WebKit is not covered by deployment validation");
assert.ok(deployWorkflow.indexOf("npm ci") < deployWorkflow.indexOf("npm run test:unit:built"),
  "Node dependencies must be installed before web validation");
assert.ok((deployWorkflow.match(/path: node_modules/g) || []).length >= 2
  && deployWorkflow.includes("thinkstock-node24-${{ runner.os }}-${{ hashFiles('package-lock.json') }}")
  && deployWorkflow.includes("outputs.cache-hit != 'true'"),
"deployment does not reuse lockfile-pinned Node dependencies");
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
assert.ok(dataSeedLoader.includes('stock-to-corp-shards-v1')
  && dataSeedLoader.includes("createShardedCorpCodeRegistry")
  && dataSeedLoader.includes("loadedShards")
  && app.includes("createShardedCorpCodeRegistry"),
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
  "THINKSTOCK_ADMIN_CODE_SECONDARY",
  "THINKSTOCK_ADMIN_SESSION_SECRET",
].forEach((secretName) => {
  assert.ok(workerConfig.includes(`\"${secretName}\"`), `Worker secret is not declared: ${secretName}`);
});
assert.ok(!/\"(?:THINKSTOCK_ADMIN_CODE(?:_SECONDARY)?|THINKSTOCK_ADMIN_SESSION_SECRET)\"\s*:\s*\"[^\"]+\"/.test(workerConfig),
  "Worker administrator secret values must not be committed");
assert.ok(!/THINKSTOCK_LEGACY_ADMIN_HASH|THINKSTOCK_ADMIN_MIGRATION_UNTIL/.test(
  `${app}\n${adminFeatureAccess}\n${adminSessionHandler}\n${workerConfig}`,
), "retired administrator migration secrets remain in the active product");
assert.ok(!/request\([\"']migrate[\"']|action\s*===\s*[\"']migrate[\"']/.test(
  `${adminFeatureAccess}\n${adminSessionHandler}`,
), "retired administrator migration requests remain active");

console.log(`Pages app validation passed (version ${appVersion}, ${ids.length} unique IDs).`);
