import assert from "node:assert/strict";
import test from "node:test";
import auxiliaryChartModel from "../../docs/modules/auxiliary-chart-model.mjs";


await import("../../docs/modules/chart-loader.mjs");
const { auxiliaryChartRuntime: auxiliaryRuntime } = await import("../../docs/modules/auxiliary-chart-runtime.mjs");
const {
  buildAuxiliaryChartModel,
  buildAuxiliaryPanelLayout,
  buildAuxiliaryViewportRanges,
  buildThresholdEnvelopeSeries,
  buildThresholdFillPolygons,
  buildThresholdZones,
  insertDatedGapBreaks,
  NEWS_MOVING_AVERAGE_DAYS,
  NEWS_MOVING_AVERAGE_MIN_DAYS,
  NEWS_MOVING_AVERAGE_MAX_DAYS,
  normalizeNewsMovingAverageDays,
  rollingAverage,
} = auxiliaryChartModel;

test("auxiliary render settlement returns values after every panel finishes", async () => {
  const values = await auxiliaryRuntime.settleAuxiliaryRenderTasks([
    Promise.resolve("macd"),
    Promise.resolve("panels"),
  ]);
  assert.deepEqual(values, ["macd", "panels"]);
});

test("MACD line and legend marker share the stock color without repeating the date", () => {
  const pair = auxiliaryRuntime.buildMacdSeriesTracePair({
    series: "218410.KQ",
    name: "RFHIC",
    color: "#9acd32",
    dates: ["2026-08-31", "2026-09-01"],
    values: [0.2, 0.4],
    signal: 0.3,
    showHover: true,
  });

  assert.equal(pair.lineTrace.line.color, "#9acd32");
  assert.equal(pair.lineTrace.showlegend, false);
  assert.equal(pair.lineTrace.hovertemplate.includes("%{x"), false);
  assert.equal(pair.legendTrace.marker.color, "#9acd32");
  assert.equal(pair.legendTrace.marker.size, 7);
  assert.equal(pair.legendTrace.showlegend, true);
  assert.equal(pair.legendTrace.legendgroup, pair.lineTrace.legendgroup);
});

test("a disconnected auxiliary latest point receives one visible marker", () => {
  assert.deepEqual(auxiliaryRuntime.isolatedAuxiliaryMarkerSizes([
    40, 42, null, 32,
  ]), [0, 0, 0, 5]);
  assert.deepEqual(auxiliaryRuntime.isolatedAuxiliaryMarkerSizes([
    40, null, 32, 34,
  ]), [5, 0, 0, 0]);
});

test("auxiliary render settlement waits for siblings before surfacing a failure", async () => {
  const expected = new Error("MACD render failed");
  let siblingSettled = false;
  const sibling = Promise.resolve().then(() => {
    siblingSettled = true;
    return "panels";
  });

  await assert.rejects(
    auxiliaryRuntime.settleAuxiliaryRenderTasks([Promise.reject(expected), sibling]),
    (error) => error === expected,
  );
  assert.equal(siblingSettled, true);
});

test("updates stable auxiliary chart topology without rebuilding Plotly", async () => {
  const firstTrace = {
    type: "scatter",
    mode: "lines",
    x: ["2026-01-01", "2026-01-02"],
    y: [100, 101],
    name: "ADR KOSPI",
    meta: { auxiliarySeriesKey: "adr_kospi" },
  };
  const layout = {
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { domain: [0, 1], anchor: "x" },
  };
  const element = { data: [], _fullLayout: null };
  const calls = [];
  const plotly = {
    react: async (target, traces) => {
      calls.push("react");
      target.data = traces;
      target._fullLayout = { xaxis: {} };
    },
    update: async (target, payload) => {
      calls.push("update");
      target.data = target.data.map((trace, index) => ({
        ...trace,
        x: payload.x[index],
        y: payload.y[index],
      }));
    },
  };

  assert.deepEqual(
    await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, [firstTrace], layout, {}),
    { mode: "full", attemptedPartial: false },
  );
  const nextTrace = { ...firstTrace, y: [102, 104] };
  assert.deepEqual(
    await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, [nextTrace], layout, {}),
    { mode: "partial", attemptedPartial: true, updateScope: "traces" },
  );
  assert.deepEqual(calls, ["react", "update"]);
  assert.deepEqual(element.data[0].y, [102, 104]);
});

