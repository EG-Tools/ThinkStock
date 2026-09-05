const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^(\d{6})\.(KS|KQ)$/;

export const KRX_MARKET_CACHE_SCHEMA = 3;

export function krxNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(number) ? number : null;
}

export function krxStockCode(value, shortValue = "") {
  const shortDigits = String(shortValue ?? "").replace(/\D/g, "");
  if (shortDigits.length >= 6) return shortDigits.slice(-6);
  const text = String(value ?? "").trim().toUpperCase();
  const isinMatch = /^KR[A-Z0-9](\d{6})\d{3}$/.exec(text);
  if (isinMatch) return isinMatch[1];
  const digits = text.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length === 10) return digits.slice(1, 7);
  return digits.length >= 6 ? digits.slice(-6) : "";
}

export function krxMarketSnapshotFromRows(rows, market = "", baseDate = "") {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const code = krxStockCode(row?.ISU_CD, row?.ISU_SRT_CD);
    const rawDate = String(row?.BAS_DD ?? "").replace(/\D/g, "");
    const date = rawDate.length === 8
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : "";
    const close = krxNumber(row?.TDD_CLSPRC ?? row?.CLSPRC);
    const volume = krxNumber(row?.ACC_TRDVOL ?? row?.ACC_TRDVOL_QTY);
    return { code, date, close, volume };
  }).filter((row) => row.code && DATE_PATTERN.test(row.date) && row.close !== null && row.close > 0);
  const marketDate = normalizedRows.reduce(
    (latest, row) => (!latest || row.date > latest ? row.date : latest),
    "",
  );
  if (!marketDate) return null;
  const prices = Object.fromEntries(normalizedRows
    .filter((row) => row.date === marketDate)
    .map((row) => [row.code, row.close]));
  const volumes = Object.fromEntries(normalizedRows
    .filter((row) => row.date === marketDate && Number.isFinite(row.volume) && row.volume > 0)
    .map((row) => [row.code, row.volume]));
  if (!Object.keys(prices).length) return null;
  return {
    schema: KRX_MARKET_CACHE_SCHEMA,
    market: String(market || ""),
    baseDate: String(baseDate || "").slice(0, 10),
    marketDate,
    prices,
    volumes,
  };
}

export function krxStockPointFromRows(rows, ticker) {
  const match = TICKER_PATTERN.exec(String(ticker || "").trim().toUpperCase());
  if (!match) return null;
  const snapshot = krxMarketSnapshotFromRows(rows, match[2], "");
  const close = snapshot?.prices?.[match[1]];
  const volume = snapshot?.volumes?.[match[1]];
  return Number.isFinite(close) ? {
    date: snapshot.marketDate,
    close,
    ...(Number.isFinite(volume) && volume > 0 ? { volume } : {}),
  } : null;
}

export function krxIndexPointFromRows(rows, market) {
  const marketName = String(market || "").toUpperCase();
  const expectedNames = marketName === "KOSPI"
    ? ["KOSPI", "\uCF54\uC2A4\uD53C"]
    : ["KOSDAQ", "\uCF54\uC2A4\uB2E5"];
  let best = null;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rawDate = String(row?.BAS_DD || "");
    const date = /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : "";
    const close = krxNumber(row?.CLSPRC_IDX ?? row?.TDD_CLSPRC ?? row?.CLSPRC);
    const volume = krxNumber(row?.ACC_TRDVOL ?? row?.ACC_TRDVOL_QTY);
    const name = String(row?.IDX_NM ?? row?.IDX_NM_KOR ?? row?.IDX_NM_ENG ?? "")
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!date || !Number.isFinite(close) || close <= 0) return;
    const exact = expectedNames.some((value) => name === value);
    const partial = expectedNames.some((value) => name.includes(value));
    const score = exact ? 100 : (partial ? 50 : 0);
    if (!score) return;
    if (!best || score > best.score) best = { date, close, volume, score };
  });
  return best ? {
    date: best.date,
    close: best.close,
    ...(Number.isFinite(best.volume) && best.volume > 0 ? { volume: best.volume } : {}),
  } : null;
}
