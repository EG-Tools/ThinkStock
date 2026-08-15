import assert from "node:assert/strict";
import test from "node:test";

import {
  QLIB_MATCHED_ANCHOR_FORMAT,
  evaluateQlibMatchedAssist,
  matchQlibAndThinkStockAnchors,
} from "../../shared/qlib-matched-anchor.mjs";

function cohortRows(cohort, residual = 0.02) {
  const qlib = [];
  const observations = [];
  [20, 63, 126].forEach((horizon) => {
    for (let index = 0; index < 30; index += 1) {
      const ticker = `${String(index + 1).padStart(6, "0")}.KS`;
      const date = `2025-${String((index % 9) + 1).padStart(2, "0")}-${String((index % 20) + 1).padStart(2, "0")}`;
      qlib.push({
        cohort,
        horizon,
        date,
        instrument: ticker,
        market: "KOSPI",
        absoluteActual: residual,
        predicted: residual,
      });
      observations.push({
        targetType: "stock",
        series: ticker,
        market: "KOSPI",
        horizon,
        cutoff: date,
        actualReturn: Math.expm1(residual),
        predictedReturn: 0,
      });
    }
  });
  return { qlib, report: { observations } };
}

test("matched anchors select only identical ticker, horizon and date rows", () => {
  const source = cohortRows("audit");
  source.report.observations.push({
    targetType: "stock",
    series: "999999.KS",
    horizon: 20,
    cutoff: "2025-01-01",
    actualReturn: 0.02,
    predictedReturn: 0,
  });
  const matched = matchQlibAndThinkStockAnchors(source.qlib, source.report, "audit");
  assert.equal(matched.matchedRows, 90);
  assert.equal(matched.actualMismatch, 0);
});

test("runtime assist needs improvement in two independent audit cohorts", () => {
  const primarySource = cohortRows("audit");
  const confirmationSource = cohortRows("confirmationAudit");
  const result = evaluateQlibMatchedAssist({
    primary: matchQlibAndThinkStockAnchors(primarySource.qlib, primarySource.report, "audit"),
    confirmation: matchQlibAndThinkStockAnchors(
      confirmationSource.qlib,
      confirmationSource.report,
      "confirmationAudit",
    ),
  });
  assert.equal(result.format, QLIB_MATCHED_ANCHOR_FORMAT);
  assert.equal(result.passed, true);
  assert.equal(result.selectedWeight, 0.15);
  assert.ok(result.runtimeAssist);
});

test("missing confirmation matches keep the ThinkStock champion", () => {
  const primarySource = cohortRows("audit");
  const result = evaluateQlibMatchedAssist({
    primary: matchQlibAndThinkStockAnchors(primarySource.qlib, primarySource.report, "audit"),
    confirmation: { rows: [] },
  });
  assert.equal(result.passed, false);
  assert.equal(result.status, "confirmation-failed");
  assert.equal(result.runtimeAssist, null);
});
