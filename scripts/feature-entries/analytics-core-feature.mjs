import "../../docs/modules/ai-forecast-math.js";
import "../../docs/modules/ai-context-profile.js";

const analyticsCoreFeature = Object.freeze({
  contextProfile: globalThis.ThinkStockAiContextProfile,
  math: globalThis.ThinkStockAiForecastMath,
});

if (Object.values(analyticsCoreFeature).some((module) => !module)) {
  throw new Error("Analytics core feature bundle is incomplete");
}

["ThinkStockAiContextProfile", "ThinkStockAiForecastMath"].forEach((name) => {
  try { delete globalThis[name]; } catch (_) {}
});

export { analyticsCoreFeature };
export default analyticsCoreFeature;
