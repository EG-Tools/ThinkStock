const NAVER_RESEARCH_UNIVERSE_ENDPOINT = "https://stock.naver.com/api/domestic/market/stock/default";
const PAGE_SIZE = 100;
const MAX_FILTER_BACKFILL_PAGES = 4;
export const RESEARCH_UNIVERSE_DEFAULT_SIZE = 400;
export const RESEARCH_UNIVERSE_MIN_SIZE = 100;
export const RESEARCH_UNIVERSE_MAX_SIZE = 1000;
export const RESEARCH_UNIVERSE_SIZE_STEP = 100;

export function normalizeResearchUniverseSize(value) {
  if (value == null || String(value).trim() === "") return RESEARCH_UNIVERSE_DEFAULT_SIZE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return RESEARCH_UNIVERSE_DEFAULT_SIZE;
  const stepped = Math.round(parsed / RESEARCH_UNIVERSE_SIZE_STEP) * RESEARCH_UNIVERSE_SIZE_STEP;
  return Math.max(RESEARCH_UNIVERSE_MIN_SIZE, Math.min(RESEARCH_UNIVERSE_MAX_SIZE, stepped));
}

export function researchUniversePerMarketLimit(value) {
  return normalizeResearchUniverseSize(value) / 2;
}

function researchUniversePageIndexes(perMarketLimit) {
  return Object.freeze(Array.from(
    { length: Math.ceil(perMarketLimit / PAGE_SIZE) },
    (_, index) => index,
  ));
}

function finiteNumber(value) {
  const normalized = typeof value === "string" ? value.replaceAll(",", "").trim() : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function marketKey(value) {
  return String(value || "").trim().toUpperCase() === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
}

export function naverResearchUniverseUrl(market, pageIndex) {
  const query = new URLSearchParams({
    tradeType: "KRX",
    marketType: marketKey(market),
    orderType: "marketSum",
    startIdx: String(Math.max(0, Math.trunc(Number(pageIndex) || 0))),
    pageSize: String(PAGE_SIZE),
  });
  return `${NAVER_RESEARCH_UNIVERSE_ENDPOINT}?${query}`;
}

export function normalizeNaverResearchUniverseRows(rows, market, priceDate, limit = PAGE_SIZE * 2) {
  const normalizedMarket = marketKey(market);
  const suffix = normalizedMarket === "KOSDAQ" ? "KQ" : "KS";
  const byTicker = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const code = String(row?.itemcode || row?.itemCode || "").replace(/\D/g, "").slice(-6);
    const name = String(row?.itemname || row?.stockName || "").trim();
    const close = finiteNumber(row?.nowPrice ?? row?.closePriceRaw ?? row?.closePrice);
    const marketCap = finiteNumber(row?.marketSum ?? row?.marketValueRaw ?? row?.marketValue);
    if (!/^\d{6}$/.test(code) || !name || !close || close <= 0 || !marketCap || marketCap <= 0) return;
    const ticker = `${code}.${suffix}`;
    const candidate = {
      ticker,
      code,
      name,
      market: normalizedMarket,
      marketCap,
      tradeValue: finiteNumber(row?.tradeAmount ?? row?.accumulatedTradingValueRaw),
      volume: finiteNumber(row?.tradeVolume ?? row?.accumulatedTradingVolumeRaw),
      close,
      baseDate: String(priceDate || "").slice(0, 10),
      priceSource: "NAVER_LIVE",
      marketStatus: String(row?.marketStatus || "").trim().toUpperCase(),
    };
    const previous = byTicker.get(ticker);
    if (!previous || candidate.marketCap > previous.marketCap) byTicker.set(ticker, candidate);
  });
  return [...byTicker.values()]
    .sort((left, right) => right.marketCap - left.marketCap || left.ticker.localeCompare(right.ticker))
    .slice(0, Math.max(1, Number(limit) || PAGE_SIZE * 2))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

async function readPage(fetchImpl, market, pageIndex) {
  const response = await fetchImpl(naverResearchUniverseUrl(market, pageIndex), {
    headers: { Accept: "application/json" },
  });
  if (!response?.ok) throw new Error(`Naver ${market} universe HTTP ${response?.status || 0}`);
  const announcedSize = Number(response.headers?.get?.("Content-Length") || 0);
  if (announcedSize > 2 * 1024 * 1024) throw new Error(`Naver ${market} universe response is too large`);
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length < PAGE_SIZE) {
    throw new Error(`Naver ${market} universe page ${pageIndex} is incomplete`);
  }
  return payload;
}

export async function fetchNaverLiveResearchUniverse(fetchImpl, priceDate, options = {}) {
  if (typeof fetchImpl !== "function") throw new Error("research universe fetch is required");
  const date = String(priceDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("research universe price date is invalid");
  const totalLimit = normalizeResearchUniverseSize(options.totalLimit ?? options.limit);
  const perMarketLimit = researchUniversePerMarketLimit(totalLimit);
  const pageIndexes = researchUniversePageIndexes(perMarketLimit);
  const marketRows = await Promise.all(["KOSPI", "KOSDAQ"].map(async (market) => {
    const pages = await Promise.all(pageIndexes.map((pageIndex) => readPage(fetchImpl, market, pageIndex)));
    let records = normalizeNaverResearchUniverseRows(pages.flat(), market, date, perMarketLimit);
    let nextPageIndex = pageIndexes.length;
    const maximumPageIndex = pageIndexes.length + MAX_FILTER_BACKFILL_PAGES;
    // Preferred shares and non-numeric symbols are filtered out. Pull only the
    // following rank pages until the requested common-stock count is complete.
    while (records.length < perMarketLimit && nextPageIndex < maximumPageIndex) {
      pages.push(await readPage(fetchImpl, market, nextPageIndex));
      nextPageIndex += 1;
      records = normalizeNaverResearchUniverseRows(pages.flat(), market, date, perMarketLimit);
    }
    if (records.length !== perMarketLimit) throw new Error(`Naver ${market} universe is incomplete`);
    return records;
  }));
  return Object.freeze({
    ok: true,
    source: "NAVER_LIVE",
    baseDate: date,
    selection: Object.freeze({ KOSPI: perMarketLimit, KOSDAQ: perMarketLimit }),
    records: Object.freeze(marketRows.flat()),
  });
}

export const researchUniverseLiveApi = Object.freeze({
  PAGE_SIZE,
  RESEARCH_UNIVERSE_DEFAULT_SIZE,
  RESEARCH_UNIVERSE_MIN_SIZE,
  RESEARCH_UNIVERSE_MAX_SIZE,
  RESEARCH_UNIVERSE_SIZE_STEP,
  fetchNaverLiveResearchUniverse,
  naverResearchUniverseUrl,
  normalizeNaverResearchUniverseRows,
  normalizeResearchUniverseSize,
  researchUniversePerMarketLimit,
});
