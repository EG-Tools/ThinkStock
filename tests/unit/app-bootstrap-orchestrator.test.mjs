import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppBootstrapOrchestrator,
  createApplicationFeatureLifecycleDescriptors,
  createApplicationLifecycleRuntime,
  createFeatureLifecycleDescriptors,
  createLazyRuntimeRegistry,
  createStartupCompletionGate,
  createStartupTaskRuntime,
} from "../../docs/modules/app-bootstrap-orchestrator.mjs";

test("one feature registry owns refresh and restored activation predicates", () => {
  const enabled = () => true;
  const aiRefresh = () => "refresh";
  const aiRestore = () => "restore";
  const lifecycle = createFeatureLifecycleDescriptors([
    { name: "dart", enabled, restore: () => "dart" },
    { name: "ai", enabled, refresh: aiRefresh, restore: aiRestore },
    { name: "eps", enabled: () => false, refresh: () => "eps" },
  ]);

  assert.deepEqual(lifecycle.optionalRefreshes.map((item) => item.name), ["ai", "eps"]);
  assert.deepEqual(lifecycle.restoredActivations.map((item) => item.name), ["dart", "ai"]);
  assert.equal(lifecycle.optionalRefreshes[0].enabled, enabled);
  assert.equal(lifecycle.optionalRefreshes[0].run, aiRefresh);
  assert.equal(lifecycle.restoredActivations[1].run, aiRestore);
  assert.equal(Object.isFrozen(lifecycle.optionalRefreshes), true);
});

test("application feature lifecycle centralizes restored toggle predicates", () => {
  const calls = [];
  const state = {
    showRecessionSignals: true,
    showDisclosures: false,
    showInsiderTrades: true,
    showAiForecast: true,
    showEps: true,
  };
  const lifecycle = createApplicationFeatureLifecycleDescriptors({
    state,
    canUseInsider: () => true,
    restoreTiming: () => calls.push("timing"),
    restoreDart: () => calls.push("dart"),
    refreshAi: () => calls.push("refresh-ai"),
    restoreAi: () => calls.push("ai"),
    refreshEps: () => calls.push("eps"),
    refreshInsider: () => calls.push("insider"),
  });

  lifecycle.restoredActivations.filter((entry) => entry.enabled()).forEach((entry) => entry.run());
  lifecycle.optionalRefreshes.filter((entry) => entry.enabled()).forEach((entry) => entry.run());

  assert.deepEqual(lifecycle.restoredActivations.map((entry) => entry.name), ["timing", "dart"]);
  assert.deepEqual(lifecycle.optionalRefreshes.map((entry) => entry.name), ["insider", "ai", "eps"]);
  assert.deepEqual(calls, ["timing", "dart", "insider", "refresh-ai", "eps"]);
});

test("runs application startup phases in one deterministic order", async () => {
  const calls = [];
  const messageElement = { id: "messageArea" };
  const orchestrator = createAppBootstrapOrchestrator({
    document: { getElementById: () => messageElement },
    scheduleServiceWorker: () => calls.push("service-worker"),
    loader: {
      show: () => calls.push("loader-show"),
      hide: () => calls.push("loader-hide"),
      progress: (percent) => calls.push(`progress-${percent}`),
    },
    performance: {
      start: () => {
        calls.push("perf-start");
        return 7;
      },
      finishPhase: (label, startedAt) => calls.push(`phase-${label}-${startedAt}`),
      finish: (startedAt) => calls.push(`perf-finish-${startedAt}`),
    },
    setup: () => calls.push("setup"),
    preparePlotly: async () => {
      calls.push("plotly");
      return "ready";
    },
    prepareInitialData: async ({ plotlyReadyTask }) => {
      calls.push(`initial-${(await plotlyReadyTask).plotly}`);
      return "snapshot";
    },
    bindControls: () => calls.push("controls"),
    afterControls: () => calls.push("after-controls"),
    waitForFirstPaint: () => calls.push("paint"),
    refreshDuringStartup: ({ restoredSnapshot }) => calls.push(`refresh-${restoredSnapshot}`),
    scheduleDiagnostics: () => calls.push("diagnostics"),
  });

  await orchestrator.boot();

  assert.deepEqual(calls, [
    "perf-start",
    "service-worker",
    "loader-show",
    "progress-4",
    "perf-start",
    "setup",
    "phase-setup-7",
    "progress-10",
    "perf-start",
    "perf-start",
    "plotly",
    "phase-plotly-7",
    "initial-ready",
    "phase-data-7",
    "perf-start",
    "controls",
    "phase-controls-7",
    "perf-start",
    "after-controls",
    "phase-features-7",
    "perf-start",
    "paint",
    "phase-paint-7",
    "progress-84",
    "perf-start",
    "refresh-snapshot",
    "phase-refresh-7",
    "progress-100",
    "loader-hide",
    "perf-finish-7",
    "diagnostics",
  ]);
});

