(function initThinkStockAiAnalysisCache(globalScope) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

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
    ].some(Number.isFinite)
      ? record
      : null;
  }

  function mergeFinancialRecords(existing, incoming) {
    const merged = new Map();
    [...(existing || []), ...(incoming || [])].forEach((value) => {
      const record = sanitizeFinancialRecord(value);
      if (!record) return;
      merged.set(`${record.frequency}:${record.period}`, record);
    });
    return [...merged.values()].sort((left, right) => (
      left.period.localeCompare(right.period) || left.frequency.localeCompare(right.frequency)
    ));
  }

  function normalizeAnalysisRecord(ticker, payload, existing = null, now = Date.now()) {
    const target = String(ticker || "").trim().toUpperCase();
    if (!TICKER_PATTERN.test(target)) return null;
    const source = payload && typeof payload === "object" ? payload : {};
    const prior = existing && typeof existing === "object" ? existing : {};
    const consensus = sanitizeConsensus(source.consensus) || sanitizeConsensus(prior.consensus);
    const financials = mergeFinancialRecords(prior.financials, source.financials);
    if (!consensus && !financials.length) return null;
    const suppliedSavedAt = Number(source.savedAt);
    const priorSavedAt = Number(prior.savedAt);
    return {
      schema: SCHEMA_VERSION,
      ticker: target,
      savedAt: Number.isFinite(suppliedSavedAt) && suppliedSavedAt > 0
        ? suppliedSavedAt
        : (Number.isFinite(priorSavedAt) && priorSavedAt > 0 ? priorSavedAt : now),
      lastAccessed: now,
      consensus,
      financials,
    };
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
    normalizeAnalysisRecord,
    sanitizeFinancialRecord,
  });
}(typeof self !== "undefined" ? self : globalThis));
