import {
  historicalFinancialSnapshotsFromRecord,
  mergePointInTimeAnalysisSnapshots,
} from "../../shared/ai-analysis-snapshots.mjs";
import { normalizeAnalysisNewsEvidence } from "../../shared/ai-news-evidence.mjs";
import {
  completedDartEpsYearRange,
  DART_EPS_HISTORY_VERSION,
  fetchDartEpsYear,
} from "../../shared/dart-financial-history.mjs";
import {
  COMPANY_ANALYSIS_CACHE_SCHEMA,
  COMPANY_ANALYSIS_CACHE_REVISION,
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
  inspectCompanyAnalysisQuality,
  mergeCompanyFinancialRecords,
} from "../../shared/company-analysis-contract.mjs";
import { koreanDateText } from "../../shared/market-calendar.mjs";
import { jsonResponse, writeCachesBestEffort } from "./http-runtime.mjs";

const COMPANY_OVERVIEW_URL = "https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx";
const COMPANY_FINANCIAL_SUMMARY_URL = "https://navercomp.wisereport.co.kr/v2/company/ajax/cF1001.aspx";
const COMPANY_NEWS_URL = "https://finance.naver.com/item/main.naver";
const MAX_OVERVIEW_BYTES = 900_000;
const MAX_FINANCIAL_SUMMARY_BYTES = 500_000;
const MAX_NEWS_BYTES = 600_000;
const COMPANY_BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const ANALYSIS_CACHE_SCHEMA = COMPANY_ANALYSIS_CACHE_SCHEMA;
export { FINANCIAL_SUMMARY_VERSION };

function companyHtmlHeaders(extra = {}) {
  return {
    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
    "User-Agent": COMPANY_BROWSER_USER_AGENT,
    ...extra,
  };
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", hellip: "…", ldquo: "“", lsquo: "‘",
    lt: "<", middot: "·", nbsp: " ", quot: '"', rdquo: "”", rsquo: "’",
  };
  return String(value || "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => {
      const number = String(code).toLowerCase().startsWith("x")
        ? Number.parseInt(String(code).slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    })
    .replace(/&([a-z]+);/gi, (match, name) => named[String(name).toLowerCase()] ?? match);
}

