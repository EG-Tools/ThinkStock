import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-render-scheduler.js");

const { createChartRenderScheduler } = globalThis.ThinkStockChartRenderScheduler;

test("coalesces render requests and lets reset-range requests win", async () => {
  const frames = [];
  const renders = [];
  const scheduler = createChartRenderScheduler({}, {
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    render: async (preserveZoom) => { renders.push(preserveZoom); },
  });

  scheduler.request(true);
  scheduler.request(false);
  scheduler.request(true);
  assert.equal(frames.length, 1);
  frames.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(renders, [false]);
});

test("coalesces typed invalidations and passes one combined render description", async () => {
  const frames = [];
  const renders = [];
  const scheduler = createChartRenderScheduler({}, {
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    render: async (_preserveZoom, invalidation) => { renders.push(invalidation); },
  });

  scheduler.request(true, { reason: "viewport-pan", updateClass: "viewport" });
  scheduler.request(true, { reason: "event-marker-data", updateClass: "markers" });
  frames.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(renders, [{
    reasons: ["viewport-pan", "event-marker-data"],
    updateClasses: ["viewport", "markers"],
  }]);
  assert.equal(scheduler.stats().coalescedRequests, 1);
});

test("defers rendering while chart interaction is active", () => {
  let busy = true;
  let timerCallback = null;
  const scheduler = createChartRenderScheduler({}, {
    deferDelayMs: 50,
    isInteractionBusy: () => busy,
    setTimer: (callback) => { timerCallback = callback; return 1; },
    clearTimer: () => {},
    requestFrame: () => 1,
    render: async () => {},
  });
  scheduler.request(true);
  assert.equal(scheduler.stats().deferred, true);
  busy = false;
  timerCallback();
  assert.equal(scheduler.stats().framePending, true);
});
