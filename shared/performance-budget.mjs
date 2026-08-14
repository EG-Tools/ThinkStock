export const DESKTOP_PERFORMANCE_BUDGET = Object.freeze({
  minPointerMoves: 20,
  minFrames: 20,
  maxP95PointerMove: 20,
  maxPointerMove: 50,
  maxP95FrameGap: 180,
  maxLongFrameRatio: 0.70,
  maxP95RenderChart: 2000,
  maxP95AuxiliaryRender: 1200,
  maxAppStartup: 4500,
  maxLongTask: 300,
});

export function evaluatePerformanceBudget(summary = {}, budget = DESKTOP_PERFORMANCE_BUDGET) {
  const violations = [];
  const skipped = [];
  const check = (metric, actual, limit, ready = true) => {
    if (!ready || !Number.isFinite(Number(actual))) {
      skipped.push(metric);
      return;
    }
    if (Number(actual) > Number(limit)) {
      violations.push({ metric, actual: Number(actual), limit: Number(limit) });
    }
  };
  const pointerReady = Number(summary.pointerMoves) >= Number(budget.minPointerMoves);
  const frameReady = Number(summary.frames) >= Number(budget.minFrames);
  check("p95PointerMove", summary.p95PointerMove, budget.maxP95PointerMove, pointerReady);
  check("maxPointerMove", summary.maxPointerMove, budget.maxPointerMove, pointerReady);
  check("p95FrameGap", summary.p95FrameGap, budget.maxP95FrameGap, frameReady);
  check("longFrameRatio", summary.longFrameRatio, budget.maxLongFrameRatio, frameReady);
  check("p95RenderChart", summary.p95RenderChart, budget.maxP95RenderChart, Number(summary.renderCharts) > 0);
  check("p95AuxiliaryRender", summary.p95AuxiliaryRender, budget.maxP95AuxiliaryRender, Number(summary.auxiliaryRenders) > 0);
  check("p95AppStartup", summary.p95AppStartup, budget.maxAppStartup, Number(summary.appStarts) > 0);
  check("maxLongTask", summary.maxLongTask, budget.maxLongTask, Number(summary.longTasks) > 0);
  return Object.freeze({
    ok: violations.length === 0,
    skipped: Object.freeze(skipped),
    violations: Object.freeze(violations),
  });
}

const api = Object.freeze({ DESKTOP_PERFORMANCE_BUDGET, evaluatePerformanceBudget });
if (typeof globalThis !== "undefined") globalThis.ThinkStockPerformanceBudget = api;
