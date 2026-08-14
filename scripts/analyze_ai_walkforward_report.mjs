import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WALKFORWARD_ARCHETYPES,
  WALKFORWARD_PROBABILISTIC_REGIMES,
  buildWalkforwardAblation,
  summarizeWalkforwardReport,
} from "../shared/ai-walkforward-comparison.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, ".thinkstock-cache", "ai-backtest", "walkforward-report.json");
const OUTPUT_PATH = path.join(ROOT, ".thinkstock-cache", "ai-backtest", "walkforward-diagnostics.json");
const HORIZONS = [20, 63, 126];
const FEATURE_KEYS = [
  "price_momentum_5",
  "price_momentum_20",
  "price_momentum_63",
  "price_momentum_126",
  "price_momentum_252",
  "projected_volatility",
  "environment_combined",
  "market_correlation",
  "market_beta",
  "market_downside_beta",
  "regime_support",
  "regime_risk",
  "regime_range",
  "regime_adjustment",
  "regime_crisis_score",
  "regime_macd",
  "adr_latest",
  "adr_change_28d",
  "adr_recent_high_28d",
  "adr_recent_low_28d",
  "adr_overheat_current",
  "adr_overheat_exit_28d",
  "adr_depressed_current",
  "adr_depression_exit_28d",
  "leading_peak",
  "leading_slowdown",
  "leading_recovery",
  "leading_expansion",
  "price_range_bound_score",
  "price_range_position",
  "price_mean_reversion_return",
  "price_annualized_return",
  "price_trend_r_squared",
  "price_breakout_strength",
  "profile_history_years",
  "profile_quality",
  "profile_long_volatility",
  "profile_recent_volatility",
  "profile_trend_up_score",
  "profile_trend_down_score",
  "profile_range_score",
  "profile_cycle_score",
  "profile_low_volatility_score",
  "profile_high_volatility_score",
  "profile_defensive_score",
  "profile_index_independent_score",
  "profile_persistent_decline_score",
  "profile_current_drawdown",
  "profile_reversal_readiness",
  "regime_probability_recovery",
  "regime_probability_expansion",
  "regime_probability_late_cycle",
  "regime_probability_slowdown",
  "regime_probability_stress",
  "regime_probability_range",
  "rotation_support",
  "rotation_risk",
  "rotation_leader_cooling",
  "macro_leading_cycle",
  "credit_customer_deposit",
  "credit_kospi_credit",
  "credit_kosdaq_credit",
  "crisis_score",
];

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rounded(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function pearson(left, right) {
  const size = Math.min(left.length, right.length);
  if (size < 3) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < size; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : 0;
}

function featureDiagnostics(rows) {
  return Object.fromEntries(FEATURE_KEYS.flatMap((key) => {
    const pairs = rows.flatMap((row) => {
      const value = Number(row.audit?.features?.[key]);
      return Number.isFinite(value) ? [{ value, actual: row.actualReturn }] : [];
    });
    if (pairs.length < 3) return [];
    const unique = new Set(pairs.map((pair) => pair.value));
    const active = pairs.filter((pair) => pair.value > 0.5);
    const inactive = pairs.filter((pair) => pair.value <= 0.5);
    return [[key, {
      samples: pairs.length,
      correlationWithActualReturn: rounded(pearson(
        pairs.map((pair) => pair.value),
        pairs.map((pair) => pair.actual),
      ), 4),
      meanValue: rounded(mean(pairs.map((pair) => pair.value))),
      ...(unique.size <= 3 ? {
        activeSamples: active.length,
        activeMeanActualReturn: active.length ? rounded(mean(active.map((pair) => pair.actual))) : null,
        inactiveMeanActualReturn: inactive.length ? rounded(mean(inactive.map((pair) => pair.actual))) : null,
      } : {}),
    }]];
  }));
}

function rankedFeatures(diagnostics, count = 12) {
  return Object.entries(diagnostics)
    .sort((left, right) => (
      Math.abs(right[1].correlationWithActualReturn) - Math.abs(left[1].correlationWithActualReturn)
    ))
    .slice(0, count)
    .map(([key, value]) => ({ key, ...value }));
}

const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
const observations = Array.isArray(report.observations) ? report.observations : [];
const diagnostics = {
  format: "thinkstock-ai-walkforward-diagnostics-v2",
  generatedAt: new Date().toISOString(),
  sourceReportGeneratedAt: report.generatedAt,
  enginePathVersion: report.enginePathVersion,
  byTarget: {},
  segments: {
    archetypes: {},
    probabilisticRegimes: {},
  },
  largestMisses: observations
    .filter((row) => row.horizon === 126)
    .sort((left, right) => right.absoluteError - left.absoluteError)
    .slice(0, 20)
    .map((row) => ({
      series: row.series,
      name: row.name,
      targetType: row.targetType,
      cutoff: row.cutoff,
      targetDate: row.targetDate,
      predictedReturn: rounded(row.predictedReturn),
      actualReturn: rounded(row.actualReturn),
      absoluteError: rounded(row.absoluteError),
      topScenario: row.topScenario,
      actualClass: row.actualClass,
      attribution: row.attribution?.components || {},
    })),
  ablation: buildWalkforwardAblation(report),
  qualityCases: Object.fromEntries(Object.entries(report.qualityCaseBenchmarks || {}).map(([
    series,
    value,
  ]) => [series, value])),
};

for (const archetype of WALKFORWARD_ARCHETYPES) {
  diagnostics.segments.archetypes[archetype] = Object.fromEntries(HORIZONS.map((horizon) => [
    horizon,
    summarizeWalkforwardReport(report, { horizon, archetype }),
  ]));
}
for (const probabilisticRegime of WALKFORWARD_PROBABILISTIC_REGIMES) {
  diagnostics.segments.probabilisticRegimes[probabilisticRegime] = Object.fromEntries(
    HORIZONS.map((horizon) => [
      horizon,
      summarizeWalkforwardReport(report, { horizon, probabilisticRegime }),
    ]),
  );
}

for (const targetType of ["stock", "index"]) {
  diagnostics.byTarget[targetType] = {};
  for (const horizon of HORIZONS) {
    const rows = observations.filter((row) => row.targetType === targetType && row.horizon === horizon);
    const features = featureDiagnostics(rows);
    diagnostics.byTarget[targetType][horizon] = {
      samples: rows.length,
      features,
      rankedAbsoluteCorrelation: rankedFeatures(features),
    };
  }
}

await writeFile(OUTPUT_PATH, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: path.relative(ROOT, OUTPUT_PATH),
  stocks126: diagnostics.byTarget.stock[126].rankedAbsoluteCorrelation,
  indices126: diagnostics.byTarget.index[126].rankedAbsoluteCorrelation,
  largestMisses: diagnostics.largestMisses.slice(0, 5),
  ablation126: diagnostics.ablation.byHorizon[126],
  rangeBound126: diagnostics.ablation.rangeBound[126],
  archetypes126: Object.fromEntries(Object.entries(diagnostics.segments.archetypes).map(([
    key,
    value,
  ]) => [key, value[126]])),
  probabilisticRegimes126: Object.fromEntries(Object.entries(
    diagnostics.segments.probabilisticRegimes,
  ).map(([key, value]) => [key, value[126]])),
  qualityCases: diagnostics.qualityCases,
}, null, 2));
