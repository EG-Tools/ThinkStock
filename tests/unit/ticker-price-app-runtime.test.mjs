import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreferredTickerHistoryFetcher,
  createTickerPriceAppRuntime,
  createTickerPriceRequestRunner,
  hasCompleteTradingCoverage,
  shiftHistorySinceDate,
} from "../../docs/modules/ticker-price-app-runtime.mjs";
import { createSharedRequestRegistry } from "../../docs/modules/shared-request-registry.mjs";
import { createTickerCacheInvalidationContract } from "../../docs/modules/ticker-cache-invalidation.mjs";
import * as cacheLifecycle from "../../docs/modules/cache-lifecycle-policy.mjs";
import tickerPriceRuntime from "../../docs/modules/ticker-price-runtime.mjs";

await import("../../shared/runtime-foundation.mjs");
await import("../../shared/market-calendar.mjs");

test("recent ticker coverage ignores weekends but rejects a missing trading day", () => {
  const weekday = (date) => {
    const day = new Date(String(date) + "T00:00:00Z").getUTCDay();
    return day !== 0 && day !== 6;
  };
  const existing = [{ date: "2026-08-21" }];
  assert.equal(hasCompleteTradingCoverage(existing, [
    { date: "2026-08-24" },
    { date: "2026-08-25" },
  ], weekday), true);
  assert.equal(hasCompleteTradingCoverage(existing, [
    { date: "2026-08-25" },
  ], weekday), false);
  assert.equal(shiftHistorySinceDate("2026-08-21", 21), "2026-07-31");
});

test("builds protected ticker history requests behind the price runtime boundary", async () => {
  const calls = [];
  const fetchHistory = createPreferredTickerHistoryFetcher({
    endpoint: "/api/ticker-history",
    fetchWithTimeout: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, rows: [{ date: "2026-08-26", close: 74000 }] }),
      };
    },
    appendCacheBust: (url) => `${url}&cache=1`,
    isLocalRuntime: false,
    getAccessToken: () => "secret",
    normalizePoints: (rows, ticker) => rows.map((row) => ({ ...row, ticker })),
    timeoutMs: 1234,
  });

  assert.deepEqual(await fetchHistory("005930.ks", { sinceDate: "2026-08-01-extra" }), [
    { date: "2026-08-26", close: 74000, ticker: "005930.KS" },
  ]);
  assert.match(calls[0][0], /ticker=005930\.KS/);
  assert.match(calls[0][0], /since=2026-08-01/);
  assert.equal(calls[0][1].headers.Authorization, "Bearer secret");
  assert.equal(calls[0][2], 1234);
});

test("rejects remote history requests without access while local requests need no token", async () => {
  const remote = createPreferredTickerHistoryFetcher({
    endpoint: "/api/ticker-history",
    fetchWithTimeout: async () => assert.fail("network must not run without access"),
    normalizePoints: (rows) => rows,
    isLocalRuntime: false,
  });
  await assert.rejects(remote("005930.KS"), /access token is unavailable/);

  let requestedUrl = "";
  const local = createPreferredTickerHistoryFetcher({
    endpoint: "/api/ticker-history",
    fetchWithTimeout: async (url, init) => {
      requestedUrl = url;
      assert.deepEqual(init.headers, {});
      return { ok: true, status: 200, json: async () => ({ ok: true, rows: [] }) };
    },
    normalizePoints: (rows) => rows,
    isLocalRuntime: true,
  });
  assert.deepEqual(await local("005930.KS"), []);
  assert.match(requestedUrl, /full=1/);
  assert.deepEqual(await local("not-a-ticker"), []);
});
test("owns ticker payload state behind one app runtime boundary", () => {
  let payload = { series: [], labels: {}, records: [] };
  let changed = 0;
  const runtime = createTickerPriceAppRuntime({
    tickerPriceRuntime,
    tickerCacheInvalidation: createTickerCacheInvalidationContract(
      cacheLifecycle,
    ),
    cacheLifecycle,
    getPayload: () => payload,
    setPayload: (value) => { payload = value; },
    volumesByTicker: new Map(),
    toNumber: (value) => (value == null || !Number.isFinite(Number(value)) ? null : Number(value)),
    sameNumber: (left, right) => left === right,
    normalizePricePoints: (points) => [...points]
      .filter((point) => Number.isFinite(Number(point?.close)))
      .sort((left, right) => left.date.localeCompare(right.date)),
    isMarketPricePoint: () => true,
    expectedLatestTradingDate: () => "2026-08-26",
    getDisplayName: () => "삼성전자",
    setDisplayName() {},
    onClearSeries() {},
    onPayloadChanged: () => { changed += 1; },
    assertPricePoints() {},
    getStatus: () => null,
    setStatus() {},
    dayMs: 86_400_000,
  });

  assert.equal(runtime.mergeSeries("005930.ks", [
    { date: "2026-08-25", close: 73_000, volume: 10 },
    { date: "2026-08-26", close: 74_000, volume: 20 },
  ]), true);
  assert.equal(runtime.latestDate("005930.KS"), "2026-08-26");
  assert.deepEqual(runtime.points("005930.KS"), [
    { date: "2026-08-25", close: 73_000, volume: 10 },
    { date: "2026-08-26", close: 74_000, volume: 20 },
  ]);
  assert.equal(changed, 1);

  runtime.clearSeries("005930.KS");
  assert.deepEqual(runtime.points("005930.KS"), []);
  assert.equal(changed, 2);
});

