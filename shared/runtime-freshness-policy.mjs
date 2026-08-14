import {
  isKoreanCurrentPriceWindow,
  koreanDateText,
} from "./market-calendar.mjs";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_SECONDS = 24 * 60 * 60;

export const RUNTIME_SOURCE_POLICIES = Object.freeze({
  price: Object.freeze({
    currentDayCacheSeconds: 60,
    emptyCacheSeconds: 10 * 60,
    stableCacheSeconds: 15 * DAY_SECONDS,
    liveConfirmMs: 60 * SECOND_MS,
    retryDelaysMs: Object.freeze([500, 1500]),
  }),
  indices: Object.freeze({
    currentDayCacheSeconds: 60,
    emptyCacheSeconds: 60,
    stableCacheSeconds: DAY_SECONDS,
    liveConfirmMs: 60 * SECOND_MS,
    retryDelaysMs: Object.freeze([500, 1500]),
  }),
  adr: Object.freeze({
    liveConfirmMs: 2 * MINUTE_MS,
    retryDelaysMs: Object.freeze([3000, 15000]),
  }),
  fearGreed: Object.freeze({
    liveConfirmMs: 2 * MINUTE_MS,
    retryDelaysMs: Object.freeze([1000, 3000]),
  }),
  credit: Object.freeze({
    liveConfirmMs: 24 * 60 * MINUTE_MS,
    retryDelaysMs: Object.freeze([500]),
  }),
  macro: Object.freeze({
    liveConfirmMs: 6 * 60 * MINUTE_MS,
    retryDelaysMs: Object.freeze([1000]),
  }),
  crisis: Object.freeze({
    liveConfirmMs: 6 * 60 * MINUTE_MS,
    retryDelaysMs: Object.freeze([1000]),
  }),
  disclosure: Object.freeze({
    liveConfirmMs: 30 * SECOND_MS,
    retryDelaysMs: Object.freeze([400, 800]),
  }),
});

export function sourcePolicy(kind) {
  return RUNTIME_SOURCE_POLICIES[kind] || Object.freeze({
    liveConfirmMs: 5 * MINUTE_MS,
    retryDelaysMs: Object.freeze([]),
  });
}

export function cacheTtlSeconds(kind, options = {}) {
  const policy = sourcePolicy(kind);
  const baseDate = String(options.baseDate || "").slice(0, 10);
  const today = koreanDateText(options.now || new Date());
  if (baseDate && baseDate === today && Number(policy.currentDayCacheSeconds) > 0) {
    return policy.currentDayCacheSeconds;
  }
  if (options.empty === true && Number(policy.emptyCacheSeconds) > 0) {
    return policy.emptyCacheSeconds;
  }
  return Number(policy.stableCacheSeconds) || 5 * 60;
}

export function retryDelaysMs(kind) {
  return [...(sourcePolicy(kind).retryDelaysMs || [])];
}

export function shouldConfirmRuntimeSource(kind, options = {}) {
  if (options.force === true) return true;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const checkedAt = Number(options.checkedAt) || 0;
  const ageMs = now.getTime() - checkedAt;
  const policy = sourcePolicy(kind);
  if (!checkedAt || ageMs < 0) return true;
  if (["price", "indices"].includes(kind) && isKoreanCurrentPriceWindow(now)) {
    return ageMs >= policy.liveConfirmMs;
  }
  return ageMs >= policy.liveConfirmMs;
}

function abortError() {
  const error = new Error("runtime source refresh aborted");
  error.name = "AbortError";
  return error;
}

function wait(delayMs, signal, sleep = null) {
  if (typeof sleep === "function") return sleep(delayMs, signal);
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(finish, Math.max(0, Number(delayMs) || 0));
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

export async function executeRuntimeSourcePlan(kind, handlers = {}, options = {}) {
  const primary = handlers.primary || handlers.request;
  if (typeof primary !== "function") throw new Error("runtime source primary loader is required");
  const signal = options.signal || null;
  const delays = Array.isArray(options.delaysMs)
    ? options.delaysMs.map(Number).filter((value) => Number.isFinite(value) && value >= 0)
    : retryDelaysMs(kind);
  const isRetryable = typeof options.isRetryable === "function"
    ? options.isRetryable
    : (error) => error?.retryable !== false;
  let lastError = null;
  let attempts = 0;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (signal?.aborted) throw abortError();
    attempts += 1;
    try {
      return Object.freeze({
        value: await primary({ attempt, signal }),
        source: "primary",
        stale: false,
        attempts,
      });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      lastError = error;
      if (attempt >= delays.length || !isRetryable(error, attempt)) break;
      await wait(delays[attempt], signal, options.sleep);
    }
  }
  if (typeof handlers.fallback === "function") {
    try {
      return Object.freeze({
        value: await handlers.fallback({ error: lastError, signal }),
        source: "fallback",
        stale: false,
        attempts,
      });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      lastError = error;
    }
  }
  if (typeof handlers.cache === "function") {
    return Object.freeze({
      value: await handlers.cache({ error: lastError, signal }),
      source: "cache",
      stale: true,
      attempts,
    });
  }
  throw lastError || new Error(`runtime source ${kind || "unknown"} failed`);
}

const api = Object.freeze({
  RUNTIME_SOURCE_POLICIES,
  cacheTtlSeconds,
  executeRuntimeSourcePlan,
  retryDelaysMs,
  shouldConfirmRuntimeSource,
  sourcePolicy,
});

if (typeof globalThis !== "undefined") globalThis.ThinkStockRuntimeFreshnessPolicy = api;
