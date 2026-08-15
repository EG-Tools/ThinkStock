import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analysisSnapshotFromRecord,
  historicalFinancialSnapshotsFromRecord,
  mergePointInTimeAnalysisSnapshots,
} from "../shared/ai-analysis-snapshots.mjs";
import {
  AI_VALIDATION_SAMPLE_VERSION,
  buildStratifiedValidationDesign,
  buildValidationCandidateProfile,
} from "../shared/ai-validation-sampling.mjs";
import { mergeDartDisclosureRecords } from "../shared/dart-disclosure.mjs";
import {
  buildDartFinancialQueryPlan,
  mergeDartFinancialRows,
  parseDartMajorAccountPayload,
} from "../shared/dart-financial-history.mjs";
import { mergeDatedSeriesRows } from "../shared/series-integrity.mjs";
import {
  buildCrisisSignalRows,
  fetchCrisisSignalSeries,
} from "../worker/src/crisis-signal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const PRICE_CACHE_PATH = path.join(CACHE_DIR, "walkforward-prices.json");
const CONTEXT_CACHE_PATH = path.join(CACHE_DIR, "walkforward-context.json");
const VKOSPI_CACHE_PATH = path.join(CACHE_DIR, "vkospi-history.json");
const DART_FINANCIAL_CACHE_PATH = path.join(CACHE_DIR, "dart-financial-history.json");
const YAHOO_SERIES_CACHE_DIR = path.join(CACHE_DIR, "yahoo-series");
const DART_CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "dart");
const STOCK_RESEARCH_CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "stock-research");
const STOCK_RESEARCH_PROFILE_DIR = path.join(STOCK_RESEARCH_CACHE_DIR, "profiles");
const DART_CORP_CODE_DIR = path.join(ROOT, "docs", "data", "dart_corp_codes");
const MODEL_PATH = path.join(ROOT, "docs", "data", "ai_market_model.json");
const UNIVERSE_PATH = path.join(ROOT, "docs", "data", "krx_universe.json");
const LOCAL_ENV_PATH = path.join(ROOT, ".env.local");
const RANDOM_SEED = 20260807;
const perMarketArgument = process.argv.indexOf("--per-market");
const requestedPerMarket = perMarketArgument >= 0
  ? Number(process.argv[perMarketArgument + 1])
  : 20;
const TARGET_PER_MARKET = Math.max(5, Math.min(50, Math.trunc(requestedPerMarket || 20)));
const stratifiedPerMarketArgument = process.argv.indexOf("--stratified-per-market");
const requestedStratifiedPerMarket = stratifiedPerMarketArgument >= 0
  ? Number(process.argv[stratifiedPerMarketArgument + 1])
  : 80;
const STRATIFIED_PER_MARKET = Math.max(20, Math.min(100, Math.trunc(requestedStratifiedPerMarket || 80)));
const auditPerMarketArgument = process.argv.indexOf("--audit-per-market");
const requestedAuditPerMarket = auditPerMarketArgument >= 0
  ? Number(process.argv[auditPerMarketArgument + 1])
  : 20;
const AUDIT_PER_MARKET = Math.max(5, Math.min(30, Math.trunc(requestedAuditPerMarket || 20)));
const CONFIRMATION_AUDIT_PER_MARKET = AUDIT_PER_MARKET;
const BREADTH_DEVELOPMENT_PER_MARKET = 20;
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
const DART_FINANCIAL_START_YEAR = 2020;
const DART_MULTI_COMPANY_LIMIT = 100;

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
      const { timeoutMs = 15_000, ...fetchOptions } = options;
      const response = await fetch(url, {
        ...fetchOptions,
        signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": "ThinkStock/ai-walkforward",
          ...(fetchOptions.headers || {}),
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
    { timeoutMs: 10_000 },
    2,
  );
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose;
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close;
  const values = Array.isArray(adjusted) ? adjusted : closes;
  if (!timestamps.length || !Array.isArray(values)) throw new Error("price rows unavailable");
  const byDate = new Map();
  timestamps.forEach((timestamp, index) => {
    const date = isoDateFromUnix(timestamp);
    const price = Number(values[index]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0) {
      const rawClose = Number(closes?.[index]);
      const adjustment = Number.isFinite(rawClose) && rawClose > 0 ? price / rawClose : 1;
      const adjustedField = (field) => {
        const value = Number(quote?.[field]?.[index]);
        return Number.isFinite(value) && value > 0 ? value * adjustment : null;
      };
      const volume = Number(quote?.volume?.[index]);
      byDate.set(date, {
        price,
        open: adjustedField("open"),
        high: adjustedField("high"),
        low: adjustedField("low"),
        volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
      });
    }
  });
  const dates = [...byDate.keys()].sort();
  if (!dates.length) throw new Error("valid adjusted prices unavailable");
  return {
    dataFormat: "adjusted-ohlcv-v1",
    source: "Yahoo Finance",
    dates,
    prices: dates.map((date) => byDate.get(date).price),
    opens: dates.map((date) => byDate.get(date).open),
    highs: dates.map((date) => byDate.get(date).high),
    lows: dates.map((date) => byDate.get(date).low),
    volumes: dates.map((date) => byDate.get(date).volume),
  };
}

