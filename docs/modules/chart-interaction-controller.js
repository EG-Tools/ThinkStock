(function initChartInteractionController(globalScope) {
  "use strict";

  function latestPointerSample(event) {
    const samples = typeof event?.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : null;
    return samples?.length ? samples[samples.length - 1] : event;
  }

  function bindPointerDrag(target, options = {}) {
    if (!target?.addEventListener || !target?.removeEventListener) {
      throw new TypeError("pointer drag target is required");
    }
    const pointerId = options.pointerId;
    const onMove = typeof options.onMove === "function" ? options.onMove : () => {};
    const onEnd = typeof options.onEnd === "function" ? options.onEnd : () => {};
    let lastClientY = Number.NaN;
    let active = true;

    const cleanup = () => {
      if (!active) return;
      active = false;
      target.removeEventListener("pointermove", pointerMove);
      target.removeEventListener("pointerup", pointerEnd);
      target.removeEventListener("pointercancel", pointerCancel);
    };
    const pointerMove = (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault?.();
      const sample = latestPointerSample(event);
      lastClientY = Number(sample?.clientY);
      onMove(lastClientY, sample);
    };
    const pointerEnd = (event) => {
      if (event.pointerId !== pointerId) return;
      cleanup();
      onEnd(Number(event.clientY), event, false);
    };
    const pointerCancel = (event) => {
      if (event.pointerId !== pointerId) return;
      cleanup();
      onEnd(Number.isFinite(lastClientY) ? lastClientY : Number(event.clientY), event, true);
    };

    target.addEventListener("pointermove", pointerMove, { passive: false });
    target.addEventListener("pointerup", pointerEnd);
    target.addEventListener("pointercancel", pointerCancel);
    return Object.freeze({ cancel: cleanup, isActive: () => active });
  }

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

  function createLatestFrameScheduler(scope = globalScope, apply, options = {}) {
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    if (typeof requestFrame !== "function" || typeof apply !== "function") {
      throw new Error("requestAnimationFrame and apply callback are required");
    }
    let pending = null;
    let frameId = 0;
    const stats = { scheduled: 0, applied: 0, coalesced: 0 };

    function applyPending() {
      if (!pending) return undefined;
      const next = pending;
      pending = null;
      stats.applied += 1;
      return apply(next);
    }

    function schedule(value) {
      stats.scheduled += 1;
      if (pending) stats.coalesced += 1;
      pending = value;
      if (frameId) return;
      frameId = requestFrame(() => {
        frameId = 0;
        applyPending();
      });
    }

    function flush() {
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
      return applyPending();
    }

    function cancel() {
      pending = null;
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
    }

    return Object.freeze({
      cancel,
      flush,
      hasPending: () => Boolean(frameId || pending),
      schedule,
      stats: () => ({ ...stats, pending: Boolean(pending) }),
    });
  }

  globalScope.ThinkStockChartInteractionController = Object.freeze({
    bindPointerDrag,
    createLatestFrameScheduler,
    createPointerFrameController,
    latestPointerSample,
  });
}(typeof self !== "undefined" ? self : globalThis));
