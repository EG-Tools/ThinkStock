const FORECAST_MODEL_VERSION_PATTERN = /^[-A-Za-z0-9._:+\/|]{1,80}$/;

const FORECAST_ATTRIBUTION_COMPONENT_KEYS = Object.freeze([
  "localModel",
  "top400Blend",
  "empiricalGuardrail",
  "corporateRiskGate",
  "criticalNewsGate",
  "consensus",
  "fundamentals",
  "internetNews",
  "brokerResearch",
  "marketRegime",
  "corporateRisk",
  "rotation",
  "rangeMeanReversion",
  "terminalRisk",
  "finalClamp",
  "analogPath",
  "journalCalibration",
]);

function normalizeForecastModelVersion(value) {
  const version = String(value || "").trim();
  return FORECAST_MODEL_VERSION_PATTERN.test(version) ? version : "";
}

function buildForecastJournalRequestUrl(endpoint, ticker) {
  const base = String(endpoint || "").trim();
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  if (!base || !normalizedTicker) return "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}ticker=${encodeURIComponent(normalizedTicker)}`;
}

export {
  FORECAST_ATTRIBUTION_COMPONENT_KEYS,
  FORECAST_MODEL_VERSION_PATTERN,
  buildForecastJournalRequestUrl,
  normalizeForecastModelVersion,
};
