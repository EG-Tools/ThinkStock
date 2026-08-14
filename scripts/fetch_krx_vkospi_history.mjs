import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchKrxVkospiPoint,
  KRX_VKOSPI_START_DATE,
  shouldRememberEmptyVkospiDate,
  withVkospiChanges,
} from "../shared/krx-volatility-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const CACHE_PATH = path.join(CACHE_DIR, "vkospi-history.json");
const ENV_PATH = path.join(ROOT, ".env.local");
const args = process.argv.slice(2);
const RETRY_DELAYS_MS = Object.freeze([0, 3000, 15000]);

function argument(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function parseEnv(text) {
  const values = {};
  String(text || "").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
  });
  return values;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function weekdayDates(from, to) {
  const output = [];
  for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${to}T00:00:00Z`); time += 86400000) {
    const date = new Date(time);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) output.push(date.toISOString().slice(0, 10));
  }
  return output;
}

async function readCache() {
  try {
    const value = JSON.parse(await readFile(CACHE_PATH, "utf8"));
    return value?.format === "thinkstock-vkospi-history-v1" ? value : null;
  } catch (_) {
    return null;
  }
}

async function saveCache(rowsByDate, checkedDates, bootstrap = null) {
  const rows = withVkospiChanges([...rowsByDate.values()]);
  const payload = {
    format: "thinkstock-vkospi-history-v1",
    source: bootstrap
      ? "KRX 파생상품지수 시세정보 + 증권플러스 과거 보완"
      : "KRX 파생상품지수 시세정보",
    generatedAt: new Date().toISOString(),
    firstDate: rows.at(0)?.date || "",
    latestDate: rows.at(-1)?.date || "",
    rows,
    checkedDates: [...checkedDates].sort(),
    ...(bootstrap ? { bootstrap } : {}),
  };
  const temporary = `${CACHE_PATH}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(temporary, CACHE_PATH);
  return payload;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchPointWithRetry(apiKey, date) {
  let lastError = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt] > 0) await wait(RETRY_DELAYS_MS[attempt]);
    try {
      return await fetchKrxVkospiPoint(fetch, apiKey, date, {
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (error?.code === "KRX_VKOSPI_UNAUTHORIZED") throw error;
      lastError = error;
      const retryable = error?.retryable === true
        || error?.name === "TimeoutError"
        || error?.name === "AbortError"
        || !Number.isFinite(Number(error?.status));
      if (!retryable) break;
    }
  }
  throw lastError || new Error(`VKOSPI ${date} request failed`);
}

const from = argument("--from", KRX_VKOSPI_START_DATE);
const to = argument("--to", new Date().toISOString().slice(0, 10));
const concurrency = Math.max(1, Math.min(6, Number(argument("--concurrency", "4")) || 4));
const requestIntervalMs = Math.max(100, Math.min(5000, Number(argument("--request-interval-ms", "350")) || 350));
const maxRequests = Math.max(0, Number(argument("--max-requests", "0")) || 0);
if (!validDate(from) || !validDate(to) || from > to) throw new Error("VKOSPI date range is invalid");

await mkdir(CACHE_DIR, { recursive: true });
const env = parseEnv(await readFile(ENV_PATH, "utf8").catch(() => ""));
const apiKey = String(env.KRX_API_KEY || env.KRX_AUTH_KEY || "").trim();
if (!apiKey) throw new Error(".env.local에 KRX_API_KEY가 필요합니다.");

const existing = await readCache();
const bootstrap = args.includes("--refresh") ? null : (existing?.bootstrap || null);
const rowsByDate = new Map((existing?.rows || []).map((row) => [row.date, row]));
const latestCachedDate = [...rowsByDate.keys()].sort().at(-1) || "";
const checkedDates = new Set(args.includes("--refresh")
  ? []
  : (existing?.checkedDates || []).filter((date) => !latestCachedDate || date <= latestCachedDate));
if (args.includes("--refresh")) rowsByDate.clear();
const verifyExisting = args.includes("--verify-existing");
const pending = weekdayDates(from, to).filter((date) => (
  !checkedDates.has(date) && (verifyExisting || !rowsByDate.has(date))
));
if (args.includes("--newest-first")) pending.reverse();
if (maxRequests > 0) pending.splice(maxRequests);
let cursor = 0;
let completed = 0;
let failed = 0;
const failedDates = [];
let stoppedReason = "";
let requestQueue = Promise.resolve();
let nextRequestAt = 0;

async function waitForRequestSlot() {
  const scheduled = requestQueue.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay > 0) await wait(delay);
    nextRequestAt = Date.now() + requestIntervalMs;
  });
  requestQueue = scheduled.catch(() => {});
  await scheduled;
}

async function rateLimitedFetchPoint(apiKey, date) {
  await waitForRequestSlot();
  return fetchPointWithRetry(apiKey, date);
}

const workers = Array.from({ length: Math.min(concurrency, pending.length || 1) }, async () => {
  while (cursor < pending.length && !stoppedReason) {
    const index = cursor;
    cursor += 1;
    const date = pending[index];
    try {
      const point = await rateLimitedFetchPoint(apiKey, date);
      if (point) {
        rowsByDate.set(point.date, point);
        checkedDates.add(date);
      } else if (shouldRememberEmptyVkospiDate(date, new Date().toISOString().slice(0, 10))) {
        checkedDates.add(date);
      }
    } catch (error) {
      if (error?.code === "KRX_VKOSPI_UNAUTHORIZED") throw error;
      failed += 1;
      failedDates.push(date);
      if ([403, 429].includes(Number(error?.status))) {
        stoppedReason = `KRX HTTP ${error.status}: 호출 제한 해제 후 다시 실행하세요.`;
      }
      if (failedDates.length <= 5) {
        process.stderr.write(`VKOSPI ${date} 실패: ${error?.message || error}\n`);
      }
    }
    completed += 1;
    if (completed % 100 === 0) {
      await saveCache(rowsByDate, checkedDates, bootstrap);
      process.stderr.write(`VKOSPI ${completed}/${pending.length}\n`);
    }
  }
});

await Promise.all(workers);
const result = await saveCache(rowsByDate, checkedDates, bootstrap);
console.log(JSON.stringify({
  cache: path.relative(ROOT, CACHE_PATH),
  requested: pending.length,
  failed,
  rows: result.rows.length,
  firstDate: result.firstDate,
  latestDate: result.latestDate,
  failedDates: failedDates.slice(0, 20),
  stoppedReason,
}, null, 2));
if (failed > 0 || stoppedReason) process.exitCode = 1;
