import { strFromU8, unzipSync } from "fflate";

import {
  expectedLatestKoreanTradingDate,
  koreanDateText,
} from "../../shared/market-calendar.mjs";

import {
  fetchCompanyAnalysis,
  mergeFinancialRecords,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
} from "./company-analysis.mjs";

import { matchRequestRoute, queryFlag } from "./request-router.mjs";
import { buildCrisisSignalRows, fetchCrisisSignalSeries } from "./crisis-signal.mjs";

export {
  mergeFinancialRecords,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
};

const DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json";
const DART_ELESTOCK_URL = "https://opendart.fss.or.kr/api/elestock.json";
const DART_MAJORSTOCK_URL = "https://opendart.fss.or.kr/api/majorstock.json";
const DART_DOCUMENT_URL = "https://opendart.fss.or.kr/api/document.xml";
const KRX_STOCK_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis/sto";
const KRX_INDEX_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis/idx";
const NAVER_STOCK_PRICE_URL = "https://api.finance.naver.com/siseJson.naver";
const TICKER_PATTERN = /^(\d{6})\.(KS|KQ)$/;
const CORP_CODE_PATTERN = /^\d{8}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_SCHEMA = 1;
const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const INSIDER_CACHE_SCHEMA = 2;
const INSIDER_CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const MAJOR_HOLDER_DOCUMENT_CONCURRENCY = 4;
const MAX_MAJOR_HOLDER_DOCUMENTS = 40;
const MAX_DART_DOCUMENT_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_DART_DOCUMENT_XML_BYTES = 12 * 1024 * 1024;
const ANALYSIS_CACHE_SCHEMA = 3;
const ANALYSIS_CACHE_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const ANALYSIS_SNAPSHOT_LIMIT = 60;
const FORECAST_JOURNAL_SCHEMA = 1;
const FORECAST_JOURNAL_LIMIT = 120;
// A full 60-record audit journal is roughly 375 KB; keep room for JSON overhead
// while still rejecting unexpectedly large authenticated writes.
const FORECAST_JOURNAL_BODY_LIMIT = 512 * 1024;
const FORECAST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const FORECAST_MODEL_PATTERN = /^[A-Za-z0-9._:+/-]{1,80}$/;
const FORECAST_HORIZON_PATTERN = /^[1-9]\d{0,3}$/;
const FORECAST_AUDIT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORECAST_ATTRIBUTION_COMPONENTS = new Set([
  "localModel",
  "top400Blend",
  "empiricalGuardrail",
  "corporateRiskGate",
  "consensus",
  "fundamentals",
  "marketRegime",
  "corporateRisk",
  "rotation",
  "rangeMeanReversion",
  "terminalRisk",
  "finalClamp",
  "analogPath",
]);
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const PROGRESSIVE_PAGE_BATCH_SIZE = 4;
const OVERLAP_DAYS = 7;
const LOOKBACK_YEARS = 3;
const KRX_LATEST_LOOKBACK_DAYS = 10;
const KRX_MARKET_CACHE_SCHEMA = 1;
const KRX_MARKET_CACHE_TTL_SECONDS = 15 * 24 * 60 * 60;
const KRX_EMPTY_MARKET_CACHE_TTL_SECONDS = 10 * 60;
const KRX_INDEX_CACHE_SCHEMA = 1;
const KRX_INDEX_CACHE_TTL_SECONDS = 24 * 60 * 60;
const NAVER_PRICE_LOOKBACK_DAYS = 21;
const MAX_NAVER_PRICE_BYTES = 1024 * 1024;
const NAVER_KRX_OVERLAP_MAX_DIVERGENCE = 1.05;
const PRICE_MOVE_WARNING_RATIO = 1.35;
const ECOS_CACHE_SCHEMA = 2;
const ECOS_CACHE_KEY = `ecos-macro:${ECOS_CACHE_SCHEMA}`;
const ECOS_LEADING_STAT_CODE = "901Y067";
const ECOS_LEADING_ITEM_CODE = "I16E";
const ECOS_NEWS_STAT_CODE = "521Y001";
const ECOS_NEWS_ITEM_CODE = "A001";
const ECOS_POLICY_RATE_STAT_CODE = "722Y001";
const ECOS_POLICY_RATE_ITEM_CODE = "0101000";
const ECOS_TRADE_STAT_CODE = "901Y118";
const ECOS_EXPORT_ITEM_CODE = "T002";
const ECOS_IMPORT_ITEM_CODE = "T004";
const CREDIT_CACHE_SCHEMA = 4;
const CREDIT_CACHE_KEY = `credit-macro:${CREDIT_CACHE_SCHEMA}`;
const CRISIS_CACHE_SCHEMA = 2;
const CRISIS_CACHE_KEY = `fred-crisis-signal:${CRISIS_CACHE_SCHEMA}`;
const KOFIA_CREDIT_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo";
const KOFIA_MARKET_FUNDS_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getSecuritiesMarketTotalCapitalInfo";
const FREESIS_CREDIT_URL = "https://freesis.kofia.or.kr/meta/getMetaDataList.do";
const FREESIS_CREDIT_OBJECT = "STATSCU0100000070BO";
const FREESIS_CUSTOMER_DEPOSIT_OBJECT = "STATSCU0100000060BO";
const IMPORTANT_DISCLOSURE_PATTERN = /반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출|배당|현금ㆍ현물배당|단일판매|공급계약|수주|유상증자|무상증자|감자|증권신고서\(지분증권\)|전환사채|신주인수권|신주인수권부사채|교환사채|사채권|자기주식(취득|처분)결정|주식소각|합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자|최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획/;
const PUBLIC_ORIGIN = "https://eg-tools.github.io";

function isPrivateHostname(hostname) {
  const value = String(hostname || "").toLowerCase();
  if (value === "localhost" || value === "::1") return true;
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
}

export function isAllowedOrigin(origin) {
  if (!origin) return true;
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

function ecosDateCode(daysBack, monthly = false) {
  const text = shiftDate(koreanDateText(), -daysBack).replaceAll("-", "");
  return monthly ? text.slice(0, 6) : text;
}

function mergeEcosRows(existing, incoming, key) {
  const rows = new Map();
  [...(existing || []), ...(incoming || [])].forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const value = finiteNumber(row?.[key]);
    if (isValidIsoDate(date) && value !== null) rows.set(date, { date, [key]: value });
  });
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function mergeEcosFieldRows(...groups) {
  const rows = new Map();
  groups.flat().forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!isValidIsoDate(date)) return;
    const next = { ...(rows.get(date) || { date }) };
    Object.entries(row || {}).forEach(([key, rawValue]) => {
      if (key === "date") return;
      const value = finiteNumber(rawValue);
      if (value !== null) next[key] = value;
    });
    rows.set(date, next);
  });
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date));
}

