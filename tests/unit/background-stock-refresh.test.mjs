import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundStockRefresh,
  createBackgroundTaskScheduler,
  createCustomStockPreloader,
  createVisibleSeriesSupplementalHydrator,
  createVisibleStockHistoryRefresh,
} from "../../docs/modules/background-stock-refresh.mjs";

function fakeClock(inputPending = () => false) {
  const timers = new Map();
  const listeners = new Map();
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
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  return {
    now: () => clock,
    pending: () => timers.size,
    dispatch(name) {
      listeners.get(name)?.();
    },
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
  assert.equal(Number.isFinite(scheduler.stats().totalQueueWaitMs), true);
  assert.equal(Number.isFinite(scheduler.stats().maxRunMs), true);
});

test("foreground background work bypasses the idle callback boundary", async () => {
  const calls = [];
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, {
    now: clock.now,
    foregroundPriority: 15,
  });

  scheduler.enqueue("visible-work", async () => calls.push("done"), { priority: 20 });
  clock.runNext();
  await Promise.resolve();

  assert.deepEqual(calls, ["done"]);
  assert.equal(scheduler.stats().foregroundWakeups, 1);
});

test("cancelling a running background task aborts its shared task signal", async () => {
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  let runningSignal = null;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const task = scheduler.enqueue("ticker-history", ({ signal }) => {
    runningSignal = signal;
    started();
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  });

  clock.runNext();
  clock.runNext();
  await startedPromise;
  assert.equal(runningSignal.aborted, false);
  assert.equal(scheduler.cancel("ticker-history"), true);
  assert.equal(runningSignal.aborted, true);
  assert.equal(await task, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.stats().cancelled, 1);
});

test("named background work can share an already running task", async () => {
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  let starts = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = scheduler.enqueue("cache-maintenance", async () => {
    starts += 1;
    await gate;
    return "ready";
  }, { coalesceRunning: true });

  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  const second = scheduler.enqueue("cache-maintenance", () => {
    starts += 1;
    return "duplicate";
  }, { coalesceRunning: true });

  assert.equal(second, first);
  assert.equal(starts, 1);
  release();
  assert.equal(await second, "ready");
  assert.equal(scheduler.stats().coalesced, 1);
  assert.equal(scheduler.stats().queued, 0);
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
  assert.equal(typeof calls[0].taskContext?.checkpoint, "function");
});

test("rescheduling hidden refresh aborts the request already in flight", async () => {
  const clock = fakeClock();
  const taskScheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  let runningSignal = null;
  let started = null;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const scheduler = createBackgroundStockRefresh(clock.scope, {
    scheduler: taskScheduler,
    hasHidden: () => true,
    refresh: ({ signal }) => {
      runningSignal = signal;
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
  });

  scheduler.schedule();
  clock.runNext();
  clock.runNext();
  await startedPromise;
  assert.equal(runningSignal.aborted, false);

  scheduler.schedule();
  assert.equal(runningSignal.aborted, true);
  scheduler.dispose();
  await Promise.resolve();
});

test("custom stock preload shares latest prices and yields between hidden tickers", async () => {
  const loaded = [];
  const removed = [];
  let checkpoints = 0;
  const preloader = createCustomStockPreloader({
    visibleConcurrency: 3,
    getItems: () => [
      { ticker: "A.KS", name: "A" },
      { ticker: "B.KQ", name: "B" },
    ],
    hasExisting: (ticker) => ticker === "B.KQ",
    canFetchLatestBatch: () => true,
    fetchLatestBatch: async () => new Map([
      ["A.KS", [{ date: "2026-08-27", close: 10 }]],
      ["B.KQ", [{ date: "2026-08-27", close: 20 }]],
    ]),
    loadSeries: async (ticker, options) => {
      loaded.push({ ticker, latestPoints: options.latestPoints });
      if (ticker === "B.KQ") throw new Error("temporary failure");
    },
    removeFailed: (tickers) => removed.push(...tickers),
  });

  const result = await preloader.preload({
    scope: "hidden",
    taskContext: {
      checkpoint: async () => { checkpoints += 1; },
    },
  });

  assert.deepEqual(loaded.map((item) => item.ticker), ["A.KS", "B.KQ"]);
  assert.deepEqual(loaded.map((item) => item.latestPoints[0].close), [10, 20]);
  assert.equal(checkpoints >= 5, true);
  assert.deepEqual(result, { failedNames: [], processed: 2, scope: "hidden" });
  assert.deepEqual(removed, []);
});

test("custom stock preload falls back individually when a batch omits one ticker", async () => {
  const loaded = [];
  const preloader = createCustomStockPreloader({
    getItems: () => [
      { ticker: "A.KS", name: "A" },
      { ticker: "B.KQ", name: "B" },
    ],
    hasExisting: () => true,
    canFetchLatestBatch: () => true,
    fetchLatestBatch: async () => new Map([
      ["A.KS", [{ date: "2026-08-28", close: 11 }]],
      ["B.KQ", []],
    ]),
    loadSeries: async (ticker, options) => {
      loaded.push({
        ticker,
        hasLatestPoints: Object.prototype.hasOwnProperty.call(options, "latestPoints"),
        latestPoints: options.latestPoints,
      });
    },
  });

  await preloader.preload({ forceRefresh: true, scope: "visible" });

  assert.deepEqual(loaded, [
    {
      ticker: "A.KS",
      hasLatestPoints: true,
      latestPoints: [{ date: "2026-08-28", close: 11 }],
    },
    { ticker: "B.KQ", hasLatestPoints: false, latestPoints: undefined },
  ]);
});

test("background work waits until pointer activity has been quiet", async () => {
  const calls = [];
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, {
    now: clock.now,
    interactionQuietMs: 250,
    retryDelayMs: 150,
  });
  clock.dispatch("pointermove");
  scheduler.enqueue("work", async () => calls.push("done"));

  clock.runNext();
  clock.runNext();
  assert.deepEqual(calls, []);
  clock.runNext();
  clock.runNext();
  assert.deepEqual(calls, []);
  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, ["done"]);
  assert.equal(scheduler.stats().activityDeferrals, 2);
});

