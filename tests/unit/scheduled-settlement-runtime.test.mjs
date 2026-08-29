import assert from "node:assert/strict";
import test from "node:test";

import { createScheduledSettlementRuntime } from "../../docs/modules/scheduled-settlement-runtime.mjs";

function clock() {
  const timers = new Map();
  let nextId = 0;
  return {
    scope: {
      setTimeout(callback, delay) {
        const id = ++nextId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
    },
    timers,
    runNext() {
      const [id, timer] = timers.entries().next().value || [];
      if (!timer) return null;
      timers.delete(id);
      return timer.callback();
    },
  };
}

test("owns one settlement timer and replaces an older schedule", async () => {
  const timerClock = clock();
  let settlements = 0;
  const runtime = createScheduledSettlementRuntime(timerClock.scope, {
    getDelayMs: () => 500,
    offsetMs: 100,
    settle: async () => { settlements += 1; return true; },
  });

  assert.equal(runtime.schedule(), true);
  assert.equal(runtime.schedule(), true);
  assert.equal(timerClock.timers.size, 1);
  assert.equal([...timerClock.timers.values()][0].delay, 600);
  await timerClock.runNext();
  assert.equal(settlements, 1);
  assert.equal(runtime.isScheduled(), false);
});

test("defers settlement while its owner is busy", async () => {
  const timerClock = clock();
  let busy = true;
  let settlements = 0;
  const runtime = createScheduledSettlementRuntime(timerClock.scope, {
    getDelayMs: () => 0,
    isBusy: () => busy,
    retryMs: 900,
    settle: async () => { settlements += 1; return true; },
  });

  runtime.schedule();
  await timerClock.runNext();
  assert.equal(settlements, 0);
  assert.equal([...timerClock.timers.values()][0].delay, 900);
  busy = false;
  await timerClock.runNext();
  assert.equal(settlements, 1);
});

test("uses separate before-close scheduling and after-close execution predicates", async () => {
  const timerClock = clock();
  let marketOpen = true;
  let settlements = 0;
  const runtime = createScheduledSettlementRuntime(timerClock.scope, {
    getDelayMs: () => 500,
    shouldSchedule: () => marketOpen,
    shouldRun: () => !marketOpen,
    settle: async () => { settlements += 1; return true; },
  });

  assert.equal(runtime.schedule(), true);
  marketOpen = false;
  await timerClock.runNext();
  assert.equal(settlements, 1);
  assert.equal(runtime.schedule(), false);
});
