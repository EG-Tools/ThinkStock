import assert from "node:assert/strict";
import test from "node:test";

import {
  CHART_RENDER_SERIES_BUDGET,
  DESKTOP_PERFORMANCE_BUDGET,
  evaluateChartRenderSeriesBudget,
  evaluatePerformanceBudget,
} from "../../shared/performance-budget.mjs";

test("passes a measured interaction session inside the shared budget", () => {
  const result = evaluatePerformanceBudget({
    pointerMoves: 30,
    p95PointerMove: 8,
    maxPointerMove: 15,
    frames: 60,
    p95FrameGap: 35,
    longFrameRatio: 0.05,
    renderCharts: 2,
    p95RenderChart: 500,
    auxiliaryRenders: 2,
    p95AuxiliaryRender: 300,
    startupVisuals: 1,
    p95StartupVisual: 900,
    appStarts: 1,
    p95AppStartup: 1200,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("reports a pointer regression but skips metrics without enough samples", () => {
  const result = evaluatePerformanceBudget({
    pointerMoves: 30,
    p95PointerMove: DESKTOP_PERFORMANCE_BUDGET.maxP95PointerMove + 1,
    maxPointerMove: 10,
    frames: 0,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((item) => item.metric), ["p95PointerMove"]);
  assert.equal(result.skipped.includes("p95FrameGap"), true);
});

test("evaluates chart render cost by visible main-series band", () => {
  const result = evaluateChartRenderSeriesBudget({
    bySeriesBand: {
      "1": { renders: 4, averageMs: 120 },
      "2-5": {
        renders: 3,
        averageMs: CHART_RENDER_SERIES_BUDGET.maxAverageMs["2-5"] + 1,
      },
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [{
    metric: "chartRenderAverage:2-5",
    actual: CHART_RENDER_SERIES_BUDGET.maxAverageMs["2-5"] + 1,
    limit: CHART_RENDER_SERIES_BUDGET.maxAverageMs["2-5"],
  }]);
  assert.equal(result.skipped.includes("chartRenderAverage:6-10"), true);
});
