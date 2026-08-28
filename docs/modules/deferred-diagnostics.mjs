"use strict";

  function createDeferredDiagnostics(scope = globalThis, options = {}) {
    const createDiagnostics = typeof options.createPerformanceDiagnostics === "function"
      ? options.createPerformanceDiagnostics
      : null;
    const createOptions = options.createOptions || {};
    const getScheduler = typeof options.getScheduler === "function"
      ? options.getScheduler
      : () => options.scheduler || null;
    const schedulerKey = String(options.schedulerKey || "performance-diagnostics-load");
    let instance = null;
    let loadTimer = 0;
    let idleHandle = 0;

    function createInstance() {
      if (typeof createDiagnostics !== "function") {
        throw new Error("Performance diagnostics module failed to load");
      }
      if (!instance) instance = createDiagnostics(scope, createOptions);
      return instance;
    }

    function ensure() {
      if (instance) return Promise.resolve(instance);
      try {
        return Promise.resolve(createInstance());
      } catch (error) {
        return Promise.reject(error);
      }
    }

    function scheduleAutomaticCapture(metadata = {}, scheduleOptions = {}) {
      const delayMs = Math.max(1000, Number(scheduleOptions.delayMs) || 30000);
      const idleTimeoutMs = Math.max(1000, Number(scheduleOptions.idleTimeoutMs) || 10000);
      const scheduler = getScheduler();
      if (scheduler?.enqueue) {
        scheduler.enqueue(schedulerKey, () => ensure()
          .then((diagnostics) => diagnostics.startAutomaticCapture(
            metadata,
            scheduleOptions.captureOptions || {},
          )), {
          delayMs,
          priority: Number(scheduleOptions.priority) || -50,
        }).catch(() => {});
        return;
      }
      if (loadTimer) scope.clearTimeout?.(loadTimer);
      loadTimer = scope.setTimeout?.(() => {
        loadTimer = 0;
        const run = () => {
          idleHandle = 0;
          ensure()
            .then((diagnostics) => diagnostics.startAutomaticCapture(
              metadata,
              scheduleOptions.captureOptions || {},
            ))
            .catch(() => {});
        };
        if (typeof scope.requestIdleCallback === "function") {
          idleHandle = scope.requestIdleCallback(run, { timeout: idleTimeoutMs });
        } else {
          idleHandle = scope.setTimeout?.(run, 250) || 0;
        }
      }, delayMs) || 0;
    }

    function cancelScheduledCapture() {
      getScheduler()?.cancel?.(schedulerKey);
      if (loadTimer) scope.clearTimeout?.(loadTimer);
      if (idleHandle) {
        if (typeof scope.cancelIdleCallback === "function") scope.cancelIdleCallback(idleHandle);
        else scope.clearTimeout?.(idleHandle);
      }
      loadTimer = 0;
      idleHandle = 0;
      instance?.dispose?.();
      instance = null;
    }

    return Object.freeze({
      ensure,
      scheduleAutomaticCapture,
      cancelScheduledCapture,
      isLoaded: () => Boolean(instance),
    });
  }

export { createDeferredDiagnostics };
