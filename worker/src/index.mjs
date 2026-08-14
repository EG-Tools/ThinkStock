import { strFromU8, unzipSync } from "fflate";

import {
  expectedLatestKoreanTradingDate,
  isKoreanCurrentPriceWindow,
  koreanDateText,
} from "../../shared/market-calendar.mjs";
import {
  RUNTIME_API_VERSION,
  RUNTIME_API_VERSION_HEADER,
  runtimeJsonHeaders,
} from "../../shared/runtime-api-contract.mjs";
import {
  cacheTtlSeconds,
  executeRuntimeSourcePlan,
  sourcePolicy,
} from "../../shared/runtime-freshness-policy.mjs";
import { mergeIndexRecords } from "../../shared/runtime-data-contract.mjs";
import {
  evaluateNaverPriceFallback,
  parseNaverPriceSeries,
  parseNaverPriceText,
  priceRatio,
  validateNaverPriceTail,
} from "../../shared/naver-market-price.mjs";
import { mergeAdrRows, parseAdrChartRows } from "../../shared/adr-data.mjs";
import {
  fetchKrxVkospiPoint,
  fetchStockplusVkospiRows,
  mergeVkospiFallbackRows,
  mergeVkospiRows,
  planVkospiSource,
  shouldRememberEmptyVkospiDate,
  vkospiBackfillDates,
} from "../../shared/krx-volatility-index.mjs";
import { parseNaverResearchProfile } from "../../shared/research-profile.mjs";
import {
  fetchNaverLiveResearchUniverse,
  normalizeResearchUniverseSize,
  researchUniversePerMarketLimit,
} from "../../shared/research-universe-live.mjs";
import {
  RESEARCH_SUMMARY_BODY_LIMIT,
  normalizeResearchMinimum,
  normalizeResearchStrategy,
  normalizeResearchSummary,
  researchSummaryCacheKey,
} from "../../shared/stock-research-summary.mjs";
import {
  mergeDartDisclosureRecords,
  recordFromDartItem,
} from "../../shared/dart-disclosure.mjs";

import {
  ANALYSIS_CACHE_SCHEMA,
  fetchCompanyAnalysis,
  mergeFinancialRecords,
  mergeAnalysisSnapshots,
  normalizeAnalysisCache,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
  parseNaverNewsHtml,
  sanitizeAnalysisNews,
  snapshotFromAnalysis,
} from "./company-analysis.mjs";

import { matchRequestRoute, queryFlag } from "./request-router.mjs";
import { adminSessionResponse } from "./admin-session-handler.mjs";
import {
  FORECAST_JOURNAL_INPUT_LIMIT,
  mergeForecastJournalRecords,
} from "./forecast-journal.mjs";
import {
  buildCrisisSignalRows,
  fetchCrisisSignalSeries,
  normalizeFredObservations,
} from "./crisis-signal.mjs";
import {
  createKofiaClient,
  creditRefreshWindowDate,
  fetchKofiaCreditAndDepositRows,
  mergeCreditRows,
  parseFreesisPayload,
} from "./kofia-client.mjs";
import {
  KRX_MARKET_CACHE_SCHEMA,
  krxIndexPointFromRows,
  krxMarketSnapshotFromRows,
  krxStockPointFromRows,
} from "./market-data.mjs";
import {
  detectResearchHistoryRebase,
  normalizeResearchUniverseRows,
  parseNaverResearchHistory,
  projectResearchHistoryPayload,
} from "./research-data.mjs";

export {
  evaluateNaverPriceFallback,
  mergeFinancialRecords,
  parseNaverPriceSeries,
  parseNaverPriceText,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
  parseNaverNewsHtml,
  priceRatio,
};
export { mergeAnalysisSnapshots };
export { creditRefreshWindowDate, parseFreesisPayload };
export { mergeForecastJournalRecords };
export {
  detectResearchHistoryRebase,
  krxIndexPointFromRows,
  krxMarketSnapshotFromRows,
  krxStockPointFromRows,
  parseNaverResearchHistory,
  projectResearchHistoryPayload,
};

const kofiaClient = createKofiaClient();

const DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json";
const DART_ELESTOCK_URL = "https://opendart.fss.or.kr/api/elestock.json";
const DART_MAJORSTOCK_URL = "https://opendart.fss.or.kr/api/majorstock.json";
const DART_DOCUMENT_URL = "https://opendart.fss.or.kr/api/document.xml";
const KRX_STOCK_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis/sto";
const KRX_INDEX_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis/idx";
const NAVER_STOCK_PRICE_URL = "https://api.finance.naver.com/siseJson.naver";
const NAVER_STOCK_HISTORY_URL = "https://fchart.stock.naver.com/sise.nhn";
const NAVER_STOCK_PROFILE_URL = "https://finance.naver.com/item/main.naver";
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
const FORECAST_JOURNAL_SCHEMA = 1;
// A full 60-record audit journal is roughly 375 KB; keep room for JSON overhead
// while still rejecting unexpectedly large authenticated writes.
const FORECAST_JOURNAL_BODY_LIMIT = 512 * 1024;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const PROGRESSIVE_PAGE_BATCH_SIZE = 4;
const OVERLAP_DAYS = 7;
const LOOKBACK_YEARS = 3;
const KRX_LATEST_LOOKBACK_DAYS = 10;
const KRX_INDEX_CACHE_SCHEMA = 4;
const NAVER_PRICE_LOOKBACK_DAYS = 21;
const MAX_NAVER_PRICE_BYTES = 1024 * 1024;
const PRICE_MOVE_WARNING_RATIO = 1.35;
const RESEARCH_CACHE_SCHEMA = 1;
const RESEARCH_HISTORY_YEARS = 5;
const RESEARCH_HISTORY_OVERLAP_DAYS = 21;
const RESEARCH_CACHE_TTL_SECONDS = 45 * 24 * 60 * 60;
const RESEARCH_PROFILE_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const RESEARCH_SUMMARY_TTL_SECONDS = 180 * 24 * 60 * 60;
const MAX_NAVER_PROFILE_BYTES = 512 * 1024;
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
const CREDIT_CACHE_SCHEMA = 5;
const CREDIT_CACHE_KEY = `credit-macro:${CREDIT_CACHE_SCHEMA}`;
const ADR_CACHE_SCHEMA = 1;
const ADR_CACHE_KEY = `adr-market:${ADR_CACHE_SCHEMA}:latest`;
const ADR_CACHE_FRESH_MS = sourcePolicy("adr").liveConfirmMs;
const ADR_CACHE_ROW_LIMIT = 900;
const ADR_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const CRISIS_CACHE_SCHEMA = 8;
const CRISIS_CACHE_KEY = `fred-crisis-signal:${CRISIS_CACHE_SCHEMA}`;
const VKOSPI_LIVE_FRESH_MS = sourcePolicy("indices").liveConfirmMs;
const VKOSPI_SETTLEMENT_RECHECK_MS = 15 * 60 * 1000;
const ADR_SOURCE_URL = "https://www.adrinfo.kr/chart";
const ADR_LEGACY_SOURCE_URL = "http://www.adrinfo.kr/chart";
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
      "Access-Control-Expose-Headers": RUNTIME_API_VERSION_HEADER,
      Vary: "Origin",
    }
    : {};
}

function jsonResponse(payload, status = 200, origin = "") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      ...runtimeJsonHeaders(),
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

async function writeCachesBestEffort(label, operations) {
  const tasks = (Array.isArray(operations) ? operations : [])
    .filter((operation) => typeof operation === "function")
    .map((operation) => Promise.resolve().then(operation));
  if (!tasks.length) return 0;
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    console.warn(JSON.stringify({
      event: "cache-write-failed",
      label,
      failures: failures.length,
      error: String(failures[0].reason?.message || failures[0].reason || "unknown").slice(0, 160),
    }));
  }
  return failures.length;
}

async function readCacheBestEffort(label, operation) {
  if (typeof operation !== "function") return null;
  try {
    return await operation();
  } catch (error) {
    console.warn(JSON.stringify({
      event: "cache-read-failed",
      label,
      error: String(error?.message || error || "unknown").slice(0, 160),
    }));
    return null;
  }
}

