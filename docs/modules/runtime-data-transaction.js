(function initThinkStockRuntimeDataTransaction(globalScope) {
  "use strict";

  const health = globalScope.ThinkStockDataHealth;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function seriesStats(rows, key) {
    let first = "";
    let latest = "";
    let count = 0;
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || finite(row?.[key]) === null) return;
      count += 1;
      if (!first || date < first) first = date;
      if (!latest || date > latest) latest = date;
    });
    return { first, latest, count };
  }

  function anomalyKey(issue) {
    return [issue?.key, issue?.kind, issue?.previousDate || "", issue?.latestDate || ""].join(":");
  }

  function incomingValueIssues(rows, policies) {
    const issues = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      Object.entries(policies || {}).forEach(([key, policy]) => {
        const value = finite(row?.[key]);
        if (value === null) return;
        const rejectedZero = policy?.rejectZero === true && value === 0;
        const belowMinimum = Number.isFinite(policy?.minValue) && value < Number(policy.minValue);
        const aboveMaximum = Number.isFinite(policy?.maxValue) && value > Number(policy.maxValue);
        if (!rejectedZero && !belowMinimum && !aboveMaximum) return;
        issues.push({
          key,
          kind: rejectedZero ? "zero" : "range",
          latestDate: date,
          latestValue: value,
        });
      });
    });
    return issues;
  }

  function validateSeriesRows(options = {}) {
    const currentRows = Array.isArray(options.currentRows) ? options.currentRows : [];
    const candidateRows = Array.isArray(options.candidateRows) ? options.candidateRows : [];
    const incomingRows = Array.isArray(options.incomingRows) ? options.incomingRows : [];
    const keys = [...new Set((options.keys || []).map(String).filter(Boolean))];
    const policies = options.policies || {};
    const gapPolicies = options.gapPolicies || {};
    const allowLatestRegression = new Set(options.allowLatestRegressionKeys || []);
    const allowCountDecrease = new Set(options.allowCountDecreaseKeys || []);

    if (!candidateRows.length && currentRows.length) {
      return { ok: false, reason: "candidate-empty", issues: [] };
    }

    const directIssues = incomingValueIssues(incomingRows, policies);
    if (directIssues.length) {
      return { ok: false, reason: "incoming-range", issues: directIssues };
    }

    const detect = health?.detectRecentChanges;
    const beforeIssues = typeof detect === "function" ? detect(currentRows, policies) : [];
    const afterIssues = typeof detect === "function" ? detect(candidateRows, policies) : [];
    const beforeKeys = new Set(beforeIssues.map(anomalyKey));
    const introducedIssues = afterIssues.filter((issue) => !beforeKeys.has(anomalyKey(issue)));
    if (introducedIssues.length) {
      return { ok: false, reason: "introduced-anomaly", issues: introducedIssues };
    }

    const detectGaps = health?.detectSeriesGaps;
    const gapOptions = {
      excludeDates: options.excludeDates,
      lookbackDays: options.gapLookbackDays,
      maxDates: options.maximumGapDates,
      referenceDates: options.referenceDates,
    };
    const beforeGaps = typeof detectGaps === "function"
      ? detectGaps(currentRows, gapPolicies, gapOptions)
      : [];
    const afterGaps = typeof detectGaps === "function"
      ? detectGaps(candidateRows, gapPolicies, gapOptions)
      : [];
    const beforeGapKeys = new Set(beforeGaps.map(anomalyKey));
    const introducedGaps = afterGaps.filter((issue) => !beforeGapKeys.has(anomalyKey(issue)));
    if (introducedGaps.length) {
      return { ok: false, reason: "introduced-gap", issues: introducedGaps };
    }

    for (const key of keys) {
      const before = seriesStats(currentRows, key);
      const after = seriesStats(candidateRows, key);
      if (before.count > 0 && after.count === 0) {
        return { ok: false, reason: `series-lost:${key}`, issues: [] };
      }
      if (before.latest && after.latest < before.latest && !allowLatestRegression.has(key)) {
        return { ok: false, reason: `latest-regressed:${key}`, issues: [] };
      }
      if (before.count > after.count && !allowCountDecrease.has(key)) {
        return { ok: false, reason: `coverage-regressed:${key}`, issues: [] };
      }
    }

    return { ok: true, reason: "", issues: [] };
  }

  function assertSeriesRows(options = {}) {
    const result = validateSeriesRows(options);
    if (result.ok) return result;
    const issue = result.issues?.[0];
    const detail = issue
      ? `${issue.key} ${issue.latestDate || ""} ${issue.kind}`.trim()
      : result.reason;
    const error = new Error(`${options.label || "runtime data"} validation failed: ${detail}`);
    error.code = "RUNTIME_DATA_REJECTED";
    error.validation = result;
    throw error;
  }

  function createLastGoodLedger(options = {}) {
    const now = typeof options.now === "function" ? options.now : Date.now;
    const states = new Map();

    function keyOf(source) {
      return String(source || "").trim().slice(0, 40);
    }

    function success(source, detail = {}) {
      const key = keyOf(source);
      if (!key) return null;
      const previous = states.get(key) || {};
      const next = Object.freeze({
        source: key,
        state: "ready",
        lastSuccessAt: now(),
        lastFailureAt: Number(previous.lastFailureAt) || 0,
        failureCount: 0,
        latestDate: String(detail.latestDate || previous.latestDate || "").slice(0, 10),
        detail: String(detail.detail || "").slice(0, 200),
        lastError: "",
      });
      states.set(key, next);
      return next;
    }

    function failure(source, error) {
      const key = keyOf(source);
      if (!key) return null;
      const previous = states.get(key) || {};
      const next = Object.freeze({
        source: key,
        state: previous.lastSuccessAt ? "stale" : "error",
        lastSuccessAt: Number(previous.lastSuccessAt) || 0,
        lastFailureAt: now(),
        failureCount: (Number(previous.failureCount) || 0) + 1,
        latestDate: String(previous.latestDate || "").slice(0, 10),
        detail: String(previous.detail || "").slice(0, 200),
        lastError: String(error?.message || error || "request failed").slice(0, 300),
      });
      states.set(key, next);
      return next;
    }

    return Object.freeze({
      failure,
      snapshot: () => Object.freeze(Object.fromEntries(states)),
      success,
    });
  }

  globalScope.ThinkStockRuntimeDataTransaction = Object.freeze({
    assertSeriesRows,
    createLastGoodLedger,
    seriesStats,
    validateSeriesRows,
  });
}(typeof self !== "undefined" ? self : globalThis));
