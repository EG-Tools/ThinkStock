import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/browser-market-client.js");

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
  assert.match(client.buildYahooHistoryUrl("035420.KS"), /range=30y/);
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