async function fetchEcosRows(env, { frequency, statCode, itemCode, start, key, limit = null }) {
  const end = ecosDateCode(0, frequency === "M");
  const rowLimit = Math.max(1, Number(limit) || (frequency === "M" ? 120 : 500));
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${env.ECOS_API_KEY}/json/kr/1/${rowLimit}/${statCode}/${frequency}/${start}/${end}/${itemCode}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ECOS HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.StatisticSearch?.row) ? payload.StatisticSearch.row : [];
  if (!rows.length && payload?.RESULT?.MESSAGE) throw new Error(payload.RESULT.MESSAGE);
  return rows.map((row) => {
    const time = String(row?.TIME || "");
    const date = frequency === "M" && /^\d{6}$/.test(time)
      ? `${time.slice(0, 4)}-${time.slice(4, 6)}-01`
      : (/^\d{8}$/.test(time) ? `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}` : "");
    return { date, [key]: finiteNumber(row?.DATA_VALUE) };
  }).filter((row) => isValidIsoDate(row.date) && row[key] !== null);
}

async function ecosMacroResponse(env, origin, refresh = false) {
  if (!env.ECOS_API_KEY) return jsonResponse({ ok: false, error: "Cloudflare에 ECOS 키가 설정되지 않았습니다." }, 503, origin);
  const cached = env.DISCLOSURE_CACHE ? await env.DISCLOSURE_CACHE.get(ECOS_CACHE_KEY, "json") : null;
  const checkDate = koreanDateText();
  const needsRefresh = refresh
    || cached?.schema !== ECOS_CACHE_SCHEMA
    || cached?.lastCheckedDate !== checkDate;
  if (!needsRefresh) return jsonResponse({ ok: true, cached: true, ...cached }, 200, origin);
  try {
    const requests = await Promise.allSettled([
      fetchEcosRows(env, { frequency: "M", statCode: ECOS_LEADING_STAT_CODE, itemCode: ECOS_LEADING_ITEM_CODE, start: ecosDateCode(730, true), key: "leading_cycle" }),
      fetchEcosRows(env, { frequency: "D", statCode: ECOS_NEWS_STAT_CODE, itemCode: ECOS_NEWS_ITEM_CODE, start: ecosDateCode(90), key: "news_sentiment" }),
      fetchEcosRows(env, {
        frequency: "M",
        statCode: ECOS_POLICY_RATE_STAT_CODE,
        itemCode: ECOS_POLICY_RATE_ITEM_CODE,
        start: ecosDateCode(365 * 26, true),
        key: "policy_rate",
        limit: 500,
      }),
      fetchEcosRows(env, {
        frequency: "M",
        statCode: ECOS_TRADE_STAT_CODE,
        itemCode: ECOS_EXPORT_ITEM_CODE,
        start: ecosDateCode(365 * 26, true),
        key: "export_value",
        limit: 500,
      }),
      fetchEcosRows(env, {
        frequency: "M",
        statCode: ECOS_TRADE_STAT_CODE,
        itemCode: ECOS_IMPORT_ITEM_CODE,
        start: ecosDateCode(365 * 26, true),
        key: "import_value",
        limit: 500,
      }),
    ]);
    if (requests[0].status !== "fulfilled" || requests[1].status !== "fulfilled") {
      const reason = requests.find((item, index) => index < 2 && item.status === "rejected")?.reason;
      throw reason || new Error("ECOS core macro series failed");
    }
    const leading = requests[0].value;
    const news = requests[1].value;
    const policyRate = requests[2].status === "fulfilled" ? requests[2].value : [];
    const exports = requests[3].status === "fulfilled" ? requests[3].value : [];
    const imports = requests[4].status === "fulfilled" ? requests[4].value : [];
    const optionalFailures = requests.slice(2).filter((item) => item.status === "rejected").length;
    const payload = {
      schema: ECOS_CACHE_SCHEMA,
      savedAt: Date.now(),
      lastCheckedDate: checkDate,
      leadingRows: mergeEcosRows(cached?.leadingRows, leading, "leading_cycle").slice(-36),
      newsRows: mergeEcosRows(cached?.newsRows, news, "news_sentiment").slice(-180),
      policyRateRows: mergeEcosRows(cached?.policyRateRows, policyRate, "policy_rate").slice(-360),
      tradeRows: mergeEcosFieldRows(cached?.tradeRows, exports, imports).slice(-360),
      warning: optionalFailures
        ? `ECOS 선택 거시지표 ${optionalFailures}개는 마지막 정상값을 사용합니다.`
        : "",
    };
    if (env.DISCLOSURE_CACHE) await env.DISCLOSURE_CACHE.put(ECOS_CACHE_KEY, JSON.stringify(payload));
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    if (cached?.schema === ECOS_CACHE_SCHEMA) return jsonResponse({ ok: true, cached: true, stale: true, warning: "ECOS 연결 실패로 마지막 저장 지표를 사용했습니다.", ...cached }, 200, origin);
    return jsonResponse({ ok: false, error: `ECOS 조회 실패: ${error?.message || error}` }, 503, origin);
  }
}

async function crisisSignalResponse(env, origin, refresh = false) {
  if (!env.FRED_API_KEY) {
    return jsonResponse({ ok: false, error: "FRED API key is not configured" }, 503, origin);
  }
  const cached = env.DISCLOSURE_CACHE
    ? await env.DISCLOSURE_CACHE.get(CRISIS_CACHE_KEY, "json")
    : null;
  const checkDate = koreanDateText();
  const needsRefresh = refresh
    || cached?.schema !== CRISIS_CACHE_SCHEMA
    || cached?.lastCheckedDate !== checkDate;
  if (!needsRefresh) return jsonResponse({ ok: true, cached: true, ...cached }, 200, origin);
  try {
    const series = await fetchCrisisSignalSeries(fetch, String(env.FRED_API_KEY).trim());
    const records = buildCrisisSignalRows(series);
    if (!records.length) throw new Error("FRED crisis signal contains no usable records");
    const payload = {
      schema: CRISIS_CACHE_SCHEMA,
      savedAt: Date.now(),
      lastCheckedDate: checkDate,
      latestDate: records.at(-1)?.date || "",
      source: "FRED",
      records,
    };
    if (env.DISCLOSURE_CACHE) {
      await env.DISCLOSURE_CACHE.put(CRISIS_CACHE_KEY, JSON.stringify(payload));
    }
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    if (cached?.schema === CRISIS_CACHE_SCHEMA) {
      return jsonResponse({
        ok: true,
        cached: true,
        stale: true,
        warning: "FRED refresh failed; using the last saved crisis signal.",
        ...cached,
      }, 200, origin);
    }
    return jsonResponse({ ok: false, error: `FRED crisis signal failed: ${error?.message || error}` }, 503, origin);
  }
}

function creditAmountToTrillion(value) {
  const amount = finiteNumber(String(value ?? "").replaceAll(",", ""), { min: 0 });
  return amount === null ? null : Math.round((amount / 1e12) * 10000) / 10000;
}

function mergeCreditRows(existing, incoming) {
  const byDate = new Map();
  [...(existing || []), ...(incoming || [])].forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!isValidIsoDate(date)) return;
    const previous = byDate.get(date) || { date };
    const next = { ...previous };
    ["customer_deposit", "kospi_credit", "kosdaq_credit"].forEach((key) => {
      const value = finiteNumber(row?.[key], { min: 0 });
      if (value !== null && value > 0) next[key] = value;
    });
    if (Object.keys(next).length > 1) byDate.set(date, next);
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function parseFreesisPayload(text) {
  const source = String(text || "").trim();
  if (source.includes("#")) throw new Error("KOFIA Freesis response masked numeric values");
  try { return JSON.parse(source); } catch (error) {
    throw new Error(`KOFIA JSON parsing failed: ${error?.message || error}`);
  }
}

