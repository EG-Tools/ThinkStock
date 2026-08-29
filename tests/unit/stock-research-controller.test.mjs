import assert from "node:assert/strict";
import test from "node:test";
import * as cacheLifecycle from "../../docs/modules/cache-lifecycle-policy.mjs";

const { default: controller } = await import("../../docs/modules/stock-research-controller.js");
controller.configureCacheLifecycle(cacheLifecycle);

test("stock research retries a transient first-page profile failure", async () => {
  let attempts = 0;
  let waits = 0;
  const profile = await controller.fetchCandidateProfileWithRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary profile failure");
      return { ok: true, category: "반도체" };
    },
    async () => { waits += 1; },
  );

  assert.equal(attempts, 2);
  assert.equal(waits, 1);
  assert.deepEqual(profile, { ok: true, category: "반도체" });
});

test("stock research scales worker lanes without overloading low-memory devices", () => {
  assert.equal(controller.researchWorkerLaneCount({ hardwareConcurrency: 2 }, 1000), 2);
  assert.equal(controller.researchWorkerLaneCount({ hardwareConcurrency: 8, deviceMemory: 16 }, 1000), 6);
  assert.equal(controller.researchWorkerLaneCount({ hardwareConcurrency: 12, deviceMemory: 2 }, 1000), 2);
  assert.equal(controller.researchWorkerLaneCount({ hardwareConcurrency: 8, deviceMemory: 8 }, 3), 3);
  assert.equal(controller.researchWorkerLaneCount({ hardwareConcurrency: 8 }, 0), 0);
});

test("stock research cards hide redundant last-sell and twenty-day-return details", () => {
  assert.deepEqual(controller.visibleCandidateReasons([
    "매수 5회 연속",
    "마지막 매도 2026-08-10",
    "20일 등락 4.2%",
    "변동성 보통",
    "최근 저점 안정화 관찰",
  ]), [
    "변동성 보통",
    "최근 저점 안정화 관찰",
  ]);
});

test("one-signal filtering uses the latest trading month instead of the full year", () => {
  const candidate = {
    buyCount: 5,
    sellCount: 4,
    recentMonthBuyCount: 0,
    recentMonthSellCount: 1,
  };
  assert.equal(controller.candidateMeetsSignalMinimum(candidate, {
    includeBuy: true,
    includeSell: false,
  }, 1), false);
  assert.equal(controller.candidateMeetsSignalMinimum(candidate, {
    includeBuy: false,
    includeSell: true,
  }, 1), true);
  assert.equal(controller.candidateMeetsSignalMinimum(candidate, {
    includeBuy: true,
    includeSell: false,
  }, 5), true);
});

function historyRows(count, start = "2025-01-01") {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(startTime + (index * 86400000)).toISOString().slice(0, 10),
    close: 10000 + index,
    volume: 100000 + index,
  }));
}

test("stock research compares top-400 composition and scans only new entrants", () => {
  const records = [
    { ticker: "005930.KS", rank: 1 },
    { ticker: "000660.KS", rank: 2 },
    { ticker: "247540.KQ", rank: 1 },
  ];
  const changes = controller.diffUniverse([
    "005930.KS",
    "035420.KS",
    "247540.KQ",
  ], records);

  assert.deepEqual(changes.added, [{ ticker: "000660.KS", rank: 2 }]);
  assert.deepEqual(changes.removed, ["035420.KS"]);
});

