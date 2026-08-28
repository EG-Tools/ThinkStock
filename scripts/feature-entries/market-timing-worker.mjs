import macd from "../../docs/modules/macd-oscillator.mjs";
import "../../docs/modules/ai-forecast-math.js";
import "../../docs/modules/ai-context-profile.js";
import evaluation from "../../docs/modules/market-timing-evaluation.mjs";
import timing from "../../docs/modules/market-timing.mjs";
import timingService from "../../docs/modules/market-timing-service.mjs";

const contextProfile = globalThis.ThinkStockAiContextProfile;

delete globalThis.ThinkStockAiForecastMath;
delete globalThis.ThinkStockAiContextProfile;

if (!macd || !contextProfile || !evaluation || !timing || !timingService) {
  throw new Error("market timing worker dependencies are incomplete");
}

let sourceSignature = "";
let sourceCache = null;

globalThis.onmessage = (event) => {
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
    const models = timingService.buildTimingModels({
      sources: sourceCache,
      targets: event.data?.targets,
      buildMacdOscillator: macd.buildMacdOscillator,
      buildMarketTimingSignals: timing.buildMarketTimingSignals,
      buildKoreanVolatilityTimingRows: timing.buildKoreanVolatilityTimingRows,
      buildExternalVolatilityTimingRows: timing.buildExternalVolatilityTimingRows,
      evaluateMarketTimingModel: evaluation.evaluateMarketTimingModel,
      buildStructuralStockProfile: contextProfile.buildStructuralStockProfile,
    });
    globalThis.postMessage({ id, models });
  } catch (error) {
    globalThis.postMessage({
      id,
      error: String(error?.message || error || "market timing worker failed"),
    });
  }
};
