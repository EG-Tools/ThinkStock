import {
  expectedLatestKoreanTradingDate,
  isKoreanCurrentPriceWindow,
  isKoreanTradingDate,
  koreanDateText,
  resolveKoreanResearchUniversePhase,
} from "../../shared/market-calendar.mjs";
import {
  RUNTIME_API_VERSION,
} from "../../shared/runtime-api-contract.mjs";
import {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
} from "../../shared/company-analysis-contract.mjs";
import {
  cacheTtlSeconds,
  sourcePolicy,
} from "../../shared/runtime-freshness-policy.mjs";
import { createProviderHttpError } from "../../shared/runtime-provider-resilience.mjs";
import {
  mergeIndexRecords,
  normalizeMacroPayload,
} from "../../shared/runtime-data-contract.mjs";
import { availableOnDate } from "../../shared/series-timeline-policy.mjs";
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
  STOCKPLUS_VKOSPI_ENDPOINT,
  vkospiBackfillDates,
  vkospiRowsFromStockplusBrowserContent,
} from "../../shared/krx-volatility-index.mjs";
import {
  fetchYahooVixRows,
  mergeVixRows,
  normalizeBrowserVixContent,
  yahooVixChartUrl,
} from "../../shared/vix-market-data.mjs";
import {
  fetchNaverLiveResearchUniverse,
  normalizeResearchUniverseSize,
  researchUniversePerMarketLimit,
} from "../../shared/research-universe-live.mjs";
import {
  companyAnalysisResponse,
  dartEpsHistoryResponse,
  financialSummaryRequestFromOverview,
  mergeFinancialRecords,
  mergeAnalysisSnapshots,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
  parseNaverNewsHtml,
} from "./company-analysis.mjs";

import { dispatchRequestRoute, matchRequestRoute, queryFlag } from "./request-router.mjs";
import { adminSessionResponse } from "./admin-session-handler.mjs";
import { brokerReportPdfResponse, brokerReportsResponse } from "./broker-report-handler.mjs";
import {
  dartDisclosureResponse,
  insiderTradeResponse,
} from "./dart-handler.mjs";
import {
  forecastJournalResponse,
  mergeForecastJournalRecords,
} from "./forecast-journal.mjs";
import {
  buildCrisisSignalRows,
  buildTreasurySpreadRows,
  fetchCrisisSignalSources,
  normalizeFredObservations,
} from "./crisis-signal.mjs";
import {
  createKofiaClient,
  creditCacheRefreshDecision,
  creditRefreshWindowDate,
  expectedLatestKofiaDate,
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
  RESEARCH_CACHE_SCHEMA,
  RESEARCH_CACHE_TTL_SECONDS,
  normalizeResearchUniverseRows,
  researchHistoryResponse,
  researchProfileResponse,
  researchSummaryResponse,
} from "./research-data.mjs";
import {
  apiDate,
  bearerToken,
  corsHeaders,
  isAllowedOrigin,
  isValidIsoDate,
  jsonResponse,
  readBoundedResponseBytes,
  readBoundedResponseText,
  readCacheBestEffort,
  shiftDate,
  tokensMatch,
  writeCachesBestEffort,
} from "./http-runtime.mjs";

