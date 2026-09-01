import assert from "node:assert/strict";
import test from "node:test";

import * as viewport from "../../docs/modules/chart-viewport-controller.mjs";

test("centered zoom changes the visible span by ten percent without moving its center", () => {
  assert.deepEqual(viewport.centeredZoomRange([20, 80], [0, 100], -1, { ratio: 0.1 }), [23, 77]);
  assert.deepEqual(viewport.centeredZoomRange([20, 80], [0, 100], 1, { ratio: 0.1 }), [17, 83]);
});

test("centered zoom can move both visible edges by twenty percent", () => {
  assert.deepEqual(viewport.centeredZoomRange([20, 80], [0, 100], -1, { ratio: 0.2 }), [26, 74]);
  assert.deepEqual(viewport.centeredZoomRange([20, 80], [0, 100], 1, { ratio: 0.2 }), [14, 86]);
});

test("centered zoom stays inside the observed data range", () => {
  assert.deepEqual(viewport.centeredZoomRange([0, 50], [0, 100], 1, { ratio: 0.1 }), [0, 55]);
  assert.deepEqual(viewport.centeredZoomRange([50, 100], [0, 100], 1, { ratio: 0.1 }), [45, 100]);
});

test("wheel-style zoom keeps the pointer date anchored without adding edge margins", () => {
  assert.deepEqual(
    viewport.centeredZoomRange([20, 80], [0, 100], -1, { ratio: 0.2, anchorRatio: 0.25 }),
    [23, 71],
  );
  assert.deepEqual(
    viewport.centeredZoomRange([0, 50], [0, 100], 1, { ratio: 0.2, anchorRatio: 0 }),
    [0, 60],
  );
  assert.deepEqual(
    viewport.centeredZoomRange([50, 100], [0, 100], 1, { ratio: 0.2, anchorRatio: 1 }),
    [40, 100],
  );
});

test("latest viewport zoom anchors to the right edge while historical zoom keeps its pointer", () => {
  assert.equal(viewport.resolveZoomAnchorRatio([40, 100], [0, 100], 0.2), 1);
  assert.equal(viewport.resolveZoomAnchorRatio([40, 98], [0, 100], 0.2, { tolerance: 2 }), 1);
  assert.equal(viewport.resolveZoomAnchorRatio([20, 80], [0, 100], 0.2, { tolerance: 2 }), 0.2);
  assert.equal(viewport.resolveZoomAnchorRatio([20, 80], [0, 100], -1), 0);
  assert.equal(viewport.resolveZoomAnchorRatio([20, 80], [0, 100], 2), 1);
});

test("pinch zoom keeps its anchor date fixed and clamps to loaded data", () => {
  assert.deepEqual(
    viewport.pinchZoomRange([20, 80], [0, 100], 100, 200, 0.25),
    [27.5, 57.5],
  );
  assert.deepEqual(
    viewport.pinchZoomRange([20, 80], [0, 100], 100, 50, 0.5),
    [0, 100],
  );
});

test("wheel zoom steps periods only at the past boundary or inside the smaller preset", () => {
  assert.equal(viewport.shouldStepRangeForWheel([2, 100], [0, 100], 1, 6, 12), true);
  assert.equal(viewport.shouldStepRangeForWheel([40, 100], [0, 100], 1, 6, 12), false);
  assert.equal(viewport.shouldStepRangeForWheel([30, 70], [0, 100], -1, 12, 6), true);
  assert.equal(viewport.shouldStepRangeForWheel([20, 80], [0, 100], -1, 12, 6), false);
});

test("wheel range clamps empty margins while preserving the longest visible series range", () => {
  assert.deepEqual(viewport.clampRangeToData([-10, 90], [0, 100]), [0, 100]);
  assert.deepEqual(viewport.clampRangeToData([20, 120], [0, 100]), [0, 100]);
  assert.deepEqual(viewport.clampRangeToData([40, 120], [0, 100]), [20, 100]);
  assert.deepEqual(
    viewport.clampRangeToData([-20, 80], [0, 100], { clampStart: false }),
    [-20, 80],
  );

  const cache = viewport.createDataRangeCache({ toMilliseconds: Number });
  const chart = {
    data: [
      { x: [10, 20] },
      { x: [0, 20] },
    ],
  };
  assert.deepEqual(cache.get(chart), [0, 20]);
});

