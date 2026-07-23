import {
  fetchCompanyAnalysis,
  mergeFinancialRecords,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
} from "./company-analysis.mjs";

export {
  mergeFinancialRecords,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
};

const DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json";
const TICKER_PATTERN = /^(\d{6})\.(KS|KQ)$/;
const CORP_CODE_PATTERN = /^\d{8}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_SCHEMA = 1;
const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const ANALYSIS_CACHE_SCHEMA = 3;
const ANALYSIS_CACHE_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const ANALYSIS_SNAPSHOT_LIMIT = 60;
const FORECAST_JOURNAL_SCHEMA = 1;
const FORECAST_JOURNAL_LIMIT = 120;
const FORECAST_JOURNAL_BODY_LIMIT = 256 * 1024;
const FORECAST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const FORECAST_MODEL_PATTERN = /^[A-Za-z0-9._:+/-]{1,80}$/;
const FORECAST_HORIZON_PATTERN = /^[1-9]\d{0,3}$/;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const PROGRESSIVE_PAGE_BATCH_SIZE = 4;
const OVERLAP_DAYS = 7;
const LOOKBACK_YEARS = 3;
const IMPORTANT_DISCLOSURE_PATTERN = /반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출|배당|현금ㆍ현물배당|단일판매|공급계약|수주|유상증자|무상증자|감자|증권신고서\(지분증권\)|전환사채|신주인수권|신주인수권부사채|교환사채|사채권|자기주식(취득|처분)결정|주식소각|합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자|최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획/;
const PUBLIC_ORIGIN = "https://eg-tools.github.io";

function isPrivateHostname(hostname) {
  const value = String(hostname || "").toLowerCase();
  if (value === "localhost" || value === "::1") return true;
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
}

export function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (["capacitor://localhost", "ionic://localhost"].includes(origin)) return true;
  try {
    const url = new URL(origin);
    return url.origin === PUBLIC_ORIGIN
      || (["http:", "https:"].includes(url.protocol) && isPrivateHostname(url.hostname));
  } catch (_) {
    return false;
  }
}

function corsHeaders(origin) {
  return origin && isAllowedOrigin(origin)
    ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      Vary: "Origin",
    }
    : {};
}

function jsonResponse(payload, status = 200, origin = "") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function yearsBefore(dateText, years) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return isoDate(date);
}

function normalizeSince(value, today) {
  const lowerBound = yearsBefore(today, LOOKBACK_YEARS);
  const candidate = String(value || "").slice(0, 10);
  if (!DATE_PATTERN.test(candidate) || candidate > today) return lowerBound;
  return candidate < lowerBound ? lowerBound : candidate;
}

function apiDate(value) {
  return String(value || "").replaceAll("-", "");
}

