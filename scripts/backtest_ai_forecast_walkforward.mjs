import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { selectAnalysisEvidenceAsOf } from "../shared/ai-analysis-snapshots.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const PRICE_CACHE_PATH = path.join(CACHE_DIR, "walkforward-prices.json");
const CONTEXT_CACHE_PATH = path.join(CACHE_DIR, "walkforward-context.json");
const outputArgument = process.argv.indexOf("--output");
const outputName = outputArgument >= 0 ? path.basename(process.argv[outputArgument + 1] || "") : "walkforward-report.json";
if (!/^walkforward-[A-Za-z0-9._-]+\.json$/.test(outputName)) {
  throw new Error("Walk-forward output must be a walkforward-*.json filename");
}
const REPORT_PATH = path.join(CACHE_DIR, outputName);
const koreanVolatilityCandidate = !process.argv.includes("--without-vkospi");
const externalRiskCandidates = !process.argv.includes("--without-external-risk");
const ENGINE_PATHS = [
  "ai-forecast-math.js",
  "ai-forecast-model.js",
  "ai-scenario-paths.js",
  "ai-forecast-scenarios.js",
  "ai-context-profile.js",
  "ai-forecast.js",
].map((name) => path.join(ROOT, "docs", "modules", name));
const HORIZONS = Object.freeze([20, 63, 126]);
const MAX_HORIZON = HORIZONS.at(-1);
const MIN_HISTORY = 756;
const MAX_WINDOWS_PER_STOCK = 12;

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (!total) return [0, 0];
  const probability = successes / total;
  const denominator = 1 + ((z ** 2) / total);
  const center = (probability + ((z ** 2) / (2 * total))) / denominator;
  const radius = (z / denominator) * Math.sqrt(
    (probability * (1 - probability) / total) + ((z ** 2) / (4 * (total ** 2))),
  );
  return [clamp(center - radius, 0, 1), clamp(center + radius, 0, 1)];
}

