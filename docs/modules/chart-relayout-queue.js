(function initThinkStockChartRelayoutQueue(globalScope) {
  "use strict";

  function createLatestKeyedFrameQueue(scope = globalScope, options = {}) {
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    const apply = options.apply;
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    if (typeof requestFrame !== "function" || typeof apply !== "function") {
      throw new Error("frame queue dependencies are incomplete");
    }

    const pending = new Map();
    const stats = { scheduled: 0, appliedBatches: 0, coalesced: 0 };
    let frameId = 0;
    let inFlight = null;
    let disposed = false;

    function requestRun() {
      if (disposed || frameId || inFlight || !pending.size) return;
      frameId = requestFrame(runNext);
    }

    function runNext() {
      frameId = 0;
      if (disposed || inFlight || !pending.size) return;
      const batch = [...pending.values()];
      pending.clear();
      stats.appliedBatches += 1;
      inFlight = Promise.resolve()
        .then(() => apply(batch))
        .catch(onError)
        .finally(() => {
          inFlight = null;
          requestRun();
        });
    }

    function schedule(key, value) {
      if (disposed) return false;
      const normalizedKey = String(key || "default");
      stats.scheduled += 1;
      if (pending.has(normalizedKey)) stats.coalesced += 1;
      pending.set(normalizedKey, value);
      requestRun();
      return true;
    }

    function cancelPending() {
      pending.clear();
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
    }

    function dispose() {
      disposed = true;
      cancelPending();
    }

    return Object.freeze({
      cancelPending,
      dispose,
      isBusy: () => Boolean(frameId || inFlight || pending.size),
      schedule,
      stats: () => ({
        ...stats,
        inFlight: Boolean(inFlight),
        pending: pending.size,
      }),
    });
  }

  globalScope.ThinkStockChartRelayoutQueue = Object.freeze({
    createLatestKeyedFrameQueue,
  });
}(typeof self !== "undefined" ? self : globalThis));
