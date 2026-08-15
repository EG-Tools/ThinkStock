(function initThinkStockChartUpdateCoordinator(globalScope) {
  "use strict";

  const MAIN_ONLY_UPDATE_CLASSES = Object.freeze(new Set(["markers", "transform", "forecast"]));

  function shouldUpdateAuxiliary(invalidation = {}) {
    const updateClasses = [...new Set((invalidation.updateClasses || []).map(String).filter(Boolean))];
    if (!updateClasses.length) return true;
    return updateClasses.some((updateClass) => !MAIN_ONLY_UPDATE_CLASSES.has(updateClass));
  }

  function createChartUpdateCoordinator(scope = globalScope, options = {}) {
    if (typeof options.requestRender !== "function") {
      throw new Error("chart render request callback is required");
    }
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    const eventLayers = Object.fromEntries((options.eventLayers || ["disclosure", "insider"])
      .map((layer) => [String(layer), { revision: 0, renderedRevision: 0 }]));
    let eventFrame = 0;
    let disposed = false;
    const stats = {
      compositionRequests: 0,
      eventRequests: 0,
      renderRequests: 0,
      coalescedEventFrames: 0,
      requestsByClass: {},
    };

    function classifyRequest(requestOptions = {}) {
      if (requestOptions.updateClass) return String(requestOptions.updateClass);
      const reason = String(requestOptions.reason || "data");
      if (reason.includes("event") || reason.includes("marker")) return "markers";
      if (reason.includes("viewport") || reason.includes("zoom") || reason.includes("range")) return "viewport";
      if (reason.includes("transform") || reason.includes("scale")) return "transform";
      if (reason.includes("composition")) return "composition";
      return "data";
    }

    function requestRender(preserveZoom = true, requestOptions = {}) {
      if (disposed) return undefined;
      stats.renderRequests += 1;
      const updateClass = classifyRequest(requestOptions);
      stats.requestsByClass[updateClass] = (Number(stats.requestsByClass[updateClass]) || 0) + 1;
      return options.requestRender(preserveZoom, { ...requestOptions, updateClass });
    }

    function requestComposition(requestOptions = {}) {
      if (disposed) return undefined;
      stats.compositionRequests += 1;
      options.prepareComposition?.(Boolean(requestOptions.forceFitFull));
      options.applyResetPolicy?.("composition");
      options.persistState?.();
      return requestRender(requestOptions.preserveZoom !== false, {
        ...requestOptions,
        reason: requestOptions.reason || "composition",
        updateClass: "composition",
      });
    }

    function isLayerEnabled(layer) {
      return Boolean(options.isEventLayerEnabled?.(layer));
    }

    function hasPendingEvents() {
      return Object.entries(eventLayers).some(([layer, state]) => (
        isLayerEnabled(layer) && state.renderedRevision < state.revision
      ));
    }

    function scheduleEventRender() {
      if (disposed || !hasPendingEvents()) return false;
      if (eventFrame) {
        stats.coalescedEventFrames += 1;
        return true;
      }
      eventFrame = requestFrame(() => {
        eventFrame = 0;
        if (disposed || !hasPendingEvents()) return;
        // The active render records its starting revisions. Once it settles,
        // flush() schedules one more pass only when newer marker data exists.
        if (options.isRendering?.()) return;
        if (typeof options.requestMarkerFrame === "function") {
          options.requestMarkerFrame({
            reason: "event-marker-data",
            updateClass: "markers",
          });
          return;
        }
        requestRender(true, {
          deferDuringInteraction: false,
          reason: "event-marker-data",
          updateClass: "markers",
        });
      });
      return true;
    }

    function queueEvent(layer) {
      const state = eventLayers[String(layer)];
      if (!state || disposed) return false;
      state.revision += 1;
      stats.eventRequests += 1;
      if (isLayerEnabled(layer)) scheduleEventRender();
      return true;
    }

    function eventRevisions() {
      return Object.fromEntries(Object.entries(eventLayers)
        .map(([layer, state]) => [layer, state.revision]));
    }

    function markEventsApplied(revisions = {}) {
      Object.entries(eventLayers).forEach(([layer, state]) => {
        state.renderedRevision = Math.max(
          state.renderedRevision,
          Number(revisions[layer]) || 0,
        );
      });
    }

    function flush() {
      return scheduleEventRender();
    }

    function dispose() {
      disposed = true;
      if (eventFrame) cancelFrame?.(eventFrame);
      eventFrame = 0;
    }

    return Object.freeze({
      dispose,
      eventRevisions,
      flush,
      hasPendingEvents,
      markEventsApplied,
      queueEvent,
      requestComposition,
      requestRender,
      stats: () => ({
        ...stats,
        requestsByClass: { ...stats.requestsByClass },
        eventFramePending: Boolean(eventFrame),
      }),
    });
  }

  globalScope.ThinkStockChartUpdateCoordinator = Object.freeze({
    createChartUpdateCoordinator,
    shouldUpdateAuxiliary,
  });
}(typeof self !== "undefined" ? self : globalThis));

