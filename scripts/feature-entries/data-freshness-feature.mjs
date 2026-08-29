import * as dataHealth from "../../docs/modules/data-health.mjs";
import { createDataFreshnessController } from "../../docs/modules/data-freshness-controller.mjs";

const dataFreshnessFeature = Object.freeze({
  createController: createDataFreshnessController,
  dataHealth,
});

export { dataFreshnessFeature };
export default dataFreshnessFeature;
