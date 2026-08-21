export function number(value) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export function quantile(values, ratioValue) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return null;
  const ratio = Math.max(0, Math.min(1, Number(ratioValue) || 0));
  const position = (finite.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return finite[lower];
  return finite[lower] + ((finite[upper] - finite[lower]) * (position - lower));
}

function lowerTailAverage(values, ratioValue = 0.1) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return null;
  const count = Math.max(1, Math.ceil(finite.length * Math.max(0.01, ratioValue)));
  return average(finite.slice(0, count));
}

export function ratio(rows, predicate) {
  return rows.length ? rows.filter(predicate).length / rows.length : null;
}

export function rounded(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function summarizeTimingRows(rows, type) {
  const directionSign = type === "buy" ? 1 : -1;
  const directional20 = rows.map((row) => (
    Number.isFinite(row.directional20) ? row.directional20 : row.return20 * directionSign
  ));
  const directional63 = rows.map((row) => (
    Number.isFinite(row.directional63) ? row.directional63 : row.return63 * directionSign
  ));
  const gains20 = directional20.filter((value) => value > 0);
  const losses20 = directional20.filter((value) => value < 0);
  const meanGain20 = average(gains20);
  const meanLoss20 = average(losses20);
  const meanAdverse20 = average(rows.map((row) => row.adverse20));
  const meanFavorable20 = average(rows.map((row) => row.favorable20));
  const meanReturn20 = average(rows.map((row) => row.return20));
  const meanReturn63 = average(rows.map((row) => row.return63));
  return {
    samples: rows.length,
    direction20: rounded(ratio(rows, (row) => row.direction20)),
    direction63: rounded(ratio(rows, (row) => row.direction63)),
    excursion20: rounded(ratio(rows, (row) => row.excursionHit)),
    meanReturn20: rounded(meanReturn20 === null ? null : meanReturn20 * directionSign),
    meanReturn63: rounded(meanReturn63 === null ? null : meanReturn63 * directionSign),
    medianReturn20: rounded(quantile(directional20, 0.5)),
    medianReturn63: rounded(quantile(directional63, 0.5)),
    lowerDecileReturn20: rounded(quantile(directional20, 0.1)),
    meanAdverse20: rounded(meanAdverse20),
    meanFavorable20: rounded(meanFavorable20),
    payoffRatio20: rounded(meanGain20 !== null && meanLoss20 !== null && meanLoss20 < 0
      ? meanGain20 / Math.abs(meanLoss20)
      : null),
    favorableAdverseRatio20: rounded(
      meanFavorable20 !== null && meanAdverse20 !== null && meanAdverse20 < 0
        ? meanFavorable20 / Math.abs(meanAdverse20)
        : null,
    ),
    meanTurningDistance: rounded(average(rows.map((row) => row.turningDistance))),
    vkospiCoverage: rounded(ratio(rows, (row) => row.vkospiPercentile !== null)),
  };
}

function booleanRate(rows, key, fallback) {
  const eligible = rows.filter((row) => (
    typeof row?.[key] === "boolean" || typeof fallback?.(row) === "boolean"
  ));
  return rounded(ratio(eligible, (row) => (
    typeof row?.[key] === "boolean" ? row[key] : fallback(row)
  )));
}

function directionalAverage(rows, key, returnKey) {
  return rounded(average(rows.map((row) => {
    if (Number.isFinite(row?.[key])) return row[key];
    const fallbackValue = number(row?.[returnKey]);
    return fallbackValue === null ? null : -fallbackValue;
  })));
}

export function summarizeSellObjectives(rows) {
  const sellRows = rows.filter((row) => row?.type === "sell");
  const sellDirectionalValue = (row, directionalKey, returnKey) => {
    const explicit = number(row?.[directionalKey]);
    if (explicit !== null) return explicit;
    const fallback = number(row?.[returnKey]);
    return fallback === null ? null : -fallback;
  };
  const directional20 = sellRows.map((row) => (
    sellDirectionalValue(row, "directional20", "return20")
  ));
  const directional63 = sellRows.map((row) => (
    sellDirectionalValue(row, "directional63", "return63")
  ));
  const shortCorrection = {
    samples: sellRows.length,
    direction5: booleanRate(sellRows, "direction5", (row) => (
      Number.isFinite(number(row?.return5)) ? number(row.return5) < 0 : null
    )),
    direction10: booleanRate(sellRows, "direction10", (row) => (
      Number.isFinite(number(row?.return10)) ? number(row.return10) < 0 : null
    )),
    excursion10: booleanRate(sellRows, "excursion10Hit", () => null),
    excursion20: booleanRate(sellRows, "excursionHit", () => null),
    meanDirectional5: directionalAverage(sellRows, "directional5", "return5"),
    meanDirectional10: directionalAverage(sellRows, "directional10", "return10"),
    meanDaysToExcursion20: rounded(average(sellRows.map((row) => number(row.daysToExcursion20)))),
    meanAdverse20: rounded(average(sellRows.map((row) => number(row.adverse20)))),
    meanFavorable20: rounded(average(sellRows.map((row) => number(row.favorable20)))),
    tailContainment20: rounded(ratio(
      directional20.filter(Number.isFinite),
      (value) => value > -0.1,
    )),
    lowerDecileDirectional20: rounded(lowerTailAverage(directional20)),
  };
  const meanFavorable20 = number(shortCorrection.meanFavorable20);
  const meanAdverse20 = number(shortCorrection.meanAdverse20);
  shortCorrection.meanNetExcursion20 = rounded(
    meanFavorable20 !== null && meanAdverse20 !== null
      ? meanFavorable20 + meanAdverse20
      : null,
  );
  shortCorrection.favorableAdverseRatio20 = rounded(
    meanFavorable20 !== null && meanAdverse20 !== null && meanAdverse20 < 0
      ? meanFavorable20 / Math.abs(meanAdverse20)
      : null,
  );
  shortCorrection.composite = rounded(average([
    shortCorrection.direction5,
    shortCorrection.direction10,
    shortCorrection.excursion10,
    shortCorrection.excursion20,
  ]));

  const mediumTrendReversal = {
    samples: sellRows.length,
    direction20: booleanRate(sellRows, "direction20", (row) => (
      Number.isFinite(number(row?.return20)) ? number(row.return20) < 0 : null
    )),
    direction63: booleanRate(sellRows, "direction63", (row) => (
      Number.isFinite(number(row?.return63)) ? number(row.return63) < 0 : null
    )),
    persistentDirection: booleanRate(sellRows, "persistentDirection", (row) => (
      typeof row?.direction20 === "boolean" && typeof row?.direction63 === "boolean"
        ? row.direction20 && row.direction63
        : null
    )),
    meanDirectional20: directionalAverage(sellRows, "directional20", "return20"),
    meanDirectional63: directionalAverage(sellRows, "directional63", "return63"),
    tailContainment63: rounded(ratio(
      directional63.filter(Number.isFinite),
      (value) => value > -0.2,
    )),
    lowerDecileDirectional63: rounded(lowerTailAverage(directional63)),
  };
  mediumTrendReversal.composite = rounded(average([
    mediumTrendReversal.direction20,
    mediumTrendReversal.direction63,
    mediumTrendReversal.persistentDirection,
  ]));

  return {
    samples: sellRows.length,
    shortCorrection,
    mediumTrendReversal,
  };
}

function objectiveMetricDeltas(baseline, candidate) {
  return Object.fromEntries(Object.keys(candidate).filter((key) => (
    key !== "samples"
    && Number.isFinite(number(candidate[key]))
    && Number.isFinite(number(baseline?.[key]))
  )).map((key) => [key, rounded(number(candidate[key]) - number(baseline[key]))]));
}

export function compareSellObjectives(baselineRows, candidateRows) {
  const baseline = summarizeSellObjectives(baselineRows);
  const candidate = summarizeSellObjectives(candidateRows);
  return {
    baseline,
    candidate,
    deltas: {
      shortCorrection: objectiveMetricDeltas(
        baseline.shortCorrection,
        candidate.shortCorrection,
      ),
      mediumTrendReversal: objectiveMetricDeltas(
        baseline.mediumTrendReversal,
        candidate.mediumTrendReversal,
      ),
    },
  };
}

export function summarizeSellObjectiveGroups(rows, keySelector) {
  const groups = new Map();
  rows.filter((row) => row?.type === "sell").forEach((row) => {
    const key = keySelector(row);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupRows]) => [key, summarizeSellObjectives(groupRows)]));
}

