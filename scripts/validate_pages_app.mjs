import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, sw, chartLoader, disclosurePolicy, plotlyBundle] = await Promise.all([
  readFile(path.join(root, "docs", "app.js"), "utf8"),
  readFile(path.join(root, "docs", "index.html"), "utf8"),
  readFile(path.join(root, "docs", "sw.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "chart-loader.js"), "utf8"),
  readFile(path.join(root, "docs", "modules", "disclosure-policy.js"), "utf8"),
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
  "./modules/chart-loader.js?v=dev",
  "./modules/disclosure-policy.js?v=dev",
  "./modules/data-worker.js?v=dev",
  "./modules/chart-model-worker.js?v=dev",
  "./app.js?v=dev",
  "./vendor/plotly-basic-2.35.2.min.js",
].forEach((asset) => assert.ok(sw.includes(`"${asset}"`), `service worker precache is missing: ${asset}`));

assert.ok(app.includes("function isDirectDisclosureTap"), "iPhone disclosure tap guard is missing");
assert.ok(app.includes("ThinkStockDisclosurePolicy"), "disclosure policy module is not wired into the app");
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
assert.ok(app.includes("fearGreedTask") && app.includes("Promise.all(["), "independent runtime refreshes are not parallelized");
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
assert.ok(app.includes('const tx = db.transaction(storeName, "readwrite");')
  && app.includes("deleteKeys.forEach((key) => store.delete(key))"), "single-transaction IndexedDB cleanup is missing");
assert.ok(!app.includes("function rowsSignature("), "sampled row signatures can leave stale chart data");
assert.ok(app.includes("function dataRevisionSignature("), "explicit data revisions are missing");
assert.ok(app.includes("function getTraceLinePaths("), "DOM-only line highlighting is missing");
assert.ok(!app.includes('Plotly.restyle(el, { "line.width"'), "line hover still triggers Plotly restyle");
assert.ok(app.includes("function startPerfFrameMonitor()"), "performance frame diagnostics are missing");
assert.ok(app.includes('const DISCLOSURE_ICON_TEXT = "◆";'), "disclosure icon is not configured");
assert.ok(app.includes("fetchSegmentedSeedText"), "segmented data loading is missing");
assert.ok(app.includes("ensureHistoricalDataLoaded"), "historical lazy loading is missing");
assert.ok(app.includes("requestChartModelFromWorker"), "chart model worker client is missing");
assert.ok(app.includes("initE2eDebugAccess"), "WebKit test diagnostics are missing");
assert.ok(sw.includes("function cacheFirst("), "service worker cache-first strategy is missing");
assert.ok(sw.includes("isVersionedAssetUrl(url)"), "versioned assets are not using immutable caching");

console.log(`Pages app validation passed (version ${appVersion}, ${ids.length} unique IDs).`);
