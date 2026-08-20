import assert from "node:assert/strict";
import test from "node:test";

import {
  apiDate,
  compareVkospiOverlap,
  fetchKrxVkospiPoint,
  fetchStockplusVkospiPoint,
  fetchStockplusVkospiRows,
  mergeVkospiFallbackRows,
  mergeVkospiRows,
  planVkospiSource,
  shouldRememberEmptyVkospiDate,
  vkospiBackfillDates,
  vkospiPointFromRows,
  vkospiPointFromStockplusPayload,
  vkospiRowsFromStockplusBrowserContent,
  vkospiRowsFromStockplusPayload,
  withVkospiChanges,
} from "../../shared/krx-volatility-index.mjs";

test("extracts the official KOSPI 200 volatility index row", () => {
  const point = vkospiPointFromRows([
    { BAS_DD: "20200414", IDX_NM: "코스피 200 선물지수", CLSPRC_IDX: "1212.67" },
    {
      BAS_DD: "20200414",
      IDX_NM: "코스피 200 변동성지수",
      CLSPRC_IDX: "36.04",
      OPNPRC_IDX: "38.29",
      HGPRC_IDX: "38.36",
      LWPRC_IDX: "35.96",
    },
  ]);

  assert.deepEqual(point, {
    date: "2020-04-14",
    vkospi: 36.04,
    vkospiOpen: 38.29,
    vkospiHigh: 38.36,
    vkospiLow: 35.96,
  });
  assert.equal(apiDate("2020-04-14"), "20200414");
});

test("returns null for a holiday response without fabricating a value", () => {
  assert.equal(vkospiPointFromRows([]), null);
});

test("reports a separate KRX service authorization error", async () => {
  await assert.rejects(
    fetchKrxVkospiPoint(async () => ({
      status: 401,
      ok: false,
      json: async () => ({ respCode: "401", respMsg: "Unauthorized API Call" }),
    }), "secret", "2026-08-11"),
    (error) => error?.code === "KRX_VKOSPI_UNAUTHORIZED",
  );
});

test("marks rate limits and server failures as retryable", async () => {
  for (const status of [403, 429, 503]) {
    await assert.rejects(
      fetchKrxVkospiPoint(async () => ({
        status,
        ok: false,
        json: async () => ({ respCode: String(status) }),
      }), "secret", "2026-08-11"),
      (error) => error?.status === status && error?.retryable === true,
    );
  }
});

test("does not calculate a twenty-session change across a long data gap", () => {
  const firstBlock = Array.from({ length: 20 }, (_, index) => ({
    date: `2010-01-${String(index + 1).padStart(2, "0")}`,
    vkospi: 20 + index,
  }));
  const rows = withVkospiChanges([
    ...firstBlock,
    { date: "2026-08-10", vkospi: 69.55 },
  ]);

  assert.equal(rows.at(-1).vkospiChange20, undefined);
});

test("merges duplicate dates and derives changes only inside a continuous window", () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    vkospi: 20 + index,
  }));
  const merged = mergeVkospiRows(rows, [{ date: rows.at(-1).date, vkospi: 42 }]);

  assert.equal(merged.length, 21);
  assert.equal(merged.at(-1).vkospi, 42);
  assert.equal(merged.at(-1).vkospiChange20, 1.1);
});

test("builds a capped weekday backfill range", () => {
  assert.deepEqual(vkospiBackfillDates("2026-08-06", "2026-08-12"), [
    "2026-08-07",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
  ]);
  assert.equal(vkospiBackfillDates("", "2026-08-12", { maxDates: 3 }).length, 3);
});

test("repairs an internal official VKOSPI gap even when a newer value already exists", () => {
  assert.deepEqual(vkospiBackfillDates("2026-08-12", "2026-08-12", {
    rows: [
      { date: "2026-08-10", vkospi: 69.55 },
      { date: "2026-08-12", vkospi: 56.05 },
    ],
    initialLookbackDays: 4,
  }), ["2026-08-11"]);
});

test("normalizes Stockplus VKOSPI candles inside the official history range", () => {
  assert.deepEqual(vkospiRowsFromStockplusPayload({
    dayCandles: [
      { date: "2026-08-11T00:00:00.000+00:00", tradePrice: 61.68 },
      { date: "2009-12-30T00:00:00.000+00:00", tradePrice: 20.1 },
      { date: "2026-08-10T00:00:00.000+00:00", tradePrice: 0 },
    ],
  }, { to: "2026-08-11" }), [
    { date: "2026-08-11", vkospi: 61.68 },
  ]);
});