test("updates only changed auxiliary traces and skips identical frames", async () => {
  const traces = ["first", "second"].map((series, index) => ({
    type: "scatter",
    mode: "lines",
    x: ["2026-01-01", "2026-01-02"],
    y: [100 + index, 101 + index],
    meta: { auxiliarySeriesKey: series, renderFingerprint: `${series}:1` },
  }));
  const layout = { xaxis: {}, yaxis: { domain: [0, 1] } };
  const element = { data: [], _fullLayout: null };
  const updates = [];
  const plotly = {
    react: async (target, next) => {
      target.data = next;
      target._fullLayout = { xaxis: {} };
    },
    update: async (_target, payload, layoutPayload, indexes) => {
      updates.push({ payload, layoutPayload, indexes });
    },
  };

  await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, traces, layout, {});
  const next = [
    traces[0],
    {
      ...traces[1],
      y: [202, 204],
      meta: { ...traces[1].meta, renderFingerprint: "second:2" },
    },
  ];
  assert.deepEqual(
    await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, next, layout, {}),
    { mode: "partial", attemptedPartial: true, updateScope: "traces" },
  );
  assert.deepEqual(updates[0].indexes, [1]);
  assert.deepEqual(updates[0].payload.y, [[202, 204]]);
  assert.deepEqual(updates[0].layoutPayload, {});
  assert.deepEqual(
    await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, next, layout, {}),
    { mode: "skipped", attemptedPartial: true, updateScope: "unchanged" },
  );
  assert.equal(updates.length, 1);
});

test("relayouts an unchanged auxiliary trace set without restyling it", async () => {
  const trace = {
    type: "scatter",
    mode: "lines",
    x: ["2026-01-01"],
    y: [100],
    meta: { auxiliarySeriesKey: "adr_kospi", renderFingerprint: "adr:1" },
  };
  const element = { data: [], _fullLayout: null };
  const calls = [];
  const plotly = {
    react: async (target, traces) => {
      target.data = traces;
      target._fullLayout = { xaxis: {} };
    },
    update: async () => calls.push("update"),
    relayout: async () => calls.push("relayout"),
  };
  await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, [trace], {
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { domain: [0, 1] },
  }, {});
  const result = await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, [trace], {
    xaxis: { range: ["2026-01-02", "2026-01-03"] },
    yaxis: { domain: [0, 1] },
  }, {});
  assert.deepEqual(result, { mode: "partial", attemptedPartial: true, updateScope: "layout" });
  assert.deepEqual(calls, ["relayout"]);
});

test("auxiliary model resolver coalesces work, caches the result, and falls back safely", async () => {
  let workerCalls = 0;
  let fallbackCalls = 0;
  let releaseWorker;
  const resolver = auxiliaryRuntime.createAuxiliaryChartModelResolver({
    requestModel: async () => {
      workerCalls += 1;
      return new Promise((resolve) => { releaseWorker = resolve; });
    },
    buildModel: () => {
      fallbackCalls += 1;
      return { rows: ["fallback"] };
    },
    normalizeModel: (value) => value?.rows ? value : null,
  });
  const first = resolver.resolve("same", { sources: {} });
  const second = resolver.resolve("same", { sources: {} });
  releaseWorker({ rows: ["worker"] });
  assert.equal(await first, await second);
  assert.deepEqual(await resolver.resolve("same", { sources: {} }), { rows: ["worker"] });
  assert.equal(workerCalls, 1);
  assert.equal(resolver.stats().coalesced, 1);
  assert.equal(resolver.stats().hits, 1);

  resolver.invalidate();
  const fallback = auxiliaryRuntime.createAuxiliaryChartModelResolver({
    requestModel: async () => { throw new Error("worker unavailable"); },
    buildModel: ({ adrRows }) => {
      fallbackCalls += 1;
      return { rows: adrRows };
    },
    normalizeModel: (value) => value,
  });
  assert.deepEqual(await fallback.resolve("fallback", {
    sources: { adrRows: [1, 2], macroRows: [] },
  }), { rows: [1, 2] });
  assert.equal(fallback.source(), "sync");
  assert.equal(fallback.stats().fallbacks, 1);
  assert.equal(fallbackCalls, 1);
});

