(function initThinkStockRuntimeDataTransaction(globalScope) {
  "use strict";

  const health = globalScope.ThinkStockDataHealth;
  const finite = globalScope.ThinkStockRuntimeFoundation?.values?.finiteOrNull;
  if (typeof finite !== "function") throw new Error("runtime value contract is required");

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

  function summarizeSeriesQuality(rows, keys = [], detail = {}) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const sourceKeys = [...new Set((keys || []).map(String).filter(Boolean))];
    const series = Object.freeze(Object.fromEntries(sourceKeys.map((key) => [
      key,
      Object.freeze(seriesStats(sourceRows, key)),
    ])));
    const covered = Object.values(series).filter((value) => value.count > 0);
    const firstDate = covered.reduce((first, value) => (
      !first || value.first < first ? value.first : first
    ), "");
    const latestDate = covered.reduce((latest, value) => (
      value.latest > latest ? value.latest : latest
    ), "");
    return Object.freeze({
      firstDate,
      latestDate,
      isEmpty: covered.length === 0,
      isStale: detail.isStale === true,
      anomalyCount: Math.max(0, Number(detail.anomalyCount) || 0),
      gapCount: Math.max(0, Number(detail.gapCount) || 0),
      revision: String(detail.revision || "").slice(0, 120),
      series,
    });
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
    const quality = (detail = {}) => summarizeSeriesQuality(candidateRows, keys, detail);

    if (!candidateRows.length && currentRows.length) {
      return { ok: false, reason: "candidate-empty", issues: [], quality: quality() };
    }

    const directIssues = incomingValueIssues(incomingRows, policies);
    if (directIssues.length) {
      return {
        ok: false,
        reason: "incoming-range",
        issues: directIssues,
        quality: quality({ anomalyCount: directIssues.length }),
      };
    }

    const detect = health?.detectRecentChanges;
    const beforeIssues = typeof detect === "function" ? detect(currentRows, policies) : [];
    const afterIssues = typeof detect === "function" ? detect(candidateRows, policies) : [];
    const beforeKeys = new Set(beforeIssues.map(anomalyKey));
    const introducedIssues = afterIssues.filter((issue) => !beforeKeys.has(anomalyKey(issue)));
    if (introducedIssues.length) {
      return {
        ok: false,
        reason: "introduced-anomaly",
        issues: introducedIssues,
        quality: quality({ anomalyCount: afterIssues.length }),
      };
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
      return {
        ok: false,
        reason: "introduced-gap",
        issues: introducedGaps,
        quality: quality({ anomalyCount: afterIssues.length, gapCount: afterGaps.length }),
      };
    }

    for (const key of keys) {
      const before = seriesStats(currentRows, key);
      const after = seriesStats(candidateRows, key);
      if (before.count > 0 && after.count === 0) {
        return { ok: false, reason: `series-lost:${key}`, issues: [], quality: quality() };
      }
      if (before.latest && after.latest < before.latest && !allowLatestRegression.has(key)) {
        return { ok: false, reason: `latest-regressed:${key}`, issues: [], quality: quality() };
      }
      if (before.count > after.count && !allowCountDecrease.has(key)) {
        return { ok: false, reason: `coverage-regressed:${key}`, issues: [], quality: quality() };
      }
    }

    return {
      ok: true,
      reason: "",
      issues: [],
      quality: quality({ anomalyCount: afterIssues.length, gapCount: afterGaps.length }),
    };
  }

  function issueDate(issue) {
    return String(issue?.date || issue?.latestDate || "").slice(0, 10);
  }

  function repairSeriesRows(options = {}, failedValidation = null) {
    const validation = failedValidation || validateSeriesRows(options);
    const candidateRows = Array.isArray(options.candidateRows) ? options.candidateRows : [];
    if (validation.ok) {
      return {
        ...validation,
        rows: candidateRows,
        repaired: false,
        repair: Object.freeze({ attempted: false, quarantined: [], unresolvedDates: [] }),
      };
    }

    const currentRows = Array.isArray(options.currentRows) ? options.currentRows : [];
    const incomingRows = Array.isArray(options.incomingRows) ? options.incomingRows : [];
    const keys = [...new Set((options.keys || []).map(String).filter(Boolean))];
    const currentByDate = new Map(currentRows.map((row) => [String(row?.date || "").slice(0, 10), row]));
    const candidateByDate = new Map(candidateRows.map((row) => [
      String(row?.date || "").slice(0, 10),
      { ...row, date: String(row?.date || "").slice(0, 10) },
    ]));
    const quarantined = [];
    const unresolvedDates = new Set();
    const blocked = new Set();

    const restoreField = (date, key, kind) => {
      if (!date || !key) return;
      const candidate = candidateByDate.get(date) || { date };
      const previous = currentByDate.get(date);
      const previousValue = finite(previous?.[key]);
      if (previousValue === null) delete candidate[key];
      else candidate[key] = previousValue;
      const hasValue = Object.entries(candidate).some(([name, value]) => (
        name !== "date" && finite(value) !== null
      ));
      if (hasValue) candidateByDate.set(date, candidate);
      else candidateByDate.delete(date);
      blocked.add(`${date}|${key}`);
      quarantined.push(Object.freeze({ date, key, kind: String(kind || validation.reason) }));
    };

    for (const issue of validation.issues || []) {
      const date = issueDate(issue);
      const key = String(issue?.key || "");
      if (issue?.kind === "missing-date") {
        const previous = currentByDate.get(date);
        if (previous) candidateByDate.set(date, { ...previous });
        else unresolvedDates.add(date);
        continue;
      }
      restoreField(date, key, issue?.kind);
    }

    const regressedKey = String(validation.reason || "").split(":")[1] || "";
    if (/^(?:series-lost|latest-regressed|coverage-regressed):/.test(validation.reason) && regressedKey) {
      currentRows.forEach((row) => {
        const date = String(row?.date || "").slice(0, 10);
        const value = finite(row?.[regressedKey]);
        if (!date || value === null) return;
        const candidate = candidateByDate.get(date) || { date };
        if (finite(candidate[regressedKey]) === null) candidate[regressedKey] = value;
        candidateByDate.set(date, candidate);
      });
    }

    const repairedRows = [...candidateByDate.values()]
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")))
      .sort((left, right) => left.date.localeCompare(right.date));
    const repairedIncoming = incomingRows.map((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const next = { ...row, date };
      keys.forEach((key) => {
        if (blocked.has(`${date}|${key}`)) delete next[key];
      });
      return next;
    });
    const repairedValidation = validateSeriesRows({
      ...options,
      candidateRows: repairedRows,
      incomingRows: repairedIncoming,
    });
    return {
      ...repairedValidation,
      rows: repairedRows,
      repaired: repairedValidation.ok && quarantined.length > 0,
      repair: Object.freeze({
        attempted: true,
        quarantined: Object.freeze(quarantined),
        unresolvedDates: Object.freeze([...unresolvedDates].sort()),
      }),
      originalValidation: validation,
    };
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
    const retryBaseMs = Math.max(1000, Number(options.retryBaseMs) || 30_000);
    const retryMaxMs = Math.max(retryBaseMs, Number(options.retryMaxMs) || 5 * 60_000);
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
        firstDate: String(detail.firstDate || previous.firstDate || "").slice(0, 10),
        anomalyCount: Math.max(0, Number(detail.anomalyCount) || 0),
        gapCount: Math.max(0, Number(detail.gapCount) || 0),
        revision: String(detail.revision || previous.revision || "").slice(0, 120),
        nextAttemptAt: 0,
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
      const failureCount = (Number(previous.failureCount) || 0) + 1;
      const retryDelay = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.min(4, failureCount - 1)));
      const next = Object.freeze({
        source: key,
        state: previous.lastSuccessAt ? "stale" : "error",
        lastSuccessAt: Number(previous.lastSuccessAt) || 0,
        lastFailureAt: now(),
        failureCount,
        latestDate: String(previous.latestDate || "").slice(0, 10),
        firstDate: String(previous.firstDate || "").slice(0, 10),
        anomalyCount: Math.max(0, Number(previous.anomalyCount) || 0),
        gapCount: Math.max(0, Number(previous.gapCount) || 0),
        revision: String(previous.revision || "").slice(0, 120),
        nextAttemptAt: now() + retryDelay,
        detail: String(previous.detail || "").slice(0, 200),
        lastError: String(error?.message || error || "request failed").slice(0, 300),
      });
      states.set(key, next);
      return next;
    }

    function observe(source, detail = {}) {
      const key = keyOf(source);
      if (!key) return null;
      const previous = states.get(key) || {};
      const next = Object.freeze({
        ...previous,
        source: key,
        state: detail.isStale === true ? "stale" : (previous.state || "ready"),
        firstDate: String(detail.firstDate || previous.firstDate || "").slice(0, 10),
        latestDate: String(detail.latestDate || previous.latestDate || "").slice(0, 10),
        anomalyCount: Math.max(0, Number(detail.anomalyCount) || 0),
        gapCount: Math.max(0, Number(detail.gapCount) || 0),
        revision: String(detail.revision || previous.revision || "").slice(0, 120),
      });
      states.set(key, next);
      return next;
    }

    function canAttempt(source, attemptOptions = {}) {
      const key = keyOf(source);
      const state = states.get(key) || null;
      const waitMs = Math.max(0, Number(state?.nextAttemptAt) - now());
      const allowed = attemptOptions.force === true || waitMs <= 0;
      return Object.freeze({ allowed, source: key, waitMs: allowed ? 0 : waitMs, state });
    }

    return Object.freeze({
      canAttempt,
      failure,
      observe,
      snapshot: () => Object.freeze(Object.fromEntries(states)),
      success,
    });
  }

  globalScope.ThinkStockRuntimeDataTransaction = Object.freeze({
    assertSeriesRows,
    createLastGoodLedger,
    repairSeriesRows,
    seriesStats,
    summarizeSeriesQuality,
    validateSeriesRows,
  });
}(typeof self !== "undefined" ? self : globalThis));
