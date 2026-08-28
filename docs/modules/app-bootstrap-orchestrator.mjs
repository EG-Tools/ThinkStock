/** @typedef {{ plotly: unknown, error: unknown }} PlotlyReadyResult */

/**
 * Keeps startup ordering and error/finalization policy outside the application
 * composition root. Product-specific work is supplied as explicit phases.
 *
 * @param {object} options
 */
export function createAppBootstrapOrchestrator(options = {}) {
  const documentRef = options.document || globalThis.document;
  const loader = options.loader || {};
  const performance = options.performance || {};

  async function runPhase(label, task) {
    const startedAt = performance.start?.();
    try {
      return await task();
    } finally {
      performance.finishPhase?.(label, startedAt);
    }
  }

  async function boot() {
    const startedAt = performance.start?.();
    const messageElement = documentRef?.getElementById?.("messageArea") || null;
    options.scheduleServiceWorker?.();
    loader.show?.();
    loader.progress?.(4, "Preparing");

    try {
      await runPhase("setup", () => options.setup?.(messageElement));
      loader.progress?.(10, "Preparing");
      const plotlyReadyTask = Promise.resolve()
        .then(() => runPhase("plotly", () => options.preparePlotly?.()))
        .then((plotly) => ({ plotly, error: null }))
        .catch((error) => ({ plotly: null, error }));
      const restoredSnapshot = await runPhase("data", () => options.prepareInitialData?.({
          messageElement,
          plotlyReadyTask,
        }));

      await runPhase("controls", () => options.bindControls?.(messageElement));
      await runPhase("features", () => options.afterControls?.(messageElement));
      await runPhase("paint", () => options.waitForFirstPaint?.());
      loader.progress?.(84, "Refreshing latest data");

      try {
        await runPhase("refresh", () => (
          options.refreshDuringStartup?.({ messageElement, restoredSnapshot })
        ));
        await runPhase("fit", () => options.afterStartupRefresh?.(messageElement));
      } catch (error) {
        options.onRefreshError?.(messageElement, error);
      }
      loader.progress?.(100, "Ready");
    } catch (error) {
      options.onError?.(messageElement, error);
    } finally {
      loader.hide?.();
      performance.finish?.(startedAt);
      options.scheduleDiagnostics?.();
    }
  }

  return Object.freeze({ boot });
}

/**
 * Owns ThinkStock's application lifetime without owning feature implementation.
 * The composition root supplies explicit setup, optional refresh, and cleanup steps.
 */
export function createApplicationLifecycleRuntime(options = {}) {
  const setupSteps = Array.from(options.setupSteps || []).filter((step) => typeof step === "function");
  const cleanupSteps = Array.from(options.cleanupSteps || []).filter((step) => typeof step === "function");
  const optionalRefreshes = Array.from(options.optionalRefreshes || []);
  const restoredActivations = Array.from(options.restoredActivations || []);
  const scheduleRestoredActivation = typeof options.scheduleRestoredActivation === "function"
    ? options.scheduleRestoredActivation
    : null;
  const initial = options.initialData || {};
  const refresh = options.refresh || {};
  let setupComplete = false;
  let disposed = false;

  function setup(messageElement) {
    if (setupComplete) return false;
    setupComplete = true;
    setupSteps.forEach((step) => step(messageElement));
    return true;
  }

  async function prepareInitialData({ messageElement, plotlyReadyTask } = {}) {
    if (!initial.runtime?.prepareInitialData) {
      throw new Error("initial data runtime is required");
    }
    return initial.runtime.prepareInitialData({
      restoreSnapshot: initial.restoreSnapshot,
      loadSeed: initial.loadSeed,
      needsHistorical: initial.needsHistorical,
      loadHistorical: initial.loadHistorical,
      onHistoricalError: () => initial.onHistoricalError?.(messageElement),
      plotlyReady: plotlyReadyTask,
      renderMain: async () => {
        await initial.renderMain?.(Boolean(initial.shouldPreserveViewport?.()));
        if (initial.shouldAutoFit?.()) await initial.fitCurrentChart?.();
      },
      setProgress: initial.setProgress,
    });
  }

  async function refreshRuntime(messageElement, refreshOptions = {}) {
    await refresh.runData?.(messageElement, refreshOptions);
    // Finish the coalesced render before reading its final trace range.
    await refresh.renderMain?.(true);
    if (refresh.shouldAutoFit?.()) await refresh.fitCurrentChart?.();
    for (const feature of optionalRefreshes) {
      if (feature?.enabled?.()) await feature.run?.(messageElement, refreshOptions);
    }
  }

  function activateRestoredFeatures(messageElement) {
    restoredActivations.forEach((feature, index) => {
      if (!feature?.enabled?.()) return;
      const run = () => {
        try {
          const result = feature.run?.(messageElement);
          if (result?.catch) result.catch((error) => options.onBackgroundError?.(error, feature.name));
          return result;
        } catch (error) {
          options.onBackgroundError?.(error, feature.name);
          return false;
        }
      };
      if (scheduleRestoredActivation) {
        scheduleRestoredActivation(run, { feature, index });
      } else {
        run();
      }
    });
    options.afterActivation?.(messageElement);
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    cleanupSteps.forEach((step) => {
      try {
        step();
      } catch (error) {
        options.onCleanupError?.(error);
      }
    });
    return true;
  }

  return Object.freeze({
    activateRestoredFeatures,
    dispose,
    isDisposed: () => disposed,
    isSetupComplete: () => setupComplete,
    prepareInitialData,
    refreshRuntime,
    setup,
  });
}

