import assert from "node:assert/strict";
import test from "node:test";
import marketData from "../../docs/modules/market-data.mjs";

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

test("detects a corporate-action boundary after a long trading suspension", () => {
  const signal = marketData.findTickerPriceRebaseSignal(
    [{ date: "2026-07-28", close: 109000, volume: 100 }],
    [{ date: "2026-08-21", close: 27700, volume: 120 }],
    { boundaryDays: 3660 },
  );

  assert.equal(signal?.type, "boundary");
  assert.equal(signal?.date, "2026-08-21");
  assert.ok(signal?.ratio > 3.9);
});

test("detects a three-for-two adjusted-price overlap without flagging a daily limit move", () => {
  const split = marketData.findTickerPriceRebaseSignal(
    [{ date: "2026-08-20", close: 150, volume: 100 }],
    [{ date: "2026-08-20", close: 100, volume: 100 }],
    { ratioThreshold: 1.5 },
  );
  const dailyLimitMove = marketData.findTickerPriceRebaseSignal(
    [{ date: "2026-08-20", close: 100, volume: 100 }],
    [{ date: "2026-08-21", close: 70, volume: 100 }],
    { ratioThreshold: 1.5 },
  );

  assert.equal(split?.type, "overlap");
  assert.equal(dailyLimitMove, null);
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
  assert.equal(marketData.shiftIsoDateByMonths("2026-08-31", 6), "2026-02-28");
  assert.equal(marketData.shiftIsoDateByMonths("2024-08-31", 6), "2024-02-29");
  assert.equal(marketData.shiftIsoDateByMonths("invalid", 6), "invalid");
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

test("keeps the last published leading-cycle value between release dates", () => {
  const rows = marketData.buildDenseMacroRows([
    { date: "2026-08-01", leading_cycle: 104.8 },
    { date: "2026-09-01", leading_cycle: 104.2 },
  ], ["2026-08-01", "2026-08-15", "2026-08-31", "2026-09-01"], {
    stepColumns: ["leading_cycle"],
  });

  assert.deepEqual(rows.map((row) => row.leading_cycle), [104.8, 104.8, 104.8, 104.2]);
});

test("smooths publication-safe leading-cycle steps only in chart rows", () => {
  const macroRows = [
    { date: "2025-10-01", leading_cycle: 99.8 },
    { date: "2025-10-16", leading_cycle: 99.8 },
    { date: "2025-10-30", leading_cycle: 99.8 },
    { date: "2025-11-01", leading_cycle: 99.7 },
    { date: "2025-11-15", leading_cycle: 99.7 },
    { date: "2025-12-01", leading_cycle: 99.6 },
  ];
  const result = marketData.mergeSources({
    priceRows: macroRows.map(({ date }) => ({ date, AAA: 100 })),
    macroRows,
    start: "2025-10-01",
    end: "2025-12-01",
  });

  assert.equal(result.rows[0].leading_cycle, 99.8);
  assert.ok(result.rows[1].leading_cycle < 99.8);
  assert.ok(result.rows[1].leading_cycle > 99.7);
  assert.ok(result.rows[2].leading_cycle < result.rows[1].leading_cycle);
  assert.equal(result.rows[3].leading_cycle, 99.7);
  assert.ok(result.rows[4].leading_cycle < 99.7);
  assert.ok(result.rows[4].leading_cycle > 99.6);
  assert.equal(result.rows[5].leading_cycle, 99.6);
  assert.deepEqual(macroRows.map((row) => row.leading_cycle), [99.8, 99.8, 99.8, 99.7, 99.7, 99.6]);
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

test("auto-fits small percentage-point series without flattening them", () => {
  const rows = [
    { date: "2026-08-01", leading_cycle: 101.2, t10y1y: 0.62 },
    { date: "2026-08-02", leading_cycle: 101.3, t10y1y: 0.69 },
    { date: "2026-08-03", leading_cycle: 101.1, t10y1y: 0.54 },
  ];
  const options = { additiveSeries: ["t10y1y"] };
  const bases = marketData.resolveNormalizationBases(
    rows,
    ["leading_cycle", "t10y1y"],
    {},
    options,
  );
  const scales = marketData.autoFitScales(
    rows,
    ["leading_cycle", "t10y1y"],
    bases,
    options,
  );

  assert.equal(bases.t10y1y, 0.62);
  assert.ok(scales.t10y1y > 5000);
  assert.ok(scales.t10y1y <= 20000);
});


test("uses one current-window auto-fit rule for macro, deposit, and stock series", () => {
  const rows = [
    {
      date: "2026-08-01",
      leading_cycle: 101,
      t10y1y: 0.5,
      us_credit_spread: 1.2,
      customer_deposit: 100,
      "^KS11": 100,
    },
    {
      date: "2026-08-02",
      leading_cycle: 101.1,
      t10y1y: 0.7,
      us_credit_spread: 1.6,
      customer_deposit: 110,
      "^KS11": 130,
    },
    {
      date: "2026-08-03",
      leading_cycle: 100.9,
      t10y1y: 0.4,
      us_credit_spread: 1.1,
      customer_deposit: 105,
      "^KS11": 115,
    },
  ];
  const macroSeries = ["leading_cycle", "t10y1y", "us_credit_spread"];
  const fourSeries = [...macroSeries, "customer_deposit"];
  const options = {
    additiveSeries: ["t10y1y", "us_credit_spread"],
    minimumTargetRange: 20,
    postScaleBySeries: { leading_cycle: 20 },
  };
  const fourBases = marketData.resolveNormalizationBases(rows, fourSeries, {}, options);
  const fourScales = marketData.autoFitScales(rows, fourSeries, fourBases, options);
  const fiveSeries = [...fourSeries, "^KS11"];
  const fiveBases = marketData.resolveNormalizationBases(rows, fiveSeries, {}, options);
  const fiveScales = marketData.autoFitScales(rows, fiveSeries, fiveBases, options);

  assert.equal(fourScales.customer_deposit, 200);
  assert.equal(fiveScales.customer_deposit, fourScales.customer_deposit);
  assert.ok(fourScales.leading_cycle > 100);
  assert.ok(fourScales.t10y1y > 100);
  assert.ok(fourScales.us_credit_spread > 100);
  const fittedSpans = Object.fromEntries(fiveSeries.map((series) => {
    const base = fiveBases[series];
    const additive = ["t10y1y", "us_credit_spread"].includes(series);
    const values = rows.map((row) => additive
      ? 100 + row[series] - base
      : (row[series] / base) * 100);
    const postScale = series === "leading_cycle" ? 20 : 1;
    const fitted = values.map((value) => (
      100 + (value - 100) * (fiveScales[series] / 100) * postScale
    ));
    return [series, Math.max(...fitted) - Math.min(...fitted)];
  }));
  fiveSeries.forEach((series) => {
    assert.ok(
      fittedSpans[series] >= 19.8 && fittedSpans[series] <= 20.2,
      `${series} should use the same auto-fit target`,
    );
  });
});

test("auto-fits a multibagger and a quiet stock to the same visible span", () => {
  const rows = [
    { date: "2024-08-01", quiet: 100, multibagger: 100 },
    { date: "2025-08-01", quiet: 80, multibagger: 650 },
    { date: "2026-08-01", quiet: 120, multibagger: 1100 },
  ];
  const series = ["quiet", "multibagger"];
  const options = {
    centerCurrentRange: true,
    minimumTargetRange: 20,
  };
  const bases = marketData.resolveNormalizationBases(rows, series, {}, options);
  const scales = marketData.autoFitScales(rows, series, bases, options);
  const fittedSpans = Object.fromEntries(series.map((key) => {
    const normalized = rows.map((row) => (row[key] / bases[key]) * 100);
    const fitted = marketData.centeredScale(normalized, scales[key]);
    return [key, {
      low: Math.min(...fitted),
      high: Math.max(...fitted),
      span: Math.max(...fitted) - Math.min(...fitted),
    }];
  }));

  series.forEach((key) => {
    assert.ok(
      fittedSpans[key].span >= 19.99 && fittedSpans[key].span <= 20.01,
      `${key} should fill the same current-window height`,
    );
    assert.ok(Math.abs(fittedSpans[key].low - 90) < 0.01);
    assert.ok(Math.abs(fittedSpans[key].high - 110) < 0.01);
  });
});
