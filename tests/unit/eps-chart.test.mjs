import assert from "node:assert/strict";
import test from "node:test";

import { epsChart } from "../../docs/modules/eps-chart.mjs";
const ticker = "218410.KQ";

test("reuses the EPS fingerprint while the normalized financial array is unchanged", () => {
  let reads = 0;
  const record = {
    ticker,
    period: "2026-06",
    frequency: "quarter",
    get eps() {
      reads += 1;
      return 300;
    },
  };
  const analysis = { financials: [record] };
  const first = epsChart.epsDataFingerprint(analysis);
  const second = epsChart.epsDataFingerprint(analysis);
  assert.equal(second, first);
  assert.equal(reads, 1);
});

test("uses the last ten fully filed financial years for DART history", () => {
  assert.deepEqual(epsChart.completedFinancialYearRange("2026-08-24"), {
    startYear: 2016,
    endYear: 2025,
  });
  assert.deepEqual(epsChart.completedFinancialYearRange("2027-02-01"), {
    startYear: 2016,
    endYear: 2025,
  });
});

test("prioritizes quarterly EPS and allocates annual totals across missing quarters", () => {
  const points = epsChart.selectEpsPoints([
    { ticker, period: "2023-12", frequency: "annual", eps: 320, estimate: false },
    { ticker, period: "2024-12", frequency: "annual", eps: 400, estimate: false },
    { ticker, period: "2025-09", frequency: "quarter", eps: 100, estimate: false },
    { ticker, period: "2025-12", frequency: "quarter", eps: 120, estimate: false },
    { ticker, period: "2026-03", frequency: "quarter", eps: 180, estimate: false },
    { ticker, period: "2026-06", frequency: "quarter", eps: 240, estimate: true },
    { ticker, period: "2025-12", frequency: "annual", eps: 520, estimate: false },
    { ticker, period: "2026-12", frequency: "annual", eps: 1200, estimate: true },
    { ticker, period: "2027-12", frequency: "annual", eps: 1800, estimate: true },
  ], ticker);

  assert.deepEqual(points.map((point) => [point.period, point.frequency, point.chartEps]), [
    ["2023-03", "quarter", 80],
    ["2023-06", "quarter", 80],
    ["2023-09", "quarter", 80],
    ["2023-12", "quarter", 80],
    ["2024-03", "quarter", 100],
    ["2024-06", "quarter", 100],
    ["2024-09", "quarter", 100],
    ["2024-12", "quarter", 100],
    ["2025-03", "quarter", 150],
    ["2025-06", "quarter", 150],
    ["2025-09", "quarter", 100],
    ["2025-12", "quarter", 120],
    ["2026-03", "quarter", 180],
    ["2026-06", "quarter", 240],
    ["2026-09", "quarter", 390],
    ["2026-12", "quarter", 390],
    ["2027-03", "quarter", 450],
    ["2027-06", "quarter", 450],
    ["2027-09", "quarter", 450],
    ["2027-12", "quarter", 450],
  ]);
  assert.equal(points.find((point) => point.period === "2026-06").basis, "quarter");
  assert.equal(points.find((point) => point.period === "2027-12").basis, "annual-quarterly-fallback");
  assert.equal(points.find((point) => point.period === "2027-12").annualEps, 1800);
});

test("preserves the latest quarterly seasonality when future quarterly forecasts are absent", () => {
  const points = epsChart.selectEpsPoints([
    { ticker, period: "2027-03", frequency: "quarter", eps: 200, estimate: true },
    { ticker, period: "2027-06", frequency: "quarter", eps: 400, estimate: true },
    { ticker, period: "2027-09", frequency: "quarter", eps: 300, estimate: true },
    { ticker, period: "2027-12", frequency: "quarter", eps: 500, estimate: true },
    { ticker, period: "2027-12", frequency: "annual", eps: 1400, estimate: true },
    { ticker, period: "2028-12", frequency: "annual", eps: 2000, estimate: true },
  ], ticker);
  const forecast = points.filter((point) => point.period.startsWith("2028-"));

  assert.deepEqual(forecast.map((point) => point.chartEps), [350, 550, 450, 650]);
  assert.equal(forecast.reduce((sum, point) => sum + point.chartEps, 0), 2000);
  assert.ok(forecast.every((point) => point.basis === "annual-seasonal-fallback"));
  assert.ok(forecast.every((point) => point.seasonalitySourceYear === 2027));
});