function mergeMarketSeries(primary, supplement) {
  const byDate = new Map();
  const add = (series, prefer) => {
    const dates = Array.isArray(series?.dates) ? series.dates : [];
    const prices = Array.isArray(series?.prices) ? series.prices : [];
    dates.forEach((rawDate, index) => {
      const date = String(rawDate || "").slice(0, 10);
      const price = Number(prices[index]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(price) || price <= 0) return;
      const previous = byDate.get(date) || {};
      const numberOrNull = (values) => {
        const value = Number(values?.[index]);
        return Number.isFinite(value) && value >= 0 ? value : null;
      };
      byDate.set(date, {
        price: prefer || !Number.isFinite(previous.price) ? price : previous.price,
        open: numberOrNull(series?.opens) ?? previous.open ?? null,
        high: numberOrNull(series?.highs) ?? previous.high ?? null,
        low: numberOrNull(series?.lows) ?? previous.low ?? null,
        volume: numberOrNull(series?.volumes) ?? previous.volume ?? null,
      });
    });
  };
  add(primary, false);
  add(supplement, true);
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return null;
  return {
    dataFormat: "adjusted-ohlcv-v1",
    source: [primary?.source, supplement?.source].filter(Boolean).join(" + ") || "local cache",
    dates,
    prices: dates.map((date) => byDate.get(date).price),
    opens: dates.map((date) => byDate.get(date).open),
    highs: dates.map((date) => byDate.get(date).high),
    lows: dates.map((date) => byDate.get(date).low),
    volumes: dates.map((date) => byDate.get(date).volume),
  };
}

function yahooSeriesCachePath(ticker) {
  return path.join(YAHOO_SERIES_CACHE_DIR, `${String(ticker).replace(/[^A-Za-z0-9.-]/g, "_")}.json`);
}

async function cachedYahooAdjustedSeries(ticker, endDate) {
  const research = await researchPriceSeries(ticker);
  if (!refreshPrices) {
    const cached = await readJsonOrNull(yahooSeriesCachePath(ticker));
    if (Array.isArray(cached?.dates) && Array.isArray(cached?.prices) && cached.dates.length === cached.prices.length) {
      return mergeMarketSeries(cached, research) || cached;
    }
    if (research?.dates?.length >= MIN_PRICE_ROWS) return research;
  }
  const series = await fetchYahooAdjustedSeries(ticker, endDate);
  const merged = mergeMarketSeries(series, research) || series;
  await mkdir(YAHOO_SERIES_CACHE_DIR, { recursive: true });
  await writeFile(yahooSeriesCachePath(ticker), `${JSON.stringify(merged)}\n`, "utf8");
  return merged;
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
  return groups.reduce((merged, rows) => mergeDatedSeriesRows(
    merged,
    Array.isArray(rows) ? rows : [],
    { preferIncoming: true },
  ), []);
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
    const historical = historicalFinancialSnapshotsFromRecord(record);
    const snapshots = mergePointInTimeAnalysisSnapshots(
      record.snapshots,
      [...historical, ...(current ? [current] : [])],
    );
    return snapshots.length ? { ticker, snapshots } : null;
  } catch (_) {
    return null;
  }
}

function enrichAnalysisRecord(record) {
  const snapshots = Array.isArray(record?.snapshots) ? record.snapshots : [];
  const historical = historicalFinancialSnapshotsFromRecord({
    financials: snapshots.flatMap((snapshot) => (
      Array.isArray(snapshot?.financials) ? snapshot.financials : []
    )),
  });
  return {
    snapshots: mergePointInTimeAnalysisSnapshots(snapshots, historical),
  };
}

