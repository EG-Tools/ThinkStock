(function initThinkStockAiForecastCalibration(globalScope) {
  "use strict";

  const HORIZONS = Object.freeze([5, 10, 20, 63, 126]);
  const CORRECTION_CAPS = Object.freeze({ 5: 0.025, 10: 0.04, 20: 0.06, 63: 0.1, 126: 0.16 });
  const SCENARIO_KEYS = Object.freeze(["upside", "sideways", "downside"]);
  const INPUT_FRESHNESS_RULES = Object.freeze({
    price: Object.freeze({ graceDays: 4, staleDays: 14, weight: 4 }),
    market: Object.freeze({ graceDays: 4, staleDays: 14, weight: 3 }),
    rotation: Object.freeze({ graceDays: 10, staleDays: 30, weight: 1 }),
    auxiliary: Object.freeze({ graceDays: 4, staleDays: 14, weight: 2 }),
    vkospi: Object.freeze({ graceDays: 4, staleDays: 14, weight: 2 }),
    credit: Object.freeze({ graceDays: 7, staleDays: 21, weight: 2 }),
    crisis: Object.freeze({ graceDays: 7, staleDays: 21, weight: 1.5 }),
    macro: Object.freeze({ graceDays: 75, staleDays: 180, weight: 1.5 }),
    consensus: Object.freeze({ graceDays: 90, staleDays: 180, weight: 0.75 }),
    financials: Object.freeze({ graceDays: 150, staleDays: 365, weight: 1 }),
  });
  const TIER_CONFIDENCE = Object.freeze({
    "own-shock": 1,
    "own-regime": 1,
    own: 0.98,
    "shock-cohort": 0.97,
    "cohort-regime": 0.96,
    "group-regime": 0.94,
    "behavior-cycle-regime": 0.93,
    "behavior-regime": 0.92,
    group: 0.9,
    "market-shock": 0.92,
    "market-regime": 0.9,
    market: 0.88,
    global: 0.84,
    none: 1,
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function median(values) {
    const clean = (values || []).filter(Number.isFinite).sort((left, right) => left - right);
    if (!clean.length) return 0;
    const middle = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
  }

  function quantile(values, ratio) {
    const clean = (values || []).filter(Number.isFinite).sort((left, right) => left - right);
    if (!clean.length) return 0;
    const position = clamp(Number(ratio) || 0, 0, 1) * (clean.length - 1);
    const left = Math.floor(position);
    const right = Math.ceil(position);
    const blend = position - left;
    return clean[left] + ((clean[right] - clean[left]) * blend);
  }

  function classifyContext(ticker, value) {
    const audit = value?.audit || value;
    const features = audit?.features || {};
    const normalizedTicker = String(ticker || value?.ticker || "").trim().toUpperCase();
    const market = normalizedTicker.endsWith(".KQ") || finite(features.market_is_kosdaq) > 0.5
      ? "KOSDAQ"
      : "KOSPI";
    const volatility = Math.max(0, finite(features.projected_volatility, value?.projectedVolatility));
    const volatilityGroup = volatility <= 0.014 ? "low" : (volatility <= 0.028 ? "mid" : "high");
    const support = finite(features.regime_support);
    const risk = finite(features.regime_risk);
    const range = finite(features.regime_range);
    const crisis = finite(features.regime_crisis_score);
    const annualizedReturn = finite(features.price_annualized_return);
    const trendStrength = finite(features.price_trend_r_squared);
    const rangeScore = finite(features.price_range_bound_score);
    const marketCorrelation = finite(features.market_correlation);
    const marketBeta = finite(features.market_beta, 1);
    const leadingPeak = finite(features.leading_peak);
    const leadingSlowdown = finite(features.leading_slowdown);
    const leadingRecovery = finite(features.leading_recovery);
    const shockSignedStrength = finite(features.price_shock_signed_strength);
    const shockActive = finite(features.price_shock_active) > 0.5
      && Math.abs(shockSignedStrength) >= 0.1;
    const shock = shockActive
      ? (shockSignedStrength > 0 ? "overbought" : "oversold")
      : "normal";
    let regime = "neutral";
    if (crisis >= 50 || risk - support >= 0.2) regime = "risk-off";
    else if (support - risk >= 0.2) regime = "risk-on";
    else if (range >= 0.45) regime = "range";
    let behavior = "market";
    if (marketCorrelation <= -0.15) behavior = "inverse";
    else if (marketBeta <= 0.7) behavior = "defensive";
    else if (marketBeta >= 1.3) behavior = "high-beta";
    let trend = "mixed";
    if (rangeScore >= 0.55) trend = "range";
    else if (trendStrength >= 0.2 && annualizedReturn >= 0.08) trend = "uptrend";
    else if (trendStrength >= 0.2 && annualizedReturn <= -0.08) trend = "downtrend";
    let cycle = "neutral";
    if (leadingPeak > 0.5 || leadingSlowdown > 0.5) cycle = "late-cycle";
    else if (leadingRecovery > 0.5) cycle = "recovery";
    return Object.freeze({
      market,
      volatility,
      volatilityGroup,
      group: `${market}:${volatilityGroup}`,
      regime,
      behavior,
      trend,
      cycle,
      shock,
      shockStrength: shockActive ? Math.abs(shockSignedStrength) : 0,
      shockCohort: `${market}:${volatilityGroup}:${shock}`,
      cohort: `${market}:${volatilityGroup}:${behavior}:${trend}:${cycle}`,
    });
  }

  function sampleWeight(record, currentAsOf, currentModelVersion, currentTicker, currentContext, recordContext) {
    const ageDays = Math.max(0, (Date.parse(`${currentAsOf}T00:00:00Z`)
      - Date.parse(`${record.asOf}T00:00:00Z`)) / 86400000);
    const recency = Math.exp(-ageDays / 730);
    const modelWeight = currentModelVersion && record.modelVersion === currentModelVersion ? 1 : 0.7;
    const tickerWeight = record.ticker === currentTicker ? 1.4 : 1;
    const volatilityDistance = Math.abs(
      Math.log((Math.max(0.004, recordContext?.volatility || 0.02))
        / Math.max(0.004, currentContext?.volatility || 0.02)),
    );
    const volatilityWeight = Math.exp(-volatilityDistance * 0.55);
    const behaviorWeight = recordContext?.behavior === currentContext?.behavior ? 1 : 0.82;
    const cycleWeight = recordContext?.cycle === currentContext?.cycle ? 1 : 0.88;
    const currentShock = String(currentContext?.shock || "normal");
    const recordShock = String(recordContext?.shock || "normal");
    const shockWeight = currentShock === "normal"
      ? (recordShock === "normal" ? 1 : 0.78)
      : (recordShock === currentShock ? 1.15 : (recordShock === "normal" ? 0.48 : 0.25));
    return Math.max(0.15, recency)
      * modelWeight
      * tickerWeight
      * volatilityWeight
      * behaviorWeight
      * cycleWeight
      * shockWeight;
  }

  function robustBias(samples, horizon) {
    const errors = samples.map((sample) => sample.error);
    const center = median(errors);
    const mad = median(errors.map((error) => Math.abs(error - center)));
    const tolerance = Math.max(0.025, mad * 3.5);
    const filtered = samples.filter((sample) => Math.abs(sample.error - center) <= tolerance);
    const usable = filtered.length >= Math.ceil(samples.length * 0.6) ? filtered : samples;
    const weightTotal = usable.reduce((sum, sample) => sum + sample.weight, 0);
    const weightSquareTotal = usable.reduce((sum, sample) => sum + (sample.weight ** 2), 0);
    const effectiveSamples = weightSquareTotal > 1e-9
      ? (weightTotal ** 2) / weightSquareTotal
      : 0;
    const weightedMean = weightTotal > 0
      ? usable.reduce((sum, sample) => sum + (sample.error * sample.weight), 0) / weightTotal
      : center;
    const rawBias = (weightedMean * 0.65) + (center * 0.35);
    const shrinkage = effectiveSamples / (effectiveSamples + 12);
    const cap = CORRECTION_CAPS[horizon] || 0.1;
    const weightedAverage = (selector) => (weightTotal > 0
      ? usable.reduce((sum, sample) => sum + (selector(sample) * sample.weight), 0) / weightTotal
      : 0);
    const directionAccuracy = weightedAverage((sample) => (sample.directionCorrect ? 1 : 0));
    const intervalCoverage = weightedAverage((sample) => (sample.intervalCovered ? 1 : 0));
    const meanAbsoluteError = weightedAverage((sample) => Math.abs(sample.error));
    const baselineSamples = usable.filter((sample) => Number.isFinite(sample.actualLogReturn));
    const baselineWeight = baselineSamples.reduce((sum, sample) => sum + sample.weight, 0);
    const noChangeMeanAbsoluteError = baselineWeight > 0
      ? baselineSamples.reduce((sum, sample) => (
        sum + (Math.abs(sample.actualLogReturn) * sample.weight)
      ), 0) / baselineWeight
      : 0;
    const skillVsNoChange = noChangeMeanAbsoluteError > 1e-6
      ? 1 - (meanAbsoluteError / noChangeMeanAbsoluteError)
      : 0;
    const momentumSamples = usable.filter((sample) => Number.isFinite(sample.momentumAbsoluteError));
    const momentumWeight = momentumSamples.reduce((sum, sample) => sum + sample.weight, 0);
    const momentumMeanAbsoluteError = momentumWeight > 0
      ? momentumSamples.reduce((sum, sample) => (
        sum + (sample.momentumAbsoluteError * sample.weight)
      ), 0) / momentumWeight
      : 0;
    const skillVsMomentum = momentumMeanAbsoluteError > 1e-6
      ? 1 - (meanAbsoluteError / momentumMeanAbsoluteError)
      : 0;
    const reliability = effectiveSamples / (effectiveSamples + 12);
    const baselinePenalty = Math.max(0, -skillVsNoChange) * 0.75;
    const momentumPenalty = momentumSamples.length
      ? Math.max(0, -skillVsMomentum) * 0.75
      : 0;
    const directionPenalty = Math.max(0, 0.5 - directionAccuracy) * 1.2;
    const confidenceScale = clamp(
      1 - ((baselinePenalty + momentumPenalty + directionPenalty) * reliability),
      0.55,
      1,
    );
    const directionQuality = clamp((directionAccuracy - 0.35) / 0.25, 0, 1);
    const baselineQuality = baselineSamples.length
      ? clamp((skillVsNoChange + 0.15) / 0.3, 0.1, 1)
      : 1;
    const momentumQuality = momentumSamples.length
      ? clamp((skillVsMomentum + 0.15) / 0.3, 0.1, 1)
      : 1;
    const correctionEligible = effectiveSamples >= 3.5
      && directionAccuracy >= 0.45
      && (!baselineSamples.length || skillVsNoChange > -0.15)
      && (!momentumSamples.length || skillVsMomentum > -0.15);
    const coverageScale = 1 + (Math.max(0, 0.68 - intervalCoverage) * 1.4 * reliability);
    const confidenceWidening = 1 + ((1 - confidenceScale) * 0.6);
    return {
      correction: clamp(
        correctionEligible
          ? rawBias * shrinkage * directionQuality * Math.min(baselineQuality, momentumQuality)
          : 0,
        -cap,
        cap,
      ),
      rawBias,
      samples: usable.length,
      effectiveSamples,
      correctionEligible,
      meanAbsoluteError,
      noChangeMeanAbsoluteError,
      skillVsNoChange,
      momentumMeanAbsoluteError,
      skillVsMomentum,
      confidenceScale,
      rootMeanSquaredError: Math.sqrt(weightedAverage((sample) => sample.error ** 2)),
      errorQuantile80: quantile(usable.map((sample) => Math.abs(sample.error)), 0.8),
      directionAccuracy,
      directionQuality,
      baselineQuality,
      momentumQuality,
      intervalCoverage,
      intervalScale: clamp(coverageScale * confidenceWidening, 1, 1.9),
      reliability,
    };
  }

  function normalizedScenarioProbabilities(value) {
    const source = value && typeof value === "object" ? value : {};
    const raw = SCENARIO_KEYS.map((key) => Math.max(0, finite(source[key])));
    const total = raw.reduce((sum, item) => sum + item, 0);
    return total > 0 ? raw.map((item) => item / total) : null;
  }

  function realizedScenario(actualLogReturn, context, horizon) {
    const actual = Number(actualLogReturn);
    if (!Number.isFinite(actual)) return "";
    const dailyVolatility = clamp(finite(context?.volatility, 0.02), 0.005, 0.08);
    const deadband = clamp(dailyVolatility * Math.sqrt(Math.max(1, horizon)) * 0.35, 0.012, 0.12);
    return actual > deadband ? "upside" : (actual < -deadband ? "downside" : "sideways");
  }

  function probabilityCalibration(samples, horizon) {
    const usable = samples.flatMap((sample) => {
      const probabilities = sample.scenarioProbabilities;
      const actualScenario = realizedScenario(sample.actualLogReturn, sample.context, horizon);
      return probabilities && actualScenario ? [{ ...sample, probabilities, actualScenario }] : [];
    });
    if (usable.length < 6) {
      return {
        applied: false,
        samples: usable.length,
        logAdjustments: {},
        uniformBrierScore: 2 / 9,
        confidenceScale: 1,
      };
    }
    const prior = 1.5;
    const weightTotal = usable.reduce((sum, sample) => sum + sample.weight, 0);
    const observed = {};
    const predicted = {};
    SCENARIO_KEYS.forEach((key, index) => {
      observed[key] = (prior + usable.reduce((sum, sample) => (
        sum + (sample.actualScenario === key ? sample.weight : 0)
      ), 0)) / (weightTotal + prior * SCENARIO_KEYS.length);
      predicted[key] = (prior + usable.reduce((sum, sample) => (
        sum + (sample.probabilities[index] * sample.weight)
      ), 0)) / (weightTotal + prior * SCENARIO_KEYS.length);
    });
    const reliability = usable.length / (usable.length + 18);
    const logAdjustments = Object.fromEntries(SCENARIO_KEYS.map((key) => [
      key,
      clamp(Math.log(observed[key] / Math.max(1e-6, predicted[key])) * reliability, -0.45, 0.45),
    ]));
    const brierScore = usable.reduce((sum, sample) => {
      const error = SCENARIO_KEYS.reduce((scenarioSum, key, index) => (
        scenarioSum + ((sample.probabilities[index] - (sample.actualScenario === key ? 1 : 0)) ** 2)
      ), 0) / SCENARIO_KEYS.length;
      return sum + error * sample.weight;
    }, 0) / Math.max(1e-9, weightTotal);
    const uniformBrierScore = 2 / 9;
    const relativeUnderperformance = Math.max(
      0,
      (brierScore - uniformBrierScore) / uniformBrierScore,
    );
    const confidenceScale = clamp(
      1 - (relativeUnderperformance * reliability),
      0.5,
      1,
    );
    return {
      applied: Object.values(logAdjustments).some((value) => Math.abs(value) > 1e-9)
        || confidenceScale < 0.999,
      samples: usable.length,
      observed,
      predicted,
      logAdjustments,
      brierScore,
      uniformBrierScore,
      confidenceScale,
      reliability,
    };
  }

  function daysBetween(startDate, endDate) {
    const start = Date.parse(`${String(startDate || "").slice(0, 10)}T00:00:00Z`);
    const end = Date.parse(`${String(endDate || "").slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(start) && Number.isFinite(end)
      ? Math.round((end - start) / 86400000)
      : null;
  }

  function freshnessScale(ageDays, rule) {
    if (!Number.isFinite(ageDays)) return 1;
    if (ageDays < 0) return 0.45;
    if (ageDays <= rule.graceDays) return 1;
    const staleSpan = Math.max(1, rule.staleDays - rule.graceDays);
    const decay = clamp((ageDays - rule.graceDays) / staleSpan, 0, 1);
    return 1 - (decay * 0.55);
  }

  function buildInputReliability(forecast, horizonRow = {}) {
    const audit = forecast?.audit || {};
    const features = audit.features || {};
    const sourceDates = audit.sourceDates || {};
    const asOf = String(
      audit.asOfDate
      || forecast?.decisionDate
      || forecast?.dates?.[0]
      || forecast?.asOf
      || "",
    ).slice(0, 10);
    const sourceRows = Object.entries(INPUT_FRESHNESS_RULES).flatMap(([key, rule]) => {
      const date = String(sourceDates[key] || (key === "price" ? audit.priceAsOfDate : "") || "")
        .slice(0, 10);
      const ageDays = daysBetween(date, asOf);
      if (!date || ageDays === null) return [];
      return [{ key, date, ageDays, scale: freshnessScale(ageDays, rule), ...rule }];
    });
    const sourceWeight = sourceRows.reduce((sum, row) => sum + row.weight, 0);
    const freshness = sourceWeight > 0
      ? sourceRows.reduce((sum, row) => sum + (row.scale * row.weight), 0) / sourceWeight
      : 1;
    const environmentCoverage = Number(features.environment_coverage);
    const coverageScale = Number.isFinite(environmentCoverage)
      ? clamp(0.82 + (clamp(environmentCoverage, 0, 1) * 0.18), 0.82, 1)
      : 1;
    const backtestSamples = Math.max(0, Number(forecast?.backtest?.validationSamples) || 0);
    const directionAccuracy = Number(forecast?.backtest?.directionAccuracy);
    const internalValidationScale = backtestSamples >= 8 && Number.isFinite(directionAccuracy)
      ? clamp(1 - (clamp((0.5 - directionAccuracy) / 0.25, 0, 1) * 0.18), 0.82, 1)
      : 1;
    const effectiveSamples = Math.max(0, finite(horizonRow.effectiveSamples, horizonRow.samples));
    const sampleScale = effectiveSamples > 0
      ? 0.82 + (clamp(effectiveSamples / 12, 0, 1) * 0.18)
      : 1;
    const tier = String(horizonRow.tier || "none");
    const contextScale = effectiveSamples > 0 ? finite(TIER_CONFIDENCE[tier], 0.84) : 1;
    const confidenceScale = clamp(Math.min(
      freshness,
      coverageScale,
      internalValidationScale,
      sampleScale,
      contextScale,
    ), 0.45, 1);
    const staleSources = sourceRows
      .filter((row) => row.ageDays < 0 || row.ageDays > row.graceDays)
      .map((row) => row.key);
    return Object.freeze({
      asOf,
      status: confidenceScale < 0.72 ? "weak" : (confidenceScale < 0.9 ? "limited" : "usable"),
      confidenceScale: Math.round(confidenceScale * 1000) / 1000,
      intervalScale: Math.round((1 + ((1 - confidenceScale) * 0.8)) * 1000) / 1000,
      freshnessScale: Math.round(freshness * 1000) / 1000,
      coverageScale: Math.round(coverageScale * 1000) / 1000,
      internalValidationScale: Math.round(internalValidationScale * 1000) / 1000,
      sampleScale: Math.round(sampleScale * 1000) / 1000,
      contextScale: Math.round(contextScale * 1000) / 1000,
      effectiveSamples,
      tier,
      staleSources: Object.freeze(staleSources),
      sourceAges: Object.freeze(Object.fromEntries(sourceRows.map((row) => [row.key, row.ageDays]))),
    });
  }

  function buildContextQuality(horizons, options = {}) {
    const rows = Object.fromEntries(HORIZONS.map((horizon) => {
      const source = horizons?.[horizon] || horizons?.[String(horizon)] || {};
      const samples = Math.max(0, Number(source.samples) || 0);
      const effectiveSamples = Math.max(0, finite(source.effectiveSamples, samples));
      return [horizon, Object.freeze({
        samples,
        effectiveSamples,
        directionAccuracy: finiteOrNull(source.directionAccuracy),
        intervalCoverage: finiteOrNull(source.intervalCoverage),
        meanAbsoluteLogError: finiteOrNull(source.meanAbsoluteError),
        meanSignedLogError: finiteOrNull(source.rawBias),
        noChangeMeanAbsoluteLogError: finiteOrNull(source.noChangeMeanAbsoluteError),
        momentumMeanAbsoluteLogError: finiteOrNull(source.momentumMeanAbsoluteError),
        skillVsNoChange: finiteOrNull(source.skillVsNoChange),
        skillVsMomentum: finiteOrNull(source.skillVsMomentum),
        status: effectiveSamples >= 8 ? "usable" : (samples ? "limited" : "pending"),
      })];
    }));
    const totalSamples = Object.values(rows).reduce((sum, row) => sum + row.samples, 0);
    const effectiveSamples = Object.values(rows)
      .reduce((sum, row) => sum + row.effectiveSamples, 0);
    return Object.freeze({
      format: "ai-forecast-context-quality-v1",
      asOf: String(options.asOf || "").slice(0, 10),
      context: options.context || null,
      horizons: Object.freeze(rows),
      totalSamples,
      effectiveSamples,
      status: effectiveSamples >= HORIZONS.length * 8
        ? "usable"
        : (totalSamples ? "limited" : "pending"),
    });
  }

  function buildCalibrationProfile(options = {}) {
    const ticker = String(options.ticker || "").trim().toUpperCase();
    const forecast = options.forecast || {};
    const currentAsOf = String(forecast.dates?.[0] || forecast.asOf || "").slice(0, 10);
    const currentModelVersion = String(forecast.model?.version || forecast.modelVersion || "");
    const context = classifyContext(ticker, forecast);
    const records = (Array.isArray(options.records) ? options.records : []).filter((record) => (
      record?.asOf
      && record.asOf < currentAsOf
      && record?.audit?.features
    ));
    const shockTiers = context.shock === "normal" ? [] : [
      { key: "own-shock", minimum: 3, matches: (sample) => sample.ticker === ticker && sample.context.shock === context.shock },
      { key: "shock-cohort", minimum: 6, matches: (sample) => sample.context.shockCohort === context.shockCohort },
      { key: "market-shock", minimum: 8, matches: (sample) => sample.context.market === context.market && sample.context.shock === context.shock },
    ];
    const tiers = [
      ...shockTiers,
      { key: "own-regime", minimum: 4, matches: (sample) => sample.ticker === ticker && sample.context.regime === context.regime },
      { key: "own", minimum: 5, matches: (sample) => sample.ticker === ticker },
      { key: "cohort-regime", minimum: 6, matches: (sample) => sample.context.cohort === context.cohort && sample.context.regime === context.regime },
      { key: "group-regime", minimum: 8, matches: (sample) => sample.context.group === context.group && sample.context.regime === context.regime },
      { key: "behavior-cycle-regime", minimum: 10, matches: (sample) => sample.context.market === context.market && sample.context.behavior === context.behavior && sample.context.cycle === context.cycle && sample.context.regime === context.regime },
      { key: "behavior-regime", minimum: 10, matches: (sample) => sample.context.market === context.market && sample.context.behavior === context.behavior && sample.context.regime === context.regime },
      { key: "group", minimum: 10, matches: (sample) => sample.context.group === context.group },
      { key: "market-regime", minimum: 10, matches: (sample) => sample.context.market === context.market && sample.context.regime === context.regime },
      { key: "market", minimum: 12, matches: (sample) => sample.context.market === context.market },
      { key: "global", minimum: 16, matches: () => true },
    ];
    const horizons = {};

    HORIZONS.forEach((horizon) => {
      const eligible = records.flatMap((record) => {
        const score = record?.horizons?.[horizon]?.score || record?.horizons?.[String(horizon)]?.score;
        if (!score || score.actualDate > currentAsOf || !Number.isFinite(Number(score.signedLogError))) return [];
        const recordContext = classifyContext(record.ticker, record);
        return [{
          ticker: String(record.ticker || "").trim().toUpperCase(),
          context: recordContext,
          error: Number(score.signedLogError),
          actualLogReturn: Number(score.actualLogReturn),
          momentumAbsoluteError: Number(score.momentumAbsLogError),
          scenarioProbabilities: normalizedScenarioProbabilities(record.audit?.scenarioWeights),
          directionCorrect: score.directionCorrect === true,
          intervalCovered: score.intervalCovered === true,
          weight: sampleWeight(
            record,
            currentAsOf,
            currentModelVersion,
            ticker,
            context,
            recordContext,
          ),
        }];
      });
      const tier = tiers.find((candidate) => eligible.filter(candidate.matches).length >= candidate.minimum);
      if (!tier) {
        horizons[horizon] = { correction: 0, samples: 0, tier: "none" };
        return;
      }
      const samples = eligible.filter(tier.matches);
      horizons[horizon] = {
        ...robustBias(samples, horizon),
        probability: probabilityCalibration(samples, horizon),
        tier: tier.key,
      };
    });

    const contextQuality = buildContextQuality(horizons, { asOf: currentAsOf, context });
    const contextHorizonSamples = finite(contextQuality.horizons?.[126]?.effectiveSamples);
    const qualitySource = contextHorizonSamples >= 8 ? "context" : "global";
    const qualityConfidenceScale = forecastQualityConfidenceScale(
      qualitySource === "context" ? contextQuality : options.quality,
      126,
    );
    const inputReliability = buildInputReliability(forecast, horizons[126]);
    return Object.freeze({
      format: "ai-calibration-v9",
      context,
      horizons,
      quality: options.quality || null,
      contextQuality,
      qualitySource,
      qualityConfidenceScale,
      inputReliability,
      applied: HORIZONS.some((horizon) => (
        Math.abs(horizons[horizon].correction) > 1e-9
        || finite(horizons[horizon].confidenceScale, 1) < 0.999
        || finite(horizons[horizon].intervalScale, 1) > 1.001
        || horizons[horizon].probability?.applied === true
      )) || qualityConfidenceScale < 0.999 || inputReliability.confidenceScale < 0.999,
      totalSamples: HORIZONS.reduce((sum, horizon) => sum + horizons[horizon].samples, 0),
    });
  }

  function forecastQualityConfidenceScale(quality, horizon = 126) {
    const row = quality?.horizons?.[horizon] || quality?.horizons?.[String(horizon)];
    const samples = Math.max(0, Number(row?.effectiveSamples ?? row?.samples) || 0);
    if (samples < 8) return 1;
    const directionAccuracy = Number(row?.directionAccuracy);
    const skillVsNoChange = Number(row?.skillVsNoChange);
    const skillVsMomentum = Number(row?.skillVsMomentum);
    const directionWeakness = Number.isFinite(directionAccuracy)
      ? clamp((0.5 - directionAccuracy) / 0.25, 0, 1)
      : 0;
    const skillWeakness = Math.max(
      Number.isFinite(skillVsNoChange) ? clamp(-skillVsNoChange / 0.5, 0, 1) : 0,
      Number.isFinite(skillVsMomentum) ? clamp(-skillVsMomentum / 0.5, 0, 1) : 0,
    );
    const weakness = Math.max(directionWeakness, skillWeakness);
    const reliability = clamp((samples - 7) / 24, 0, 1);
    return Math.round(clamp(1 - (weakness * (0.12 + (0.23 * reliability))), 0.65, 1) * 1000) / 1000;
  }

  function buildForecastQualityDiagnostic(profile, quality, options = {}) {
    const horizon = Math.max(1, Math.floor(Number(options.horizon) || 126));
    const row = profile?.horizons?.[horizon] || profile?.horizons?.[String(horizon)] || {};
    const context = profile?.context || {};
    const selectedQuality = profile?.qualitySource === "context"
      ? profile?.contextQuality
      : quality;
    const confidenceScale = Math.min(
      clamp(finite(profile?.qualityConfidenceScale, 1), 0, 1),
      clamp(finite(row?.confidenceScale, 1), 0, 1),
      clamp(finite(row?.probability?.confidenceScale, 1), 0, 1),
      clamp(finite(profile?.inputReliability?.confidenceScale, 1), 0, 1),
    );
    return Object.freeze({
      asOf: String(options.asOf || quality?.asOf || "").slice(0, 10),
      status: String(selectedQuality?.status || "pending"),
      totalSamples: Math.max(0, Number(selectedQuality?.totalSamples) || 0),
      effectiveSamples: Math.max(0, Number(row?.effectiveSamples) || 0),
      calibrationSamples: Math.max(0, Number(profile?.totalSamples) || 0),
      horizon,
      horizonSamples: Math.max(0, Number(row?.samples) || 0),
      confidenceScale,
      inputConfidenceScale: clamp(finite(profile?.inputReliability?.confidenceScale, 1), 0, 1),
      inputStatus: String(profile?.inputReliability?.status || "unknown"),
      staleSources: Object.freeze([...(profile?.inputReliability?.staleSources || [])]),
      globalConfidenceScale: clamp(finite(profile?.qualityConfidenceScale, 1), 0, 1),
      calibrationApplied: profile?.applied === true,
      qualitySource: String(profile?.qualitySource || "global"),
      market: String(context.market || "unknown"),
      volatilityGroup: String(context.volatilityGroup || "unknown"),
      regime: String(context.regime || "unknown"),
      behavior: String(context.behavior || "unknown"),
      trend: String(context.trend || "unknown"),
      cycle: String(context.cycle || "unknown"),
      shock: String(context.shock || "normal"),
      tier: String(row?.tier || "none"),
      directionAccuracy: finiteOrNull(row?.directionAccuracy),
      skillVsNoChange: finiteOrNull(row?.skillVsNoChange),
      skillVsMomentum: finiteOrNull(row?.skillVsMomentum),
      intervalCoverage: finiteOrNull(row?.intervalCoverage),
      probabilityBrierScore: finiteOrNull(row?.probability?.brierScore),
    });
  }

  function summarizeForecastQualityDiagnostics(values) {
    const entries = values instanceof Map
      ? [...values.entries()]
      : Object.entries(values && typeof values === "object" ? values : {});
    const statuses = { usable: 0, limited: 0, pending: 0, unknown: 0 };
    const contextRows = {};
    const cohortRows = {};
    const shockRows = {};
    const series = {};

    entries.forEach(([ticker, rawValue]) => {
      const value = rawValue && typeof rawValue === "object" ? rawValue : {};
      const status = Object.hasOwn(statuses, value.status) ? value.status : "unknown";
      const market = String(value.market || "unknown");
      const regime = String(value.regime || "unknown");
      const volatilityGroup = String(value.volatilityGroup || "unknown");
      const shock = String(value.shock || "normal");
      const contextKey = `${market}:${regime}`;
      const cohortKey = `${contextKey}:${volatilityGroup}`;
      const shockKey = `${market}:${shock}`;
      const samples = Math.max(0, Number(value.horizonSamples) || 0);
      const confidence = clamp(finite(value.confidenceScale, 1), 0, 1);
      const directionAccuracy = finiteOrNull(value.directionAccuracy);
      const skillVsNoChange = finiteOrNull(value.skillVsNoChange);
      statuses[status] += 1;
      series[ticker] = { ...value };
      contextRows[contextKey] ||= {
        seriesCount: 0,
        weakSeries: 0,
        samples: 0,
        confidenceTotal: 0,
        directionWeightedTotal: 0,
        directionSamples: 0,
        skillWeightedTotal: 0,
        skillSamples: 0,
      };
      const contextRow = contextRows[contextKey];
      contextRow.seriesCount += 1;
      contextRow.weakSeries += confidence < 0.999 ? 1 : 0;
      contextRow.samples += samples;
      contextRow.confidenceTotal += confidence;
      if (directionAccuracy !== null && samples > 0) {
        contextRow.directionWeightedTotal += directionAccuracy * samples;
        contextRow.directionSamples += samples;
      }
      if (skillVsNoChange !== null && samples > 0) {
        contextRow.skillWeightedTotal += skillVsNoChange * samples;
        contextRow.skillSamples += samples;
      }
      cohortRows[cohortKey] ||= {
        seriesCount: 0,
        samples: 0,
        confidenceTotal: 0,
      };
      cohortRows[cohortKey].seriesCount += 1;
      cohortRows[cohortKey].samples += samples;
      cohortRows[cohortKey].confidenceTotal += confidence;
      shockRows[shockKey] ||= {
        seriesCount: 0,
        samples: 0,
        confidenceTotal: 0,
        directionWeightedTotal: 0,
        directionSamples: 0,
      };
      const shockRow = shockRows[shockKey];
      shockRow.seriesCount += 1;
      shockRow.samples += samples;
      shockRow.confidenceTotal += confidence;
      if (directionAccuracy !== null && samples > 0) {
        shockRow.directionWeightedTotal += directionAccuracy * samples;
        shockRow.directionSamples += samples;
      }
    });

    const byContext = Object.freeze(Object.fromEntries(Object.entries(contextRows).map(([key, row]) => [
      key,
      Object.freeze({
        seriesCount: row.seriesCount,
        weakSeries: row.weakSeries,
        samples: row.samples,
        averageConfidenceScale: row.seriesCount
          ? Math.round((row.confidenceTotal / row.seriesCount) * 1000) / 1000
          : null,
        directionAccuracy: row.directionSamples
          ? Math.round((row.directionWeightedTotal / row.directionSamples) * 10000) / 10000
          : null,
        skillVsNoChange: row.skillSamples
          ? Math.round((row.skillWeightedTotal / row.skillSamples) * 10000) / 10000
          : null,
      }),
    ])));
    const byCohort = Object.freeze(Object.fromEntries(Object.entries(cohortRows).map(([key, row]) => [
      key,
      Object.freeze({
        seriesCount: row.seriesCount,
        samples: row.samples,
        averageConfidenceScale: row.seriesCount
          ? Math.round((row.confidenceTotal / row.seriesCount) * 1000) / 1000
          : null,
      }),
    ])));
    const byShock = Object.freeze(Object.fromEntries(Object.entries(shockRows).map(([key, row]) => [
      key,
      Object.freeze({
        seriesCount: row.seriesCount,
        samples: row.samples,
        averageConfidenceScale: row.seriesCount
          ? Math.round((row.confidenceTotal / row.seriesCount) * 1000) / 1000
          : null,
        directionAccuracy: row.directionSamples
          ? Math.round((row.directionWeightedTotal / row.directionSamples) * 10000) / 10000
          : null,
      }),
    ])));
    return Object.freeze({
      seriesCount: entries.length,
      statuses: Object.freeze(statuses),
      weakSeries: Object.freeze(entries
        .filter(([, value]) => finite(value?.confidenceScale, 1) < 0.999)
        .map(([ticker]) => ticker)),
      byContext,
      byCohort,
      byShock,
      series: Object.freeze(series),
    });
  }

  function correctionAt(profile, day) {
    const points = [{ day: 0, correction: 0 }, ...HORIZONS.map((horizon) => ({
      day: horizon,
      correction: finite(profile?.horizons?.[horizon]?.correction),
    }))];
    const boundedDay = Math.max(0, Number(day) || 0);
    for (let index = 1; index < points.length; index += 1) {
      const right = points[index];
      if (boundedDay > right.day) continue;
      const left = points[index - 1];
      const ratio = (boundedDay - left.day) / Math.max(1, right.day - left.day);
      return left.correction + ((right.correction - left.correction) * ratio);
    }
    return points.at(-1).correction;
  }

  function intervalScaleAt(profile, day) {
    const points = [{ day: 0, scale: 1 }, ...HORIZONS.map((horizon) => ({
      day: horizon,
      scale: clamp(finite(profile?.horizons?.[horizon]?.intervalScale, 1), 1, 1.9),
    }))];
    const boundedDay = Math.max(0, Number(day) || 0);
    for (let index = 1; index < points.length; index += 1) {
      const right = points[index];
      if (boundedDay > right.day) continue;
      const left = points[index - 1];
      const ratio = (boundedDay - left.day) / Math.max(1, right.day - left.day);
      return left.scale + ((right.scale - left.scale) * ratio);
    }
    return points.at(-1).scale;
  }

  function roundedProbabilities(values) {
    const total = Math.max(1e-9, values.reduce((sum, value) => sum + Math.max(0, value), 0));
    const exact = values.map((value) => (Math.max(0, value) / total) * 100);
    const rounded = exact.map(Math.floor);
    let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
    exact.map((value, index) => ({ index, fraction: value - rounded[index] }))
      .sort((left, right) => right.fraction - left.fraction)
      .forEach(({ index }) => {
        if (remainder > 0) {
          rounded[index] += 1;
          remainder -= 1;
        }
      });
    return rounded;
  }

  function applyForecastCalibration(forecast, profile) {
    if (!forecast || !profile?.applied || !Array.isArray(forecast.prices)) return forecast;
    const features = forecast.audit?.features || {};
    const hardNegativeRisk = finite(features.corporate_terminal_risk) > 0.5
      || finite(features.corporate_recent_dilution_risk) > 0.5
      || finite(features.internet_news_critical_risk) > 0.5;
    const effectiveCorrection = (day) => {
      const correction = correctionAt(profile, day);
      return hardNegativeRisk ? Math.min(0, correction) : correction;
    };
    const shift = (values) => (Array.isArray(values) ? values.map((value, day) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number * Math.exp(effectiveCorrection(day)) : value;
    }) : values);
    const shiftedPrices = shift(forecast.prices);
    const widenBound = (values, side) => (Array.isArray(values) ? values.map((value, day) => {
      const center = Number(shiftedPrices?.[day]);
      const shifted = Number(value) * Math.exp(effectiveCorrection(day));
      if (!Number.isFinite(center) || center <= 0 || !Number.isFinite(shifted) || shifted <= 0) return value;
      const distance = side === "lower"
        ? Math.max(0, Math.log(center / shifted))
        : Math.max(0, Math.log(shifted / center));
      const inputIntervalScale = clamp(finite(profile?.inputReliability?.intervalScale, 1), 1, 1.9);
      const widened = distance * intervalScaleAt(profile, day) * inputIntervalScale;
      return side === "lower" ? center * Math.exp(-widened) : center * Math.exp(widened);
    }) : values);
    const scenarios = Object.fromEntries(Object.entries(forecast.scenarios || {}).map(([key, scenario]) => [
      key,
      scenario?.prices ? { ...scenario, prices: shift(scenario.prices) } : scenario,
    ]));

    const terminalBias = effectiveCorrection(126);
    const scenarioKeys = ["upside", "sideways", "downside"];
    if (scenarioKeys.every((key) => scenarios[key])) {
      const strength = clamp(terminalBias / 0.12, -0.45, 0.45);
      const current = scenarioKeys.map((key) => finite(scenarios[key].weight ?? scenarios[key].probability, 0));
      const empirical = profile.horizons?.[126]?.probability?.logAdjustments || {};
      const adjustments = [
        strength + finite(empirical.upside),
        (-Math.abs(strength) * 0.2) + finite(empirical.sideways),
        -strength + finite(empirical.downside),
      ];
      if (hardNegativeRisk) {
        adjustments[0] = Math.min(0, adjustments[0]);
        adjustments[2] = Math.max(0, adjustments[2]);
      }
      const calibrated = roundedProbabilities(current.map((value, index) => (
        value * Math.exp(adjustments[index])
      )));
      const probabilityConfidence = finite(profile.horizons?.[126]?.probability?.confidenceScale, 1);
      const forecastConfidence = finite(profile.horizons?.[126]?.confidenceScale, 1);
      const qualityConfidence = finite(profile.qualityConfidenceScale, 1);
      const inputConfidence = finite(profile.inputReliability?.confidenceScale, 1);
      const confidence = clamp(
        Math.min(probabilityConfidence, forecastConfidence, qualityConfidence, inputConfidence),
        0.45,
        1,
      );
      let honestProbabilities = roundedProbabilities(calibrated.map((value) => (
        ((value / 100) * confidence) + ((1 / SCENARIO_KEYS.length) * (1 - confidence))
      )));
      if (hardNegativeRisk) {
        honestProbabilities = roundedProbabilities([
          0,
          honestProbabilities[1],
          honestProbabilities[0] + honestProbabilities[2],
        ]);
      }
      scenarioKeys.forEach((key, index) => {
        scenarios[key] = {
          ...scenarios[key],
          probability: honestProbabilities[index],
          weight: honestProbabilities[index],
        };
      });
    }

    const attributionHorizons = { ...(forecast.attribution?.horizons || {}) };
    [20, 63, 126].forEach((horizon) => {
      const prior = attributionHorizons[horizon] || attributionHorizons[String(horizon)];
      if (!prior) return;
      const correction = effectiveCorrection(horizon);
      attributionHorizons[horizon] = {
        ...prior,
        expectedLogReturn: finite(prior.expectedLogReturn) + correction,
        components: { ...(prior.components || {}), journalCalibration: correction },
      };
    });
    const calibrationFeatures = Object.fromEntries(HORIZONS.flatMap((horizon) => [
      [`journal_bias_${horizon}`, effectiveCorrection(horizon)],
      [`journal_samples_${horizon}`, finite(profile.horizons[horizon]?.samples)],
      [`journal_probability_samples_${horizon}`, finite(profile.horizons[horizon]?.probability?.samples)],
      [`journal_brier_${horizon}`, finite(profile.horizons[horizon]?.probability?.brierScore)],
      [`journal_probability_confidence_${horizon}`, finite(profile.horizons[horizon]?.probability?.confidenceScale, 1)],
      [`journal_direction_accuracy_${horizon}`, finite(profile.horizons[horizon]?.directionAccuracy)],
      [`journal_skill_vs_no_change_${horizon}`, finite(profile.horizons[horizon]?.skillVsNoChange)],
      [`journal_skill_vs_momentum_${horizon}`, finite(profile.horizons[horizon]?.skillVsMomentum)],
      [`journal_confidence_scale_${horizon}`, finite(profile.horizons[horizon]?.confidenceScale, 1)],
      [`journal_interval_scale_${horizon}`, finite(profile.horizons[horizon]?.intervalScale, 1)],
    ]));
    calibrationFeatures.journal_quality_confidence_scale = finite(profile.qualityConfidenceScale, 1);
    calibrationFeatures.input_confidence_scale = finite(profile.inputReliability?.confidenceScale, 1);
    calibrationFeatures.input_freshness_scale = finite(profile.inputReliability?.freshnessScale, 1);
    calibrationFeatures.input_coverage_scale = finite(profile.inputReliability?.coverageScale, 1);
    calibrationFeatures.input_stale_source_count = profile.inputReliability?.staleSources?.length || 0;
    return {
      ...forecast,
      prices: shiftedPrices,
      lowerPrices: widenBound(forecast.lowerPrices, "lower"),
      upperPrices: widenBound(forecast.upperPrices, "upper"),
      scenarios,
      attribution: forecast.attribution ? { ...forecast.attribution, horizons: attributionHorizons } : forecast.attribution,
      audit: forecast.audit ? {
        ...forecast.audit,
        features: { ...features, ...calibrationFeatures },
      } : forecast.audit,
      validation: {
        ...(forecast.validation || {}),
        calibratedProbability: true,
        calibration: profile,
      },
      model: { ...(forecast.model || {}), journalCalibration: profile },
    };
  }

  globalScope.ThinkStockAiForecastCalibration = Object.freeze({
    HORIZONS,
    applyForecastCalibration,
    buildCalibrationProfile,
    buildContextQuality,
    buildForecastQualityDiagnostic,
    buildInputReliability,
    classifyContext,
    correctionAt,
    forecastQualityConfidenceScale,
    intervalScaleAt,
    probabilityCalibration,
    realizedScenario,
    summarizeForecastQualityDiagnostics,
  });
}(typeof self !== "undefined" ? self : globalThis));