async function readBoundedResponseText(response, maxBytes) {
  const declaredLength = Number(response.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("ADR upstream response is too large");
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("ADR upstream response is too large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel("ADR upstream response is too large");
      throw new Error("ADR upstream response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function adrSourceCandidates() {
  const stamp = Date.now();
  const httpsUrl = `${ADR_SOURCE_URL}?_=${stamp}`;
  const legacyUrl = `${ADR_LEGACY_SOURCE_URL}?_=${stamp}`;
  return [
    { source: "adrinfo-https", url: httpsUrl },
    { source: "adrinfo-http", url: legacyUrl },
    { source: "corsproxy", url: `https://corsproxy.io/?url=${encodeURIComponent(legacyUrl)}` },
  ];
}

export async function fetchAdrSourceRows(fetchImpl = fetch) {
  let lastError = null;
  for (const candidate of adrSourceCandidates()) {
    try {
      const response = await fetchImpl(candidate.url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = parseAdrChartRows(await readBoundedResponseText(response, ADR_RESPONSE_MAX_BYTES));
      if (!rows.length) throw new Error("ADR response contained no rows");
      return { rows, source: candidate.source };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`ADR upstream failed: ${lastError?.message || lastError || "unknown error"}`);
}

function normalizeAdrCache(value) {
  if (!value || value.schema !== ADR_CACHE_SCHEMA) return null;
  const rows = mergeAdrRows([], value.rows, ADR_CACHE_ROW_LIMIT);
  if (!rows.length) return null;
  const latestDate = rows.at(-1)?.date || "";
  const expectedDate = expectedLatestKoreanTradingDate();
  return {
    schema: ADR_CACHE_SCHEMA,
    savedAt: Number(value.savedAt) || 0,
    checkedAt: Number(value.checkedAt) || Number(value.savedAt) || 0,
    latestDate,
    expectedDate,
    delayed: Boolean(latestDate && latestDate < expectedDate),
    source: String(value.source || "cache"),
    rows,
  };
}

async function adrMarketResponse(env, origin, forceRefresh = false) {
  const cached = env.DISCLOSURE_CACHE
    ? normalizeAdrCache(await readCacheBestEffort(
      "adr",
      () => env.DISCLOSURE_CACHE.get(ADR_CACHE_KEY, "json"),
    ))
    : null;
  if (!forceRefresh && cached && Date.now() - cached.savedAt <= ADR_CACHE_FRESH_MS) {
    return jsonResponse({ ...cached, ok: true, cached: true, stale: false }, 200, origin);
  }

  try {
    const incoming = await fetchAdrSourceRows();
    const rows = mergeAdrRows(cached?.rows, incoming.rows, ADR_CACHE_ROW_LIMIT);
    const latestDate = rows.at(-1)?.date || "";
    const expectedDate = expectedLatestKoreanTradingDate();
    const payload = {
      schema: ADR_CACHE_SCHEMA,
      savedAt: Date.now(),
      checkedAt: Date.now(),
      latestDate,
      expectedDate,
      delayed: Boolean(latestDate && latestDate < expectedDate),
      source: incoming.source,
      rows,
    };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("adr", [
        () => env.DISCLOSURE_CACHE.put(ADR_CACHE_KEY, JSON.stringify(payload)),
      ]);
    }
    return jsonResponse({ ok: true, cached: false, stale: false, ...payload }, 200, origin);
  } catch (error) {
    if (cached) {
      return jsonResponse({
        ...cached,
        ok: true,
        cached: true,
        stale: true,
        warning: combineWarnings(cached.warning, "ADR 연결 실패로 마지막 검증 데이터를 사용합니다."),
      }, 200, origin);
    }
    return jsonResponse({ ok: false, error: error?.message || "ADR 조회 실패" }, 503, origin);
  }
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
  const cached = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("ecos-macro", () => env.DISCLOSURE_CACHE.get(ECOS_CACHE_KEY, "json"))
    : null;
  const checkDate = koreanDateText();
  const needsRefresh = refresh
    || cached?.schema !== ECOS_CACHE_SCHEMA
    || cached?.lastCheckedDate !== checkDate;
  if (!needsRefresh) return jsonResponse({ ...cached, ok: true, cached: true }, 200, origin);
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
    const labels = ["선행순환변동", "뉴스심리", "기준금리", "수출", "수입"];
    const values = requests.map((result) => (
      result.status === "fulfilled" && Array.isArray(result.value) && result.value.length
        ? result.value
        : []
    ));
    const failedLabels = requests.flatMap((result, index) => (
      values[index].length
        ? []
        : [`${labels[index]}: ${result.status === "rejected"
          ? (result.reason?.message || result.reason)
          : "빈 응답"}`]
    ));
    if (!values.some((rows) => rows.length)) {
      const reason = requests.find((item) => item.status === "rejected")?.reason;
      throw reason || new Error("ECOS returned no usable macro series");
    }
    const [leading, news, policyRate, exports, imports] = values;
    const payload = {
      schema: ECOS_CACHE_SCHEMA,
      savedAt: Date.now(),
      lastCheckedDate: failedLabels.length ? (cached?.lastCheckedDate || "") : checkDate,
      leadingRows: mergeEcosRows(cached?.leadingRows, leading, "leading_cycle").slice(-36),
      newsRows: mergeEcosRows(cached?.newsRows, news, "news_sentiment").slice(-180),
      policyRateRows: mergeEcosRows(cached?.policyRateRows, policyRate, "policy_rate").slice(-360),
      tradeRows: mergeEcosFieldRows(cached?.tradeRows, exports, imports).slice(-360),
      partial: failedLabels.length > 0,
      warning: failedLabels.length
        ? `ECOS 일부 지표는 마지막 정상값을 사용합니다: ${failedLabels.join(" / ")}`
        : "",
    };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("ecos-macro", [
        () => env.DISCLOSURE_CACHE.put(ECOS_CACHE_KEY, JSON.stringify(payload)),
      ]);
    }
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    if (cached?.schema === ECOS_CACHE_SCHEMA) return jsonResponse({
      ...cached,
      ok: true,
      cached: true,
      stale: true,
      warning: combineWarnings(cached.warning, "ECOS 연결 실패로 마지막 저장 지표를 사용했습니다."),
    }, 200, origin);
    return jsonResponse({ ok: false, error: `ECOS 조회 실패: ${error?.message || error}` }, 503, origin);
  }
}

function combineWarnings(...warnings) {
  return [...new Set(warnings.map((value) => String(value || "").trim()).filter(Boolean))].join(" / ");
}

async function fetchLiveVkospiRows(rows, now = new Date()) {
  const recentRows = await fetchStockplusVkospiRows(fetch, {
    expectedDate: koreanDateText(now),
    limit: 10,
    signal: AbortSignal.timeout(10000),
  });
  const point = recentRows.at(-1);
  return {
    point,
    rows: mergeVkospiFallbackRows(rows, recentRows, { liveDate: point?.date }).slice(-6000),
  };
}

async function refreshOfficialVkospiRows(
  env,
  rows,
  officialLatestDate = "",
  now = new Date(),
  knownEmptyDates = [],
) {
  let mergedRows = mergeVkospiRows(rows).slice(-6000);
  let latestOfficialDate = String(officialLatestDate || "").slice(0, 10);
  const emptyDates = new Set((Array.isArray(knownEmptyDates) ? knownEmptyDates : [])
    .map((date) => String(date || "").slice(0, 10))
    .filter((date) => DATE_PATTERN.test(date)));
  let warning = "";
  const checkedAt = Date.now();
  if (!env.KRX_API_KEY) {
    return {
      checkedAt,
      emptyDates: [...emptyDates].sort().slice(-60),
      latestOfficialDate,
      rows: mergedRows,
      warning: "KRX API key is not configured; saved VKOSPI values are retained.",
    };
  }

  const targetDate = expectedLatestKoreanTradingDate(now, {
    closeHour: 16,
    closeMinute: 0,
  });
  const requestDates = vkospiBackfillDates(latestOfficialDate, targetDate, {
    initialLookbackDays: 14,
    maxDates: 10,
    rows: mergedRows,
    excludeDates: [...emptyDates],
  });
  const incoming = [];
  for (const date of requestDates) {
    try {
      const point = await fetchKrxVkospiPoint(fetch, String(env.KRX_API_KEY).trim(), date, {
        signal: AbortSignal.timeout(15000),
      });
      if (point) incoming.push(point);
      else if (shouldRememberEmptyVkospiDate(date, targetDate)) emptyDates.add(date);
    } catch (error) {
      warning = `KRX VKOSPI 갱신 지연: ${error?.message || error}`;
      if ([401, 403, 429].includes(Number(error?.status))) break;
    }
  }
  if (incoming.length) {
    mergedRows = mergeVkospiRows(mergedRows, incoming).slice(-6000);
    latestOfficialDate = [latestOfficialDate, incoming.at(-1)?.date || ""].sort().at(-1);
  }
  return {
    checkedAt,
    emptyDates: [...emptyDates].sort().slice(-60),
    latestOfficialDate,
    rows: mergedRows,
    warning,
  };
}

async function crisisSignalResponse(env, origin, refresh = false) {
  if (!env.FRED_API_KEY) {
    return jsonResponse({ ok: false, error: "FRED API key is not configured" }, 503, origin);
  }
  const cached = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("crisis-signal", () => env.DISCLOSURE_CACHE.get(CRISIS_CACHE_KEY, "json"))
    : null;
  const now = new Date();
  const checkDate = koreanDateText(now);
  const cachedSource = String(cached?.source || "");
  const cachedRows = mergeVkospiRows(cached?.vkospiRows).slice(-6000);
  const cachedOfficialLatestDate = String(
    cached?.vkospiOfficialLatestDate
      || (!cachedSource.includes("Stockplus") ? cachedRows.at(-1)?.date : "")
      || "",
  ).slice(0, 10);
  const sourcePlan = planVkospiSource(now, cachedOfficialLatestDate);
  const settlementRefreshDue = sourcePlan.settlementWindow
    && !sourcePlan.officialCurrent
    && (refresh
      || Date.now() - Number(cached?.vkospiOfficialCheckedAt || 0) >= VKOSPI_SETTLEMENT_RECHECK_MS);
  const needsCoreRefresh = refresh
    || cached?.schema !== CRISIS_CACHE_SCHEMA
    || cached?.lastCheckedDate !== checkDate;
  const stockplusFreshMs = sourcePlan.stockplusLiveWindow
    ? VKOSPI_LIVE_FRESH_MS
    : VKOSPI_SETTLEMENT_RECHECK_MS;
  const needsLiveRefresh = sourcePlan.useStockplus
    && (refresh
      || checkDate !== cached?.vkospiLiveDate
      || Date.now() - Number(
        cached?.vkospiLiveAttemptedAt || cached?.vkospiLiveCheckedAt || 0,
      ) >= stockplusFreshMs);
  if (!needsCoreRefresh && !settlementRefreshDue && !needsLiveRefresh) {
    return jsonResponse({ ...cached, ok: true, cached: true }, 200, origin);
  }

  if (!needsCoreRefresh) {
    const liveAttemptedAt = Date.now();
    let vkospiRows = cachedRows;
    let vkospiOfficialLatestDate = cachedOfficialLatestDate;
    let vkospiOfficialCheckedAt = Number(cached?.vkospiOfficialCheckedAt || 0);
    let vkospiOfficialEmptyDates = Array.isArray(cached?.vkospiOfficialEmptyDates)
      ? cached.vkospiOfficialEmptyDates
      : [];
    let vkospiWarning = String(cached?.vkospiCoreWarning || "");
    if (settlementRefreshDue) {
      const official = await refreshOfficialVkospiRows(
        env,
        vkospiRows,
        vkospiOfficialLatestDate,
        now,
        cached?.vkospiOfficialEmptyDates,
      );
      vkospiRows = official.rows;
      vkospiOfficialLatestDate = official.latestOfficialDate;
      vkospiOfficialCheckedAt = official.checkedAt;
      vkospiOfficialEmptyDates = official.emptyDates;
      vkospiWarning = official.warning;
    }
    const nextSourcePlan = planVkospiSource(now, vkospiOfficialLatestDate);
    let livePoint = null;
    let liveWarning = "";
    if (nextSourcePlan.useStockplus) {
      try {
        const live = await fetchLiveVkospiRows(vkospiRows, now);
        vkospiRows = live.rows;
        livePoint = live.point;
      } catch (error) {
        liveWarning = `증권플러스 VKOSPI 갱신 지연: ${error?.message || error}`;
      }
    }
    const retainedLive = !nextSourcePlan.officialCurrent
      && cached?.vkospiLive === true
      && cached?.vkospiLiveDate === checkDate;
    const hasCurrentLive = Boolean(livePoint || retainedLive);
    const payload = {
      ...cached,
      savedAt: Date.now(),
      latestDate: [cached?.records?.at(-1)?.date || "", vkospiRows.at(-1)?.date || ""].sort().at(-1),
      source: hasCurrentLive
        ? (nextSourcePlan.stockplusLiveWindow
          ? "FRED + KRX + Stockplus (intraday)"
          : "FRED + KRX + Stockplus (settlement fallback)")
        : "FRED + KRX",
      vkospiRows,
      vkospiCoreWarning: vkospiWarning,
      vkospiOfficialCheckedAt,
      vkospiOfficialEmptyDates,
      vkospiOfficialLatestDate,
      vkospiLiveAttemptedAt: nextSourcePlan.useStockplus
        ? liveAttemptedAt
        : cached?.vkospiLiveAttemptedAt || 0,
      vkospiLiveCheckedAt: livePoint
        ? liveAttemptedAt
        : cached?.vkospiLiveCheckedAt || 0,
      vkospiLiveDate: livePoint?.date
        || (retainedLive ? cached?.vkospiLiveDate : "")
        || "",
      vkospiLive: hasCurrentLive,
      warning: combineWarnings(vkospiWarning, liveWarning),
    };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("crisis-vkospi-live", [
        () => env.DISCLOSURE_CACHE.put(CRISIS_CACHE_KEY, JSON.stringify(payload)),
      ]);
    }
    return jsonResponse({ ok: true, cached: !livePoint, ...payload }, 200, origin);
  }

  try {
    const series = await fetchCrisisSignalSeries(fetch, String(env.FRED_API_KEY).trim(), {
      includeExternalRisk: true,
    });
    const records = buildCrisisSignalRows(series);
    if (!records.length) throw new Error("FRED crisis signal contains no usable records");
    const vixRows = normalizeFredObservations(series.VIXCLS)
      .map((row) => ({ date: row.date, vix: row.value }));
    let vkospiRows = cachedRows;
    let vkospiOfficialLatestDate = cachedOfficialLatestDate;
    const vkospiOfficialCheckedAt = Date.now();
    let vkospiWarning = "";
    if (env.KRX_API_KEY) {
      const targetDate = expectedLatestKoreanTradingDate(now, {
        closeHour: 16,
        closeMinute: 0,
      });
      const requestDates = vkospiBackfillDates(vkospiOfficialLatestDate, targetDate, {
        initialLookbackDays: 14,
        maxDates: 10,
        rows: vkospiRows,
        excludeDates: cached?.vkospiOfficialEmptyDates,
      });
      const incoming = [];
      for (const date of requestDates) {
        try {
          const point = await fetchKrxVkospiPoint(fetch, String(env.KRX_API_KEY).trim(), date, {
            signal: AbortSignal.timeout(15000),
          });
          if (point) incoming.push(point);
        } catch (error) {
          vkospiWarning = `KRX VKOSPI 갱신 지연: ${error?.message || error}`;
          if ([401, 403, 429].includes(Number(error?.status))) break;
        }
      }
      vkospiRows = mergeVkospiRows(vkospiRows, incoming).slice(-6000);
      if (incoming.length) {
        vkospiOfficialLatestDate = [vkospiOfficialLatestDate, incoming.at(-1)?.date || ""].sort().at(-1);
      }
    } else {
      vkospiWarning = "KRX API key is not configured; saved VKOSPI values are retained.";
    }
    let livePoint = null;
    let liveWarning = "";
    let vkospiLiveAttemptedAt = 0;
    let vkospiLiveCheckedAt = Number(cached?.vkospiLiveCheckedAt || 0);
    const nextSourcePlan = planVkospiSource(now, vkospiOfficialLatestDate);
    if (nextSourcePlan.useStockplus) {
      vkospiLiveAttemptedAt = Date.now();
      try {
        const live = await fetchLiveVkospiRows(vkospiRows, now);
        vkospiRows = live.rows;
        livePoint = live.point;
        vkospiLiveCheckedAt = vkospiLiveAttemptedAt;
      } catch (error) {
        liveWarning = `증권플러스 VKOSPI 장중 갱신 지연: ${error?.message || error}`;
      }
    }
    const retainedLive = !nextSourcePlan.officialCurrent
      && cached?.vkospiLive === true
      && cached?.vkospiLiveDate === checkDate;
    const hasCurrentLive = Boolean(livePoint || retainedLive);
    const payload = {
      schema: CRISIS_CACHE_SCHEMA,
      savedAt: Date.now(),
      lastCheckedDate: checkDate,
      latestDate: [
        records.at(-1)?.date || "",
        vkospiRows.at(-1)?.date || "",
        vixRows.at(-1)?.date || "",
      ].sort().at(-1),
      source: hasCurrentLive
        ? (nextSourcePlan.stockplusLiveWindow
          ? "FRED + KRX + Stockplus (intraday)"
          : "FRED + KRX + Stockplus (settlement fallback)")
        : "FRED + KRX",
      records,
      vkospiRows,
      vixRows,
      vkospiCoreWarning: vkospiWarning,
      vkospiOfficialCheckedAt,
      vkospiOfficialEmptyDates: cached?.vkospiOfficialEmptyDates || [],
      vkospiOfficialLatestDate,
      vkospiLiveAttemptedAt,
      vkospiLiveCheckedAt,
      vkospiLiveDate: livePoint?.date || (retainedLive ? cached?.vkospiLiveDate : "") || "",
      vkospiLive: hasCurrentLive,
      warning: combineWarnings(vkospiWarning, liveWarning),
    };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("crisis-signal", [
        () => env.DISCLOSURE_CACHE.put(CRISIS_CACHE_KEY, JSON.stringify(payload)),
      ]);
    }
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    if (cached?.schema === CRISIS_CACHE_SCHEMA) {
      return jsonResponse({
        ...cached,
        ok: true,
        cached: true,
        stale: true,
        warning: combineWarnings(cached.warning, "FRED refresh failed; using the last saved crisis signal."),
      }, 200, origin);
    }
    return jsonResponse({ ok: false, error: `FRED crisis signal failed: ${error?.message || error}` }, 503, origin);
  }
}

