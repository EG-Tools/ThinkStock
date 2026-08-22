import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectDailyPriceHistoryDensity,
  isKoreanMarketPricePoint,
} from "../../shared/market-calendar.mjs";

await import("../../docs/modules/browser-market-client.js");
await import("../../docs/modules/ticker-price-runtime.js");
const tickerPriceRuntime = globalThis.ThinkStockTickerPriceRuntime;

function createClient(fetchJson = async () => ({}), options = {}) {
  return globalThis.ThinkStockBrowserMarketClient.createBrowserMarketClient({
    fetchJson,
    appendCacheBust: (url) => `${url}&cache=1`,
    shiftDays: (dateText, days) => {
      const date = new Date(`${dateText}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    },
    dayMs: 86400000,
    baseInfoEndpoints: { KOSPI: "stocks" },
    indexEndpoints: { KOSPI: "index" },
    filterLatestTailPoints: tickerPriceRuntime.filterLatestTailPoints,
    inspectHistoryIntegrity: tickerPriceRuntime.inspectPriceHistoryIntegrity,
    ...options,
  });
}


test("normalizes KRX stock rows and generates incremental Yahoo requests", () => {
  const client = createClient();
  const rows = client.normalizeKrxUniverseRows([
    { ISU_SRT_CD: "5930", ISU_ABBRV: "삼성전자", MKT_TP_NM: "KOSPI" },
    { ISU_SRT_CD: "5930", ISU_ABBRV: "중복", MKT_TP_NM: "KOSPI" },
  ], "KOSPI");
  const url = client.buildYahooHistoryUrl("005930.KS", "2026-01-10", Date.parse("2026-01-20T00:00:00Z"));

  assert.deepEqual(rows, [{
    ticker: "005930.KS",
    code: "005930",
    name: "삼성전자",
    market: "KOSPI",
  }]);
  assert.match(url, /period1=/);
  assert.match(url, /period2=/);
  assert.match(client.buildYahooHistoryUrl("035420.KS"), /range=max/);
});


test("normalizes Yahoo history responses into sorted daily points", async () => {
  const client = createClient(async () => ({
    chart: {
      result: [{
        timestamp: [1767312000, 1767225600],
        meta: { gmtoffset: 0 },
        indicators: { quote: [{ close: [102, 101], volume: [2200, 1100] }] },
      }],
    },
  }));

  const points = await client.fetchYahooHistorySeries("TEST");
  assert.deepEqual(points, [
    { date: "2026-01-01", close: 101, volume: 1100 },
    { date: "2026-01-02", close: 102, volume: 2200 },
  ]);
});

test("rejects non-trading placeholders without removing real Korean trading dates", async () => {
  const client = createClient(async () => ({
    chart: {
      result: [{
        timestamp: [1493596800, 1496275200],
        meta: { gmtoffset: 0 },
        indicators: { quote: [{ close: [286371, 333083], volume: [0, 306967] }] },
      }],
    },
  }), {
    isValidPricePoint: ({ date, volume }) => isKoreanMarketPricePoint(date, volume),
  });

  assert.deepEqual(await client.fetchYahooHistorySeries("207940.KS"), [
    { date: "2017-06-01", close: 333083, volume: 306967 },
  ]);
});

test("drops explicit zero-volume placeholders while merging price sources", () => {
  const client = createClient();
  assert.deepEqual(client.mergePriceSeries([
    { date: "2017-05-01", close: 286371, volume: 0 },
    { date: "2017-05-02", close: 287842, volume: 125000 },
  ]), [
    { date: "2017-05-02", close: 287842, volume: 125000 },
  ]);
});

test("keeps Yahoo history but gives the latest KRX close priority", async () => {
  const client = createClient(async () => ({
    chart: {
      result: [{
        timestamp: [1785715200],
        meta: { gmtoffset: 0 },
        indicators: { quote: [{ close: [62000] }] },
      }],
    },
  }), {
    fetchLatestPrice: async () => [
      { date: "2026-08-03", close: 61800 },
    ],
  });

  assert.deepEqual(await client.fetchTickerHistorySeries("383220.KS"), [
    { date: "2026-08-03", close: 61800 },
  ]);
});

test("does not insert a stale pre-split KRX row behind newer adjusted history", async () => {
  const client = createClient(async () => ({}), {
    fetchPreferredHistory: async () => [
      { date: "2026-07-28", close: 21800, volume: 516832 },
      { date: "2026-08-21", close: 27700, volume: 1595930 },
    ],
    fetchLatestPrice: async () => [
      { date: "2026-08-20", close: 54400 },
    ],
  });

  assert.deepEqual(await client.fetchTickerHistorySeries("183300.KQ"), [
    { date: "2026-07-28", close: 21800, volume: 516832 },
    { date: "2026-08-21", close: 27700, volume: 1595930 },
  ]);
});

test("uses KRX latest price when Yahoo is rate limited", async () => {
  const client = createClient(async () => {
    throw new Error("Too Many Requests");
  }, {
    fetchLatestPrice: async () => [{ date: "2026-08-03", close: 61800 }],
  });

  assert.deepEqual(await client.fetchTickerHistorySeries("383220.KS"), [
    { date: "2026-08-03", close: 61800 },
  ]);
});

test("prefers the authenticated daily history source before the browser Yahoo fallback", async () => {
  let yahooCalls = 0;
  const preferred = Array.from({ length: 320 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 2 + index)).toISOString().slice(0, 10),
    close: 700000 + index,
    volume: 10000 + index,
  }));
  const client = createClient(async () => {
    yahooCalls += 1;
    throw new Error("Yahoo should not be requested");
  }, {
    fetchPreferredHistory: async () => preferred,
    fetchLatestPrice: async () => [],
  });

  const points = await client.fetchTickerHistorySeries("207940.KS");
  assert.equal(points.length, 320);
  assert.equal(points[0].date, preferred[0].date);
  assert.equal(points.at(-1).date, preferred.at(-1).date);
  assert.equal(yahooCalls, 0);
});

test("rejects a monthly preferred-history response before accepting a daily fallback", async () => {
  const monthly = Array.from({ length: 60 }, (_, index) => ({
    date: new Date(Date.UTC(2016 + Math.floor(index / 12), index % 12, 1)).toISOString().slice(0, 10),
    close: 500000 + index,
    volume: 10000 + index,
  }));
  const dailyTimestamps = Array.from({ length: 260 }, (_, index) => (
    Date.parse(new Date(Date.UTC(2025, 0, 2 + index)).toISOString()) / 1000
  ));
  let yahooCalls = 0;
  const client = createClient(async () => {
    yahooCalls += 1;
    return {
      chart: {
        result: [{
          timestamp: dailyTimestamps,
          meta: { gmtoffset: 0 },
          indicators: { quote: [{
            close: dailyTimestamps.map((_, index) => 700000 + index),
            volume: dailyTimestamps.map((_, index) => 100000 + index),
          }] },
        }],
      },
    };
  }, {
    fetchPreferredHistory: async () => monthly,
    fetchLatestPrice: async () => [],
    validateHistory: (points) => inspectDailyPriceHistoryDensity(points).dense,
  });

  const points = await client.fetchTickerHistorySeries("207940.KS");
  assert.equal(yahooCalls, 1);
  assert.equal(points.length, 260);
});

test("uses prefetched latest points without requesting the same price twice", async () => {
  let latestCalls = 0;
  const client = createClient(async () => ({
    chart: {
      result: [{
        timestamp: [1785628800],
        meta: { gmtoffset: 0 },
        indicators: { quote: [{ close: [70000] }] },
      }],
    },
  }), {
    fetchLatestPrice: async () => {
      latestCalls += 1;
      return [];
    },
  });

  const points = await client.fetchTickerHistorySeries("005930.KS", {
    latestPoints: [{ date: "2026-08-03", close: 71000 }],
  });
  assert.equal(latestCalls, 0);
  assert.deepEqual(points.at(-1), { date: "2026-08-03", close: 71000 });
});
