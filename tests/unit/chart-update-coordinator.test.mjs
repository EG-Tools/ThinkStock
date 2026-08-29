import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMainChartViewportPlan,
  buildMainChartRenderFrame,
  canReuseEventMarkerTraces,
  canReuseFutureOverlayTraces,
  createChartUpdateCoordinator,
  createChartRenderFacade,
  createMainChartRenderGuard,
  createMainChartRenderRuntime,
  createPlotlyUpdateRuntime,
  createReusableMainChartTracePlan,
  createSeriesFrameApplier,
  finalizeMainChartFrameState,
  fitMainChartToViewport,
  hydrateMainChartSession,
  normalizeChartInvalidation,
  shouldHydrateChartData,
  shouldUpdateAuxiliary,
} from "../../docs/modules/chart-update-coordinator.mjs";

test("fits the main chart and marker layer in one coordinated update", async () => {
  const calls = [];
  const price = { x: ["2026-01-01"], y: [100], meta: { seriesKey: "005930.KS" } };
  const marker = { x: ["2026-01-01"], y: [105], meta: { overlayKind: "signal" } };
  const element = {
    data: [price, marker],
    _fullLayout: { yaxis: { range: [90, 110] } },
  };
  const result = await fitMainChartToViewport({
    element,
    renderer: {
      rangeBearingTraces: (traces) => traces.filter((trace) => trace === price),
    },
    updateRuntime: {
      update: async (...args) => calls.push(["update", ...args]),
      relayout: async (...args) => calls.push(["relayout", ...args]),
    },
    xRange: ["2026-01-01", "2026-01-02"],
    fitRangeForTraces: (traces) => {
      assert.deepEqual(traces, [price]);
      return [95, 105];
    },
    hasEventMarkers: true,
    appendEventMarkerYUpdates: (_element, indexes, updates) => {
      indexes.push(1);
      updates.push([104]);
      return { structureChanged: false, disclosureUpdated: true };
    },
  });

  assert.equal(result.mode, "update");
  assert.deepEqual(result.yRange, [95, 105]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "update");
  assert.deepEqual(calls[0][2], { y: [[104]] });
  assert.deepEqual(calls[0][3], {
    "yaxis.range[0]": 95,
    "yaxis.range[1]": 105,
    "yaxis.autorange": false,
  });
  assert.deepEqual(calls[0][4], [1]);
});

test("normalizes every chart layer decision once per render transaction", () => {
  const invalidation = normalizeChartInvalidation({
    reasons: ["drag", "markers"],
    updateClasses: ["viewport", "viewport", "markers"],
  });

  assert.deepEqual(invalidation.updateClasses, ["viewport", "markers"]);
  assert.deepEqual(invalidation.plan, {
    normalized: true,
    updateAuxiliary: false,
    hydrateData: false,
    reuseFutureOverlays: false,
    reuseEventMarkers: false,
  });
  assert.equal(normalizeChartInvalidation(invalidation), invalidation);
  assert.equal(Object.isFrozen(invalidation.updateClasses), true);
  assert.equal(Object.isFrozen(invalidation.plan), true);
});

test("routes every app chart request through one render facade", () => {
  const calls = [];
  const facade = createChartRenderFacade({
    getCoordinator: () => ({
      requestRender: (...args) => calls.push(["render", ...args]),
      requestComposition: (options) => calls.push(["composition", options]),
    }),
    getScheduler: () => ({
      run: (preserveZoom) => calls.push(["run", preserveZoom]),
      runWhenIdleOrNow: (preserveZoom) => calls.push(["idle", preserveZoom]),
    }),
    getState: () => ({ showAiForecast: true, showEps: false }),
    getAiApp: () => ({ requestRender: (render) => { calls.push(["ai-hold"]); render(); } }),
  });

  facade.requestComposition({ reason: "toggle" });
  facade.requestFutureOverlayComposition();
  facade.requestAiForecast();
  facade.run(false);
  facade.runWhenIdleOrNow(true);

  assert.equal(calls[0][1].preserveFutureOverlayViewport, true);
  assert.equal(calls[1][1].reason, "future-overlay-composition");
  assert.deepEqual(calls[2], ["ai-hold"]);
  assert.equal(calls[3][2].updateClass, "forecast");
  assert.deepEqual(calls.slice(-2), [["run", false], ["idle", true]]);
});

test("main chart render runtime owns render mode selection and telemetry", async () => {
  const calls = [];
  const telemetry = [];
  const runtime = createMainChartRenderRuntime({}, {
    renderer: {
      render: async (...args) => {
        calls.push(args);
        return { mode: "partial", updateScope: "lines" };
      },
    },
    updateRuntime: {
      run: async (label, task) => {
        assert.equal(label, "main-chart-render");
        return task();
      },
    },
    telemetry: {
      begin: (detail, workloadTraces) => {
        telemetry.push(["begin", detail, workloadTraces]);
        return detail;
      },
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
  assert.equal(telemetry[0][2], traces);
  assert.equal(telemetry[1][2].mode, "partial");
});

test("main chart render runtime leaves deferred telemetry inert until loaded", async () => {
  const telemetry = [];
  const runtime = createMainChartRenderRuntime({}, {
    renderer: {
      render: async () => ({ mode: "partial", updateScope: "lines" }),
    },
    updateRuntime: {
      run: async (_label, task) => task(),
    },
    telemetry: {
      isLoaded: () => false,
      begin: (detail) => { telemetry.push(["begin", detail]); return detail; },
      complete: (token, result) => telemetry.push(["complete", token, result]),
    },
    render: async () => {},
  });

  const mode = await runtime.apply({}, [{
    x: [1, 2],
    y: [2, 3],
    meta: { overlayKind: "price", seriesKey: "A" },
  }], {}, { updateClasses: ["viewport"] });

  assert.equal(mode, "partial");
  assert.deepEqual(telemetry, []);
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
  let viewportSignature = "100:200";
  let captured = 0;
  let queued = 0;
  const guard = createMainChartRenderGuard({
    getAiRevision: () => aiRevision,
    getViewportRevision: () => viewportRevision,
    getViewportSignature: () => viewportSignature,
    onViewportChanged: () => { captured += 1; },
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
  viewportRevision = 7;
  viewportSignature = "120:220";
  assert.equal(guard.queueCurrentViewportRender(), true);
  assert.equal(captured, 2);
  assert.equal(queued, 2);
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
    coalescedRelayoutCalls: 0,
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

test("plotly update runtime reuses an identical relayout already in flight", async () => {
  let release;
  let calls = 0;
  const runtime = createPlotlyUpdateRuntime({
    Plotly: {
      relayout: () => {
        calls += 1;
        return new Promise((resolve) => { release = resolve; });
      },
    },
  });
  const element = { id: "chart", data: [{}] };
  const payload = { "xaxis.range[0]": "2026-01-01", "xaxis.range[1]": "2026-02-01" };

  const first = runtime.relayout(element, payload);
  const second = runtime.relayout(element, { ...payload });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(runtime.stats().coalescedRelayoutCalls, 1);
  release(true);
  await Promise.all([first, second]);
  assert.equal(runtime.isBusy(), false);
});