test("keeps explicit future quarterly forecasts ahead of annual trend fallback", () => {
  const points = epsChart.selectEpsPoints([
    { ticker, period: "2025-12", frequency: "annual", eps: 800, estimate: false },
    { ticker, period: "2026-03", frequency: "quarter", eps: 260, estimate: true },
    { ticker, period: "2026-12", frequency: "annual", eps: 1200, estimate: true },
  ], ticker);

  assert.equal(points.find((point) => point.period === "2026-03").chartEps, 260);
  assert.deepEqual(
    points.filter((point) => point.period.startsWith("2026-")).slice(1).map((point) => point.chartEps),
    [940 / 3, 940 / 3, 940 / 3],
  );
  assert.ok(points.filter((point) => point.period.startsWith("2026-")).slice(1)
    .every((point) => point.basis === "annual-quarterly-fallback"));
});

test("keeps recorded quarterly EPS ahead of an annual record on the same date", () => {
  const points = epsChart.selectEpsPoints([
    { ticker, period: "2025-12", frequency: "quarter", eps: -50, estimate: false },
    { ticker, period: "2026-03", frequency: "quarter", eps: 20, estimate: false },
    { ticker, period: "2025-12", frequency: "annual", eps: -160, estimate: false },
  ], ticker);
  const q4 = points.find((point) => point.period === "2025-12");
  assert.equal(q4.chartEps, -50);
  assert.equal(q4.basis, "quarter");
  assert.equal(
    points.filter((point) => point.period.startsWith("2025-")).reduce((sum, point) => sum + point.chartEps, 0),
    -160,
  );
  const normalized = epsChart.normalizeEpsTrend(points);
  assert.ok(normalized.at(-1) > normalized[points.indexOf(q4)]);
});

test("rebases pre-split EPS to the post-split share basis without ticker-specific rules", () => {
  const samsung = "005930.KS";
  const points = epsChart.selectEpsPoints([
    { ticker: samsung, period: "2017-12", frequency: "annual", eps: 299868, estimate: false, source: "DART" },
    { ticker: samsung, period: "2018-03", frequency: "quarter", eps: 85435, estimate: false, source: "DART" },
    { ticker: samsung, period: "2018-06", frequency: "quarter", eps: 1617, estimate: false, source: "DART" },
    { ticker: samsung, period: "2018-09", frequency: "quarter", eps: 1909, estimate: false, source: "DART" },
    { ticker: samsung, period: "2018-12", frequency: "quarter", eps: 1227, estimate: false, source: "DART" },
    { ticker: samsung, period: "2018-12", frequency: "annual", eps: 6461, estimate: false, source: "DART" },
  ], samsung);
  const byPeriod = new Map(points.map((point) => [point.period, point]));

  assert.equal(byPeriod.get("2018-03").reportedEps, 85435);
  assert.equal(byPeriod.get("2018-03").epsAdjustmentFactor, 1 / 50);
  assert.ok(Math.abs(byPeriod.get("2018-03").eps - 1708.7) < 1e-9);
  assert.equal(byPeriod.get("2018-06").eps, 1617);
  assert.ok(Math.abs(byPeriod.get("2017-12").eps - (299868 / 4 / 50)) < 1e-9);
});

test("does not mistake an ordinary annual and quarterly mismatch for a stock split", () => {
  const points = epsChart.selectEpsPoints([
    { ticker, period: "2024-03", frequency: "quarter", eps: 110, estimate: false, source: "DART" },
    { ticker, period: "2024-06", frequency: "quarter", eps: 130, estimate: false, source: "DART" },
    { ticker, period: "2024-09", frequency: "quarter", eps: 95, estimate: false, source: "DART" },
    { ticker, period: "2024-12", frequency: "quarter", eps: 120, estimate: false, source: "DART" },
    { ticker, period: "2024-12", frequency: "annual", eps: 500, estimate: false, source: "DART" },
  ], ticker);

  assert.deepEqual(points.map((point) => point.eps), [110, 130, 95, 120]);
  assert.ok(points.every((point) => point.corporateActionAdjusted !== true));
});

