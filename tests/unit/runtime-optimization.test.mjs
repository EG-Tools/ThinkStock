import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/shared-request-registry.js");
await import("../../docs/modules/dart-request-runtime.js");
await import("../../docs/modules/ai-forecast-input-cache.js");

test("DART request runtime shares normal work and queues one forced refresh", async () => {
  const registry = globalThis.ThinkStockSharedRequestRegistry.createSharedRequestRegistry();
  const runtime = globalThis.ThinkStockDartRequestRuntime.createDartRequestRuntime(registry);
  let runs = 0;
  let release;
  const first = runtime.run("seed", "005930.KS", async () => {
    runs += 1;
    await new Promise((resolve) => { release = resolve; });
    return "normal";
  });
  const shared = runtime.run("seed", "005930.KS", async () => "duplicate");
  const forced = runtime.run("seed", "005930.KS", async () => {
    runs += 1;
    return "forced";
  }, { force: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  assert.equal(await first, "normal");
  assert.equal(await shared, "normal");
  assert.equal(await forced, "forced");
  assert.equal(runs, 2);
  assert.deepEqual(runtime.identities("seed"), []);
});

test("DART request runtime exposes pending identities by request kind", async () => {
  const registry = globalThis.ThinkStockSharedRequestRegistry.createSharedRequestRegistry();
  const runtime = globalThis.ThinkStockDartRequestRuntime.createDartRequestRuntime(registry);
  let release;
  const request = runtime.run("insider", "005930.KS", () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(runtime.identities("insider"), ["005930.KS"]);
  release([]);
  await request;
});

test("DART event lifecycle scopes work to visible stocks and coalesces insider refresh", async () => {
  const disclosureCalls = [];
  const insiderCalls = [];
  const pendingCounts = [];
  const timers = new Map();
  let timerId = 0;
  const lifecycle = globalThis.ThinkStockDartRequestRuntime.createDartEventLifecycle({}, {
    tickerPattern: /^[0-9]{6}\.(KS|KQ)$/,
    getStocks: () => [
      { ticker: "005930.KS" },
      { ticker: "000660.KS" },
      { ticker: "005930.KS" },
      { ticker: "invalid" },
    ],
    isHidden: (ticker) => ticker === "000660.KS",
    isInsiderEnabled: () => true,
    canUseGateway: () => true,
    hasRequest: () => false,
    concurrency: 2,
    mapWithConcurrency: async (items, _limit, mapper) => Promise.all(items.map(mapper)),
    requestDisclosure: async (ticker) => { disclosureCalls.push(ticker); return []; },
    requestInsider: async (ticker) => { insiderCalls.push(ticker); return [{ ticker }]; },
    onPendingChange: (count) => pendingCounts.push(count),
    setTimer: (callback) => { timerId += 1; timers.set(timerId, callback); return timerId; },
    clearTimer: (id) => timers.delete(id),
  });

  assert.deepEqual(lifecycle.targetTickers(), ["005930.KS", "000660.KS"]);
  assert.deepEqual(lifecycle.targetTickers({ visible: true }), ["005930.KS"]);
  await lifecycle.prepareVisibleDisclosures(null);
  assert.deepEqual(disclosureCalls, ["005930.KS"]);
  lifecycle.setInsiderPending("005930.KS", true);
  lifecycle.setInsiderPending("005930.KS", false);
  assert.deepEqual(pendingCounts, [1, 0]);
  assert.equal(lifecycle.scheduleInsiderRefresh(), true);
  assert.equal(lifecycle.scheduleInsiderRefresh(), false);
  await timers.get(1)();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(insiderCalls, ["005930.KS"]);
  lifecycle.markInsiderLoaded("005930.KS");
  assert.equal(lifecycle.isInsiderLoaded("005930.KS"), true);
  assert.equal(lifecycle.scheduleInsiderRefresh(), false);
  assert.deepEqual(lifecycle.snapshot().visibleTickers, ["005930.KS"]);
});

test("progressive DART records merge pages and expose stable progress", async () => {
  const pages = [];
  const progress = [];
  const rows = await globalThis.ThinkStockDartRequestRuntime.fetchProgressiveRecords({
    since: "2026-08-01",
    fetchPage: async ({ page, since }) => {
      pages.push([page, since]);
      return page === 1
        ? { records: [{ id: 1 }], page: 1, totalPages: 2, nextPage: 2, checkedFrom: "2026-08-10" }
        : { records: [{ id: 2 }], page: 2, totalPages: 2, nextPage: null, complete: true };
    },
    normalizeRecords: (records) => records,
    mergeRecords: (existing, incoming) => [...existing, ...incoming],
    onBatch: (_batch, state) => progress.push(state),
  });

  assert.deepEqual(pages, [[1, "2026-08-01"], [2, "2026-08-10"]]);
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
  assert.equal(progress[0].complete, false);
  assert.equal(progress[1].complete, true);
  assert.equal(progress[1].accumulatedCount, 2);
});

test("AI input cache reuses projections and evicts the oldest entry", () => {
  const cache = globalThis.ThinkStockAiForecastInputCache.createAiForecastInputCache({ maxEntries: 2 });
  let builds = 0;
  const resolve = (key) => cache.resolve(key, () => ({ key, build: ++builds }));
  assert.equal(resolve("a"), resolve("a"));
  resolve("b");
  resolve("c");
  assert.equal(resolve("a").build, 4);
  assert.equal(cache.stats().entries, 2);
});

test("AI series revision stays stable when only an unrelated global price revision changes", () => {
  let fingerprints = 0;
  const cache = globalThis.ThinkStockAiForecastInputCache.createSeriesRevisionCache({
    maxEntries: 2,
    fingerprint: (rows, keys) => {
      fingerprints += 1;
      return JSON.stringify([rows, keys]);
    },
  });
  const rows = [{ date: "2026-08-20", "005930.KS": 70000, "^KS11": 3200 }];
  const first = cache.resolve("005930.KS", rows, "global-a", ["005930.KS", "^KS11"]);
  const cached = cache.resolve("005930.KS", rows, "global-a", ["005930.KS", "^KS11"]);
  const unrelatedRevision = cache.resolve("005930.KS", rows, "global-b", ["005930.KS", "^KS11"]);

  assert.equal(cached, first);
  assert.equal(unrelatedRevision, first);
  assert.equal(fingerprints, 2);
});
