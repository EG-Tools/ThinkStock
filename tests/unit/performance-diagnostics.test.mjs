import assert from "node:assert/strict";
import test from "node:test";


import * as diagnosticsModule from "../../docs/modules/performance-diagnostics.mjs";


test("captures bounded version diagnostics with storage state", async () => {
  const stored = new Map();
  const scope = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: (key) => stored.delete(key),
    },
    navigator: {
      storage: {
        estimate: async () => ({ usage: 10 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
        persisted: async () => true,
      },
    },
  };
  const performanceApi = {
    summary: () => ({ longTasks: 2, maxLongTask: 120 }),
    getLatestOperations: () => ({ appStartup: { duration: 300 } }),
    getOperationProfiles: () => [{ label: "appStartup", count: 2, p50: 280, p95: 300, max: 320 }],
    getSlowOperations: () => [{ label: "appStartup", duration: 300 }],
  };
  const diagnostics = diagnosticsModule.createPerformanceDiagnostics(scope, {
    performanceApi,
    historyLimit: 3,
    sessionId: "session-a",
  });

  const report = await diagnostics.capture({ appVersion: "0.96", buildVersion: "build-1" });
  await diagnostics.capture({ appVersion: "0.95", buildVersion: "build-0" });
  await diagnostics.capture({ appVersion: "0.94", buildVersion: "build-old" });

  assert.equal(report.storage.persisted, true);
  assert.deepEqual(report.operationProfiles, [
    { label: "appStartup", count: 2, p50: 280, p95: 300, max: 320 },
  ]);
  assert.deepEqual(diagnostics.readHistory().map((item) => item.appVersion), ["0.94", "0.95", "0.96"]);
  assert.match(diagnostics.reportLines(report).join("\n"), /부팅 300ms/);
  assert.match(diagnostics.reportLines(report).join("\n"), /10MB \/ 100MB/);
  diagnostics.clear();
  assert.deepEqual(diagnostics.readHistory(), []);
});

test("exports diagnostics without access tokens, API keys, or secret text", async () => {
  const stored = new Map();
  const diagnostics = diagnosticsModule.createPerformanceDiagnostics({
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value)),
    },
    navigator: {},
  }, {
    sessionId: "safe-export",
    performanceApi: {
      summary: () => ({}),
      getLatestOperations: () => ({}),
      getSlowOperations: () => [],
      getRecentErrors: () => [{
        source: "gateway",
        message: "token=private-value failed https://ecos.bok.or.kr/api/StatisticSearch/private-ecos/xml/kr/1/10",
      }],
    },
  });

  const payload = await diagnostics.exportSnapshot({
    appVersion: "2.76",
    appState: {
      accessToken: "private-token",
      nested: { apiKey: "private-key", renderCount: 7 },
    },
  });
  const text = JSON.stringify(payload);
  assert.equal(text.includes("private-token"), false);
  assert.equal(text.includes("private-key"), false);
  assert.equal(text.includes("private-value"), false);
  assert.equal(text.includes("private-ecos"), false);
  assert.equal(payload.current.appState.nested.renderCount, 7);
});

test("keeps hidden app-state diagnostics when later captures omit them", async () => {
  const stored = new Map();
  const scope = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    navigator: {},
  };
  const diagnostics = diagnosticsModule.createPerformanceDiagnostics(scope, {
    sessionId: "state-log",
    performanceApi: {
      summary: () => ({}),
      getLatestOperations: () => ({}),
      getSlowOperations: () => [],
      getRecentErrors: () => [],
    },
  });

  await diagnostics.capture({
    appVersion: "2.65",
    buildVersion: "local",
    appState: { cacheBytes: 4096, blockedStockCount: 3 },
  });
  await diagnostics.capture({ appVersion: "2.65", buildVersion: "local", reason: "pagehide" });

  assert.deepEqual(diagnostics.readHistory()[0].appState, {
    cacheBytes: 4096,
    blockedStockCount: 3,
  });
});

