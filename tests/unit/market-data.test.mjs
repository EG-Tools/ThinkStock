import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/data-payload.js");
await import("../../docs/modules/market-data.js");
const marketData = globalThis.ThinkStockMarketData;


test("merges new dates and fills gaps without replacing cached values", () => {
  const merged = marketData.mergeRowsPreservingExisting(
    [{ date: "2026-01-01", AAA: 100, BBB: null }],
    [
      { date: "2026-01-01", AAA: 999, BBB: 20 },
      { date: "2026-01-02", AAA: 101, BBB: 21 },
    ],
  );

  assert.deepEqual(merged, [
    { date: "2026-01-01", AAA: 100, BBB: 20 },
    { date: "2026-01-02", AAA: 101, BBB: 21 },
  ]);
});


test("detects overlap and boundary price rebases", () => {
  const overlap = marketData.findTickerPriceRebaseSignal(
    [{ date: "2026-01-01", close: 100 }],
    [{ date: "2026-01-01", close: 20 }],
  );
  const boundary = marketData.findTickerPriceRebaseSignal(
    [{ date: "2026-01-01", close: 100 }],
    [{ date: "2026-01-02", close: 25 }],
  );
  const stable = marketData.findTickerPriceRebaseSignal(
    [{ date: "2026-01-01", close: 100 }],
    [{ date: "2026-01-02", close: 102 }],
  );

  assert.deepEqual(overlap, { type: "overlap", date: "2026-01-01", ratio: 5 });
  assert.deepEqual(boundary, { type: "boundary", date: "2026-01-02", ratio: 4 });
  assert.equal(stable, null);
});


test("aligns historical credit scale before using current KOFIA values", () => {
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const result = marketData.mergeSources({
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index })),
    macroRows: dates.map((date) => ({ date, leading_cycle: 100, kospi_credit: 10 })),
    creditRows: [
      { date: dates[1], kospi_credit: 100 },
      { date: dates[2], kospi_credit: 110 },
    ],
    creditCols: ["kospi_credit"],
    creditOffsetDays: 0,
    start: dates[0],
    end: dates[2],
  });

  assert.deepEqual(result.rows.map((row) => row.kospi_credit), [105, 100, 110]);
  assert.deepEqual(result.macroCols, ["leading_cycle", "kospi_credit"]);
  assert.deepEqual(result.liveCols, ["AAA"]);
});

test("keeps credit values fixed while dates are shifted independently", () => {
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const input = {
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index })),
    macroRows: dates.map((date, index) => ({ date, kospi_credit: 10 + index })),
    creditRows: [
      { date: dates[1], kospi_credit: 100 },
      { date: dates[2], kospi_credit: 110 },
    ],
    creditCols: ["kospi_credit"],
    start: dates[0],
    end: dates[2],
  };
  const zeroOffset = marketData.mergeSources({ ...input, creditOffsetDays: 0 });
  const twoDayOffset = marketData.mergeSources({ ...input, creditOffsetDays: 2 });

  assert.deepEqual(twoDayOffset.rows, zeroOffset.rows);
  assert.equal(marketData.shiftIsoDateByDays("2026-01-03", -2), "2026-01-01");
  assert.equal(marketData.shiftIsoDateByDays("invalid", -2), "invalid");
});


test("sanitizes columnar price payloads in the shared module", () => {
  const payload = marketData.sanitizePricePayload({
    generated_at: "2026-01-03T00:00:00Z",
    dates: ["2026-01-02", "2026-01-01"],
    series: ["AAA"],
    columns: { AAA: [101, "100"] },
    display_names: { AAA: " Example " },
  });

  assert.deepEqual(payload.records, [
    { date: "2026-01-01", AAA: 100 },
    { date: "2026-01-02", AAA: 101 },
  ]);
  assert.deepEqual(payload.display_names, { AAA: "Example" });
});
