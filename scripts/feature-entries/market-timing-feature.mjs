import { coMovement } from "../../docs/modules/co-movement.mjs";
import evaluation from "../../docs/modules/market-timing-evaluation.mjs";
import macd from "../../docs/modules/macd-oscillator.mjs";
import timing from "../../docs/modules/market-timing.mjs";
import service from "../../docs/modules/market-timing-service.mjs";

if (!evaluation || !macd || !timing || !service) {
  throw new Error("market timing feature dependencies are incomplete");
}

const marketTimingFeature = Object.freeze({
  coMovement,
  evaluation,
  macd,
  service,
  timing,
});

export { marketTimingFeature };
export default marketTimingFeature;