test("stores the shared performance budget result with each report", async () => {
  const diagnostics = diagnosticsModule.createPerformanceDiagnostics({ navigator: {} }, {
    performanceApi: {
      summary: () => ({ pointerMoves: 20, p95PointerMove: 24 }),
      getLatestOperations: () => ({}),
      getSlowOperations: () => [],
      getRecentErrors: () => [],
    },
    evaluateBudget: () => ({
      ok: false,
      skipped: [],
      violations: [{ metric: "p95PointerMove", actual: 24, limit: 20 }],
    }),
  });
  const report = await diagnostics.capture({ appVersion: "2.47" });
  assert.equal(report.budget.ok, false);
  assert.equal(report.budget.violations[0].metric, "p95PointerMove");
});

test("combines main-chart series-band warnings with the session budget", async () => {
  const diagnostics = diagnosticsModule.createPerformanceDiagnostics({ navigator: {} }, {
    performanceApi: {
      summary: () => ({ renderCharts: 3, p95RenderChart: 100 }),
      getLatestOperations: () => ({}),
      getSlowOperations: () => [],
      getRecentErrors: () => [],
    },
    evaluateBudget: () => ({ ok: true, skipped: [], violations: [] }),
    evaluateChartRenderBudget: (snapshot) => ({
      ok: false,
      skipped: ["chartRenderAverage:6-10"],
      violations: [{
        metric: "chartRenderAverage:2-5",
        actual: snapshot.bySeriesBand["2-5"].averageMs,
        limit: 900,
      }],
    }),
  });
  const report = await diagnostics.capture({
    appVersion: "3.21",
    appState: { chartRender: { bySeriesBand: { "2-5": { averageMs: 901 } } } },
  });

  assert.equal(report.budget.ok, false);
  assert.deepEqual(report.budget.skipped, ["chartRenderAverage:6-10"]);
  assert.equal(report.budget.violations[0].actual, 901);
});


test("keeps separate sessions and compares version percentiles", async () => {
  const stored = new Map();
  const scope = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value)),
    },
    navigator: {},
  };
  const makeDiagnostics = (sessionId, startupDuration) => (
    diagnosticsModule.createPerformanceDiagnostics(scope, {
      sessionId,
      performanceApi: {
        summary: () => ({ p95PointerMove: startupDuration / 10 }),
        getLatestOperations: () => ({ appStartup: { duration: startupDuration } }),
        getOperationProfiles: () => [{
          label: "viewportRangeSync",
          count: 3,
          p50: startupDuration / 3,
          p95: startupDuration / 2,
          max: startupDuration / 2,
        }],
        getSlowOperations: () => [],
      },
    })
  );
  await makeDiagnostics("old", 500).capture({ appVersion: "0.96", buildVersion: "old" });
  const currentA = makeDiagnostics("current-a", 300);
  await currentA.capture({
    appVersion: "0.97",
    buildVersion: "new",
    appState: {
      chartRender: {
        bySeriesBand: {
          "2-5": { renders: 2, averageMs: 100, maximumMs: 140, maximumOverlays: 3, maximumPoints: 1000 },
        },
      },
    },
  });
  await makeDiagnostics("current-b", 400).capture({
    appVersion: "0.97",
    buildVersion: "new",
    appState: {
      chartRender: {
        bySeriesBand: {
          "2-5": { renders: 4, averageMs: 200, maximumMs: 260, maximumOverlays: 5, maximumPoints: 2200 },
        },
      },
    },
  });

  const report = currentA.readHistory().find((item) => item.sessionId === "current-a");
  const comparison = currentA.comparisonFor(report);
  assert.equal(comparison.current.sessions, 2);
  assert.equal(comparison.current.startupP95, 300);
  assert.equal(comparison.current.topOperations[0].label, "viewportRangeSync");
  assert.equal(comparison.current.topOperations[0].sessions, 2);
  assert.equal(comparison.current.topOperations[0].samples, 6);
  assert.deepEqual(comparison.current.chartSeriesBands["2-5"], {
    sessions: 2,
    renders: 6,
    averageMs: 166.7,
    maximumMs: 260,
    maximumOverlays: 5,
    maximumPoints: 2200,
  });
  assert.equal(comparison.previous.appVersion, "0.96");
  assert.match(currentA.reportLines(report, comparison).join("\n"), /이전 0.96/);
});


