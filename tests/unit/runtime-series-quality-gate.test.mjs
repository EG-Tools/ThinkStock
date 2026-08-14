import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/series-integrity.mjs");
await import("../../docs/modules/data-health.js");
await import("../../docs/modules/runtime-data-transaction.js");
await import("../../docs/modules/runtime-series-quality-gate.js");

const gate = globalThis.ThinkStockRuntimeSeriesQualityGate;

test("accepts an ordinary index tail and rejects zero or implausible jumps", () => {
  const currentPayload = {
    records: [
      { date: "2026-08-10", "^KS11": 3200 },
      { date: "2026-08-11", "^KS11": 3220 },
    ],
  };
  assert.equal(gate.validatePricePoints({
    ticker: "^KS11",
    currentPayload,
    incomingPoints: [{ date: "2026-08-12", close: 3240 }],
  }).ok, true);
  assert.equal(gate.validatePricePoints({
    ticker: "^KS11",
    currentPayload,
    incomingPoints: [{ date: "2026-08-12", close: 0 }],
  }).reason, "incoming-range");
  assert.equal(gate.validatePricePoints({
    ticker: "^KS11",
    currentPayload,
    incomingPoints: [{ date: "2026-08-12", close: 4700 }],
  }).reason, "introduced-anomaly");
});

test("does not mistake a stock split for a corrupt index jump", () => {
  const result = gate.validatePricePoints({
    ticker: "005930.KS",
    currentPayload: { records: [{ date: "2026-08-10", "005930.KS": 100000 }] },
    incomingPoints: [{ date: "2026-08-11", close: 50000 }],
  });
  assert.equal(result.ok, true);
});

test("rejects a missing trusted index date and an invalid cached macro snapshot", () => {
  const gap = gate.validatePricePoints({
    ticker: "^KQ11",
    currentPayload: { records: [] },
    incomingPoints: [
      { date: "2026-08-10", close: 1000 },
      { date: "2026-08-12", close: 1020 },
    ],
    referenceDates: ["2026-08-10", "2026-08-11", "2026-08-12"],
  });
  assert.equal(gap.reason, "introduced-gap");

  const snapshot = gate.validateSnapshotComponent("macro", [
    { date: "2026-05-01", leading_cycle: 104.8, news_sentiment: 102 },
    { date: "2026-06-01", leading_cycle: 0, news_sentiment: 103 },
  ]);
  assert.equal(snapshot.reason, "incoming-range");
});

test("validates all index series in a restored price snapshot", () => {
  const result = gate.validateSnapshotComponent("price", {
    series: ["^KS11", "^KQ11", "005930.KS"],
    records: [
      { date: "2026-08-10", "^KS11": 3200, "^KQ11": 1000, "005930.KS": 70000 },
      { date: "2026-08-11", "^KS11": 3220, "^KQ11": 1010, "005930.KS": 71000 },
    ],
  });
  assert.equal(result.ok, true);
});
