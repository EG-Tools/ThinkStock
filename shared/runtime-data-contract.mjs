import { finiteOrNull } from "./runtime-foundation.mjs";
import { rebaseSeriesRowsToAvailability } from "./series-timeline-policy.mjs";

/** @typedef {{date?: string} & Record<string, unknown>} RuntimeDataRow */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CREDIT_KEYS = Object.freeze(["customer_deposit", "kospi_credit", "kosdaq_credit"]);
const ADR_KEYS = Object.freeze(["adr_kospi", "adr_kosdaq"]);
const LEADING_DATE_BASIS = "availability";

const finiteNumber = finiteOrNull;

function requireSuccess(payload, label) {
  if (!payload || typeof payload !== "object" || payload.ok !== true) {
    throw new Error(payload?.error || `${label} response is invalid`);
  }
  return payload;
}

/**
 * @param {RuntimeDataRow[]} rows
 * @param {string[]} keys
 * @param {{positiveOnly?: boolean}} [options]
 * @returns {RuntimeDataRow[]}
 */
function normalizeRows(rows, keys, options = {}) {
  const positiveOnly = options.positiveOnly === true;
  const output = [];
  const byDate = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!DATE_PATTERN.test(date)) return;
    const previous = byDate.get(date) || { date };
    const next = { ...previous };
    keys.forEach((key) => {
      const value = finiteNumber(row?.[key]);
      if (value !== null && (!positiveOnly || value > 0)) next[key] = value;
    });
    if (keys.some((key) => finiteNumber(next[key]) !== null)) byDate.set(date, next);
  });
  [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .forEach((row) => output.push(row));
  return output;
}

export function latestSeriesDates(rows, keys) {
  const result = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!DATE_PATTERN.test(date)) return;
    (Array.isArray(keys) ? keys : []).forEach((key) => {
      if (finiteNumber(row?.[key]) !== null && (!result[key] || date > result[key])) result[key] = date;
    });
  });
  return Object.freeze(result);
}

function requireUsableRows(sourceRows, normalizedRows, label, allowEmpty = false) {
  if (normalizedRows.length || (allowEmpty && Array.isArray(sourceRows) && !sourceRows.length)) return;
  throw new Error(`${label} response contains no usable rows`);
}

function requirePlausibleContinuity(rows, key, options = {}) {
  const maxRelativeChange = Number(options.maxRelativeChange) || 0;
  const maxAbsoluteChange = Number(options.maxAbsoluteChange) || 0;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = finiteNumber(rows[index - 1]?.[key]);
    const current = finiteNumber(rows[index]?.[key]);
    if (previous === null || current === null || previous === 0) continue;
    const relativeChange = Math.abs(current / previous - 1);
    const absoluteChange = Math.abs(current - previous);
    if (relativeChange > maxRelativeChange && absoluteChange > maxAbsoluteChange) {
      throw new Error(`${key} response has an implausible jump at ${rows[index].date}`);
    }
  }
}

export function normalizeCreditPayload(payload) {
  const source = requireSuccess(payload, "Credit");
  const rows = normalizeRows(source.rows, CREDIT_KEYS, { positiveOnly: true });
  requireUsableRows(source.rows, rows, "Credit");
  return { ...source, rows, componentLatestDates: latestSeriesDates(rows, CREDIT_KEYS) };
}

export function normalizeAdrPayload(payload) {
  const source = requireSuccess(payload, "ADR");
  const rows = normalizeRows(source.rows, ADR_KEYS, { positiveOnly: true });
  requireUsableRows(source.rows, rows, "ADR");
  return {
    ...source,
    latestDate: [
      DATE_PATTERN.test(String(source.latestDate || "").slice(0, 10))
        ? String(source.latestDate).slice(0, 10)
        : "",
      rows.at(-1)?.date || "",
    ].filter(Boolean).sort().at(-1) || "",
    rows,
    componentLatestDates: latestSeriesDates(rows, ADR_KEYS),
  };
}

