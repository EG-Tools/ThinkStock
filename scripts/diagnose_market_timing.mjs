import fs from "node:fs";
import { buildMacdOscillator } from "../docs/modules/macd-oscillator.mjs";
import marketTiming from "../docs/modules/market-timing.mjs";
import { rebaseSeriesRowsToAvailability } from "../shared/series-timeline-policy.mjs";

const {
  alignAsOf,
  buildMarketTimingSignals,
  rollingPercentile,
  scoreTimingPoint,
  trailingAverage,
} = marketTiming;

const BASE_URL = process.env.THINKSTOCK_LOCAL_URL || "http://127.0.0.1:8787";
const SIGNAL_START = process.env.SIGNAL_START || "2026-01-01";
const TARGET_DATES = (process.env.TARGET_DATES || "2026-06-01,2026-06-18,2026-06-19,2026-06-22,2026-06-23,2026-06-24,2026-06-25,2026-06-26")
  .split(",")
  .map((date) => date.trim())
  .filter(Boolean);
const SERIES_KEYS = (process.env.SERIES_KEYS || "^KS11,^KQ11")
  .split(",")
  .map((series) => series.trim().toUpperCase())
  .filter(Boolean);

function readColumnar(filename) {
  const payload = JSON.parse(fs.readFileSync(new URL(`../docs/data/${filename}`, import.meta.url), "utf8"));
  return payload.dates.map((date, index) => Object.fromEntries([
    ["date", date],
    ...Object.entries(payload.columns).map(([key, values]) => [key, values[index]]),
  ]));
}

