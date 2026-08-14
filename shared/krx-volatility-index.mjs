const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const API_DATE_PATTERN = /^\d{8}$/;

export const KRX_VKOSPI_START_DATE = "2010-01-04";
import {
  isKoreanCurrentPriceWindow,
  koreanDateText,
} from "./market-calendar.mjs";
import { compareProviderSeries, planSeriesRepairDates } from "./series-integrity.mjs";

export const KRX_VKOSPI_NAME = "코스피 200 변동성지수";
export const KRX_VKOSPI_ENDPOINT = "https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd";
export const STOCKPLUS_VKOSPI_SECURITY_ID = "KOREA-O2901P";
export const STOCKPLUS_VKOSPI_ENDPOINT = `https://mweb-api.stockplus.com/api/securities/${STOCKPLUS_VKOSPI_SECURITY_ID}/day_candles.json`;
export const STOCKPLUS_VKOSPI_PAGE_URL = `https://www.stockplus.com/m/stocks/${STOCKPLUS_VKOSPI_SECURITY_ID}`;

export function planVkospiSource(now = new Date(), officialLatestDate = "") {
  const today = koreanDateText(now);
  const stockplusLiveWindow = isKoreanCurrentPriceWindow(now, {
    openHour: 8,
    openMinute: 0,
    closeHour: 16,
    closeMinute: 0,
  });
  const settlementWindow = isKoreanCurrentPriceWindow(now, {
    openHour: 16,
    openMinute: 0,
    closeHour: 23,
    closeMinute: 59,
  });
  const officialCurrent = String(officialLatestDate || "").slice(0, 10) === today;
  return Object.freeze({
    today,
    officialCurrent,
    settlementWindow,
    stockplusLiveWindow,
    useStockplus: stockplusLiveWindow || (settlementWindow && !officialCurrent),
    priority: stockplusLiveWindow ? "stockplus" : "krx",
  });
}

function compactName(value) {
  return String(value || "").toUpperCase().replace(/[\s_-]+/g, "");
}

function finiteNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function daysBetween(left, right) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? Math.round((rightTime - leftTime) / 86400000)
    : Infinity;
}

