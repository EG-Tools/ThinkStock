import assert from "node:assert/strict";
import test from "node:test";

import { createSharedRequestRegistry } from "../../docs/modules/shared-request-registry.mjs";
  const dartRequestRuntimeModule = await import("../../docs/modules/dart-request-runtime.mjs");
import {
  createAiForecastInputCache,
  createSeriesRevisionCache,
} from "../../docs/modules/ai-forecast-app.mjs";

test("DART request runtime shares normal work and queues one forced refresh", async () => {
    const registry = createSharedRequestRegistry();
    const runtime = dartRequestRuntimeModule.createDartRequestRuntime(registry);
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
    const registry = createSharedRequestRegistry();
    const runtime = dartRequestRuntimeModule.createDartRequestRuntime(registry);
  let release;
  const request = runtime.run("insider", "005930.KS", () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(runtime.identities("insider"), ["005930.KS"]);
  release([]);
  await request;
});

test("DART request runtime cancels one ticker or an entire request kind", async () => {
  const registry = createSharedRequestRegistry();
  const runtime = dartRequestRuntimeModule.createDartRequestRuntime(registry);
  const waitForAbort = (signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const samsung = runtime.run("insider", "005930.KS", waitForAbort);
  const hynix = runtime.run("insider", "000660.KS", waitForAbort);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtime.cancel("insider", "005930.KS"), true);
  await assert.rejects(samsung, { name: "AbortError" });
  assert.deepEqual(runtime.identities("insider"), ["000660.KS"]);
  assert.equal(runtime.cancelKind("insider"), 1);
  await assert.rejects(hynix, { name: "AbortError" });
  assert.deepEqual(runtime.identities("insider"), []);
});

test("shared DART work owns one progress lifecycle", async () => {
    const registry = createSharedRequestRegistry();
    const runtime = dartRequestRuntimeModule.createDartRequestRuntime(registry);
  const events = [];
  const progress = {
    begin: (key) => { events.push(["begin", key]); return true; },
    update: (key, value) => { events.push(["update", key, value]); return true; },
    complete: (key) => { events.push(["complete", key]); return true; },
  };
  let release;
  const first = runtime.runTracked("insider", "005930.KS", async (_signal, task) => {
    task.update(0.5);
    await new Promise((resolve) => { release = resolve; });
    return "first";
  }, {
    progress,
    progressKey: "insider:005930.KS",
    progressLabel: "삼성전자 내부거래",
    trackProgress: true,
    initialProgress: 0.1,
  });
  const shared = runtime.runTracked("insider", "005930.KS", async () => "duplicate", {
    progress,
    progressKey: "insider:005930.KS",
    progressLabel: "삼성전자 내부거래",
    trackProgress: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  assert.equal(await first, "first");
  assert.equal(await shared, "first");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events.map(([event]) => event), ["begin", "update", "update", "complete"]);
});

test("visible DART progress can join work that started while its layer was hidden", async () => {
    const registry = createSharedRequestRegistry();
    const runtime = dartRequestRuntimeModule.createDartRequestRuntime(registry);
  const events = [];
  const progress = {
    begin: (key) => { events.push(["begin", key]); return true; },
    update: (key, value) => { events.push(["update", key, value]); return true; },
    complete: (key) => { events.push(["complete", key]); return true; },
  };
  let release;
  const hidden = runtime.runTracked("disclosure", "005930.KS", async (_signal, task) => {
    task.update(0.35);
    await new Promise((resolve) => { release = resolve; });
    return "loaded";
  }, { trackProgress: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const visible = runtime.runTracked("disclosure", "005930.KS", async () => "duplicate", {
    progress,
    progressKey: "disclosure:005930.KS",
    progressLabel: "삼성전자 공시",
    trackProgress: true,
  });
  assert.deepEqual(events, [
    ["begin", "disclosure:005930.KS"],
    ["update", "disclosure:005930.KS", 0.35],
  ]);
  release();
  assert.equal(await hidden, "loaded");
  assert.equal(await visible, "loaded");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events.map(([event]) => event), ["begin", "update", "complete"]);
});

test("DART company context and gateway errors share one validation contract", async () => {
    const dart = dartRequestRuntimeModule;
  assert.equal(dart.normalizeDartTicker(" 005930.ks "), "005930.KS");
  assert.equal(dart.normalizeDartTicker("invalid"), "");
  assert.deepEqual(await dart.resolveDartCompanyContext("005930.KS", {
    ensureCorpCode: async () => true,
    getCorpCode: () => "00126380",
    requireAccessToken: true,
    getAccessToken: () => "saved-token",
  }), {
    ticker: "005930.KS",
    stockCode: "005930",
    corpCode: "00126380",
  });
  await assert.rejects(() => dart.resolveDartCompanyContext("005930.KS", {
    ensureCorpCode: async () => true,
    getCorpCode: () => "00126380",
    requireAccessToken: true,
    getAccessToken: () => "",
  }), /접속 코드를 먼저 저장/);
  const authError = dart.toDartGatewayError({ status: 401 });
  assert.equal(authError.status, 401);
  assert.match(authError.message, /접속 코드가 만료/);
  assert.equal(dart.toDartGatewayError({ status: 429 }).status, 429);
  assert.match(dart.toDartGatewayError(new TypeError("fetch failed")).message, /중계 서버에 연결/);
});

test("DART event lifecycle scopes work to visible stocks and coalesces insider refresh", async () => {
  const disclosureCalls = [];
  const insiderCalls = [];
  const pendingCounts = [];
  const concurrencyLimits = [];
  const timers = new Map();
  let timerId = 0;
    const lifecycle = dartRequestRuntimeModule.createDartEventLifecycle({}, {
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
    mapWithConcurrency: async (items, limit, mapper) => {
      concurrencyLimits.push(limit);
      return Promise.all(items.map(mapper));
    },
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
  assert.deepEqual(concurrencyLimits, [2]);
  lifecycle.setInsiderPending("005930.KS", true);
  lifecycle.setInsiderPending("005930.KS", false);
  assert.deepEqual(pendingCounts, [1, 0]);
  assert.equal(lifecycle.scheduleInsiderRefresh(), true);
  assert.equal(lifecycle.scheduleInsiderRefresh(), false);
  await timers.get(1)();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(insiderCalls, ["005930.KS"]);
  assert.deepEqual(concurrencyLimits, [2, 2]);
  lifecycle.markInsiderLoaded("005930.KS");
  assert.equal(lifecycle.isInsiderLoaded("005930.KS"), true);
  assert.equal(lifecycle.scheduleInsiderRefresh(), false);
  assert.deepEqual(lifecycle.snapshot().visibleTickers, ["005930.KS"]);
});

test("progressive DART records merge pages and expose stable progress", async () => {
  const pages = [];
  const progress = [];
    const rows = await dartRequestRuntimeModule.fetchProgressiveRecords({
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
  const cache = createAiForecastInputCache({ maxEntries: 2 });
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
  const cache = createSeriesRevisionCache({
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
