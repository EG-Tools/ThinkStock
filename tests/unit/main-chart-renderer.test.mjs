import assert from "node:assert/strict";
import test from "node:test";


const { mainChartRenderer: renderer } = await import("../../docs/modules/main-chart-renderer.mjs");


function trace(seriesKey, values = [1, 2]) {
  return {
    type: "scatter",
    mode: "lines",
    x: ["2026-01-01", "2026-01-02"],
    y: values,
    meta: { seriesKey },
  };
}

test("classifies chart overlays through one compatibility contract", () => {
  assert.deepEqual(renderer.chartOverlayDescriptor(trace("005930.KS")), {
    adjustable: true,
    event: false,
    grouped: false,
    hoverPriority: 100,
    identity: "series:005930.KS",
    kind: "price",
    rangeRole: "historical",
    seriesKey: "005930.KS",
  });
  const eps = {
    ...trace("eps:005930.KS"),
    meta: { overlayKind: "eps", seriesKey: "eps:005930.KS", isEpsTrace: true },
  };
  assert.equal(renderer.chartOverlayDescriptor(eps).adjustable, true);
  assert.equal(renderer.chartOverlayDescriptor(eps).hoverPriority, 10);
  assert.equal(renderer.chartOverlayDescriptor(eps).rangeRole, "future");
  assert.equal(renderer.traceIdentity(eps), "series:eps:005930.KS");
  const disclosure = { meta: { overlayKind: "disclosure", isDisclosureTrace: true } };
  assert.equal(renderer.chartOverlayDescriptor(disclosure).event, true);
  assert.equal(renderer.chartOverlayDescriptor(disclosure).hoverPriority, 20);
  assert.equal(renderer.chartOverlayDescriptor(disclosure).rangeRole, "none");
  assert.equal(renderer.traceIdentity(disclosure), "disclosure");
});

test("selects visible range-bearing traces through the overlay contract", () => {
  const price = trace("005930.KS");
  const eps = {
    ...trace("eps:005930.KS"),
    meta: { overlayKind: "eps", seriesKey: "eps:005930.KS", isEpsTrace: true },
  };
  const disclosure = {
    visible: true,
    meta: { overlayKind: "disclosure", isDisclosureTrace: true },
  };
  const hiddenPrice = { ...trace("000660.KS"), visible: "legendonly" };

  assert.deepEqual(renderer.rangeBearingTraces([
    price,
    eps,
    disclosure,
    hiddenPrice,
  ]), [price, eps]);
  assert.deepEqual(renderer.rangeBearingTraces([price, eps], ["historical"]), [price]);
});

test("builds one immediate visibility update for every trace owned by a series", () => {
  const traces = [
    { meta: { overlayKind: "grouped-hover", hoverGroupTicker: "A" } },
    trace("A"),
    { meta: { overlayKind: "eps", seriesKey: "eps:A" } },
    { meta: { overlayKind: "ai-scenario", seriesKey: "A" } },
    { meta: { overlayKind: "disclosure", isDisclosureTrace: true } },
    trace("B"),
  ];

  assert.deepEqual(renderer.buildSeriesVisibilityUpdate(traces, "A", false), {
    traceIndexes: [0, 1, 2, 3],
    values: ["legendonly", "legendonly", "legendonly", "legendonly"],
  });
  assert.deepEqual(renderer.buildSeriesVisibilityUpdate(traces, "A", true).values, [
    true,
    true,
    true,
    true,
  ]);
  assert.deepEqual(renderer.buildSeriesVisibilityUpdate(
    traces,
    "A",
    true,
    { includeKinds: ["price"] },
  ), {
    traceIndexes: [1],
    values: [true],
  });
});

test("hides only one series inside shared event-marker traces", () => {
  const traces = [
    trace("A"),
    {
      x: ["2026-08-20", "2026-08-21", "2026-08-22"],
      meta: {
        overlayKind: "timing-buy",
        isMarketTimingBuyTrace: true,
        pointTickers: ["A", "B", "A"],
      },
    },
    {
      x: ["2026-08-23"],
      meta: {
        overlayKind: "disclosure",
        isDisclosureTrace: true,
        pointTickers: ["B"],
      },
    },
  ];

  assert.deepEqual(renderer.buildSeriesEventPointHideUpdate(traces, "A"), {
    traceIndexes: [1],
    values: [[null, "2026-08-21", null]],
  });
  assert.deepEqual(renderer.buildSeriesEventPointHideUpdate(traces, "B"), {
    traceIndexes: [1, 2],
    values: [["2026-08-20", null, "2026-08-22"], [null]],
  });
});

test("main chart composition builds line, EPS, AI, and event layers in one pipeline", async () => {
  let prepared = 0;
  const model = {
    rows: [
      { date: "2026-08-24", TEST: 100 },
      { date: "2026-08-25", TEST: 105 },
    ],
    selected: ["TEST"],
    seriesModels: [{
      series: "TEST",
      xValues: ["2026-08-24", "2026-08-25"],
      values: [100, 105],
      rawTexts: ["100", "105"],
      baseValues: [100, 105],
      baseLineWidth: 1,
    }],
  };
  const result = await renderer.buildMainChartComposition({
    model,
    hiddenSeries: new Set(),
    labelName: (value) => value,
    seriesColor: () => "#ffffff",
    buildEpsTraceModel: () => ({
      traces: [{ meta: { overlayKind: "eps", seriesKey: "eps:TEST" } }],
      baseValuesBySeries: { "eps:TEST": [1, 2] },
    }),
    buildAiForecastTraces: async () => [{ meta: { overlayKind: "ai-scenario", seriesKey: "TEST" } }],
    prepareEventModels: async () => { prepared += 1; },
    buildEventArguments: () => ({ ready: true }),
    buildEventTraces: ({ ready }) => ready ? [{ meta: { overlayKind: "timing-buy" } }] : [],
  });

  assert.equal(prepared, 1);
  assert.deepEqual(result.traces.map((item) => item.meta?.overlayKind), [
    "price",
    "eps",
    "ai-scenario",
    "timing-buy",
  ]);
  assert.deepEqual(result.baseValuesBySeries["eps:TEST"], [1, 2]);
  assert.equal(result.displayPointCount, 2);
});

