const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STRATEGY_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export const RESEARCH_SUMMARY_SCHEMA = 2;
export const RESEARCH_SUMMARY_HISTORY_QUALITY_VERSION = 2;
export const RESEARCH_SUMMARY_BODY_LIMIT = 1024 * 1024;
export const RESEARCH_SUMMARY_DEFAULT_UNIVERSE_SIZE = 400;

function finite(value, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function text(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function date(value) {
  const normalized = String(value || "").slice(0, 10);
  return DATE_PATTERN.test(normalized) ? normalized : "";
}

export function normalizeResearchMinimum(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(1, Math.min(10, number)) : 5;
}

export function normalizeResearchStrategy(value) {
  const strategy = String(value || "").trim();
  return STRATEGY_PATTERN.test(strategy) ? strategy : "";
}

export function normalizeResearchUniverseSize(value) {
  if (value == null || String(value).trim() === "") return RESEARCH_SUMMARY_DEFAULT_UNIVERSE_SIZE;
  const number = Number(value);
  if (!Number.isFinite(number)) return RESEARCH_SUMMARY_DEFAULT_UNIVERSE_SIZE;
  return Math.max(100, Math.min(1000, Math.round(number / 100) * 100));
}

export function researchSummaryCacheKey(strategy, minimum, universeSize = RESEARCH_SUMMARY_DEFAULT_UNIVERSE_SIZE) {
  const normalizedStrategy = normalizeResearchStrategy(strategy);
  if (!normalizedStrategy) return "";
  return `research-summary:${RESEARCH_SUMMARY_SCHEMA}:${normalizedStrategy}:${normalizeResearchMinimum(minimum)}:${normalizeResearchUniverseSize(universeSize)}`;
}

export function sanitizeResearchCandidate(value) {
  const ticker = String(value?.ticker || "").trim().toUpperCase();
  const market = String(value?.market || "").trim().toUpperCase();
  const buyCount = Math.round(finite(value?.buyCount, 0, 100) ?? 0);
  const sellCount = Math.round(finite(value?.sellCount, 0, 100) ?? 0);
  if (!TICKER_PATTERN.test(ticker)
    || !["KOSPI", "KOSDAQ"].includes(market)
    || (buyCount < 1 && sellCount < 1)) return null;
  const candidate = {
    ticker,
    code: ticker.slice(0, 6),
    name: text(value?.name || ticker, 80),
    market,
    marketRank: finite(value?.marketRank, 1, 500),
    marketCap: finite(value?.marketCap, 0),
    signalMode: text(value?.signalMode, 8),
    status: text(value?.status, 40),
    signalCount: Math.round(finite(value?.signalCount, 0, 200) ?? (buyCount + sellCount)),
    buyCount,
    sellCount,
    recentMonthBuyCount: Math.round(finite(value?.recentMonthBuyCount, 0, 100) ?? 0),
    recentMonthSellCount: Math.round(finite(value?.recentMonthSellCount, 0, 100) ?? 0),
    firstBuyDate: date(value?.firstBuyDate),
    lastBuyDate: date(value?.lastBuyDate),
    firstBuyConfirmationDate: date(value?.firstBuyConfirmationDate) || null,
    lastBuyConfirmationDate: date(value?.lastBuyConfirmationDate) || null,
    firstSellDate: date(value?.firstSellDate) || null,
    lastSellDate: date(value?.lastSellDate) || null,
    firstSellConfirmationDate: date(value?.firstSellConfirmationDate) || null,
    lastSellConfirmationDate: date(value?.lastSellConfirmationDate) || null,
    sellDate: date(value?.sellDate) || date(value?.lastSellDate) || null,
    bottomDate: date(value?.bottomDate),
    latestDate: date(value?.latestDate),
    reboundPercent: finite(value?.reboundPercent, -1000, 100000),
    return20Percent: finite(value?.return20Percent, -1000, 100000),
    annualVolatilityPercent: finite(value?.annualVolatilityPercent, 0, 100000),
    reasons: (Array.isArray(value?.reasons) ? value.reasons : []).map((reason) => text(reason, 100)).filter(Boolean).slice(0, 6),
    category: text(value?.category, 40),
    industry: text(value?.industry, 80),
    categoryType: text(value?.categoryType, 20),
  };
  return candidate.name && (candidate.lastBuyDate || candidate.lastSellDate) ? candidate : null;
}

function sanitizeUniverseState(value, limit = RESEARCH_SUMMARY_DEFAULT_UNIVERSE_SIZE) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([tickerValue, state]) => {
    const ticker = String(tickerValue || "").trim().toUpperCase();
    if (!TICKER_PATTERN.test(ticker) || !state || typeof state !== "object") return [];
    return [[ticker, {
      fingerprint: text(state.fingerprint, 240),
      metadataFingerprint: text(state.metadataFingerprint, 240),
      signalFingerprint: text(state.signalFingerprint, 240),
    }]];
  }).slice(0, normalizeResearchUniverseSize(limit)));
}