function htmlText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFromHtml(value) {
  const cleaned = htmlText(value).replaceAll(",", "").replace(/[^0-9.+-]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function analysisTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= 8_640_000_000_000_000
    ? timestamp
    : null;
}

export function sanitizeAnalysisNews(rows, ticker) {
  return normalizeAnalysisNewsEvidence(rows, {
    ticker,
    requireTrustedUrl: true,
    maximumRows: 40,
  });
}

export function snapshotFromAnalysis(analysis) {
  const savedAt = analysisTimestamp(analysis?.savedAt);
  if (!savedAt) return null;
  return {
    asOf: koreanDateText(new Date(savedAt)),
    savedAt,
    consensus: analysis?.consensus || null,
    financials: Array.isArray(analysis?.financials) ? analysis.financials : [],
    news: sanitizeAnalysisNews(analysis?.news, analysis?.ticker),
  };
}

export function sanitizeAnalysisSnapshot(snapshot) {
  const savedAt = analysisTimestamp(snapshot?.savedAt);
  const asOf = savedAt
    ? koreanDateText(new Date(savedAt))
    : String(snapshot?.asOf || "").slice(0, 10);
  if (!savedAt || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  return {
    asOf,
    savedAt,
    consensus: snapshot?.consensus || null,
    financials: Array.isArray(snapshot?.financials) ? snapshot.financials : [],
    news: sanitizeAnalysisNews(snapshot?.news, snapshot?.ticker),
  };
}

export function mergeAnalysisSnapshots(existing, incoming) {
  return mergePointInTimeAnalysisSnapshots(existing, incoming, {
    sanitize: sanitizeAnalysisSnapshot,
  });
}

export function normalizeAnalysisCache(value, ticker) {
  if (!value || value.ticker !== ticker || ![2, 3, 4, ANALYSIS_CACHE_SCHEMA].includes(value.schema)) return null;
  const hasNews = Array.isArray(value.news);
  const currentSnapshot = snapshotFromAnalysis(value);
  const storedSnapshots = mergeAnalysisSnapshots(value.snapshots, []);
  const historicalSnapshots = historicalFinancialSnapshotsFromRecord(value);
  const snapshots = mergeAnalysisSnapshots(
    storedSnapshots,
    [...historicalSnapshots, ...(currentSnapshot ? [currentSnapshot] : [])],
  );
  const includesCurrentSnapshot = !currentSnapshot
    || storedSnapshots.some((snapshot) => snapshot.savedAt === currentSnapshot.savedAt);
  const financials = mergeCompanyFinancialRecords([], value.financials, { ticker });
  const savedAt = analysisTimestamp(value.savedAt) || 0;
  const normalized = {
    schema: ANALYSIS_CACHE_SCHEMA,
    analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
    cacheRevision: COMPANY_ANALYSIS_CACHE_REVISION,
    financialSummaryVersion: Math.max(0, Number(value.financialSummaryVersion) || 0),
    ticker,
    savedAt,
    financialSummarySavedAt: analysisTimestamp(value.financialSummarySavedAt) || 0,
    newsSavedAt: analysisTimestamp(value.newsSavedAt) || (hasNews ? savedAt : 0),
    consensus: value.consensus || null,
    financials,
    news: sanitizeAnalysisNews(value.news, ticker),
    snapshots,
    hasNews,
    needsMigration: value.schema !== ANALYSIS_CACHE_SCHEMA
      || Number(value.analysisContractVersion) !== COMPANY_ANALYSIS_CONTRACT_VERSION
      || String(value.cacheRevision || "") !== COMPANY_ANALYSIS_CACHE_REVISION
      || !Array.isArray(value.snapshots)
      || storedSnapshots.length !== value.snapshots.length
      || snapshots.length !== storedSnapshots.length
      || !includesCurrentSnapshot,
  };
  const dataQuality = inspectCompanyAnalysisQuality(normalized);
  if (!normalized.financialSummarySavedAt && dataQuality.completeFinancialSummary) {
    normalized.financialSummarySavedAt = savedAt;
  }
  normalized.needsMigration = normalized.needsMigration
    || (dataQuality.completeFinancialSummary && !analysisTimestamp(value.financialSummarySavedAt))
    || (hasNews && !analysisTimestamp(value.newsSavedAt));
  return {
    ...normalized,
    dataQuality,
  };
}

function attributeValue(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] || "";
}

async function boundedText(response, maxBytes) {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Upstream response is too large");
  const charset = response.headers.get("Content-Type")?.match(/charset\s*=\s*([^;\s]+)/i)?.[1] || "utf-8";
  let decoder;
  try {
    decoder = new TextDecoder(charset.replace(/["']/g, ""));
  } catch (_) {
    decoder = new TextDecoder();
  }
  if (!response.body?.getReader) {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.byteLength > maxBytes) throw new Error("Upstream response is too large");
    return decoder.decode(value);
  }
  const reader = response.body.getReader();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Upstream response is too large");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function newsDate(month, day, now = new Date()) {
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) return "";
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12
    || !Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return "";
  const koreanNow = new Date(current.getTime() + (9 * 60 * 60 * 1000));
  let year = koreanNow.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, monthNumber - 1, dayNumber));
  if (candidate.getUTCMonth() !== monthNumber - 1 || candidate.getUTCDate() !== dayNumber) return "";
  const koreanToday = Date.UTC(year, koreanNow.getUTCMonth(), koreanNow.getUTCDate());
  if (candidate.getTime() > koreanToday + (7 * 24 * 60 * 60 * 1000)) year -= 1;
  return `${year}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
}

function newsPublisher(row) {
  const value = String(row || "").match(
    /<(?:span|div)\b[^>]*class\s*=\s*["'][^"']*(?:info|press)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i,
  )?.[1];
  return htmlText(value)
    .replace(/\b\d{2}[./-]\d{2}(?:[./-]\d{2,4})?\b.*$/, "")
    .trim()
    .slice(0, 80);
}

export function parseNaverNewsHtml(html, ticker, now = new Date()) {
  const target = String(ticker || "").trim().toUpperCase();
  const code = target.slice(0, 6);
  const records = [];
  const seen = new Set();
  [...String(html || "").matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].forEach((match) => {
    const row = match[1];
    const anchor = row.match(/<a\b([^>]*href\s*=\s*(["'])([^"']*news_read\.naver[^"']*)\2[^>]*)>([\s\S]*?)<\/a>/i);
    const dateMatch = row.match(/<em\b[^>]*>\s*(\d{2})\/(\d{2})\s*<\/em>/i);
    if (!anchor || !dateMatch) return;
    const title = htmlText(anchor[4]).slice(0, 240);
    const date = newsDate(dateMatch[1], dateMatch[2], now);
    if (!title || !date) return;
    const relativeUrl = decodeHtmlEntities(anchor[3]);
    const url = relativeUrl.startsWith("http")
      ? relativeUrl
      : `https://finance.naver.com${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;
    const key = `${date}|${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push({ ticker: target, date, title, source: newsPublisher(row) || "Naver Finance", url });
  });
  return records
    .filter((row) => row.ticker === target && row.url.includes(`code=${code}`))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 20);
}

export function parseConsensusHtml(html, ticker) {
  const table = String(html || "").match(/<table\b[^>]*\bid=["']cTB15["'][^>]*>[\s\S]*?<\/table>/i)?.[0] || "";
  if (!table) return null;
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRow = rows
    .map((match) => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]))
    .find((cells) => cells.length >= 5);
  if (!dataRow) return null;
  const [opinion, targetPrice, eps, per, institutions] = dataRow.slice(-5).map(numberFromHtml);
  if (!Number.isFinite(targetPrice) || targetPrice <= 0 || !Number.isFinite(institutions) || institutions < 1) return null;
  const code = String(ticker || "").slice(0, 6);
  return {
    ticker,
    opinion,
    targetPrice,
    eps,
    per,
    institutions,
    source: "Naver Finance / WiseReport",
    sourceUrl: `https://finance.naver.com/item/coinfo.naver?code=${encodeURIComponent(code)}`,
    fetchedAt: new Date().toISOString(),
  };
}

