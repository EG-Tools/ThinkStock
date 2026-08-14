const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const RECENT_ANALYSIS_WINDOW_DAYS = 120;
export const RECENT_ANALYSIS_SNAPSHOT_LIMIT = 45;
export const MONTHLY_ANALYSIS_SNAPSHOT_LIMIT = 60;

export function analysisDateText(value) {
  const date = String(value || "").slice(0, 10);
  return DATE_PATTERN.test(date) ? date : "";
}

export function koreanDateFromTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function snapshotTimestamp(value) {
  const timestamp = Number(value?.savedAt ?? value?.saved_at);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function snapshotDate(value) {
  const savedAt = snapshotTimestamp(value);
  return koreanDateFromTimestamp(savedAt)
    || analysisDateText(value?.asOf ?? value?.as_of);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function canonicalConsensus(value) {
  if (!value || typeof value !== "object") return null;
  return {
    opinion: finiteOrNull(value.opinion),
    targetPrice: finiteOrNull(value.targetPrice),
    eps: finiteOrNull(value.eps),
    per: finiteOrNull(value.per),
    institutions: finiteOrNull(value.institutions),
  };
}

function canonicalFinancials(values) {
  return (Array.isArray(values) ? values : []).map((row) => ({
    period: String(row?.period || "").slice(0, 7),
    frequency: String(row?.frequency || ""),
    estimate: row?.estimate === true,
    revenue: finiteOrNull(row?.revenue),
    operatingProfit: finiteOrNull(row?.operatingProfit),
    netIncome: finiteOrNull(row?.netIncome),
    eps: finiteOrNull(row?.eps),
    operatingProfitConsensus: finiteOrNull(row?.operatingProfitConsensus),
    netIncomeConsensus: finiteOrNull(row?.netIncomeConsensus),
    operatingProfitSurprise: finiteOrNull(row?.operatingProfitSurprise),
    netIncomeSurprise: finiteOrNull(row?.netIncomeSurprise),
    operatingProfitYoy: finiteOrNull(row?.operatingProfitYoy),
    netIncomeYoy: finiteOrNull(row?.netIncomeYoy),
    reportDate: analysisDateText(row?.reportDate ?? row?.report_date),
  })).sort((left, right) => (
    left.period.localeCompare(right.period) || left.frequency.localeCompare(right.frequency)
  ));
}

function canonicalNews(values) {
  return (Array.isArray(values) ? values : []).map((row) => ({
    date: analysisDateText(row?.date),
    title: String(row?.title || "").replace(/\s+/g, " ").trim(),
    source: String(row?.source || "").replace(/\s+/g, " ").trim(),
    url: String(row?.url || "").trim(),
  })).filter((row) => row.date && row.title)
    .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}

export function analysisEvidenceFingerprint(snapshot) {
  return fnv1a(JSON.stringify([
    canonicalConsensus(snapshot?.consensus),
    canonicalFinancials(snapshot?.financials),
    canonicalNews(snapshot?.news),
  ]));
}

export function analysisFeatureManifest(snapshot) {
  const financials = canonicalFinancials(snapshot?.financials);
  const news = canonicalNews(snapshot?.news);
  const consensus = canonicalConsensus(snapshot?.consensus);
  const latestFinancialDate = financials
    .map((row) => row.reportDate)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  const latestNewsDate = news.map((row) => row.date).sort().at(-1) || "";
  return Object.freeze({
    fingerprint: analysisEvidenceFingerprint(snapshot),
    families: Object.freeze({
      consensus: Boolean(consensus),
      financials: financials.length,
      news: news.length,
    }),
    sourceDates: Object.freeze({
      consensus: analysisDateText(snapshot?.consensus?.asOfDate)
        || analysisDateText(snapshot?.consensus?.fetchedAt)
        || snapshotDate(snapshot),
      financials: latestFinancialDate,
      news: latestNewsDate,
    }),
  });
}

function contentFingerprint(snapshot) {
  return analysisEvidenceFingerprint(snapshot);
}

function elapsedDays(left, right) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Infinity;
  return Math.floor((rightTime - leftTime) / 86400000);
}

export function mergePointInTimeAnalysisSnapshots(existing, incoming, options = {}) {
  const sanitize = typeof options.sanitize === "function" ? options.sanitize : (value) => value;
  const recentWindowDays = Math.max(1, Number(options.recentWindowDays)
    || RECENT_ANALYSIS_WINDOW_DAYS);
  const recentLimit = Math.max(1, Number(options.recentLimit)
    || RECENT_ANALYSIS_SNAPSHOT_LIMIT);
  const monthlyLimit = Math.max(1, Number(options.monthlyLimit)
    || MONTHLY_ANALYSIS_SNAPSHOT_LIMIT);
  const byDay = new Map();

  [...(existing || []), ...(incoming || [])].forEach((value) => {
    const sanitized = sanitize(value);
    if (!sanitized || typeof sanitized !== "object") return;
    const asOf = snapshotDate(sanitized);
    if (!asOf) return;
    const savedAt = snapshotTimestamp(sanitized)
      || Date.parse(`${asOf}T00:00:00Z`);
    const snapshot = { ...sanitized, asOf, savedAt };
    const featureManifest = analysisFeatureManifest(snapshot);
    snapshot.evidenceFingerprint = featureManifest.fingerprint;
    snapshot.featureManifest = featureManifest;
    const prior = byDay.get(asOf);
    if (!prior || savedAt >= snapshotTimestamp(prior)) byDay.set(asOf, snapshot);
  });

  const ordered = [...byDay.values()]
    .sort((left, right) => left.asOf.localeCompare(right.asOf) || left.savedAt - right.savedAt);
  const changed = [];
  let previousFingerprint = "";
  ordered.forEach((snapshot) => {
    const fingerprint = contentFingerprint(snapshot);
    if (fingerprint === previousFingerprint) return;
    previousFingerprint = fingerprint;
    changed.push(snapshot);
  });
  const latestDate = changed.at(-1)?.asOf || "";
  const recent = changed
    .filter((snapshot) => elapsedDays(snapshot.asOf, latestDate) <= recentWindowDays)
    .slice(-recentLimit);
  const recentDates = new Set(recent.map((snapshot) => snapshot.asOf));
  const monthly = new Map();
  changed.forEach((snapshot) => {
    if (recentDates.has(snapshot.asOf)) return;
    const month = snapshot.asOf.slice(0, 7);
    const prior = monthly.get(month);
    if (!prior || snapshot.savedAt >= prior.savedAt) monthly.set(month, snapshot);
  });

  return [...monthly.values()].slice(-monthlyLimit)
    .concat(recent)
    .sort((left, right) => left.asOf.localeCompare(right.asOf) || left.savedAt - right.savedAt);
}

export function selectAnalysisSnapshotAsOf(snapshots, cutoff) {
  const asOf = analysisDateText(cutoff);
  if (!asOf) return null;
  return (Array.isArray(snapshots) ? snapshots : []).reduce((selected, value) => {
    const date = snapshotDate(value);
    if (!date || date > asOf) return selected;
    if (!selected || date > selected.asOf
      || (date === selected.asOf && snapshotTimestamp(value) >= selected.savedAt)) {
      return { ...value, asOf: date, savedAt: snapshotTimestamp(value) };
    }
    return selected;
  }, null);
}

export function analysisSnapshotFromRecord(record) {
  const savedAt = snapshotTimestamp(record);
  const asOf = snapshotDate(record);
  if (!savedAt || !asOf) return null;
  const consensus = record?.consensus || null;
  const financials = Array.isArray(record?.financials) ? record.financials : [];
  const news = Array.isArray(record?.news) ? record.news : [];
  if (!consensus && !financials.length && !news.length) return null;
  const snapshot = { asOf, savedAt, consensus, financials, news };
  const featureManifest = analysisFeatureManifest(snapshot);
  return {
    ...snapshot,
    evidenceFingerprint: featureManifest.fingerprint,
    featureManifest,
  };
}

export function selectAnalysisEvidenceAsOf(record, cutoff) {
  const asOf = analysisDateText(cutoff);
  if (!asOf || !record || typeof record !== "object") return null;
  const current = analysisSnapshotFromRecord(record);
  const snapshots = mergePointInTimeAnalysisSnapshots(
    record.snapshots,
    current ? [current] : [],
  );
  const selected = selectAnalysisSnapshotAsOf(snapshots, asOf);
  if (!selected) return null;
  const consensus = selected.consensus && typeof selected.consensus === "object"
    ? { ...selected.consensus, asOfDate: selected.asOf }
    : null;
  const financials = (Array.isArray(selected.financials) ? selected.financials : [])
    .filter((row) => {
      const reportDate = analysisDateText(row?.reportDate ?? row?.report_date);
      return !reportDate || reportDate <= asOf;
    })
    .map((row) => ({
      ...row,
      asOfDate: analysisDateText(row?.reportDate ?? row?.report_date) || selected.asOf,
    }));
  const news = (Array.isArray(selected.news) ? selected.news : [])
    .filter((row) => {
      const date = analysisDateText(row?.date);
      return date && date <= asOf;
    });
  return Object.freeze({
    asOf: selected.asOf,
    savedAt: selected.savedAt,
    consensus,
    financials,
    news,
    evidenceFingerprint: selected.evidenceFingerprint || analysisEvidenceFingerprint(selected),
    featureManifest: selected.featureManifest || analysisFeatureManifest(selected),
  });
}

const browserApi = Object.freeze({
  MONTHLY_ANALYSIS_SNAPSHOT_LIMIT,
  RECENT_ANALYSIS_SNAPSHOT_LIMIT,
  RECENT_ANALYSIS_WINDOW_DAYS,
  analysisEvidenceFingerprint,
  analysisFeatureManifest,
  analysisDateText,
  analysisSnapshotFromRecord,
  koreanDateFromTimestamp,
  mergePointInTimeAnalysisSnapshots,
  selectAnalysisEvidenceAsOf,
  selectAnalysisSnapshotAsOf,
});

if (typeof globalThis !== "undefined") {
  globalThis.ThinkStockAiAnalysisSnapshots = browserApi;
}
