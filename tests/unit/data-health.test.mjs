import assert from "node:assert/strict";
import test from "node:test";


await import("../../shared/series-integrity.mjs");
await import("../../shared/series-timeline-policy.mjs");
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
    missingSeries: 0,
    staleSeries: 1,
    series: {
      credit: {
        first: "2026-01-02",
        latest: "2026-01-03",
        ageDays: 3,
        staleDays: 2,
        isEmpty: false,
        isStale: true,
      },
    },
    anomalies: [],
    gaps: [],
  });
});

test("does not let one fresh component hide a stale or missing grouped series", () => {
  const [item] = dataHealth.buildFreshnessItems([{
    label: "신용·예탁금",
    rows: [
      { date: "2026-07-20", kospi_credit: 20 },
      { date: "2026-08-12", customer_deposit: 82 },
    ],
    keys: ["customer_deposit", "kospi_credit", "kosdaq_credit"],
  }], "2026-08-20");

  assert.equal(item.latest, "2026-08-12");
  assert.equal(item.isStale, true);
  assert.equal(item.staleSeries, 1);
  assert.equal(item.missingSeries, 1);
  assert.equal(item.series.customer_deposit.isStale, false);
  assert.equal(item.series.kospi_credit.isStale, true);
  assert.equal(item.series.kosdaq_credit.isEmpty, true);
});

test("derives stale thresholds from the shared timeline policy when omitted", () => {
  const [item] = dataHealth.buildFreshnessItems([{
    label: "신용",
    rows: [{ date: "2026-08-01", kospi_credit: 10 }],
    keys: ["kospi_credit"],
  }], "2026-08-12");

  assert.equal(item.staleDays, 14);
  assert.equal(item.isStale, false);
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

test("range-only policies do not treat every legitimate value change as an anomaly", () => {
  const issues = dataHealth.detectRecentChanges([
    { date: "2026-01-01", score: 20 },
    { date: "2026-01-02", score: 35 },
    { date: "2026-01-03", score: 28 },
  ], {
    score: dataHealth.DEFAULT_SERIES_POLICIES.score,
  });

  assert.deepEqual(issues, []);
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

test("reports a long weekday gap without flagging an ordinary weekend", () => {
  const policy = { price: { maxMissingWeekdays: 5, scanPoints: 20 } };
  assert.deepEqual(dataHealth.detectSeriesGaps([
    { date: "2026-08-07", price: 100 },
    { date: "2026-08-10", price: 101 },
  ], policy), []);

  const gaps = dataHealth.detectSeriesGaps([
    { date: "2026-07-14", price: 100 },
    { date: "2026-08-10", price: 101 },
  ], policy);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].kind, "gap");
  assert.ok(gaps[0].missingWeekdays > 5);
});

test("finds an exact missing market date against a trusted reference series", () => {
  const rows = [
    { date: "2026-08-10", vkospi: 52 },
    { date: "2026-08-12", vkospi: 55 },
  ];
  const referenceRows = [
    { date: "2026-08-10", kospi: 3200 },
    { date: "2026-08-11", kospi: 3210 },
    { date: "2026-08-12", kospi: 3220 },
  ];
  const [item] = dataHealth.buildFreshnessItems([{
    label: "VKOSPI",
    rows,
    keys: ["vkospi"],
    gapPolicies: { vkospi: dataHealth.DEFAULT_SERIES_POLICIES.vkospi },
    referenceRows,
    referenceKeys: ["kospi"],
  }], "2026-08-12");

  assert.deepEqual(item.gaps, [{
    key: "vkospi",
    kind: "missing-date",
    latestDate: "2026-08-11",
    missingWeekdays: 1,
  }]);
});
