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
const ANALYSIS_CACHE_SCHEMA = 2;
const ANALYSIS_CACHE_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
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
      "Access-Control-Allow-Methods": "GET, OPTIONS",
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

async function readAnalysisCache(env, ticker) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const value = await env.DISCLOSURE_CACHE.get(`analysis:${ticker}`, "json");
    if (value?.schema === ANALYSIS_CACHE_SCHEMA && value?.ticker === ticker) return value;
    const legacy = await env.DISCLOSURE_CACHE.get(`consensus:${ticker}`, "json");
    return legacy?.schema === 1 && legacy?.ticker === ticker
      ? { ...legacy, schema: ANALYSIS_CACHE_SCHEMA, financials: [] }
      : null;
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
  }));
}

function analysisPayload(cached, extra = {}) {
  return {
    ok: true,
    ticker: cached.ticker,
    savedAt: cached.savedAt,
    consensus: cached.consensus || null,
    financials: cached.financials || [],
    ...extra,
  };
}

async function analysisResponse(env, ctx, ticker, origin, options = {}) {
  const cached = await readAnalysisCache(env, ticker);
  const fresh = cached && Date.now() - Number(cached.savedAt || 0) <= ANALYSIS_CACHE_FRESH_MS;
  if (fresh && (!options.requireFinancials || cached.financials?.length)) {
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
      const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
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

async function fetchDartDisclosures(env, ticker, corpCode, since, today) {
  const baseParams = {
    crtfc_key: env.DART_API_KEY,
    corp_code: corpCode,
    bgn_de: apiDate(since),
    end_de: apiDate(today),
    last_reprt_at: "Y",
    sort: "date",
    sort_mth: "asc",
    page_count: String(PAGE_SIZE),
  };
  const records = [];
  let pageNo = 1;
  let totalPages = 1;
  while (pageNo <= totalPages) {
    const payload = await fetchDartPage(env, { ...baseParams, page_no: String(pageNo) });
    const status = String(payload?.status || "");
    if (status === "013") break;
    if (status && status !== "000") {
      const error = new Error(String(payload?.message || `DART status ${status}`));
      error.status = status === "020" ? 429 : 502;
      throw error;
    }
    totalPages = Math.min(MAX_PAGES, Math.max(1, Number(payload?.total_page) || 1));
    (payload?.list || []).forEach((item) => {
      const record = recordFromItem(ticker, item);
      if (record) records.push(record);
    });
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

async function writeCache(env, ticker, corpCode, records) {
  if (!env.DISCLOSURE_CACHE) return;
  const payload = {
    schema: CACHE_SCHEMA,
    ticker,
    corpCode,
    savedAt: Date.now(),
    latestDate: records.at(-1)?.date || "",
    records,
  };
  await env.DISCLOSURE_CACHE.put(`ticker:${ticker}`, JSON.stringify(payload));
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
  if (!isDartRequest && !isConsensusRequest && !isAnalysisRequest) {
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
  if (isConsensusRequest || isAnalysisRequest) {
    return analysisResponse(env, ctx, ticker, origin, { requireFinancials: isAnalysisRequest });
  }
  if (!env.DART_API_KEY) return jsonResponse({ ok: false, error: "Cloudflare에 DART 키가 설정되지 않았습니다." }, 503, origin);

  const corpCode = String(url.searchParams.get("corpCode") || "").trim();
  if (!CORP_CODE_PATTERN.test(corpCode)) {
    return jsonResponse({ ok: false, error: "종목 또는 DART 회사코드 형식이 올바르지 않습니다." }, 400, origin);
  }

  const force = ["1", "true", "yes"].includes(String(url.searchParams.get("force") || "").toLowerCase());
  const cached = await readCache(env, ticker);
  if (!force && cached && Date.now() - Number(cached.savedAt || 0) <= CACHE_FRESH_MS) {
    return jsonResponse({ ok: true, ticker, cached: true, latestDate: cached.latestDate || "", records: cached.records || [] }, 200, origin);
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
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
