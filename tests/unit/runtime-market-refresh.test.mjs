import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeIndexRefreshService,
  createRuntimeMarketRefresh,
  normalizeTickerPoints,
  planKoreanPriceRefresh,
} from "../../docs/modules/runtime-market-refresh.mjs";
import * as seriesMerge from "../../docs/modules/runtime-series-merge.mjs";

function withTransactions(controller) {
  return {
    ...controller,
    beginTransaction(name) {
      return {
        rows: () => [],
        stage: (result, keys, options = {}) => {
          if (name === "credit") {
            return controller.applyCreditLiveRows(result, keys, options.label);
          }
          if (name === "macro") return controller.commitMacroBuild(result, keys, options);
          return result;
        },
        commit: () => true,
      };
    },
  };
}

test("price refresh planning checks live values but reuses a settled weekend tail", () => {
  const tickers = ["005930.KS"];
  const live = planKoreanPriceRefresh({
    tickers,
    latestDates: { "005930.KS": "2026-08-21" },
    now: new Date("2026-08-21T00:01:00Z"),
  });
  assert.equal(live.live, true);
  assert.deepEqual(live.requiredTickers, tickers);

  const weekend = planKoreanPriceRefresh({
    tickers,
    latestDates: { "005930.KS": "2026-08-21" },
    now: new Date("2026-08-22T03:00:00Z"),
  });
  assert.equal(weekend.live, false);
  assert.equal(weekend.targetDate, "2026-08-21");
  assert.deepEqual(weekend.requiredTickers, []);
  assert.deepEqual(weekend.skippedTickers, tickers);
});

test("price refresh planning requests first use, stale tails, and explicit refreshes", () => {
  const tickers = ["005930.KS"];
  const now = new Date("2026-08-22T03:00:00Z");
  assert.deepEqual(planKoreanPriceRefresh({ tickers, latestDates: {}, now }).requiredTickers, tickers);
  assert.deepEqual(planKoreanPriceRefresh({
    tickers,
    latestDates: { "005930.KS": "2026-08-20" },
    now,
  }).requiredTickers, tickers);
  assert.deepEqual(planKoreanPriceRefresh({
    tickers,
    latestDates: { "005930.KS": "2026-08-21" },
    forceNetwork: true,
    now,
  }).requiredTickers, tickers);
});

test("index refresh requests and preserves volume history needed by timing signals", async () => {
  const merged = new Map();
  let requestedSince = "";
  const records = Array.from({ length: 30 }, (_, index) => ({
    ticker: "^KS11",
    date: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10),
    close: 3000 + index,
    volume: 100000 + index,
  }));
  const service = createRuntimeIndexRefreshService({
    appVersion: "test",
    canUseGateway: () => true,
    gatewayClient: {
      fetchIndices: async ({ since }) => {
        requestedSince = since;
        return { ok: true, records };
      },
    },
    getPricePayload: () => ({
      records: [{ date: "2026-07-30", "^KS11": 3029 }],
    }),
    hasVolumeHistory: () => false,
    isLocalRuntime: false,
    labelName: (ticker) => ticker,
    mergeTickerSeries: (ticker, points) => merged.set(ticker, points),
    throwIfAborted: () => {},
    toNumber: Number,
  });

  await service.refresh({ tickers: ["^KS11"], now: new Date("2026-09-05T00:00:00Z") });

  assert.equal(requestedSince, "2026-05-08");
  assert.equal(merged.get("^KS11").length, 30);
  assert.equal(merged.get("^KS11").at(-1).volume, 100029);
  assert.deepEqual(normalizeTickerPoints(records.slice(0, 1), "^KS11"), [{
    date: "2026-07-01",
    close: 3000,
    volume: 100000,
  }]);
});

test("macro refresh keeps healthy components when another component fails", async () => {
  const controller = withTransactions({
    buildLeadingCycleLiveRows: (rows) => rows,
    buildNewsSentimentLiveRows: (rows) => rows,
    buildMacroIndicatorLiveRows: (rows) => rows,
    commitMacroBuild: (_rows, keys) => {
      if (keys.includes("leading_cycle")) throw new Error("leading rejected");
      return { latestDate: "2026-08-19", updated: 1 };
    },
  });
  const refresh = createRuntimeMarketRefresh({
    gateway: {
      fetchMacro: async () => ({
        leadingRows: [{ date: "2026-06-01", leading_cycle: 104 }],
        newsRows: [{ date: "2026-08-19", news_sentiment: 101 }],
        policyRateRows: [],
        tradeRows: [],
      }),
    },
    getSeriesController: () => controller,
    isLocal: true,
  });

  const result = await refresh.refreshMacro();
  assert.equal(result.components["macro:leading"].ok, false);
  assert.equal(result.components["macro:news"].ok, true);
  assert.equal(result.latestDate, "2026-08-19");
  assert.match(result.warnings[0], /이전 값 유지/);
});

