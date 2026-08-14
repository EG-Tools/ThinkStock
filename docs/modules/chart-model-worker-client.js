(function initThinkStockChartModelWorkerClient(globalScope) {
  "use strict";

  function createChartModelWorkerClient(scope = globalScope, options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 10000);
    const mainType = String(options.mainType || "buildMainChartModel");
    const workerUrl = options.workerUrl;
    let worker = null;
    let sequence = 0;
    let active = null;
    let queued = new Map();
    const dataKeys = new Map();
    let disposed = false;
    const counters = {
      dispatched: 0,
      sourceTransfers: 0,
      superseded: 0,
      dispatchByType: {},
    };

    const resolveWorkerUrl = () => (
      typeof workerUrl === "function" ? workerUrl() : String(workerUrl || "")
    );

    function takeNext() {
      if (!queued.size) return null;
      const type = queued.has(mainType) ? mainType : queued.keys().next().value;
      const request = queued.get(type);
      queued.delete(type);
      return request;
    }

    function dispatchNext() {
      if (disposed || active) return;
      const next = takeNext();
      if (next) dispatch(next);
    }

    function resetWorker(target = worker) {
      if (target && target === worker) worker = null;
      dataKeys.clear();
      try { target?.terminate(); } catch (_) {}
    }

    function settleActive(message) {
      if (!active || message?.id !== active.id) return false;
      const request = active;
      active = null;
      scope.clearTimeout(request.timer);

      if (request.superseded) {
        request.resolve(null);
      } else if (message.ok) {
        request.resolve(message.result || {});
      } else {
        dataKeys.delete(request.type);
        request.reject(new Error(message.error || "chart worker failed"));
      }
      dispatchNext();
      return true;
    }

    function rejectActive(error, targetWorker) {
      const request = active;
      active = null;
      if (request) {
        scope.clearTimeout(request.timer);
        request.reject(error);
      }
      resetWorker(targetWorker);
      dispatchNext();
    }

    function ensureWorker() {
      if (worker) return worker;
      if (typeof scope.Worker !== "function") throw new Error("chart worker is unavailable");
      const nextWorker = new scope.Worker(resolveWorkerUrl());
      nextWorker.onmessage = (event) => settleActive(event.data || {});
      nextWorker.onerror = (event) => {
        if (worker !== nextWorker) return;
        rejectActive(new Error(event?.message || "chart worker failed"), nextWorker);
      };
      worker = nextWorker;
      return worker;
    }

    function dispatch(request) {
      let targetWorker;
      try {
        targetWorker = ensureWorker();
      } catch (error) {
        request.reject(error);
        dispatchNext();
        return;
      }

      const type = request.type || mainType;
      const id = `chart-${type}-${Date.now()}-${++sequence}`;
      const { datasetKey, sources, ...config } = request.payload || {};
      const cacheSources = Boolean(datasetKey && sources);
      const includeSources = cacheSources && dataKeys.get(type) !== datasetKey;
      const payload = cacheSources
        ? { ...config, datasetKey, ...(includeSources ? { sources } : {}) }
        : request.payload;
      if (includeSources) dataKeys.set(type, datasetKey);

      counters.dispatched += 1;
      counters.dispatchByType[type] = (Number(counters.dispatchByType[type]) || 0) + 1;
      if (includeSources) counters.sourceTransfers += 1;

      const timer = scope.setTimeout(() => {
        if (!active || active.id !== id) return;
        const timedOut = active;
        active = null;
        timedOut.reject(new Error("chart worker timeout"));
        resetWorker(targetWorker);
        dispatchNext();
      }, timeoutMs);
      active = { ...request, id, timer, type, superseded: false };

      try {
        targetWorker.postMessage({ id, type, payload });
      } catch (error) {
        const failed = active;
        active = null;
        scope.clearTimeout(timer);
        dataKeys.delete(type);
        failed.reject(error);
        resetWorker(targetWorker);
        dispatchNext();
      }
    }

    function request(payload, type = mainType) {
      if (disposed) return Promise.reject(new Error("chart worker client is disposed"));
      return new Promise((resolve, reject) => {
        const next = { payload, type: String(type || mainType), resolve, reject };
        if (!active) {
          dispatch(next);
          return;
        }

        const previousQueued = queued.get(next.type);
        if (previousQueued) {
          counters.superseded += 1;
          previousQueued.resolve(null);
        }
        queued.set(next.type, next);
        if (active.type === next.type && !active.superseded) {
          active.superseded = true;
          counters.superseded += 1;
        }
      });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (active) {
        scope.clearTimeout(active.timer);
        active.resolve(null);
        active = null;
      }
      queued.forEach((request) => request.resolve(null));
      queued = new Map();
      resetWorker();
    }

    return Object.freeze({
      dispose,
      request,
      stats: () => ({
        ...counters,
        dispatchByType: { ...counters.dispatchByType },
        activeType: active?.type || "",
        queuedTypes: [...queued.keys()],
        workerActive: Boolean(worker),
      }),
    });
  }

  globalScope.ThinkStockChartModelWorkerClient = Object.freeze({
    createChartModelWorkerClient,
  });
}(typeof self !== "undefined" ? self : globalThis));