async function fetchKofiaOpenApiItems(apiKey, endpoint) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) throw new Error("KOFIA_API_KEY is not configured");
  let decodedKey = cleanKey;
  try { decodedKey = decodeURIComponent(cleanKey); } catch (_) {}
  const keyCandidates = [...new Set([cleanKey, decodedKey].filter(Boolean))];
  let lastError = null;
  for (const serviceKey of keyCandidates) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("serviceKey", serviceKey);
      url.searchParams.set("numOfRows", "1000");
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("resultType", "json");
      url.searchParams.set("beginBasDt", shiftDate(koreanDateText(), -180).replaceAll("-", ""));
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`KOFIA Open API HTTP ${response.status}`);
      const payload = await response.json();
      const header = payload?.response?.header;
      if (String(header?.resultCode || "") !== "00") {
        throw new Error(header?.resultMsg || "KOFIA Open API error");
      }
      const rawItems = payload?.response?.body?.items?.item;
      const items = Array.isArray(rawItems) ? rawItems : (rawItems && typeof rawItems === "object" ? [rawItems] : []);
      if (!items.length) throw new Error("KOFIA Open API returned no rows");
      return items;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("KOFIA Open API request failed");
}

async function fetchKofiaOpenApiCreditRows(apiKey) {
  const rows = await fetchKofiaOpenApiItems(apiKey, KOFIA_CREDIT_URL);
  return rows.map((row) => {
    const rawDate = String(row?.basDt || "");
    return {
      date: /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : "",
      kospi_credit: creditAmountToTrillion(row?.crdTrFingScrs),
      kosdaq_credit: creditAmountToTrillion(row?.crdTrFingKosdaq),
    };
  }).filter((row) => isValidIsoDate(row.date) && row.kospi_credit > 0 && row.kosdaq_credit > 0);
}

async function fetchKofiaOpenApiDepositRows(apiKey) {
  const rows = await fetchKofiaOpenApiItems(apiKey, KOFIA_MARKET_FUNDS_URL);
  return rows.map((row) => {
    const rawDate = String(row?.basDt || "");
    return {
      date: /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : "",
      customer_deposit: creditAmountToTrillion(row?.invrDpsgAmt),
    };
  }).filter((row) => isValidIsoDate(row.date) && row.customer_deposit > 0);
}

async function fetchFreesisRows(objectName) {
  const end = koreanDateText().replaceAll("-", "");
  const start = shiftDate(koreanDateText(), -180).replaceAll("-", "");
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(FREESIS_CREDIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          dmSearch: {
            OBJ_NM: objectName,
            tmpV1: "D",
            tmpV40: "01",
            tmpV45: start,
            tmpV46: end,
          },
        }),
      });
      if (!response.ok) throw new Error(`KOFIA HTTP ${response.status}`);
      const payload = parseFreesisPayload(await response.text());
      const rows = Array.isArray(payload?.ds1) ? payload.ds1 : [];
      if (rows.length) return rows;
      throw new Error("KOFIA returned no rows");
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError || new Error("KOFIA request failed");
}

async function fetchFreesisCreditRows() {
  const rows = await fetchFreesisRows(FREESIS_CREDIT_OBJECT);
  return rows.map((row) => {
    const rawDate = String(row?.TMPV1 || "");
    const date = /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : "";
    return {
      date,
      kospi_credit: creditAmountToTrillion(row?.TMPV3),
      kosdaq_credit: creditAmountToTrillion(row?.TMPV4),
    };
  }).filter((row) => isValidIsoDate(row.date)
    && (row.kospi_credit !== null || row.kosdaq_credit !== null));
}

async function fetchFreesisCustomerDepositRows() {
  const rows = await fetchFreesisRows(FREESIS_CUSTOMER_DEPOSIT_OBJECT);
  return rows.map((row) => {
    const rawDate = String(row?.TMPV1 || "");
    const date = /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : "";
    return { date, customer_deposit: creditAmountToTrillion(row?.TMPV2) };
  }).filter((row) => isValidIsoDate(row.date) && row.customer_deposit !== null);
}

export function creditRefreshWindowDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).reduce((out, part) => {
    out[part.type] = part.value;
    return out;
  }, {});
  if (!new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]).has(parts.weekday)) return "";
  if (Number(parts.hour) * 60 + Number(parts.minute) < 9 * 60 + 31) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function creditMacroResponse(env, origin, refresh = false) {
  const cached = env.DISCLOSURE_CACHE ? await env.DISCLOSURE_CACHE.get(CREDIT_CACHE_KEY, "json") : null;
  const windowDate = creditRefreshWindowDate();
  const needsRefresh = refresh
    || !cached || cached.schema !== CREDIT_CACHE_SCHEMA
    || Boolean(windowDate && cached.lastCheckedWindow !== windowDate);
  if (!needsRefresh) return jsonResponse({ ok: true, cached: true, ...cached }, 200, origin);
  try {
    const [creditResult, depositResult] = await Promise.allSettled([
      env.KOFIA_API_KEY ? fetchKofiaOpenApiCreditRows(env.KOFIA_API_KEY) : fetchFreesisCreditRows(),
      env.KOFIA_API_KEY ? fetchKofiaOpenApiDepositRows(env.KOFIA_API_KEY) : fetchFreesisCustomerDepositRows(),
    ]);
    const rows = mergeCreditRows(
      creditResult.status === "fulfilled" ? creditResult.value : [],
      depositResult.status === "fulfilled" ? depositResult.value : [],
    );
    if (!rows.length) {
      const errors = [creditResult, depositResult]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message || String(result.reason));
      throw new Error(errors.join(" / ") || "KOFIA returned no usable rows");
    }
    const warnings = [];
    if (creditResult.status === "rejected") warnings.push("신용 잔고 연결 실패로 마지막 확인 데이터를 사용합니다.");
    if (depositResult.status === "rejected") warnings.push("고객예탁금 연결 실패로 마지막 확인 데이터를 사용합니다.");
    const payload = {
      schema: CREDIT_CACHE_SCHEMA,
      savedAt: Date.now(),
      rows: mergeCreditRows(cached?.rows, rows).slice(-210),
      lastCheckedWindow: windowDate || cached?.lastCheckedWindow || "",
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    };
    if (env.DISCLOSURE_CACHE) {
      await env.DISCLOSURE_CACHE.put(CREDIT_CACHE_KEY, JSON.stringify(payload));
    }
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    if (cached?.schema === CREDIT_CACHE_SCHEMA) return jsonResponse({ ok: true, cached: true, stale: true, warning: "신용 잔고 연결 실패로 마지막 확인 데이터를 사용합니다.", ...cached }, 200, origin);
    return jsonResponse({ ok: false, error: `신용 잔고 조회 실패: ${error?.message || error}` }, 503, origin);
  }
}

function krxNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(number) ? number : null;
}

const krxMarketSnapshotRequests = new Map();

