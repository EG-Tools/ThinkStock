import {
  brokerReportWorkerClient,
  brokerResearchRuntime,
} from "../../docs/modules/broker-research-runtime.mjs";
import brokerReportParser from "../../docs/modules/broker-report-parser.mjs";
import brokerResearchCache from "../../docs/modules/broker-research-cache.mjs";

const brokerResearchFeature = Object.freeze({
  cache: brokerResearchCache,
  parser: brokerReportParser,
  runtime: brokerResearchRuntime,
  worker: brokerReportWorkerClient,
});

if (Object.values(brokerResearchFeature).some((module) => !module)) {
  throw new Error("Broker research feature bundle is incomplete");
}

export { brokerResearchFeature };
export default brokerResearchFeature;
