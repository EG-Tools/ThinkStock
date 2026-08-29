import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedLatestKoreanTradingDate,
  inspectDailyPriceHistoryDensity,
  isKoreanCurrentPriceWindow,
  isKoreanMarketPricePoint,
  isKoreanTradingDate,
  koreanDateText,
  latestKoreanTradingDateOnOrBefore,
  latestWeekdayOnOrBefore,
  millisecondsUntilKoreanMarketClose,
  resolveKoreanSignalLifecycle,
  resolveKoreanResearchUniversePhase,
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

test("rejects zero-volume holiday placeholders but keeps real trading rows", () => {
  assert.equal(isKoreanMarketPricePoint("2017-05-01", 0), false);
  assert.equal(isKoreanMarketPricePoint("2017-06-01", 306967), true);
  assert.equal(isKoreanMarketPricePoint("2017-06-01", null), true);
});

test("distinguishes daily history from a monthly full-history fallback", () => {
  const daily = Array.from({ length: 260 }, (_, index) => ({
    date: new Date(Date.parse("2020-01-02T00:00:00Z") + (index * 86400000)).toISOString().slice(0, 10),
  })).filter((row) => ![0, 6].includes(new Date(`${row.date}T00:00:00Z`).getUTCDay()));
  const monthly = Array.from({ length: 60 }, (_, index) => ({
    date: new Date(Date.UTC(2016 + Math.floor(index / 12), index % 12, 1)).toISOString().slice(0, 10),
  }));
  assert.equal(inspectDailyPriceHistoryDensity(daily).dense, true);
  assert.equal(inspectDailyPriceHistoryDensity(monthly).dense, false);
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

test("labels only a latest intraday signal as realtime", () => {
  const now = new Date("2026-08-10T03:00:00Z");
  assert.equal(resolveKoreanSignalLifecycle({
    signalDate: "2026-08-10",
    latestPriceDate: "2026-08-10",
    priceMode: "realtime",
    now,
  }).state, "realtime");
  assert.equal(resolveKoreanSignalLifecycle({
    signalDate: "2026-08-07",
    latestPriceDate: "2026-08-10",
    priceMode: "realtime",
    now,
  }).state, "confirmed");
  assert.equal(resolveKoreanSignalLifecycle({
    signalDate: "2026-08-10",
    latestPriceDate: "2026-08-10",
    priceMode: "settled",
    now,
  }).state, "confirmed");
});

test("schedules one Korean market-close settlement without polling", () => {
  assert.equal(millisecondsUntilKoreanMarketClose(
    new Date("2026-08-10T06:59:30Z"),
    { closeHour: 16 },
  ), 30_000);
  assert.equal(millisecondsUntilKoreanMarketClose(
    new Date("2026-08-10T07:00:30Z"),
    { closeHour: 16 },
  ), 0);
  assert.equal(millisecondsUntilKoreanMarketClose(
    new Date("2026-08-09T03:00:00Z"),
    { closeHour: 16 },
  ), null);
});

test("shares one deterministic research-universe phase across live and deployed runtimes", () => {
  assert.deepEqual(resolveKoreanResearchUniversePhase(new Date("2026-08-10T03:00:00Z")), {
    today: "2026-08-10",
    expectedDate: "2026-08-07",
    targetDate: "2026-08-10",
    priceMode: "realtime",
    realtime: true,
    captureClose: false,
  });
  assert.deepEqual(resolveKoreanResearchUniversePhase(new Date("2026-08-10T07:01:00Z")), {
    today: "2026-08-10",
    expectedDate: "2026-08-07",
    targetDate: "2026-08-10",
    priceMode: "settled",
    realtime: false,
    captureClose: true,
  });
  assert.deepEqual(resolveKoreanResearchUniversePhase(new Date("2026-08-10T09:01:00Z")), {
    today: "2026-08-10",
    expectedDate: "2026-08-10",
    targetDate: "2026-08-10",
    priceMode: "settled",
    realtime: false,
    captureClose: false,
  });
});
