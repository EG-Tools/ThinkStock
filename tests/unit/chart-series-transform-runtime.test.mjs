import assert from "node:assert/strict";
import test from "node:test";

import {
  createChartSeriesTransformRuntime,
  createSeriesTransformGestureRuntime,
} from "../../docs/modules/chart-series-transform-runtime.mjs";
import adjustments from "../../docs/modules/chart-adjustments.mjs";

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

test("anchors linked AI traces to the owning series latest price", () => {
  const bases = { A: [80, 90, 110] };
  const runtime = createChartSeriesTransformRuntime({
    baseValuesFor: (seriesKey) => bases[seriesKey],
    describeTrace,
    resolveOffset: () => 5,
    resolveScale: () => 2,
    transformValuesInto,
  });
  const scenario = {
    y: [0, 0],
    meta: {
      overlayKind: "ai-scenario",
      seriesKey: "A",
      seriesTransformBaseValues: [50, 60],
      seriesTransformAnchor: "latest-price",
      seriesTransformAnchorBaseValue: 50,
    },
  };
  const report = {
    y: [0],
    meta: {
      overlayKind: "ai-report",
      seriesKey: "A",
      seriesTransformBaseValues: [55],
      seriesTransformAnchor: "latest-price",
      seriesTransformAnchorBaseValue: 50,
    },
  };

  const updates = runtime.collectLinkedSeriesYUpdates([scenario, report], "A");
  const ownerLatest = transformValuesInto(bases.A, 2, 5, []).at(-1);

  assert.equal(updates.yUpdates[0][0], ownerLatest);
  assert.deepEqual(updates.yUpdates, [[125, 145], [135]]);
});

test("reframes every visible series to the same viewport span without cumulative drift", () => {
  const dates = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"];
  const bases = {
    A: [80, 90, 100, 120],
    B: [99, 100, 101, 102],
  };
  const runtime = createChartSeriesTransformRuntime({
    baseValuesFor: (seriesKey) => bases[seriesKey],
    describeTrace,
    finiteDatedRange: adjustments.finiteDatedRange,
    groupedHoverYUpdate: (_traces, sourceTraceIndex, values) => ({
      traceIndex: sourceTraceIndex === 1 ? 3 : 4,
      y: [values.at(-1)],
    }),
    resolveOffset: () => 0,
    resolveScale: () => 1,
    transformValuesInto,
    transformViewportValuesInto: adjustments.transformViewportValuesInto,
  });
  const linked = {
    x: ["2026-03-01", "2026-04-01"],
    y: [100, 120],
    meta: {
      overlayKind: "ai-scenario",
      seriesKey: "A",
      seriesTransformBaseValues: [100, 120],
    },
  };
  const traces = [
    linked,
    { x: dates, y: [...bases.A], meta: { overlayKind: "price", seriesKey: "A" } },
    { x: dates, y: [...bases.B], meta: { overlayKind: "price", seriesKey: "B" } },
    { x: dates, y: [...bases.A], meta: { overlayKind: "grouped-hover" } },
    { x: dates, y: [...bases.B], meta: { overlayKind: "grouped-hover" } },
  ];
  const range = ["2026-02-01", "2026-04-01"];
  const first = runtime.collectViewportFrameUpdates(traces, range, { targetSpan: 20 });
  const updates = new Map(first.seriesUpdates.map((item) => [item.seriesKey, item]));
  const visibleSpan = (values) => Math.max(...values.slice(1)) - Math.min(...values.slice(1));
  assert.equal(visibleSpan(updates.get("A").nextY), 20);
  assert.equal(visibleSpan(updates.get("B").nextY), 20);
  assert.deepEqual(updates.get("A").linkedUpdate.traceIndexes, [0]);
  assert.deepEqual(first.traceIndexes, [0, 1, 3, 2, 4]);

  traces[1].y = updates.get("A").nextY;
  traces[2].y = updates.get("B").nextY;
  const repeated = runtime.collectViewportFrameUpdates(traces, range, { targetSpan: 20 });
  const repeatedUpdates = new Map(repeated.seriesUpdates.map((item) => [item.seriesKey, item]));
  assert.deepEqual(repeatedUpdates.get("A").nextY, updates.get("A").nextY);
  assert.deepEqual(repeatedUpdates.get("B").nextY, updates.get("B").nextY);
  assert.deepEqual(runtime.stats(), {
    viewportFrames: 2,
    viewportTraceDescriptions: 10,
    viewportSeriesTransforms: 4,
    viewportLinkedTransforms: 2,
  });
});

