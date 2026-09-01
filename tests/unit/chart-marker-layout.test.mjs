import assert from "node:assert/strict";
import test from "node:test";

const { chartMarkerLayout: layout } = await import("../../docs/modules/chart-marker-runtime.mjs");

test("collects marker y updates by stable marker identity", () => {
  const element = {
    data: [
      { meta: { insider: true, side: "buy" }, y: [1] },
      { meta: { insider: true, side: "sell" }, y: [2] },
      { meta: { disclosure: true }, y: [3] },
    ],
  };
  const result = layout.collectYUpdates(element, [
    {
      id: "insider",
      enabled: true,
      matches: (trace) => trace?.meta?.insider,
      keyOf: (trace) => trace.meta.side,
      traces: [
        { meta: { side: "sell" }, y: [20] },
        { meta: { side: "buy" }, y: [10] },
      ],
    },
    {
      id: "disclosure",
      enabled: true,
      matches: (trace) => trace?.meta?.disclosure,
      traces: { y: [30] },
    },
  ]);

  assert.deepEqual(result.traceIndexes, [0, 1, 2]);
  assert.deepEqual(result.yUpdates, [[10], [20], [30]]);
  assert.deepEqual(result.updated, ["insider", "disclosure"]);
  assert.equal(result.structureChanged, false);
});

test("reports marker structure changes instead of applying mismatched arrays", () => {
  const result = layout.collectYUpdates({ data: [] }, [{
    id: "disclosure",
    enabled: true,
    matches: (trace) => trace?.meta?.disclosure,
    traces: { y: [1] },
  }]);
  assert.equal(result.structureChanged, true);
  assert.deepEqual(result.traceIndexes, []);
});

test("skips marker restyles when the y positions are unchanged", () => {
  const result = layout.collectYUpdates({
    data: [{ meta: { disclosure: true }, x: ["2026-08-01"], y: [10] }],
  }, [{
    id: "disclosure",
    enabled: true,
    matches: (trace) => trace?.meta?.disclosure,
    traces: { meta: { disclosure: true }, x: ["2026-08-01"], y: [10] },
  }]);

  assert.equal(result.structureChanged, false);
  assert.deepEqual(result.traceIndexes, []);
  assert.deepEqual(result.yUpdates, []);
  assert.deepEqual(result.updated, []);
});

test("requests a structural render when a new ticker changes marker dates or payload", () => {
  const result = layout.collectYUpdates({
    data: [{
      meta: { insider: true, side: "buy" },
      x: ["2026-08-01"],
      y: [10],
      customdata: [{ ticker: "005930.KS" }],
    }],
  }, [{
    id: "insider",
    enabled: true,
    matches: (trace) => trace?.meta?.insider,
    keyOf: (trace) => trace.meta.side,
    traces: [{
      meta: { side: "buy" },
      x: ["2026-08-01", "2026-08-02"],
      y: [10, 20],
      customdata: [{ ticker: "005930.KS" }, { ticker: "000660.KS" }],
    }],
  }]);

  assert.equal(result.structureChanged, true);
  assert.deepEqual(result.traceIndexes, []);
});

test("moves only one series marker positions during a live line transform", () => {
  const element = {
    data: [
      {
        x: ["2026-08-01", "2026-08-02"],
        y: [100, 110],
        meta: { seriesKey: "005930.KS" },
      },
      {
        x: ["2026-08-01", "2026-08-02", "2026-08-02"],
        y: [105, 115, 210],
        meta: { pointTickers: ["005930.KS", "005930.KS", "000660.KS"] },
      },
    ],
  };

  const result = layout.collectSeriesYDeltaUpdates(element, {
    seriesKey: "005930.KS",
    sourceTraceIndex: 0,
    nextY: [120, 140],
  });

  assert.deepEqual(result.traceIndexes, [1]);
  assert.deepEqual(result.yUpdates, [[125, 145, 210]]);
});

