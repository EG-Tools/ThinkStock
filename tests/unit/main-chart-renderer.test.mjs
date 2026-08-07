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

  assert.deepEqual(result, { mode: "full", attemptedPartial: true });
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
