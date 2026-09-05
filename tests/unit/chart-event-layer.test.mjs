import assert from "node:assert/strict";
import test from "node:test";

import * as eventLayer from "../../docs/modules/chart-event-layer.mjs";

test("all point markers share one mouse and touch hit-area policy", () => {
  assert.equal(eventLayer.interactiveMarkerHitRadius(false), 26);
  assert.equal(eventLayer.interactiveMarkerHitRadius(true), 36);
});

test("all chart lines share a restrained one-pixel highlight increase", () => {
  assert.equal(eventLayer.interactiveLineWidth(1, false), 1);
  assert.equal(eventLayer.interactiveLineWidth(1, true), 2);
  assert.equal(eventLayer.interactiveLineWidth(2, true), 3);
});

test("indexes only exact chart dates for disclosures and insider trades", () => {
  const index = eventLayer.buildPointIndex([
    {
      series: "005930.KS",
      xValues: ["2026-07-16", "2026-07-20"],
      values: [100, 110],
      baseValues: [95, 105],
    },
  ], new Set(["005930.KS"]), Date.parse);
  assert.deepEqual(eventLayer.findPointOnDate("2026-07-20", "005930.KS", index), {
    date: "2026-07-20",
    y: 110,
    baseY: 105,
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
    meta: { overlayKind: "disclosure" },
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
    meta: { overlayKind: "disclosure" },
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

test("selects timing and disclosure markers through one interactive index", () => {
  const disclosure = {
    x: [20],
    y: [30],
    meta: { overlayKind: "disclosure" },
  };
  const timing = {
    x: [20],
    y: [70],
    meta: { overlayKind: "timing-buy" },
  };
  const element = {
    data: [disclosure, timing],
    _fullLayout: {
      xaxis: { _offset: 0, _length: 100, range: [0, 100], d2p: (value) => value },
      yaxis: { _offset: 0, _length: 100, range: [0, 100], d2p: (value) => value },
    },
    getBoundingClientRect: () => ({ left: 100, top: 200 }),
  };
  const options = {
    cacheKey: "interactive",
    tracePredicate: (trace) => ["disclosure", "timing-buy"].includes(trace.meta?.overlayKind),
    mouseRadius: 10,
    touchRadius: 16,
    isTouch: false,
  };

  assert.deepEqual(eventLayer.findMarkerAtClientPoint(element, 120, 270, options), {
    traceIndex: 1,
    pointIndex: 0,
  });
  assert.deepEqual(eventLayer.findMarkerAtClientPoint(element, 120, 230, options), {
    traceIndex: 0,
    pointIndex: 0,
  });
});

test("highlights a marker through its trace node without reading every marker rectangle", () => {
  const attributes = new Map();
  const point = {
    style: {},
    classList: { toggle() {} },
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const group = {
    classList: { contains: (name) => name === "traceabc" },
    querySelectorAll: () => [point],
  };
  const element = {
    data: [{ uid: "abc", marker: { color: ["orange"], line: { color: "black", width: 1 } } }],
    _fullData: [{ uid: "abc" }],
    querySelectorAll: () => [group],
  };

  assert.equal(eventLayer.setMarkerHighlighted(element, 0, 0, true, {
    highlightFill: "white",
    highlightStroke: "yellow",
    highlightStrokeWidth: 3,
  }), true);
  assert.equal(point.style.fill, "white");
  assert.equal(attributes.get("stroke-width"), "3");

  assert.equal(eventLayer.setMarkerHighlighted(element, 0, 0, false), true);
  assert.equal(point.style.fill, "orange");
  assert.equal(point.style.stroke, "black");
  assert.equal(point.style.strokeWidth, "1px");
});

test("text event markers share the same one-pixel hover enlargement", () => {
  const attributes = new Map();
  const point = {
    style: {},
    classList: { toggle() {} },
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const group = {
    classList: { contains: (name) => name === "traceevent" },
    querySelectorAll: () => [point],
  };
  const element = {
    data: [{ uid: "event", mode: "text", textfont: { color: "#b91c1c", size: 15 } }],
    _fullData: [{ uid: "event" }],
    querySelectorAll: () => [group],
  };

  assert.equal(eventLayer.setMarkerHighlighted(element, 0, 0, true, {
    highlightSizeDelta: 1,
  }), true);
  assert.equal(point.style.fill, "#b91c1c");
  assert.equal(point.style.fontSize, "16px");
  assert.equal(attributes.get("font-size"), "16");

  assert.equal(eventLayer.setMarkerHighlighted(element, 0, 0, false), true);
  assert.equal(point.style.fontSize, "15px");
});

test("refreshes marker nodes after Plotly replaces the visible SVG trace", () => {
  const trace = { uid: "event", mode: "text", textfont: { color: "#b91c1c", size: 15 } };
  const stalePoint = {
    isConnected: true,
    style: {},
    classList: { toggle() {} },
    setAttribute() {},
  };
  const currentPoint = {
    isConnected: true,
    style: {},
    classList: { toggle() {} },
    setAttribute() {},
  };
  let visiblePoint = stalePoint;
  const group = {
    classList: { contains: (name) => name === "traceevent" },
    querySelectorAll: () => [visiblePoint],
  };
  const element = {
    data: [trace],
    _fullData: [{ uid: "event" }],
    contains: (node) => node === visiblePoint,
    querySelectorAll: () => [group],
  };

  assert.equal(eventLayer.setMarkerHighlighted(element, 0, 0, true, {
    highlightSizeDelta: 3,
  }), true);
  assert.equal(stalePoint.style.fontSize, "18px");

  stalePoint.isConnected = false;
  visiblePoint = currentPoint;
  assert.equal(eventLayer.setMarkerHighlighted(element, 0, 0, true, {
    highlightSizeDelta: 3,
  }), true);
  assert.equal(currentPoint.style.fontSize, "18px");
});
