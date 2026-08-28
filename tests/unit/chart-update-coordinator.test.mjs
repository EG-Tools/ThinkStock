import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMainChartViewportPlan,
  buildMainChartRenderFrame,
  canReuseEventMarkerTraces,
  canReuseFutureOverlayTraces,
  createChartUpdateCoordinator,
  createMainChartRenderGuard,
  createMainChartRenderRuntime,
  createPlotlyUpdateRuntime,
  createReusableMainChartTracePlan,
  createSeriesFrameApplier,
  finalizeMainChartFrameState,
  hydrateMainChartSession,
  summarizeMainChartWorkload,
  shouldHydrateChartData,
  shouldUpdateAuxiliary,
} from "../../docs/modules/chart-update-coordinator.mjs";

test("summarizes real series separately from overlays and grouped hover helpers", () => {
  assert.deepEqual(summarizeMainChartWorkload([
    { x: [1, 2], meta: { overlayKind: "price", seriesKey: "A" } },
    { x: [1, 2], meta: { overlayKind: "price", seriesKey: "B" }, visible: "legendonly" },
    { x: [1], meta: { overlayKind: "eps", seriesKey: "eps:A" } },
    { x: [1, 2], meta: { overlayKind: "grouped-hover" } },
  ]), {
    traceCount: 4,
    seriesCount: 1,
    overlayCount: 2,
    pointCount: 7,
  });
});

test("main chart render runtime owns render mode selection and telemetry", async () => {
  const calls = [];
  const telemetry = [];
  const runtime = createMainChartRenderRuntime({}, {
    renderer: {
      canApplyPartialUpdate: () => true,
      canApplyEventMarkerUpdate: () => false,
      canReconcileTraceStructure: () => false,
      render: async (...args) => {
        calls.push(args);
        return { mode: "partial", updateScope: "lines" };
      },
    },
    updateRuntime: {
      run: async (label, task) => {
        assert.equal(label, "main-chart-partial-render");
        return task();
      },
    },
    telemetry: {
      begin: (detail) => { telemetry.push(["begin", detail]); return detail; },
      complete: (token, result) => telemetry.push(["complete", token, result]),
    },
    getPlotly: () => ({ id: "plotly" }),
    config: { responsive: true },
    render: async () => {},
  });
  const traces = [{ x: [1, 2], y: [2, 3], meta: { overlayKind: "price", seriesKey: "A" } }];
  const mode = await runtime.apply({ id: "chart" }, traces, { title: "main" }, {
    transactionId: 7,
    updateClasses: ["viewport"],
  });

  assert.equal(mode, "partial");
  assert.equal(calls.length, 1);
  assert.equal(telemetry[0][1].seriesCount, 1);
  assert.equal(telemetry[0][1].overlayCount, 0);
  assert.equal(telemetry[1][2].mode, "partial");
});


test("skips auxiliary rendering for main-only marker, transform, forecast, and viewport updates", () => {
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["markers"] }), false);
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["transform", "forecast"] }), false);
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["viewport"] }), false);
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["viewport-range"] }), true);
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["markers", "data"] }), true);
  assert.equal(shouldUpdateAuxiliary({}), true);
});

test("hydrates external chart data only for data and composition updates", () => {
  assert.equal(shouldHydrateChartData({ updateClasses: ["data"] }), true);
  assert.equal(shouldHydrateChartData({ updateClasses: ["composition"] }), true);
  assert.equal(shouldHydrateChartData({ updateClasses: ["viewport"] }), false);
  assert.equal(shouldHydrateChartData({ updateClasses: ["viewport-range"] }), false);
  assert.equal(shouldHydrateChartData({ updateClasses: ["markers", "transform"] }), false);
  assert.equal(shouldHydrateChartData({}), true);
});

