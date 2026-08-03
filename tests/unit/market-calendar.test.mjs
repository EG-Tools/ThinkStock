import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedLatestKoreanTradingDate,
  koreanDateText,
  latestWeekdayOnOrBefore,
} from "../../shared/market-calendar.mjs";

test("uses the Korean calendar date instead of UTC", () => {
  assert.equal(koreanDateText(new Date("2026-08-03T15:30:00Z")), "2026-08-04");
});

test("uses the previous market day before the evening data cutoff", () => {
  assert.equal(
    expectedLatestKoreanTradingDate(new Date("2026-08-04T07:00:00Z")),
    "2026-08-03",
  );
  assert.equal(
    expectedLatestKoreanTradingDate(new Date("2026-08-04T09:30:00Z")),
    "2026-08-04",
  );
});

test("skips weekends when estimating the latest expected trading date", () => {
  assert.equal(latestWeekdayOnOrBefore("2026-08-02"), "2026-07-31");
  assert.equal(
    expectedLatestKoreanTradingDate(new Date("2026-08-02T12:00:00Z")),
    "2026-07-31",
  );
});