test("captures automatically after the idle delay", async () => {
  const stored = new Map();
  let scheduled = null;
  const listeners = new Map();
  const scope = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value)),
    },
    navigator: {},
    document: {
      addEventListener: (name, listener) => listeners.set(`document:${name}`, listener),
      removeEventListener: (name) => listeners.delete(`document:${name}`),
      visibilityState: "visible",
    },
    addEventListener: (name, listener) => listeners.set(`window:${name}`, listener),
    removeEventListener: (name) => listeners.delete(`window:${name}`),
    setTimeout: (callback) => {
      scheduled = callback;
      return 1;
    },
    clearTimeout: () => {},
  };
  const diagnostics = diagnosticsModule.createPerformanceDiagnostics(scope, {
    sessionId: "automatic",
    performanceApi: {
      summary: () => ({}),
      getLatestOperations: () => ({ appStartup: { duration: 250 } }),
      getSlowOperations: () => [],
    },
  });
  const stop = diagnostics.startAutomaticCapture(
    { appVersion: "0.97", buildVersion: "new" },
    { delayMs: 1000 },
  );
  scheduled();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(diagnostics.readHistory()[0].reason, "idle");
  stop();
  assert.equal(listeners.size, 0);
});

test("can keep exit diagnostics without scheduling post-boot idle work", async () => {
  const stored = new Map();
  const listeners = new Map();
  let timers = 0;
  const scope = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value)),
    },
    navigator: {},
    document: {
      addEventListener: (name, listener) => listeners.set(`document:${name}`, listener),
      removeEventListener: (name) => listeners.delete(`document:${name}`),
      visibilityState: "visible",
    },
    addEventListener: (name, listener) => listeners.set(`window:${name}`, listener),
    removeEventListener: (name) => listeners.delete(`window:${name}`),
    setTimeout: () => { timers += 1; return timers; },
    clearTimeout: () => {},
  };
  const diagnostics = diagnosticsModule.createPerformanceDiagnostics(scope, {
    sessionId: "exit-only",
    performanceApi: {
      summary: () => ({}),
      getLatestOperations: () => ({}),
      getSlowOperations: () => [],
      getRecentErrors: () => [],
    },
  });

  const stop = diagnostics.startAutomaticCapture(
    { appVersion: "3.13" },
    { captureOnIdle: false, minimumIntervalMs: 1000 },
  );
  assert.equal(timers, 0);
  listeners.get("window:pagehide")();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(diagnostics.readHistory()[0].reason, "pagehide");
  stop();
  assert.equal(listeners.size, 0);
});

test("merges fresh runtime state from an automatic metadata provider", async () => {
  const stored = new Map();
  let scheduled = null;
  const scope = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value)),
    },
    navigator: {},
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (callback) => { scheduled = callback; return 1; },
    clearTimeout() {},
  };
  const diagnostics = diagnosticsModule.createPerformanceDiagnostics(scope, {
    sessionId: "automatic-state",
    performanceApi: {
      summary: () => ({}),
      getLatestOperations: () => ({}),
      getSlowOperations: () => [],
      getRecentErrors: () => [],
    },
  });
  diagnostics.startAutomaticCapture(
    { appVersion: "2.69", appState: { staticValue: 1 } },
    {
      delayMs: 1000,
      metadataProvider: async ({ reason }) => ({
        appState: { reasonSeen: reason, renderCount: 7 },
      }),
    },
  );
  scheduled();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(diagnostics.readHistory()[0].appState, {
    staticValue: 1,
    reasonSeen: "idle",
    renderCount: 7,
  });
});