function pearson(left, right) {
  const size = Math.min(left.length, right.length);
  if (size < 3) return 0;
  const leftValues = left.slice(0, size);
  const rightValues = right.slice(0, size);
  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < size; index += 1) {
    const leftDelta = leftValues[index] - leftMean;
    const rightDelta = rightValues[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : 0;
}

function classify(value, flatBand) {
  if (value > flatBand) return "upside";
  if (value < -flatBand) return "downside";
  return "sideways";
}

function topScenario(scenarios) {
  return ["upside", "sideways", "downside"].sort((left, right) => (
    Number(scenarios?.[right]?.probability || 0) - Number(scenarios?.[left]?.probability || 0)
  ))[0];
}

function priceMap(series) {
  const output = new Map();
  (series?.dates || []).forEach((date, index) => {
    const value = Number(series?.prices?.[index]);
    if (Number.isFinite(value) && value > 0) output.set(String(date).slice(0, 10), value);
  });
  return output;
}

function pricePoints(series) {
  const map = priceMap(series);
  return [...map.entries()]
    .map(([date, price]) => ({ date, price }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function alignedCandidate(seriesKey, dates, maps) {
  const map = maps.get(seriesKey) || new Map();
  return {
    series: seriesKey,
    dates,
    prices: dates.map((date) => map.get(date) ?? null),
  };
}

function anchorsFor(points) {
  const lastAnchor = points.length - MAX_HORIZON - 1;
  if (lastAnchor < MIN_HISTORY - 1) return [];
  const firstCandidate = Math.max(
    MIN_HISTORY - 1,
    lastAnchor - ((MAX_WINDOWS_PER_STOCK - 1) * MAX_HORIZON),
  );
  const anchors = [];
  for (let anchor = firstCandidate; anchor <= lastAnchor; anchor += MAX_HORIZON) anchors.push(anchor);
  if (anchors.at(-1) !== lastAnchor && anchors.length < MAX_WINDOWS_PER_STOCK) anchors.push(lastAnchor);
  return anchors.slice(-MAX_WINDOWS_PER_STOCK);
}

function rowsThrough(rows, cutoff) {
  return (rows || []).filter((row) => String(row?.date || "").slice(0, 10) <= cutoff);
}

function summarize(rows) {
  if (!rows.length) return {
    samples: 0,
    stocks: 0,
  };
  const directionHits = rows.filter((row) => row.directionCorrect).length;
  const scenarioRows = rows.filter((row) => row.topScenario);
  const scenarioHits = scenarioRows.filter((row) => row.scenarioCorrect).length;
  const medianClassHits = rows.filter((row) => row.medianClassCorrect).length;
  const intervalHits = rows.filter((row) => row.intervalCovered).length;
  const modelMae = mean(rows.map((row) => row.absoluteError));
  const noChangeMae = mean(rows.map((row) => row.noChangeError));
  const momentumMae = mean(rows.map((row) => row.momentumError));
  const brierScore = scenarioRows.length ? mean(scenarioRows.map((row) => ["upside", "sideways", "downside"]
    .reduce((sum, key) => {
      const probability = Number(row.scenarioWeights?.[key] || 0) / 100;
      const actual = row.actualClass === key ? 1 : 0;
      return sum + ((probability - actual) ** 2);
    }, 0))) : null;
  const directionInterval = wilsonInterval(directionHits, rows.length);
  const scenarioInterval = wilsonInterval(scenarioHits, scenarioRows.length);
  const actualClassCounts = Object.fromEntries(["upside", "sideways", "downside"].map((key) => [
    key,
    rows.filter((row) => row.actualClass === key).length,
  ]));
  const majorityClass = Object.entries(actualClassCounts)
    .sort((left, right) => right[1] - left[1])[0][0];
  return {
    samples: rows.length,
    stocks: new Set(rows.map((row) => row.series)).size,
    firstCutoff: rows.map((row) => row.cutoff).sort()[0],
    lastCutoff: rows.map((row) => row.cutoff).sort().at(-1),
    directionAccuracy: rounded(directionHits / rows.length, 4),
    directionAccuracy95: directionInterval.map((value) => rounded(value, 4)),
    topScenarioSamples: scenarioRows.length,
    topScenarioAccuracy: scenarioRows.length ? rounded(scenarioHits / scenarioRows.length, 4) : null,
    topScenarioAccuracy95: scenarioRows.length
      ? scenarioInterval.map((value) => rounded(value, 4))
      : null,
    scenarioBrierScore: rounded(brierScore),
    uniformScenarioBrierScore: scenarioRows.length ? rounded(2 / 3) : null,
    medianThreeClassAccuracy: rounded(medianClassHits / rows.length, 4),
    hindsightMajorityClass: majorityClass,
    hindsightMajorityClassAccuracy: rounded(actualClassCounts[majorityClass] / rows.length, 4),
    alwaysUpDirectionAccuracy: rounded(rows.filter((row) => row.actualReturn > 0).length / rows.length, 4),
    intervalCoverage: rounded(intervalHits / rows.length, 4),
    meanAbsoluteLogError: rounded(modelMae),
    medianAbsoluteLogError: rounded(median(rows.map((row) => row.absoluteError))),
    rootMeanSquaredLogError: rounded(Math.sqrt(mean(rows.map((row) => row.squaredError)))),
    noChangeMae: rounded(noChangeMae),
    momentumMae: rounded(momentumMae),
    improvementVsNoChange: rounded(noChangeMae > 0 ? (noChangeMae - modelMae) / noChangeMae : 0, 4),
    improvementVsMomentum: rounded(momentumMae > 0 ? (momentumMae - modelMae) / momentumMae : 0, 4),
    meanPredictedReturn: rounded(mean(rows.map((row) => row.predictedReturn))),
    meanActualReturn: rounded(mean(rows.map((row) => row.actualReturn))),
    meanSignedError: rounded(mean(rows.map((row) => row.signedError))),
    predictedClasses: Object.fromEntries(["upside", "sideways", "downside"].map((key) => [
      key,
      scenarioRows.filter((row) => row.topScenario === key).length,
    ])),
    actualClasses: actualClassCounts,
  };
}

function attributionDiagnostics(rows) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row.attribution?.components || {})))];
  return Object.fromEntries(keys.map((key) => {
    const pairs = rows.flatMap((row) => {
      const contribution = Number(row.attribution?.components?.[key]);
      return Number.isFinite(contribution) ? [{ contribution, actual: row.actualReturn }] : [];
    });
    const nonZero = pairs.filter((pair) => Math.abs(pair.contribution) > 1e-9);
    return [key, {
      samples: pairs.length,
      activeSamples: nonZero.length,
      meanContribution: rounded(mean(pairs.map((pair) => pair.contribution))),
      correlationWithActualReturn: rounded(pearson(
        pairs.map((pair) => pair.contribution),
        pairs.map((pair) => pair.actual),
      ), 4),
      activeDirectionAccuracy: nonZero.length
        ? rounded(nonZero.filter((pair) => Math.sign(pair.contribution) === Math.sign(pair.actual)).length / nonZero.length, 4)
        : null,
    }];
  }));
}