test("data range cache keeps full history metadata behind a viewport slice", () => {
  const cache = viewport.createDataRangeCache({
    toMilliseconds: Number,
    shouldInclude: (trace) => trace.visible !== "legendonly",
  });
  const chart = {
    data: [
      {
        x: [80, 90],
        meta: { fullDataStartMs: 0, fullDataEndMs: 100 },
      },
      {
        x: [30, 40],
        visible: "legendonly",
        meta: { fullDataStartMs: -100, fullDataEndMs: 200 },
      },
    ],
  };

  assert.deepEqual(cache.get(chart), [0, 100]);
});

test("blank-area pan preserves the visible span and stops at both data edges", () => {
  assert.deepEqual(viewport.panRange([20, 60], [0, 100], 10), [30, 70]);
  assert.deepEqual(viewport.panRange([20, 60], [0, 100], -50), [0, 40]);
  assert.deepEqual(viewport.panRange([20, 60], [0, 100], 80), [60, 100]);
  assert.deepEqual(viewport.panRange([0, 100], [0, 100], 20), [0, 100]);
});

test("latest range preserves the visible span and lands on the newest date", () => {
  assert.deepEqual(viewport.latestRange([20, 50], [0, 100]), [70, 100]);
  assert.deepEqual(viewport.latestRange([-20, 120], [0, 100]), [0, 100]);
  assert.equal(viewport.latestRange([20, 20], [0, 100]), null);
});

test("composition range follows the longest remaining series only from a full-lifetime view", () => {
  assert.deepEqual(
    viewport.reconcileCompositionRange([0, 200], [0, 200], [100, 200]),
    [100, 200],
  );
  assert.deepEqual(
    viewport.reconcileCompositionRange([150, 180], [0, 200], [100, 200]),
    [150, 180],
  );
  assert.deepEqual(
    viewport.reconcileCompositionRange([20, 80], [0, 200], [100, 200]),
    [100, 160],
  );
});

test("composition range follows a newly added fresher series only when the viewport was at latest", () => {
  assert.deepEqual(
    viewport.reconcileCompositionRange([140, 200], [0, 200], [0, 203], { latestTolerance: 3 }),
    [143, 203],
  );
  assert.deepEqual(
    viewport.reconcileCompositionRange([130, 196], [0, 200], [0, 203], { latestTolerance: 3 }),
    [130, 196],
  );
});

test("render viewport plan moves a stale latest edge to a fresher added series", () => {
  const previousEnd = Date.parse("2026-08-07");
  const nextEnd = Date.parse("2026-08-10");
  const viewStart = Date.parse("2026-02-07");
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    pendingCompositionViewport: {
      viewRange: [viewStart, previousEnd],
      dataRange: [Date.parse("2020-01-01"), previousEnd],
      forceFitFull: false,
    },
    nextVisibleDataRange: [Date.parse("2020-01-01"), nextEnd],
    compositionLatestTolerance: 3 * 24 * 60 * 60 * 1000,
    observedStart: "2020-01-01",
    observedEnd: "2026-08-10",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date(viewStart + (nextEnd - previousEnd)).toISOString(),
    new Date(nextEnd).toISOString(),
  ]);
});

test("a newer visible range discards an older composition snapshot", () => {
  const currentRange = [Date.parse("2026-02-11"), Date.parse("2026-04-12")];
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: currentRange.map((value) => new Date(value).toISOString()),
    pinnedXRange: currentRange.map((value) => new Date(value).toISOString()),
    pendingCompositionViewport: {
      viewRange: [Date.parse("2025-10-13"), Date.parse("2026-04-12")],
      dataRange: [Date.parse("2020-01-01"), Date.parse("2026-04-12")],
    },
    nextVisibleDataRange: [Date.parse("2020-01-01"), Date.parse("2026-07-14")],
    observedStart: "2020-01-01",
    observedEnd: "2026-07-14",
  });

  assert.deepEqual(plan.savedXRange, currentRange.map((value) => new Date(value).toISOString()));
  assert.equal(plan.pendingCompositionViewport, null);
});

