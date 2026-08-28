import assert from "node:assert/strict";
import test from "node:test";

import { createLatestKeyedFrameQueue } from "../../docs/modules/chart-update-coordinator.mjs";

test("coalesces each target to its latest value inside one frame", async () => {
  let frame = null;
  const batches = [];
  const queue = createLatestKeyedFrameQueue({}, {
    requestFrame: (callback) => { frame = callback; return 1; },
    cancelFrame: () => {},
    apply: async (batch) => { batches.push(batch); },
  });

  queue.schedule("main", { value: 1 });
  queue.schedule("main", { value: 2 });
  queue.schedule("aux", { value: 3 });
  frame();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(batches, [[{ value: 2 }, { value: 3 }]]);
  assert.equal(queue.stats().coalesced, 1);
});

test("waits for an active relayout before applying the newest pending batch", async () => {
  const frames = [];
  const batches = [];
  let releaseFirst;
  const queue = createLatestKeyedFrameQueue({}, {
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    apply: async (batch) => {
      batches.push(batch);
      if (batches.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    },
  });

  queue.schedule("chart", 1);
  frames.shift()();
  await Promise.resolve();
  queue.schedule("chart", 2);
  queue.schedule("chart", 3);
  assert.equal(frames.length, 0);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(frames.length, 1);
  frames.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(batches, [[1], [3]]);
});

test("flush drains the active batch and the newest companion ranges", async () => {
  const frames = [];
  const batches = [];
  let releaseFirst;
  const queue = createLatestKeyedFrameQueue({}, {
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    apply: async (batch) => {
      batches.push(batch);
      if (batches.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    },
  });

  queue.schedule("macd", { value: 1 });
  frames.shift()();
  await Promise.resolve();
  queue.schedule("macd", { value: 2 });
  queue.schedule("adr", { value: 3 });
  const flushed = queue.flush();
  releaseFirst();
  await flushed;

  assert.deepEqual(batches, [
    [{ value: 1 }],
    [{ value: 2 }, { value: 3 }],
  ]);
  assert.equal(queue.isBusy(), false);
  await queue.whenSettled();
});