function objectiveHasNoRegression(deltas, rateKeys, returnKeys, options = {}) {
  const maximumRateDrop = Math.max(0, Number(options.maximumRateDrop) || 0.01);
  const maximumReturnDrop = Math.max(0, Number(options.maximumReturnDrop) || 0.005);
  return rateKeys.every((key) => (deltas[key] ?? -Infinity) >= -maximumRateDrop)
    && returnKeys.every((key) => (deltas[key] ?? -Infinity) >= -maximumReturnDrop);
}

export function sellObjectivePromotionDecision(baselineRows, candidateRows, options = {}) {
  const minimumSamples = Math.max(30, Number(options.minimumSamples) || 120);
  const minimumCompositeGain = Math.max(0, Number(options.minimumCompositeGain) || 0.005);
  const comparison = compareSellObjectives(baselineRows, candidateRows);
  const enoughSamples = Math.min(
    comparison.baseline.samples,
    comparison.candidate.samples,
  ) >= minimumSamples;
  const shortDeltas = comparison.deltas.shortCorrection;
  const mediumDeltas = comparison.deltas.mediumTrendReversal;
  const shortCorrection = enoughSamples
    && (shortDeltas.composite ?? -Infinity) >= minimumCompositeGain
    && objectiveHasNoRegression(
      shortDeltas,
      ["direction5", "direction10", "excursion10", "excursion20", "tailContainment20"],
      ["meanDirectional5", "meanDirectional10", "lowerDecileDirectional20"],
      options,
    )
    && (mediumDeltas.composite ?? -Infinity) >= -0.01
    && (mediumDeltas.meanDirectional63 ?? -Infinity) >= -0.005;
  const mediumTrendReversal = enoughSamples
    && (mediumDeltas.composite ?? -Infinity) >= minimumCompositeGain
    && objectiveHasNoRegression(
      mediumDeltas,
      ["direction20", "direction63", "persistentDirection", "tailContainment63"],
      ["meanDirectional20", "meanDirectional63", "lowerDecileDirectional63"],
      options,
    )
    && (shortDeltas.composite ?? -Infinity) >= -0.01
    && (shortDeltas.meanDirectional10 ?? -Infinity) >= -0.005;
  const promotedObjectives = [
    shortCorrection ? "short-correction" : "",
    mediumTrendReversal ? "medium-trend-reversal" : "",
  ].filter(Boolean);
  return {
    promote: promotedObjectives.length > 0,
    decision: promotedObjectives.length ? "promote-objective" : "keep-champion",
    minimumSamples,
    minimumCompositeGain,
    promotedObjectives,
    comparison,
  };
}

