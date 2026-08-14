(function initThinkStockMacdOscillator(globalScope) {
  "use strict";

  const toNumber = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function alignedEma(values, period) {
    const size = Math.max(1, Math.floor(Number(period) || 1));
    const output = Array(values.length).fill(null);
    const seed = [];
    const multiplier = 2 / (size + 1);
    let previous = null;

    values.forEach((rawValue, index) => {
      const value = toNumber(rawValue);
      if (value === null) return;
      if (previous === null) {
        seed.push(value);
        if (seed.length < size) return;
        previous = seed.reduce((sum, item) => sum + item, 0) / size;
      } else {
        previous += (value - previous) * multiplier;
      }
      output[index] = previous;
    });
    return output;
  }

  function standardDeviation(values) {
    if (values.length < 2) return 0;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce(
      (sum, value) => sum + ((value - average) ** 2),
      0,
    ) / values.length);
  }

  function calculateSignal(values) {
    const recent = values.filter(Number.isFinite).slice(-40);
    if (recent.length < 8) return 0;
    const deviation = standardDeviation(recent) || 0.0001;
    const latest = recent.at(-1);
    const previous = recent.slice(-5, -1);
    const previousMean = previous.reduce((sum, value) => sum + value, 0) / previous.length;
    const position = clamp(latest / (deviation * 1.8), -1, 1);
    const slope = clamp((latest - previousMean) / deviation, -1, 1);
    const persistence = recent.slice(-5).reduce(
      (sum, value) => sum + Math.sign(value),
      0,
    ) / 5;
    return clamp((position * 0.45) + (slope * 0.35) + (persistence * 0.2), -1, 1);
  }

  function buildMacdOscillator(options = {}) {
    const sourceDates = Array.isArray(options.dates) ? options.dates : [];
    const sourcePrices = Array.isArray(options.prices) ? options.prices : [];
    const points = [];
    const pointCount = Math.min(sourceDates.length, sourcePrices.length);
    for (let index = 0; index < pointCount; index += 1) {
      const price = toNumber(sourcePrices[index]);
      const date = String(sourceDates[index] || "").slice(0, 10);
      if (date && price !== null && price > 0) points.push({ date, price });
    }

    const fastPeriod = Math.max(2, Number(options.fastPeriod) || 12);
    const slowPeriod = Math.max(fastPeriod + 1, Number(options.slowPeriod) || 26);
    const signalPeriod = Math.max(2, Number(options.signalPeriod) || 9);
    if (points.length < slowPeriod + signalPeriod - 1) return null;

    const prices = points.map((point) => point.price);
    const fast = alignedEma(prices, fastPeriod);
    const slow = alignedEma(prices, slowPeriod);
    const macd = prices.map((_, index) => (
      Number.isFinite(fast[index]) && Number.isFinite(slow[index])
        ? fast[index] - slow[index]
        : null
    ));
    const signalLine = alignedEma(macd, signalPeriod);
    const oscillator = macd.map((value, index) => (
      Number.isFinite(value) && Number.isFinite(signalLine[index])
        ? value - signalLine[index]
        : null
    ));
    const normalized = oscillator.map((value, index) => (
      Number.isFinite(value) ? (value / prices[index]) * 100 : null
    ));

    return {
      dates: points.map((point) => point.date),
      prices,
      macd,
      signalLine,
      oscillator,
      normalized,
      signal: calculateSignal(normalized),
      periods: { fast: fastPeriod, slow: slowPeriod, signal: signalPeriod },
    };
  }

  function thinMacdPoints(dates, values, budget = 1400) {
    const count = Math.min(dates?.length || 0, values?.length || 0);
    const limit = Math.max(20, Math.floor(Number(budget) || 1400));
    if (count <= limit) return { dates: dates.slice(0, count), values: values.slice(0, count) };

    const keep = new Set([0, count - 1]);
    const bucketSize = Math.max(1, Math.ceil((count - 2) / Math.max(1, Math.floor((limit - 2) / 2))));
    for (let start = 1; start < count - 1; start += bucketSize) {
      const end = Math.min(count - 1, start + bucketSize);
      let minIndex = -1;
      let maxIndex = -1;
      let minValue = Infinity;
      let maxValue = -Infinity;
      for (let index = start; index < end; index += 1) {
        const value = toNumber(values[index]);
        if (value === null) continue;
        if (value < minValue) { minValue = value; minIndex = index; }
        if (value > maxValue) { maxValue = value; maxIndex = index; }
      }
      if (minIndex >= 0) keep.add(minIndex);
      if (maxIndex >= 0) keep.add(maxIndex);
    }
    const indexes = [...keep].sort((left, right) => left - right).slice(0, limit);
    return {
      dates: indexes.map((index) => dates[index]),
      values: indexes.map((index) => values[index]),
    };
  }

  globalScope.ThinkStockMacdOscillator = Object.freeze({
    alignedEma,
    buildMacdOscillator,
    thinMacdPoints,
  });
}(typeof self !== "undefined" ? self : globalThis));
