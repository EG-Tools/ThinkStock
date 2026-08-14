import { shiftIsoDate } from "../../shared/market-calendar.mjs";
import { krxNumber, krxStockCode } from "./market-data.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  const date = String(value || "").slice(0, 10);
  return DATE_PATTERN.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));
}

export function normalizeResearchUniverseRows(rows, market, limit) {
  const suffix = market === "KOSDAQ" ? "KQ" : "KS";
  const byTicker = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const code = krxStockCode(row?.ISU_CD, row?.ISU_SRT_CD);
    const name = String(row?.ISU_NM || row?.ISU_ABBRV || "").trim();
    const marketCap = krxNumber(row?.MKTCAP);
    const tradeValue = krxNumber(row?.ACC_TRDVAL ?? row?.ACC_TRDVAL_AMT);
    const close = krxNumber(row?.TDD_CLSPRC ?? row?.CLSPRC);
    if (!code || !name || !Number.isFinite(marketCap) || marketCap <= 0) return;
    const ticker = `${code}.${suffix}`;
    const candidate = { ticker, code, name, market, marketCap, tradeValue, close };
    const previous = byTicker.get(ticker);
    if (!previous || candidate.marketCap > previous.marketCap) byTicker.set(ticker, candidate);
  });
  return [...byTicker.values()]
    .sort((left, right) => right.marketCap - left.marketCap || left.ticker.localeCompare(right.ticker))
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function parseNaverResearchHistory(text) {
  const byDate = new Map();
  for (const match of String(text || "").matchAll(/<item\s+data="(\d{8})\|[^|]*\|[^|]*\|[^|]*\|([^|]+)\|([^"]+)"/g)) {
    const rawDate = match[1];
    const close = krxNumber(match[2]);
    const volume = krxNumber(match[3]);
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    if (!validDate(date) || !Number.isFinite(close) || close <= 0) continue;
    byDate.set(date, { date, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : null });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function detectResearchHistoryRebase(existingRows, incomingRows, threshold = 1.8) {
  const existingByDate = new Map((Array.isArray(existingRows) ? existingRows : [])
    .map((row) => [String(row?.date || ""), Number(row?.close)]));
  const ratios = (Array.isArray(incomingRows) ? incomingRows : []).flatMap((row) => {
    const existing = existingByDate.get(String(row?.date || ""));
    const incoming = Number(row?.close);
    return Number.isFinite(existing) && existing > 0 && Number.isFinite(incoming) && incoming > 0
      ? [existing / incoming]
      : [];
  }).sort((left, right) => left - right);
  if (ratios.length < 3) return false;
  const middle = Math.floor(ratios.length / 2);
  const medianRatio = ratios.length % 2
    ? ratios[middle]
    : (ratios[middle - 1] + ratios[middle]) / 2;
  if (medianRatio < threshold && medianRatio > (1 / threshold)) return false;
  const relativeDeviation = ratios.reduce((sum, ratio) => (
    sum + Math.abs((ratio / medianRatio) - 1)
  ), 0) / ratios.length;
  return relativeDeviation <= 0.04;
}

export function projectResearchHistoryPayload(
  payload,
  sinceDate = "",
  forceFull = false,
  overlapDays = 35,
) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const since = String(sinceDate || "").slice(0, 10);
  const latestDate = String(payload?.latestDate || rows.at(-1)?.date || "").slice(0, 10);
  const validSince = validDate(since) && since <= latestDate;
  const reset = payload?.rebased === true && validSince && !forceFull;
  if (forceFull || !validSince || reset) {
    return {
      ...payload,
      partial: false,
      reset,
      fullRowCount: rows.length,
    };
  }
  const overlapStart = shiftIsoDate(since, -Math.max(7, Number(overlapDays) || 35));
  return {
    ...payload,
    rows: rows.filter((row) => String(row?.date || "") >= overlapStart),
    partial: true,
    reset: false,
    overlapStart,
    fullRowCount: rows.length,
  };
}
