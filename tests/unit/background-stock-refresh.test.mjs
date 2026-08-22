import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/background-stock-refresh.js");
const { createBackgroundStockRefresh } = globalThis.ThinkStockBackgroundStockRefresh;

test("hidden ticker refresh waits for idle time and preserves failed list entries", async () => {
  const calls = [];
  const timers = [];
  const scope = {
    navigator: { scheduling: { isInputPending: () => false } },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    requestIdleCallback(callback) {
      timers.push(callback);
      return timers.length;
    },
    cancelIdleCallback() {},
  };
  const scheduler = createBackgroundStockRefresh(scope, {
    hasHidden: () => true,
    refresh: async (options) => calls.push(options),
  });

  assert.equal(scheduler.schedule({ forceRefresh: true }), true);
  assert.equal(calls.length, 0);
  timers.shift()();
  timers.shift()();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scope, "hidden");
  assert.equal(calls[0].preserveFailed, true);
  assert.equal(calls[0].forceRefresh, true);
});
