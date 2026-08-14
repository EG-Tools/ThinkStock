import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/co-movement.js");
const coMovement = globalThis.ThinkStockCoMovement;

test("calculates directional agreement from non-flat common changes", () => {
  const result = coMovement.calculateDirectionalAgreement([
    { date: "2026-01-01", stock: 100, market: 100 },
    { date: "2026-01-02", stock: 102, market: 101 },
    { date: "2026-01-03", stock: 101, market: 100 },
    { date: "2026-01-04", stock: 103, market: 99 },
    { date: "2026-01-05", stock: 104, market: 100 },
  ], "stock", "market");

  assert.equal(result.samples, 4);
  assert.equal(result.matches, 3);
  assert.equal(result.rate, 75);
});

test("ignores missing and flat comparison changes", () => {
  const result = coMovement.calculateDirectionalAgreement([
    { date: "2026-01-01", stock: 100, market: 100 },
    { date: "2026-01-02", stock: 101, market: 100 },
    { date: "2026-01-03", stock: null, market: 101 },
    { date: "2026-01-04", stock: 102, market: 102 },
    { date: "2026-01-05", stock: 101, market: 101 },
    { date: "2026-01-06", stock: 103, market: 102 },
  ], "stock", "market");

  assert.equal(result.samples, 3);
  assert.equal(result.rate, 100);
});

test("uses the selected period when target history covers the window", () => {
  const rows = [
    { date: "2025-01-01", stock: 100 },
    { date: "2026-01-01", stock: 120 },
  ];

  assert.equal(coMovement.effectivePeriodLabel(rows, "stock", 12), "1년");
  assert.equal(coMovement.effectivePeriodLabel(rows, "stock", 3), "3개월");
});

test("formats a short visible trading window in days", () => {
  const fiveTradingDaysInMonths = 5 / (365.2425 / 12);
  assert.equal(coMovement.formatPeriod(fiveTradingDaysInMonths), "5일");
});

test("keeps a nearly complete twelve-month viewport labeled as one year", () => {
  assert.equal(coMovement.formatPeriod(11.99), "1년");
});

test("shortens a 30-year request to the target's actual history", () => {
  const rows = [
    { date: "1996-01-01", market: 100, stock: null },
    { date: "2010-01-01", market: 130, stock: 100 },
    { date: "2026-01-01", market: 180, stock: 220 },
  ];

  const summary = coMovement.buildSummary({
    rows,
    targetKey: "stock",
    targetName: "테스트종목",
    requestedMonths: 360,
    comparisons: [{ key: "market", label: "코스피" }],
  });

  assert.equal(summary.periodLabel, "16년");
  assert.equal(summary.targetName, "테스트종목");
});
