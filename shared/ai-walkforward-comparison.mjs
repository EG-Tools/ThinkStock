export const WALKFORWARD_HORIZONS = Object.freeze([20, 63, 126]);
export const WALKFORWARD_CLASSES = Object.freeze(["upside", "sideways", "downside"]);
export const WALKFORWARD_REGIMES = Object.freeze(["risk-on", "risk-off", "range", "neutral"]);
export const WALKFORWARD_VOLATILITY_GROUPS = Object.freeze(["low", "mid", "high"]);
export const WALKFORWARD_BEHAVIORS = Object.freeze(["market", "inverse", "defensive", "high-beta"]);
export const WALKFORWARD_CYCLES = Object.freeze(["neutral", "late-cycle", "recovery"]);
export const WALKFORWARD_ARCHETYPES = Object.freeze([
  "trend-up",
  "trend-down",
  "range",
  "cyclical",
  "defensive",
  "high-volatility",
  "mixed",
  "unclassified",
]);
export const WALKFORWARD_PROBABILISTIC_REGIMES = Object.freeze([
  "recovery",
  "expansion",
  "late-cycle",
  "slowdown",
  "stress",
  "range",
  "unclassified",
]);

const ARCHETYPE_THRESHOLDS = Object.freeze({
  "trend-up": 0.35,
  "trend-down": 0.35,
  range: 0.65,
  cyclical: 0.42,
  defensive: 0.25,
  "high-volatility": 0.65,
});
export const WALKFORWARD_ABLATION_FAMILIES = Object.freeze({
  companyEvidence: Object.freeze([
    "consensus",
    "fundamentals",
    "internetNews",
    "corporateRiskGate",
    "corporateRisk",
    "terminalRisk",
    "criticalNewsGate",
  ]),
  marketContext: Object.freeze([
    "top400Blend",
    "marketRegime",
    "koreanVolatility",
    "rotation",
  ]),
  rangePrior: Object.freeze(["rangeMeanReversion"]),
});

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rounded(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function structuralArchetypeScores(features) {
  return [
    ["trend-up", finite(features.profile_trend_up_score)],
    ["trend-down", finite(features.profile_trend_down_score)],
    ["range", finite(features.profile_range_score)],
    ["cyclical", finite(features.profile_cycle_score)],
    ["defensive", finite(features.profile_defensive_score)],
    ["high-volatility", finite(features.profile_high_volatility_score)],
  ];
}

function classifyStructuralArchetypes(features) {
  if (finite(features.context_profile_version) < 1) return ["unclassified"];
  const active = structuralArchetypeScores(features)
    .filter(([name, score]) => score >= (ARCHETYPE_THRESHOLDS[name] ?? 0.5))
    .sort((left, right) => right[1] - left[1])
    .map(([name]) => name);
  return active.length ? active : ["mixed"];
}

function classifyStructuralArchetype(features) {
  return classifyStructuralArchetypes(features)[0];
}

function classifyProbabilisticRegime(features) {
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

export function classifyWalkforwardContext(row) {
  const features = row?.audit?.features || {};
  const support = finite(features.regime_support);
  const risk = finite(features.regime_risk);
  const range = finite(features.regime_range);
  const crisis = finite(features.regime_crisis_score);
  const volatility = Math.max(0, finite(features.projected_volatility, 0.02));
  const correlation = finite(features.market_correlation);
  const beta = finite(features.market_beta, 1);
  let regime = "neutral";
  if (crisis >= 50 || risk - support >= 0.2) regime = "risk-off";
  else if (support - risk >= 0.2) regime = "risk-on";
  else if (range >= 0.45) regime = "range";
  let behavior = "market";
  if (correlation <= -0.15) behavior = "inverse";
  else if (beta <= 0.7) behavior = "defensive";
  else if (beta >= 1.3) behavior = "high-beta";
  let cycle = "neutral";
  if (finite(features.leading_peak) > 0.5 || finite(features.leading_slowdown) > 0.5) {
    cycle = "late-cycle";
  } else if (finite(features.leading_recovery) > 0.5) {
    cycle = "recovery";
  }
  return Object.freeze({
    regime,
    volatilityGroup: volatility <= 0.014 ? "low" : (volatility <= 0.028 ? "mid" : "high"),
    behavior,
    cycle,
    archetype: classifyStructuralArchetype(features),
    archetypes: Object.freeze(classifyStructuralArchetypes(features)),
    probabilisticRegime: classifyProbabilisticRegime(features),
  });
}

export function classifyWalkforwardRegime(row) {
  return classifyWalkforwardContext(row).regime;
}

export function walkforwardCohortSets(selection) {
  const development = new Set();
  const holdout = new Set();
  for (const series of Object.values(selection || {})) {
    const middle = Math.floor(series.length / 2);
    series.slice(0, middle).forEach((item) => development.add(item));
    series.slice(middle).forEach((item) => holdout.add(item));
  }
  return {
    all: new Set([...development, ...holdout]),
    development,
    holdout,
  };
}

export function summarizeWalkforwardReport(report, options = {}) {
  const series = options.series instanceof Set ? options.series : null;
  const targetType = String(options.targetType || "stock");
  const rows = (report?.observations || []).filter((row) => (
    (() => {
      if (row.targetType !== targetType || row.horizon !== options.horizon) return false;
      if (series && !series.has(row.series)) return false;
      if (options.market && row.market !== options.market) return false;
      const context = classifyWalkforwardContext(row);
      return (!options.regime || context.regime === options.regime)
        && (!options.volatilityGroup || context.volatilityGroup === options.volatilityGroup)
        && (!options.behavior || context.behavior === options.behavior)
        && (!options.cycle || context.cycle === options.cycle)
        && (!options.archetype || context.archetypes.includes(options.archetype))
        && (!options.probabilisticRegime || context.probabilisticRegime === options.probabilisticRegime);
    })()
  ));
  const scenarioRows = rows.filter((row) => typeof row.scenarioCorrect === "boolean");
  const mae = mean(rows.map((row) => finite(row.absoluteError)));
  const noChangeMae = mean(rows.map((row) => finite(row.noChangeError)));
  const momentumErrors = rows
    .map((row) => Number(row.momentumError))
    .filter(Number.isFinite);
  const momentumMae = mean(momentumErrors);
  const brier = mean(scenarioRows.map((row) => WALKFORWARD_CLASSES.reduce((sum, key) => {
    const probability = finite(row.scenarioWeights?.[key]) / 100;
    return sum + ((probability - Number(row.actualClass === key)) ** 2);
  }, 0)));
  return {
    samples: rows.length,
    stocks: new Set(rows.map((row) => row.series)).size,
    directionAccuracy: rounded(mean(rows.map((row) => Number(row.directionCorrect))), 4),
    meanAbsoluteLogError: rounded(mae),
    meanSignedError: rounded(mean(rows.map((row) => finite(row.signedError)))),
    noChangeMae: rounded(noChangeMae),
    improvementVsNoChange: rounded(noChangeMae > 0 ? 1 - (mae / noChangeMae) : null, 4),
    momentumMae: rounded(momentumMae),
    improvementVsMomentum: rounded(momentumMae > 0 ? 1 - (mae / momentumMae) : null, 4),
    scenarioSamples: scenarioRows.length,
    scenarioAccuracy: rounded(mean(scenarioRows.map((row) => Number(row.scenarioCorrect))), 4),
    scenarioBrierScore: rounded(brier),
  };
}

function ablationPrediction(row, excludedComponents = []) {
  const predicted = Number(row?.predictedReturn);
  if (!Number.isFinite(predicted)) return null;
  const components = row?.attribution?.components;
  if (!components || typeof components !== "object") {
    return excludedComponents.length ? null : predicted;
  }
  return predicted - excludedComponents.reduce((sum, key) => (
    sum + finite(components[key])
  ), 0);
}

function summarizeAblationRows(rows, excludedComponents = []) {
  const samples = (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const actual = Number(row?.actualReturn);
    const predicted = ablationPrediction(row, excludedComponents);
    return Number.isFinite(actual) && Number.isFinite(predicted)
      ? [{ actual, predicted }]
      : [];
  });
  const errors = samples.map((sample) => sample.actual - sample.predicted);
  return Object.freeze({
    samples: samples.length,
    meanAbsoluteLogError: rounded(mean(errors.map(Math.abs))),
    meanSignedError: rounded(mean(errors)),
    directionAccuracy: rounded(mean(samples.map((sample) => (
      Number(Math.sign(sample.actual) === Math.sign(sample.predicted))
    ))), 4),
    upsidePredictionRate: rounded(mean(samples.map((sample) => Number(sample.predicted > 0))), 4),
    meanPredictedReturn: rounded(mean(samples.map((sample) => sample.predicted))),
    meanActualReturn: rounded(mean(samples.map((sample) => sample.actual))),
  });
}

function ablationSegment(rows) {
  const company = WALKFORWARD_ABLATION_FAMILIES.companyEvidence;
  const market = WALKFORWARD_ABLATION_FAMILIES.marketContext;
  const range = WALKFORWARD_ABLATION_FAMILIES.rangePrior;
  const variants = Object.freeze({
    full: summarizeAblationRows(rows),
    withoutCompanyEvidence: summarizeAblationRows(rows, company),
    withoutMarketContext: summarizeAblationRows(rows, market),
    withoutRangePrior: summarizeAblationRows(rows, range),
    priceOnlyApproximation: summarizeAblationRows(rows, [...company, ...market]),
  });
  const fullMae = variants.full.meanAbsoluteLogError;
  const impact = Object.fromEntries([
    ["companyEvidence", variants.withoutCompanyEvidence],
    ["marketContext", variants.withoutMarketContext],
    ["rangePrior", variants.withoutRangePrior],
  ].map(([key, variant]) => [key, Object.freeze({
    samples: variant.samples,
    maeIncreaseWhenRemoved: Number.isFinite(fullMae)
      && Number.isFinite(variant.meanAbsoluteLogError)
      ? rounded(variant.meanAbsoluteLogError - fullMae)
      : null,
    directionPointsWhenRemoved: Number.isFinite(variants.full.directionAccuracy)
      && Number.isFinite(variant.directionAccuracy)
      ? rounded((variant.directionAccuracy - variants.full.directionAccuracy) * 100, 2)
      : null,
  })]));
  return Object.freeze({ variants, impact: Object.freeze(impact) });
}

export function buildWalkforwardAblation(report, options = {}) {
  const targetType = String(options.targetType || "stock");
  const rangeThreshold = Math.max(0, Math.min(1, Number(options.rangeThreshold) || 0.55));
  const observations = (Array.isArray(report?.observations) ? report.observations : [])
    .filter((row) => row?.targetType === targetType);
  const byHorizon = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
    horizon,
    ablationSegment(observations.filter((row) => Number(row?.horizon) === horizon)),
  ]));
  const rangeBound = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
    horizon,
    ablationSegment(observations.filter((row) => (
      Number(row?.horizon) === horizon
      && finite(row?.audit?.features?.price_range_bound_score) >= rangeThreshold
    ))),
  ]));
  return Object.freeze({
    format: "thinkstock-ai-attribution-ablation-v1",
    method: "additive-attribution-removal",
    probabilityMetricsExcluded: true,
    targetType,
    rangeThreshold,
    families: WALKFORWARD_ABLATION_FAMILIES,
    byHorizon: Object.freeze(byHorizon),
    rangeBound: Object.freeze(rangeBound),
  });
}

