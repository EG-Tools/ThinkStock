function pathVersionMatches(value, expected) {
  const text = String(value || "");
  const target = String(expected || "");
  return Boolean(target && (text === target || text.endsWith(`|${target}`)));
}

export function evaluateAiReleaseGate(options = {}) {
  const runtimePathVersion = String(options.runtimePathVersion || "");
  const summary = options.summary || {};
  const comparison = options.comparison || {};
  const runtimeChanged = options.runtimeChanged === true;
  const approvedIncumbentPathVersion = String(options.approvedIncumbentPathVersion || "");
  const errors = [];
  const warnings = [];
  const championVersion = String(summary.championVersion || "");
  const challengerVersion = String(summary.challengerVersion || "");
  const activeVersion = String(summary.activeVersion || (
    summary.promotionAllowed === true ? challengerVersion : championVersion
  ));
  const runtimeIsChampion = pathVersionMatches(championVersion, runtimePathVersion);
  const runtimeIsChallenger = pathVersionMatches(challengerVersion, runtimePathVersion);
  const runtimeIsApprovedIncumbent = !runtimeChanged
    && pathVersionMatches(approvedIncumbentPathVersion, runtimePathVersion);

  if (!runtimePathVersion) errors.push("runtime-path-version-missing");
  if (!runtimeIsChampion && !runtimeIsChallenger && !runtimeIsApprovedIncumbent) {
    errors.push("validation-version-mismatch");
  }
  if (activeVersion && !pathVersionMatches(activeVersion, runtimePathVersion) && !runtimeIsApprovedIncumbent) {
    errors.push("unpromoted-challenger-active");
  }
  if (summary.pointInTime?.auditPassed !== true) errors.push("point-in-time-audit-failed");
  if (comparison.format !== "thinkstock-ai-walkforward-comparison-v6") {
    errors.push("comparison-format-outdated");
  }
  if (Math.max(0, Number(comparison.matchedObservations) || 0) < 1) {
    errors.push("matched-observations-missing");
  }
  if (runtimeChanged && summary.regressionPassed !== true) {
    errors.push("runtime-regression-detected");
  }
  if (summary.benchmarkOutperformanceConfirmed !== true) {
    warnings.push("no-change-benchmark-not-beaten");
  }
  if (summary.pointInTime?.coverage?.companyEvidenceReady !== true) {
    warnings.push("point-in-time-company-evidence-incomplete");
  }
  if (summary.releaseDecision === "keep-champion") warnings.push("champion-retained");
  if (runtimeIsApprovedIncumbent && !runtimeIsChampion) {
    warnings.push("approved-incumbent-differs-from-benchmark-champion");
  }

  return Object.freeze({
    ok: errors.length === 0,
    runtimeChanged,
    runtimePathVersion,
    runtimeIsApprovedIncumbent,
    activeVersion,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
}
