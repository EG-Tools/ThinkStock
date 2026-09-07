export const RUNTIME_SOURCE_KEYS = Object.freeze([
  "price",
  "indices",
  "prices",
  "prices-hidden",
  "prices-visible",
  "adr",
  "fearGreed",
  "credit",
  "macro",
  "macro:leading",
  "macro:news",
  "macro:policyRate",
  "macro:trade",
  "macro:trade:export",
  "macro:trade:import",
  "macro:termSpread",
  "macro:creditSpread",
  "volatility",
  "volatility:vkospi",
  "volatility:vix",
  "crisis",
  "disclosure",
  "insider",
  "brokerResearch",
]);

const RUNTIME_SOURCE_KEY_SET = new Set(RUNTIME_SOURCE_KEYS);

export function isRuntimeSourceKey(value) {
  return RUNTIME_SOURCE_KEY_SET.has(String(value || "").trim());
}

export function runtimeSourcePolicyFamily(value) {
  const source = String(value || "").trim();
  if (["prices", "prices-hidden", "prices-visible"].includes(source)) return "price";
  if (source === "volatility" || source.startsWith("volatility:")) return "crisis";
  if (source.startsWith("macro:")) return "macro";
  return source;
}

export default Object.freeze({
  RUNTIME_SOURCE_KEYS,
  isRuntimeSourceKey,
  runtimeSourcePolicyFamily,
});
