import "../../shared/ai-news-evidence.mjs";
import {
  aiForecastApp,
  aiForecastInputCache,
} from "../../docs/modules/ai-forecast-app.mjs";
import aiForecastJournal from "../../docs/modules/ai-forecast-journal.mjs";
import aiForecastQualityRuntime from "../../docs/modules/ai-forecast-quality-runtime.mjs";
import aiForecastTraces from "../../docs/modules/ai-forecast-traces.mjs";
import aiForecastCache from "../../docs/modules/ai-forecast-cache.mjs";
import aiAnalysisCache from "../../docs/modules/ai-analysis-cache.mjs";
import "../../docs/modules/ai-forecast-model.js";
import "../../docs/modules/ai-scenario-paths.js";
import "../../docs/modules/ai-forecast-scenarios.js";
import "../../docs/modules/ai-forecast.js";
import aiForecastCalibration from "../../docs/modules/ai-forecast-calibration.mjs";

const aiFeature = Object.freeze({
  analysis: aiAnalysisCache,
  app: aiForecastApp,
  cache: aiForecastCache,
  calibration: aiForecastCalibration,
  forecast: globalThis.ThinkStockAiForecast,
  inputCache: aiForecastInputCache,
  journal: aiForecastJournal,
  qualityRuntime: aiForecastQualityRuntime,
  scenarios: globalThis.ThinkStockAiForecastScenarios,
  traces: aiForecastTraces,
});

if (Object.values(aiFeature).some((module) => !module)) {
  throw new Error("AI feature bundle is incomplete");
}

[
  "ThinkStockAiForecast",
  "ThinkStockAiForecastMath",
  "ThinkStockAiForecastModel",
  "ThinkStockAiForecastScenarios",
  "ThinkStockAiContextProfile",
  "ThinkStockAiNewsEvidence",
  "ThinkStockAiScenarioPaths",
].forEach((name) => {
  try { delete globalThis[name]; } catch (_) {}
});

export { aiFeature };
export default aiFeature;