test("background work pauses while its document is hidden", async () => {
  const calls = [];
  const listeners = new Map();
  const visibilityTarget = {
    visibilityState: "hidden",
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, {
    now: clock.now,
    interactionQuietMs: 1,
    retryDelayMs: 100,
    visibilityTarget,
  });
  scheduler.enqueue("hidden-work", async () => calls.push("done"));

  clock.runNext();
  clock.runNext();
  assert.deepEqual(calls, []);
  assert.equal(scheduler.stats().visibilityDeferrals, 1);

  visibilityTarget.visibilityState = "visible";
  listeners.get("visibilitychange")?.();
  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, ["done"]);
  scheduler.dispose();
});

test("hidden tickers are prepared one at a time", async () => {
  const calls = [];
  const clock = fakeClock();
  const taskScheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  const scheduler = createBackgroundStockRefresh(clock.scope, {
    scheduler: taskScheduler,
    getTargets: () => ["A", "B"],
    hasHidden: () => true,
    refresh: async (options) => calls.push(options.tickers),
  });

  scheduler.schedule();
  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [["A"]]);
  assert.ok(clock.pending() > 0);

  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, [["A"], ["B"]]);
});

test("hidden ticker refresh batches latest-price preparation while keeping idle boundaries", async () => {
  const calls = [];
  const clock = fakeClock();
  const taskScheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  const scheduler = createBackgroundStockRefresh(clock.scope, {
    scheduler: taskScheduler,
    targetBatchSize: 2,
    getTargets: () => ["A", "B", "C"],
    hasHidden: () => true,
    refresh: async (options) => calls.push(options.tickers),
  });

  scheduler.schedule();
  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [["A", "B"]]);

  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, [["A", "B"], ["C"]]);
});

test("background tasks yield between consecutive jobs", async () => {
  const calls = [];
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, {
    now: clock.now,
    minimumTaskGapMs: 100,
  });
  scheduler.enqueue("first", async () => calls.push("first"));
  scheduler.enqueue("second", async () => calls.push("second"));

  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, ["first"]);
  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(scheduler.stats().taskYields >= 0, true);
});

test("an externally aborted queued task leaves the scheduler immediately", async () => {
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  const controller = new AbortController();
  const task = scheduler.enqueue("waiting", async () => true, {
    delayMs: 5000,
    group: "supplemental",
    signal: controller.signal,
  });

  assert.equal(scheduler.stats().queued, 1);
  controller.abort();
  assert.equal(await task, false);
  assert.equal(scheduler.stats().queued, 0);
  assert.deepEqual(scheduler.stats().queuedGroups, {});
});

test("background task groups can be cancelled as one lifecycle", async () => {
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, { now: clock.now });
  const first = scheduler.enqueue("first", async () => true, {
    delayMs: 5000,
    group: "startup",
  });
  const second = scheduler.enqueue("second", async () => true, {
    delayMs: 5000,
    group: "startup",
  });
  scheduler.enqueue("other", async () => true, { delayMs: 5000, group: "maintenance" });

  assert.equal(scheduler.cancelGroup("startup"), 2);
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.deepEqual(scheduler.stats().queuedGroups, { maintenance: 1 });
  scheduler.dispose();
});