function krxStockCode(value, shortValue = "") {
  const shortDigits = String(shortValue ?? "").replace(/\D/g, "");
  if (shortDigits.length >= 6) return shortDigits.slice(-6);
  const text = String(value ?? "").trim().toUpperCase();
  const isinMatch = /^KR[A-Z0-9](\d{6})\d{3}$/.exec(text);
  if (isinMatch) return isinMatch[1];
  const digits = text.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length === 10) return digits.slice(1, 7);
  return digits.length >= 6 ? digits.slice(-6) : "";
}

export function krxMarketSnapshotFromRows(rows, market = "", baseDate = "") {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const code = krxStockCode(row?.ISU_CD, row?.ISU_SRT_CD);
    const rawDate = String(row?.BAS_DD ?? "").replace(/\D/g, "");
    const date = rawDate.length === 8
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : "";
    const close = krxNumber(row?.TDD_CLSPRC ?? row?.CLSPRC);
    return { code, date, close };
  }).filter((row) => row.code && isValidIsoDate(row.date) && row.close !== null && row.close > 0);
  const marketDate = normalizedRows.reduce(
    (latest, row) => (!latest || row.date > latest ? row.date : latest),
    "",
  );
  if (!marketDate) return null;
  const prices = Object.fromEntries(normalizedRows
    .filter((row) => row.date === marketDate)
    .map((row) => [row.code, row.close]));
  if (!Object.keys(prices).length) return null;
  return {
    schema: KRX_MARKET_CACHE_SCHEMA,
    market: String(market || ""),
    baseDate: String(baseDate || "").slice(0, 10),
    marketDate,
    prices,
  };
}

export function krxStockPointFromRows(rows, ticker) {
  const match = TICKER_PATTERN.exec(String(ticker || "").trim().toUpperCase());
  if (!match) return null;
  const snapshot = krxMarketSnapshotFromRows(rows, match[2], "");
  const close = snapshot?.prices?.[match[1]];
  return Number.isFinite(close) ? { date: snapshot.marketDate, close } : null;
}

export function krxIndexPointFromRows(rows, market) {
  const marketName = String(market || "").toUpperCase();
  const expectedNames = marketName === "KOSPI"
    ? ["KOSPI", "\uCF54\uC2A4\uD53C"]
    : ["KOSDAQ", "\uCF54\uC2A4\uB2E5"];
  let best = null;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rawDate = String(row?.BAS_DD || "");
    const date = /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : "";
    const close = krxNumber(row?.CLSPRC_IDX ?? row?.TDD_CLSPRC ?? row?.CLSPRC);
    const name = String(row?.IDX_NM ?? row?.IDX_NM_KOR ?? row?.IDX_NM_ENG ?? "")
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!date || !Number.isFinite(close) || close <= 0) return;
    const exact = expectedNames.some((value) => name === value);
    const partial = expectedNames.some((value) => name.includes(value));
    const score = exact ? 100 : (partial ? 50 : 0);
    if (!score) return;
    if (!best || score > best.score) best = { date, close, score };
  });
  return best ? { date: best.date, close: best.close } : null;
}

async function fetchLatestKrxIndexPoint(env, market, endpoint, expectedDate) {
  let lastError = null;
  for (let offset = 0; offset <= KRX_LATEST_LOOKBACK_DAYS; offset += 1) {
    const baseDate = shiftDate(expectedDate, -offset);
    try {
      const response = await fetch(`${KRX_INDEX_BASE_URL}/${endpoint}?basDd=${apiDate(baseDate)}`, {
        headers: { AUTH_KEY: env.KRX_API_KEY },
      });
      if (!response.ok) throw new Error(`KRX index HTTP ${response.status}`);
      const payload = await response.json();
      const point = krxIndexPointFromRows(payload?.OutBlock_1, market);
      if (point) return point;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function krxCoreIndexResponse(env, origin) {
  if (!env.KRX_API_KEY) {
    return jsonResponse({ ok: false, error: "Cloudflare\uC5D0 KRX \uD0A4\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." }, 503, origin);
  }
  const expectedDate = expectedLatestKoreanTradingDate(new Date());
  const cacheKey = `krx-core-indices:${KRX_INDEX_CACHE_SCHEMA}:${expectedDate}`;
  const latestKey = `krx-core-indices:${KRX_INDEX_CACHE_SCHEMA}:latest`;
  const cached = env.DISCLOSURE_CACHE ? await env.DISCLOSURE_CACHE.get(cacheKey, "json") : null;
  if (cached?.schema === KRX_INDEX_CACHE_SCHEMA && Array.isArray(cached.records) && cached.records.length) {
    return jsonResponse({ ok: true, cached: true, ...cached }, 200, origin);
  }
  try {
    const targets = [
      { market: "KOSPI", ticker: "^KS11", endpoint: "kospi_dd_trd" },
      { market: "KOSDAQ", ticker: "^KQ11", endpoint: "kosdaq_dd_trd" },
    ];
    const points = await Promise.all(targets.map(async (target) => {
      const point = await fetchLatestKrxIndexPoint(env, target.market, target.endpoint, expectedDate);
      return point ? { ticker: target.ticker, ...point } : null;
    }));
    const records = points.filter(Boolean);
    if (records.length !== targets.length) throw new Error("KRX core index response is incomplete");
    const payload = {
      schema: KRX_INDEX_CACHE_SCHEMA,
      source: "KRX",
      savedAt: Date.now(),
      expectedDate,
      latestDate: records.reduce((latest, row) => row.date > latest ? row.date : latest, ""),
      records,
    };
    if (env.DISCLOSURE_CACHE) {
      await Promise.all([
        env.DISCLOSURE_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: KRX_INDEX_CACHE_TTL_SECONDS }),
        env.DISCLOSURE_CACHE.put(latestKey, JSON.stringify(payload)),
      ]);
    }
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    const stale = env.DISCLOSURE_CACHE ? await env.DISCLOSURE_CACHE.get(latestKey, "json") : null;
    if (stale?.schema === KRX_INDEX_CACHE_SCHEMA && Array.isArray(stale.records) && stale.records.length) {
      return jsonResponse({
        ok: true,
        cached: true,
        stale: true,
        warning: "KRX \uC5F0\uACB0 \uC2E4\uD328\uB85C \uB9C8\uC9C0\uB9C9 \uC800\uC7A5 \uC9C0\uC218\uB97C \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4.",
        ...stale,
      }, 200, origin);
    }
    return jsonResponse({ ok: false, error: `KRX index failed: ${error?.message || error}` }, 503, origin);
  }
}

function krxMarketCacheKey(market, baseDate) {
  return `krx-market:${KRX_MARKET_CACHE_SCHEMA}:${market}:${baseDate}`;
}

async function readKrxMarketSnapshot(env, market, baseDate) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const cached = await env.DISCLOSURE_CACHE.get(krxMarketCacheKey(market, baseDate), "json");
    if (cached?.schema !== KRX_MARKET_CACHE_SCHEMA
      || cached?.market !== market
      || cached?.baseDate !== baseDate
      || !cached?.prices
      || typeof cached.prices !== "object") return null;
    if (cached.empty === true) return { ...cached, cached: true };
    if (!isValidIsoDate(cached?.marketDate)) return null;
    return { ...cached, cached: true };
  } catch (_) {
    return null;
  }
}

