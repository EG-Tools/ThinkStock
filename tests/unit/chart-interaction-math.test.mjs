import assert from "node:assert/strict";
import test from "node:test";


import * as chartMath from "../../docs/modules/chart-interaction-math.mjs";


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

test("finds a hover point inside the explicitly selected scenario trace", () => {
  const element = {
    data: [
      { x: ["2026-09-01"], y: [120], meta: { overlayKind: "ai-scenario", aiTraceRole: "upside" } },
      { x: ["2026-09-01"], y: [100], meta: { overlayKind: "ai-scenario", aiTraceRole: "sideways" } },
      { x: ["2026-09-01"], y: [80], meta: { overlayKind: "ai-scenario", aiTraceRole: "downside" } },
    ],
  };

  assert.deepEqual(chartMath.findNearestHoverPoint(element, "2026-09-01", 2), {
    curveNumber: 2,
    pointNumber: 0,
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


test("uses the chart axis converter for exact rendered y pixels", () => {
  assert.equal(chartMath.yValueToLocalPixelFromAxis({
    _offset: 12,
    d2p: (value) => value * 3,
    range: [0, 100],
    _length: 200,
  }, 25), 87);
});


test("builds and reuses a numeric line hit index", () => {
  const traces = [
    {
      x: ["2026-01-01", "2026-01-03"],
      y: ["10", "30"],
      meta: { renderFingerprint: "frame-1" },
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
  ), {
    traceIndex: 0,
    seriesKey: "first",
    yValue: 20,
    localY: 170,
    distancePx: 0,
  });

  traces[0].y = [20, 40];
  assert.equal(chartMath.lineHitIndexMatches(index, traces, seriesKeys), false);

  traces[0].y = index[0].yValues;
  traces[0].meta.renderFingerprint = "frame-2";
  assert.equal(chartMath.lineHitIndexMatches(index, traces, seriesKeys), false);
});

test("prefers the visually topmost line when two series overlap", () => {
  const traces = [
    { x: ["2026-01-01"], y: [50] },
    { x: ["2026-01-01"], y: [50] },
  ];
  const index = chartMath.buildLineHitIndex(traces, ["benchmark", "stock"]);

  assert.deepEqual(chartMath.findNearestLineTarget(
    index,
    Date.parse("2026-01-01"),
    110,
    { _offset: 10, _length: 200, range: [0, 100] },
    4,
  ), {
    traceIndex: 1,
    seriesKey: "stock",
    yValue: 50,
    localY: 110,
    distancePx: 0,
  });
});

test("selects the closest price line while excluding other overlays", () => {
  const traces = [
    { x: ["2026-01-01"], y: [20], meta: { overlayKind: "price" } },
    { x: ["2026-01-01"], y: [78], meta: { overlayKind: "price" } },
    { x: ["2026-01-01"], y: [80], meta: { overlayKind: "eps" } },
  ];
  const index = chartMath.buildLineHitIndex(traces, ["first", "second", "eps:first"]);
  const target = chartMath.findNearestLineTarget(
    index,
    Date.parse("2026-01-01"),
    52,
    { _offset: 10, _length: 200, range: [0, 100] },
    Number.POSITIVE_INFINITY,
    (entry) => entry.trace.meta.overlayKind === "price",
  );
  assert.deepEqual({
    traceIndex: target.traceIndex,
    seriesKey: target.seriesKey,
    yValue: target.yValue,
  }, {
    traceIndex: 1,
    seriesKey: "second",
    yValue: 78,
  });
  assert.ok(Math.abs(target.localY - 54) < 1e-9);
  assert.ok(Math.abs(target.distancePx - 2) < 1e-9);
});


test("prioritizes a marker inside its two-dimensional hit radius", () => {
  const trace = {
    x: ["2026-01-01", "2026-03-31"],
    y: [20, 40],
    marker: { size: [0, 15] },
    meta: { overlayKind: "eps" },
  };
  const index = chartMath.buildLineHitIndex([trace], ["eps:first"]);
  const target = chartMath.findNearestMarkerTarget(
    index,
    123,
    132,
    { _offset: 10, d2p: (value) => value === "2026-03-31" ? 100 : 0 },
    { _offset: 10, _length: 200, range: [0, 100] },
    24,
    (entry, pointIndex) => entry.trace.meta.overlayKind === "eps" && entry.trace.marker.size[pointIndex] > 0,
  );

  assert.deepEqual(target, { traceIndex: 0, seriesKey: "eps:first", pointIndex: 1 });
});


test("skips dense price entries before scanning sparse EPS markers", () => {
  const pricePointChecks = { count: 0 };
  const densePrice = {
    x: Array.from({ length: 6500 }, (_, index) => `price-${index}`),
    y: Array.from({ length: 6500 }, () => 50),
    marker: { size: Array.from({ length: 6500 }, () => 7) },
    meta: { seriesKey: "price" },
  };
  const eps = {
    x: ["eps-0", "eps-1"],
    y: [20, 40],
    marker: { size: [0, 15] },
    meta: { overlayKind: "eps" },
  };
  const index = chartMath.buildLineHitIndex([densePrice, eps], ["price", "eps:price"]);
  const target = chartMath.findNearestMarkerTarget(
    index,
    113,
    132,
    { _offset: 10, d2p: (value) => value === "eps-1" ? 100 : 0 },
    { _offset: 10, _length: 200, range: [0, 100] },
    24,
    (entry, pointIndex) => {
      if (entry.trace.meta.overlayKind !== "eps") pricePointChecks.count += 1;
      return entry.trace.marker.size[pointIndex] > 0;
    },
    (entry) => entry.trace.meta.overlayKind === "eps",
  );

  assert.equal(pricePointChecks.count, 0);
  assert.deepEqual(target, { traceIndex: 1, seriesKey: "eps:price", pointIndex: 1 });
});

test("limits sorted EPS marker hit tests to points near the cursor date", () => {
  const dates = Array.from({ length: 500 }, (_, index) => (
    new Date(Date.UTC(2000, index * 3, 1)).toISOString().slice(0, 10)
  ));
  const pixelByDate = new Map(dates.map((date, index) => [date, index]));
  const trace = {
    x: dates,
    y: dates.map(() => 50),
    marker: { size: dates.map(() => 12) },
    meta: { overlayKind: "eps" },
  };
  const index = chartMath.buildLineHitIndex([trace], ["eps:first"]);
  let pointChecks = 0;
  const target = chartMath.findNearestMarkerTarget(
    index,
    260,
    50,
    { _offset: 10, d2p: (value) => pixelByDate.get(value) },
    { _offset: 0, _length: 100, range: [0, 100] },
    5,
    () => {
      pointChecks += 1;
      return true;
    },
    (entry) => entry.trace.meta.overlayKind === "eps",
    Date.parse(dates[250]),
  );

  assert.deepEqual(target, { traceIndex: 0, seriesKey: "eps:first", pointIndex: 250 });
  assert.ok(pointChecks <= 11);
});
