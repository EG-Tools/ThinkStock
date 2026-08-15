(function initThinkStockChartRenderScheduler(globalScope) {
  "use strict";

  function createChartRenderScheduler(scope = globalScope, options = {}) {
    const deferDelayMs = Math.max(0, Number(options.deferDelayMs) || 0);
    const requestFrame = options.requestFrame || ((callback) => scope.requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame || ((id) => scope.cancelAnimationFrame?.(id));
    const setTimer = options.setTimer || ((callback, delay) => scope.setTimeout(callback, delay));
    const clearTimer = options.clearTimer || ((id) => scope.clearTimeout(id));
    const isInteractionBusy = options.isInteractionBusy || (() => false);
    const render = options.render;
    if (typeof render !== "function") throw new Error("chart render callback is required");

    let frameId = 0;
    let deferredTimer = 0;
    let inFlightPromise = null;
    let renderAfterFlight = false;
    let pendingPreserveZoom = true;
    let deferredPreserveZoom = true;
    let disposed = false;
    let activeTransaction = null;
    let nextTransactionId = 1;
    let pendingRequestCount = 0;
    const pendingReasons = new Set();
    const pendingClasses = new Set();
    const invalidationCounts = {};
    let coalescedRequests = 0;
    let supersededTransactions = 0;

    function queueInvalidation(requestOptions = {}) {
      const reason = String(requestOptions.reason || "data");
      const updateClass = String(requestOptions.updateClass || "data");
      pendingRequestCount += 1;
      pendingReasons.add(reason);
      pendingClasses.add(updateClass);
      invalidationCounts[updateClass] = (Number(invalidationCounts[updateClass]) || 0) + 1;
      if (activeTransaction && updateClass !== "markers" && !activeTransaction.superseded) {
        activeTransaction.superseded = true;
        supersededTransactions += 1;
      }
    }

    function takeInvalidation() {
      const transaction = {
        id: nextTransactionId,
        requestCount: pendingRequestCount,
        superseded: false,
      };
      nextTransactionId += 1;
      const value = Object.freeze({
        reasons: [...pendingReasons],
        updateClasses: [...pendingClasses],
        transactionId: transaction.id,
        requestCount: transaction.requestCount,
        shouldAbort: () => transaction.superseded,
        transaction,
      });
      pendingReasons.clear();
      pendingClasses.clear();
      pendingRequestCount = 0;
      return value;
    }

    const reportError = (error) => {
      try { options.onError?.(error); } catch (_) {}
    };

    async function run(preserveZoom = true, requestOptions = null) {
      if (requestOptions) queueInvalidation(requestOptions);
      if (!pendingReasons.size) queueInvalidation({ reason: "immediate", updateClass: "data" });
      pendingPreserveZoom = pendingPreserveZoom && preserveZoom;
      if (inFlightPromise) {
        renderAfterFlight = true;
        coalescedRequests += 1;
        return inFlightPromise;
      }

      const firstPreserveZoom = pendingPreserveZoom;
      pendingPreserveZoom = true;
      const firstInvalidation = takeInvalidation();
      inFlightPromise = (async () => {
        let nextPreserveZoom = firstPreserveZoom;
        let nextInvalidation = firstInvalidation;
        try {
          while (!disposed) {
            renderAfterFlight = false;
            activeTransaction = nextInvalidation.transaction;
            await render(nextPreserveZoom, nextInvalidation);
            activeTransaction = null;
            if (!renderAfterFlight) {
              await options.afterBatch?.();
              break;
            }
            nextPreserveZoom = pendingPreserveZoom;
            pendingPreserveZoom = true;
            nextInvalidation = takeInvalidation();
          }
        } finally {
          activeTransaction = null;
          inFlightPromise = null;
          try { options.afterSettled?.(); } catch (_) {}
          if (!disposed && renderAfterFlight) {
            const retryPreserveZoom = pendingPreserveZoom;
            renderAfterFlight = false;
            pendingPreserveZoom = true;
            request(retryPreserveZoom, { deferDuringInteraction: false });
          }
        }
      })();
      return inFlightPromise;
    }

    function scheduleDeferred(preserveZoom = true) {
      deferredPreserveZoom = deferredPreserveZoom && preserveZoom;
      if (deferredTimer) clearTimer(deferredTimer);
      deferredTimer = setTimer(() => {
        deferredTimer = 0;
        const nextPreserveZoom = deferredPreserveZoom;
        deferredPreserveZoom = true;
        if (isInteractionBusy()) {
          scheduleDeferred(nextPreserveZoom);
          return;
        }
        request(nextPreserveZoom, { deferDuringInteraction: false });
      }, deferDelayMs);
    }

    function request(preserveZoom = true, requestOptions = {}) {
      if (disposed) return;
      queueInvalidation(requestOptions);
      if (requestOptions.deferDuringInteraction !== false && isInteractionBusy()) {
        scheduleDeferred(preserveZoom);
        return;
      }
      pendingPreserveZoom = pendingPreserveZoom && preserveZoom;
      if (frameId || inFlightPromise) {
        coalescedRequests += 1;
        if (inFlightPromise) renderAfterFlight = true;
        return;
      }
      frameId = requestFrame(() => {
        const nextPreserveZoom = pendingPreserveZoom;
        frameId = 0;
        pendingPreserveZoom = true;
        run(nextPreserveZoom).catch(reportError);
      });
    }

    function runWhenIdleOrNow(preserveZoom = true) {
      if (isInteractionBusy()) {
        request(preserveZoom);
        return false;
      }
      run(preserveZoom).catch(reportError);
      return true;
    }

    function dispose() {
      disposed = true;
      if (frameId) cancelFrame(frameId);
      if (deferredTimer) clearTimer(deferredTimer);
      frameId = 0;
      deferredTimer = 0;
    }

    return Object.freeze({
      dispose,
      isRendering: () => Boolean(frameId || inFlightPromise),
      request,
      run,
      runWhenIdleOrNow,
      stats: () => ({
        framePending: Boolean(frameId),
        inFlight: Boolean(inFlightPromise),
        deferred: Boolean(deferredTimer),
        renderAfterFlight,
        coalescedRequests,
        supersededTransactions,
        activeTransactionId: activeTransaction?.id || 0,
        invalidationCounts: { ...invalidationCounts },
        pendingReasons: [...pendingReasons],
        pendingClasses: [...pendingClasses],
      }),
    });
  }

  globalScope.ThinkStockChartRenderScheduler = Object.freeze({
    createChartRenderScheduler,
  });
}(typeof self !== "undefined" ? self : globalThis));
