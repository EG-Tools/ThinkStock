import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/deferred-diagnostics.js");
const deferredDiagnostics = globalThis.ThinkStockDeferredDiagnostics;


test("loads performance diagnostics once on demand", async () => {
  let appended = 0;
  let created = 0;
  const scope = {
    document: {
      querySelector() { return null; },
      createElement() {
        const listeners = {};
        return {
          dataset: {},
          addEventListener(type, listener) { listeners[type] = listener; },
          dispatch(type) { listeners[type]?.(); },
        };
      },
      head: {
        appendChild(script) {
          appended += 1;
          scope.ThinkStockPerformanceDiagnostics = {
            createPerformanceDiagnostics() {
              created += 1;
              return { capture() {} };
            },
          };
          script.dispatch("load");
        },
      },
    },
  };
  const loader = deferredDiagnostics.createDeferredDiagnostics(scope, {
    scriptUrl: "./performance-diagnostics.js",
  });

  const first = await loader.ensure();
  const second = await loader.ensure();

  assert.equal(first, second);
  assert.equal(appended, 1);
  assert.equal(created, 1);
  assert.equal(loader.isLoaded(), true);
});

test("forwards automatic capture options after the deferred load", async () => {
  let timer = null;
  let idle = null;
  let received = null;
  const scope = {
    ThinkStockPerformanceDiagnostics: {
      createPerformanceDiagnostics() {
        return {
          startAutomaticCapture(metadata, options) { received = { metadata, options }; },
        };
      },
    },
    document: {},
    setTimeout(callback) { timer = callback; return 1; },
    requestIdleCallback(callback) { idle = callback; return 2; },
  };
  const loader = deferredDiagnostics.createDeferredDiagnostics(scope);
  const metadataProvider = () => ({ appState: { renders: 2 } });
  loader.scheduleAutomaticCapture(
    { appVersion: "2.69" },
    { delayMs: 1000, captureOptions: { metadataProvider } },
  );
  timer();
  idle();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(received.metadata.appVersion, "2.69");
  assert.equal(received.options.metadataProvider, metadataProvider);
});