/**
 * Defines refresh and restored-activation work from one feature registry.
 * A feature's enabled predicate is therefore not duplicated across startup
 * and manual refresh orchestration.
 */
export function createFeatureLifecycleDescriptors(features = []) {
  const entries = Array.from(features || []).filter((feature) => (
    feature && typeof feature === "object" && String(feature.name || "")
  ));
  const descriptor = (feature, run) => Object.freeze({
    name: String(feature.name),
    enabled: typeof feature.enabled === "function" ? feature.enabled : () => true,
    run,
  });
  return Object.freeze({
    optionalRefreshes: Object.freeze(entries
      .filter((feature) => typeof feature.refresh === "function")
      .map((feature) => descriptor(feature, feature.refresh))),
    restoredActivations: Object.freeze(entries
      .filter((feature) => typeof feature.restore === "function")
      .map((feature) => descriptor(feature, feature.restore))),
  });
}

/**
 * Defers non-critical work until the title-fill animation has visibly reached
 * 100%. Keeping this gate outside app.js makes the user-visible boot boundary
 * explicit and independently testable.
 */
export function createStartupCompletionGate(schedule = queueMicrotask) {
  const scheduleTask = typeof schedule === "function" ? schedule : queueMicrotask;
  const pending = [];
  const pendingByKey = new Map();
  let released = false;

  function taskKey(taskOptions = {}) {
    return String(taskOptions.taskKey || taskOptions.taskName || "").trim();
  }

  function defer(task, taskOptions = {}) {
    if (typeof task !== "function") return false;
    const entry = { task, taskOptions: { ...taskOptions } };
    if (released) scheduleTask(entry.task, entry.taskOptions);
    else {
      const key = taskKey(entry.taskOptions);
      const previous = key ? pendingByKey.get(key) : null;
      if (previous) {
        previous.task = entry.task;
        previous.taskOptions = entry.taskOptions;
      } else {
        pending.push(entry);
        if (key) pendingByKey.set(key, entry);
      }
    }
    return true;
  }

  function release() {
    if (released) return false;
    released = true;
    const ready = pending.splice(0);
    pendingByKey.clear();
    ready.forEach(({ task, taskOptions }) => scheduleTask(task, taskOptions));
    return true;
  }

  return Object.freeze({
    defer,
    isReleased: () => released,
    pendingCount: () => pending.length,
    release,
  });
}

/**
 * Owns startup-deferred task naming, foreground priority, and cooperative
 * supplemental work so the application composition root only describes work.
 */