function isoDate(value) {
  const text = String(value || "").trim();
  if (DATE_PATTERN.test(text)) return text;
  if (!API_DATE_PATTERN.test(text)) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export function apiDate(value) {
  const date = isoDate(value);
  return date ? date.replace(/-/g, "") : "";
}

export function normalizeVkospiRows(rows) {
  const byDate = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const date = isoDate(raw?.date ?? raw?.BAS_DD);
    const vkospi = finiteNumber(raw?.vkospi ?? raw?.CLSPRC_IDX ?? raw?.TDD_CLSPRC ?? raw?.CLSPRC);
    if (!date || vkospi === null || vkospi <= 0) continue;
    const row = { date, vkospi };
    for (const [target, source] of [
      ["vkospiOpen", raw?.vkospiOpen ?? raw?.OPNPRC_IDX],
      ["vkospiHigh", raw?.vkospiHigh ?? raw?.HGPRC_IDX],
      ["vkospiLow", raw?.vkospiLow ?? raw?.LWPRC_IDX],
    ]) {
      const value = finiteNumber(source);
      if (value !== null && value > 0) row[target] = value;
    }
    byDate.set(date, row);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function vkospiRowsFromStockplusPayload(payload, options = {}) {
  const from = isoDate(options.from) || KRX_VKOSPI_START_DATE;
  const to = isoDate(options.to) || "9999-12-31";
  const rows = (Array.isArray(payload?.dayCandles) ? payload.dayCandles : []).flatMap((raw) => {
    const date = isoDate(String(raw?.date || "").slice(0, 10));
    const vkospi = finiteNumber(raw?.tradePrice);
    return date && date >= from && date <= to && vkospi !== null && vkospi > 0
      ? [{ date, vkospi }]
      : [];
  });
  return normalizeVkospiRows(rows);
}

export function vkospiPointFromStockplusPayload(payload, options = {}) {
  const expectedDate = isoDate(options.expectedDate);
  const point = vkospiRowsFromStockplusPayload(payload, {
    from: "1900-01-01",
    to: "9999-12-31",
  }).at(-1) || null;
  return expectedDate && point?.date !== expectedDate ? null : point;
}

export function compareVkospiOverlap(primaryRows, fallbackRows, options = {}) {
  const comparison = compareProviderSeries(
    normalizeVkospiRows(primaryRows),
    normalizeVkospiRows(fallbackRows),
    {
      key: "vkospi",
      relativeTolerance: Math.max(0, Number(options.relativeTolerance) || 0.005),
      absoluteTolerance: Math.max(0, Number(options.absoluteTolerance) || 0.02),
    },
  );
  return {
    overlapCount: comparison.overlapCount,
    mismatches: comparison.mismatches.map((entry) => ({
      date: entry.date,
      primary: entry.primary,
      fallback: entry.secondary,
    })),
  };
}

export function withVkospiChanges(rows, options = {}) {
  const window = Math.max(1, Math.round(Number(options.window) || 20));
  const maximumCalendarGap = Math.max(window, Math.round(Number(options.maximumCalendarGap) || 45));
  const normalized = normalizeVkospiRows(rows);
  return normalized.map((row, index) => {
    const previous = normalized[index - window];
    if (!previous || daysBetween(previous.date, row.date) > maximumCalendarGap) return row;
    return {
      ...row,
      vkospiChange20: (row.vkospi / previous.vkospi) - 1,
    };
  });
}

export function mergeVkospiRows(...sources) {
  return withVkospiChanges(sources.flatMap((rows) => (Array.isArray(rows) ? rows : [])));
}

export function mergeVkospiFallbackRows(primaryRows, fallbackRows, options = {}) {
  const primary = normalizeVkospiRows(primaryRows);
  const primaryDates = new Set(primary.map((row) => row.date));
  const liveDate = isoDate(options.liveDate);
  const additions = normalizeVkospiRows(fallbackRows).filter((row) => (
    !primaryDates.has(row.date) || row.date === liveDate
  ));
  return mergeVkospiRows(primary, additions);
}

export function vkospiBackfillDates(latestCachedDate, targetDate, options = {}) {
  const target = isoDate(targetDate);
  if (!target) return [];
  const maxDates = Math.max(1, Math.min(30, Math.round(Number(options.maxDates) || 10)));
  const initialLookbackDays = Math.max(
    1,
    Math.min(60, Math.round(Number(options.initialLookbackDays) || 14)),
  );
  return planSeriesRepairDates(options.rows, "vkospi", target, {
    latestKnownDate: isoDate(latestCachedDate),
    lookbackDays: initialLookbackDays,
    maxDates,
    excludeDates: options.excludeDates,
    referenceDates: options.referenceDates,
  });
}

export function shouldRememberEmptyVkospiDate(date, referenceDate, options = {}) {
  const candidate = isoDate(date);
  const reference = isoDate(referenceDate);
  const graceDays = Math.max(1, Math.min(30, Math.round(Number(options.graceDays) || 7)));
  return Boolean(candidate && reference && daysBetween(candidate, reference) >= graceDays);
}

export function vkospiPointFromRows(rows) {
  const expected = compactName(KRX_VKOSPI_NAME);
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = compactName(row?.IDX_NM ?? row?.IDX_NM_KOR ?? row?.IDX_NM_ENG);
    if (name !== expected && !name.includes("KOSPI200변동성지수")) continue;
    const date = isoDate(row?.BAS_DD);
    const close = finiteNumber(row?.CLSPRC_IDX ?? row?.TDD_CLSPRC ?? row?.CLSPRC);
    if (!date || close === null || close <= 0) continue;
    const point = { date, vkospi: close };
    const open = finiteNumber(row?.OPNPRC_IDX);
    const high = finiteNumber(row?.HGPRC_IDX);
    const low = finiteNumber(row?.LWPRC_IDX);
    if (open !== null && open > 0) point.vkospiOpen = open;
    if (high !== null && high > 0) point.vkospiHigh = high;
    if (low !== null && low > 0) point.vkospiLow = low;
    return point;
  }
  return null;
}

export async function fetchStockplusVkospiRows(fetchImpl, options = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const limit = Math.max(1, Math.min(30, Math.round(Number(options.limit) || 10)));
  const endpoint = new URL(String(options.endpoint || STOCKPLUS_VKOSPI_ENDPOINT));
  endpoint.searchParams.set("limit", String(limit));
  const response = await fetchImpl(endpoint.toString(), {
    headers: {
      accept: "application/json",
      ...(options.headers || {}),
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Stockplus VKOSPI HTTP ${response.status}`);
    error.code = "STOCKPLUS_VKOSPI_HTTP_ERROR";
    error.status = response.status;
    error.retryable = response.status === 403 || response.status === 429 || response.status >= 500;
    throw error;
  }
  const rows = vkospiRowsFromStockplusPayload(payload, {
    from: options.from,
    to: options.to,
  });
  const expectedDate = isoDate(options.expectedDate);
  if (!rows.length || (expectedDate && rows.at(-1)?.date !== expectedDate)) {
    const error = new Error("Stockplus VKOSPI response has no current value");
    error.code = "STOCKPLUS_VKOSPI_EMPTY";
    error.retryable = true;
    throw error;
  }
  return rows;
}

export async function fetchStockplusVkospiPoint(fetchImpl, options = {}) {
  const rows = await fetchStockplusVkospiRows(fetchImpl, {
    ...options,
    limit: options.limit ?? 2,
  });
  return rows.at(-1) || null;
}

export async function fetchKrxVkospiPoint(fetchImpl, apiKey, date, options = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const key = String(apiKey || "").trim();
  const baseDate = apiDate(date);
  if (!key) throw new Error("KRX API key is required");
  if (!baseDate) throw new Error("VKOSPI date must use YYYY-MM-DD format");
  const endpoint = String(options.endpoint || KRX_VKOSPI_ENDPOINT);
  const response = await fetchImpl(`${endpoint}?basDd=${baseDate}`, {
    headers: { AUTH_KEY: key },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const payload = await response.json().catch(() => null);
  const unauthorized = response.status === 401 || String(payload?.respCode || "") === "401";
  if (unauthorized) {
    const error = new Error("KRX 파생상품지수 시세정보 이용신청이 필요합니다.");
    error.code = "KRX_VKOSPI_UNAUTHORIZED";
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`KRX VKOSPI HTTP ${response.status}`);
    error.code = "KRX_VKOSPI_HTTP_ERROR";
    error.status = response.status;
    error.retryable = response.status === 403 || response.status === 429 || response.status >= 500;
    throw error;
  }
  return vkospiPointFromRows(payload?.OutBlock_1);
}