test("reuses future overlays only for pure viewport and transform frames", () => {
  assert.equal(canReuseFutureOverlayTraces({ updateClasses: ["viewport"] }), true);
  assert.equal(canReuseFutureOverlayTraces({ updateClasses: ["viewport-range"] }), true);
  assert.equal(canReuseFutureOverlayTraces({ updateClasses: ["viewport", "transform"] }), true);
  assert.equal(canReuseFutureOverlayTraces({ updateClasses: ["forecast"] }), false);
  assert.equal(canReuseFutureOverlayTraces({ updateClasses: ["viewport", "composition"] }), false);
  assert.equal(canReuseFutureOverlayTraces({}), false);
});

test("reuses event markers only while the visible date window moves", () => {
  assert.equal(canReuseEventMarkerTraces({ updateClasses: ["viewport"] }), true);
  assert.equal(canReuseEventMarkerTraces({ updateClasses: ["viewport-range"] }), true);
  assert.equal(canReuseEventMarkerTraces({ updateClasses: ["viewport", "viewport-range"] }), true);
  assert.equal(canReuseEventMarkerTraces({ updateClasses: ["transform"] }), false);
  assert.equal(canReuseEventMarkerTraces({ updateClasses: ["markers"] }), false);
  assert.equal(canReuseEventMarkerTraces({}), false);
});

test("shares one render revision guard for viewport and AI invalidation", () => {
  let aiRevision = 2;
  let viewportRevision = 7;
  let queued = 0;
  const guard = createMainChartRenderGuard({
    getAiRevision: () => aiRevision,
    getViewportRevision: () => viewportRevision,
    requestViewportRender: () => { queued += 1; },
  });

  assert.equal(guard.shouldAbort({}), false);
  assert.equal(guard.queueCurrentViewportRender(), false);
  viewportRevision += 1;
  assert.equal(guard.shouldAbort({}), true);
  assert.equal(guard.queueCurrentViewportRender(), true);
  assert.equal(queued, 1);
  aiRevision += 1;
  assert.equal(guard.aiChanged(), true);
});

test("reuses EPS, AI, and event traces through one composition plan", () => {
  const descriptor = (trace) => ({ kind: trace.kind });
  const eps = { kind: "eps", meta: { seriesKey: "eps:A" } };
  const ai = { kind: "ai-scenario", meta: { seriesKey: "A" } };
  const event = { kind: "timing", event: true };
  const plan = createReusableMainChartTracePlan({ data: [eps, ai, event] }, {
    chartOverlayDescriptor: descriptor,
    isEventMarkerTrace: (trace) => trace.event === true,
  }, { updateClasses: ["viewport"] }, {
    baseValuesBySeries: { "eps:A": [1, 2] },
    hasPendingEvents: false,
    showEps: true,
  });

  assert.deepEqual(plan.aiForecastTraces, [ai]);
  assert.deepEqual(plan.epsTraceModel, {
    traces: [eps],
    baseValuesBySeries: { "eps:A": [1, 2] },
  });
  assert.deepEqual(plan.eventTraces, [event]);
});

test("price-first composition reuses only active passive overlays even with pending events", () => {
  const descriptor = (trace) => ({ kind: trace.kind, seriesKey: trace.meta?.seriesKey || "" });
  const groupedA = { kind: "grouped-hover", meta: { hoverGroupTicker: "A" } };
  const groupedB = { kind: "grouped-hover", meta: { hoverGroupTicker: "B" } };
  const epsA = { kind: "eps", meta: { seriesKey: "eps:A" } };
  const epsB = { kind: "eps", meta: { seriesKey: "eps:B" } };
  const aiA = { kind: "ai-scenario", meta: { seriesKey: "A" } };
  const event = { kind: "timing", event: true };
  const plan = createReusableMainChartTracePlan(
    { data: [groupedA, groupedB, epsA, epsB, aiA, event] },
    {
      chartOverlayDescriptor: descriptor,
      isEventMarkerTrace: (trace) => trace.event === true,
    },
    { updateClasses: ["composition"] },
    {
      activeSeries: ["A", "B"],
      deferOverlays: true,
      hasPendingEvents: true,
      hiddenSeries: new Set(["B"]),
      showEps: true,
    },
  );

  assert.deepEqual(plan.groupedHoverTraces, [groupedA]);
  assert.deepEqual(plan.epsTraces, [epsA]);
  assert.deepEqual(plan.aiForecastTraces, [aiA]);
  assert.deepEqual(plan.eventTraces, [event]);
  assert.equal(plan.reuseFutureOverlays, true);
  assert.equal(plan.reuseEventMarkers, true);
});

