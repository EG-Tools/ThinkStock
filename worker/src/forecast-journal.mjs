const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FORECAST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const FORECAST_MODEL_PATTERN = /^[A-Za-z0-9._:+/-]{1,80}$/;
const FORECAST_HORIZON_PATTERN = /^[1-9]\d{0,3}$/;
const FORECAST_AUDIT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORECAST_ATTRIBUTION_COMPONENTS = new Set([
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
]);

export const FORECAST_JOURNAL_LIMIT = 60;
export const FORECAST_JOURNAL_INPUT_LIMIT = 120;
const DENSE_RECORDS = 24;
const WEEKLY_RECORDS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function isValidIsoDate(value) {
  const text = String(value || "");
  if (!DATE_PATTERN.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function timestamp(value) {
  return finiteNumber(value, { min: 1, max: 8_640_000_000_000_000 });
}

function journalValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeForecastNumericMap(value, { maxEntries = 128, maxAbs = 1e12, allowedKeys = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, rawValue]) => {
    if (!FORECAST_AUDIT_KEY_PATTERN.test(key) || (allowedKeys && !allowedKeys.has(key))) return [];
    const number = finiteNumber(rawValue, { min: -maxAbs, max: maxAbs });
    return number === null ? [] : [[key, number]];
  }).slice(0, maxEntries));
}

function normalizeForecastDateMap(value, cutoff) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, rawValue]) => {
    const date = String(rawValue || "").slice(0, 10);
    return FORECAST_AUDIT_KEY_PATTERN.test(key)
      && isValidIsoDate(date)
      && (!cutoff || date <= cutoff)
      ? [[key, date]]
      : [];
  }).slice(0, 24));
}

function normalizeForecastAudit(value, fallbackAsOf = "") {
  if (!value || value.format !== "ai-audit-v1") return null;
  const features = normalizeForecastNumericMap(value.features);
  const sources = normalizeForecastNumericMap(value.sources, { maxEntries: 24, maxAbs: 1e9 });
  const scenarioWeights = normalizeForecastNumericMap(value.scenarioWeights, { maxEntries: 3, maxAbs: 100 });
  const recordAsOf = isValidIsoDate(String(fallbackAsOf || "").slice(0, 10))
    ? String(fallbackAsOf).slice(0, 10)
    : "";
  const requestedAsOf = isValidIsoDate(String(value.asOfDate || "").slice(0, 10))
    ? String(value.asOfDate).slice(0, 10)
    : "";
  const asOfDate = requestedAsOf && (!recordAsOf || requestedAsOf >= recordAsOf)
    ? requestedAsOf
    : recordAsOf;
  const requestedPriceAsOf = isValidIsoDate(String(value.priceAsOfDate || "").slice(0, 10))
    ? String(value.priceAsOfDate).slice(0, 10)
    : "";
  const priceAsOfDate = recordAsOf || (
    requestedPriceAsOf && (!asOfDate || requestedPriceAsOf <= asOfDate)
      ? requestedPriceAsOf
      : asOfDate
  );
  const sourceDates = normalizeForecastDateMap(value.sourceDates, asOfDate);
  return Object.keys(features).length
    ? {
      format: "ai-audit-v1",
      ...(asOfDate ? { asOfDate } : {}),
      ...(priceAsOfDate ? { priceAsOfDate } : {}),
      sourceDates,
      features,
      sources,
      scenarioWeights,
    }
    : null;
}

function normalizeForecastAttribution(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const days = finiteNumber(value.days ?? key, { min: 1, max: 3650 });
  const expectedLogReturn = finiteNumber(value.expectedLogReturn, { min: -10, max: 10 });
  const components = normalizeForecastNumericMap(value.components, {
    maxEntries: FORECAST_ATTRIBUTION_COMPONENTS.size,
    maxAbs: 10,
    allowedKeys: FORECAST_ATTRIBUTION_COMPONENTS,
  });
  if (days !== Number(key) || expectedLogReturn === null || !Object.keys(components).length) return null;
  return { days, expectedLogReturn, components };
}