test("auxiliary model resolver sends unchanged source rows to the worker only once", async () => {
  const payloads = [];
  const resolver = auxiliaryRuntime.createAuxiliaryChartModelResolver({
    requestModel: async (payload) => {
      payloads.push(payload);
      return { rows: [payload.seriesKeys?.[0] || "none"] };
    },
    buildModel: () => ({ rows: ["fallback"] }),
    normalizeModel: (value) => value?.rows ? value : null,
  });
  const sources = { adrRows: [{ date: "2026-09-04", fear_greed: 32 }], macroRows: [] };
  await resolver.resolve("fear", {
    datasetKey: "adr:1|macro:1",
    seriesKeys: ["fear_greed"],
    sources,
  });
  await resolver.resolve("adr", {
    datasetKey: "adr:1|macro:1",
    seriesKeys: ["adr_kospi"],
    sources,
  });

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].sources, sources);
  assert.equal(payloads[1].sources, undefined);
  assert.equal(resolver.stats().workerDatasetCached, true);
});

test("rebuilds auxiliary charts when panel topology changes", async () => {
  const trace = {
    type: "scatter",
    mode: "lines",
    x: ["2026-01-01"],
    y: [100],
    meta: { auxiliarySeriesKey: "adr_kospi" },
  };
  const element = { data: [], _fullLayout: null };
  const calls = [];
  const plotly = {
    react: async (target, traces) => {
      calls.push("react");
      target.data = traces;
      target._fullLayout = { xaxis: {} };
    },
    update: async () => calls.push("update"),
  };
  await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, [trace], {
    xaxis: {}, yaxis: { domain: [0, 1] },
  }, {});
  await auxiliaryRuntime.renderAuxiliaryPlot(plotly, element, [trace], {
    xaxis: {}, yaxis: { domain: [0.5, 1] }, yaxis2: { domain: [0, 0.45] },
  }, {});
  assert.deepEqual(calls, ["react", "react"]);
});

test("auxiliary panels collapse without leaving an empty axis domain", () => {
  const full = buildAuxiliaryPanelLayout({
    adr: true,
    fearGreed: true,
    newsSentiment: true,
    vkospi: true,
  });
  const collapsed = buildAuxiliaryPanelLayout({
    adr: true,
    fearGreed: false,
    newsSentiment: true,
    vkospi: false,
  });

  assert.equal(full.chartHeight, 577);
  assert.equal(full.separators.length, 3);
  assert.equal(full.bottomAxis, "y4");
  assert.deepEqual(full.axes, {
    adr: "y",
    vkospi: "y2",
    fearGreed: "y3",
    newsSentiment: "y4",
  });
  assert.deepEqual(collapsed.activeKeys, ["adr", "newsSentiment"]);
  assert.equal(collapsed.chartHeight, 371);
  assert.equal(collapsed.separators.length, 1);
  assert.equal(collapsed.bottomAxis, "y2");
  assert.deepEqual(collapsed.axes, { adr: "y", newsSentiment: "y2" });
  assert.equal(collapsed.domains.fearGreed, undefined);
  assert.equal(collapsed.domains.adr[1], 1);
  assert.ok(collapsed.domains.newsSentiment[0] < collapsed.domains.newsSentiment[1]);
});

test("all auxiliary panel combinations keep fixed pixel heights and compact cleanly", () => {
  const keys = ["adr", "vkospi", "fearGreed", "newsSentiment"];
  const targetPixels = { adr: 180, fearGreed: 85, newsSentiment: 85, vkospi: 85 };

  for (let mask = 0; mask < 16; mask += 1) {
    const visibility = Object.fromEntries(keys.map((key, index) => [
      key,
      Boolean(mask & (1 << index)),
    ]));
    const layout = buildAuxiliaryPanelLayout(visibility);
    const activeKeys = keys.filter((key) => visibility[key]);
    assert.deepEqual(layout.activeKeys, activeKeys);
    assert.equal(layout.chartHeight, activeKeys.length
      ? 88 + activeKeys.reduce((sum, key) => sum + targetPixels[key], 0)
        + Math.max(0, activeKeys.length - 1) * 18
      : 42);
    assert.deepEqual(layout.axes, Object.fromEntries(activeKeys.map((key, index) => [
      key,
      index === 0 ? "y" : `y${index + 1}`,
    ])));
    activeKeys.forEach((key) => {
      const domain = layout.domains[key];
      const actualPixels = (domain[1] - domain[0]) * layout.plotHeight;
      assert.ok(Math.abs(actualPixels - targetPixels[key]) < 1e-9);
    });
  }
});