test("long background work can yield cooperatively before continuing", async () => {
  const calls = [];
  const clock = fakeClock();
  const scheduler = createBackgroundTaskScheduler(clock.scope, {
    now: clock.now,
    cooperativeYieldDelayMs: 10,
  });
  const task = scheduler.enqueue("maintenance", async (context) => {
    calls.push("start");
    assert.equal(context.shouldYield(), false);
    await context.checkpoint(true);
    calls.push("finish");
  });

  clock.runNext();
  clock.runNext();
  await Promise.resolve();
  assert.deepEqual(calls, ["start"]);

  clock.runNext();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ["start", "finish"]);
  assert.equal(await task, undefined);
  assert.equal(scheduler.stats().cooperativeYields, 1);
});

test("visible stock history refresh shares scheduling, visibility, and cancellation rules", async () => {
  const calls = [];
  const cancelled = [];
  let visible = true;
  const scheduler = {
    cancel(key) {
      cancelled.push(key);
      return true;
    },
    enqueue(key, task, options) {
      calls.push({ key, options });
      if (options.shouldRun() === false) return Promise.resolve(false);
      return Promise.resolve(task({ signal: null, checkpoint: async () => false }));
    },
  };
  const loaded = [];
  const updated = [];
  const refresh = createVisibleStockHistoryRefresh({
    scheduler,
    preload: async (options) => loaded.push(options),
    hasTicker: (ticker) => ticker === "005930.KS",
    isVisible: () => visible,
    onUpdated: (ticker) => updated.push(ticker),
  });

  assert.equal(await refresh.schedule("005930.ks", "삼성전자"), true);
  assert.equal(calls[0].key, "visible-stock-history:005930.KS");
  assert.equal(calls[0].options.priority, 15);
  assert.deepEqual(loaded[0].tickers, ["005930.KS"]);
  assert.equal(loaded[0].scope, "visible");
  assert.deepEqual(updated, ["005930.KS"]);

  visible = false;
  assert.equal(await refresh.schedule("005930.KS"), false);
  assert.equal(loaded.length, 1);
  assert.equal(refresh.cancel("005930.ks"), true);
  assert.deepEqual(cancelled, ["visible-stock-history:005930.KS"]);
});

test("visible supplemental hydration owns disclosure, EPS, and AI task cleanup", async () => {
  const calls = [];
  const scheduler = {
    cancel: (key) => calls.push(`cancel:${key}`),
    enqueue: (key, task, options) => {
      calls.push(`enqueue:${key}:${options.group}`);
      return Promise.resolve(task({ checkpoint: async () => false }));
    },
  };
  const hydration = createVisibleSeriesSupplementalHydrator({
    scheduler,
    isSupported: (ticker) => ticker.endsWith(".KS"),
    isActive: () => true,
    isDartEnabled: () => true,
    isEpsEnabled: () => true,
    isAiEnabled: () => true,
    prepareDisclosure: (ticker) => calls.push(`disclosure:${ticker}`),
    prepareEps: (ticker) => calls.push(`eps:${ticker}`),
    prepareAi: (ticker) => calls.push(`ai:${ticker}`),
    onAiQueued: (ticker) => calls.push(`queued:${ticker}`),
    onAiPreparing: (ticker) => calls.push(`preparing:${ticker}`),
    onAiReady: (ticker) => calls.push(`ready:${ticker}`),
    onAiCompleted: (ticker) => calls.push(`completed:${ticker}`),
  });

  assert.equal(await hydration.schedule("005930.ks", { trackAiProgress: true }), true);
  assert.deepEqual(calls, [
    "queued:005930.KS",
    "enqueue:visible-series-supplemental:005930.KS:visible-series-supplemental",
    "disclosure:005930.KS",
    "eps:005930.KS",
    "preparing:005930.KS",
    "ai:005930.KS",
    "ready:005930.KS",
    "completed:005930.KS",
  ]);
  hydration.cancel("005930.ks");
  assert.equal(calls.at(-1), "cancel:visible-series-supplemental:005930.KS");
});

test("visible supplemental hydration skips the scheduler when every optional layer is off", async () => {
  let enqueueCount = 0;
  const hydration = createVisibleSeriesSupplementalHydrator({
    scheduler: {
      enqueue() {
        enqueueCount += 1;
        return Promise.resolve(true);
      },
      cancel() {},
    },
    isSupported: () => true,
    isDartEnabled: () => false,
    isEpsEnabled: () => false,
    isAiEnabled: () => false,
  });

  assert.equal(await hydration.schedule("005930.KS"), false);
  assert.equal(enqueueCount, 0);
});