export {
  evaluateNaverPriceFallback,
  financialSummaryRequestFromOverview,
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
export { isAllowedOrigin };
export { creditRefreshWindowDate, parseFreesisPayload };
export { mergeForecastJournalRecords };
export {
  insiderRecordFromItem,
  mergeInsiderRecords,
  mergeRecords,
  parseLargestShareholderDocument,
  parseMajorHolderDocument,
} from "./dart-handler.mjs";
export {
  detectResearchHistoryRebase,
  parseNaverResearchHistory,
  projectResearchHistoryPayload,
} from "./research-data.mjs";
export {
  krxIndexPointFromRows,
  krxMarketSnapshotFromRows,
  krxStockPointFromRows,
} from "./market-data.mjs";

const kofiaClient = createKofiaClient();

const KRX_STOCK_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis/sto";
const KRX_INDEX_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis/idx";
const NAVER_STOCK_PRICE_URL = "https://api.finance.naver.com/siseJson.naver";
const TICKER_PATTERN = /^(\d{6})\.(KS|KQ)$/;
const CORP_CODE_PATTERN = /^\d{8}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KRX_LATEST_LOOKBACK_DAYS = 10;
const KRX_INDEX_CACHE_SCHEMA = 5;
const NAVER_PRICE_LOOKBACK_DAYS = 21;
const MAX_NAVER_PRICE_BYTES = 1024 * 1024;
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
const CREDIT_CACHE_SCHEMA = 5;
const CREDIT_CACHE_KEY = `credit-macro:${CREDIT_CACHE_SCHEMA}`;
const CREDIT_SYNC_MAX_BYTES = 64 * 1024;
const CREDIT_SYNC_MAX_ROWS = 45;
const INDEXERGO_BROWSER_MAX_BYTES = 256 * 1024;
const STOCKPLUS_BROWSER_MAX_BYTES = 256 * 1024;
const VIX_BROWSER_MAX_BYTES = 256 * 1024;
const BROWSER_QUICK_ACTION_INTERVAL_MS = 10_250;
const ADR_CACHE_SCHEMA = 1;
const ADR_CACHE_KEY = `adr-market:${ADR_CACHE_SCHEMA}:latest`;
const ADR_CACHE_FRESH_MS = sourcePolicy("adr").liveConfirmMs;
const ADR_CACHE_ROW_LIMIT = 900;
const ADR_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const CRISIS_CACHE_SCHEMA = 10;
const CRISIS_CACHE_KEY = `fred-crisis-signal:${CRISIS_CACHE_SCHEMA}`;
const VKOSPI_LIVE_FRESH_MS = sourcePolicy("indices").liveConfirmMs;
const VKOSPI_SETTLEMENT_RECHECK_MS = 15 * 60 * 1000;
const ADR_SOURCE_URL = "https://www.adrinfo.kr/chart";
const ADR_LEGACY_SOURCE_URL = "http://www.adrinfo.kr/chart";

let browserQuickActionQueue = Promise.resolve();
let browserQuickActionStartedAt = 0;

function browserQuickActionInterval(env) {
  if (Object.prototype.hasOwnProperty.call(env || {}, "BROWSER_QUICK_ACTION_INTERVAL_MS")) {
    return Math.max(0, Math.min(60_000, Number(env.BROWSER_QUICK_ACTION_INTERVAL_MS) || 0));
  }
  return BROWSER_QUICK_ACTION_INTERVAL_MS;
}

function queuedBrowserQuickAction(env, action, options) {
  const run = async () => {
    const intervalMs = browserQuickActionInterval(env);
    const attempts = intervalMs > 0 ? 2 : 1;
    let response = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const waitMs = Math.max(0, intervalMs - (Date.now() - browserQuickActionStartedAt));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      browserQuickActionStartedAt = Date.now();
      response = await env.BROWSER.quickAction(action, options);
      if (response?.status !== 429) return response;
      await response.arrayBuffer().catch(() => null);
    }
    return response;
  };
  const pending = browserQuickActionQueue.then(run, run);
  browserQuickActionQueue = pending.then(() => undefined, () => undefined);
  return pending;
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
      const rows = parseAdrChartRows(await readBoundedResponseText(response, ADR_RESPONSE_MAX_BYTES, "ADR upstream"));
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

async function adrMarketResponse(env, origin, forceRefresh = false, latestOnly = false) {
  const cached = env.DISCLOSURE_CACHE
    ? normalizeAdrCache(await readCacheBestEffort(
      "adr",
      () => env.DISCLOSURE_CACHE.get(ADR_CACHE_KEY, "json"),
    ))
    : null;
  if (!forceRefresh && cached && Date.now() - cached.savedAt <= ADR_CACHE_FRESH_MS) {
    return jsonResponse({
      ...cached,
      ok: true,
      cached: true,
      stale: false,
      rows: latestOnly ? cached.rows.slice(-1) : cached.rows,
    }, 200, origin);
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
    return jsonResponse({
      ok: true,
      cached: false,
      stale: false,
      ...payload,
      rows: latestOnly ? rows.slice(-1) : rows,
    }, 200, origin);
  } catch (error) {
    if (cached) {
      return jsonResponse({
        ...cached,
        ok: true,
        cached: true,
        stale: true,
        warning: combineWarnings(cached.warning, "ADR 연결 실패로 마지막 검증 데이터를 사용합니다."),
        rows: latestOnly ? cached.rows.slice(-1) : cached.rows,
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

function mergePublishedEcosRows(existing, incoming, key, options = {}) {
  const checkedDate = String(options.checkedDate || "").slice(0, 10);
  const previousCheckedDate = String(options.previousCheckedDate || "").slice(0, 10);
  const existingRows = Array.isArray(existing) ? existing : [];
  const incomingRows = Array.isArray(incoming) ? incoming : [];
  const latestLegacyReferenceDate = existingRows
    .map((row) => String(row?.reference_date || row?.date || "").slice(0, 10))
    .filter(isValidIsoDate)
    .sort()
    .at(-1) || "";
  const rows = new Map();

  existingRows.forEach((row) => {
    const referenceDate = String(row?.reference_date || row?.date || "").slice(0, 10);
    const value = finiteNumber(row?.[key]);
    if (!isValidIsoDate(referenceDate) || value === null) return;
    const fallbackDate = availableOnDate(key, referenceDate);
    const explicitDate = String(row?.available_date || row?.availableDate || "").slice(0, 10);
    const legacyLatestDate = referenceDate === latestLegacyReferenceDate
      && isValidIsoDate(previousCheckedDate)
      && Math.abs(Date.parse(`${previousCheckedDate}T00:00:00Z`) - Date.parse(`${fallbackDate}T00:00:00Z`)) <= 7 * 86400000
      ? previousCheckedDate
      : fallbackDate;
    rows.set(referenceDate, {
      date: referenceDate,
      available_date: isValidIsoDate(explicitDate) ? explicitDate : legacyLatestDate,
      [key]: value,
    });
  });

  const hadExistingRows = rows.size > 0;
  incomingRows.forEach((row) => {
    const referenceDate = String(row?.date || "").slice(0, 10);
    const value = finiteNumber(row?.[key]);
    if (!isValidIsoDate(referenceDate) || value === null) return;
    const previous = rows.get(referenceDate);
    const changed = previous && finiteNumber(previous[key]) !== value;
    const observedDate = isValidIsoDate(checkedDate)
      ? checkedDate
      : availableOnDate(key, referenceDate);
    rows.set(referenceDate, {
      date: referenceDate,
      available_date: previous && !changed
        ? previous.available_date
        : (hadExistingRows ? observedDate : availableOnDate(key, referenceDate)),
      [key]: value,
    });
  });
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function normalizedEcosMacroPayload(payload) {
  return normalizeMacroPayload({ ...payload, ok: true });
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
  if (!needsRefresh) {
    return jsonResponse(normalizedEcosMacroPayload({ ...cached, cached: true }), 200, origin);
  }
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
      leadingRows: mergePublishedEcosRows(cached?.leadingRows, leading, "leading_cycle", {
        checkedDate: checkDate,
        previousCheckedDate: cached?.lastCheckedDate,
      }).slice(-36),
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
    return jsonResponse(normalizedEcosMacroPayload({ cached: false, ...payload }), 200, origin);
  } catch (error) {
    if (cached?.schema === ECOS_CACHE_SCHEMA) return jsonResponse(normalizedEcosMacroPayload({
      ...cached,
      cached: true,
      stale: true,
      warning: combineWarnings(cached.warning, "ECOS 연결 실패로 마지막 저장 지표를 사용했습니다."),
    }), 200, origin);
    return jsonResponse({ ok: false, error: `ECOS 조회 실패: ${error?.message || error}` }, 503, origin);
  }
}

function combineWarnings(...warnings) {
  return [...new Set(warnings.map((value) => String(value || "").trim()).filter(Boolean))].join(" / ");
}

export async function fetchLiveVkospiRows(env, rows, now = new Date()) {
  const expectedDate = koreanDateText(now);
  let recentRows;
  try {
    recentRows = await fetchStockplusVkospiRows(fetch, {
      expectedDate,
      limit: 10,
      signal: AbortSignal.timeout(10000),
    });
  } catch (directError) {
    if (!directError?.retryable || !env?.BROWSER?.quickAction) throw directError;
    const url = new URL(STOCKPLUS_VKOSPI_ENDPOINT);
    url.searchParams.set("limit", "10");
    const response = await queuedBrowserQuickAction(env, "content", {
      url: url.toString(),
      cacheTTL: 60,
      gotoOptions: { waitUntil: "domcontentloaded", timeout: 15000 },
      rejectResourceTypes: ["image", "media", "font", "stylesheet"],
    });
    const body = await readBoundedResponseText(
      response,
      STOCKPLUS_BROWSER_MAX_BYTES,
      "Stockplus VKOSPI Browser Run",
    );
    if (!response.ok) {
      throw createProviderHttpError("Stockplus VKOSPI Browser Run", response, body.slice(0, 160));
    }
    recentRows = vkospiRowsFromStockplusBrowserContent(body);
    if (!recentRows.length || recentRows.at(-1)?.date !== expectedDate) {
      throw new Error("Stockplus VKOSPI Browser Run returned no current value");
    }
  }
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
        const live = await fetchLiveVkospiRows(env, vkospiRows, now);
        vkospiRows = live.rows;
        livePoint = live.point;
      } catch (error) {
        const retainedSettlementValue = !nextSourcePlan.stockplusLiveWindow
          && cached?.vkospiLive === true
          && cached?.vkospiLiveDate === checkDate;
        if (!retainedSettlementValue) {
          liveWarning = `증권플러스 VKOSPI 갱신 지연: ${error?.message || error}`;
        }
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
    const [sources, yahooVixResult] = await Promise.all([
      fetchCrisisSignalSources(fetch, String(env.FRED_API_KEY).trim()),
      fetchYahooVixRows(fetch, {
        cacheBust: Date.now(),
        signal: AbortSignal.timeout(12000),
      }).then((rows) => ({ rows, error: "" }))
        .catch(async (directError) => {
          if (!env.BROWSER?.quickAction) {
            return { rows: [], error: String(directError?.message || directError) };
          }
          try {
            const response = await queuedBrowserQuickAction(env, "content", {
              url: yahooVixChartUrl({ cacheBust: Date.now() }),
              cacheTTL: 60,
              gotoOptions: { waitUntil: "domcontentloaded", timeout: 15000 },
              rejectResourceTypes: ["image", "media", "font", "stylesheet"],
            });
            const body = await readBoundedResponseText(
              response,
              VIX_BROWSER_MAX_BYTES,
              "Yahoo VIX Browser Run",
            );
            if (!response.ok) throw createProviderHttpError("Yahoo VIX Browser Run", response);
            const rows = normalizeBrowserVixContent(body);
            if (!rows.length) throw new Error("Yahoo VIX Browser Run returned no usable rows");
            return { rows, error: "" };
          } catch (browserError) {
            return {
              rows: [],
              error: [directError?.message || directError, browserError?.message || browserError]
                .filter(Boolean)
                .join(" / "),
            };
          }
        }),
    ]);
    const cachedVixOfficialDate = String(
      cached?.vixOfficialLatestDate || cached?.vixRows?.at(-1)?.date || "",
    ).slice(0, 10);
    const cachedVix = normalizeFredObservations((cached?.vixRows || [])
      .filter((row) => !cachedVixOfficialDate || String(row?.date || "").slice(0, 10) <= cachedVixOfficialDate)
      .map((row) => ({
      date: row?.date,
      value: row?.vix,
      })));
    const cachedKrwUsd = normalizeFredObservations((cached?.records || []).map((row) => ({
      date: row?.date,
      value: row?.krwUsd,
    })));
    const officialVixSeries = sources.vix || cachedVix;
    const officialVixRows = normalizeFredObservations(officialVixSeries)
      .map((row) => ({ date: row.date, vix: row.value }));
    const vixOfficialLatestDate = officialVixRows.at(-1)?.date || cachedVixOfficialDate;
    const retainedVixRows = mergeVixRows(
      officialVixRows,
      cached?.vixRows,
      { afterDate: vixOfficialLatestDate },
    );
    const vixRows = mergeVixRows(
      retainedVixRows,
      yahooVixResult.rows,
      { afterDate: vixOfficialLatestDate },
    );
    const vixLiveDate = String(
      vixRows.at(-1)?.date > vixOfficialLatestDate ? vixRows.at(-1)?.date : "",
    );
    const vixSeries = vixRows.map((row) => ({ date: row.date, value: row.vix }));
    const krwUsdSeries = sources.krwUsd || cachedKrwUsd;
    const treasuryYields = sources.treasuryYields || null;
    const termSpreadRows = treasuryYields
      ? buildTreasurySpreadRows(treasuryYields.DGS10, treasuryYields.DGS1)
      : (Array.isArray(cached?.termSpreadRows) ? cached.termSpreadRows : []);
    const creditRates = sources.creditRates || null;
    const creditSpreadRows = creditRates?.rows?.length
      ? creditRates.rows
      : (Array.isArray(cached?.creditSpreadRows) ? cached.creditSpreadRows : []);
    const records = sources.core
      ? buildCrisisSignalRows({
        ...sources.core,
        ...(treasuryYields || {}),
        VIXCLS: vixSeries,
        DEXKOUS: krwUsdSeries,
      })
      : (Array.isArray(cached?.records) ? cached.records : []);
    if (!records.length) throw new Error("FRED crisis signal contains no usable records");
    const fredWarning = [
      sources.errors.core && "FRED 경기 지표 갱신 지연",
      sources.errors.vix && "FRED VIX 갱신 지연",
      sources.errors.krwUsd && "FRED 원달러 환율 갱신 지연",
      sources.errors.treasuryYields && "FRED 장단기금리 갱신 지연",
      sources.errors.creditRates && "FRED 미국 신용스프레드 갱신 지연",
      creditRates?.warning,
      yahooVixResult.error && "VIX 최신 시세 보완 지연",
    ].filter(Boolean).join(" / ");
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
        const live = await fetchLiveVkospiRows(env, vkospiRows, now);
        vkospiRows = live.rows;
        livePoint = live.point;
        vkospiLiveCheckedAt = vkospiLiveAttemptedAt;
      } catch (error) {
        const retainedSettlementValue = !nextSourcePlan.stockplusLiveWindow
          && cached?.vkospiLive === true
          && cached?.vkospiLiveDate === checkDate;
        if (!retainedSettlementValue) {
          liveWarning = `증권플러스 VKOSPI 장중 갱신 지연: ${error?.message || error}`;
        }
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
        termSpreadRows.at(-1)?.date || "",
        creditSpreadRows.at(-1)?.date || "",
        vkospiRows.at(-1)?.date || "",
        vixRows.at(-1)?.date || "",
      ].sort().at(-1),
      source: `${hasCurrentLive
        ? (nextSourcePlan.stockplusLiveWindow
          ? "FRED + KRX + Stockplus (intraday)"
          : "FRED + KRX + Stockplus (settlement fallback)")
        : "FRED + KRX"}${vixLiveDate ? " + Yahoo VIX (latest)" : ""}`,
      records,
      termSpreadRows,
      creditSpreadRows,
      creditSpreadSource: creditRates?.source || cached?.creditSpreadSource || "",
      vkospiRows,
      vixRows,
      vixOfficialLatestDate,
      vixLiveCheckedAt: yahooVixResult.rows.length ? Date.now() : Number(cached?.vixLiveCheckedAt || 0),
      vixLiveDate,
      vixSource: vixLiveDate ? "FRED VIXCLS + Yahoo Finance (latest)" : "FRED VIXCLS",
      vkospiCoreWarning: vkospiWarning,
      vkospiOfficialCheckedAt,
      vkospiOfficialEmptyDates: cached?.vkospiOfficialEmptyDates || [],
      vkospiOfficialLatestDate,
      vkospiLiveAttemptedAt,
      vkospiLiveCheckedAt,
      vkospiLiveDate: livePoint?.date || (retainedLive ? cached?.vkospiLiveDate : "") || "",
      vkospiLive: hasCurrentLive,
      warning: combineWarnings(fredWarning, vkospiWarning, liveWarning),
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
  const expectedDate = expectedLatestKofiaDate();
  const refreshDecision = creditCacheRefreshDecision({
    cached,
    expectedDate,
    refresh,
    requiredSchema: CREDIT_CACHE_SCHEMA,
    windowDate,
  });
  const cachedFreshThrough = refreshDecision.freshThrough;
  if (!refreshDecision.needsRefresh) {
    const { warning: _staleSourceWarning, ...cleanCached } = cached;
    return jsonResponse({ ...cleanCached, ok: true, cached: true }, 200, origin);
  }
  try {
    const creditClient = env.BROWSER?.quickAction
      ? createKofiaClient({
        enableIndexergo: true,
        officialFreshThrough: expectedDate,
        cachedFreshThrough,
        indexergoAttempts: 1,
        fetchIndexergoHtml: async (url) => {
          const response = await queuedBrowserQuickAction(env, "content", {
            url,
            cacheTTL: 3600,
            gotoOptions: { waitUntil: "domcontentloaded", timeout: 20000 },
            waitForSelector: { selector: "h1.visually-hidden", timeout: 20000 },
            rejectResourceTypes: ["image", "media", "font"],
          });
          const body = await readBoundedResponseText(
            response,
            INDEXERGO_BROWSER_MAX_BYTES,
            "INDEXerGO Browser Run",
          );
          if (!response.ok) {
            throw createProviderHttpError("INDEXerGO Browser Run", response, body.slice(0, 240));
          }
          try {
            const payload = JSON.parse(body);
            if (payload?.success === true && typeof payload.result === "string") return payload.result;
          } catch (_) {}
          return body;
        },
      })
      : kofiaClient;
    const result = await fetchKofiaCreditAndDepositRows(creditClient, env.KOFIA_API_KEY);
    const rows = result.rows;
    const warnings = [];
    if (result.creditFailed) warnings.push("신용 잔고 연결 실패로 마지막 확인 데이터를 사용합니다.");
    if (result.depositFailed) warnings.push("고객예탁금 연결 실패로 마지막 확인 데이터를 사용합니다.");
    warnings.push(...(result.componentWarnings || []));
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

function normalizeCreditSyncRows(rows, today = koreanDateText()) {
  const earliest = shiftDate(today, -45);
  return mergeCreditRows([], rows)
    .filter((row) => row.date >= earliest && row.date <= today)
    .filter((row) => (
      Number(row.customer_deposit) >= 1 && Number(row.customer_deposit) <= 1000
      && Number(row.kospi_credit) >= 0.1 && Number(row.kospi_credit) <= 200
      && Number(row.kosdaq_credit) >= 0.1 && Number(row.kosdaq_credit) <= 100
    ))
    .slice(-CREDIT_SYNC_MAX_ROWS);
}

async function creditSyncResponse(request, env, origin) {
  if (!env.DISCLOSURE_CACHE) {
    return jsonResponse({ ok: false, error: "신용 동기화 저장소가 없습니다." }, 503, origin);
  }
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > CREDIT_SYNC_MAX_BYTES) {
    return jsonResponse({ ok: false, error: "신용 동기화 데이터가 너무 큽니다." }, 413, origin);
  }
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > CREDIT_SYNC_MAX_BYTES) {
      return jsonResponse({ ok: false, error: "신용 동기화 데이터가 너무 큽니다." }, 413, origin);
    }
    body = JSON.parse(text);
  } catch (_) {
    return jsonResponse({ ok: false, error: "신용 동기화 데이터 형식이 올바르지 않습니다." }, 400, origin);
  }
  const incoming = normalizeCreditSyncRows(body?.rows);
  if (!incoming.length) {
    return jsonResponse({ ok: false, error: "동기화할 유효한 신용 데이터가 없습니다." }, 400, origin);
  }
  const cached = await readCacheBestEffort(
    "credit-sync",
    () => env.DISCLOSURE_CACHE.get(CREDIT_CACHE_KEY, "json"),
  );
  const rows = mergeCreditRows(cached?.rows, incoming).slice(-210);
  const payload = {
    ...(cached?.schema === CREDIT_CACHE_SCHEMA ? cached : {}),
    schema: CREDIT_CACHE_SCHEMA,
    savedAt: Date.now(),
    rows,
    localSyncedAt: Date.now(),
    localSyncedLatestDate: incoming.at(-1).date,
  };
  const failures = await writeCachesBestEffort("credit-sync", [
    () => env.DISCLOSURE_CACHE.put(CREDIT_CACHE_KEY, JSON.stringify(payload)),
  ]);
  if (failures) {
    return jsonResponse({ ok: false, error: "신용 동기화 저장에 실패했습니다." }, 503, origin);
  }
  return jsonResponse({
    ok: true,
    latestDate: rows.at(-1)?.date || "",
    accepted: incoming.length,
  }, 200, origin);
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

async function fetchKrxMarketSnapshot(env, market, endpoint, baseDate, options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const cached = forceRefresh ? null : await readKrxMarketSnapshot(env, market, baseDate);
  if (cached) return cached;
  const requestKey = `${forceRefresh ? "force" : "normal"}:${market}:${baseDate}`;
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

async function fetchLatestKrxStockPoint(env, ticker, today = koreanDateText(), options = {}) {
  const market = String(ticker || "").toUpperCase().endsWith(".KQ") ? "KQ" : "KS";
  const endpoint = market === "KQ" ? "ksq_bydd_trd" : "stk_bydd_trd";
  const stockCode = TICKER_PATTERN.exec(String(ticker || "").trim().toUpperCase())?.[1] || "";
  let lastError = null;
  let marketDate = "";
  let cacheHits = 0;
  const forceDate = isValidIsoDate(String(options.forceDate || ""))
    ? String(options.forceDate).slice(0, 10)
    : today;
  for (let offset = 0; offset <= KRX_LATEST_LOOKBACK_DAYS; offset += 1) {
    const baseDate = shiftDate(today, -offset);
    try {
      const snapshot = await fetchKrxMarketSnapshot(env, market, endpoint, baseDate, {
        forceRefresh: options.forceRefresh === true && baseDate === forceDate,
      });
      if (!snapshot || snapshot.empty) continue;
      if (snapshot.cached) cacheHits += 1;
      if (!marketDate || snapshot.marketDate > marketDate) marketDate = snapshot.marketDate;
      const close = snapshot.prices?.[stockCode];
      if (Number.isFinite(close)) {
        const volume = snapshot.volumes?.[stockCode];
        return {
          point: {
            date: snapshot.marketDate,
            close,
            ...(Number.isFinite(volume) && volume > 0 ? { volume } : {}),
          },
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
  const phase = resolveKoreanResearchUniversePhase(now);
  const { expectedDate, today } = phase;
  const latestKey = `research-universe:${RESEARCH_CACHE_SCHEMA}:${totalLimit}:latest`;
  const latest = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("research-universe-latest", () => env.DISCLOSURE_CACHE.get(latestKey, "json"))
    : null;
  let liveWarning = "";
  if (phase.realtime) {
    try {
      const live = await fetchNaverLiveResearchUniverse(fetch, today, {
        totalLimit,
        priceMode: "realtime",
      });
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
  // KRX daily rows can lag after the close. Capture one final Naver snapshot so
  // provisional signals are either confirmed or removed before KRX settles.
  if (phase.captureClose) {
    if (latest?.schema === RESEARCH_CACHE_SCHEMA
      && latest?.priceMode === "settled"
      && latest?.baseDate === today
      && latest?.records?.length === totalLimit) {
      return jsonResponse({ ...latest, ok: true, cached: true }, 200, origin);
    }
    try {
      const settled = await fetchNaverLiveResearchUniverse(fetch, today, {
        totalLimit,
        priceMode: "settled",
      });
      const payload = {
        ...settled,
        schema: RESEARCH_CACHE_SCHEMA,
        savedAt: Date.now(),
      };
      if (env.DISCLOSURE_CACHE) {
        await writeCachesBestEffort("research-universe-close", [
          () => env.DISCLOSURE_CACHE.put(latestKey, JSON.stringify(payload)),
        ]);
      }
      return jsonResponse({ ...payload, ok: true, cached: false }, 200, origin);
    } catch (error) {
      liveWarning = `장 마감 가격 확인 실패: ${error?.message || error}`;
    }
  }
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
        priceMode: "settled",
        baseDate,
        savedAt: Date.now(),
        selection: { KOSPI: perMarketLimit, KOSDAQ: perMarketLimit },
        records: records.map((record) => ({ ...record, priceMode: "settled" })),
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

async function buildKrxPricePayload(env, ticker, now = new Date(), options = {}) {
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
    krxResult = await fetchLatestKrxStockPoint(env, ticker, today, {
      ...options,
      // KRX daily snapshots settle on expectedDate. During market hours the
      // current day is cross-checked through Naver, so refreshing today's empty
      // KRX slot must not leave the latest settled snapshot cached.
      forceDate: expectedDate,
    });
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

async function krxPriceResponse(env, ticker, origin, forceRefresh = false) {
  try {
    return jsonResponse(await buildKrxPricePayload(env, ticker, new Date(), { forceRefresh }), 200, origin);
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || "KRX 가격 조회에 실패했습니다." }, 503, origin);
  }
}

async function krxBatchPriceResponse(env, tickers, origin, forceRefresh = false) {
  const targets = [...new Set((Array.isArray(tickers) ? tickers : [])
    .map((ticker) => String(ticker || "").trim().toUpperCase())
    .filter((ticker) => TICKER_PATTERN.test(ticker)))].slice(0, 10);
  if (!targets.length) return jsonResponse({ ok: false, error: "종목코드 형식이 올바르지 않습니다." }, 400, origin);
  const now = new Date();
  const results = await Promise.all(targets.map(async (ticker) => {
    try {
      return await buildKrxPricePayload(env, ticker, now, { forceRefresh });
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
  const includeIndices = String(url.searchParams.get("indices") || "1") !== "0";
  const since = String(url.searchParams.get("since") || "").slice(0, 10);
  const responses = await Promise.allSettled([
    includeIndices
      ? krxCoreIndexResponse(env, origin, refresh, since)
      : Promise.resolve(jsonResponse({ ok: false, skipped: true, records: [] }, 200, origin)),
    targets.length
      ? krxBatchPriceResponse(env, targets, origin, refresh)
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







const ROUTE_HANDLERS = Object.freeze({
  "auth-check": ({ origin }) => jsonResponse({ ok: true }, 200, origin),
  "admin-session": ({ request, env, origin }) => (
    adminSessionResponse(request, env, origin, { jsonResponse, tokensMatch })
  ),
  macro: ({ env, origin, url }) => (
    ecosMacroResponse(env, origin, queryFlag(url.searchParams.get("refresh")))
  ),
  credit: ({ env, origin, url }) => (
    creditMacroResponse(env, origin, queryFlag(url.searchParams.get("refresh")))
  ),
  "credit-sync": ({ request, env, origin }) => creditSyncResponse(request, env, origin),
  "crisis-signal": ({ env, origin, url, accessAuthorized }) => crisisSignalResponse(
    env,
    origin,
    accessAuthorized && queryFlag(url.searchParams.get("refresh")),
  ),
  adr: ({ env, origin, url }) => (
    adrMarketResponse(
      env,
      origin,
      queryFlag(url.searchParams.get("refresh")),
      queryFlag(url.searchParams.get("latest")),
    )
  ),
  bootstrap: ({ env, origin, url }) => runtimeBootstrapResponse(env, url, origin),
  indices: ({ env, origin, url }) => krxCoreIndexResponse(
    env,
    origin,
    queryFlag(url.searchParams.get("refresh")),
    url.searchParams.get("since"),
  ),
  "research-universe": ({ env, origin, url }) => researchUniverseResponse(
    env,
    origin,
    queryFlag(url.searchParams.get("refresh")),
    url.searchParams.get("limit"),
  ),
  "research-summary": ({ request, env, origin, url }) => (
    researchSummaryResponse(request, env, url, origin)
  ),
  "prices-batch": ({ env, origin, url }) => krxBatchPriceResponse(
    env,
    String(url.searchParams.get("tickers") || "").split(","),
    origin,
    queryFlag(url.searchParams.get("refresh")),
  ),
  prices: ({ env, ticker, origin, url }) => krxPriceResponse(
    env,
    ticker,
    origin,
    queryFlag(url.searchParams.get("refresh")),
  ),
  "research-history": ({ env, ticker, origin, url }) => researchHistoryResponse(
    env,
    ticker,
    origin,
    {
      sinceDate: url.searchParams.get("since"),
      forceFull: queryFlag(url.searchParams.get("full")),
    },
  ),
  "research-profile": ({ env, ticker, origin }) => researchProfileResponse(env, ticker, origin),
  "forecast-journal": ({ request, env, ticker, origin }) => (
    forecastJournalResponse(request, env, ticker, origin)
  ),
  consensus: ({ env, workerContext, ticker, origin, url }) => companyAnalysisResponse(
    env,
    workerContext,
    ticker,
    origin,
    {
      requireFinancials: false,
      requireNews: false,
      forceRefresh: queryFlag(url.searchParams.get("refresh")),
    },
  ),
  analysis: ({ env, workerContext, ticker, origin, url }) => companyAnalysisResponse(
    env,
    workerContext,
    ticker,
    origin,
    {
      requireFinancials: true,
      requireNews: true,
      forceRefresh: queryFlag(url.searchParams.get("refresh")),
    },
  ),
  "broker-reports": ({ ticker, origin, url }) => brokerReportsResponse(ticker, url, origin),
  "broker-report-pdf": ({ origin, url, workerContext }) => (
    brokerReportPdfResponse(url, origin, workerContext)
  ),
  "eps-history": ({ env, ticker, corpCode, origin, url }) => (
    dartEpsHistoryResponse(env, ticker, corpCode, origin, {
      businessYear: url.searchParams.get("year"),
      force: queryFlag(url.searchParams.get("force")),
    })
  ),
  "insider-trades": ({ env, workerContext, ticker, corpCode, origin, url }) => (
    insiderTradeResponse(
      env,
      workerContext,
      ticker,
      corpCode,
      origin,
      queryFlag(url.searchParams.get("force")),
    )
  ),
  "dart-disclosures": ({ env, workerContext, ticker, corpCode, origin, url }) => (
    dartDisclosureResponse({
      env,
      ctx: workerContext,
      ticker,
      corpCode,
      origin,
      url,
      force: queryFlag(url.searchParams.get("force")),
      progressive: queryFlag(url.searchParams.get("progressive")),
    })
  ),
});

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
      analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
      financialSummaryVersion: FINANCIAL_SUMMARY_VERSION,
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
  const ticker = String(url.searchParams.get("ticker") || "").trim().toUpperCase();
  if (route.ticker && !TICKER_PATTERN.test(ticker)) {
    return jsonResponse({ ok: false, error: "종목코드 형식이 올바르지 않습니다." }, 400, origin);
  }
  if (route.provider === "dart" && !env.DART_API_KEY) {
    return jsonResponse({ ok: false, error: "Cloudflare에 DART 키가 설정되지 않았습니다." }, 503, origin);
  }

  const corpCode = String(url.searchParams.get("corpCode") || "").trim();
  if (route.corpCode && !CORP_CODE_PATTERN.test(corpCode)) {
    return jsonResponse({ ok: false, error: "종목 또는 DART 회사코드 형식이 올바르지 않습니다." }, 400, origin);
  }

  const routedResponse = dispatchRequestRoute(route, ROUTE_HANDLERS, {
    request,
    env,
    workerContext: ctx,
    origin,
    url,
    ticker,
    corpCode,
    accessAuthorized,
  });
  if (routedResponse) return routedResponse;
  return jsonResponse({ ok: false, error: "Not found" }, 404, origin);
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
