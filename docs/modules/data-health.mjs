import { planSeriesRepairDates } from "../../shared/series-integrity.mjs";
import { maximumAsOfAgeDays } from "../../shared/series-timeline-policy.mjs";

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
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    customer_deposit: Object.freeze({
      minValue: 0,
      maxValue: 500,
      rejectZero: true,
      maxRelativeChange: 0.2,
      maxAbsoluteChange: 25,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    kospi_credit: Object.freeze({
      minValue: 0,
      maxValue: 100,
      rejectZero: true,
      maxRelativeChange: 0.15,
      maxAbsoluteChange: 3,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    kosdaq_credit: Object.freeze({
      minValue: 0,
      maxValue: 100,
      rejectZero: true,
      maxRelativeChange: 0.15,
      maxAbsoluteChange: 1,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    adr_kospi: Object.freeze({
      minValue: 0,
      maxValue: 300,
      rejectZero: true,
      maxRelativeChange: 0.5,
      maxAbsoluteChange: 40,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    adr_kosdaq: Object.freeze({
      minValue: 0,
      maxValue: 300,
      rejectZero: true,
      maxRelativeChange: 0.5,
      maxAbsoluteChange: 40,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    fear_greed: Object.freeze({
      minValue: 0,
      maxValue: 100,
      maxRelativeChange: 0.5,
      maxAbsoluteChange: 30,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    vkospi: Object.freeze({
      minValue: 1,
      maxValue: 200,
      rejectZero: true,
      maxRelativeChange: 1.5,
      maxAbsoluteChange: 50,
      maxGapDays: 14,
      maxMissingWeekdays: 5,
      scanPoints: 120,
    }),
    vix: Object.freeze({
      minValue: 1,
      maxValue: 200,
      rejectZero: true,
      maxRelativeChange: 1.5,
      maxAbsoluteChange: 50,
      maxGapDays: 14,
      maxMissingWeekdays: 5,
      scanPoints: 120,
    }),
    score: Object.freeze({
      minValue: 0,
      maxValue: 100,
      maxGapDays: 45,
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

  function seriesFreshnessForRows(rows, keys = [], todayText, configuredStaleDays) {
    return Object.freeze(Object.fromEntries((Array.isArray(keys) ? keys : []).map((key) => {
      const span = dateSpanForRows(rows, [key]);
      const ageDays = daysSinceDate(span.latest, todayText);
      const policyStaleDays = maximumAsOfAgeDays([key]);
      const staleDays = Math.max(0, Number.isFinite(Number(configuredStaleDays))
        ? Number(configuredStaleDays)
        : (Number(policyStaleDays) || 0));
      return [key, Object.freeze({
        ...span,
        ageDays,
        staleDays,
        isEmpty: !span.latest,
        isStale: Number.isFinite(ageDays) && ageDays > staleDays,
      })];
    })));
  }

  function daysSinceDate(dateText, todayText = new Date().toISOString().slice(0, 10)) {
    const time = toUtcMs(dateText);
    const today = toUtcMs(todayText);
    if (!Number.isFinite(time) || !Number.isFinite(today)) return null;
    return Math.floor((today - time) / DAY_MS);
  }

  function weekdaysBetween(leftDate, rightDate) {
    const left = toUtcMs(leftDate);
    const right = toUtcMs(rightDate);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return 0;
    let count = 0;
    for (let time = left + DAY_MS; time < right; time += DAY_MS) {
      const day = new Date(time).getUTCDay();
      if (day !== 0 && day !== 6) count += 1;
    }
    return count;
  }

  function normalizedReferenceDates(options = {}) {
    return [...new Set((Array.isArray(options.referenceDates) ? options.referenceDates : [])
      .map((date) => String(date || "").slice(0, 10))
      .filter((date) => Number.isFinite(toUtcMs(date))))]
      .sort((left, right) => left.localeCompare(right));
  }

  function detectSeriesGaps(rows, policies = {}, options = {}) {
    const gaps = [];
    const referenceDates = normalizedReferenceDates(options);
    Object.entries(policies || {}).forEach(([key, rawPolicy]) => {
      const policy = rawPolicy || {};
      const dates = [...new Set((Array.isArray(rows) ? rows : [])
        .filter((row) => toNum(row?.[key]) !== null)
        .map((row) => String(row?.date || "").slice(0, 10))
        .filter((date) => Number.isFinite(toUtcMs(date))))]
        .sort((left, right) => left.localeCompare(right));
      if (referenceDates.length && dates.length) {
        const exactMissingDates = planSeriesRepairDates(
          rows,
          key,
          referenceDates.at(-1),
          {
            latestKnownDate: referenceDates.at(-1),
            referenceDates,
            excludeDates: options.excludeDates,
            lookbackDays: Math.max(1, Number(options.lookbackDays) || 45),
            maxDates: Math.max(1, Number(options.maxDates) || 3),
          },
        );
        exactMissingDates.forEach((date) => {
          gaps.push({
            key,
            kind: "missing-date",
            latestDate: date,
            missingWeekdays: 1,
          });
        });
        if (gaps.length >= 3) return;
      }
      const scanPoints = Math.max(2, Number(policy.scanPoints) || 120);
      const recentDates = dates.slice(-scanPoints);
      const maxMissingWeekdays = Math.max(0, Number(policy.maxMissingWeekdays) || 10);
      for (let index = 1; index < recentDates.length; index += 1) {
        const missingWeekdays = weekdaysBetween(recentDates[index - 1], recentDates[index]);
        if (missingWeekdays <= maxMissingWeekdays) continue;
        gaps.push({
          key,
          kind: "gap",
          previousDate: recentDates[index - 1],
          latestDate: recentDates[index],
          missingWeekdays,
        });
        if (gaps.length >= 3) return;
      }
    });
    return gaps;
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
      const hasRelativeChangeLimit = Number.isFinite(Number(policy.maxRelativeChange))
        && Number(policy.maxRelativeChange) > 0;
      const hasAbsoluteChangeLimit = Number.isFinite(Number(policy.maxAbsoluteChange))
        && Number(policy.maxAbsoluteChange) > 0;
      const maxRelativeChange = hasRelativeChangeLimit ? Number(policy.maxRelativeChange) : 0;
      const maxAbsoluteChange = hasAbsoluteChangeLimit ? Number(policy.maxAbsoluteChange) : 0;
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
      // A range-only policy (for example recession score) intentionally has no
      // abrupt-change threshold. Treating missing thresholds as zero would flag
      // every legitimate change as an anomaly.
      if (points.length < 2 || (!hasRelativeChangeLimit && !hasAbsoluteChangeLimit)) return;
      const firstPairIndex = Math.max(1, points.length - scanPoints + 1);
      for (let index = firstPairIndex; index < points.length; index += 1) {
        const [previousDate, previousValue] = points[index - 1];
        const [latestDate, latestValue] = points[index];
        const gapDays = Math.max(1, Math.round((toUtcMs(latestDate) - toUtcMs(previousDate)) / DAY_MS));
        if (gapDays > maxGapDays || previousValue === 0
          || isInvalidValue(previousValue) || isInvalidValue(latestValue)) continue;
        const relativeChange = Math.abs(latestValue / previousValue - 1);
        const absoluteChange = Math.abs(latestValue - previousValue);
        const relativeExceeded = hasRelativeChangeLimit && relativeChange > maxRelativeChange;
        const absoluteExceeded = hasAbsoluteChangeLimit && absoluteChange > maxAbsoluteChange;
        const changeExceeded = hasRelativeChangeLimit && hasAbsoluteChangeLimit
          ? relativeExceeded && absoluteExceeded
          : relativeExceeded || absoluteExceeded;
        if (changeExceeded) {
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
      const configuredStaleDays = Number(config.staleDays);
      const policyStaleDays = maximumAsOfAgeDays(config.keys);
      const staleDays = Math.max(0, Number.isFinite(configuredStaleDays)
        ? configuredStaleDays
        : (Number(policyStaleDays) || 0));
      const series = seriesFreshnessForRows(
        config.rows,
        config.keys,
        todayText,
        Number.isFinite(configuredStaleDays) ? configuredStaleDays : undefined,
      );
      const seriesStates = Object.values(series);
      const missingSeries = seriesStates.filter((item) => item.isEmpty).length;
      const staleSeries = seriesStates.filter((item) => item.isStale).length;
      const anomalies = detectRecentChanges(config.rows, config.changePolicies);
      const referenceDates = (Array.isArray(config.referenceRows) ? config.referenceRows : [])
        .filter((row) => {
          const keys = Array.isArray(config.referenceKeys) ? config.referenceKeys : [];
          return !keys.length || keys.some((key) => toNum(row?.[key]) !== null);
        })
        .map((row) => String(row?.date || "").slice(0, 10));
      const gaps = detectSeriesGaps(config.rows, config.gapPolicies, {
        excludeDates: config.excludeDates,
        lookbackDays: config.gapLookbackDays,
        maxDates: config.maximumGapDates,
        referenceDates,
      });
      return {
        label: String(config.label || ""),
        ...span,
        date: span.latest,
        ageDays,
        staleDays,
        isEmpty: !span.latest,
        isStale: staleSeries > 0 || missingSeries > 0,
        missingSeries,
        staleSeries,
        series,
        anomalies,
        gaps,
      };
    });
  }

export {
    DEFAULT_SERIES_POLICIES,
    dateSpanForRows,
    daysSinceDate,
    detectRecentChanges,
    detectSeriesGaps,
    seriesFreshnessForRows,
    weekdaysBetween,
    buildFreshnessItems,
};
