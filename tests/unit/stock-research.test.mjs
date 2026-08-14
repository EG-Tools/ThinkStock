import assert from "node:assert/strict";
import test from "node:test";
import { parseNaverResearchProfile } from "../../shared/research-profile.mjs";

await import("../../docs/modules/stock-research-contract.js");
await import("../../docs/modules/stock-research-storage.js");
await import("../../docs/modules/stock-research-navigation.js");
await import("../../docs/modules/stock-research-filter.js");
await import("../../docs/modules/stock-research-history-cache.js");
await import("../../docs/modules/stock-research-worker-client.js");
await import("../../docs/modules/stock-research.js");
await import("../../docs/modules/stock-research-controller.js");

const research = globalThis.ThinkStockStockResearch;
const controller = globalThis.ThinkStockStockResearchController;

test("uses the newest ticker history date when the KRX universe date is delayed", () => {
  assert.equal(controller.latestResearchDate([
    { date: "2026-08-07" },
    { date: "2026-08-10" },
  ], "2026-08-07"), "2026-08-10");
  assert.equal(controller.latestResearchDate([], "2026-08-07"), "2026-08-07");
  assert.equal(controller.latestResearchDate([
    { date: "2026-08-07" },
  ], "2026-08-09"), "2026-08-07");
});

test("uses a concise industry and a curated battery category", () => {
  const html = '<a href="/sise/sise_group_detail.naver?type=upjong&no=283">전기제품</a>';
  assert.deepEqual(parseNaverResearchProfile(html, "247540.KQ"), {
    category: "2차전지",
    industry: "전기제품",
    categoryType: "테마",
  });
  assert.deepEqual(parseNaverResearchProfile(
    '<a href="/sise/sise_group_detail.naver?type=upjong&no=261"><span>제약</span></a>',
    "000100.KS",
  ), {
    category: "제약",
    industry: "제약",
    categoryType: "업종",
  });
});

test("persists only valid stock-research blocked tickers", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(controller.loadMinimum(storage), 5);
  controller.saveMinimum(storage, 1);
  assert.equal(controller.loadMinimum(storage), 1);
  controller.saveMinimum(storage, 0);
  assert.equal(controller.loadMinimum(storage), 1);
  controller.saveMinimum(storage, 2);
  assert.equal(controller.loadMinimum(storage), 2);
  controller.saveMinimum(storage, 7);
  assert.equal(controller.loadMinimum(storage), 7);
  controller.saveBlocked(storage, [
    { ticker: "005930.ks", name: "삼성전자", market: "KOSPI" },
    { ticker: "invalid", name: "제외" },
  ]);
  assert.deepEqual(controller.loadBlocked(storage), [{
    ticker: "005930.KS",
    name: "삼성전자",
    market: "KOSPI",
    blockedAt: "",
  }]);
});

test("minimum signal option includes three-signal candidates", () => {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const rows = Array.from({ length: 520 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    close: 120 - index * 0.05,
    volume: 10_000_000,
  }));
  const timingSignals = [480, 490, 500].map((index) => ({ date: rows[index].date }));
  const assess = (minimumBuySignals) => research.assessTicker({
    item: { ticker: "000001.KS", name: "테스트", market: "KOSPI", rank: 100 },
    rows,
    asOfDate: rows.at(-1).date,
    minimumBuySignals,
    benchmarkRows: rows.map((row) => ({ date: row.date, close: 1000 })),
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: () => ({ signals: timingSignals, sellSignals: [] }),
  });
  assert.equal(assess(), null);
  assert.equal(assess(3)?.buyCount, 3);
});

test("counts only buy and sell signals visible in the latest trading year", () => {
  const start = Date.parse("2022-01-01T00:00:00Z");
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    close: 100 + index * 0.03,
    volume: 10_000_000,
  }));
  const oldIndexes = [100, 180, 260, 340, 420, 500, 600, 700];
  const recentIndexes = [800, 900, 990];
  const signals = [...oldIndexes, ...recentIndexes].map((index) => ({ date: rows[index].date }));
  const assess = ({ includeBuy, includeSell, minimumSignals }) => research.assessTicker({
    item: { ticker: "000001.KS", name: "테스트", market: "KOSPI", rank: 30 },
    rows,
    asOfDate: rows.at(-1).date,
    includeBuy,
    includeSell,
    minimumSignals,
    benchmarkRows: rows.map((row) => ({ date: row.date, close: 1000 })),
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: () => ({
      signals: includeBuy ? signals : [],
      sellSignals: includeSell ? signals : [],
    }),
  });

  assert.equal(assess({ includeBuy: true, includeSell: false, minimumSignals: 5 }), null);
  assert.equal(assess({ includeBuy: false, includeSell: true, minimumSignals: 5 }), null);
  assert.equal(assess({ includeBuy: true, includeSell: false, minimumSignals: 3 })?.buyCount, 3);
  assert.equal(assess({ includeBuy: false, includeSell: true, minimumSignals: 3 })?.sellCount, 3);
});

