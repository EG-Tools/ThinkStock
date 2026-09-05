import assert from "node:assert/strict";
import test from "node:test";

import {
  availableOnDate,
  classifyTimelineDate,
  latestToleranceMs,
  maximumAsOfAgeDays,
  rebaseSeriesRowsToAvailability,
} from "../../shared/series-timeline-policy.mjs";

test("keeps publication lag and latest-edge tolerance in one timeline policy", () => {
  assert.equal(availableOnDate("kospi_credit", "2026-08-10"), "2026-08-12");
  assert.equal(availableOnDate("leading_cycle", "2026-06-01"), "2026-08-01");
  assert.equal(latestToleranceMs(["005930.KS", "kospi_credit"]), 5 * 86400000);
  assert.equal(maximumAsOfAgeDays(["price", "leading_cycle"]), 75);
  assert.equal(maximumAsOfAgeDays(["vix"]), 11);
});

test("rebases monthly leading-cycle values to publication dates without moving other series", () => {
  assert.deepEqual(rebaseSeriesRowsToAvailability([
    { date: "2026-07-01", leading_cycle: 104.2, news_sentiment: 99 },
    { date: "2026-09-01", news_sentiment: 101 },
  ], "leading_cycle"), [
    { date: "2026-07-01", news_sentiment: 99 },
    { date: "2026-09-01", news_sentiment: 101, leading_cycle: 104.2 },
  ]);
  assert.deepEqual(rebaseSeriesRowsToAvailability([
    { date: "2026-07-01", available_date: "2026-09-02", leading_cycle: 104.2 },
  ], "leading_cycle"), [
    { date: "2026-07-01", available_date: "2026-09-02" },
    { date: "2026-09-02", leading_cycle: 104.2 },
  ]);
});

test("collapses interpolated monthly values before applying publication dates", () => {
  const rows = rebaseSeriesRowsToAvailability([
    { date: "2026-06-30", leading_cycle: 103.9 },
    { date: "2026-07-01", leading_cycle: 104.2 },
    { date: "2026-07-15", leading_cycle: 104.3 },
    { date: "2026-07-31", leading_cycle: 104.4 },
  ], "leading_cycle", { observationCadence: "monthly" });

  assert.deepEqual(rows.filter((row) => Number.isFinite(row.leading_cycle)), [
    { date: "2026-08-01", leading_cycle: 103.9 },
    { date: "2026-09-01", leading_cycle: 104.2 },
  ]);
});

test("separates immutable history from each source's mutable tail", () => {
  assert.equal(classifyTimelineDate("price", "2026-07-20", "2026-08-10"), "stable");
  assert.equal(classifyTimelineDate("price", "2026-08-02", "2026-08-10"), "mutable");
  assert.equal(classifyTimelineDate("kospi_credit", "2026-07-25", "2026-08-10"), "mutable");
  assert.equal(classifyTimelineDate("vix", "2026-07-20", "2026-08-10"), "stable");
});
