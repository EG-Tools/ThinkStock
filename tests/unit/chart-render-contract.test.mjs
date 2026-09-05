import assert from "node:assert/strict";
import test from "node:test";

import {
  EVENT_MARKER_FONT_FAMILY,
  assertMainChartRenderPayload,
  assertChartRenderPayload,
  buildEventMarkerTextFont,
  chartRenderPayloadIssue,
  normalizeAuxiliaryChartModel,
  normalizeMainChartModel,
  mainChartRenderPayloadIssue,
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

test("accepts an explicit hidden trace slot without retained point arrays", () => {
  const model = normalizeMainChartModel({
    rows: [{ date: "2026-08-24" }],
    seriesModels: [{
      series: "005930.KS",
      hidden: true,
      xValues: [],
      values: [],
      baseValues: [],
    }],
  });

  assert.equal(model.seriesModels[0].hidden, true);
  assert.equal(normalizeMainChartModel({
    rows: [{ date: "2026-08-24" }],
    seriesModels: [{ series: "005930.KS", xValues: [], values: [] }],
  }), null);
});

test("accepts an explicit empty model while visible prices are still loading", () => {
  const model = normalizeMainChartModel({
    empty: true,
    rows: [],
    allSeries: [],
    selected: [],
    seriesModels: [],
  });

  assert.equal(model.empty, true);
  assert.deepEqual(model.rows, []);
  assert.deepEqual(model.seriesModels, []);
  assert.equal(normalizeMainChartModel({ rows: [{ date: "2026-08-24" }], seriesModels: [] }), null);
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

test("requires every main trace to declare one known overlay kind", () => {
  const price = {
    x: ["2026-08-20"],
    y: [100],
    meta: { overlayKind: "price", seriesKey: "005930.KS" },
  };
  assert.equal(mainChartRenderPayloadIssue([price], {}), "");
  assert.equal(
    mainChartRenderPayloadIssue([{ ...price, meta: { seriesKey: "005930.KS" } }], {}),
    "main chart trace 0 must declare meta.overlayKind",
  );
  assert.throws(
    () => assertMainChartRenderPayload([{ ...price, meta: { overlayKind: "unknown" } }], {}),
    /unknown overlay kind/,
  );
});
