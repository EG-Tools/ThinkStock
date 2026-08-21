import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { buildRandomValidationBatches } from "../shared/ai-validation-sampling.mjs";
import { buildTimingSignalOutcome } from "../shared/market-timing-outcomes.mjs";
import {
  average,
  timingComposite as composite,
  newTimingSignalRows as newSignalRows,
  number,
  rounded,
  summarizeTimingGroups,
  summarizeTimingOutcomes as summarizeOutcomes,
  summarizeTimingRows as summarize,
  summarizeTimingSegments as summarizeValidationSegments,
  summarizeTimingTickerChangeOutcomes as summarizeTickerChangeOutcomes,
  summarizeTimingTickerChanges as summarizeTickerSignalChanges,
  summarizeTimingTickerPerformance as summarizeTickerPerformance,
  summarizeSellObjectives,
  summarizeSellObjectiveGroups,
  summarizeSellTailFailures,
  compareSellObjectives,
  timingPromotionDecision as promotionDecision,
  timingValidationSafety as validationSafety,
} from "../shared/market-timing-evaluation.mjs";

const RUN_STARTED_AT = Date.now();

await import("../docs/modules/macd-oscillator.js");
await import("../docs/modules/market-timing.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const QUICK_MODE = process.argv.includes("--quick");
const HEAD_COMPARE_MODE = process.argv.includes("--compare-head");
const RANDOM_AUDIT_MODE = process.argv.includes("--random-audit");
const DIAGNOSTIC_MODE = process.argv.includes("--diagnostics");
const POLICY_GRID_MODE = process.argv.includes("--policy-grid");
const SEPARATE_CANDIDATE_PASSES = process.argv.includes("--separate-candidate-passes");
const argumentValue = (name, fallback = "") => String(
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)
    || fallback,
).trim();
const BUY_VARIANT = argumentValue("buy-variant", "default");
const SELL_VARIANT = argumentValue("sell-variant", "default");
const EXPERIMENT_LABEL = argumentValue("experiment", "").replace(/[^A-Za-z0-9_-]/g, "");
const RESAMPLE_SEED = Math.max(0, Number(argumentValue("resample-seed", "0")) || 0);
const RESAMPLE_BATCH_COUNT = Math.max(1, Math.min(20,
  Number(argumentValue("resample-batches", "5")) || 5));
const RESAMPLE_EXCLUDE_EXPERIMENTS = argumentValue("resample-exclude", "")
  .split(",")
  .map((label) => label.replace(/[^A-Za-z0-9_-]/g, ""))
  .filter(Boolean);
const FOCUS_TICKER = String(
  process.argv.find((argument) => argument.startsWith("--ticker="))?.slice("--ticker=".length) || "",
).trim();
const OUTPUT_PATH = path.join(
  CACHE_DIR,
  FOCUS_TICKER
    ? `market-timing-vkospi-${FOCUS_TICKER.replace(/[^A-Za-z0-9.-]/g, "_")}.json`
    : (RANDOM_AUDIT_MODE
      ? `market-timing-vkospi-random-audit${EXPERIMENT_LABEL ? `-${EXPERIMENT_LABEL}` : ""}.json`
      : (QUICK_MODE
      ? `market-timing-vkospi-candidates.quick${EXPERIMENT_LABEL ? `-${EXPERIMENT_LABEL}` : ""}.json`
      : `market-timing-vkospi-candidates${EXPERIMENT_LABEL ? `-${EXPERIMENT_LABEL}` : ""}.json`)),
);
const START_DATE = "2011-01-01";

const { buildMacdOscillator } = globalThis.ThinkStockMacdOscillator;
const currentMarketTimingApi = globalThis.ThinkStockMarketTiming;
const {
  buildKoreanVolatilityTimingRows,
  buildMarketTimingSignals,
} = currentMarketTimingApi;

