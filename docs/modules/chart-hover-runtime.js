(function initThinkStockChartHoverRuntime(globalScope) {
  "use strict";

  function createChartHoverRuntime(scope = globalScope, options = {}) {
    const findNearestHoverPoint = options.findNearestHoverPoint;
    const getTraceTimeMsArray = options.getTraceTimeMsArray;
    const toMsSafe = options.toMsSafe;
    if (typeof findNearestHoverPoint !== "function"
      || typeof getTraceTimeMsArray !== "function"
      || typeof toMsSafe !== "function") {
      throw new Error("chart hover runtime dependencies are required");
    }

    const requestFrame = scope.requestAnimationFrame?.bind(scope)
      || ((callback) => scope.setTimeout(callback, 16));
    const cancelFrame = scope.cancelAnimationFrame?.bind(scope)
      || scope.clearTimeout?.bind(scope)
      || (() => {});
    let hoverSyncing = false;
    let hoverSyncFrame = 0;
    let pendingHoverSync = null;
    let lastHoverSyncKey = "";

    function setSyncing(value) {
      hoverSyncing = Boolean(value);
      options.onSyncingChange?.(hoverSyncing);
    }

    function syncHoverToChartNow(targetEl, xValue) {
      const plotly = scope.Plotly;
      if (!targetEl || !plotly?.Fx?.hover || xValue == null) return;
      setSyncing(true);
      const nearestPoint = findNearestHoverPoint(targetEl, xValue);
      try {
        plotly.Fx.hover(targetEl, nearestPoint ? [nearestPoint] : [{ xval: xValue }], ["xy"]);
      } catch (_) {
        if (!nearestPoint) {
          requestFrame(() => setSyncing(false));
          return;
        }
        try {
          plotly.Fx.hover(targetEl, [{ xval: xValue }], ["xy"]);
        } catch (_) {
          // Plotly may reject a hover request while a chart is being replaced.
        }
      }
      requestFrame(() => setSyncing(false));
    }

    function syncHoverToChart(targetEl, xValue) {
      if (!targetEl || xValue == null) return;
      const key = `${targetEl.id || "chart"}|${String(xValue)}`;
      pendingHoverSync = { targetEl, xValue, key };
      if (hoverSyncFrame) return;
      hoverSyncFrame = requestFrame(() => {
        const pending = pendingHoverSync;
        pendingHoverSync = null;
        hoverSyncFrame = 0;
        if (!pending || pending.key === lastHoverSyncKey) return;
        lastHoverSyncKey = pending.key;
        syncHoverToChartNow(pending.targetEl, pending.xValue);
      });
    }

    function nearestMainLineDate(chartEl, xValue) {
      const targetMs = toMsSafe(xValue);
      if (!Number.isFinite(targetMs)) return "";
      let nearestDate = "";
      let nearestDistance = Number.POSITIVE_INFINITY;
      (chartEl?.data || []).forEach((trace) => {
        if (!trace?.meta?.seriesKey || trace.meta.isAiForecastTrace || trace.visible === "legendonly") return;
        const times = getTraceTimeMsArray(trace);
        let low = 0;
        let high = times.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (times[middle] < targetMs) low = middle + 1;
          else high = middle;
        }
        [low - 1, low].forEach((index) => {
          const time = times[index];
          if (!Number.isFinite(time)) return;
          const distance = Math.abs(time - targetMs);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestDate = String(trace.x[index] || "").slice(0, 10);
          }
        });
      });
      return nearestDate;
    }

    function configureExactDateEventHover(chartEl, eventData) {
      const axis = chartEl?._fullLayout?.xaxis;
      const rect = chartEl?.getBoundingClientRect?.();
      const clientX = Number(eventData?.clientX ?? eventData?.event?.clientX);
      if (!axis || !rect || !Number.isFinite(clientX) || typeof axis.p2d !== "function") return;
      const axisPixel = clientX - rect.left - Number(axis._offset || 0);
      const anchorDate = nearestMainLineDate(chartEl, axis.p2d(axisPixel));
      if (!anchorDate) return;

      const traceCount = Math.max(chartEl.data?.length || 0, chartEl._fullData?.length || 0);
      for (let curveNumber = 0; curveNumber < traceCount; curveNumber += 1) {
        const inputTrace = chartEl.data?.[curveNumber];
        const fullTrace = chartEl._fullData?.[curveNumber];
        const meta = fullTrace?.meta || inputTrace?.meta;
        if (!meta?.isDisclosureTrace
          && !meta?.isInsiderTradeTrace
          && !meta?.isCrisisSignalTrace
          && !meta?.isMarketTimingBuyTrace
          && !meta?.isMarketTimingSellTrace) continue;
        const dates = Array.isArray(inputTrace?.x) ? inputTrace.x : fullTrace?.x || [];
        const hasExactDate = dates.some((date) => String(date || "").slice(0, 10) === anchorDate);
        if (inputTrace) inputTrace.hoverinfo = hasExactDate ? "all" : "skip";
        if (fullTrace) fullTrace.hoverinfo = hasExactDate ? "all" : "skip";
      }
    }

    function clearHoverOnChart(targetEl) {
      const plotly = scope.Plotly;
      if (!targetEl || !plotly?.Fx?.unhover) return;
      if (hoverSyncFrame) {
        cancelFrame(hoverSyncFrame);
        hoverSyncFrame = 0;
      }
      pendingHoverSync = null;
      lastHoverSyncKey = "";
      setSyncing(true);
      try {
        plotly.Fx.unhover(targetEl);
      } catch (_) {
        // The chart may be detached during a responsive relayout.
      }
      requestFrame(() => setSyncing(false));
    }

    function destroy() {
      if (hoverSyncFrame) cancelFrame(hoverSyncFrame);
      hoverSyncFrame = 0;
      pendingHoverSync = null;
      lastHoverSyncKey = "";
      setSyncing(false);
    }

    return Object.freeze({
      clearHoverOnChart,
      configureExactDateEventHover,
      destroy,
      isSyncing: () => hoverSyncing,
      nearestMainLineDate,
      syncHoverToChart,
    });
  }

  globalScope.ThinkStockChartHoverRuntime = Object.freeze({ createChartHoverRuntime });
}(typeof self !== "undefined" ? self : globalThis));