function seriesValue(series, index) {
  const key = String(index + 1);
  const value = Object.prototype.hasOwnProperty.call(series || {}, key)
    ? series[key]
    : series?.[index];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseEarningsTrendHtml(html, ticker) {
  const source = String(html || "");
  const start = source.indexOf("var EarnigList");
  if (start < 0) return [];
  const section = source.slice(start, start + 30_000);
  const jsonText = section.match(/var\s+res\s*=\s*(\{[\s\S]*?\})\s*;/)?.[1];
  if (!jsonText) return [];

  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(payload?.yymm) || !Array.isArray(payload?.data)) return [];

  return payload.yymm.map((rawPeriod, index) => {
    const compactPeriod = String(rawPeriod || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(compactPeriod)) return null;
    const operatingProfitConsensus = seriesValue(payload.data[0], index);
    const operatingProfitActual = seriesValue(payload.data[1], index);
    const netIncomeConsensus = seriesValue(payload.data[5], index);
    const netIncomeActual = seriesValue(payload.data[6], index);
    const reportDateText = String(payload.yymmdd?.[index] || "");
    const reportDateMatch = reportDateText.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    const estimate = operatingProfitActual === null && netIncomeActual === null;
    const record = {
      ticker,
      period: `${compactPeriod.slice(0, 4)}-${compactPeriod.slice(4)}`,
      frequency: "quarter",
      estimate,
      revenue: null,
      operatingProfit: operatingProfitActual ?? operatingProfitConsensus,
      netIncome: netIncomeActual ?? netIncomeConsensus,
      eps: null,
      operatingProfitConsensus,
      netIncomeConsensus,
      operatingProfitSurprise: seriesValue(payload.data[2], index),
      netIncomeSurprise: seriesValue(payload.data[7], index),
      operatingProfitYoy: seriesValue(payload.data[3], index),
      netIncomeYoy: seriesValue(payload.data[8], index),
      reportDate: reportDateMatch
        ? `${reportDateMatch[1]}-${reportDateMatch[2]}-${reportDateMatch[3]}`
        : "",
    };
    return [
      record.operatingProfit,
      record.netIncome,
      record.operatingProfitConsensus,
      record.netIncomeConsensus,
    ].some(Number.isFinite) ? record : null;
  }).filter(Boolean);
}