export function createStartupTaskRuntime(options = {}) {
  const scheduler = options.scheduler;
  if (typeof scheduler?.enqueue !== "function") {
    throw new Error("startup task scheduler is required");
  }
  const recordError = typeof options.recordError === "function" ? options.recordError : () => {};
  let deferredSequence = 0;
  let supplementalSequence = 0;

  function createTaskKey(prefix, taskOptions, nextSequence) {
    const explicitKey = String(taskOptions.taskKey || taskOptions.taskName || "").trim();
    if (!explicitKey) return `${prefix}-${nextSequence()}`;
    return `${prefix}:${explicitKey.replace(/\s+/g, "-").slice(0, 96)}`;
  }

  function scheduleDeferred(task, taskOptions = {}) {
    const taskKey = createTaskKey(
      "startup-deferred",
      taskOptions,
      () => ++deferredSequence,
    );
    const userVisible = taskOptions.userVisible === true;
    scheduler.enqueue(taskKey, async (taskContext) => {
      await taskContext.checkpoint?.();
      const result = await task(taskContext);
      // Deferred network work may resolve after chart interaction has begun.
      // Rejoin the UI only after the same quiet-turn check used by supplements.
      await taskContext.checkpoint?.();
      return result;
    }, {
      group: "startup-deferred",
      delayMs: taskOptions.delayMs,
      ...(taskOptions.taskKey || taskOptions.taskName ? { coalesceRunning: true } : {}),
      priority: Number.isFinite(Number(taskOptions.priority))
        ? Number(taskOptions.priority)
        : (userVisible ? 20 : -10),
    }).catch((error) => recordError(
      userVisible ? "startup-visible" : "startup-deferred",
      error,
      { taskKey },
    ));
  }

  const completionGate = createStartupCompletionGate(scheduleDeferred);

  function scheduleSupplemental(task, taskOptions = {}) {
    const index = Number(taskOptions.index) || 0;
    const taskKey = createTaskKey(
      "startup-supplemental",
      taskOptions,
      () => ++supplementalSequence,
    );
    return scheduler.enqueue(
      taskKey,
      async (taskContext) => {
        await taskContext.checkpoint?.();
        const result = await task(taskContext);
        // A network response can finish while the user starts dragging. Wait
        // for a quiet turn before its result rejoins the refresh pipeline.
        await taskContext.checkpoint?.();
        return result;
      },
      {
        group: "startup-supplemental",
        delayMs: 80,
        ...(taskOptions.taskKey || taskOptions.taskName ? { coalesceRunning: true } : {}),
        priority: -2 - index,
        signal: taskOptions.signal,
      },
    );
  }

  return Object.freeze({
    dispose: () => {
      scheduler.cancelGroup?.("startup-deferred");
      scheduler.cancelGroup?.("startup-supplemental");
    },
    defer: completionGate.defer,
    isReleased: completionGate.isReleased,
    pendingCount: completionGate.pendingCount,
    release: completionGate.release,
    scheduleSupplemental,
  });
}

/**
 * Owns the title-fill startup indicator used by the application bootstrap.
 */
