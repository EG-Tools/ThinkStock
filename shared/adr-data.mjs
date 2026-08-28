const ADR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ADR_SERIES = Object.freeze([
  ["kospi_adr", "adr_kospi"],
  ["kosdaq_adr", "adr_kosdaq"],
]);

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function timestampToKoreanDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function extractArray(sourceText, name) {
  const declaration = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`, "m").exec(sourceText);
  if (!declaration) return [];
  const start = declaration.index + declaration[0].length;
  const end = sourceText.indexOf("];", start);
  if (end < 0) return [];
  try {
    const value = JSON.parse(sourceText.slice(start, end + 1).replace(/,\s*\]/g, "]"));
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

export function normalizeAdrRows(rows) {
  const rowsByDate = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!ADR_DATE_PATTERN.test(date)) return;
    const previous = rowsByDate.get(date) || { date };
    const next = { ...previous };
    const kospi = finitePositive(row?.adr_kospi);
    const kosdaq = finitePositive(row?.adr_kosdaq);
    if (kospi !== null) next.adr_kospi = kospi;
    if (kosdaq !== null) next.adr_kosdaq = kosdaq;
    if (Number.isFinite(next.adr_kospi) || Number.isFinite(next.adr_kosdaq)) rowsByDate.set(date, next);
  });
  return [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function mergeAdrRows(existing, incoming, limit = Infinity) {
  const rowsByDate = new Map(normalizeAdrRows(existing).map((row) => [row.date, row]));
  normalizeAdrRows(incoming).forEach((row) => {
    rowsByDate.set(row.date, { ...(rowsByDate.get(row.date) || { date: row.date }), ...row });
  });
  const rows = [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : rows.length;
  return rows.slice(-safeLimit);
}

export function mergeAdrLiveRows(existing, incoming) {
  const rowsByDate = new Map();
  (Array.isArray(existing) ? existing : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (ADR_DATE_PATTERN.test(date)) rowsByDate.set(date, { ...row, date });
  });
  let added = 0;
  let updated = 0;
  normalizeAdrRows(incoming).forEach((row) => {
    const previous = rowsByDate.get(row.date) || { date: row.date };
    const hadAdr = finitePositive(previous.adr_kospi) !== null
      || finitePositive(previous.adr_kosdaq) !== null;
    const next = { ...previous };
    let changed = false;
    ["adr_kospi", "adr_kosdaq"].forEach((key) => {
      const value = finitePositive(row[key]);
      if (value === null || finitePositive(previous[key]) === value) return;
      next[key] = value;
      changed = true;
    });
    if (!changed) return;
    if (hadAdr) updated += 1;
    else added += 1;
    rowsByDate.set(row.date, next);
  });
  const rows = [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const latestDate = rows.reduce((latest, row) => (
    (finitePositive(row.adr_kospi) !== null || finitePositive(row.adr_kosdaq) !== null) && row.date > latest
      ? row.date
      : latest
  ), "");
  return { rows, added, updated, changed: added + updated, latestDate };
}

export function parseAdrChartRows(html) {
  const sourceText = String(html || "");
  const rowsByDate = new Map();
  ADR_SERIES.forEach(([source, key]) => {
    extractArray(sourceText, source).forEach((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return;
      const date = timestampToKoreanDate(entry[0]);
      const value = finitePositive(entry[1]);
      if (!date || value === null) return;
      rowsByDate.set(date, { ...(rowsByDate.get(date) || { date }), [key]: value });
    });
  });
  return normalizeAdrRows([...rowsByDate.values()]);
}

const api = Object.freeze({
  mergeAdrLiveRows,
  mergeAdrRows,
  normalizeAdrRows,
  parseAdrChartRows,
});