function isValidIsoDate(value) {
  const text = String(value || "");
  if (!DATE_PATTERN.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && isoDate(date) === text;
}

function finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function timestamp(value) {
  return finiteNumber(value, { min: 1, max: 8_640_000_000_000_000 });
}

function snapshotFromAnalysis(analysis) {
  const savedAt = timestamp(analysis?.savedAt);
  if (!savedAt) return null;
  return {
    asOf: isoDate(new Date(savedAt)),
    savedAt,
    consensus: analysis?.consensus || null,
    financials: Array.isArray(analysis?.financials) ? analysis.financials : [],
  };
}

function sanitizeAnalysisSnapshot(snapshot) {
  const savedAt = timestamp(snapshot?.savedAt);
  const asOf = String(snapshot?.asOf || "").slice(0, 10);
  if (!savedAt || !isValidIsoDate(asOf)) return null;
  return {
    asOf,
    savedAt,
    consensus: snapshot?.consensus || null,
    financials: Array.isArray(snapshot?.financials) ? snapshot.financials : [],
  };
}

export function mergeAnalysisSnapshots(existing, incoming) {
  const byMonth = new Map();
  [...(existing || []), ...(incoming || [])].forEach((value) => {
    const snapshot = sanitizeAnalysisSnapshot(value);
    if (!snapshot) return;
    const month = snapshot.asOf.slice(0, 7);
    const previous = byMonth.get(month);
    if (!previous || snapshot.savedAt >= previous.savedAt) byMonth.set(month, snapshot);
  });
  return [...byMonth.values()]
    .sort((left, right) => left.asOf.localeCompare(right.asOf) || left.savedAt - right.savedAt)
    .slice(-ANALYSIS_SNAPSHOT_LIMIT);
}

function normalizeAnalysisCache(value, ticker) {
  if (!value || value.ticker !== ticker || ![2, ANALYSIS_CACHE_SCHEMA].includes(value.schema)) return null;
  const currentSnapshot = snapshotFromAnalysis(value);
  const storedSnapshots = mergeAnalysisSnapshots(value.snapshots, []);
  const snapshots = mergeAnalysisSnapshots(storedSnapshots, currentSnapshot ? [currentSnapshot] : []);
  const includesCurrentSnapshot = !currentSnapshot
    || storedSnapshots.some((snapshot) => snapshot.savedAt === currentSnapshot.savedAt);
  return {
    schema: ANALYSIS_CACHE_SCHEMA,
    ticker,
    savedAt: timestamp(value.savedAt) || 0,
    consensus: value.consensus || null,
    financials: Array.isArray(value.financials) ? value.financials : [],
    snapshots,
    needsMigration: value.schema !== ANALYSIS_CACHE_SCHEMA
      || !Array.isArray(value.snapshots)
      || storedSnapshots.length !== value.snapshots.length
      || !includesCurrentSnapshot,
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
    ticker,
    savedAt: analysis.savedAt,
    consensus: analysis.consensus || null,
    financials: analysis.financials || [],
    snapshots: mergeAnalysisSnapshots(analysis.snapshots, []),
  }));
}

function analysisPayload(cached, extra = {}) {
  return {
    ok: true,
    ticker: cached.ticker,
    savedAt: cached.savedAt,
    consensus: cached.consensus || null,
    financials: cached.financials || [],
    snapshots: cached.snapshots || [],
    ...extra,
  };
}

async function analysisResponse(env, ctx, ticker, origin, options = {}) {
  const cached = await readAnalysisCache(env, ticker);
  const fresh = cached && Date.now() - Number(cached.savedAt || 0) <= ANALYSIS_CACHE_FRESH_MS;
  if (fresh && (!options.requireFinancials || cached.financials?.length)) {
    if (cached.needsMigration) {
      const write = writeAnalysisCache(env, ticker, cached);
      if (ctx?.waitUntil) ctx.waitUntil(write);
      else await write;
    }
    return jsonResponse(analysisPayload(cached, { cached: true }), 200, origin);
  }
  try {
    const incoming = await fetchCompanyAnalysis(ticker);
    if (options.requireFinancials && !incoming.financials?.length) {
      throw new Error("Embedded earnings data is empty");
    }
    const analysis = {
      schema: ANALYSIS_CACHE_SCHEMA,
      ticker,
      savedAt: Date.now(),
      consensus: incoming.consensus || cached?.consensus || null,
      financials: mergeFinancialRecords(cached?.financials || [], incoming.financials || []),
    };
    const currentSnapshot = snapshotFromAnalysis(analysis);
    analysis.snapshots = mergeAnalysisSnapshots(
      cached?.snapshots || [],
      currentSnapshot ? [currentSnapshot] : [],
    );
    const write = writeAnalysisCache(env, ticker, analysis);
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
    return jsonResponse(analysisPayload(analysis, { cached: false }), 200, origin);
  } catch (error) {
    if (cached?.consensus || cached?.financials?.length) {
      return jsonResponse(analysisPayload(cached, {
        cached: true,
        stale: true,
        warning: "최신 기업 분석을 가져오지 못해 마지막 저장 자료를 사용했습니다.",
      }), 200, origin);
    }
    return jsonResponse({ ok: false, error: `Company analysis failed: ${error?.message || error}` }, 503, origin);
  }
}

