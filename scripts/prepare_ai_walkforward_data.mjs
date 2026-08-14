import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analysisSnapshotFromRecord,
  mergePointInTimeAnalysisSnapshots,
} from "../shared/ai-analysis-snapshots.mjs";
import {
  buildCrisisSignalRows,
  fetchCrisisSignalSeries,
} from "../worker/src/crisis-signal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const PRICE_CACHE_PATH = path.join(CACHE_DIR, "walkforward-prices.json");
const CONTEXT_CACHE_PATH = path.join(CACHE_DIR, "walkforward-context.json");
const VKOSPI_CACHE_PATH = path.join(CACHE_DIR, "vkospi-history.json");
const MODEL_PATH = path.join(ROOT, "docs", "data", "ai_market_model.json");
const UNIVERSE_PATH = path.join(ROOT, "docs", "data", "krx_universe.json");
const LOCAL_ENV_PATH = path.join(ROOT, ".env.local");
const RANDOM_SEED = 20260807;
const perMarketArgument = process.argv.indexOf("--per-market");
const requestedPerMarket = perMarketArgument >= 0
  ? Number(process.argv[perMarketArgument + 1])
  : 20;
const TARGET_PER_MARKET = Math.max(5, Math.min(50, Math.trunc(requestedPerMarket || 20)));
const MAX_CANDIDATES_PER_MARKET = Math.max(40, TARGET_PER_MARKET * 2);
const MIN_PRICE_ROWS = 1000;
const START_DATE = "2000-01-01";
const QUALITY_CASES = Object.freeze([
  Object.freeze({
    ticker: "078930.KS",
    name: "GS",
    profile: "long-range-holding-company",
  }),
]);
const GATEWAY_URL = "https://thinkstock-api.keg0320.workers.dev";
const refreshAll = process.argv.includes("--refresh");
const refreshPrices = refreshAll || process.argv.includes("--refresh-prices");
const refreshContext = refreshAll || process.argv.includes("--refresh-context");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonOrNull(file) {
  try {
    return await readJson(file);
  } catch (_) {
    return null;
  }
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, seed) {
  const output = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  const random = mulberry32(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function parseEnv(text) {
  const values = {};
  String(text || "").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
  });
  return values;
}

function unixSeconds(dateText) {
  return Math.floor(Date.parse(`${dateText}T00:00:00Z`) / 1000);
}

function isoDateFromUnix(value) {
  const milliseconds = Number(value) * 1000;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString().slice(0, 10) : "";
}

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "User-Agent": "ThinkStock/ai-walkforward",
          ...(options.headers || {}),
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
      }
    }
  }
  throw lastError || new Error("request failed");
}

async function fetchYahooAdjustedSeries(ticker, endDate) {
  const query = new URLSearchParams({
    period1: String(unixSeconds(START_DATE)),
    period2: String(unixSeconds(endDate) + 86400),
    interval: "1d",
    events: "history",
    includeAdjustedClose: "true",
  });
  const payload = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${query}`,
  );
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose;
  const closes = result?.indicators?.quote?.[0]?.close;
  const values = Array.isArray(adjusted) ? adjusted : closes;
  if (!timestamps.length || !Array.isArray(values)) throw new Error("price rows unavailable");
  const byDate = new Map();
  timestamps.forEach((timestamp, index) => {
    const date = isoDateFromUnix(timestamp);
    const price = Number(values[index]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0) {
      byDate.set(date, price);
    }
  });
  const dates = [...byDate.keys()].sort();
  if (!dates.length) throw new Error("valid adjusted prices unavailable");
  return { dates, prices: dates.map((date) => byDate.get(date)) };
}

async function mapWithConcurrency(values, limit, mapper) {
  const output = Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

function latestDate(series) {
  return series?.dates?.at(-1) || "";
}

function isEligible(series, endDate) {
  if (!series || series.dates.length < MIN_PRICE_ROWS) return false;
  const ageDays = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${latestDate(series)}T00:00:00Z`)) / 86400000);
  return Number.isFinite(ageDays) && ageDays <= 45;
}

