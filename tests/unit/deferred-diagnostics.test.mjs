import assert from "node:assert/strict";
import test from "node:test";


import * as deferredDiagnostics from "../../docs/modules/performance-diagnostics.mjs";

test("uses an injected diagnostics factory without loading another script", async () => {
  const created = { ready: true };
  const loader = deferredDiagnostics.createDeferredDiagnostics({}, {
    createPerformanceDiagnostics: () => created,
  });

  assert.equal(await loader.ensure(), created);
});


test("creates performance diagnostics once on demand", async () => {
  let created = 0;
  const loader = deferredDiagnostics.createDeferredDiagnostics({}, {
    createPerformanceDiagnostics() {
      created += 1;
      return { capture() {} };
    },
  });

  const first = await loader.ensure();
  const second = await loader.ensure();

  assert.equal(first, second);
  assert.equal(created, 1);
  assert.equal(loader.isLoaded(), true);
});

test("forwards automatic capture options after the deferred load", async () => {
  let timer = null;
  let idle = null;
  let received = null;
  const scope = {
    document: {},
    setTimeout(callback) { timer = callback; return 1; },
    requestIdleCallback(callback) { idle = callback; return 2; },
  };
  const loader = deferredDiagnostics.createDeferredDiagnostics(scope, {
    createPerformanceDiagnostics() {
      return {
        startAutomaticCapture(metadata, options) { received = { metadata, options }; },
      };
    },
  });
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

test("routes deferred diagnostics loading through the shared background scheduler", async () => {
  let scheduled = null;
  let received = null;
  const scope = { document: {} };
  const scheduler = {
    enqueue(key, task, options) {
      scheduled = { key, task, options };
      return Promise.resolve(true);
    },
    cancel() {},
  };
  const loader = deferredDiagnostics.createDeferredDiagnostics(scope, {
    scheduler,
    createPerformanceDiagnostics() {
      return {
        startAutomaticCapture(metadata, options) { received = { metadata, options }; },
      };
    },
  });

  loader.scheduleAutomaticCapture(
    { appVersion: "3.13" },
    { delayMs: 12000, priority: -60, captureOptions: { captureOnIdle: false } },
  );
  assert.deepEqual(
    { key: scheduled.key, options: scheduled.options },
    {
      key: "performance-diagnostics-load",
      options: { delayMs: 12000, priority: -60 },
    },
  );
  await scheduled.task();
  assert.equal(received.metadata.appVersion, "3.13");
  assert.equal(received.options.captureOnIdle, false);
});
