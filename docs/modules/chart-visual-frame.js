(function initThinkStockChartVisualFrame(globalScope) {
  "use strict";

  function createCoordinator(scope = globalScope, options = {}) {
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    const applyFrame = options.applyFrame;
    if (typeof requestFrame !== "function") throw new Error("requestAnimationFrame is required");
    if (typeof applyFrame !== "function") throw new Error("applyFrame is required");

    let frameId = 0;
    let pendingSeries = new Map();
    let pendingMarkers = false;
    let pendingHandles = false;
    let pendingReasons = new Set();

    function takePending() {
      if (!pendingSeries.size && !pendingMarkers && !pendingHandles && !pendingReasons.size) return null;
      const frame = {
        series: [...pendingSeries.values()],
        markers: pendingMarkers,
        handles: pendingHandles,
        reasons: [...pendingReasons],
      };
      pendingSeries = new Map();
      pendingMarkers = false;
      pendingHandles = false;
      pendingReasons = new Set();
      return frame;
    }

    function flush() {
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
      const frame = takePending();
      if (frame) applyFrame(frame);
      return frame;
    }

    function schedule(update = {}) {
      const seriesKey = String(update.seriesKey || "");
      if (seriesKey) {
        pendingSeries.set(seriesKey, {
          seriesKey,
          traceIndex: Number.isInteger(update.traceIndex) ? update.traceIndex : null,
        });
      }
      pendingMarkers = pendingMarkers || update.markers === true;
      pendingHandles = pendingHandles || update.handles === true;
      if (update.reason) pendingReasons.add(String(update.reason));
      if (frameId) return;
      frameId = requestFrame(() => {
        frameId = 0;
        const frame = takePending();
        if (frame) applyFrame(frame);
      });
    }

    function cancel() {
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
      pendingSeries = new Map();
      pendingMarkers = false;
      pendingHandles = false;
      pendingReasons = new Set();
    }

    return Object.freeze({
      schedule,
      flush,
      cancel,
      hasPending: () => Boolean(
        frameId || pendingSeries.size || pendingMarkers || pendingHandles || pendingReasons.size
      ),
    });
  }

  globalScope.ThinkStockChartVisualFrame = Object.freeze({ createCoordinator });
}(typeof self !== "undefined" ? self : globalThis));