test("render viewport plan preserves a manually pinned viewport and current y range", () => {
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    pinnedXRange: ["2026-02-01", "2026-05-01"],
    userViewportPinned: true,
    currentXRange: ["2026-01-01", "2026-06-01"],
    currentYRange: [-12, 18],
    lockedYRange: [-20, 20],
    observedStart: "2026-01-01",
    observedEnd: "2026-08-01",
  });

  assert.deepEqual(plan.savedXRange, ["2026-02-01", "2026-05-01"]);
  assert.deepEqual(plan.pinnedXRange, ["2026-02-01", "2026-05-01"]);
  assert.deepEqual(plan.savedYRange, [-12, 18]);
  assert.equal(plan.userViewportPinned, true);
});

test("render viewport plan reconciles a full-range composition change", () => {
  const priorStart = Date.parse("2010-01-01");
  const nextStart = Date.parse("2020-01-01");
  const end = Date.parse("2026-08-01");
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    pendingCompositionViewport: {
      viewRange: [priorStart, end],
      dataRange: [priorStart, end],
      forceFitFull: false,
    },
    nextVisibleDataRange: [nextStart, end],
    observedStart: "2020-01-01",
    observedEnd: "2026-08-01",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date(nextStart).toISOString(),
    new Date(end).toISOString(),
  ]);
  assert.equal(plan.pendingCompositionViewport, null);
});

test("an explicit viewport reset discards an older composition snapshot", () => {
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: false,
    autoChartReset: true,
    pendingCompositionViewport: {
      viewRange: [Date.parse("2025-08-01"), Date.parse("2026-08-01")],
      dataRange: [Date.parse("2020-01-01"), Date.parse("2026-08-01")],
      forceFitFull: false,
    },
    nextVisibleDataRange: [Date.parse("2020-01-01"), Date.parse("2026-08-01")],
    currentXRange: ["2025-08-01", "2026-08-01"],
    observedStart: "2026-05-01",
    observedEnd: "2026-08-01",
  });

  assert.equal(plan.savedXRange, null);
  assert.equal(plan.pinnedXRange, null);
  assert.equal(plan.pendingCompositionViewport, null);
  assert.deepEqual(plan.defaultXRange, ["2026-05-01", "2026-08-01"]);
});

test("render viewport plan reveals the forecast once and extends only to its last date", () => {
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: false,
    autoChartReset: true,
    showAiForecast: true,
    aiForecastTraces: [
      { x: ["2026-08-01", "2027-02-01"] },
      { x: ["2026-08-01", "2026-12-01"] },
    ],
    revealAiForecastRange: true,
    observedStart: "2026-02-01",
    observedEnd: "2026-08-01",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date("2026-02-01").toISOString(),
    new Date("2027-02-01").toISOString(),
  ]);
  assert.deepEqual(plan.defaultXRange, ["2026-02-01", "2027-02-01"]);
  assert.equal(plan.revealAiForecastRange, false);
});

test("AI reveal keeps the current one-year history and appends six forecast months", () => {
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2025-08-24", "2026-08-24"],
    showAiForecast: true,
    aiForecastTraces: [{ x: ["2026-08-24", "2027-02-24"] }],
    futureTraces: [{ x: ["2026-08-24", "2027-02-24"] }],
    revealAiForecastRange: true,
    observedStart: "2016-08-24",
    observedEnd: "2026-08-24",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date("2025-08-24").toISOString(),
    new Date("2027-02-24").toISOString(),
  ]);
  assert.equal(plan.revealAiForecastRange, false);
});

test("render viewport plan adds the configured empty days after observed and forecast lines", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const observed = viewport.buildRenderViewportPlan({
    preserveZoom: false,
    observedStart: "2026-02-01",
    observedEnd: "2026-08-01",
    rightPaddingMs: 30 * dayMs,
  });
  assert.deepEqual(observed.defaultXRange, [
    "2026-02-01",
    new Date(Date.parse("2026-08-01") + (30 * dayMs)).toISOString(),
  ]);

  const forecast = viewport.buildRenderViewportPlan({
    preserveZoom: false,
    showAiForecast: true,
    aiForecastTraces: [{ x: ["2026-08-01", "2027-02-01"] }],
    observedStart: "2026-02-01",
    observedEnd: "2026-08-01",
    rightPaddingMs: 10 * dayMs,
  });
  assert.equal(
    forecast.defaultXRange[1],
    new Date(Date.parse("2027-02-01") + (10 * dayMs)).toISOString(),
  );
});

