import auxiliaryChartModel from "./auxiliary-chart-model.mjs?v=dev";
import mainChartModel from "./main-chart-model.mjs?v=dev";
import { attachChartModelWorker } from "./chart-model-worker-runtime.mjs?v=dev";

attachChartModelWorker(globalThis, {
  auxiliaryChartModel,
  mainChartModel,
});