async function fetchKrxMarketSnapshot(env, market, endpoint, baseDate) {
  const cached = await readKrxMarketSnapshot(env, market, baseDate);
  if (cached) return cached;
  const requestKey = `${market}:${baseDate}`;
  if (krxMarketSnapshotRequests.has(requestKey)) return krxMarketSnapshotRequests.get(requestKey);
  const request = (async () => {
    const response = await fetch(`${KRX_STOCK_BASE_URL}/${endpoint}?basDd=${apiDate(baseDate)}`, {
      headers: { AUTH_KEY: env.KRX_API_KEY },
    });
    if (!response.ok) throw new Error(`KRX HTTP ${response.status}`);
    const payload = await response.json();
    const snapshot = krxMarketSnapshotFromRows(payload?.OutBlock_1, market, baseDate) || {
      schema: KRX_MARKET_CACHE_SCHEMA,
      market,
      baseDate,
      marketDate: "",
      prices: {},
      empty: true,
    };
    if (env.DISCLOSURE_CACHE) {
      await env.DISCLOSURE_CACHE.put(
        krxMarketCacheKey(market, baseDate),
        JSON.stringify(snapshot),
        {
          expirationTtl: snapshot.empty
            ? KRX_EMPTY_MARKET_CACHE_TTL_SECONDS
            : KRX_MARKET_CACHE_TTL_SECONDS,
        },
      );
    }
    return { ...snapshot, cached: false };
  })();
  krxMarketSnapshotRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    krxMarketSnapshotRequests.delete(requestKey);
  }
}