test("uses detailed macro names and stacks long macro prices on a second line", () => {
  const macroSeries = ["leading_cycle", "t10y1y", "us_credit_spread"];
  const detailedNames = {
    leading_cycle: "한국 선행지수 순환변동치",
    t10y1y: "미국채 10년/1년 금리차",
    us_credit_spread: "미국 회사채 3년/국채 3년 금리차",
  };
  const prices = macroSeries.map((series, index) => ({
    ...trace(series, [100 + index, 101 + index]),
    name: series,
    x: ["2026-08-27", "2026-08-28"],
    text: [String(index + 1), String(index + 2)],
    line: { color: "#2dd4bf" },
  }));
  const grouped = renderer.buildGroupedHoverTraces({
    enabled: true,
    traces: prices,
    seriesOrder: macroSeries,
    labelName: (series) => series,
    hoverLabelName: (series) => detailedNames[series],
    stackedPriceSeries: macroSeries,
    revision: "macro-hover-label",
  });

  assert.deepEqual(grouped.map((item) => item.meta.hoverGroupTicker), macroSeries);
  grouped.forEach((item, index) => {
    assert.ok(item.text[0].includes(`${detailedNames[macroSeries[index]]}</b><br>가격`));
    assert.doesNotMatch(item.text[0], /<\/b> · 가격/);
  });
});

test("grouped hover follows its supplied activation order without changing price traces", () => {
  const first = { ...trace("FIRST", [100]), x: ["2026-08-28"], text: ["100"] };
  const second = { ...trace("SECOND", [200]), x: ["2026-08-28"], text: ["200"] };
  const grouped = renderer.buildGroupedHoverTraces({
    enabled: true,
    traces: [first, second],
    seriesOrder: ["SECOND", "FIRST"],
  });

  assert.deepEqual(grouped.map((item) => item.meta.hoverGroupTicker), ["SECOND", "FIRST"]);
  assert.deepEqual([first.meta.seriesKey, second.meta.seriesKey], ["FIRST", "SECOND"]);
});

test("main chart composition reuses prepared future overlays during viewport frames", async () => {
  const model = {
    rows: [{ date: "2026-08-24", TEST: 100 }],
    selected: ["TEST"],
    seriesModels: [{
      series: "TEST",
      xValues: ["2026-08-24"],
      values: [100],
      baseValues: [100],
      rawTexts: ["100"],
      baseLineWidth: 1,
    }],
  };
  const eps = { meta: { overlayKind: "eps", seriesKey: "eps:TEST" } };
  const ai = { meta: { overlayKind: "ai-scenario", seriesKey: "TEST" } };
  let rebuiltEps = 0;
  let rebuiltAi = 0;
  const result = await renderer.buildMainChartComposition({
    model,
    hiddenSeries: new Set(),
    prebuiltEpsTraceModel: { traces: [eps], baseValuesBySeries: { "eps:TEST": [120] } },
    prebuiltAiForecastTraces: [ai],
    buildEpsTraceModel: () => { rebuiltEps += 1; return { traces: [] }; },
    buildAiForecastTraces: () => { rebuiltAi += 1; return []; },
  });

  assert.equal(rebuiltEps, 0);
  assert.equal(rebuiltAi, 0);
  assert.equal(result.epsTraces[0], eps);
  assert.equal(result.aiForecastTraces[0], ai);
  assert.deepEqual(result.baseValuesBySeries["eps:TEST"], [120]);
});

test("main chart composition reuses prepared event traces during viewport frames", async () => {
  const event = { meta: { overlayKind: "timing-buy", isMarketTimingBuyTrace: true } };
  let rebuiltEvents = 0;
  const result = await renderer.buildMainChartComposition({
    model: {
      rows: [{ date: "2026-08-24", TEST: 100 }],
      selected: ["TEST"],
      seriesModels: [{
        series: "TEST",
        xValues: ["2026-08-24"],
        values: [100],
        baseValues: [100],
        rawTexts: ["100"],
        baseLineWidth: 1,
      }],
    },
    hiddenSeries: new Set(),
    labelName: (value) => value,
    seriesColor: () => "#ffffff",
    prebuiltEventTraces: [event],
    buildEventArguments: () => { rebuiltEvents += 1; return {}; },
    buildEventTraces: () => { rebuiltEvents += 1; return []; },
  });

  assert.equal(rebuiltEvents, 0);
  assert.equal(result.traces.at(-1), event);
});

test("price-first composition reuses passive overlays without running their builders", async () => {
  const calls = [];
  const eps = { meta: { overlayKind: "eps", seriesKey: "eps:TEST" } };
  const ai = { meta: { overlayKind: "ai-scenario", seriesKey: "TEST" } };
  const event = { meta: { overlayKind: "timing-buy", isMarketTimingBuyTrace: true } };
  const grouped = { meta: { overlayKind: "grouped-hover", hoverGroupTicker: "TEST" } };
  const result = await renderer.buildMainChartComposition({
    model: {
      rows: [{ date: "2026-08-24", TEST: 100 }],
      selected: ["TEST"],
      seriesModels: [{
        series: "TEST",
        xValues: ["2026-08-24"],
        values: [100],
        baseValues: [100],
        rawTexts: ["100"],
        baseLineWidth: 1,
      }],
    },
    deferOverlays: true,
    prebuiltEpsTraceModel: { traces: [eps], baseValuesBySeries: { "eps:TEST": [100] } },
    prebuiltAiForecastTraces: [ai],
    prebuiltEventTraces: [event],
    prebuiltGroupedHoverTraces: [grouped],
    buildEpsTraceModel: () => { calls.push("eps"); return { traces: [] }; },
    buildAiForecastTraces: () => { calls.push("ai"); return []; },
    prepareEventModels: () => { calls.push("events"); },
    buildEventTraces: () => { calls.push("event-traces"); return []; },
  });

  assert.deepEqual(calls, []);
  assert.equal(result.deferredOverlays, true);
  assert.deepEqual(result.traces.slice(0, 5), [grouped, result.traces[1], eps, ai, event]);
  assert.equal(result.traces[1].meta.overlayKind, "price");
});