test("render viewport plan includes future EPS without pretending AI is enabled", () => {
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: false,
    showAiForecast: false,
    aiForecastTraces: [],
    futureTraces: [{ x: ["2026-06-30", "2027-12-31"], meta: { isEpsTrace: true } }],
    observedStart: "2026-02-01",
    observedEnd: "2026-08-24",
  });

  assert.deepEqual(plan.defaultXRange, ["2026-02-01", "2027-12-31"]);
  assert.equal(plan.revealAiForecastRange, false);
});

test("EPS reveal keeps one history year and appends its full three-year outlook", () => {
  const epsTrace = {
    x: ["2026-06-30", "2029-08-24"],
    meta: { isEpsTrace: true },
  };
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2025-08-24", "2026-08-24"],
    showAiForecast: false,
    showEps: true,
    aiForecastTraces: [],
    epsForecastTraces: [epsTrace],
    futureTraces: [epsTrace],
    revealEpsForecastRange: true,
    observedStart: "2016-08-24",
    observedEnd: "2026-08-24",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date("2025-08-24").toISOString(),
    new Date("2029-08-24").toISOString(),
  ]);
  assert.equal(plan.revealEpsForecastRange, false);
});

test("future overlays never extend a historical viewport", () => {
  const epsTrace = {
    x: ["2026-06-30", "2029-08-24"],
    meta: { isEpsTrace: true },
  };
  const aiTrace = { x: ["2026-08-24", "2027-02-24"] };
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2021-01-01", "2022-01-01"],
    showAiForecast: true,
    showEps: true,
    aiForecastTraces: [aiTrace],
    epsForecastTraces: [epsTrace],
    futureTraces: [aiTrace, epsTrace],
    revealAiForecastRange: true,
    revealEpsForecastRange: true,
    futureRevealLatestToleranceMs: 3 * 24 * 60 * 60 * 1000,
    observedStart: "2016-08-24",
    observedEnd: "2026-08-24",
  });

  assert.deepEqual(plan.savedXRange, ["2021-01-01", "2022-01-01"]);
  assert.equal(plan.revealAiForecastRange, false);
  assert.equal(plan.revealEpsForecastRange, false);
});

test("disabling EPS restores the shared future-overlay entry viewport", () => {
  const visibleRange = [Date.parse("2016-01-01"), Date.parse("2026-08-24")];
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2025-08-24", "2029-08-24"],
    nextVisibleDataRange: visibleRange,
    restoreFutureOverlayViewport: {
      range: [Date.parse("2025-08-24"), Date.parse("2026-08-24")],
      userViewportPinned: true,
    },
    showAiForecast: false,
    showEps: false,
    trimFutureOverlayRange: true,
    observedStart: "2016-01-01",
    observedEnd: "2026-08-24",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date("2025-08-24").toISOString(),
    new Date("2026-08-24").toISOString(),
  ]);
  assert.equal(plan.restoreFutureOverlayViewport, null);
  assert.equal(plan.trimFutureOverlayRange, false);
  assert.equal(plan.userViewportPinned, true);
});

test("disabling AI keeps the farther EPS outlook visible", () => {
  const epsTrace = {
    x: ["2026-06-30", "2029-08-24"],
    meta: { isEpsTrace: true },
  };
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2026-02-24", "2029-08-24"],
    showAiForecast: false,
    aiForecastTraces: [],
    epsForecastTraces: [epsTrace],
    futureTraces: [epsTrace],
    trimAiForecastRange: true,
    observedStart: "2016-08-24",
    observedEnd: "2026-08-24",
  });

  assert.deepEqual(plan.savedXRange, ["2026-02-24", "2029-08-24"]);
  assert.equal(plan.trimAiForecastRange, false);
});

test("enabling EPS while AI is visible preserves history and extends only the future end", () => {
  const aiTrace = { x: ["2026-08-24", "2027-02-24"] };
  const epsTrace = {
    x: ["2026-06-30", "2029-08-24"],
    meta: { isEpsTrace: true },
  };
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2025-08-24", "2027-02-24"],
    showAiForecast: true,
    showEps: true,
    aiForecastTraces: [aiTrace],
    epsForecastTraces: [epsTrace],
    futureTraces: [aiTrace, epsTrace],
    revealEpsForecastRange: true,
    observedStart: "2016-08-24",
    observedEnd: "2026-08-24",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date("2025-08-24").toISOString(),
    new Date("2029-08-24").toISOString(),
  ]);
  assert.equal(plan.revealEpsForecastRange, false);
});