test("reuses dated marker bindings instead of rebuilding the full source date map each frame", () => {
  const sourceDates = Array.from({ length: 6500 }, (_, index) => `2026-${String(index).padStart(4, "0")}`);
  let sourceDateReads = 0;
  const observedDates = new Array(sourceDates.length);
  sourceDates.forEach((value, index) => {
    Object.defineProperty(observedDates, index, {
      configurable: true,
      enumerable: true,
      get() {
        sourceDateReads += 1;
        return value;
      },
    });
  });
  const sourceTrace = {
    x: observedDates,
    y: sourceDates.map((_, index) => index),
    meta: { seriesKey: "005930.KS" },
  };
  const markerTrace = {
    x: [sourceDates[100], sourceDates[6400]],
    y: [105, 6405],
    meta: { pointTickers: ["005930.KS", "005930.KS"] },
  };
  const element = { data: [sourceTrace, markerTrace] };
  const first = layout.collectSeriesYDeltaUpdates(element, {
    seriesKey: "005930.KS",
    sourceTraceIndex: 0,
    nextY: sourceTrace.y.map((value) => value + 10),
  });
  const firstPassReads = sourceDateReads;
  sourceTrace.y = sourceTrace.y.map((value) => value + 10);
  markerTrace.y = first.yUpdates[0];

  const second = layout.collectSeriesYDeltaUpdates(element, {
    seriesKey: "005930.KS",
    sourceTraceIndex: 0,
    nextY: sourceTrace.y.map((value) => value + 10),
  });

  assert.deepEqual(second.yUpdates, [[125, 6425]]);
  assert.ok(sourceDateReads - firstPassReads <= 4);
});

test("attaches every event marker to its owning price point during viewport fitting", () => {
  const element = {
    data: [
      {
        x: ["2026-08-01", "2026-08-02"],
        y: [100, 120],
        meta: { overlayKind: "price", seriesKey: "005930.KS" },
      },
      {
        x: ["2026-08-01"],
        y: [104],
        meta: {
          isDisclosureTrace: true,
          pointTickers: ["005930.KS"],
          markerGapFactors: [1],
        },
      },
      {
        x: ["2026-08-02"],
        y: [111.2],
        meta: {
          isMarketTimingBuyTrace: true,
          pointTickers: ["005930.KS"],
          markerGapFactors: [-1.1],
        },
      },
    ],
  };

  const result = layout.collectViewportAnchoredYUpdates(element, {
    viewportRange: [0, 200],
    gapRatio: 0.02,
  });

  assert.deepEqual(result.traceIndexes, [2]);
  assert.deepEqual(result.yUpdates, [[115.6]]);

  // Plotly can retain the array identity while updating the latest value in place.
  element.data[0].y[1] = 140;
  const refreshed = layout.collectViewportAnchoredYUpdates(element, {
    viewportRange: [0, 200],
    gapRatio: 0.02,
  });
  assert.deepEqual(refreshed.traceIndexes, [2]);
  assert.deepEqual(refreshed.yUpdates, [[135.6]]);
});

test("reuses baked viewport marker indexes while transformed prices change", () => {
  const sourceDates = Array.from({ length: 5000 }, (_, index) => `2026-${String(index).padStart(4, "0")}`);
  let sourceDateReads = 0;
  const observedDates = new Array(sourceDates.length);
  sourceDates.forEach((value, index) => {
    Object.defineProperty(observedDates, index, {
      configurable: true,
      enumerable: true,
      get() {
        sourceDateReads += 1;
        return value;
      },
    });
  });
  const sourceTrace = {
    x: observedDates,
    y: sourceDates.map((_, index) => index),
    meta: { overlayKind: "price", seriesKey: "005930.KS" },
  };
  const markerTrace = {
    x: [sourceDates[4000]],
    y: [4004],
    meta: {
      isDisclosureTrace: true,
      pointTickers: ["005930.KS"],
      markerGapFactors: [1],
    },
  };
  const element = { data: [sourceTrace, markerTrace] };
  layout.collectViewportAnchoredYUpdates(element, { viewportRange: [0, 200] });
  const firstPassReads = sourceDateReads;

  const result = layout.collectViewportAnchoredYUpdates(element, {
    traces: [
      { ...sourceTrace, y: sourceTrace.y.map((value) => value + 10) },
      { ...markerTrace, y: markerTrace.y.slice() },
    ],
    viewportRange: [0, 200],
  });

  assert.deepEqual(result.traceIndexes, [1]);
  assert.deepEqual(result.yUpdates, [[4014]]);
  assert.ok(sourceDateReads - firstPassReads <= 4);
});