async function creditMacroResponse(env, origin, refresh = false) {
  const cached = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("credit", () => env.DISCLOSURE_CACHE.get(CREDIT_CACHE_KEY, "json"))
    : null;
  const windowDate = creditRefreshWindowDate();
  const needsRefresh = refresh
    || !cached || cached.schema !== CREDIT_CACHE_SCHEMA
    || Boolean(windowDate && cached.lastCheckedWindow !== windowDate);
  if (!needsRefresh) return jsonResponse({ ...cached, ok: true, cached: true }, 200, origin);
  try {
    const result = await fetchKofiaCreditAndDepositRows(kofiaClient, env.KOFIA_API_KEY);
    const rows = result.rows;
    const warnings = [];
    if (result.creditFailed) warnings.push("신용 잔고 연결 실패로 마지막 확인 데이터를 사용합니다.");
    if (result.depositFailed) warnings.push("고객예탁금 연결 실패로 마지막 확인 데이터를 사용합니다.");
    const payload = {
      schema: CREDIT_CACHE_SCHEMA,
      savedAt: Date.now(),
      rows: mergeCreditRows(cached?.rows, rows).slice(-210),
      lastCheckedWindow: windowDate || cached?.lastCheckedWindow || "",
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("credit", [
        () => env.DISCLOSURE_CACHE.put(CREDIT_CACHE_KEY, JSON.stringify(payload)),
      ]);
    }
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    if (cached?.schema === CREDIT_CACHE_SCHEMA) return jsonResponse({
      ...cached,
      ok: true,
      cached: true,
      stale: true,
      warning: combineWarnings(cached.warning, "신용 잔고 연결 실패로 마지막 확인 데이터를 사용합니다."),
    }, 200, origin);
    return jsonResponse({ ok: false, error: `신용 잔고 조회 실패: ${error?.message || error}` }, 503, origin);
  }
}

