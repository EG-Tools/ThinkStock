import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/runtime-market-refresh.js");

const { createRuntimeMarketRefresh } = globalThis.ThinkStockRuntimeMarketRefresh;

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