test("joins valid trading points across internal calendar gaps", () => {
  const points = renderer.finiteTracePoints(
    ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"],
    [null, 100, null, 103, null],
    ["", "100", "", "103", ""],
    [null, 100, null, 103, null],
  );

  assert.deepEqual(points, {
    x: ["2026-01-02", "2026-01-06"],
    y: [100, 103],
    text: ["100", "103"],
    base: [100, 103],
  });
});

test("groups price, EPS, disclosures, and signals by series in one hover entry", () => {
  const rfhicPrice = {
    ...trace("218410.KQ", [100, 110]),
    x: ["2024-03-29", "2024-04-01"],
    text: ["32,000", "33,000"],
    line: { color: "#b6df00" },
    hovertemplate: "%{text}<extra>RFHIC</extra>",
  };
  const hynixPrice = {
    ...trace("000660.KS", [90, 95]),
    x: ["2024-03-29", "2024-04-01"],
    text: ["180,000", "182,000"],
    line: { color: "#14b8a6" },
    hovertemplate: "%{text}<extra>SK하이닉스</extra>",
  };
  const eps = {
    type: "scatter",
    mode: "lines",
    x: ["2024-03-31"],
    y: [160],
    text: ["2024년 1분기 EPS 850"],
    hovertemplate: "%{text}<extra>RFHIC EPS</extra>",
    meta: { isEpsTrace: true, seriesKey: "eps:218410.KQ" },
  };
  const timing = {
    type: "scatter",
    mode: "markers",
    x: ["2024-03-29", "2024-03-29"],
    y: [165, 88],
    customdata: [["RFHIC", "과매도·반전"], ["SK하이닉스", "추세 눌림"]],
    hovertemplate: "<b>%{customdata[0]} 매수 신호</b><br>근거 · %{customdata[1]}<extra></extra>",
    meta: {
      isMarketTimingBuyTrace: true,
      pointTickers: ["218410.KQ", "000660.KS"],
    },
  };
  const disclosure = {
    type: "scatter",
    mode: "text",
    x: ["2024-03-29"],
    y: [170],
    hovertemplate: ["<b>공시</b><br>분기보고서<extra></extra>"],
    meta: { isDisclosureTrace: true, pointTickers: ["218410.KQ"] },
  };
  const traces = [rfhicPrice, hynixPrice, eps, timing, disclosure];
  const grouped = renderer.buildGroupedHoverTraces({
    enabled: true,
    traces,
    seriesOrder: ["218410.KQ", "000660.KS"],
    labelName: (series) => series === "218410.KQ" ? "RFHIC" : "SK하이닉스",
  });
  const cacheBeforeReuse = renderer.groupedHoverCacheStats();
  const reusedGrouped = renderer.buildGroupedHoverTraces({
    enabled: true,
    traces,
    seriesOrder: ["218410.KQ", "000660.KS"],
    labelName: (series) => series === "218410.KQ" ? "RFHIC" : "SK하이닉스",
  });
  const cacheAfterReuse = renderer.groupedHoverCacheStats();

  assert.deepEqual(grouped.map((item) => item.meta.hoverGroupTicker), ["218410.KQ", "000660.KS"]);
  assert.equal(cacheAfterReuse.hits, cacheBeforeReuse.hits + 1);
  assert.notEqual(reusedGrouped[0], grouped[0]);
  assert.equal(reusedGrouped[0].text, grouped[0].text);
  assert.equal(grouped.every((item) => item.type === "scattergl"), true);
  const epsHoverIndex = grouped[0].x.indexOf("2024-03-31");
  assert.ok(epsHoverIndex >= 0);
  assert.match(grouped[0].text[0], /RFHIC<\/b> · 가격 32,000/);
  assert.match(grouped[0].text[epsHoverIndex], /RFHIC<\/b> · 가격 32,000/);
  assert.match(grouped[0].text[epsHoverIndex], /EPS · 1분기 850/);
  assert.doesNotMatch(grouped[0].text[epsHoverIndex], /2024\.3\.31/);
  assert.equal(
    grouped[0].hovertemplate,
    "%{text}<extra></extra>",
  );
  assert.equal(grouped[1].hovertemplate, grouped[0].hovertemplate);
  assert.equal(
    grouped[0].meta.pointHoverTemplate,
    "%{x|%Y.%-m.%-d}<br>%{customdata}<extra></extra>",
  );
  assert.equal(renderer.buildLayout().xaxis.hoverformat, "%Y.%-m.%-d");
  assert.match(grouped[0].text[0], /<br>공시/);
  assert.match(grouped[0].text[0], /<br>매수 신호/);
  assert.match(
    grouped[0].text[epsHoverIndex],
    /<br>EPS/,
  );
  assert.doesNotMatch(grouped[0].text[epsHoverIndex], /<b>EPS<\/b>/);
  assert.equal(grouped[0].customdata[epsHoverIndex], grouped[0].text[epsHoverIndex]);
  assert.doesNotMatch(grouped[0].customdata[epsHoverIndex], /&nbsp;/);
  assert.deepEqual(grouped[0].marker.size, [1, 36, 1]);
  assert.equal(grouped[0].marker.opacity, 0);
  assert.equal(grouped[0].marker.line.width, 0);
  assert.deepEqual(grouped[0].y, [100, 160, 110]);
  assert.match(grouped[0].text[0], /────────────/);
  assert.doesNotMatch(grouped[0].text[0], /RFHIC EPS|RFHIC 매수/);
  assert.match(grouped[1].text[0], /SK하이닉스<\/b> · 가격 180,000/);
  assert.doesNotMatch(grouped[1].text[0], /────────────/);
  assert.equal(traces.every((item) => item.hoverinfo === "skip"), true);
});

