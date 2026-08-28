export const DESKTOP_PERFORMANCE_BUDGET = Object.freeze({
  minPointerMoves: 20,
  minFrames: 20,
  maxP95PointerMove: 12,
  maxPointerMove: 40,
  maxP95FrameGap: 100,
  maxLongFrameRatio: 0.35,
  maxP95RenderChart: 1200,
  maxP95AuxiliaryRender: 800,
  maxP95StartupVisual: 2500,
  maxAppStartup: 4500,
  maxLongTask: 200,
});

export const CHART_RENDER_SERIES_BUDGET = Object.freeze({
  minRenders: 2,
  maxAverageMs: Object.freeze({
    "1": 700,
    "2-5": 900,
    "6-10": 1200,
    "11+": 1800,
  }),
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
  check("p95StartupVisual", summary.p95StartupVisual, budget.maxP95StartupVisual, Number(summary.startupVisuals) > 0);
  check("p95AppStartup", summary.p95AppStartup, budget.maxAppStartup, Number(summary.appStarts) > 0);
  check("maxLongTask", summary.maxLongTask, budget.maxLongTask, Number(summary.longTasks) > 0);
  return Object.freeze({
    ok: violations.length === 0,
    skipped: Object.freeze(skipped),
    violations: Object.freeze(violations),
  });
}

export function evaluateChartRenderSeriesBudget(
  snapshot = {},
  budget = CHART_RENDER_SERIES_BUDGET,
) {
  const violations = [];
  const skipped = [];
  const bySeriesBand = snapshot?.bySeriesBand && typeof snapshot.bySeriesBand === "object"
    ? snapshot.bySeriesBand
    : {};
  Object.entries(budget.maxAverageMs || {}).forEach(([band, limit]) => {
    const sample = bySeriesBand[band];
    const metric = `chartRenderAverage:${band}`;
    if (!sample || Number(sample.renders) < Number(budget.minRenders)) {
      skipped.push(metric);
      return;
    }
    const actual = Number(sample.averageMs);
    if (!Number.isFinite(actual)) {
      skipped.push(metric);
      return;
    }
    if (actual > Number(limit)) violations.push({ metric, actual, limit: Number(limit) });
  });
  return Object.freeze({
    ok: violations.length === 0,
    skipped: Object.freeze(skipped),
    violations: Object.freeze(violations),
  });
}

const api = Object.freeze({
  CHART_RENDER_SERIES_BUDGET,
  DESKTOP_PERFORMANCE_BUDGET,
  evaluateChartRenderSeriesBudget,
  evaluatePerformanceBudget,
});
