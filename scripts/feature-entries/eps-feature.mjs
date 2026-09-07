import aiAnalysisCache from "../../docs/modules/ai-analysis-cache.mjs";
import { epsChart } from "../../docs/modules/eps-chart.mjs";

// EPS shares the company-analysis record contract, not the forecast engine.
// Keeping that small contract in this lazy bundle prevents the EPS toggle from
// downloading and initializing the full AI feature.
const epsFeature = Object.freeze({
  ...epsChart,
  analysis: aiAnalysisCache,
});

export { epsChart, epsFeature };
export default epsFeature;