function metricDelta(previous, current) {
  const ratioReduction = (before, after) => (
    Number.isFinite(before) && before !== 0 && Number.isFinite(after)
      ? rounded(1 - (after / before), 4)
      : null
  );
  return {
    directionAccuracyPoints: Number.isFinite(previous.directionAccuracy)
      && Number.isFinite(current.directionAccuracy)
      ? rounded((current.directionAccuracy - previous.directionAccuracy) * 100, 2)
      : null,
    errorReduction: ratioReduction(previous.meanAbsoluteLogError, current.meanAbsoluteLogError),
    signedBiasReduction: ratioReduction(
      Math.abs(previous.meanSignedError),
      Math.abs(current.meanSignedError),
    ),
    signedBiasAbsoluteIncrease: Number.isFinite(previous.meanSignedError)
      && Number.isFinite(current.meanSignedError)
      ? rounded(Math.abs(current.meanSignedError) - Math.abs(previous.meanSignedError))
      : null,
    noChangeSkillPoints: Number.isFinite(previous.improvementVsNoChange)
      && Number.isFinite(current.improvementVsNoChange)
      ? rounded((current.improvementVsNoChange - previous.improvementVsNoChange) * 100, 2)
      : null,
    momentumSkillPoints: Number.isFinite(previous.improvementVsMomentum)
      && Number.isFinite(current.improvementVsMomentum)
      ? rounded((current.improvementVsMomentum - previous.improvementVsMomentum) * 100, 2)
      : null,
    scenarioAccuracyPoints: Number.isFinite(previous.scenarioAccuracy)
      && Number.isFinite(current.scenarioAccuracy)
      ? rounded((current.scenarioAccuracy - previous.scenarioAccuracy) * 100, 2)
      : null,
    scenarioBrierReduction: ratioReduction(previous.scenarioBrierScore, current.scenarioBrierScore),
  };
}