test("disabling EPS while AI remains preserves history and trims to the AI end", () => {
  const aiTrace = { x: ["2026-08-24", "2027-02-24"] };
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2025-08-24", "2029-08-24"],
    showAiForecast: true,
    showEps: false,
    aiForecastTraces: [aiTrace],
    epsForecastTraces: [],
    futureTraces: [aiTrace],
    trimFutureOverlayRange: true,
    observedStart: "2016-08-24",
    observedEnd: "2026-08-24",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date("2025-08-24").toISOString(),
    new Date("2027-02-24").toISOString(),
  ]);
  assert.equal(plan.trimFutureOverlayRange, false);
});

test("render viewport plan restores the entry viewport after AI is disabled", () => {
  const visibleRange = [Date.parse("2026-01-01"), Date.parse("2026-08-01")];
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2026-02-01", "2027-02-01"],
    nextVisibleDataRange: visibleRange,
    restoreAiForecastViewport: {
      range: [Date.parse("2026-03-01"), Date.parse("2026-07-01")],
      userViewportPinned: true,
    },
    showAiForecast: false,
    trimAiForecastRange: true,
    observedStart: "2026-01-01",
    observedEnd: "2026-08-01",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date("2026-03-01").toISOString(),
    new Date("2026-07-01").toISOString(),
  ]);
  assert.equal(plan.restoreAiForecastViewport, null);
  assert.equal(plan.trimAiForecastRange, false);
  assert.equal(plan.userViewportPinned, true);
});

test("render viewport plan trims an orphaned forecast range to observed data", () => {
  const plan = viewport.buildRenderViewportPlan({
    preserveZoom: true,
    autoChartReset: true,
    currentXRange: ["2026-03-01", "2027-02-01"],
    showAiForecast: false,
    trimAiForecastRange: true,
    observedStart: "2026-02-01",
    observedEnd: "2026-08-01",
  });

  assert.deepEqual(plan.savedXRange, [
    new Date("2026-03-01").toISOString(),
    new Date("2026-08-01").toISOString(),
  ]);
  assert.equal(plan.trimAiForecastRange, false);
});

test("centered zoom stops at the configured minimum span", () => {
  assert.equal(
    viewport.centeredZoomRange([20, 40], [0, 100], -1, { ratio: 0.2, minimumSpan: 20 }),
    null,
  );
  assert.deepEqual(
    viewport.centeredZoomRange([20, 45], [0, 100], -1, { ratio: 0.2, minimumSpan: 20 }),
    [22.5, 42.5],
  );
});

test("drag zoom session keeps one exact undo range while later zooms stay centered", () => {
  const session = viewport.createZoomSession();
  assert.equal(session.isActive(), false);
  assert.equal(session.zoom([20, 80], [0, 100], -1), null);
  assert.equal(session.commit([0, 100]), true);
  assert.equal(session.isActive(), true);
  assert.deepEqual(session.zoom([20, 80], [0, 100], -1, { ratio: 0.1 }), [23, 77]);
  assert.deepEqual(session.zoom([23, 77], [0, 100], 1, { ratio: 0.1 }), [20.299999999999997, 79.7]);
  assert.deepEqual(session.restore(), [0, 100]);
  assert.equal(session.restore(), null);
  assert.equal(session.isActive(), false);
});

test("data range cache ignores marker traces and invalidates when endpoints change", () => {
  let conversions = 0;
  const cache = viewport.createDataRangeCache({
    toMilliseconds: (value) => {
      conversions += 1;
      return Date.parse(value);
    },
    shouldInclude: (trace) => !trace?.meta?.marker,
  });
  const series = { x: ["2026-01-02", "2026-02-02"] };
  const element = {
    data: [series, { x: ["2020-01-01", "2030-01-01"], meta: { marker: true } }],
  };

  assert.deepEqual(cache.get(element), [Date.parse("2026-01-02"), Date.parse("2026-02-02")]);
  const firstConversions = conversions;
  assert.deepEqual(cache.get(element), [Date.parse("2026-01-02"), Date.parse("2026-02-02")]);
  assert.equal(conversions, firstConversions);

  series.x.push("2026-03-02");
  assert.deepEqual(cache.get(element), [Date.parse("2026-01-02"), Date.parse("2026-03-02")]);
  assert.ok(conversions > firstConversions);
});

