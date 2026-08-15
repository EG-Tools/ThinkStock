import { WALKFORWARD_HORIZONS } from "./ai-walkforward-comparison.mjs";
import { finiteOrNull } from "./runtime-foundation.mjs";

export const MINIMUM_POINT_IN_TIME_SNAPSHOT_ANCHORS = 30;
export const MINIMUM_POINT_IN_TIME_SNAPSHOT_RATE = 0.2;
export const MINIMUM_POINT_IN_TIME_FAMILY_RATE = 0.1;

function compactMetrics(value = {}) {
  return Object.freeze({
    samples: Math.max(0, Math.trunc(Number(value.samples) || 0)),
    directionAccuracy: finiteOrNull(value.directionAccuracy),
    meanAbsoluteLogError: finiteOrNull(value.meanAbsoluteLogError),
    improvementVsNoChange: finiteOrNull(value.improvementVsNoChange),
    improvementVsMomentum: finiteOrNull(value.improvementVsMomentum),
    scenarioAccuracy: finiteOrNull(value.scenarioAccuracy),
    scenarioBrierScore: finiteOrNull(value.scenarioBrierScore),
    meanPredictedReturn: finiteOrNull(value.meanPredictedReturn),
    meanActualReturn: finiteOrNull(value.meanActualReturn),
  });
}

function compactHoldout(result = {}) {
  return Object.freeze({
    ...compactMetrics(result.after),
    directionAccuracyPoints: finiteOrNull(result.delta?.directionAccuracyPoints),
    errorReduction: finiteOrNull(result.delta?.errorReduction),
    noChangeSkillPoints: finiteOrNull(result.delta?.noChangeSkillPoints),
    momentumSkillPoints: finiteOrNull(result.delta?.momentumSkillPoints),
    scenarioBrierReduction: finiteOrNull(result.delta?.scenarioBrierReduction),
  });
}

const SEGMENT_FAMILIES = Object.freeze([
  "markets",
  "regimes",
  "volatilityGroups",
  "behaviors",
  "cycles",
  "archetypes",
  "probabilisticRegimes",
]);

function compactSegmentFamilies(comparison = {}) {
  return Object.freeze(Object.fromEntries(SEGMENT_FAMILIES.map((family) => [
    family,
    Object.freeze(Object.fromEntries(Object.entries(comparison?.[family] || {}).map(([name, horizons]) => [
      name,
      Object.freeze(Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
        String(horizon),
        compactHoldout(horizons?.[horizon]),
      ]))),
    ]))),
  ])));
}

function segmentRegressionSafety(comparison = {}) {
  const issues = [];
  SEGMENT_FAMILIES.forEach((family) => {
    Object.entries(comparison?.[family] || {}).forEach(([name, horizons]) => {
      WALKFORWARD_HORIZONS.forEach((horizon) => {
        const row = horizons?.[horizon] || {};
        const samples = Math.max(0, Number(row?.after?.samples) || 0);
        if (samples < 20) return;
        const directionDelta = finiteOrNull(row?.delta?.directionAccuracyPoints);
        const errorReduction = finiteOrNull(row?.delta?.errorReduction);
        if ((directionDelta !== null && directionDelta <= -5)
          || (errorReduction !== null && errorReduction <= -0.05)) {
          issues.push(Object.freeze({
            family,
            name,
            horizon,
            samples,
            directionAccuracyPoints: directionDelta,
            errorReduction,
          }));
        }
      });
    });
  });
  return Object.freeze({ passed: issues.length === 0, issues: Object.freeze(issues) });
}

function pointInTimeCoverage(report = {}) {
  const sourceCoverage = report.sourceCoverage || {};
  const coverage = sourceCoverage.pointInTimeFeatureCoverage || {};
  const analysisSnapshots = Math.max(0, Math.trunc(Number(sourceCoverage.analysisSnapshots) || 0));
  const eligibleAnchors = Math.max(0, Math.trunc(Number(coverage.eligibleAnchors) || 0));
  const snapshotAnchors = Math.max(0, Math.trunc(Number(coverage.snapshotAnchors) || 0));
  const snapshotRate = finiteOrNull(coverage.snapshotRate) || 0;
  const consensusRate = finiteOrNull(coverage.consensusRate) || 0;
  const financialRate = finiteOrNull(coverage.financialRate) || 0;
  const newsRate = finiteOrNull(coverage.newsRate) || 0;
  const disclosureRate = finiteOrNull(coverage.disclosureRate) || 0;
  const companyEvidenceExpected = analysisSnapshots > 0
    || sourceCoverage.pointInTimeConsensus === true
    || sourceCoverage.pointInTimeFinancials === true
    || sourceCoverage.pointInTimeDisclosures === true;
  const minimumSnapshotAnchors = eligibleAnchors > 0
    ? Math.min(
      MINIMUM_POINT_IN_TIME_SNAPSHOT_ANCHORS,
      Math.max(3, Math.ceil(eligibleAnchors * MINIMUM_POINT_IN_TIME_SNAPSHOT_RATE)),
    )
    : MINIMUM_POINT_IN_TIME_SNAPSHOT_ANCHORS;
  const familyRate = Math.max(consensusRate, financialRate, newsRate, disclosureRate);
  const familyEvidenceReady = familyRate >= MINIMUM_POINT_IN_TIME_FAMILY_RATE;
  const companyEvidenceReady = !companyEvidenceExpected
    || (
      snapshotAnchors >= minimumSnapshotAnchors
      && snapshotRate >= MINIMUM_POINT_IN_TIME_SNAPSHOT_RATE
      && familyEvidenceReady
    );
  return Object.freeze({
    eligibleAnchors,
    snapshotAnchors,
    snapshotRate,
    consensusRate,
    financialRate,
    newsRate,
    disclosureRate,
    analysisSnapshots,
    minimumSnapshotAnchors,
    minimumSnapshotRate: MINIMUM_POINT_IN_TIME_SNAPSHOT_RATE,
    minimumFamilyRate: MINIMUM_POINT_IN_TIME_FAMILY_RATE,
    familyEvidenceReady,
    companyEvidenceExpected,
    companyEvidenceReady,
  });
}

