import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/performance-diagnostics.js");
const diagnosticsModule = globalThis.ThinkStockPerformanceDiagnostics;


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
  assert.deepEqual(diagnostics.readHistory().map((item) => item.appVersion), ["0.94", "0.95", "0.96"]);
  assert.match(diagnostics.reportLines(report).join("\n"), /부팅 300ms/);
  assert.match(diagnostics.reportLines(report).join("\n"), /10MB \/ 100MB/);
  diagnostics.clear();
  assert.deepEqual(diagnostics.readHistory(), []);
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
        getSlowOperations: () => [],
      },
    })
  );
  await makeDiagnostics("old", 500).capture({ appVersion: "0.96", buildVersion: "old" });
  const currentA = makeDiagnostics("current-a", 300);
  await currentA.capture({ appVersion: "0.97", buildVersion: "new" });
  await makeDiagnostics("current-b", 400).capture({ appVersion: "0.97", buildVersion: "new" });

  const report = currentA.readHistory().find((item) => item.sessionId === "current-a");
  const comparison = currentA.comparisonFor(report);
  assert.equal(comparison.current.sessions, 2);
  assert.equal(comparison.current.startupP95, 300);
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