function rowValuesByLabel(table) {
  const output = new Map();
  [...String(table || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].forEach((rowMatch) => {
    const row = rowMatch[1];
    const heading = row.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i);
    if (!heading) return;
    const label = htmlText(heading[1]).replace(/\s+/g, "");
    if (!label) return;
    const values = [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((cell) => {
      const title = attributeValue(cell[1], "title");
      return numberFromHtml(title || cell[2]);
    });
    if (values.length) output.set(label, values);
  });
  return output;
}

export function parseFinancialSummaryHtml(html, ticker, options = {}) {
  const forcedFrequency = ["annual", "quarter"].includes(options.frequency)
    ? options.frequency
    : "";
  const tables = [...String(html || "").matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const table = tables.find((candidate) => (
    /r0[23]c\d{2}/i.test(candidate) && /매출액/.test(htmlText(candidate))
  ));
  if (!table) return [];

  const periods = [...table.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)]
    .map((match) => {
      const className = attributeValue(match[1], "class");
      const column = Number(className.match(/\br0[23]c(\d{2})\b/i)?.[1]);
      const text = htmlText(match[2]);
      const period = text.match(/(\d{4})\/(\d{2})(?:\(E\))?/);
      if (!Number.isInteger(column) || !period) return null;
      return {
        column,
        period: `${period[1]}-${period[2]}`,
        frequency: forcedFrequency || (column <= 3 ? "annual" : "quarter"),
        estimate: /\(E\)/i.test(text),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.column - right.column);
  if (!periods.length) return [];

  const rows = rowValuesByLabel(table);
  const revenue = rows.get("매출액") || [];
  const operatingProfit = rows.get("영업이익(발표기준)") || rows.get("영업이익") || [];
  const netIncome = rows.get("당기순이익(지배)") || rows.get("당기순이익") || [];
  const eps = rows.get("EPS") || rows.get("EPS(원)") || [];

  return periods.map((period, index) => ({
    ticker,
    period: period.period,
    frequency: period.frequency,
    estimate: period.estimate,
    revenue: revenue[index] ?? null,
    operatingProfit: operatingProfit[index] ?? null,
    netIncome: netIncome[index] ?? null,
    eps: eps[index] ?? null,
  })).filter((record) => (
    [record.revenue, record.operatingProfit, record.netIncome, record.eps].some(Number.isFinite)
  ));
}

export function financialSummaryRequestFromOverview(html, ticker, options = {}) {
  const source = String(html || "");
  const code = String(ticker || "").slice(0, 6);
  const encparam = source.match(/\bencparam\s*:\s*['"]([^'"]+)['"]/i)?.[1] || "";
  const id = source.match(/\bid\s*:\s*['"]([^'"]+)['"]/i)?.[1] || "";
  if (!/^\d{6}$/.test(code) || !encparam || !id) return null;
  const frequency = ["A", "Y", "Q"].includes(options.frequency)
    ? options.frequency
    : "A";
  const query = new URLSearchParams({
    cmp_cd: code,
    fin_typ: "0",
    freq_typ: frequency,
    extY: "1",
    extQ: "1",
    encparam,
    id,
  });
  return {
    url: `${COMPANY_FINANCIAL_SUMMARY_URL}?${query}`,
    referer: `${COMPANY_OVERVIEW_URL}?cmp_cd=${encodeURIComponent(code)}`,
  };
}

export const mergeFinancialRecords = mergeCompanyFinancialRecords;

export async function fetchCompanyAnalysis(ticker, fetchImpl = fetch) {
  const code = String(ticker || "").slice(0, 6);
  const overviewUrl = `${COMPANY_OVERVIEW_URL}?cmp_cd=${encodeURIComponent(code)}`;
  const newsUrl = `${COMPANY_NEWS_URL}?code=${encodeURIComponent(code)}`;
  const request = (url) => fetchImpl(url, {
    headers: companyHtmlHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  const [overviewResult, newsResult] = await Promise.allSettled([
    request(overviewUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Company analysis HTTP ${response.status}`);
      return boundedText(response, MAX_OVERVIEW_BYTES);
    }),
    request(newsUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Company news HTTP ${response.status}`);
      return boundedText(response, MAX_NEWS_BYTES);
    }),
  ]);
  if (overviewResult.status === "rejected" && newsResult.status === "rejected") {
    throw overviewResult.reason;
  }
  const overviewHtml = overviewResult.status === "fulfilled" ? overviewResult.value : "";
  const newsHtml = newsResult.status === "fulfilled" ? newsResult.value : "";
  const financialRequests = [
    { frequency: "annual", request: financialSummaryRequestFromOverview(overviewHtml, ticker, { frequency: "Y" }) },
    { frequency: "quarter", request: financialSummaryRequestFromOverview(overviewHtml, ticker, { frequency: "Q" }) },
  ].filter((entry) => entry.request);
  const financialResults = await Promise.allSettled(financialRequests.map(async (entry) => {
    const response = await fetchImpl(entry.request.url, {
      headers: companyHtmlHeaders({
        Accept: "text/html, */*; q=0.01",
        Referer: entry.request.referer,
        "X-Requested-With": "XMLHttpRequest",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Financial summary HTTP ${response.status}`);
    return {
      frequency: entry.frequency,
      html: await boundedText(response, MAX_FINANCIAL_SUMMARY_BYTES),
    };
  }));
  const parsedFinancialResults = financialResults.map((result) => (
    result.status === "fulfilled"
      ? parseFinancialSummaryHtml(result.value.html, ticker, { frequency: result.value.frequency })
      : []
  ));
  const parsedFinancialsByFrequency = new Map(financialRequests.map((entry, index) => [
    entry.frequency,
    parsedFinancialResults[index] || [],
  ]));
  const financialSummary = mergeFinancialRecords([], parsedFinancialResults.flat());
  if (!financialSummary.length && overviewHtml) {
    financialSummary.push(...parseFinancialSummaryHtml(overviewHtml, ticker));
  }
  const financialSummaryVersion = financialRequests.length === 2
    && financialResults.every((result) => result.status === "fulfilled")
    && parsedFinancialResults.every((records) => records.length > 0)
    ? FINANCIAL_SUMMARY_VERSION
    : 0;
  const earningsTrend = parseEarningsTrendHtml(overviewHtml, ticker);
  const analysis = {
    ticker,
    analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
    cacheRevision: COMPANY_ANALYSIS_CACHE_REVISION,
    consensus: parseConsensusHtml(overviewHtml, ticker),
    financials: mergeFinancialRecords(financialSummary, earningsTrend),
    financialSummaryVersion,
    news: parseNaverNewsHtml(newsHtml, ticker),
    newsFetched: newsResult.status === "fulfilled",
  };
  return {
    ...analysis,
    dataQuality: inspectCompanyAnalysisQuality(analysis),
    sourceState: Object.freeze({
      overview: overviewResult.status === "fulfilled" ? "ok" : "failed",
      news: newsResult.status === "fulfilled" ? "ok" : "failed",
      annualSummary: parsedFinancialsByFrequency.get("annual")?.length ? "ok" : "failed",
      quarterSummary: parsedFinancialsByFrequency.get("quarter")?.length ? "ok" : "failed",
    }),
  };
}

async function readAnalysisCache(env, ticker) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const value = await env.DISCLOSURE_CACHE.get(`analysis:${ticker}`, "json");
    const normalized = normalizeAnalysisCache(value, ticker);
    if (normalized) return normalized;
    const legacy = await env.DISCLOSURE_CACHE.get(`consensus:${ticker}`, "json");
    if (legacy?.schema !== 1 || legacy?.ticker !== ticker) return null;
    return normalizeAnalysisCache({ ...legacy, schema: 2, financials: [] }, ticker);
  } catch (_) {
    return null;
  }
}

async function writeAnalysisCache(env, ticker, analysis) {
  if (!env.DISCLOSURE_CACHE) return;
  await env.DISCLOSURE_CACHE.put(`analysis:${ticker}`, JSON.stringify({
    schema: ANALYSIS_CACHE_SCHEMA,
    analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
    cacheRevision: COMPANY_ANALYSIS_CACHE_REVISION,
    financialSummaryVersion: Math.max(0, Number(analysis.financialSummaryVersion) || 0),
    ticker,
    savedAt: analysis.savedAt,
    financialSummarySavedAt: analysis.financialSummarySavedAt || 0,
    newsSavedAt: analysis.newsSavedAt || 0,
    consensus: analysis.consensus || null,
    financials: analysis.financials || [],
    news: sanitizeAnalysisNews(analysis.news, ticker),
    snapshots: mergeAnalysisSnapshots(analysis.snapshots, []),
  }));
}

function analysisPayload(cached, extra = {}) {
  const dataQuality = inspectCompanyAnalysisQuality(cached);
  return {
    ok: true,
    analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
    cacheRevision: COMPANY_ANALYSIS_CACHE_REVISION,
    ticker: cached.ticker,
    financialSummaryVersion: Math.max(0, Number(cached.financialSummaryVersion) || 0),
    savedAt: cached.savedAt,
    financialSummarySavedAt: cached.financialSummarySavedAt || 0,
    newsSavedAt: cached.newsSavedAt || 0,
    consensus: cached.consensus || null,
    financials: cached.financials || [],
    news: cached.news || [],
    snapshots: cached.snapshots || [],
    dataQuality,
    ...extra,
  };
}

/**
 * Serve one company-analysis request while keeping cache migration and stale fallback together.
 * @param {Record<string, any>} env
 * @param {{waitUntil?: (promise: Promise<unknown>) => void}|null} ctx
 * @param {string} ticker
 * @param {string} origin
 * @param {{
 *   requireFinancials?: boolean,
 *   requireNews?: boolean,
 *   forceRefresh?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export async function companyAnalysisResponse(env, ctx, ticker, origin, options = {}) {
  const cached = await readAnalysisCache(env, ticker);
  const today = koreanDateText();
  const fresh = cached && koreanDateText(new Date(Number(cached.savedAt || 0))) === today;
  const financialsFresh = cached
    && koreanDateText(new Date(Number(cached.financialSummarySavedAt || 0))) === today;
  const newsFresh = cached
    && koreanDateText(new Date(Number(cached.newsSavedAt || 0))) === today;
  if (!options.forceRefresh
    && fresh
    && (!options.requireNews || (cached.hasNews && newsFresh))
    && (!options.requireFinancials || (
      financialsFresh && cached.dataQuality?.completeFinancialSummary === true
    ))) {
    if (cached.needsMigration) {
      const write = writeCachesBestEffort("company-analysis", [
        () => writeAnalysisCache(env, ticker, cached),
      ]);
      if (ctx?.waitUntil) ctx.waitUntil(write);
      else await write;
    }
    return jsonResponse(analysisPayload(cached, { cached: true }), 200, origin);
  }
  try {
    const incoming = await fetchCompanyAnalysis(ticker, options.fetchImpl || env.fetch || fetch);
    if (options.requireFinancials && incoming.dataQuality?.completeFinancialSummary !== true) {
      console.warn(JSON.stringify({
        event: "company-analysis-incomplete",
        ticker,
        issues: incoming.dataQuality?.issues || [],
        sourceState: incoming.sourceState || {},
      }));
      throw new Error(`Financial summary is incomplete: ${incoming.dataQuality?.issues?.join(",") || "unknown"}`);
    }
    const now = Date.now();
    const analysis = {
      schema: ANALYSIS_CACHE_SCHEMA,
      analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
      cacheRevision: COMPANY_ANALYSIS_CACHE_REVISION,
      financialSummaryVersion: Math.max(
        Number(cached?.financialSummaryVersion) || 0,
        Number(incoming.financialSummaryVersion) || 0,
      ),
      ticker,
      savedAt: now,
      financialSummarySavedAt: incoming.dataQuality?.completeFinancialSummary
        ? now : (cached?.financialSummarySavedAt || 0),
      newsSavedAt: incoming.newsFetched ? now : (cached?.newsSavedAt || 0),
      consensus: incoming.consensus || cached?.consensus || null,
      financials: mergeFinancialRecords(cached?.financials || [], incoming.financials || []),
      news: incoming.newsFetched
        ? sanitizeAnalysisNews(incoming.news, ticker)
        : (cached?.news || []),
    };
    analysis.dataQuality = inspectCompanyAnalysisQuality(analysis);
    if (options.requireFinancials && analysis.dataQuality.completeFinancialSummary !== true) {
      throw new Error(`Merged financial summary is incomplete: ${analysis.dataQuality.issues.join(",")}`);
    }
    const currentSnapshot = snapshotFromAnalysis(analysis);
    analysis.snapshots = mergeAnalysisSnapshots(
      cached?.snapshots || [],
      [
        ...historicalFinancialSnapshotsFromRecord(analysis),
        ...(currentSnapshot ? [currentSnapshot] : []),
      ],
    );
    const write = writeCachesBestEffort("company-analysis", [
      () => writeAnalysisCache(env, ticker, analysis),
    ]);
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
    return jsonResponse(analysisPayload(analysis, { cached: false }), 200, origin);
  } catch (error) {
    if (cached?.consensus || cached?.financials?.length || cached?.news?.length) {
      console.warn(JSON.stringify({
        event: "company-analysis-last-good",
        ticker,
        financialSummarySavedAt: cached.financialSummarySavedAt || 0,
        newsSavedAt: cached.newsSavedAt || 0,
        error: String(error?.message || error || "unknown").slice(0, 240),
      }));
      return jsonResponse(analysisPayload(cached, {
        cached: true,
        stale: true,
        warning: "최신 기업 분석을 가져오지 못해 마지막 저장 자료를 사용했습니다.",
      }), 200, origin);
    }
    return jsonResponse({ ok: false, error: `Company analysis failed: ${error?.message || error}` }, 503, origin);
  }
}

function dartEpsYearCacheKey(ticker, businessYear) {
  return `eps-history:v${DART_EPS_HISTORY_VERSION}:${ticker}:${businessYear}`;
}

async function readDartEpsYearCache(env, ticker, businessYear) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const cached = await env.DISCLOSURE_CACHE.get(dartEpsYearCacheKey(ticker, businessYear), "json");
    return cached?.version === DART_EPS_HISTORY_VERSION
      && cached?.ticker === ticker
      && Number(cached?.businessYear) === businessYear
      && Array.isArray(cached?.records)
      ? cached : null;
  } catch (_) {
    return null;
  }
}

/**
 * Serve one completed DART EPS year. Completed years are immutable unless explicitly refreshed.
 * @param {Record<string, any>} env
 * @param {string} ticker
 * @param {string} corpCode
 * @param {string} origin
 * @param {{businessYear?: number|string, force?: boolean}} [options]
 */
export async function dartEpsHistoryResponse(env, ticker, corpCode, origin, options = {}) {
  const businessYear = Math.trunc(Number(options.businessYear));
  const range = completedDartEpsYearRange({ asOf: koreanDateText() });
  if (businessYear < range.startYear || businessYear > range.endYear) {
    return jsonResponse({ ok: false, error: "완료된 EPS 사업연도 범위를 벗어났습니다." }, 400, origin);
  }
  const cached = await readDartEpsYearCache(env, ticker, businessYear);
  if (cached && !options.force) {
    return jsonResponse({
      ok: true,
      ...cached,
      cached: true,
      startYear: range.startYear,
      endYear: range.endYear,
    }, 200, origin);
  }
  try {
    const result = await fetchDartEpsYear({
      apiKey: env.DART_API_KEY,
      corpCode,
      ticker,
      businessYear,
    });
    const payload = {
      version: DART_EPS_HISTORY_VERSION,
      ticker,
      businessYear,
      savedAt: Date.now(),
      records: result.records,
      emptyReports: result.emptyReports,
    };
    if (env.DISCLOSURE_CACHE) {
      await env.DISCLOSURE_CACHE.put(
        dartEpsYearCacheKey(ticker, businessYear),
        JSON.stringify(payload),
      );
    }
    return jsonResponse({
      ok: true,
      ...payload,
      cached: false,
      startYear: range.startYear,
      endYear: range.endYear,
    }, 200, origin);
  } catch (error) {
    if (cached) {
      return jsonResponse({
        ok: true,
        ...cached,
        cached: true,
        stale: true,
        warning: "최신 DART EPS를 가져오지 못해 저장 자료를 사용했습니다.",
        startYear: range.startYear,
        endYear: range.endYear,
      }, 200, origin);
    }
    return jsonResponse({ ok: false, error: `DART EPS failed: ${error?.message || error}` }, 503, origin);
  }
}
