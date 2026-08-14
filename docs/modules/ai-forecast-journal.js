(function initThinkStockAiForecastJournal(globalScope) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const FORECAST_HORIZONS = Object.freeze([5, 10, 20, 63, 126]);
  const MAX_RECORDS = 60;
  const DENSE_RECORDS = 24;
  const WEEKLY_RECORDS = 24;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const AUDIT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
  const ATTRIBUTION_COMPONENTS = new Set([
    "localModel",
    "top400Blend",
    "empiricalGuardrail",
    "corporateRiskGate",
    "criticalNewsGate",
    "consensus",
    "fundamentals",
    "internetNews",
    "marketRegime",
    "corporateRisk",
    "rotation",
    "rangeMeanReversion",
    "terminalRisk",
    "finalClamp",
    "analogPath",
    "journalCalibration",
  ]);

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

  function normalizeNumericMap(value, { maxEntries = 192, maxAbs = 1e12, allowedKeys = null } = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, rawValue]) => {
      if (!AUDIT_KEY_PATTERN.test(key) || (allowedKeys && !allowedKeys.has(key))) return [];
      const number = Number(rawValue);
      return Number.isFinite(number) && Math.abs(number) <= maxAbs ? [[key, number]] : [];
    }).slice(0, maxEntries));
  }

  function normalizeDateMap(value, cutoff) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, rawValue]) => {
      const date = normalizeDate(rawValue);
      return AUDIT_KEY_PATTERN.test(key) && date && (!cutoff || date <= cutoff)
        ? [[key, date]]
        : [];
    }).slice(0, 24));
  }

  function normalizeAudit(value, fallbackAsOf = "") {
    if (!value || value.format !== "ai-audit-v1") return null;
    const features = normalizeNumericMap(value.features);
    const sources = normalizeNumericMap(value.sources, { maxEntries: 24, maxAbs: 1e9 });
    const scenarioWeights = normalizeNumericMap(value.scenarioWeights, { maxEntries: 3, maxAbs: 100 });
    const recordAsOf = normalizeDate(fallbackAsOf);
    const requestedAsOf = normalizeDate(value.asOfDate);
    const asOfDate = requestedAsOf && (!recordAsOf || requestedAsOf >= recordAsOf)
      ? requestedAsOf
      : recordAsOf;
    const requestedPriceAsOf = normalizeDate(value.priceAsOfDate);
    const priceAsOfDate = recordAsOf || (
      requestedPriceAsOf && (!asOfDate || requestedPriceAsOf <= asOfDate)
        ? requestedPriceAsOf
        : asOfDate
    );
    const sourceDates = normalizeDateMap(value.sourceDates, asOfDate);
    if (!Object.keys(features).length) return null;
    return {
      format: "ai-audit-v1",
      ...(asOfDate ? { asOfDate } : {}),
      ...(priceAsOfDate ? { priceAsOfDate } : {}),
      sourceDates,
      features,
      sources,
      scenarioWeights,
    };
  }

  function normalizeAttribution(value, expectedDays) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const days = Number(value.days ?? expectedDays);
    const expectedLogReturn = Number(value.expectedLogReturn);
    const components = normalizeNumericMap(value.components, {
      maxEntries: ATTRIBUTION_COMPONENTS.size,
      maxAbs: 10,
      allowedKeys: ATTRIBUTION_COMPONENTS,
    });
    if (days !== expectedDays || !Number.isFinite(expectedLogReturn) || Math.abs(expectedLogReturn) > 10) return null;
    if (!Object.keys(components).length) return null;
    return { days: expectedDays, expectedLogReturn, components };
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
    const signedLogError = Number(value.signedLogError ?? (actualLogReturn - predictedLogReturn));
    const squaredLogError = Number(value.squaredLogError ?? (signedLogError ** 2));
    const momentumPredictedLogReturn = Number(value.momentumPredictedLogReturn);
    const momentumAbsLogError = Number(value.momentumAbsLogError);
    if (
      !actualDate
      || actualPrice === null
      || !Number.isFinite(actualLogReturn)
      || !Number.isFinite(predictedLogReturn)
      || !Number.isFinite(absLogError)
      || !Number.isFinite(signedLogError)
      || !Number.isFinite(squaredLogError)
      || absLogError < 0
      || squaredLogError < 0
      || typeof value.directionCorrect !== "boolean"
      || typeof value.intervalCovered !== "boolean"
    ) return null;
    return {
      actualDate,
      actualPrice,
      actualLogReturn,
      predictedLogReturn,
      absLogError,
      signedLogError,
      squaredLogError,
      directionCorrect: value.directionCorrect,
      intervalCovered: value.intervalCovered,
      scoredAt: timestampOr(value.scoredAt, 0),
      ...(Number.isFinite(momentumPredictedLogReturn)
        && Number.isFinite(momentumAbsLogError)
        && momentumAbsLogError >= 0
        ? { momentumPredictedLogReturn, momentumAbsLogError }
        : {}),
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
      signedLogError: value.signedLogError,
      squaredLogError: value.squaredLogError,
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
      attribution: normalizeAttribution(value.attribution, expectedDays),
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
        attribution: source.attribution?.horizons?.[horizon]
          || source.attribution?.horizons?.[String(horizon)],
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
    return { asOf, basePrice, horizons, audit: normalizeAudit(value.audit, asOf) };
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
      audit: forecast.audit,
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
      audit: normalizeAudit(value.audit, asOf),
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

  function firstPriceOnOrAfter(prices, targetDate) {
    let low = 0;
    let high = prices.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (prices[middle].date < targetDate) low = middle + 1;
      else high = middle;
    }
    return prices[low] || null;
  }

  function lastPriceIndexOnOrBefore(prices, targetDate) {
    let low = 0;
    let high = prices.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (prices[middle].date <= targetDate) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }

  function scoreNormalizedRecord(record, prices, now) {
    if (!prices.length) return record;
    let changed = false;
    const horizons = {};
    const baseIndex = lastPriceIndexOnOrBefore(prices, record.asOf);
    FORECAST_HORIZONS.forEach((horizon) => {
      const result = record.horizons[horizon];
      const actual = firstPriceOnOrAfter(prices, result.targetDate);
      if (!actual) {
        horizons[horizon] = result;
        return;
      }
      if (result.score?.actualDate === actual.date && result.score?.actualPrice === actual.close) {
        horizons[horizon] = result;
        return;
      }
      const actualLogReturn = Math.log(actual.close / record.basePrice);
      const predictedLogReturn = Math.log(result.predictedPrice / record.basePrice);
      const signedLogError = actualLogReturn - predictedLogReturn;
      const momentumBase = baseIndex - horizon >= 0 ? prices[baseIndex - horizon] : null;
      const momentumPredictedLogReturn = momentumBase?.close > 0
        ? Math.log(record.basePrice / momentumBase.close)
        : null;
      horizons[horizon] = {
        ...result,
        score: {
          actualDate: actual.date,
          actualPrice: actual.close,
          actualLogReturn,
          predictedLogReturn,
          absLogError: Math.abs(signedLogError),
          signedLogError,
          squaredLogError: signedLogError ** 2,
          directionCorrect: direction(actualLogReturn) === direction(predictedLogReturn),
          intervalCovered: actual.close >= result.lowerPrice && actual.close <= result.upperPrice,
          scoredAt: timestampOr(now, Date.now()),
          ...(Number.isFinite(momentumPredictedLogReturn) ? {
            momentumPredictedLogReturn,
            momentumAbsLogError: Math.abs(actualLogReturn - momentumPredictedLogReturn),
          } : {}),
        },
      };
      changed = true;
    });
    return changed
      ? { ...record, updatedAt: timestampOr(now, record.updatedAt), horizons }
      : record;
  }

  function scoreForecastRecord(value, priceHistory, now = Date.now()) {
    const record = normalizeForecastRecord(value);
    if (!record) return null;
    return scoreNormalizedRecord(record, normalizePriceHistory(priceHistory), now);
  }

  function scoreForecastRecords(values, priceHistory, now = Date.now()) {
    const prices = normalizePriceHistory(priceHistory);
    return (Array.isArray(values) ? values : []).map((value) => {
      const record = normalizeForecastRecord(value);
      return record ? scoreNormalizedRecord(record, prices, now) : null;
    });
  }

  function mean(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
  }

  function rounded(value, digits = 5) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  }

  function summarizeForecastQuality(values, options = {}) {
    const asOf = normalizeDate(options.asOf);
    const requestedHorizons = Array.isArray(options.horizons) && options.horizons.length
      ? options.horizons.map(Number).filter((value) => FORECAST_HORIZONS.includes(value))
      : [20, 63, 126];
    const records = (Array.isArray(values) ? values : [])
      .map(normalizeForecastRecord)
      .filter(Boolean);
    const horizons = Object.fromEntries(requestedHorizons.map((horizon) => {
      const scores = records.flatMap((record) => {
        const score = record.horizons[horizon]?.score;
        if (!score || (asOf && score.actualDate > asOf)) return [];
        return [score];
      });
      const meanAbsoluteLogError = mean(scores.map((score) => Number(score.absLogError)));
      const noChangeMeanAbsoluteLogError = mean(scores.map((score) => (
        Math.abs(Number(score.actualLogReturn))
      )));
      const momentumMeanAbsoluteLogError = mean(scores.map((score) => (
        Number(score.momentumAbsLogError)
      )));
      const skill = (baseline) => (
        Number.isFinite(meanAbsoluteLogError) && Number.isFinite(baseline) && baseline > 1e-9
          ? 1 - (meanAbsoluteLogError / baseline)
          : null
      );
      return [horizon, Object.freeze({
        samples: scores.length,
        directionAccuracy: rounded(mean(scores.map((score) => Number(score.directionCorrect === true)))),
        intervalCoverage: rounded(mean(scores.map((score) => Number(score.intervalCovered === true)))),
        meanAbsoluteLogError: rounded(meanAbsoluteLogError),
        meanSignedLogError: rounded(mean(scores.map((score) => Number(score.signedLogError)))),
        noChangeMeanAbsoluteLogError: rounded(noChangeMeanAbsoluteLogError),
        momentumMeanAbsoluteLogError: rounded(momentumMeanAbsoluteLogError),
        skillVsNoChange: rounded(skill(noChangeMeanAbsoluteLogError)),
        skillVsMomentum: rounded(skill(momentumMeanAbsoluteLogError)),
        status: scores.length >= 8 ? "usable" : (scores.length ? "limited" : "pending"),
      })];
    }));
    const totalSamples = Object.values(horizons).reduce((sum, item) => sum + item.samples, 0);
    return Object.freeze({
      format: "ai-forecast-quality-v1",
      asOf,
      horizons: Object.freeze(horizons),
      totalSamples,
      status: totalSamples >= requestedHorizons.length * 8
        ? "usable"
        : (totalSamples ? "limited" : "pending"),
    });
  }

  function mergeDuplicate(existing, incoming) {
    const preferred = incoming.updatedAt >= existing.updatedAt ? incoming : existing;
    const other = preferred === incoming ? existing : incoming;
    const horizons = {};
    FORECAST_HORIZONS.forEach((horizon) => {
      const selected = preferred.horizons[horizon];
      const otherHorizon = other.horizons[horizon];
      horizons[horizon] = {
        ...selected,
        attribution: selected.attribution || otherHorizon.attribution,
        score: selected.score || otherHorizon.score,
      };
    });
    return {
      ...preferred,
      createdAt: Math.min(existing.createdAt, incoming.createdAt),
      updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
      horizons,
      audit: preferred.audit || other.audit,
    };
  }

  function compactForecastRecords(values, maxRecords = MAX_RECORDS) {
    const limit = Math.max(0, Math.min(MAX_RECORDS, Math.trunc(Number(maxRecords) || MAX_RECORDS)));
    const sorted = [...(Array.isArray(values) ? values : [])].sort((left, right) => (
      right.asOf.localeCompare(left.asOf)
      || right.createdAt - left.createdAt
      || left.id.localeCompare(right.id)
    ));
    if (!limit || sorted.length <= limit) return sorted.slice(0, limit);

    const denseLimit = Math.min(DENSE_RECORDS, limit);
    const weeklyLimit = Math.min(WEEKLY_RECORDS, Math.max(0, limit - denseLimit));
    const monthlyLimit = Math.max(0, limit - denseLimit - weeklyLimit);
    const selected = new Set(sorted.slice(0, denseLimit).map((record) => record.id));
    const weekBuckets = new Set();
    let cursor = denseLimit;

    for (; cursor < sorted.length && weekBuckets.size < weeklyLimit; cursor += 1) {
      const record = sorted[cursor];
      const timestamp = Date.parse(`${record.asOf}T00:00:00Z`);
      const bucket = Number.isFinite(timestamp) ? Math.floor(timestamp / (7 * DAY_MS)) : record.asOf;
      if (weekBuckets.has(bucket)) continue;
      weekBuckets.add(bucket);
      selected.add(record.id);
    }

    const monthBuckets = new Set();
    for (; cursor < sorted.length && monthBuckets.size < monthlyLimit; cursor += 1) {
      const record = sorted[cursor];
      const bucket = record.asOf.slice(0, 7);
      if (monthBuckets.has(bucket)) continue;
      monthBuckets.add(bucket);
      selected.add(record.id);
    }

    // Sparse histories should still use the available budget after reserving long-term samples.
    for (const record of sorted) {
      if (selected.size >= limit) break;
      selected.add(record.id);
    }
    return sorted.filter((record) => selected.has(record.id)).slice(0, limit);
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
    return compactForecastRecords([...merged.values()], maxRecords);
  }

  globalScope.ThinkStockAiForecastJournal = Object.freeze({
    FORECAST_HORIZONS,
    MAX_RECORDS,
    SCHEMA_VERSION,
    buildForecastRecord,
    compactForecastRecords,
    forecastRecordId,
    mergeForecastRecords,
    normalizeForecastRecord,
    normalizeForecastResult,
    normalizePriceHistory,
    scoreForecastRecord,
    scoreForecastRecords,
    summarizeForecastQuality,
  });
}(typeof self !== "undefined" ? self : globalThis));