test("finalizes startup after a top-level failure", async () => {
  const calls = [];
  const failure = new Error("startup failed");
  const orchestrator = createAppBootstrapOrchestrator({
    document: { getElementById: () => null },
    loader: { hide: () => calls.push("hide") },
    setup: () => { throw failure; },
    onError: (_element, error) => calls.push(error.message),
    scheduleDiagnostics: () => calls.push("diagnostics"),
  });

  await orchestrator.boot();
  assert.deepEqual(calls, ["startup failed", "hide", "diagnostics"]);
});

test("application setup and cleanup are each committed once", () => {
  const calls = [];
  const runtime = createApplicationLifecycleRuntime({
    setupSteps: [
      (message) => calls.push(`setup-a:${message.id}`),
      () => calls.push("setup-b"),
    ],
    cleanupSteps: [
      () => calls.push("cleanup-a"),
      () => calls.push("cleanup-b"),
    ],
  });

  assert.equal(runtime.setup({ id: "message" }), true);
  assert.equal(runtime.setup({ id: "ignored" }), false);
  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  assert.deepEqual(calls, ["setup-a:message", "setup-b", "cleanup-a", "cleanup-b"]);
});

test("initial data preserves the active viewport before applying automatic scale", async () => {
  const calls = [];
  const runtime = createApplicationLifecycleRuntime({
    initialData: {
      runtime: {
        async prepareInitialData(options) {
          calls.push("prepare");
          assert.equal(options.needsHistorical(), true);
          await options.renderMain();
          return "snapshot";
        },
      },
      needsHistorical: () => true,
      shouldPreserveViewport: () => true,
      renderMain: (preserve) => calls.push(`render:${preserve}`),
      shouldAutoFit: () => true,
      fitCurrentChart: () => calls.push("fit"),
    },
  });

  assert.equal(await runtime.prepareInitialData({}), "snapshot");
  assert.deepEqual(calls, ["prepare", "render:true", "fit"]);
});

test("runtime refresh runs only enabled optional features in order", async () => {
  const calls = [];
  const runtime = createApplicationLifecycleRuntime({
    refresh: {
      runData: () => calls.push("data"),
      renderMain: (preserve) => calls.push(`render:${preserve}`),
      shouldAutoFit: () => true,
      fitCurrentChart: () => calls.push("fit"),
    },
    optionalRefreshes: [
      { name: "ai", enabled: () => true, run: () => calls.push("ai") },
      { name: "eps", enabled: () => false, run: () => calls.push("eps") },
      { name: "insider", enabled: () => true, run: () => calls.push("insider") },
    ],
  });

  await runtime.refreshRuntime(null, { force: true });
  assert.deepEqual(calls, ["data", "render:true", "fit", "ai", "insider"]);
});

test("manual runtime refresh reconciles the viewport after optional features", async () => {
  const calls = [];
  const runtime = createApplicationLifecycleRuntime({
    refresh: {
      runData: () => calls.push("data"),
      renderAfterData: false,
      reconcileViewport: () => calls.push("reconcile"),
    },
    optionalRefreshes: [
      { name: "eps", enabled: () => true, run: () => calls.push("eps") },
    ],
  });

  await runtime.refreshRuntime(null, { reconcileViewport: true });
  assert.deepEqual(calls, ["data", "eps", "reconcile"]);
});

test("runtime refresh can run independent optional features through a bounded lane", async () => {
  const calls = [];
  const releases = [];
  const runtime = createApplicationLifecycleRuntime({
    runOptionalRefreshes: async (jobs) => {
      const results = [];
      let nextIndex = 0;
      await Promise.all(Array.from({ length: 2 }, async () => {
        while (nextIndex < jobs.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await jobs[index]();
        }
      }));
      return results;
    },
    refresh: { runData: () => calls.push("data"), renderAfterData: false },
    optionalRefreshes: ["insider", "ai", "eps"].map((name) => ({
      name,
      enabled: () => true,
      run: () => new Promise((resolve) => {
        calls.push(`start:${name}`);
        releases.push(() => {
          calls.push(`end:${name}`);
          resolve();
        });
      }),
    })),
  });

  const refresh = runtime.refreshRuntime(null);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ["data", "start:insider", "start:ai"]);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes("start:eps"), true);
  releases.splice(0).forEach((release) => release());
  await Promise.resolve();
  releases.splice(0).forEach((release) => release());
  await refresh;
});

