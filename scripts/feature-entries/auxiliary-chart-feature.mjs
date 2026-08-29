import auxiliaryChartModel from "../../docs/modules/auxiliary-chart-model.mjs";
import { auxiliaryChartRuntime } from "../../docs/modules/auxiliary-chart-runtime.mjs";
import macd from "../../docs/modules/macd-oscillator.mjs";

const auxiliaryChartFeature = Object.freeze({
  macd,
  model: auxiliaryChartModel,
  runtime: auxiliaryChartRuntime,
});

export { auxiliaryChartFeature, auxiliaryChartModel, auxiliaryChartRuntime, macd };
export default auxiliaryChartFeature;
