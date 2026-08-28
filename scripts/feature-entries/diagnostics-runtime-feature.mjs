import { createPerformanceDiagnostics } from "../../docs/modules/performance-diagnostics.mjs";
import * as deferredDiagnostics from "../../docs/modules/deferred-diagnostics.mjs";
import {
  evaluateChartRenderSeriesBudget,
  evaluatePerformanceBudget,
} from "../../shared/performance-budget.mjs";

const diagnosticsFeature = Object.freeze({
  ...deferredDiagnostics,
  createDeferredDiagnostics(scope = globalThis, options = {}) {
    return deferredDiagnostics.createDeferredDiagnostics(scope, {
      ...options,
      createPerformanceDiagnostics,
      createOptions: {
        ...options.createOptions,
        evaluateBudget: options.createOptions?.evaluateBudget || evaluatePerformanceBudget,
        evaluateChartRenderBudget: options.createOptions?.evaluateChartRenderBudget
          || evaluateChartRenderSeriesBudget,
      },
    });
  },
});

export { diagnosticsFeature as deferredDiagnostics };
export default diagnosticsFeature;
