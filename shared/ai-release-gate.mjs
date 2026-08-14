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
  const errors = [];
  const warnings = [];

  if (!runtimePathVersion) errors.push("runtime-path-version-missing");
  if (!pathVersionMatches(summary.challengerVersion, runtimePathVersion)) {
    errors.push("validation-version-mismatch");
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

  return Object.freeze({
    ok: errors.length === 0,
    runtimeChanged,
    runtimePathVersion,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
}