function compareSegment(previous, current, options) {
  const before = summarizeWalkforwardReport(previous, options);
  const after = summarizeWalkforwardReport(current, options);
  return { before, after, delta: metricDelta(before, after) };
}

export function compareWalkforwardReports(previous, current) {
  if (JSON.stringify(previous?.selection) !== JSON.stringify(current?.selection)) {
    throw new Error("Backtest selections differ; the reports are not directly comparable.");
  }
  const cohorts = walkforwardCohortSets(current.selection);
  const comparison = {
    format: "thinkstock-ai-walkforward-comparison-v5",
    generatedAt: new Date().toISOString(),
    previousVersion: previous.enginePathVersion,
    currentVersion: current.enginePathVersion,
    cohorts: {},
    markets: {},
    indices: {},
    regimes: {},
    volatilityGroups: {},
    behaviors: {},
    cycles: {},
    archetypes: {},
    probabilisticRegimes: {},
  };

  for (const [cohort, series] of Object.entries(cohorts)) {
    comparison.cohorts[cohort] = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
      horizon,
      compareSegment(previous, current, { horizon, series }),
    ]));
  }
  for (const market of ["KOSPI", "KOSDAQ"]) {
    comparison.markets[market] = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
      horizon,
      compareSegment(previous, current, { horizon, market }),
    ]));
  }
  for (const market of ["KOSPI", "KOSDAQ"]) {
    comparison.indices[market] = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
      horizon,
      compareSegment(previous, current, { horizon, market, targetType: "index" }),
    ]));
  }
  for (const regime of WALKFORWARD_REGIMES) {
    comparison.regimes[regime] = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
      horizon,
      compareSegment(previous, current, { horizon, regime }),
    ]));
  }
  for (const volatilityGroup of WALKFORWARD_VOLATILITY_GROUPS) {
    comparison.volatilityGroups[volatilityGroup] = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
      horizon,
      compareSegment(previous, current, { horizon, volatilityGroup }),
    ]));
  }
  for (const behavior of WALKFORWARD_BEHAVIORS) {
    comparison.behaviors[behavior] = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
      horizon,
      compareSegment(previous, current, { horizon, behavior }),
    ]));
  }
  for (const cycle of WALKFORWARD_CYCLES) {
    comparison.cycles[cycle] = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
      horizon,
      compareSegment(previous, current, { horizon, cycle }),
    ]));
  }
  for (const archetype of WALKFORWARD_ARCHETYPES) {
    comparison.archetypes[archetype] = Object.fromEntries(WALKFORWARD_HORIZONS.map((horizon) => [
      horizon,
      compareSegment(previous, current, { horizon, archetype }),
    ]));
  }
  for (const probabilisticRegime of WALKFORWARD_PROBABILISTIC_REGIMES) {
    comparison.probabilisticRegimes[probabilisticRegime] = Object.fromEntries(
      WALKFORWARD_HORIZONS.map((horizon) => [
        horizon,
        compareSegment(previous, current, { horizon, probabilisticRegime }),
      ]),
    );
  }
  return comparison;
}