test("auxiliary panels follow activation order while preserving their heights", () => {
  const layout = buildAuxiliaryPanelLayout({
    adr: true,
    fearGreed: false,
    newsSentiment: false,
    vkospi: true,
  }, {
    panelOrder: ["vkospi", "adr", "fearGreed", "newsSentiment"],
  });

  assert.deepEqual(layout.activeKeys, ["vkospi", "adr"]);
  assert.deepEqual(layout.axes, { vkospi: "y", adr: "y2" });
  assert.equal(layout.bottomAxis, "y2");
  assert.ok(layout.domains.vkospi[0] > layout.domains.adr[1]);
  assert.equal(Math.round((layout.domains.vkospi[1] - layout.domains.vkospi[0]) * layout.plotHeight), 85);
  assert.equal(Math.round((layout.domains.adr[1] - layout.domains.adr[0]) * layout.plotHeight), 180);
});


test("threshold zones preserve seam points at low and high crossings", () => {
  const zones = buildThresholdZones([100, 70, 90, 130, 110, null], 80, 120);

  assert.deepEqual(zones.low, [null, 70, 90, null, null, null]);
  assert.deepEqual(zones.middle, [100, 70, 90, 130, 110, null]);
  assert.deepEqual(zones.high, [null, null, null, 130, 110, null]);
  assert.deepEqual(zones.lowBaseline, [null, 80, 80, null, null, null]);
  assert.deepEqual(zones.highBaseline, [null, null, null, 120, 120, null]);
});

test("threshold fill polygons close exactly at interpolated crossings", () => {
  const polygons = buildThresholdFillPolygons(
    ["2026-02-01", "2026-02-02", "2026-02-03"],
    [100, 70, 100],
    80,
    "low",
  );

  assert.equal(polygons.length, 1);
  assert.deepEqual(polygons[0].values, [80, 70, 80, 80, 80]);
  assert.equal(polygons[0].dates[0], "2026-02-01T16:00:00.000Z");
  assert.equal(polygons[0].dates[2], "2026-02-02T08:00:00.000Z");
  assert.equal(polygons[0].dates.at(-1), polygons[0].dates[0]);
});

test("threshold equality does not create a stray fill", () => {
  const low = buildThresholdFillPolygons(
    ["2026-02-01", "2026-02-02", "2026-02-03"],
    [50, 25, 50],
    25,
    "low",
  );
  const high = buildThresholdFillPolygons(
    ["2026-02-01", "2026-02-02", "2026-02-03"],
    [50, 75, 50],
    75,
    "high",
  );

  assert.deepEqual(low, []);
  assert.deepEqual(high, []);
});

test("threshold fill polygons never bridge missing data", () => {
  const polygons = buildThresholdFillPolygons(
    ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"],
    [50, 20, null, 20, 50],
    25,
    "low",
  );

  assert.equal(polygons.length, 2);
  assert.ok(polygons[0].dates.every((date) => String(date).slice(0, 10) <= "2026-02-02"));
  assert.ok(polygons[1].dates.every((date) => String(date).slice(0, 10) >= "2026-02-04"));
});

test("ADR threshold envelopes combine two lines without stacking opacity", () => {
  const series = [
    {
      dates: ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"],
      values: [100, 70, null, 130],
    },
    {
      dates: ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"],
      values: [90, 75, 60, 125],
    },
  ];

  assert.deepEqual(buildThresholdEnvelopeSeries(series, "low"), {
    dates: ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"],
    values: [90, 70, 60, 125],
  });
  assert.deepEqual(buildThresholdEnvelopeSeries(series, "high"), {
    dates: ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"],
    values: [100, 75, 60, 130],
  });
});


test("auxiliary model keeps ADR and news dates independent", () => {
  const model = buildAuxiliaryChartModel({
    startDate: "2026-01-02",
    adrLowThreshold: 80,
    adrHighThreshold: 120,
    newsLowThreshold: 90,
    newsHighThreshold: 110,
    adrRows: [
      { date: "2026-01-01", adr_kospi: 90, adr_kosdaq: 95, fear_greed: 40 },
      { date: "2026-01-02", adr_kospi: 75, adr_kosdaq: 125, fear_greed: 45 },
      { date: "2026-01-03", adr_kospi: 85, adr_kosdaq: 115, fear_greed: 50 },
    ],
    macroRows: [
      { date: "2026-01-02", news_sentiment: null },
      { date: "2026-01-03", news_sentiment: 105 },
      { date: "2026-01-04", news_sentiment: 112 },
    ],
    // VKOSPI can have a different calendar from ADR and macro data.
    vkospiRows: [],
  });

  assert.deepEqual(model.dates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.adrKospiDates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.adrKosdaqDates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.fearGreedDates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.newsDates, ["2026-01-03", "2026-01-04"]);
  assert.deepEqual(model.kospiValues, [75, 85]);
  assert.deepEqual(model.newsValues, [105, 112]);
  assert.equal(model.adrRowCount, 2);
  assert.equal(model.newsRowCount, 2);
  assert.ok(model.adrYMin < 75);
  assert.ok(model.newsYMax >= 112);
});

