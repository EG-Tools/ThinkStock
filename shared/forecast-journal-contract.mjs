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

export {
  FORECAST_ATTRIBUTION_COMPONENT_KEYS,
  FORECAST_MODEL_VERSION_PATTERN,
  normalizeForecastModelVersion,
};