test("one research pass preserves both buy and sell counts for instant filtering", () => {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const rows = Array.from({ length: 700 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    close: 100 + index * 0.02,
    volume: 10_000_000,
  }));
  const candidate = research.assessTicker({
    item: { ticker: "000001.KS", name: "테스트", market: "KOSPI", rank: 30 },
    rows,
    asOfDate: rows.at(-1).date,
    includeBuy: true,
    includeSell: true,
    collectAllSignals: true,
    minimumSignals: 5,
    benchmarkRows: rows.map((row) => ({ date: row.date, close: 1000 })),
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: () => ({
      signals: [{ date: rows[650].date }],
      sellSignals: [610, 660, 690].map((index) => ({ date: rows[index].date })),
    }),
  });

  assert.equal(candidate?.signalMode, "both");
  assert.equal(candidate?.buyCount, 1);
  assert.equal(candidate?.sellCount, 2);
  assert.equal(candidate?.recentMonthSellCount, 1);
});

test("counts only the latest consecutive sell run after a buy transition", () => {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const rows = Array.from({ length: 700 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    close: 100 + index * 0.02,
    volume: 10_000_000,
  }));
  const assess = (minimumSignals) => research.assessTicker({
    item: { ticker: "000001.KS", name: "테스트", market: "KOSPI", rank: 30 },
    rows,
    asOfDate: rows.at(-1).date,
    includeBuy: false,
    includeSell: true,
    minimumSignals,
    benchmarkRows: rows.map((row) => ({ date: row.date, close: 1000 })),
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: () => ({
      signals: [{ date: rows[650].date }],
      sellSignals: [610, 620, 680, 690].map((index) => ({ date: rows[index].date })),
    }),
  });

  assert.equal(assess(3), null);
  assert.equal(assess(2)?.sellCount, 2);
  assert.equal(assess(2)?.firstSellDate, rows[680].date);
});

test("one-signal research requires a signal inside the latest 21 trading sessions", () => {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const rows = Array.from({ length: 520 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    close: 100 + index * 0.02,
    volume: 10_000_000,
  }));
  const assess = (signalIndex) => research.assessTicker({
    item: { ticker: "000001.KS", name: "테스트", market: "KOSPI", rank: 30 },
    rows,
    asOfDate: rows.at(-1).date,
    includeBuy: true,
    includeSell: false,
    minimumSignals: 1,
    benchmarkRows: rows.map((row) => ({ date: row.date, close: 1000 })),
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: () => ({ signals: [{ date: rows[signalIndex].date }], sellSignals: [] }),
  });

  assert.equal(assess(498), null);
  assert.equal(assess(499)?.recentMonthBuyCount, 1);
});

test("today sell research accepts only a signal occurring on the latest trading date", () => {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const rows = Array.from({ length: 520 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    close: 100 + index * 0.05,
    volume: 10_000_000,
  }));
  const latestTradingDate = rows.at(-1).date;
  const weekendDate = new Date(Date.parse(`${latestTradingDate}T00:00:00Z`) + (2 * 86400000)).toISOString().slice(0, 10);
  const assess = (signalDate, confirmationDate = latestTradingDate) => research.assessTicker({
    item: {
      ticker: "000001.KS",
      name: "테스트",
      market: "KOSPI",
      rank: 30,
      baseDate: weekendDate,
      close: 130,
      volume: 12_000_000,
    },
    rows,
    asOfDate: latestTradingDate,
    includeBuy: false,
    includeSell: true,
    todayOnly: true,
    minimumSignals: 5,
    benchmarkRows: rows.map((row) => ({ date: row.date, close: 1000 })),
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: () => ({
      signals: [],
      sellSignals: [{ date: signalDate, confirmationDate }],
    }),
  });

  const candidate = assess(latestTradingDate);
  assert.equal(candidate?.signalMode, "sell");
  assert.equal(candidate?.sellCount, 1);
  assert.equal(candidate?.lastSellDate, latestTradingDate);
  assert.equal(candidate?.lastSellConfirmationDate, latestTradingDate);
  assert.equal(assess(rows.at(-2).date, latestTradingDate), null);
});

