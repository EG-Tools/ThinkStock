const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CREDIT_KEYS = Object.freeze(["customer_deposit", "kospi_credit", "kosdaq_credit"]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireSuccess(payload, label) {
  if (!payload || typeof payload !== "object" || payload.ok !== true) {
    throw new Error(payload?.error || `${label} response is invalid`);
  }
  return payload;
}

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
  return { ...source, rows };
}

export function normalizeMacroPayload(payload) {
  const source = requireSuccess(payload, "Macro");
  const leadingRows = normalizeRows(source.leadingRows, ["leading_cycle"], { positiveOnly: true });
  const newsRows = normalizeRows(source.newsRows, ["news_sentiment"], { positiveOnly: true });
  const policyRateRows = normalizeRows(source.policyRateRows, ["policy_rate"], { positiveOnly: true });
  const tradeRows = normalizeRows(source.tradeRows, ["export_value", "import_value"], { positiveOnly: true });
  if (!leadingRows.length && !newsRows.length && !policyRateRows.length && !tradeRows.length) {
    throw new Error("Macro response contains no usable rows");
  }
  requirePlausibleContinuity(leadingRows, "leading_cycle", {
    maxRelativeChange: 0.01,
    maxAbsoluteChange: 0.8,
  });
  return { ...source, leadingRows, newsRows, policyRateRows, tradeRows };
}

export function normalizePricePayload(payload) {
  const source = requireSuccess(payload, "Price");
  const records = normalizeRows(source.records, ["close"], { positiveOnly: true });
  requireUsableRows(source.records, records, "Price");
  return {
    ...source,
    latestDate: String(source.latestDate || records.at(-1)?.date || "").slice(0, 10),
    records,
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
    ["curve", "labor", "credit", "t10y2y", "t10y3m", "unemployment", "initialClaims4w", "creditSpread", "sahm", "fedFunds", "fedFundsChange6m"]
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
  requireUsableRows(source.records, records, "Crisis signal");
  return {
    ...source,
    latestDate: String(source.latestDate || records.at(-1)?.date || "").slice(0, 10),
    records,
  };
}

export function normalizeRuntimePayload(kind, payload) {
  if (kind === "credit") return normalizeCreditPayload(payload);
  if (kind === "macro") return normalizeMacroPayload(payload);
  if (kind === "price") return normalizePricePayload(payload);
  if (kind === "disclosure") return normalizeEventPayload(payload, "Disclosure");
  if (kind === "insider") return normalizeEventPayload(payload, "Insider trade");
  if (kind === "crisis") return normalizeCrisisSignalPayload(payload);
  return requireSuccess(payload, "Runtime data");
}

const api = Object.freeze({
  normalizeCreditPayload,
  normalizeMacroPayload,
  normalizePricePayload,
  normalizeEventPayload,
  normalizeCrisisSignalPayload,
  normalizeRuntimePayload,
});

if (typeof globalThis !== "undefined") globalThis.ThinkStockRuntimeDataContract = api;
