import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/auxiliary-chart-model.js");
const {
  buildAuxiliaryChartModel,
  buildAuxiliaryPanelLayout,
  buildAuxiliaryViewportRanges,
  buildThresholdEnvelopeSeries,
  buildThresholdFillPolygons,
  buildThresholdZones,
  insertDatedGapBreaks,
  NEWS_MOVING_AVERAGE_DAYS,
  NEWS_MOVING_AVERAGE_MIN_DAYS,
  NEWS_MOVING_AVERAGE_MAX_DAYS,
  normalizeNewsMovingAverageDays,
  rollingAverage,
} = globalThis.ThinkStockAuxiliaryChartModel;

test("auxiliary panels collapse without leaving an empty axis domain", () => {
  const full = buildAuxiliaryPanelLayout({
    adr: true,
    fearGreed: true,
    newsSentiment: true,
    vkospi: true,
  });
  const collapsed = buildAuxiliaryPanelLayout({
    adr: true,
    fearGreed: false,
    newsSentiment: true,
    vkospi: false,
  });

  assert.equal(full.chartHeight, 577);
  assert.equal(full.separators.length, 3);
  assert.equal(full.bottomAxis, "y4");
  assert.deepEqual(full.axes, {
    adr: "y",
    fearGreed: "y2",
    newsSentiment: "y3",
    vkospi: "y4",
  });
  assert.deepEqual(collapsed.activeKeys, ["adr", "newsSentiment"]);
  assert.equal(collapsed.chartHeight, 371);
  assert.equal(collapsed.separators.length, 1);
  assert.equal(collapsed.bottomAxis, "y2");
  assert.deepEqual(collapsed.axes, { adr: "y", newsSentiment: "y2" });
  assert.equal(collapsed.domains.fearGreed, undefined);
  assert.equal(collapsed.domains.adr[1], 1);
  assert.ok(collapsed.domains.newsSentiment[0] < collapsed.domains.newsSentiment[1]);
});

test("all auxiliary panel combinations keep fixed pixel heights and compact cleanly", () => {
  const keys = ["adr", "fearGreed", "newsSentiment", "vkospi"];
  const targetPixels = { adr: 180, fearGreed: 85, newsSentiment: 85, vkospi: 85 };

  for (let mask = 0; mask < 16; mask += 1) {
    const visibility = Object.fromEntries(keys.map((key, index) => [
      key,
      Boolean(mask & (1 << index)),
    ]));
    const layout = buildAuxiliaryPanelLayout(visibility);
    const activeKeys = keys.filter((key) => visibility[key]);
    assert.deepEqual(layout.activeKeys, activeKeys);
    assert.equal(layout.chartHeight, activeKeys.length
      ? 88 + activeKeys.reduce((sum, key) => sum + targetPixels[key], 0)
        + Math.max(0, activeKeys.length - 1) * 18
      : 42);
    assert.deepEqual(layout.axes, Object.fromEntries(activeKeys.map((key, index) => [
      key,
      index === 0 ? "y" : `y${index + 1}`,
    ])));
    activeKeys.forEach((key) => {
      const domain = layout.domains[key];
      const actualPixels = (domain[1] - domain[0]) * layout.plotHeight;
      assert.ok(Math.abs(actualPixels - targetPixels[key]) < 1e-9);
    });
  }
});

test("auxiliary panels follow activation order while preserving their heights", () => {
  const layout = buildAuxiliaryPanelLayout({
    adr: true,
    fearGreed: false,
    newsSentiment: false,
    vkospi: true,
  }, {
    panelOrder: ["vkospi", "adr", "fearGreed", "newsSentiment"],
  });

  assert.deepEqual(layout.activeKeys, ["vkospi", "adr"]);
  assert.deepEqual(layout.axes, { vkospi: "y", adr: "y2" });
  assert.equal(layout.bottomAxis, "y2");
  assert.ok(layout.domains.vkospi[0] > layout.domains.adr[1]);
  assert.equal(Math.round((layout.domains.vkospi[1] - layout.domains.vkospi[0]) * layout.plotHeight), 85);
  assert.equal(Math.round((layout.domains.adr[1] - layout.domains.adr[0]) * layout.plotHeight), 180);
});


test("threshold zones preserve seam points at low and high crossings", () => {
  const zones = buildThresholdZones([100, 70, 90, 130, 110, null], 80, 120);

  assert.deepEqual(zones.low, [null, 70, 90, null, null, null]);
  assert.deepEqual(zones.middle, [100, 70, 90, 130, 110, null]);
  assert.deepEqual(zones.high, [null, null, null, 130, 110, null]);
  assert.deepEqual(zones.lowBaseline, [null, 80, 80, null, null, null]);
  assert.deepEqual(zones.highBaseline, [null, null, null, 120, 120, null]);
});