test("restored feature activation does not block the startup sequence", async () => {
  let resolveBackground;
  const background = new Promise((resolve) => { resolveBackground = resolve; });
  const calls = [];
  const runtime = createApplicationLifecycleRuntime({
    restoredActivations: [
      { name: "ai", enabled: () => true, run: () => background.then(() => calls.push("ai")) },
      { name: "eps", enabled: () => false, run: () => calls.push("eps") },
    ],
    afterActivation: () => calls.push("ready"),
  });

  runtime.activateRestoredFeatures();
  assert.deepEqual(calls, ["ready"]);
  resolveBackground();
  await background;
  assert.deepEqual(calls, ["ready", "ai"]);
});

test("restored features can be deferred without delaying control readiness", () => {
  const scheduled = [];
  const calls = [];
  const runtime = createApplicationLifecycleRuntime({
    restoredActivations: [
      { name: "dart", enabled: () => true, run: () => calls.push("dart") },
      { name: "eps", enabled: () => false, run: () => calls.push("eps") },
      { name: "insider", enabled: () => true, run: () => calls.push("insider") },
    ],
    scheduleRestoredActivation: (task, context) => scheduled.push({ task, context }),
    afterActivation: () => calls.push("ready"),
  });

  runtime.activateRestoredFeatures();
  assert.deepEqual(calls, ["ready"]);
  assert.deepEqual(scheduled.map(({ context }) => [context.feature.name, context.index]), [
    ["dart", 0],
    ["insider", 2],
  ]);
  scheduled.forEach(({ task }) => task());
  assert.deepEqual(calls, ["ready", "dart", "insider"]);
});

test("deferred restored feature skips work when disabled before execution", () => {
  const scheduled = [];
  const calls = [];
  let enabled = true;
  const runtime = createApplicationLifecycleRuntime({
    restoredActivations: [
      { name: "ai", enabled: () => enabled, run: () => calls.push("ai") },
    ],
    scheduleRestoredActivation: (task) => scheduled.push(task),
  });

  runtime.activateRestoredFeatures();
  assert.equal(scheduled.length, 1);
  enabled = false;
  assert.equal(scheduled[0](), false);
  assert.deepEqual(calls, []);
});

test("lazy runtime registry creates services once and disposes them in reverse order", () => {
  const calls = [];
  const registry = createLazyRuntimeRegistry();
  const first = registry.get("first", () => ({ dispose: () => calls.push("first") }));
  const same = registry.get("first", () => ({ dispose: () => calls.push("duplicate") }));
  registry.get("second", () => ({ destroy: () => calls.push("second") }));

  assert.equal(first, same);
  assert.equal(registry.size(), 2);
  assert.equal(registry.peek("first"), first);
  assert.equal(registry.disposeAll(), 2);
  assert.deepEqual(calls, ["second", "first"]);
  assert.equal(registry.size(), 0);
});

test("lazy runtime registry shares async creation and retries after failure", async () => {
  const registry = createLazyRuntimeRegistry();
  let attempts = 0;
  const create = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary failure");
    return { ready: true };
  };

  const failed = registry.getAsync("feature", create);
  assert.equal(registry.has("feature"), true);
  await assert.rejects(failed, /temporary failure/);
  assert.equal(registry.has("feature"), false);

  const first = registry.getAsync("feature", create);
  const second = registry.getAsync("feature", create);
  assert.equal(first, second);
  assert.equal(await first, await second);
  assert.equal(attempts, 2);
  assert.equal(registry.size(), 1);
});

test("lazy runtime registry clears every entry even when one disposer fails", () => {
  const registry = createLazyRuntimeRegistry();
  const calls = [];
  registry.get("first", () => ({ dispose() { calls.push("first"); } }));
  registry.get("second", () => ({ dispose() { calls.push("second"); throw new Error("cleanup failed"); } }));

  assert.throws(() => registry.disposeAll(), /cleanup failed/);
  assert.deepEqual(calls, ["second", "first"]);
  assert.equal(registry.size(), 0);
});