test("credit refresh isolates each balance series and reports its own date", async () => {
  const controller = withTransactions({
    scaleCreditRowsToExisting: (rows) => rows,
    buildCreditLiveRows: (rows) => rows,
    applyCreditLiveRows: (_rows, keys) => {
      if (keys[0] === "kospi_credit") throw new Error("kospi rejected");
      return {
        latestDate: keys[0] === "customer_deposit" ? "2026-08-18" : "2026-08-19",
        updated: 1,
      };
    },
  });
  const refresh = createRuntimeMarketRefresh({
    gateway: { fetchCredit: async () => ({ rows: [{ date: "2026-08-19" }] }) },
    getSeriesController: () => controller,
    getCreditRows: () => [],
    creditKeys: ["customer_deposit", "kospi_credit", "kosdaq_credit"],
    isLocal: true,
  });

  const result = await refresh.refreshCredit();
  assert.equal(result.components["credit:customer_deposit"].ok, true);
  assert.equal(result.components["credit:kospi_credit"].ok, false);
  assert.equal(result.components["credit:kosdaq_credit"].latestDate, "2026-08-19");
  assert.equal(result.latestDate, "2026-08-19");
  assert.equal(result.applied.length, 1);
});

test("crisis refresh commits both US spread series through the macro path", async () => {
  const committed = [];
  const controller = withTransactions({
    buildMacroIndicatorLiveRows: (rows, keys, _targets, options) => {
      assert.equal(options.positiveOnly, false);
      return rows;
    },
    commitMacroBuild: (rows, keys) => {
      committed.push({ rows, keys });
      return { latestDate: rows.at(-1)?.date || "", updated: rows.length };
    },
    applyCrisisSignalRows: () => ({ latestDate: "", updated: 0 }),
    buildAuxiliarySeriesRows: () => ({ latestDate: "", updated: 0 }),
  });
  const refresh = createRuntimeMarketRefresh({
    gateway: { fetchCrisisSignal: async () => ({
      records: [],
      termSpreadRows: [{ date: "2026-08-28", t10y1y: 0.39 }],
      creditSpreadRows: [{ date: "2026-08-01", us_credit_spread: 0.66 }],
      vkospiRows: [],
      vixRows: [],
    }) },
    getSeriesController: () => controller,
    isLocal: true,
  });

  const result = await refresh.refreshCrisis();

  assert.deepEqual(committed.map((entry) => entry.keys), [
    ["t10y1y"],
    ["us_credit_spread"],
  ]);
  assert.equal(result.components["macro:termSpread"].ok, true);
  assert.equal(result.components["macro:creditSpread"].ok, true);
  assert.equal(result.latestDate, "2026-08-28");
});

test("crisis refresh accepts a healthy recent VKOSPI segment after a short provider gap", async () => {
  const state = {
    macro: [],
    adr: [{ date: "2026-08-10", vkospi: 18 }],
    crisis: [],
  };
  const controller = seriesMerge.createRuntimeSeriesController({
    getRows: (name) => state[name],
    setRows: (name, rows) => { state[name] = rows; },
    policiesFor: seriesMerge.policiesFor,
    validate: (label, currentRows, candidateRows, incomingRows, keys, options = {}) => (
      seriesMerge.assertRows({
        label,
        currentRows,
        candidateRows,
        incomingRows,
        keys,
        policies: seriesMerge.policiesFor(keys),
        ...options,
      })
    ),
  });
  const vkospiRows = Array.from({ length: 18 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 7, 18 + index)).toISOString().slice(0, 10),
    vkospi: 20 + (index * 0.1),
  })).filter((row) => ![0, 6].includes(new Date(`${row.date}T00:00:00Z`).getUTCDay()));
  const refresh = createRuntimeMarketRefresh({
    gateway: { fetchCrisisSignal: async () => ({
      records: [],
      termSpreadRows: [],
      creditSpreadRows: [],
      vkospiRows,
      vixRows: [],
    }) },
    getSeriesController: () => controller,
    policiesFor: seriesMerge.policiesFor,
    isLocal: true,
  });

  const result = await refresh.refreshCrisis();

  assert.equal(result.components["volatility:vkospi"].ok, true);
  assert.equal(state.adr.at(-1).date, vkospiRows.at(-1).date);
  assert.equal(state.adr.at(-1).vkospi, vkospiRows.at(-1).vkospi);
});