function recordFromItem(ticker, item) {
  const rawDate = String(item?.rcept_dt || "").trim();
  const title = String(item?.report_nm || "").trim();
  if (!/^\d{8}$/.test(rawDate) || !title || !IMPORTANT_DISCLOSURE_PATTERN.test(title)) return null;
  const receiptNo = String(item?.rcept_no || "").trim();
  return {
    ticker,
    code: ticker.slice(0, 6),
    name: String(item?.corp_name || "").trim(),
    date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
    title,
    summary: "",
    source: "OpenDART",
    receiptNo,
    url: receiptNo
      ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
      : "",
  };
}

export function mergeRecords(existing, incoming) {
  const records = new Map();
  [...(existing || []), ...(incoming || [])].forEach((record) => {
    if (!record?.ticker || !record?.date || !record?.title) return;
    const key = String(record.receiptNo || record.url || `${record.date}|${record.title}`);
    records.set(key, record);
  });
  return [...records.values()].sort((left, right) => (
    String(left.date).localeCompare(String(right.date))
      || String(left.title).localeCompare(String(right.title))
  ));
}

async function fetchDartPage(env, params) {
  const url = `${DART_LIST_URL}?${new URLSearchParams(params)}`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(25000),
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "User-Agent": "ThinkStock/1.27 (+https://eg-tools.github.io/ThinkStock/)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = String(response.headers.get("Location") || "");
        const redirectHost = (() => {
          try { return new URL(location, DART_LIST_URL).host; } catch (_) { return "unknown"; }
        })();
        const error = new Error(`DART redirect ${response.status} to ${redirectHost}`);
        error.retryable = false;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`DART HTTP ${response.status}`);
        error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw new Error(lastError?.message || "DART request failed");
}

async function fetchDartDisclosurePage(env, ticker, corpCode, since, today, pageNo) {
  const baseParams = {
    crtfc_key: env.DART_API_KEY,
    corp_code: corpCode,
    bgn_de: apiDate(since),
    end_de: apiDate(today),
    last_reprt_at: "Y",
    sort: "date",
    sort_mth: "desc",
    page_count: String(PAGE_SIZE),
  };
  const payload = await fetchDartPage(env, { ...baseParams, page_no: String(pageNo) });
  const status = String(payload?.status || "");
  if (status === "013") return { records: [], totalPages: 1 };
  if (status && status !== "000") {
    const error = new Error(String(payload?.message || `DART status ${status}`));
    error.status = status === "020" ? 429 : 502;
    throw error;
  }
  const records = (payload?.list || [])
    .map((item) => recordFromItem(ticker, item))
    .filter(Boolean);
  return {
    records: mergeRecords([], records),
    totalPages: Math.min(MAX_PAGES, Math.max(1, Number(payload?.total_page) || 1)),
  };
}

async function fetchDartDisclosureBatch(env, ticker, corpCode, since, today, startPage) {
  const first = await fetchDartDisclosurePage(env, ticker, corpCode, since, today, startPage);
  const lastPage = Math.min(
    first.totalPages,
    startPage + PROGRESSIVE_PAGE_BATCH_SIZE - 1,
  );
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, lastPage - startPage) }, (_, index) => (
      fetchDartDisclosurePage(env, ticker, corpCode, since, today, startPage + index + 1)
    )),
  );
  return {
    records: mergeRecords([], [first, ...remaining].flatMap((page) => page.records)),
    totalPages: first.totalPages,
    lastPage,
  };
}

async function fetchDartDisclosures(env, ticker, corpCode, since, today) {
  const records = [];
  let pageNo = 1;
  let totalPages = 1;
  while (pageNo <= totalPages) {
    const page = await fetchDartDisclosurePage(env, ticker, corpCode, since, today, pageNo);
    records.push(...page.records);
    totalPages = page.totalPages;
    pageNo += 1;
  }
  return mergeRecords([], records);
}