export function timingComposite(summary) {
  if (!summary?.samples) return null;
  return average([summary.direction20, summary.direction63, summary.excursion20]);
}

export function summarizeTimingOutcomes(rows) {
  const output = {};
  for (const kind of ["all", "index", "stock"]) {
    const subset = kind === "all" ? rows : rows.filter((row) => row.kind === kind);
    output[kind] = {};
    for (const type of ["buy", "sell"]) {
      const typed = subset.filter((row) => row.type === type);
      output[kind][type] = summarizeTimingRows(typed, type);
      output[kind][type].composite = rounded(timingComposite(output[kind][type]));
    }
  }
  return output;
}

export function summarizeTimingGroups(rows, keySelector) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keySelector(row);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupRows]) => [key, summarizeTimingOutcomes(groupRows)]));
}

export function summarizeTimingSegments(rows) {
  const periods = [
    ["2011-2016", "2011-01-01", "2016-12-31"],
    ["2017-2021", "2017-01-01", "2021-12-31"],
    ["2022-2026", "2022-01-01", "2026-12-31"],
  ];
  const archetypes = [...new Set(rows.flatMap((row) => row.tags || []))].sort();
  const regimes = [...new Set(rows.map((row) => row.marketRegime).filter(Boolean))].sort();
  const structuralDirections = [...new Set(rows
    .map((row) => row.structuralDirection)
    .filter(Boolean))].sort();
  return {
    byMarket: Object.fromEntries(["KOSPI", "KOSDAQ"].map((market) => [
      market,
      summarizeTimingOutcomes(rows.filter((row) => row.market === market)),
    ])),
    byPeriod: Object.fromEntries(periods.map(([label, start, end]) => [
      label,
      summarizeTimingOutcomes(rows.filter((row) => row.actionDate >= start && row.actionDate <= end)),
    ])),
    byArchetype: Object.fromEntries(archetypes.map((tag) => [
      tag,
      summarizeTimingOutcomes(rows.filter((row) => row.tags?.includes(tag))),
    ])),
    byRegime: Object.fromEntries(regimes.map((regime) => [
      regime,
      summarizeTimingOutcomes(rows.filter((row) => row.marketRegime === regime)),
    ])),
    byStructuralDirection: Object.fromEntries(structuralDirections.map((direction) => [
      direction,
      summarizeTimingOutcomes(rows.filter((row) => row.structuralDirection === direction)),
    ])),
  };
}