const corpCodeShards = new Map();

async function corpCodeForTicker(ticker) {
  const code = String(ticker || "").slice(0, 6);
  const prefix = code.slice(0, 2);
  if (!/^\d{6}$/.test(code) || !/^\d{2}$/.test(prefix)) return "";
  if (!corpCodeShards.has(prefix)) {
    const payload = await readJsonOrNull(path.join(DART_CORP_CODE_DIR, `${prefix}.json`));
    corpCodeShards.set(prefix, payload?.codes || {});
  }
  return String(corpCodeShards.get(prefix)?.[code] || "").trim();
}

async function localDisclosureRecords(ticker) {
  const payload = await readJsonOrNull(path.join(DART_CACHE_DIR, `${ticker}.json`));
  return mergeDartDisclosureRecords([], payload?.records || []).filter((row) => (
    String(row?.ticker || "").trim().toUpperCase() === ticker
  ));
}

async function gatewayDisclosureRecords(ticker, token) {
  if (!token) return [];
  const corpCode = await corpCodeForTicker(ticker);
  if (!/^\d{8}$/.test(corpCode)) return [];
  try {
    const query = new URLSearchParams({ ticker, corpCode });
    const payload = await fetchJson(`${GATEWAY_URL}/api/dart/disclosures?${query}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    }, 2);
    const records = mergeDartDisclosureRecords([], payload?.records || []).filter((row) => (
      String(row?.ticker || "").trim().toUpperCase() === ticker
    ));
    if (records.length) {
      await mkdir(DART_CACHE_DIR, { recursive: true });
      await writeFile(path.join(DART_CACHE_DIR, `${ticker}.json`), `${JSON.stringify({
        saved_at: Date.now() / 1000,
        ticker,
        records,
      })}\n`, "utf8");
    }
    return records;
  } catch (error) {
    process.stderr.write(`DART context ${ticker}: ${error?.message || error}\n`);
    return [];
  }
}

async function prepareDisclosureRecords(tickers, token, existing = {}) {
  const entries = await mapWithConcurrency(tickers, 3, async (ticker) => {
    if (!refreshContext && Object.prototype.hasOwnProperty.call(existing, ticker)) {
      return [ticker, mergeDartDisclosureRecords([], existing[ticker])];
    }
    const local = await localDisclosureRecords(ticker);
    if (local.length) return [ticker, local];
    return [ticker, await gatewayDisclosureRecords(ticker, token)];
  });
  return Object.fromEntries(entries);
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function validationTickers(prices) {
  return [...new Set([
    ...(prices?.stratifiedSelection?.KOSPI || prices?.selection?.KOSPI || []),
    ...(prices?.stratifiedSelection?.KOSDAQ || prices?.selection?.KOSDAQ || []),
    ...(prices?.auditSelection?.KOSPI || []),
    ...(prices?.auditSelection?.KOSDAQ || []),
    ...(prices?.confirmationAuditSelection?.KOSPI || []),
    ...(prices?.confirmationAuditSelection?.KOSDAQ || []),
    ...(prices?.breadthDevelopmentSelection?.KOSPI || []),
    ...(prices?.breadthDevelopmentSelection?.KOSDAQ || []),
    ...(prices?.qualityCases || []).map((item) => item?.ticker),
  ].filter(Boolean))];
}

async function prepareDartFinancialHistory(tickers, apiKey) {
  const existing = await readJsonOrNull(DART_FINANCIAL_CACHE_PATH);
  let rows = mergeDartFinancialRows(existing?.rows || []);
  const coverage = Object.fromEntries(Object.entries(existing?.coverage || {}).map(([key, values]) => (
    [key, [...new Set(Array.isArray(values) ? values : [])]]
  )));
  if (!apiKey) {
    return { rows, coverage, requestCount: 0, unavailable: true };
  }

  const tickerAndCorpCodes = await mapWithConcurrency(tickers, 12, async (ticker) => (
    [ticker, await corpCodeForTicker(ticker)]
  ));
  const tickerByCorpCode = Object.fromEntries(tickerAndCorpCodes
    .filter(([, corpCode]) => /^\d{8}$/.test(corpCode))
    .map(([ticker, corpCode]) => [corpCode, ticker]));
  const corpCodes = Object.keys(tickerByCorpCode).sort();
  const plans = buildDartFinancialQueryPlan({
    startYear: DART_FINANCIAL_START_YEAR,
    asOf: new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10),
  });
  let requestCount = 0;

  for (const plan of plans) {
    const coverageKey = `${plan.businessYear}:${plan.reportCode}`;
    const covered = new Set(coverage[coverageKey] || []);
    const pending = refreshContext ? corpCodes : corpCodes.filter((corpCode) => !covered.has(corpCode));
    for (const batch of chunks(pending, DART_MULTI_COMPANY_LIMIT)) {
      const query = new URLSearchParams({
        crtfc_key: apiKey,
        corp_code: batch.join(","),
        bsns_year: String(plan.businessYear),
        reprt_code: plan.reportCode,
      });
      try {
        const payload = await fetchJson(`https://opendart.fss.or.kr/api/fnlttMultiAcnt.json?${query}`, {
          cache: "no-store",
        }, 2);
        if (!['000', '013'].includes(String(payload?.status || ""))) {
          throw new Error(`DART ${payload?.status || "unknown"}: ${payload?.message || "financial request failed"}`);
        }
        if (String(payload?.status) === "000") {
          rows = mergeDartFinancialRows(rows, parseDartMajorAccountPayload(payload, {
            businessYear: plan.businessYear,
            reportCode: plan.reportCode,
            tickerByCorpCode,
          }));
        }
        batch.forEach((corpCode) => covered.add(corpCode));
        requestCount += 1;
      } catch (error) {
        process.stderr.write(`DART financial ${coverageKey}: ${error?.message || error}\n`);
      }
    }
    coverage[coverageKey] = [...covered].sort();
  }

  const payload = {
    format: "thinkstock-dart-financial-history-v1",
    generatedAt: new Date().toISOString(),
    startYear: DART_FINANCIAL_START_YEAR,
    coverage,
    rows,
  };
  await writeFile(DART_FINANCIAL_CACHE_PATH, `${JSON.stringify(payload)}\n`, "utf8");
  return { rows, coverage, requestCount, unavailable: false };
}

