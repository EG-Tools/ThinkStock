(function initThinkStockAiForecastMath(globalScope) {
  "use strict";

  const EPSILON = 1e-9;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function compactAuditMap(source) {
    return Object.fromEntries(Object.entries(source || {}).flatMap(([key, value]) => {
      const number = finite(value);
      return number === null ? [] : [[key, Math.round(number * 1e8) / 1e8]];
    }));
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function variance(values, average = mean(values)) {
    if (values.length < 2) return 0;
    return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
  }

  function standardDeviation(values) {
    return Math.sqrt(Math.max(0, variance(values)));
  }

  function quantile(values, probability) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const position = clamp(probability, 0, 1) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] + ((sorted[upper] - sorted[lower]) * weight);
  }

  function pearson(left, right) {
    const size = Math.min(left.length, right.length);
    if (size < 8) return 0;
    const a = left.slice(-size);
    const b = right.slice(-size);
    const aMean = mean(a);
    const bMean = mean(b);
    let covariance = 0;
    let aVariance = 0;
    let bVariance = 0;
    for (let index = 0; index < size; index += 1) {
      const aDelta = a[index] - aMean;
      const bDelta = b[index] - bMean;
      covariance += aDelta * bDelta;
      aVariance += aDelta ** 2;
      bVariance += bDelta ** 2;
    }
    return covariance / Math.sqrt(Math.max(EPSILON, aVariance * bVariance));
  }

  function nextBusinessDates(lastDate, count) {
    const output = [];
    const cursor = new Date(`${lastDate}T00:00:00Z`);
    while (output.length < count) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) output.push(cursor.toISOString().slice(0, 10));
    }
    return output;
  }

  globalScope.ThinkStockAiForecastMath = Object.freeze({
    EPSILON,
    clamp,
    compactAuditMap,
    finite,
    mean,
    nextBusinessDates,
    pearson,
    quantile,
    standardDeviation,
    variance,
  });
}(typeof self !== "undefined" ? self : globalThis));
