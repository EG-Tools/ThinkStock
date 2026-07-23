(function initThinkStockAiForecastJournal(globalScope) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const FORECAST_HORIZONS = Object.freeze([20, 63, 126]);
  const MAX_RECORDS = 60;
  const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeDate(value) {
    const date = String(value || "").slice(0, 10);
    if (!DATE_PATTERN.test(date)) return "";
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
      ? date
      : "";
  }

  function normalizeTicker(value) {
    const ticker = String(value || "").trim().toUpperCase();
    return TICKER_PATTERN.test(ticker) ? ticker : "";
  }

  function normalizeModelVersion(value) {
    const version = String(value || "").trim().slice(0, 80);
    return version && !/[\u0000-\u001f\u007f]/.test(version) ? version : "";
  }

  function timestampOr(value, fallback) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? Math.trunc(timestamp) : fallback;
  }

  function forecastRecordId(ticker, asOf, modelVersion) {
    const normalizedTicker = normalizeTicker(ticker);
    const normalizedAsOf = normalizeDate(asOf);
    const normalizedVersion = normalizeModelVersion(modelVersion);
    if (!normalizedTicker || !normalizedAsOf || !normalizedVersion) return "";
    const idVersion = normalizedVersion.replace(/[^A-Za-z0-9._:-]/g, "_");
    return `${normalizedTicker}:${normalizedAsOf}:${idVersion}`;
  }

  function normalizeScore(value) {
    if (!value || typeof value !== "object") return null;
    const actualDate = normalizeDate(value.actualDate);
    const actualPrice = finitePositive(value.actualPrice);
    const actualLogReturn = Number(value.actualLogReturn);
    const predictedLogReturn = Number(value.predictedLogReturn);
    const absLogError = Number(value.absLogError);
    if (
      !actualDate
      || actualPrice === null
      || !Number.isFinite(actualLogReturn)
      || !Number.isFinite(predictedLogReturn)
      || !Number.isFinite(absLogError)
      || absLogError < 0
      || typeof value.directionCorrect !== "boolean"
      || typeof value.intervalCovered !== "boolean"
    ) return null;
    return {
      actualDate,
      actualPrice,
      actualLogReturn,
      predictedLogReturn,
      absLogError,
      directionCorrect: value.directionCorrect,
      intervalCovered: value.intervalCovered,
      scoredAt: timestampOr(value.scoredAt, 0),
    };
  }

  function normalizeHorizon(value, expectedDays, basePrice = null) {
    if (!value || typeof value !== "object") return null;
    const days = Number(value.days ?? expectedDays);
    const targetDate = normalizeDate(value.targetDate ?? value.date);
    const predictedPrice = finitePositive(value.predictedPrice ?? value.price);
    const lowerPrice = finitePositive(value.lowerPrice ?? value.lower);
    const upperPrice = finitePositive(value.upperPrice ?? value.upper);
    if (
      days !== expectedDays
      || !targetDate
      || predictedPrice === null
      || lowerPrice === null
      || upperPrice === null
    ) return null;
    const score = normalizeScore(value.score || {
      actualDate: value.actualDate,
      actualPrice: value.actualPrice,
      actualLogReturn: value.actualLogReturn ?? (
        finitePositive(value.actualPrice) && finitePositive(basePrice)
          ? Math.log(Number(value.actualPrice) / Number(basePrice))
          : 0
      ),
      predictedLogReturn: value.predictedLogReturn ?? (
        finitePositive(basePrice) ? Math.log(predictedPrice / Number(basePrice)) : 0
      ),
      absLogError: value.absLogError ?? value.absoluteLogError,
      directionCorrect: value.directionCorrect,
      intervalCovered: value.intervalCovered ?? value.covered,
      scoredAt: value.scoredAt,
    });
    return {
      days: expectedDays,
      targetDate,
      predictedPrice,
      lowerPrice: Math.min(lowerPrice, upperPrice),
      upperPrice: Math.max(lowerPrice, upperPrice),
      score,
    };
  }

  function horizonSource(source, horizon) {
    if (Array.isArray(source?.dates) && Array.isArray(source?.prices)) {
      return {
        days: horizon,
        targetDate: source.dates[horizon],
        predictedPrice: source.prices[horizon],
        lowerPrice: source.lowerPrices?.[horizon],
        upperPrice: source.upperPrices?.[horizon],
      };
    }
    return source?.horizons?.[horizon]
      || source?.horizons?.[String(horizon)]
      || (Array.isArray(source?.horizons)
        ? source.horizons.find((item) => Number(item?.days) === horizon)
        : null);
  }

  function normalizeForecastResult(value) {
    if (!value || typeof value !== "object") return null;
    const asOf = normalizeDate(value.asOf ?? value.dates?.[0]);
    const basePrice = finitePositive(value.basePrice ?? value.prices?.[0]);
    if (!asOf || basePrice === null) return null;
    const horizons = {};
    for (const horizon of FORECAST_HORIZONS) {
      const normalized = normalizeHorizon(horizonSource(value, horizon), horizon, basePrice);
      if (!normalized || normalized.targetDate <= asOf) return null;
      horizons[horizon] = normalized;
    }
    return { asOf, basePrice, horizons };
  }

  function buildForecastRecord(options = {}) {
    const ticker = normalizeTicker(options.ticker);
    const modelVersion = normalizeModelVersion(
      options.modelVersion ?? options.forecast?.modelVersion ?? options.forecast?.model?.version,
    );
    const forecast = normalizeForecastResult({
      ...options.forecast,
      asOf: options.asOf ?? options.forecast?.asOf,
      basePrice: options.basePrice ?? options.forecast?.basePrice,
    });
    if (!ticker || !modelVersion || !forecast) return null;
    const createdAt = timestampOr(options.createdAt, Date.now());
    return {
      schema: SCHEMA_VERSION,
      id: forecastRecordId(ticker, forecast.asOf, modelVersion),
      ticker,
      asOf: forecast.asOf,
      modelVersion,
      basePrice: forecast.basePrice,
      createdAt,
      updatedAt: timestampOr(options.updatedAt, createdAt),
      horizons: forecast.horizons,
    };
  }

  function normalizeForecastRecord(value) {
    if (!value || typeof value !== "object") return null;
    const ticker = normalizeTicker(value.ticker);
    const asOf = normalizeDate(value.asOf);
    const modelVersion = normalizeModelVersion(value.modelVersion);
    const basePrice = finitePositive(value.basePrice);
    const expectedId = forecastRecordId(ticker, asOf, modelVersion);
    if (!expectedId || basePrice === null) return null;
    const horizons = {};
    for (const horizon of FORECAST_HORIZONS) {
      const normalized = normalizeHorizon(horizonSource(value, horizon), horizon, basePrice);
      if (!normalized || normalized.targetDate <= asOf) return null;
      horizons[horizon] = normalized;
    }
    const createdAt = timestampOr(value.createdAt, 0);
    if (!createdAt) return null;
    return {
      schema: SCHEMA_VERSION,
      id: expectedId,
      ticker,
      asOf,
      modelVersion,
      basePrice,
      createdAt,
      updatedAt: timestampOr(value.updatedAt, createdAt),
      horizons,
    };
  }

  function normalizePriceHistory(value) {
    const byDate = new Map();
    const rows = Array.isArray(value)
      ? value
      : (Array.isArray(value?.dates) ? value.dates.map((date, index) => ({
        date,
        close: value.prices?.[index] ?? value.closes?.[index],
      })) : []);
    rows.forEach((row) => {
      const date = normalizeDate(row?.date);
      const close = finitePositive(row?.close ?? row?.price ?? row?.value);
      if (date && close !== null) byDate.set(date, { date, close });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function direction(value) {
    if (Math.abs(value) < 1e-12) return 0;
    return Math.sign(value);
  }

  function scoreForecastRecord(value, priceHistory, now = Date.now()) {
    const record = normalizeForecastRecord(value);
    if (!record) return null;
    const prices = normalizePriceHistory(priceHistory);
    if (!prices.length) return record;
    let changed = false;
    const horizons = {};
    FORECAST_HORIZONS.forEach((horizon) => {
      const result = record.horizons[horizon];
      const actual = prices.find((point) => point.date >= result.targetDate);
      if (!actual) {
        horizons[horizon] = result;
        return;
      }
      const actualLogReturn = Math.log(actual.close / record.basePrice);
      const predictedLogReturn = Math.log(result.predictedPrice / record.basePrice);
      horizons[horizon] = {
        ...result,
        score: {
          actualDate: actual.date,
          actualPrice: actual.close,
          actualLogReturn,
          predictedLogReturn,
          absLogError: Math.abs(actualLogReturn - predictedLogReturn),
          directionCorrect: direction(actualLogReturn) === direction(predictedLogReturn),
          intervalCovered: actual.close >= result.lowerPrice && actual.close <= result.upperPrice,
          scoredAt: timestampOr(now, Date.now()),
        },
      };
      changed = true;
    });
    return changed
      ? { ...record, updatedAt: timestampOr(now, record.updatedAt), horizons }
      : record;
  }

  function mergeDuplicate(existing, incoming) {
    const preferred = incoming.updatedAt >= existing.updatedAt ? incoming : existing;
    const other = preferred === incoming ? existing : incoming;
    const horizons = {};
    FORECAST_HORIZONS.forEach((horizon) => {
      const selected = preferred.horizons[horizon];
      horizons[horizon] = selected.score
        ? selected
        : { ...selected, score: other.horizons[horizon].score };
    });
    return {
      ...preferred,
      createdAt: Math.min(existing.createdAt, incoming.createdAt),
      updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
      horizons,
    };
  }

  function mergeForecastRecords(existing, incoming, maxRecords = MAX_RECORDS) {
    const merged = new Map();
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
      .forEach((value) => {
        const record = normalizeForecastRecord(value);
        if (!record) return;
        const prior = merged.get(record.id);
        merged.set(record.id, prior ? mergeDuplicate(prior, record) : record);
      });
    const limit = Math.max(0, Math.min(MAX_RECORDS, Math.trunc(Number(maxRecords) || MAX_RECORDS)));
    return [...merged.values()]
      .sort((left, right) => (
        right.asOf.localeCompare(left.asOf)
        || right.createdAt - left.createdAt
        || left.id.localeCompare(right.id)
      ))
      .slice(0, limit);
  }

  globalScope.ThinkStockAiForecastJournal = Object.freeze({
    FORECAST_HORIZONS,
    MAX_RECORDS,
    SCHEMA_VERSION,
    buildForecastRecord,
    forecastRecordId,
    mergeForecastRecords,
    normalizeForecastRecord,
    normalizeForecastResult,
    normalizePriceHistory,
    scoreForecastRecord,
  });
}(typeof self !== "undefined" ? self : globalThis));