test("expanding research from 400 to 600 scans only the added 100 stocks per market", () => {
  const marketRows = (market, suffix, count) => Array.from({ length: count }, (_, index) => ({
    ticker: `${String(index + (market === "KOSDAQ" ? 500000 : 100000)).padStart(6, "0")}.${suffix}`,
    market,
    rank: index + 1,
    baseDate: "2026-08-13",
    close: 10000 + index,
    marketCap: 1_000_000_000 - index,
  }));
  const expanded = [
    ...marketRows("KOSPI", "KS", 300),
    ...marketRows("KOSDAQ", "KQ", 300),
  ];
  const initial = [...expanded.slice(0, 200), ...expanded.slice(300, 500)];
  const initialState = controller.diffUniverseState({}, initial).state;
  const changes = controller.diffUniverseState(
    initialState,
    expanded,
    initial.map((row) => row.ticker),
  );

  assert.equal(changes.added.length, 200);
  assert.equal(changes.changed.length, 0);
  assert.equal(changes.unchanged.length, 400);
  assert.equal(changes.added.filter((row) => row.market === "KOSPI").length, 100);
  assert.equal(changes.added.filter((row) => row.market === "KOSDAQ").length, 100);
});

test("stock research skips records whose price, market cap, and rank are unchanged", () => {
  const records = [
    { ticker: "005930.KS", market: "KOSPI", rank: 2, close: 81000, marketCap: 480000 },
    { ticker: "000660.KS", market: "KOSPI", rank: 1, close: 220000, marketCap: 510000 },
  ];
  const initial = controller.diffUniverseState({}, records);
  const changes = controller.diffUniverseState(initial.state, records);

  assert.deepEqual(changes.added, []);
  assert.deepEqual(changes.removed, []);
  assert.deepEqual(changes.changed, []);
  assert.deepEqual(changes.metadataChanged, []);
  assert.deepEqual(changes.unchanged, records);
});

test("stock research updates rank and market cap metadata without recalculating signals", () => {
  const records = [
    { ticker: "005930.KS", name: "삼성전자", market: "KOSPI", rank: 1, close: 81000, marketCap: 480000 },
  ];
  const initial = controller.diffUniverseState({}, records);
  const next = [{ ...records[0], rank: 2, marketCap: 470000 }];
  const changes = controller.diffUniverseState(initial.state, next);

  assert.deepEqual(changes.changed, []);
  assert.deepEqual(changes.metadataChanged, next);
  assert.equal(changes.state["005930.KS"].fingerprint, initial.state["005930.KS"].fingerprint);
  assert.notEqual(
    changes.state["005930.KS"].metadataFingerprint,
    initial.state["005930.KS"].metadataFingerprint,
  );
});

test("stock research recalculates only the ticker whose source fingerprint changed", () => {
  const records = [
    { ticker: "005930.KS", market: "KOSPI", rank: 2, close: 81000, marketCap: 480000 },
    { ticker: "000660.KS", market: "KOSPI", rank: 1, close: 220000, marketCap: 510000 },
  ];
  const initial = controller.diffUniverseState({}, records);
  const nextRecords = [{ ...records[0], close: 82000 }, records[1]];
  const changes = controller.diffUniverseState(initial.state, nextRecords);

  assert.deepEqual(changes.changed, [nextRecords[0]]);
  assert.deepEqual(changes.unchanged, [records[1]]);
  assert.notEqual(changes.state["005930.KS"].fingerprint, initial.state["005930.KS"].fingerprint);
});

test("stock research treats a new trading session as a new signal input even at the same close", () => {
  const initialRecord = {
    ticker: "005930.KS",
    name: "삼성전자",
    market: "KOSPI",
    baseDate: "2026-08-07",
    close: 81000,
    volume: 1000000,
  };
  const initial = controller.diffUniverseState({}, [initialRecord]);
  const nextRecord = { ...initialRecord, baseDate: "2026-08-10" };
  const changes = controller.diffUniverseState(initial.state, [nextRecord]);
  assert.deepEqual(changes.changed, [nextRecord]);
});

test("stock research stores a stable signal fingerprint separately from price state", () => {
  const first = controller.candidateSignalFingerprint({
    buyCount: 6,
    firstBuyDate: "2026-01-02",
    lastBuyDate: "2026-07-01",
    sellDate: "",
    bottomDate: "2026-07-08",
    status: "바닥 점검",
  });
  const same = controller.candidateSignalFingerprint({
    buyCount: 6,
    firstBuyDate: "2026-01-02",
    lastBuyDate: "2026-07-01",
    bottomDate: "2026-07-08",
    status: "바닥 점검",
  });
  assert.equal(first, same);
  assert.notEqual(first, controller.candidateSignalFingerprint(null));
});

