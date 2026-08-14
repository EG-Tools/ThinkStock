import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/runtime-bootstrap.js");

const { createRuntimeBootstrapService } = globalThis.ThinkStockRuntimeBootstrap;

test("runtime bootstrap sends only visible stock tickers with the oldest index date", async () => {
  let request = null;
  const service = createRuntimeBootstrapService({
    canUseGateway: () => true,
    gatewayClient: { fetchBootstrap: async (options) => { request = options; return { ok: true }; } },
    getCustomStocks: () => [
      { ticker: "005930.KS" },
      { ticker: "247540.KQ" },
      { ticker: "invalid" },
    ],
    getPricePayload: () => ({ records: [] }),
    isHidden: (ticker) => ticker === "247540.KQ",
    latestDatesByTicker: () => ({ "^KS11": "2026-08-11", "^KQ11": "2026-08-10" }),
    timeoutMs: 5000,
    toNumber: Number,
  });

  assert.deepEqual(await service.fetchCritical(), { ok: true });
  assert.deepEqual(request.tickers, ["005930.KS"]);
  assert.equal(request.since, "2026-08-10");
});

test("runtime bootstrap reuses an injected price payload without another request", async () => {
  let priceRequests = 0;
  const statuses = new Map();
  const service = createRuntimeBootstrapService({
    canUseGateway: () => true,
    gatewayClient: { fetchPrices: async () => { priceRequests += 1; return {}; } },
    getTickerStatus: (ticker) => statuses.get(ticker),
    mapWithConcurrency: async () => [],
    setTickerStatus: (ticker, value) => statuses.set(ticker, value),
    toNumber: (value) => Number(value),
  });
  const points = await service.fetchLatestPriceSeriesBatch(["005930.KS"], {
    payload: {
      ok: true,
      results: [{
        ok: true,
        ticker: "005930.KS",
        source: "KRX",
        latestDate: "2026-08-11",
        records: [{ date: "2026-08-11", close: 123 }],
      }],
    },
  });

  assert.equal(priceRequests, 0);
  assert.deepEqual(points.get("005930.KS"), [{ date: "2026-08-11", close: 123 }]);
  assert.equal(statuses.get("005930.KS").source, "KRX");
});

test("runtime bootstrap forwards forced refreshes to fallback price batches", async () => {
  const requests = [];
  const service = createRuntimeBootstrapService({
    canUseGateway: () => true,
    gatewayClient: {
      fetchPrices: async (tickers, options) => {
        requests.push({ tickers, options });
        return { ok: true, results: [] };
      },
    },
    mapWithConcurrency: async (items, _limit, task) => Promise.all(items.map(task)),
    toNumber: Number,
  });

  await service.fetchLatestPriceSeriesBatch(["005930.KS", "000660.KS"], {
    forceNetwork: true,
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].tickers, ["005930.KS", "000660.KS"]);
  assert.equal(requests[0].options.forceNetwork, true);
});
