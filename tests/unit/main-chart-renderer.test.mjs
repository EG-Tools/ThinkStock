import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/main-chart-renderer.js");
const renderer = globalThis.ThinkStockMainChartRenderer;


function trace(seriesKey, values = [1, 2]) {
  return {
    type: "scatter",
    mode: "lines",
    x: ["2026-01-01", "2026-01-02"],
    y: values,
    meta: { seriesKey },
  };
}


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

test("anchors drag handles to endpoints inside the visible date range", () => {
  const endpoints = renderer.visibleEndpointValues({
    x: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"],
    y: [80, 100, 120, 500],
  }, [90, 110, 130, 900], ["2026-01-02", "2026-01-03"]);

  assert.deepEqual(endpoints, { first: 110, last: 130 });
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
  assert.deepEqual(result.baseValuesBySeries["^KS11"], [100, 103]);
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

test("updates only event markers for marker-only invalidations", async () => {
  const disclosure = {
    ...trace("disclosure", [2, 2]),
    mode: "markers",
    meta: { isDisclosureTrace: true },
  };
  const nextDisclosure = { ...disclosure, y: [3, 3] };
  const element = {
    data: [trace("^KS11"), trace("005930.KS"), disclosure],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  const calls = [];
  const result = await renderer.render({
    update: async (...args) => calls.push(args),
    react: async () => { throw new Error("unexpected full render"); },
  }, element, [trace("^KS11"), trace("005930.KS"), nextDisclosure], {
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
  assert.deepEqual(calls[0][3], [2]);
  assert.deepEqual(calls[0][1].y, [[3, 3]]);
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
