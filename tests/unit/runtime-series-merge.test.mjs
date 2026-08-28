import assert from "node:assert/strict";
import test from "node:test";

import * as merge from "../../docs/modules/runtime-series-merge.mjs";

test("normalizes duplicate dated values through one shared path", () => {
  assert.deepEqual(merge.normalizeDatedRows([
    { date: "2026-08-02T09:00:00Z", news_sentiment: 99 },
    { date: "2026-08-01", news_sentiment: 98 },
    { date: "2026-08-02", news_sentiment: 101 },
    { date: "invalid", news_sentiment: 120 },
  ], ["news_sentiment"], { requireIsoDate: true }), [
    { date: "2026-08-01", news_sentiment: 98 },
    { date: "2026-08-02", news_sentiment: 101 },
  ]);
});

test("normalizes sparse positive credit fields without replacing valid duplicates with zero", () => {
  assert.deepEqual(merge.normalizeCreditInputRows([
    { date: "2026-08-01", kospi_credit: 10, customer_deposit: 0 },
    { date: "2026-08-01", kospi_credit: 0, customer_deposit: 20 },
  ], ["kospi_credit", "customer_deposit"]), [
    { date: "2026-08-01", kospi_credit: 10, customer_deposit: 20 },
  ]);
  assert.equal(merge.sameNullableNumber(null, ""), true);
  assert.equal(merge.sameNullableNumber(10, "10"), true);
});

test("merges dated macro values without discarding unrelated fields", () => {
  const result = merge.mergeDatedSeries({
    sourceRows: [{ date: "2026-08-01", leading_cycle: 101, policy_rate: 2.5 }],
    incomingRows: [{ date: "2026-08-01", policy_rate: 2.75 }, { date: "2026-08-02", policy_rate: 2.75 }],
    keys: ["policy_rate"],
  });

  assert.deepEqual(result.rows, [
    { date: "2026-08-01", leading_cycle: 101, policy_rate: 2.75 },
    { date: "2026-08-02", policy_rate: 2.75 },
  ]);
  assert.equal(result.updated, 2);
});

test("leading cycle ends at its last published observation", () => {
  const result = merge.mergeLeadingCycle({
    sourceRows: [
      { date: "2026-06-01", leading_cycle: 104.8 },
      { date: "2026-06-02", leading_cycle: 104.8 },
    ],
    denseRows: [{ date: "2026-06-01", leading_cycle: 104.8 }],
    priceDates: ["2026-06-01", "2026-06-02"],
    latestDate: "2026-06-01",
  });

  assert.equal(result.rows[1].leading_cycle, null);
});

test("credit merge preserves a valid previous field but never preserves zero source values", () => {
  const result = merge.mergeCreditRows({
    sourceRows: [{ date: "2026-08-07", kospi_credit: 10, customer_deposit: 0 }],
    incomingRows: [{ date: "2026-08-07", customer_deposit: 20 }],
    keys: ["kospi_credit", "customer_deposit"],
  });

  assert.deepEqual(result.rows, [{ date: "2026-08-07", kospi_credit: 10, customer_deposit: 20 }]);
});

test("credit component updates do not discard unrelated credit series", () => {
  const result = merge.mergeCreditRows({
    sourceRows: [{
      date: "2026-08-07",
      customer_deposit: 80,
      kospi_credit: 20,
      kosdaq_credit: 12,
    }],
    incomingRows: [{ date: "2026-08-07", kospi_credit: 21 }],
    keys: ["kospi_credit"],
  });

  assert.deepEqual(result.rows, [{
    date: "2026-08-07",
    customer_deposit: 80,
    kospi_credit: 21,
    kosdaq_credit: 12,
  }]);
});

test("normalizes only bounded crisis scores", () => {
  assert.deepEqual(merge.normalizeCrisisRows([
    { date: "2026-08-01", score: 80 },
    { date: "2026-08-02", score: 120 },
  ]), [{
    date: "2026-08-01",
    score: 80,
    stage: "crisis",
    uninversion: false,
  }]);
});

test("runtime controller commits each live series through one validated state path", () => {
  const state = {
    macro: [{ date: "2026-08-01", leading_cycle: 101 }],
    credit: [{ date: "2026-08-01", kospi_credit: 10, customer_deposit: 20 }],
    crisis: [],
    adr: [{ date: "2026-08-01", adr_kospi: 95 }],
  };
  const changed = [];
  const validated = [];
  const controller = merge.createRuntimeSeriesController({
    creditKeys: ["kospi_credit", "customer_deposit"],
    getRows: (name) => state[name],
    setRows: (name, rows) => { state[name] = rows; },
    markChanged: (name) => changed.push(name),
    validate: (label, _current, candidate) => {
      validated.push(label);
      return { rows: candidate };
    },
  });

  controller.applyNewsSentimentLiveRows([
    { date: "2026-08-02", news_sentiment: 102 },
  ]);
  controller.applyCreditLiveRows([
    { date: "2026-08-02", kospi_credit: 11, customer_deposit: 21 },
  ]);
  controller.applyCrisisSignalRows([
    { date: "2026-08-02", score: 55 },
  ]);
  controller.applyAuxiliarySeriesRows([
    { date: "2026-08-02", vix: 18 },
  ], "vix", "VIX");

  assert.equal(state.macro.at(-1).news_sentiment, 102);
  assert.equal(state.credit.at(-1).kospi_credit, 11);
  assert.equal(state.crisis.at(-1).stage, "warning");
  assert.equal(state.adr.at(-1).vix, 18);
  assert.deepEqual(changed, ["macro", "credit", "crisis", "adr"]);
  assert.deepEqual(validated, ["news sentiment", "credit balance", "recession signal", "VIX"]);
});
