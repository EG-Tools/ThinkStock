"use strict";

function createSeedBundleParser(dataPayloadUtils) {
  const {
    normalizeDisclosureRows,
    parseMacroPayload,
    parsePayloadText,
    rowsFromColumnarPayload,
  } = dataPayloadUtils || {};
  if ([
    normalizeDisclosureRows,
    parseMacroPayload,
    parsePayloadText,
    rowsFromColumnarPayload,
  ].some((value) => typeof value !== "function")) {
    throw new Error("ThinkStock data payload module is unavailable");
  }

  return function parseSeedBundle(texts = {}) {
    const pricePayload = parsePayloadText(texts.priceText);
    const priceRows = rowsFromColumnarPayload(pricePayload);
    const macroRows = parseMacroPayload(texts.macroText);
    const creditRows = parseMacroPayload(texts.creditText);
    const adrRows = parseMacroPayload(texts.adrText);
    const vkospiRows = parseMacroPayload(texts.vkospiText);
    const disclosurePayload = parsePayloadText(texts.disclosureText);
    const disclosureRows = normalizeDisclosureRows(disclosurePayload?.records);

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
      macroRows,
      creditRows,
      adrRows,
      vkospiRows,
      disclosurePayload: disclosurePayload || null,
      disclosureRows,
    };
  };
}

function attachDataWorker(scope, dataPayloadUtils) {
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

export {
  attachDataWorker,
  createSeedBundleParser,
};
