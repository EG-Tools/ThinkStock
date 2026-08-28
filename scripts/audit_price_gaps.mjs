import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_ROOT = path.join(ROOT, ".thinkstock-cache");
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizedTicker(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return /^\d{6}\.(?:KS|KQ)$/.test(ticker) ? ticker : "";
}

function normalizedPoint(row) {
  const date = String(row?.date || "").slice(0, 10);
  const close = Number(row?.close);
  const volume = row?.volume == null ? null : Number(row.volume);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) return null;
  if (Number.isFinite(volume) && volume <= 0) return null;
  return { date, close };
}

export function parseNaverChartRows(text) {
  const rows = [];
  for (const match of String(text || "").matchAll(/<item\s+data="([^"]+)"/g)) {
    const fields = match[1].split("|");
    const rawDate = String(fields[0] || "");
    const date = /^\d{8}$/.test(rawDate)
      ? rawDate.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
      : "";
    const point = normalizedPoint({ date, close: fields[4], volume: fields[5] });
    if (point) rows.push(point);
  }
  return rows;
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function countDatesBetween(sortedDates, start, end) {
  const first = lowerBound(sortedDates, start);
  const last = lowerBound(sortedDates, end);
  let count = Math.max(0, last - first);
  if (sortedDates[first] === start) count -= 1;
  return Math.max(0, count);
}

export function detectIsolatedPriceSpikes(rows, options = {}) {
  const records = Array.isArray(rows) ? rows : [];
  const seriesKeys = Array.isArray(options.seriesKeys) && options.seriesKeys.length
    ? [...new Set(options.seriesKeys.map((key) => String(key || "").trim()).filter(Boolean))]
    : [...new Set(records.flatMap((row) => Object.keys(row || {})).filter((key) => key !== "date"))];
  const stockMultiple = Math.max(2, Number(options.stockMultiple) || 3.5);
  const indexMultiple = Math.max(1.2, Number(options.indexMultiple) || 1.6);
  const surroundingMultiple = Math.max(1, Number(options.surroundingMultiple) || 2);
  const issues = [];

  seriesKeys.forEach((series) => {
    const points = records
      .map((row) => ({ date: String(row?.date || "").slice(0, 10), value: Number(row?.[series]) }))
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.value) && point.value > 0)
      .sort((left, right) => left.date.localeCompare(right.date));
    const threshold = series.startsWith("^") ? indexMultiple : stockMultiple;
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const next = points[index + 1];
      const firstChange = Math.max(current.value / previous.value, previous.value / current.value);
      const reversal = Math.max(current.value / next.value, next.value / current.value);
      const surroundingChange = Math.max(next.value / previous.value, previous.value / next.value);
      if (firstChange < threshold || reversal < threshold || surroundingChange > surroundingMultiple) continue;
      issues.push(Object.freeze({
        series,
        date: current.date,
        previous: previous.value,
        current: current.value,
        next: next.value,
        multiple: Math.round(Math.max(firstChange, reversal) * 100) / 100,
      }));
    }
  });

  return Object.freeze(issues);
}

