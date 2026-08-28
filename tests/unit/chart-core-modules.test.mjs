import assert from "node:assert/strict";
import test from "node:test";

import auxiliaryChartModel from "../../docs/modules/auxiliary-chart-model.mjs";
import chartAdjustments from "../../docs/modules/chart-adjustments.mjs";
import chartDisplaySampler from "../../docs/modules/chart-display-sampler.mjs";
import dataPayload from "../../docs/modules/data-payload.mjs";
import macdOscillator from "../../docs/modules/macd-oscillator.mjs";
import mainChartModel from "../../docs/modules/main-chart-model.mjs";
import marketData from "../../docs/modules/market-data.mjs";

test("chart core exposes explicit ESM APIs and removes page-global registrations", () => {
  assert.equal(typeof marketData.getSeriesColumns, "function");
  assert.equal(typeof chartDisplaySampler.buildDisplayIndexes, "function");
  assert.equal(typeof dataPayload.parsePayloadText, "function");
  assert.equal(typeof macdOscillator.buildMacdOscillator, "function");
  assert.equal(typeof chartAdjustments.fitRangeForTraces, "function");
  assert.equal(typeof auxiliaryChartModel.buildAuxiliaryChartModel, "function");
  assert.equal(typeof mainChartModel.buildMainChartModel, "function");
  assert.equal(globalThis.ThinkStockMarketData, undefined);
  assert.equal(globalThis.ThinkStockChartAdjustments, undefined);
  assert.equal(globalThis.ThinkStockChartDisplaySampler, undefined);
  assert.equal(globalThis.ThinkStockAuxiliaryChartModel, undefined);
  assert.equal(globalThis.ThinkStockMainChartModel, undefined);
  assert.equal(globalThis.ThinkStockDataPayload, undefined);
  assert.equal(globalThis.ThinkStockMacdOscillator, undefined);
});

test("main chart model keeps captured dependencies after globals are removed", () => {
  const model = mainChartModel.buildMainChartModel({
    priceRows: [
      { date: "2026-08-24", TEST: 100 },
      { date: "2026-08-25", TEST: 105 },
    ],
    macroRows: [],
    creditRows: [],
    allowedSeries: ["TEST"],
    hiddenSeries: [],
    start: "2026-08-24",
    end: "2026-08-25",
    frameStart: "2026-08-24",
    frameEnd: "2026-08-25",
    preserveDailyPoints: true,
  });
  assert.deepEqual(model.selected, ["TEST"]);
  assert.equal(model.rows.length, 2);
});
