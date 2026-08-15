(function initThinkStockAiAnalysisCache(globalScope) {
  "use strict";

  const SCHEMA_VERSION = 4;
  const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const snapshotEngine = globalScope.ThinkStockAiAnalysisSnapshots || null;
  const newsEvidenceEngine = globalScope.ThinkStockAiNewsEvidence || null;
  const cacheLifecycle = globalScope.ThinkStockCacheLifecyclePolicy;
  const finiteOrNull = globalScope.ThinkStockRuntimeFoundation?.values?.finiteOrNull;
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

  function sanitizeFinancialRecord(value) {
    const ticker = String(value?.ticker || "").trim().toUpperCase();
    const period = String(value?.period || "").slice(0, 7);
    const frequency = ["annual", "quarter"].includes(value?.frequency) ? value.frequency : "";
    if (!TICKER_PATTERN.test(ticker) || !/^\d{4}-\d{2}$/.test(period) || !frequency) return null;
    const record = {
      ticker,
      period,
      frequency,
      estimate: value?.estimate === true,
      revenue: finiteOrNull(value?.revenue),
      operatingProfit: finiteOrNull(value?.operatingProfit),
      netIncome: finiteOrNull(value?.netIncome),
      eps: finiteOrNull(value?.eps),
      operatingProfitConsensus: finiteOrNull(value?.operatingProfitConsensus),
      netIncomeConsensus: finiteOrNull(value?.netIncomeConsensus),
      operatingProfitSurprise: finiteOrNull(value?.operatingProfitSurprise),
      netIncomeSurprise: finiteOrNull(value?.netIncomeSurprise),
      operatingProfitYoy: finiteOrNull(value?.operatingProfitYoy),
      netIncomeYoy: finiteOrNull(value?.netIncomeYoy),
      reportDate: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.reportDate || ""))
        ? String(value.reportDate)
        : "",
    };
    return [
      record.revenue,
      record.operatingProfit,
      record.netIncome,
      record.eps,
      record.operatingProfitConsensus,
      record.netIncomeConsensus,
      record.operatingProfitSurprise,
      record.netIncomeSurprise,
      record.operatingProfitYoy,
      record.netIncomeYoy,
    ].some(Number.isFinite)
      ? record
      : null;
  }

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

  function mergeFinancialRecords(existing, incoming) {
    const merged = new Map();
    [...(existing || []), ...(incoming || [])].forEach((value) => {
      const record = sanitizeFinancialRecord(value);
      if (!record) return;
      const key = `${record.frequency}:${record.period}`;
      const previous = merged.get(key) || {};
      const preferFinite = (nextValue, previousValue) => (
        Number.isFinite(nextValue) ? nextValue : (Number.isFinite(previousValue) ? previousValue : null)
      );
      merged.set(key, {
        ...record,
        estimate: value?.estimate === true
          ? previous.estimate !== false
          : (value?.estimate === false ? false : previous.estimate === true),
        revenue: preferFinite(record.revenue, previous.revenue),
        operatingProfit: preferFinite(record.operatingProfit, previous.operatingProfit),
        netIncome: preferFinite(record.netIncome, previous.netIncome),
        eps: preferFinite(record.eps, previous.eps),
        operatingProfitConsensus: preferFinite(
          record.operatingProfitConsensus,
          previous.operatingProfitConsensus,
        ),
        netIncomeConsensus: preferFinite(record.netIncomeConsensus, previous.netIncomeConsensus),
        operatingProfitSurprise: preferFinite(
          record.operatingProfitSurprise,
          previous.operatingProfitSurprise,
        ),
        netIncomeSurprise: preferFinite(record.netIncomeSurprise, previous.netIncomeSurprise),
        operatingProfitYoy: preferFinite(record.operatingProfitYoy, previous.operatingProfitYoy),
        netIncomeYoy: preferFinite(record.netIncomeYoy, previous.netIncomeYoy),
        reportDate: record.reportDate || previous.reportDate || "",
      });
    });
    return [...merged.values()].sort((left, right) => (
      left.period.localeCompare(right.period) || left.frequency.localeCompare(right.frequency)
    ));
  }

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
      ticker: target,
      savedAt,
      lastAccessed: now,
      consensus,
      financials,
      news,
      snapshots,
    }, {
      source: "ai-analysis",
      asOf,
      revision: String(SCHEMA_VERSION),
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

  globalScope.ThinkStockAiAnalysisCache = Object.freeze({
    SCHEMA_VERSION,
    isAnalysisFresh,
    mergeFinancialRecords,
    mergeSnapshots,
    normalizeAnalysisRecord,
    selectAnalysisAsOf,
    sanitizeFinancialRecord,
    sanitizeNewsRecords,
    sanitizeSnapshot,
  });
}(typeof self !== "undefined" ? self : globalThis));
