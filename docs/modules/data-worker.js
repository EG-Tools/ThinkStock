importScripts("./data-payload.js?v=dev");

const dataPayloadUtils = self.ThinkStockDataPayload;
if (!dataPayloadUtils) throw new Error("ThinkStock data payload module is unavailable");
const {
  rowsFromColumnarPayload,
  parsePayloadText: parsePayload,
  parseMacroPayload: parseRows,
  normalizeDisclosureRows,
} = dataPayloadUtils;

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