function bearerToken(request) {
  const authorization = String(request.headers.get("Authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function tokensMatch(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(provided || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected || ""))),
  ]);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
  }
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function readCache(env, ticker) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const value = await env.DISCLOSURE_CACHE.get(`ticker:${ticker}`, "json");
    return value?.schema === CACHE_SCHEMA && value?.ticker === ticker ? value : null;
  } catch (_) {
    return null;
  }
}

async function writeCache(env, ticker, corpCode, records, complete = true) {
  if (!env.DISCLOSURE_CACHE) return;
  const payload = {
    schema: CACHE_SCHEMA,
    ticker,
    corpCode,
    savedAt: Date.now(),
    latestDate: records.at(-1)?.date || "",
    complete,
    records,
  };
  await env.DISCLOSURE_CACHE.put(`ticker:${ticker}`, JSON.stringify(payload));
}

function journalValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeForecastHorizon(value, key, { strict = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (strict) throw journalValidationError(`Invalid forecast horizon: ${key}`);
    return null;
  }
  const targetDate = String(value.targetDate || "").slice(0, 10);
  const predictedPrice = finiteNumber(value.predictedPrice, { min: Number.MIN_VALUE, max: 1e15 });
  const lowerPrice = finiteNumber(value.lowerPrice, { min: Number.MIN_VALUE, max: 1e15 });
  const upperPrice = finiteNumber(value.upperPrice, { min: Number.MIN_VALUE, max: 1e15 });
  if (!isValidIsoDate(targetDate) || !predictedPrice || !lowerPrice || !upperPrice
    || lowerPrice > upperPrice) {
    if (strict) throw journalValidationError(`Invalid forecast values for horizon ${key}`);
    return null;
  }
  const result = { targetDate, predictedPrice, lowerPrice, upperPrice };
  const nestedScore = value.score && typeof value.score === "object" ? value.score : null;
  const evaluation = nestedScore ? {
    actualDate: nestedScore.actualDate,
    actualPrice: nestedScore.actualPrice,
    absoluteLogError: nestedScore.absLogError ?? nestedScore.absoluteLogError,
    directionCorrect: nestedScore.directionCorrect,
    covered: nestedScore.intervalCovered ?? nestedScore.covered,
    scoredAt: nestedScore.scoredAt,
  } : value;
  const evaluationFields = [
    evaluation.actualDate,
    evaluation.actualPrice,
    evaluation.absoluteLogError,
    evaluation.directionCorrect,
    evaluation.covered,
    evaluation.scoredAt,
  ];
  const hasEvaluation = evaluationFields.some((field) => field !== undefined && field !== null);
  if (!hasEvaluation) return result;

  const actualDate = String(evaluation.actualDate || "").slice(0, 10);
  const actualPrice = finiteNumber(evaluation.actualPrice, { min: Number.MIN_VALUE, max: 1e15 });
  const absoluteLogError = finiteNumber(evaluation.absoluteLogError, { min: 0, max: 100 });
  const scoredAt = timestamp(evaluation.scoredAt);
  const validEvaluation = isValidIsoDate(actualDate)
    && actualPrice
    && absoluteLogError !== null
    && typeof evaluation.directionCorrect === "boolean"
    && typeof evaluation.covered === "boolean"
    && scoredAt;
  if (!validEvaluation) {
    if (strict) throw journalValidationError(`Invalid evaluation values for horizon ${key}`);
    return result;
  }
  return {
    ...result,
    actualDate,
    actualPrice,
    absoluteLogError,
    directionCorrect: evaluation.directionCorrect,
    covered: evaluation.covered,
    scoredAt,
  };
}

