import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/chart-interaction-math.js");
const chartMath = globalThis.ThinkStockChartInteractionMath;


test("finds the nearest visible chart point by date", () => {
  const element = {
    data: [
      { x: ["2026-01-01", "2026-01-10"], y: [100, 110] },
      { x: ["2026-01-02"], y: [200], visible: "legendonly" },
    ],
  };

  assert.deepEqual(chartMath.findNearestHoverPoint(element, "2026-01-08"), {
    curveNumber: 0,
    pointNumber: 1,
  });
});


test("converts chart pixels and interpolates line values", () => {
  const element = {
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    _fullLayout: {
      xaxis: { _offset: 5, _length: 100, p2d: (pixel) => pixel * 2 },
      yaxis: { _offset: 10, _length: 200, range: [0, 100] },
    },
  };
  const start = Date.parse("2026-01-01");
  const end = Date.parse("2026-01-03");

  assert.equal(chartMath.axisPixelToXValue(element, 65), 100);
  assert.equal(chartMath.yValueToLocalPixel(element, 25), 160);
  assert.equal(chartMath.interpolateTraceYAtMs({
    x: ["2026-01-01", "2026-01-03"],
    y: [10, 30],
  }, (start + end) / 2), 20);
  assert.equal(chartMath.interpolateTraceYAtMs({
    x: ["2026-01-01", "2026-01-02", "2026-01-03"],
    y: [10, null, 30],
  }, Date.parse("2026-01-02")), 20);
});


test("builds and reuses a numeric line hit index", () => {
  const traces = [
    {
      x: ["2026-01-01", "2026-01-03"],
      y: ["10", "30"],
    },
    {
      x: ["2026-01-01", "2026-01-03"],
      y: [80, 90],
      visible: "legendonly",
    },
  ];
  const seriesKeys = ["first", "hidden"];
  const index = chartMath.buildLineHitIndex(traces, seriesKeys);

  assert.equal(chartMath.lineHitIndexMatches(index, traces, seriesKeys), true);
  assert.deepEqual(chartMath.findNearestLineTarget(
    index,
    Date.parse("2026-01-02"),
    170,
    { _offset: 10, _length: 200, range: [0, 100] },
    2,
  ), { traceIndex: 0, seriesKey: "first" });

  traces[0].y = [20, 40];
  assert.equal(chartMath.lineHitIndexMatches(index, traces, seriesKeys), false);
});
