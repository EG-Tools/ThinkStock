import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/data-health.js");
const dataHealth = globalThis.ThinkStockDataHealth;


test("builds freshness ranges from finite series values", () => {
  const items = dataHealth.buildFreshnessItems([{
    label: "신용",
    rows: [
      { date: "2026-01-01", credit: null },
      { date: "2026-01-02", credit: 10 },
      { date: "2026-01-03", credit: 11 },
    ],
    keys: ["credit"],
    staleDays: 2,
  }], "2026-01-06");

  assert.deepEqual(items[0], {
    label: "신용",
    first: "2026-01-02",
    latest: "2026-01-03",
    date: "2026-01-03",
    ageDays: 3,
    staleDays: 2,
    isEmpty: false,
    isStale: true,
    anomalies: [],
  });
});


test("detects abrupt recent changes only inside the configured gap", () => {
  const policy = {
    credit: {
      maxRelativeChange: 0.2,
      maxAbsoluteChange: 2,
      maxGapDays: 7,
    },
  };
  const abrupt = dataHealth.detectRecentChanges([
    { date: "2026-01-01", credit: 10 },
    { date: "2026-01-02", credit: 15 },
  ], policy);
  const distant = dataHealth.detectRecentChanges([
    { date: "2026-01-01", credit: 10 },
    { date: "2026-02-01", credit: 15 },
  ], policy);

  assert.equal(abrupt.length, 1);
  assert.equal(abrupt[0].key, "credit");
  assert.deepEqual(distant, []);
});