export function buildAiValidationSummary(options = {}) {
  const report = options.report || {};
  const comparison = options.comparison || {};
  const evaluation = options.evaluation || {};
  const audit = options.pointInTimeAudit || {};
  const baselineCreated = options.baselineCreated === true;
  const coverage = pointInTimeCoverage(report);
  const segmentSafety = segmentRegressionSafety(comparison);
  const auditPassed = audit.passed === true;
  const regressionPassed = baselineCreated || evaluation.passed === true;
  const promotionRecommended = !baselineCreated && evaluation.promotionRecommended === true;
  const promotionAllowed = promotionRecommended
    && regressionPassed
    && auditPassed
    && evaluation.benchmarkOutperformanceConfirmed === true
    && coverage.companyEvidenceReady
    && segmentSafety.passed;
  let releaseDecision = String(evaluation.decision || "keep-champion");
  if (baselineCreated) releaseDecision = "baseline-created";
  else if (!regressionPassed || !auditPassed) releaseDecision = "keep-champion";
  else if (promotionRecommended && evaluation.benchmarkOutperformanceConfirmed !== true) {
    releaseDecision = "hold-for-benchmark";
  }
  else if (promotionRecommended && !coverage.companyEvidenceReady) releaseDecision = "hold-for-evidence";
  else if (promotionRecommended && !segmentSafety.passed) releaseDecision = "hold-for-segment-regression";
  else if (promotionAllowed) releaseDecision = "promote-challenger";

  const championVersion = String(
    comparison.previousVersion || (baselineCreated ? report.enginePathVersion : ""),
  );
  const challengerVersion = String(comparison.currentVersion || report.enginePathVersion || "");
  const activeVersion = promotionAllowed || baselineCreated
    ? challengerVersion
    : championVersion;

  const warnings = [...new Set([
    ...Array.isArray(evaluation.warnings) ? evaluation.warnings : [],
    ...(!coverage.companyEvidenceReady
      ? ["point-in-time company evidence is not represented in the walk-forward sample"]
      : []),
  ].map(String).filter(Boolean))];
  const failures = [...new Set([
    ...Array.isArray(evaluation.failures) ? evaluation.failures : [],
    ...(!auditPassed && !baselineCreated ? ["point-in-time audit failed"] : []),
  ].map(String).filter(Boolean))];
  const holdout = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
    String(horizon),
    compactHoldout(comparison?.cohorts?.holdout?.[horizon]),
  ]));

  return Object.freeze({
    format: "thinkstock-ai-validation-summary-v1",
    generatedAt: String(options.generatedAt || new Date().toISOString()),
    championVersion,
    challengerVersion,
    activeVersion,
    releaseDecision,
    regressionPassed,
    benchmarkOutperformanceConfirmed: evaluation.benchmarkOutperformanceConfirmed === true,
    promotionRecommended,
    promotionAllowed,
    overall: compactMetrics(report.overall),
    holdout: Object.freeze(holdout),
    pointInTime: Object.freeze({
      auditPassed,
      observations: Math.max(0, Math.trunc(Number(audit.observations) || 0)),
      auditedSourceDates: Math.max(0, Math.trunc(Number(audit.auditedSourceDates) || 0)),
      issueCounts: Object.freeze({ ...(audit.issueCounts || {}) }),
      coverage,
    }),
    segments: compactSegmentFamilies(comparison),
    segmentSafety,
    promotionEvidence: Object.freeze({ ...(evaluation.promotionEvidence || {}) }),
    warnings: Object.freeze(warnings),
    failures: Object.freeze(failures),
  });
}