// Visual-frame coalescing shares the chart update lifecycle.
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
    let inFlightPromise = null;
    let renderAfterFlight = false;
    let nextTransactionId = 1;
    const settleWaiters = new Set();

    function settleWaitersIfIdle() {
      if (frameId || inFlightPromise || pendingSeries.size || pendingMarkers || pendingHandles) return;
      settleWaiters.forEach((resolve) => resolve());
      settleWaiters.clear();
    }

    function takePending() {
      if (!pendingSeries.size && !pendingMarkers && !pendingHandles && !pendingReasons.size) return null;
      const frame = {
        transactionId: nextTransactionId,
        series: [...pendingSeries.values()],
        markers: pendingMarkers,
        handles: pendingHandles,
        reasons: [...pendingReasons],
      };
      pendingSeries = new Map();
      pendingMarkers = false;
      pendingHandles = false;
      pendingReasons = new Set();
      nextTransactionId += 1;
      return frame;
    }

    function scheduleFrame() {
      if (frameId || inFlightPromise) {
        if (inFlightPromise) renderAfterFlight = true;
        return;
      }
      frameId = requestFrame(() => {
        frameId = 0;
        const frame = takePending();
        if (frame) apply(frame);
        else settleWaitersIfIdle();
      });
    }

    function apply(frame) {
      let result;
      try {
        result = applyFrame(frame);
      } catch (error) {
        options.onError?.(error);
        settleWaitersIfIdle();
        return;
      }
      if (!result || typeof result.then !== "function") {
        settleWaitersIfIdle();
        return;
      }
      inFlightPromise = Promise.resolve(result)
        .catch((error) => options.onError?.(error))
        .finally(() => {
          inFlightPromise = null;
          if (renderAfterFlight || pendingSeries.size || pendingMarkers || pendingHandles) {
            renderAfterFlight = false;
            scheduleFrame();
          } else {
            settleWaitersIfIdle();
          }
        });
    }

    function flush() {
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
      if (inFlightPromise) {
        renderAfterFlight = true;
        return null;
      }
      const frame = takePending();
      if (frame) apply(frame);
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
      scheduleFrame();
    }

    function cancel() {
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
      pendingSeries = new Map();
      pendingMarkers = false;
      pendingHandles = false;
      pendingReasons = new Set();
      renderAfterFlight = false;
      settleWaitersIfIdle();
    }

    function whenSettled() {
      if (!frameId && !inFlightPromise && !pendingSeries.size && !pendingMarkers && !pendingHandles) {
        return Promise.resolve();
      }
      return new Promise((resolve) => settleWaiters.add(resolve));
    }

    return Object.freeze({
      schedule,
      flush,
      cancel,
      whenSettled,
      hasPending: () => Boolean(
        frameId || inFlightPromise || pendingSeries.size || pendingMarkers || pendingHandles || pendingReasons.size
      ),
    });
  }

  globalScope.ThinkStockChartVisualFrame = Object.freeze({ createCoordinator });
}(typeof self !== "undefined" ? self : globalThis));