export function normalizeFearGreedPayload(payload) {
  if (!payload || typeof payload !== "object" || payload.ok === false) {
    throw new Error(payload?.error || "Fear-greed response is invalid");
  }
  const sourceRows = Array.isArray(payload.rows) && payload.rows.length
    ? payload.rows
    : [{ date: payload.updated, score: payload.score }];
  const rows = normalizeRows(
    sourceRows.map((row) => ({
      date: row?.date || row?.updated,
      fear_greed: row?.fear_greed ?? row?.score,
    })),
    ["fear_greed"],
  ).filter((row) => row.fear_greed >= 0 && row.fear_greed <= 100);
  requireUsableRows(sourceRows, rows, "Fear-greed");
  return {
    ...payload,
    latestDate: rows.at(-1)?.date || "",
    rows,
    componentLatestDates: latestSeriesDates(rows, ["fear_greed"]),
  };
}

export function normalizeMacroPayload(payload) {
  const source = requireSuccess(payload, "Macro");
  let leadingRows = normalizeRows(
    rebaseSeriesRowsToAvailability(source.leadingRows, "leading_cycle", {
      dateBasis: source.leadingDateBasis,
    }),
    ["leading_cycle"],
    { positiveOnly: true },
  );
  const newsRows = normalizeRows(source.newsRows, ["news_sentiment"], { positiveOnly: true });
  const policyRateRows = normalizeRows(source.policyRateRows, ["policy_rate"], { positiveOnly: true });
  const tradeRows = normalizeRows(source.tradeRows, ["export_value", "import_value"], { positiveOnly: true });
  const componentWarnings = [];
  try {
    requirePlausibleContinuity(leadingRows, "leading_cycle", {
      maxRelativeChange: 0.01,
      maxAbsoluteChange: 0.8,
    });
  } catch (error) {
    componentWarnings.push(error.message);
    leadingRows = [];
  }
  if (!leadingRows.length && !newsRows.length && !policyRateRows.length && !tradeRows.length) {
    throw new Error(componentWarnings[0] || "Macro response contains no usable rows");
  }
  return {
    ...source,
    leadingDateBasis: LEADING_DATE_BASIS,
    leadingRows,
    newsRows,
    policyRateRows,
    tradeRows,
    componentWarnings,
    componentLatestDates: Object.freeze({
      ...latestSeriesDates(leadingRows, ["leading_cycle"]),
      ...latestSeriesDates(newsRows, ["news_sentiment"]),
      ...latestSeriesDates(policyRateRows, ["policy_rate"]),
      ...latestSeriesDates(tradeRows, ["export_value", "import_value"]),
    }),
  };
}

export function normalizePricePayload(payload) {
  const source = requireSuccess(payload, "Price");
  const records = normalizeRows(source.records, ["close", "volume"], { positiveOnly: true })
    .filter((row) => finiteNumber(row.close) !== null);
  requireUsableRows(source.records, records, "Price");
  return {
    ...source,
    latestDate: [
      DATE_PATTERN.test(String(source.latestDate || "").slice(0, 10))
        ? String(source.latestDate).slice(0, 10)
        : "",
      records.at(-1)?.date || "",
    ].filter(Boolean).sort().at(-1) || "",
    records,
    componentLatestDates: latestSeriesDates(records, ["close"]),
  };
}

export function normalizePriceBatchPayload(payload) {
  const source = requireSuccess(payload, "Price batch");
  const input = Array.isArray(source.results) ? source.results : [];
  if (!input.length) throw new Error("Price batch response contains no results");
  const results = input.map((result) => {
    const ticker = String(result?.ticker || "").trim().toUpperCase();
    if (!/^\d{6}\.(?:KS|KQ)$/.test(ticker)) {
      return { ok: false, ticker: "", error: "Price batch response contains an invalid ticker" };
    }
    if (result?.ok !== true) {
      return {
        ok: false,
        ticker,
        error: String(result?.error || "Price lookup failed"),
      };
    }
    try {
      return normalizePricePayload({ ...result, ticker });
    } catch (error) {
      return { ok: false, ticker, error: error.message };
    }
  });
  const succeeded = results.filter((result) => result.ok === true).length;
  return {
    ...source,
    requested: results.length,
    succeeded,
    results,
  };
}

