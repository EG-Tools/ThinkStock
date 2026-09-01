import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeMarketRefresh,
  planKoreanPriceRefresh,
} from "../../docs/modules/runtime-market-refresh.mjs";

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

test("macro refresh keeps healthy components when another component fails", async () => {
  const controller = {
    buildLeadingCycleLiveRows: (rows) => rows,
    buildNewsSentimentLiveRows: (rows) => rows,
    buildMacroIndicatorLiveRows: (rows) => rows,
    commitMacroBuild: (_rows, keys) => {
      if (keys.includes("leading_cycle")) throw new Error("leading rejected");
      return { latestDate: "2026-08-19", updated: 1 };
    },
  };
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
  const controller = {
    scaleCreditRowsToExisting: (rows) => rows,
    applyCreditLiveRows: (_rows, keys) => {
      if (keys[0] === "kospi_credit") throw new Error("kospi rejected");
      return {
        latestDate: keys[0] === "customer_deposit" ? "2026-08-18" : "2026-08-19",
        updated: 1,
      };
    },
  };
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
  const controller = {
    buildMacroIndicatorLiveRows: (rows, keys, _targets, options) => {
      assert.equal(options.positiveOnly, false);
      return rows;
    },
    commitMacroBuild: (rows, keys) => {
      committed.push({ rows, keys });
      return { latestDate: rows.at(-1)?.date || "", updated: rows.length };
    },
    applyCrisisSignalRows: () => ({ latestDate: "", updated: 0 }),
  };
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
