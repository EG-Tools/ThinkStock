import { mergePointInTimeAnalysisSnapshots } from "../../shared/ai-analysis-snapshots.mjs";
import { normalizeAnalysisNewsEvidence } from "../../shared/ai-news-evidence.mjs";
import { koreanDateText } from "../../shared/market-calendar.mjs";

const COMPANY_OVERVIEW_URL = "https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx";
const COMPANY_NEWS_URL = "https://finance.naver.com/item/main.naver";
const MAX_OVERVIEW_BYTES = 900_000;
const MAX_NEWS_BYTES = 600_000;

export const ANALYSIS_CACHE_SCHEMA = 4;

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

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
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
  if (!value || value.ticker !== ticker || ![2, 3, ANALYSIS_CACHE_SCHEMA].includes(value.schema)) return null;
  const hasNews = Array.isArray(value.news);
  const currentSnapshot = snapshotFromAnalysis(value);
  const storedSnapshots = mergeAnalysisSnapshots(value.snapshots, []);
  const snapshots = mergeAnalysisSnapshots(storedSnapshots, currentSnapshot ? [currentSnapshot] : []);
  const includesCurrentSnapshot = !currentSnapshot
    || storedSnapshots.some((snapshot) => snapshot.savedAt === currentSnapshot.savedAt);
  return {
    schema: ANALYSIS_CACHE_SCHEMA,
    ticker,
    savedAt: analysisTimestamp(value.savedAt) || 0,
    consensus: value.consensus || null,
    financials: Array.isArray(value.financials) ? value.financials : [],
    news: sanitizeAnalysisNews(value.news, ticker),
    snapshots,
    hasNews,
    needsMigration: value.schema !== ANALYSIS_CACHE_SCHEMA
      || !Array.isArray(value.snapshots)
      || storedSnapshots.length !== value.snapshots.length
      || !includesCurrentSnapshot,
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

export function parseFinancialSummaryHtml(html, ticker) {
  const tables = [...String(html || "").matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const table = tables.find((candidate) => (
    /r02c0[0-7]/i.test(candidate) && /매출액/.test(htmlText(candidate))
  ));
  if (!table) return [];

  const periods = [...table.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)]
    .map((match) => {
      const className = attributeValue(match[1], "class");
      const column = Number(className.match(/\br02c(\d{2})\b/i)?.[1]);
      const text = htmlText(match[2]);
      const period = text.match(/(\d{4})\/(\d{2})(?:\(E\))?/);
      if (!Number.isInteger(column) || !period) return null;
      return {
        column,
        period: `${period[1]}-${period[2]}`,
        frequency: column <= 3 ? "annual" : "quarter",
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
  const eps = rows.get("EPS") || [];

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

export function mergeFinancialRecords(existing, incoming) {
  const merged = new Map();
  [...(existing || []), ...(incoming || [])].forEach((record) => {
    const ticker = String(record?.ticker || "").trim().toUpperCase();
    const frequency = ["annual", "quarter"].includes(record?.frequency) ? record.frequency : "";
    const period = String(record?.period || "").slice(0, 7);
    if (!ticker || !frequency || !/^\d{4}-\d{2}$/.test(period)) return;
    merged.set(`${frequency}:${period}`, {
      ticker,
      period,
      frequency,
      estimate: record?.estimate === true,
      revenue: finiteNumberOrNull(record?.revenue),
      operatingProfit: finiteNumberOrNull(record?.operatingProfit),
      netIncome: finiteNumberOrNull(record?.netIncome),
      eps: finiteNumberOrNull(record?.eps),
      operatingProfitConsensus: finiteNumberOrNull(record?.operatingProfitConsensus),
      netIncomeConsensus: finiteNumberOrNull(record?.netIncomeConsensus),
      operatingProfitSurprise: finiteNumberOrNull(record?.operatingProfitSurprise),
      netIncomeSurprise: finiteNumberOrNull(record?.netIncomeSurprise),
      operatingProfitYoy: finiteNumberOrNull(record?.operatingProfitYoy),
      netIncomeYoy: finiteNumberOrNull(record?.netIncomeYoy),
      reportDate: /^\d{4}-\d{2}-\d{2}$/.test(String(record?.reportDate || ""))
        ? String(record.reportDate) : "",
    });
  });
  return [...merged.values()].sort((left, right) => (
    left.period.localeCompare(right.period) || left.frequency.localeCompare(right.frequency)
  ));
}

export async function fetchCompanyAnalysis(ticker, fetchImpl = fetch) {
  const code = String(ticker || "").slice(0, 6);
  const overviewUrl = `${COMPANY_OVERVIEW_URL}?cmp_cd=${encodeURIComponent(code)}`;
  const newsUrl = `${COMPANY_NEWS_URL}?code=${encodeURIComponent(code)}`;
  const request = (url) => fetchImpl(url, {
    headers: { Accept: "text/html", "Accept-Language": "ko-KR,ko;q=0.9" },
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
  return {
    consensus: parseConsensusHtml(overviewHtml, ticker),
    financials: parseEarningsTrendHtml(overviewHtml, ticker),
    news: parseNaverNewsHtml(newsHtml, ticker),
    newsFetched: newsResult.status === "fulfilled",
  };
}