export function mergeIndexRecords(...groups) {
  const byKey = new Map();
  groups.flat().forEach((row) => {
    const ticker = String(row?.ticker || "").trim().toUpperCase();
    const date = String(row?.date || "").slice(0, 10);
    const close = finiteNumber(row?.close);
    const volume = finiteNumber(row?.volume);
    if (!["^KS11", "^KQ11"].includes(ticker)
      || !DATE_PATTERN.test(date)
      || close === null
      || close <= 0) return;
    byKey.set(`${ticker}:${date}`, {
      ticker,
      date,
      close,
      ...(volume !== null && volume > 0 ? { volume } : {}),
      ...(row?.source ? { source: String(row.source) } : {}),
    });
  });
  const tickerOrder = { "^KS11": 0, "^KQ11": 1 };
  return [...byKey.values()].sort((left, right) => (
    left.date.localeCompare(right.date)
    || (tickerOrder[left.ticker] ?? 99) - (tickerOrder[right.ticker] ?? 99)
  ));
}

export function normalizeIndexPayload(payload) {
  const source = requireSuccess(payload, "Index");
  const records = mergeIndexRecords(source.records);
  requireUsableRows(source.records, records, "Index");
  return {
    ...source,
    latestDate: String(source.latestDate || records.at(-1)?.date || "").slice(0, 10),
    records,
  };
}

export function normalizeBootstrapPayload(payload) {
  const source = requireSuccess(payload, "Bootstrap");
  let indices;
  try {
    indices = source.indices?.ok === true
      ? normalizeIndexPayload(source.indices)
      : { ok: false, error: String(source.indices?.error || "Index bootstrap failed") };
  } catch (error) {
    indices = { ok: false, records: [], error: error.message };
  }
  const requested = Math.max(0, Number(source.prices?.requested) || 0);
  let prices;
  try {
    prices = requested === 0 && source.prices?.ok === true
      ? { ...source.prices, requested: 0, succeeded: 0, results: [] }
      : (source.prices?.ok === true
        ? normalizePriceBatchPayload(source.prices)
        : { ok: false, requested, succeeded: 0, results: [], error: String(source.prices?.error || "Price bootstrap failed") });
  } catch (error) {
    prices = { ok: false, requested, succeeded: 0, results: [], error: error.message };
  }
  const indicesUsable = indices.ok === true && Array.isArray(indices.records) && indices.records.length > 0;
  const pricesUsable = prices.ok === true && Number(prices.succeeded) > 0;
  if (!indicesUsable && !pricesUsable) {
    throw new Error("Bootstrap response contains no usable source");
  }
  return {
    ...source,
    indices,
    prices,
    partial: !indicesUsable || (requested > 0 && !pricesUsable),
  };
}

export function normalizeEventPayload(payload, label = "Event") {
  const source = requireSuccess(payload, label);
  const input = Array.isArray(source.records) ? source.records : [];
  const records = input.filter((record) => DATE_PATTERN.test(String(record?.date || "").slice(0, 10)));
  requireUsableRows(input, records, label, true);
  return { ...source, records };
}