async function fetchLatestKrxStockPoint(env, ticker, today = koreanDateText()) {
  const market = String(ticker || "").toUpperCase().endsWith(".KQ") ? "KQ" : "KS";
  const endpoint = market === "KQ" ? "ksq_bydd_trd" : "stk_bydd_trd";
  const stockCode = TICKER_PATTERN.exec(String(ticker || "").trim().toUpperCase())?.[1] || "";
  let lastError = null;
  let marketDate = "";
  let cacheHits = 0;
  for (let offset = 0; offset <= KRX_LATEST_LOOKBACK_DAYS; offset += 1) {
    const baseDate = shiftDate(today, -offset);
    try {
      const snapshot = await fetchKrxMarketSnapshot(env, market, endpoint, baseDate);
      if (!snapshot || snapshot.empty) continue;
      if (snapshot.cached) cacheHits += 1;
      if (!marketDate || snapshot.marketDate > marketDate) marketDate = snapshot.marketDate;
      const close = snapshot.prices?.[stockCode];
      if (Number.isFinite(close)) {
        return {
          point: { date: snapshot.marketDate, close },
          marketDate,
          cached: Boolean(snapshot.cached),
          cacheHits,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return { point: null, marketDate, cached: cacheHits > 0, cacheHits };
}

export function parseNaverPriceSeries(text) {
  const byDate = new Map();
  for (const match of String(text || "").matchAll(/\[\s*"(\d{8})"\s*,([^\]]+)\]/g)) {
    const rawDate = match[1];
    const values = match[2].split(",").map((value) => krxNumber(value));
    const close = values[3];
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    if (!isValidIsoDate(date) || close === null || close <= 0) continue;
    byDate.set(date, { date, close });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function parseNaverPriceText(text) {
  return parseNaverPriceSeries(text).at(-1) || null;
}

function priceRatio(left, right) {
  const a = finiteNumber(left, { min: Number.MIN_VALUE });
  const b = finiteNumber(right, { min: Number.MIN_VALUE });
  if (!a || !b) return null;
  return Math.max(a, b) / Math.min(a, b);
}

export function evaluateNaverPriceFallback(krxPoint, naverPoints) {
  const points = (Array.isArray(naverPoints) ? naverPoints : [])
    .filter((point) => isValidIsoDate(point?.date) && finiteNumber(point?.close, { min: Number.MIN_VALUE }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const latest = points.at(-1) || null;
  if (!latest) return { accepted: false, status: "unavailable", point: null };
  if (!krxPoint) return { accepted: true, status: "krx-unavailable", point: latest, jumpRatio: null };
  const overlap = points.find((point) => point.date === krxPoint.date) || null;
  const overlapRatio = overlap ? priceRatio(overlap.close, krxPoint.close) : null;
  if (!overlap || overlapRatio === null) {
    return { accepted: false, status: "no-overlap", point: latest, overlapRatio };
  }
  if (overlapRatio > NAVER_KRX_OVERLAP_MAX_DIVERGENCE) {
    return { accepted: false, status: "mismatch", point: latest, overlapRatio };
  }
  if (latest.date <= krxPoint.date) {
    return { accepted: false, status: "matched", point: latest, overlapRatio };
  }
  const prior = [...points].reverse().find((point) => point.date < latest.date) || overlap;
  return {
    accepted: true,
    status: "matched-newer",
    point: latest,
    overlapRatio,
    jumpRatio: priceRatio(prior?.close, latest.close),
  };
}

async function fetchLatestNaverStockPoints(ticker, today = koreanDateText()) {
  const stockCode = TICKER_PATTERN.exec(String(ticker || "").trim().toUpperCase())?.[1] || "";
  if (!stockCode) return [];
  const query = new URLSearchParams({
    symbol: stockCode,
    requestType: "1",
    startTime: apiDate(shiftDate(today, -NAVER_PRICE_LOOKBACK_DAYS)),
    endTime: apiDate(today),
    timeframe: "day",
  });
  const response = await fetch(`${NAVER_STOCK_PRICE_URL}?${query}`);
  if (!response.ok) throw new Error(`Naver price HTTP ${response.status}`);
  const announcedSize = Number(response.headers.get("Content-Length") || 0);
  if (announcedSize > MAX_NAVER_PRICE_BYTES) throw new Error("Naver price response is too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_NAVER_PRICE_BYTES) throw new Error("Naver price response is too large");
  return parseNaverPriceSeries(new TextDecoder().decode(bytes));
}

async function krxPriceResponse(env, ticker, origin) {
  if (!env.KRX_API_KEY) {
    return jsonResponse({ ok: false, error: "Cloudflare에 KRX 키가 설정되지 않았습니다." }, 503, origin);
  }
  try {
    const now = new Date();
    const today = koreanDateText(now);
    const expectedDate = expectedLatestKoreanTradingDate(now);
    let point = null;
    let source = "KRX";
    let krxError = null;
    let krxResult = null;
    let stale = false;
    let crossCheck = "not-needed";
    const warnings = [];
    try {
      krxResult = await fetchLatestKrxStockPoint(env, ticker, today);
      point = krxResult?.point || null;
    } catch (error) {
      krxError = error;
    }
    const shouldCheckNaver = !point
      || !krxResult?.marketDate
      || krxResult.marketDate < expectedDate
      || point.date < krxResult.marketDate;
    if (shouldCheckNaver) {
      try {
        const naverPoints = await fetchLatestNaverStockPoints(ticker, today);
        const evaluation = evaluateNaverPriceFallback(point, naverPoints);
        crossCheck = evaluation.status;
        if (evaluation.accepted && evaluation.point && (!point || evaluation.point.date > point.date)) {
          point = evaluation.point;
          source = "NAVER_FALLBACK";
          if (evaluation.jumpRatio >= PRICE_MOVE_WARNING_RATIO) {
            warnings.push("최근 가격 변동 폭이 커서 기업행사 여부를 확인해 주세요.");
          }
        } else if (evaluation.status === "mismatch") {
          stale = true;
          warnings.push("KRX와 네이버의 겹치는 날짜 가격이 달라 KRX 값을 유지했습니다.");
        } else if (evaluation.status === "matched") {
          stale = false;
        } else if (point?.date < expectedDate) {
          stale = true;
        }
      } catch (error) {
        stale = Boolean(point && point.date < expectedDate);
        warnings.push(`보조 가격 확인 실패: ${error?.message || error}`);
      }
    }
    if (!point && krxError) throw krxError;
    if (!point) stale = true;
    return jsonResponse({
      ok: true,
      ticker,
      source,
      latestDate: point?.date || "",
      marketDate: krxResult?.marketDate || "",
      expectedDate,
      cached: Boolean(krxResult?.cached),
      stale,
      crossCheck,
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
      records: point ? [point] : [],
    }, 200, origin);
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || "KRX 가격 조회에 실패했습니다." }, 503, origin);
  }
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
          "User-Agent": "ThinkStock/1.28 (+https://eg-tools.github.io/ThinkStock/)",
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

function dartNumber(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!normalized || normalized === "-") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function dartReceiptDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isValidIsoDate(date) ? date : "";
}

function decodeDartText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function majorHolderRecordKey(record) {
  return [
    record.receiptNo,
    record.date,
    record.reporter,
    record.transactionMethod,
    record.securityType,
    record.sharesBefore,
    record.sharesChanged,
    record.sharesOwned,
  ].map((value) => String(value ?? "")).join("|");
}

export function parseMajorHolderDocument(ticker, xmlText, report = {}) {
  const xml = String(xmlText || "");
  if (!xml || xml.length > MAX_DART_DOCUMENT_XML_BYTES) return [];
  const receiptNo = String(report?.rcept_no || report?.receiptNo || "").replace(/\D/g, "").slice(0, 14);
  const reportOwnershipRate = dartNumber(report?.stkrt ?? report?.ownershipRate);
  const reportReporter = String(report?.repror || report?.reporter || "").trim().slice(0, 80);
  const records = [];
  const rowPattern = /<TR\b[^>]*>([\s\S]*?)<\/TR>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const cells = new Map();
    const cellPattern = /<(TU|TE)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const codeMatch = cellMatch[2].match(/\b(?:ACODE|AUNIT)\s*=\s*"([^"]+)"/i);
      const code = String(codeMatch?.[1] || "").trim().toUpperCase();
      if (code) cells.set(code, decodeDartText(cellMatch[3]));
    }

    const date = dartReceiptDate(cells.get("MDF_DT"));
    const transactionMethod = String(cells.get("HLD_MTH") || "").trim();
    const sharesChanged = dartNumber(cells.get("MDF_SDK_CNT"));
    const sharesBefore = dartNumber(cells.get("BFR_MDF_CNT"));
    const sharesOwned = dartNumber(cells.get("AFR_MDF_CNT"));
    if (!date || !sharesChanged || !transactionMethod || transactionMethod === "-") continue;

    const reporter = String(cells.get("SPC_NM") || reportReporter).trim().slice(0, 80);
    const record = {
      ticker,
      date,
      side: sharesChanged > 0 ? "buy" : "sell",
      reporter,
      role: "주요주주 · 대량보유",
      sharesBefore,
      sharesChanged,
      sharesOwned,
      ownershipRate: reportOwnershipRate,
      ownershipRateChanged: null,
      transactionMethod: transactionMethod.slice(0, 80),
      securityType: String(cells.get("STK_KND") || "").trim().slice(0, 80),
      unitPrice: dartNumber(cells.get("HLD_UNT_PRJ")),
      receiptNo,
      recordType: "major-holder-detail",
      url: receiptNo
        ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
        : "",
      source: "OpenDART",
    };
    record.recordId = majorHolderRecordKey(record);
    records.push(record);
  }
  return records;
}

export function insiderRecordFromItem(ticker, item) {
  const date = dartReceiptDate(item?.rcept_dt);
  const sharesChanged = dartNumber(item?.sp_stock_lmp_irds_cnt);
  if (!date || !sharesChanged) return null;
  const receiptNo = String(item?.rcept_no || "").replace(/\D/g, "").slice(0, 14);
  const role = [
    item?.isu_exctv_rgist_at,
    item?.isu_exctv_ofcps,
    item?.isu_main_shrholdr,
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
  return {
    ticker,
    date,
    side: sharesChanged > 0 ? "buy" : "sell",
    reporter: String(item?.repror || "").trim().slice(0, 80),
    role: role.slice(0, 120),
    sharesOwned: dartNumber(item?.sp_stock_lmp_cnt),
    sharesChanged,
    ownershipRate: dartNumber(item?.sp_stock_lmp_rate),
    ownershipRateChanged: dartNumber(item?.sp_stock_lmp_irds_rate),
    receiptNo,
    recordType: "executive-ownership",
    url: receiptNo
      ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
      : "",
    source: "OpenDART",
  };
}

export function mergeInsiderRecords(existing, incoming) {
  const records = new Map();
  [...(existing || []), ...(incoming || [])].forEach((record) => {
    if (!record?.ticker || !record?.date || !["buy", "sell"].includes(record?.side)) return;
    const key = String(record.recordId || (record.recordType === "major-holder-detail"
      ? majorHolderRecordKey(record)
      : record.receiptNo) || [
      record.ticker,
      record.date,
      record.reporter,
      record.sharesChanged,
    ].join("|"));
    records.set(key, record);
  });
  return [...records.values()].sort((left, right) => (
    String(left.date).localeCompare(String(right.date))
    || String(left.reporter).localeCompare(String(right.reporter))
  ));
}

async function fetchDartExecutiveTrades(env, ticker, corpCode, today) {
  const url = `${DART_ELESTOCK_URL}?${new URLSearchParams({
    crtfc_key: env.DART_API_KEY,
    corp_code: corpCode,
  })}`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(25000),
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "User-Agent": "ThinkStock/1.35 (+https://eg-tools.github.io/ThinkStock/)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const error = new Error(`DART ownership redirect ${response.status}`);
        error.retryable = false;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`DART ownership HTTP ${response.status}`);
        error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      const payload = await response.json();
      const status = String(payload?.status || "");
      if (status === "013") return [];
      if (status && status !== "000") {
        const error = new Error(String(payload?.message || `DART ownership status ${status}`));
        error.status = status === "020" ? 429 : 502;
        error.retryable = status !== "100";
        throw error;
      }
      const cutoff = yearsBefore(today, LOOKBACK_YEARS);
      return mergeInsiderRecords([], (payload?.list || [])
        .map((item) => insiderRecordFromItem(ticker, item))
        .filter((record) => record && record.date >= cutoff));
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw new Error(lastError?.message || "DART ownership request failed");
}

async function fetchDartMajorHolderReports(env, corpCode, today) {
  const url = `${DART_MAJORSTOCK_URL}?${new URLSearchParams({
    crtfc_key: env.DART_API_KEY,
    corp_code: corpCode,
  })}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "User-Agent": "ThinkStock/1.35 (+https://eg-tools.github.io/ThinkStock/)",
    },
  });
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new Error(`DART major ownership HTTP ${response.status}`);
  }
  const payload = await response.json();
  const status = String(payload?.status || "");
  if (status === "013") return [];
  if (status && status !== "000") {
    const error = new Error(String(payload?.message || `DART major ownership status ${status}`));
    error.status = status === "020" ? 429 : 502;
    throw error;
  }
  const cutoff = yearsBefore(today, LOOKBACK_YEARS);
  return (Array.isArray(payload?.list) ? payload.list : [])
    .filter((item) => dartReceiptDate(item?.rcept_dt) >= cutoff)
    .filter((item) => /^\d{14}$/.test(String(item?.rcept_no || "")))
    .sort((left, right) => String(right.rcept_dt).localeCompare(String(left.rcept_dt)))
    .slice(0, MAX_MAJOR_HOLDER_DOCUMENTS);
}

async function fetchDartDocumentXml(env, receiptNo) {
  const url = `${DART_DOCUMENT_URL}?${new URLSearchParams({
    crtfc_key: env.DART_API_KEY,
    rcept_no: receiptNo,
  })}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    redirect: "follow",
    headers: {
      Accept: "application/zip, application/octet-stream",
      "User-Agent": "ThinkStock/1.35 (+https://eg-tools.github.io/ThinkStock/)",
    },
  });
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new Error(`DART document HTTP ${response.status}`);
  }
  const announcedSize = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_DART_DOCUMENT_ARCHIVE_BYTES) {
    throw new Error("DART document archive is too large");
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  if (!archive.length || archive.length > MAX_DART_DOCUMENT_ARCHIVE_BYTES) {
    throw new Error("DART document archive is empty or too large");
  }
  const entries = unzipSync(archive);
  const xmlEntries = Object.entries(entries)
    .filter(([name]) => /\.xml$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right));
  let totalBytes = 0;
  const documents = [];
  for (const [, bytes] of xmlEntries) {
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_DART_DOCUMENT_XML_BYTES) throw new Error("DART document XML is too large");
    documents.push(strFromU8(bytes));
  }
  if (!documents.length) throw new Error("DART document XML was not found");
  return documents.join("\n");
}

