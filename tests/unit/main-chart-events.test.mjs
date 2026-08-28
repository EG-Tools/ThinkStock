import assert from "node:assert/strict";
import test from "node:test";

import { createMainChartEvents } from "../../docs/modules/main-chart-events.mjs";

function createHarness({ chartSyncing = false, currentRange = true } = {}) {
  const handlers = new Map();
  const calls = {
    coMovement: 0,
    handles: 0,
    viewport: 0,
  };
  const chartSession = {
    currentEnd: "2026-08-27",
    currentStart: "2025-08-27",
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
    requestChartCompositionUpdate: () => {},
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
  assert.deepEqual(harness.calls, { coMovement: 0, handles: 0, viewport: 0 });
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
  assert.deepEqual(harness.calls, { coMovement: 1, handles: 1, viewport: 1 });
});

test("late relayout events cannot overwrite a newer visible viewport", () => {
  const harness = createHarness({ currentRange: false });

  harness.handlers.get("plotly_relayout")({
    "xaxis.range[0]": "2025-08-27",
    "xaxis.range[1]": "2026-08-27",
  });

  assert.equal(harness.chartSession.pinnedXRange, null);
  assert.deepEqual(harness.calls, { coMovement: 0, handles: 0, viewport: 0 });
});