test("today research returns both buy and sell signals occurring on the latest trading date", () => {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const rows = Array.from({ length: 520 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    close: 100 + index * 0.05,
    volume: 10_000_000,
  }));
  const currentDate = rows.at(-1).date;
  const candidate = research.assessTicker({
    item: {
      ticker: "000001.KS",
      name: "테스트",
      market: "KOSPI",
      rank: 30,
      baseDate: currentDate,
      close: 130,
      volume: 12_000_000,
    },
    rows,
    asOfDate: currentDate,
    includeBuy: true,
    includeSell: true,
    todayOnly: true,
    benchmarkRows: rows.map((row) => ({ date: row.date, close: 1000 })),
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: () => ({
      signals: [{ date: currentDate, confirmationDate: currentDate }],
      sellSignals: [{ date: currentDate, confirmationDate: currentDate }],
    }),
  });

  assert.equal(candidate?.signalMode, "both");
  assert.equal(candidate?.buyCount, 1);
  assert.equal(candidate?.sellCount, 1);
  assert.equal(candidate?.lastBuyConfirmationDate, currentDate);
  assert.equal(candidate?.lastSellConfirmationDate, currentDate);
});

test("groups consecutive buys between sell signals", () => {
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07"];
  const indexes = new Map(dates.map((date, index) => [date, index]));
  const runs = research.buildSignalRuns(
    dates.slice(1).map((date) => ({ date })),
    [{ date: dates[0] }],
    indexes,
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0].buys.length, 6);
  assert.equal(runs[0].sell, null);
});

test("keeps a five-buy candidate even after a large rebound", () => {
  const start = Date.parse("2023-01-01T00:00:00Z");
  const rows = Array.from({ length: 700 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    close: index < 650 ? 100 - index * 0.03 : 80 + (index - 650) * 1.6,
    volume: 10_000_000,
  }));
  const buyDates = [580, 595, 610, 625, 640].map((index) => ({ date: rows[index].date }));
  const candidate = research.assessTicker({
    item: { ticker: "218410.KQ", code: "218410", name: "RFHIC", market: "KOSDAQ", rank: 60 },
    rows,
    asOfDate: rows.at(-1).date,
    benchmarkRows: rows.map((row) => ({ date: row.date, close: 1000 })),
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: () => ({ signals: buyDates, sellSignals: [] }),
  });
  assert.ok(candidate);
  assert.equal(candidate.buyCount, 5);
  assert.ok(candidate.reboundPercent > 55);
});

test("ranks honestly without filling to ten", () => {
  const ranked = research.rankCandidates([
    { ticker: "B", score: 70, marketRank: 10 },
    { ticker: "A", score: 80, marketRank: 20 },
  ], 10);
  assert.deepEqual(ranked.map((item) => item.ticker), ["A", "B"]);
});

test("rotates random research results without repeats until the pool is exhausted", () => {
  const pool = Array.from({ length: 6 }, (_, index) => ({
    ticker: `${String(index + 1).padStart(6, "0")}.KS`,
  }));
  const first = controller.selectRandomBatch(pool, [], { limit: 5, random: () => 0 });
  const second = controller.selectRandomBatch(pool, first.seenTickers, { limit: 5, random: () => 0 });
  const third = controller.selectRandomBatch(pool, second.seenTickers, { limit: 5, random: () => 0 });

  assert.equal(first.candidates.length, 5);
  assert.equal(second.candidates.length, 1);
  assert.equal(second.cycleReset, false);
  assert.equal(first.candidates.some((candidate) => candidate.ticker === second.candidates[0].ticker), false);
  assert.equal(third.candidates.length, 5);
  assert.equal(third.cycleReset, true);
});

test("keeps a stable randomized order and slices it into five-stock pages", () => {
  const pool = Array.from({ length: 7 }, (_, index) => ({ ticker: `${index + 1}.KS` }));
  const order = controller.normalizeCandidateOrder(pool, ["3.KS", "1.KS"], () => 0);

  assert.deepEqual(order.slice(0, 2), ["3.KS", "1.KS"]);
  assert.equal(new Set(order).size, 7);
  assert.equal(controller.selectCandidatePage(pool, order, 0).length, 5);
  assert.equal(controller.selectCandidatePage(pool, order, 1).length, 2);
});
