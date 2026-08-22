(function initThinkStockBackgroundStockRefresh(globalScope) {
  "use strict";

  function createBackgroundTaskScheduler(scope = globalScope, options = {}) {
    const inputPending = typeof options.inputPending === "function"
      ? options.inputPending
      : () => {
        try { return scope.navigator?.scheduling?.isInputPending?.() === true; }
        catch (_) { return false; }
      };
    const retryDelayMs = Math.max(50, Number(options.retryDelayMs) || 180);
    const idleTimeoutMs = Math.max(500, Number(options.idleTimeoutMs) || 6000);
    const now = typeof options.now === "function" ? options.now : Date.now;
    const queue = new Map();
    let sequence = 0;
    let timerHandle = 0;
    let idleHandle = 0;
    let runningKey = "";
    let disposed = false;
    const counters = { enqueued: 0, completed: 0, cancelled: 0, inputDeferrals: 0 };

    function clearWakeup() {
      if (timerHandle) scope.clearTimeout?.(timerHandle);
      if (idleHandle && typeof scope.cancelIdleCallback === "function") {
        scope.cancelIdleCallback(idleHandle);
      }
      timerHandle = 0;
      idleHandle = 0;
    }

    function settle(entry, value, error = null) {
      if (error) entry.reject(error);
      else entry.resolve(value);
    }

    function orderedReady(currentTime = now()) {
      return [...queue.values()]
        .filter((entry) => entry.notBefore <= currentTime)
        .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)[0] || null;
    }

    function nextDelay(currentTime = now()) {
      if (!queue.size) return null;
      return Math.max(0, Math.min(...[...queue.values()].map((entry) => entry.notBefore - currentTime)));
    }

    function schedulePump(delayMs = null) {
      if (disposed || runningKey || timerHandle || idleHandle || !queue.size) return;
      const delay = delayMs == null ? nextDelay() : Math.max(0, Number(delayMs) || 0);
      timerHandle = scope.setTimeout?.(() => {
        timerHandle = 0;
        const run = () => {
          idleHandle = 0;
          pump();
        };
        if (typeof scope.requestIdleCallback === "function") {
          idleHandle = scope.requestIdleCallback(run, { timeout: idleTimeoutMs });
        } else {
          run();
        }
      }, delay ?? 0) || 0;
    }

    async function pump() {
      if (disposed || runningKey) return;
      if (inputPending()) {
        counters.inputDeferrals += 1;
        schedulePump(retryDelayMs);
        return;
      }
      const entry = orderedReady();
      if (!entry) {
        schedulePump();
        return;
      }
      queue.delete(entry.key);
      if (entry.signal?.aborted || entry.shouldRun?.() === false) {
        counters.cancelled += 1;
        settle(entry, false);
        schedulePump();
        return;
      }
      runningKey = entry.key;
      try {
        settle(entry, await entry.task());
        counters.completed += 1;
      } catch (error) {
        settle(entry, undefined, error);
      } finally {
        runningKey = "";
        schedulePump();
      }
    }

    function enqueue(key, task, taskOptions = {}) {
      const normalizedKey = String(key || "").trim();
      if (disposed || !normalizedKey || typeof task !== "function") return Promise.resolve(false);
      const previous = queue.get(normalizedKey);
      if (previous) {
        queue.delete(normalizedKey);
        counters.cancelled += 1;
        settle(previous, false);
      }
      let resolve;
      let reject;
      const promise = new Promise((resolveTask, rejectTask) => {
        resolve = resolveTask;
        reject = rejectTask;
      });
      queue.set(normalizedKey, {
        key: normalizedKey,
        task,
        priority: Number(taskOptions.priority) || 0,
        notBefore: now() + Math.max(0, Number(taskOptions.delayMs) || 0),
        sequence: ++sequence,
        signal: taskOptions.signal || null,
        shouldRun: typeof taskOptions.shouldRun === "function" ? taskOptions.shouldRun : null,
        resolve,
        reject,
      });
      counters.enqueued += 1;
      clearWakeup();
      schedulePump();
      return promise;
    }

    function cancel(key) {
      const entry = queue.get(String(key || "").trim());
      if (!entry) return false;
      queue.delete(entry.key);
      counters.cancelled += 1;
      settle(entry, false);
      clearWakeup();
      schedulePump();
      return true;
    }

    function dispose() {
      disposed = true;
      clearWakeup();
      [...queue.values()].forEach((entry) => settle(entry, false));
      counters.cancelled += queue.size;
      queue.clear();
    }

    return Object.freeze({
      cancel,
      dispose,
      enqueue,
      isRunning: () => Boolean(runningKey),
      stats: () => Object.freeze({ ...counters, queued: queue.size, runningKey }),
    });
  }

  function createBackgroundStockRefresh(scope = globalScope, options = {}) {
    const refresh = options.refresh;
    const hasHidden = typeof options.hasHidden === "function" ? options.hasHidden : () => false;
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    const delayMs = Math.max(1000, Number(options.delayMs) || 3500);
    const scheduler = options.scheduler || createBackgroundTaskScheduler(scope);
    const ownsScheduler = !options.scheduler;
    let running = null;

    function cancelPending() {
      scheduler.cancel("hidden-stock-refresh");
    }

    function schedule(runOptions = {}) {
      cancelPending();
      if (typeof refresh !== "function" || !hasHidden()) return false;
      const signal = runOptions.signal || null;
      scheduler.enqueue("hidden-stock-refresh", () => {
        running = Promise.resolve(refresh({
          forceRefresh: runOptions.forceRefresh === true,
          preserveFailed: true,
          scope: "hidden",
          signal,
        })).catch((error) => {
          if (!signal?.aborted) onError(error);
        }).finally(() => { running = null; });
        return running;
      }, {
        delayMs,
        priority: -20,
        shouldRun: hasHidden,
        signal,
      }).catch((error) => {
        if (!signal?.aborted) onError(error);
      });
      return true;
    }

    return Object.freeze({
      cancelPending,
      dispose: () => {
        cancelPending();
        if (ownsScheduler) scheduler.dispose();
      },
      isRunning: () => Boolean(running),
      schedule,
    });
  }

  globalScope.ThinkStockBackgroundStockRefresh = Object.freeze({
    createBackgroundTaskScheduler,
    createBackgroundStockRefresh,
  });
}(typeof self !== "undefined" ? self : globalThis));
