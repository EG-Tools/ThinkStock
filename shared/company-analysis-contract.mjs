import { finiteOrNull } from "./runtime-foundation.mjs";

export const COMPANY_ANALYSIS_CONTRACT_VERSION = 1;
export const COMPANY_ANALYSIS_CACHE_SCHEMA = 5;
export const FINANCIAL_SUMMARY_VERSION = 3;
export const COMPANY_ANALYSIS_CACHE_REVISION = `analysis-${COMPANY_ANALYSIS_CONTRACT_VERSION}-summary-${FINANCIAL_SUMMARY_VERSION}`;

const TICKER_PATTERN = /^\d{6}\.(?:KS|KQ)$/;
const PERIOD_PATTERN = /^\d{4}-\d{2}$/;
const FINANCIAL_FIELDS = Object.freeze([
  "revenue",
  "operatingProfit",
  "netIncome",
  "eps",
  "operatingProfitConsensus",
  "netIncomeConsensus",
  "operatingProfitSurprise",
  "netIncomeSurprise",
  "operatingProfitYoy",
  "netIncomeYoy",
]);

function normalizedTicker(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : "";
}

function normalizedDate(value) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

export function sanitizeCompanyFinancialRecord(value, fallbackTicker = "") {
  const ticker = normalizedTicker(value?.ticker || fallbackTicker);
  const period = String(value?.period || "").slice(0, 7);
  const frequency = ["annual", "quarter"].includes(value?.frequency) ? value.frequency : "";
  if (!ticker || !PERIOD_PATTERN.test(period) || !frequency) return null;
  const record = {
    ticker,
    period,
    frequency,
    estimate: value?.estimate === true,
    source: String(value?.source || "").trim().slice(0, 40),
    epsDerived: value?.epsDerived === true,
    reportDate: normalizedDate(value?.reportDate),
  };
  FINANCIAL_FIELDS.forEach((key) => {
    record[key] = finiteOrNull(value?.[key]);
  });
  return FINANCIAL_FIELDS.some((key) => record[key] !== null) ? record : null;
}

export function mergeCompanyFinancialRecords(existing, incoming, options = {}) {
  const fallbackTicker = normalizedTicker(options.ticker);
  const merged = new Map();
  [...(existing || []), ...(incoming || [])].forEach((value) => {
    const record = sanitizeCompanyFinancialRecord(value, fallbackTicker);
    if (!record) return;
    const key = `${record.frequency}:${record.period}`;
    const previous = merged.get(key) || {};
    const preferFinite = (nextValue, previousValue) => (
      Number.isFinite(nextValue) ? nextValue : (Number.isFinite(previousValue) ? previousValue : null)
    );
    const incomingDartEps = record.source === "DART"
      && record.estimate === false
      && Number.isFinite(record.eps);
    const previousDartEps = previous.source === "DART"
      && previous.estimate === false
      && Number.isFinite(previous.eps);
    const useIncomingEps = Number.isFinite(record.eps) && (incomingDartEps || !previousDartEps);
    const next = {
      ...record,
      estimate: value?.estimate === true
        ? previous.estimate !== false
        : (value?.estimate === false ? false : previous.estimate === true),
      source: useIncomingEps ? record.source : (previous.source || record.source || ""),
      epsDerived: useIncomingEps ? record.epsDerived : previous.epsDerived === true,
      reportDate: record.reportDate || previous.reportDate || "",
    };
    FINANCIAL_FIELDS.forEach((field) => {
      next[field] = field === "eps"
        ? (useIncomingEps ? record.eps : preferFinite(previous.eps, record.eps))
        : preferFinite(record[field], previous[field]);
    });
    merged.set(key, next);
  });
  return [...merged.values()].sort((left, right) => (
    left.period.localeCompare(right.period) || left.frequency.localeCompare(right.frequency)
  ));
}

function latestPeriod(records, predicate) {
  return records.filter(predicate).map((record) => record.period).sort().at(-1) || "";
}