function rowsFromColumnar(payload) {
  const series = Array.isArray(payload?.series) ? payload.series : Object.keys(payload?.columns || {});
  return (payload?.dates || []).map((date, index) => {
    const row = { date };
    series.forEach((key) => { row[key] = payload.columns?.[key]?.[index] ?? null; });
    return row;
  });
}

function mergeRows(...groups) {
  const byDate = new Map();
  groups.flat().forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const prior = byDate.get(date) || { date };
    Object.entries(row).forEach(([key, value]) => {
      if (key === "date") return;
      const number = Number(value);
      if (Number.isFinite(number)) prior[key] = number;
    });
    byDate.set(date, prior);
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

async function gatewayPayload(endpoint, token) {
  if (!token) return [];
  try {
    return await fetchJson(`${GATEWAY_URL}${endpoint}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    }, 2);
  } catch (_) {
    return null;
  }
}

async function gatewayRows(endpoint, token) {
  const payload = await gatewayPayload(endpoint, token);
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.records)) return payload.records;
  return rowsFromColumnar(payload);
}

function macroRowsFromPayload(payload) {
  return mergeRows(
    payload?.leadingRows,
    payload?.newsRows,
    payload?.policyRateRows,
    payload?.tradeRows,
    payload?.rows,
    rowsFromColumnar(payload),
  );
}

async function directFredCrisisRows(apiKey) {
  if (!apiKey) return [];
  try {
    return buildCrisisSignalRows(await fetchCrisisSignalSeries(fetch, apiKey, {
      includeExternalRisk: true,
    }));
  } catch (_) {
    return [];
  }
}

async function gatewayAnalysisRecord(ticker, token) {
  if (!token) return null;
  try {
    const payload = await fetchJson(`${GATEWAY_URL}/api/analysis?ticker=${encodeURIComponent(ticker)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    }, 2);
    if (payload?.ok !== true) return null;
    const record = {
      ticker,
      savedAt: payload.savedAt,
      consensus: payload.consensus || null,
      financials: Array.isArray(payload.financials) ? payload.financials : [],
      news: Array.isArray(payload.news) ? payload.news : [],
      snapshots: Array.isArray(payload.snapshots) ? payload.snapshots : [],
    };
    const current = analysisSnapshotFromRecord(record);
    const snapshots = mergePointInTimeAnalysisSnapshots(
      record.snapshots,
      current ? [current] : [],
    );
    return snapshots.length ? { ticker, snapshots } : null;
  } catch (_) {
    return null;
  }
}

async function preparePrices() {
  const existing = await readJsonOrNull(PRICE_CACHE_PATH);
  const canReuseExisting = !refreshPrices
    && existing?.format === "thinkstock-ai-walkforward-prices-v1"
    && Number(existing.targetPerMarket || 10) === TARGET_PER_MARKET
    && QUALITY_CASES.every(({ ticker }) => existing.series?.[ticker])
    && ["KOSPI", "KOSDAQ"].every((market) => (
      existing.selection?.[market]?.length === TARGET_PER_MARKET
    ));
  if (canReuseExisting) {
    const qualityCasesMatch = JSON.stringify(existing.qualityCases || []) === JSON.stringify(QUALITY_CASES);
    if (qualityCasesMatch) return existing;
    const migrated = { ...existing, qualityCases: QUALITY_CASES };
    await writeFile(PRICE_CACHE_PATH, `${JSON.stringify(migrated)}\n`, "utf8");
    return migrated;
  }

  const [model, universe] = await Promise.all([readJson(MODEL_PATH), readJson(UNIVERSE_PATH)]);
  const endDate = new Date().toISOString().slice(0, 10);
  const candidateMarkets = {
    KOSPI: shuffled(model?.universe?.tickers?.KOSPI || [], RANDOM_SEED),
    KOSDAQ: shuffled(model?.universe?.tickers?.KOSDAQ || [], RANDOM_SEED ^ 0x9E3779B9),
  };
  const fetched = new Map();
  const failures = {};

  for (const market of ["KOSPI", "KOSDAQ"]) {
    const candidates = candidateMarkets[market].slice(0, MAX_CANDIDATES_PER_MARKET);
    for (let offset = 0; offset < candidates.length; offset += 8) {
      const selectedSoFar = candidates.slice(0, offset)
        .filter((ticker) => isEligible(fetched.get(ticker), endDate));
      if (selectedSoFar.length >= TARGET_PER_MARKET) break;
      const batch = candidates.slice(offset, offset + 8);
      await mapWithConcurrency(batch, 3, async (ticker) => {
        try {
          fetched.set(ticker, await fetchYahooAdjustedSeries(ticker, endDate));
        } catch (error) {
          failures[ticker] = String(error?.message || error);
        }
      });
    }
  }

  const selection = {};
  for (const market of ["KOSPI", "KOSDAQ"]) {
    selection[market] = candidateMarkets[market]
      .filter((ticker) => isEligible(fetched.get(ticker), endDate))
      .slice(0, TARGET_PER_MARKET);
    if (selection[market].length < TARGET_PER_MARKET) {
      throw new Error(`${market} eligible sample is ${selection[market].length}/${TARGET_PER_MARKET}`);
    }
  }

  const requiredSeries = [...new Set([
    ...selection.KOSPI,
    ...selection.KOSDAQ,
    ...QUALITY_CASES.map(({ ticker }) => ticker),
    "^KS11",
    "^KQ11",
    "005930.KS",
    "000660.KS",
  ])];
  await mapWithConcurrency(requiredSeries.filter((ticker) => !fetched.has(ticker)), 3, async (ticker) => {
    try {
      fetched.set(ticker, await fetchYahooAdjustedSeries(ticker, endDate));
    } catch (error) {
      failures[ticker] = String(error?.message || error);
    }
  });
  for (const required of ["^KS11", "^KQ11"]) {
    if (!fetched.has(required)) throw new Error(`${required} benchmark history is unavailable`);
  }

  const names = Object.fromEntries((universe.records || []).map((row) => [row.ticker, row.name]));
  const payload = {
    format: "thinkstock-ai-walkforward-prices-v1",
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance adjusted close",
    startDate: START_DATE,
    endDate,
    seed: RANDOM_SEED,
    targetPerMarket: TARGET_PER_MARKET,
    selection,
    qualityCases: QUALITY_CASES,
    names,
    series: Object.fromEntries(requiredSeries.flatMap((ticker) => (
      fetched.has(ticker) ? [[ticker, fetched.get(ticker)]] : []
    ))),
    failures,
  };
  await writeFile(PRICE_CACHE_PATH, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}

async function prepareContext(prices) {
  const existing = await readJsonOrNull(CONTEXT_CACHE_PATH);
  const vkospiHistory = await readJsonOrNull(VKOSPI_CACHE_PATH);
  const vkospiRows = Array.isArray(vkospiHistory?.rows)
    ? vkospiHistory.rows
    : (Array.isArray(vkospiHistory?.records) ? vkospiHistory.records : []);
  if (!refreshContext && [
    "thinkstock-ai-walkforward-context-v3",
    "thinkstock-ai-walkforward-context-v4",
  ].includes(existing?.format)) {
    const requiredAnalysisTickers = [...new Set([
      ...(prices?.selection?.KOSPI || []),
      ...(prices?.selection?.KOSDAQ || []),
      ...(prices?.qualityCases || []).map((item) => item?.ticker),
    ].filter(Boolean))];
    const missingAnalysisTickers = requiredAnalysisTickers.filter((ticker) => (
      !existing.analysisByTicker?.[ticker]?.snapshots?.length
    ));
    let analysisByTicker = { ...(existing.analysisByTicker || {}) };
    if (missingAnalysisTickers.length) {
      const env = parseEnv(await readFile(LOCAL_ENV_PATH, "utf8").catch(() => ""));
      const records = await mapWithConcurrency(missingAnalysisTickers, 3, (ticker) => (
        gatewayAnalysisRecord(ticker, env.THINKSTOCK_ACCESS_TOKEN)
      ));
      records.forEach((record) => {
        if (record) analysisByTicker[record.ticker] = { snapshots: record.snapshots };
      });
    }
    const payload = {
      ...existing,
      format: "thinkstock-ai-walkforward-context-v4",
      crisisRows: mergeRows(existing.crisisRows, vkospiRows),
      analysisByTicker,
      candidateCoverage: {
        ...(existing.candidateCoverage || {}),
        vkospi: vkospiRows.some((row) => Number.isFinite(Number(row?.vkospi))),
      },
    };
    await writeFile(CONTEXT_CACHE_PATH, `${JSON.stringify(payload)}\n`, "utf8");
    return payload;
  }
  const env = parseEnv(await readFile(LOCAL_ENV_PATH, "utf8").catch(() => ""));
  const [macroFile, creditFile, adrFile, gatewayMacro, gatewayCredit, gatewayCrisisRows, directCrisisRows] = await Promise.all([
    readJson(path.join(ROOT, "docs", "data", "macro_data.json")),
    readJson(path.join(ROOT, "docs", "data", "credit_data.json")),
    readJson(path.join(ROOT, "docs", "data", "adr_data.json")),
    gatewayPayload("/api/macro", env.THINKSTOCK_ACCESS_TOKEN),
    gatewayRows("/api/credit", env.THINKSTOCK_ACCESS_TOKEN),
    gatewayRows("/api/crisis-signal", env.THINKSTOCK_ACCESS_TOKEN),
    directFredCrisisRows(env.FRED_API_KEY),
  ]);
  const analysisTickers = [...new Set([
    ...(prices?.selection?.KOSPI || []),
    ...(prices?.selection?.KOSDAQ || []),
    ...(prices?.qualityCases || []).map((item) => item?.ticker),
  ])];
  const analysisRecords = await mapWithConcurrency(analysisTickers, 3, (ticker) => (
    gatewayAnalysisRecord(ticker, env.THINKSTOCK_ACCESS_TOKEN)
  ));
  const payload = {
    format: "thinkstock-ai-walkforward-context-v4",
    generatedAt: new Date().toISOString(),
    macroRows: mergeRows(rowsFromColumnar(macroFile), macroRowsFromPayload(gatewayMacro)),
    creditRows: mergeRows(rowsFromColumnar(creditFile), gatewayCredit),
    auxiliaryRows: mergeRows(rowsFromColumnar(adrFile)),
    crisisRows: mergeRows(gatewayCrisisRows, directCrisisRows, vkospiRows),
    candidateCoverage: {
      vkospi: vkospiRows.some((row) => Number.isFinite(Number(row?.vkospi))),
      vix: directCrisisRows.some((row) => Number.isFinite(Number(row?.vix))),
      krwUsd: directCrisisRows.some((row) => Number.isFinite(Number(row?.krwUsd))),
    },
    analysisByTicker: Object.fromEntries(analysisRecords.flatMap((record) => (
      record ? [[record.ticker, { snapshots: record.snapshots }]] : []
    ))),
  };
  await writeFile(CONTEXT_CACHE_PATH, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}

await mkdir(CACHE_DIR, { recursive: true });
const prices = await preparePrices();
const context = await prepareContext(prices);
console.log(JSON.stringify({
  priceCache: path.relative(ROOT, PRICE_CACHE_PATH),
  contextCache: path.relative(ROOT, CONTEXT_CACHE_PATH),
  seed: prices.seed,
  targetPerMarket: prices.targetPerMarket || TARGET_PER_MARKET,
  selection: prices.selection,
  contextRows: {
    macro: context.macroRows.length,
    credit: context.creditRows.length,
    auxiliary: context.auxiliaryRows.length,
    crisis: context.crisisRows.length,
    analysisTickers: Object.keys(context.analysisByTicker || {}).length,
    analysisSnapshots: Object.values(context.analysisByTicker || {})
      .reduce((total, record) => total + (record?.snapshots?.length || 0), 0),
  },
}, null, 2));