test("hydrates chart session state from one normalized model boundary", () => {
  const session = {};
  const model = {
    rows: [{ date: "2026-01-02" }, { date: "2026-01-05" }],
    allSeries: ["A", "B"],
    selected: ["A"],
  };
  const calls = [];
  hydrateMainChartSession(session, model, {
    frameStart: "2026-01-01",
    frameEnd: "2026-01-31",
    createSessionModel: (value) => ({ ...value, session: true }),
    captureLockedFrame: () => calls.push("capture"),
    syncSeries: (series) => calls.push(series),
  });

  assert.equal(session.currentMainChartModel.session, true);
  assert.equal(session.currentDataStart, "2026-01-02");
  assert.equal(session.currentDataEnd, "2026-01-05");
  assert.deepEqual(session.currentSelected, ["A"]);
  assert.deepEqual(calls, ["capture", ["A", "B"]]);
});

test("builds composition, viewport, and layout through one render frame boundary", async () => {
  const traces = [{ x: ["2026-01-02"], meta: { sourcePointCount: 1 } }];
  const viewportCalls = [];
  const frame = await buildMainChartRenderFrame({
    element: { data: [] },
    renderer: {
      chartOverlayDescriptor: () => ({ kind: "price" }),
      isEventMarkerTrace: () => false,
      buildMainChartComposition: async (options) => ({
        aiForecastTraces: [],
        baseValuesBySeries: { A: [10] },
        displayPointCount: 1,
        epsTraces: [],
        traces,
        received: options,
      }),
      buildLongRangeTicks: (options) => ({ options }),
      buildLayout: (options) => ({ options }),
    },
    model: { selected: ["A"] },
    invalidation: { updateClasses: ["data"] },
    baseValuesBySeries: { "eps:A": [1] },
    visibleLineDataRangeMs: () => [1, 2],
    shouldAbort: () => false,
    composition: {
      displayIndexes: [0],
      eventRevisions: { timing: 2, disclosure: 1 },
      hoverShowPopup: true,
    },
    viewport: {
      controller: {
        buildRenderViewportPlan: (options) => {
          viewportCalls.push(options);
          return {
            defaultXRange: ["2026-01-01", "2026-01-31"],
            forecastEnd: "2026-01-31",
            savedXRange: ["2026-01-01", "2026-01-31"],
            savedYRange: null,
          };
        },
      },
      observedStart: "2026-01-01",
      observedEnd: "2026-01-31",
      showAiForecast: false,
      showEps: false,
      futurePlanState: {},
      fitRangeForTraces: () => [0, 20],
      toMilliseconds: Date.parse,
      dayMs: 86400000,
      horizontalMargin: 40,
      cursorLineMode: "vertical",
      hoverlabel: { font: { size: 12 } },
    },
  });

  assert.deepEqual(frame.viewportPlan.savedYRange, null);
  assert.deepEqual(frame.layout.options.fittedYRange, [0, 20]);
  assert.deepEqual(viewportCalls[0].nextVisibleDataRange, [1, 2]);
  assert.equal(frame.received.eventRevisionKey, "disclosure,1|timing,2");
});