test("keeps long Korean stock trading suspensions flat until trading resumes", () => {
  const result = renderer.buildLineTraces({
    seriesModels: [{
      series: "207940.KS",
      xValues: [
        "2018-11-14",
        "2018-11-15",
        "2018-11-30",
        "2018-12-10",
        "2018-12-11",
      ],
      values: [100, null, null, null, 118],
      rawTexts: ["100", "", "", "", "118"],
      baseValues: [100, null, null, null, 118],
      baseLineWidth: 2,
    }],
    hiddenSeries: new Set(),
    labelName: () => "삼성바이오로직스",
    seriesColor: () => "#36d399",
  });

  assert.deepEqual(result.traces[0].x, [
    "2018-11-14",
    "2018-11-15",
    "2018-11-30",
    "2018-12-10",
    "2018-12-11",
  ]);
  assert.deepEqual(result.traces[0].y, [100, 100, 100, 100, 118]);
  assert.equal(result.traces[0].text[2], "거래 없음");
  assert.equal(result.traces[0].meta.longGapFillPointCount, 3);
});

test("renders the latest activated price series last and fully opaque", () => {
  const seriesModels = ["A", "B"].map((series, index) => ({
    series,
    xValues: ["2026-01-01", "2026-01-02"],
    values: [100, 101 + index],
    rawTexts: ["100", String(101 + index)],
    baseValues: [100, 101 + index],
    baseLineWidth: 1,
  }));
  const result = renderer.buildLineTraces({
    seriesModels,
    seriesOrder: ["B", "A"],
    hiddenSeries: new Set(),
  });
  assert.deepEqual(result.traces.map((trace) => trace.meta.seriesKey), ["B", "A"]);
  assert.deepEqual(result.traces.map((trace) => trace.opacity), [1, 1]);
});

test("does not flatten short stock holidays or non-stock series", () => {
  const shortGap = renderer.carryLongNonTradingGaps(
    ["2026-09-30", "2026-10-01", "2026-10-06"],
    [100, null, 105],
  );
  assert.deepEqual(shortGap.y, [100, null, 105]);

  const indexResult = renderer.buildLineTraces({
    seriesModels: [{
      series: "^KS11",
      xValues: ["2018-11-14", "2018-11-30", "2018-12-11"],
      values: [100, null, 118],
      rawTexts: ["100", "", "118"],
      baseValues: [100, null, 118],
      baseLineWidth: 2,
    }],
    hiddenSeries: new Set(),
  });
  assert.deepEqual(indexResult.traces[0].y, [100, 118]);
  assert.equal(indexResult.traces[0].meta.longGapFillPointCount, 0);
});

test("keeps a short stock-only halt flat when the benchmark traded three times", () => {
  const dates = [
    "2018-04-27",
    "2018-04-30",
    "2018-05-02",
    "2018-05-03",
    "2018-05-04",
  ];
  const result = renderer.buildLineTraces({
    seriesModels: [
      {
        series: "^KS11",
        xValues: dates,
        values: [100, 101, 100, 102, 103],
        rawTexts: ["100", "101", "100", "102", "103"],
        baseValues: [100, 101, 100, 102, 103],
        baseLineWidth: 3,
      },
      {
        series: "005930.KS",
        xValues: dates,
        values: [100, null, null, null, 98],
        rawTexts: ["100", "", "", "", "98"],
        baseValues: [100, null, null, null, 98],
        baseLineWidth: 2,
      },
    ],
    hiddenSeries: new Set(),
  });

  const stockTrace = result.traces.find((item) => item.meta.seriesKey === "005930.KS");
  assert.deepEqual(stockTrace.y, [100, 100, 100, 100, 98]);
  assert.equal(stockTrace.meta.longGapFillPointCount, 3);
});

test("anchors drag handles to endpoints inside the visible date range", () => {
  const endpoints = renderer.visibleEndpointValues({
    x: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"],
    y: [80, 100, 120, 500],
  }, [90, 110, 130, 900], ["2026-01-02", "2026-01-03"]);

  assert.deepEqual(endpoints, { first: 110, last: 130 });
});

test("creates scale handles only for real series traces", () => {
  const values = { "005930.KS": [100, 101], "eps:005930.KS": [100, 112] };
  assert.equal(renderer.isSeriesHandleTrace(trace("005930.KS"), values), true);
  assert.equal(renderer.isSeriesHandleTrace({
    ...trace("eps:005930.KS"),
    meta: { seriesKey: "eps:005930.KS", isEpsTrace: true },
  }, values), true);
  assert.equal(renderer.isSeriesHandleTrace({
    ...trace("005930.KS"),
    meta: { seriesKey: "005930.KS", isAiForecastTrace: true },
  }, values), false);
  assert.equal(renderer.isSeriesHandleTrace({
    ...trace("005930.KS"),
    meta: { seriesKey: "005930.KS", isAiForecastBand: true },
  }, values), false);
  assert.equal(renderer.isSeriesHandleTrace({
    ...trace("005930.KS"),
    meta: { seriesKey: "005930.KS", isAiForecastScenarioTrace: true },
  }, values), false);
  assert.equal(renderer.isSeriesHandleTrace({
    ...trace("005930.KS"),
    meta: { seriesKey: "005930.KS", isAiReportMarkerTrace: true },
  }, values), false);
  assert.equal(renderer.isSeriesHandleTrace({
    ...trace("005930.KS"),
    meta: { seriesKey: "005930.KS", isGroupedHoverTrace: true },
  }, values), false);
  assert.deepEqual(renderer.adjustableSeriesKeys([
    trace("005930.KS"),
    { ...trace("eps:005930.KS"), meta: { seriesKey: "eps:005930.KS", isEpsTrace: true } },
    { ...trace("005930.KS"), meta: { seriesKey: "005930.KS", isAiForecastTrace: true } },
  ], values), ["005930.KS", "eps:005930.KS", ""]);
});

