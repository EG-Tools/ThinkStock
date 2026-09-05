const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_POLICY = Object.freeze({
  availabilityLagDays: 0,
  latestToleranceDays: 3,
  mutableTailDays: 10,
  maximumAsOfAgeDays: 7,
});

export const SERIES_TIMELINE_POLICIES = Object.freeze({
  price: Object.freeze({
    availabilityLagDays: 0,
    latestToleranceDays: 3,
    mutableTailDays: 14,
    maximumAsOfAgeDays: 10,
  }),
  leading_cycle: Object.freeze({
    availabilityLagDays: 0,
    availabilityLagMonths: 2,
    latestToleranceDays: 7,
    mutableTailDays: 95,
    maximumAsOfAgeDays: 75,
  }),
  news_sentiment: Object.freeze({
    availabilityLagDays: 1,
    latestToleranceDays: 4,
    mutableTailDays: 35,
    maximumAsOfAgeDays: 10,
  }),
  customer_deposit: Object.freeze({
    availabilityLagDays: 2,
    latestToleranceDays: 5,
    mutableTailDays: 21,
    maximumAsOfAgeDays: 14,
  }),
  kospi_credit: Object.freeze({
    availabilityLagDays: 2,
    latestToleranceDays: 5,
    mutableTailDays: 21,
    maximumAsOfAgeDays: 14,
  }),
  kosdaq_credit: Object.freeze({
    availabilityLagDays: 2,
    latestToleranceDays: 5,
    mutableTailDays: 21,
    maximumAsOfAgeDays: 14,
  }),
  adr_kospi: Object.freeze({
    availabilityLagDays: 0,
    latestToleranceDays: 3,
    mutableTailDays: 14,
    maximumAsOfAgeDays: 10,
  }),
  adr_kosdaq: Object.freeze({
    availabilityLagDays: 0,
    latestToleranceDays: 3,
    mutableTailDays: 14,
    maximumAsOfAgeDays: 10,
  }),
  fear_greed: Object.freeze({
    availabilityLagDays: 0,
    latestToleranceDays: 3,
    mutableTailDays: 14,
    maximumAsOfAgeDays: 10,
  }),
  vkospi: Object.freeze({
    availabilityLagDays: 0,
    latestToleranceDays: 3,
    mutableTailDays: 14,
    maximumAsOfAgeDays: 10,
  }),
  vix: Object.freeze({
    // The US close is only usable by the Korean app on the following date.
    availabilityLagDays: 1,
    latestToleranceDays: 4,
    mutableTailDays: 14,
    maximumAsOfAgeDays: 11,
  }),
  score: Object.freeze({
    availabilityLagDays: 0,
    latestToleranceDays: 3,
    mutableTailDays: 14,
    maximumAsOfAgeDays: 10,
  }),
});

function normalizeDate(value) {
  const date = String(value || "").slice(0, 10);
  if (!DATE_PATTERN.test(date)) return "";
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
    ? date
    : "";
}

function isPriceSeries(series) {
  const key = String(series || "").trim().toUpperCase();
  return key === "^KS11" || key === "^KQ11" || /^\d{6}\.(KS|KQ)$/.test(key);
}

export function seriesTimelinePolicy(series) {
  const key = String(series || "").trim();
  const configured = SERIES_TIMELINE_POLICIES[key];
  return configured || (isPriceSeries(key) ? SERIES_TIMELINE_POLICIES.price : DEFAULT_POLICY);
}

export function shiftTimelineDate(date, days) {
  const normalized = normalizeDate(date);
  const timestamp = normalized ? Date.parse(`${normalized}T00:00:00Z`) : NaN;
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + (Number(days) || 0) * DAY_MS).toISOString().slice(0, 10);
}

export function shiftTimelineMonth(date, months) {
  const normalized = normalizeDate(date);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const monthIndex = (year * 12) + (month - 1) + (Number(months) || 0);
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonthIndex,
    Math.min(day, lastDay),
  )).toISOString().slice(0, 10);
}

export function availableOnDate(series, observationDate) {
  const policy = seriesTimelinePolicy(series);
  if (Number(policy.availabilityLagMonths)) {
    return shiftTimelineMonth(observationDate, policy.availabilityLagMonths);
  }
  return shiftTimelineDate(observationDate, policy.availabilityLagDays);
}