test("commits viewport and delayed overlay state through one render boundary", () => {
  const session = { autoChartReset: true };
  const applied = [];
  const viewportPlan = {
    pinnedXRange: ["2026-01-01", "2026-06-30"],
    savedXRange: ["2026-01-01", "2026-06-30"],
    userViewportPinned: true,
    pendingCompositionViewport: null,
  };
  applyMainChartViewportPlan(session, viewportPlan, (plan) => applied.push(plan));
  const result = finalizeMainChartFrameState(session, {
    viewportPlan,
    aiForecastTraces: [{ y: [120] }],
    epsTraces: [{ y: [130] }],
  }, {
    renderedRange: [Date.parse("2026-01-01"), Date.parse("2026-06-30")],
    xRange: ["2026-01-01", "2026-06-30"],
    yRange: [80, 110],
    tracesExceedVisibleYRange: () => true,
  });

  assert.deepEqual(applied, [viewportPlan]);
  assert.equal(session.currentStart, "2026-01-01");
  assert.equal(session.currentEnd, "2026-06-30");
  assert.equal(session.pendingAutoChartFit, true);
  assert.equal(session.pendingAutoChartFitExpandOnly, false);
  assert.deepEqual(result.mainRange, ["2026-01-01", "2026-06-30"]);
  assert.equal(result.delayedScaleTraceCount, 2);
  assert.equal(result.needsDelayedFit, true);
});

test("composition updates prepare state once with the request policy before rendering", () => {
  const calls = [];
  const coordinator = createChartUpdateCoordinator({}, {
    requestFrame: () => 1,
    requestRender: (preserveZoom, options) => calls.push(["render", preserveZoom, options.reason, options.updateClass]),
    prepareComposition: (forceFit, options) => calls.push([
      "prepare",
      forceFit,
      options.preserveFutureOverlayViewport,
    ]),
    applyResetPolicy: (change) => calls.push(["reset", change]),
    persistState: () => calls.push(["persist"]),
  });

  coordinator.requestComposition({
    forceFitFull: true,
    preserveFutureOverlayViewport: true,
  });
  assert.deepEqual(calls, [
    ["prepare", true, true],
    ["reset", "composition"],
    ["persist"],
    ["render", true, "composition", "composition"],
  ]);
});

test("event revisions coalesce and retry after an active render settles", () => {
  const frames = [];
  const renders = [];
  let rendering = true;
  const coordinator = createChartUpdateCoordinator({}, {
    eventLayers: ["disclosure", "insider"],
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    isEventLayerEnabled: () => true,
    isRendering: () => rendering,
    requestRender: (...args) => renders.push(args),
  });

  coordinator.queueEvent("disclosure");
  coordinator.queueEvent("disclosure");
  assert.equal(frames.length, 1);
  assert.deepEqual(coordinator.eventRevisions(), { disclosure: 2, insider: 0 });
  frames.shift()();
  assert.equal(renders.length, 0);
  assert.equal(coordinator.hasPendingEvents(), true);

  rendering = false;
  coordinator.flush();
  frames.shift()();
  assert.equal(renders.length, 1);
  const revisions = coordinator.eventRevisions();
  coordinator.markEventsApplied(revisions);
  assert.equal(coordinator.hasPendingEvents(), false);
});

test("event data uses a marker-only visual frame when the trace structure is stable", () => {
  const frames = [];
  const fullRenders = [];
  const callbacks = [];
  const coordinator = createChartUpdateCoordinator({}, {
    eventLayers: ["disclosure"],
    requestFrame: (callback) => { callbacks.push(callback); return callbacks.length; },
    cancelFrame: () => {},
    isEventLayerEnabled: () => true,
    isRendering: () => false,
    requestMarkerFrame: (options) => frames.push(options),
    requestRender: (...args) => fullRenders.push(args),
  });

  coordinator.queueEvent("disclosure");
  callbacks.shift()();

  assert.deepEqual(frames, [{ reason: "event-marker-data", updateClass: "markers" }]);
  assert.deepEqual(fullRenders, []);
});

