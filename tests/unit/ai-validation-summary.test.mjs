import assert from "node:assert/strict";
import test from "node:test";

import { buildAiValidationSummary } from "../../shared/ai-validation-summary.mjs";

function validationInput(overrides = {}) {
  return {
    generatedAt: "2026-08-14T00:00:00.000Z",
    report: {
      enginePathVersion: "challenger",
      overall: {
        samples: 100,
        directionAccuracy: 0.55,
        improvementVsNoChange: 0.02,
      },
      sourceCoverage: {
        analysisSnapshots: 20,
        pointInTimeFeatureCoverage: {
          eligibleAnchors: 100,
          snapshotAnchors: 80,
          snapshotRate: 0.8,
          consensusRate: 0.7,
          financialRate: 0.6,
          newsRate: 0.5,
        },
      },
    },
    comparison: {
      previousVersion: "champion",
      currentVersion: "challenger",
      cohorts: {
        holdout: {
          126: {
            after: { samples: 40, directionAccuracy: 0.56, improvementVsNoChange: 0.03 },
            delta: { directionAccuracyPoints: 2, errorReduction: 0.04 },
          },
        },
      },
    },
    evaluation: {
      passed: true,
      decision: "promote-challenger",
      promotionRecommended: true,
      benchmarkOutperformanceConfirmed: true,
      promotionEvidence: { comparableHorizons: [126], improvedHorizons: [126] },
      warnings: [],
      failures: [],
    },
    pointInTimeAudit: {
      passed: true,
      observations: 300,
      auditedSourceDates: 900,
      issueCounts: {},
    },
    ...overrides,
  };
}

test("validation summary permits only a tested, materially better challenger", () => {
  const summary = buildAiValidationSummary(validationInput());

  assert.equal(summary.releaseDecision, "promote-challenger");
  assert.equal(summary.promotionAllowed, true);
  assert.equal(summary.holdout[126].samples, 40);
  assert.equal(summary.holdout[126].directionAccuracyPoints, 2);
  assert.equal(summary.holdout[20].scenarioAccuracy, null);
  assert.equal(summary.pointInTime.coverage.companyEvidenceReady, true);
});

test("validation summary blocks promotion when historical company evidence is absent", () => {
  const input = validationInput();
  input.report.sourceCoverage.pointInTimeFeatureCoverage.snapshotAnchors = 0;
  input.report.sourceCoverage.pointInTimeFeatureCoverage.snapshotRate = 0;
  const summary = buildAiValidationSummary(input);

  assert.equal(summary.releaseDecision, "hold-for-evidence");
  assert.equal(summary.promotionRecommended, true);
  assert.equal(summary.promotionAllowed, false);
  assert.match(summary.warnings.at(-1), /point-in-time company evidence/);
});

test("validation summary requires meaningful point-in-time coverage", () => {
  const input = validationInput();
  input.report.sourceCoverage.pointInTimeFeatureCoverage = {
    eligibleAnchors: 100,
    snapshotAnchors: 1,
    snapshotRate: 0.01,
    consensusRate: 0.01,
    financialRate: 0,
    newsRate: 0,
  };
  const summary = buildAiValidationSummary(input);

  assert.equal(summary.pointInTime.coverage.minimumSnapshotAnchors, 20);
  assert.equal(summary.pointInTime.coverage.familyEvidenceReady, false);
  assert.equal(summary.pointInTime.coverage.companyEvidenceReady, false);
  assert.equal(summary.promotionAllowed, false);
});

test("validation summary cannot promote without beating simple benchmarks", () => {
  const input = validationInput();
  input.evaluation.benchmarkOutperformanceConfirmed = false;
  const summary = buildAiValidationSummary(input);

  assert.equal(summary.releaseDecision, "hold-for-benchmark");
  assert.equal(summary.promotionAllowed, false);
});

test("validation summary keeps the champion after any regression", () => {
  const input = validationInput();
  input.evaluation = {
    ...input.evaluation,
    passed: false,
    decision: "keep-champion",
    promotionRecommended: false,
    failures: ["63d risk-on error regression"],
  };
  const summary = buildAiValidationSummary(input);

  assert.equal(summary.releaseDecision, "keep-champion");
  assert.equal(summary.regressionPassed, false);
  assert.equal(summary.promotionAllowed, false);
  assert.deepEqual(summary.failures, ["63d risk-on error regression"]);
});