async function fetchDartMajorHolderTrades(env, ticker, corpCode, today) {
  const reports = await fetchDartMajorHolderReports(env, corpCode, today);
  const records = [];
  const failures = [];
  let completedDocuments = 0;
  for (let offset = 0; offset < reports.length; offset += MAJOR_HOLDER_DOCUMENT_CONCURRENCY) {
    const batch = reports.slice(offset, offset + MAJOR_HOLDER_DOCUMENT_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async (report) => {
      const xml = await fetchDartDocumentXml(env, String(report.rcept_no));
      return parseMajorHolderDocument(ticker, xml, report);
    }));
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        completedDocuments += 1;
        records.push(...result.value);
      } else {
        failures.push(result.reason);
      }
    });
  }
  if (reports.length && completedDocuments === 0) {
    const error = failures[0];
    throw new Error(`DART major-holder documents failed: ${error?.message || error || "unknown error"}`);
  }
  const cutoff = yearsBefore(today, LOOKBACK_YEARS);
  return mergeInsiderRecords([], records.filter((record) => record.date >= cutoff));
}

async function fetchDartInsiderTrades(env, ticker, corpCode, today) {
  const sourceNames = ["executive", "major-holder"];
  const results = await Promise.allSettled([
    fetchDartExecutiveTrades(env, ticker, corpCode, today),
    fetchDartMajorHolderTrades(env, ticker, corpCode, today),
  ]);
  const records = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
  if (!records.length && results.every((result) => result.status === "rejected")) {
    throw results[0].reason;
  }
  const warnings = results.flatMap((result, index) => (
    result.status === "rejected"
      ? [`${sourceNames[index]}: ${result.reason?.message || result.reason || "unknown error"}`]
      : []
  ));
  return { records: mergeInsiderRecords([], records), warnings };
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

async function readInsiderCache(env, ticker) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const value = await env.DISCLOSURE_CACHE.get(`insider:${ticker}`, "json");
    return value?.schema === INSIDER_CACHE_SCHEMA && value?.ticker === ticker ? value : null;
  } catch (_) {
    return null;
  }
}

async function writeInsiderCache(env, ticker, corpCode, records) {
  if (!env.DISCLOSURE_CACHE) return;
  await env.DISCLOSURE_CACHE.put(`insider:${ticker}`, JSON.stringify({
    schema: INSIDER_CACHE_SCHEMA,
    ticker,
    corpCode,
    savedAt: Date.now(),
    latestDate: records.at(-1)?.date || "",
    records,
  }));
}

async function insiderTradeResponse(env, ctx, ticker, corpCode, origin, force = false) {
  const cached = await readInsiderCache(env, ticker);
  if (!force && cached && Date.now() - Number(cached.savedAt || 0) <= INSIDER_CACHE_FRESH_MS) {
    return jsonResponse({
      ok: true,
      ticker,
      cached: true,
      checkedFrom: yearsBefore(koreanDateText(), LOOKBACK_YEARS),
      latestDate: cached.latestDate || "",
      records: cached.records || [],
    }, 200, origin);
  }
  try {
    const today = koreanDateText();
    const { records, warnings } = await fetchDartInsiderTrades(env, ticker, corpCode, today);
    const cacheWrite = writeInsiderCache(env, ticker, corpCode, records);
    if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
    else await cacheWrite;
    return jsonResponse({
      ok: true,
      ticker,
      cached: false,
      checkedFrom: yearsBefore(today, LOOKBACK_YEARS),
      latestDate: records.at(-1)?.date || "",
      records,
      ...(warnings.length ? { warnings } : {}),
    }, 200, origin);
  } catch (error) {
    if (cached) {
      return jsonResponse({
        ok: true,
        ticker,
        cached: true,
        stale: true,
        warning: "DART 연결 실패로 마지막 내부거래 데이터를 사용했습니다.",
        latestDate: cached.latestDate || "",
        records: cached.records || [],
      }, 200, origin);
    }
    return jsonResponse({
      ok: false,
      error: `DART 내부거래 조회 실패: ${error?.message || error}`,
    }, error?.status || 503, origin);
  }
}

function journalValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeForecastNumericMap(value, { maxEntries = 128, maxAbs = 1e12, allowedKeys = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, rawValue]) => {
    if (!FORECAST_AUDIT_KEY_PATTERN.test(key) || (allowedKeys && !allowedKeys.has(key))) return [];
    const number = finiteNumber(rawValue, { min: -maxAbs, max: maxAbs });
    return number === null ? [] : [[key, number]];
  }).slice(0, maxEntries));
}

function normalizeForecastAudit(value) {
  if (!value || value.format !== "ai-audit-v1") return null;
  const features = normalizeForecastNumericMap(value.features);
  const sources = normalizeForecastNumericMap(value.sources, { maxEntries: 24, maxAbs: 1e9 });
  const scenarioWeights = normalizeForecastNumericMap(value.scenarioWeights, { maxEntries: 3, maxAbs: 100 });
  return Object.keys(features).length
    ? { format: "ai-audit-v1", features, sources, scenarioWeights }
    : null;
}

