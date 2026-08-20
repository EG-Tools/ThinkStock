import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  mergeIndexRecords,
  normalizeRuntimePayload,
} from "../shared/runtime-data-contract.mjs";
import {
  expectedLatestKoreanTradingDate,
  isKoreanCurrentPriceWindow,
  koreanDateText,
} from "../shared/market-calendar.mjs";
import {
  executeRuntimeSourcePlan,
  sourcePolicy,
} from "../shared/runtime-freshness-policy.mjs";
import {
  runtimeJsonHeaders,
} from "../shared/runtime-api-contract.mjs";
import {
  evaluateNaverPriceFallback,
  parseNaverPriceSeries,
  validateNaverPriceTail,
} from "../shared/naver-market-price.mjs";
import { parseAdrChartRows } from "../shared/adr-data.mjs";
import {
  fetchStockplusVkospiRows,
  mergeVkospiFallbackRows,
  mergeVkospiRows,
  planVkospiSource,
} from "../shared/krx-volatility-index.mjs";
import {
  fetchYahooVixRows,
  mergeVixRows,
} from "../shared/vix-market-data.mjs";
import { parseNaverResearchProfile } from "../shared/research-profile.mjs";
import {
  RESEARCH_UNIVERSE_DEFAULT_SIZE,
  fetchNaverLiveResearchUniverse,
  normalizeResearchUniverseSize,
  researchUniversePerMarketLimit,
} from "../shared/research-universe-live.mjs";
import {
  createKofiaClient,
  creditRefreshWindowDate,
  fetchKofiaCreditAndDepositRows,
  mergeCreditRows,
} from "../worker/src/kofia-client.mjs";
import { fetchFredSeries } from "../worker/src/crisis-signal.mjs";
import {
  RESEARCH_SUMMARY_BODY_LIMIT,
  normalizeResearchMinimum,
  normalizeResearchStrategy,
  normalizeResearchSummary,
} from "../shared/stock-research-summary.mjs";
import {
  DART_DISCLOSURE_MAX_PAGES,
  DART_DISCLOSURE_TYPES,
  recordFromDartItem,
} from "../shared/dart-disclosure.mjs";
import {
  buildHankyungReportListUrl,
  buildHankyungReportPdfUrl,
  buildNaverReportListUrl,
  buildNaverReportPdfUrl,
  decodeNaverReportListBytes,
  parseHankyungReportListHtml,
  parseNaverReportListHtml,
  reportAgeDays,
} from "../shared/broker-report-source.mjs";
import {
  readBoundedResponseBytes,
  readBoundedResponseText,
} from "../worker/src/http-runtime.mjs";


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SOURCE_PATH = fileURLToPath(import.meta.url);
const DOCS_DIR = path.join(ROOT, "docs");
const ENV_FILE = path.join(ROOT, ".env.local");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "dart");
const PAGES_DATA_CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "pages-data");
const STOCK_RESEARCH_CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "stock-research");
const CORP_CODE_DIR = path.join(DOCS_DIR, "data", "dart_corp_codes");
const PAGES_DATA_BASE_URL = "https://eg-tools.github.io/ThinkStock/data/";
const THINKSTOCK_WORKER_URL = "https://thinkstock-api.keg0320.workers.dev";
const ADR_SOURCE_URL = "http://www.adrinfo.kr/chart";
const FEAR_GREED_SOURCE_URL = "https://kospi.feargreedchart.com/api/?action=kospi";
const DART_DISCLOSURE_URL = "https://opendart.fss.or.kr/api/list.json";
const DISCLOSURE_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const TICKER_PATTERN = /^(\d{6})\.(KS|KQ)$/;
const KRX_INDEX_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis/idx";
const KRX_STOCK_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis/sto";
const NAVER_MARKET_PRICE_URL = "https://api.finance.naver.com/siseJson.naver";
const NAVER_STOCK_HISTORY_URL = "https://fchart.stock.naver.com/sise.nhn";
const NAVER_STOCK_PROFILE_URL = "https://finance.naver.com/item/main.naver";
const STOCK_RESEARCH_LIMIT = RESEARCH_UNIVERSE_DEFAULT_SIZE / 2;
const STOCK_RESEARCH_PROFILE_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NAVER_PROFILE_BYTES = 512 * 1024;
const BROKER_REPORT_LIST_MAX_BYTES = 2 * 1024 * 1024;
const BROKER_REPORT_PDF_MAX_BYTES = 12 * 1024 * 1024;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};


export function parseEnvText(text) {
  const values = {};
  String(text || "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return;
    const splitAt = line.indexOf("=");
    const key = line.slice(0, splitAt).trim();
    const value = line.slice(splitAt + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key) values[key] = value;
  });
  return values;
}

