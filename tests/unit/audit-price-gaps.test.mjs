import assert from "node:assert/strict";
import test from "node:test";

import {
  auditPriceGapRecords,
  countDatesBetween,
  detectIsolatedPriceSpikes,
  parseNaverChartRows,
} from "../../scripts/audit_price_gaps.mjs";

function record(rows, source = "test") {
  return {
    points: new Map(rows.map((row) => [row.date, row])),
    sources: new Set([source]),
  };
}

test("parses only positive-volume Naver chart rows", () => {
  const rows = parseNaverChartRows(`
    <item data="20260801|10|11|9|10|0" />
    <item data="20260802|10|12|9|11|120" />
  `);
  assert.deepEqual(rows, [{ date: "2026-08-02", close: 11 }]);
});

test("counts only market dates strictly inside a price gap", () => {
  assert.equal(countDatesBetween(
    ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"],
    "2026-08-01",
    "2026-08-04",
  ), 2);
});

test("separates a stock-only halt from a market-wide closure", () => {
  const records = new Map([
    ["000001.KS", record([
      { date: "2026-01-01", close: 100 },
      { date: "2026-01-03", close: 101 },
      { date: "2026-01-05", close: 102 },
      { date: "2026-01-20", close: 103 },
    ])],
    ["000002.KS", record([
      { date: "2026-01-01", close: 100 },
      { date: "2026-01-20", close: 110 },
    ])],
    ["000003.KQ", record([
      { date: "2026-01-01", close: 100 },
      { date: "2026-01-20", close: 101 },
    ])],
  ]);
  const result = auditPriceGapRecords(records, { minimumCalendarDays: 10 });

  assert.equal(result.stockSpecificGapCount, 1);
  assert.equal(result.stockSpecific[0].ticker, "000002.KS");
  assert.equal(result.stockSpecific[0].marketSessions, 2);
  assert.equal(result.marketClosureGapCount, 2);
});

test("detects one-day price spikes without rejecting a sustained split boundary", () => {
  const isolated = detectIsolatedPriceSpikes([
    { date: "2026-08-01", "000001.KS": 100, "000002.KS": 100 },
    { date: "2026-08-02", "000001.KS": 500, "000002.KS": 500 },
    { date: "2026-08-03", "000001.KS": 102, "000002.KS": 510 },
  ]);

  assert.deepEqual(isolated, [{
    series: "000001.KS",
    date: "2026-08-02",
    previous: 100,
    current: 500,
    next: 102,
    multiple: 5,
  }]);
});