function normalizeForecastAttribution(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const days = finiteNumber(value.days ?? key, { min: 1, max: 3650 });
  const expectedLogReturn = finiteNumber(value.expectedLogReturn, { min: -10, max: 10 });
  const components = normalizeForecastNumericMap(value.components, {
    maxEntries: FORECAST_ATTRIBUTION_COMPONENTS.size,
    maxAbs: 10,
    allowedKeys: FORECAST_ATTRIBUTION_COMPONENTS,
  });
  if (days !== Number(key) || expectedLogReturn === null || !Object.keys(components).length) return null;
  return { days, expectedLogReturn, components };
}

function normalizeForecastHorizon(value, key, { strict = false, basePrice = null } = {}) {
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
  const attribution = normalizeForecastAttribution(value.attribution, key);
  const result = {
    targetDate,
    predictedPrice,
    lowerPrice,
    upperPrice,
    ...(attribution ? { attribution } : {}),
  };
  const nestedScore = value.score && typeof value.score === "object" ? value.score : null;
  const evaluation = nestedScore ? {
    actualDate: nestedScore.actualDate,
    actualPrice: nestedScore.actualPrice,
    actualLogReturn: nestedScore.actualLogReturn,
    predictedLogReturn: nestedScore.predictedLogReturn,
    absoluteLogError: nestedScore.absLogError ?? nestedScore.absoluteLogError,
    signedLogError: nestedScore.signedLogError,
    squaredLogError: nestedScore.squaredLogError,
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
  const normalizedBasePrice = finiteNumber(basePrice, { min: Number.MIN_VALUE, max: 1e15 });
  const actualLogReturn = finiteNumber(
    evaluation.actualLogReturn ?? (
      actualPrice && normalizedBasePrice ? Math.log(actualPrice / normalizedBasePrice) : null
    ),
    { min: -100, max: 100 },
  );
  const predictedLogReturn = finiteNumber(
    evaluation.predictedLogReturn ?? (
      normalizedBasePrice ? Math.log(predictedPrice / normalizedBasePrice) : null
    ),
    { min: -100, max: 100 },
  );
  const signedLogError = finiteNumber(
    evaluation.signedLogError ?? (
      actualLogReturn !== null && predictedLogReturn !== null
        ? actualLogReturn - predictedLogReturn
        : null
    ),
    { min: -100, max: 100 },
  );
  const absoluteLogError = finiteNumber(
    evaluation.absoluteLogError ?? (signedLogError === null ? null : Math.abs(signedLogError)),
    { min: 0, max: 100 },
  );
  const squaredLogError = finiteNumber(
    evaluation.squaredLogError ?? (signedLogError === null ? null : signedLogError ** 2),
    { min: 0, max: 10000 },
  );
  const scoredAt = timestamp(evaluation.scoredAt);
  const validEvaluation = isValidIsoDate(actualDate)
    && actualPrice
    && actualLogReturn !== null
    && predictedLogReturn !== null
    && signedLogError !== null
    && absoluteLogError !== null
    && squaredLogError !== null
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
    actualLogReturn,
    predictedLogReturn,
    signedLogError,
    absoluteLogError,
    squaredLogError,
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
    const normalized = normalizeForecastHorizon(horizon, key, { strict, basePrice });
    if (normalized?.targetDate < asOf) {
      if (strict) throw journalValidationError(`Forecast target precedes its base date: ${key}`);
      continue;
    }
    if (normalized) horizons[key] = normalized;
  }
  if (!Object.keys(horizons).length) return fail("At least one forecast horizon is required");
  const audit = normalizeForecastAudit(value.audit);
  return {
    id,
    ticker,
    asOf,
    basePrice,
    modelVersion,
    createdAt,
    updatedAt,
    horizons,
    ...(audit ? { audit } : {}),
  };
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
      if (incomingScoreTime > previousScoreTime) {
        horizons[key] = {
          ...horizon,
          attribution: horizon.attribution || previousHorizon.attribution,
        };
      } else if (!previousHorizon.attribution && horizon.attribution) {
        horizons[key] = { ...previousHorizon, attribution: horizon.attribution };
      }
    });
    return {
      ...previous,
      updatedAt: Math.max(previous.updatedAt, record.updatedAt),
      horizons,
      audit: previous.audit || record.audit,
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
  const route = matchRequestRoute(url.pathname, request.method);
  if (!route) return jsonResponse({ ok: false, error: "Not found" }, 404, origin);
  if (route.id === "health") {
    return jsonResponse({
      ok: true,
      dartConfigured: Boolean(env.DART_API_KEY),
      krxConfigured: Boolean(env.KRX_API_KEY),
      ecosConfigured: Boolean(env.ECOS_API_KEY),
      fredConfigured: Boolean(env.FRED_API_KEY),
      accessTokenConfigured: Boolean(env.THINKSTOCK_ACCESS_TOKEN),
      cacheConfigured: Boolean(env.DISCLOSURE_CACHE),
    }, 200, origin);
  }
  if (!env.THINKSTOCK_ACCESS_TOKEN
    || !await tokensMatch(bearerToken(request), env.THINKSTOCK_ACCESS_TOKEN)) {
    return jsonResponse({ ok: false, error: "개인 접속 코드가 올바르지 않습니다." }, 401, origin);
  }
  if (route.id === "auth-check") return jsonResponse({ ok: true }, 200, origin);
  if (route.id === "macro") {
    const refresh = queryFlag(url.searchParams.get("refresh"));
    return ecosMacroResponse(env, origin, refresh);
  }
  if (route.id === "credit") {
    const refresh = queryFlag(url.searchParams.get("refresh"));
    return creditMacroResponse(env, origin, refresh);
  }
  if (route.id === "crisis-signal") {
    const refresh = queryFlag(url.searchParams.get("refresh"));
    return crisisSignalResponse(env, origin, refresh);
  }
  if (route.id === "indices") return krxCoreIndexResponse(env, origin);
  const ticker = String(url.searchParams.get("ticker") || "").trim().toUpperCase();
  if (route.ticker && !TICKER_PATTERN.test(ticker)) {
    return jsonResponse({ ok: false, error: "종목코드 형식이 올바르지 않습니다." }, 400, origin);
  }
  if (route.id === "prices") return krxPriceResponse(env, ticker, origin);
  if (route.id === "forecast-journal") return forecastJournalResponse(request, env, ticker, origin);
  if (["consensus", "analysis"].includes(route.id)) {
    return analysisResponse(env, ctx, ticker, origin, { requireFinancials: route.id === "analysis" });
  }
  if (!env.DART_API_KEY) return jsonResponse({ ok: false, error: "Cloudflare에 DART 키가 설정되지 않았습니다." }, 503, origin);

  const corpCode = String(url.searchParams.get("corpCode") || "").trim();
  if (route.corpCode && !CORP_CODE_PATTERN.test(corpCode)) {
    return jsonResponse({ ok: false, error: "종목 또는 DART 회사코드 형식이 올바르지 않습니다." }, 400, origin);
  }

  const force = queryFlag(url.searchParams.get("force"));
  if (route.id === "insider-trades") return insiderTradeResponse(env, ctx, ticker, corpCode, origin, force);
  const progressive = queryFlag(url.searchParams.get("progressive"));
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

  const today = koreanDateText();
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
