import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/performance-monitor.js");
const { createPerformanceMonitor } = globalThis.ThinkStockPerformanceMonitor;


function createScope(search = "") {
  let now = 100;
  let rafSequence = 0;
  const rafCallbacks = new Map();
  const stored = new Map();
  const observerInstances = [];
  class PerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observerInstances.push(this);
    }
    observe(options) {
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const scope = {
    location: { search },
    document: { visibilityState: "visible" },
    performance: { now: () => now },
    PerformanceObserver,
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: (key) => stored.delete(key),
    },
    requestAnimationFrame(callback) {
      const id = ++rafSequence;
      rafCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      rafCallbacks.delete(id);
    },
    console: { debug() {} },
  };
  return {
    scope,
    stored,
    setNow(value) { now = value; },
    runFrame(timestamp) {
      const [id, callback] = rafCallbacks.entries().next().value || [];
      assert.equal(typeof callback, "function");
      rafCallbacks.delete(id);
      callback(timestamp);
    },
    pendingFrames: () => rafCallbacks.size,
    emitLongTasks(entries) {
      observerInstances.at(-1)?.callback?.({ getEntries: () => entries });
    },
    observers: observerInstances,
  };
}


test("records samples and uses percentile frame timing", () => {
  const harness = createScope("?perf=1");
  const monitor = createPerformanceMonitor(harness.scope);
  const api = monitor.init();
  assert.equal(monitor.isEnabled(), true);
  assert.equal(harness.scope.ThinkStockPerf, api);

  const startedAt = monitor.startSample();
  harness.setNow(112.34);
  monitor.recordSample("pointerMove", startedAt, { chart: "main" });
  harness.runFrame(100);
  harness.runFrame(116);
  harness.runFrame(132);
  harness.runFrame(700);
  harness.runFrame(1800); // Suspended execution is excluded from frame statistics.
  harness.runFrame(1816);

  assert.deepEqual(api.get().map((sample) => sample.label), ["pointerMove"]);
  assert.deepEqual(api.summary(), {
    frames: 4,
    longFrames: 1,
    maxFrameGap: 568,
    p95FrameGap: 16,
    longFrameRatio: 0.25,
    longTasks: 0,
    p95LongTask: 0,
    maxLongTask: 0,
    latestLongTaskSource: "",
    pointerMoves: 1,
    p95PointerMove: 12.3,
    maxPointerMove: 12.3,
    renderCharts: 0,
    p95RenderChart: 0,
    auxiliaryRenders: 0,
    p95AuxiliaryRender: 0,
    runtimeRefreshes: 0,
    maxRuntimeRefresh: 0,
    appStarts: 0,
    p95AppStartup: 0,
    slowOperations: 0,
    latestSlowOperation: "",
  });
});


test("persists enable state and stops frame monitoring when disabled", () => {
  const harness = createScope();
  const monitor = createPerformanceMonitor(harness.scope);
  const api = monitor.init();
  assert.equal(monitor.isEnabled(), false);
  assert.equal(monitor.startSample(), 100);

  assert.equal(api.enable(), true);
  assert.equal(harness.stored.get("thinkstock-perf-debug"), "1");
  assert.equal(harness.pendingFrames(), 1);
  assert.equal(api.disable(), false);
  assert.equal(harness.stored.has("thinkstock-perf-debug"), false);
  assert.equal(harness.pendingFrames(), 0);
  assert.equal(harness.observers[0].disconnected, false);
});


test("caps retained operation samples", () => {
  const harness = createScope("?perf=1");
  const monitor = createPerformanceMonitor(harness.scope, { sampleLimit: 2 });
  const api = monitor.init();
  [1, 2, 3].forEach((value) => {
    harness.setNow(100 + value);
    monitor.recordSample(`sample-${value}`, 100);
  });
  assert.deepEqual(api.get().map((sample) => sample.label), ["sample-2", "sample-3"]);
});


test("records bounded browser long tasks with attribution", () => {
  const harness = createScope("?perf=1");
  const monitor = createPerformanceMonitor(harness.scope, { longTaskSampleLimit: 2 });
  const api = monitor.init();

  harness.emitLongTasks([
    { duration: 55.54, startTime: 10, name: "self", attribution: [] },
    {
      duration: 81.25,
      startTime: 20,
      name: "self",
      attribution: [{ containerId: "chart" }],
    },
    { duration: 120.04, startTime: 30, name: "self", attribution: [] },
  ]);

  assert.deepEqual(api.getLongTasks(), [
    { duration: 81.3, startTime: 20, source: "chart" },
    { duration: 120, startTime: 30, source: "self" },
  ]);
  assert.deepEqual(api.summary(), {
    frames: 0,
    longFrames: 0,
    maxFrameGap: 0,
    p95FrameGap: 0,
    longFrameRatio: 0,
    longTasks: 2,
    p95LongTask: 81.3,
    maxLongTask: 120,
    latestLongTaskSource: "self",
    pointerMoves: 0,
    p95PointerMove: 0,
    maxPointerMove: 0,
    renderCharts: 0,
    p95RenderChart: 0,
    auxiliaryRenders: 0,
    p95AuxiliaryRender: 0,
    runtimeRefreshes: 0,
    maxRuntimeRefresh: 0,
    appStarts: 0,
    p95AppStartup: 0,
    slowOperations: 0,
    latestSlowOperation: "",
  });
});


test("keeps a bounded slow-operation trail without debug mode", () => {
  const harness = createScope();
  const monitor = createPerformanceMonitor(harness.scope, {
    slowOperationMs: 20,
    slowSampleLimit: 2,
  });
  const api = monitor.init();

  [10, 30, 40].forEach((duration, index) => {
    harness.setNow(100);
    const startedAt = monitor.startSample();
    harness.setNow(100 + duration);
    monitor.recordSample(`operation-${index}`, startedAt);
  });

  assert.deepEqual(api.get(), []);
  assert.deepEqual(
    api.getSlowOperations().map((sample) => sample.label),
    ["operation-1", "operation-2"],
  );
  assert.equal(api.summary().slowOperations, 2);
  assert.equal(api.summary().latestSlowOperation, "operation-2");
});