test("reads the current stock-research history schema instead of discarding its cache", async () => {
  const ticker = "018260.KS";
  const rows = Array.from({ length: 252 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    close: 100000 + index,
    volume: 1000 + index,
  }));
  const researchRecord = {
    schema: 2,
    ticker,
    savedAt: Date.now(),
    lastAccessed: Date.now(),
    historyCoverage: "partial",
    historyCoverageVersion: tickerPriceRuntime.HISTORY_COVERAGE_VERSION,
    rows,
  };
  const runtime = createTickerPriceAppRuntime({
    tickerPriceRuntime,
    tickerCacheInvalidation: createTickerCacheInvalidationContract(cacheLifecycle),
    cacheLifecycle,
    getPayload: () => ({ records: [] }),
    setPayload() {},
    volumesByTicker: new Map(),
    toNumber: Number,
    sameNumber: (left, right) => left === right,
    normalizePricePoints: (points) => [...(points || [])],
    isMarketPricePoint: () => true,
    getDisplayName: () => "삼성에스디에스",
    priceStoreName: "tickerPrices",
    researchStoreName: "tickerResearchHistory",
    cacheSchema: 5,
    researchCacheSchema: 2,
    readRecords: async (storeName) => new Map(storeName === "tickerResearchHistory"
      ? [[ticker, researchRecord]]
      : []),
  });

  const records = await runtime.readResearchHistories([ticker]);
  assert.equal(records.get(ticker)?.schema, 2);
  assert.equal(records.get(ticker)?.rows.length, 252);
});

test("shares ticker network loads while preserving cache-only reads and forced refresh order", async () => {
  const registry = createSharedRequestRegistry();
  const releases = [];
  const calls = [];
  const run = createTickerPriceRequestRunner(registry, (ticker, options = {}) => {
    calls.push({ ticker, force: options.forceRefresh === true, signal: options.signal });
    if (options.returnAfterCache === true) return Promise.resolve("cache");
    return new Promise((resolve) => releases.push(resolve));
  });

  assert.equal(await run("005930.ks", { returnAfterCache: true }), "cache");
  const normalA = run("005930.KS");
  const normalB = run("005930.KS");
  await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].signal instanceof AbortSignal, true);
  releases.shift()("normal");
  assert.equal(await normalA, "normal");
  assert.equal(await normalB, "normal");

  const normal = run("005930.KS");
  await Promise.resolve();
  const forcedA = run("005930.KS", { forceRefresh: true });
  const forcedB = run("005930.KS", { forceRefresh: true });
  releases.shift()("stale");
  assert.equal(await normal, "stale");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((entry) => entry.force).length, 1);
  releases.shift()("fresh");
  assert.equal(await forcedA, "fresh");
  assert.equal(await forcedB, "fresh");
  assert.ok(registry.stats().sharedHits >= 2);
});
