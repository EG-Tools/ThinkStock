import { failureBackoffMs } from "../../shared/runtime-freshness-policy.mjs";

"use strict";

  const STORAGE_KEY = "thinkstock-runtime-source-health-v1";
  const MAX_BLOCK_AGE_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_BACKOFF_MS = Object.freeze([30_000, 120_000, 300_000]);
  const SOURCE_NAMES = Object.freeze([
    "indices", "prices", "prices-hidden", "adr", "fearGreed", "credit",
    "macro", "macro:leading", "macro:news", "macro:policyRate",
    "macro:trade", "macro:trade:export", "macro:trade:import",
    "volatility", "volatility:vkospi", "volatility:vix", "crisis",
    "disclosure", "insider", "brokerResearch",
  ]);
  const SOURCE_BACKOFF_MS = Object.freeze(Object.fromEntries(SOURCE_NAMES.map((source) => [
    source,
    Object.freeze([1, 2, 3].map((failureCount) => (
      Number(failureBackoffMs(source, failureCount))
      || DEFAULT_BACKOFF_MS[failureCount - 1]
    ))),
  ])));

  function sourceKey(value) {
    return String(value || "").trim().slice(0, 40);
  }

  function finiteTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function boundedCount(value) {
    return Math.max(0, Math.min(100000, Math.trunc(Number(value) || 0)));
  }

  function qualityState(value = {}) {
    if (value.isEmpty === true) return "error";
    if (value.isStale === true || boundedCount(value.anomalyCount) || boundedCount(value.gapCount)) {
      return "stale";
    }
    return "ready";
  }

  function effectiveState(value = {}) {
    if (value.state === "error" || value.qualityState === "error" || value.isEmpty === true) {
      return "error";
    }
    if (
      value.state === "stale"
      || value.qualityState === "stale"
      || value.isStale === true
      || boundedCount(value.anomalyCount) > 0
      || boundedCount(value.gapCount) > 0
    ) {
      return "stale";
    }
    return "ready";
  }

  function summarizeSourceStates(snapshot = {}) {
    const entries = Object.entries(snapshot && typeof snapshot === "object" ? snapshot : {})
      .map(([source, value]) => normalizeState(source, value))
      .filter(Boolean)
      .sort((left, right) => left.source.localeCompare(right.source));
    const states = { ready: 0, stale: 0, error: 0 };
    const issueSources = [];
    let anomalyCount = 0;
    let gapCount = 0;
    let latestObservedAt = 0;
    const coverage = {};
    entries.forEach((entry) => {
      const state = effectiveState(entry);
      states[state] += 1;
      anomalyCount += boundedCount(entry.anomalyCount);
      gapCount += boundedCount(entry.gapCount);
      latestObservedAt = Math.max(latestObservedAt, entry.observedAt, entry.lastSuccessAt, entry.lastFailureAt);
      if (state !== "ready") issueSources.push(entry.source);
      if (entry.firstDate || entry.latestDate) {
        coverage[entry.source] = Object.freeze({
          firstDate: entry.firstDate,
          latestDate: entry.latestDate,
          state,
        });
      }
    });
    return Object.freeze({
      total: entries.length,
      states: Object.freeze(states),
      issueSources: Object.freeze(issueSources),
      anomalyCount,
      gapCount,
      latestObservedAt,
      coverage: Object.freeze(coverage),
    });
  }

  function normalizeState(source, value = {}) {
    const key = sourceKey(source);
    if (!key) return null;
    return Object.freeze({
      source: key,
      state: value.state === "ready" ? "ready" : (value.lastSuccessAt ? "stale" : "error"),
      lastSuccessAt: finiteTimestamp(value.lastSuccessAt),
      lastFailureAt: finiteTimestamp(value.lastFailureAt),
      failureCount: Math.max(0, Math.min(20, Number(value.failureCount) || 0)),
      latestDate: String(value.latestDate || "").slice(0, 10),
      firstDate: String(value.firstDate || "").slice(0, 10),
      detail: String(value.detail || "").slice(0, 200),
      lastError: String(value.lastError || "").slice(0, 300),
      observedAt: finiteTimestamp(value.observedAt),
      qualityState: ["ready", "stale", "error"].includes(value.qualityState)
        ? value.qualityState
        : "",
      anomalyCount: boundedCount(value.anomalyCount),
      gapCount: boundedCount(value.gapCount),
      isEmpty: value.isEmpty === true,
      isStale: value.isStale === true,
      revision: String(value.revision || "").slice(0, 120),
    });
  }

  function safeStorage(scope, override) {
    if (override === null) return null;
    if (override) return override;
    try {
      return scope?.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  function backoffFor(source, failureCount) {
    const shared = Number(failureBackoffMs(source, failureCount));
    if (Number.isFinite(shared) && shared >= 0) return shared;
    const values = SOURCE_BACKOFF_MS[source] || DEFAULT_BACKOFF_MS;
    const index = Math.max(0, Math.min(values.length - 1, (Number(failureCount) || 1) - 1));
    return values[index];
  }

  function createRuntimeSourceHealth(scope = globalThis, options = {}) {
    const now = typeof options.now === "function" ? options.now : Date.now;
    const storageKey = String(options.storageKey || STORAGE_KEY);
    const storage = safeStorage(scope, options.storage);
    const persistDelayMs = Math.max(0, Number(options.persistDelayMs) || 0);
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    const states = new Map();
    let persistTimer = 0;
    let persistDirty = false;

    function persistNow() {
      if (persistTimer) clearTimer?.(persistTimer);
      persistTimer = 0;
      if (!storage || !persistDirty) return;
      try {
        storage.setItem(storageKey, JSON.stringify(Object.fromEntries(states)));
        persistDirty = false;
      } catch (_) {}
    }

    function persist() {
      if (!storage) return;
      persistDirty = true;
      if (!persistDelayMs || typeof setTimer !== "function") {
        persistNow();
        return;
      }
      if (persistTimer) return;
      persistTimer = setTimer(persistNow, persistDelayMs) || 0;
    }

    function hydrate() {
      if (!storage) return;
      try {
        const parsed = JSON.parse(storage.getItem(storageKey) || "{}");
        Object.entries(parsed || {}).forEach(([source, value]) => {
          const normalized = normalizeState(source, value);
          if (normalized) states.set(normalized.source, normalized);
        });
      } catch (_) {}
    }

    function commitSuccess(source, detail = {}, includeQuality = false) {
      const key = sourceKey(source);
      if (!key) return null;
      const previous = states.get(key) || {};
      const timestamp = now();
      const next = normalizeState(key, {
        state: "ready",
        lastSuccessAt: timestamp,
        lastFailureAt: previous.lastFailureAt,
        failureCount: 0,
        latestDate: detail.latestDate || previous.latestDate,
        firstDate: detail.firstDate || previous.firstDate,
        detail: detail.detail,
        lastError: "",
        observedAt: includeQuality ? timestamp : previous.observedAt,
        qualityState: includeQuality ? qualityState(detail) : previous.qualityState,
        anomalyCount: includeQuality ? detail.anomalyCount : previous.anomalyCount,
        gapCount: includeQuality ? detail.gapCount : previous.gapCount,
        isEmpty: includeQuality ? detail.isEmpty : previous.isEmpty,
        isStale: includeQuality ? detail.isStale : previous.isStale,
        revision: (includeQuality && detail.revision) || previous.revision,
      });
      states.set(key, next);
      persist();
      return next;
    }

    const success = (source, detail) => commitSuccess(source, detail, false);
    const recordSuccess = (source, detail) => commitSuccess(source, detail, true);

    function failure(source, error) {
      const key = sourceKey(source);
      if (!key) return null;
      const previous = states.get(key) || {};
      const next = normalizeState(key, {
        state: previous.lastSuccessAt ? "stale" : "error",
        lastSuccessAt: previous.lastSuccessAt,
        lastFailureAt: now(),
        failureCount: (Number(previous.failureCount) || 0) + 1,
        latestDate: previous.latestDate,
        firstDate: previous.firstDate,
        detail: previous.detail,
        lastError: error?.message || error || "request failed",
        observedAt: previous.observedAt,
        qualityState: previous.qualityState,
        anomalyCount: previous.anomalyCount,
        gapCount: previous.gapCount,
        isEmpty: previous.isEmpty,
        isStale: previous.isStale,
        revision: previous.revision,
      });
      states.set(key, next);
      persist();
      return next;
    }

    function observe(source, detail = {}) {
      const key = sourceKey(source);
      if (!key) return null;
      const previous = states.get(key) || {};
      const nextQualityState = qualityState(detail);
      const next = normalizeState(key, {
        ...previous,
        state: previous.state || nextQualityState,
        firstDate: detail.firstDate || previous.firstDate,
        latestDate: detail.latestDate || previous.latestDate,
        observedAt: now(),
        qualityState: nextQualityState,
        anomalyCount: detail.anomalyCount,
        gapCount: detail.gapCount,
        isEmpty: detail.isEmpty,
        isStale: detail.isStale,
        revision: detail.revision || previous.revision,
        detail: detail.detail ?? previous.detail,
      });
      states.set(key, next);
      persist();
      return next;
    }

    function canAttempt(source, attemptOptions = {}) {
      const key = sourceKey(source);
      const state = states.get(key) || null;
      if (!key || attemptOptions.force === true || !state?.lastFailureAt || state.failureCount < 1) {
        return Object.freeze({ allowed: true, source: key, waitMs: 0, state });
      }
      const ageMs = Math.max(0, now() - state.lastFailureAt);
      if (ageMs >= MAX_BLOCK_AGE_MS) {
        return Object.freeze({ allowed: true, source: key, waitMs: 0, state });
      }
      const waitMs = Math.max(0, backoffFor(key, state.failureCount) - ageMs);
      return Object.freeze({ allowed: waitMs === 0, source: key, waitMs, state });
    }

    function clear() {
      if (persistTimer) clearTimer?.(persistTimer);
      persistTimer = 0;
      persistDirty = false;
      states.clear();
      try {
        storage?.removeItem(storageKey);
      } catch (_) {}
    }

    hydrate();
    return Object.freeze({
      canAttempt,
      clear,
      failure,
      flush: persistNow,
      observe,
      recordSuccess,
      snapshot: () => Object.freeze(Object.fromEntries(states)),
      summary: () => summarizeSourceStates(Object.fromEntries(states)),
      success,
      dispose: persistNow,
    });
  }

export {
  MAX_BLOCK_AGE_MS,
  SOURCE_BACKOFF_MS,
  STORAGE_KEY,
  createRuntimeSourceHealth,
  summarizeSourceStates,
};
