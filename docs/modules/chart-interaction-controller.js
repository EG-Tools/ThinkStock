(function initChartInteractionController(globalScope) {
  "use strict";

  function createPointerFrameController(scope = globalScope, options = {}) {
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    const now = options.now || (() => scope.performance?.now?.() || Date.now());
    const readGeometry = options.readGeometry;
    const processFrame = options.processFrame;
    const geometryTtlMs = Math.max(0, Number(options.geometryTtlMs) || 240);
    const hitTestIntervalMs = Math.max(0, Number(options.hitTestIntervalMs) || 50);
    let geometryCache = new WeakMap();
    let pending = null;
    let frameId = 0;
    let lastHitTestAt = Number.NEGATIVE_INFINITY;

    if (typeof requestFrame !== "function") {
      throw new Error("requestAnimationFrame is required");
    }
    if (typeof readGeometry !== "function" || typeof processFrame !== "function") {
      throw new Error("readGeometry and processFrame are required");
    }

    function geometryFor(element, timestamp) {
      if (!element) return null;
      const cached = geometryCache.get(element);
      const xAxis = element?._fullLayout?.xaxis;
      const yAxis = element?._fullLayout?.yaxis;
      if (
        cached
        && cached.xAxis === xAxis
        && cached.yAxis === yAxis
        && timestamp - cached.at <= geometryTtlMs
      ) {
        return cached.geometry;
      }
      const geometry = readGeometry(element);
      geometryCache.set(element, {
        at: timestamp,
        xAxis,
        yAxis,
        geometry,
      });
      return geometry;
    }

    function schedule(payload) {
      pending = payload;
      if (frameId) return;
      frameId = requestFrame(() => {
        frameId = 0;
        const next = pending;
        pending = null;
        if (!next) return;
        const timestamp = now();
        const runHitTest = Boolean(
          next.findLineTarget
          && timestamp - lastHitTestAt >= hitTestIntervalMs
        );
        if (runHitTest) lastHitTestAt = timestamp;
        processFrame({
          ...next,
          timestamp,
          runHitTest,
          geometry: geometryFor(next.sourceEl, timestamp),
        });
      });
    }

    function cancel() {
      pending = null;
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
    }

    function invalidate(element = null) {
      if (element) geometryCache.delete(element);
      else geometryCache = new WeakMap();
    }

    return Object.freeze({
      schedule,
      cancel,
      invalidate,
      hasPending: () => Boolean(frameId || pending),
    });
  }

  globalScope.ThinkStockChartInteractionController = Object.freeze({
    createPointerFrameController,
  });
}(typeof self !== "undefined" ? self : globalThis));