export function createStartupLoader(scope = globalThis, options = {}) {
  const selector = String(options.selector || ".hero h1");
  const hideDelayMs = Math.max(0, Number(options.hideDelayMs) || 460);
  const onComplete = typeof options.onComplete === "function" ? options.onComplete : null;
  let hideTimer = 0;
  let rafId = 0;
  let displayProgress = 100;
  let targetProgress = 100;
  let completed = true;
  let startedAt = 0;

  function ensureElement() {
    const element = scope.document?.querySelector(selector) || null;
    if (!element) return null;
    if (!element.dataset.title) {
      element.dataset.title = String(element.textContent || "Think Stock").trim() || "Think Stock";
    }
    return element;
  }

  function renderProgress(value) {
    const element = ensureElement();
    if (!element) return;
    const clamped = Math.max(0, Math.min(100, value));
    element.style.setProperty("--title-load", `${clamped.toFixed(2)}%`);
    element.setAttribute("aria-valuemin", "0");
    element.setAttribute("aria-valuemax", "100");
    element.setAttribute("aria-valuenow", String(Math.round(clamped)));
  }

  function tween() {
    const difference = targetProgress - displayProgress;
    if (Math.abs(difference) < 0.28) {
      displayProgress = targetProgress;
      renderProgress(displayProgress);
      rafId = 0;
      if (displayProgress >= 100 && !completed) {
        completed = true;
        onComplete?.({ startedAt });
      }
      return;
    }
    displayProgress += difference * 0.16;
    renderProgress(displayProgress);
    rafId = scope.requestAnimationFrame(tween);
  }

  function setProgress(percent, _label = "") {
    if (!ensureElement()) return;
    targetProgress = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (!rafId) rafId = scope.requestAnimationFrame(tween);
  }

  function show() {
    if (hideTimer) {
      scope.clearTimeout(hideTimer);
      hideTimer = 0;
    }
    if (rafId) {
      scope.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    const element = ensureElement();
    if (!element) return;
    element.classList.add("is-loading");
    displayProgress = 0;
    targetProgress = 0;
    completed = false;
    startedAt = typeof scope.performance?.now === "function" ? scope.performance.now() : 0;
    renderProgress(0);
  }

  function hide() {
    const element = ensureElement();
    if (!element) return;
    setProgress(100);
    if (hideTimer) scope.clearTimeout(hideTimer);
    hideTimer = scope.setTimeout(() => {
      element.classList.remove("is-loading");
      hideTimer = 0;
    }, hideDelayMs);
  }

  return Object.freeze({
    show,
    hide,
    isComplete: () => completed,
    setProgress,
    renderProgress,
  });
}

/**
 * Creates each application runtime once and owns its eventual cleanup.
 * This replaces scattered nullable service variables in the composition root.
 */
export function createLazyRuntimeRegistry() {
  const entries = new Map();
  const pending = new Map();
  let generation = 0;

  function normalizeRequest(keyValue, factory) {
    const key = String(keyValue || "");
    if (!key || typeof factory !== "function") {
      throw new Error("runtime registry key and factory are required");
    }
    return key;
  }

  function createEntry(value, disposer) {
    return Object.freeze({ value, disposer });
  }

  function get(keyValue, factory, disposer = null) {
    const key = normalizeRequest(keyValue, factory);
    if (entries.has(key)) return entries.get(key).value;
    const value = factory();
    entries.set(key, createEntry(value, disposer));
    return value;
  }

  function getAsync(keyValue, factory, disposer = null) {
    const key = normalizeRequest(keyValue, factory);
    if (entries.has(key)) return Promise.resolve(entries.get(key).value);
    if (pending.has(key)) return pending.get(key);

    const requestGeneration = generation;
    const task = Promise.resolve()
      .then(factory)
      .then((value) => {
        if (pending.get(key) === task) pending.delete(key);
        if (generation !== requestGeneration) {
          disposeEntry(createEntry(value, disposer));
          return value;
        }
        if (!entries.has(key)) entries.set(key, createEntry(value, disposer));
        return entries.get(key).value;
      }, (error) => {
        if (pending.get(key) === task) pending.delete(key);
        throw error;
      });
    pending.set(key, task);
    return task;
  }

  function peek(keyValue) {
    return entries.get(String(keyValue || ""))?.value || null;
  }

  function disposeEntry(entry) {
    if (typeof entry?.disposer === "function") return entry.disposer(entry.value);
    if (typeof entry?.value?.dispose === "function") return entry.value.dispose();
    if (typeof entry?.value?.destroy === "function") return entry.value.destroy();
    if (typeof entry?.value?.cancel === "function") return entry.value.cancel();
    return undefined;
  }

  function disposeAll() {
    generation += 1;
    pending.clear();
    const values = [...entries.values()].reverse();
    entries.clear();
    const errors = [];
    values.forEach((entry) => {
      try { disposeEntry(entry); } catch (error) { errors.push(error); }
    });
    if (errors.length) throw errors[0];
    return values.length;
  }

  return Object.freeze({
    disposeAll,
    get,
    getAsync,
    has: (keyValue) => {
      const key = String(keyValue || "");
      return entries.has(key) || pending.has(key);
    },
    peek,
    size: () => entries.size + pending.size,
  });
}
