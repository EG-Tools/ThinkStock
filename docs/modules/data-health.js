(function initThinkStockDataHealth(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const toNum = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const toUtcMs = (date) => Date.parse(`${String(date || "").slice(0, 10)}T00:00:00Z`);

  function dateSpanForRows(rows, keys = []) {
    if (!Array.isArray(rows)) return { first: "", latest: "" };
    const targetKeys = Array.isArray(keys) ? keys : [];
    let first = "";
    let latest = "";
    rows.forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      if (!date) return;
      const hasValue = targetKeys.length
        ? targetKeys.some((key) => toNum(row?.[key]) !== null)
        : Object.entries(row || {}).some(
          ([key, value]) => key !== "date" && toNum(value) !== null,
        );
      if (!hasValue) return;
      if (!first || date < first) first = date;
      if (!latest || date > latest) latest = date;
    });
    return { first, latest };
  }

  function daysSinceDate(dateText, todayText = new Date().toISOString().slice(0, 10)) {
    const time = toUtcMs(dateText);
    const today = toUtcMs(todayText);
    if (!Number.isFinite(time) || !Number.isFinite(today)) return null;
    return Math.floor((today - time) / DAY_MS);
  }

  function detectRecentChanges(rows, policies = {}) {
    const anomalies = [];
    Object.entries(policies || {}).forEach(([key, rawPolicy]) => {
      const policy = rawPolicy || {};
      const byDate = new Map();
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const date = String(row?.date || "").slice(0, 10);
        const value = toNum(row?.[key]);
        if (date && value !== null) byDate.set(date, value);
      });
      const points = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right));
      if (points.length < 2) return;
      const [previousDate, previousValue] = points[points.length - 2];
      const [latestDate, latestValue] = points[points.length - 1];
      const gapDays = Math.max(1, Math.round((toUtcMs(latestDate) - toUtcMs(previousDate)) / DAY_MS));
      const maxGapDays = Math.max(1, Number(policy.maxGapDays) || 14);
      if (gapDays > maxGapDays || previousValue === 0) return;
      const relativeChange = Math.abs(latestValue / previousValue - 1);
      const absoluteChange = Math.abs(latestValue - previousValue);
      const maxRelativeChange = Math.max(0, Number(policy.maxRelativeChange) || 0);
      const maxAbsoluteChange = Math.max(0, Number(policy.maxAbsoluteChange) || 0);
      if (relativeChange > maxRelativeChange && absoluteChange > maxAbsoluteChange) {
        anomalies.push({
          key,
          previousDate,
          latestDate,
          previousValue,
          latestValue,
          relativeChange,
        });
      }
    });
    return anomalies;
  }

  function buildFreshnessItems(configs, todayText) {
    return (Array.isArray(configs) ? configs : []).map((config) => {
      const span = dateSpanForRows(config.rows, config.keys);
      const ageDays = daysSinceDate(span.latest, todayText);
      const staleDays = Math.max(0, Number(config.staleDays) || 0);
      const anomalies = detectRecentChanges(config.rows, config.changePolicies);
      return {
        label: String(config.label || ""),
        ...span,
        date: span.latest,
        ageDays,
        staleDays,
        isEmpty: !span.latest,
        isStale: Number.isFinite(ageDays) && ageDays > staleDays,
        anomalies,
      };
    });
  }

  globalScope.ThinkStockDataHealth = Object.freeze({
    dateSpanForRows,
    daysSinceDate,
    detectRecentChanges,
    buildFreshnessItems,
  });
}(typeof self !== "undefined" ? self : globalThis));
