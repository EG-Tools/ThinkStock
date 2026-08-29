import assert from "node:assert/strict";
import test from "node:test";
import model from "../../docs/modules/main-chart-model.mjs";
import { prepareMainChartDataset } from "../../docs/modules/chart-model-worker-runtime.mjs";

test("main chart cache helpers share one normalized frame signature", () => {
  assert.equal(model.sortedObjectSignature({ b: 2, a: 1 }), "a:1|b:2");
  assert.equal(model.mainChartDatasetKey({
    priceFingerprint: "price-7",
    supplementalRevision: "macro:2|credit:4",
  }), "price-7|macro:2|credit:4");
});

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

test("builds identical worker and synchronous main-chart requests", () => {
  const sources = {
    priceRows: [{ date: "2026-08-22", AAA: 100 }],
    macroRows: [{ date: "2026-08-22", leading_cycle: 101 }],
    creditRows: [],
  };
  const request = model.buildMainChartModelRequest({
    activeMonths: -12,
    allowedSeries: ["AAA", "leading_cycle"],
    creditCols: ["customer_deposit"],
    creditOffsetDays: 2,
    customStocksSignature: "AAA:#fff",
    dataStart: "2025-08-22",
    dataEnd: "2026-08-22",
    displayBudget: 1200,
    displayNames: { AAA: "AAA" },
    fixedFrame: { normBases: { AAA: 100 }, autoScales: { AAA: 90 } },
    frameStart: "2026-01-01",
    frameEnd: "2026-08-22",
    hiddenSeries: new Set(["leading_cycle"]),
    priceFingerprint: "price-8",
    priorityOrder: ["AAA"],
    seriesOffsets: { AAA: 2 },
    seriesScales: { AAA: 1.2 },
    sources,
    supplementalRevision: "macro:3|credit:1",
    supplementalSeries: ["leading_cycle"],
  });

  assert.equal(request.workerPayload.datasetKey, "price-8|macro:3|credit:1");
  assert.deepEqual(request.workerPayload.sources, sources);
  assert.deepEqual(
    Object.fromEntries(Object.entries(request.workerPayload).filter(([key]) => !["datasetKey", "sources"].includes(key))),
    Object.fromEntries(Object.entries(request.syncPayload).filter(([key]) => !["priceRows", "macroRows", "creditRows"].includes(key))),
  );
  assert.match(request.cacheKey, /fixed-frame::fixed-frame/);
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

test("keeps hidden trace slots without calculating their full history", () => {
  const result = model.buildMainChartModel({
    priceRows: [
      { date: "2026-08-20", "^KS11": 3000, "005930.KS": 70000 },
      { date: "2026-08-21", "^KS11": 3030, "005930.KS": 71000 },
    ],
    macroRows: [],
    creditRows: [],
    allowedSeries: ["^KS11", "005930.KS"],
    hiddenSeries: ["005930.KS"],
    excludedSeries: [],
    priorityOrder: ["^KS11", "005930.KS"],
    start: "2026-08-20",
    end: "2026-08-21",
    frameStart: "2026-08-20",
    frameEnd: "2026-08-21",
    displayBudget: 100,
    preserveDailyPoints: true,
  });

  assert.deepEqual(result.selected, ["^KS11", "005930.KS"]);
  assert.equal(result.seriesModels[0].values.length, 2);
  assert.deepEqual(result.seriesModels[1], {
    series: "005930.KS",
    hidden: true,
    rawTexts: [],
    baseLineWidth: 1,
    xValues: [],
    values: [],
    baseValues: [],
  });
});

test("reuses prepared raw values and labels across viewport model rebuilds", () => {
  const payload = {
    priceRows: [
      { date: "2026-08-20", AAA: 100 },
      { date: "2026-08-21", AAA: 105 },
      { date: "2026-08-22", AAA: 103 },
    ],
    macroRows: [],
    creditRows: [],
    allowedSeries: ["AAA"],
    hiddenSeries: [],
    excludedSeries: [],
    priorityOrder: ["AAA"],
    start: "2026-08-20",
    end: "2026-08-22",
    displayBudget: 100,
    preserveDailyPoints: true,
  };
  const preparedDataset = prepareMainChartDataset(payload);

  model.buildMainChartModel({
    ...payload,
    preparedDataset,
    frameStart: "2026-08-20",
    frameEnd: "2026-08-21",
  });
  model.buildMainChartModel({
    ...payload,
    preparedDataset,
    frameStart: "2026-08-21",
    frameEnd: "2026-08-22",
  });

  assert.deepEqual(preparedDataset.stats(), {
    availabilityScans: 1,
    rangeSlices: 2,
    valueBuilds: 1,
    textBuilds: 1,
    cachedSeries: 1,
    cachedTexts: 1,
  });
});