test("preserves the visible magnitude of EPS growth from 300 to 700", () => {
  const normalized = epsChart.normalizeEpsTrend([
    { chartEps: 300 },
    { chartEps: 700 },
  ]);
  assert.equal(normalized[0], 100);
  assert.ok(Math.abs(normalized[1] - 233.33333333333331) < 1e-9);
});

test("divides annual EPS into quarterly equivalents when quarterly records are unavailable", () => {
  const points = epsChart.selectEpsPoints([
    { ticker, period: "2024-12", frequency: "annual", eps: 700, estimate: false },
    { ticker, period: "2025-12", frequency: "annual", eps: 900, estimate: false },
  ], ticker);
  assert.deepEqual(points.map((point) => point.chartEps), [175, 175, 175, 175, 225, 225, 225, 225]);
  assert.ok(points.every((point) => point.basis === "annual-quarterly-fallback"));
});

test("keeps a 2000 annual forecast visibly above a 1000 annual actual", () => {
  const points = epsChart.selectEpsPoints([
    { ticker, period: "2024-12", frequency: "annual", eps: 1000, estimate: false },
    { ticker, period: "2026-12", frequency: "annual", eps: 2000, estimate: true },
  ], ticker);
  const normalized = epsChart.normalizeEpsTrend(points);
  assert.ok(normalized.at(-1) - normalized[0] >= 100);
});

test("does not flatten distinct historical and future EPS values at a display ceiling", () => {
  const points = epsChart.selectEpsPoints([
    { ticker, period: "2019-06", frequency: "quarter", eps: 373, estimate: false },
    { ticker, period: "2024-03", frequency: "quarter", eps: 850, estimate: false },
    { ticker, period: "2026-12", frequency: "quarter", eps: 572, estimate: true },
    { ticker, period: "2027-12", frequency: "annual", eps: 2620, estimate: true },
    { ticker, period: "2028-12", frequency: "annual", eps: 2824, estimate: true },
  ], ticker);
  const normalized = epsChart.normalizeEpsTrend(points);
  const byPeriod = new Map(points.map((point, index) => [point.period, normalized[index]]));
  assert.ok(byPeriod.get("2024-03") > byPeriod.get("2019-06"));
  assert.ok(byPeriod.get("2027-12") > byPeriod.get("2026-12"));
  assert.ok(byPeriod.get("2028-12") > byPeriod.get("2027-12"));
});

test("builds one long-dash EPS trace per visible stock", () => {
  const traces = epsChart.buildEpsTraceModel({
    analysesByTicker: new Map([[ticker, { financials: [
      { ticker, period: "2025-12", frequency: "quarter", eps: 120, estimate: false },
      { ticker, period: "2026-03", frequency: "quarter", eps: 180, estimate: false },
    ] }]]),
    seriesModels: [{ series: ticker }, { series: "^KQ11" }],
    hiddenSeries: new Set(),
    seriesColor: () => "#11d4d4",
    labelName: () => "RFHIC",
    hoverShowPopup: true,
  }).traces;
  assert.equal(traces.length, 1);
  assert.equal(traces[0].name, "EPS");
  assert.equal(traces[0].line.dash, "dot");
  assert.equal(traces[0].line.width, 1);
  assert.equal(traces[0].line.color, "#11d4d4");
  assert.deepEqual(traces[0].marker.size, [12, 12]);
  assert.deepEqual(traces[0].marker.symbol, ["circle", "circle"]);
  assert.deepEqual(traces[0].marker.color, ["#000000", "#000000"]);
  assert.equal(traces[0].meta.overlayKind, "eps");
  assert.equal(traces[0].meta.seriesKey, `eps:${ticker}`);
  assert.equal(traces[0].text[0], "2025년 4분기 EPS 120");
  assert.equal(traces[0].text[1], "2026년 1분기 EPS 180");
  assert.equal(traces[0].hoverinfo, "skip");
  assert.equal(traces[0].hovertemplate, undefined);
  assert.deepEqual(traces[0].customdata, [["2025.12.31"], ["2026.3.31"]]);
});