test("builds sampled line traces without reconnecting missing source values", () => {
  const result = renderer.buildLineTraces({
    seriesModels: [{
      series: "^KS11",
      xValues: ["2026-01-01", "2026-01-02", "2026-01-03"],
      values: [100, null, 103],
      rawTexts: ["100", "", "103"],
      baseValues: [100, null, 103],
      baseLineWidth: 2,
    }],
    displayIndexes: [0, 1, 2],
    displayPointCount: 3,
    hiddenSeries: new Set(),
    labelName: () => "코스피",
    seriesColor: () => "#4ade80",
  });

  assert.deepEqual(result.traces[0].x, ["2026-01-01", "2026-01-03"]);
  assert.deepEqual(result.traces[0].y, [100, 103]);
  assert.equal(result.traces[0].meta.displayPointCount, 3);
  assert.equal(result.traces[0].meta.fullDataStartMs, Date.parse("2026-01-01"));
  assert.equal(result.traces[0].meta.fullDataEndMs, Date.parse("2026-01-03"));
  assert.deepEqual(result.baseValuesBySeries["^KS11"], [100, 103]);
});

test("renders a newly listed one-point stock as a circle and labels its first trading day", () => {
  const result = renderer.buildLineTraces({
    seriesModels: [{
      series: "279570.KS",
      xValues: ["2026-08-30"],
      values: [15000],
      rawTexts: ["15,000"],
      baseValues: [15000],
      baseLineWidth: 1,
    }],
    hiddenSeries: new Set(),
    hoverShowPopup: true,
    labelName: () => "신규상장종목",
    seriesColor: () => "#4ade80",
  });
  const trace = result.traces[0];

  assert.equal(trace.mode, "markers");
  assert.equal(trace.marker.symbol, "circle");
  assert.equal(trace.meta.listingDate, "2026-08-30");
  assert.match(trace.text[0], /<br>상장일/);

  const grouped = renderer.buildGroupedHoverTraces({
    enabled: true,
    traces: result.traces,
    seriesOrder: ["279570.KS"],
    labelName: () => "신규상장종목",
  });
  assert.match(grouped[0].text[0], /가격 15,000/);
  assert.match(grouped[0].text[0], /<br>상장일/);
});

test("labels only the actual stock history start, not the first point of a viewport slice", () => {
  const seriesModels = [{
    series: "005930.KS",
    xValues: ["1975-06-11", "2025-08-29", "2026-08-30"],
    values: [100, 70000, 75000],
    rawTexts: ["100", "70,000", "75,000"],
    baseValues: [100, 70000, 75000],
    baseLineWidth: 1,
  }];
  const result = renderer.buildLineTraces({
    seriesModels,
    displayIndexes: [1, 2],
    hiddenSeries: new Set(),
    hoverShowPopup: true,
    labelName: () => "삼성전자",
  });
  assert.equal(result.traces[0].meta.listingDate, "1975-06-11");

  const grouped = renderer.buildGroupedHoverTraces({
    enabled: true,
    traces: result.traces,
    seriesOrder: ["005930.KS"],
    labelName: () => "삼성전자",
  });
  assert.doesNotMatch(grouped[0].text.join("\n"), /상장일/);
});

test("reuses prepared line data until a transformed value array changes", () => {
  const model = {
    series: "005930.KS",
    xValues: ["2026-01-01", "2026-01-02"],
    values: [100, 102],
    rawTexts: ["100", "102"],
    baseValues: [100, 102],
    baseLineWidth: 1,
  };
  const seriesModels = [model];
  const first = renderer.buildLineTraces({ seriesModels, hiddenSeries: new Set() });
  const second = renderer.buildLineTraces({ seriesModels, hiddenSeries: new Set(["005930.KS"]) });

  assert.equal(second.traces[0].y, first.traces[0].y);
  assert.equal(second.traces[0].visible, "legendonly");

  model.values = [100, 110];
  const transformed = renderer.buildLineTraces({ seriesModels, hiddenSeries: new Set() });
  assert.notEqual(transformed.traces[0].y, first.traces[0].y);
  assert.deepEqual(transformed.traces[0].y, [100, 110]);
});

test("reuses normalized line data across recent viewport slices", () => {
  const model = {
    series: "^KS11",
    xValues: ["2026-01-01", "2026-01-02", "2026-01-03"],
    values: [100, 102, 104],
    rawTexts: ["100", "102", "104"],
    baseValues: [100, 102, 104],
    baseLineWidth: 1,
  };
  const seriesModels = [model];
  const before = renderer.lineDataCacheStats();
  const first = renderer.buildLineTraces({
    seriesModels,
    displayIndexes: [0, 1],
    renderRevision: "model-a|window:left",
  });
  const repeated = renderer.buildLineTraces({
    seriesModels,
    displayIndexes: [0, 1],
    renderRevision: "model-a|window:left",
  });
  const shifted = renderer.buildLineTraces({
    seriesModels,
    displayIndexes: [1, 2],
    renderRevision: "model-a|window:right",
  });
  const after = renderer.lineDataCacheStats();

  assert.equal(repeated.traces[0].y, first.traces[0].y);
  assert.deepEqual(shifted.traces[0].y, [102, 104]);
  assert.equal(after.normalizedMisses, before.normalizedMisses + 1);
  assert.equal(after.normalizedHits, before.normalizedHits + 2);
  assert.equal(after.viewportMisses, before.viewportMisses + 2);
  assert.equal(after.viewportHits, before.viewportHits + 1);
});