test("range sync keeps one active request and only the newest pending range", async () => {
  let frame = null;
  let release = null;
  const applied = [];
  const controller = viewport.createRangeSyncController({}, {
    requestFrame: (callback) => {
      frame = callback;
      return 1;
    },
    cancelFrame: () => {},
    applyRange: (range) => {
      applied.push(range);
      return new Promise((resolve) => { release = resolve; });
    },
    extraStats: () => ({ appliedFrames: applied.length }),
  });

  controller.schedule(0, 10);
  controller.schedule(10, 20);
  frame();
  await Promise.resolve();
  assert.deepEqual(applied.map((range) => [range.startMs, range.endMs]), [[10, 20]]);

  controller.schedule(20, 30);
  controller.schedule(30, 40);
  assert.equal(controller.stats().coalesced, 2);
  assert.deepEqual(controller.stats().frame, { appliedFrames: 1 });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  frame();
  await Promise.resolve();
  assert.deepEqual(applied.map((range) => [range.startMs, range.endMs]), [[10, 20], [30, 40]]);
  release();
  await controller.flush();
});

test("relayout viewport resolves explicit and autoranged ranges through one contract", () => {
  assert.deepEqual(viewport.resolveRelayoutViewport({
    "xaxis.range[0]": "2026-01-01",
    "xaxis.range[1]": "2026-08-31",
  }), {
    autorange: false,
    explicitRange: true,
    range: ["2026-01-01", "2026-08-31"],
  });

  assert.deepEqual(viewport.resolveRelayoutViewport({ "xaxis.autorange": true }, {
    _fullLayout: { xaxis: { range: ["2025-01-01", "2026-08-31"] } },
  }), {
    autorange: true,
    explicitRange: false,
    range: ["2025-01-01", "2026-08-31"],
  });
});

test("future overlay controller captures once and restores after the final overlay closes", () => {
  let revision = 4;
  const controller = viewport.createFutureOverlayController({
    toMilliseconds: (value) => typeof value === "number" ? value : Date.parse(value),
    getPinnedRange: () => [100, 200],
    getCurrentRange: () => [90, 210],
    getInteractionRevision: () => revision,
    getUserViewportPinned: () => true,
  });

  controller.enable("ai");
  assert.deepEqual(controller.planState(), {
    restoreFutureOverlayViewport: null,
    revealAiForecastRange: true,
    revealEpsForecastRange: false,
    trimFutureOverlayRange: false,
  });
  controller.applyPlan({});
  controller.enable("eps");
  controller.disable("ai", { ai: false, eps: true });
  assert.equal(controller.planState().trimFutureOverlayRange, true);

  controller.disable("eps", { ai: false, eps: false });
  assert.deepEqual(controller.planState().restoreFutureOverlayViewport, {
    range: [100, 200],
    interactionRevision: 4,
    userViewportPinned: true,
  });
  assert.equal(controller.planState().trimFutureOverlayRange, false);
  revision += 1;
});

test("future overlay controller trims instead of restoring after user viewport interaction", () => {
  let revision = 1;
  const clampCalls = [];
  const controller = viewport.createFutureOverlayController({
    toMilliseconds: Number,
    getPinnedRange: () => [10, 20],
    getInteractionRevision: () => revision,
    isAtLatest: () => true,
    clampToObservedData: (options) => { clampCalls.push(options); },
  });
  controller.enable("eps");
  revision = 2;
  assert.equal(controller.disable("eps", { ai: false, eps: false }), false);
  assert.equal(controller.planState().restoreFutureOverlayViewport, null);
  assert.equal(controller.planState().trimFutureOverlayRange, true);
  assert.deepEqual(clampCalls, [{ alignLatest: true }]);
});

test("future overlay controller preserves a historical viewport after user interaction", () => {
  let revision = 1;
  let clampCalls = 0;
  const controller = viewport.createFutureOverlayController({
    toMilliseconds: Number,
    getPinnedRange: () => [10, 20],
    getInteractionRevision: () => revision,
    isAtLatest: () => false,
    clampToObservedData: () => { clampCalls += 1; },
  });
  controller.enable("ai");
  revision = 2;

  assert.equal(controller.disable("ai", { ai: false, eps: false }), false);
  assert.equal(controller.planState().restoreFutureOverlayViewport, null);
  assert.equal(controller.planState().trimFutureOverlayRange, true);
  assert.equal(clampCalls, 0);
});
