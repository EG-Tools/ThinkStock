export const QLIB_MATCHED_ANCHOR_FORMAT = "thinkstock-qlib-matched-anchor-v1";
export const QLIB_RUNTIME_ASSIST_FORMAT = "thinkstock-qlib-runtime-assist-v1";

const HORIZONS = Object.freeze([20, 63, 126]);
const DEFAULT_WEIGHTS = Object.freeze([0.05, 0.10, 0.15]);

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function predictionKey(ticker, horizon, date) {
  return `${String(ticker || "").toUpperCase()}|${Math.trunc(finite(horizon, 0))}|${String(date || "").slice(0, 10)}`;
}

function directionHit(actual, predicted, flatBand = 0.0025) {
  const classify = (value) => (value > flatBand ? 1 : (value < -flatBand ? -1 : 0));
  return classify(actual) === classify(predicted);
}

function summarizeRows(rows, weight) {
  const valid = rows.filter((row) => (
    Number.isFinite(row.actual)
    && Number.isFinite(row.champion)
    && Number.isFinite(row.qlibAlpha)
  ));
  if (!valid.length) {
    return Object.freeze({
      samples: 0,
      stocks: 0,
      baselineMae: null,
      assistedMae: null,
      errorReduction: null,
      baselineDirectionAccuracy: null,
      assistedDirectionAccuracy: null,
      directionDeltaPoints: null,
    });
  }
  let baselineError = 0;
  let assistedError = 0;
  let baselineHits = 0;
  let assistedHits = 0;
  valid.forEach((row) => {
    const assisted = row.champion + (row.qlibAlpha * weight);
    baselineError += Math.abs(row.actual - row.champion);
    assistedError += Math.abs(row.actual - assisted);
    baselineHits += Number(directionHit(row.actual, row.champion));
    assistedHits += Number(directionHit(row.actual, assisted));
  });
  const baselineMae = baselineError / valid.length;
  const assistedMae = assistedError / valid.length;
  const baselineDirectionAccuracy = baselineHits / valid.length;
  const assistedDirectionAccuracy = assistedHits / valid.length;
  return Object.freeze({
    samples: valid.length,
    stocks: new Set(valid.map((row) => row.instrument)).size,
    baselineMae: rounded(baselineMae),
    assistedMae: rounded(assistedMae),
    errorReduction: rounded(baselineMae > 0 ? 1 - (assistedMae / baselineMae) : null, 4),
    baselineDirectionAccuracy: rounded(baselineDirectionAccuracy, 4),
    assistedDirectionAccuracy: rounded(assistedDirectionAccuracy, 4),
    directionDeltaPoints: rounded((assistedDirectionAccuracy - baselineDirectionAccuracy) * 100, 2),
  });
}

export function matchQlibAndThinkStockAnchors(qlibRows, championReport, cohort) {
  const requestedCohort = String(cohort || "");
  const qlibByKey = new Map();
  (Array.isArray(qlibRows) ? qlibRows : []).forEach((row) => {
    if (String(row?.cohort || "") !== requestedCohort) return;
    const key = predictionKey(row?.instrument, row?.horizon, row?.date);
    const actual = finite(row?.absoluteActual);
    const qlibAlpha = finite(row?.predicted);
    if (actual === null || qlibAlpha === null) return;
    qlibByKey.set(key, row);
  });
  const matches = [];
  let actualMismatch = 0;
  (Array.isArray(championReport?.observations) ? championReport.observations : []).forEach((row) => {
    if (row?.targetType !== "stock") return;
    const qlib = qlibByKey.get(predictionKey(row?.series, row?.horizon, row?.cutoff));
    if (!qlib) return;
    const actual = finite(qlib.absoluteActual);
    const championActual = finite(row?.actualReturn);
    const championPrediction = finite(row?.predictedReturn);
    if (actual === null || championActual === null || championActual <= -1
      || championPrediction === null || championPrediction <= -1) return;
    const championActualLog = Math.log1p(championActual);
    if (Math.abs(championActualLog - actual) > 0.03) {
      actualMismatch += 1;
      return;
    }
    matches.push(Object.freeze({
      instrument: String(qlib.instrument || row.series),
      market: String(qlib.market || row.market || ""),
      horizon: Math.trunc(finite(qlib.horizon, row.horizon)),
      date: String(qlib.date || row.cutoff).slice(0, 10),
      actual,
      champion: Math.log1p(championPrediction),
      qlibAlpha: finite(qlib.predicted, 0),
      modelGroup: String(qlib.modelGroup || "general"),
    }));
  });
  return Object.freeze({
    cohort: requestedCohort,
    qlibRows: qlibByKey.size,
    championRows: Array.isArray(championReport?.observations)
      ? championReport.observations.length
      : 0,
    matchedRows: matches.length,
    actualMismatch,
    rows: Object.freeze(matches),
  });
}