function normalizeForecastRecord(value, ticker, { strict = false } = {}) {
  const fail = (message) => {
    if (strict) throw journalValidationError(message);
    return null;
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("Invalid forecast record");
  const id = String(value.id || "").trim();
  const recordTicker = String(value.ticker || "").trim().toUpperCase();
  const asOf = String(value.asOf || "").slice(0, 10);
  const basePrice = finiteNumber(value.basePrice, { min: Number.MIN_VALUE, max: 1e15 });
  const modelVersion = String(value.modelVersion || "").trim();
  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt) || createdAt;
  if (!FORECAST_ID_PATTERN.test(id)) return fail("Invalid forecast id");
  if (recordTicker !== ticker) return fail("Forecast ticker does not match the request");
  if (!isValidIsoDate(asOf) || !basePrice) return fail("Invalid forecast base values");
  if (!FORECAST_MODEL_PATTERN.test(modelVersion) || !createdAt || !updatedAt || updatedAt < createdAt) {
    return fail("Invalid forecast metadata");
  }
  if (!value.horizons || typeof value.horizons !== "object" || Array.isArray(value.horizons)) {
    return fail("Forecast horizons are required");
  }
  const horizons = {};
  for (const [key, horizon] of Object.entries(value.horizons)) {
    if (!FORECAST_HORIZON_PATTERN.test(key) || Number(key) > 3650) {
      if (strict) throw journalValidationError(`Invalid forecast horizon key: ${key}`);
      continue;
    }
    const normalized = normalizeForecastHorizon(horizon, key, { strict });
    if (normalized?.targetDate < asOf) {
      if (strict) throw journalValidationError(`Forecast target precedes its base date: ${key}`);
      continue;
    }
    if (normalized) horizons[key] = normalized;
  }
  if (!Object.keys(horizons).length) return fail("At least one forecast horizon is required");
  return { id, ticker, asOf, basePrice, modelVersion, createdAt, updatedAt, horizons };
}

export function mergeForecastJournalRecords(existing, incoming, ticker, { strictIncoming = false } = {}) {
  const records = new Map();
  const mergeRecord = (previous, record) => {
    if (!previous) return record;
    const horizons = { ...previous.horizons };
    Object.entries(record.horizons).forEach(([key, horizon]) => {
      const previousHorizon = horizons[key];
      if (!previousHorizon) {
        horizons[key] = horizon;
        return;
      }
      const previousScoreTime = timestamp(previousHorizon.scoredAt) || 0;
      const incomingScoreTime = timestamp(horizon.scoredAt) || 0;
      if (incomingScoreTime > previousScoreTime) horizons[key] = horizon;
    });
    return {
      ...previous,
      updatedAt: Math.max(previous.updatedAt, record.updatedAt),
      horizons,
    };
  };
  (existing || []).forEach((value) => {
    const record = normalizeForecastRecord(value, ticker);
    if (record) records.set(record.id, mergeRecord(records.get(record.id), record));
  });
  (incoming || []).forEach((value) => {
    const record = normalizeForecastRecord(value, ticker, { strict: strictIncoming });
    if (!record) return;
    records.set(record.id, mergeRecord(records.get(record.id), record));
  });
  return [...records.values()]
    .sort((left, right) => left.asOf.localeCompare(right.asOf) || left.createdAt - right.createdAt)
    .slice(-FORECAST_JOURNAL_LIMIT);
}

async function readForecastJournal(env, ticker) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const value = await env.DISCLOSURE_CACHE.get(`forecast-journal:${ticker}`, "json");
    if (!value) {
      return { schema: FORECAST_JOURNAL_SCHEMA, ticker, savedAt: 0, records: [] };
    }
    if (value.schema !== FORECAST_JOURNAL_SCHEMA || value.ticker !== ticker) return null;
    return {
      schema: FORECAST_JOURNAL_SCHEMA,
      ticker,
      savedAt: timestamp(value.savedAt) || 0,
      records: mergeForecastJournalRecords(value.records, [], ticker),
    };
  } catch (_) {
    return null;
  }
}

