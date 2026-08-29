import assert from "node:assert/strict";
import test from "node:test";
import {
  bindStockResearchWorker,
  createStockResearchWorkerRuntime,
} from "../../docs/modules/stock-research-worker-runtime.mjs";
const { default: stockResearchController } = await import(
  "../../docs/modules/stock-research-controller.js"
);

function createRuntime() {
  return createStockResearchWorkerRuntime({
    macd: { buildMacdOscillator: () => ({}) },
    timing: {
      PROMOTED_RUNTIME_BEHAVIOR_POLICY: { enabled: true },
      buildKoreanVolatilityTimingRows: () => [{ date: "2026-08-28", value: 20 }],
      buildExternalVolatilityTimingRows: () => [{ date: "2026-08-28", value: 15 }],
      buildMarketTimingSignals: () => ({ signals: [], sellSignals: [] }),
    },
    timingService: {
      sharedTimingFingerprint: () => "shared-1",
      validTimingCacheRecord: () => false,
      createTimingCacheRecord: (ticker, sources, model, fingerprint) => ({
        ticker, dates: sources.dates, model, fingerprint,
      }),
    },
    research: {
      assessTicker: (options) => {
        options.onTimingModel({ regime: "test" });
        return { ticker: options.item.ticker, count: options.rows.length };
      },
    },
  });
}

test("stock research worker runtime owns shared initialization and analysis state", () => {
  const runtime = createRuntime();
  assert.deepEqual(runtime.handle({ id: 1, type: "init", shared: {
    kospiRows: [{ date: "2026-08-28", close: 3000 }],
    kosdaqRows: [],
    adrRows: [],
    macroRows: [],
    creditRows: [],
    crisisRows: [],
  } }), { id: 1, ready: true });
  assert.equal(runtime.isReady(), true);
  const response = runtime.handle({
    id: 2,
    item: { ticker: "005930.KS", market: "KOSPI" },
    rows: [{ date: "2026-08-28", close: 81000, volume: 100 }],
  });
  assert.deepEqual(response.candidate, { ticker: "005930.KS", count: 1 });
  assert.deepEqual(response.timingCacheRecord, {
    ticker: "005930.KS",
    dates: ["2026-08-28"],
    model: { regime: "test" },
    fingerprint: "shared-1",
  });
});

test("stock research worker binding converts runtime failures into worker responses", () => {
  const messages = [];
  const scope = { postMessage: (message) => messages.push(message), onmessage: null };
  const binding = bindStockResearchWorker(scope, createRuntime());
  scope.onmessage({ data: { id: 7, item: { ticker: "005930.KS" }, rows: [] } });
  assert.match(messages[0].error, /공통 데이터/);
  binding.dispose();
  assert.equal(scope.onmessage, null);
});

test("stock research controller options share one indexed cache adapter", async () => {
  const calls = [];
  const store = {
    readRecord: async (...args) => { calls.push(["read", ...args]); return null; },
    readRecords: async (...args) => { calls.push(["readMany", ...args]); return new Map(); },
    writeRecord: async (...args) => { calls.push(["write", ...args]); },
    writeRecords: async (...args) => { calls.push(["writeMany", ...args]); },
    clearStore: async (...args) => { calls.push(["clear", ...args]); },
  };
  const noop = () => {};
  const options = stockResearchController.createControllerOptions({
    indexedCacheStore: store,
    storeNames: { history: "history", results: "results", timing: "timing" },
    readHistory: async () => null,
    readHistoryMany: async () => new Map(),
    schedulePrune: (...args) => calls.push(["prune", ...args]),
    getAccessToken: () => "",
    fetchWithTimeout: noop,
    getExpectedLatestTradingDate: () => "2026-08-28",
    getSignalPriceMode: () => "settled",
    getSignalSettlementDelayMs: () => 0,
    canRun: () => true,
    createProgressView: noop,
    getData: () => ({}),
    isAdded: () => false,
    addStock: noop,
    removeStock: noop,
  });
  await options.resultCache.write("buy", { candidates: [] });
  await options.timingCache.readMany(["005930.KS"]);
  options.historyCache.prune();
  assert.deepEqual(calls, [
    ["write", "results", "buy", { candidates: [] }],
    ["readMany", "timing", ["005930.KS"]],
    ["prune", "history", 420],
  ]);
});
