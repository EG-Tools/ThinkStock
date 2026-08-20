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
    availabilityLagDays: 60,
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

export function availableOnDate(series, observationDate) {
  const policy = seriesTimelinePolicy(series);
  return shiftTimelineDate(observationDate, policy.availabilityLagDays);
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
  seriesTimelinePolicy,
  shiftTimelineDate,
});

if (typeof globalThis !== "undefined") globalThis.ThinkStockSeriesTimelinePolicy = api;
