import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppFeatureRuntime,
  createDeferredChartRenderTelemetryFacade,
  createDeferredDiagnosticsFacade,
  resolveTickerDartPreloadPlan,
} from "../../docs/modules/optional-feature-runtime.mjs";

function createRegistry() {
  const values = new Map();
  return {
    get(key, factory) {
      if (!values.has(key)) values.set(key, factory());
      return values.get(key);
    },
    async getAsync(key, factory) {
      if (!values.has(key)) values.set(key, await factory());
      return values.get(key);
    },
    peek: (key) => values.get(key),
  };
}

test("loads each optional app feature behind one explicit registry boundary", async () => {
  const calls = [];
  const dartRequests = { run() {} };
  const aiFeature = { forecast: { buildForecast() {} } };
  const brokerResearchFeature = { runtime: { createBrokerResearchRuntime() {} } };
  const dartFeature = {
    insiderTrades: {
      sanitizeRows: (rows) => rows.filter(Boolean),
      mergeRowsWithChange: (existing, incoming) => ({ rows: [...existing, ...incoming], changed: true }),
    },
    requestRuntime: {
      createDartRequestRuntime: (registry) => {
        calls.push(["dart-requests", registry]);
        return dartRequests;
      },
      normalizeDartTicker: (value, pattern) => {
        const ticker = String(value || "").trim().toUpperCase();
        return pattern.test(ticker) ? ticker : "";
      },
      resolveDartCompanyContext: async (ticker) => ({ ticker }),
      fetchProgressiveRecords: async (value) => [value],
      toDartGatewayError: (error) => new Error(`DART: ${error.message}`),
    },
  };
  const requestRegistry = { run() {} };
  const runtime = createAppFeatureRuntime({
    registry: createRegistry(),
    keys: {
      aiFeature: "ai",
      aiForecastApp: "ai-app",
      brokerResearchFeature: "broker-feature",
      dartFeature: "dart",
      dartRequests: "dart-requests",
      epsFeature: "eps",
      marketTiming: "timing",
    },
    optional: {
      ensureAi: async () => { calls.push("ai"); return aiFeature; },
      ensureBrokerResearch: async () => {
        calls.push("broker");
        return brokerResearchFeature;
      },
      ensureDart: async () => { calls.push("dart"); return dartFeature; },
      ensureEps: async () => { calls.push("eps"); return { chart: true }; },
      ensureMarketTiming: async () => { calls.push("timing"); return { timing: true }; },
    },
    requestRegistry,
    dartTickerPattern: /^\d{6}\.(KS|KQ)$/,
    createAiApp: (feature) => ({ feature }),
  });

  assert.equal(await runtime.ensureAi(), aiFeature.forecast);
  assert.equal(await runtime.ensureAi(), aiFeature.forecast);
  assert.equal(runtime.requireAi(), aiFeature);
  assert.equal(await runtime.ensureBrokerResearch(), brokerResearchFeature);
  assert.equal(runtime.requireBrokerResearch(), brokerResearchFeature);
  assert.deepEqual(await runtime.ensureEps(), { chart: true });
  assert.equal(runtime.getDartRequests(), dartRequests);
  assert.equal(runtime.getDartRequests(), dartRequests);
  assert.equal(runtime.normalizeDartTicker(" 005930.ks "), "005930.KS");
  assert.equal(runtime.normalizeDartTicker("^KS11"), "");
  assert.deepEqual(await runtime.resolveDartCompanyContext("005930.KS"), { ticker: "005930.KS" });
  assert.deepEqual(await runtime.fetchProgressiveRecords("page"), ["page"]);
  assert.match(runtime.toDartGatewayError(new Error("failed")).message, /^DART:/);
  assert.deepEqual(runtime.sanitizeInsiderRows([null, { ticker: "005930.KS" }]), [{ ticker: "005930.KS" }]);
  assert.deepEqual(runtime.mergeInsiderRowsWithChange([1], [2]), { rows: [1, 2], changed: true });
  assert.deepEqual(await runtime.ensureMarketTiming(), { timing: true });
  assert.deepEqual(calls, ["ai", "broker", "dart", "eps", ["dart-requests", requestRegistry], "timing"]);
});

