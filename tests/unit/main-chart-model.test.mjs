import assert from "node:assert/strict";
import test from "node:test";
import model from "../../docs/modules/main-chart-model.mjs";

test("plans main chart dates and visible-series budget in the chart model", () => {
  let budgetCount = 0;
  const result = model.buildMainChartRenderInputs({
    activeMonths: -6,
    boundRows: [[{ date: "2020-01-01" }, { date: "2026-08-22" }]],
    coreSeries: ["^KS11", "customer_deposit"],
    customSeries: ["005930.KS"],
    dateBounds: () => ({ minDate: "2000-01-04", maxDate: "2026-08-22" }),
    fallbackDate: "2026-08-25",
    hiddenSeries: new Set(["005930.KS"]),
    preservedFrameRange: [Date.parse("2025-01-01"), Date.parse("2025-12-31")],
    priceRows: [{ date: "2000-01-04" }, { date: "2026-08-22" }],
    resolveDisplayBudget: (visibleCount) => {
      budgetCount = visibleCount;
      return 2400;
    },
    shiftMonths: (date, months) => {
      if (months === -6) return "2026-02-22";
      if (months === 360) return "1996-08-22";
      return date;
    },
    supplementalSeries: ["customer_deposit"],
  });

  assert.equal(result.dataStart, "2000-01-04");
  assert.equal(result.frameStart, "2025-01-01");
  assert.equal(result.frameEnd, "2025-12-31");
  assert.equal(result.displayBudget, 2400);
  assert.equal(budgetCount, 1);
  assert.deepEqual([...result.allowedSeries], ["^KS11", "customer_deposit", "005930.KS"]);
});

test("keeps main chart model cache-key construction deterministic", () => {
  const options = {
    dataStart: "2000-01-01",
    dataEnd: "2026-08-22",
    frameStart: "2026-02-22",
    frameEnd: "2026-08-22",
    activeMonths: -6,
    creditOffsetDays: -2,
    priceFingerprint: "price-42",
    supplementalRevision: "macro-7",
    customStocksSignature: "005930.KS:#fff",
    hiddenSeriesSignature: "",
    offsetsSignature: "{}",
    scalesSignature: "{}",
    chartFrameSignature: "auto-frame",
    displayBudget: 2400,
    preserveDailyPoints: true,
  };
  const first = model.mainChartCalcCacheKey(options);
  assert.equal(model.mainChartCalcCacheKey({ ...options }), first);
  assert.notEqual(model.mainChartCalcCacheKey({ ...options, displayBudget: 1200 }), first);
  assert.match(first, /daily-points$/);
});

test("creates an isolated live session model without mutating the cached calculation", () => {
  const cached = {
    rows: [{ date: "2026-08-22" }],
    selected: ["^KS11"],
    seriesModels: [{
      series: "^KS11",
      values: [95, 100, 105],
      baseValues: [95, 100, 105],
    }],
  };

  const session = model.createMainChartSessionModel(cached);
  session.seriesModels[0].values[1] = 72;
  session.seriesModels[0].values = [70, 72, 74];

  assert.notEqual(session, cached);
  assert.notEqual(session.seriesModels, cached.seriesModels);
  assert.notEqual(session.seriesModels[0], cached.seriesModels[0]);
  assert.deepEqual(cached.seriesModels[0].values, [95, 100, 105]);
  assert.equal(session.seriesModels[0].baseValues, cached.seriesModels[0].baseValues);
});
