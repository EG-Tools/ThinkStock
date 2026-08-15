const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function finiteOrNull(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function positiveOrNull(value) {
  const number = finiteOrNull(value);
  return number !== null && number > 0 ? number : null;
}

export function boundedOrNull(value, minimum, maximum) {
  const number = finiteOrNull(value);
  return number !== null && number >= minimum && number <= maximum ? number : null;
}

export function normalizedIsoDate(value) {
  const date = String(value || "").slice(0, 10);
  return DATE_PATTERN.test(date) ? date : "";
}

export const RUNTIME_VALUE_CONTRACT = Object.freeze({
  boundedOrNull,
  finiteOrNull,
  normalizedIsoDate,
  positiveOrNull,
});

export const RUNTIME_STORAGE_CONTRACT = Object.freeze({
  dbName: "thinkstock-runtime-cache-v1",
  dbVersion: 7,
  localSnapshotKey: "thinkstock-runtime-cache-v1",
  snapshotRecordKey: "latest",
  stores: Object.freeze({
    snapshots: "snapshots",
    tickerPrices: "tickerPrices",
    tickerDisclosures: "tickerDisclosures",
    tickerAiAnalysis: "tickerAiAnalysis",
    tickerAiForecast: "tickerAiForecast",
    tickerAiForecastJournal: "tickerAiForecastJournal",
    tickerResearchHistory: "tickerResearchHistory",
    tickerBrokerResearch: "tickerBrokerResearch",
  }),
});

globalThis.ThinkStockRuntimeFoundation = Object.freeze({
  storage: RUNTIME_STORAGE_CONTRACT,
  values: RUNTIME_VALUE_CONTRACT,
});
