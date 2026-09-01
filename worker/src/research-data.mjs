import {
  expectedLatestKoreanTradingDate,
  inspectDailyPriceHistoryDensity,
  isKoreanMarketPricePoint,
  isKoreanTradingDate,
  shiftIsoDate,
} from "../../shared/market-calendar.mjs";
import { parseNaverResearchProfile } from "../../shared/research-profile.mjs";
import { normalizeResearchUniverseSize } from "../../shared/research-universe-live.mjs";
import {
  RESEARCH_SUMMARY_BODY_LIMIT,
  normalizeResearchMinimum,
  normalizeResearchStrategy,
  normalizeResearchSummary,
  researchSummaryCacheKey,
} from "../../shared/stock-research-summary.mjs";
import summaryQuality from "../../shared/stock-research-summary-quality.js";
import {
  apiDate,
  jsonResponse,
  readCacheBestEffort,
  shiftDate,
  writeCachesBestEffort,
  yearsBefore,
} from "./http-runtime.mjs";
import { krxNumber, krxStockCode } from "./market-data.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const {
  researchSummaryIsPublishable,
  shouldPreferResearchSummary,
} = summaryQuality;
const RESEARCH_TICKER_PATTERN = /^(\d{6})\.(KS|KQ)$/;
const NAVER_RESEARCH_HISTORY_URL = "https://fchart.stock.naver.com/sise.nhn";
const NAVER_RESEARCH_PROFILE_URL = "https://finance.naver.com/item/main.naver";
const MAX_NAVER_RESEARCH_HISTORY_BYTES = 1024 * 1024;
const MAX_NAVER_RESEARCH_PROFILE_BYTES = 512 * 1024;

export const RESEARCH_CACHE_SCHEMA = 1;
export const RESEARCH_CACHE_TTL_SECONDS = 45 * 24 * 60 * 60;
export const RESEARCH_SUMMARY_TTL_SECONDS = 180 * 24 * 60 * 60;
export const RESEARCH_HISTORY_CACHE_SCHEMA = 2;
export const RESEARCH_HISTORY_QUALITY_VERSION = 2;
export const RESEARCH_HISTORY_COVERAGE_VERSION = 2;
export const RESEARCH_HISTORY_OVERLAP_DAYS = 21;
export const RESEARCH_HISTORY_YEARS = 5;
export const FULL_RESEARCH_HISTORY_YEARS = 30;
export const RESEARCH_PROFILE_FRESH_MS = 30 * 24 * 60 * 60 * 1000;

function validDate(value) {
  const date = String(value || "").slice(0, 10);
  return DATE_PATTERN.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));
}

