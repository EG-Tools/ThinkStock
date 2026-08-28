import auxiliaryChartModel from "../../docs/modules/auxiliary-chart-model.mjs";
import { auxiliaryChartRuntime } from "../../docs/modules/auxiliary-chart-runtime.mjs";

const auxiliaryChartFeature = Object.freeze({
  model: auxiliaryChartModel,
  runtime: auxiliaryChartRuntime,
});

export { auxiliaryChartFeature, auxiliaryChartModel, auxiliaryChartRuntime };
export default auxiliaryChartFeature;
