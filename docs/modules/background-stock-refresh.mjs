import { mapWithConcurrency } from "./shared-request-registry.mjs";

/**
 * @typedef {object} BackgroundTaskOptions
 * @property {number} [delayMs]
 * @property {number} [priority]
 * @property {string} [group]
 * @property {AbortSignal|null} [signal]
 * @property {() => boolean} [shouldRun]
 */

/**
 * @typedef {object} BackgroundTaskContext
 * @property {AbortSignal|null} signal
 * @property {() => boolean} shouldYield
 * @property {(force?: boolean) => Promise<boolean>} checkpoint
 */

function createBackgroundTaskScheduler(scope = globalThis, options = {}) {
    const inputPending = typeof options.inputPending === "function"
      ? options.inputPending
      : () => {
        try { return scope.navigator?.scheduling?.isInputPending?.() === true; }
        catch (_) { return false; }
      };
    const retryDelayMs = Math.max(50, Number(options.retryDelayMs) || 180);
    const idleTimeoutMs = Math.max(500, Number(options.idleTimeoutMs) || 6000);
    const interactionQuietMs = Math.max(0, Number(options.interactionQuietMs) || 260);
    const minimumTaskGapMs = Math.max(0, Number(options.minimumTaskGapMs) || 96);
    const activitySampleIntervalMs = Math.max(16, Number(options.activitySampleIntervalMs) || 48);
    const maxTaskSliceMs = Math.max(4, Number(options.maxTaskSliceMs) || 12);
    const cooperativeYieldDelayMs = Math.max(0, Number(options.cooperativeYieldDelayMs) || 16);
    const isInteractionBusy = typeof options.isInteractionBusy === "function"
      ? options.isInteractionBusy
      : () => false;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const activityTarget = options.activityTarget || scope;
    const activityEvents = options.activityEvents || [
      "pointerdown",
      "pointermove",
      "touchstart",
      "touchmove",
      "wheel",
      "keydown",
    ];
    const queue = new Map();
    let sequence = 0;
    let timerHandle = 0;
    let idleHandle = 0;
    let runningKey = "";
    let runningEntry = null;
    let disposed = false;
    let lastActivityAt = Number.NEGATIVE_INFINITY;
    let lastCompletedAt = Number.NEGATIVE_INFINITY;
    const counters = {
      enqueued: 0,
      completed: 0,
      cancelled: 0,
      inputDeferrals: 0,
      activityDeferrals: 0,
      taskYields: 0,
      cooperativeYields: 0,
      totalQueueWaitMs: 0,
      maxQueueWaitMs: 0,
      totalRunMs: 0,
      maxRunMs: 0,
    };

    const noteActivity = (event = null) => {
      const currentTime = now();
      if (
        ["pointermove", "touchmove"].includes(String(event?.type || ""))
        && currentTime - lastActivityAt < activitySampleIntervalMs
      ) return;
      lastActivityAt = currentTime;
    };
    activityEvents.forEach((eventName) => {
      activityTarget?.addEventListener?.(eventName, noteActivity, { capture: true, passive: true });
    });

    function clearWakeup() {
      if (timerHandle) scope.clearTimeout?.(timerHandle);
      if (idleHandle && typeof scope.cancelIdleCallback === "function") {
        scope.cancelIdleCallback(idleHandle);
      }
      timerHandle = 0;
      idleHandle = 0;
    }

    function settle(entry, value, error = null) {
      if (entry.settled) return;
      entry.settled = true;
      if (entry.externalSignal && entry.forwardAbort) {
        entry.externalSignal.removeEventListener?.("abort", entry.forwardAbort);
      }
      if (error) entry.reject(error);
      else entry.resolve(value);
    }

    function abortEntry(entry) {
      if (!entry) return false;
      entry.cancelled = true;
      try { entry.controller?.abort?.(); } catch (_) {}
      return true;
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

    function interactionPending() {
      return inputPending()
        || isInteractionBusy()
        || now() - lastActivityAt < interactionQuietMs;
    }

    function createTaskContext(entry) {
      let sliceStartedAt = now();
      const shouldYield = () => (
        disposed
        || entry.signal?.aborted === true
        || interactionPending()
        || now() - sliceStartedAt >= maxTaskSliceMs
      );
      const checkpoint = async (force = false) => {
        if (!force && !shouldYield()) return false;
        return new Promise((resolve) => {
          const waitForQuietTurn = () => {
            if (disposed || entry.signal?.aborted) {
              resolve(false);
              return;
            }
            if (interactionPending()) {
              scope.setTimeout?.(waitForQuietTurn, retryDelayMs);
              return;
            }
            sliceStartedAt = now();
            counters.cooperativeYields += 1;
            resolve(true);
          };
          if (typeof scope.setTimeout === "function") {
            scope.setTimeout(waitForQuietTurn, cooperativeYieldDelayMs);
          } else {
            Promise.resolve().then(waitForQuietTurn);
          }
        });
      };
      return Object.freeze({
        signal: entry.signal || null,
        shouldYield,
        checkpoint,
      });
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
      const remainingGap = lastCompletedAt + minimumTaskGapMs - now();
      if (remainingGap > 0) {
        counters.taskYields += 1;
        schedulePump(remainingGap);
        return;
      }
      if (inputPending()) {
        counters.inputDeferrals += 1;
        schedulePump(retryDelayMs);
        return;
      }
      if (isInteractionBusy() || now() - lastActivityAt < interactionQuietMs) {
        counters.activityDeferrals += 1;
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
      runningEntry = entry;
      const taskStartedAt = now();
      const queueWaitMs = Math.max(0, taskStartedAt - entry.enqueuedAt);
      counters.totalQueueWaitMs += queueWaitMs;
      counters.maxQueueWaitMs = Math.max(counters.maxQueueWaitMs, queueWaitMs);
      try {
        const value = await entry.task(createTaskContext(entry));
        if (entry.cancelled || disposed) {
          settle(entry, false);
        } else {
          settle(entry, value);
          counters.completed += 1;
        }
      } catch (error) {
        if (entry.cancelled || disposed) settle(entry, false);
        else settle(entry, undefined, error);
      } finally {
        const runMs = Math.max(0, now() - taskStartedAt);
        counters.totalRunMs += runMs;
        counters.maxRunMs = Math.max(counters.maxRunMs, runMs);
        runningKey = "";
        if (runningEntry === entry) runningEntry = null;
        lastCompletedAt = now();
        schedulePump(minimumTaskGapMs);
      }
    }

    /**
     * @param {string} key
     * @param {(context: BackgroundTaskContext) => unknown|Promise<unknown>} task
     * @param {BackgroundTaskOptions} [taskOptions]
     */
    function enqueue(key, task, taskOptions = {}) {
      const normalizedKey = String(key || "").trim();
      if (disposed || !normalizedKey || typeof task !== "function") return Promise.resolve(false);
      const externalSignal = taskOptions.signal || null;
      if (externalSignal?.aborted) {
        counters.cancelled += 1;
        return Promise.resolve(false);
      }
      const previous = queue.get(normalizedKey);
      if (previous) {
        queue.delete(normalizedKey);
        counters.cancelled += 1;
        abortEntry(previous);
        settle(previous, false);
      }
      const controller = new AbortController();
      const forwardAbort = () => cancel(normalizedKey);
      let resolve;
      let reject;
      const promise = new Promise((resolveTask, rejectTask) => {
        resolve = resolveTask;
        reject = rejectTask;
      });
      const enqueuedAt = now();
      queue.set(normalizedKey, {
        key: normalizedKey,
        task,
        group: String(taskOptions.group || "").trim(),
        priority: Number(taskOptions.priority) || 0,
        notBefore: enqueuedAt + Math.max(0, Number(taskOptions.delayMs) || 0),
        enqueuedAt,
        sequence: ++sequence,
        signal: controller.signal,
        controller,
        externalSignal,
        forwardAbort,
        cancelled: false,
        settled: false,
        shouldRun: typeof taskOptions.shouldRun === "function" ? taskOptions.shouldRun : null,
        resolve,
        reject,
      });
      externalSignal?.addEventListener?.("abort", forwardAbort, { once: true });
      counters.enqueued += 1;
      clearWakeup();
      schedulePump();
      return promise;
    }

    function cancel(key) {
      const normalizedKey = String(key || "").trim();
      const entry = queue.get(normalizedKey);
      if (!entry && runningEntry?.key !== normalizedKey) return false;
      if (!entry) {
        abortEntry(runningEntry);
        counters.cancelled += 1;
        settle(runningEntry, false);
        return true;
      }
      queue.delete(normalizedKey);
      counters.cancelled += 1;
      abortEntry(entry);
      settle(entry, false);
      clearWakeup();
      schedulePump();
      return true;
    }

    function cancelGroup(group) {
      const normalizedGroup = String(group || "").trim();
      if (!normalizedGroup) return 0;
      const keys = [...queue.values()]
        .filter((entry) => entry.group === normalizedGroup)
        .map((entry) => entry.key);
      if (runningEntry?.group === normalizedGroup) keys.push(runningEntry.key);
      return [...new Set(keys)].reduce((count, key) => count + (cancel(key) ? 1 : 0), 0);
    }

    function dispose() {
      disposed = true;
      clearWakeup();
      activityEvents.forEach((eventName) => {
        activityTarget?.removeEventListener?.(eventName, noteActivity, { capture: true });
      });
      if (runningEntry) {
        abortEntry(runningEntry);
        settle(runningEntry, false);
        counters.cancelled += 1;
      }
      [...queue.values()].forEach((entry) => {
        abortEntry(entry);
        settle(entry, false);
      });
      counters.cancelled += queue.size;
      queue.clear();
    }

    return Object.freeze({
      cancel,
      cancelGroup,
      dispose,
      enqueue,
      isRunning: () => Boolean(runningKey),
      stats: () => Object.freeze({
        ...counters,
        queued: queue.size,
        queuedGroups: Object.freeze([...queue.values()].reduce((groups, entry) => {
          const key = entry.group || "ungrouped";
          groups[key] = (Number(groups[key]) || 0) + 1;
          return groups;
        }, {})),
        runningGroup: runningEntry?.group || "",
        runningKey,
      }),
    });
  }

  function createCustomStockPreloader(options = {}) {
    const getItems = options.getItems;
    const loadSeries = options.loadSeries;
    if (typeof getItems !== "function" || typeof loadSeries !== "function") {
      throw new Error("custom stock preloader dependencies are incomplete");
    }
    const normalizeTicker = (value) => String(value || "").trim().toUpperCase();
    const throwIfAborted = typeof options.throwIfAborted === "function"
      ? options.throwIfAborted
      : (signal) => {
        if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
      };
    const isAbortError = typeof options.isAbortError === "function"
      ? options.isAbortError
      : (error) => error?.name === "AbortError";
    const visibleConcurrency = Math.max(1, Number(options.visibleConcurrency) || 2);

    async function preload(runOptions = {}) {
      const forceRefresh = runOptions.forceRefresh === true;
      const signal = runOptions.signal || null;
      const taskContext = runOptions.taskContext || null;
      throwIfAborted(signal);
      await taskContext?.checkpoint?.();
      throwIfAborted(signal);
      const scope = ["visible", "hidden"].includes(runOptions.scope) ? runOptions.scope : "all";
      const requestedTickers = new Set((runOptions.tickers || []).map(normalizeTicker).filter(Boolean));
      const items = (getItems(scope) || []).filter((item) => (
        !requestedTickers.size || requestedTickers.has(normalizeTicker(item?.ticker))
      ));
      if (!items.length) return { failedNames: [], processed: 0, scope };

      const perfStartedAt = options.startPerformance?.();
      let latestPointsByTicker = null;
      if (options.canFetchLatestBatch?.() && typeof options.fetchLatestBatch === "function") {
        try {
          latestPointsByTicker = await options.fetchLatestBatch(
            items.map((item) => normalizeTicker(item?.ticker)),
            {
              forceNetwork: forceRefresh,
              signal,
              payload: runOptions.priceBatchPayload || null,
            },
          );
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) throw error;
          // An older runtime can still fall back to the per-ticker endpoint.
          latestPointsByTicker = null;
        }
      }
      await taskContext?.checkpoint?.();
      throwIfAborted(signal);

      const concurrency = scope === "hidden" ? 1 : visibleConcurrency;
      const results = await mapWithConcurrency(items, concurrency, async (item) => {
        await taskContext?.checkpoint?.();
        throwIfAborted(signal);
        const ticker = normalizeTicker(item?.ticker);
        const name = String(item?.name || ticker);
        const hadExisting = options.hasExisting?.(ticker) === true;
        const prefetchedLatest = latestPointsByTicker?.get(ticker);
        try {
          await loadSeries(ticker, {
            forceRefresh,
            displayName: name,
            requireFullHistory: true,
            signal,
            // An empty/missing batch result is not a successful latest-price check.
            // Omitting the field lets the ticker loader retry its individual source.
            ...(Array.isArray(prefetchedLatest) && prefetchedLatest.length
              ? { latestPoints: prefetchedLatest }
              : {}),
          });
          options.setDisplayName?.(ticker, name);
          await taskContext?.checkpoint?.();
          return null;
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) throw error;
          if (hadExisting) {
            options.setDisplayName?.(ticker, name);
            return null;
          }
          return { ticker, name };
        }
      });
      throwIfAborted(signal);
      const failedResults = results.filter(Boolean);
      const failed = failedResults.map((item) => item.ticker);
      const failedNames = failedResults.map((item) => item.name);
      options.recordPerformance?.("preloadCustomStocks", perfStartedAt, {
        stocks: items.length,
        concurrency,
        failed: failed.length,
        scope,
      });

      if (!failed.length || runOptions.preserveFailed === true) {
        return { failedNames, processed: items.length, scope };
      }
      options.removeFailed?.(failed);
      return { failedNames, processed: items.length, scope };
    }

    return Object.freeze({ preload });
  }

  function createBackgroundStockRefresh(scope = globalThis, options = {}) {
    const refresh = options.refresh;
    const hasHidden = typeof options.hasHidden === "function" ? options.hasHidden : () => false;
    const getTargets = typeof options.getTargets === "function" ? options.getTargets : null;
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    const delayMs = Math.max(1000, Number(options.delayMs) || 3500);
    const betweenTargetsMs = Math.max(100, Number(options.betweenTargetsMs) || 700);
    const targetBatchSize = Math.max(1, Number(options.targetBatchSize) || 1);
    const scheduler = options.scheduler || createBackgroundTaskScheduler(scope);
    const ownsScheduler = !options.scheduler;
    let running = null;
    let runningController = null;
    let pendingTargets = [];
    let generation = 0;

    function cancelPending() {
      generation += 1;
      pendingTargets = [];
      scheduler.cancel("hidden-stock-refresh");
      runningController?.abort?.();
    }

    function normalizedTargets() {
      if (!getTargets) return [];
      return [...new Set((getTargets() || []).map((value) => String(value || "").trim()).filter(Boolean))];
    }

    function nextTargetBatch() {
      return pendingTargets.splice(0, targetBatchSize);
    }

    function enqueueRefresh(runOptions, targetGeneration, targets = [], waitMs = delayMs) {
      scheduler.enqueue("hidden-stock-refresh", async (taskContext) => {
        if (targetGeneration !== generation) return false;
        const controller = new AbortController();
        const externalSignal = runOptions.signal || null;
        const forwardAbort = () => controller.abort(externalSignal?.reason);
        if (externalSignal?.aborted) forwardAbort();
        else externalSignal?.addEventListener?.("abort", forwardAbort, { once: true });
        runningController = controller;
        running = Promise.resolve(refresh({
          forceRefresh: runOptions.forceRefresh === true,
          preserveFailed: true,
          scope: "hidden",
          signal: controller.signal,
          taskContext,
          ...(targets.length ? { tickers: targets } : {}),
        }));
        try {
          await running;
        } finally {
          externalSignal?.removeEventListener?.("abort", forwardAbort);
          if (runningController === controller) runningController = null;
          running = null;
        }
        return true;
      }, {
        group: "ticker-history",
        delayMs: waitMs,
        priority: -20,
        shouldRun: () => targetGeneration === generation && hasHidden(),
        signal: runOptions.signal || null,
      }).then(() => {
        if (targetGeneration !== generation || !pendingTargets.length) return;
        enqueueRefresh(runOptions, targetGeneration, nextTargetBatch(), betweenTargetsMs);
      }).catch((error) => {
        if (targetGeneration === generation && !runOptions.signal?.aborted && error?.name !== "AbortError") {
          onError(error);
        }
      });
    }

    function schedule(runOptions = {}) {
      cancelPending();
      if (typeof refresh !== "function" || !hasHidden()) return false;
      const signal = runOptions.signal || null;
      const targetGeneration = generation;
      pendingTargets = normalizedTargets();
      enqueueRefresh(runOptions, targetGeneration, nextTargetBatch(), delayMs);
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

  function createVisibleStockHistoryRefresh(options = {}) {
    const scheduler = options.scheduler;
    const preload = options.preload;
    if (typeof scheduler?.enqueue !== "function" || typeof preload !== "function") {
      throw new Error("visible stock history refresh dependencies are incomplete");
    }
    const hasTicker = typeof options.hasTicker === "function" ? options.hasTicker : () => false;
    const isVisible = typeof options.isVisible === "function" ? options.isVisible : () => false;
    const onUpdated = typeof options.onUpdated === "function" ? options.onUpdated : () => {};
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    const isAbortError = typeof options.isAbortError === "function"
      ? options.isAbortError
      : (error) => error?.name === "AbortError";
    const delayMs = Math.max(0, Number(options.delayMs) || 80);
    const priority = Number(options.priority) || 15;
    const generations = new Map();
    const normalizeTicker = (value) => String(value || "").trim().toUpperCase();
    const taskKey = (ticker) => `visible-stock-history:${normalizeTicker(ticker)}`;
    const shouldRun = (ticker) => hasTicker(ticker) && isVisible(ticker);

    function cancel(tickerValue) {
      const ticker = normalizeTicker(tickerValue);
      if (!ticker) return false;
      generations.delete(ticker);
      return scheduler.cancel(taskKey(ticker));
    }

    function schedule(tickerValue, displayName = "") {
      const ticker = normalizeTicker(tickerValue);
      if (!ticker) return Promise.resolve(false);
      const generation = (generations.get(ticker) || 0) + 1;
      generations.set(ticker, generation);
      return scheduler.enqueue(taskKey(ticker), async (taskContext) => {
        if (!shouldRun(ticker)) return false;
        await preload({
          scope: "visible",
          tickers: [ticker],
          preserveFailed: true,
          signal: taskContext.signal,
          taskContext,
        });
        if (shouldRun(ticker)) onUpdated(ticker);
        return true;
      }, {
        group: "ticker-history",
        delayMs,
        priority,
        shouldRun: () => shouldRun(ticker),
      }).catch((error) => {
        if (!isAbortError(error)) onError(error, { ticker, displayName });
        return false;
      }).finally(() => {
        if (generations.get(ticker) === generation) generations.delete(ticker);
      });
    }

    function dispose() {
      [...generations.keys()].forEach(cancel);
      generations.clear();
    }

    return Object.freeze({ cancel, dispose, schedule });
  }

export {
  createBackgroundStockRefresh,
  createBackgroundTaskScheduler,
  createCustomStockPreloader,
  createVisibleStockHistoryRefresh,
};
