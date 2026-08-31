import assert from "node:assert/strict";
import test from "node:test";

import {
  captureLockedChartFrame,
  captureLockedHistoryYRange,
  captureViewportNormalizationFrame,
  clearSeriesTransforms,
  createChartSessionController,
  orderItemsByActivation,
  reconcileSeriesActivationOrder,
  updateSeriesActivationOrder,
} from "../../docs/modules/chart-session-controller.mjs";

function session(overrides = {}) {
  return {
    autoChartReset: false,
    pendingAutoChartFit: false,
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

test("viewport completion keeps the live fit and clears only its temporary normalization frame", () => {
  const state = session({
    autoChartReset: true,
    viewportNormalizationFrame: { normBases: { A: 10 }, autoScales: { A: 2 } },
  });
  let fitted = 0;
  let normalized = 0;
  const controller = createChartSessionController({}, {
    state,
    fitCurrentViewport: () => { fitted += 1; },
    normalizeCurrentViewport: () => { normalized += 1; },
  });

  assert.equal(controller.applyResetPolicy("viewport"), true);
  assert.equal(state.viewportNormalizationFrame, null);
  assert.equal(normalized, 0);
  assert.equal(fitted, 0);
  assert.deepEqual(controller.stats(), { autoFitPending: false, disposed: false });
});

test("one session contract captures manual scale and viewport normalization frames", () => {
  const state = session({
    lockedChartFrame: { normBases: { A: 10 }, autoScales: { A: 2 } },
    lockedHistoryYRange: null,
    viewportNormalizationFrame: null,
  });
  const model = {
    normBases: { A: 99, B: 20, empty: 0 },
    autoScales: { A: 9, B: 3, invalid: Number.NaN },
  };

  assert.deepEqual(captureLockedChartFrame(state, model), {
    normBases: { A: 10, B: 20 },
    autoScales: { A: 2, B: 3 },
  });
  assert.deepEqual(captureLockedHistoryYRange(state, [4, 8], model), [4, 8]);
  assert.deepEqual(captureViewportNormalizationFrame(state, model), {
    normBases: { A: 99, B: 20 },
    autoScales: { A: 9, B: 3 },
  });
});

test("clearing a stock transform also clears its dependent EPS transform", () => {
  const state = session({
    seriesOffsets: { "005930.KS": 2, "eps:005930.KS": 4, "000660.KS": 6 },
    seriesScales: { "005930.KS": 1.2, "eps:005930.KS": 0.8, "000660.KS": 1.1 },
  });

  assert.equal(clearSeriesTransforms(state, "005930.KS"), true);
  assert.deepEqual(state.seriesOffsets, { "000660.KS": 6 });
  assert.deepEqual(state.seriesScales, { "000660.KS": 1.1 });
});

test("clearing an EPS transform does not reset its stock transform", () => {
  const state = session({
    seriesOffsets: { "005930.KS": 2, "eps:005930.KS": 4 },
    seriesScales: { "005930.KS": 1.2, "eps:005930.KS": 0.8 },
  });

  assert.equal(clearSeriesTransforms(state, "eps:005930.KS"), true);
  assert.deepEqual(state.seriesOffsets, { "005930.KS": 2 });
  assert.deepEqual(state.seriesScales, { "005930.KS": 1.2 });
});

test("information rows preserve activation order and move a reactivated series to the end", () => {
  let order = reconcileSeriesActivationOrder(
    ["^KS11", "leading_cycle"],
    ["leading_cycle", "^KS11", "218410.KQ"],
  );
  assert.deepEqual(order, ["^KS11", "leading_cycle", "218410.KQ"]);

  order = updateSeriesActivationOrder(order, "^KS11", false);
  order = updateSeriesActivationOrder(order, "^KS11", true);
  assert.deepEqual(order, ["leading_cycle", "218410.KQ", "^KS11"]);
  assert.deepEqual(
    reconcileSeriesActivationOrder(order, ["^KS11", "leading_cycle"]),
    ["leading_cycle", "^KS11"],
  );
});

test("orders any chart trace collection so the latest activation renders last", () => {
  const items = [{ key: "A" }, { key: "B" }, { key: "background" }];
  assert.deepEqual(
    orderItemsByActivation(items, ["B", "A"], (item) => item.key),
    [{ key: "background" }, { key: "B" }, { key: "A" }],
  );
});