export function normalizeCrisisSignalPayload(payload) {
  const source = requireSuccess(payload, "Crisis signal");
  const byDate = new Map();
  (Array.isArray(source.records) ? source.records : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const score = finiteNumber(row?.score);
    if (!DATE_PATTERN.test(date) || score === null || score < 0 || score > 100) return;
    const normalized = { date, score: Math.round(score) };
    ["curve", "labor", "credit", "t10y2y", "t10y3m", "t10y1y", "unemployment", "initialClaims4w", "creditSpread", "sahm", "fedFunds", "fedFundsChange6m", "vkospi", "vkospiChange20", "vix", "vixChange20", "krwUsd", "krwUsdChange20"]
      .forEach((key) => {
        const value = finiteNumber(row?.[key]);
        if (value !== null) normalized[key] = value;
      });
    normalized.stage = ["stable", "caution", "warning", "crisis"].includes(row?.stage)
      ? row.stage
      : (score >= 75 ? "crisis" : score >= 50 ? "warning" : score >= 25 ? "caution" : "stable");
    normalized.uninversion = row?.uninversion === true;
    byDate.set(date, normalized);
  });
  const records = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const termSpreadByDate = new Map();
  (Array.isArray(source.termSpreadRows) ? source.termSpreadRows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const t10y1y = finiteNumber(row?.t10y1y);
    if (!DATE_PATTERN.test(date) || t10y1y === null) return;
    termSpreadByDate.set(date, { date, t10y1y });
  });
  const termSpreadRows = [...termSpreadByDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date));
  const creditSpreadByDate = new Map();
  (Array.isArray(source.creditSpreadRows) ? source.creditSpreadRows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const usCreditSpread = finiteNumber(row?.us_credit_spread);
    if (!DATE_PATTERN.test(date) || usCreditSpread === null) return;
    creditSpreadByDate.set(date, { date, us_credit_spread: usCreditSpread });
  });
  const creditSpreadRows = [...creditSpreadByDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date));
  const vkospiByDate = new Map();
  (Array.isArray(source.vkospiRows) ? source.vkospiRows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const vkospi = finiteNumber(row?.vkospi);
    if (!DATE_PATTERN.test(date) || vkospi === null || vkospi <= 0) return;
    const normalized = { date, vkospi };
    ["vkospiOpen", "vkospiHigh", "vkospiLow", "vkospiChange20"].forEach((key) => {
      const value = finiteNumber(row?.[key]);
      if (value !== null) normalized[key] = value;
    });
    vkospiByDate.set(date, normalized);
  });
  const vkospiRows = [...vkospiByDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date));
  const vixByDate = new Map();
  (Array.isArray(source.vixRows) ? source.vixRows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const vix = finiteNumber(row?.vix);
    if (!DATE_PATTERN.test(date) || vix === null || vix <= 0) return;
    const normalized = { date, vix };
    const change20 = finiteNumber(row?.vixChange20);
    if (change20 !== null) normalized.vixChange20 = change20;
    vixByDate.set(date, normalized);
  });
  const vixRows = [...vixByDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!records.length && !termSpreadRows.length && !creditSpreadRows.length
    && !vkospiRows.length && !vixRows.length) {
    throw new Error("Crisis signal response contains no usable rows");
  }
  const componentWarnings = [];
  if (Array.isArray(source.records) && source.records.length && !records.length) {
    componentWarnings.push("Crisis signal records contain no usable rows");
  }
  return {
    ...source,
    latestDate: [
      DATE_PATTERN.test(String(source.latestDate || "").slice(0, 10))
        ? String(source.latestDate).slice(0, 10)
        : "",
      records.at(-1)?.date || "",
      termSpreadRows.at(-1)?.date || "",
      creditSpreadRows.at(-1)?.date || "",
      vkospiRows.at(-1)?.date || "",
      vixRows.at(-1)?.date || "",
    ].filter(Boolean).sort().at(-1) || "",
    records,
    termSpreadRows,
    creditSpreadRows,
    vkospiRows,
    vixRows,
    componentWarnings,
    componentLatestDates: Object.freeze({
      ...latestSeriesDates(records, ["score"]),
      ...latestSeriesDates(termSpreadRows, ["t10y1y"]),
      ...latestSeriesDates(creditSpreadRows, ["us_credit_spread"]),
      ...latestSeriesDates(vkospiRows, ["vkospi"]),
      ...latestSeriesDates(vixRows, ["vix"]),
    }),
  };
}

export function normalizeRuntimePayload(kind, payload) {
  if (kind === "adr") return normalizeAdrPayload(payload);
  if (kind === "fear-greed") return normalizeFearGreedPayload(payload);
  if (kind === "credit") return normalizeCreditPayload(payload);
  if (kind === "macro") return normalizeMacroPayload(payload);
  if (kind === "price") return normalizePricePayload(payload);
  if (kind === "price-batch") return normalizePriceBatchPayload(payload);
  if (kind === "disclosure") return normalizeEventPayload(payload, "Disclosure");
  if (kind === "insider") return normalizeEventPayload(payload, "Insider trade");
  if (kind === "crisis") return normalizeCrisisSignalPayload(payload);
  return requireSuccess(payload, "Runtime data");
}

const api = Object.freeze({
  mergeIndexRecords,
  latestSeriesDates,
  normalizeAdrPayload,
  normalizeFearGreedPayload,
  normalizeCreditPayload,
  normalizeMacroPayload,
  normalizeBootstrapPayload,
  normalizeIndexPayload,
  normalizePricePayload,
  normalizePriceBatchPayload,
  normalizeEventPayload,
  normalizeCrisisSignalPayload,
  normalizeRuntimePayload,
});