function adrState(row) {
  const features = row.audit?.features || {};
  if (features.adr_overheat_current === 1 || features.adr_latest >= 120) return "current-overheat";
  if (features.adr_overheat_exit_28d === 1
    || (features.adr_recent_high_28d >= 120 && features.adr_latest < 120)) return "exited-overheat";
  if (features.adr_depressed_current === 1 || features.adr_latest <= 75) return "current-depression";
  if (features.adr_depression_exit_28d === 1
    || (features.adr_recent_low_28d <= 75 && features.adr_latest > 75)) return "exited-depression";
  return Number.isFinite(features.adr_latest) ? "neutral" : "unavailable";
}

const sandbox = {};
vm.createContext(sandbox);
for (const enginePath of ENGINE_PATHS) {
  const engineSource = await readFile(enginePath, "utf8");
  vm.runInContext(engineSource, sandbox, { filename: enginePath });
}
const { buildForecast } = sandbox.ThinkStockAiForecast;
const { resolveScenarioPresentation } = sandbox.ThinkStockAiForecastScenarios;
const [prices, context] = await Promise.all([
  readJson(PRICE_CACHE_PATH),
  readJson(CONTEXT_CACHE_PATH),
]);
if (prices.format !== "thinkstock-ai-walkforward-prices-v1") {
  throw new Error("Run scripts/prepare_ai_walkforward_data.mjs first");
}
if (koreanVolatilityCandidate
  && !context.crisisRows?.some((row) => Number.isFinite(Number(row?.vkospi)))) {
  throw new Error("Run scripts/fetch_krx_vkospi_history.mjs and refresh walk-forward context first");
}

const maps = new Map(Object.entries(prices.series || {}).map(([key, value]) => [key, priceMap(value)]));
const selected = [
  ...(prices.selection?.KOSPI || []).map((series) => ({ series, market: "KOSPI", targetType: "stock" })),
  ...(prices.selection?.KOSDAQ || []).map((series) => ({ series, market: "KOSDAQ", targetType: "stock" })),
];
const selectedSeries = new Set(selected.map((item) => item.series));
const qualityCases = Array.isArray(prices.qualityCases) ? prices.qualityCases : [];
const qualityCaseByTicker = new Map(qualityCases.map((item) => [item.ticker, item]));
const targets = [
  ...selected,
  ...qualityCases.flatMap((item) => (
    prices.series?.[item?.ticker] && !selectedSeries.has(item.ticker)
      ? [{
        series: item.ticker,
        market: "QUALITY_CASE",
        targetType: "quality-case",
        qualityProfile: String(item.profile || ""),
      }]
      : []
  )),
  { series: "^KS11", market: "KOSPI_INDEX", targetType: "index" },
  { series: "^KQ11", market: "KOSDAQ_INDEX", targetType: "index" },
];
const observations = [];
const pointInTimeCoverage = {
  eligibleAnchors: 0,
  anchors: 0,
  consensus: 0,
  financials: 0,
  news: 0,
};
let completed = 0;
const expected = targets.reduce((sum, item) => (
  sum + anchorsFor(pricePoints(prices.series[item.series])).length
), 0);