test("marker-only visual frames preserve line and report hit caches", async () => {
  const element = { data: [{ x: [1], y: [1] }] };
  const invalidations = [];
  const applyFrame = createSeriesFrameApplier({
    getElement: () => element,
    restyle: async () => {},
    hasEventModel: () => true,
    appendEventUpdates: (_element, indexes, values) => {
      indexes.push(0);
      values.push([2]);
      return { structureChanged: false, disclosureUpdated: false };
    },
    invalidateInteractionCaches: (_element, options) => invalidations.push(options),
  });

  await applyFrame({ markers: true, series: [] });
  assert.deepEqual(invalidations, [{
    lines: false,
    markers: true,
    reports: false,
  }]);
});

test("shares one axis geometry snapshot across all handle updates in a visual frame", async () => {
  const element = { data: [{ y: [1] }, { y: [2] }] };
  const geometry = { xa: { range: [0, 1] }, ya: { range: [0, 2] } };
  const received = [];
  let geometryReads = 0;
  const applyFrame = createSeriesFrameApplier({
    getElement: () => element,
    restyle: async () => {},
    resolveTraceIndex: (_element, seriesKey) => (seriesKey === "first" ? 0 : 1),
    computeValues: (seriesKey) => (seriesKey === "first" ? [3] : [4]),
    readGeometry: () => {
      geometryReads += 1;
      return geometry;
    },
    positionHandles: (_element, seriesKey, _values, frameGeometry) => {
      received.push([seriesKey, frameGeometry]);
    },
  });

  await applyFrame({
    handles: true,
    series: [{ seriesKey: "first" }, { seriesKey: "second" }],
  });

  assert.equal(geometryReads, 1);
  assert.deepEqual(received, [["first", geometry], ["second", geometry]]);
});

test("plotly update runtime shares one busy lifecycle across batched chart updates", async () => {
  const calls = [];
  const busy = [];
  const runtime = createPlotlyUpdateRuntime({
    Plotly: {
      relayout: async (element, payload) => calls.push(["relayout", element.id, payload]),
      restyle: async (element, data, indexes) => calls.push(["restyle", element.id, data, indexes]),
      update: async (element, data, layout, indexes) => calls.push([
        "update", element.id, data, layout, indexes,
      ]),
    },
  }, {
    onBusyChange: (value) => busy.push(value),
  });
  const first = { id: "chart", data: [{}] };
  const second = { id: "chart-macd", data: [{}] };

  await runtime.relayoutMany([
    { element: first, payload: { "xaxis.range[0]": "2026-01-01" } },
    { element: second, payload: { "xaxis.range[0]": "2026-01-01" } },
  ]);
  await runtime.update(first, { y: [[1, 2]] }, { "yaxis.autorange": false }, [0]);
  await runtime.restyle(first, { y: [[2, 3]] }, [0]);

  assert.deepEqual(busy, [true, false, true, false, true, false]);
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [
    ["relayout", "chart"],
    ["relayout", "chart-macd"],
    ["update", "chart"],
    ["restyle", "chart"],
  ]);
  assert.deepEqual(runtime.stats(), {
    relayoutCalls: 2,
    restyleCalls: 1,
    updateCalls: 1,
    failedCalls: 0,
    activeOperations: 0,
  });
});

test("plotly update runtime settles optional relayout failures without leaking busy state", async () => {
  const errors = [];
  const busy = [];
  const runtime = createPlotlyUpdateRuntime({
    Plotly: {
      relayout: async (element) => {
        if (element.id === "bad") throw new Error("detached");
        return true;
      },
    },
  }, {
    onBusyChange: (value) => busy.push(value),
    onError: (error, label) => errors.push([error.message, label]),
  });

  const results = await runtime.relayoutMany([
    { element: { id: "ok", data: [{}] }, payload: { x: 1 } },
    { element: { id: "bad", data: [{}] }, payload: { x: 2 } },
  ], { label: "viewport", settle: true });

  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  assert.deepEqual(errors, [["detached", "viewport"]]);
  assert.deepEqual(busy, [true, false]);
  assert.equal(runtime.isBusy(), false);
});
