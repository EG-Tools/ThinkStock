import { rebaseSeriesRowsToAvailability } from "../../shared/series-timeline-policy.mjs";

"use strict";
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

  function parseMacroPayload(text, options = {}) {
    const payload = parsePayloadText(text);
    const rows = rowsFromColumnarPayload(payload);
    return options.alignLeadingCycle === true
      ? rebaseSeriesRowsToAvailability(rows, "leading_cycle", {
          dateBasis: payload?.leadingDateBasis,
          observationCadence: payload?.leadingDateBasis ? undefined : "monthly",
        })
      : rows;
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

  function createSeedBundleParser(dataPayloadUtils = dataPayload) {
    const {
      normalizeDisclosureRows: normalizeDisclosures,
      parseMacroPayload: parseMacro,
      parsePayloadText: parseText,
      rowsFromColumnarPayload: rowsFromColumns,
    } = dataPayloadUtils || {};
    if ([normalizeDisclosures, parseMacro, parseText, rowsFromColumns]
      .some((value) => typeof value !== "function")) {
      throw new Error("ThinkStock data payload module is unavailable");
    }

    return function parseSeedBundle(texts = {}) {
      const pricePayload = parseText(texts.priceText);
      const priceRows = rowsFromColumns(pricePayload);
      const disclosurePayload = parseText(texts.disclosureText);
      return {
        pricePayload: pricePayload ? {
          ...pricePayload,
          records: priceRows,
          series: Array.isArray(pricePayload.series)
            ? pricePayload.series
            : Object.keys(pricePayload.columns || {}),
          display_names: pricePayload.display_names && typeof pricePayload.display_names === "object"
            ? pricePayload.display_names
            : {},
        } : null,
        macroRows: parseMacro(texts.macroText, { alignLeadingCycle: true }),
        creditRows: parseMacro(texts.creditText),
        adrRows: parseMacro(texts.adrText),
        vkospiRows: parseMacro(texts.vkospiText),
        disclosurePayload: disclosurePayload || null,
        disclosureRows: normalizeDisclosures(disclosurePayload?.records),
      };
    };
  }

  function attachDataWorker(scope, dataPayloadUtils = dataPayload) {
    if (!scope || typeof scope.addEventListener !== "function" || typeof scope.postMessage !== "function") {
      throw new Error("Data worker scope is unavailable");
    }
    const parseSeedBundle = createSeedBundleParser(dataPayloadUtils);
    const handleMessage = (event) => {
      const { id, type, texts } = event?.data || {};
      if (type !== "parseSeedBundle") return;
      try {
        scope.postMessage({ id, ok: true, result: parseSeedBundle(texts) });
      } catch (error) {
        scope.postMessage({ id, ok: false, error: error?.message || String(error) });
      }
    };
    scope.addEventListener("message", handleMessage);
    return Object.freeze({
      dispose() {
        scope.removeEventListener?.("message", handleMessage);
      },
      parseSeedBundle,
    });
  }

  const dataPayload = Object.freeze({
    attachDataWorker,
    createSeedBundleParser,
    normalizePayloadRecords,
    rowsFromColumnarPayload,
    parsePayloadText,
    parseMacroPayload,
    normalizeDisclosureRows,
  });
export {
  attachDataWorker,
  createSeedBundleParser,
  normalizeDisclosureRows,
  normalizePayloadRecords,
  parseMacroPayload,
  parsePayloadText,
  rowsFromColumnarPayload,
};
export default dataPayload;
