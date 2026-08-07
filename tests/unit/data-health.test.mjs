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


test("detects an earlier bad point inside the configured scan window", () => {
  const anomalies = dataHealth.detectRecentChanges([
    { date: "2026-06-01", leading_cycle: 105.7 },
    { date: "2026-06-02", leading_cycle: 102.869808 },
    { date: "2026-06-03", leading_cycle: 102.869808 },
  ], {
    leading_cycle: {
      maxRelativeChange: 0.01,
      maxAbsoluteChange: 0.8,
      maxGapDays: 62,
      scanPoints: 3,
    },
  });

  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].latestDate, "2026-06-02");
});

test("rejects zero and out-of-range values across the recent scan window", () => {
  const issues = dataHealth.detectRecentChanges([
    { date: "2026-01-01", kospi_credit: 20, fear_greed: 50 },
    { date: "2026-01-02", kospi_credit: 0, fear_greed: 101 },
    { date: "2026-01-03", kospi_credit: 21, fear_greed: 55 },
  ], {
    kospi_credit: dataHealth.DEFAULT_SERIES_POLICIES.kospi_credit,
    fear_greed: dataHealth.DEFAULT_SERIES_POLICIES.fear_greed,
  });

  assert.deepEqual(issues.map((issue) => [issue.key, issue.kind, issue.latestDate]), [
    ["kospi_credit", "zero", "2026-01-02"],
    ["fear_greed", "range", "2026-01-02"],
  ]);
});
