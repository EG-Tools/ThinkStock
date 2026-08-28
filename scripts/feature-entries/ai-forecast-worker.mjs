import "../../docs/modules/ai-forecast-math.js";
import "../../docs/modules/ai-forecast-model.js";
import "../../docs/modules/ai-scenario-paths.js";
import "../../docs/modules/ai-forecast-scenarios.js";
import "../../docs/modules/ai-context-profile.js";
import "../../docs/modules/ai-forecast.js";

const aiForecast = globalThis.ThinkStockAiForecast;

delete globalThis.ThinkStockAiForecastMath;
delete globalThis.ThinkStockAiForecastModel;
delete globalThis.ThinkStockAiScenarioPaths;
delete globalThis.ThinkStockAiForecastScenarios;
delete globalThis.ThinkStockAiContextProfile;
delete globalThis.ThinkStockAiForecast;

if (!aiForecast) throw new Error("AI forecast worker dependencies are incomplete");

globalThis.onmessage = (event) => {
  const id = Number(event.data?.id);
  if (!Number.isInteger(id)) return;
  try {
    const forecast = aiForecast.buildForecast(event.data?.options || {});
    globalThis.postMessage({ id, forecast });
  } catch (error) {
    globalThis.postMessage({
      id,
      error: String(error?.message || error || "AI forecast failed"),
    });
  }
};