test("shared market fingerprint changes only when recent common inputs change", () => {
  const shared = {
    kospiRows: [{ date: "2026-08-06", close: 3200 }, { date: "2026-08-07", close: 3210 }],
    kosdaqRows: [{ date: "2026-08-07", close: 1000 }],
    adrRows: [{ date: "2026-08-07", adr_kospi: 91 }],
    macroRows: [],
    creditRows: [],
    crisisRows: [],
  };
  const first = controller.sharedResearchFingerprint(shared);
  assert.equal(first, controller.sharedResearchFingerprint(structuredClone(shared)));
  assert.notEqual(first, controller.sharedResearchFingerprint({
    ...shared,
    adrRows: [{ date: "2026-08-07", adr_kospi: 92 }],
  }));
});

test("shared market fingerprints isolate KOSPI-only and KOSDAQ-only changes", () => {
  const shared = {
    kospiRows: [{ date: "2026-08-10", close: 3200 }],
    kosdaqRows: [{ date: "2026-08-10", close: 1000 }],
    adrRows: [{ date: "2026-08-10", adr_kospi: 90, adr_kosdaq: 95, fear_greed: 50 }],
    macroRows: [{ date: "2026-08-10", news_sentiment: 101 }],
    creditRows: [{ date: "2026-08-10", customer_deposit: 80, kospi_credit: 20, kosdaq_credit: 12 }],
    crisisRows: [{ date: "2026-08-10", score: 30 }],
  };
  const before = controller.sharedResearchFingerprints(shared);
  const after = controller.sharedResearchFingerprints({
    ...shared,
    adrRows: [{ ...shared.adrRows[0], adr_kospi: 91 }],
  });

  assert.notEqual(before.KOSPI, after.KOSPI);
  assert.equal(before.KOSDAQ, after.KOSDAQ);
});

test("one-day research follows each market's latest date and previous session", () => {
  const marketDates = controller.resolveResearchMarketDates({
    kospiRows: [
      { date: "2026-08-10", close: 3200 },
      { date: "2026-08-11", close: 3240 },
    ],
    kosdaqRows: [{ date: "2026-08-10", close: 1000 }],
  });
  const filter = { includeBuy: true, includeSell: true };

  assert.deepEqual(marketDates, { KOSPI: "2026-08-11", KOSDAQ: "2026-08-10" });
  assert.equal(controller.candidateMatchesTodayFilter({
    ticker: "005930.KS",
    market: "KOSPI",
    latestDate: "2026-08-11",
    lastSellDate: "2026-08-09",
  }, filter, marketDates), false);
  assert.equal(controller.candidateMatchesTodayFilter({
    ticker: "005930.KS",
    market: "KOSPI",
    latestDate: "2026-08-11",
    lastSellDate: "2026-08-11",
  }, filter, marketDates), true);
  assert.equal(controller.candidateMatchesTodayFilter({
    ticker: "247540.KQ",
    market: "KOSDAQ",
    latestDate: "2026-08-10",
    lastBuyDate: "2026-08-10",
  }, filter, marketDates), true);
  assert.equal(controller.researchMarketDateLabel(marketDates), "코스피 2026-08-11 · 코스닥 2026-08-10");
});

test("signal period cycles through off, one, fifteen and thirty trading days", () => {
  assert.equal(controller.signalWindowLabel(0), "OFF");
  assert.equal(controller.signalWindowLabel(1), "1일");
  assert.equal(controller.signalWindowLabel(15), "15일");
  assert.equal(controller.signalWindowLabel(30), "30일");
  assert.deepEqual([
    controller.nextSignalWindowDays(0),
    controller.nextSignalWindowDays(1),
    controller.nextSignalWindowDays(15),
    controller.nextSignalWindowDays(30),
  ], [1, 15, 30, 0]);
});