test("keeps AI paths and their report marker linked during viewport reframing", () => {
  const ownerDates = ["2026-01-01", "2026-02-01", "2026-03-01"];
  const bases = { A: [80, 100, 110] };
  const runtime = createChartSeriesTransformRuntime({
    baseValuesFor: (seriesKey) => bases[seriesKey],
    describeTrace,
    finiteDatedRange: adjustments.finiteDatedRange,
    resolveOffset: () => 0,
    resolveScale: () => 1,
    transformValuesInto,
    transformViewportValuesInto: adjustments.transformViewportValuesInto,
  });
  const scenario = {
    x: ["2026-03-01", "2026-04-01"],
    y: [50, 60],
    meta: {
      overlayKind: "ai-scenario",
      seriesKey: "A",
      seriesTransformBaseValues: [50, 60],
      seriesTransformAnchor: "latest-price",
      seriesTransformAnchorBaseValue: 50,
    },
  };
  const report = {
    x: ["2026-03-15"],
    y: [55],
    meta: {
      overlayKind: "ai-report",
      seriesKey: "A",
      seriesTransformBaseValues: [55],
      seriesTransformAnchor: "latest-price",
      seriesTransformAnchorBaseValue: 50,
    },
  };
  const traces = [
    scenario,
    report,
    { x: ownerDates, y: [...bases.A], meta: { overlayKind: "price", seriesKey: "A" } },
  ];

  const frame = runtime.collectViewportSeriesUpdates(
    traces,
    ["2026-01-01", "2026-03-01"],
    { targetSpan: 20 },
  );
  const update = frame.seriesUpdates[0];

  assert.equal(update.linkedUpdate.yUpdates[0][0], update.nextY.at(-1));
  assert.ok(Math.abs(update.linkedUpdate.yUpdates[1][0] - (update.nextY.at(-1) + (10 / 3))) < 1e-9);
});

test("can reframe one requested series for a live handle gesture", () => {
  const dates = ["2026-01-01", "2026-02-01", "2026-03-01"];
  const bases = {
    A: [80, 100, 120],
    B: [95, 100, 105],
  };
  const runtime = createChartSeriesTransformRuntime({
    baseValuesFor: (seriesKey) => bases[seriesKey],
    describeTrace,
    finiteDatedRange: adjustments.finiteDatedRange,
    resolveOffset: () => 0,
    resolveScale: () => 0.5,
    transformValuesInto,
    transformViewportValuesInto: adjustments.transformViewportValuesInto,
  });
  const traces = [
    { x: dates, y: [...bases.A], meta: { overlayKind: "price", seriesKey: "A" } },
    { x: dates, y: [...bases.B], meta: { overlayKind: "price", seriesKey: "B" } },
  ];

  const frame = runtime.collectViewportSeriesUpdates(
    traces,
    ["2026-01-01", "2026-03-01"],
    { targetSpan: 20, seriesKeys: ["B"] },
  );

  assert.deepEqual(frame.seriesUpdates.map((update) => update.seriesKey), ["B"]);
  assert.equal(Math.max(...frame.seriesUpdates[0].nextY) - Math.min(...frame.seriesUpdates[0].nextY), 10);
});

test("reframes EPS through the same adjustable-series viewport contract as prices", () => {
  const dates = ["2026-01-01", "2026-04-01", "2026-07-01"];
  const bases = {
    A: [95, 100, 105],
    "eps:A": [20, 400, 2000],
  };
  const runtime = createChartSeriesTransformRuntime({
    baseValuesFor: (seriesKey) => bases[seriesKey],
    describeTrace,
    finiteDatedRange: adjustments.finiteDatedRange,
    resolveOffset: () => 0,
    resolveScale: () => 1,
    transformValuesInto,
    transformViewportValuesInto: adjustments.transformViewportValuesInto,
  });
  const frame = runtime.collectViewportSeriesUpdates([
    { x: dates, y: [...bases.A], meta: { overlayKind: "price", seriesKey: "A" } },
    { x: dates, y: [...bases["eps:A"]], meta: { overlayKind: "eps", seriesKey: "eps:A" } },
  ], dates.slice(0, 2), { targetSpan: 20 });
  const updates = new Map(frame.seriesUpdates.map((update) => [update.seriesKey, update.nextY]));
  const visibleSpan = (values) => Math.max(...values.slice(0, 2)) - Math.min(...values.slice(0, 2));

  assert.deepEqual([...updates.keys()], ["A", "eps:A"]);
  assert.equal(visibleSpan(updates.get("A")), 20);
  assert.equal(visibleSpan(updates.get("eps:A")), 20);
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

test("keeps the visible left endpoint fixed while the right scale handle changes span", () => {
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
    scaleFromDrag: (start, startY, clientY) => start + ((startY - clientY) / 100),
    resolveOffset: (seriesKey) => offsets[seriesKey],
    resolveScale: (seriesKey) => scales[seriesKey],
    setOffset: (seriesKey, value) => { offsets[seriesKey] = value; },
    setScale: (seriesKey, value) => { scales[seriesKey] = value; },
  });

  runtime.startScale({
    pointerId: 2,
    startClientY: 100,
    seriesKey: "TEST",
    scaleAnchorCoefficient: 10,
  });
  activeConfig.applyValue(50);

  assert.equal(scales.TEST, 2);
  assert.equal(offsets.TEST, -1);
  assert.equal(100 + (10 * 1.5) + 4, 100 + (10 * scales.TEST) + offsets.TEST);
});
