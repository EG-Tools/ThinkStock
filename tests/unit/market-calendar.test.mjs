import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedLatestKoreanTradingDate,
  isKoreanCurrentPriceWindow,
  isKoreanTradingDate,
  koreanDateText,
  latestKoreanTradingDateOnOrBefore,
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

test("checks current prices from market open until the evening KRX cutoff", () => {
  assert.equal(isKoreanCurrentPriceWindow(new Date("2026-08-10T23:59:00Z")), false);
  assert.equal(isKoreanCurrentPriceWindow(new Date("2026-08-10T00:00:00Z")), true);
  assert.equal(isKoreanCurrentPriceWindow(new Date("2026-08-10T08:59:00Z")), true);
  assert.equal(isKoreanCurrentPriceWindow(new Date("2026-08-10T09:00:00Z")), false);
  assert.equal(isKoreanCurrentPriceWindow(new Date("2026-08-08T01:00:00Z")), false);
});

test("skips fixed, substitute, election, Labor Day, and year-end KRX closures", () => {
  assert.equal(isKoreanTradingDate("2026-05-01"), false);
  assert.equal(isKoreanTradingDate("2026-05-25"), false);
  assert.equal(isKoreanTradingDate("2026-06-03"), false);
  assert.equal(isKoreanTradingDate("2026-12-31"), false);
  assert.equal(latestKoreanTradingDateOnOrBefore("2026-12-31"), "2026-12-30");
});

test("walks across long exchange holidays without inventing a trading date", () => {
  assert.equal(latestKoreanTradingDateOnOrBefore("2026-02-18"), "2026-02-13");
  assert.equal(
    expectedLatestKoreanTradingDate(new Date("2026-02-18T09:30:00Z")),
    "2026-02-13",
  );
});

test("uses observed KRX dates as the authority inside their covered range", () => {
  const referenceDates = ["2026-08-07", "2026-08-10", "2026-08-12"];
  assert.equal(isKoreanTradingDate("2026-08-11", { referenceDates }), false);
  assert.equal(isKoreanTradingDate("2026-08-12", { referenceDates }), true);
  assert.equal(latestKoreanTradingDateOnOrBefore("2026-08-11", { referenceDates }), "2026-08-10");
});

test("does not open the live-price window on an exchange holiday", () => {
  assert.equal(isKoreanCurrentPriceWindow(new Date("2026-05-01T01:00:00Z")), false);
  assert.equal(isKoreanCurrentPriceWindow(new Date("2026-06-03T01:00:00Z")), false);
});
