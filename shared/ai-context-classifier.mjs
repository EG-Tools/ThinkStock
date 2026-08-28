import { finiteOrNull } from "./runtime-foundation.mjs";

export const AI_ARCHETYPE_THRESHOLDS = Object.freeze({
  "trend-up": 0.35,
  "trend-down": 0.35,
  range: 0.65,
  cyclical: 0.42,
  defensive: 0.25,
  "high-volatility": 0.65,
});

function finite(value, fallback = 0) {
  return finiteOrNull(value) ?? fallback;
}

export function structuralArchetypeScores(features = {}) {
  return [
    ["trend-up", finite(features.profile_trend_up_score)],
    ["trend-down", finite(features.profile_trend_down_score)],
    ["range", finite(features.profile_range_score)],
    ["cyclical", finite(features.profile_cycle_score)],
    ["defensive", finite(features.profile_defensive_score)],
    ["high-volatility", finite(features.profile_high_volatility_score)],
  ];
}

export function classifyStructuralArchetypes(features = {}) {
  if (finite(features.context_profile_version) < 1) return ["unclassified"];
  const active = structuralArchetypeScores(features)
    .filter(([name, score]) => score >= (AI_ARCHETYPE_THRESHOLDS[name] ?? 0.5))
    .sort((left, right) => right[1] - left[1])
    .map(([name]) => name);
  return active.length ? active : ["mixed"];
}

export function classifyStructuralArchetype(features = {}) {
  return classifyStructuralArchetypes(features)[0];
}

export function classifyProbabilisticRegime(features = {}) {
  if (finite(features.context_profile_version) < 1) return "unclassified";
  const probabilities = [
    ["recovery", finite(features.regime_probability_recovery)],
    ["expansion", finite(features.regime_probability_expansion)],
    ["late-cycle", finite(features.regime_probability_late_cycle)],
    ["slowdown", finite(features.regime_probability_slowdown)],
    ["stress", finite(features.regime_probability_stress)],
    ["range", finite(features.regime_probability_range)],
  ].sort((left, right) => right[1] - left[1]);
  return probabilities[0][1] > 0 ? probabilities[0][0] : "unclassified";
}
