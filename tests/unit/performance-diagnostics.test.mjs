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
    historyLimit: 2,
  });

  const report = await diagnostics.capture({ appVersion: "0.96", buildVersion: "build-1" });
  await diagnostics.capture({ appVersion: "0.95", buildVersion: "build-0" });
  await diagnostics.capture({ appVersion: "0.94", buildVersion: "build-old" });

  assert.equal(report.storage.persisted, true);
  assert.deepEqual(diagnostics.readHistory().map((item) => item.appVersion), ["0.94", "0.95"]);
  assert.match(diagnostics.reportLines(report).join("\n"), /부팅 300ms/);
  assert.match(diagnostics.reportLines(report).join("\n"), /10MB \/ 100MB/);
  diagnostics.clear();
  assert.deepEqual(diagnostics.readHistory(), []);
});
