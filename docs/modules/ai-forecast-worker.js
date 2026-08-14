const versionQuery = new URL(self.location.href).search;
importScripts(
  `./ai-forecast-math.js${versionQuery}`,
  `./ai-forecast-model.js${versionQuery}`,
  `./ai-scenario-paths.js${versionQuery}`,
  `./ai-forecast-scenarios.js${versionQuery}`,
  `./ai-context-profile.js${versionQuery}`,
  `./ai-forecast.js${versionQuery}`,
);

const aiForecast = self.ThinkStockAiForecast;
if (!aiForecast) throw new Error("AI forecast module failed to load in worker");

self.onmessage = (event) => {
  const id = Number(event.data?.id);
  if (!Number.isInteger(id)) return;
  try {
    const forecast = aiForecast.buildForecast(event.data?.options || {});
    self.postMessage({ id, forecast });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error || "AI forecast failed") });
  }
};