async function writeForecastJournal(env, ticker, records) {
  const payload = {
    schema: FORECAST_JOURNAL_SCHEMA,
    ticker,
    savedAt: Date.now(),
    records,
  };
  await env.DISCLOSURE_CACHE.put(`forecast-journal:${ticker}`, JSON.stringify(payload));
  return payload;
}

async function readJournalRequestBody(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > FORECAST_JOURNAL_BODY_LIMIT) {
    const error = new Error("Forecast journal request is too large");
    error.status = 413;
    throw error;
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > FORECAST_JOURNAL_BODY_LIMIT) {
        await reader.cancel("Forecast journal request is too large");
        const error = new Error("Forecast journal request is too large");
        error.status = 413;
        throw error;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw journalValidationError("Forecast journal body must be valid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.records)) {
    throw journalValidationError("Forecast journal records are required");
  }
  if (payload.records.length > FORECAST_JOURNAL_LIMIT) {
    throw journalValidationError(`Forecast journal accepts at most ${FORECAST_JOURNAL_LIMIT} records`);
  }
  return payload;
}

async function forecastJournalResponse(request, env, ticker, origin) {
  if (!env.DISCLOSURE_CACHE) {
    return jsonResponse({ ok: false, error: "Forecast journal storage is not configured" }, 503, origin);
  }
  if (request.method === "GET") {
    const journal = await readForecastJournal(env, ticker);
    if (!journal) return jsonResponse({ ok: false, error: "Forecast journal cache is invalid" }, 503, origin);
    return jsonResponse({ ok: true, ...journal }, 200, origin);
  }
  try {
    const payload = await readJournalRequestBody(request);
    if (payload.ticker !== undefined && String(payload.ticker).trim().toUpperCase() !== ticker) {
      throw journalValidationError("Forecast journal ticker does not match the request");
    }
    const cached = await readForecastJournal(env, ticker);
    if (!cached) throw new Error("Forecast journal cache is invalid");
    const records = mergeForecastJournalRecords(cached.records, payload.records, ticker, { strictIncoming: true });
    const saved = await writeForecastJournal(env, ticker, records);
    return jsonResponse({ ok: true, ...saved }, 200, origin);
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || "Forecast journal update failed" }, error?.status || 503, origin);
  }
}