test("reuses every prepared line while panning multi-series viewports", () => {
  const dates = Array.from({ length: 240 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, index + 1));
    return date.toISOString().slice(0, 10);
  });

  for (const seriesCount of [1, 5, 10]) {
    const seriesModels = Array.from({ length: seriesCount }, (_, seriesIndex) => {
      const values = dates.map((_, pointIndex) => 100 + seriesIndex + pointIndex);
      return {
        series: `${String(seriesIndex + 1).padStart(6, "0")}.KS`,
        xValues: dates,
        values,
        rawTexts: values.map(String),
        baseValues: values,
        baseLineWidth: 1,
      };
    });
    const leftIndexes = Array.from({ length: 120 }, (_, index) => index);
    const rightIndexes = Array.from({ length: 120 }, (_, index) => index + 120);
    const before = renderer.lineDataCacheStats();
    const first = renderer.buildLineTraces({
      seriesModels,
      displayIndexes: leftIndexes,
      renderRevision: `${seriesCount}|left`,
    });
    const repeated = renderer.buildLineTraces({
      seriesModels,
      displayIndexes: leftIndexes,
      renderRevision: `${seriesCount}|left`,
    });
    const shifted = renderer.buildLineTraces({
      seriesModels,
      displayIndexes: rightIndexes,
      renderRevision: `${seriesCount}|right`,
    });
    const after = renderer.lineDataCacheStats();

    assert.equal(first.traces.length, seriesCount);
    assert.equal(shifted.traces.length, seriesCount);
    first.traces.forEach((trace, index) => {
      assert.equal(repeated.traces[index].x, trace.x);
      assert.equal(repeated.traces[index].y, trace.y);
      assert.deepEqual(shifted.traces[index].y, seriesModels[index].values.slice(120));
    });
    assert.equal(after.normalizedMisses, before.normalizedMisses + 1);
    assert.equal(after.normalizedHits, before.normalizedHits + 2);
    assert.equal(after.viewportMisses, before.viewportMisses + 2);
    assert.equal(after.viewportHits, before.viewportHits + 1);
  }
});

test("invalidates normalized line data when a source array changes", () => {
  const model = {
    series: "^KS11",
    xValues: ["2026-01-01", "2026-01-02"],
    values: [100, 102],
    rawTexts: ["100", "102"],
    baseValues: [100, 102],
    baseLineWidth: 1,
  };
  const seriesModels = [model];
  const first = renderer.buildLineTraces({
    seriesModels,
    renderRevision: "same-revision",
  });

  model.xValues = ["2026-01-03", "2026-01-04"];
  const updated = renderer.buildLineTraces({
    seriesModels,
    renderRevision: "same-revision",
  });

  assert.notEqual(updated.traces[0].x, first.traces[0].x);
  assert.deepEqual(updated.traces[0].x, ["2026-01-03", "2026-01-04"]);
});

test("centralizes chart date bounds and long-range ticks", () => {
  assert.deepEqual(renderer.dateBounds([
    [{ date: "2001-01-02" }, { date: "2001-01-03" }],
    [{ date: "1998-05-01" }, { date: "2026-08-10" }],
  ], "2026-08-11"), {
    minDate: "1998-05-01",
    maxDate: "2026-08-10",
  });
  const ticks = renderer.buildLongRangeTicks({
    start: "1998-05-01",
    end: "2026-08-10",
  });
  assert.equal(ticks.tickmode, "array");
  assert.ok(ticks.ticktext.includes("2000"));
  assert.ok(ticks.ticktext.includes("2025"));
});


test("combines compatible trace and viewport updates into one Plotly call", async () => {
  const element = {
    data: [trace("^KS11", [0, 0])],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const result = await renderer.render({
    update: async (...args) => calls.push(["update", ...args]),
    react: async (...args) => calls.push(["react", ...args]),
  }, element, [trace("^KS11")], {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 3] },
  }, {});

  assert.deepEqual(result, { mode: "partial", attemptedPartial: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "update");
  assert.deepEqual(calls[0][4], [0]);
  assert.deepEqual(calls[0][2].name, [""]);
  assert.deepEqual(calls[0][2].line, [null]);
  assert.equal(calls[0][3]["xaxis.tickmode"], "auto");
  assert.equal(calls[0][3]["xaxis.tickvals"], null);
});

test("updates only changed traces after render state has been remembered", async () => {
  const first = trace("^KS11", [1, 2]);
  const second = trace("005930.KS", [3, 4]);
  const element = {
    data: [first, second],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const plotly = {
    update: async (...args) => calls.push(args),
    react: async () => { throw new Error("unexpected full render"); },
  };
  const layout = {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 5] },
  };

  await renderer.render(plotly, element, [first, second], layout, {});
  await renderer.render(plotly, element, [first, { ...second, y: [3, 5] }], layout, {});

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][3], [1]);
  assert.deepEqual(calls[1][1].y, [[3, 5]]);
  assert.deepEqual(calls[1][2], {});
});

test("uses a layout-only Plotly update when trace data is unchanged", async () => {
  const series = trace("^KS11", [1, 2]);
  const element = {
    data: [series],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const plotly = {
    update: async () => {},
    relayout: async (...args) => calls.push(args),
    react: async () => { throw new Error("unexpected full render"); },
  };
  const layout = {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 3] },
  };

  await renderer.render(plotly, element, [series], layout, {});
  const result = await renderer.render(plotly, element, [series], {
    ...layout,
    xaxis: { range: ["2026-01-02", "2026-01-03"] },
  }, {});

  assert.equal(result.updateScope, "layout");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1]["xaxis.range"], ["2026-01-02", "2026-01-03"]);
});

test("skips an identical render after the first successful Plotly update", async () => {
  const element = {
    data: [trace("^KS11", [0, 0])],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const plotly = {
    update: async (...args) => calls.push(["update", ...args]),
    react: async (...args) => calls.push(["react", ...args]),
  };
  const traces = [trace("^KS11")];
  const layout = {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 3] },
  };

  assert.equal((await renderer.render(plotly, element, traces, layout, {})).mode, "partial");
  assert.deepEqual(await renderer.render(plotly, element, traces, layout, {}), {
    mode: "skipped",
    attemptedPartial: false,
    updateScope: "unchanged",
  });
  assert.deepEqual(calls.map((call) => call[0]), ["update"]);

  const changed = [{ ...traces[0], y: [1, 3] }];
  assert.equal((await renderer.render(plotly, element, changed, layout, {})).mode, "partial");
  assert.deepEqual(calls.map((call) => call[0]), ["update", "update"]);
});