test("an aborted market response cannot mutate shared series", async () => {
  const request = new AbortController();
  let commits = 0;
  const refresh = createRuntimeMarketRefresh({
    gateway: {
      fetchMacro: async () => {
        request.abort();
        return {
          leadingRows: [{ date: "2026-08-01", leading_cycle: 101 }],
          newsRows: [],
          policyRateRows: [],
          tradeRows: [],
        };
      },
    },
    getSeriesController: () => ({
      buildLeadingCycleLiveRows: (rows) => rows,
      commitMacroBuild: () => {
        commits += 1;
        return { latestDate: "2026-08-01", updated: 1 };
      },
    }),
    isLocal: true,
  });

  await assert.rejects(refresh.refreshMacro(request.signal), { name: "AbortError" });
  assert.equal(commits, 0);
});

test("fear-greed skips full history when the lightweight latest point is unchanged", async () => {
  const calls = [];
  const refresh = createRuntimeMarketRefresh({
    gateway: {
      fetchFearGreed: async ({ latestOnly }) => {
        calls.push(latestOnly ? "latest" : "history");
        return {
          latestDate: "2026-09-04",
          rows: [{ date: "2026-09-04", fear_greed: 32 }],
        };
      },
    },
    getAdrRows: () => [{ date: "2026-09-04", fear_greed: 32 }],
    getSeriesController: () => ({ beginTransaction: () => { throw new Error("must not merge"); } }),
    isLocal: true,
  });

  const result = await refresh.refreshFearGreed();
  assert.deepEqual(calls, ["latest"]);
  assert.equal(result.updated, 0);
  assert.equal(result.latestDate, "2026-09-04");
});

test("fear-greed downloads and commits history only after the latest point changes", async () => {
  const calls = [];
  const state = { adr: [{ date: "2026-09-03", fear_greed: 31 }] };
  let commits = 0;
  const controller = seriesMerge.createRuntimeSeriesController({
    getRows: (name) => state[name] || [],
    setRows: (name, rows) => { state[name] = rows; commits += 1; },
    policiesFor: seriesMerge.policiesFor,
    validate: (_label, _current, candidate) => ({ rows: candidate }),
  });
  const refresh = createRuntimeMarketRefresh({
    gateway: {
      fetchFearGreed: async ({ latestOnly }) => {
        calls.push(latestOnly ? "latest" : "history");
        return latestOnly
          ? { latestDate: "2026-09-04", rows: [{ date: "2026-09-04", fear_greed: 32 }] }
          : { latestDate: "2026-09-04", rows: [
            { date: "2026-09-03", fear_greed: 31 },
            { date: "2026-09-04", fear_greed: 32 },
          ] };
      },
    },
    getAdrRows: () => state.adr,
    getSeriesController: () => controller,
    isLocal: true,
  });

  const result = await refresh.refreshFearGreed();
  assert.deepEqual(calls, ["latest", "history"]);
  assert.equal(result.updated, 1);
  assert.equal(commits, 1);
  assert.deepEqual(state.adr.at(-1), { date: "2026-09-04", fear_greed: 32 });
});

test("ADR commits both market series in one shared transaction", async () => {
  const calls = [];
  const state = { adr: [{ date: "2026-09-03", adr_kospi: 100, adr_kosdaq: 90 }] };
  let commits = 0;
  const controller = seriesMerge.createRuntimeSeriesController({
    getRows: (name) => state[name] || [],
    setRows: (name, rows) => { state[name] = rows; commits += 1; },
    policiesFor: seriesMerge.policiesFor,
    validate: (_label, _current, candidate) => ({ rows: candidate }),
  });
  const refresh = createRuntimeMarketRefresh({
    gateway: {
      fetchAdr: async ({ latestOnly }) => {
        calls.push(latestOnly ? "latest" : "history");
        return latestOnly
          ? { latestDate: "2026-09-04", rows: [{ date: "2026-09-04", adr_kospi: 101, adr_kosdaq: 91 }] }
          : { latestDate: "2026-09-04", rows: [
            { date: "2026-09-03", adr_kospi: 100, adr_kosdaq: 90 },
            { date: "2026-09-04", adr_kospi: 101, adr_kosdaq: 91 },
          ] };
      },
    },
    adrKeys: ["adr_kospi", "adr_kosdaq"],
    getAdrRows: () => state.adr,
    getAdrBenchmarkDate: () => "2026-09-04",
    getSeriesController: () => controller,
    isLocal: true,
  });

  const result = await refresh.refreshAdr();
  assert.deepEqual(calls, ["latest", "history"]);
  assert.equal(result.updated, 2);
  assert.equal(commits, 1);
  assert.deepEqual(state.adr.at(-1), {
    date: "2026-09-04",
    adr_kospi: 101,
    adr_kosdaq: 91,
  });
});
