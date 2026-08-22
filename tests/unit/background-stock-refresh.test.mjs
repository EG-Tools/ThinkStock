import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/background-stock-refresh.js");
const {
  createBackgroundStockRefresh,
  createBackgroundTaskScheduler,
} = globalThis.ThinkStockBackgroundStockRefresh;

function fakeClock(inputPending = () => false) {
  const timers = new Map();
  let clock = 0;
  let sequence = 0;
  const schedule = (callback, delay = 0) => {
    const id = ++sequence;
    timers.set(id, { callback, due: clock + Math.max(0, Number(delay) || 0) });
    return id;
  };
  const scope = {
    navigator: { scheduling: { isInputPending: inputPending } },
    setTimeout: schedule,
    clearTimeout: (id) => timers.delete(id),
    requestIdleCallback: (callback) => schedule(callback, 0),
    cancelIdleCallback: (id) => timers.delete(id),
  };
  return {
    now: () => clock,
    runNext() {
      const next = [...timers.entries()].sort((left, right) => (
        left[1].due - right[1].due || left[0] - right[0]
      ))[0];
      assert.ok(next, "expected a scheduled callback");
      timers.delete(next[0]);
      clock = next[1].due;
      next[1].callback();
    },
    scope,
  };
}

test("background tasks prefer higher priority work and pause while input is pending", async () => {
  const calls = [];
  let pendingInput = true;
  const clock = fakeClock(() => pendingInput);
  const scheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  scheduler.enqueue("low", async () => calls.push("low"), { priority: -10 });
  scheduler.enqueue("high", async () => calls.push("high"), { priority: 10 });
  clock.runNext();
  clock.runNext();
  assert.deepEqual(calls, []);
  pendingInput = false;
  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, ["high"]);
  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, ["high", "low"]);
  assert.equal(scheduler.stats().inputDeferrals, 1);
});

test("hidden ticker refresh waits for idle time and preserves failed list entries", async () => {
  const calls = [];
  const clock = fakeClock();
  const taskScheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  const scheduler = createBackgroundStockRefresh(clock.scope, {
    scheduler: taskScheduler,
    hasHidden: () => true,
    refresh: async (options) => calls.push(options),
  });

  assert.equal(scheduler.schedule({ forceRefresh: true }), true);
  assert.equal(calls.length, 0);
  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scope, "hidden");
  assert.equal(calls[0].preserveFailed, true);
  assert.equal(calls[0].forceRefresh, true);
});