test("uses an explicit line render revision instead of walking large line arrays", () => {
  const result = renderer.buildLineTraces({
    seriesModels: [{
      series: "^KS11",
      xValues: ["2026-01-01", "2026-01-02"],
      values: [100, 101],
      rawTexts: ["100", "101"],
      baseValues: [100, 101],
      baseLineWidth: 2,
    }],
    renderRevision: "model-42",
    hiddenSeries: new Set(),
  });
  assert.match(result.traces[0].meta.renderFingerprint, /^model-42\|\^KS11\|/);
  const first = renderer.renderFingerprint(result.traces, { xaxis: {}, yaxis: {} }, {});
  result.traces[0].y[0] = 999;
  assert.equal(renderer.renderFingerprint(result.traces, { xaxis: {}, yaxis: {} }, {}), first);
  result.traces[0].meta.renderFingerprint = "model-43|^KS11";
  assert.notEqual(renderer.renderFingerprint(result.traces, { xaxis: {}, yaxis: {} }, {}), first);
});

test("invalidates a remembered render fingerprint after a direct live restyle", async () => {
  const element = { _fullLayout: { xaxis: {}, yaxis: {} }, data: [] };
  const traces = [{
    x: ["2026-01-01"],
    y: [100],
    type: "scatter",
    mode: "lines",
    meta: { overlayKind: "price", seriesKey: "^KS11", renderFingerprint: "model-a" },
  }];
  const layout = { xaxis: { range: ["2026-01-01", "2026-01-02"] }, yaxis: {} };
  const plotly = {
    react: async (target, nextTraces) => { target.data = nextTraces; },
    update: async () => {},
  };

  assert.equal((await renderer.render(plotly, element, traces, layout, {})).mode, "full");
  assert.equal((await renderer.render(plotly, element, traces, layout, {})).mode, "skipped");
  assert.equal(renderer.invalidateRenderFingerprint(element), true);
  assert.notEqual((await renderer.render(plotly, element, traces, layout, {})).mode, "skipped");
});


test("carries explicit long-range date ticks through a partial update", () => {
  const payload = renderer.relayoutPayload({
    hovermode: false,
    xaxis: {
      range: ["1996-12-11", "2026-08-06"],
      tickmode: "array",
      tickvals: ["1996-12-11", "2000-01-01"],
      ticktext: ["1996", "2000"],
    },
    yaxis: {},
  });

  assert.equal(payload["xaxis.tickmode"], "array");
  assert.deepEqual(payload["xaxis.tickvals"], ["1996-12-11", "2000-01-01"]);
  assert.deepEqual(payload["xaxis.ticktext"], ["1996", "2000"]);
});

test("normalizes and maps vertical, horizontal, and cross chart line modes", () => {
  assert.equal(renderer.normalizeCursorLineMode("invalid"), "vertical");
  assert.equal(renderer.buildCursorHoverMode(false, "vertical"), false);
  assert.equal(renderer.buildCursorHoverMode(true, "vertical"), "x unified");
  assert.equal(renderer.buildCursorHoverMode(true, "horizontal"), "x unified");
  assert.equal(renderer.buildCursorHoverMode(true, "cross"), "x unified");
  assert.equal(renderer.buildCursorLineAxisLayout("vertical", "x").showspikes, false);
  assert.equal(renderer.buildCursorLineAxisLayout("vertical", "y").showspikes, false);
  assert.equal(renderer.buildCursorLineAxisLayout("horizontal", "x").showspikes, false);
  assert.equal(renderer.buildCursorLineAxisLayout("horizontal", "y").showspikes, false);
  assert.equal(renderer.buildCursorLineAxisLayout("cross", "x").showspikes, false);
  assert.equal(renderer.buildCursorLineAxisLayout("cross", "y").showspikes, false);
});

test("carries chart line mode through a partial layout update", () => {
  const layout = renderer.buildLayout({
    cursorLineMode: "horizontal",
    xRange: ["2026-01-01", "2026-01-02"],
    yRange: [0, 3],
  });
  const payload = renderer.relayoutPayload(layout);

  assert.equal(payload["xaxis.showspikes"], false);
  assert.equal(payload["yaxis.showspikes"], false);
  assert.equal(payload["xaxis.spikecolor"], "rgba(0,0,0,0)");
  assert.equal(payload["yaxis.spikecolor"], "rgba(0,0,0,0)");
});

test("falls back to a full render when the trace structure changes", async () => {
  const element = {
    data: [trace("^KS11")],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const result = await renderer.render({
    update: async (...args) => calls.push(["update", ...args]),
    react: async (...args) => calls.push(["react", ...args]),
  }, element, [trace("^KQ11")], {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: {},
  }, { responsive: true });

  assert.deepEqual(result, { mode: "full", attemptedPartial: false });
  assert.deepEqual(calls.map((call) => call[0]), ["react"]);
});


test("adds optional traces without rebuilding the full chart", async () => {
  const element = {
    data: [trace("^KS11")],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const timing = {
    ...trace("timing"),
    mode: "markers",
    meta: { isMarketTimingBuyTrace: true },
  };
  const calls = [];
  const plotly = {
    addTraces: async (target, nextTrace, index) => {
      calls.push(["addTraces", index]);
      target.data.splice(index, 0, nextTrace);
    },
    deleteTraces: async () => { throw new Error("unexpected delete"); },
    update: async (...args) => calls.push(["update", ...args]),
    react: async (...args) => calls.push(["react", ...args]),
  };

  const result = await renderer.render(plotly, element, [trace("^KS11"), timing], {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 3] },
  }, {});

  assert.deepEqual(result, { mode: "structural", attemptedPartial: true });
  assert.deepEqual(calls.map((call) => call[0]), ["addTraces", "update"]);
  assert.equal(renderer.traceIdentity(element.data[1]), "market-timing-buy");
});


