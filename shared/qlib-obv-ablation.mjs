import { QLIB_CHALLENGER_HORIZONS } from "./qlib-challenger-contract.mjs";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function featureNames(report) {
  return [...new Set((report?.sample?.featureNames || []).map(String))].sort();
}

function metricDelta(baseline, candidate, key) {
  const before = finite(baseline?.[key]);
  const after = finite(candidate?.[key]);
  return before === null || after === null ? null : rounded(after - before);
}

export function compareQlibObvAblation(baseline, candidate, options = {}) {
  const minimumSamples = Math.max(30, Math.trunc(finite(options.minimumSamples) ?? 100));
  const errors = [];
  if (baseline?.featureSet !== "baseline") errors.push("baseline-feature-set-invalid");
  if (candidate?.featureSet !== "obv") errors.push("candidate-feature-set-invalid");
  for (const key of ["priceFingerprint", "contextFingerprint"]) {
    if (!baseline?.manifest?.[key]
      || baseline.manifest[key] !== candidate?.manifest?.[key]) {
      errors.push(`${key}-mismatch`);
    }
  }
  const baselineFeatures = featureNames(baseline);
  const candidateFeatures = featureNames(candidate);
  const candidateCore = candidateFeatures.filter((name) => !name.startsWith("obv_"));
  const obvFeatures = candidateFeatures.filter((name) => name.startsWith("obv_"));
  if (baselineFeatures.some((name) => name.startsWith("obv_"))) {
    errors.push("baseline-contains-obv");
  }
  if (JSON.stringify(baselineFeatures) !== JSON.stringify(candidateCore)) {
    errors.push("non-obv-feature-set-mismatch");
  }
  if (obvFeatures.length < 3) errors.push("obv-feature-family-incomplete");

  const horizons = Object.fromEntries(QLIB_CHALLENGER_HORIZONS.map((horizon) => {
    const before = baseline?.horizons?.[horizon]?.holdout || {};
    const after = candidate?.horizons?.[horizon]?.holdout || {};
    const samplesMatch = finite(before.samples) === finite(after.samples);
    const datesMatch = before.firstDate === after.firstDate && before.lastDate === after.lastDate;
    const rankIcDelta = metricDelta(before, after, "meanDailyRankIc");
    const spreadDelta = metricDelta(before, after, "topBottomActualSpread");
    const directionDelta = metricDelta(before, after, "directionAccuracy");
    const improvementDelta = metricDelta(before, after, "improvementVsNoChange");
    const enoughSamples = (finite(after.samples) ?? 0) >= minimumSamples;
    const win = samplesMatch && datesMatch && enoughSamples
      && (rankIcDelta ?? -Infinity) >= 0.002
      && (spreadDelta ?? -Infinity) > 0
      && (directionDelta ?? -Infinity) >= -0.01
      && (improvementDelta ?? -Infinity) >= -0.01;
    const severeRegression = !samplesMatch || !datesMatch
      || (rankIcDelta ?? -Infinity) < -0.005
      || (spreadDelta ?? -Infinity) < -0.002
      || (directionDelta ?? -Infinity) < -0.02;
    return [horizon, {
      samples: finite(after.samples) ?? 0,
      samplesMatch,
      datesMatch,
      rankIcDelta,
      spreadDelta,
      directionDelta,
      improvementVsNoChangeDelta: improvementDelta,
      win,
      severeRegression,
    }];
  }));
  const wins = Object.values(horizons).filter((row) => row.win).length;
  const severeRegressions = Object.values(horizons).filter((row) => row.severeRegression).length;
  const passed = errors.length === 0 && wins >= 2 && severeRegressions === 0;
  return Object.freeze({
    format: "thinkstock-qlib-obv-ablation-v1",
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    minimumSamples,
    baselineFeatures: baselineFeatures.length,
    candidateFeatures: candidateFeatures.length,
    obvFeatures: Object.freeze(obvFeatures),
    horizons: Object.freeze(horizons),
    wins,
    requiredWins: 2,
    severeRegressions,
    passed,
    decision: passed ? "freeze-obv-for-sealed-audit" : "keep-baseline",
    runtimeIntegrationEligible: false,
  });
}