async function mergeDartFinancialHistoryIntoAnalysis(analysisByTicker, tickers, apiKey) {
  const financialHistory = await prepareDartFinancialHistory(tickers, apiKey);
  const rowsByTicker = new Map();
  financialHistory.rows.forEach((row) => {
    if (!rowsByTicker.has(row.ticker)) rowsByTicker.set(row.ticker, []);
    rowsByTicker.get(row.ticker).push(row);
  });
  const output = { ...(analysisByTicker || {}) };
  tickers.forEach((ticker) => {
    const enriched = enrichAnalysisRecord(output[ticker]);
    const historical = historicalFinancialSnapshotsFromRecord({
      financials: rowsByTicker.get(ticker) || [],
    });
    const snapshots = mergePointInTimeAnalysisSnapshots(enriched.snapshots, historical);
    if (snapshots.length) output[ticker] = { snapshots };
  });
  return {
    analysisByTicker: output,
    financialCoverage: {
      rows: financialHistory.rows.filter((row) => tickers.includes(row.ticker)).length,
      tickers: tickers.filter((ticker) => rowsByTicker.get(ticker)?.length).length,
      requests: financialHistory.requestCount,
      unavailable: financialHistory.unavailable,
    },
  };
}

async function researchPriceSeries(ticker) {
  const payload = await readJsonOrNull(path.join(STOCK_RESEARCH_CACHE_DIR, `${ticker}.json`));
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const dates = [];
  const prices = [];
  const volumes = [];
  rows.forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const price = Number(row?.close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0) {
      dates.push(date);
      prices.push(price);
      const volume = Number(row?.volume);
      volumes.push(Number.isFinite(volume) && volume >= 0 ? volume : null);
    }
  });
  return dates.length ? {
    dataFormat: "close-volume-v1",
    source: "ThinkStock stock-research cache",
    dates,
    prices,
    volumes,
  } : null;
}

