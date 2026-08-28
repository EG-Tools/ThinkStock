import assert from "node:assert/strict";
import test from "node:test";

import { createMainChartEvents } from "../../docs/modules/main-chart-events.mjs";

function createHarness({ chartSyncing = false, currentRange = true } = {}) {
  const handlers = new Map();
  const calls = {
    coMovement: 0,
    composition: [],
    handles: 0,
    visibility: [],
    viewport: 0,
  };
  const chartSession = {
    currentSelected: ["A"],
    currentEnd: "2026-08-27",
    currentStart: "2025-08-27",
    hiddenSeries: new Set(["A"]),
    pinnedXRange: null,
    showCoMovement: true,
  };
  const interactionState = {
    chartSyncing,
    cursorSyncing: false,
    hoverSyncing: false,
    isHandleDragging: false,
    suppressPlotlyClickUntil: 0,
  };
  const scope = {
    document: { getElementById: () => null },
    requestAnimationFrame: (callback) => { callback(); return 1; },
  };
  const events = createMainChartEvents(scope, {
    HANDLE_UPDATE_DEBOUNCE_MS: 24,
    MAX_VISIBLE_MAIN_SERIES_MESSAGE: "limit",
    chartSession,
    changeSeriesVisibility: (...args) => { calls.visibility.push(args); },
    clearAutoResetSeriesTransforms: () => {},
    clearHoverOnChart: () => {},
    configureExactDateEventHover: () => true,
    enforceMainChartSeriesLimit: () => [],
    handlePriorityChartClick: () => false,
    hideDisclosurePopover: () => {},
    interactionState,
    isCurrentRange: () => currentRange,
    isTouchDevice: () => false,
    noteStockVisibilityChange: () => {},
    normalizeHoverPopupIndent: () => {},
    refreshAiForecastTargets: () => {},
    renderCoMovementPanel: () => { calls.coMovement += 1; },
    requestChartCompositionUpdate: (options) => { calls.composition.push(options); },
    scheduleHandleUpdate: () => { calls.handles += 1; },
    scheduleViewportRangeSync: () => {},
    scheduleViewportWindowRender: () => { calls.viewport += 1; },
    setAiForecastTargetVisibility: () => {},
    setMainChartSeriesVisible: () => true,
    showChartNavigationMessage: () => {},
    syncHoverToChart: () => {},
    toMsSafe: (value) => Date.parse(value),
  });
  events.bind({
    classList: { contains: () => false },
    on: (name, handler) => handlers.set(name, handler),
  });
  return { calls, chartSession, handlers, interactionState };
}

test("programmatic relayout cannot persist or replay an app-owned viewport", () => {
  const harness = createHarness({ chartSyncing: true });

  harness.handlers.get("plotly_relayout")({
    "xaxis.range[0]": "2025-08-27",
    "xaxis.range[1]": "2026-08-27",
  });

  assert.equal(harness.chartSession.pinnedXRange, null);
  assert.equal(harness.chartSession.currentStart, "2025-08-27");
  assert.equal(harness.chartSession.currentEnd, "2026-08-27");
  assert.deepEqual(harness.calls, {
    coMovement: 0,
    composition: [],
    handles: 0,
    visibility: [],
    viewport: 0,
  });
});

test("user relayout persists the viewport and schedules dependent work", () => {
  const harness = createHarness();

  harness.handlers.get("plotly_relayout")({
    "xaxis.range[0]": "2026-05-27",
    "xaxis.range[1]": "2026-08-27",
  });

  assert.deepEqual(harness.chartSession.pinnedXRange, ["2026-05-27", "2026-08-27"]);
  assert.equal(harness.chartSession.currentStart, "2026-05-27");
  assert.equal(harness.chartSession.currentEnd, "2026-08-27");
  assert.deepEqual(harness.calls, {
    coMovement: 1,
    composition: [],
    handles: 1,
    visibility: [],
    viewport: 1,
  });
});

test("late relayout events cannot overwrite a newer visible viewport", () => {
  const harness = createHarness({ currentRange: false });

  harness.handlers.get("plotly_relayout")({
    "xaxis.range[0]": "2025-08-27",
    "xaxis.range[1]": "2026-08-27",
  });

  assert.equal(harness.chartSession.pinnedXRange, null);
  assert.deepEqual(harness.calls, {
    coMovement: 0,
    composition: [],
    handles: 0,
    visibility: [],
    viewport: 0,
  });
});

test("legend visibility uses the shared staged-series path", () => {
  const harness = createHarness();

  assert.equal(harness.handlers.get("plotly_legendclick")({ curveNumber: 0 }), false);

  assert.deepEqual(harness.calls.visibility, [["A", true]]);
  assert.deepEqual(harness.calls.composition, []);
});

test("legend reset requests one price-first composition", () => {
  const harness = createHarness();

  assert.equal(harness.handlers.get("plotly_legenddoubleclick")(), false);

  assert.deepEqual(harness.calls.composition, [{
    progressiveComposition: true,
    reason: "series-visibility-reset",
  }]);
});
