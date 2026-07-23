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