for (const item of targets) {
  const points = pricePoints(prices.series[item.series]);
  for (const anchor of anchorsFor(points)) {
    const history = points.slice(0, anchor + 1);
    const cutoff = history.at(-1).date;
    const dates = history.map((point) => point.date);
    const currentPrice = history.at(-1).price;
    const analysis = item.targetType !== "index"
      ? selectAnalysisEvidenceAsOf(context.analysisByTicker?.[item.series], cutoff)
      : null;
    if (item.targetType !== "index") pointInTimeCoverage.eligibleAnchors += 1;
    if (analysis) {
      pointInTimeCoverage.anchors += 1;
      if (analysis.consensus) pointInTimeCoverage.consensus += 1;
      if (analysis.financials.length) pointInTimeCoverage.financials += 1;
      if (analysis.news.length) pointInTimeCoverage.news += 1;
    }
    const forecast = buildForecast({
      series: item.series,
      decisionDate: cutoff,
      dates,
      prices: history.map((point) => point.price),
      marketCandidates: ["^KS11", "^KQ11"].map((series) => alignedCandidate(series, dates, maps)),
      rotationCandidates: ["005930.KS", "000660.KS"].map((series) => alignedCandidate(series, dates, maps)),
      macroRows: rowsThrough(context.macroRows, cutoff),
      creditRows: rowsThrough(context.creditRows, cutoff),
      auxiliaryRows: rowsThrough(context.auxiliaryRows, cutoff),
      crisisRows: rowsThrough(context.crisisRows, cutoff),
      koreanVolatilityCandidate,
      externalRiskCandidates,
      consensus: analysis?.consensus || null,
      financials: analysis?.financials || [],
      internetNews: analysis?.news || [],
      horizon: MAX_HORIZON,
    });
    completed += 1;
    if (completed % 10 === 0 || completed === expected) {
      process.stderr.write(`AI walk-forward ${completed}/${expected}\n`);
    }
    if (!forecast || !(currentPrice > 0)) continue;

    HORIZONS.forEach((horizon) => {
      const actual = points[anchor + horizon];
      const predictedPrice = Number(forecast.prices?.[horizon]);
      if (!(actual?.price > 0 && predictedPrice > 0)) return;
      const horizonModel = forecast.model?.horizons?.find((value) => value.days === horizon) || null;
      const previousMomentumPrice = history.at(-(horizon + 1))?.price || currentPrice;
      const actualReturn = Math.log(actual.price / currentPrice);
      const predictedReturn = Math.log(predictedPrice / currentPrice);
      const momentumPrediction = clamp(Math.log(currentPrice / previousMomentumPrice), -0.6, 0.6);
      const flatBand = horizon === MAX_HORIZON
        ? (Number(forecast.scenarios?.calibration?.flatBand) || 0.07)
        : clamp(Number(forecast.projectedVolatility || 0) * Math.sqrt(horizon) * 0.35, 0.025, 0.1);
      const actualClass = classify(actualReturn, flatBand);
      const medianClass = classify(predictedReturn, flatBand);
      const scenario = horizon === MAX_HORIZON ? topScenario(forecast.scenarios) : null;
      const signedError = actualReturn - predictedReturn;
      observations.push({
        series: item.series,
        name: prices.names?.[item.series]
          || ({ "^KS11": "KOSPI", "^KQ11": "KOSDAQ" }[item.series])
          || item.series,
        market: item.market,
        targetType: item.targetType,
        qualityProfile: item.qualityProfile || "",
        horizon,
        cutoff,
        targetDate: actual.date,
        basePrice: rounded(currentPrice, 4),
        actualPrice: rounded(actual.price, 4),
        predictedPrice: rounded(predictedPrice, 4),
        lowerPrice: rounded(forecast.lowerPrices[horizon], 4),
        upperPrice: rounded(forecast.upperPrices[horizon], 4),
        actualReturn,
        predictedReturn,
        momentumPrediction,
        signedError,
        absoluteError: Math.abs(signedError),
        squaredError: signedError ** 2,
        noChangeError: Math.abs(actualReturn),
        momentumError: Math.abs(actualReturn - momentumPrediction),
        directionCorrect: Math.sign(actualReturn) === Math.sign(predictedReturn),
        intervalCovered: actual.price >= forecast.lowerPrices[horizon]
          && actual.price <= forecast.upperPrices[horizon],
        flatBand,
        actualClass,
        medianClass,
        medianClassCorrect: actualClass === medianClass,
        topScenario: scenario,
        scenarioCorrect: scenario ? actualClass === scenario : null,
        scenarioWeights: scenario ? {
          upside: forecast.scenarios?.upside?.probability || 0,
          sideways: forecast.scenarios?.sideways?.probability || 0,
          downside: forecast.scenarios?.downside?.probability || 0,
        } : {},
        modelVersion: forecast.model?.version || "",
        modelKind: horizonModel?.kind || "",
        modelConfig: horizonModel ? {
          lambda: horizonModel.lambda,
          neighborWeight: horizonModel.neighborWeight,
          predictionScale: horizonModel.predictionScale,
          window: horizonModel.window,
          multiplier: horizonModel.multiplier,
          reliability: horizonModel.reliability,
          localMode: horizonModel.localMode,
          calibration: horizonModel.calibration,
        } : null,
        audit: forecast.audit,
        attribution: forecast.attribution?.horizons?.[horizon] || null,
      });
    });
  }
}

