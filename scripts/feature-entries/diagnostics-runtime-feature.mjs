import {
  createDeferredDiagnostics as createDeferredDiagnosticsRuntime,
  createPerformanceDiagnostics,
} from "../../docs/modules/performance-diagnostics.mjs";
import { createChartRenderTelemetry } from "../../docs/modules/performance-monitor.mjs";
import {
  evaluateChartRenderSeriesBudget,
  evaluatePerformanceBudget,
} from "../../shared/performance-budget.mjs";

const diagnosticsFeature = Object.freeze({
  createChartRenderTelemetry,
  createDeferredDiagnostics(scope = globalThis, options = {}) {
    return createDeferredDiagnosticsRuntime(scope, {
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
