import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, sw] = await Promise.all([
  readFile(path.join(root, "docs", "app.js"), "utf8"),
  readFile(path.join(root, "docs", "index.html"), "utf8"),
  readFile(path.join(root, "docs", "sw.js"), "utf8"),
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
  "./modules/data-worker.js?v=dev",
  "./app.js?v=dev",
].forEach((asset) => assert.ok(sw.includes(`"${asset}"`), `service worker precache is missing: ${asset}`));

assert.ok(app.includes("function isDirectDisclosureTap"), "iPhone disclosure tap guard is missing");
assert.ok(app.includes("disclosure-title-link"), "disclosure title links are missing");
assert.ok(html.includes('data-series="customer_deposit"'), "customer deposit toggle is missing");
assert.ok(app.includes("getSecuritiesMarketTotalCapitalInfo"), "customer deposit API endpoint is missing");
assert.ok(app.includes("CUSTOM_STOCK_PRELOAD_CONCURRENCY"), "custom stock preload concurrency guard is missing");
assert.ok(app.includes("Promise.all([adrTask, dartTask, liveTask])"), "independent runtime refreshes are not parallelized");
assert.ok(app.includes("lastAdrRenderKey === renderKey"), "ADR render fast path is missing");

console.log(`Pages app validation passed (version ${appVersion}, ${ids.length} unique IDs).`);