test("startup completion gate releases deferred work and readiness exactly once", async () => {
  const scheduled = [];
  const calls = [];
  const gate = createStartupCompletionGate((task, taskOptions) => scheduled.push({ task, taskOptions }));

  assert.equal(gate.defer(() => calls.push("before-a"), { priority: 4 }), true);
  assert.equal(gate.defer(null), false);
  assert.equal(gate.defer(() => calls.push("before-b")), true);
  assert.equal(gate.pendingCount(), 2);
  assert.equal(gate.isReleased(), false);
  let ready = false;
  const readiness = gate.whenReleased().then((value) => { ready = value; });
  await Promise.resolve();
  assert.equal(ready, false);

  assert.equal(gate.release(), true);
  await readiness;
  assert.equal(ready, true);
  assert.equal(gate.release(), false);
  assert.equal(gate.pendingCount(), 0);
  assert.equal(gate.isReleased(), true);
  assert.equal(scheduled.length, 2);
  assert.deepEqual(scheduled[0].taskOptions, { priority: 4 });
  scheduled.splice(0).forEach(({ task }) => task());
  assert.deepEqual(calls, ["before-a", "before-b"]);

  assert.equal(gate.defer(() => calls.push("after")), true);
  assert.equal(scheduled.length, 1);
  scheduled.shift().task();
  assert.deepEqual(calls, ["before-a", "before-b", "after"]);
});

test("startup completion gate keeps only the latest named task before release", () => {
  const scheduled = [];
  const calls = [];
  const gate = createStartupCompletionGate((task, taskOptions) => scheduled.push({ task, taskOptions }));

  gate.defer(() => calls.push("stale"), { taskName: "cache-maintenance", priority: -10 });
  gate.defer(() => calls.push("latest"), { taskName: "cache-maintenance", priority: -5 });
  gate.defer(() => calls.push("independent"), { taskName: "service-worker" });

  assert.equal(gate.pendingCount(), 2);
  gate.release();
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0].taskOptions.priority, -5);
  scheduled.forEach(({ task }) => task());
  assert.deepEqual(calls, ["latest", "independent"]);
});

test("startup task runtime yields before and after deferred work", async () => {
  const enqueued = [];
  const errors = [];
  const scheduler = {
    enqueue(key, task, options) {
      enqueued.push({ key, task, options });
      return Promise.resolve(true);
    },
  };
  const runtime = createStartupTaskRuntime({
    scheduler,
    recordError: (...args) => errors.push(args),
  });
  const calls = [];

  runtime.defer(() => calls.push("deferred"), { priority: 3 });
  assert.equal(enqueued.length, 0);
  runtime.release();
  assert.equal(enqueued[0].key, "startup-deferred-1");
  assert.equal(enqueued[0].options.priority, 3);
  assert.equal(enqueued[0].options.deferDuringInteraction, false);
  const deferredCheckpoints = [];
  assert.equal(await enqueued[0].task({
    checkpoint: async () => { deferredCheckpoints.push("yield"); },
  }), 1);
  assert.deepEqual(deferredCheckpoints, ["yield", "yield"]);

  assert.deepEqual(calls, ["deferred"]);
  assert.deepEqual(errors, []);
});

test("startup task runtime serializes visible work through the interaction-aware scheduler", () => {
  const enqueued = [];
  const scheduler = {
    enqueue(key, task, options) {
      enqueued.push({ key, task, options });
      return Promise.resolve(true);
    },
  };
  const runtime = createStartupTaskRuntime({ scheduler });

  runtime.defer(() => "visible", { userVisible: true, delayMs: 120 });
  runtime.release();

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].key, "startup-deferred-1");
  assert.deepEqual(enqueued[0].options, {
    delayMs: 120,
    group: "startup-deferred",
    priority: 20,
    deferDuringInteraction: false,
  });
});

test("startup task runtime gives non-visible work a post-visual quiet window", () => {
  const enqueued = [];
  const scheduler = {
    enqueue(key, task, options) {
      enqueued.push({ key, task, options });
      return Promise.resolve(true);
    },
  };
  const runtime = createStartupTaskRuntime({
    scheduler,
    defaultDeferredDelayMs: 650,
  });

  runtime.defer(() => true, { taskName: "maintenance" });
  runtime.defer(() => true, { taskName: "visible", userVisible: true });
  runtime.defer(() => true, { taskName: "explicit", delayMs: 90 });
  runtime.release();

  assert.deepEqual(enqueued.map(({ options }) => options.delayMs), [650, 0, 90]);
});

test("startup task runtime uses stable scheduler keys for named work", () => {
  const enqueued = [];
  const scheduler = {
    enqueue(key, task, options) {
      enqueued.push({ key, task, options });
      return Promise.resolve(true);
    },
  };
  const runtime = createStartupTaskRuntime({ scheduler });

  runtime.defer(() => true, { taskName: "service worker" });
  runtime.release();
  runtime.defer(() => true, { taskName: "service worker" });
  assert.deepEqual(enqueued.map(({ key }) => key), [
    "startup-deferred:service-worker",
    "startup-deferred:service-worker",
  ]);
  assert.equal(enqueued.every(({ options }) => options.coalesceRunning === true), true);
});