test("unrelated auxiliary dates do not split ADR or fear-greed lines", () => {
  const model = buildAuxiliaryChartModel({
    startDate: "2026-08-01",
    adrRows: [
      { date: "2026-08-03", adr_kospi: 91, adr_kosdaq: 88, fear_greed: 42 },
      { date: "2026-08-04", vix: 18.2 },
      { date: "2026-08-05", vkospi: 21.1 },
      { date: "2026-08-06", adr_kospi: 94, adr_kosdaq: 90, fear_greed: 45 },
    ],
  });

  assert.deepEqual(model.adrKospiDates, ["2026-08-03", "2026-08-06"]);
  assert.deepEqual(model.adrKospiValues, [91, 94]);
  assert.deepEqual(model.adrKosdaqDates, ["2026-08-03", "2026-08-06"]);
  assert.deepEqual(model.adrKosdaqValues, [88, 90]);
  assert.deepEqual(model.fearGreedDates, ["2026-08-03", "2026-08-06"]);
  assert.deepEqual(model.fearGreedValues, [42, 45]);
});

test("VKOSPI stays independent and long missing periods break the line", () => {
  const model = buildAuxiliaryChartModel({
    startDate: "2010-01-01",
    adrRows: [
      { date: "2010-01-04", vkospi: 20.94 },
      { date: "2010-01-05", vkospi: 20.6 },
      { date: "2026-08-10", vkospi: 69.55 },
    ],
  });

  assert.deepEqual(model.vkospiDates, [
    "2010-01-04",
    "2010-01-05",
    "2010-01-06",
    "2026-08-10",
  ]);
  assert.deepEqual(model.vkospiValues, [20.94, 20.6, null, 69.55]);
  assert.equal(model.vkospiRowCount, 3);
});

test("volatility panel keeps VKOSPI and VIX on independent calendars", () => {
  const model = buildAuxiliaryChartModel({
    startDate: "2026-08-01",
    adrRows: [
      { date: "2026-08-03", vkospi: 20.5 },
      { date: "2026-08-04", vix: 18.2 },
      { date: "2026-08-05", vkospi: 21.1, vix: 19.4 },
    ],
  });

  assert.deepEqual(model.vkospiDates, ["2026-08-03", "2026-08-05"]);
  assert.deepEqual(model.vkospiValues, [20.5, 21.1]);
  assert.deepEqual(model.vixDates, ["2026-08-04", "2026-08-05"]);
  assert.deepEqual(model.vixValues, [18.2, 19.4]);
  assert.equal(model.vkospiRowCount, 2);
  assert.equal(model.vixRowCount, 2);
});

test("gap insertion keeps a continuous recent VKOSPI segment untouched", () => {
  assert.deepEqual(insertDatedGapBreaks([
    { date: "2026-08-07", vkospi: 75.59 },
    { date: "2026-08-10", vkospi: 69.55 },
  ], "vkospi"), {
    dates: ["2026-08-07", "2026-08-10"],
    values: [75.59, 69.55],
    rowCount: 2,
  });
});

test("a long Korean market holiday does not create a false VKOSPI break", () => {
  assert.deepEqual(insertDatedGapBreaks([
    { date: "2017-09-29", vkospi: 14.2 },
    { date: "2017-10-10", vkospi: 15.1 },
  ], "vkospi"), {
    dates: ["2017-09-29", "2017-10-10"],
    values: [14.2, 15.1],
    rowCount: 2,
  });
});

test("news smoothing defaults to the original daily values", () => {
  const values = Array.from({ length: 6 }, (_, index) => index + 1);
  const smoothed = rollingAverage(values, NEWS_MOVING_AVERAGE_DAYS);

  assert.equal(NEWS_MOVING_AVERAGE_DAYS, 1);
  assert.equal(smoothed[4], 5);
  assert.equal(smoothed[5], 6);
  assert.deepEqual(rollingAverage(values, 3).slice(-2), [4, 5]);
});

