importScripts("./ai-forecast.js");

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
