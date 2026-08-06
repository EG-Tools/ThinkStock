import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-event-layer.js");
const eventLayer = globalThis.ThinkStockChartEventLayer;

test("indexes only exact chart dates for disclosures and insider trades", () => {
  const index = eventLayer.buildPointIndex([
    {
      series: "005930.KS",
      xValues: ["2026-07-16", "2026-07-20"],
      values: [100, 110],
    },
  ], new Set(["005930.KS"]), Date.parse);
  assert.deepEqual(eventLayer.findPointOnDate("2026-07-20", "005930.KS", index), {
    date: "2026-07-20",
    y: 110,
  });
  assert.equal(eventLayer.findPointOnDate("2026-07-19", "005930.KS", index), null);
});

test("calculates event spacing from the visible chart range", () => {
  const models = [{
    series: "005930.KS",
    xValues: ["2026-01-01", "2026-01-02"],
    values: [80, 120],
  }];
  assert.equal(eventLayer.markerGap(models, "2026-01-01", "2026-01-02", {
    ratio: 0.02,
    hiddenSeries: new Set(),
  }), 0.8);
  assert.equal(eventLayer.markerGap(models, "2026-01-01", "2026-01-02", {
    ratio: 0.02,
    useViewport: true,
    viewportRange: [50, 150],
  }), 2);
});

test("finds only a disclosure marker inside its hit radius", () => {
  const trace = {
    x: [10, 50],
    y: [20, 60],
    meta: { isDisclosureTrace: true },
  };
  const element = {
    data: [trace],
    _fullLayout: {
      xaxis: { _offset: 5, _length: 100, range: [0, 100], d2p: (value) => value },
      yaxis: { _offset: 7, _length: 100, range: [0, 100], d2p: (value) => value },
    },
    getBoundingClientRect: () => ({ left: 100, top: 200 }),
    querySelectorAll: () => [],
  };
  const options = { iconText: "diamond", mouseRadius: 8, touchRadius: 14, isTouch: false };
  assert.deepEqual(eventLayer.findMarkerAtClientPoint(element, 115, 227, options), {
    traceIndex: 0,
    pointIndex: 0,
  });
  assert.equal(eventLayer.findMarkerAtClientPoint(element, 115, 250, options), null);
});

test("selects the vertically nearest disclosure when dates overlap", () => {
  const trace = {
    x: [50, 50],
    y: [20, 80],
    meta: { isDisclosureTrace: true },
  };
  const reversedTextNodes = [
    { textContent: "diamond", getBoundingClientRect: () => ({ top: 275, height: 10 }) },
    { textContent: "diamond", getBoundingClientRect: () => ({ top: 215, height: 10 }) },
  ];
  const element = {
    data: [trace],
    _fullLayout: {
      xaxis: { _offset: 0, _length: 100, range: [0, 100], d2p: (value) => value },
      yaxis: { _offset: 0, _length: 100, range: [0, 100], d2p: (value) => value },
    },
    getBoundingClientRect: () => ({ left: 100, top: 200 }),
    querySelectorAll: () => reversedTextNodes,
  };
  const options = { iconText: "diamond", mouseRadius: 12, touchRadius: 18, isTouch: false };

  assert.deepEqual(eventLayer.findMarkerAtClientPoint(element, 150, 280, options), {
    traceIndex: 0,
    pointIndex: 1,
  });
  assert.deepEqual(eventLayer.findMarkerAtClientPoint(element, 150, 220, options), {
    traceIndex: 0,
    pointIndex: 0,
  });
});