test("one-day research includes the latest and immediately previous trading sessions", () => {
  const filter = { includeBuy: true, includeSell: true, signalWindowDays: 1 };
  const marketDates = { KOSPI: "2026-08-28", KOSDAQ: "2026-08-28" };
  const candidate = {
    ticker: "005930.KS",
    market: "KOSPI",
    latestDate: "2026-08-28",
    lastBuyDate: "2026-08-27",
    lastBuySessionAge: 1,
    lastSellDate: "2026-08-26",
    lastSellSessionAge: 2,
  };

  assert.deepEqual(
    controller.candidateSignalWindowState(candidate, filter, marketDates, "2026-08-28"),
    {
      matches: true,
      buy: true,
      sell: false,
      buyCount: 1,
      sellCount: 0,
      minimumSignals: 1,
      referenceDate: "2026-08-28",
      windowDays: 1,
    },
  );
  assert.equal(controller.candidateMatchesSignalWindow(
    { ...candidate, lastBuySessionAge: 2 },
    filter,
    marketDates,
    "2026-08-28",
  ), false);
});

test("fifteen and thirty-day filters use trading-session ages", () => {
  const marketDates = { KOSPI: "2026-08-28", KOSDAQ: "2026-08-28" };
  const candidate = {
    ticker: "005930.KS",
    market: "KOSPI",
    latestDate: "2026-08-28",
    lastBuyDate: "2026-08-01",
    lastBuySessionAge: 14,
    buySignalSessionAges: [2, 10, 20],
    lastSellDate: "2026-07-15",
    lastSellSessionAge: 29,
    sellSignalSessionAges: [12, 29],
  };
  assert.equal(controller.candidateMatchesSignalWindow(candidate, {
    includeBuy: true,
    includeSell: false,
    signalWindowDays: 15,
    minimumSignals: 2,
  }, marketDates), true);
  assert.equal(controller.candidateMatchesSignalWindow(candidate, {
    includeBuy: true,
    includeSell: false,
    signalWindowDays: 15,
    minimumSignals: 3,
  }, marketDates), false);
  assert.equal(controller.candidateMatchesSignalWindow(candidate, {
    includeBuy: false,
    includeSell: true,
    signalWindowDays: 30,
    minimumSignals: 2,
  }, marketDates), true);
});

test("today research rejects stale market and ticker histories", () => {
  const filter = { includeBuy: true, includeSell: true };
  const marketDates = { KOSPI: "2026-08-27", KOSDAQ: "2026-08-27" };
  const current = {
    ticker: "127120.KQ",
    market: "KOSDAQ",
    latestDate: "2026-08-27",
    lastBuyDate: "2026-08-27",
  };

  assert.equal(controller.candidateMatchesTodayFilter(
    current,
    filter,
    marketDates,
    "2026-08-27",
  ), true);
  assert.equal(controller.candidateMatchesTodayFilter(
    { ...current, latestDate: "2026-07-30", lastBuyDate: "2026-07-30" },
    filter,
    marketDates,
    "2026-08-27",
  ), false);
  assert.equal(controller.candidateMatchesTodayFilter(
    current,
    filter,
    { ...marketDates, KOSDAQ: "2026-08-26" },
    "2026-08-27",
  ), false);
  assert.equal(
    controller.researchMarketDateLabel({ KOSPI: "2026-08-27", KOSDAQ: "2026-08-26" }, "2026-08-27"),
    "코스닥 최신가격 지연",
  );
});

