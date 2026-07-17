import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/performance-monitor.js");
const { createPerformanceMonitor } = globalThis.ThinkStockPerformanceMonitor;


function createScope(search = "") {
  let now = 100;
  let rafSequence = 0;
  const rafCallbacks = new Map();
  const stored = new Map();
  const scope = {
    location: { search },
    document: { visibilityState: "visible" },
    performance: { now: () => now },
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
    pointerMoves: 1,
    p95PointerMove: 12.3,
    maxPointerMove: 12.3,
    renderCharts: 0,
    p95RenderChart: 0,
    auxiliaryRenders: 0,
    p95AuxiliaryRender: 0,
    runtimeRefreshes: 0,
    maxRuntimeRefresh: 0,
  });
});


test("persists enable state and stops frame monitoring when disabled", () => {
  const harness = createScope();
  const monitor = createPerformanceMonitor(harness.scope);
  const api = monitor.init();
  assert.equal(monitor.isEnabled(), false);
  assert.equal(monitor.startSample(), 0);

  assert.equal(api.enable(), true);
  assert.equal(harness.stored.get("thinkstock-perf-debug"), "1");
  assert.equal(harness.pendingFrames(), 1);
  assert.equal(api.disable(), false);
  assert.equal(harness.stored.has("thinkstock-perf-debug"), false);
  assert.equal(harness.pendingFrames(), 0);
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
