(function initThinkStockDataHealth(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const toNum = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const toUtcMs = (date) => Date.parse(`${String(date || "").slice(0, 10)}T00:00:00Z`);

  const DEFAULT_SERIES_POLICIES = Object.freeze({
    leading_cycle: Object.freeze({
      minValue: 80,
      maxValue: 120,
      rejectZero: true,
      maxRelativeChange: 0.01,
      maxAbsoluteChange: 0.8,
      maxGapDays: 62,
      scanPoints: 120,
    }),
    news_sentiment: Object.freeze({
      minValue: 0,
      maxValue: 200,
      rejectZero: true,
      maxRelativeChange: 0.35,
      maxAbsoluteChange: 20,
      maxGapDays: 14,
      scanPoints: 120,
    }),
    customer_deposit: Object.freeze({
      minValue: 0,
      maxValue: 500,
      rejectZero: true,
      maxRelativeChange: 0.2,
      maxAbsoluteChange: 25,
      maxGapDays: 14,
      scanPoints: 120,
    }),
    kospi_credit: Object.freeze({
      minValue: 0,
      maxValue: 100,
      rejectZero: true,
      maxRelativeChange: 0.15,
      maxAbsoluteChange: 3,
      maxGapDays: 14,
      scanPoints: 120,
    }),
    kosdaq_credit: Object.freeze({
      minValue: 0,
      maxValue: 100,
      rejectZero: true,
      maxRelativeChange: 0.15,
      maxAbsoluteChange: 1,
      maxGapDays: 14,
      scanPoints: 120,
    }),
    adr_kospi: Object.freeze({
      minValue: 0,
      maxValue: 300,
      rejectZero: true,
      maxRelativeChange: 0.5,
      maxAbsoluteChange: 40,
      maxGapDays: 14,
      scanPoints: 120,
    }),
    adr_kosdaq: Object.freeze({
      minValue: 0,
      maxValue: 300,
      rejectZero: true,
      maxRelativeChange: 0.5,
      maxAbsoluteChange: 40,
      maxGapDays: 14,
      scanPoints: 120,
    }),
    fear_greed: Object.freeze({
      minValue: 0,
      maxValue: 100,
      maxRelativeChange: 0.5,
      maxAbsoluteChange: 30,
      maxGapDays: 14,
      scanPoints: 120,
    }),
  });

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
      if (!points.length) return;
      const maxGapDays = Math.max(1, Number(policy.maxGapDays) || 14);
      const maxRelativeChange = Math.max(0, Number(policy.maxRelativeChange) || 0);
      const maxAbsoluteChange = Math.max(0, Number(policy.maxAbsoluteChange) || 0);
      const scanPoints = Math.max(2, Number(policy.scanPoints) || 2);
      const recentPoints = points.slice(-scanPoints);
      const isInvalidValue = (value) => (
        (Number.isFinite(policy.minValue) && value < Number(policy.minValue))
        || (Number.isFinite(policy.maxValue) && value > Number(policy.maxValue))
        || (policy.rejectZero === true && value === 0)
      );
      for (const [date, value] of recentPoints) {
        const belowMinimum = Number.isFinite(policy.minValue) && value < Number(policy.minValue);
        const aboveMaximum = Number.isFinite(policy.maxValue) && value > Number(policy.maxValue);
        const rejectedZero = policy.rejectZero === true && value === 0;
        if (belowMinimum || aboveMaximum || rejectedZero) {
          anomalies.push({
            key,
            latestDate: date,
            latestValue: value,
            kind: rejectedZero ? "zero" : "range",
          });
          if (anomalies.length >= 3) return;
        }
      }
      if (points.length < 2) return;
      const firstPairIndex = Math.max(1, points.length - scanPoints + 1);
      for (let index = firstPairIndex; index < points.length; index += 1) {
        const [previousDate, previousValue] = points[index - 1];
        const [latestDate, latestValue] = points[index];
        const gapDays = Math.max(1, Math.round((toUtcMs(latestDate) - toUtcMs(previousDate)) / DAY_MS));
        if (gapDays > maxGapDays || previousValue === 0
          || isInvalidValue(previousValue) || isInvalidValue(latestValue)) continue;
        const relativeChange = Math.abs(latestValue / previousValue - 1);
        const absoluteChange = Math.abs(latestValue - previousValue);
        if (relativeChange > maxRelativeChange && absoluteChange > maxAbsoluteChange) {
          anomalies.push({
            key,
            previousDate,
            latestDate,
            previousValue,
            latestValue,
            relativeChange,
            kind: "change",
          });
          if (anomalies.length >= 3) return;
        }
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
    DEFAULT_SERIES_POLICIES,
    dateSpanForRows,
    daysSinceDate,
    detectRecentChanges,
    buildFreshnessItems,
  });
}(typeof self !== "undefined" ? self : globalThis));