export function timingValidationSafety(baselineSegments, candidateSegments, options = {}) {
  const maximumCompositeDrop = Math.max(0.01, Number(options.maximumCompositeDrop) || 0.03);
  const issues = [];
  for (const family of [
    "byMarket",
    "byPeriod",
    "byArchetype",
    "byRegime",
    "byStructuralDirection",
  ]) {
    for (const [name, candidate] of Object.entries(candidateSegments?.[family] || {})) {
      const baseline = baselineSegments?.[family]?.[name];
      if (!baseline) continue;
      for (const kind of ["index", "stock"]) {
        for (const type of ["buy", "sell"]) {
          const before = baseline?.[kind]?.[type];
          const after = candidate?.[kind]?.[type];
          if (Math.min(Number(before?.samples) || 0, Number(after?.samples) || 0) < 12) continue;
          const beforeComposite = number(before?.composite);
          const afterComposite = number(after?.composite);
          if (beforeComposite === null || afterComposite === null) continue;
          const delta = afterComposite - beforeComposite;
          if (Number.isFinite(delta) && delta <= -maximumCompositeDrop) {
            issues.push({
              family,
              name,
              kind,
              type,
              samples: after.samples,
              compositeDelta: rounded(delta),
            });
          }
        }
      }
    }
  }
  return { passed: issues.length === 0, issues };
}