function monthlyObservationRows(rows, key) {
  const points = rows.flatMap((row) => {
    const rawValue = row?.[key];
    const value = rawValue == null || rawValue === "" ? NaN : Number(rawValue);
    const time = Date.parse(`${row.date}T00:00:00Z`);
    return Number.isFinite(time) && Number.isFinite(value)
      ? [{ date: row.date, time, value }]
      : [];
  });
  const months = [...new Set(points.map((point) => point.date.slice(0, 7)))];

  return months.flatMap((month) => {
    const date = `${month}-01`;
    const time = Date.parse(`${date}T00:00:00Z`);
    const exact = points.find((point) => point.time === time);
    if (exact) return [{ date, [key]: exact.value }];

    const left = points.findLast((point) => point.time < time);
    const right = points.find((point) => point.time > time);
    if (left && right && right.time > left.time) {
      const ratio = (time - left.time) / (right.time - left.time);
      const value = left.value + ((right.value - left.value) * ratio);
      return [{ date, [key]: Number(value.toFixed(6)) }];
    }

    const firstInMonth = points.find((point) => point.date.startsWith(`${month}-`));
    return firstInMonth ? [{ date, [key]: firstInMonth.value }] : [];
  });
}

export function rebaseSeriesRowsToAvailability(rows, series, options = {}) {
  const key = String(series || "").trim();
  const source = Array.isArray(rows) ? rows : [];
  const dateBasis = String(options.dateBasis || "observation").trim().toLowerCase();
  const byDate = new Map();
  const normalizedRows = [];

  source.forEach((row) => {
    const date = normalizeDate(row?.date);
    if (!date) return;
    const normalized = { ...(row || {}), date };
    normalizedRows.push(normalized);
    const previous = byDate.get(date) || { date };
    byDate.set(date, { ...previous, ...normalized, date });
  });
  if (!key || dateBasis === "availability" || dateBasis === "publication") {
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  byDate.forEach((row) => { delete row[key]; });
  const seriesRows = options.observationCadence === "monthly"
    ? monthlyObservationRows(normalizedRows, key)
    : normalizedRows;
  seriesRows.forEach((row) => {
    const sourceDate = row.date;
    const value = row?.[key];
    if (value == null || !Number.isFinite(Number(value))) return;
    const explicitDate = normalizeDate(
      row?.availableDate
        || row?.available_date
        || row?.publicationDate
        || row?.publication_date,
    );
    const date = explicitDate || availableOnDate(key, sourceDate);
    if (!date) return;
    const target = byDate.get(date) || { date };
    target[key] = Number(value);
    byDate.set(date, target);
  });

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function latestToleranceMs(seriesList) {
  const policies = (Array.isArray(seriesList) ? seriesList : [seriesList])
    .filter(Boolean)
    .map(seriesTimelinePolicy);
  const days = policies.length
    ? Math.max(...policies.map((policy) => Number(policy.latestToleranceDays) || 0))
    : DEFAULT_POLICY.latestToleranceDays;
  return Math.max(0, days) * DAY_MS;
}

export function mutableTailStartDate(series, latestDate) {
  const policy = seriesTimelinePolicy(series);
  return shiftTimelineDate(latestDate, -(Number(policy.mutableTailDays) || 0));
}

export function classifyTimelineDate(series, date, latestDate) {
  const normalized = normalizeDate(date);
  const latest = normalizeDate(latestDate);
  if (!normalized || !latest) return "invalid";
  return normalized >= mutableTailStartDate(series, latest) ? "mutable" : "stable";
}

export function maximumAsOfAgeDays(seriesList) {
  const policies = (Array.isArray(seriesList) ? seriesList : [seriesList])
    .filter(Boolean)
    .map(seriesTimelinePolicy);
  return policies.length
    ? Math.max(...policies.map((policy) => Number(policy.maximumAsOfAgeDays) || 0))
    : DEFAULT_POLICY.maximumAsOfAgeDays;
}

const api = Object.freeze({
  SERIES_TIMELINE_POLICIES,
  availableOnDate,
  classifyTimelineDate,
  latestToleranceMs,
  maximumAsOfAgeDays,
  mutableTailStartDate,
  rebaseSeriesRowsToAvailability,
  seriesTimelinePolicy,
  shiftTimelineDate,
  shiftTimelineMonth,
});