test("threshold fill polygons close exactly at interpolated crossings", () => {
  const polygons = buildThresholdFillPolygons(
    ["2026-02-01", "2026-02-02", "2026-02-03"],
    [100, 70, 100],
    80,
    "low",
  );

  assert.equal(polygons.length, 1);
  assert.deepEqual(polygons[0].values, [80, 70, 80, 80, 80]);
  assert.equal(polygons[0].dates[0], "2026-02-01T16:00:00.000Z");
  assert.equal(polygons[0].dates[2], "2026-02-02T08:00:00.000Z");
  assert.equal(polygons[0].dates.at(-1), polygons[0].dates[0]);
});

test("threshold equality does not create a stray fill", () => {
  const low = buildThresholdFillPolygons(
    ["2026-02-01", "2026-02-02", "2026-02-03"],
    [50, 25, 50],
    25,
    "low",
  );
  const high = buildThresholdFillPolygons(
    ["2026-02-01", "2026-02-02", "2026-02-03"],
    [50, 75, 50],
    75,
    "high",
  );

  assert.deepEqual(low, []);
  assert.deepEqual(high, []);
});

test("threshold fill polygons never bridge missing data", () => {
  const polygons = buildThresholdFillPolygons(
    ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"],
    [50, 20, null, 20, 50],
    25,
    "low",
  );

  assert.equal(polygons.length, 2);
  assert.ok(polygons[0].dates.every((date) => String(date).slice(0, 10) <= "2026-02-02"));
  assert.ok(polygons[1].dates.every((date) => String(date).slice(0, 10) >= "2026-02-04"));
});

test("ADR threshold envelopes combine two lines without stacking opacity", () => {
  const series = [
    {
      dates: ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"],
      values: [100, 70, null, 130],
    },
    {
      dates: ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"],
      values: [90, 75, 60, 125],
    },
  ];

  assert.deepEqual(buildThresholdEnvelopeSeries(series, "low"), {
    dates: ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"],
    values: [90, 70, 60, 125],
  });
  assert.deepEqual(buildThresholdEnvelopeSeries(series, "high"), {
    dates: ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"],
    values: [100, 75, 60, 130],
  });
});


test("auxiliary model keeps ADR and news dates independent", () => {
  const model = buildAuxiliaryChartModel({
    startDate: "2026-01-02",
    adrLowThreshold: 80,
    adrHighThreshold: 120,
    newsLowThreshold: 90,
    newsHighThreshold: 110,
    adrRows: [
      { date: "2026-01-01", adr_kospi: 90, adr_kosdaq: 95, fear_greed: 40 },
      { date: "2026-01-02", adr_kospi: 75, adr_kosdaq: 125, fear_greed: 45 },
      { date: "2026-01-03", adr_kospi: 85, adr_kosdaq: 115, fear_greed: 50 },
    ],
    macroRows: [
      { date: "2026-01-02", news_sentiment: null },
      { date: "2026-01-03", news_sentiment: 105 },
      { date: "2026-01-04", news_sentiment: 112 },
    ],
    // VKOSPI can have a different calendar from ADR and macro data.
    vkospiRows: [],
  });

  assert.deepEqual(model.dates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.adrKospiDates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.adrKosdaqDates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.fearGreedDates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.newsDates, ["2026-01-03", "2026-01-04"]);
  assert.deepEqual(model.kospiValues, [75, 85]);
  assert.deepEqual(model.newsValues, [105, 112]);
  assert.equal(model.adrRowCount, 2);
  assert.equal(model.newsRowCount, 2);
  assert.ok(model.adrYMin < 75);
  assert.ok(model.newsYMax >= 112);
});

test("unrelated auxiliary dates do not split ADR or fear-greed lines", () => {
  const model = buildAuxiliaryChartModel({
    startDate: "2026-08-01",
    adrRows: [
      { date: "2026-08-03", adr_kospi: 91, adr_kosdaq: 88, fear_greed: 42 },
      { date: "2026-08-04", vix: 18.2 },
      { date: "2026-08-05", vkospi: 21.1 },
      { date: "2026-08-06", adr_kospi: 94, adr_kosdaq: 90, fear_greed: 45 },
    ],
  });

  assert.deepEqual(model.adrKospiDates, ["2026-08-03", "2026-08-06"]);
  assert.deepEqual(model.adrKospiValues, [91, 94]);
  assert.deepEqual(model.adrKosdaqDates, ["2026-08-03", "2026-08-06"]);
  assert.deepEqual(model.adrKosdaqValues, [88, 90]);
  assert.deepEqual(model.fearGreedDates, ["2026-08-03", "2026-08-06"]);
  assert.deepEqual(model.fearGreedValues, [42, 45]);
});

test("VKOSPI stays independent and long missing periods break the line", () => {
  const model = buildAuxiliaryChartModel({
    startDate: "2010-01-01",
    adrRows: [
      { date: "2010-01-04", vkospi: 20.94 },
      { date: "2010-01-05", vkospi: 20.6 },
      { date: "2026-08-10", vkospi: 69.55 },
    ],
  });

  assert.deepEqual(model.vkospiDates, [
    "2010-01-04",
    "2010-01-05",
    "2010-01-06",
    "2026-08-10",
  ]);
  assert.deepEqual(model.vkospiValues, [20.94, 20.6, null, 69.55]);
  assert.equal(model.vkospiRowCount, 3);
});