function sanitizeSharedFingerprints(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(["KOSPI", "KOSDAQ"].flatMap((market) => {
    const fingerprint = text(value[market], 80);
    return fingerprint ? [[market, fingerprint]] : [];
  }));
}

export function normalizeResearchSummary(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const strategy = normalizeResearchStrategy(value.strategy);
  const minimumBuySignals = normalizeResearchMinimum(value.minimumBuySignals);
  const baseDate = date(value.baseDate);
  const analysisDate = date(value.analysisDate) || baseDate;
  const incrementalDate = date(value.incrementalDate);
  const universeSize = normalizeResearchUniverseSize(value.universeSize);
  const historyQualityVersion = Math.round(finite(value.historyQualityVersion, 1, 100) ?? 0);
  if (value.schema !== RESEARCH_SUMMARY_SCHEMA
    || historyQualityVersion !== RESEARCH_SUMMARY_HISTORY_QUALITY_VERSION
    || !strategy
    || !baseDate) return null;
  if (expected.strategy && strategy !== expected.strategy) return null;
  if (expected.minimum !== undefined && minimumBuySignals !== normalizeResearchMinimum(expected.minimum)) return null;
  if (expected.universeSize !== undefined
    && universeSize !== normalizeResearchUniverseSize(expected.universeSize)) return null;
  const candidatesByTicker = new Map();
  (Array.isArray(value.candidatePool) ? value.candidatePool : []).slice(0, universeSize).forEach((candidateValue) => {
    const candidate = sanitizeResearchCandidate(candidateValue);
    if (candidate) candidatesByTicker.set(candidate.ticker, candidate);
  });
  const candidatePool = [...candidatesByTicker.values()];
  const preferredOrder = Array.isArray(value.candidateOrder) ? value.candidateOrder : [];
  const candidateOrder = [...new Set(preferredOrder.map((ticker) => String(ticker || "").trim().toUpperCase()))]
    .filter((ticker) => candidatesByTicker.has(ticker));
  candidatePool.forEach((candidate) => {
    if (!candidateOrder.includes(candidate.ticker)) candidateOrder.push(candidate.ticker);
  });
  const universeTickers = [...new Set((Array.isArray(value.universeTickers) ? value.universeTickers : [])
    .map((ticker) => String(ticker || "").trim().toUpperCase())
    .filter((ticker) => TICKER_PATTERN.test(ticker)))]
    .slice(0, universeSize);
  return {
    schema: RESEARCH_SUMMARY_SCHEMA,
    strategy,
    signalLogicVersion: text(value.signalLogicVersion || strategy, 80),
    historyQualityVersion,
    baseDate,
    analysisDate,
    incrementalDate,
    refreshCursor: Math.round(finite(value.refreshCursor, 0, 1000000) ?? 0),
    generatedAt: text(value.generatedAt, 40) || new Date().toISOString(),
    universeTickers,
    universeState: sanitizeUniverseState(value.universeState, universeSize),
    sharedFingerprint: text(value.sharedFingerprint, 80),
    sharedFingerprints: sanitizeSharedFingerprints(value.sharedFingerprints),
    scanned: Math.round(finite(value.scanned, 0, 1000) ?? universeTickers.length),
    failed: Math.round(finite(value.failed, 0, 1000) ?? 0),
    minimumBuySignals,
    universeSize,
    candidatePool,
    candidateOrder,
  };
}
