import assert from "node:assert/strict";
import test from "node:test";

import {
  availableOnDate,
  classifyTimelineDate,
  latestToleranceMs,
  maximumAsOfAgeDays,
} from "../../shared/series-timeline-policy.mjs";

test("keeps publication lag and latest-edge tolerance in one timeline policy", () => {
  assert.equal(availableOnDate("kospi_credit", "2026-08-10"), "2026-08-12");
  assert.equal(availableOnDate("leading_cycle", "2026-06-01"), "2026-07-31");
  assert.equal(latestToleranceMs(["005930.KS", "kospi_credit"]), 5 * 86400000);
  assert.equal(maximumAsOfAgeDays(["price", "leading_cycle"]), 75);
});

test("separates immutable history from each source's mutable tail", () => {
  assert.equal(classifyTimelineDate("price", "2026-07-20", "2026-08-10"), "stable");
  assert.equal(classifyTimelineDate("price", "2026-08-02", "2026-08-10"), "mutable");
  assert.equal(classifyTimelineDate("kospi_credit", "2026-07-25", "2026-08-10"), "mutable");
});
