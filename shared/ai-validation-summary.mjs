import { WALKFORWARD_HORIZONS } from "./ai-walkforward-comparison.mjs";

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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

function pointInTimeCoverage(report = {}) {
  const sourceCoverage = report.sourceCoverage || {};
  const coverage = sourceCoverage.pointInTimeFeatureCoverage || {};
  const analysisSnapshots = Math.max(0, Math.trunc(Number(sourceCoverage.analysisSnapshots) || 0));
  const snapshotAnchors = Math.max(0, Math.trunc(Number(coverage.snapshotAnchors) || 0));
  const snapshotRate = finiteOrNull(coverage.snapshotRate) || 0;
  const companyEvidenceExpected = analysisSnapshots > 0
    || sourceCoverage.pointInTimeConsensus === true
    || sourceCoverage.pointInTimeFinancials === true
    || sourceCoverage.pointInTimeDisclosures === true;
  const companyEvidenceReady = !companyEvidenceExpected
    || (snapshotAnchors > 0 && snapshotRate > 0);
  return Object.freeze({
    eligibleAnchors: Math.max(0, Math.trunc(Number(coverage.eligibleAnchors) || 0)),
    snapshotAnchors,
    snapshotRate,
    consensusRate: finiteOrNull(coverage.consensusRate) || 0,
    financialRate: finiteOrNull(coverage.financialRate) || 0,
    newsRate: finiteOrNull(coverage.newsRate) || 0,
    analysisSnapshots,
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
  const auditPassed = audit.passed === true;
  const regressionPassed = baselineCreated || evaluation.passed === true;
  const promotionRecommended = !baselineCreated && evaluation.promotionRecommended === true;
  const promotionAllowed = promotionRecommended
    && regressionPassed
    && auditPassed
    && coverage.companyEvidenceReady;
  let releaseDecision = String(evaluation.decision || "keep-champion");
  if (baselineCreated) releaseDecision = "baseline-created";
  else if (!regressionPassed || !auditPassed) releaseDecision = "keep-champion";
  else if (promotionRecommended && !coverage.companyEvidenceReady) releaseDecision = "hold-for-evidence";
  else if (promotionAllowed) releaseDecision = "promote-challenger";

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
    championVersion: String(comparison.previousVersion || (baselineCreated ? report.enginePathVersion : "")),
    challengerVersion: String(comparison.currentVersion || report.enginePathVersion || ""),
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
    promotionEvidence: Object.freeze({ ...(evaluation.promotionEvidence || {}) }),
    warnings: Object.freeze(warnings),
    failures: Object.freeze(failures),
  });
}