export function isPrivateAddress(rawAddress) {
  let address = String(rawAddress || "").trim().toLowerCase();
  if (address.startsWith("::ffff:")) address = address.slice(7);
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) {
    return true;
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function isLoopbackAddress(rawAddress) {
  let address = String(rawAddress || "").trim().toLowerCase();
  if (address.startsWith("::ffff:")) address = address.slice(7);
  return address === "::1" || address === "127.0.0.1";
}

export function isAllowedOrigin(rawOrigin) {
  const origin = String(rawOrigin || "").trim();
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol)
      && (parsed.hostname === "localhost" || isPrivateAddress(parsed.hostname));
  } catch (_) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateYearsBefore(years) {
  const now = new Date();
  const month = now.getUTCMonth();
  const date = new Date(Date.UTC(now.getUTCFullYear() - years, month, now.getUTCDate()));
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function todayApiDate() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function shiftIsoDate(dateText, days) {
  const time = Date.parse(`${String(dateText || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time)) return "";
  return new Date(time + Number(days || 0) * 86400000).toISOString().slice(0, 10);
}

function krxIndexNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(number) ? number : null;
}

export function localKrxIndexPointFromRows(rows, market) {
  const expected = String(market || "").toUpperCase() === "KOSPI"
    ? ["KOSPI", "\uCF54\uC2A4\uD53C"]
    : ["KOSDAQ", "\uCF54\uC2A4\uB2E5"];
  let best = null;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rawDate = String(row?.BAS_DD || "");
    const date = /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : "";
    const close = krxIndexNumber(row?.CLSPRC_IDX ?? row?.TDD_CLSPRC ?? row?.CLSPRC);
    const name = String(row?.IDX_NM ?? row?.IDX_NM_KOR ?? row?.IDX_NM_ENG ?? "")
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!date || close === null || close <= 0) return;
    const exact = expected.some((value) => name === value);
    const partial = expected.some((value) => name.includes(value));
    const score = exact ? 100 : (partial ? 50 : 0);
    if (!score) return;
    if (!best || score > best.score) best = { date, close, score };
  });
  return best ? { date: best.date, close: best.close } : null;
}

export async function fetchLocalKrxCoreIndices(fetchImpl, apiKey, now = new Date(), options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("KRX API key is missing");
  const expectedDate = expectedLatestKoreanTradingDate(now);
  const today = koreanDateText(now);
  const currentPriceWindow = isKoreanCurrentPriceWindow(now);
  const historySince = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.since || ""))
    ? String(options.since)
    : "";
  const targets = [
    { market: "KOSPI", ticker: "^KS11", endpoint: "kospi_dd_trd", naverSymbol: "KOSPI" },
    { market: "KOSDAQ", ticker: "^KQ11", endpoint: "kosdaq_dd_trd", naverSymbol: "KOSDAQ" },
  ];
  const baseResults = await Promise.allSettled(targets.map(async (target) => {
    let lastError = null;
    for (let offset = 0; offset <= 10; offset += 1) {
      const baseDate = shiftIsoDate(expectedDate, -offset).replaceAll("-", "");
      try {
        const response = await fetchImpl(`${KRX_INDEX_BASE_URL}/${target.endpoint}?basDd=${baseDate}`, {
          headers: { AUTH_KEY: key },
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`KRX index HTTP ${response.status}`);
        const payload = await response.json();
        const point = localKrxIndexPointFromRows(payload?.OutBlock_1, target.market);
        if (point) return { ticker: target.ticker, ...point };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    throw new Error(`${target.market} index data is empty`);
  }));
  const warnings = [];
  const records = baseResults.flatMap((result, index) => {
    if (result.status === "fulfilled") return [{ target: targets[index], record: result.value }];
    warnings.push(`${targets[index].market} 지수 조회 실패: ${result.reason?.message || result.reason}`);
    return [];
  });
  if (!records.length) {
    throw new Error(warnings.join(" / ") || "KRX core index data is empty");
  }
  const results = await Promise.all(records.map(async ({ record, target }) => {
    const shouldCheckNaver = Boolean(historySince) || currentPriceWindow || record.date < expectedDate;
    let selected = { ...record, source: "KRX" };
    let history = [];
    let providerAudit = "not-needed";
    if (shouldCheckNaver) {
      try {
        const historyStart = historySince && historySince < record.date ? historySince : record.date;
        const query = new URLSearchParams({
          symbol: target.naverSymbol,
          requestType: "1",
          startTime: shiftIsoDate(historyStart || today, -7).replaceAll("-", ""),
          endTime: today.replaceAll("-", ""),
          timeframe: "day",
        });
        const response = await fetchImpl(`${NAVER_MARKET_PRICE_URL}?${query}`, {
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`Naver index HTTP ${response.status}`);
        const naverPoints = parseNaverPriceSeries(await response.text());
        const tail = validateNaverPriceTail(record, naverPoints, { since: historySince });
        const evaluation = evaluateNaverPriceFallback(record, naverPoints, {
          allowSameDate: currentPriceWindow,
        });
        providerAudit = evaluation.status;
        if (historySince && tail.accepted) {
          history = tail.points.map((point) => ({
            ticker: record.ticker,
            ...point,
            source: "NAVER_HISTORY",
          }));
        }
        if (evaluation.accepted && evaluation.point && (
          evaluation.point.date > record.date
          || (currentPriceWindow && evaluation.point.date === record.date)
        )) {
          selected = { ticker: record.ticker, ...evaluation.point, source: "NAVER_FALLBACK" };
        }
        if (evaluation.status === "mismatch") warnings.push(`${target.market} KRX·네이버 값 불일치`);
      } catch (error) {
        warnings.push(`${target.market} 네이버 지수 확인 실패: ${error?.message || error}`);
      }
    }
    const freshnessDate = currentPriceWindow ? today : expectedDate;
    if (selected.date < freshnessDate) {
      warnings.push(`${target.market} 최신 지수 지연(${selected.date}, 예상 ${freshnessDate})`);
    }
    const byDate = new Map(history.map((point) => [point.date, point]));
    byDate.set(selected.date, selected);
    return {
      latest: selected,
      records: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
      providerAudit,
    };
  }));
  const mergedRecords = results.flatMap((result) => result.records);
  const latestRecords = results.map((result) => result.latest);
  const missingTickers = targets
    .filter((target) => !latestRecords.some((record) => record.ticker === target.ticker))
    .map((target) => target.ticker);
  return {
    ok: true,
    source: latestRecords.some((record) => record.source === "NAVER_FALLBACK") ? "NAVER_FALLBACK" : "KRX",
    savedAt: Date.now(),
    expectedDate,
    historySince,
    latestDate: mergedRecords.reduce((latest, row) => row.date > latest ? row.date : latest, ""),
    partial: missingTickers.length > 0,
    missingTickers,
    providerAudit: Object.fromEntries(results.map((result) => [
      result.latest.ticker,
      result.providerAudit,
    ])),
    stale: missingTickers.length > 0
      || latestRecords.some((record) => record.date < (currentPriceWindow ? today : expectedDate)),
    ...(warnings.length ? { warning: warnings.join(" / ") } : {}),
    records: mergedRecords,
  };
}

function localResearchCode(row) {
  const shortCode = String(row?.ISU_SRT_CD || "").replace(/\D/g, "");
  if (shortCode.length >= 6) return shortCode.slice(-6);
  const raw = String(row?.ISU_CD || "").trim().toUpperCase();
  const isinMatch = /^KR[A-Z0-9](\d{6})\d{3}$/.exec(raw);
  if (isinMatch) return isinMatch[1];
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(-6) : "";
}

export function normalizeLocalResearchUniverseRows(rows, market, limit = STOCK_RESEARCH_LIMIT) {
  const suffix = market === "KOSDAQ" ? "KQ" : "KS";
  const records = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const code = localResearchCode(row);
    const name = String(row?.ISU_NM || row?.ISU_ABBRV || "").trim();
    const marketCap = krxIndexNumber(row?.MKTCAP);
    if (!code || !name || !Number.isFinite(marketCap) || marketCap <= 0) return;
    const ticker = `${code}.${suffix}`;
    const candidate = {
      ticker,
      code,
      name,
      market,
      marketCap,
      tradeValue: krxIndexNumber(row?.ACC_TRDVAL ?? row?.ACC_TRDVAL_AMT),
      volume: krxIndexNumber(row?.ACC_TRDVOL ?? row?.ACC_TRDVOL_QTY),
      close: krxIndexNumber(row?.TDD_CLSPRC ?? row?.CLSPRC),
    };
    if (!records.has(ticker) || records.get(ticker).marketCap < marketCap) records.set(ticker, candidate);
  });
  return [...records.values()]
    .sort((left, right) => right.marketCap - left.marketCap || left.ticker.localeCompare(right.ticker))
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function fetchLocalResearchUniverse(fetchImpl, apiKey, now = new Date(), options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("KRX API key is missing");
  const totalLimit = normalizeResearchUniverseSize(options.totalLimit ?? options.limit);
  const perMarketLimit = researchUniversePerMarketLimit(totalLimit);
  const expectedDate = expectedLatestKoreanTradingDate(now);
  if (isKoreanCurrentPriceWindow(now, { closeHour: 16 })) {
    try {
      return await fetchNaverLiveResearchUniverse(fetchImpl, koreanDateText(now), { totalLimit });
    } catch (_) {
      // KRX remains the safe fallback when the live rank pages are incomplete.
    }
  }
  const targets = [
    { market: "KOSPI", endpoint: "stk_bydd_trd" },
    { market: "KOSDAQ", endpoint: "ksq_bydd_trd" },
  ];
  for (let offset = 0; offset <= 10; offset += 1) {
    const baseDate = shiftIsoDate(expectedDate, -offset);
    try {
      const markets = await Promise.all(targets.map(async (target) => {
        const response = await fetchImpl(`${KRX_STOCK_BASE_URL}/${target.endpoint}?basDd=${baseDate.replaceAll("-", "")}`, {
          headers: { AUTH_KEY: key },
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`KRX ${target.market} HTTP ${response.status}`);
        const payload = await response.json();
        const records = normalizeLocalResearchUniverseRows(
          payload?.OutBlock_1,
          target.market,
          perMarketLimit,
        );
        if (records.length < perMarketLimit) throw new Error(`${target.market} 시총 목록 불완전`);
        return records;
      }));
      return {
        ok: true,
        baseDate,
        selection: { KOSPI: perMarketLimit, KOSDAQ: perMarketLimit },
        records: markets.flat(),
      };
    } catch (_) {
      // Empty holiday snapshots are expected; continue to the previous date.
    }
  }
  throw new Error("KRX 시가총액 상위 종목을 불러오지 못했습니다.");
}

export function parseLocalResearchHistory(text) {
  const rows = new Map();
  for (const match of String(text || "").matchAll(/<item\s+data="(\d{8})\|[^|]*\|[^|]*\|[^|]*\|([^|]+)\|([^"]+)"/g)) {
    const rawDate = match[1];
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const close = krxIndexNumber(match[2]);
    const volume = krxIndexNumber(match[3]);
    if (!Number.isFinite(close) || close <= 0) continue;
    rows.set(date, { date, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : null });
  }
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function detectLocalResearchHistoryRebase(existingRows, incomingRows, threshold = 1.8) {
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
  const scaled = medianRatio >= threshold || medianRatio <= (1 / threshold);
  if (!scaled) return false;
  const relativeDeviation = ratios.reduce((sum, ratio) => (
    sum + Math.abs((ratio / medianRatio) - 1)
  ), 0) / ratios.length;
  return relativeDeviation <= 0.04;
}

export function localResearchHistoryPointFromUniverse(existingRows, universeItem, asOfDate, threshold = 1.8) {
  const rows = Array.isArray(existingRows) ? existingRows : [];
  const latest = rows.at(-1);
  const date = String(universeItem?.date || "").slice(0, 10);
  const expected = String(asOfDate || "").slice(0, 10);
  const close = Number(universeItem?.close);
  const latestClose = Number(latest?.close);
  const latestTime = Date.parse(`${String(latest?.date || "")}T00:00:00Z`);
  const pointTime = Date.parse(`${date}T00:00:00Z`);
  if (
    !latest
    || date !== expected
    || !Number.isFinite(close)
    || close <= 0
    || !Number.isFinite(latestClose)
    || latestClose <= 0
    || !Number.isFinite(latestTime)
    || !Number.isFinite(pointTime)
  ) return null;
  const calendarGap = Math.round((pointTime - latestTime) / 86400000);
  const ratio = close / latestClose;
  if (calendarGap < 1 || calendarGap > 5 || ratio >= threshold || ratio <= (1 / threshold)) return null;
  const volume = Number(universeItem?.volume);
  return {
    date,
    close,
    volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
  };
}

function fiveYearsBefore(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - 5);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function projectLocalResearchHistory(
  payload,
  sinceDate = "",
  forceFull = false,
  overlapDays = 35,
) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const since = String(sinceDate || "").slice(0, 10);
  const latestDate = String(payload?.latestDate || rows.at(-1)?.date || "").slice(0, 10);
  const validSince = /^\d{4}-\d{2}-\d{2}$/.test(since) && since <= latestDate;
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

export async function fetchLocalResearchHistory(
  fetchImpl,
  ticker,
  now = new Date(),
  cacheDir = STOCK_RESEARCH_CACHE_DIR,
  universeItem = null,
) {
  const match = TICKER_PATTERN.exec(String(ticker || "").trim().toUpperCase());
  if (!match) throw new Error("종목코드 형식이 올바르지 않습니다.");
  const target = `${match[1]}.${match[2]}`;
  const asOfDate = expectedLatestKoreanTradingDate(now);
  const cachePath = path.join(cacheDir, `${target}.json`);
  const cached = JSON.parse(await readFile(cachePath, "utf8").catch(() => "null"));
  if (cached?.asOfDate === asOfDate && Array.isArray(cached?.rows) && cached.rows.length >= 252) {
    return { ...cached, ok: true, cached: true };
  }
  const existing = Array.isArray(cached?.rows) ? cached.rows : [];
  const latestDate = existing.at(-1)?.date || "";
  const cutoff = fiveYearsBefore(asOfDate);
  const persist = async (payload) => {
    await mkdir(cacheDir, { recursive: true });
    const temporaryPath = `${cachePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(payload), "utf8");
    await rename(temporaryPath, cachePath);
  };
  if (existing.length >= 252 && latestDate === asOfDate) {
    const payload = { ...cached, schema: 1, ticker: target, asOfDate, latestDate };
    await persist(payload).catch(() => false);
    return { ok: true, cached: true, ...payload };
  }
  const latestUniversePoint = localResearchHistoryPointFromUniverse(
    existing,
    universeItem,
    asOfDate,
  );
  if (existing.length >= 252 && latestUniversePoint) {
    const rows = [...existing.filter((row) => row?.date >= cutoff), latestUniversePoint];
    const payload = {
      schema: 1,
      ticker: target,
      asOfDate,
      latestDate: latestUniversePoint.date,
      rebased: false,
      source: "KRX",
      rows,
    };
    await persist(payload).catch(() => false);
    return { ...payload, ok: true, cached: false };
  }
  const requestRows = async (startDate) => {
    const query = new URLSearchParams({
      symbol: match[1],
      timeframe: "day",
      startTime: startDate.replaceAll("-", ""),
      endTime: asOfDate.replaceAll("-", ""),
      requestType: "1",
    });
    const response = await fetchImpl(`${NAVER_STOCK_HISTORY_URL}?${query}`, {
      headers: { "User-Agent": "ThinkStock-Local/1.0" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Naver history HTTP ${response.status}`);
    return parseLocalResearchHistory(await response.text());
  };
  const startDate = latestDate ? shiftIsoDate(latestDate, -21) : cutoff;
  try {
  let incoming = await requestRows(startDate);
  let mergeBase = existing;
  let rebased = false;
  if (existing.length && detectLocalResearchHistoryRebase(existing, incoming)) {
    incoming = await requestRows(cutoff);
    mergeBase = [];
    rebased = true;
  }
  const merged = new Map();
  [...mergeBase, ...incoming].forEach((row) => {
    if (row?.date >= cutoff && Number(row?.close) > 0) merged.set(row.date, row);
  });
  const rows = [...merged.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length < 252) throw new Error("가격 이력이 1년 미만입니다.");
  const payload = { schema: 1, ticker: target, asOfDate, latestDate: rows.at(-1).date, rebased, rows };
  await persist(payload).catch(() => false);
  return { ...payload, ok: true, cached: false };
  } catch (error) {
    if (existing.length >= 252) {
      return {
        ...cached,
        ok: true,
        cached: true,
        stale: true,
        warning: `${target} refresh failed; using the last saved history.`,
      };
    }
    throw error;
  }
}

export async function fetchLocalResearchProfile(fetchImpl, ticker, now = new Date(), cacheDir = STOCK_RESEARCH_CACHE_DIR) {
  const match = TICKER_PATTERN.exec(String(ticker || "").trim().toUpperCase());
  if (!match) throw new Error("종목코드 형식이 올바르지 않습니다.");
  const target = `${match[1]}.${match[2]}`;
  const profileDir = path.join(cacheDir, "profiles");
  const cachePath = path.join(profileDir, `${target}.json`);
  const cached = JSON.parse(await readFile(cachePath, "utf8").catch(() => "null"));
  if (cached?.category && now.getTime() - Number(cached.savedAt || 0) < STOCK_RESEARCH_PROFILE_FRESH_MS) {
    return { ...cached, ok: true, cached: true };
  }
  try {
    const response = await fetchImpl(`${NAVER_STOCK_PROFILE_URL}?code=${encodeURIComponent(match[1])}`, {
      headers: { "User-Agent": "ThinkStock-Local/1.0" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Naver profile HTTP ${response.status}`);
    const announcedSize = Number(response.headers.get("Content-Length") || 0);
    if (announcedSize > MAX_NAVER_PROFILE_BYTES) throw new Error("Naver profile response is too large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_NAVER_PROFILE_BYTES) throw new Error("Naver profile response is too large");
    const profile = parseNaverResearchProfile(new TextDecoder().decode(bytes), target);
    if (!profile.category) throw new Error("업종 분류가 없습니다.");
    const payload = { ticker: target, savedAt: now.getTime(), ...profile };
    try {
      await mkdir(profileDir, { recursive: true });
      await writeFile(cachePath, JSON.stringify(payload), "utf8");
    } catch (_) {
      // A cache write failure must not hide a fresh profile.
    }
    return { ...payload, ok: true, cached: false };
  } catch (error) {
    if (cached?.category) return { ...cached, ok: true, cached: true, stale: true };
    throw new Error(`${target} 업종 조회 실패: ${error?.message || error}`);
  }
}

async function readJson(filePath) {
  try {
    const payload = JSON.parse(await readFile(filePath, "utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch (_) {
    return null;
  }
}

async function writeJsonAtomic(filePath, payload) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(payload), "utf8");
  await rename(temporary, filePath);
}

async function readRequestJson(request, maxBytes = RESEARCH_SUMMARY_BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("요청 데이터가 너무 큽니다.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function writeTextAtomic(filePath, text) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, filePath);
}

export { parseAdrChartRows };

function pagesManifestEntries(manifest) {
  const entries = new Map();
  Object.values(manifest?.datasets || {}).forEach((dataset) => {
    [dataset?.recent, dataset?.history].forEach((descriptor) => {
      const file = String(descriptor?.file || "");
      const rows = Number(descriptor?.rows);
      const sha256 = String(descriptor?.sha256 || "").toLowerCase();
      if (!/^[a-z0-9_-]+\.json$/i.test(file)) throw new Error("Pages data manifest file is invalid");
      if (!Number.isInteger(rows) || rows < 0) throw new Error(`Pages data ${file} row count is invalid`);
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Pages data ${file} hash is invalid`);
      const previous = entries.get(file);
      if (previous && (previous.rows !== rows || previous.sha256 !== sha256)) {
        throw new Error(`Pages data ${file} has conflicting manifest entries`);
      }
      entries.set(file, { file, rows, sha256 });
    });
  });
  if (!entries.size) throw new Error("Pages data manifest contains no files");
  return [...entries.values()];
}

function pagesPayloadRowCount(payload) {
  if (Array.isArray(payload?.dates)) return payload.dates.length;
  if (Array.isArray(payload?.records)) return payload.records.length;
  return null;
}

function validatePagesDataText(text, descriptor) {
  const payload = JSON.parse(text);
  const rows = pagesPayloadRowCount(payload);
  if (rows !== descriptor.rows) {
    throw new Error(`Pages data ${descriptor.file} row count mismatch: ${rows} != ${descriptor.rows}`);
  }
  const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  if (sha256 !== descriptor.sha256) throw new Error(`Pages data ${descriptor.file} hash mismatch`);
  return payload;
}

async function pagesMirrorMatches(cacheDir, manifest, entries) {
  const currentManifest = await readJson(path.join(cacheDir, "data_manifest.json"));
  const incomingRevision = String(manifest?.revision || manifest?.generated_at || "");
  const currentRevision = String(currentManifest?.revision || currentManifest?.generated_at || "");
  if (!incomingRevision || incomingRevision !== currentRevision) return false;
  try {
    await Promise.all(entries.map(async (descriptor) => {
      const text = await readFile(path.join(cacheDir, descriptor.file), "utf8");
      validatePagesDataText(text, descriptor);
    }));
    return true;
  } catch (_) {
    return false;
  }
}

export async function syncPagesDataMirror(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cacheDir = options.cacheDir || PAGES_DATA_CACHE_DIR;
  const baseUrl = String(options.baseUrl || PAGES_DATA_BASE_URL);
  const manifestResponse = await fetchImpl(`${baseUrl}data_manifest.json?_=${Date.now()}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!manifestResponse.ok) throw new Error(`Pages data manifest HTTP ${manifestResponse.status}`);
  const manifestText = await manifestResponse.text();
  const manifest = JSON.parse(manifestText);
  if (manifest?.format !== "segmented-data-v1" || !manifest?.datasets) {
    throw new Error("Pages data manifest format is invalid");
  }
  const entries = pagesManifestEntries(manifest);
  if (await pagesMirrorMatches(cacheDir, manifest, entries)) {
    return { generatedAt: String(manifest.generated_at || ""), files: entries.length, unchanged: true };
  }

  const parentDir = path.dirname(cacheDir);
  const generationId = `${process.pid}-${Date.now()}`;
  const stagingDir = path.join(parentDir, `${path.basename(cacheDir)}.next-${generationId}`);
  const backupDir = path.join(parentDir, `${path.basename(cacheDir)}.previous-${generationId}`);
  await mkdir(parentDir, { recursive: true });
  await mkdir(stagingDir, { recursive: true });
  let movedCurrent = false;
  try {
    await Promise.all(entries.map(async (descriptor) => {
      const response = await fetchImpl(`${baseUrl}${descriptor.file}?_=${Date.now()}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Pages data ${descriptor.file} HTTP ${response.status}`);
      const text = await response.text();
      validatePagesDataText(text, descriptor);
      await writeFile(path.join(stagingDir, descriptor.file), text, "utf8");
    }));
    await writeFile(path.join(stagingDir, "data_manifest.json"), manifestText, "utf8");

    if (await stat(cacheDir).then(() => true).catch(() => false)) {
      await rename(cacheDir, backupDir);
      movedCurrent = true;
    }
    try {
      await rename(stagingDir, cacheDir);
    } catch (error) {
      if (movedCurrent) await rename(backupDir, cacheDir).catch(() => {});
      throw error;
    }
    if (movedCurrent) await rm(backupDir, { recursive: true, force: true });
    return { generatedAt: String(manifest.generated_at || ""), files: entries.length, unchanged: false };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export class DartGateway {
  constructor(apiKey, options = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.cacheDir = options.cacheDir || CACHE_DIR;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.disclosureTtlMs = Number(options.disclosureTtlMs ?? DISCLOSURE_TTL_MS);
    this.pending = new Map();
    this.corpShards = new Map();
  }

  async initialize() {
    await mkdir(this.cacheDir, { recursive: true });
    const cutoff = Date.now() - STALE_CACHE_MAX_AGE_MS;
    const names = await readdir(this.cacheDir).catch(() => []);
    await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      const filePath = path.join(this.cacheDir, name);
      try {
        if ((await stat(filePath)).mtimeMs < cutoff) await unlink(filePath);
      } catch (_) {}
    }));
  }

  async corpCode(stockCode) {
    const prefix = String(stockCode || "").slice(0, 2);
    if (!/^\d{2}$/.test(prefix)) return "";
    if (!this.corpShards.has(prefix)) {
      const payload = await readJson(path.join(CORP_CODE_DIR, `${prefix}.json`));
      this.corpShards.set(prefix, payload?.codes || {});
    }
    return String(this.corpShards.get(prefix)?.[stockCode] || "").trim();
  }

  async requestJson(params) {
    const url = `${DART_DISCLOSURE_URL}?${new URLSearchParams(params)}`;
    try {
      const result = await executeRuntimeSourcePlan("disclosure", {
        primary: async () => {
        const response = await this.fetchImpl(url, {
          headers: { "User-Agent": "ThinkStock-Local/1.0" },
          signal: AbortSignal.timeout(30000),
        });
        if (response.ok) return await response.json();
        const error = new Error(`DART HTTP ${response.status}`);
        error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
        },
      });
      return result.value;
    } catch (error) {
      throw new Error(`DART 접속에 실패했습니다: ${error?.message || "unknown error"}`);
    }
  }

  static recordFromItem(ticker, item) {
    return recordFromDartItem(ticker, item);
  }

  async fetchDisclosures(ticker) {
    if (!this.apiKey) throw new Error(".env.local에 DART_API_KEY가 없습니다.");
    const corpCode = await this.corpCode(ticker.slice(0, 6));
    if (!corpCode) throw new Error("DART 회사코드를 찾지 못했습니다. 데이터 업데이트 후 다시 시도해 주세요.");
    const baseParams = {
      crtfc_key: this.apiKey,
      corp_code: corpCode,
      bgn_de: dateYearsBefore(3),
      end_de: todayApiDate(),
      last_reprt_at: "Y",
      sort: "date",
      sort_mth: "asc",
      page_count: "100",
    };
    const records = [];
    for (const disclosureType of DART_DISCLOSURE_TYPES) {
      let pageNo = 1;
      let totalPages = 1;
      while (pageNo <= totalPages) {
        const payload = await this.requestJson({
          ...baseParams,
          pblntf_ty: disclosureType,
          page_no: String(pageNo),
        });
        const status = String(payload?.status || "");
        if (status === "013") break;
        if (status && status !== "000") throw new Error(payload?.message || `DART 오류 ${status}`);
        totalPages = Math.min(DART_DISCLOSURE_MAX_PAGES, Math.max(1, Number(payload?.total_page) || 1));
        (payload?.list || []).forEach((item) => {
          const record = DartGateway.recordFromItem(ticker, item);
          if (record) records.push(record);
        });
        pageNo += 1;
      }
    }
    const unique = new Map(records.map((record) => [
      `${record.date}|${record.title}|${record.receiptNo}`,
      record,
    ]));
    return [...unique.values()].sort((left, right) => (
      left.date.localeCompare(right.date) || left.title.localeCompare(right.title)
    ));
  }

  async disclosures(ticker, force = false) {
    const target = String(ticker || "").trim().toUpperCase();
    if (!TICKER_PATTERN.test(target)) throw new Error("종목코드는 005930.KS 형식이어야 합니다.");
    if (this.pending.has(target)) return this.pending.get(target);
    const task = (async () => {
      const cachePath = path.join(this.cacheDir, `${target}.json`);
      const cached = await readJson(cachePath);
      const savedAtMs = Number(cached?.saved_at || 0) * 1000;
      if (!force && Array.isArray(cached?.records) && Date.now() - savedAtMs <= this.disclosureTtlMs) {
        return { records: cached.records, cached: true };
      }
      try {
        const records = await this.fetchDisclosures(target);
        await writeJsonAtomic(cachePath, {
          saved_at: Date.now() / 1000,
          ticker: target,
          records,
        }).catch(() => false);
        return { records, cached: false };
      } catch (error) {
        if (Array.isArray(cached?.records)) {
          return {
            records: cached.records,
            cached: true,
            stale: true,
            warning: `${target} DART refresh failed; using the last saved disclosures.`,
          };
        }
        throw error;
      }
    })().finally(() => this.pending.delete(target));
    this.pending.set(target, task);
    return task;
  }
}

function corsHeaders(request) {
  const origin = String(request.headers.origin || "").trim();
  if (!isAllowedOrigin(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-private-network": request.headers["access-control-request-private-network"] === "true" ? "true" : undefined,
    vary: "Origin",
  };
}

function sendJson(request, response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = Object.fromEntries(Object.entries(corsHeaders(request)).filter(([, value]) => value));
  response.writeHead(statusCode, {
    ...headers,
    ...runtimeJsonHeaders({ referrerPolicy: "same-origin" }),
    "content-length": body.length,
  });
  response.end(body);
}

function sendBytes(request, response, statusCode, bytes, extraHeaders = {}) {
  const body = Buffer.from(bytes);
  const headers = Object.fromEntries(Object.entries(corsHeaders(request)).filter(([, value]) => value));
  response.writeHead(statusCode, {
    ...headers,
    "cache-control": "private, no-store",
    "content-length": body.length,
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

async function serveStatic(response, pathname, headOnly = false, dataMirrorDir = PAGES_DATA_CACHE_DIR) {
  const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const mirrorName = relative.match(/^\/data\/([a-z0-9_-]+\.json)$/i)?.[1] || "";
  const mirrorPath = mirrorName ? path.join(dataMirrorDir, mirrorName) : "";
  const useMirror = mirrorPath && await stat(mirrorPath).then(() => true).catch(() => false);
  const filePath = useMirror ? mirrorPath : path.resolve(DOCS_DIR, `.${relative}`);
  if (!useMirror && filePath !== DOCS_DIR && !filePath.startsWith(`${DOCS_DIR}${path.sep}`)) {
    throw new Error("invalid path");
  }
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not a file");
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-length": info.size,
    "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "x-content-type-options": "nosniff",
  });
  if (headOnly) response.end();
  else createReadStream(filePath).pipe(response);
}

export async function createThinkStockServer(options = {}) {
  const envText = await readFile(ENV_FILE, "utf8").catch(() => "");
  const envValues = parseEnvText(envText);
  const apiKey = String(options.apiKey || process.env.DART_API_KEY || envValues.DART_API_KEY || "").trim();
  const krxApiKey = String(options.krxApiKey || process.env.KRX_API_KEY || envValues.KRX_API_KEY || "").trim();
  const fredApiKey = String(
    options.fredApiKey || process.env.FRED_API_KEY || envValues.FRED_API_KEY || "",
  ).trim();
  const hasKofiaOption = Object.prototype.hasOwnProperty.call(options, "kofiaApiKey");
  const kofiaApiKey = String(hasKofiaOption
    ? options.kofiaApiKey
    : (process.env.KOFIA_API_KEY || envValues.KOFIA_API_KEY || "")).trim();
  const workerAccessToken = String(
    options.workerAccessToken || process.env.THINKSTOCK_ACCESS_TOKEN || envValues.THINKSTOCK_ACCESS_TOKEN || "",
  ).trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const nowProvider = typeof options.nowProvider === "function"
    ? options.nowProvider
    : () => new Date();
  const serverStartedAt = new Date().toISOString();
  const loadedServerSourceMtimeMs = Number.isFinite(Number(options.serverSourceMtimeMs))
    ? Number(options.serverSourceMtimeMs)
    : Number((await stat(SERVER_SOURCE_PATH)).mtimeMs);
  const getServerSourceMtime = typeof options.getServerSourceMtime === "function"
    ? options.getServerSourceMtime
    : async () => Number((await stat(SERVER_SOURCE_PATH)).mtimeMs);
  const appVersion = String(
    options.appVersion
      || (await readFile(path.join(DOCS_DIR, "index.html"), "utf8").catch(() => ""))
        .match(/id=["']appVersionText["'][^>]*>([^<]+)/i)?.[1]
      || "",
  ).trim();
  const localKofiaClient = options.kofiaClient || createKofiaClient({
    fetch: fetchImpl,
    enableIndexergo: true,
  });
  const dataMirrorDir = options.dataMirrorDir || PAGES_DATA_CACHE_DIR;
  const mirrorStatus = options.syncPagesData === false
    ? { generatedAt: "", files: 0 }
    : await syncPagesDataMirror({ fetchImpl, cacheDir: dataMirrorDir }).catch((error) => ({
      generatedAt: "",
      files: 0,
      warning: error?.message || String(error),
    }));
  const gateway = options.gateway || new DartGateway(apiKey);
  await gateway.initialize();
  let coreIndexCache = null;
  let creditMacroCache = null;
  let lastCreditWorkerSyncSignature = "";
  let researchUniverseCache = null;
  let vkospiLiveCache = null;
  let localVixCache = null;
  let localVixLiveCache = null;
  async function syncCreditRowsToWorker(rows) {
    if (!workerAccessToken) return false;
    const recentRows = mergeCreditRows([], rows).slice(-45);
    const latest = recentRows.at(-1);
    if (!latest) return false;
    const signature = JSON.stringify(latest);
    if (signature === lastCreditWorkerSyncSignature) return false;
    const upstream = await fetchImpl(`${THINKSTOCK_WORKER_URL}/api/credit/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rows: recentRows }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || payload?.ok !== true) {
      throw new Error(payload?.error || `신용 클라우드 동기화 HTTP ${upstream.status}`);
    }
    lastCreditWorkerSyncSignature = signature;
    return true;
  }
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/")) {
      response.writeHead(204, {
        ...corsHeaders(request),
        "access-control-allow-headers": "Authorization, Content-Type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      });
      response.end();
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/shutdown") {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        sendJson(request, response, 403, { ok: false, error: "Shutdown is allowed only from this PC." });
        return;
      }
      sendJson(request, response, 200, { ok: true });
      setTimeout(() => server.close(), 50);
      return;
    }
    if (requestUrl.pathname === "/api/health") {
      const currentServerSourceMtimeMs = Number(await getServerSourceMtime().catch(() => loadedServerSourceMtimeMs));
      sendJson(request, response, 200, {
        ok: true,
        appVersion,
        serverStartedAt,
        serverSourceLoadedAt: new Date(loadedServerSourceMtimeMs).toISOString(),
        serverSourceCurrentAt: new Date(currentServerSourceMtimeMs).toISOString(),
        restartRequired: currentServerSourceMtimeMs > loadedServerSourceMtimeMs + 1,
        dartConfigured: Boolean(gateway.apiKey),
        krxConfigured: Boolean(krxApiKey),
        fredConfigured: Boolean(fredApiKey),
        workerConfigured: Boolean(workerAccessToken),
        pagesDataGeneratedAt: mirrorStatus.generatedAt,
        pagesDataWarning: mirrorStatus.warning || "",
      });
      return;
    }
    if (requestUrl.pathname === "/api/broker-reports") {
      try {
        const ticker = String(requestUrl.searchParams.get("ticker") || "").trim().toUpperCase();
        const days = Number(requestUrl.searchParams.get("days")) <= 90 ? 90 : 180;
        const requestedAsOf = String(requestUrl.searchParams.get("asOf") || "").slice(0, 10);
        const asOf = /^\d{4}-\d{2}-\d{2}$/.test(requestedAsOf)
          ? requestedAsOf
          : new Date().toISOString().slice(0, 10);
        const source = requestUrl.searchParams.get("source") === "naver" ? "naver" : "hankyung";
        const sourceUrl = source === "naver"
          ? buildNaverReportListUrl(ticker)
          : buildHankyungReportListUrl(ticker, { days, asOf });
        const upstream = await fetchImpl(sourceUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml",
            ...(source === "naver" ? { Referer: "https://finance.naver.com/" } : {}),
            "User-Agent": "ThinkStock-Local/2 broker-research",
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!upstream.ok) throw new Error(`${source === "naver" ? "Naver Finance" : "Hankyung Consensus"} HTTP ${upstream.status}`);
        const html = source === "naver"
          ? decodeNaverReportListBytes(await readBoundedResponseBytes(
            upstream,
            BROKER_REPORT_LIST_MAX_BYTES,
            "Broker report list",
          ))
          : await readBoundedResponseText(upstream, BROKER_REPORT_LIST_MAX_BYTES, "Broker report list");
        const reports = (source === "naver"
          ? parseNaverReportListHtml(html, ticker)
          : parseHankyungReportListHtml(html, ticker))
          .filter((report) => reportAgeDays(report.publishedDate, asOf) < days);
        sendJson(request, response, 200, {
          ok: true,
          ticker,
          days,
          reports,
          source: source === "naver" ? "Naver Finance" : "Hankyung Consensus",
        });
      } catch (error) {
        sendJson(request, response, 503, {
          ok: false,
          error: `Broker report list failed: ${error?.message || error}`,
        });
      }
      return;
    }
    if (requestUrl.pathname === "/api/broker-report-pdf") {
      try {
        const reportId = String(requestUrl.searchParams.get("reportId") || "").trim();
        const source = requestUrl.searchParams.get("source") === "naver" ? "naver" : "hankyung";
        if (source === "naver" && !/^naver-\d{1,12}$/.test(reportId)) {
          throw new Error("Broker report id is invalid");
        }
        const sourceUrl = source === "naver"
          ? buildNaverReportPdfUrl(requestUrl.searchParams.get("sourceUrl"))
          : buildHankyungReportPdfUrl(reportId);
        const upstream = await fetchImpl(sourceUrl, {
          headers: {
            Accept: "application/pdf",
            ...(source === "naver" ? { Referer: "https://finance.naver.com/" } : {}),
            "User-Agent": "ThinkStock-Local/2 broker-research",
          },
          signal: AbortSignal.timeout(30000),
        });
        if (!upstream.ok) throw new Error(`${source === "naver" ? "Naver Finance" : "Hankyung Consensus"} PDF HTTP ${upstream.status}`);
        const bytes = await readBoundedResponseBytes(
          upstream,
          BROKER_REPORT_PDF_MAX_BYTES,
          "Broker report PDF",
        );
        if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
          throw new Error("Broker report response is not a PDF");
        }
        sendBytes(request, response, 200, bytes, {
          "content-disposition": `inline; filename=broker-report-${reportId}.pdf`,
          "content-type": "application/pdf",
        });
      } catch (error) {
        const invalidId = /id is invalid/i.test(String(error?.message || error));
        sendJson(request, response, invalidId ? 400 : 503, {
          ok: false,
          error: `Broker report PDF failed: ${error?.message || error}`,
        });
      }
      return;
    }
    if (requestUrl.pathname === "/api/adr") {
      let workerFallback = null;
      if (workerAccessToken) {
        try {
          const refresh = ["1", "true", "yes"].includes(String(requestUrl.searchParams.get("refresh") || "").toLowerCase());
          const upstream = await fetchImpl(`${THINKSTOCK_WORKER_URL}/api/adr${refresh ? "?refresh=1" : ""}`, {
            headers: { Authorization: `Bearer ${workerAccessToken}` },
            signal: AbortSignal.timeout(45000),
          });
          const payload = await upstream.json();
          if (upstream.ok && payload?.ok === true && Array.isArray(payload.rows)) {
            if (payload.stale !== true) {
              sendJson(request, response, 200, payload);
              return;
            }
            workerFallback = payload;
          }
        } catch (_) {
          // A direct ADR request below remains available when the Worker path is interrupted.
        }
      }
      try {
        const upstream = await fetchImpl(`${ADR_SOURCE_URL}?_=${Date.now()}`, {
          headers: { "User-Agent": "ThinkStock-Local/1.0" },
          signal: AbortSignal.timeout(30000),
        });
        if (!upstream.ok) throw new Error(`adrinfo.kr HTTP ${upstream.status}`);
        const rows = parseAdrChartRows(await upstream.text());
        if (!rows.length) throw new Error("ADR response contained no rows");
        sendJson(request, response, 200, { ok: true, rows });
      } catch (error) {
        if (workerFallback) sendJson(request, response, 200, workerFallback);
        else sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (requestUrl.pathname === "/api/fear-greed") {
      try {
        const upstream = await fetchImpl(`${FEAR_GREED_SOURCE_URL}&_=${Date.now()}`, {
          headers: { "User-Agent": "ThinkStock-Local/1.0" },
          signal: AbortSignal.timeout(30000),
        });
        if (!upstream.ok) throw new Error(`fear-greed HTTP ${upstream.status}`);
        sendJson(request, response, 200, await upstream.json());
      } catch (error) {
        sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (requestUrl.pathname === "/api/indices" && krxApiKey) {
      try {
        const now = new Date();
        const expectedDate = expectedLatestKoreanTradingDate(now);
        const currentPriceWindow = isKoreanCurrentPriceWindow(now);
        const today = koreanDateText(now);
        const freshnessDate = currentPriceWindow ? today : expectedDate;
        const forceRefresh = ["1", "true", "yes"].includes(
          String(requestUrl.searchParams.get("refresh") || "").toLowerCase(),
        );
        const historySince = /^\d{4}-\d{2}-\d{2}$/.test(String(requestUrl.searchParams.get("since") || ""))
          ? String(requestUrl.searchParams.get("since"))
          : "";
        const maxAgeMs = currentPriceWindow
          ? sourcePolicy("indices").liveConfirmMs
          : sourcePolicy("indices").stableCacheSeconds * 1000;
        const cachedIsStale = coreIndexCache?.stale === true;
        const cacheMissesHistory = Boolean(historySince
          && (!coreIndexCache?.historySince || coreIndexCache.historySince > historySince));
        let refreshed = false;
        if (forceRefresh || !coreIndexCache
          || coreIndexCache.expectedDate !== expectedDate
          || cachedIsStale
          || cacheMissesHistory
          || Date.now() - Number(coreIndexCache.savedAt || 0) >= maxAgeMs) {
          const incoming = await fetchLocalKrxCoreIndices(fetchImpl, krxApiKey, now, { since: historySince });
          const mergedRecords = mergeIndexRecords(coreIndexCache?.records, incoming.records);
          const knownTickers = new Set(mergedRecords.map((row) => row.ticker));
          const missingTickers = ["^KS11", "^KQ11"].filter((ticker) => !knownTickers.has(ticker));
          const retainedPrevious = Boolean(incoming.partial && coreIndexCache?.records?.length);
          const warnings = [
            incoming.warning,
            retainedPrevious ? "일부 지수 조회 실패로 마지막 정상값을 함께 사용합니다." : "",
          ].filter(Boolean);
          coreIndexCache = {
            ...incoming,
            records: mergedRecords,
            historySince: [coreIndexCache?.historySince, incoming.historySince]
              .filter(Boolean)
              .sort()[0] || "",
            latestDate: mergedRecords.reduce((latest, row) => row.date > latest ? row.date : latest, ""),
            partial: incoming.partial === true || missingTickers.length > 0,
            missingTickers,
            stale: incoming.stale === true || incoming.partial === true || missingTickers.length > 0,
            ...(warnings.length ? { warning: warnings.join(" / ") } : {}),
          };
          refreshed = true;
        }
        sendJson(request, response, 200, { ...coreIndexCache, cached: !refreshed });
      } catch (error) {
        if (coreIndexCache?.records?.length) {
          sendJson(request, response, 200, {
            ...coreIndexCache,
            ok: true,
            cached: true,
            stale: true,
            warning: [
              coreIndexCache.warning,
              `KRX 연결 실패로 마지막 정상 지수를 사용합니다: ${error?.message || error}`,
            ].filter(Boolean).join(" / "),
          });
        } else {
          sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
        }
      }
      return;
    }
    if (requestUrl.pathname === "/api/credit" && kofiaApiKey) {
      const forceRefresh = ["1", "true", "yes"].includes(
        String(requestUrl.searchParams.get("refresh") || "").toLowerCase(),
      );
      const windowDate = creditRefreshWindowDate();
      const needsRefresh = forceRefresh
        || !creditMacroCache
        || Boolean(windowDate && creditMacroCache.lastCheckedWindow !== windowDate);
      if (!needsRefresh) {
        await syncCreditRowsToWorker(creditMacroCache.rows).catch(() => false);
        sendJson(request, response, 200, { ok: true, cached: true, ...creditMacroCache });
        return;
      }
      try {
        const result = await fetchKofiaCreditAndDepositRows(localKofiaClient, kofiaApiKey);
        const warnings = [];
        if (result.creditFailed) warnings.push("신용 잔고 연결 실패로 마지막 확인 데이터를 사용합니다.");
        if (result.depositFailed) warnings.push("고객예탁금 연결 실패로 마지막 확인 데이터를 사용합니다.");
        warnings.push(...(result.componentWarnings || []));
        creditMacroCache = {
          savedAt: Date.now(),
          rows: mergeCreditRows(creditMacroCache?.rows, result.rows).slice(-210),
          lastCheckedWindow: windowDate || creditMacroCache?.lastCheckedWindow || "",
          ...(warnings.length ? { warning: warnings.join(" ") } : {}),
        };
        await syncCreditRowsToWorker(creditMacroCache.rows).catch((error) => {
          creditMacroCache.warning = [
            creditMacroCache.warning,
            `클라우드 동기화 지연: ${error?.message || error}`,
          ].filter(Boolean).join(" / ");
        });
        sendJson(request, response, 200, { ok: true, cached: false, ...creditMacroCache });
      } catch (error) {
        if (creditMacroCache?.rows?.length) {
          sendJson(request, response, 200, {
            ...creditMacroCache,
            ok: true,
            cached: true,
            stale: true,
            warning: [
              creditMacroCache.warning,
              "신용·예탁금 연결 실패로 마지막 확인 데이터를 사용합니다.",
            ].filter(Boolean).join(" / "),
          });
        } else {
          sendJson(request, response, 503, {
            ok: false,
            error: `신용·예탁금 조회 실패: ${error?.message || error}`,
          });
        }
      }
      return;
    }
    if (requestUrl.pathname === "/api/research/universe") {
      const refresh = ["1", "true", "yes", "on"].includes(
        String(requestUrl.searchParams.get("refresh") || "").trim().toLowerCase(),
      );
      const totalLimit = normalizeResearchUniverseSize(requestUrl.searchParams.get("limit"));
      const previousUniverse = researchUniverseCache;
      try {
        const now = new Date();
        const expectedDate = expectedLatestKoreanTradingDate(now);
        const today = koreanDateText(now);
        const liveWindow = isKoreanCurrentPriceWindow(now, { closeHour: 16 });
        const targetDate = liveWindow ? today : expectedDate;
        const cacheMatchesSize = researchUniverseCache?.records?.length === totalLimit;
        const cacheIsFresh = cacheMatchesSize && researchUniverseCache.baseDate >= targetDate;
        const preserveClosedMarketLiveCache = !liveWindow
          && cacheMatchesSize
          && researchUniverseCache.baseDate === today;
        if (!cacheIsFresh || (refresh && !preserveClosedMarketLiveCache)) {
          const fetched = await fetchLocalResearchUniverse(
            fetchImpl,
            krxApiKey,
            now,
            { totalLimit },
          );
          researchUniverseCache = cacheMatchesSize
            && researchUniverseCache.baseDate > fetched.baseDate
            ? researchUniverseCache
            : fetched;
        }
        sendJson(request, response, 200, { ...researchUniverseCache, cached: !refresh });
      } catch (error) {
        if (previousUniverse?.records?.length === totalLimit) {
          researchUniverseCache = previousUniverse;
          sendJson(request, response, 200, {
            ...previousUniverse,
            cached: true,
            stale: true,
            warning: `KRX 최신 조회 실패: ${error?.message || error}`,
          });
        } else {
          sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
        }
      }
      return;
    }
    if (requestUrl.pathname === "/api/research/summary") {
      try {
        const strategy = normalizeResearchStrategy(requestUrl.searchParams.get("strategy"));
        const minimum = normalizeResearchMinimum(requestUrl.searchParams.get("minimum"));
        const universeSize = normalizeResearchUniverseSize(requestUrl.searchParams.get("size"));
        if (!strategy) throw new Error("종목탐구 전략 형식이 올바르지 않습니다.");
        const summaryPath = path.join(STOCK_RESEARCH_CACHE_DIR, `summary-${strategy}-${minimum}-${universeSize}.json`);
        if (request.method === "GET") {
          const summary = normalizeResearchSummary(await readJson(summaryPath), { strategy, minimum, universeSize });
          if (!summary) {
            sendJson(request, response, 404, { ok: false, error: "저장된 종목탐구 요약이 없습니다." });
            return;
          }
          sendJson(request, response, 200, { ok: true, cached: true, ...summary });
          return;
        }
        if (request.method !== "POST") {
          sendJson(request, response, 405, { ok: false, error: "지원하지 않는 요청입니다." });
          return;
        }
        const summary = normalizeResearchSummary(await readRequestJson(request), { strategy, minimum, universeSize });
        if (!summary) throw new Error("종목탐구 요약 형식이 올바르지 않습니다.");
        await mkdir(STOCK_RESEARCH_CACHE_DIR, { recursive: true });
        await writeJsonAtomic(summaryPath, summary);
        sendJson(request, response, 200, { ok: true, cached: false, ...summary });
      } catch (error) {
        sendJson(request, response, 400, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (requestUrl.pathname === "/api/research/history") {
      try {
        const ticker = String(requestUrl.searchParams.get("ticker") || "").trim().toUpperCase();
        const sinceDate = String(requestUrl.searchParams.get("since") || "").slice(0, 10);
        const forceFull = ["1", "true", "yes", "on"].includes(
          String(requestUrl.searchParams.get("full") || "").trim().toLowerCase(),
        );
        const universeItem = researchUniverseCache?.records?.find((item) => item.ticker === ticker);
        const payload = await fetchLocalResearchHistory(
          fetchImpl,
          ticker,
          new Date(),
          STOCK_RESEARCH_CACHE_DIR,
          universeItem ? { ...universeItem, date: researchUniverseCache.baseDate } : null,
        );
        sendJson(request, response, 200, projectLocalResearchHistory(payload, sinceDate, forceFull));
      } catch (error) {
        sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (requestUrl.pathname === "/api/research/profile") {
      try {
        const payload = await fetchLocalResearchProfile(fetchImpl, requestUrl.searchParams.get("ticker"));
        sendJson(request, response, 200, payload);
      } catch (error) {
        sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (requestUrl.pathname === "/api/admin/session") {
      if (request.method !== "POST") {
        sendJson(request, response, 405, { ok: false, error: "지원하지 않는 요청입니다." });
        return;
      }
      if (!workerAccessToken) {
        sendJson(request, response, 503, { ok: false, error: ".env.local에 THINKSTOCK_ACCESS_TOKEN이 없습니다." });
        return;
      }
      try {
        const payload = await readRequestJson(request, 4096);
        const upstream = await fetchImpl(`${THINKSTOCK_WORKER_URL}/api/admin/session`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${workerAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
        const result = await upstream.json().catch(() => ({ ok: false, error: "접속코드가 틀렸습니다." }));
        sendJson(request, response, upstream.status, result);
      } catch (error) {
        sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if ([
      "/api/macro",
      "/api/credit",
      "/api/crisis-signal",
      "/api/indices",
      "/api/dart/insider-trades",
    ].includes(requestUrl.pathname)) {
      if (!workerAccessToken) {
        sendJson(request, response, 503, { ok: false, error: ".env.local에 THINKSTOCK_ACCESS_TOKEN이 없습니다." });
        return;
      }
      try {
        const upstream = await fetchImpl(`${THINKSTOCK_WORKER_URL}${requestUrl.pathname}${requestUrl.search}`, {
          headers: { Authorization: `Bearer ${workerAccessToken}` },
          signal: AbortSignal.timeout(90000),
        });
        let payload = await upstream.json();
        if (!upstream.ok) {
          sendJson(request, response, upstream.status, payload);
          return;
        }
        if (requestUrl.pathname === "/api/crisis-signal") {
          const now = nowProvider();
          const today = koreanDateText(now);
          const forceRefresh = ["1", "true", "yes"].includes(
            String(requestUrl.searchParams.get("refresh") || "").toLowerCase(),
          );
          if (fredApiKey) {
            try {
              const workerVixRows = Array.isArray(payload?.vixRows) ? payload.vixRows : [];
              const workerLatestDate = String(workerVixRows.at(-1)?.date || "").slice(0, 10);
              if (forceRefresh || localVixCache?.checkedDate !== today) {
                const rows = await fetchFredSeries(
                  fetchImpl,
                  fredApiKey,
                  "VIXCLS",
                  workerLatestDate || "1990-01-01",
                );
                localVixCache = {
                  checkedDate: today,
                  rows: rows.map((row) => ({ date: row.date, vix: row.value })),
                };
              }
              const directLatestDate = String(localVixCache?.rows?.at(-1)?.date || "").slice(0, 10);
              if (directLatestDate && directLatestDate > workerLatestDate) {
                const merged = new Map(workerVixRows.map((row) => [row.date, row]));
                localVixCache.rows.forEach((row) => merged.set(row.date, row));
                const vixRows = [...merged.values()].sort((left, right) => left.date.localeCompare(right.date));
                payload = {
                  ...payload,
                  latestDate: [payload?.latestDate || "", directLatestDate].sort().at(-1),
                  vixRows,
                  vixSource: "FRED VIXCLS (local latest check)",
                };
              }
              payload = {
                ...payload,
                vixOfficialLatestDate: [
                  String(payload?.vixOfficialLatestDate || "").slice(0, 10),
                  directLatestDate,
                ].filter(Boolean).sort().at(-1) || workerLatestDate,
              };
            } catch (error) {
              payload = {
                ...payload,
                warning: [
                  payload?.warning,
                  `FRED VIX 보완 지연: ${error?.message || error}`,
                ].filter(Boolean).join(" / "),
              };
            }
          }
          const vixOfficialLatestDate = String(
            payload?.vixOfficialLatestDate || payload?.vixRows?.at(-1)?.date || "",
          ).slice(0, 10);
          const vixLiveFresh = Date.now() - Number(localVixLiveCache?.checkedAt || 0) < 5 * 60 * 1000;
          if (forceRefresh || !vixLiveFresh) {
            try {
              localVixLiveCache = {
                checkedAt: Date.now(),
                rows: await fetchYahooVixRows(fetchImpl, {
                  cacheBust: Date.now(),
                  signal: AbortSignal.timeout(12000),
                }),
              };
            } catch (error) {
              payload = {
                ...payload,
                warning: [
                  payload?.warning,
                  `VIX 최신 시세 보완 지연: ${error?.message || error}`,
                ].filter(Boolean).join(" / "),
              };
            }
          }
          if (localVixLiveCache?.rows?.length) {
            const vixRows = mergeVixRows(
              payload?.vixRows,
              localVixLiveCache.rows,
              { afterDate: vixOfficialLatestDate },
            );
            const vixLiveDate = String(
              vixRows.at(-1)?.date > vixOfficialLatestDate ? vixRows.at(-1)?.date : "",
            );
            payload = {
              ...payload,
              latestDate: [payload?.latestDate || "", vixRows.at(-1)?.date || ""].sort().at(-1),
              vixRows,
              vixLiveCheckedAt: localVixLiveCache.checkedAt,
              vixLiveDate,
              vixSource: vixLiveDate
                ? "FRED VIXCLS + Yahoo Finance (local latest check)"
                : (payload?.vixSource || "FRED VIXCLS"),
            };
          }
          const upstreamSource = String(payload?.source || "");
          const upstreamRows = mergeVkospiRows(payload?.vkospiRows);
          const inferredOfficialLatestDate = payload?.vkospiOfficialLatestDate
            || (!upstreamSource.includes("Stockplus") ? upstreamRows.at(-1)?.date : "")
            || "";
          const sourcePlan = planVkospiSource(now, inferredOfficialLatestDate);
          const stockplusFreshMs = sourcePlan.stockplusLiveWindow
            ? sourcePolicy("indices").liveConfirmMs
            : 15 * 60 * 1000;
          const upstreamLiveFresh = payload?.vkospiLiveDate === today
            && Date.now() - Number(payload?.vkospiLiveCheckedAt || 0)
              < stockplusFreshMs;
          if (sourcePlan.useStockplus && !upstreamLiveFresh) {
            const localLiveFresh = vkospiLiveCache?.date === today
              && Date.now() - Number(vkospiLiveCache?.checkedAt || 0)
                < stockplusFreshMs;
            if (forceRefresh || !localLiveFresh) {
              try {
                const recentRows = await fetchStockplusVkospiRows(fetchImpl, {
                  expectedDate: today,
                  limit: 10,
                  signal: AbortSignal.timeout(10000),
                });
                const point = recentRows.at(-1);
                vkospiLiveCache = { ...point, rows: recentRows, checkedAt: Date.now() };
              } catch (error) {
                payload = {
                  ...payload,
                  warning: [
                    payload?.warning,
                    `증권플러스 VKOSPI 장중 갱신 지연: ${error?.message || error}`,
                  ].filter(Boolean).join(" / "),
                };
              }
            }
            if (vkospiLiveCache?.date === today) {
              const vkospiRows = mergeVkospiFallbackRows(
                payload?.vkospiRows,
                vkospiLiveCache.rows || [vkospiLiveCache],
                { liveDate: today },
              );
              payload = {
                ...payload,
                source: sourcePlan.stockplusLiveWindow
                  ? "FRED + KRX + Stockplus (intraday)"
                  : "FRED + KRX + Stockplus (settlement fallback)",
                latestDate: [
                  payload?.records?.at(-1)?.date || "",
                  vkospiRows.at(-1)?.date || "",
                  payload?.vixRows?.at(-1)?.date || "",
                ]
                  .sort().at(-1),
                vkospiRows,
                vkospiLive: true,
                vkospiLiveDate: today,
                vkospiLiveCheckedAt: vkospiLiveCache.checkedAt,
              };
            }
          }
        }
        const kind = requestUrl.pathname === "/api/macro"
          ? "macro"
          : (requestUrl.pathname === "/api/credit"
            ? "credit"
            : (requestUrl.pathname === "/api/crisis-signal" ? "crisis" : "insider"));
        const passthrough = requestUrl.pathname === "/api/indices"
          || requestUrl.pathname.startsWith("/api/research/");
        sendJson(
          request,
          response,
          200,
          passthrough ? payload : normalizeRuntimePayload(kind, payload),
        );
      } catch (error) {
        sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (requestUrl.pathname === "/api/dart/disclosures") {
      if (!isPrivateAddress(request.socket.remoteAddress)) {
        sendJson(request, response, 403, { ok: false, error: "로컬 네트워크에서만 사용할 수 있습니다." });
        return;
      }
      try {
        const ticker = String(requestUrl.searchParams.get("ticker") || "").toUpperCase();
        const force = ["1", "true", "yes"].includes(String(requestUrl.searchParams.get("force") || "").toLowerCase());
        const result = await gateway.disclosures(ticker, force);
        sendJson(request, response, 200, {
          ok: true,
          ticker,
          cached: result.cached,
          latestDate: result.records.at(-1)?.date || "",
          records: result.records,
        });
      } catch (error) {
        sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(request, response, 404, { ok: false, error: "API 경로를 찾을 수 없습니다." });
      return;
    }
    try {
      await serveStatic(response, requestUrl.pathname, request.method === "HEAD", dataMirrorDir);
    } catch (_) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  return server;
}

function localAddresses(port) {
  const addresses = new Set(["127.0.0.1"]);
  Object.values(networkInterfaces()).flat().forEach((item) => {
    if (item?.family === "IPv4" && isPrivateAddress(item.address)) addresses.add(item.address);
  });
  return [...addresses].sort().map((address) => `http://${address}:${port}`);
}

async function main() {
  const portIndex = process.argv.indexOf("--port");
  const hostIndex = process.argv.indexOf("--host");
  const port = Math.max(1, Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8787) || 8787);
  const host = String(hostIndex >= 0 ? process.argv[hostIndex + 1] : "0.0.0.0");
  const server = await createThinkStockServer();
  server.listen(port, host, () => {
    console.log("ThinkStock 로컬 서버가 시작되었습니다.");
    localAddresses(port).forEach((address) => console.log(`접속 주소: ${address}`));
    console.log("종료하려면 이 창에서 Ctrl+C를 누르세요.");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