test("rejects access before a required feature has loaded", () => {
  const runtime = createAppFeatureRuntime({
    registry: createRegistry(),
    keys: {},
    optional: {
      ensureAi: async () => ({}),
      ensureBrokerResearch: async () => ({}),
      ensureDart: async () => ({}),
      ensureEps: async () => ({}),
      ensureMarketTiming: async () => ({}),
    },
  });
  assert.throws(() => runtime.requireAi(), /AI feature is not loaded/);
  assert.throws(() => runtime.requireBrokerResearch(), /Broker research feature is not loaded/);
  assert.throws(() => runtime.requireDart(), /DART feature is not loaded/);
});

test("loads ticker DART data only for visible DART or AI features", () => {
  assert.deepEqual(resolveTickerDartPreloadPlan({}), {
    disclosures: false,
    insiders: false,
    required: false,
  });
  assert.deepEqual(resolveTickerDartPreloadPlan({ showAiForecast: true }), {
    disclosures: true,
    insiders: false,
    required: true,
  });
  assert.deepEqual(resolveTickerDartPreloadPlan({ showInsiderTrades: true }), {
    disclosures: false,
    insiders: true,
    required: true,
  });
  assert.deepEqual(resolveTickerDartPreloadPlan({ showDisclosures: true }), {
    disclosures: true,
    insiders: false,
    required: true,
  });
});

test("owns deferred diagnostics loading and scheduling behind one facade", async () => {
  const registry = createRegistry();
  const scheduled = [];
  const diagnostics = { startAutomaticCapture: () => "captured" };
  const runtime = {
    ensure: async () => diagnostics,
    cancelScheduledCapture() {},
  };
  const facade = createDeferredDiagnosticsFacade(globalThis, {
    registry,
    runtimeKey: "diagnostics",
    performanceApi: { summary() {} },
    optional: {
      ensureDiagnostics: async () => ({
        createDeferredDiagnostics: (_scope, options) => {
          assert.equal(typeof options.createOptions.performanceApi.summary, "function");
          return runtime;
        },
      }),
    },
    scheduler: {
      enqueue(key, task, options) {
        scheduled.push({ key, task, options });
        return Promise.resolve(true);
      },
      cancel() {},
    },
  });

  assert.equal(await facade.ensure(), diagnostics);
  facade.scheduleAutomaticCapture({}, { delayMs: 1200, priority: -5 });
  assert.deepEqual(scheduled[0].options, { delayMs: 1200, priority: -5 });
  assert.equal(await scheduled[0].task(), "captured");
});

test("keeps chart render telemetry inert until diagnostics attach", () => {
  const facade = createDeferredChartRenderTelemetryFacade();
  assert.equal(facade.begin({ traceCount: 2 }), null);
  assert.equal(facade.complete(null, { mode: "full" }), 0);
  assert.equal(facade.snapshot().total, 0);
  assert.equal(facade.isLoaded(), false);

  const calls = [];
  facade.attach({
    createChartRenderTelemetry(scope) {
      assert.equal(scope.marker, "scope");
      return {
        begin(invalidation) {
          calls.push(["begin", invalidation.traceCount]);
          return { started: true };
        },
        complete(token, result) {
          calls.push(["complete", token.started, result.mode]);
          return 4;
        },
        snapshot: () => ({ total: calls.length, counts: { full: 1 }, recent: [] }),
      };
    },
  }, { marker: "scope" });

  const token = facade.begin({ traceCount: 3 });
  assert.equal(facade.complete(token, { mode: "full" }), 4);
  assert.equal(facade.snapshot().total, 2);
  assert.equal(facade.isLoaded(), true);
  assert.deepEqual(calls, [["begin", 3], ["complete", true, "full"]]);
});
