import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/data-payload.js");
await import("../../docs/modules/market-data.js");
const marketData = globalThis.ThinkStockMarketData;

test("normalizes full fear-greed history and rejects invalid rows", () => {
  assert.deepEqual(marketData.normalizeFearGreedRows({
    rows: [
      { date: "2026-08-12", score: 36 },
      { date: "2026-08-11", score: "42" },
      { date: "2026-08-10", score: 101 },
    ],
  }), [
    { date: "2026-08-11", fear_greed: 42 },
    { date: "2026-08-12", fear_greed: 36 },
  ]);
  assert.deepEqual(
    marketData.normalizeFearGreedRows({ updated: "2026-08-13", score: 55 }),
    [{ date: "2026-08-13", fear_greed: 55 }],
  );
});


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


test("lets a validated incoming seed correct stale cached values", () => {
  const merged = marketData.mergeRowsPreferIncoming(
    [{ date: "2026-01-01", AAA: 100, BBB: 10 }],
    [{ date: "2026-01-01", AAA: 999, BBB: null }],
  );

  assert.deepEqual(merged, [{ date: "2026-01-01", AAA: 999, BBB: 10 }]);
  const prices = marketData.mergePricePayloadPreferIncoming(
    { generated_at: "old", records: [{ date: "2026-01-01", AAA: 100 }], display_names: { AAA: "Old" } },
    { generated_at: "new", records: [{ date: "2026-01-01", AAA: 999 }], display_names: { AAA: "New" } },
  );
  assert.equal(prices.generated_at, "new");
  assert.equal(prices.records[0].AAA, 999);
  assert.equal(prices.display_names.AAA, "New");
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

test("removes explicit zero-volume placeholder prices", () => {
  assert.deepEqual(marketData.normalizeTickerPricePoints([
    { date: "2017-05-01", close: 286371, volume: 0 },
    { date: "2017-05-02", close: 287842, volume: 125000 },
    { date: "2017-05-04", close: 292255 },
  ]), [
    { date: "2017-05-02", close: 287842, volume: 125000 },
    { date: "2017-05-04", close: 292255 },
  ]);
});

test("removes cached Korean equity values on non-trading dates without deleting valid market rows", () => {
  const payload = marketData.sanitizeKoreanEquityPricePayload({
    records: [
      { date: "2017-04-28", "^KS11": 2205, "207940.KS": 266242 },
      { date: "2017-05-01", "207940.KS": 286371, leading_cycle: 100.2 },
      { date: "2017-05-02", "^KS11": 2219, "207940.KS": 272328 },
      { date: "2017-06-01", "^KS11": 2344, "207940.KS": 348397 },
    ],
    series: ["^KS11", "207940.KS", "leading_cycle"],
  }, {
    isTradingDate: (date) => date !== "2017-05-01",
  });

  assert.deepEqual(payload.records, [
    { date: "2017-04-28", "^KS11": 2205, "207940.KS": 266242 },
    { date: "2017-05-01", leading_cycle: 100.2 },
    { date: "2017-05-02", "^KS11": 2219, "207940.KS": 272328 },
    { date: "2017-06-01", "^KS11": 2344, "207940.KS": 348397 },
  ]);
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

test("treats unpublished zero credit balances as missing values", () => {
  const dates = ["2026-08-03", "2026-08-04"];
  const result = marketData.mergeSources({
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index })),
    macroRows: [],
    creditRows: [
      { date: dates[0], kospi_credit: 21.6 },
      { date: dates[1], kospi_credit: 0 },
    ],
    creditCols: ["kospi_credit"],
    start: dates[0],
    end: dates[1],
  });

  assert.deepEqual(result.rows.map((row) => row.kospi_credit), [21.6, null]);
});

test("keeps runtime credit dates that are newer than the bundled price history", () => {
  const result = marketData.mergeSources({
    priceRows: [
      { date: "2026-07-14", AAA: 100 },
      { date: "2026-08-10", AAA: 110 },
    ],
    macroRows: [],
    creditRows: [
      { date: "2026-07-14", kospi_credit: 21.1 },
      { date: "2026-08-07", kospi_credit: 23.1 },
    ],
    creditCols: ["kospi_credit"],
    start: "2026-07-14",
    end: "2026-08-10",
  });

  assert.deepEqual(result.rows.map((row) => row.date), [
    "2026-07-14",
    "2026-08-07",
    "2026-08-10",
  ]);
  assert.equal(result.rows[1].kospi_credit, 23.1);
  assert.equal(result.rows[1].AAA, null);
  assert.equal(result.rows[2].kospi_credit, null);
});

test("keeps the latest monthly macro value until the next release", () => {
  const targets = ["2026-05-29", "2026-06-01", "2026-06-02", "2026-06-10"];
  const source = [
    { date: "2026-05-01", leading_cycle: 104.8 },
    { date: "2026-06-01", leading_cycle: 105.7 },
  ];
  assert.deepEqual(
    marketData.buildDenseMacroRows(source, targets, { carryForwardAfterLast: true })
      .map((row) => row.leading_cycle),
    [105.61290322580645, 105.7, 105.7, 105.7],
  );
  assert.deepEqual(
    marketData.buildDenseMacroRows(source, targets)
      .map((row) => row.leading_cycle),
    [105.61290322580645, 105.7],
  );
});

test("ends each macro series at its own latest observation by default", () => {
  const rows = marketData.buildDenseMacroRows([
    { date: "2026-05-01", leading_cycle: 104.8, news_sentiment: 98 },
    { date: "2026-05-03", news_sentiment: 101 },
    { date: "2026-06-01", leading_cycle: 105.1 },
  ], ["2026-05-01", "2026-05-02", "2026-05-03", "2026-06-01", "2026-06-02"]);

  assert.deepEqual(rows, [
    { date: "2026-05-01", leading_cycle: 104.8, news_sentiment: 98 },
    { date: "2026-05-02", leading_cycle: 104.80967741935484, news_sentiment: 99.5 },
    { date: "2026-05-03", leading_cycle: 104.81935483870967, news_sentiment: 101 },
    { date: "2026-06-01", leading_cycle: 105.1, news_sentiment: null },
  ]);
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

test("keeps normalization and scale references fixed while navigating history", () => {
  const rows = [
    { date: "2026-01-01", calm: 100, volatile: 100 },
    { date: "2026-01-02", calm: 102, volatile: 140 },
    { date: "2026-01-03", calm: 101, volatile: 70 },
  ];
  const bases = marketData.resolveNormalizationBases(rows, ["calm", "volatile"], { volatile: 250 });
  const scales = marketData.mergeFixedAutoScales(
    marketData.autoFitScales(rows, ["calm", "volatile"], bases),
    { volatile: 80 },
  );

  assert.equal(bases.volatile, 250);
  assert.equal(scales.volatile, 80);
});