test("normalizes Browser Run wrapped Stockplus JSON", () => {
  const payload = JSON.stringify({
    dayCandles: [{ date: "2026-08-20T09:00:00+09:00", tradePrice: 57.26 }],
  }).replaceAll('"', "&quot;");
  assert.deepEqual(vkospiRowsFromStockplusBrowserContent(JSON.stringify({
    success: true,
    result: `<html><body><pre>${payload}</pre></body></html>`,
  })), [{ date: "2026-08-20", vkospi: 57.26 }]);
});

test("extracts and fetches the current Stockplus VKOSPI candle", async () => {
  const payload = {
    dayCandles: [
      { date: "2026-08-12T00:00:00.000+00:00", tradePrice: 55.89 },
      { date: "2026-08-11T00:00:00.000+00:00", tradePrice: 61.68 },
    ],
  };
  assert.deepEqual(vkospiPointFromStockplusPayload(payload, {
    expectedDate: "2026-08-12",
  }), {
    date: "2026-08-12",
    vkospi: 55.89,
  });
  assert.equal(vkospiPointFromStockplusPayload(payload, {
    expectedDate: "2026-08-13",
  }), null);

  let requestedUrl = "";
  const point = await fetchStockplusVkospiPoint(async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  }, { expectedDate: "2026-08-12" });
  assert.match(requestedUrl, /limit=2/);
  assert.deepEqual(point, { date: "2026-08-12", vkospi: 55.89 });

  const recentRows = await fetchStockplusVkospiRows(async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  }, { expectedDate: "2026-08-12", limit: 10 });
  assert.match(requestedUrl, /limit=10/);
  assert.deepEqual(recentRows, [
    { date: "2026-08-11", vkospi: 61.68 },
    { date: "2026-08-12", vkospi: 55.89 },
  ]);
});

test("fills missing Stockplus dates without replacing settled KRX values", () => {
  const rows = mergeVkospiFallbackRows([
    { date: "2026-08-10", vkospi: 69.55 },
  ], [
    { date: "2026-08-10", vkospi: 99 },
    { date: "2026-08-11", vkospi: 61.68 },
    { date: "2026-08-12", vkospi: 55.88 },
  ], { liveDate: "2026-08-12" });

  assert.deepEqual(rows.map(({ date, vkospi }) => ({ date, vkospi })), [
    { date: "2026-08-10", vkospi: 69.55 },
    { date: "2026-08-11", vkospi: 61.68 },
    { date: "2026-08-12", vkospi: 55.88 },
  ]);
});

test("cross-checks fallback history against overlapping KRX closes", () => {
  assert.deepEqual(compareVkospiOverlap([
    { date: "2026-08-10", vkospi: 69.55 },
    { date: "2026-08-11", vkospi: 61.68 },
  ], [
    { date: "2026-08-10", vkospi: 69.55 },
    { date: "2026-08-11", vkospi: 61.7 },
  ]), {
    overlapCount: 2,
    mismatches: [],
  });

  assert.deepEqual(compareVkospiOverlap([
    { date: "2026-08-11", vkospi: 61.68 },
  ], [
    { date: "2026-08-11", vkospi: 55.2 },
  ]), {
    overlapCount: 1,
    mismatches: [{ date: "2026-08-11", primary: 61.68, fallback: 55.2 }],
  });
});

test("rechecks recent unpublished dates but remembers old holidays", () => {
  assert.equal(shouldRememberEmptyVkospiDate("2026-08-11", "2026-08-12"), false);
  assert.equal(shouldRememberEmptyVkospiDate("2026-08-03", "2026-08-12"), true);
});

test("uses Stockplus intraday and only as a settlement fallback after KRX closes", () => {
  const intraday = planVkospiSource(new Date("2026-08-12T00:30:00Z"), "2026-08-11");
  assert.equal(intraday.stockplusLiveWindow, true);
  assert.equal(intraday.useStockplus, true);
  assert.equal(intraday.priority, "stockplus");

  const pendingSettlement = planVkospiSource(new Date("2026-08-12T07:10:00Z"), "2026-08-11");
  assert.equal(pendingSettlement.settlementWindow, true);
  assert.equal(pendingSettlement.officialCurrent, false);
  assert.equal(pendingSettlement.useStockplus, true);
  assert.equal(pendingSettlement.priority, "krx");

  const settled = planVkospiSource(new Date("2026-08-12T07:10:00Z"), "2026-08-12");
  assert.equal(settled.officialCurrent, true);
  assert.equal(settled.useStockplus, false);

  const beforeOpen = planVkospiSource(new Date("2026-08-11T22:30:00Z"), "2026-08-11");
  assert.equal(beforeOpen.useStockplus, false);
});
