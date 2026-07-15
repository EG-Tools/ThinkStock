(function (globalScope) {
  const toNum = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );

  function normalizePayloadRecords(records) {
    const list = Array.isArray(records) ? records : [];
    return list.map((row) => {
      const source = row && typeof row === "object" ? row : {};
      const out = { date: String(source.date || "").slice(0, 10) };
      Object.entries(source).forEach(([key, value]) => {
        if (key !== "date") out[key] = toNum(value);
      });
      return out;
    }).filter((row) => row.date).sort((left, right) => left.date.localeCompare(right.date));
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
    }).filter((row) => row.date).sort((left, right) => left.date.localeCompare(right.date));
  }

  function parsePayloadText(text) {
    if (!text) return null;
    return JSON.parse(String(text).replace(/\bNaN\b/g, "null"));
  }

  function parseMacroPayload(text) {
    return rowsFromColumnarPayload(parsePayloadText(text));
  }

  function normalizeDisclosureRows(records) {
    return (Array.isArray(records) ? records : [])
      .filter((row) => row && typeof row === "object")
      .map((row) => ({
        ...row,
        date: String(row.date || "").slice(0, 10),
        ticker: String(row.ticker || "").toUpperCase(),
      }))
      .filter((row) => row.date && row.ticker)
      .sort((left, right) => (
        left.date.localeCompare(right.date)
        || left.ticker.localeCompare(right.ticker)
        || String(left.title || "").localeCompare(String(right.title || ""))
      ));
  }

  globalScope.ThinkStockDataPayload = Object.freeze({
    normalizePayloadRecords,
    rowsFromColumnarPayload,
    parsePayloadText,
    parseMacroPayload,
    normalizeDisclosureRows,
  });
})(typeof self !== "undefined" ? self : globalThis);
