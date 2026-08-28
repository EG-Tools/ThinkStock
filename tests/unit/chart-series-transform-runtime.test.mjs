import assert from "node:assert/strict";
import test from "node:test";

import {
  createChartSeriesTransformRuntime,
  createSeriesTransformGestureRuntime,
} from "../../docs/modules/chart-series-transform-runtime.mjs";

function describeTrace(trace) {
  const kind = String(trace?.meta?.overlayKind || "price");
  return {
    adjustable: kind === "price" || kind === "eps",
    kind,
    seriesKey: String(trace?.meta?.seriesKey || ""),
  };
}

function transformValuesInto(values, scale, offset, output) {
  values.forEach((value, index) => {
    output[index] = value == null ? null : 100 + ((value - 100) * scale) + offset;
  });
  return output;
}

test("shares one buffered transform contract across base and linked series", () => {
  const bases = { "005930.KS": [100, 110] };
  const runtime = createChartSeriesTransformRuntime({
    baseValuesFor: (seriesKey) => bases[seriesKey],
    describeTrace,
    resolveOffset: () => 5,
    resolveScale: () => 2,
    transformValuesInto,
  });
  const price = { y: [100, 110], meta: { seriesKey: "005930.KS" } };
  const scenario = {
    y: [100, 105],
    meta: {
      overlayKind: "ai-scenario",
      seriesKey: "005930.KS",
      seriesTransformBaseValues: [100, 105],
    },
  };
  const report = {
    y: [105],
    meta: {
      overlayKind: "ai-report",
      seriesKey: "005930.KS",
      seriesTransformBaseValues: [105],
    },
  };
  const traces = [scenario, report, price];

  assert.equal(runtime.findAdjustableSeriesTraceIndex(traces, "005930.KS", 0), 2);
  assert.deepEqual(runtime.computeSeriesValues("005930.KS", 2, { data: traces }), [105, 125]);
  assert.deepEqual(runtime.collectLinkedSeriesYUpdates(traces, "005930.KS"), {
    traceIndexes: [0, 1],
    yUpdates: [[105, 115], [115]],
  });
  assert.deepEqual(price.y, [100, 110]);
  assert.deepEqual(scenario.y, [100, 105]);
});

test("uses one gesture contract for line offsets and scale handles", () => {
  const offsets = { TEST: 4 };
  const scales = { TEST: 1.5 };
  let activeConfig = null;
  const runtime = createSeriesTransformGestureRuntime({
    getDragController: () => ({
      start: (config) => {
        activeConfig = config;
        return true;
      },
    }),
    offsetFromDrag: (start, startY, clientY, axis) => start + ((startY - clientY) / axis.step),
    scaleFromDrag: (start, startY, clientY) => start + ((startY - clientY) / 100),
    resolveOffset: (seriesKey) => offsets[seriesKey],
    resolveScale: (seriesKey) => scales[seriesKey],
    setOffset: (seriesKey, value) => { offsets[seriesKey] = value; },
    setScale: (seriesKey, value) => { scales[seriesKey] = value; },
  });

  assert.equal(runtime.startOffset({
    pointerId: 1,
    startClientY: 100,
    seriesKey: "TEST",
    axis: { step: 10 },
  }), true);
  activeConfig.applyValue(80);
  assert.equal(offsets.TEST, 6);

  assert.equal(runtime.startScale({
    pointerId: 2,
    startClientY: 100,
    seriesKey: "TEST",
  }), true);
  activeConfig.applyValue(50);
  assert.equal(scales.TEST, 2);
});
