import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareVkospiOverlap,
  KRX_VKOSPI_START_DATE,
  mergeVkospiRows,
  STOCKPLUS_VKOSPI_ENDPOINT,
  STOCKPLUS_VKOSPI_PAGE_URL,
  STOCKPLUS_VKOSPI_SECURITY_ID,
  vkospiRowsFromStockplusPayload,
} from "../shared/krx-volatility-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const CACHE_PATH = path.join(CACHE_DIR, "vkospi-history.json");
const args = process.argv.slice(2);
const PAGE_SIZE = 500;
const RETRY_DELAYS_MS = Object.freeze([0, 1000, 3000]);

function argument(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function previousDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readCache() {
  try {
    const value = JSON.parse(await readFile(CACHE_PATH, "utf8"));
    return value?.format === "thinkstock-vkospi-history-v1" ? value : null;
  } catch (_) {
    return null;
  }
}

async function fetchPage(toDate = "") {
  const url = new URL(STOCKPLUS_VKOSPI_ENDPOINT);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (toDate) url.searchParams.set("to", toDate);
  let lastError = null;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await wait(delay);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Stockplus VKOSPI HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.dayCandles)) throw new Error("Stockplus VKOSPI 응답 형식이 올바르지 않습니다.");
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Stockplus VKOSPI 요청에 실패했습니다.");
}

const existing = await readCache();
const from = argument("--from", KRX_VKOSPI_START_DATE);
const existingLatest = mergeVkospiRows(existing?.rows).at(-1)?.date || "";
const to = argument("--to", existingLatest || new Date().toISOString().slice(0, 10));
const requestDelayMs = Math.max(100, Math.min(5000, Number(argument("--request-delay-ms", "300")) || 300));
const maxPages = Math.max(1, Math.min(30, Number(argument("--max-pages", "20")) || 20));
if (!validDate(from) || !validDate(to) || from > to) throw new Error("VKOSPI 수집 기간이 올바르지 않습니다.");

const collected = [];
let cursor = "";
let pages = 0;
for (; pages < maxPages; pages += 1) {
  const payload = await fetchPage(cursor);
  const pageRows = vkospiRowsFromStockplusPayload(payload, { from: "1900-01-01", to });
  if (!pageRows.length) break;
  collected.push(...pageRows);
  const oldestDate = pageRows[0].date;
  process.stderr.write(`Stockplus VKOSPI ${pages + 1}페이지: ${oldestDate} ~ ${pageRows.at(-1).date}\n`);
  if (oldestDate <= from || payload.dayCandles.length < PAGE_SIZE) {
    pages += 1;
    break;
  }
  cursor = previousDate(oldestDate);
  await wait(requestDelayMs);
}

const fallbackRows = mergeVkospiRows(collected).filter((row) => row.date >= from && row.date <= to);
if (!fallbackRows.length || fallbackRows[0].date > from) {
  throw new Error(`Stockplus VKOSPI 과거 데이터가 ${from}까지 도달하지 못했습니다.`);
}
const comparison = compareVkospiOverlap(existing?.rows, fallbackRows);
if (comparison.overlapCount < 3) {
  throw new Error(`KRX 교차검증 표본이 부족합니다: ${comparison.overlapCount}개`);
}
if (comparison.mismatches.length) {
  throw new Error(`KRX 교차검증 불일치: ${JSON.stringify(comparison.mismatches.slice(0, 5))}`);
}

// Existing KRX rows are merged last so official OHLC fields and corrections win.
const rows = mergeVkospiRows(fallbackRows, existing?.rows);
const payload = {
  format: "thinkstock-vkospi-history-v1",
  source: "KRX 파생상품지수 시세정보 + 증권플러스 과거 보완",
  generatedAt: new Date().toISOString(),
  firstDate: rows[0]?.date || "",
  latestDate: rows.at(-1)?.date || "",
  rows,
  checkedDates: Array.isArray(existing?.checkedDates) ? existing.checkedDates : [],
  bootstrap: {
    source: "증권플러스",
    securityId: STOCKPLUS_VKOSPI_SECURITY_ID,
    pageUrl: STOCKPLUS_VKOSPI_PAGE_URL,
    collectedAt: new Date().toISOString(),
    firstDate: fallbackRows[0]?.date || "",
    latestDate: fallbackRows.at(-1)?.date || "",
    rows: fallbackRows.length,
    krxOverlapCount: comparison.overlapCount,
  },
};

await mkdir(CACHE_DIR, { recursive: true });
const temporary = `${CACHE_PATH}.tmp`;
await writeFile(temporary, `${JSON.stringify(payload)}\n`, "utf8");
await rename(temporary, CACHE_PATH);
console.log(JSON.stringify({
  cache: path.relative(ROOT, CACHE_PATH),
  pages,
  rows: rows.length,
  firstDate: payload.firstDate,
  latestDate: payload.latestDate,
  krxOverlapCount: comparison.overlapCount,
}, null, 2));