export function stableTimingTickerBucket(ticker, buckets = 4) {
  let hash = 2166136261;
  for (const character of String(ticker || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % Math.max(2, buckets);
}

export function strictTimingPromotionRows(rows) {
  return rows.filter((row) => row.actionDate >= "2022-01-01"
    && (row.kind === "index" || stableTimingTickerBucket(row.ticker) === 0));
}

export function timingTickerFoldStability(baselineRows, candidateRows, side) {
  const folds = Array.from({ length: 4 }, (_, bucket) => {
    const filter = (row) => row.actionDate >= "2022-01-01"
      && row.kind === "stock"
      && row.type === side
      && stableTimingTickerBucket(row.ticker) === bucket;
    const baseline = summarizeTimingRows(baselineRows.filter(filter), side);
    const candidate = summarizeTimingRows(candidateRows.filter(filter), side);
    baseline.composite = rounded(timingComposite(baseline));
    candidate.composite = rounded(timingComposite(candidate));
    return {
      bucket,
      baselineSamples: baseline.samples,
      candidateSamples: candidate.samples,
      compositeDelta: rounded(Number(candidate.composite) - Number(baseline.composite)),
      direction20Delta: rounded(Number(candidate.direction20) - Number(baseline.direction20)),
      direction63Delta: rounded(Number(candidate.direction63) - Number(baseline.direction63)),
      excursion20Delta: rounded(Number(candidate.excursion20) - Number(baseline.excursion20)),
    };
  });
  const valid = folds.filter((fold) => (
    Math.min(fold.baselineSamples, fold.candidateSamples) >= 30
    && Number.isFinite(fold.compositeDelta)
  ));
  return {
    folds,
    validFolds: valid.length,
    positiveFolds: valid.filter((fold) => fold.compositeDelta > 0).length,
    meanCompositeDelta: rounded(average(valid.map((fold) => fold.compositeDelta))),
    worstCompositeDelta: valid.length
      ? rounded(Math.min(...valid.map((fold) => fold.compositeDelta)))
      : null,
  };
}

function timingCohortStability(baselineRows, candidateRows, side, cohorts, minimumSamples) {
  const rows = cohorts.map(({ id, matches }) => {
    const filter = (row) => row.kind === "stock" && row.type === side && matches(row);
    const baseline = summarizeTimingRows(baselineRows.filter(filter), side);
    const candidate = summarizeTimingRows(candidateRows.filter(filter), side);
    baseline.composite = rounded(timingComposite(baseline));
    candidate.composite = rounded(timingComposite(candidate));
    return {
      id,
      baselineSamples: baseline.samples,
      candidateSamples: candidate.samples,
      compositeDelta: rounded(Number(candidate.composite) - Number(baseline.composite)),
      direction20Delta: rounded(Number(candidate.direction20) - Number(baseline.direction20)),
      direction63Delta: rounded(Number(candidate.direction63) - Number(baseline.direction63)),
      excursion20Delta: rounded(Number(candidate.excursion20) - Number(baseline.excursion20)),
    };
  });
  const valid = rows.filter((row) => (
    Math.min(row.baselineSamples, row.candidateSamples) >= minimumSamples
    && Number.isFinite(row.compositeDelta)
  ));
  return {
    cohorts: rows,
    validCohorts: valid.length,
    positiveCohorts: valid.filter((row) => row.compositeDelta > 0).length,
    meanCompositeDelta: rounded(average(valid.map((row) => row.compositeDelta))),
    worstCompositeDelta: valid.length
      ? rounded(Math.min(...valid.map((row) => row.compositeDelta)))
      : null,
  };
}

export function timingTemporalStability(baselineRows, candidateRows, side) {
  const years = [...new Set([...baselineRows, ...candidateRows]
    .map((row) => Number(String(row?.actionDate || "").slice(0, 4)))
    .filter((year) => Number.isInteger(year) && year >= 2022))].sort((left, right) => left - right);
  return timingCohortStability(
    baselineRows,
    candidateRows,
    side,
    years.map((year) => ({
      id: String(year),
      matches: (row) => String(row.actionDate || "").startsWith(`${year}-`),
    })),
    40,
  );
}

export function timingRegimeStability(baselineRows, candidateRows, side) {
  const regimes = [...new Set([...baselineRows, ...candidateRows]
    .filter((row) => row.actionDate >= "2022-01-01")
    .map((row) => row.marketRegime)
    .filter((regime) => regime && regime !== "unclassified"))].sort();
  return timingCohortStability(
    baselineRows,
    candidateRows,
    side,
    regimes.map((regime) => ({
      id: regime,
      matches: (row) => row.actionDate >= "2022-01-01" && row.marketRegime === regime,
    })),
    40,
  );
}

export function timingSidePromotionDecision(baselineRows, candidateRows, side, options = {}) {
  const minimumSamples = Math.max(30, Number(options.minimumSamples) || 120);
  const minimumCompositeGain = Math.max(0, Number(options.minimumCompositeGain) || 0.005);
  const maximumRateDrop = Math.max(0, Number(options.maximumRateDrop) || 0.01);
  const maximumReturnDrop = Math.max(0, Number(options.maximumReturnDrop) || 0.005);
  const maximumTailDrop = Math.max(0, Number(options.maximumTailDrop) || 0.02);
  const predictiveBaselineRows = baselineRows.filter((row) => row.signalRole !== "warning");
  const predictiveCandidateRows = candidateRows.filter((row) => row.signalRole !== "warning");
  const baseline = summarizeTimingRows(strictTimingPromotionRows(predictiveBaselineRows).filter((row) => (
    row.kind === "stock" && row.type === side
  )), side);
  const candidate = summarizeTimingRows(strictTimingPromotionRows(predictiveCandidateRows).filter((row) => (
    row.kind === "stock" && row.type === side
  )), side);
  baseline.composite = rounded(timingComposite(baseline));
  candidate.composite = rounded(timingComposite(candidate));
  const metricDelta = (key) => rounded(Number(candidate[key]) - Number(baseline[key]));
  const deltas = {
    composite: metricDelta("composite"),
    direction20: metricDelta("direction20"),
    direction63: metricDelta("direction63"),
    excursion20: metricDelta("excursion20"),
    meanReturn20: metricDelta("meanReturn20"),
    meanReturn63: metricDelta("meanReturn63"),
    medianReturn20: metricDelta("medianReturn20"),
    lowerDecileReturn20: metricDelta("lowerDecileReturn20"),
    meanAdverse20: metricDelta("meanAdverse20"),
    payoffRatio20: metricDelta("payoffRatio20"),
    favorableAdverseRatio20: metricDelta("favorableAdverseRatio20"),
  };
  const reasons = [];
  if (Math.min(baseline.samples, candidate.samples) < minimumSamples) {
    reasons.push("insufficient-strict-holdout");
  }
  if ((deltas.composite ?? -Infinity) < minimumCompositeGain) {
    reasons.push("no-material-composite-gain");
  }
  for (const key of ["direction20", "direction63", "excursion20"]) {
    if ((deltas[key] ?? -Infinity) < -maximumRateDrop) reasons.push(`${key}-regression`);
  }
  for (const key of ["meanReturn20", "meanReturn63", "medianReturn20", "meanAdverse20"]) {
    if ((deltas[key] ?? -Infinity) < -maximumReturnDrop) reasons.push(`${key}-regression`);
  }
  if ((deltas.lowerDecileReturn20 ?? -Infinity) < -maximumTailDrop) {
    reasons.push("lower-tail-regression");
  }
  for (const key of ["payoffRatio20", "favorableAdverseRatio20"]) {
    if (Number.isFinite(deltas[key]) && deltas[key] < -0.15) reasons.push(`${key}-regression`);
  }
  const signalRatio = baseline.samples ? candidate.samples / baseline.samples : null;
  if (signalRatio !== null && (signalRatio < 0.65 || signalRatio > 1.5)) {
    reasons.push("signal-frequency-regression");
  }
  const safety = timingValidationSafety(
    summarizeTimingSegments(strictTimingPromotionRows(predictiveBaselineRows).filter((row) => row.type === side)),
    summarizeTimingSegments(strictTimingPromotionRows(predictiveCandidateRows).filter((row) => row.type === side)),
  );
  if (!safety.passed) reasons.push("cohort-regression");
  const foldStability = timingTickerFoldStability(
    predictiveBaselineRows,
    predictiveCandidateRows,
    side,
  );
  if (foldStability.validFolds >= 3 && (
    foldStability.positiveFolds < Math.ceil(foldStability.validFolds / 2)
    || (foldStability.meanCompositeDelta ?? -Infinity) < 0.002
    || (foldStability.worstCompositeDelta ?? -Infinity) < -0.015
  )) reasons.push("unstable-ticker-folds");
  const temporalStability = timingTemporalStability(
    predictiveBaselineRows,
    predictiveCandidateRows,
    side,
  );
  if (temporalStability.validCohorts >= 3 && (
    temporalStability.positiveCohorts < Math.ceil(temporalStability.validCohorts / 2)
    || (temporalStability.meanCompositeDelta ?? -Infinity) < 0.002
    || (temporalStability.worstCompositeDelta ?? -Infinity) < -0.02
  )) reasons.push("unstable-temporal-windows");
  const regimeStability = timingRegimeStability(
    predictiveBaselineRows,
    predictiveCandidateRows,
    side,
  );
  if (regimeStability.validCohorts >= 3 && (
    regimeStability.positiveCohorts < Math.ceil(regimeStability.validCohorts / 2)
    || (regimeStability.meanCompositeDelta ?? -Infinity) < 0
    || (regimeStability.worstCompositeDelta ?? -Infinity) < -0.025
  )) reasons.push("unstable-market-regimes");
  const objectivePromotion = side === "sell"
    ? sellObjectivePromotionDecision(
      strictTimingPromotionRows(predictiveBaselineRows).filter((row) => row.kind === "stock"),
      strictTimingPromotionRows(predictiveCandidateRows).filter((row) => row.kind === "stock"),
      options,
    )
    : null;
  if (side === "sell" && !objectivePromotion.promote) reasons.push("no-sell-objective-gain");
  return {
    side,
    decision: reasons.length ? "keep-champion" : "promote-challenger",
    promote: reasons.length === 0,
    strictHoldout: {
      startDate: "2022-01-01",
      tickerBucket: "fnv1a-mod4-equals-0",
      minimumSamples,
    },
    baseline,
    candidate,
    deltas,
    signalRatio: rounded(signalRatio),
    safety,
    foldStability,
    temporalStability,
    regimeStability,
    objectivePromotion,
    excludedWarnings: {
      baseline: baselineRows.length - predictiveBaselineRows.length,
      candidate: candidateRows.length - predictiveCandidateRows.length,
    },
    reasons,
  };
}

export function timingPromotionDecision(baselineRows, buyCandidateRows, sellCandidateRows) {
  const buy = timingSidePromotionDecision(baselineRows, buyCandidateRows, "buy");
  const sell = timingSidePromotionDecision(baselineRows, sellCandidateRows, "sell");
  return {
    format: "thinkstock-market-timing-promotion-v1",
    buy,
    sell,
    promotedSides: [buy, sell].filter((row) => row.promote).map((row) => row.side),
  };
}

export function newTimingSignalRows(candidateRows, baselineRows) {
  const baselineByTickerType = new Map();
  baselineRows.forEach((row) => {
    const key = `${row.ticker}|${row.type}`;
    if (!baselineByTickerType.has(key)) baselineByTickerType.set(key, []);
    baselineByTickerType.get(key).push(Date.parse(`${row.date}T00:00:00Z`));
  });
  return candidateRows.filter((row) => {
    const date = Date.parse(`${row.date}T00:00:00Z`);
    const neighbors = baselineByTickerType.get(`${row.ticker}|${row.type}`) || [];
    return !neighbors.some((other) => Math.abs(other - date) <= 5 * 86400000);
  });
}

export function summarizeTimingTickerChanges(candidateRows, baselineRows, tickerNames = {}) {
  const added = newTimingSignalRows(candidateRows, baselineRows);
  const removed = newTimingSignalRows(baselineRows, candidateRows);
  const rows = new Map();
  const ensure = (ticker) => {
    if (!rows.has(ticker)) {
      rows.set(ticker, {
        ticker,
        name: tickerNames[ticker] || ticker,
        market: ticker.endsWith(".KQ") ? "KOSDAQ" : "KOSPI",
        addedBuyDates: [],
        removedBuyDates: [],
        addedSellDates: [],
        removedSellDates: [],
      });
    }
    return rows.get(ticker);
  };
  added.filter((row) => row.kind === "stock").forEach((row) => {
    ensure(row.ticker)[row.type === "buy" ? "addedBuyDates" : "addedSellDates"].push(row.date);
  });
  removed.filter((row) => row.kind === "stock").forEach((row) => {
    ensure(row.ticker)[row.type === "buy" ? "removedBuyDates" : "removedSellDates"].push(row.date);
  });
  return [...rows.values()].map((row) => {
    Object.keys(row).filter((key) => key.endsWith("Dates"))
      .forEach((key) => row[key].sort());
    const addedCount = row.addedBuyDates.length + row.addedSellDates.length;
    const removedCount = row.removedBuyDates.length + row.removedSellDates.length;
    return {
      ...row,
      addedCount,
      removedCount,
      changedCount: addedCount + removedCount,
      netBuy: row.addedBuyDates.length - row.removedBuyDates.length,
      netSell: row.addedSellDates.length - row.removedSellDates.length,
    };
  }).sort((left, right) => (
    right.changedCount - left.changedCount
    || right.addedCount - left.addedCount
    || left.ticker.localeCompare(right.ticker)
  ));
}

export function summarizeTimingTickerPerformance(candidateRows, baselineRows, tickerNames = {}) {
  const tickers = [...new Set([
    ...baselineRows.filter((row) => row.kind === "stock").map((row) => row.ticker),
    ...candidateRows.filter((row) => row.kind === "stock").map((row) => row.ticker),
  ])].sort();
  return tickers.map((ticker) => {
    const tickerBaseline = baselineRows.filter((row) => row.ticker === ticker);
    const tickerCandidate = candidateRows.filter((row) => row.ticker === ticker);
    const sides = Object.fromEntries(["buy", "sell"].map((side) => {
      const baseline = summarizeTimingRows(tickerBaseline.filter((row) => row.type === side), side);
      const candidate = summarizeTimingRows(tickerCandidate.filter((row) => row.type === side), side);
      baseline.composite = rounded(timingComposite(baseline));
      candidate.composite = rounded(timingComposite(candidate));
      return [side, {
        baseline,
        candidate,
        improvement: rounded(Number(candidate.composite) - Number(baseline.composite)),
      }];
    }));
    return {
      ticker,
      name: tickerNames[ticker] || ticker,
      market: ticker.endsWith(".KQ") ? "KOSDAQ" : "KOSPI",
      tags: [...new Set([...tickerBaseline, ...tickerCandidate]
        .flatMap((row) => row.tags || []))].sort(),
      ...sides,
    };
  });
}

export function compactTimingSignalOutcome(row) {
  return {
    ticker: row.ticker,
    market: row.market,
    date: row.date,
    actionDate: row.actionDate,
    marketRegime: row.marketRegime,
    family: row.signalFamily,
    behavior: row.behavior,
    role: row.signalRole,
    objective: row.calibrationObjective,
    evidenceCount: row.evidenceCount,
    score: rounded(row.score),
    return5: rounded(row.return5),
    return10: rounded(row.return10),
    return20: rounded(row.return20),
    return63: rounded(row.return63),
    direction5: row.direction5,
    direction10: row.direction10,
    direction20: row.direction20,
    direction63: row.direction63,
    persistentDirection: row.persistentDirection,
    excursion10Hit: row.excursion10Hit,
    excursionHit: row.excursionHit,
    daysToExcursion20: number(row.daysToExcursion20),
    price20d: rounded(row.price20d),
    price60d: rounded(row.price60d),
    price120d: rounded(row.price120d),
    price252d: rounded(row.price252d),
    price756d: rounded(row.price756d),
    price1260d: rounded(row.price1260d),
    structuralDirection: row.structuralDirection,
    structuralAnnualReturn: rounded(row.structuralAnnualReturn),
    structuralDirectionConsistency: rounded(row.structuralDirectionConsistency),
    calibration: row.calibration,
  };
}

export function summarizeSellTailFailures(rows, tickerNames = {}, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const horizon = Number(options.horizon) === 20 ? 20 : 63;
  const directionalKey = horizon === 20 ? "directional20" : "directional63";
  const returnKey = horizon === 20 ? "return20" : "return63";
  return rows
    .filter((row) => row?.kind === "stock"
      && row?.type === "sell"
      && row?.signalRole !== "warning")
    .map((row) => {
      const directional = number(row?.[directionalKey]);
      const fallbackReturn = number(row?.[returnKey]);
      return {
        row,
        directional: directional ?? (fallbackReturn === null ? null : -fallbackReturn),
      };
    })
    .filter((entry) => entry.directional !== null)
    .sort((left, right) => left.directional - right.directional
      || String(left.row.actionDate).localeCompare(String(right.row.actionDate)))
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      name: tickerNames[entry.row.ticker] || entry.row.ticker,
      horizon,
      directionalReturn: rounded(entry.directional),
      ...compactTimingSignalOutcome(entry.row),
    }));
}

export function summarizeTimingTickerChangeOutcomes(
  candidateRows,
  baselineRows,
  tickerNames = {},
) {
  const added = newTimingSignalRows(candidateRows, baselineRows)
    .filter((row) => row.kind === "stock");
  const removed = newTimingSignalRows(baselineRows, candidateRows)
    .filter((row) => row.kind === "stock");
  const tickers = [...new Set([...added, ...removed].map((row) => row.ticker))].sort();
  return tickers.map((ticker) => ({
    ticker,
    name: tickerNames[ticker] || ticker,
    market: ticker.endsWith(".KQ") ? "KOSDAQ" : "KOSPI",
    added: added.filter((row) => row.ticker === ticker).map(compactTimingSignalOutcome),
    removed: removed.filter((row) => row.ticker === ticker).map(compactTimingSignalOutcome),
  }));
}
