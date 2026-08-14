import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-session-controller.js");

const { createChartSessionState } = globalThis.ThinkStockChartSessionState;

test("chart session state keeps viewport and visibility in one mutable source", () => {
  const state = createChartSessionState({
    activeMonths: 6,
    hiddenSeries: new Set(["^KQ11"]),
    pinnedXRange: null,
    autoChartReset: true,
  });

  state.activeMonths = 12;
  state.hiddenSeries.add("kospi_credit");
  state.pinnedXRange = ["2026-01-01", "2026-08-01"];

  assert.equal(state.activeMonths, 12);
  assert.deepEqual([...state.hiddenSeries], ["^KQ11", "kospi_credit"]);
  assert.deepEqual(state.pinnedXRange, ["2026-01-01", "2026-08-01"]);
});

test("chart session state is sealed and isolates mutable initial values", () => {
  const hiddenSeries = new Set(["^KS11"]);
  const state = createChartSessionState({ activeMonths: 6, hiddenSeries, pinnedXRange: null });
  hiddenSeries.add("^KQ11");

  assert.equal(Object.isSealed(state), true);
  assert.deepEqual([...state.hiddenSeries], ["^KS11"]);
  assert.throws(() => { state.unknown = true; }, TypeError);
});