test("news smoothing accepts display-only periods from one to twenty days", () => {
  assert.equal(NEWS_MOVING_AVERAGE_MIN_DAYS, 1);
  assert.equal(NEWS_MOVING_AVERAGE_MAX_DAYS, 20);
  assert.equal(normalizeNewsMovingAverageDays(-10), 1);
  assert.equal(normalizeNewsMovingAverageDays(8.6), 9);
  assert.equal(normalizeNewsMovingAverageDays(200), 20);

  const rows = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    news_sentiment: index + 1,
  }));
  const daily = buildAuxiliaryChartModel({ macroRows: rows, newsMovingAverageDays: 1 });
  const twentyDay = buildAuxiliaryChartModel({ macroRows: rows, newsMovingAverageDays: 20 });
  assert.equal(daily.newsValues.at(-1), 20);
  assert.equal(twentyDay.newsValues.at(-1), 10.5);
  assert.equal(twentyDay.newsMovingAverageDays, 20);
});

test("viewport ranges ignore outliers outside the visible dates", () => {
  const model = {
    dates: ["2020-01-01", "2026-01-01", "2026-01-02"],
    kospiValues: [280, 96, 101],
    kosdaqValues: [260, 103, 108],
    newsDates: ["2020-01-01", "2026-01-01", "2026-01-02"],
    newsValues: [180, 99, 101],
    vkospiDates: ["2020-01-01", "2026-01-01", "2026-01-02"],
    vkospiValues: [90, 18, 20],
    vixDates: ["2020-01-01", "2026-01-01", "2026-01-02"],
    vixValues: [80, 16, 24],
  };
  const ranges = buildAuxiliaryViewportRanges(
    model,
    ["2026-01-01", "2026-01-02"],
  );

  assert.deepEqual(ranges.adr, [77.5, 121.2]);
  assert.deepEqual(ranges.news, [88, 112]);
  assert.deepEqual(ranges.vkospi, [15, 25]);
});

test("viewport ranges preserve the same result for unsorted fallback dates", () => {
  const ranges = buildAuxiliaryViewportRanges({
    dates: ["2026-01-02", "2020-01-01", "2026-01-01"],
    kospiValues: [101, 280, 96],
    kosdaqValues: [108, 260, 103],
    newsDates: ["2026-01-02", "2020-01-01", "2026-01-01"],
    newsValues: [101, 180, 99],
    vkospiDates: ["2026-01-02", "2020-01-01", "2026-01-01"],
    vkospiValues: [20, 90, 18],
    vixDates: ["2026-01-02", "2020-01-01", "2026-01-01"],
    vixValues: [24, 80, 16],
  }, ["2026-01-02", "2026-01-01"]);

  assert.deepEqual(ranges.adr, [77.5, 121.2]);
  assert.deepEqual(ranges.news, [88, 112]);
  assert.deepEqual(ranges.vkospi, [15, 25]);
});

test("viewport ranges do not inspect data for hidden auxiliary panels", () => {
  const hiddenValues = [];
  Object.defineProperty(hiddenValues, 0, {
    configurable: true,
    get() {
      throw new Error("hidden panel values must not be inspected");
    },
  });
  hiddenValues.length = 1;

  const ranges = buildAuxiliaryViewportRanges({
    dates: ["2026-01-01"],
    kospiValues: hiddenValues,
    kosdaqValues: hiddenValues,
    newsDates: ["2026-01-01"],
    newsValues: hiddenValues,
    vkospiDates: ["2026-01-01"],
    vkospiValues: hiddenValues,
    vixDates: ["2026-01-01"],
    vixValues: hiddenValues,
  }, ["2026-01-01", "2026-01-01"], {
    activePanels: {
      adr: false,
      newsSentiment: false,
      vkospi: false,
    },
  });

  assert.deepEqual(ranges.adr, [77.5, 121.2]);
  assert.deepEqual(ranges.news, [88, 112]);
  assert.deepEqual(ranges.vkospi, [7.6, 42.4]);
});

test("auxiliary model skips calculations for panels that are off", () => {
  const model = buildAuxiliaryChartModel({
    adrRows: [
      { date: "2026-09-03", adr_kospi: 100, fear_greed: 31, vkospi: 18 },
      { date: "2026-09-04", adr_kospi: 101, fear_greed: 32, vkospi: 19 },
    ],
    macroRows: [{ date: "2026-09-04", news_sentiment: 105 }],
    seriesKeys: ["fear_greed"],
  });

  assert.equal(model.availability.adrKospi, true);
  assert.equal(model.availability.newsSentiment, true);
  assert.deepEqual(model.adrKospiValues, []);
  assert.deepEqual(model.newsValues, []);
  assert.deepEqual(model.vkospiValues, []);
  assert.deepEqual(model.fearGreedValues, [31, 32]);
});