test("draws quarterly markers for reported and annual-derived EPS points", () => {
  const trace = epsChart.buildEpsTraceModel({
    analysesByTicker: new Map([[ticker, { financials: [
      { ticker, period: "2025-12", frequency: "annual", eps: 400, estimate: false },
      { ticker, period: "2026-03", frequency: "quarter", eps: 120, estimate: false },
      { ticker, period: "2026-12", frequency: "annual", eps: 800, estimate: true },
    ] }]]),
    seriesModels: [{ series: ticker }],
    seriesColor: () => "#11d4d4",
  }).traces[0];

  assert.equal(trace.mode, "lines+markers");
  assert.ok(trace.marker.size.every((size) => size === 12));
  assert.ok(trace.marker.symbol.every((symbol) => symbol === "circle"));
  assert.ok(trace.marker.color.every((color) => color === "#000000"));
});

test("aligns the initial EPS point without compressing its growth amplitude", () => {
  const anchored = epsChart.anchorEpsTrendToStock(
    [100, 140, 233],
    [70, 90, 120, 180, 260, 420],
  );
  assert.equal(anchored[0], 120);
  assert.equal(anchored.at(-1) - anchored[0], 133);
});

test("keeps the EPS anchor stable while a visibility change rebuilds the stock model", () => {
  const financials = [
    { ticker, period: "2025-12", frequency: "quarter", eps: 100, estimate: false },
    { ticker, period: "2026-03", frequency: "quarter", eps: 200, estimate: false },
  ];
  const options = {
    analysesByTicker: new Map([[ticker, { financials }]]),
    hiddenSeries: new Set(),
  };
  const first = epsChart.buildEpsTraceModel({
    ...options,
    seriesModels: [{ series: ticker, values: [80, 100, 120] }],
  }).traces[0].y;
  const rebuilt = epsChart.buildEpsTraceModel({
    ...options,
    seriesModels: [{ series: ticker, values: [160, 200, 240] }],
  }).traces[0].y;

  assert.deepEqual(rebuilt, first);
});

test("changes the EPS render fingerprint when refreshed financial data gets a new stock anchor", () => {
  const financials = () => [
    { ticker, period: "2025-12", frequency: "quarter", eps: 100, estimate: false },
    { ticker, period: "2026-03", frequency: "quarter", eps: 200, estimate: false },
  ];
  const build = (stockValues) => epsChart.buildEpsTraceModel({
    analysesByTicker: new Map([[ticker, { financials: financials() }]]),
    hiddenSeries: new Set(),
    seriesModels: [{ series: ticker, values: stockValues }],
  }).traces[0];
  const first = build([80, 100, 120]);
  const refreshed = build([160, 200, 240]);

  assert.notDeepEqual(refreshed.y, first.y);
  assert.notEqual(refreshed.meta.renderFingerprint, first.meta.renderFingerprint);
});

test("keeps EPS handles independent from the stock-price transform", () => {
  const model = epsChart.buildEpsTraceModel({
    analysesByTicker: new Map([[ticker, { financials: [
      { ticker, period: "2025-12", frequency: "quarter", eps: 100, estimate: false },
      { ticker, period: "2026-03", frequency: "quarter", eps: 200, estimate: false },
    ] }]]),
    seriesModels: [{ series: ticker }],
    seriesScales: { [`eps:${ticker}`]: 2, [ticker]: 9 },
    seriesOffsets: { [`eps:${ticker}`]: 5, [ticker]: 40 },
    transformValues: (values, scale, offset) => values.map((value) => 100 + ((value - 100) * scale) + offset),
  });
  assert.ok(model.baseValuesBySeries[`eps:${ticker}`]);
  assert.equal(model.baseValuesBySeries[ticker], undefined);
  assert.equal(model.traces[0].y[0], 105);
  assert.ok(model.traces[0].y[1] > 105);
});

