import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-viewport-controller.js");
const viewport = globalThis.ThinkStockChartCompositionViewport;

test("captures visible series and source-aware latest tolerance before composition changes", () => {
  const captured = viewport.captureCompositionViewport({
    autoScale: true,
    element: { data: [{
      mode: "lines",
      x: ["2026-08-01", "2026-08-10"],
      meta: { seriesKey: "kospi_credit" },
    }] },
    getViewRange: () => [1, 2],
    toMilliseconds: (value) => Date.parse(`${value}T00:00:00Z`),
    timelinePolicy: { latestToleranceMs: () => 432000000 },
  });

  assert.deepEqual(captured.viewRange, [1, 2]);
  assert.deepEqual(captured.visibleSeries, ["kospi_credit"]);
  assert.equal(captured.latestTolerance, 432000000);
});

test("does not capture composition state while automatic scaling is off", () => {
  assert.equal(viewport.captureCompositionViewport({ autoScale: false }), null);
});