const latestQualityCaseForecasts = Object.fromEntries(qualityCases.flatMap((item) => {
  const points = pricePoints(prices.series?.[item.ticker]);
  if (points.length < MIN_HISTORY) return [];
  const cutoff = points.at(-1).date;
  const dates = points.map((point) => point.date);
  const currentPrice = points.at(-1).price;
  const analysis = selectAnalysisEvidenceAsOf(context.analysisByTicker?.[item.ticker], cutoff);
  const forecast = buildForecast({
    series: item.ticker,
    decisionDate: cutoff,
    dates,
    prices: points.map((point) => point.price),
    marketCandidates: ["^KS11", "^KQ11"].map((series) => alignedCandidate(series, dates, maps)),
    rotationCandidates: ["005930.KS", "000660.KS"].map((series) => alignedCandidate(series, dates, maps)),
    macroRows: rowsThrough(context.macroRows, cutoff),
    creditRows: rowsThrough(context.creditRows, cutoff),
    auxiliaryRows: rowsThrough(context.auxiliaryRows, cutoff),
    crisisRows: rowsThrough(context.crisisRows, cutoff),
    koreanVolatilityCandidate,
    externalRiskCandidates,
    consensus: analysis?.consensus || null,
    financials: analysis?.financials || [],
    internetNews: analysis?.news || [],
    horizon: MAX_HORIZON,
  });
  if (!forecast || !(currentPrice > 0)) return [];
  const predictedPrice = Number(forecast.prices?.[MAX_HORIZON]);
  const top = topScenario(forecast.scenarios);
  const predictedReturn = predictedPrice > 0 ? Math.log(predictedPrice / currentPrice) : NaN;
  const presentation = resolveScenarioPresentation(
    forecast.scenarios,
    {
      expectedReturn: predictedReturn,
      flatBand: forecast.scenarios?.calibration?.flatBand,
    },
  );
  return [[item.ticker, {
    asOfDate: cutoff,
    basePrice: rounded(currentPrice, 4),
    predictedPrice: rounded(predictedPrice, 4),
    predictedReturn: rounded(predictedReturn),
    topScenario: top,
    scenarioPresentation: {
      rawPrimary: presentation.rawPrimaryKey,
      representative: presentation.representativeKey,
      expectedDirection: presentation.expectedDirection,
      decisive: presentation.decisive,
      lead: rounded(presentation.lead, 2),
    },
    scenarioWeights: Object.fromEntries(["upside", "sideways", "downside"].map((key) => [
      key,
      rounded(Number(forecast.scenarios?.[key]?.probability || 0), 2),
    ])),
    rangeBoundScore: rounded(Number(forecast.audit?.features?.price_range_bound_score), 4),
    rangePosition: rounded(Number(forecast.audit?.features?.price_range_position), 4),
    annualizedReturn: rounded(Number(forecast.audit?.features?.price_annualized_return), 4),
    trendRSquared: rounded(Number(forecast.audit?.features?.price_trend_r_squared), 4),
    attribution: forecast.attribution?.horizons?.[MAX_HORIZON]?.components || {},
  }]];
}));

