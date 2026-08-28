import assert from "node:assert/strict";
import test from "node:test";

import { createChartRenderScheduler } from "../../docs/modules/chart-update-coordinator.mjs";

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

  assert.equal(renders.length, 1);
  assert.deepEqual(renders[0].reasons, ["viewport-pan", "event-marker-data"]);
  assert.deepEqual(renders[0].updateClasses, ["viewport", "markers"]);
  assert.equal(renders[0].transactionId, 1);
  assert.equal(renders[0].requestCount, 2);
  assert.equal(renders[0].shouldAbort(), false);
  assert.equal(scheduler.stats().coalescedRequests, 1);
  assert.equal(scheduler.stats().lastTransactionId, 1);
  assert.equal(scheduler.stats().completedTransactionId, 1);
});

test("an immediate render absorbs and cancels an older queued frame", async () => {
  const frames = new Map();
  const cancelled = [];
  const renders = [];
  let nextFrameId = 1;
  const scheduler = createChartRenderScheduler({}, {
    requestFrame: (callback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      cancelled.push(id);
      frames.delete(id);
    },
    render: async (preserveZoom, invalidation) => {
      renders.push({ preserveZoom, reasons: invalidation.reasons });
    },
  });

  scheduler.request(true, { reason: "older-layout", updateClass: "viewport" });
  await scheduler.run(false);

  assert.deepEqual(cancelled, [1]);
  assert.equal(frames.size, 0);
  assert.deepEqual(renders, [{ preserveZoom: false, reasons: ["older-layout"] }]);
  assert.equal(scheduler.stats().framePending, false);
});

test("an explicit render cannot be downgraded to queued marker-only work", async () => {
  const frames = new Map();
  const renders = [];
  let nextFrameId = 1;
  const scheduler = createChartRenderScheduler({}, {
    requestFrame: (callback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    render: async (preserveZoom, invalidation) => {
      renders.push({
        preserveZoom,
        reasons: invalidation.reasons,
        updateClasses: invalidation.updateClasses,
      });
    },
  });

  scheduler.request(true, { reason: "event-marker-data", updateClass: "markers" });
  await scheduler.run(false);

  assert.equal(frames.size, 0);
  assert.deepEqual(renders, [{
    preserveZoom: false,
    reasons: ["event-marker-data", "immediate"],
    updateClasses: ["markers", "data"],
  }]);
});

test("marks an in-flight data transaction stale and runs one replacement", async () => {
  const frames = [];
  const invalidations = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const scheduler = createChartRenderScheduler({}, {
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    render: async (_preserveZoom, invalidation) => {
      invalidations.push(invalidation);
      if (invalidations.length === 1) await firstGate;
    },
  });

  scheduler.request(true, { reason: "price", updateClass: "data" });
  frames.shift()();
  await Promise.resolve();
  scheduler.request(true, { reason: "viewport", updateClass: "viewport" });
  assert.equal(invalidations[0].shouldAbort(), true);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(invalidations.length, 2);
  assert.deepEqual(invalidations[1].reasons, ["viewport"]);
  assert.equal(scheduler.stats().supersededTransactions, 1);
  assert.equal(scheduler.stats().lastTransactionId, 2);
  assert.equal(scheduler.stats().completedTransactionId, 2);
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

test("deferred marker work stays marker-only instead of gaining a phantom data request", async () => {
  let busy = true;
  let timerCallback = null;
  const frames = [];
  const renders = [];
  const scheduler = createChartRenderScheduler({}, {
    deferDelayMs: 50,
    isInteractionBusy: () => busy,
    setTimer: (callback) => { timerCallback = callback; return 1; },
    clearTimer: () => {},
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    render: async (_preserveZoom, invalidation) => renders.push(invalidation),
  });
  scheduler.request(true, { reason: "disclosure-toggle", updateClass: "markers" });
  busy = false;
  timerCallback();
  frames.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(renders[0].reasons, ["disclosure-toggle"]);
  assert.deepEqual(renders[0].updateClasses, ["markers"]);
  assert.equal(renders[0].requestCount, 1);
  assert.equal(scheduler.stats().invalidationCounts.data || 0, 0);
});

test("whenSettled waits through rendering and final layout work", async () => {
  const frames = [];
  let releaseLayout;
  const layoutGate = new Promise((resolve) => { releaseLayout = resolve; });
  const scheduler = createChartRenderScheduler({}, {
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    render: async () => {},
    afterBatch: () => layoutGate,
  });

  scheduler.request(true);
  let settled = false;
  const waiting = scheduler.whenSettled().then(() => { settled = true; });
  frames.shift()();
  await Promise.resolve();
  assert.equal(settled, false);
  releaseLayout();
  await waiting;
  assert.equal(settled, true);
});
