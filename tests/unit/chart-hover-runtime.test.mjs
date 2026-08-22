import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-hover-runtime.js");

const hoverModule = globalThis.ThinkStockChartHoverRuntime;

test("chart hover requests the complete unified popup at the selected x value", () => {
  const frames = [];
  const hoverCalls = [];
  let popupVisible = false;
  const scope = {
    Plotly: {
      Fx: {
        hover: (...args) => { hoverCalls.push(args); popupVisible = true; },
        unhover: () => {},
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
  };
  const runtime = hoverModule.createChartHoverRuntime(scope, {
    findNearestHoverPoint: () => ({ curveNumber: 0, pointNumber: 1 }),
    getTraceTimeMsArray: (trace) => trace.x.map((date) => Date.parse(`${date}T00:00:00Z`)),
    toMsSafe: (value) => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`),
  });
  const chart = {
    id: "chart",
    querySelector: () => (popupVisible ? {} : null),
    data: [{
      x: ["2026-08-08", "2026-08-11"],
      meta: { seriesKey: "005930.KS" },
    }],
  };

  runtime.syncHoverToChart(chart, "2026-08-10");
  frames.shift()();
  assert.deepEqual(hoverCalls[0][1], [{ xval: "2026-08-10" }]);
  assert.equal(runtime.nearestMainLineDate(chart, "2026-08-10"), "2026-08-11");

  frames.shift()();
  popupVisible = false;
  runtime.syncHoverToChart(chart, "2026-08-10");
  frames.shift()();
  assert.equal(hoverCalls.length, 2);
});

test("chart hover exposes event markers only on the exact selected date", () => {
  const runtime = hoverModule.createChartHoverRuntime({
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  }, {
    findNearestHoverPoint: () => null,
    getTraceTimeMsArray: (trace) => trace.x.map((date) => Date.parse(`${date}T00:00:00Z`)),
    toMsSafe: (value) => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`),
  });
  const line = { x: ["2026-08-08", "2026-08-11"], meta: { seriesKey: "005930.KS" } };
  const exact = { x: ["2026-08-11"], meta: { isDisclosureTrace: true } };
  const other = { x: ["2026-08-08"], meta: { isInsiderTradeTrace: true } };
  const chart = {
    data: [line, exact, other],
    _fullData: [line, exact, other],
    _fullLayout: { xaxis: { _offset: 0, p2d: () => "2026-08-11" } },
    getBoundingClientRect: () => ({ left: 0 }),
  };

  runtime.configureExactDateEventHover(chart, { clientX: 100 });
  assert.equal(exact.hoverinfo, "all");
  assert.equal(other.hoverinfo, "skip");
});