function cohortEvaluation(match, weight, options = {}) {
  const minimumSamples = Math.max(1, Math.trunc(finite(options.minimumSamples, 80)));
  const minimumPerHorizon = Math.max(1, Math.trunc(finite(options.minimumPerHorizon, 20)));
  const minimumImprovement = finite(options.minimumImprovement, 0.005);
  const overall = summarizeRows(match?.rows || [], weight);
  const byHorizon = Object.fromEntries(HORIZONS.map((horizon) => [
    horizon,
    summarizeRows((match?.rows || []).filter((row) => row.horizon === horizon), weight),
  ]));
  const comparableHorizons = HORIZONS.filter((horizon) => (
    byHorizon[horizon].samples >= minimumPerHorizon
  ));
  const winningHorizons = comparableHorizons.filter((horizon) => (
    finite(byHorizon[horizon].errorReduction, -1) > 0
    && finite(byHorizon[horizon].directionDeltaPoints, -100) >= -1.5
  ));
  const severeRegression = comparableHorizons.some((horizon) => (
    finite(byHorizon[horizon].errorReduction, 0) < -0.03
  ));
  const passed = overall.samples >= minimumSamples
    && comparableHorizons.length >= 2
    && winningHorizons.length >= 2
    && finite(overall.errorReduction, -1) >= minimumImprovement
    && finite(overall.directionDeltaPoints, -100) >= -1.5
    && !severeRegression;
  return Object.freeze({
    passed,
    weight,
    minimumSamples,
    minimumPerHorizon,
    minimumImprovement,
    comparableHorizons: Object.freeze(comparableHorizons),
    winningHorizons: Object.freeze(winningHorizons),
    severeRegression,
    overall,
    byHorizon: Object.freeze(byHorizon),
  });
}

export function evaluateQlibMatchedAssist(input, options = {}) {
  const weights = (Array.isArray(options.weights) ? options.weights : DEFAULT_WEIGHTS)
    .map((value) => finite(value))
    .filter((value) => value > 0 && value <= 0.2);
  const primaryCandidates = weights.map((weight) => cohortEvaluation(input?.primary, weight, {
    minimumSamples: options.minimumSamples,
    minimumPerHorizon: options.minimumPerHorizon,
    minimumImprovement: options.primaryMinimumImprovement ?? 0.005,
  }));
  const primary = primaryCandidates.sort((left, right) => (
    finite(right.overall.errorReduction, -Infinity) - finite(left.overall.errorReduction, -Infinity)
    || left.weight - right.weight
  ))[0] || cohortEvaluation(input?.primary, 0, options);
  const confirmation = cohortEvaluation(input?.confirmation, primary.weight, {
    minimumSamples: options.minimumSamples,
    minimumPerHorizon: options.minimumPerHorizon,
    minimumImprovement: options.confirmationMinimumImprovement ?? 0.0025,
  });
  const passed = primary.passed && confirmation.passed;
  return Object.freeze({
    format: QLIB_MATCHED_ANCHOR_FORMAT,
    status: passed ? "passed" : (primary.passed ? "confirmation-failed" : "primary-failed"),
    passed,
    selectedWeight: primary.weight,
    primary,
    confirmation,
    runtimeAssist: passed ? Object.freeze({
      format: QLIB_RUNTIME_ASSIST_FORMAT,
      relativeAlphaWeight: primary.weight,
      maximumAbsoluteLogAdjustment: 0.035,
      horizons: HORIZONS,
      policy: "add a capped Qlib relative-alpha adjustment to the ThinkStock champion",
    }) : null,
  });
}