export function evaluateWalkforwardComparison(comparison, options = {}) {
  const minimumSamples = Math.max(1, Number(options.minimumSamples) || 20);
  const segmentMinimumSamples = Math.max(8, Number(options.segmentMinimumSamples) || 12);
  const indexMinimumSamples = Math.max(4, Number(options.indexMinimumSamples) || 6);
  const minimumComparableHorizons = Math.max(1, Math.min(
    WALKFORWARD_HORIZONS.length,
    Number(options.minimumComparableHorizons) || 2,
  ));
  const minimumPromotionErrorReduction = Math.max(0, Number(options.minimumPromotionErrorReduction) || 0.02);
  const minimumPromotionDirectionPoints = Math.max(0, Number(options.minimumPromotionDirectionPoints) || 1);
  const thresholds = {
    directionDropPoints: Math.max(0, Number(options.directionDropPoints) || 4),
    errorIncreaseRatio: Math.max(0, Number(options.errorIncreaseRatio) || 0.1),
    signedBiasIncrease: Math.max(0, Number(options.signedBiasIncrease) || 0.025),
    noChangeSkillDropPoints: Math.max(0, Number(options.noChangeSkillDropPoints) || 4),
    momentumSkillDropPoints: Math.max(0, Number(options.momentumSkillDropPoints) || 4),
    scenarioDropPoints: Math.max(0, Number(options.scenarioDropPoints) || 5),
    brierIncreaseRatio: Math.max(0, Number(options.brierIncreaseRatio) || 0.1),
  };
  const failures = [];
  const warnings = [];
  const qualityFloors = {
    directionAccuracy: Math.max(0, Number(options.minimumDirectionAccuracy) || 0.4),
    improvementVsNoChange: Number.isFinite(Number(options.minimumNoChangeSkill))
      ? Number(options.minimumNoChangeSkill)
      : -0.08,
    improvementVsMomentum: Number.isFinite(Number(options.minimumMomentumSkill))
      ? Number(options.minimumMomentumSkill)
      : -0.08,
    scenarioBrierScore: Math.max(0, Number(options.maximumScenarioBrierScore) || 0.72),
  };
  const inspect = (label, result, sampleMinimum, multiplier = 1) => {
    if (!result || result.after.samples < sampleMinimum) return;
    const delta = result.delta || {};
    if (delta.directionAccuracyPoints < -(thresholds.directionDropPoints * multiplier)) {
      failures.push(`${label} direction ${delta.directionAccuracyPoints}pp`);
    }
    if (delta.errorReduction < -(thresholds.errorIncreaseRatio * multiplier)) {
      failures.push(`${label} error ${rounded(delta.errorReduction * 100, 2)}%`);
    }
    if (delta.signedBiasAbsoluteIncrease > thresholds.signedBiasIncrease * multiplier) {
      failures.push(`${label} signed bias +${rounded(delta.signedBiasAbsoluteIncrease)}`);
    }
    if (delta.noChangeSkillPoints < -(thresholds.noChangeSkillDropPoints * multiplier)) {
      failures.push(`${label} no-change skill ${delta.noChangeSkillPoints}pp`);
    }
    if (delta.momentumSkillPoints < -(thresholds.momentumSkillDropPoints * multiplier)) {
      failures.push(`${label} momentum skill ${delta.momentumSkillPoints}pp`);
    }
    if (
      delta.scenarioAccuracyPoints < -(thresholds.scenarioDropPoints * multiplier)
      && !(delta.scenarioBrierReduction > 0)
    ) {
      failures.push(`${label} scenario ${delta.scenarioAccuracyPoints}pp`);
    }
    if (delta.scenarioBrierReduction < -(thresholds.brierIncreaseRatio * multiplier)) {
      failures.push(`${label} Brier ${rounded(delta.scenarioBrierReduction * 100, 2)}%`);
    }
  };
  const holdout = comparison?.cohorts?.holdout || {};
  let benchmarkOutperformanceConfirmed = true;
  for (const horizon of WALKFORWARD_HORIZONS) {
    inspect(`${horizon}d holdout`, holdout[horizon], minimumSamples);
    const current = holdout[horizon]?.after;
    if (!current || current.samples < minimumSamples) continue;
    if (!(current.directionAccuracy >= 0.5)) {
      benchmarkOutperformanceConfirmed = false;
      warnings.push(`${horizon}d holdout direction remains below 50%`);
    }
    if (!(current.improvementVsNoChange > 0)) {
      benchmarkOutperformanceConfirmed = false;
      warnings.push(`${horizon}d holdout has not beaten the no-change baseline`);
    }
    if (!(current.improvementVsMomentum > 0)) {
      benchmarkOutperformanceConfirmed = false;
      warnings.push(`${horizon}d holdout has not beaten the momentum baseline`);
    }
    if (current.directionAccuracy < qualityFloors.directionAccuracy) {
      failures.push(`${horizon}d holdout absolute direction ${rounded(current.directionAccuracy * 100, 2)}%`);
    }
    if (current.improvementVsNoChange < qualityFloors.improvementVsNoChange) {
      failures.push(`${horizon}d holdout absolute no-change skill ${rounded(current.improvementVsNoChange * 100, 2)}%`);
    }
    if (Number.isFinite(current.improvementVsMomentum)
      && current.improvementVsMomentum < qualityFloors.improvementVsMomentum) {
      failures.push(`${horizon}d holdout absolute momentum skill ${rounded(current.improvementVsMomentum * 100, 2)}%`);
    }
    if (Number.isFinite(current.scenarioBrierScore)
      && current.scenarioBrierScore > qualityFloors.scenarioBrierScore) {
      failures.push(`${horizon}d holdout absolute Brier ${current.scenarioBrierScore}`);
    }
  }
  const segmentGroups = [
    "markets",
    "regimes",
    "volatilityGroups",
    "behaviors",
    "cycles",
    "archetypes",
    "probabilisticRegimes",
  ];
  for (const group of segmentGroups) {
    for (const [segment, horizons] of Object.entries(comparison?.[group] || {})) {
      for (const horizon of WALKFORWARD_HORIZONS) {
        inspect(`${horizon}d ${group}/${segment}`, horizons[horizon], segmentMinimumSamples, 1.5);
      }
    }
  }
  for (const [market, horizons] of Object.entries(comparison?.indices || {})) {
    for (const horizon of WALKFORWARD_HORIZONS) {
      const result = horizons[horizon];
      inspect(`${horizon}d indices/${market}`, result, indexMinimumSamples, 1.5);
      const current = result?.after;
      if (!current || current.samples < indexMinimumSamples) continue;
      if (!(current.improvementVsNoChange > 0) || !(current.improvementVsMomentum > 0)) {
        benchmarkOutperformanceConfirmed = false;
        warnings.push(`${horizon}d ${market} index has not beaten both simple baselines`);
      }
    }
  }
  const comparableHoldouts = WALKFORWARD_HORIZONS.flatMap((horizon) => {
    const result = holdout[horizon];
    return Number(result?.after?.samples) >= minimumSamples ? [{ horizon, result }] : [];
  });
  const improvedHoldouts = comparableHoldouts.filter(({ result }) => (
    Number(result?.delta?.errorReduction) >= minimumPromotionErrorReduction
    || Number(result?.delta?.directionAccuracyPoints) >= minimumPromotionDirectionPoints
    || Number(result?.delta?.scenarioBrierReduction) >= minimumPromotionErrorReduction
  ));
  const evidenceReady = comparableHoldouts.length >= minimumComparableHorizons;
  const meaningfulImprovement = evidenceReady
    && improvedHoldouts.length >= Math.ceil(comparableHoldouts.length / 2);
  const promotionRecommended = failures.length === 0
    && benchmarkOutperformanceConfirmed
    && meaningfulImprovement;
  const decision = failures.length
    ? "keep-champion"
    : (!evidenceReady
      ? "insufficient-evidence"
      : (promotionRecommended ? "promote-challenger" : "keep-champion"));
  return Object.freeze({
    passed: failures.length === 0,
    minimumSamples,
    segmentMinimumSamples,
    indexMinimumSamples,
    thresholds,
    qualityFloors,
    benchmarkOutperformanceConfirmed,
    decision,
    promotionRecommended,
    promotionEvidence: Object.freeze({
      comparableHorizons: Object.freeze(comparableHoldouts.map(({ horizon }) => horizon)),
      improvedHorizons: Object.freeze(improvedHoldouts.map(({ horizon }) => horizon)),
      minimumComparableHorizons,
      minimumPromotionDirectionPoints,
      minimumPromotionErrorReduction,
    }),
    warnings,
    failures,
  });
}