test("backfills only the rolling ten years while preserving older cached EPS", async () => {
  let analysis = {
    financials: [
      { ticker, period: "2017-12", frequency: "annual", eps: 80, estimate: false },
      { ticker, period: "2041-12", frequency: "annual", eps: 900, estimate: true },
    ],
    dartEpsCompletedYears: [2017],
    dartEpsHistoryVersion: 1,
  };
  const fetchedYears = [];
  const saved = [];
  const controller = epsChart.createEpsDataController(globalThis, {
    canUseGateway: () => true,
    ensureCurrent: async () => analysis,
    fetchYear: async ({ year }) => {
      fetchedYears.push(year);
      return { records: [{ ticker, period: `${year}-12`, frequency: "annual", eps: year, estimate: false }] };
    },
    getAnalysis: () => analysis,
    getVisibleTickers: () => [ticker],
    hasEps: (record) => record.financials.length > 0,
    hasHistoryCoverage: (record, range) => {
      const completed = new Set(record?.dartEpsCompletedYears || []);
      return Array.from({ length: range.endYear - range.startYear + 1 }, (_, index) => range.startYear + index)
        .every((year) => completed.has(year));
    },
    isEnabled: () => true,
    mapWithConcurrency: (items, _limit, iteratee) => Promise.all(items.map(iteratee)),
    normalizeAnalysis: (_ticker, payload, previous) => ({
      ...previous,
      ...payload,
      financials: [...previous.financials, ...payload.financials],
    }),
    readAnalysis: async () => null,
    resolveCorpCode: async () => "01078178",
    runRequest: (_ticker, factory) => factory(new AbortController().signal),
    saveAnalysis: async (_ticker, record) => saved.push(structuredClone(record)),
    setAnalysis: (_ticker, record) => { analysis = record; },
    today: () => "2040-08-24",
  });

  assert.equal(await controller.prepare(), 1);
  assert.deepEqual(fetchedYears, [2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037, 2038, 2039]);
  assert.ok(analysis.financials.some((record) => record.period === "2017-12"));
  assert.ok(analysis.financials.some((record) => record.period === "2041-12"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].dartEpsCompletedYears.length, 11);

  await controller.prepare();
  assert.equal(fetchedYears.length, 10);
});

test("checks current EPS on add or manual refresh without rerendering unchanged data", async () => {
  let analysis = {
    financials: [
      { ticker, period: "2026-06", frequency: "quarter", eps: 240, estimate: false },
    ],
  };
  let forceOnAdd = true;
  let nextFinancials = null;
  const currentRequests = [];
  const prepared = [];
  const controller = epsChart.createEpsDataController(globalThis, {
    canUseGateway: () => false,
    consumeForcedCurrent: () => {
      const value = forceOnAdd;
      forceOnAdd = false;
      return value;
    },
    ensureCurrent: async (_ticker, options) => {
      currentRequests.push(options.forceNetwork === true);
      if (nextFinancials) {
        analysis = { financials: nextFinancials };
        nextFinancials = null;
      }
      return analysis;
    },
    getAnalysis: () => analysis,
    getVisibleTickers: () => [ticker],
    hasEps: (record) => record.financials.length > 0,
    isEnabled: () => true,
    mapWithConcurrency: (items, _limit, iteratee) => Promise.all(items.map(iteratee)),
    onPrepared: (_loadedCount, _options, result) => prepared.push(result),
  });

  assert.equal(await controller.prepare(), 1);
  assert.equal(await controller.prepare({ forceNetwork: true }), 1);
  assert.deepEqual(currentRequests, [true, true]);
  assert.deepEqual(prepared.map((result) => result.changedCount), [0, 0]);
  assert.equal(controller.lastPrepareResult().changedCount, 0);

  nextFinancials = [
    ...analysis.financials,
    { ticker, period: "2026-09", frequency: "quarter", eps: 300, estimate: true },
  ];
  assert.equal(await controller.prepare({ forceNetwork: true }), 1);
  assert.equal(controller.lastPrepareResult().changedCount, 1);
});