async function latestResearchUniverseMetadata() {
  const files = (await readdir(STOCK_RESEARCH_CACHE_DIR).catch(() => []))
    .filter((name) => /^summary-.*\.json$/i.test(name));
  if (!files.length) return { rows: [], source: "", generatedAt: "" };
  const ranked = await Promise.all(files.map(async (name) => ({
    name,
    modifiedAt: Number((await stat(path.join(STOCK_RESEARCH_CACHE_DIR, name))).mtimeMs) || 0,
  })));
  ranked.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const file = ranked[0].name;
  const summary = await readJsonOrNull(path.join(STOCK_RESEARCH_CACHE_DIR, file));
  const byTicker = new Map((Array.isArray(summary?.candidatePool) ? summary.candidatePool : [])
    .filter((row) => row?.ticker)
    .map((row) => [String(row.ticker), row]));
  (Array.isArray(summary?.universeTickers) ? summary.universeTickers : []).forEach((ticker) => {
    if (byTicker.has(ticker)) return;
    const metadata = String(summary?.universeState?.[ticker]?.metadataFingerprint || "").split("|");
    const rank = Number(metadata[2]);
    const marketCap = Number(metadata[3]);
    byTicker.set(ticker, {
      ticker,
      name: metadata[1] || ticker,
      market: String(ticker).endsWith(".KQ") ? "KOSDAQ" : "KOSPI",
      marketRank: Number.isFinite(rank) ? rank : null,
      marketCap: Number.isFinite(marketCap) ? marketCap : null,
    });
  });
  return {
    rows: [...byTicker.values()],
    source: file,
    generatedAt: String(summary?.generatedAt || ""),
  };
}

