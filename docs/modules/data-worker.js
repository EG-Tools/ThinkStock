const toNum = (value) => (value != null && Number.isFinite(Number(value))) ? Number(value) : null;

function normalizePayloadRecords(records) {
  const list = Array.isArray(records) ? records : [];
  return list.map((row) => {
    const out = { date: String(row?.date || "").slice(0, 10) };
    Object.entries(row || {}).forEach(([key, value]) => {
      if (key !== "date") out[key] = toNum(value);
    });
    return out;
  }).filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date));
}

function rowsFromColumnarPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const dates = Array.isArray(payload.dates) ? payload.dates : [];
  const columns = payload.columns && typeof payload.columns === "object" ? payload.columns : null;
  if (!dates.length || !columns) return normalizePayloadRecords(payload.records);

  const series = Array.isArray(payload.series) && payload.series.length
    ? payload.series.map(String).filter(Boolean)
    : Object.keys(columns);

  return dates.map((rawDate, index) => {
    const row = { date: String(rawDate || "").slice(0, 10) };
    series.forEach((key) => {
      const values = Array.isArray(columns[key]) ? columns[key] : [];
      row[key] = toNum(values[index]);
    });
    return row;
  }).filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date));
}

function parsePayload(text) {
  if (!text) return null;
  return JSON.parse(String(text).replace(/\bNaN\b/g, "null"));
}

function parseRows(text) {
  const payload = parsePayload(text);
  return rowsFromColumnarPayload(payload);
}

function normalizeDisclosureRows(records) {
  return (Array.isArray(records) ? records : [])
    .filter((row) => row && typeof row === "object")
    .map((row) => ({ ...row, date: String(row.date || "").slice(0, 10), ticker: String(row.ticker || "").toUpperCase() }))
    .filter((row) => row.date && row.ticker)
    .sort((a, b) => (a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker) || String(a.title || "").localeCompare(String(b.title || ""))));
}

self.addEventListener("message", (event) => {
  const { id, type, texts } = event.data || {};
  if (type !== "parseSeedBundle") return;

  try {
    const pricePayload = parsePayload(texts?.priceText);
    const priceRows = rowsFromColumnarPayload(pricePayload);
    const macroRows = parseRows(texts?.macroText);
    const creditRows = parseRows(texts?.creditText);
    const adrRows = parseRows(texts?.adrText);
    const disclosurePayload = parsePayload(texts?.disclosureText);
    const disclosureRows = normalizeDisclosureRows(disclosurePayload?.records);

    self.postMessage({
      id,
      ok: true,
      result: {
        pricePayload: pricePayload ? {
          ...pricePayload,
          records: priceRows,
          series: Array.isArray(pricePayload.series) ? pricePayload.series : Object.keys(pricePayload.columns || {}),
          display_names: pricePayload.display_names && typeof pricePayload.display_names === "object" ? pricePayload.display_names : {},
        } : null,
        macroRows,
        creditRows,
        adrRows,
        disclosurePayload: disclosurePayload || null,
        disclosureRows,
      },
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