export async function handleRequest(request, env, ctx = null) {
  const origin = String(request.headers.get("Origin") || "");
  if (!isAllowedOrigin(origin)) return jsonResponse({ ok: false, error: "허용되지 않은 앱 주소입니다." }, 403, origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      dartConfigured: Boolean(env.DART_API_KEY),
      accessTokenConfigured: Boolean(env.THINKSTOCK_ACCESS_TOKEN),
      cacheConfigured: Boolean(env.DISCLOSURE_CACHE),
    }, 200, origin);
  }
  const isDartRequest = url.pathname === "/api/dart/disclosures" && request.method === "GET";
  const isConsensusRequest = url.pathname === "/api/consensus" && request.method === "GET";
  const isAnalysisRequest = url.pathname === "/api/analysis" && request.method === "GET";
  const isJournalRequest = url.pathname === "/api/forecast-journal"
    && ["GET", "POST"].includes(request.method);
  if (!isDartRequest && !isConsensusRequest && !isAnalysisRequest && !isJournalRequest) {
    return jsonResponse({ ok: false, error: "Not found" }, 404, origin);
  }
  if (!env.THINKSTOCK_ACCESS_TOKEN
    || !await tokensMatch(bearerToken(request), env.THINKSTOCK_ACCESS_TOKEN)) {
    return jsonResponse({ ok: false, error: "개인 접속 코드가 올바르지 않습니다." }, 401, origin);
  }
  const ticker = String(url.searchParams.get("ticker") || "").trim().toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) {
    return jsonResponse({ ok: false, error: "종목코드 형식이 올바르지 않습니다." }, 400, origin);
  }
  if (isJournalRequest) return forecastJournalResponse(request, env, ticker, origin);
  if (isConsensusRequest || isAnalysisRequest) {
    return analysisResponse(env, ctx, ticker, origin, { requireFinancials: isAnalysisRequest });
  }
  if (!env.DART_API_KEY) return jsonResponse({ ok: false, error: "Cloudflare에 DART 키가 설정되지 않았습니다." }, 503, origin);

  const corpCode = String(url.searchParams.get("corpCode") || "").trim();
  if (!CORP_CODE_PATTERN.test(corpCode)) {
    return jsonResponse({ ok: false, error: "종목 또는 DART 회사코드 형식이 올바르지 않습니다." }, 400, origin);
  }

  const force = ["1", "true", "yes"].includes(String(url.searchParams.get("force") || "").toLowerCase());
  const progressive = ["1", "true", "yes"].includes(String(url.searchParams.get("progressive") || "").toLowerCase());
  const requestedPage = Math.min(MAX_PAGES, Math.max(1, Number(url.searchParams.get("page")) || 1));
  const cached = await readCache(env, ticker);
  if (!force && requestedPage === 1 && cached?.complete !== false
    && cached?.records?.length > 0
    && Date.now() - Number(cached.savedAt || 0) <= CACHE_FRESH_MS) {
    return jsonResponse({
      ok: true,
      ticker,
      cached: true,
      latestDate: cached.latestDate || "",
      records: cached.records || [],
      nextPage: null,
      totalPages: 1,
      complete: true,
    }, 200, origin);
  }

  const today = isoDate();
  const rawSince = String(url.searchParams.get("since") || "").slice(0, 10);
  const requestedSince = normalizeSince(rawSince, today);
  const cacheSince = cached?.latestDate ? shiftDate(cached.latestDate, -OVERLAP_DAYS) : requestedSince;
  const since = normalizeSince(
    cached?.latestDate && !DATE_PATTERN.test(rawSince)
      ? cacheSince
      : (cacheSince < requestedSince ? cacheSince : requestedSince),
    today,
  );
  try {
    if (progressive) {
      const batch = await fetchDartDisclosureBatch(env, ticker, corpCode, since, today, requestedPage);
      const records = mergeRecords(cached?.records || [], batch.records);
      const complete = batch.lastPage >= batch.totalPages;
      const cacheWrite = writeCache(env, ticker, corpCode, records, complete);
      if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
      else await cacheWrite;
      return jsonResponse({
        ok: true,
        ticker,
        cached: false,
        checkedFrom: since,
        latestDate: records.at(-1)?.date || "",
        records: batch.records,
        accumulatedCount: records.length,
        page: batch.lastPage,
        totalPages: batch.totalPages,
        nextPage: complete ? null : batch.lastPage + 1,
        complete,
      }, 200, origin);
    }
    const incoming = await fetchDartDisclosures(env, ticker, corpCode, since, today);
    const records = mergeRecords(cached?.records || [], incoming);
    const cacheWrite = writeCache(env, ticker, corpCode, records);
    if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
    else await cacheWrite;
    return jsonResponse({
      ok: true,
      ticker,
      cached: false,
      checkedFrom: since,
      latestDate: records.at(-1)?.date || "",
      records,
    }, 200, origin);
  } catch (error) {
    if (cached?.records?.length) {
      return jsonResponse({
        ok: true,
        ticker,
        cached: true,
        stale: true,
        warning: "DART 연결 실패로 마지막 저장 공시를 사용했습니다.",
        latestDate: cached.latestDate || "",
        records: cached.records,
      }, 200, origin);
    }
    return jsonResponse({ ok: false, error: `DART 조회 실패: ${error?.message || error}` }, error?.status || 503, origin);
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      const origin = String(request.headers.get("Origin") || "");
      console.error(JSON.stringify({
        event: "unhandled-request-error",
        path: new URL(request.url).pathname,
        message: String(error?.message || error),
      }));
      return jsonResponse({ ok: false, error: "ThinkStock server request failed" }, 500, origin);
    }
  },
};