const krxMarketSnapshotRequests = new Map();
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

async function krxCoreIndexResponse(env, origin, refresh = false, since = "") {
  if (!env.KRX_API_KEY) {
    return jsonResponse({ ok: false, error: "Cloudflare\uC5D0 KRX \uD0A4\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." }, 503, origin);
  }
  const now = new Date();
  const today = koreanDateText(now);
  const expectedDate = expectedLatestKoreanTradingDate(now);
  const currentPriceWindow = isKoreanCurrentPriceWindow(now);
  const historySince = DATE_PATTERN.test(String(since || "")) ? String(since) : "";
  const cacheDate = currentPriceWindow ? today : expectedDate;
  const cacheMode = currentPriceWindow ? "live" : "settled";
  const cacheKey = `krx-core-indices:${KRX_INDEX_CACHE_SCHEMA}:${cacheMode}:${cacheDate}:${historySince || "latest"}`;
  const latestKey = `krx-core-indices:${KRX_INDEX_CACHE_SCHEMA}:latest`;
  const cached = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("krx-core-indices", () => env.DISCLOSURE_CACHE.get(cacheKey, "json"))
    : null;
  const staleRetryDue = cached?.stale === true
    && Date.now() - Number(cached?.savedAt || 0) >= sourcePolicy("indices").liveConfirmMs;
  if (!refresh && cached?.schema === KRX_INDEX_CACHE_SCHEMA
    && Array.isArray(cached.records) && cached.records.length
    && !staleRetryDue) {
    return jsonResponse({ ...cached, ok: true, cached: true }, 200, origin);
  }
  try {
    const targets = [
      { market: "KOSPI", ticker: "^KS11", endpoint: "kospi_dd_trd", naverSymbol: "KOSPI" },
      { market: "KOSDAQ", ticker: "^KQ11", endpoint: "kosdaq_dd_trd", naverSymbol: "KOSDAQ" },
    ];
    const settledResults = await Promise.allSettled(targets.map(async (target) => {
      let selected = null;
      let source = "KRX";
      let krxError = null;
      let history = [];
      let providerAudit = "not-needed";
      const warnings = [];
      try {
        selected = await fetchLatestKrxIndexPoint(env, target.market, target.endpoint, expectedDate);
      } catch (error) {
        krxError = error;
      }
      const shouldCheckNaver = currentPriceWindow
        || Boolean(historySince)
        || !selected
        || selected.date < expectedDate;
      if (shouldCheckNaver) {
        try {
          const historyStart = historySince && (!selected || historySince < selected.date)
            ? historySince
            : selected?.date || shiftDate(today, -NAVER_PRICE_LOOKBACK_DAYS);
          const naverPoints = await fetchLatestNaverSymbolPoints(target.naverSymbol, today, {
            startDate: shiftDate(historyStart, -7),
          });
          const tail = validateNaverPriceTail(selected, naverPoints, { since: historySince });
          const evaluation = evaluateNaverPriceFallback(selected, naverPoints, {
            allowSameDate: currentPriceWindow,
          });
          providerAudit = evaluation.status;
          if (historySince && tail.accepted) {
            history = tail.points.map((point) => ({
              ticker: target.ticker,
              ...point,
              source: "NAVER_HISTORY",
            }));
          }
          if (evaluation.accepted && evaluation.point && (
            !selected
            || evaluation.point.date > selected.date
            || (currentPriceWindow && evaluation.point.date === selected.date)
          )) {
            selected = evaluation.point;
            source = "NAVER_FALLBACK";
          } else if (evaluation.status === "mismatch") {
            warnings.push(`${target.market} KRX·네이버 겹치는 날짜 값 불일치`);
          }
        } catch (error) {
          warnings.push(`${target.market} 네이버 지수 확인 실패: ${error?.message || error}`);
        }
      }
      const freshnessDate = currentPriceWindow ? today : expectedDate;
      if (selected && selected.date < freshnessDate) {
        warnings.push(`${target.market} 최신 지수 지연(${selected.date}, 예상 ${freshnessDate})`);
      }
      if (!selected && krxError) throw krxError;
      if (!selected) return null;
      const latest = { ticker: target.ticker, ...selected, source };
      const byDate = new Map(history.map((point) => [point.date, point]));
      byDate.set(latest.date, latest);
      return {
        latest,
        records: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
        providerAudit,
        warnings,
      };
    }));
    const completeResults = settledResults.flatMap((result) => (
      result.status === "fulfilled" && result.value ? [result.value] : []
    ));
    if (!completeResults.length) {
      const failure = settledResults.find((result) => result.status === "rejected");
      throw failure?.reason || new Error("KRX core index response is empty");
    }
    const failedTickers = settledResults.flatMap((result, index) => (
      result.status === "rejected" || !result.value ? [targets[index].ticker] : []
    ));
    let fallback = cached?.schema === KRX_INDEX_CACHE_SCHEMA ? cached : null;
    if (failedTickers.length && env.DISCLOSURE_CACHE) {
      try {
        const latest = await env.DISCLOSURE_CACHE.get(latestKey, "json");
        if (latest?.schema === KRX_INDEX_CACHE_SCHEMA) fallback = latest;
      } catch (_) {
        // Fresh successful markets remain usable even when the fallback cache cannot be read.
      }
    }
    const currentRecords = completeResults.flatMap((result) => result.records);
    const fallbackRecords = (fallback?.records || [])
      .filter((record) => failedTickers.includes(record?.ticker));
    const records = mergeIndexRecords(fallbackRecords, currentRecords);
    const latestByTicker = new Map();
    records.forEach((record) => {
      const previous = latestByTicker.get(record.ticker);
      if (!previous || record.date > previous.date) latestByTicker.set(record.ticker, record);
    });
    const latestRecords = [...latestByTicker.values()];
    const missingTickers = targets
      .map((target) => target.ticker)
      .filter((ticker) => !latestByTicker.has(ticker));
    const warnings = [
      ...completeResults.flatMap((result) => result.warnings || []),
      ...settledResults.flatMap((result, index) => (
        result.status === "rejected"
          ? [`${targets[index].market} 지수 조회 실패: ${result.reason?.message || result.reason}`]
          : []
      )),
      ...(fallbackRecords.length ? ["일부 지수는 마지막 정상값을 사용합니다."] : []),
    ];
    const partial = failedTickers.length > 0 || missingTickers.length > 0;
    const payload = {
      schema: KRX_INDEX_CACHE_SCHEMA,
      source: fallbackRecords.length
        ? "MIXED"
        : (latestRecords.some((record) => record.source === "NAVER_FALLBACK") ? "NAVER_FALLBACK" : "KRX"),
      savedAt: Date.now(),
      expectedDate,
      historySince,
      latestDate: records.reduce((latest, row) => row.date > latest ? row.date : latest, ""),
      partial,
      missingTickers,
      providerAudit: Object.fromEntries(completeResults.map((result) => [
        result.latest.ticker,
        result.providerAudit,
      ])),
      stale: partial
        || latestRecords.some((record) => record.date < (currentPriceWindow ? today : expectedDate)),
      ...(warnings.length ? { warning: warnings.join(" / ") } : {}),
      records,
    };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("krx-core-indices", [
        () => env.DISCLOSURE_CACHE.put(cacheKey, JSON.stringify(payload), {
          expirationTtl: cacheTtlSeconds("indices", { baseDate: cacheDate, now }),
        }),
        () => env.DISCLOSURE_CACHE.put(latestKey, JSON.stringify(payload)),
      ]);
    }
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    const stale = env.DISCLOSURE_CACHE
      ? await readCacheBestEffort("krx-core-indices-latest", () => env.DISCLOSURE_CACHE.get(latestKey, "json"))
      : null;
    if (stale?.schema === KRX_INDEX_CACHE_SCHEMA && Array.isArray(stale.records) && stale.records.length) {
      return jsonResponse({
        ...stale,
        ok: true,
        cached: true,
        stale: true,
        warning: combineWarnings(stale.warning, "KRX \uC5F0\uACB0 \uC2E4\uD328\uB85C \uB9C8\uC9C0\uB9C9 \uC800\uC7A5 \uC9C0\uC218\uB97C \uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4."),
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
      await writeCachesBestEffort("krx-market-snapshot", [
        () => env.DISCLOSURE_CACHE.put(
          krxMarketCacheKey(market, baseDate),
          JSON.stringify(snapshot),
          {
            expirationTtl: cacheTtlSeconds("price", {
              baseDate,
              empty: snapshot.empty === true,
            }),
          },
        ),
      ]);
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

async function fetchResearchUniverse(env, baseDate, perMarketLimit) {
  const targets = [
    { market: "KOSPI", endpoint: "stk_bydd_trd" },
    { market: "KOSDAQ", endpoint: "ksq_bydd_trd" },
  ];
  const markets = {};
  for (const target of targets) {
    const response = await fetch(`${KRX_STOCK_BASE_URL}/${target.endpoint}?basDd=${apiDate(baseDate)}`, {
      headers: { AUTH_KEY: env.KRX_API_KEY },
    });
    if (!response.ok) throw new Error(`KRX ${target.market} HTTP ${response.status}`);
    const payload = await response.json();
    const records = normalizeResearchUniverseRows(payload?.OutBlock_1, target.market, perMarketLimit);
    if (records.length < perMarketLimit) {
      throw new Error(`KRX ${target.market} 시가총액 목록이 불완전합니다.`);
    }
    markets[target.market] = records;
  }
  return markets;
}

async function researchUniverseResponse(env, origin, forceRefresh = false, requestedLimit = null) {
  if (!env.KRX_API_KEY) {
    return jsonResponse({ ok: false, error: "Cloudflare에 KRX 키가 설정되지 않았습니다." }, 503, origin);
  }
  const now = new Date();
  const totalLimit = normalizeResearchUniverseSize(requestedLimit);
  const perMarketLimit = researchUniversePerMarketLimit(totalLimit);
  const expectedDate = expectedLatestKoreanTradingDate(now);
  const latestKey = `research-universe:${RESEARCH_CACHE_SCHEMA}:${totalLimit}:latest`;
  let liveWarning = "";
  if (isKoreanCurrentPriceWindow(now, { closeHour: 16 })) {
    try {
      const live = await fetchNaverLiveResearchUniverse(fetch, koreanDateText(now), { totalLimit });
      const payload = {
        ...live,
        schema: RESEARCH_CACHE_SCHEMA,
        savedAt: Date.now(),
      };
      if (env.DISCLOSURE_CACHE) {
        const liveKey = `research-universe:${RESEARCH_CACHE_SCHEMA}:${totalLimit}:live:${payload.baseDate}`;
        await writeCachesBestEffort("research-universe-live", [
          () => env.DISCLOSURE_CACHE.put(liveKey, JSON.stringify(payload), { expirationTtl: 300 }),
          () => env.DISCLOSURE_CACHE.put(latestKey, JSON.stringify(payload)),
        ]);
      }
      return jsonResponse({ ...payload, ok: true, cached: false }, 200, origin);
    } catch (error) {
      liveWarning = `장중 현재가 목록 확인 실패: ${error?.message || error}`;
    }
  }
  const latest = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("research-universe-latest", () => env.DISCLOSURE_CACHE.get(latestKey, "json"))
    : null;
  if (latest?.records?.length === totalLimit && latest.baseDate > expectedDate) {
    return jsonResponse({ ...latest, ok: true, cached: true }, 200, origin);
  }
  let refreshFallback = null;
  for (let offset = 0; offset <= KRX_LATEST_LOOKBACK_DAYS; offset += 1) {
    const baseDate = shiftDate(expectedDate, -offset);
    const cacheKey = `research-universe:${RESEARCH_CACHE_SCHEMA}:${totalLimit}:${baseDate}`;
    const cached = env.DISCLOSURE_CACHE
      ? await readCacheBestEffort("research-universe", () => env.DISCLOSURE_CACHE.get(cacheKey, "json"))
      : null;
    const cacheIsValid = cached?.schema === RESEARCH_CACHE_SCHEMA
      && cached?.baseDate === baseDate
      && cached?.records?.length === totalLimit;
    if (cacheIsValid && !forceRefresh) {
      return jsonResponse({
        ...cached,
        ok: true,
        cached: true,
        ...(liveWarning ? { warning: liveWarning } : {}),
      }, 200, origin);
    }
    if (cacheIsValid && !refreshFallback) refreshFallback = cached;
    try {
      const markets = await fetchResearchUniverse(env, baseDate, perMarketLimit);
      const records = [...markets.KOSPI, ...markets.KOSDAQ];
      const payload = {
        schema: RESEARCH_CACHE_SCHEMA,
        source: "KRX",
        baseDate,
        savedAt: Date.now(),
        selection: { KOSPI: perMarketLimit, KOSDAQ: perMarketLimit },
        records,
        ...(liveWarning ? { warning: liveWarning } : {}),
      };
      if (env.DISCLOSURE_CACHE) {
        await writeCachesBestEffort("research-universe", [
          () => env.DISCLOSURE_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: RESEARCH_CACHE_TTL_SECONDS }),
          () => env.DISCLOSURE_CACHE.put(latestKey, JSON.stringify(payload)),
        ]);
      }
      return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
    } catch (_) {
      // KRX can return an empty holiday snapshot; continue to the previous day.
    }
    if (refreshFallback?.baseDate === baseDate) {
      return jsonResponse({
        ...refreshFallback,
        ok: true,
        cached: true,
        stale: true,
        warning: "KRX 최신 조회에 실패해 직전 종목 목록을 사용했습니다.",
      }, 200, origin);
    }
  }
  const stale = latest || (env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("research-universe-latest", () => env.DISCLOSURE_CACHE.get(latestKey, "json"))
    : null);
  if (stale?.records?.length === totalLimit) {
    return jsonResponse({
      ...stale,
      ok: true,
      cached: true,
      stale: true,
      warning: "KRX 연결 실패로 마지막 시가총액 목록을 사용했습니다.",
    }, 200, origin);
  }
  return jsonResponse({ ok: false, error: "KRX 시가총액 상위 종목을 불러오지 못했습니다." }, 503, origin);
}

function mergeResearchHistory(existing, incoming, today) {
  const cutoff = yearsBefore(today, RESEARCH_HISTORY_YEARS);
  const byDate = new Map();
  [...(existing || []), ...(incoming || [])].forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const close = finiteNumber(row?.close, { min: Number.MIN_VALUE });
    const volume = finiteNumber(row?.volume, { min: 0 });
    if (!isValidIsoDate(date) || date < cutoff || !close) return;
    byDate.set(date, { date, close, volume });
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

async function fetchNaverResearchHistory(ticker, startDate, endDate) {
  const code = TICKER_PATTERN.exec(ticker)?.[1] || "";
  const query = new URLSearchParams({
    symbol: code,
    timeframe: "day",
    startTime: apiDate(startDate),
    endTime: apiDate(endDate),
    requestType: "1",
  });
  const response = await fetch(`${NAVER_STOCK_HISTORY_URL}?${query}`);
  if (!response.ok) throw new Error(`Naver history HTTP ${response.status}`);
  const announcedSize = Number(response.headers.get("Content-Length") || 0);
  if (announcedSize > MAX_NAVER_PRICE_BYTES) throw new Error("Naver history response is too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_NAVER_PRICE_BYTES) throw new Error("Naver history response is too large");
  return parseNaverResearchHistory(new TextDecoder().decode(bytes));
}

async function researchHistoryResponse(env, ticker, origin, options = {}) {
  const today = expectedLatestKoreanTradingDate(new Date());
  const sinceDate = String(options.sinceDate || "").slice(0, 10);
  const forceFull = options.forceFull === true;
  const cacheKey = `research-history:${RESEARCH_CACHE_SCHEMA}:${ticker}`;
  const cached = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("research-history", () => env.DISCLOSURE_CACHE.get(cacheKey, "json"))
    : null;
  if (cached?.schema === RESEARCH_CACHE_SCHEMA && cached?.asOfDate === today && cached?.rows?.length >= 252) {
    return jsonResponse(projectResearchHistoryPayload(
      { ...cached, ok: true, cached: true },
      sinceDate,
      forceFull,
    ), 200, origin);
  }
  try {
    const existingRows = Array.isArray(cached?.rows) ? cached.rows : [];
    const latestDate = existingRows.at(-1)?.date || "";
    const startDate = latestDate
      ? shiftDate(latestDate, -RESEARCH_HISTORY_OVERLAP_DAYS)
      : yearsBefore(today, RESEARCH_HISTORY_YEARS);
    let incoming = await fetchNaverResearchHistory(ticker, startDate, today);
    let mergeBase = existingRows;
    let rebased = false;
    if (existingRows.length && detectResearchHistoryRebase(existingRows, incoming)) {
      incoming = await fetchNaverResearchHistory(ticker, yearsBefore(today, RESEARCH_HISTORY_YEARS), today);
      mergeBase = [];
      rebased = true;
    }
    const rows = mergeResearchHistory(mergeBase, incoming, today);
    if (rows.length < 252) throw new Error("가격 이력이 1년 미만입니다.");
    const payload = {
      schema: RESEARCH_CACHE_SCHEMA,
      ticker,
      asOfDate: today,
      latestDate: rows.at(-1).date,
      savedAt: Date.now(),
      rebased,
      rows,
    };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("research-history", [
        () => env.DISCLOSURE_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: RESEARCH_CACHE_TTL_SECONDS }),
      ]);
    }
    return jsonResponse(projectResearchHistoryPayload(
      { ok: true, cached: false, ...payload },
      sinceDate,
      forceFull,
    ), 200, origin);
  } catch (error) {
    if (cached?.rows?.length >= 252) {
      return jsonResponse(projectResearchHistoryPayload({
        ...cached,
        ok: true,
        cached: true,
        stale: true,
        warning: `${ticker} 최신 가격 갱신에 실패해 저장 이력을 사용했습니다.`,
      }, sinceDate, forceFull), 200, origin);
    }
    return jsonResponse({ ok: false, error: `${ticker} 가격 이력 조회 실패: ${error?.message || error}` }, 503, origin);
  }
}

async function fetchNaverResearchProfile(ticker) {
  const code = TICKER_PATTERN.exec(ticker)?.[1] || "";
  const response = await fetch(`${NAVER_STOCK_PROFILE_URL}?code=${encodeURIComponent(code)}`);
  if (!response.ok) throw new Error(`Naver profile HTTP ${response.status}`);
  const announcedSize = Number(response.headers.get("Content-Length") || 0);
  if (announcedSize > MAX_NAVER_PROFILE_BYTES) throw new Error("Naver profile response is too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_NAVER_PROFILE_BYTES) throw new Error("Naver profile response is too large");
  const profile = parseNaverResearchProfile(new TextDecoder().decode(bytes), ticker);
  if (!profile.category) throw new Error("업종 분류가 없습니다.");
  return profile;
}

async function researchProfileResponse(env, ticker, origin) {
  const cacheKey = `research-profile:${RESEARCH_CACHE_SCHEMA}:${ticker}`;
  const cached = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("research-profile", () => env.DISCLOSURE_CACHE.get(cacheKey, "json"))
    : null;
  if (cached?.category && Date.now() - Number(cached.savedAt || 0) < RESEARCH_PROFILE_FRESH_MS) {
    return jsonResponse({ ...cached, ok: true, cached: true }, 200, origin);
  }
  try {
    const profile = await fetchNaverResearchProfile(ticker);
    const payload = { schema: RESEARCH_CACHE_SCHEMA, ticker, savedAt: Date.now(), ...profile };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("research-profile", [
        () => env.DISCLOSURE_CACHE.put(cacheKey, JSON.stringify(payload), {
          expirationTtl: RESEARCH_CACHE_TTL_SECONDS,
        }),
      ]);
    }
    return jsonResponse({ ok: true, cached: false, ...payload }, 200, origin);
  } catch (error) {
    if (cached?.category) return jsonResponse({ ...cached, ok: true, cached: true, stale: true }, 200, origin);
    return jsonResponse({ ok: false, error: `${ticker} 업종 조회 실패: ${error?.message || error}` }, 503, origin);
  }
}

async function readResearchSummaryBody(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > RESEARCH_SUMMARY_BODY_LIMIT) {
    const error = new Error("Research summary request is too large");
    error.status = 413;
    throw error;
  }
  const reader = request.body?.getReader();
  const chunks = [];
  let bytesRead = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > RESEARCH_SUMMARY_BODY_LIMIT) {
        await reader.cancel("Research summary request is too large");
        const error = new Error("Research summary request is too large");
        error.status = 413;
        throw error;
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (_) {
    const error = new Error("Research summary body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

async function researchSummaryResponse(request, env, url, origin) {
  if (!env.DISCLOSURE_CACHE) {
    return jsonResponse({ ok: false, error: "Research summary storage is not configured" }, 503, origin);
  }
  const strategy = normalizeResearchStrategy(url.searchParams.get("strategy"));
  const minimum = normalizeResearchMinimum(url.searchParams.get("minimum"));
  const universeSize = normalizeResearchUniverseSize(url.searchParams.get("size"));
  const key = researchSummaryCacheKey(strategy, minimum, universeSize);
  if (!key) return jsonResponse({ ok: false, error: "Research strategy is invalid" }, 400, origin);
  if (request.method === "GET") {
    const cached = await env.DISCLOSURE_CACHE.get(key, "json");
    const summary = normalizeResearchSummary(cached, { strategy, minimum, universeSize });
    return summary
      ? jsonResponse({ ok: true, cached: true, ...summary }, 200, origin)
      : jsonResponse({ ok: false, error: "저장된 종목탐구 요약이 없습니다." }, 404, origin);
  }
  try {
    const body = await readResearchSummaryBody(request);
    const summary = normalizeResearchSummary(body, { strategy, minimum, universeSize });
    if (!summary) return jsonResponse({ ok: false, error: "종목탐구 요약 형식이 올바르지 않습니다." }, 400, origin);
    await env.DISCLOSURE_CACHE.put(key, JSON.stringify(summary), {
      expirationTtl: RESEARCH_SUMMARY_TTL_SECONDS,
    });
    return jsonResponse({ ok: true, cached: false, ...summary }, 200, origin);
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || "종목탐구 요약 저장 실패" }, error?.status || 503, origin);
  }
}

async function fetchLatestNaverSymbolPoints(symbol, today = koreanDateText(), options = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!/^(?:\d{6}|KOSPI|KOSDAQ)$/.test(normalizedSymbol)) return [];
  const startDate = DATE_PATTERN.test(String(options?.startDate || ""))
    ? String(options.startDate)
    : shiftDate(today, -NAVER_PRICE_LOOKBACK_DAYS);
  const query = new URLSearchParams({
    symbol: normalizedSymbol,
    requestType: "1",
    startTime: apiDate(startDate),
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

async function fetchLatestNaverStockPoints(ticker, today = koreanDateText()) {
  const stockCode = TICKER_PATTERN.exec(String(ticker || "").trim().toUpperCase())?.[1] || "";
  return stockCode ? fetchLatestNaverSymbolPoints(stockCode, today) : [];
}

async function buildKrxPricePayload(env, ticker, now = new Date()) {
  if (!env.KRX_API_KEY) throw new Error("Cloudflare에 KRX 키가 설정되지 않았습니다.");
  const today = koreanDateText(now);
  const expectedDate = expectedLatestKoreanTradingDate(now);
  const currentPriceWindow = isKoreanCurrentPriceWindow(now);
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
  const shouldCheckNaver = currentPriceWindow
    || !point
    || !krxResult?.marketDate
    || krxResult.marketDate < expectedDate
    || point.date < krxResult.marketDate;
  if (shouldCheckNaver) {
    try {
      const naverPoints = await fetchLatestNaverStockPoints(ticker, today);
      const evaluation = evaluateNaverPriceFallback(point, naverPoints, {
        allowSameDate: currentPriceWindow,
      });
      crossCheck = evaluation.status;
      if (evaluation.accepted && evaluation.point && (
        !point
        || evaluation.point.date > point.date
        || (currentPriceWindow && evaluation.point.date === point.date)
      )) {
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
  return {
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
  };
}

async function krxPriceResponse(env, ticker, origin) {
  try {
    return jsonResponse(await buildKrxPricePayload(env, ticker), 200, origin);
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || "KRX 가격 조회에 실패했습니다." }, 503, origin);
  }
}

async function krxBatchPriceResponse(env, tickers, origin) {
  const targets = [...new Set((Array.isArray(tickers) ? tickers : [])
    .map((ticker) => String(ticker || "").trim().toUpperCase())
    .filter((ticker) => TICKER_PATTERN.test(ticker)))].slice(0, 10);
  if (!targets.length) return jsonResponse({ ok: false, error: "종목코드 형식이 올바르지 않습니다." }, 400, origin);
  const now = new Date();
  const results = await Promise.all(targets.map(async (ticker) => {
    try {
      return await buildKrxPricePayload(env, ticker, now);
    } catch (error) {
      return { ok: false, ticker, error: error?.message || "가격 조회 실패" };
    }
  }));
  const succeeded = results.filter((result) => result.ok === true).length;
  return jsonResponse({
    ok: succeeded > 0,
    requested: targets.length,
    succeeded,
    results,
  }, succeeded > 0 ? 200 : 503, origin);
}

async function runtimeBootstrapResponse(env, url, origin) {
  const tickers = String(url.searchParams.get("tickers") || "").split(",");
  const targets = [...new Set(tickers
    .map((ticker) => String(ticker || "").trim().toUpperCase())
    .filter((ticker) => TICKER_PATTERN.test(ticker)))].slice(0, 10);
  const refresh = queryFlag(url.searchParams.get("refresh"));
  const since = String(url.searchParams.get("since") || "").slice(0, 10);
  const responses = await Promise.allSettled([
    krxCoreIndexResponse(env, origin, refresh, since),
    targets.length
      ? krxBatchPriceResponse(env, targets, origin)
      : Promise.resolve(jsonResponse({ ok: true, requested: 0, succeeded: 0, results: [] }, 200, origin)),
  ]);
  const responsePayload = async (result, label) => {
    if (result.status === "rejected") {
      return { ok: false, error: `${label} failed: ${result.reason?.message || result.reason}` };
    }
    return result.value.json().catch(() => ({
      ok: false,
      error: `${label} HTTP ${result.value.status}`,
    }));
  };
  const [indices, prices] = await Promise.all([
    responsePayload(responses[0], "Index"),
    responsePayload(responses[1], "Price"),
  ]);
  const usable = indices?.ok === true || prices?.ok === true;
  return jsonResponse({
    ok: usable,
    partial: indices?.ok !== true || prices?.ok !== true,
    requestedTickers: targets,
    indices,
    prices,
  }, usable ? 200 : 503, origin);
}

function timestamp(value) {
  return finiteNumber(value, { min: 1, max: 8_640_000_000_000_000 });
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
    news: sanitizeAnalysisNews(analysis.news, ticker),
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
    news: cached.news || [],
    snapshots: cached.snapshots || [],
    ...extra,
  };
}

async function analysisResponse(env, ctx, ticker, origin, options = {}) {
  const cached = await readAnalysisCache(env, ticker);
  const fresh = cached
    && koreanDateText(new Date(Number(cached.savedAt || 0))) === koreanDateText();
  if (!options.forceRefresh
    && fresh
    && (!options.requireNews || cached.hasNews)
    && (!options.requireFinancials || cached.financials?.length)) {
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
    const incoming = await fetchCompanyAnalysis(ticker);
    if (options.requireFinancials
      && !incoming.financials?.length
      && !incoming.consensus
      && !incoming.news?.length) {
      throw new Error("Embedded earnings data is empty");
    }
    const analysis = {
      schema: ANALYSIS_CACHE_SCHEMA,
      ticker,
      savedAt: Date.now(),
      consensus: incoming.consensus || cached?.consensus || null,
      financials: mergeFinancialRecords(cached?.financials || [], incoming.financials || []),
      news: incoming.newsFetched
        ? sanitizeAnalysisNews(incoming.news, ticker)
        : (cached?.news || []),
    };
    const currentSnapshot = snapshotFromAnalysis(analysis);
    analysis.snapshots = mergeAnalysisSnapshots(
      cached?.snapshots || [],
      currentSnapshot ? [currentSnapshot] : [],
    );
    const write = writeCachesBestEffort("company-analysis", [
      () => writeAnalysisCache(env, ticker, analysis),
    ]);
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
    return jsonResponse(analysisPayload(analysis, { cached: false }), 200, origin);
  } catch (error) {
    if (cached?.consensus || cached?.financials?.length || cached?.news?.length) {
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
  return recordFromDartItem(ticker, item);
}

export const mergeRecords = mergeDartDisclosureRecords;

async function fetchDartPage(env, params) {
  const url = `${DART_LIST_URL}?${new URLSearchParams(params)}`;
  const result = await executeRuntimeSourcePlan("disclosure", {
    primary: async () => {
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
    },
  });
  return result.value;
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
  const result = await executeRuntimeSourcePlan("disclosure", {
    primary: async () => {
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
    },
  });
  return result.value;
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
  const remaining = await Promise.allSettled(
    Array.from({ length: Math.max(0, lastPage - startPage) }, (_, index) => (
      fetchDartDisclosurePage(env, ticker, corpCode, since, today, startPage + index + 1)
    )),
  );
  const contiguousPages = [];
  let warning = "";
  for (const result of remaining) {
    if (result.status === "rejected") {
      warning = `DART 다음 페이지 일부를 불러오지 못했습니다: ${result.reason?.message || result.reason}`;
      break;
    }
    contiguousPages.push(result.value);
  }
  return {
    records: mergeRecords([], [first, ...contiguousPages].flatMap((page) => page.records)),
    totalPages: first.totalPages,
    lastPage: startPage + contiguousPages.length,
    warning,
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
    const cacheWrite = writeCachesBestEffort("dart-insider", [
      () => writeInsiderCache(env, ticker, corpCode, records),
    ]);
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

function journalValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
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
  if (payload.records.length > FORECAST_JOURNAL_INPUT_LIMIT) {
    throw journalValidationError(`Forecast journal accepts at most ${FORECAST_JOURNAL_INPUT_LIMIT} records`);
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
      apiVersion: RUNTIME_API_VERSION,
      dartConfigured: Boolean(env.DART_API_KEY),
      krxConfigured: Boolean(env.KRX_API_KEY),
      ecosConfigured: Boolean(env.ECOS_API_KEY),
      fredConfigured: Boolean(env.FRED_API_KEY),
      accessTokenConfigured: Boolean(env.THINKSTOCK_ACCESS_TOKEN),
      adminSessionConfigured: Boolean(
        env.THINKSTOCK_ADMIN_CODE && env.THINKSTOCK_ADMIN_SESSION_SECRET,
      ),
      cacheConfigured: Boolean(env.DISCLOSURE_CACHE),
    }, 200, origin);
  }
  const accessAuthorized = Boolean(
    env.THINKSTOCK_ACCESS_TOKEN
    && await tokensMatch(bearerToken(request), env.THINKSTOCK_ACCESS_TOKEN),
  );
  if (route.authenticated && !accessAuthorized) {
    return jsonResponse({ ok: false, error: "개인 접속 코드가 올바르지 않습니다." }, 401, origin);
  }
  if (route.id === "auth-check") return jsonResponse({ ok: true }, 200, origin);
  if (route.id === "admin-session") {
    return adminSessionResponse(request, env, origin, { jsonResponse, tokensMatch });
  }
  if (route.id === "macro") {
    const refresh = queryFlag(url.searchParams.get("refresh"));
    return ecosMacroResponse(env, origin, refresh);
  }
  if (route.id === "credit") {
    const refresh = queryFlag(url.searchParams.get("refresh"));
    return creditMacroResponse(env, origin, refresh);
  }
  if (route.id === "crisis-signal") {
    // Public clients may read validated market data; only authenticated clients may force upstream calls.
    const refresh = accessAuthorized && queryFlag(url.searchParams.get("refresh"));
    return crisisSignalResponse(env, origin, refresh);
  }
  if (route.id === "adr") {
    const refresh = queryFlag(url.searchParams.get("refresh"));
    return adrMarketResponse(env, origin, refresh);
  }
  if (route.id === "bootstrap") return runtimeBootstrapResponse(env, url, origin);
  if (route.id === "indices") {
    const refresh = queryFlag(url.searchParams.get("refresh"));
    return krxCoreIndexResponse(env, origin, refresh, url.searchParams.get("since"));
  }
  if (route.id === "research-universe") {
    return researchUniverseResponse(
      env,
      origin,
      queryFlag(url.searchParams.get("refresh")),
      url.searchParams.get("limit"),
    );
  }
  if (route.id === "research-summary") return researchSummaryResponse(request, env, url, origin);
  if (route.id === "prices-batch") {
    const tickers = String(url.searchParams.get("tickers") || "").split(",");
    return krxBatchPriceResponse(env, tickers, origin);
  }
  const ticker = String(url.searchParams.get("ticker") || "").trim().toUpperCase();
  if (route.ticker && !TICKER_PATTERN.test(ticker)) {
    return jsonResponse({ ok: false, error: "종목코드 형식이 올바르지 않습니다." }, 400, origin);
  }
  if (route.id === "prices") return krxPriceResponse(env, ticker, origin);
  if (route.id === "research-history") {
    return researchHistoryResponse(env, ticker, origin, {
      sinceDate: url.searchParams.get("since"),
      forceFull: queryFlag(url.searchParams.get("full")),
    });
  }
  if (route.id === "research-profile") return researchProfileResponse(env, ticker, origin);
  if (route.id === "forecast-journal") return forecastJournalResponse(request, env, ticker, origin);
  if (["consensus", "analysis"].includes(route.id)) {
    return analysisResponse(env, ctx, ticker, origin, {
      requireFinancials: route.id === "analysis",
      requireNews: route.id === "analysis",
      forceRefresh: queryFlag(url.searchParams.get("refresh")),
    });
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
      const cacheWrite = writeCachesBestEffort("dart-disclosure", [
        () => writeCache(env, ticker, corpCode, records, complete),
      ]);
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
        ...(batch.warning ? { warning: batch.warning } : {}),
      }, 200, origin);
    }
    const incoming = await fetchDartDisclosures(env, ticker, corpCode, since, today);
    const records = mergeRecords(cached?.records || [], incoming);
    const cacheWrite = writeCachesBestEffort("dart-disclosure", [
      () => writeCache(env, ticker, corpCode, records),
    ]);
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