test("removes optional traces without rebuilding the full chart", async () => {
  const timing = {
    ...trace("timing"),
    mode: "markers",
    meta: { isMarketTimingSellTrace: true },
  };
  const element = {
    data: [trace("^KS11"), timing],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const plotly = {
    addTraces: async () => { throw new Error("unexpected add"); },
    deleteTraces: async (target, indexes) => {
      calls.push(["deleteTraces", indexes]);
      indexes.forEach((index) => target.data.splice(index, 1));
    },
    update: async (...args) => calls.push(["update", ...args]),
    react: async (...args) => calls.push(["react", ...args]),
  };

  const result = await renderer.render(plotly, element, [trace("^KS11")], {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 3] },
  }, {});

  assert.deepEqual(result, { mode: "structural", attemptedPartial: true });
  assert.deepEqual(calls.map((call) => call[0]), ["deleteTraces", "update"]);
  assert.equal(element.data.length, 1);
});

test("replaces one same-count series without rebuilding unchanged traces", async () => {
  const element = {
    data: [trace("^KS11"), trace("005930.KS")],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const next = [trace("^KS11"), trace("000660.KS")];
  const calls = [];
  const plotly = {
    deleteTraces: async (target, indexes) => {
      calls.push(["deleteTraces", indexes]);
      indexes.forEach((index) => target.data.splice(index, 1));
    },
    addTraces: async (target, nextTrace, index) => {
      calls.push(["addTraces", index]);
      target.data.splice(index, 0, nextTrace);
    },
    update: async () => calls.push(["update"]),
    react: async () => calls.push(["react"]),
  };

  const result = await renderer.render(plotly, element, next, {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 3] },
  }, {});

  assert.deepEqual(result, { mode: "structural", attemptedPartial: true });
  assert.deepEqual(calls.map((call) => call[0]), ["deleteTraces", "addTraces", "update"]);
  assert.deepEqual(element.data.map(renderer.traceIdentity), ["series:^KS11", "series:000660.KS"]);
});

test("updates event markers and their grouped hover summaries for marker-only invalidations", async () => {
  const groupedHover = {
    type: "scattergl",
    mode: "markers",
    x: ["2026-01-01", "2026-01-02"],
    y: [1, 2],
    text: ["old", "old"],
    meta: { isGroupedHoverTrace: true, hoverGroupTicker: "005930.KS" },
  };
  const nextGroupedHover = { ...groupedHover, text: ["new disclosure", "new insider"] };
  const disclosure = {
    ...trace("disclosure", [2, 2]),
    mode: "markers",
    meta: { isDisclosureTrace: true },
  };
  const nextDisclosure = { ...disclosure, y: [3, 3] };
  const element = {
    data: [groupedHover, trace("^KS11"), trace("005930.KS"), disclosure],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const result = await renderer.render({
    update: async (...args) => calls.push(args),
    react: async () => { throw new Error("unexpected full render"); },
  }, element, [nextGroupedHover, trace("^KS11"), trace("005930.KS"), nextDisclosure], {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 4] },
  }, {}, { invalidation: { updateClasses: ["markers"] } });

  assert.deepEqual(result, {
    mode: "partial",
    attemptedPartial: true,
    updateScope: "markers",
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][3], [0, 3]);
  assert.deepEqual(calls[0][1].text, [["new disclosure", "new insider"], null]);
  assert.deepEqual(calls[0][1].y, [[1, 2], [3, 3]]);
});

test("recognizes marker-only invalidations through one shared policy", () => {
  assert.equal(renderer.isMarkerOnlyInvalidation({ updateClasses: ["markers", "markers"] }), true);
  assert.equal(renderer.isMarkerOnlyInvalidation({ updateClasses: ["markers", "viewport"] }), false);
  assert.equal(renderer.isMarkerOnlyInvalidation({ updateClasses: [] }), false);
});


test("falls back to a full render after a compatible partial update fails", async () => {
  const element = {
    data: [trace("^KS11", [0, 0])],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const result = await renderer.render({
    update: async () => {
      calls.push("update");
      throw new Error("partial update failed");
    },
    react: async () => calls.push("react"),
  }, element, [trace("^KS11")], {
    hovermode: false,
    xaxis: { range: ["2026-01-01", "2026-01-02"] },
    yaxis: { range: [0, 3] },
  }, {});

  assert.deepEqual(result, { mode: "full", attemptedPartial: true, fallbacks: ["partial"] });
  assert.deepEqual(calls, ["update", "react"]);
});


test("keeps AI interval bands distinct and updates their fill styling", () => {
  const lower = {
    ...trace("005930.KS"),
    meta: { seriesKey: "005930.KS", isAiForecastBand: true, aiTraceRole: "lower" },
    fill: "none",
  };
  const upper = {
    ...trace("005930.KS"),
    meta: { seriesKey: "005930.KS", isAiForecastBand: true, aiTraceRole: "upper" },
    fill: "tonexty",
    fillcolor: "rgba(190, 190, 190, 0.10)",
  };

  assert.notEqual(renderer.traceIdentity(lower), renderer.traceIdentity(upper));
  const payload = renderer.restylePayload([lower, upper]);
  assert.deepEqual(payload.fill, ["none", "tonexty"]);
  assert.deepEqual(payload.fillcolor, [null, "rgba(190, 190, 190, 0.10)"]);
});

test("keeps market timing buy markers distinct from recession warnings", () => {
  assert.equal(renderer.traceIdentity({ meta: { isCrisisSignalTrace: true } }), "crisis-signal");
  assert.equal(renderer.traceIdentity({ meta: { isMarketTimingBuyTrace: true } }), "market-timing-buy");
  assert.equal(renderer.traceIdentity({ meta: { isMarketTimingSellTrace: true } }), "market-timing-sell");
});
