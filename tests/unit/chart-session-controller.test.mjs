import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-session-controller.js");
const { createChartSessionController } = globalThis.ThinkStockChartSessionController;

function session(overrides = {}) {
  return {
    autoChartReset: false,
    pendingAutoChartFit: false,
    pendingAutoChartFitExpandOnly: false,
    viewportNormalizationFrame: "old",
    pendingCompositionViewport: {},
    pinnedXRange: null,
    userViewportPinned: true,
    lockedChartFrame: {},
    lockedHistoryYRange: [1, 2],
    ...overrides,
  };
}

test("enabling auto scale preserves the visible horizontal range and clears vertical transforms", () => {
  const state = session();
  let cleared = 0;
  const controller = createChartSessionController(globalThis, {
    state,
    getVisibleRange: () => [Date.parse("2025-01-01"), Date.parse("2025-07-01")],
    clearTransforms: () => { cleared += 1; },
  });

  controller.setAutoScale(true);
  assert.equal(state.autoChartReset, true);
  assert.deepEqual(state.pinnedXRange, [
    "2025-01-01T00:00:00.000Z",
    "2025-07-01T00:00:00.000Z",
  ]);
  assert.equal(state.pendingAutoChartFit, true);
  assert.equal(state.lockedChartFrame, null);
  assert.equal(state.lockedHistoryYRange, null);
  assert.equal(cleared, 1);
});

test("disabling auto scale captures a stable manual vertical range", () => {
  const state = session({ autoChartReset: true });
  let captured = 0;
  const controller = createChartSessionController(globalThis, {
    state,
    captureLockedRange: () => { captured += 1; },
  });

  controller.setAutoScale(false);
  assert.equal(state.autoChartReset, false);
  assert.equal(captured, 1);
  assert.equal(state.pendingCompositionViewport, null);
});

test("viewport auto-fit requests coalesce into one timer", () => {
  const state = session({ autoChartReset: true });
  const timers = new Map();
  let nextTimer = 0;
  let fitted = 0;
  const controller = createChartSessionController({}, {
    state,
    setTimer: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimer: (id) => timers.delete(id),
    fitCurrentViewport: () => { fitted += 1; },
    isInteractionBusy: () => false,
  });

  controller.applyResetPolicy("viewport", 100);
  controller.applyResetPolicy("viewport", 100);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(fitted, 1);
});
