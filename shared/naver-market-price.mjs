import { compareProviderSeries } from "./series-integrity.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function finitePositive(value) {
  const number = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizePricePoints(points) {
  return (Array.isArray(points) ? points : [])
    .filter((point) => DATE_PATTERN.test(String(point?.date || "")) && finitePositive(point?.close))
    .map((point) => ({ date: point.date, close: finitePositive(point.close) }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function parseNaverPriceSeries(text) {
  const byDate = new Map();
  for (const match of String(text || "").matchAll(/\[\s*"(\d{8})"\s*,([^\]]+)\]/g)) {
    const rawDate = match[1];
    const values = match[2].split(",").map(finitePositive);
    const close = values[3];
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    if (!DATE_PATTERN.test(date) || close === null) continue;
    byDate.set(date, { date, close });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function parseNaverPriceText(text) {
  return parseNaverPriceSeries(text).at(-1) || null;
}

export function priceRatio(left, right) {
  const a = finitePositive(left);
  const b = finitePositive(right);
  if (!a || !b) return null;
  return Math.max(a, b) / Math.min(a, b);
}

export function evaluateNaverPriceFallback(referencePoint, naverPoints, options = {}) {
  const maxOverlapRatio = Number(options.maxOverlapRatio) || 1.02;
  const points = normalizePricePoints(naverPoints);
  const latest = points.at(-1) || null;
  if (!latest) return { accepted: false, status: "unavailable", point: null };
  if (!referencePoint) return { accepted: true, status: "reference-unavailable", point: latest, jumpRatio: null };
  const overlap = points.find((point) => point.date === referencePoint.date) || null;
  const overlapRatio = overlap ? priceRatio(overlap.close, referencePoint.close) : null;
  const comparison = compareProviderSeries(
    [referencePoint],
    points,
    { key: "close", relativeTolerance: maxOverlapRatio - 1 },
  );
  if (!overlap || overlapRatio === null) {
    return { accepted: false, status: "no-overlap", point: latest, overlapRatio };
  }
  if (!comparison.ok) {
    return { accepted: false, status: "mismatch", point: latest, overlapRatio };
  }
  if (latest.date < referencePoint.date) {
    return { accepted: false, status: "matched", point: latest, overlapRatio };
  }
  if (latest.date === referencePoint.date) {
    if (!options.allowSameDate || latest.close === referencePoint.close) {
      return { accepted: false, status: "matched", point: latest, overlapRatio };
    }
    return {
      accepted: true,
      status: "matched-live",
      point: latest,
      overlapRatio,
      jumpRatio: null,
    };
  }
  const prior = [...points].reverse().find((point) => point.date < latest.date) || overlap;
  return {
    accepted: true,
    status: "matched-newer",
    point: latest,
    overlapRatio,
    jumpRatio: priceRatio(prior?.close, latest.close),
  };
}

export function validateNaverPriceTail(referencePoint, naverPoints, options = {}) {
  const maxOverlapRatio = Number(options.maxOverlapRatio) || 1.02;
  const since = DATE_PATTERN.test(String(options.since || "")) ? String(options.since) : "";
  const points = normalizePricePoints(naverPoints);
  if (!points.length) {
    return { accepted: false, status: "unavailable", points: [], overlapRatio: null };
  }
  if (!referencePoint || !DATE_PATTERN.test(String(referencePoint.date || ""))) {
    return { accepted: false, status: "reference-unavailable", points: [], overlapRatio: null };
  }
  const overlap = points.find((point) => point.date === referencePoint.date) || null;
  const overlapRatio = overlap ? priceRatio(overlap.close, referencePoint.close) : null;
  if (!overlap || overlapRatio === null) {
    return { accepted: false, status: "no-overlap", points: [], overlapRatio };
  }
  const comparison = compareProviderSeries(
    [referencePoint],
    points,
    { key: "close", relativeTolerance: maxOverlapRatio - 1 },
  );
  if (!comparison.ok) {
    return { accepted: false, status: "mismatch", points: [], overlapRatio };
  }
  return {
    accepted: true,
    status: "matched",
    points: since ? points.filter((point) => point.date >= since) : points,
    overlapRatio,
  };
}

const api = Object.freeze({
  evaluateNaverPriceFallback,
  parseNaverPriceSeries,
  parseNaverPriceText,
  priceRatio,
  validateNaverPriceTail,
});

if (typeof globalThis !== "undefined") globalThis.ThinkStockNaverMarketPrice = api;