function normalizeForecastHorizon(value, key, { strict = false, basePrice = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (strict) throw journalValidationError(`Invalid forecast horizon: ${key}`);
    return null;
  }
  const targetDate = String(value.targetDate || "").slice(0, 10);
  const predictedPrice = finiteNumber(value.predictedPrice, { min: Number.MIN_VALUE, max: 1e15 });
  const lowerPrice = finiteNumber(value.lowerPrice, { min: Number.MIN_VALUE, max: 1e15 });
  const upperPrice = finiteNumber(value.upperPrice, { min: Number.MIN_VALUE, max: 1e15 });
  if (!isValidIsoDate(targetDate) || !predictedPrice || !lowerPrice || !upperPrice
    || lowerPrice > upperPrice) {
    if (strict) throw journalValidationError(`Invalid forecast values for horizon ${key}`);
    return null;
  }
  const attribution = normalizeForecastAttribution(value.attribution, key);
  const result = {
    targetDate,
    predictedPrice,
    lowerPrice,
    upperPrice,
    ...(attribution ? { attribution } : {}),
  };
  const nestedScore = value.score && typeof value.score === "object" ? value.score : null;
  const evaluation = nestedScore ? {
    actualDate: nestedScore.actualDate,
    actualPrice: nestedScore.actualPrice,
    actualLogReturn: nestedScore.actualLogReturn,
    predictedLogReturn: nestedScore.predictedLogReturn,
    absoluteLogError: nestedScore.absLogError ?? nestedScore.absoluteLogError,
    signedLogError: nestedScore.signedLogError,
    squaredLogError: nestedScore.squaredLogError,
    directionCorrect: nestedScore.directionCorrect,
    covered: nestedScore.intervalCovered ?? nestedScore.covered,
    scoredAt: nestedScore.scoredAt,
  } : value;
  const evaluationFields = [
    evaluation.actualDate,
    evaluation.actualPrice,
    evaluation.absoluteLogError,
    evaluation.directionCorrect,
    evaluation.covered,
    evaluation.scoredAt,
  ];
  const hasEvaluation = evaluationFields.some((field) => field !== undefined && field !== null);
  if (!hasEvaluation) return result;

  const actualDate = String(evaluation.actualDate || "").slice(0, 10);
  const actualPrice = finiteNumber(evaluation.actualPrice, { min: Number.MIN_VALUE, max: 1e15 });
  const normalizedBasePrice = finiteNumber(basePrice, { min: Number.MIN_VALUE, max: 1e15 });
  const actualLogReturn = finiteNumber(
    evaluation.actualLogReturn ?? (
      actualPrice && normalizedBasePrice ? Math.log(actualPrice / normalizedBasePrice) : null
    ),
    { min: -100, max: 100 },
  );
  const predictedLogReturn = finiteNumber(
    evaluation.predictedLogReturn ?? (
      normalizedBasePrice ? Math.log(predictedPrice / normalizedBasePrice) : null
    ),
    { min: -100, max: 100 },
  );
  const signedLogError = finiteNumber(
    evaluation.signedLogError ?? (
      actualLogReturn !== null && predictedLogReturn !== null
        ? actualLogReturn - predictedLogReturn
        : null
    ),
    { min: -100, max: 100 },
  );
  const absoluteLogError = finiteNumber(
    evaluation.absoluteLogError ?? (signedLogError === null ? null : Math.abs(signedLogError)),
    { min: 0, max: 100 },
  );
  const squaredLogError = finiteNumber(
    evaluation.squaredLogError ?? (signedLogError === null ? null : signedLogError ** 2),
    { min: 0, max: 10000 },
  );
  const scoredAt = timestamp(evaluation.scoredAt);
  const validEvaluation = isValidIsoDate(actualDate)
    && actualPrice
    && actualLogReturn !== null
    && predictedLogReturn !== null
    && signedLogError !== null
    && absoluteLogError !== null
    && squaredLogError !== null
    && typeof evaluation.directionCorrect === "boolean"
    && typeof evaluation.covered === "boolean"
    && scoredAt;
  if (!validEvaluation) {
    if (strict) throw journalValidationError(`Invalid evaluation values for horizon ${key}`);
    return result;
  }
  return {
    ...result,
    actualDate,
    actualPrice,
    actualLogReturn,
    predictedLogReturn,
    signedLogError,
    absoluteLogError,
    squaredLogError,
    directionCorrect: evaluation.directionCorrect,
    covered: evaluation.covered,
    scoredAt,
  };
}

