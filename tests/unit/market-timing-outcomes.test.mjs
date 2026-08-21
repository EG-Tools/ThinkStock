import test from "node:test";
import assert from "node:assert/strict";

import { buildTimingSignalOutcome } from "../../shared/market-timing-outcomes.mjs";

function dateAt(offset) {
  return new Date(Date.UTC(2024, 0, 1 + offset)).toISOString().slice(0, 10);
}

function fallingSeries(length = 80) {
  const dates = Array.from({ length }, (_, index) => dateAt(index));
  const prices = Array.from({ length }, (_, index) => (
    index <= 6 ? 100 : 100 - Math.min(20, index - 6)
  ));
  return {
    dates,
    prices,
    dateIndexes: new Map(dates.map((date, index) => [date, index])),
    tags: ["sample"],
  };
}

test("builds separate short correction and medium reversal outcomes from one sell signal", () => {
  const series = fallingSeries();
  const signal = {
    date: series.dates[5],
    confirmationDate: series.dates[6],
    marketRegime: "slowdown",
    behaviorProfile: {
      dominant: "trendFollowing",
      structural: { trendDirection: "up", annualReturn: 0.12, directionConsistency: 0.7 },
    },
  };

  const outcome = buildTimingSignalOutcome({
    signal,
    type: "sell",
    series,
    ticker: "005930.KS",
  });

  assert.equal(outcome.date, series.dates[5]);
  assert.equal(outcome.actionDate, series.dates[6]);
  assert.equal(outcome.direction5, true);
  assert.equal(outcome.direction10, true);
  assert.equal(outcome.direction20, true);
  assert.equal(outcome.direction63, true);
  assert.equal(outcome.excursion10Hit, true);
  assert.equal(outcome.daysToExcursion20, 7);
  assert.equal(outcome.structuralDirection, "up");
  assert.deepEqual(outcome.tags, ["sample"]);
});

test("rejects a signal without enough immutable forward prices", () => {
  const series = fallingSeries(30);
  const outcome = buildTimingSignalOutcome({
    signal: { date: series.dates[5], confirmationDate: series.dates[6] },
    type: "sell",
    series,
    ticker: "005930.KS",
  });

  assert.equal(outcome, null);
});
