import assert from "node:assert/strict";
import test from "node:test";

import {
  EVENT_MARKER_FONT_FAMILY,
  assertChartRenderPayload,
  buildEventMarkerTextFont,
  chartRenderPayloadIssue,
  normalizeAuxiliaryChartModel,
  normalizeMainChartModel,
} from "../../docs/modules/chart-render-contract.mjs";

test("shares one event marker text style contract", () => {
  assert.deepEqual(buildEventMarkerTextFont("#fff", 15), {
    color: "#fff",
    family: EVENT_MARKER_FONT_FAMILY,
    size: 15,
  });
});

test("normalizes one valid main chart model without copying point arrays", () => {
  const values = [100, 101];
  const model = normalizeMainChartModel({
    rows: [{ date: "2026-08-24" }, { date: "2026-08-25" }],
    seriesModels: [{
      series: "005930.KS",
      xValues: ["2026-08-24", "2026-08-25"],
      values,
      baseValues: [100, 101],
    }],
  });
  assert.equal(model.seriesModels[0].values, values);
  assert.deepEqual(model.selected, []);
  assert.equal(normalizeMainChartModel({ rows: [{}], seriesModels: [{ series: "A", xValues: [1], values: [] }] }), null);
});

test("accepts aligned auxiliary series and rejects one mismatched pair", () => {
  const model = Object.fromEntries([
    ["adrKospi", 2], ["adrKosdaq", 2], ["fearGreed", 1],
    ["news", 1], ["vkospi", 1], ["vix", 1],
  ].flatMap(([key, count]) => [
    [`${key}Dates`, Array.from({ length: count }, (_, index) => `2026-08-${20 + index}`)],
    [`${key}Values`, Array.from({ length: count }, (_, index) => index + 1)],
  ]));
  assert.equal(normalizeAuxiliaryChartModel(model), model);
  assert.equal(normalizeAuxiliaryChartModel({ ...model, vixValues: [] }), null);
});

test("shares one light trace and layout contract across chart renderers", () => {
  assert.equal(chartRenderPayloadIssue([{ x: [1], y: [2] }], { xaxis: {} }), "");
  assert.throws(
    () => assertChartRenderPayload([{ x: [1, 2], y: [2] }], {}),
    /x\/y length mismatch/,
  );
});