function normalizeForecastRecord(value, ticker, { strict = false } = {}) {
  const fail = (message) => {
    if (strict) throw journalValidationError(message);
    return null;
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("Invalid forecast record");
  const id = String(value.id || "").trim();
  const recordTicker = String(value.ticker || "").trim().toUpperCase();
  const asOf = String(value.asOf || "").slice(0, 10);
  const basePrice = finiteNumber(value.basePrice, { min: Number.MIN_VALUE, max: 1e15 });
  const modelVersion = String(value.modelVersion || "").trim();
  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt) || createdAt;
  if (!FORECAST_ID_PATTERN.test(id)) return fail("Invalid forecast id");
  if (recordTicker !== ticker) return fail("Forecast ticker does not match the request");
  if (!isValidIsoDate(asOf) || !basePrice) return fail("Invalid forecast base values");
  if (!FORECAST_MODEL_PATTERN.test(modelVersion) || !createdAt || !updatedAt || updatedAt < createdAt) {
    return fail("Invalid forecast metadata");
  }
  if (!value.horizons || typeof value.horizons !== "object" || Array.isArray(value.horizons)) {
    return fail("Forecast horizons are required");
  }
  const horizons = {};
  for (const [key, horizon] of Object.entries(value.horizons)) {
    if (!FORECAST_HORIZON_PATTERN.test(key) || Number(key) > 3650) {
      if (strict) throw journalValidationError(`Invalid forecast horizon key: ${key}`);
      continue;
    }
    const normalized = normalizeForecastHorizon(horizon, key, { strict, basePrice });
    if (normalized?.targetDate < asOf) {
      if (strict) throw journalValidationError(`Forecast target precedes its base date: ${key}`);
      continue;
    }
    if (normalized) horizons[key] = normalized;
  }
  if (!Object.keys(horizons).length) return fail("At least one forecast horizon is required");
  const audit = normalizeForecastAudit(value.audit, asOf);
  return {
    id,
    ticker,
    asOf,
    basePrice,
    modelVersion,
    createdAt,
    updatedAt,
    horizons,
    ...(audit ? { audit } : {}),
  };
}

export function mergeForecastJournalRecords(existing, incoming, ticker, { strictIncoming = false } = {}) {
  const records = new Map();
  const mergeRecord = (previous, record) => {
    if (!previous) return record;
    const horizons = { ...previous.horizons };
    Object.entries(record.horizons).forEach(([key, horizon]) => {
      const previousHorizon = horizons[key];
      if (!previousHorizon) {
        horizons[key] = horizon;
        return;
      }
      const previousScoreTime = timestamp(previousHorizon.scoredAt) || 0;
      const incomingScoreTime = timestamp(horizon.scoredAt) || 0;
      if (incomingScoreTime > previousScoreTime) {
        horizons[key] = {
          ...horizon,
          attribution: horizon.attribution || previousHorizon.attribution,
        };
      } else if (!previousHorizon.attribution && horizon.attribution) {
        horizons[key] = { ...previousHorizon, attribution: horizon.attribution };
      }
    });
    return {
      ...previous,
      updatedAt: Math.max(previous.updatedAt, record.updatedAt),
      horizons,
      audit: previous.audit || record.audit,
    };
  };
  (existing || []).forEach((value) => {
    const record = normalizeForecastRecord(value, ticker);
    if (record) records.set(record.id, mergeRecord(records.get(record.id), record));
  });
  (incoming || []).forEach((value) => {
    const record = normalizeForecastRecord(value, ticker, { strict: strictIncoming });
    if (!record) return;
    records.set(record.id, mergeRecord(records.get(record.id), record));
  });
  return compactForecastJournalRecords([...records.values()]);
}

export function compactForecastJournalRecords(values, maxRecords = FORECAST_JOURNAL_LIMIT) {
  const limit = Math.max(
    0,
    Math.min(FORECAST_JOURNAL_LIMIT, Math.trunc(Number(maxRecords) || FORECAST_JOURNAL_LIMIT)),
  );
  const sorted = [...(Array.isArray(values) ? values : [])].sort((left, right) => (
    right.asOf.localeCompare(left.asOf)
    || right.createdAt - left.createdAt
    || left.id.localeCompare(right.id)
  ));
  if (!limit || sorted.length <= limit) return sorted.slice(0, limit).reverse();

  const denseLimit = Math.min(DENSE_RECORDS, limit);
  const weeklyLimit = Math.min(WEEKLY_RECORDS, Math.max(0, limit - denseLimit));
  const monthlyLimit = Math.max(0, limit - denseLimit - weeklyLimit);
  const selected = new Set(sorted.slice(0, denseLimit).map((record) => record.id));
  const weekBuckets = new Set();
  let cursor = denseLimit;

  for (; cursor < sorted.length && weekBuckets.size < weeklyLimit; cursor += 1) {
    const record = sorted[cursor];
    const date = Date.parse(`${record.asOf}T00:00:00Z`);
    const bucket = Number.isFinite(date) ? Math.floor(date / (7 * DAY_MS)) : record.asOf;
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

  for (const record of sorted) {
    if (selected.size >= limit) break;
    selected.add(record.id);
  }
  return sorted.filter((record) => selected.has(record.id)).slice(0, limit).reverse();
}