test("volatility panel keeps VKOSPI and VIX on independent calendars", () => {
  const model = buildAuxiliaryChartModel({
    startDate: "2026-08-01",
    adrRows: [
      { date: "2026-08-03", vkospi: 20.5 },
      { date: "2026-08-04", vix: 18.2 },
      { date: "2026-08-05", vkospi: 21.1, vix: 19.4 },
    ],
  });

  assert.deepEqual(model.vkospiDates, ["2026-08-03", "2026-08-05"]);
  assert.deepEqual(model.vkospiValues, [20.5, 21.1]);
  assert.deepEqual(model.vixDates, ["2026-08-04", "2026-08-05"]);
  assert.deepEqual(model.vixValues, [18.2, 19.4]);
  assert.equal(model.vkospiRowCount, 2);
  assert.equal(model.vixRowCount, 2);
});

test("gap insertion keeps a continuous recent VKOSPI segment untouched", () => {
  assert.deepEqual(insertDatedGapBreaks([
    { date: "2026-08-07", vkospi: 75.59 },
    { date: "2026-08-10", vkospi: 69.55 },
  ], "vkospi"), {
    dates: ["2026-08-07", "2026-08-10"],
    values: [75.59, 69.55],
    rowCount: 2,
  });
});

test("a long Korean market holiday does not create a false VKOSPI break", () => {
  assert.deepEqual(insertDatedGapBreaks([
    { date: "2017-09-29", vkospi: 14.2 },
    { date: "2017-10-10", vkospi: 15.1 },
  ], "vkospi"), {
    dates: ["2017-09-29", "2017-10-10"],
    values: [14.2, 15.1],
    rowCount: 2,
  });
});

test("news smoothing defaults to the original daily values", () => {
  const values = Array.from({ length: 6 }, (_, index) => index + 1);
  const smoothed = rollingAverage(values, NEWS_MOVING_AVERAGE_DAYS);

  assert.equal(NEWS_MOVING_AVERAGE_DAYS, 1);
  assert.equal(smoothed[4], 5);
  assert.equal(smoothed[5], 6);
  assert.deepEqual(rollingAverage(values, 3).slice(-2), [4, 5]);
});

test("news smoothing accepts display-only periods from one to twenty days", () => {
  assert.equal(NEWS_MOVING_AVERAGE_MIN_DAYS, 1);
  assert.equal(NEWS_MOVING_AVERAGE_MAX_DAYS, 20);
  assert.equal(normalizeNewsMovingAverageDays(-10), 1);
  assert.equal(normalizeNewsMovingAverageDays(8.6), 9);
  assert.equal(normalizeNewsMovingAverageDays(200), 20);

  const rows = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    news_sentiment: index + 1,
  }));
  const daily = buildAuxiliaryChartModel({ macroRows: rows, newsMovingAverageDays: 1 });
  const twentyDay = buildAuxiliaryChartModel({ macroRows: rows, newsMovingAverageDays: 20 });
  assert.equal(daily.newsValues.at(-1), 20);
  assert.equal(twentyDay.newsValues.at(-1), 10.5);
  assert.equal(twentyDay.newsMovingAverageDays, 20);
});

test("viewport ranges ignore outliers outside the visible dates", () => {
  const model = {
    dates: ["2020-01-01", "2026-01-01", "2026-01-02"],
    kospiValues: [280, 96, 101],
    kosdaqValues: [260, 103, 108],
    newsDates: ["2020-01-01", "2026-01-01", "2026-01-02"],
    newsValues: [180, 99, 101],
    vkospiDates: ["2020-01-01", "2026-01-01", "2026-01-02"],
    vkospiValues: [90, 18, 20],
    vixDates: ["2020-01-01", "2026-01-01", "2026-01-02"],
    vixValues: [80, 16, 24],
  };
  const ranges = buildAuxiliaryViewportRanges(
    model,
    ["2026-01-01", "2026-01-02"],
  );

  assert.deepEqual(ranges.adr, [77.5, 121.2]);
  assert.deepEqual(ranges.news, [88, 112]);
  assert.deepEqual(ranges.vkospi, [15, 25]);
});

test("viewport ranges preserve the same result for unsorted fallback dates", () => {
  const ranges = buildAuxiliaryViewportRanges({
    dates: ["2026-01-02", "2020-01-01", "2026-01-01"],
    kospiValues: [101, 280, 96],
    kosdaqValues: [108, 260, 103],
    newsDates: ["2026-01-02", "2020-01-01", "2026-01-01"],
    newsValues: [101, 180, 99],
    vkospiDates: ["2026-01-02", "2020-01-01", "2026-01-01"],
    vkospiValues: [20, 90, 18],
    vixDates: ["2026-01-02", "2020-01-01", "2026-01-01"],
    vixValues: [24, 80, 16],
  }, ["2026-01-02", "2026-01-01"]);

  assert.deepEqual(ranges.adr, [77.5, 121.2]);
  assert.deepEqual(ranges.news, [88, 112]);
  assert.deepEqual(ranges.vkospi, [15, 25]);
});
