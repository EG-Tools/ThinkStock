import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/auxiliary-chart-model.js");
const {
  buildAuxiliaryChartModel,
  buildThresholdZones,
} = globalThis.ThinkStockAuxiliaryChartModel;


test("threshold zones preserve seam points at low and high crossings", () => {
  const zones = buildThresholdZones([100, 70, 90, 130, 110, null], 80, 120);

  assert.deepEqual(zones.low, [null, 70, 90, null, null, null]);
  assert.deepEqual(zones.middle, [100, 70, 90, 130, 110, null]);
  assert.deepEqual(zones.high, [null, null, null, 130, 110, null]);
  assert.deepEqual(zones.lowBaseline, [null, 80, 80, null, null, null]);
  assert.deepEqual(zones.highBaseline, [null, null, null, 120, 120, null]);
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
  });

  assert.deepEqual(model.dates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(model.newsDates, ["2026-01-03", "2026-01-04"]);
  assert.deepEqual(model.kospiValues, [75, 85]);
  assert.deepEqual(model.newsValues, [105, 112]);
  assert.equal(model.adrRowCount, 2);
  assert.equal(model.newsRowCount, 2);
  assert.ok(model.adrYMin < 75);
  assert.ok(model.newsYMax > 112);
});
