import { mapWithConcurrency } from "./shared-request-registry.mjs";

/**
 * @typedef {object} BackgroundTaskOptions
 * @property {number} [delayMs]
 * @property {number} [priority]
 * @property {string} [group]
 * @property {AbortSignal|null} [signal]
 * @property {() => boolean} [shouldRun]
 * @property {boolean} [coalesceRunning]
 * @property {boolean} [deferDuringInteraction]
 * @property {"serial"|"network"} [lane]
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
    const foregroundPriority = Number.isFinite(Number(options.foregroundPriority))
      ? Number(options.foregroundPriority)
      : Number.POSITIVE_INFINITY;
    const isInteractionBusy = typeof options.isInteractionBusy === "function"
      ? options.isInteractionBusy
      : () => false;
    const pauseWhenHidden = options.pauseWhenHidden !== false;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const activityTarget = options.activityTarget || scope;
    const visibilityTarget = options.visibilityTarget || scope.document || null;
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
    const running = new Map();
    const networkConcurrency = Math.max(1, Number(options.networkConcurrency) || 3);
    let disposed = false;
    let lifecycleListenersAttached = false;
    let lastActivityAt = Number.NEGATIVE_INFINITY;
    let lastCompletedAt = Number.NEGATIVE_INFINITY;
    const counters = {
      enqueued: 0,
      completed: 0,
      cancelled: 0,
      coalesced: 0,
      replaced: 0,
      inputDeferrals: 0,
      activityDeferrals: 0,
      visibilityDeferrals: 0,
      taskYields: 0,
      cooperativeYields: 0,
      foregroundWakeups: 0,
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

    const pageHidden = () => pauseWhenHidden && visibilityTarget?.visibilityState === "hidden";
    const onVisibilityChange = () => {
      if (pageHidden()) {
        clearWakeup();
        schedulePump(Math.max(1000, retryDelayMs));
        return;
      }
      noteActivity();
      clearWakeup();
      schedulePump(retryDelayMs);
    };

    function hasLifecycleWork() {
      return Boolean(running.size || queue.size);
    }

    function syncLifecycleListeners() {
      const shouldAttach = !disposed && hasLifecycleWork();
      if (shouldAttach === lifecycleListenersAttached) return;
      lifecycleListenersAttached = shouldAttach;
      activityEvents.forEach((eventName) => {
        const method = shouldAttach ? "addEventListener" : "removeEventListener";
        activityTarget?.[method]?.(eventName, noteActivity, { capture: true, passive: true });
      });
      const visibilityMethod = shouldAttach ? "addEventListener" : "removeEventListener";
      visibilityTarget?.[visibilityMethod]?.("visibilitychange", onVisibilityChange);
    }

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

    function hasCapacity(entry) {
      if (running.has(entry.key)) return false;
      const count = [...running.values()].filter((item) => item.lane === entry.lane).length;
      return count < (entry.lane === "network" ? networkConcurrency : 1);
    }

    function orderedReady(currentTime = now()) {
      return [...queue.values()]
        .filter((entry) => entry.notBefore <= currentTime && hasCapacity(entry))
        .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)[0] || null;
    }

    function nextDelay(currentTime = now()) {
      const available = [...queue.values()].filter(hasCapacity);
      if (!available.length) return null;
      return Math.max(0, Math.min(...available.map((entry) => entry.notBefore - currentTime)));
    }

    function isForeground(entry = null) {
      return Number(entry?.priority) >= foregroundPriority;
    }

    function defersDuringInteraction(entry = null) {
      return entry?.deferDuringInteraction !== false;
    }

    function interactionPending(entry = null) {
      if (pageHidden()) return true;
      if (!defersDuringInteraction(entry)) return false;
      return inputPending()
        || isInteractionBusy()
        || (!isForeground(entry) && now() - lastActivityAt < interactionQuietMs);
    }

    function createTaskContext(entry) {
      let sliceStartedAt = now();
      const shouldYield = () => (
        disposed
        || entry.signal?.aborted === true
        || interactionPending(entry)
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
            if (interactionPending(entry)) {
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
      if (disposed || timerHandle || idleHandle || !queue.size || nextDelay() == null) return;
      const delay = delayMs == null ? nextDelay() : Math.max(0, Number(delayMs) || 0);
      timerHandle = scope.setTimeout?.(() => {
        timerHandle = 0;
        const run = () => {
          idleHandle = 0;
          pump();
        };
        if (isForeground(orderedReady())) {
          counters.foregroundWakeups += 1;
          run();
        } else if (typeof scope.requestIdleCallback === "function") {
          idleHandle = scope.requestIdleCallback(run, { timeout: idleTimeoutMs });
        } else {
          run();
        }
      }, delay ?? 0) || 0;
    }

    async function pump() {
      if (disposed) return;
      const remainingGap = lastCompletedAt + minimumTaskGapMs - now();
      if (remainingGap > 0) {
        counters.taskYields += 1;
        schedulePump(remainingGap);
        return;
      }
      const entry = orderedReady();
      if (!entry) {
        schedulePump();
        return;
      }
      if (defersDuringInteraction(entry) && inputPending()) {
        counters.inputDeferrals += 1;
        schedulePump(retryDelayMs);
        return;
      }
      if (pageHidden()) {
        counters.visibilityDeferrals += 1;
        schedulePump(Math.max(1000, retryDelayMs));
        return;
      }
      if (defersDuringInteraction(entry)
        && (isInteractionBusy() || (!isForeground(entry) && now() - lastActivityAt < interactionQuietMs))) {
        counters.activityDeferrals += 1;
        schedulePump(retryDelayMs);
        return;
      }
      queue.delete(entry.key);
      if (entry.signal?.aborted || entry.shouldRun?.() === false) {
        counters.cancelled += 1;
        settle(entry, false);
        syncLifecycleListeners();
        schedulePump();
        return;
      }
      running.set(entry.key, entry);
      syncLifecycleListeners();
      schedulePump();
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
        if (running.get(entry.key) === entry) running.delete(entry.key);
        lastCompletedAt = now();
        syncLifecycleListeners();
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
      const runningEntry = running.get(normalizedKey);
      if (taskOptions.coalesceRunning === true && runningEntry && !runningEntry.cancelled) {
        counters.coalesced += 1;
        return runningEntry.promise || Promise.resolve(false);
      }
      const previous = queue.get(normalizedKey);
      if (previous) {
        queue.delete(normalizedKey);
        counters.cancelled += 1;
        counters.replaced += 1;
        abortEntry(previous);
        settle(previous, false);
      }
      const controller = new AbortController();
      const forwardAbort = () => cancel(normalizedKey, controller);
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
        lane: taskOptions.lane === "network" ? "network" : "serial",
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
        promise,
        shouldRun: typeof taskOptions.shouldRun === "function" ? taskOptions.shouldRun : null,
        deferDuringInteraction: taskOptions.deferDuringInteraction !== false,
        resolve,
        reject,
      });
      externalSignal?.addEventListener?.("abort", forwardAbort, { once: true });
      counters.enqueued += 1;
      syncLifecycleListeners();
      clearWakeup();
      schedulePump();
      return promise;
    }

    function cancel(key, controller = null) {
      const normalizedKey = String(key || "").trim();
      const queued = queue.get(normalizedKey);
      const active = running.get(normalizedKey);
      const entry = !controller || queued?.controller === controller ? queued : null;
      const runningEntry = !controller || active?.controller === controller ? active : null;
      if (!entry && !runningEntry) return false;
      if (runningEntry) {
        running.delete(normalizedKey);
        abortEntry(runningEntry);
        counters.cancelled += 1;
        settle(runningEntry, false);
      }
      if (entry) {
        queue.delete(normalizedKey);
        counters.cancelled += 1;
        abortEntry(entry);
        settle(entry, false);
      }
      syncLifecycleListeners();
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
      running.forEach((entry) => { if (entry.group === normalizedGroup) keys.push(entry.key); });
      return [...new Set(keys)].reduce((count, key) => count + (cancel(key) ? 1 : 0), 0);
    }

    function dispose() {
      disposed = true;
      clearWakeup();
      running.forEach((entry) => {
        abortEntry(entry);
        settle(entry, false);
        counters.cancelled += 1;
      });
      running.clear();
      [...queue.values()].forEach((entry) => {
        abortEntry(entry);
        settle(entry, false);
      });
      counters.cancelled += queue.size;
      queue.clear();
      syncLifecycleListeners();
    }

    return Object.freeze({
      cancel,
      cancelGroup,
      dispose,
      enqueue,
      isRunning: () => Boolean(running.size),
      stats: () => Object.freeze({
        ...counters,
        queued: queue.size,
        queuedGroups: Object.freeze([...queue.values()].reduce((groups, entry) => {
          const key = entry.group || "ungrouped";
          groups[key] = (Number(groups[key]) || 0) + 1;
          return groups;
        }, {})),
        runningGroup: running.values().next().value?.group || "",
        runningKey: running.keys().next().value || "",
        runningCount: running.size,
        lifecycleListenersAttached,
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
      const latestOnly = runOptions.latestOnly === true;
      const visibleSinceDate = String(runOptions.visibleSinceDate || "").slice(0, 10);
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
          const loadResult = await loadSeries(ticker, {
            forceRefresh,
            displayName: name,
            latestOnly: latestOnly && hadExisting,
            requireFullHistory: !latestOnly || (!hadExisting && !visibleSinceDate),
            signal,
            ...(visibleSinceDate ? { visibleSinceDate } : {}),
            // An empty/missing batch result is not a successful latest-price check.
            // Omitting the field lets the ticker loader retry its individual source.
            ...(Array.isArray(prefetchedLatest) && prefetchedLatest.length
              ? { latestPoints: prefetchedLatest }
              : {}),
          });
          options.setDisplayName?.(ticker, name);
          await taskContext?.checkpoint?.();
          return {
            ticker,
            success: true,
            deferredRefresh: loadResult?.deferredRefresh === true,
          };
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) throw error;
          if (hadExisting) {
            options.setDisplayName?.(ticker, name);
            return { ticker, name, retainedExisting: true };
          }
          return { ticker, name };
        }
      });
      throwIfAborted(signal);
      const successfulResults = results.filter((item) => item?.success === true);
      const unconfirmedResults = results.filter((item) => item?.success !== true);
      const failedResults = unconfirmedResults.filter((item) => item.retainedExisting !== true);
      const failed = failedResults.map((item) => item.ticker);
      const failedNames = failedResults.map((item) => item.name);
      const unconfirmedTickers = unconfirmedResults.map((item) => item.ticker);
      const deferredTickers = successfulResults
        .filter((item) => item.deferredRefresh === true)
        .map((item) => item.ticker);
      options.recordPerformance?.("preloadCustomStocks", perfStartedAt, {
        stocks: items.length,
        concurrency,
        failed: failed.length,
        scope,
      });

      const result = {
        failedNames,
        processed: items.length,
        scope,
        ...(deferredTickers.length ? { deferredTickers } : {}),
        ...(unconfirmedTickers.length ? { unconfirmedTickers } : {}),
      };
      if (!failed.length || runOptions.preserveFailed === true) {
        return result;
      }
      options.removeFailed?.(failed);
      return result;
    }

    return Object.freeze({ preload });
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

    function schedule(tickerValue, displayName = "", runOptions = {}) {
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
          forceRefresh: runOptions.forceRefresh === true,
          latestOnly: runOptions.latestOnly === true,
          ...(runOptions.visibleSinceDate
            ? { visibleSinceDate: String(runOptions.visibleSinceDate).slice(0, 10) }
            : {}),
        });
        if (!taskContext.signal?.aborted && generations.get(ticker) === generation
          && shouldRun(ticker) && runOptions.notifyUpdated !== false) {
          await onUpdated(ticker);
        }
        return true;
      }, {
        group: "ticker-history",
        lane: "network",
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

  function createVisibleSeriesSupplementalHydrator(options = {}) {
    const scheduler = options.scheduler;
    if (typeof scheduler?.enqueue !== "function") {
      throw new Error("visible series supplemental scheduler is required");
    }
    if (typeof options.resolveFeaturePlan !== "function") {
      throw new Error("visible series supplemental feature plan is required");
    }
    const normalizeTicker = typeof options.normalizeTicker === "function"
      ? options.normalizeTicker
      : (value) => String(value || "").trim().toUpperCase();
    const isSupported = typeof options.isSupported === "function"
      ? options.isSupported
      : (ticker) => Boolean(ticker);
    const isActive = typeof options.isActive === "function"
      ? options.isActive
      : () => true;
    const resolveFeaturePlan = (ticker) => {
      const resolved = options.resolveFeaturePlan(ticker) || {};
      return Object.freeze({
        ai: resolved.ai === true,
        dart: resolved.dart === true,
        disclosureData: resolved.disclosureData === true,
        eps: resolved.eps === true,
        insider: resolved.insider === true,
      });
    };
    const delayMs = Math.max(0, Number(options.delayMs) || 32);
    const priority = Number(options.priority) || 80;
    const group = String(options.group || "visible-series-supplemental");
    const taskKey = (ticker) => `${group}:${ticker}`;
    const activations = new Map();

    function schedule(tickerValue, context = {}) {
      const ticker = normalizeTicker(tickerValue);
      if (!isSupported(ticker)) return Promise.resolve(false);
      if (activations.has(ticker)) return activations.get(ticker).promise;
      const hasEnabledWork = () => {
        const plan = resolveFeaturePlan(ticker);
        return plan.dart || plan.eps || plan.ai;
      };
      const initialFeaturePlan = resolveFeaturePlan(ticker);
      if (!initialFeaturePlan.dart && !initialFeaturePlan.eps && !initialFeaturePlan.ai) {
        return Promise.resolve(false);
      }
      const trackAiProgress = context.trackAiProgress === true && initialFeaturePlan.ai;
      if (trackAiProgress) options.onAiQueued?.(ticker, context);

      const activation = { context: { ...context, trackAiProgress }, promise: null };
      activations.set(ticker, activation);
      const isCurrent = () => activations.get(ticker) === activation;
      const cleanupSkipped = () => {
        if (isCurrent()) options.onSkipped?.(ticker, activation.context);
      };
      activation.promise = scheduler.enqueue(taskKey(ticker), async (taskContext) => {
        await taskContext.checkpoint?.();
        if (!isCurrent() || taskContext.signal?.aborted || !isActive(ticker)) return false;
        const featurePlan = resolveFeaturePlan(ticker);
        const runContext = { ...context, featurePlan, signal: taskContext.signal };
        const tasks = [];
        if (featurePlan.dart) {
          tasks.push(Promise.resolve(options.prepareDisclosure?.(ticker, runContext)));
        }
        const hydrateAi = featurePlan.ai;
        if (featurePlan.eps) {
          tasks.push(Promise.resolve(options.prepareEps?.(ticker, runContext)));
        }
        if (hydrateAi) {
          options.onAiPreparing?.(ticker, runContext);
          tasks.push(Promise.resolve(options.prepareAi?.(ticker, runContext)));
        } else {
          cleanupSkipped();
        }
        const results = await Promise.allSettled(tasks);
        if (!isCurrent() || taskContext.signal?.aborted || !isActive(ticker)) return false;
        results.forEach((result) => {
          if (result.status === "rejected") options.onTaskError?.(ticker, result.reason, context);
        });
        await taskContext.checkpoint?.();
        if (!isCurrent() || taskContext.signal?.aborted || !isActive(ticker)) return false;
        if (hydrateAi) {
          try {
            if (resolveFeaturePlan(ticker).ai) options.onAiReady?.(ticker, runContext);
          } finally {
            options.onAiCompleted?.(ticker, runContext);
          }
        }
        return true;
      }, {
        coalesceRunning: true,
        lane: "network",
        delayMs,
        group,
        priority,
        shouldRun: () => isActive(ticker) && hasEnabledWork(),
      }).then((started) => {
        if (started === false) cleanupSkipped();
        return started;
      }).catch((error) => {
        cleanupSkipped();
        if (isCurrent()) options.onError?.(ticker, error, context);
        return false;
      }).finally(() => {
        if (isCurrent()) activations.delete(ticker);
      });
      return activation.promise;
    }

    return Object.freeze({
      cancel: (tickerValue) => {
        const ticker = normalizeTicker(tickerValue);
        const activation = activations.get(ticker);
        activations.delete(ticker);
        if (activation) options.onSkipped?.(ticker, activation.context);
        return scheduler.cancel(taskKey(ticker));
      },
      schedule,
    });
  }

export {
  createBackgroundTaskScheduler,
  createCustomStockPreloader,
  createVisibleSeriesSupplementalHydrator,
  createVisibleStockHistoryRefresh,
};
