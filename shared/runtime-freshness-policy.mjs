import {
  isKoreanCurrentPriceWindow,
  koreanDateText,
} from "./market-calendar.mjs";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_SECONDS = 24 * 60 * 60;

const DEFAULT_POLICY = Object.freeze({
  emptyCacheSeconds: 5 * 60,
  stableCacheSeconds: 5 * 60,
  liveConfirmMs: 5 * MINUTE_MS,
  retryDelaysMs: Object.freeze([]),
  failureBackoffMs: Object.freeze([30_000, 120_000, 300_000]),
});

export const RUNTIME_SOURCE_POLICIES = Object.freeze({
  price: Object.freeze({
    currentDayCacheSeconds: 60,
    emptyCacheSeconds: 10 * 60,
    stableCacheSeconds: 15 * DAY_SECONDS,
    liveConfirmMs: 60 * SECOND_MS,
    retryDelaysMs: Object.freeze([500, 1500]),
    failureBackoffMs: Object.freeze([15_000, 60_000, 300_000]),
  }),
  indices: Object.freeze({
    currentDayCacheSeconds: 60,
    emptyCacheSeconds: 60,
    stableCacheSeconds: DAY_SECONDS,
    liveConfirmMs: 60 * SECOND_MS,
    retryDelaysMs: Object.freeze([500, 1500]),
    failureBackoffMs: Object.freeze([15_000, 60_000, 300_000]),
  }),
  adr: Object.freeze({
    liveConfirmMs: 2 * MINUTE_MS,
    retryDelaysMs: Object.freeze([3000, 15000]),
    failureBackoffMs: Object.freeze([30_000, 120_000, 300_000]),
  }),
  fearGreed: Object.freeze({
    liveConfirmMs: 2 * MINUTE_MS,
    retryDelaysMs: Object.freeze([1000, 3000]),
    failureBackoffMs: Object.freeze([30_000, 120_000, 300_000]),
  }),
  credit: Object.freeze({
    liveConfirmMs: 24 * 60 * MINUTE_MS,
    retryDelaysMs: Object.freeze([500]),
    failureBackoffMs: Object.freeze([60_000, 300_000, 900_000]),
  }),
  macro: Object.freeze({
    liveConfirmMs: 6 * 60 * MINUTE_MS,
    retryDelaysMs: Object.freeze([1000]),
    failureBackoffMs: Object.freeze([60_000, 300_000, 900_000]),
  }),
  crisis: Object.freeze({
    liveConfirmMs: 6 * 60 * MINUTE_MS,
    retryDelaysMs: Object.freeze([1000]),
    failureBackoffMs: Object.freeze([60_000, 300_000, 900_000]),
  }),
  disclosure: Object.freeze({
    liveConfirmMs: 30 * SECOND_MS,
    retryDelaysMs: Object.freeze([400, 800]),
    failureBackoffMs: Object.freeze([30_000, 120_000, 300_000]),
  }),
  insider: Object.freeze({
    emptyCacheSeconds: 15 * 60,
    stableCacheSeconds: 6 * 60 * 60,
    liveConfirmMs: 30 * SECOND_MS,
    retryDelaysMs: Object.freeze([400, 800]),
    failureBackoffMs: Object.freeze([30_000, 120_000, 300_000]),
  }),
  brokerResearch: Object.freeze({
    emptyCacheSeconds: 15 * 60,
    stableCacheSeconds: DAY_SECONDS,
    liveConfirmMs: 15 * MINUTE_MS,
    retryDelaysMs: Object.freeze([800]),
    failureBackoffMs: Object.freeze([60_000, 300_000, 900_000]),
  }),
});

function normalizedKind(kind) {
  const value = String(kind || "").trim();
  if (value === "prices" || value === "prices-hidden") return "price";
  return value;
}

export function sourcePolicy(kind) {
  return RUNTIME_SOURCE_POLICIES[normalizedKind(kind)] || DEFAULT_POLICY;
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

export function failureBackoffMs(kind, failureCount = 1) {
  const delays = sourcePolicy(kind).failureBackoffMs || DEFAULT_POLICY.failureBackoffMs;
  const index = Math.max(0, Math.min(delays.length - 1, Math.trunc(Number(failureCount) || 1) - 1));
  return Number(delays[index]) || 0;
}

function recordTimestamp(record = {}) {
  const candidates = [
    record.checkedAt,
    record.lastFailureAt,
    record.savedAt,
    record.cacheMeta?.savedAt,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function recordState(record = {}, options = {}) {
  if (options.state === "error" || options.state === "empty" || options.state === "ready") {
    return options.state;
  }
  if (record.resultState === "error" || record.resultState === "empty" || record.resultState === "ready") {
    return record.resultState;
  }
  if (options.empty === true) return "empty";
  if (record.complete === false || Number(record.failureCount) > 0) return "error";
  return "ready";
}

export function cacheRefreshDecision(kind, record, options = {}) {
  const state = record ? recordState(record, options) : "missing";
  const nowValue = options.now instanceof Date
    ? options.now.getTime()
    : Number(options.now) || Date.now();
  const checkedAt = recordTimestamp(record || {});
  const ageMs = checkedAt ? nowValue - checkedAt : Number.POSITIVE_INFINITY;
  let ttlMs = 0;
  if (state === "ready") {
    const maximumAgeMs = Number(options.maximumAgeMs);
    ttlMs = Number.isFinite(maximumAgeMs) && maximumAgeMs >= 0
      ? maximumAgeMs
      : cacheTtlSeconds(kind, options) * SECOND_MS;
  } else if (state === "empty") {
    ttlMs = (Number(sourcePolicy(kind).emptyCacheSeconds) || DEFAULT_POLICY.emptyCacheSeconds) * SECOND_MS;
  } else if (state === "error") {
    ttlMs = failureBackoffMs(kind, record?.failureCount);
  }
  const refresh = options.force === true
    || state === "missing"
    || !checkedAt
    || ageMs < 0
    || ageMs >= ttlMs;
  const waitMs = refresh ? 0 : Math.max(0, ttlMs - ageMs);
  return Object.freeze({
    reuse: !refresh,
    refresh,
    reason: options.force === true
      ? "forced"
      : (refresh ? `${state}-stale` : `${state}-fresh`),
    state,
    ageMs,
    retryAt: refresh ? nowValue : checkedAt + ttlMs,
    waitMs,
  });
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
  cacheRefreshDecision,
  cacheTtlSeconds,
  executeRuntimeSourcePlan,
  failureBackoffMs,
  retryDelaysMs,
  shouldConfirmRuntimeSource,
  sourcePolicy,
});

if (typeof globalThis !== "undefined") globalThis.ThinkStockRuntimeFreshnessPolicy = api;
