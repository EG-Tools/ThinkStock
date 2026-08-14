const versionQuery = new URL(self.location.href).search || "?v=dev";
importScripts(
  `./macd-oscillator.js${versionQuery}`,
  `./ai-forecast-math.js${versionQuery}`,
  `./ai-context-profile.js${versionQuery}`,
  `./market-timing-evaluation.js${versionQuery}`,
  `./market-timing.js${versionQuery}`,
  `./market-timing-service.js${versionQuery}`,
);

const macdModule = self.ThinkStockMacdOscillator;
const contextProfileModule = self.ThinkStockAiContextProfile;
const evaluationModule = self.ThinkStockMarketTimingEvaluation;
const timingModule = self.ThinkStockMarketTiming;
const serviceModule = self.ThinkStockMarketTimingService;
if (!macdModule || !contextProfileModule || !evaluationModule || !timingModule || !serviceModule) {
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
      buildKoreanVolatilityTimingRows: timingModule.buildKoreanVolatilityTimingRows,
      buildExternalVolatilityTimingRows: timingModule.buildExternalVolatilityTimingRows,
      evaluateMarketTimingModel: evaluationModule.evaluateMarketTimingModel,
      buildStructuralStockProfile: contextProfileModule.buildStructuralStockProfile,
    });
    self.postMessage({ id, models });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error || "market timing worker failed") });
  }
};
