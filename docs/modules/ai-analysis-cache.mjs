import * as snapshotEngine from "../../shared/ai-analysis-snapshots.mjs";
import * as newsEvidenceEngine from "../../shared/ai-news-evidence.mjs";
import {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  COMPANY_ANALYSIS_CACHE_REVISION,
  FINANCIAL_SUMMARY_VERSION,
  inspectCompanyAnalysisQuality,
  mergeCompanyFinancialRecords,
  sanitizeCompanyFinancialRecord,
} from "../../shared/company-analysis-contract.mjs";
import { finiteOrNull } from "../../shared/runtime-foundation.mjs";
import * as cacheLifecycle from "./cache-lifecycle-policy.mjs";

  "use strict";

  const SCHEMA_VERSION = 5;
  const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
  if (!cacheLifecycle?.withCacheMetadata) throw new Error("cache lifecycle policy is required");
  if (typeof finiteOrNull !== "function") throw new Error("runtime value contract is required");

  function sanitizeConsensus(value) {
    if (!value || typeof value !== "object") return null;
    const targetPrice = finiteOrNull(value.targetPrice);
    const institutions = finiteOrNull(value.institutions);
    if (targetPrice === null && institutions === null) return null;
    return {
      ticker: String(value.ticker || "").trim().toUpperCase(),
      opinion: finiteOrNull(value.opinion),
      targetPrice,
      eps: finiteOrNull(value.eps),
      per: finiteOrNull(value.per),
      institutions,
      source: String(value.source || "").slice(0, 80),
      sourceUrl: String(value.sourceUrl || "").slice(0, 300),
      fetchedAt: String(value.fetchedAt || "").slice(0, 40),
    };
  }

  const sanitizeFinancialRecord = sanitizeCompanyFinancialRecord;

  function sanitizeNewsRecords(values, ticker) {
    if (newsEvidenceEngine?.normalizeAnalysisNewsEvidence) {
      return newsEvidenceEngine.normalizeAnalysisNewsEvidence(values, {
        ticker,
        requireTrustedUrl: true,
        maximumRows: 40,
      });
    }
    const target = String(ticker || "").trim().toUpperCase();
    const seen = new Set();
    return (Array.isArray(values) ? values : []).flatMap((value) => {
      const date = String(value?.date || "").slice(0, 10);
      const title = String(value?.title || "").replace(/\s+/g, " ").trim().slice(0, 240);
      const source = String(value?.source || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const url = String(value?.url || "").trim().slice(0, 500);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || !/^https:\/\//i.test(url)) return [];
      const key = `${date}|${title}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ticker: target, date, title, source, url }];
    }).sort((left, right) => right.date.localeCompare(left.date)).slice(0, 40);
  }

  const mergeFinancialRecords = mergeCompanyFinancialRecords;

  function sanitizeSnapshot(value, ticker) {
    if (!value || typeof value !== "object") return null;
    const savedAt = Number(value.savedAt ?? value.saved_at);
    const asOf = snapshotEngine?.koreanDateFromTimestamp?.(savedAt)
      || String(value.asOf || value.as_of || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
    const consensus = sanitizeConsensus(value.consensus);
    const financials = mergeFinancialRecords([], value.financials).slice(-16);
    const news = sanitizeNewsRecords(value.news, ticker).slice(0, 24);
    if (!consensus && !financials.length && !news.length) return null;
    return {
      asOf,
      savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : Date.parse(`${asOf}T00:00:00Z`),
      ticker,
      consensus,
      financials,
      news,
    };
  }

  function mergeSnapshots(existing, incoming, ticker) {
    if (snapshotEngine?.mergePointInTimeAnalysisSnapshots) {
      return snapshotEngine.mergePointInTimeAnalysisSnapshots(existing, incoming, {
        sanitize: (value) => sanitizeSnapshot(value, ticker),
      });
    }
    const merged = new Map();
    [...(existing || []), ...(incoming || [])].forEach((value) => {
      const snapshot = sanitizeSnapshot(value, ticker);
      if (!snapshot) return;
      const key = snapshot.asOf.slice(0, 7);
      const prior = merged.get(key);
      if (!prior || snapshot.savedAt >= prior.savedAt) merged.set(key, snapshot);
    });
    return [...merged.values()]
      .sort((left, right) => left.asOf.localeCompare(right.asOf))
      .slice(-60);
  }

  function selectAnalysisAsOf(record, cutoff) {
    if (snapshotEngine?.selectAnalysisEvidenceAsOf) {
      return snapshotEngine.selectAnalysisEvidenceAsOf(record, cutoff);
    }
    const selected = (Array.isArray(record?.snapshots) ? record.snapshots : [])
      .filter((snapshot) => String(snapshot?.asOf || "").slice(0, 10) <= String(cutoff || ""))
      .at(-1);
    return selected || null;
  }

  function normalizeAnalysisRecord(ticker, payload, existing = null, now = Date.now()) {
    const target = String(ticker || "").trim().toUpperCase();
    if (!TICKER_PATTERN.test(target)) return null;
    const source = payload && typeof payload === "object" ? payload : {};
    const prior = existing && typeof existing === "object" ? existing : {};
    const financialSummaryVersion = Math.max(
      0,
      Number(prior.financialSummaryVersion) || 0,
      Number(source.financialSummaryVersion) || 0,
    );
    const dartEpsHistoryVersion = Math.max(
      0,
      Number(prior.dartEpsHistoryVersion) || 0,
      Number(source.dartEpsHistoryVersion) || 0,
    );
    const dartEpsCompletedYears = [...new Set([
      ...(Array.isArray(prior.dartEpsCompletedYears) ? prior.dartEpsCompletedYears : []),
      ...(Array.isArray(source.dartEpsCompletedYears) ? source.dartEpsCompletedYears : []),
    ].map(Number).filter((year) => Number.isInteger(year) && year >= 2015 && year <= 2100))]
      .sort((left, right) => left - right);
    const dartEpsHistoryStartYear = Math.max(
      0,
      Number(source.dartEpsHistoryStartYear) || 0,
      Number(prior.dartEpsHistoryStartYear) || 0,
    );
    const dartEpsHistoryEndYear = Math.max(
      0,
      Number(source.dartEpsHistoryEndYear) || 0,
      Number(prior.dartEpsHistoryEndYear) || 0,
    );
    const consensus = sanitizeConsensus(source.consensus) || sanitizeConsensus(prior.consensus);
    const financials = mergeFinancialRecords(prior.financials, source.financials);
    const news = Object.prototype.hasOwnProperty.call(source, "news")
      ? sanitizeNewsRecords(source.news, target)
      : sanitizeNewsRecords(prior.news, target);
    const suppliedSavedAt = Number(source.savedAt);
    const priorSavedAt = Number(prior.savedAt);
    const savedAt = Number.isFinite(suppliedSavedAt) && suppliedSavedAt > 0
      ? suppliedSavedAt
      : (Number.isFinite(priorSavedAt) && priorSavedAt > 0 ? priorSavedAt : now);
    const suppliedFinancialSummarySavedAt = Number(source.financialSummarySavedAt);
    const priorFinancialSummarySavedAt = Number(prior.financialSummarySavedAt);
    const financialSummarySavedAt = Number.isFinite(suppliedFinancialSummarySavedAt)
      && suppliedFinancialSummarySavedAt > 0
      ? suppliedFinancialSummarySavedAt
      : (Number.isFinite(priorFinancialSummarySavedAt) && priorFinancialSummarySavedAt > 0
        ? priorFinancialSummarySavedAt : 0);
    const suppliedNewsSavedAt = Number(source.newsSavedAt);
    const priorNewsSavedAt = Number(prior.newsSavedAt);
    const newsSavedAt = Number.isFinite(suppliedNewsSavedAt) && suppliedNewsSavedAt > 0
      ? suppliedNewsSavedAt
      : (Number.isFinite(priorNewsSavedAt) && priorNewsSavedAt > 0 ? priorNewsSavedAt : 0);
    const currentSnapshot = consensus || financials.length || news.length
      ? { savedAt, ticker: target, consensus, financials, news }
      : null;
    const historicalSnapshots = snapshotEngine?.historicalFinancialSnapshotsFromRecord
      ? snapshotEngine.historicalFinancialSnapshotsFromRecord({ financials })
      : [];
    const snapshots = mergeSnapshots(
      prior.snapshots,
      [
        ...(Array.isArray(source.snapshots) ? source.snapshots : []),
        ...historicalSnapshots,
        ...(currentSnapshot ? [currentSnapshot] : []),
      ],
      target,
    );
    if (!consensus && !financials.length && !news.length && !snapshots.length) return null;
    const asOf = snapshots.at(-1)?.asOf
      || snapshotEngine?.koreanDateFromTimestamp?.(savedAt)
      || "";
    const evidence = { consensus, financials, news };
    const fingerprint = snapshotEngine?.analysisEvidenceFingerprint
      ? snapshotEngine.analysisEvidenceFingerprint(evidence)
      : cacheLifecycle.contentFingerprint(evidence);
    return cacheLifecycle.withCacheMetadata({
      schema: SCHEMA_VERSION,
      analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
      cacheRevision: COMPANY_ANALYSIS_CACHE_REVISION,
      ticker: target,
      savedAt,
      lastAccessed: now,
      financialSummarySavedAt,
      newsSavedAt,
      financialSummaryVersion,
      dartEpsHistoryVersion,
      dartEpsCompletedYears,
      dartEpsHistoryStartYear,
      dartEpsHistoryEndYear,
      consensus,
      financials,
      news,
      snapshots,
    }, {
      source: "ai-analysis",
      asOf,
      revision: COMPANY_ANALYSIS_CACHE_REVISION,
      contentFingerprint: fingerprint,
      now,
      savedAt,
      touch: true,
    });
  }

  function isAnalysisFresh(record, maxAgeMs, now = Date.now()) {
    const savedAt = Number(record?.savedAt);
    return record?.schema === SCHEMA_VERSION
      && Number.isFinite(savedAt)
      && savedAt > 0
      && now - savedAt >= 0
      && now - savedAt <= Math.max(0, Number(maxAgeMs) || 0);
  }

  function hasCurrentFinancialSummary(record) {
    return inspectCompanyAnalysisQuality(record).completeFinancialSummary === true;
  }

  function isFinancialSummaryFresh(record, maxAgeMs, now = Date.now()) {
    const savedAt = Number(record?.financialSummarySavedAt);
    return hasCurrentFinancialSummary(record)
      && Number.isFinite(savedAt)
      && savedAt > 0
      && now - savedAt >= 0
      && now - savedAt <= Math.max(0, Number(maxAgeMs) || 0);
  }

  function hasDartEpsHistoryCoverage(record, range, version = 1) {
    const startYear = Math.trunc(Number(range?.startYear));
    const endYear = Math.trunc(Number(range?.endYear));
    if (startYear < 2015 || endYear < startYear
      || Number(record?.dartEpsHistoryVersion) < Number(version)) return false;
    const completed = new Set((Array.isArray(record?.dartEpsCompletedYears)
      ? record.dartEpsCompletedYears : []).map(Number));
    for (let year = startYear; year <= endYear; year += 1) {
      if (!completed.has(year)) return false;
    }
    return true;
  }

  const aiAnalysisCache = Object.freeze({
    SCHEMA_VERSION,
    COMPANY_ANALYSIS_CONTRACT_VERSION,
    COMPANY_ANALYSIS_CACHE_REVISION,
    FINANCIAL_SUMMARY_VERSION,
    hasDartEpsHistoryCoverage,
    hasCurrentFinancialSummary,
    isAnalysisFresh,
    isFinancialSummaryFresh,
    mergeFinancialRecords,
    mergeSnapshots,
    normalizeAnalysisRecord,
    selectAnalysisAsOf,
    sanitizeFinancialRecord,
    sanitizeNewsRecords,
    sanitizeSnapshot,
  });

export {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  COMPANY_ANALYSIS_CACHE_REVISION,
  FINANCIAL_SUMMARY_VERSION,
  SCHEMA_VERSION,
  hasCurrentFinancialSummary,
  hasDartEpsHistoryCoverage,
  isAnalysisFresh,
  isFinancialSummaryFresh,
  mergeFinancialRecords,
  mergeSnapshots,
  normalizeAnalysisRecord,
  sanitizeFinancialRecord,
  sanitizeNewsRecords,
  sanitizeSnapshot,
  selectAnalysisAsOf,
};

export default aiAnalysisCache;