async function preparePrices() {
  const existing = await readJsonOrNull(PRICE_CACHE_PATH);
  const canReuseExisting = !refreshPrices
    && existing?.format === "thinkstock-ai-walkforward-prices-v3"
    && Number(existing.targetPerMarket || 10) === TARGET_PER_MARKET
    && Number(existing.stratifiedPerMarket || 0) === STRATIFIED_PER_MARKET
    && Number(existing.auditPerMarket || 0) === AUDIT_PER_MARKET
    && Number(existing.confirmationAuditPerMarket || 0) === CONFIRMATION_AUDIT_PER_MARKET
    && Number(existing.breadthDevelopmentPerMarket || 0) === BREADTH_DEVELOPMENT_PER_MARKET
    && existing.validationSampling?.version === AI_VALIDATION_SAMPLE_VERSION
    && QUALITY_CASES.every(({ ticker }) => existing.series?.[ticker])
    && ["KOSPI", "KOSDAQ"].every((market) => (
      existing.selection?.[market]?.length === TARGET_PER_MARKET
      && existing.stratifiedSelection?.[market]?.length === STRATIFIED_PER_MARKET
      && existing.auditSelection?.[market]?.length === AUDIT_PER_MARKET
      && existing.confirmationAuditSelection?.[market]?.length === CONFIRMATION_AUDIT_PER_MARKET
      && existing.breadthDevelopmentSelection?.[market]?.length === BREADTH_DEVELOPMENT_PER_MARKET
      && existing.stratifiedSelection[market].every((ticker) => existing.series?.[ticker])
      && existing.auditSelection[market].every((ticker) => existing.series?.[ticker])
      && existing.confirmationAuditSelection[market].every((ticker) => existing.series?.[ticker])
      && existing.breadthDevelopmentSelection[market].every((ticker) => existing.series?.[ticker])
    ));
  if (canReuseExisting) {
    const qualityCasesMatch = JSON.stringify(existing.qualityCases || []) === JSON.stringify(QUALITY_CASES);
    if (qualityCasesMatch) return existing;
    const migrated = { ...existing, qualityCases: QUALITY_CASES };
    await writeFile(PRICE_CACHE_PATH, `${JSON.stringify(migrated)}\n`, "utf8");
    return migrated;
  }

  const [model, universe, researchUniverse] = await Promise.all([
    readJson(MODEL_PATH),
    readJson(UNIVERSE_PATH),
    latestResearchUniverseMetadata(),
  ]);
  const endDate = new Date().toISOString().slice(0, 10);
  const names = Object.fromEntries((universe.records || []).map((row) => [row.ticker, row.name]));
  const fetched = new Map(!refreshPrices ? Object.entries(existing?.series || {}) : []);
  const failures = { ...(!refreshPrices ? existing?.failures : {}) };
  await mapWithConcurrency(["^KS11", "^KQ11"].filter((ticker) => !fetched.has(ticker)), 2, async (ticker) => {
    fetched.set(ticker, await cachedYahooAdjustedSeries(ticker, endDate));
  });
  const modelCandidates = ["KOSPI", "KOSDAQ"].flatMap((market) => (
    (model?.universe?.tickers?.[market] || []).map((ticker, index, tickers) => ({
      ticker,
      name: names[ticker] || ticker,
      market,
      marketRank: index + 1,
      marketUniverseSize: tickers.length,
      marketCap: 0,
    }))
  ));
  const marketUniverseSizes = Object.fromEntries(["KOSPI", "KOSDAQ"].map((market) => [
    market,
    Math.max(
      1,
      ...researchUniverse.rows
        .filter((row) => String(row?.market || "").toUpperCase() === market)
        .map((row) => Number(row?.marketRank) || 0),
    ),
  ]));
  const candidateByTicker = new Map(modelCandidates.map((row) => [row.ticker, row]));
  researchUniverse.rows.forEach((row) => {
    const ticker = String(row?.ticker || "");
    const market = String(row?.market || (ticker.endsWith(".KQ") ? "KOSDAQ" : "KOSPI")).toUpperCase();
    if (!ticker || !["KOSPI", "KOSDAQ"].includes(market)) return;
    const previous = candidateByTicker.get(ticker) || {};
    candidateByTicker.set(ticker, {
      ...previous,
      ticker,
      name: String(row?.name || previous.name || names[ticker] || ticker),
      market,
      marketRank: Math.max(1, Number(row?.marketRank) || Number(previous.marketRank) || marketUniverseSizes[market]),
      marketUniverseSize: marketUniverseSizes[market],
      marketCap: Math.max(0, Number(row?.marketCap) || Number(previous.marketCap) || 0),
    });
  });
  const candidateMetadata = [...candidateByTicker.values()]
    .sort((left, right) => left.market.localeCompare(right.market)
      || left.marketRank - right.marketRank
      || left.ticker.localeCompare(right.ticker));
  const localCandidateSeries = new Map();
  const candidateProfiles = (await mapWithConcurrency(candidateMetadata, 16, async (candidate) => {
    const researchSeries = await researchPriceSeries(candidate.ticker);
    const series = mergeMarketSeries(fetched.get(candidate.ticker), researchSeries)
      || fetched.get(candidate.ticker)
      || researchSeries;
    if (!series || series.dates.length < MIN_PRICE_ROWS) return null;
    const researchProfile = await readJsonOrNull(path.join(STOCK_RESEARCH_PROFILE_DIR, `${candidate.ticker}.json`));
    localCandidateSeries.set(candidate.ticker, series);
    fetched.set(candidate.ticker, series);
    return buildValidationCandidateProfile({
      ...candidate,
      series,
      industry: researchProfile?.industry || "",
      category: researchProfile?.category || "",
      themes: researchProfile?.themes || [],
    }, {
      benchmarkSeries: fetched.get(candidate.market === "KOSDAQ" ? "^KQ11" : "^KS11"),
    });
  })).filter(Boolean);
  const sampleDesign = buildStratifiedValidationDesign(candidateProfiles, {
    seed: RANDOM_SEED,
    targetPerMarket: STRATIFIED_PER_MARKET,
    fastPerMarket: TARGET_PER_MARKET,
    auditPerMarket: AUDIT_PER_MARKET,
    confirmationAuditPerMarket: CONFIRMATION_AUDIT_PER_MARKET,
    breadthPerMarket: BREADTH_DEVELOPMENT_PER_MARKET,
    minimumPerTag: 20,
    holdoutFraction: 0.25,
  });
  if (sampleDesign.deficits.length) {
    throw new Error(`Stratified sample coverage is incomplete: ${JSON.stringify(sampleDesign.deficits)}`);
  }

  const requiredSeries = [...new Set([
    ...Object.values(sampleDesign.selection).flat(),
    ...Object.values(sampleDesign.audit).flat(),
    ...Object.values(sampleDesign.confirmationAudit).flat(),
    ...Object.values(sampleDesign.breadthDevelopment).flat(),
    ...QUALITY_CASES.map(({ ticker }) => ticker),
    "^KS11",
    "^KQ11",
    "005930.KS",
    "000660.KS",
  ])];
  await mapWithConcurrency(requiredSeries.filter((ticker) => !fetched.has(ticker)), 6, async (ticker) => {
    try {
      fetched.set(ticker, await cachedYahooAdjustedSeries(ticker, endDate));
    } catch (error) {
      failures[ticker] = String(error?.message || error);
      const fallback = localCandidateSeries.get(ticker);
      if (fallback) fetched.set(ticker, fallback);
    }
  });
  for (const required of ["^KS11", "^KQ11"]) {
    if (!fetched.has(required)) throw new Error(`${required} benchmark history is unavailable`);
  }

  for (const market of ["KOSPI", "KOSDAQ"]) {
    const eligible = sampleDesign.selection[market].filter((ticker) => isEligible(fetched.get(ticker), endDate));
    if (eligible.length < STRATIFIED_PER_MARKET) {
      throw new Error(`${market} eligible stratified sample is ${eligible.length}/${STRATIFIED_PER_MARKET}`);
    }
  }
  const requiredRecords = requiredSeries.flatMap((ticker) => (
    fetched.has(ticker) ? [[ticker, fetched.get(ticker)]] : []
  ));
  const volumeSeriesCount = requiredRecords.filter(([, series]) => (
    Array.isArray(series?.volumes) && series.volumes.some((value) => Number.isFinite(Number(value)))
  )).length;
  const payload = {
    format: "thinkstock-ai-walkforward-prices-v3",
    generatedAt: new Date().toISOString(),
    source: "ThinkStock stock-research cache with Yahoo adjusted-history fallback",
    startDate: START_DATE,
    endDate,
    seed: RANDOM_SEED,
    targetPerMarket: TARGET_PER_MARKET,
    stratifiedPerMarket: STRATIFIED_PER_MARKET,
    auditPerMarket: AUDIT_PER_MARKET,
    confirmationAuditPerMarket: CONFIRMATION_AUDIT_PER_MARKET,
    breadthDevelopmentPerMarket: BREADTH_DEVELOPMENT_PER_MARKET,
    selection: sampleDesign.fastSelection,
    stratifiedSelection: sampleDesign.selection,
    auditSelection: sampleDesign.audit,
    confirmationAuditSelection: sampleDesign.confirmationAudit,
    breadthDevelopmentSelection: sampleDesign.breadthDevelopment,
    validationSplit: {
      development: sampleDesign.development,
      holdout: sampleDesign.holdout,
    },
    validationSampling: sampleDesign,
    researchUniverse: {
      source: researchUniverse.source,
      generatedAt: researchUniverse.generatedAt,
      candidates: candidateMetadata.length,
    },
    dataQuality: {
      requiredSeries: requiredRecords.length,
      volumeSeries: volumeSeriesCount,
      pointInTimeMarketCapSeries: 0,
      latestMarketCapSnapshots: candidateMetadata.filter((row) => row.marketCap > 0).length,
      marketCapTrainingPolicy: "latest snapshot is sampling metadata only and excluded from historical model features",
      survivorshipPolicy: "lower-ranked current listings augment development; delisted point-in-time membership remains unavailable",
      delistedSeries: 0,
    },
    qualityCases: QUALITY_CASES,
    names,
    series: Object.fromEntries(requiredRecords),
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
  const requiredAnalysisTickers = validationTickers(prices);
  const env = parseEnv(await readFile(LOCAL_ENV_PATH, "utf8").catch(() => ""));
  if (!refreshContext && [
    "thinkstock-ai-walkforward-context-v3",
    "thinkstock-ai-walkforward-context-v4",
    "thinkstock-ai-walkforward-context-v5",
    "thinkstock-ai-walkforward-context-v6",
  ].includes(existing?.format)) {
    const missingAnalysisTickers = requiredAnalysisTickers.filter((ticker) => (
      !existing.analysisByTicker?.[ticker]?.snapshots?.length
    ));
    let analysisByTicker = Object.fromEntries(Object.entries(existing.analysisByTicker || {})
      .map(([ticker, record]) => [ticker, enrichAnalysisRecord(record)]));
    if (missingAnalysisTickers.length) {
      const records = await mapWithConcurrency(missingAnalysisTickers, 3, (ticker) => (
        gatewayAnalysisRecord(ticker, env.THINKSTOCK_ACCESS_TOKEN)
      ));
      records.forEach((record) => {
        if (record) analysisByTicker[record.ticker] = { snapshots: record.snapshots };
      });
    }
    const dartFinancial = await mergeDartFinancialHistoryIntoAnalysis(
      analysisByTicker,
      requiredAnalysisTickers,
      env.DART_API_KEY,
    );
    analysisByTicker = dartFinancial.analysisByTicker;
    const disclosuresByTicker = await prepareDisclosureRecords(
      requiredAnalysisTickers,
      env.THINKSTOCK_ACCESS_TOKEN,
      existing.disclosuresByTicker || {},
    );
    const payload = {
      ...existing,
      format: "thinkstock-ai-walkforward-context-v6",
      generatedAt: new Date().toISOString(),
      crisisRows: mergeRows(existing.crisisRows, vkospiRows),
      analysisByTicker,
      disclosuresByTicker,
      financialHistoryCoverage: dartFinancial.financialCoverage,
      candidateCoverage: {
        ...(existing.candidateCoverage || {}),
        vkospi: vkospiRows.some((row) => Number.isFinite(Number(row?.vkospi))),
        pointInTimeFinancials: dartFinancial.financialCoverage.rows > 0,
      },
    };
    await writeFile(CONTEXT_CACHE_PATH, `${JSON.stringify(payload)}\n`, "utf8");
    return payload;
  }
  const [macroFile, creditFile, adrFile, gatewayMacro, gatewayCredit, gatewayCrisisRows, directCrisisRows] = await Promise.all([
    readJson(path.join(ROOT, "docs", "data", "macro_data.json")),
    readJson(path.join(ROOT, "docs", "data", "credit_data.json")),
    readJson(path.join(ROOT, "docs", "data", "adr_data.json")),
    gatewayPayload("/api/macro", env.THINKSTOCK_ACCESS_TOKEN),
    gatewayRows("/api/credit", env.THINKSTOCK_ACCESS_TOKEN),
    gatewayRows("/api/crisis-signal", env.THINKSTOCK_ACCESS_TOKEN),
    directFredCrisisRows(env.FRED_API_KEY),
  ]);
  const analysisRecords = await mapWithConcurrency(requiredAnalysisTickers, 3, (ticker) => (
    gatewayAnalysisRecord(ticker, env.THINKSTOCK_ACCESS_TOKEN)
  ));
  const disclosuresByTicker = await prepareDisclosureRecords(
    requiredAnalysisTickers,
    env.THINKSTOCK_ACCESS_TOKEN,
  );
  const initialAnalysisByTicker = Object.fromEntries(analysisRecords.flatMap((record) => (
    record ? [[record.ticker, { snapshots: record.snapshots }]] : []
  )));
  const dartFinancial = await mergeDartFinancialHistoryIntoAnalysis(
    initialAnalysisByTicker,
    requiredAnalysisTickers,
    env.DART_API_KEY,
  );
  const payload = {
    format: "thinkstock-ai-walkforward-context-v6",
    generatedAt: new Date().toISOString(),
    macroRows: mergeRows(rowsFromColumnar(macroFile), macroRowsFromPayload(gatewayMacro)),
    creditRows: mergeRows(rowsFromColumnar(creditFile), gatewayCredit),
    auxiliaryRows: mergeRows(rowsFromColumnar(adrFile)),
    crisisRows: mergeRows(gatewayCrisisRows, directCrisisRows, vkospiRows),
    candidateCoverage: {
      vkospi: vkospiRows.some((row) => Number.isFinite(Number(row?.vkospi))),
      vix: directCrisisRows.some((row) => Number.isFinite(Number(row?.vix))),
      krwUsd: directCrisisRows.some((row) => Number.isFinite(Number(row?.krwUsd))),
      pointInTimeFinancials: dartFinancial.financialCoverage.rows > 0,
    },
    financialHistoryCoverage: dartFinancial.financialCoverage,
    analysisByTicker: dartFinancial.analysisByTicker,
    disclosuresByTicker,
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
  stratifiedPerMarket: prices.stratifiedPerMarket || STRATIFIED_PER_MARKET,
  auditPerMarket: prices.auditPerMarket || AUDIT_PER_MARKET,
  selection: prices.selection,
  auditSelection: prices.auditSelection,
  validationSplit: prices.validationSplit,
  contextRows: {
    macro: context.macroRows.length,
    credit: context.creditRows.length,
    auxiliary: context.auxiliaryRows.length,
    crisis: context.crisisRows.length,
    analysisTickers: Object.keys(context.analysisByTicker || {}).length,
    analysisSnapshots: Object.values(context.analysisByTicker || {})
      .reduce((total, record) => total + (record?.snapshots?.length || 0), 0),
    disclosureTickers: Object.values(context.disclosuresByTicker || {})
      .filter((records) => records?.length).length,
    disclosureRecords: Object.values(context.disclosuresByTicker || {})
      .reduce((total, records) => total + (records?.length || 0), 0),
    financialHistoryRows: Number(context.financialHistoryCoverage?.rows || 0),
    financialHistoryTickers: Number(context.financialHistoryCoverage?.tickers || 0),
  },
}, null, 2));