export function normalizeResearchUniverseRows(rows, market, limit) {
  const suffix = market === "KOSDAQ" ? "KQ" : "KS";
  const byTicker = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const code = krxStockCode(row?.ISU_CD, row?.ISU_SRT_CD);
    const name = String(row?.ISU_NM || row?.ISU_ABBRV || "").trim();
    const marketCap = krxNumber(row?.MKTCAP);
    const tradeValue = krxNumber(row?.ACC_TRDVAL ?? row?.ACC_TRDVAL_AMT);
    const close = krxNumber(row?.TDD_CLSPRC ?? row?.CLSPRC);
    if (!code || !name || !Number.isFinite(marketCap) || marketCap <= 0) return;
    const ticker = `${code}.${suffix}`;
    const candidate = { ticker, code, name, market, marketCap, tradeValue, close };
    const previous = byTicker.get(ticker);
    if (!previous || candidate.marketCap > previous.marketCap) byTicker.set(ticker, candidate);
  });
  return [...byTicker.values()]
    .sort((left, right) => right.marketCap - left.marketCap || left.ticker.localeCompare(right.ticker))
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function parseNaverResearchHistory(text) {
  const byDate = new Map();
  for (const match of String(text || "").matchAll(/<item\s+data="(\d{8})\|[^|]*\|[^|]*\|[^|]*\|([^|]+)\|([^"]+)"/g)) {
    const rawDate = match[1];
    const close = krxNumber(match[2]);
    const volume = krxNumber(match[3]);
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    if (!validDate(date)
      || !Number.isFinite(close)
      || close <= 0
      || !isKoreanMarketPricePoint(date, volume)) continue;
    byDate.set(date, { date, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : null });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function normalizeResearchHistoryRows(sourceRows) {
  const byDate = new Map();
  (Array.isArray(sourceRows) ? sourceRows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const close = Number(row?.close);
    const volume = row?.volume == null || String(row.volume).trim() === ""
      ? null
      : Number(row.volume);
    if (!validDate(date)
      || !Number.isFinite(close)
      || close <= 0
      || !isKoreanMarketPricePoint(date, volume)) return;
    byDate.set(date, {
      date,
      close,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
    });
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function detectResearchHistoryRebase(existingRows, incomingRows, threshold = 1.8) {
  const existingByDate = new Map((Array.isArray(existingRows) ? existingRows : [])
    .map((row) => [String(row?.date || ""), Number(row?.close)]));
  const ratios = (Array.isArray(incomingRows) ? incomingRows : []).flatMap((row) => {
    const existing = existingByDate.get(String(row?.date || ""));
    const incoming = Number(row?.close);
    return Number.isFinite(existing) && existing > 0 && Number.isFinite(incoming) && incoming > 0
      ? [existing / incoming]
      : [];
  }).sort((left, right) => left - right);
  if (ratios.length < 3) return false;
  const middle = Math.floor(ratios.length / 2);
  const medianRatio = ratios.length % 2
    ? ratios[middle]
    : (ratios[middle - 1] + ratios[middle]) / 2;
  if (medianRatio < threshold && medianRatio > (1 / threshold)) return false;
  const relativeDeviation = ratios.reduce((sum, ratio) => (
    sum + Math.abs((ratio / medianRatio) - 1)
  ), 0) / ratios.length;
  return relativeDeviation <= 0.04;
}

export function mergeResearchHistoryRows(existingRows, incomingRows, cutoffDate = "") {
  const cutoff = validDate(cutoffDate) ? cutoffDate : "";
  return normalizeResearchHistoryRows([
    ...(Array.isArray(existingRows) ? existingRows : []),
    ...(Array.isArray(incomingRows) ? incomingRows : []),
  ]).filter((row) => !cutoff || row.date >= cutoff);
}

export function researchHistoryPointFromUniverse(existingRows, universeItem, targetDate, threshold = 1.8) {
  const rows = normalizeResearchHistoryRows(existingRows);
  const latest = rows.at(-1);
  const date = String(universeItem?.date || universeItem?.baseDate || "").slice(0, 10);
  const expected = String(targetDate || "").slice(0, 10);
  const close = Number(universeItem?.close);
  const latestClose = Number(latest?.close);
  if (!latest
    || date !== expected
    || !Number.isFinite(close)
    || close <= 0
    || !Number.isFinite(latestClose)
    || latestClose <= 0
    || !isKoreanMarketPricePoint(date, universeItem?.volume)) return null;
  const ratio = close / latestClose;
  if (ratio >= threshold || ratio <= (1 / threshold)) return null;
  const volume = Number(universeItem?.volume);
  return {
    date,
    close,
    volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
  };
}

function expectedTradingDatesAfter(anchorDate, targetDate) {
  const anchor = String(anchorDate || "").slice(0, 10);
  const target = String(targetDate || "").slice(0, 10);
  if (!validDate(anchor) || !validDate(target) || anchor >= target) return [];
  const dates = [];
  for (let date = shiftIsoDate(anchor, 1); date && date <= target; date = shiftIsoDate(date, 1)) {
    if (isKoreanTradingDate(date)) dates.push(date);
  }
  return dates;
}

export function appendableResearchUniversePoint(existingRows, universeItem, targetDate, options = {}) {
  const rows = normalizeResearchHistoryRows(existingRows);
  const latestDate = rows.at(-1)?.date || "";
  const verifiedThrough = String(options.verifiedThrough || "").slice(0, 10);
  const anchorDate = validDate(verifiedThrough) && verifiedThrough >= latestDate
    ? verifiedThrough
    : latestDate;
  const expectedDates = expectedTradingDatesAfter(anchorDate, targetDate);
  if (expectedDates.length !== 1 || expectedDates[0] !== String(targetDate || "").slice(0, 10)) {
    return null;
  }
  return researchHistoryPointFromUniverse(rows, universeItem, targetDate, options.threshold);
}

export function researchHistoryCacheIsCurrent(cached, targetDate, options = {}) {
  const rows = normalizeResearchHistoryRows(cached?.rows);
  const fullHistory = options.fullHistory === true;
  return cached?.schema === RESEARCH_HISTORY_CACHE_SCHEMA
    && Number(cached?.historyQualityVersion) === RESEARCH_HISTORY_QUALITY_VERSION
    && String(cached?.historyValidationDate || "").slice(0, 10) === String(targetDate || "").slice(0, 10)
    && rows.length >= 252
    && (!fullHistory || (
      String(cached?.historyCoverage || "").toLowerCase() === "full"
      && Number(cached?.historyCoverageVersion) === RESEARCH_HISTORY_COVERAGE_VERSION
    ));
}

export function projectResearchHistoryPayload(
  payload,
  sinceDate = "",
  forceFull = false,
  overlapDays = 35,
) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const since = String(sinceDate || "").slice(0, 10);
  const latestDate = String(payload?.latestDate || rows.at(-1)?.date || "").slice(0, 10);
  const validSince = validDate(since) && since <= latestDate;
  const reset = payload?.rebased === true && validSince && !forceFull;
  if (forceFull || !validSince || reset) {
    return {
      ...payload,
      partial: false,
      reset,
      fullRowCount: rows.length,
    };
  }
  const overlapStart = shiftIsoDate(since, -Math.max(7, Number(overlapDays) || 35));
  return {
    ...payload,
    rows: rows.filter((row) => String(row?.date || "") >= overlapStart),
    partial: true,
    reset: false,
    overlapStart,
    fullRowCount: rows.length,
  };
}

async function readBoundedFetchText(response, maximumBytes, label) {
  const announcedSize = Number(response.headers.get("Content-Length") || 0);
  if (announcedSize > maximumBytes) throw new Error(`${label} response is too large`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error(`${label} response is too large`);
  return new TextDecoder().decode(bytes);
}

async function fetchNaverResearchHistory(ticker, startDate, endDate) {
  const code = RESEARCH_TICKER_PATTERN.exec(ticker)?.[1] || "";
  const query = new URLSearchParams({
    symbol: code,
    timeframe: "day",
    startTime: apiDate(startDate),
    endTime: apiDate(endDate),
    requestType: "1",
  });
  const response = await fetch(`${NAVER_RESEARCH_HISTORY_URL}?${query}`);
  if (!response.ok) throw new Error(`Naver history HTTP ${response.status}`);
  return parseNaverResearchHistory(await readBoundedFetchText(
    response,
    MAX_NAVER_RESEARCH_HISTORY_BYTES,
    "Naver history",
  ));
}

export async function researchHistoryResponse(env, ticker, origin, options = {}) {
  const today = expectedLatestKoreanTradingDate(new Date());
  const sinceDate = String(options.sinceDate || "").slice(0, 10);
  const forceFull = options.forceFull === true;
  const historyYears = forceFull ? FULL_RESEARCH_HISTORY_YEARS : RESEARCH_HISTORY_YEARS;
  const cacheKey = forceFull
    ? `research-history:${RESEARCH_HISTORY_CACHE_SCHEMA}:full:${ticker}`
    : `research-history:${RESEARCH_HISTORY_CACHE_SCHEMA}:${ticker}`;
  const cached = env.DISCLOSURE_CACHE
    ? await readCacheBestEffort("research-history", () => env.DISCLOSURE_CACHE.get(cacheKey, "json"))
    : null;
  const requiresFullBackfill = forceFull && (
    String(cached?.historyCoverage || "").trim().toLowerCase() !== "full"
    || Number(cached?.historyCoverageVersion) !== RESEARCH_HISTORY_COVERAGE_VERSION
  );
  if (researchHistoryCacheIsCurrent(cached, today, { fullHistory: forceFull })) {
    return jsonResponse(projectResearchHistoryPayload(
      { ...cached, rows: normalizeResearchHistoryRows(cached.rows), ok: true, cached: true },
      sinceDate,
      forceFull,
    ), 200, origin);
  }
  try {
    const existingRows = normalizeResearchHistoryRows(cached?.rows);
    const latestDate = existingRows.at(-1)?.date || "";
    const startDate = requiresFullBackfill
      ? yearsBefore(today, historyYears)
      : latestDate
      ? shiftDate(latestDate, -RESEARCH_HISTORY_OVERLAP_DAYS)
      : yearsBefore(today, historyYears);
    let incoming = await fetchNaverResearchHistory(ticker, startDate, today);
    let mergeBase = requiresFullBackfill ? [] : existingRows;
    let rebased = false;
    if (existingRows.length && detectResearchHistoryRebase(existingRows, incoming)) {
      incoming = await fetchNaverResearchHistory(ticker, yearsBefore(today, historyYears), today);
      mergeBase = [];
      rebased = true;
    }
    const rows = mergeResearchHistoryRows(
      mergeBase,
      incoming,
      yearsBefore(today, historyYears),
    );
    if (rows.length < 252) {
      const error = new Error("가격 이력이 1년 미만입니다.");
      error.code = "insufficient-history";
      error.status = 422;
      throw error;
    }
    if (forceFull) {
      const olderDensity = inspectDailyPriceHistoryDensity(rows, {
        beforeDate: yearsBefore(today, RESEARCH_HISTORY_YEARS),
      });
      if (!olderDensity.dense) throw new Error("Full price history is not daily data");
    }
    const payload = {
      schema: RESEARCH_HISTORY_CACHE_SCHEMA,
      ticker,
      asOfDate: today,
      latestDate: rows.at(-1).date,
      historyValidationDate: today,
      historyQualityVersion: RESEARCH_HISTORY_QUALITY_VERSION,
      savedAt: Date.now(),
      rebased,
      historyCoverage: forceFull ? "full" : "partial",
      historyCoverageVersion: RESEARCH_HISTORY_COVERAGE_VERSION,
      rows,
    };
    if (env.DISCLOSURE_CACHE) {
      await writeCachesBestEffort("research-history", [
        () => env.DISCLOSURE_CACHE.put(cacheKey, JSON.stringify(payload), {
          expirationTtl: RESEARCH_CACHE_TTL_SECONDS,
        }),
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
    return jsonResponse({
      ok: false,
      code: String(error?.code || ""),
      error: `${ticker} 가격 이력 조회 실패: ${error?.message || error}`,
    }, error?.status || 503, origin);
  }
}

async function fetchNaverResearchProfile(ticker) {
  const code = RESEARCH_TICKER_PATTERN.exec(ticker)?.[1] || "";
  const response = await fetch(`${NAVER_RESEARCH_PROFILE_URL}?code=${encodeURIComponent(code)}`);
  if (!response.ok) throw new Error(`Naver profile HTTP ${response.status}`);
  const profile = parseNaverResearchProfile(await readBoundedFetchText(
    response,
    MAX_NAVER_RESEARCH_PROFILE_BYTES,
    "Naver profile",
  ), ticker);
  if (!profile.category) throw new Error("업종 분류가 없습니다.");
  return profile;
}

export async function researchProfileResponse(env, ticker, origin) {
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
    if (cached?.category) {
      return jsonResponse({ ...cached, ok: true, cached: true, stale: true }, 200, origin);
    }
    return jsonResponse({
      ok: false,
      error: `${ticker} 업종 조회 실패: ${error?.message || error}`,
    }, 503, origin);
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
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    const error = new Error("Research summary body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

export async function researchSummaryResponse(request, env, url, origin) {
  if (!env.DISCLOSURE_CACHE) {
    return jsonResponse({
      ok: false,
      error: "Research summary storage is not configured",
    }, 503, origin);
  }
  const strategy = normalizeResearchStrategy(url.searchParams.get("strategy"));
  const minimum = normalizeResearchMinimum(url.searchParams.get("minimum"));
  const universeSize = normalizeResearchUniverseSize(url.searchParams.get("size"));
  const key = researchSummaryCacheKey(strategy, minimum, universeSize);
  if (!key) {
    return jsonResponse({ ok: false, error: "Research strategy is invalid" }, 400, origin);
  }
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
    if (!summary) {
      return jsonResponse({ ok: false, error: "종목탐구 요약 형식이 올바르지 않습니다." }, 400, origin);
    }
    const existingValue = await env.DISCLOSURE_CACHE.get(key, "json");
    const existing = normalizeResearchSummary(existingValue, { strategy, minimum, universeSize });
    if (!researchSummaryIsPublishable(summary)) {
      return existing
        ? jsonResponse({
            ok: true,
            cached: true,
            accepted: false,
            warning: "불완전한 종목탐구 결과를 저장하지 않았습니다.",
            ...existing,
          }, 200, origin)
        : jsonResponse({ ok: false, error: "종목탐구 성공 종목이 부족합니다." }, 409, origin);
    }
    if (existing && !shouldPreferResearchSummary(summary, existing)) {
      return jsonResponse({ ok: true, cached: true, accepted: false, ...existing }, 200, origin);
    }
    await env.DISCLOSURE_CACHE.put(key, JSON.stringify(summary), {
      expirationTtl: RESEARCH_SUMMARY_TTL_SECONDS,
    });
    return jsonResponse({ ok: true, cached: false, accepted: true, ...summary }, 200, origin);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error?.message || "종목탐구 요약 저장 실패",
    }, error?.status || 503, origin);
  }
}
