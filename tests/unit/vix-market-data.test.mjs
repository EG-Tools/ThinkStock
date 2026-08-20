import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchYahooVixRows,
  mergeVixRows,
  normalizeBrowserVixContent,
  normalizeYahooVixChart,
  yahooVixChartUrl,
} from "../../shared/vix-market-data.mjs";

const payload = {
  chart: {
    result: [{
      meta: {
        gmtoffset: -18000,
        regularMarketTime: Date.parse("2026-08-20T12:00:00Z") / 1000,
        regularMarketPrice: 15.56,
      },
      timestamp: [
        Date.parse("2026-08-18T07:00:00Z") / 1000,
        Date.parse("2026-08-19T07:00:00Z") / 1000,
        Date.parse("2026-08-20T07:00:00Z") / 1000,
      ],
      indicators: {
        quote: [{ close: [15.84, 14.89, 15.4] }],
      },
    }],
    error: null,
  },
};

test("normalizes Yahoo VIX daily bars and prefers the latest market value", () => {
  assert.deepEqual(normalizeYahooVixChart(payload), [
    { date: "2026-08-18", vix: 15.84 },
    { date: "2026-08-19", vix: 14.89 },
    { date: "2026-08-20", vix: 15.56 },
  ]);
});

test("normalizes Browser Run HTML and wrapped content responses", () => {
  const raw = JSON.stringify(payload);
  const html = `<html><body><pre>${raw.replace(/\"/g, "&quot;")}</pre></body></html>`;
  assert.equal(normalizeBrowserVixContent(html).at(-1).vix, 15.56);
  assert.equal(normalizeBrowserVixContent(JSON.stringify({
    success: true,
    result: html,
  })).at(-1).date, "2026-08-20");
});

test("keeps official FRED history and appends only newer VIX dates", () => {
  assert.deepEqual(mergeVixRows(
    [
      { date: "2026-08-17", vix: 15.19 },
      { date: "2026-08-18", vix: 15.84 },
    ],
    normalizeYahooVixChart(payload),
    { afterDate: "2026-08-18" },
  ), [
    { date: "2026-08-17", vix: 15.19 },
    { date: "2026-08-18", vix: 15.84 },
    { date: "2026-08-19", vix: 14.89 },
    { date: "2026-08-20", vix: 15.56 },
  ]);
});

test("fetches the compact VIX chart without replacing official same-day history", async () => {
  let requestedUrl = "";
  const rows = await fetchYahooVixRows(async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify(payload), { status: 200 });
  }, { cacheBust: 123 });
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/v8/finance/chart/%5EVIX");
  assert.equal(url.searchParams.get("range"), "10d");
  assert.equal(url.searchParams.get("_ts"), "123");
  assert.equal(rows.at(-1).date, "2026-08-20");
});

test("builds a compact Yahoo VIX URL", () => {
  const url = new URL(yahooVixChartUrl());
  assert.equal(url.hostname, "query2.finance.yahoo.com");
  assert.equal(url.searchParams.get("interval"), "1d");
});
