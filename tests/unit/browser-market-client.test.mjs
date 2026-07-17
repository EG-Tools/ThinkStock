import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/browser-market-client.js");

function createClient(fetchJson = async () => ({})) {
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
});


test("normalizes Yahoo history responses into sorted daily points", async () => {
  const client = createClient(async () => ({
    chart: {
      result: [{
        timestamp: [1767312000, 1767225600],
        meta: { gmtoffset: 0 },
        indicators: { quote: [{ close: [102, 101] }] },
      }],
    },
  }));

  const points = await client.fetchYahooHistorySeries("TEST");
  assert.deepEqual(points, [
    { date: "2026-01-01", close: 101 },
    { date: "2026-01-02", close: 102 },
  ]);
});
