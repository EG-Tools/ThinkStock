import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/series-integrity.mjs");
await import("../../docs/modules/runtime-series-merge.js");
const merge = globalThis.ThinkStockRuntimeSeriesMerge;

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
