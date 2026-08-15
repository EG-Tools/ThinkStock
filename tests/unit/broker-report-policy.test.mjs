import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerReportEvaluationEvent,
  evaluateBrokerReportEvents,
  reportAvailableDate,
  reportIsAvailableAt,
  scoreBrokerReportEvidence,
} from "../../shared/broker-report-policy.mjs";

test("evaluation events freeze the point-in-time signal and policy version", () => {
  const event = brokerReportEvaluationEvent("005930.KS", {
    reportId: "101",
    publishedDate: "2026-08-14",
    confidence: 0.8,
    metrics: {
      eps: { growth: 0.2 },
      roe: { growth: 2.5 },
    },
    targetPriceChange: 0.1,
  });
  assert.equal(event.availableDate, "2026-08-17");
  assert.equal(event.policyVersion, "broker-policy-v1");
  assert.ok(event.signal > 0);
  assert.ok(event.confidence > 0);
  assert.equal(event.evidence.epsChange, 0.2);
});

test("historical report availability is conservative and blocks future leakage", () => {
  const report = { publishedDate: "2026-08-14" };
  assert.equal(reportAvailableDate(report), "2026-08-14");
  assert.equal(reportAvailableDate(report, { historicalMode: true }), "2026-08-17");
  assert.equal(reportIsAvailableAt(report, "2026-08-14", { historicalMode: true }), false);
  assert.equal(reportIsAvailableAt(report, "2026-08-17", { historicalMode: true }), true);
  assert.equal(reportIsAvailableAt({ publishedDate: "2026-08-18" }, "2026-08-17"), false);
});

test("report scoring keeps target cuts asymmetric and measurable", () => {
  const raised = scoreBrokerReportEvidence({
    epsChange: 0,
    roeChange: 0,
    targetRevisionChange: 0.1,
    hasTargetRevision: true,
    parserConfidence: 0.8,
    coverageConfidence: 0.8,
    primaryCoverage: 1,
    targetDeviation: 0.05,
  });
  const cut = scoreBrokerReportEvidence({
    epsChange: 0,
    roeChange: 0,
    targetRevisionChange: -0.1,
    hasTargetRevision: true,
    targetCutBreadth: 1,
    targetCutStreak: 2,
    parserConfidence: 0.8,
    coverageConfidence: 0.8,
    primaryCoverage: 1,
    targetDeviation: 0.05,
  });
  assert.ok(cut.signal < -raised.signal);
  assert.ok(Math.abs(cut.adjustment) > Math.abs(raised.adjustment));
});

test("report event evaluator uses prices after the conservative availability date", () => {
  const rows = Array.from({ length: 70 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 7, 17 + index)).toISOString().slice(0, 10),
    close: 100 + index,
  }));
  const result = evaluateBrokerReportEvents([
    { ticker: "005930.KS", reportId: "1", publishedDate: "2026-08-14", signal: 0.5 },
  ], { "005930.KS": rows }, { horizon: 20 });
  assert.equal(result.samples, 1);
  assert.equal(result.observations[0].availableDate, "2026-08-17");
  assert.equal(result.observations[0].directionCorrect, true);
});