export function auditPriceGapRecords(recordsByTicker, options = {}) {
  const minimumCalendarDays = Math.max(2, Number(options.minimumCalendarDays) || 10);
  const calendars = { KS: new Set(), KQ: new Set() };
  recordsByTicker.forEach((record, ticker) => {
    const market = ticker.endsWith(".KQ") ? "KQ" : ticker.endsWith(".KS") ? "KS" : "";
    if (!market) return;
    record.points.forEach((_, date) => calendars[market].add(date));
  });
  const sortedCalendars = Object.fromEntries(
    Object.entries(calendars).map(([market, dates]) => [market, [...dates].sort()]),
  );

  const gaps = [];
  recordsByTicker.forEach((record, ticker) => {
    const market = ticker.endsWith(".KQ") ? "KQ" : ticker.endsWith(".KS") ? "KS" : "";
    if (!market) return;
    const points = [...record.points.values()].sort((left, right) => left.date.localeCompare(right.date));
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const gapDays = Math.round((Date.parse(current.date) - Date.parse(previous.date)) / DAY_MS);
      if (gapDays <= minimumCalendarDays) continue;
      const marketSessions = countDatesBetween(sortedCalendars[market], previous.date, current.date);
      gaps.push(Object.freeze({
        ticker,
        lastTrade: previous.date,
        resume: current.date,
        gapDays,
        marketSessions,
        changePct: Math.round(((current.close / previous.close) - 1) * 1000) / 10,
        sources: [...record.sources].sort(),
      }));
    }
  });

  gaps.sort((left, right) => (
    right.marketSessions - left.marketSessions
    || right.gapDays - left.gapDays
    || left.ticker.localeCompare(right.ticker)
    || left.lastTrade.localeCompare(right.lastTrade)
  ));
  const stockSpecific = gaps.filter((gap) => gap.marketSessions > 0);
  return Object.freeze({
    tickerCount: recordsByTicker.size,
    gapCount: gaps.length,
    stockSpecificGapCount: stockSpecific.length,
    marketClosureGapCount: gaps.length - stockSpecific.length,
    affectedTickerCount: new Set(stockSpecific.map((gap) => gap.ticker)).size,
    gaps: Object.freeze(gaps),
    stockSpecific: Object.freeze(stockSpecific),
  });
}

async function readDirectoryNames(directory) {
  try {
    return await fs.readdir(directory);
  } catch {
    return [];
  }
}

function addRows(recordsByTicker, tickerValue, rows, source) {
  const ticker = normalizedTicker(tickerValue);
  if (!ticker) return;
  let record = recordsByTicker.get(ticker);
  if (!record) {
    record = { points: new Map(), sources: new Set() };
    recordsByTicker.set(ticker, record);
  }
  record.sources.add(source);
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const point = normalizedPoint(row);
    if (point) record.points.set(point.date, point);
  });
}

export async function loadCachedPriceRecords(cacheRoot = CACHE_ROOT) {
  const records = new Map();
  const researchDirectory = path.join(cacheRoot, "stock-research");
  for (const name of await readDirectoryNames(researchDirectory)) {
    if (!name.endsWith(".json")) continue;
    try {
      const payload = JSON.parse(await fs.readFile(path.join(researchDirectory, name), "utf8"));
      const ticker = payload?.ticker || name.replace(/\.full(?=\.json$)|\.json$/g, "");
      addRows(records, ticker, payload?.rows, name.includes(".full.") ? "full" : "recent");
    } catch {
      // A damaged cache is reported by the existing cache-integrity path.
    }
  }

  const timingDirectory = path.join(cacheRoot, "timing-universe-15y");
  for (const name of await readDirectoryNames(timingDirectory)) {
    if (!name.endsWith(".xml")) continue;
    try {
      const rows = parseNaverChartRows(await fs.readFile(path.join(timingDirectory, name), "utf8"));
      addRows(records, name.replace(/\.xml$/i, ""), rows, "timing15y");
    } catch {
      // Keep auditing the remaining tickers when one local cache cannot be read.
    }
  }
  return records;
}

async function main() {
  const records = await loadCachedPriceRecords();
  const report = auditPriceGapRecords(records);
  const output = {
    generatedAt: new Date().toISOString(),
    tickerCount: report.tickerCount,
    gapCount: report.gapCount,
    stockSpecificGapCount: report.stockSpecificGapCount,
    marketClosureGapCount: report.marketClosureGapCount,
    affectedTickerCount: report.affectedTickerCount,
    stockSpecific: process.argv.includes("--all") ? report.stockSpecific : report.stockSpecific.slice(0, 50),
    omittedStockSpecificGapCount: process.argv.includes("--all")
      ? 0
      : Math.max(0, report.stockSpecific.length - 50),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
