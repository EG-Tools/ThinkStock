import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_REPORT_TARGET,
  EVENT_MARKER_TARGET,
  LINE_TARGET,
  chartPressMovementPx,
  createChartTargetRuntime,
  createPriorityChartPress,
  findChartInteractionTarget,
  findPriorityChartTarget,
  isPriorityChartPressValid,
  openPriorityChartTarget,
} from "../../docs/modules/chart-target-activation.mjs";

test("shares pointer press movement thresholds across chart targets", () => {
  assert.equal(chartPressMovementPx(false), 8);
  assert.equal(chartPressMovementPx(true), 14);
});

test("event markers have priority over AI report targets", () => {
  const marker = findPriorityChartTarget({}, 10, 20, false, null, {
    findEventMarkerAtClientPoint: () => ({ traceIndex: 2, pointIndex: 4 }),
    findAiForecastReportAtClientPoint: () => ({ traceIndex: 8 }),
  });
  assert.deepEqual(marker, {
    kind: EVENT_MARKER_TARGET,
    traceIndex: 2,
    pointIndex: 4,
  });

  const report = findPriorityChartTarget({}, 10, 20, false, null, {
    findEventMarkerAtClientPoint: () => null,
    findAiForecastReportAtClientPoint: () => ({ traceIndex: 8 }),
  });
  assert.deepEqual(report, { kind: AI_REPORT_TARGET, traceIndex: 8 });
});

test("line and EPS targets are considered only after point overlays", () => {
  const target = findChartInteractionTarget({}, 10, 20, false, null, {
    findEventMarkerAtClientPoint: () => null,
    findAiForecastReportAtClientPoint: () => null,
    findNearestLineDragTarget: () => ({ traceIndex: 3, seriesKey: "218410.KQ" }),
  });
  assert.deepEqual(target, {
    kind: LINE_TARGET,
    traceIndex: 3,
    seriesKey: "218410.KQ",
  });
});

test("a chart target opens only after a matching low-movement press", () => {
  const event = { clientX: 100, clientY: 120 };
  const target = { kind: EVENT_MARKER_TARGET, traceIndex: 2, pointIndex: 4 };
  const press = createPriorityChartPress(target, event, 1000);
  assert.equal(isPriorityChartPressValid(press, target, {
    clientX: 105,
    clientY: 120,
  }, { now: 1100 }), true);
  assert.equal(isPriorityChartPressValid(press, {
    ...target,
    pointIndex: 5,
  }, event, { now: 1100 }), false);

  let opened = "";
  assert.equal(openPriorityChartTarget({}, target, event, {
    openEventMarkerHit: () => { opened = "marker"; return true; },
    openAiForecastReportHit: () => { opened = "report"; return true; },
  }), true);
  assert.equal(opened, "marker");
});

test("chart target runtime owns and invalidates line hit indexes", () => {
  const element = {
    data: [{ meta: { seriesKey: "A" } }],
    _fullLayout: {
      xaxis: { _offset: 0, _length: 200 },
      yaxis: { _offset: 0, _length: 100 },
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  let builds = 0;
  const runtime = createChartTargetRuntime({
    getMainElement: () => element,
    getBaseTraceValues: () => ({}),
    axisPixelToXValue: () => "2026-08-25",
    toMilliseconds: Date.parse,
    adjustableSeriesKeys: () => ["A"],
    lineHitIndexMatches: (index) => Array.isArray(index),
    buildLineHitIndex: () => { builds += 1; return [{ traceIndex: 0 }]; },
    findNearestMarkerTarget: () => null,
    interactiveMarkerHitRadius: () => 16,
    findNearestLineTarget: () => ({ traceIndex: 0, seriesKey: "A" }),
  });

  assert.equal(runtime.findNearestLineDragTarget(element, 50, 50)?.seriesKey, "A");
  assert.equal(runtime.findNearestLineDragTarget(element, 60, 50)?.seriesKey, "A");
  assert.equal(builds, 1);
  runtime.invalidate(element, { markers: false });
  runtime.findNearestLineDragTarget(element, 70, 50);
  assert.equal(builds, 2);
});

test("shares one axis conversion across report and line hit tests in a pointer frame", () => {
  const element = {
    data: [{ meta: { seriesKey: "A" }, x: ["2026-08-25"], y: [10] }],
    _fullLayout: {
      xaxis: { _offset: 0, _length: 200 },
      yaxis: { _offset: 0, _length: 100 },
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  let axisConversions = 0;
  const runtime = createChartTargetRuntime({
    getMainElement: () => element,
    getBaseTraceValues: () => ({}),
    axisPixelToXValue: () => { axisConversions += 1; return "2026-08-25"; },
    toMilliseconds: Date.parse,
    adjustableSeriesKeys: () => ["A"],
    isAiReportTrace: () => false,
    findMarkerAtClientPoint: () => null,
    lineHitIndexMatches: () => false,
    buildLineHitIndex: () => [],
    findNearestMarkerTarget: () => null,
    interactiveMarkerHitRadius: () => 16,
    findNearestLineTarget: () => null,
  });
  const interactionContext = {};

  runtime.findAiForecastReportAtClientPoint(element, 50, 50, false, null, interactionContext);
  runtime.findNearestLineDragTarget(element, 50, 50, false, null, interactionContext);
  assert.equal(axisConversions, 1);
  assert.equal(interactionContext.chartPoint.xValue, "2026-08-25");
});

test("marker-only invalidation preserves reusable line indexes", () => {
  const element = {
    data: [{ meta: { seriesKey: "A" } }],
    _fullLayout: {
      xaxis: { _offset: 0, _length: 200 },
      yaxis: { _offset: 0, _length: 100 },
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  let builds = 0;
  let markerInvalidations = 0;
  const runtime = createChartTargetRuntime({
    getMainElement: () => element,
    getBaseTraceValues: () => ({}),
    axisPixelToXValue: () => "2026-08-25",
    toMilliseconds: Date.parse,
    adjustableSeriesKeys: () => ["A"],
    lineHitIndexMatches: (index) => Array.isArray(index),
    buildLineHitIndex: () => { builds += 1; return [{ traceIndex: 0 }]; },
    findNearestMarkerTarget: () => null,
    findNearestLineTarget: () => ({ traceIndex: 0, seriesKey: "A" }),
    invalidateMarkerPixels: () => { markerInvalidations += 1; },
  });

  runtime.findNearestLineDragTarget(element, 50, 50);
  runtime.invalidate(element, { lines: false, markers: true, reports: false });
  runtime.findNearestLineDragTarget(element, 60, 50);
  assert.equal(builds, 1);
  assert.equal(markerInvalidations, 1);
});

test("chart target runtime shares marker lookup and popover activation", () => {
  const trace = { x: ["2026-08-25"], y: [100], customdata: [{ title: "공시" }] };
  const element = {
    data: [trace],
    _fullLayout: { xaxis: {}, yaxis: {} },
  };
  let shown = null;
  const runtime = createChartTargetRuntime({
    getMainElement: () => element,
    findMarkerAtClientPoint: () => ({ traceIndex: 0, pointIndex: 0 }),
    isInteractiveEventMarkerTrace: () => true,
    buildEventMarkerPopoverGroup: (point) => ({ title: point.customdata.title }),
    showEventMarkerPopover: (group) => { shown = group; return true; },
  });
  const hit = runtime.findEventMarkerAtClientPoint(element, 10, 20);
  assert.equal(runtime.openEventMarkerHit(element, hit, {}), true);
  assert.deepEqual(shown, { title: "공시" });
});