test("stock research merges a recent history tail without duplicating dates", () => {
  const rows = historyRows(300);
  const ticker = "005930.KS";
  const cached = {
    schema: controller.HISTORY_CACHE_SCHEMA,
    historyQualityVersion: controller.HISTORY_QUALITY_VERSION,
    historyValidationDate: rows.at(-1).date,
    ticker,
    rows,
  };
  const replacement = { ...rows.at(-1), close: 99999 };
  const next = historyRows(1, "2025-10-28")[0];
  const merged = controller.mergeResearchHistoryPayload(cached, {
    partial: true,
    historyQualityVersion: controller.HISTORY_QUALITY_VERSION,
    historyValidationDate: next.date,
    rows: [replacement, next],
  }, ticker);

  assert.equal(merged.rows.length, 301);
  assert.equal(merged.rows.at(-2).close, 99999);
  assert.equal(merged.rows.at(-1).date, "2025-10-28");
  assert.equal(merged.cacheMeta.source, "stock-research-history");
});

test("stock research requests only the tail when a valid local history exists", () => {
  const incremental = new URL(controller.researchHistoryRequestUrl(
    "https://example.test/api/research/history",
    "005930.ks",
    { latestDate: "2026-08-07" },
  ));
  assert.equal(incremental.searchParams.get("ticker"), "005930.KS");
  assert.equal(incremental.searchParams.get("since"), "2026-08-07");
  assert.equal(incremental.searchParams.has("full"), false);

  const fallback = new URL(controller.researchHistoryRequestUrl(
    "https://example.test/api/research/history",
    "005930.KS",
    null,
    true,
  ));
  assert.equal(fallback.searchParams.get("full"), "1");
  assert.equal(fallback.searchParams.has("since"), false);
});

test("stock research updates a cached history from the refreshed universe without another history request", () => {
  const ticker = "005930.KS";
  const rows = historyRows(300);
  const cached = {
    schema: controller.HISTORY_CACHE_SCHEMA,
    historyQualityVersion: controller.HISTORY_QUALITY_VERSION,
    historyValidationDate: rows.at(-1).date,
    ticker,
    rows,
  };
  const latestDate = rows.at(-1).date;
  const sameDay = controller.mergeUniversePointIntoHistoryCache(cached, {
    ticker,
    baseDate: latestDate,
    close: 99000,
    volume: 1234567,
  });
  assert.equal(sameDay.changed, true);
  assert.equal(sameDay.record.rows.length, 300);
  assert.equal(sameDay.record.rows.at(-1).close, 99000);

  const nextDate = new Date(Date.parse(`${latestDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const nextDay = controller.mergeUniversePointIntoHistoryCache(sameDay.record, {
    ticker,
    baseDate: nextDate,
    close: 99500,
    volume: 2234567,
  });
  assert.equal(nextDay.changed, true);
  assert.equal(nextDay.record.rows.length, 301);
  assert.equal(nextDay.record.latestDate, nextDate);
});

test("stock research rejects a suspicious universe jump so split history can be refetched", () => {
  const ticker = "005930.KS";
  const rows = historyRows(300);
  const latestDate = rows.at(-1).date;
  const nextDate = new Date(Date.parse(`${latestDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  assert.equal(controller.mergeUniversePointIntoHistoryCache({
    schema: controller.HISTORY_CACHE_SCHEMA,
    historyQualityVersion: controller.HISTORY_QUALITY_VERSION,
    historyValidationDate: latestDate,
    ticker,
    rows,
  }, {
    ticker,
    baseDate: nextDate,
    close: rows.at(-1).close / 5,
    volume: 1000000,
  }), null);
});

test("stock research refetches instead of skipping missing sessions in the browser cache", () => {
  const ticker = "127120.KQ";
  const rows = historyRows(300, "2025-10-26");
  assert.equal(controller.mergeUniversePointIntoHistoryCache({
    schema: controller.HISTORY_CACHE_SCHEMA,
    historyQualityVersion: controller.HISTORY_QUALITY_VERSION,
    historyValidationDate: "2026-08-21",
    ticker,
    rows,
  }, {
    ticker,
    baseDate: "2026-08-27",
    close: 5300,
    volume: 120000,
  }), null);
});