function loadHeadMarketTimingApi() {
  const source = execFileSync("git", ["show", "HEAD:docs/modules/market-timing.js"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  runInThisContext(source, { filename: "HEAD:docs/modules/market-timing.js" });
  const headApi = globalThis.ThinkStockMarketTiming;
  globalThis.ThinkStockMarketTiming = currentMarketTimingApi;
  if (typeof headApi?.buildMarketTimingSignals !== "function") {
    throw new Error("HEAD market timing API could not be loaded");
  }
  return headApi;
}

const headMarketTimingApi = HEAD_COMPARE_MODE ? loadHeadMarketTimingApi() : null;

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function assertPriceUniverseIntegrity(payload) {
  if (Number(payload?.priceIntegrityVersion || 0) < 3) {
    throw new Error("Price validation corpus requires integrity version 3 or newer");
  }
  if (Number(payload?.dataQuality?.integrityRepair?.unresolvedSeries || 0) > 0) {
    throw new Error("Price validation corpus still has unresolved history repairs");
  }
  Object.entries(payload?.series || {}).forEach(([ticker, series]) => {
    const dates = Array.isArray(series?.dates) ? series.dates : [];
    const prices = Array.isArray(series?.prices) ? series.prices : [];
    if (dates.length !== prices.length || dates.length < 1) {
      throw new Error(`${ticker} has an invalid price timeline`);
    }
    dates.forEach((date, index) => {
      if (index > 0 && date <= dates[index - 1]) {
        throw new Error(`${ticker} has an unsorted or duplicate price date: ${date}`);
      }
      const volume = series?.volumes?.[index];
      if (volume != null && Number.isFinite(Number(volume)) && Number(volume) <= 0) {
        throw new Error(`${ticker} has a non-trading price row: ${date}`);
      }
    });
  });
}

function columnarSeries(payload, key) {
  return {
    dates: Array.isArray(payload?.dates) ? payload.dates : [],
    prices: Array.isArray(payload?.columns?.[key]) ? payload.columns[key] : [],
  };
}

const priceUniverse = readJson(path.join(CACHE_DIR, "walkforward-prices.json"));
assertPriceUniverseIntegrity(priceUniverse);
const context = readJson(path.join(CACHE_DIR, "walkforward-context.json"));
const indexPayload = readJson(path.join(ROOT, "docs", "data", "prices.json"));
const krxUniverse = readJson(path.join(ROOT, "docs", "data", "krx_universe.json"));
const tickerNames = Object.fromEntries((krxUniverse.records || []).map((row) => [row.ticker, row.name]));
const koreanVolatilityRows = buildKoreanVolatilityTimingRows(context.crisisRows || []);
const indexSeries = {
  "^KS11": columnarSeries(indexPayload, "^KS11"),
  "^KQ11": columnarSeries(indexPayload, "^KQ11"),
};
const benchmarkMaps = Object.fromEntries(Object.entries(indexSeries).map(([ticker, series]) => [
  ticker,
  new Map(series.dates.map((date, index) => [date, series.prices[index]])),
]));

const fastSelection = new Set(Object.values(priceUniverse.validationSampling?.fastSelection || {}).flat());
const storedRandomAuditBatches = Array.isArray(priceUniverse.validationSampling?.randomSignalAudit?.batches)
  ? priceUniverse.validationSampling.randomSignalAudit.batches
  : [];
const storedRandomAuditTickers = new Set(storedRandomAuditBatches.flatMap((batch) => (
  (batch.records || []).map((record) => record.ticker)
)));
const excludedExperimentTickers = new Set(RESAMPLE_EXCLUDE_EXPERIMENTS.flatMap((label) => {
  const reportPath = path.join(
    CACHE_DIR,
    `market-timing-vkospi-random-audit-${label}.json`,
  );
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Excluded random audit report was not found: ${label}`);
  }
  const report = readJson(reportPath);
  return (report?.randomAudit?.batches || []).flatMap((batch) => (
    (batch.records || []).map((record) => record.ticker)
  ));
}));
const resampleUniverse = (krxUniverse.records || []).filter((record) => (
  /^\d{6}\.(KS|KQ)$/.test(String(record?.ticker || ""))
  && priceUniverse.series?.[record.ticker]
  && !storedRandomAuditTickers.has(record.ticker)
  && !excludedExperimentTickers.has(record.ticker)
));
const randomAuditDesign = RESAMPLE_SEED > 0
  ? buildRandomValidationBatches(resampleUniverse, {
    seed: RESAMPLE_SEED,
    batchSize: 10,
    batchCount: RESAMPLE_BATCH_COUNT,
  })
  : null;
const randomAuditBatches = randomAuditDesign?.batches || storedRandomAuditBatches;
const randomAuditSourceSize = randomAuditDesign
  ? resampleUniverse.length
  : Number(priceUniverse.validationSampling?.randomSignalAudit?.eligibleCount || 0);
const randomAuditSelection = new Set(randomAuditBatches.flatMap((batch) => (
  (batch.records || []).map((record) => record.ticker)
)));
if (RANDOM_AUDIT_MODE && !randomAuditSelection.size) {
  throw new Error("Random signal audit is missing; run prepare:ai-data once to create the 10-stock batches");
}
const allSeriesEntries = [...new Map([
  ...Object.entries(priceUniverse.series || {}),
  ...Object.entries(indexSeries),
]).entries()];
const seriesEntries = FOCUS_TICKER
  ? allSeriesEntries.filter(([ticker]) => ticker === FOCUS_TICKER)
  : (RANDOM_AUDIT_MODE && randomAuditSelection.size
    ? allSeriesEntries.filter(([ticker]) => randomAuditSelection.has(ticker))
    : (QUICK_MODE && fastSelection.size
    ? allSeriesEntries.filter(([ticker]) => ticker.startsWith("^") || fastSelection.has(ticker))
    : allSeriesEntries));
const preparedSeries = seriesEntries.flatMap(([ticker, raw]) => {
  const macd = buildMacdOscillator({ dates: raw.dates || [], prices: raw.prices || [] });
  if (!macd) return [];
  const benchmarkKey = ticker === "^KQ11" || ticker.endsWith(".KQ") ? "^KQ11" : "^KS11";
  const benchmarkMap = benchmarkMaps[benchmarkKey];
  return [[ticker, {
    dates: macd.dates,
    prices: macd.prices,
    oscillator: macd.normalized,
    benchmarkPrices: macd.dates.map((date) => benchmarkMap.get(date) ?? null),
    dateIndexes: new Map(macd.dates.map((date, index) => [date, index])),
    tags: priceUniverse.validationSampling?.profiles?.[ticker]?.tags || [],
  }]];
});

const policies = [
  { id: "conservative", buyPercentile: 0.85, sellPercentile: 0.20, sellChange5: 8, sellRebound20: 10 },
  { id: "balanced", buyPercentile: 0.80, sellPercentile: 0.25, sellChange5: 6, sellRebound20: 8 },
  { id: "broad", buyPercentile: 0.75, sellPercentile: 0.30, sellChange5: 5, sellRebound20: 7 },
  { id: "stress-90", buyPercentile: 0.90, sellPercentile: 0.25, sellChange5: 6, sellRebound20: 8 },
  { id: "calm-15", buyPercentile: 0.80, sellPercentile: 0.15, sellChange5: 6, sellRebound20: 8 },
  { id: "early-rise", buyPercentile: 0.80, sellPercentile: 0.25, sellChange5: 4, sellRebound20: 6 },
  { id: "confirmed-rise", buyPercentile: 0.80, sellPercentile: 0.25, sellChange5: 10, sellRebound20: 12 },
  { id: "buy-70", buyPercentile: 0.70, sellPercentile: 0.25, sellChange5: 6, sellRebound20: 8 },
];

function calculate(policy = null, timingBuilder = buildMarketTimingSignals, progressLabel = "") {
  const outcomes = [];
  for (const [seriesIndex, [ticker, series]] of preparedSeries.entries()) {
    const model = timingBuilder({
      indexKey: ticker,
      dates: series.dates,
      prices: series.prices,
      oscillator: series.oscillator,
      benchmarkPrices: series.benchmarkPrices,
      adrRows: context.auxiliaryRows || [],
      macroRows: context.macroRows || [],
      creditRows: context.creditRows || [],
      crisisRows: context.crisisRows || [],
      koreanVolatilityRows,
      ...(policy ? {
        koreanVolatilityPolicy: {
          enabled: true,
          buyPercentile: policy.buyPercentile,
          sellPercentile: policy.sellPercentile,
          sellChange5: policy.sellChange5,
          sellRebound20: policy.sellRebound20,
        },
      } : {}),
      ...(policy?.externalVolatility === true
        ? { externalVolatilityPolicy: { enabled: true } }
        : {}),
      ...(policy?.behaviorPolicy
        ? { behaviorPolicy: policy.behaviorPolicy }
        : {}),
    });
    for (const signal of model.signals || []) {
      const outcome = buildTimingSignalOutcome({
        signal,
        type: "buy",
        series,
        ticker,
        startDate: START_DATE,
      });
      if (outcome) outcomes.push(outcome);
    }
    for (const signal of model.sellSignals || []) {
      const outcome = buildTimingSignalOutcome({
        signal,
        type: "sell",
        series,
        ticker,
        startDate: START_DATE,
      });
      if (outcome) outcomes.push(outcome);
    }
    const completed = seriesIndex + 1;
    if (progressLabel && preparedSeries.length >= 100
      && (completed % 50 === 0 || completed === preparedSeries.length)) {
      console.error(`[timing:${progressLabel}] ${completed}/${preparedSeries.length}`);
    }
  }
  return outcomes;
}

const baselineRows = HEAD_COMPARE_MODE || !POLICY_GRID_MODE ? [] : calculate();
const baseline = summarizeOutcomes(baselineRows);
const baselineSegments = summarizeValidationSegments(baselineRows);
const candidates = HEAD_COMPARE_MODE || !POLICY_GRID_MODE ? [] : policies.map((policy) => {
  const rows = calculate(policy);
  const addedRows = newSignalRows(rows, baselineRows);
  const summary = summarizeOutcomes(rows);
  const added = summarizeOutcomes(addedRows);
  const segments = summarizeValidationSegments(rows);
  const groups = ["all", "index", "stock"];
  const improvement = Object.fromEntries(groups.map((group) => [
    group,
    Object.fromEntries(["buy", "sell"].map((type) => [
      type,
      rounded(composite(summary[group][type]) - composite(baseline[group][type])),
    ])),
  ]));
  return {
    policy,
    summary,
    added,
    improvement,
    segments,
    addedSegments: summarizeValidationSegments(addedRows),
    validationSafety: validationSafety(baselineSegments, segments),
  };
});

const runtimePolicy = {
  id: "runtime-v16",
  buyPercentile: 0.85,
  sellPercentile: 0.20,
  sellChange5: 8,
  sellRebound20: 10,
  externalVolatility: true,
};
const buyVariantOptions = Object.freeze({
  default: Object.freeze({}),
  "range-guard": Object.freeze({
    minimumHistoryDays: 252,
    rangeFloorPosition: 0.15,
    rangeScore: 0.62,
  }),
  "calibration-memory": Object.freeze({
    calibrationMinimumSamples: 10,
    calibrationMaxSamples: 40,
    rejectHitRate: 0.44,
  }),
  "balanced-guard": Object.freeze({
    minimumHistoryDays: 252,
    rangeFloorPosition: 0.15,
    rangeScore: 0.62,
    calibrationMinimumSamples: 10,
    calibrationMaxSamples: 36,
    rejectHitRate: 0.43,
  }),
});
const sellVariantOptions = Object.freeze({
  default: Object.freeze({ sellDiscoveryEnabled: false }),
  "calibration-memory": Object.freeze({
    sellDiscoveryEnabled: false,
    calibrationMinimumSamples: 10,
    calibrationMaxSamples: 40,
    rejectHitRate: 0.44,
  }),
  "calibration-strict": Object.freeze({
    sellDiscoveryEnabled: false,
    calibrationMinimumSamples: 8,
    calibrationMaxSamples: 36,
    rejectHitRate: 0.46,
  }),
  "discovery-strict": Object.freeze({
    sellDiscoveryEnabled: true,
    calibrationMinimumSamples: 10,
    calibrationMaxSamples: 40,
    rejectHitRate: 0.48,
  }),
});
if (!Object.hasOwn(buyVariantOptions, BUY_VARIANT)) {
  throw new Error(`Unknown buy variant: ${BUY_VARIANT}`);
}
if (!Object.hasOwn(sellVariantOptions, SELL_VARIANT)) {
  throw new Error(`Unknown sell variant: ${SELL_VARIANT}`);
}
const adaptivePolicy = {
  ...runtimePolicy,
  id: "adaptive-behavior-v19",
  behaviorPolicy: { enabled: true },
};
const adaptiveBuyPolicy = {
  ...runtimePolicy,
  id: `adaptive-behavior-v19-buy-${BUY_VARIANT}`,
  behaviorPolicy: {
    enabled: true,
    buyEnabled: true,
    sellEnabled: false,
    ...buyVariantOptions[BUY_VARIANT],
  },
};
const adaptiveSellPolicy = {
  ...runtimePolicy,
  id: "adaptive-behavior-v19-sell",
  behaviorPolicy: { enabled: true, buyEnabled: false, sellEnabled: true },
};
const adaptiveSellCalibrationPolicy = {
  ...runtimePolicy,
  id: `adaptive-behavior-v19-sell-${SELL_VARIANT}`,
  behaviorPolicy: {
    enabled: true,
    buyEnabled: false,
    sellEnabled: true,
    ...sellVariantOptions[SELL_VARIANT],
  },
};
const previousAdaptivePolicy = {
  ...runtimePolicy,
  id: "adaptive-behavior-v17",
  behaviorPolicy: {
    enabled: true,
    objectiveAware: false,
    calibrationMaxSamples: 0,
  },
};
const runtimeRows = HEAD_COMPARE_MODE ? [] : calculate(runtimePolicy);
const previousAdaptiveRows = DIAGNOSTIC_MODE && !HEAD_COMPARE_MODE
  ? calculate(previousAdaptivePolicy)
  : [];
const adaptiveRows = DIAGNOSTIC_MODE
  ? calculate(
    adaptivePolicy,
    buildMarketTimingSignals,
    HEAD_COMPARE_MODE ? "local" : "",
  )
  : [];
const shareDefaultCandidatePass = BUY_VARIANT === "default"
  && SELL_VARIANT === "default"
  && !SEPARATE_CANDIDATE_PASSES
  && !HEAD_COMPARE_MODE;
const sharedDefaultCandidateRows = shareDefaultCandidatePass
  ? calculate({
    ...runtimePolicy,
    id: "adaptive-behavior-v19-shared-default",
    behaviorPolicy: {
      enabled: true,
      buyEnabled: true,
      sellEnabled: true,
      sellDiscoveryEnabled: false,
    },
  })
  : null;
const adaptiveBuyRows = sharedDefaultCandidateRows
  ? sharedDefaultCandidateRows.filter((row) => row.type === "buy")
  : calculate(
    adaptiveBuyPolicy,
    buildMarketTimingSignals,
    HEAD_COMPARE_MODE ? "local-buy" : "",
  );
const adaptiveSellRows = DIAGNOSTIC_MODE
  ? calculate(
    adaptiveSellPolicy,
    buildMarketTimingSignals,
    HEAD_COMPARE_MODE ? "local-sell" : "",
  )
  : [];
const adaptiveSellCalibrationRows = sharedDefaultCandidateRows
  ? sharedDefaultCandidateRows.filter((row) => row.type === "sell")
  : calculate(
    adaptiveSellCalibrationPolicy,
    buildMarketTimingSignals,
    HEAD_COMPARE_MODE ? "local-sell-calibration" : "",
  );
const headRows = headMarketTimingApi
  ? calculate(adaptivePolicy, headMarketTimingApi.buildMarketTimingSignals, "deployed")
  : [];
const rawAdaptiveRows = DIAGNOSTIC_MODE && FOCUS_TICKER && !HEAD_COMPARE_MODE
  ? calculate({
    ...adaptivePolicy,
    id: "adaptive-behavior-v19-raw",
    behaviorPolicy: {
      ...adaptivePolicy.behaviorPolicy,
      calibrationMinimumSamples: 999,
    },
  })
  : [];
const runtimeSummary = summarizeOutcomes(runtimeRows);
const previousAdaptiveSummary = DIAGNOSTIC_MODE ? summarizeOutcomes(previousAdaptiveRows) : null;
const adaptiveSummary = DIAGNOSTIC_MODE ? summarizeOutcomes(adaptiveRows) : null;
const previousAdaptiveSegments = DIAGNOSTIC_MODE
  ? summarizeValidationSegments(previousAdaptiveRows)
  : null;
const adaptiveSegments = DIAGNOSTIC_MODE ? summarizeValidationSegments(adaptiveRows) : null;
const adaptiveAddedRows = DIAGNOSTIC_MODE && !HEAD_COMPARE_MODE
  ? newSignalRows(adaptiveRows, runtimeRows)
  : [];
const tickerChanges = HEAD_COMPARE_MODE
  ? []
  : summarizeTickerSignalChanges(adaptiveRows, runtimeRows, tickerNames);
const runtimePredictiveRows = runtimeRows.filter((row) => row.signalRole === "predictive");
const adaptivePredictiveRows = DIAGNOSTIC_MODE
  ? adaptiveRows.filter((row) => row.signalRole === "predictive")
  : [];
const runtimePredictiveSummary = summarizeOutcomes(runtimePredictiveRows);
const adaptivePredictiveSummary = DIAGNOSTIC_MODE
  ? summarizeOutcomes(adaptivePredictiveRows)
  : null;
const promotion = promotionDecision(
  HEAD_COMPARE_MODE ? headRows : runtimeRows,
  adaptiveBuyRows,
  adaptiveSellCalibrationRows,
);
const comparisonBaselineRows = HEAD_COMPARE_MODE ? headRows : runtimeRows;
const promotedRows = [
  ...((RANDOM_AUDIT_MODE || promotion.buy.promote) ? adaptiveBuyRows : comparisonBaselineRows)
    .filter((row) => row.type === "buy"),
  ...(promotion.sell.promote ? adaptiveSellCalibrationRows : comparisonBaselineRows)
    .filter((row) => row.type === "sell"),
];
const promotedSummary = summarizeOutcomes(promotedRows);
const promotedSegments = summarizeValidationSegments(promotedRows);
const sellObjectiveComparison = compareSellObjectives(
  comparisonBaselineRows,
  adaptiveSellCalibrationRows,
);
const headSummary = headMarketTimingApi ? summarizeOutcomes(headRows) : null;
const headSegments = headMarketTimingApi ? summarizeValidationSegments(headRows) : null;
const headAddedRows = headMarketTimingApi ? newSignalRows(promotedRows, headRows) : [];
const headRemovedRows = headMarketTimingApi ? newSignalRows(headRows, promotedRows) : [];
const randomAuditReport = randomAuditBatches.length ? {
  format: "thinkstock-market-timing-random-audit-v1",
  candidatePolicy: "promoted-buy-with-champion-sell",
  variants: Object.freeze({ buy: BUY_VARIANT, sell: SELL_VARIANT }),
  excludedExperiments: RESAMPLE_EXCLUDE_EXPERIMENTS,
  sourceUniverseSize: randomAuditSourceSize,
  batchSize: Number(priceUniverse.validationSampling?.randomSignalAudit?.batchSize || 10),
  batches: randomAuditBatches.map((batch) => {
    const tickers = new Set((batch.records || []).map((record) => record.ticker));
    const baselineRows = comparisonBaselineRows.filter((row) => tickers.has(row.ticker));
    const candidateRows = promotedRows.filter((row) => tickers.has(row.ticker));
    const rawBuyRows = adaptiveBuyRows.filter((row) => tickers.has(row.ticker));
    const rawSellRows = adaptiveSellCalibrationRows.filter((row) => tickers.has(row.ticker));
    const screeningRows = [
      ...rawBuyRows.filter((row) => row.type === "buy"),
      ...rawSellRows.filter((row) => row.type === "sell"),
    ];
    const baselineSummary = summarizeOutcomes(baselineRows);
    const candidateSummary = summarizeOutcomes(candidateRows);
    const rawBuySummary = summarizeOutcomes(rawBuyRows);
    const rawSellSummary = summarizeOutcomes(rawSellRows);
    return {
      index: batch.index,
      seed: batch.seed,
      records: batch.records,
      baseline: baselineSummary.stock,
      candidate: candidateSummary.stock,
      improvement: Object.fromEntries(["buy", "sell"].map((side) => [
        side,
        rounded(composite(candidateSummary.stock[side]) - composite(baselineSummary.stock[side])),
      ])),
      screening: {
        buy: rawBuySummary.stock.buy,
        sell: rawSellSummary.stock.sell,
        improvement: {
          buy: rounded(composite(rawBuySummary.stock.buy) - composite(baselineSummary.stock.buy)),
          sell: rounded(composite(rawSellSummary.stock.sell) - composite(baselineSummary.stock.sell)),
        },
        sellObjectives: compareSellObjectives(baselineRows, rawSellRows),
      },
      sellObjectives: compareSellObjectives(baselineRows, candidateRows),
      screeningTickerPerformance: summarizeTickerPerformance(
        screeningRows,
        baselineRows,
        tickerNames,
      ),
      screeningChangeOutcomes: summarizeTickerChangeOutcomes(
        screeningRows,
        baselineRows,
        tickerNames,
      ),
      tickerPerformance: summarizeTickerPerformance(candidateRows, baselineRows, tickerNames),
      changeOutcomes: summarizeTickerChangeOutcomes(candidateRows, baselineRows, tickerNames),
      changedTickers: summarizeTickerSignalChanges(candidateRows, baselineRows, tickerNames),
    };
  }),
} : null;
const headComparison = headMarketTimingApi ? {
  baseline: headSummary,
  candidate: promotedSummary,
  improvement: Object.fromEntries(["all", "index", "stock"].map((group) => [
    group,
    Object.fromEntries(["buy", "sell"].map((type) => [
      type,
      rounded(composite(promotedSummary[group][type])
        - composite(headSummary[group][type])),
    ])),
  ])),
  validationSafety: validationSafety(
    headSegments,
    promotedSegments,
  ),
  added: summarizeOutcomes(headAddedRows),
  removed: summarizeOutcomes(headRemovedRows),
  tickerChanges: summarizeTickerSignalChanges(promotedRows, headRows, tickerNames),
  promotion,
} : null;
const behaviorComparison = HEAD_COMPARE_MODE || !DIAGNOSTIC_MODE ? null : {
  baselinePolicy: runtimePolicy,
  candidatePolicy: adaptivePolicy,
  buyCandidatePolicy: adaptiveBuyPolicy,
  sellCandidatePolicy: adaptiveSellPolicy,
  sellCalibrationCandidatePolicy: adaptiveSellCalibrationPolicy,
  previousAdaptivePolicy,
  baseline: runtimeSummary,
  previousAdaptive: previousAdaptiveSummary,
  candidate: adaptiveSummary,
  added: summarizeOutcomes(adaptiveAddedRows),
  improvement: Object.fromEntries(["all", "index", "stock"].map((group) => [
    group,
    Object.fromEntries(["buy", "sell"].map((type) => [
      type,
      rounded(composite(adaptiveSummary[group][type]) - composite(runtimeSummary[group][type])),
    ])),
  ])),
  validationSafety: validationSafety(
    summarizeValidationSegments(runtimeRows),
    summarizeValidationSegments(adaptiveRows),
  ),
  versusPreviousAdaptive: {
    improvement: Object.fromEntries(["all", "index", "stock"].map((group) => [
      group,
      Object.fromEntries(["buy", "sell"].map((type) => [
        type,
        rounded(composite(adaptiveSummary[group][type])
          - composite(previousAdaptiveSummary[group][type])),
      ])),
    ])),
    validationSafety: validationSafety(
      previousAdaptiveSegments,
      adaptiveSegments,
    ),
    tickerChanges: summarizeTickerSignalChanges(adaptiveRows, previousAdaptiveRows, tickerNames),
  },
  predictive: {
    baseline: runtimePredictiveSummary,
    candidate: adaptivePredictiveSummary,
    improvement: Object.fromEntries(["all", "index", "stock"].map((group) => [
      group,
      Object.fromEntries(["buy", "sell"].map((type) => [
        type,
        rounded(composite(adaptivePredictiveSummary[group][type])
          - composite(runtimePredictiveSummary[group][type])),
      ])),
    ])),
    validationSafety: validationSafety(
      summarizeValidationSegments(runtimePredictiveRows),
      summarizeValidationSegments(adaptivePredictiveRows),
    ),
  },
  warnings: summarizeOutcomes(adaptiveRows.filter((row) => row.signalRole === "warning")),
  evidenceOverrides: summarizeOutcomes(adaptiveRows.filter(
    (row) => row.calibration?.status === "evidence-override",
  )),
  byBehavior: Object.fromEntries([...new Set(adaptiveRows.map((row) => row.behavior))]
    .sort()
    .map((behavior) => [behavior, summarizeOutcomes(
      adaptiveRows.filter((row) => row.behavior === behavior),
    )])),
  bySignalFamily: Object.fromEntries([...new Set(adaptiveRows.map((row) => row.signalFamily))]
    .sort()
    .map((family) => [family, summarizeOutcomes(
      adaptiveRows.filter((row) => row.signalFamily === family),
    )])),
  byBehaviorFamily: summarizeTimingGroups(
    adaptiveRows,
    (row) => `${row.behavior}|${row.signalFamily}`,
  ),
  sellObjectivesBySignalFamily: {
    baseline: summarizeSellObjectiveGroups(runtimePredictiveRows, (row) => row.signalFamily),
    candidate: summarizeSellObjectiveGroups(adaptivePredictiveRows, (row) => row.signalFamily),
  },
  sellObjectivesByBehaviorFamily: {
    baseline: summarizeSellObjectiveGroups(
      runtimePredictiveRows,
      (row) => `${row.behavior}|${row.signalFamily}`,
    ),
    candidate: summarizeSellObjectiveGroups(
      adaptivePredictiveRows,
      (row) => `${row.behavior}|${row.signalFamily}`,
    ),
  },
  sellObjectivesByRegimeBehaviorFamily: {
    baseline: summarizeSellObjectiveGroups(
      runtimePredictiveRows,
      (row) => `${row.marketRegime}|${row.behavior}|${row.signalFamily}`,
    ),
    candidate: summarizeSellObjectiveGroups(
      adaptivePredictiveRows,
      (row) => `${row.marketRegime}|${row.behavior}|${row.signalFamily}`,
    ),
  },
  sellWarningObjectivesBySignalFamily: summarizeSellObjectiveGroups(
    adaptiveRows.filter((row) => row.signalRole === "warning"),
    (row) => row.signalFamily,
  ),
  sellTailFailures: {
    baseline20: summarizeSellTailFailures(runtimePredictiveRows, tickerNames, { horizon: 20 }),
    candidate20: summarizeSellTailFailures(adaptivePredictiveRows, tickerNames, { horizon: 20 }),
    baseline63: summarizeSellTailFailures(runtimePredictiveRows, tickerNames, { horizon: 63 }),
    candidate63: summarizeSellTailFailures(adaptivePredictiveRows, tickerNames, { horizon: 63 }),
  },
  bySignalRole: Object.fromEntries([...new Set(adaptiveRows.map((row) => row.signalRole))]
    .sort()
    .map((role) => [role, summarizeOutcomes(
      adaptiveRows.filter((row) => row.signalRole === role),
    )])),
  byCalibrationObjective: Object.fromEntries([
    ...new Set(adaptiveRows.map((row) => row.calibrationObjective)),
  ].sort().map((objective) => [objective, summarizeOutcomes(
    adaptiveRows.filter((row) => row.calibrationObjective === objective),
  )])),
  tickerChanges,
  promotion,
};

const report = {
  format: "thinkstock-market-timing-vkospi-backtest-v1",
  generatedAt: new Date().toISOString(),
  mode: RANDOM_AUDIT_MODE ? "random-audit" : (QUICK_MODE ? "quick-stratified" : "full"),
  variants: { buy: BUY_VARIANT, sell: SELL_VARIANT },
  candidatePasses: shareDefaultCandidatePass ? "shared" : "separate",
  startDate: START_DATE,
  series: preparedSeries.length,
  stockSeries: preparedSeries.filter(([ticker]) => /^\d{6}\.(KS|KQ)$/.test(ticker)).length,
  indexSeries: preparedSeries.filter(([ticker]) => ticker.startsWith("^")).length,
  vkospiRows: koreanVolatilityRows.length,
  focusTicker: FOCUS_TICKER || null,
  elapsedMs: Date.now() - RUN_STARTED_AT,
  baseline: HEAD_COMPARE_MODE ? headSummary : (POLICY_GRID_MODE ? baseline : runtimeSummary),
  baselineSegments: HEAD_COMPARE_MODE
    ? headSegments
    : (POLICY_GRID_MODE ? baselineSegments : summarizeValidationSegments(runtimeRows)),
  candidates,
  behaviorComparison,
  headComparison,
  promotion,
  randomAudit: randomAuditReport,
  sellObjectives: {
    baseline: summarizeSellObjectives(comparisonBaselineRows),
    selected: summarizeSellObjectives(promotedRows),
    comparison: sellObjectiveComparison,
  },
  ...(FOCUS_TICKER ? {
    focusedOutcomes: {
      runtime: runtimeRows,
      previousAdaptive: previousAdaptiveRows,
      adaptive: adaptiveRows,
      adaptiveBuy: adaptiveBuyRows,
      adaptiveSell: adaptiveSellRows,
      adaptiveSellCalibration: adaptiveSellCalibrationRows,
      rawAdaptive: rawAdaptiveRows,
    },
  } : {}),
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(ROOT, OUTPUT_PATH),
  series: report.series,
  stockSeries: report.stockSeries,
  indexSeries: report.indexSeries,
  baseline: report.baseline,
  candidates: report.candidates.map(({ policy, improvement, added, validationSafety: safety }) => ({
    policy,
    improvement,
    added: {
      indexSell: added.index.sell,
      stockBuy: added.stock.buy,
      stockSell: added.stock.sell,
    },
    validationSafety: safety,
  })),
  behaviorComparison: behaviorComparison ? {
    improvement: behaviorComparison.improvement,
    predictiveImprovement: behaviorComparison.predictive.improvement,
    added: {
      stockBuy: behaviorComparison.added.stock.buy,
      stockSell: behaviorComparison.added.stock.sell,
    },
    validationSafety: behaviorComparison.validationSafety,
    predictiveValidationSafety: behaviorComparison.predictive.validationSafety,
    versusPreviousAdaptive: {
      improvement: behaviorComparison.versusPreviousAdaptive.improvement,
      validationSafety: behaviorComparison.versusPreviousAdaptive.validationSafety,
    },
  } : null,
  headComparison: headComparison ? {
    improvement: headComparison.improvement,
    validationSafety: headComparison.validationSafety,
    added: {
      stockBuy: headComparison.added.stock.buy,
      stockSell: headComparison.added.stock.sell,
    },
    removed: {
      stockBuy: headComparison.removed.stock.buy,
      stockSell: headComparison.removed.stock.sell,
    },
    mostChangedTickers: headComparison.tickerChanges.slice(0, 20),
  } : null,
  promotion: {
    promotedSides: promotion.promotedSides,
    buy: {
      decision: promotion.buy.decision,
      deltas: promotion.buy.deltas,
      reasons: promotion.buy.reasons,
    },
    sell: {
      decision: promotion.sell.decision,
      deltas: promotion.sell.deltas,
      reasons: promotion.sell.reasons,
    },
  },
  randomAuditBatches: RANDOM_AUDIT_MODE ? randomAuditReport?.batches.map((batch) => ({
    index: batch.index,
    seed: batch.seed,
    records: batch.records,
    improvement: batch.improvement,
    screeningImprovement: batch.screening.improvement,
  })) : null,
}, null, 2));
