const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
const TOKEN_PATTERN = /[A-Za-z0-9\uAC00-\uD7A3]+/g;
const NAVER_FINANCE_HOST = "finance.naver.com";
const NAVER_NEWS_PATH = "/item/news_read.naver";

function cleanText(value, maximum = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function validDate(value) {
  const date = String(value || "").slice(0, 10);
  return DATE_PATTERN.test(date) ? date : "";
}

export function isTrustedAnalysisNewsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === NAVER_FINANCE_HOST
      && url.pathname === NAVER_NEWS_PATH
      && /^\d{6}$/.test(url.searchParams.get("code") || "");
  } catch (_) {
    return false;
  }
}

export function normalizeAnalysisHeadline(value) {
  let title = cleanText(value).normalize("NFKC").toLowerCase();
  for (let index = 0; index < 3; index += 1) {
    const stripped = title.replace(/^\s*(?:\[[^\]]{1,24}\]|\([^)]{1,24}\))\s*/, "");
    if (stripped === title) break;
    title = stripped;
  }
  return title
    .replace(/["'`“”‘’]/g, "")
    .replace(/[^A-Za-z0-9\uAC00-\uD7A3]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineTokens(value) {
  return [...new Set(normalizeAnalysisHeadline(value).match(TOKEN_PATTERN) || [])]
    .filter((token) => token.length >= 2);
}

function dayDistance(left, right) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? Math.abs(leftTime - rightTime) / 86400000
    : Infinity;
}

export function analysisHeadlineSimilarity(left, right) {
  const normalizedLeft = normalizeAnalysisHeadline(left);
  const normalizedRight = normalizeAnalysisHeadline(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const compactLeft = normalizedLeft.replace(/\s+/g, "");
  const compactRight = normalizedRight.replace(/\s+/g, "");
  if (compactLeft === compactRight) return 0.98;
  if (
    Math.min(compactLeft.length, compactRight.length) >= 12
    && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))
  ) return 0.9;
  const leftTokens = headlineTokens(normalizedLeft);
  const rightTokens = headlineTokens(normalizedRight);
  if (Math.min(leftTokens.length, rightTokens.length) < 2) return 0;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  if (overlap < 2) return 0;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = overlap / Math.max(1, union);
  const containment = overlap / Math.min(leftTokens.length, rightTokens.length);
  return Math.max(jaccard, containment * 0.9);
}

function normalizeRow(value, ticker, requireTrustedUrl) {
  const date = validDate(value?.date);
  const title = cleanText(value?.title);
  const source = cleanText(value?.source, 80);
  const url = cleanText(value?.url, 500);
  const recordTicker = String(ticker || value?.ticker || "").trim().toUpperCase();
  const trustedUrl = isTrustedAnalysisNewsUrl(url);
  if (!date || !title || !TICKER_PATTERN.test(recordTicker)) return null;
  if ((requireTrustedUrl || url) && !trustedUrl) return null;
  const clusterSize = Math.max(1, Math.min(100, Math.trunc(Number(value?.clusterSize) || 1)));
  const clusterSources = [...new Set([
    ...(Array.isArray(value?.clusterSources) ? value.clusterSources : []),
    source,
  ].map((item) => cleanText(item, 80)).filter(Boolean))].slice(0, 8);
  return {
    ticker: recordTicker,
    date,
    title,
    source,
    url,
    clusterSize,
    clusterSources,
  };
}

function sameNewsEvent(left, right, maximumDayDistance) {
  if (left.ticker !== right.ticker || dayDistance(left.date, right.date) > maximumDayDistance) return false;
  return analysisHeadlineSimilarity(left.title, right.title) >= 0.72;
}

export function normalizeAnalysisNewsEvidence(values, options = {}) {
  const ticker = String(options.ticker || "").trim().toUpperCase();
  const requireTrustedUrl = options.requireTrustedUrl !== false;
  const maximumDayDistance = Math.max(0, Math.min(5, Number(options.maximumDayDistance) || 2));
  const maximumRows = Math.max(1, Math.min(100, Math.trunc(Number(options.maximumRows) || 40)));
  const rows = (Array.isArray(values) ? values : [])
    .map((value) => normalizeRow(value, ticker, requireTrustedUrl))
    .filter(Boolean)
    .sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title));
  const clusters = [];
  rows.forEach((row) => {
    const prior = clusters.find((candidate) => sameNewsEvent(candidate, row, maximumDayDistance));
    if (!prior) {
      clusters.push({ ...row });
      return;
    }
    prior.clusterSize = Math.min(100, prior.clusterSize + row.clusterSize);
    prior.clusterSources = [...new Set([...prior.clusterSources, ...row.clusterSources])].slice(0, 8);
  });
  return clusters.slice(0, maximumRows);
}

export const NEWS_EVIDENCE_FORMAT = "thinkstock-news-evidence-v1";

const api = Object.freeze({
  NEWS_EVIDENCE_FORMAT,
  analysisHeadlineSimilarity,
  isTrustedAnalysisNewsUrl,
  normalizeAnalysisHeadline,
  normalizeAnalysisNewsEvidence,
});

if (typeof globalThis !== "undefined") globalThis.ThinkStockAiNewsEvidence = api;