export function inspectCompanyAnalysisQuality(payload, options = {}) {
  const ticker = normalizedTicker(payload?.ticker || options.ticker);
  const financials = mergeCompanyFinancialRecords([], payload?.financials, { ticker });
  const annualRows = financials.filter((record) => record.frequency === "annual");
  const quarterRows = financials.filter((record) => record.frequency === "quarter");
  const epsRows = financials.filter((record) => Number.isFinite(record.eps));
  const actualEpsRows = epsRows.filter((record) => record.estimate !== true);
  const estimateEpsRows = epsRows.filter((record) => record.estimate === true);
  const financialSummaryVersion = Math.max(0, Number(payload?.financialSummaryVersion) || 0);
  const issues = [];
  if (!ticker) issues.push("invalid-ticker");
  if (!financials.length) issues.push("empty-financials");
  if (!annualRows.length) issues.push("missing-annual-summary");
  if (!quarterRows.length) issues.push("missing-quarter-summary");
  if (!epsRows.length) issues.push("missing-eps");
  if (financialSummaryVersion < FINANCIAL_SUMMARY_VERSION) issues.push("stale-summary-contract");
  const completeFinancialSummary = Boolean(
    ticker
    && annualRows.length
    && quarterRows.length
    && epsRows.length
    && financialSummaryVersion >= FINANCIAL_SUMMARY_VERSION
  );
  return Object.freeze({
    contractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
    completeFinancialSummary,
    usable: Boolean(payload?.consensus || financials.length || payload?.news?.length),
    issues: Object.freeze(issues),
    counts: Object.freeze({
      financials: financials.length,
      annual: annualRows.length,
      quarter: quarterRows.length,
      eps: epsRows.length,
      actualEps: actualEpsRows.length,
      estimateEps: estimateEpsRows.length,
      news: Array.isArray(payload?.news) ? payload.news.length : 0,
    }),
    latestActualPeriod: latestPeriod(financials, (record) => record.estimate !== true),
    latestEstimatePeriod: latestPeriod(financials, (record) => record.estimate === true),
  });
}

function normalizedConsensus(value) {
  if (!value || typeof value !== "object") return null;
  const output = {};
  ["opinion", "targetPrice", "eps", "per", "institutions"].forEach((key) => {
    output[key] = finiteOrNull(value[key]);
  });
  return Object.values(output).some((entry) => entry !== null) ? output : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function compactFingerprint(value) {
  const text = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function companyAnalysisParitySnapshot(payload, options = {}) {
  const ticker = normalizedTicker(payload?.ticker || options.ticker);
  const annualLimit = Math.max(0, Number(options.annualLimit) || 0);
  const quarterLimit = Math.max(0, Number(options.quarterLimit) || 0);
  const allFinancials = mergeCompanyFinancialRecords([], payload?.financials, { ticker });
  const includedKeys = new Set([
    ...allFinancials.filter((record) => record.frequency === "annual")
      .slice(annualLimit ? -annualLimit : 0)
      .map((record) => `${record.frequency}:${record.period}`),
    ...allFinancials.filter((record) => record.frequency === "quarter")
      .slice(quarterLimit ? -quarterLimit : 0)
      .map((record) => `${record.frequency}:${record.period}`),
  ]);
  const financials = allFinancials
    .filter((record) => (!annualLimit && !quarterLimit)
      || includedKeys.has(`${record.frequency}:${record.period}`))
    .map((record) => ({
    ticker: record.ticker,
    period: record.period,
    frequency: record.frequency,
    estimate: record.estimate,
    source: record.source,
    epsDerived: record.epsDerived,
    reportDate: record.reportDate,
    ...Object.fromEntries(FINANCIAL_FIELDS.map((key) => [key, record[key]])),
    }));
  const snapshot = {
    contractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
    ticker,
    financialSummaryVersion: Math.max(0, Number(payload?.financialSummaryVersion) || 0),
    consensus: normalizedConsensus(payload?.consensus),
    financials,
  };
  return Object.freeze({ ...snapshot, fingerprint: compactFingerprint(snapshot) });
}

export function compareCompanyAnalysisPayloads(left, right, options = {}) {
  const leftSnapshot = companyAnalysisParitySnapshot(left, options);
  const rightSnapshot = companyAnalysisParitySnapshot(right, options);
  const differences = [];
  if (leftSnapshot.ticker !== rightSnapshot.ticker) differences.push("ticker");
  if (leftSnapshot.financialSummaryVersion !== rightSnapshot.financialSummaryVersion) {
    differences.push("financial-summary-version");
  }
  if (JSON.stringify(leftSnapshot.consensus) !== JSON.stringify(rightSnapshot.consensus)) {
    differences.push("consensus");
  }
  if (JSON.stringify(leftSnapshot.financials) !== JSON.stringify(rightSnapshot.financials)) {
    differences.push("financials");
  }
  return Object.freeze({
    equal: differences.length === 0,
    differences: Object.freeze(differences),
    left: leftSnapshot,
    right: rightSnapshot,
  });
}

export default Object.freeze({
  COMPANY_ANALYSIS_CACHE_SCHEMA,
  COMPANY_ANALYSIS_CACHE_REVISION,
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
  companyAnalysisParitySnapshot,
  compareCompanyAnalysisPayloads,
  inspectCompanyAnalysisQuality,
  mergeCompanyFinancialRecords,
  sanitizeCompanyFinancialRecord,
});