function mergeRows(...groups) {
  const merged = new Map();
  groups.flat().forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (date) merged.set(date, { ...(merged.get(date) || {}), ...row, date });
  });
  return [...merged.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeRows(rows, key) {
  return rows
    .map((row) => ({ date: String(row?.date || "").slice(0, 10), value: Number(row?.[key]) }))
    .filter((row) => row.date && Number.isFinite(row.value))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function changeRate(values, index, lookback) {
  const current = Number(values[index]);
  const previous = Number(values[index - lookback]);
  return Number.isFinite(current) && Number.isFinite(previous) && Math.abs(previous) > 1e-9
    ? ((current / previous) - 1) * 100
    : null;
}

async function fetchJson(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const [adrPayload, macroPayload, creditPayload, crisisPayload] = await Promise.all([
  fetchJson("/api/adr"),
  fetchJson("/api/macro"),
  fetchJson("/api/credit"),
  fetchJson("/api/crisis-signal"),
]);

const priceRows = readColumnar("prices.json");
const adrRows = mergeRows(readColumnar("adr_data.json"), adrPayload.rows || []);
const macroRows = mergeRows(
  rebaseSeriesRowsToAvailability(
    readColumnar("macro_data.json"),
    "leading_cycle",
    { observationCadence: "monthly" },
  ),
  rebaseSeriesRowsToAvailability(macroPayload.leadingRows || [], "leading_cycle", {
    dateBasis: macroPayload.leadingDateBasis,
  }),
  macroPayload.newsRows || [],
);
const creditRows = mergeRows(readColumnar("credit_data.json"), creditPayload.rows || []);
const crisisRows = crisisPayload.records || [];
const sourceDates = priceRows.map((row) => row.date);

function inspectIndex(indexKey) {
  const prices = priceRows.map((row) => row[indexKey]);
  const macd = buildMacdOscillator({ dates: sourceDates, prices });
  const dates = macd.dates;
  const isKosdaqSeries = indexKey === "^KQ11" || indexKey.endsWith(".KQ");
  const isIndividualStock = /^\d{6}\.(KS|KQ)$/.test(indexKey);
  const adrKey = isKosdaqSeries ? "adr_kosdaq" : "adr_kospi";
  const creditKey = isKosdaqSeries ? "kosdaq_credit" : "kospi_credit";
  const newsSource = normalizeRows(macroRows, "news_sentiment");
  const newsAverage = trailingAverage(newsSource.map((row) => row.value), 20);
  const newsRows = newsSource.map((row, index) => ({ date: row.date, value: newsAverage[index] }));
  const credit = alignAsOf(dates, normalizeRows(creditRows, creditKey), 10);
  const creditGrowth = credit.map((_, index) => changeRate(credit, index, 20));
  const context = {
    prices: macd.prices,
    oscillator: macd.normalized,
    adr: alignAsOf(dates, normalizeRows(adrRows, adrKey), 7),
    fearGreed: Array(dates.length).fill(null),
    news: alignAsOf(dates, newsRows, 10),
    leading: alignAsOf(dates, normalizeRows(macroRows, "leading_cycle"), 75),
    creditGrowth,
    creditPercentile: creditGrowth.map((_, index) => rollingPercentile(creditGrowth, index)),
    crisis: alignAsOf(dates, normalizeRows(crisisRows, "score"), 14),
  };
  const model = buildMarketTimingSignals({
    indexKey,
    dates: macd.dates,
    prices: macd.prices,
    oscillator: macd.normalized,
    adrRows,
    macroRows,
    creditRows,
    crisisRows,
  });
  const targetRows = TARGET_DATES.map((date) => {
    const index = dates.indexOf(date);
    if (index < 0) return { date, missing: true };
    const point = scoreTimingPoint(context, index);
    const creditCrowded = point.creditChange >= 6 && point.creditPercentile >= 0.65;
    const sentimentCrowded = point.fearGreed >= 70 || point.news >= 110 || point.adr >= 115;
    const breadthDivergence = point.adr <= 60 && point.creditChange >= 8 && point.creditPercentile >= 0.6;
    const technicalOverheat = point.oscillator >= 0.5;
    const supportCount = [creditCrowded, sentimentCrowded, breadthDivergence, technicalOverheat].filter(Boolean).length;
    const nearHigh = point.priceDrawdown60 >= -2.5;
    const extended = point.price20dVolScore >= 1.5 || point.price60dVolScore >= 1.8;
    const stronglyExtended = point.price20dVolScore >= 2.5 || point.price60dVolScore >= 2.5;
    const creditDriven = nearHigh && point.creditChange >= 10 && point.creditPercentile >= 0.75
      && point.price20d >= 15;
    const clusteredOverheat = nearHigh && point.price20d >= 8 && point.creditChange >= 5
      && point.creditPercentile >= 0.75 && point.adr >= 110 && point.oscillator >= 0.5;
    const stockClimax = isIndividualStock && nearHigh && (
      (point.price20d >= 35 && point.price20dVolScore >= 1.5)
      || (point.price20d >= 15 && point.price60dVolScore >= 1.8)
      || (point.price20d >= 15 && point.creditChange >= 5 && point.creditPercentile >= 0.75)
    );
    const armed = creditDriven || clusteredOverheat || stockClimax
      || (nearHigh && extended && (supportCount >= 2 || (stronglyExtended && supportCount >= 1)));
    const rollover = point.oscillator > 0 && point.macdSlope <= 0 && point.priorMacdSlope > 0;
    return {
      date,
      price: point.price,
      drawdown60: point.priceDrawdown60,
      return20: point.price20d,
      vol20: point.price20dVolScore,
      vol60: point.price60dVolScore,
      adr: point.adr,
      news: point.news,
      creditGrowth: point.creditChange,
      creditRank: point.creditPercentile,
      oscillator: point.oscillator,
      macdSlope: point.macdSlope,
      supportCount,
      nearHigh,
      extended,
      stronglyExtended,
      creditDriven,
      clusteredOverheat,
      stockClimax,
      armed,
      rollover,
    };
  });
  return {
    indexKey,
    sellSignals: model.sellSignals.filter((signal) => signal.date >= SIGNAL_START)
      .map((signal) => ({ date: signal.date, confirmationDate: signal.confirmationDate })),
    targetRows,
  };
}

console.log(JSON.stringify(SERIES_KEYS.map(inspectIndex), null, 2));
