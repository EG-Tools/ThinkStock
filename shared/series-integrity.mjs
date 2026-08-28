import { isKoreanTradingDate } from "./market-calendar.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeIsoDate(value) {
  const date = String(value || "").slice(0, 10);
  if (!DATE_PATTERN.test(date)) return "";
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
    ? date
    : "";
}

function shiftIsoDate(date, days) {
  const timestamp = Date.parse(`${normalizeIsoDate(date)}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + (Number(days) || 0) * DAY_MS).toISOString().slice(0, 10);
}

function normalizedKeys(options, rows) {
  const configured = Array.isArray(options?.keys) ? options.keys.map(String).filter(Boolean) : [];
  if (configured.length) return [...new Set(configured)];
  return [...new Set((Array.isArray(rows) ? rows : []).flatMap((row) => (
    row && typeof row === "object" ? Object.keys(row).filter((key) => key !== "date") : []
  )))];
}

function acceptableValue(value, policy = {}) {
  const number = finiteNumber(value);
  if (number === null) return null;
  if (policy.rejectZero === true && number === 0) return null;
  if (Number.isFinite(policy.minValue) && number < Number(policy.minValue)) return null;
  if (Number.isFinite(policy.maxValue) && number > Number(policy.maxValue)) return null;
  return number;
}

export function mergeDatedSeriesRows(existingRows, incomingRows, options = {}) {
  const allRows = [
    ...(Array.isArray(existingRows) ? existingRows : []),
    ...(Array.isArray(incomingRows) ? incomingRows : []),
  ];
  const keys = normalizedKeys(options, allRows);
  const policies = options.policies || {};
  const byDate = new Map();
  const mergeGroup = (rows, incoming) => {
    for (const raw of rows) {
      const date = normalizeIsoDate(raw?.date);
      if (!date) continue;
      const previous = byDate.get(date) || { date };
      // Cached rows can contain neighboring series that are not part of this
      // refresh. Preserve those fields while validating only the requested keys.
      const next = incoming ? { ...previous } : { ...raw, ...previous, date };
      for (const key of keys) {
        const value = acceptableValue(raw?.[key], policies[key]);
        if (value === null) {
          if (!incoming && finiteNumber(previous[key]) === null) delete next[key];
          continue;
        }
        if (incoming || finiteNumber(next[key]) === null) next[key] = value;
      }
      const hasRequestedValue = keys.some((key) => finiteNumber(next[key]) !== null);
      const hasNeighborValue = !incoming && Object.entries(next).some(([key, value]) => (
        key !== "date" && finiteNumber(value) !== null
      ));
      if (hasRequestedValue || hasNeighborValue) byDate.set(date, next);
    }
  };
  mergeGroup(Array.isArray(existingRows) ? existingRows : [], false);
  mergeGroup(Array.isArray(incomingRows) ? incomingRows : [], options.preferIncoming !== false);
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function weekdayDates(fromDate, toDate, options = {}) {
  const from = normalizeIsoDate(fromDate);
  const to = normalizeIsoDate(toDate);
  if (!from || !to || from > to) return [];
  const excluded = new Set([
    ...(Array.isArray(options.excludeDates) ? options.excludeDates : []),
    ...(Array.isArray(options.closedDates) ? options.closedDates : []),
  ]
    .map(normalizeIsoDate)
    .filter(Boolean));
  const allReferences = [...new Set((options.referenceDates || [])
    .map(normalizeIsoDate)
    .filter(Boolean))].sort();
  if (allReferences.length && from >= allReferences[0] && to <= allReferences.at(-1)) {
    return allReferences.filter((date) => date >= from && date <= to && !excluded.has(date));
  }
  const dates = [];
  for (
    let timestamp = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
    timestamp <= end;
    timestamp += DAY_MS
  ) {
    const date = new Date(timestamp);
    const text = date.toISOString().slice(0, 10);
    if (isKoreanTradingDate(text, {
      closedDates: [...excluded],
      openDates: options.openDates,
    })) dates.push(text);
  }
  return dates;
}

export function planSeriesRepairDates(rows, key, targetDate, options = {}) {
  const target = normalizeIsoDate(targetDate);
  if (!target || !key) return [];
  const lookbackDays = Math.max(1, Math.min(366, Math.round(Number(options.lookbackDays) || 14)));
  const maxDates = Math.max(1, Math.min(120, Math.round(Number(options.maxDates) || 10)));
  const latestKnownDate = normalizeIsoDate(options.latestKnownDate);
  const excluded = new Set((options.excludeDates || []).map(normalizeIsoDate).filter(Boolean));
  const firstCandidate = shiftIsoDate(target, -lookbackDays);
  const referenceDates = (Array.isArray(options.referenceDates) ? options.referenceDates : [])
    .map(normalizeIsoDate)
    .filter((date) => date && date >= firstCandidate && date <= target && !excluded.has(date));
  const expected = referenceDates.length
    ? [...new Set(referenceDates)].sort()
    : weekdayDates(firstCandidate, target, { excludeDates: [...excluded] });
  const present = new Set((Array.isArray(rows) ? rows : []).flatMap((row) => {
    const date = normalizeIsoDate(row?.date);
    return date && finiteNumber(row?.[key]) !== null ? [date] : [];
  }));
  return expected.filter((date) => (
    (!latestKnownDate && present.size === 0)
    ||
    (latestKnownDate && date > latestKnownDate)
    || (present.size > 0 && !present.has(date))
  )).slice(-maxDates);
}

function businessDaysBetween(leftDate, rightDate, options = {}) {
  const left = normalizeIsoDate(leftDate);
  const right = normalizeIsoDate(rightDate);
  if (!left || !right || left >= right) return 0;
  return Math.max(0, weekdayDates(
    shiftIsoDate(left, 1),
    shiftIsoDate(right, -1),
    options,
  ).length);
}

export function compareProviderSeries(primaryRows, secondaryRows, options = {}) {
  const primaryKey = String(options.primaryKey || options.key || "value");
  const secondaryKey = String(options.secondaryKey || options.key || primaryKey);
  const relativeTolerance = Math.max(0, Number(options.relativeTolerance) || 0);
  const absoluteTolerance = Math.max(0, Number(options.absoluteTolerance) || 0);
  const minimumOverlap = Math.max(1, Math.round(Number(options.minimumOverlap) || 1));
  const maximumMismatches = Math.max(0, Math.round(Number(options.maximumMismatches) || 0));
  const toMap = (rows, key) => new Map((Array.isArray(rows) ? rows : []).flatMap((row) => {
    const date = normalizeIsoDate(row?.date);
    const value = finiteNumber(row?.[key]);
    return date && value !== null ? [[date, value]] : [];
  }));
  const primary = toMap(primaryRows, primaryKey);
  const secondary = toMap(secondaryRows, secondaryKey);
  const overlaps = [];
  const mismatches = [];
  for (const [date, primaryValue] of primary) {
    if (!secondary.has(date)) continue;
    const secondaryValue = secondary.get(date);
    const absoluteDifference = Math.abs(primaryValue - secondaryValue);
    const scale = Math.max(Math.abs(primaryValue), Math.abs(secondaryValue), Number.EPSILON);
    const relativeDifference = absoluteDifference / scale;
    const comparison = Object.freeze({
      date,
      primary: primaryValue,
      secondary: secondaryValue,
      absoluteDifference,
      relativeDifference,
    });
    overlaps.push(comparison);
    if (absoluteDifference > absoluteTolerance && relativeDifference > relativeTolerance) {
      mismatches.push(comparison);
    }
  }
  overlaps.sort((left, right) => left.date.localeCompare(right.date));
  mismatches.sort((left, right) => left.date.localeCompare(right.date));
  let status = "matched";
  if (!primary.size) status = "primary-unavailable";
  else if (!secondary.size) status = "secondary-unavailable";
  else if (!overlaps.length) status = "no-overlap";
  else if (overlaps.length < minimumOverlap) status = "insufficient-overlap";
  else if (mismatches.length > maximumMismatches) status = "mismatch";
  const matchingDates = overlaps
    .filter((entry) => !mismatches.includes(entry))
    .map((entry) => entry.date);
  return Object.freeze({
    ok: status === "matched",
    status,
    overlapCount: overlaps.length,
    mismatchCount: mismatches.length,
    latestAgreementDate: matchingDates.at(-1) || "",
    maxRelativeDifference: overlaps.length
      ? Math.max(...overlaps.map((entry) => entry.relativeDifference))
      : null,
    mismatches: Object.freeze(mismatches),
  });
}

export function inspectDatedSeries(rows, policies = {}, options = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const maximumIssues = Math.max(1, Number(options.maximumIssues) || 20);
  const issues = [];
  const duplicateDates = [];
  const seenDates = new Set();
  let invalidDates = 0;
  for (const row of source) {
    const date = normalizeIsoDate(row?.date);
    if (!date) {
      invalidDates += 1;
      continue;
    }
    if (seenDates.has(date)) duplicateDates.push(date);
    seenDates.add(date);
  }

  const stats = {};
  const pushIssue = (issue) => {
    if (issues.length < maximumIssues) issues.push(Object.freeze(issue));
  };
  for (const [key, policy = {}] of Object.entries(policies || {})) {
    const points = source.flatMap((row) => {
      const date = normalizeIsoDate(row?.date);
      const value = finiteNumber(row?.[key]);
      return date && value !== null ? [{ date, value }] : [];
    }).sort((left, right) => left.date.localeCompare(right.date));
    stats[key] = Object.freeze({
      count: points.length,
      first: points[0]?.date || "",
      latest: points.at(-1)?.date || "",
    });
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const previous = index > 0 ? points[index - 1] : null;
      if (previous) {
        const missingBusinessDays = businessDaysBetween(previous.date, point.date, {
          closedDates: options.closedDates || options.excludeDates,
          openDates: options.openDates,
          referenceDates: options.referenceDates,
        });
        const maximumMissingBusinessDays = Number(policy.maxMissingBusinessDays);
        if (Number.isFinite(maximumMissingBusinessDays)
          && missingBusinessDays > maximumMissingBusinessDays) {
          pushIssue({
            key,
            kind: "gap",
            previousDate: previous.date,
            latestDate: point.date,
            missingBusinessDays,
          });
        }
      }
      if (policy.rejectZero === true && point.value === 0) {
        pushIssue({ key, kind: "zero", date: point.date, value: point.value });
        continue;
      }
      if ((Number.isFinite(policy.minValue) && point.value < Number(policy.minValue))
        || (Number.isFinite(policy.maxValue) && point.value > Number(policy.maxValue))) {
        pushIssue({ key, kind: "range", date: point.date, value: point.value });
        continue;
      }
      if (!previous || previous.value === 0) continue;
      const relativeChange = Math.abs(point.value / previous.value - 1);
      const absoluteChange = Math.abs(point.value - previous.value);
      const relativeExceeded = Number.isFinite(policy.maxRelativeChange)
        && relativeChange > Number(policy.maxRelativeChange);
      const absoluteExceeded = Number.isFinite(policy.maxAbsoluteChange)
        && absoluteChange > Number(policy.maxAbsoluteChange);
      if (relativeExceeded && absoluteExceeded) {
        pushIssue({
          key,
          kind: "change",
          previousDate: previous.date,
          latestDate: point.date,
          previousValue: previous.value,
          latestValue: point.value,
          relativeChange,
        });
      }
    }
  }
  return Object.freeze({
    ok: invalidDates === 0 && duplicateDates.length === 0 && issues.length === 0,
    invalidDates,
    duplicateDates: Object.freeze([...new Set(duplicateDates)]),
    issues: Object.freeze(issues),
    stats: Object.freeze(stats),
  });
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function fingerprintDatedSeries(rows, keys, options = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const targetKeys = [...new Set((Array.isArray(keys) ? keys : []).map(String).filter(Boolean))];
  const tail = Math.max(1, Math.min(source.length || 1, Number(options.tail) || 64));
  const samples = source.slice(-tail).map((row) => [
    normalizeIsoDate(row?.date),
    ...targetKeys.map((key) => finiteNumber(row?.[key])),
  ]);
  return [
    String(options.logicVersion || "1"),
    source.length,
    targetKeys.join(","),
    fnv1a(JSON.stringify(samples)),
  ].join(":");
}

const api = Object.freeze({
  compareProviderSeries,
  fingerprintDatedSeries,
  inspectDatedSeries,
  mergeDatedSeriesRows,
  normalizeIsoDate,
  planSeriesRepairDates,
  weekdayDates,
});
