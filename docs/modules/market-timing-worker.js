importScripts(
  "./macd-oscillator.js?v=dev",
  "./market-timing.js?v=dev",
  "./market-timing-service.js?v=dev",
);

const macdModule = self.ThinkStockMacdOscillator;
const timingModule = self.ThinkStockMarketTiming;
const serviceModule = self.ThinkStockMarketTimingService;
if (!macdModule || !timingModule || !serviceModule) {
  throw new Error("market timing worker dependencies failed to load");
}

let sourceSignature = "";
let sourceCache = null;

self.onmessage = (event) => {
  const id = Number(event.data?.id);
  if (!Number.isInteger(id)) return;
  try {
    const signature = String(event.data?.signature || "");
    if (event.data?.sources) {
      sourceSignature = signature;
      sourceCache = event.data.sources;
    }
    if (!sourceCache || sourceSignature !== signature) {
      throw new Error("market timing worker source cache miss");
    }
    const models = serviceModule.buildTimingModels({
      sources: sourceCache,
      targets: event.data?.targets,
      buildMacdOscillator: macdModule.buildMacdOscillator,
      buildMarketTimingSignals: timingModule.buildMarketTimingSignals,
    });
    self.postMessage({ id, models });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error || "market timing worker failed") });
  }
};
