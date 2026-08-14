import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("../docs/modules/macd-oscillator.js");
await import("../docs/modules/market-timing.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const OUTPUT_PATH = path.join(CACHE_DIR, "market-timing-vkospi-candidates.json");
const START_DATE = "2011-01-01";

const { buildMacdOscillator } = globalThis.ThinkStockMacdOscillator;
const {
  buildKoreanVolatilityTimingRows,
  buildMarketTimingSignals,
} = globalThis.ThinkStockMarketTiming;

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function columnarSeries(payload, key) {
  return {
    dates: Array.isArray(payload?.dates) ? payload.dates : [],
    prices: Array.isArray(payload?.columns?.[key]) ? payload.columns[key] : [],
  };
}

function number(value) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function ratio(rows, predicate) {
  return rows.length ? rows.filter(predicate).length / rows.length : null;
}

function rounded(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function signalOutcome(signal, type, series, ticker) {
  const actionDate = String(signal?.confirmationDate || signal?.date || "").slice(0, 10);
  const markerDate = String(signal?.date || "").slice(0, 10);
  const dateIndexes = series.dateIndexes;
  const actionIndex = dateIndexes.get(actionDate);
  const markerIndex = dateIndexes.get(markerDate);
  if (!Number.isInteger(actionIndex) || !Number.isInteger(markerIndex)) return null;
  if (actionDate < START_DATE || actionIndex + 63 >= series.prices.length) return null;
  const actionPrice = number(series.prices[actionIndex]);
  const markerPrice = number(series.prices[markerIndex]);
  if (!(actionPrice > 0 && markerPrice > 0)) return null;
  const future20 = series.prices.slice(actionIndex + 1, actionIndex + 21).filter((value) => number(value) > 0);
  const future63 = series.prices.slice(actionIndex + 1, actionIndex + 64).filter((value) => number(value) > 0);
  if (future20.length < 15 || future63.length < 45) return null;
  const end20 = number(series.prices[actionIndex + 20]);
  const end63 = number(series.prices[actionIndex + 63]);
  if (!(end20 > 0 && end63 > 0)) return null;
  const local = series.prices
    .slice(Math.max(0, markerIndex - 4), Math.min(series.prices.length, markerIndex + 5))
    .filter((value) => number(value) > 0);
  const isStock = /^\d{6}\.(KS|KQ)$/.test(ticker);
  const excursionThreshold = isStock ? 0.07 : 0.04;
  const return20 = (end20 / actionPrice) - 1;
  const return63 = (end63 / actionPrice) - 1;
  const maximum20 = (Math.max(...future20) / actionPrice) - 1;
  const minimum20 = (Math.min(...future20) / actionPrice) - 1;
  const turningDistance = type === "buy"
    ? (markerPrice / Math.min(...local)) - 1
    : 1 - (markerPrice / Math.max(...local));
  const direction20 = type === "buy" ? return20 > 0 : return20 < 0;
  const direction63 = type === "buy" ? return63 > 0 : return63 < 0;
  const excursionHit = type === "buy"
    ? maximum20 >= excursionThreshold
    : minimum20 <= -excursionThreshold;
  return {
    ticker,
    market: ticker === "^KS11" || ticker.endsWith(".KS") ? "KOSPI" : "KOSDAQ",
    kind: isStock ? "stock" : "index",
    type,
    date: markerDate,
    actionDate,
    return20,
    return63,
    maximum20,
    minimum20,
    turningDistance,
    direction20,
    direction63,
    excursionHit,
    vkospi: number(signal?.vkospi),
    vkospiPercentile: number(signal?.vkospiPercentile),
    vkospiChange5: number(signal?.vkospiChange5),
    vkospiChange20: number(signal?.vkospiChange20),
  };
}

function summarize(rows, type) {
  const directionSign = type === "buy" ? 1 : -1;
  return {
    samples: rows.length,
    direction20: rounded(ratio(rows, (row) => row.direction20)),
    direction63: rounded(ratio(rows, (row) => row.direction63)),
    excursion20: rounded(ratio(rows, (row) => row.excursionHit)),
    meanReturn20: rounded(average(rows.map((row) => row.return20)) * directionSign),
    meanReturn63: rounded(average(rows.map((row) => row.return63)) * directionSign),
    meanTurningDistance: rounded(average(rows.map((row) => row.turningDistance))),
    vkospiCoverage: rounded(ratio(rows, (row) => row.vkospiPercentile !== null)),
  };
}

function composite(summary) {
  if (!summary?.samples) return null;
  return average([summary.direction20, summary.direction63, summary.excursion20]);
}

function summarizeOutcomes(rows) {
  const output = {};
  for (const kind of ["all", "index", "stock"]) {
    const subset = kind === "all" ? rows : rows.filter((row) => row.kind === kind);
    output[kind] = {};
    for (const type of ["buy", "sell"]) {
      const typed = subset.filter((row) => row.type === type);
      output[kind][type] = summarize(typed, type);
      output[kind][type].composite = rounded(composite(output[kind][type]));
    }
  }
  return output;
}

function summarizeValidationSegments(rows) {
  const periods = [
    ["2011-2016", "2011-01-01", "2016-12-31"],
    ["2017-2021", "2017-01-01", "2021-12-31"],
    ["2022-2026", "2022-01-01", "2026-12-31"],
  ];
  return {
    byMarket: Object.fromEntries(["KOSPI", "KOSDAQ"].map((market) => [
      market,
      summarizeOutcomes(rows.filter((row) => row.market === market)),
    ])),
    byPeriod: Object.fromEntries(periods.map(([label, start, end]) => [
      label,
      summarizeOutcomes(rows.filter((row) => row.actionDate >= start && row.actionDate <= end)),
    ])),
  };
}

function newSignalRows(candidateRows, baselineRows) {
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

const priceUniverse = readJson(path.join(CACHE_DIR, "walkforward-prices.json"));
const context = readJson(path.join(CACHE_DIR, "walkforward-context.json"));
const indexPayload = readJson(path.join(ROOT, "docs", "data", "prices.json"));
const koreanVolatilityRows = buildKoreanVolatilityTimingRows(context.crisisRows || []);
const indexSeries = {
  "^KS11": columnarSeries(indexPayload, "^KS11"),
  "^KQ11": columnarSeries(indexPayload, "^KQ11"),
};
const benchmarkMaps = Object.fromEntries(Object.entries(indexSeries).map(([ticker, series]) => [
  ticker,
  new Map(series.dates.map((date, index) => [date, series.prices[index]])),
]));

const seriesEntries = [...new Map([
  ...Object.entries(priceUniverse.series || {}),
  ...Object.entries(indexSeries),
]).entries()];
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

function calculate(policy = null) {
  const outcomes = [];
  for (const [ticker, series] of preparedSeries) {
    const model = buildMarketTimingSignals({
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
      ...(policy ? { koreanVolatilityPolicy: { enabled: true, ...policy } } : {}),
    });
    for (const signal of model.signals || []) {
      const outcome = signalOutcome(signal, "buy", series, ticker);
      if (outcome) outcomes.push(outcome);
    }
    for (const signal of model.sellSignals || []) {
      const outcome = signalOutcome(signal, "sell", series, ticker);
      if (outcome) outcomes.push(outcome);
    }
  }
  return outcomes;
}

const baselineRows = calculate();
const baseline = summarizeOutcomes(baselineRows);
const baselineSegments = summarizeValidationSegments(baselineRows);
const candidates = policies.map((policy) => {
  const rows = calculate(policy);
  const addedRows = newSignalRows(rows, baselineRows);
  const summary = summarizeOutcomes(rows);
  const added = summarizeOutcomes(addedRows);
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
    segments: summarizeValidationSegments(rows),
    addedSegments: summarizeValidationSegments(addedRows),
  };
});

const report = {
  format: "thinkstock-market-timing-vkospi-backtest-v1",
  generatedAt: new Date().toISOString(),
  startDate: START_DATE,
  series: preparedSeries.length,
  stockSeries: preparedSeries.filter(([ticker]) => /^\d{6}\.(KS|KQ)$/.test(ticker)).length,
  indexSeries: preparedSeries.filter(([ticker]) => ticker.startsWith("^")).length,
  vkospiRows: koreanVolatilityRows.length,
  baseline,
  baselineSegments,
  candidates,
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(ROOT, OUTPUT_PATH),
  series: report.series,
  stockSeries: report.stockSeries,
  indexSeries: report.indexSeries,
  baseline: report.baseline,
  candidates: report.candidates.map(({ policy, improvement, added }) => ({
    policy,
    improvement,
    added: {
      indexSell: added.index.sell,
      stockBuy: added.stock.buy,
      stockSell: added.stock.sell,
    },
  })),
}, null, 2));