const stockObservations = observations.filter((row) => row.targetType === "stock");
const indexObservations = observations.filter((row) => row.targetType === "index");
const qualityCaseObservations = observations.filter((row) => qualityCaseByTicker.has(row.series));
const adrStates = [
  "current-overheat",
  "exited-overheat",
  "current-depression",
  "exited-depression",
  "neutral",
  "unavailable",
];
const report = {
  format: "thinkstock-ai-walkforward-report-v1",
  generatedAt: new Date().toISOString(),
  enginePathVersion: observations[0]?.modelVersion || "",
  seed: prices.seed,
  horizonTradingDays: HORIZONS,
  stepTradingDays: MAX_HORIZON,
  maxWindowsPerStock: MAX_WINDOWS_PER_STOCK,
  selection: prices.selection,
  sourceCoverage: {
    price: prices.source,
    macroRows: context.macroRows?.length || 0,
    creditRows: context.creditRows?.length || 0,
    auxiliaryRows: context.auxiliaryRows?.length || 0,
    crisisRows: context.crisisRows?.length || 0,
    koreanVolatilityCandidate,
    vkospiRows: context.crisisRows?.filter((row) => Number.isFinite(Number(row?.vkospi))).length || 0,
    externalRiskCandidates,
    vixRows: context.crisisRows?.filter((row) => Number.isFinite(Number(row?.vix))).length || 0,
    krwUsdRows: context.crisisRows?.filter((row) => Number.isFinite(Number(row?.krwUsd))).length || 0,
    analysisSnapshots: Object.values(context.analysisByTicker || {})
      .reduce((total, record) => total + (record?.snapshots?.length || 0), 0),
    pointInTimeAnalysisAnchors: pointInTimeCoverage.anchors,
    pointInTimeFeatureCoverage: {
      eligibleAnchors: pointInTimeCoverage.eligibleAnchors,
      snapshotAnchors: pointInTimeCoverage.anchors,
      snapshotRate: rounded(pointInTimeCoverage.eligibleAnchors
        ? pointInTimeCoverage.anchors / pointInTimeCoverage.eligibleAnchors
        : 0, 4),
      consensusRate: rounded(pointInTimeCoverage.eligibleAnchors
        ? pointInTimeCoverage.consensus / pointInTimeCoverage.eligibleAnchors
        : 0, 4),
      financialRate: rounded(pointInTimeCoverage.eligibleAnchors
        ? pointInTimeCoverage.financials / pointInTimeCoverage.eligibleAnchors
        : 0, 4),
      newsRate: rounded(pointInTimeCoverage.eligibleAnchors
        ? pointInTimeCoverage.news / pointInTimeCoverage.eligibleAnchors
        : 0, 4),
    },
    pointInTimeConsensus: pointInTimeCoverage.consensus > 0,
    pointInTimeFinancials: pointInTimeCoverage.financials > 0,
    pointInTimeDisclosures: false,
    genericInternetNews: pointInTimeCoverage.news > 0,
    analystReports: false,
    currentTop400ArtifactUsed: false,
  },
  overall: summarize(stockObservations.filter((row) => row.horizon === MAX_HORIZON)),
  byHorizon: Object.fromEntries(HORIZONS.map((horizon) => [
    horizon,
    summarize(stockObservations.filter((row) => row.horizon === horizon)),
  ])),
  byMarket: Object.fromEntries(["KOSPI", "KOSDAQ"].map((market) => [
    market,
    summarize(stockObservations.filter((row) => row.market === market && row.horizon === MAX_HORIZON)),
  ])),
  byAdrState: Object.fromEntries(HORIZONS.map((horizon) => [
    horizon,
    Object.fromEntries(adrStates.map((state) => [
      state,
      summarize(stockObservations.filter((row) => row.horizon === horizon && adrState(row) === state)),
    ])),
  ])),
  bySeries: Object.fromEntries(selected.map(({ series }) => [
    series,
    summarize(stockObservations.filter((row) => row.series === series && row.horizon === MAX_HORIZON)),
  ])),
  qualityCaseBenchmarks: Object.fromEntries(qualityCases.map(({ ticker, name, profile }) => [
    ticker,
    {
      name,
      profile,
      byHorizon: Object.fromEntries(HORIZONS.map((horizon) => [
        horizon,
        summarize(qualityCaseObservations.filter((row) => (
          row.series === ticker && row.horizon === horizon
        ))),
      ])),
      rangeBoundShare: rounded(mean(qualityCaseObservations
        .filter((row) => row.series === ticker && row.horizon === MAX_HORIZON)
        .map((row) => Number(Number(row.audit?.features?.price_range_bound_score) >= 0.55))), 4),
      latestForecast: latestQualityCaseForecasts[ticker] || null,
    },
  ])),
  indexBenchmarks: Object.fromEntries(["^KS11", "^KQ11"].map((series) => [
    series,
    Object.fromEntries(HORIZONS.map((horizon) => [
      horizon,
      summarize(indexObservations.filter((row) => row.series === series && row.horizon === horizon)),
    ])),
  ])),
  indexByAdrState: Object.fromEntries(HORIZONS.map((horizon) => [
    horizon,
    Object.fromEntries(adrStates.map((state) => [
      state,
      summarize(indexObservations.filter((row) => row.horizon === horizon && adrState(row) === state)),
    ])),
  ])),
  attributionDiagnostics: {
    stocks: Object.fromEntries(HORIZONS.map((horizon) => [
      horizon,
      attributionDiagnostics(stockObservations.filter((row) => row.horizon === horizon)),
    ])),
    indices: Object.fromEntries(HORIZONS.map((horizon) => [
      horizon,
      attributionDiagnostics(indexObservations.filter((row) => row.horizon === horizon)),
    ])),
  },
  limitations: [
    "Current top-market-cap constituents create survivorship bias.",
    "Yahoo adjusted closes remove corporate-action jumps but are not the KRX runtime feed.",
    "Historical macro releases may contain later revisions rather than original release vintages.",
    pointInTimeCoverage.anchors > 0
      ? "Company analysis is used only where a stored point-in-time snapshot existed by the cutoff; earlier anchors remain unfilled."
      : "Point-in-time disclosures, financial statements, consensus, generic news, and analyst reports are excluded because historical snapshots are unavailable.",
    "The current top-400 artifact is excluded because it was trained through the present and would leak future information into older anchors.",
    "Scenario percentages are relative scenario weights, not calibrated real-world probabilities.",
  ],
  observations,
};

await mkdir(CACHE_DIR, { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const compact = (summary) => ({
  samples: summary?.samples || 0,
  directionAccuracy: summary?.directionAccuracy ?? null,
  medianThreeClassAccuracy: summary?.medianThreeClassAccuracy ?? null,
  meanAbsoluteLogError: summary?.meanAbsoluteLogError ?? null,
  improvementVsNoChange: summary?.improvementVsNoChange ?? null,
  meanActualReturn: summary?.meanActualReturn ?? null,
});
console.log(JSON.stringify({
  report: path.relative(ROOT, REPORT_PATH),
  overall: report.overall,
  byHorizon: Object.fromEntries(Object.entries(report.byHorizon).map(([key, value]) => [key, compact(value)])),
  indexBenchmarks: Object.fromEntries(Object.entries(report.indexBenchmarks).map(([series, values]) => [
    series,
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, compact(value)])),
  ])),
  indexAdr: Object.fromEntries(Object.entries(report.indexByAdrState).map(([horizon, states]) => [
    horizon,
    Object.fromEntries(Object.entries(states).map(([state, value]) => [state, compact(value)])),
  ])),
}, null, 2));
