import assert from "node:assert/strict";
import test from "node:test";

import * as module from "../../docs/modules/runtime-market-refresh.mjs";

test("requests and merges only the missing validated index tail", async () => {
  const merged = [];
  let request = null;
  const service = module.createRuntimeIndexRefreshService({
    isLocalRuntime: true,
    fetchWithTimeout: async () => new Response(JSON.stringify({ ok: true, restartRequired: true })),
    gatewayClient: {
      fetchIndices: async (options) => {
        request = options;
        return {
          ok: true,
          records: [
            { ticker: "^KS11", date: "2026-08-10", close: 3210 },
            { ticker: "^KS11", date: "2026-08-07", close: 3190 },
            { ticker: "^KQ11", date: "2026-08-10", close: 1012 },
          ],
        };
      },
    },
    getPricePayload: () => ({
      records: [{ date: "2026-07-14", "^KS11": 3000, "^KQ11": 900 }],
    }),
    mergeTickerSeries: (ticker, points) => merged.push({ ticker, points }),
    labelName: (ticker) => ticker,
    toNumber: (value) => value == null ? null : Number(value),
    timeoutMs: 12000,
  });

  const result = await service.refresh({ forceNetwork: true });
  assert.equal(request.since, "2026-07-14");
  assert.equal(request.forceNetwork, true);
  assert.deepEqual(merged[0].points.map((point) => point.date), ["2026-08-07", "2026-08-10"]);
  assert.equal(result.applied.length, 2);
  assert.match(result.warnings[0], /로컬 서버 업데이트/);
});

test("refreshes only the index selected by the shared critical plan", async () => {
  const merged = [];
  const service = module.createRuntimeIndexRefreshService({
    isLocalRuntime: false,
    canUseGateway: () => true,
    gatewayClient: {
      fetchIndices: async () => ({
        ok: true,
        records: [
          { ticker: "^KS11", date: "2026-08-21", close: 3200 },
          { ticker: "^KQ11", date: "2026-08-21", close: 1010 },
        ],
      }),
    },
    getPricePayload: () => ({ records: [] }),
    mergeTickerSeries: (ticker) => merged.push(ticker),
    labelName: (ticker) => ticker,
    toNumber: Number,
  });

  await service.refresh({ tickers: ["^KQ11"] });
  assert.deepEqual(merged, ["^KQ11"]);
});

test("rethrows transient failures for the shared retry layer", async () => {
  const service = module.createRuntimeIndexRefreshService({
    isLocalRuntime: false,
    canUseGateway: () => true,
    gatewayClient: {
      fetchIndices: async () => {
        const error = new Error("fetch failed");
        error.status = 503;
        throw error;
      },
    },
    getPricePayload: () => ({ records: [] }),
    mergeTickerSeries: () => {},
    isRetryableError: (error) => error.status === 503,
  });
  await assert.rejects(service.refresh(), /fetch failed/);
});

test("keeps the previous index when the shared quality gate rejects a tail", async () => {
  const merged = [];
  const service = module.createRuntimeIndexRefreshService({
    isLocalRuntime: true,
    fetchWithTimeout: async () => new Response(JSON.stringify({ ok: true })),
    gatewayClient: {
      fetchIndices: async () => ({
        ok: true,
        records: [
          { ticker: "^KS11", date: "2026-08-12", close: 4700 },
          { ticker: "^KQ11", date: "2026-08-12", close: 1020 },
        ],
      }),
    },
    getPricePayload: () => ({ records: [{ date: "2026-08-11", "^KS11": 3200, "^KQ11": 1000 }] }),
    mergeTickerSeries: (ticker) => merged.push(ticker),
    validateTickerPoints: (ticker) => {
      if (ticker === "^KS11") throw new Error("introduced anomaly");
    },
    labelName: (ticker) => ticker,
    toNumber: Number,
  });

  const result = await service.refresh();
  assert.deepEqual(merged, ["^KQ11"]);
  assert.equal(result.applied.length, 1);
  assert.match(result.warnings[0], /\^KS11/);
});

test("warns when the running local server is older than the loaded app", async () => {
  const service = module.createRuntimeIndexRefreshService({
    appVersion: "2.65",
    isLocalRuntime: true,
    fetchWithTimeout: async () => new Response(JSON.stringify({
      ok: true,
      appVersion: "2.57",
      restartRequired: false,
    })),
    gatewayClient: {
      fetchIndices: async () => ({
        ok: true,
        records: [
          { ticker: "^KS11", date: "2026-08-12", close: 3250 },
          { ticker: "^KQ11", date: "2026-08-12", close: 1020 },
        ],
      }),
    },
    getPricePayload: () => ({ records: [] }),
    mergeTickerSeries: () => {},
    labelName: (ticker) => ticker,
    toNumber: Number,
  });

  const result = await service.refresh();
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /로컬 서버 업데이트 감지/);
});
