(function initThinkStockChartSessionController(globalScope) {
  "use strict";

  function createChartSessionController(scope = globalScope, options = {}) {
    const state = options.state;
    if (!state || typeof state !== "object") {
      throw new Error("chart session state is required");
    }

    const setTimer = options.setTimer || ((callback, delay) => scope.setTimeout(callback, delay));
    const clearTimer = options.clearTimer || ((id) => scope.clearTimeout(id));
    let autoFitTimer = 0;
    let disposed = false;

    function cancelAutoFit() {
      if (autoFitTimer) clearTimer(autoFitTimer);
      autoFitTimer = 0;
    }

    function applyResetPolicy(change, delay = 100) {
      if (disposed) return false;
      const kind = String(change || "viewport");
      if (kind === "manual" || kind === "composition") {
        state.viewportNormalizationFrame = null;
      }
      cancelAutoFit();

      if (kind === "manual") {
        state.pendingAutoChartFit = false;
        state.pendingAutoChartFitExpandOnly = false;
        if (!state.autoChartReset) return false;
        options.clearTransforms?.();
        state.pendingAutoChartFit = true;
        return true;
      }

      if (!state.autoChartReset) {
        if (kind === "composition") options.captureLockedRange?.();
        return false;
      }

      if (kind === "composition") {
        state.pendingAutoChartFit = true;
        state.pendingAutoChartFitExpandOnly = false;
        return true;
      }

      autoFitTimer = setTimer(() => {
        autoFitTimer = 0;
        if (!disposed && !options.isInteractionBusy?.()) options.fitCurrentViewport?.();
      }, Math.max(0, Number(delay) || 0));
      return true;
    }

    function setAutoScale(enabled) {
      if (disposed) return { enabled: state.autoChartReset, visibleRange: null };
      const nextEnabled = Boolean(enabled);
      const visibleRange = nextEnabled ? options.getVisibleRange?.() : null;

      state.autoChartReset = nextEnabled;
      state.pendingAutoChartFit = false;
      state.pendingAutoChartFitExpandOnly = false;
      state.viewportNormalizationFrame = null;
      state.pendingCompositionViewport = null;
      cancelAutoFit();

      if (nextEnabled) {
        state.pinnedXRange = Array.isArray(visibleRange) && visibleRange.length === 2
          ? visibleRange.map((value) => new Date(value).toISOString())
          : null;
        if (!state.pinnedXRange) state.userViewportPinned = false;
        options.clearTransforms?.();
        state.lockedChartFrame = null;
        state.lockedHistoryYRange = null;
        state.pendingAutoChartFit = true;
      } else {
        options.captureLockedRange?.();
      }

      return {
        enabled: nextEnabled,
        visibleRange: state.pinnedXRange ? [...state.pinnedXRange] : null,
      };
    }

    function dispose() {
      disposed = true;
      cancelAutoFit();
    }

    return Object.freeze({
      applyResetPolicy,
      dispose,
      setAutoScale,
      stats: () => ({ autoFitPending: Boolean(autoFitTimer), disposed }),
    });
  }

  globalScope.ThinkStockChartSessionController = Object.freeze({
    createChartSessionController,
  });
}(typeof self !== "undefined" ? self : globalThis));

// Session state belongs to the chart session lifecycle.
(function initThinkStockChartSessionState(globalScope) {
  "use strict";

  function cloneInitialValue(value) {
    if (value instanceof Set) return new Set(value);
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === "object") return { ...value };
    return value;
  }

  function createChartSessionState(initialState = {}) {
    const state = Object.fromEntries(Object.entries(initialState)
      .map(([key, value]) => [key, cloneInitialValue(value)]));
    return Object.seal(state);
  }

  globalScope.ThinkStockChartSessionState = Object.freeze({
    createChartSessionState,
  });
}(typeof self !== "undefined" ? self : globalThis));

// Visible-series policy belongs to the chart session lifecycle.
(function initThinkStockMainSeriesController(globalScope) {
  "use strict";

  function resolveSeriesKey(seriesKeys, requestedKey) {
    const requested = String(requestedKey || "").trim();
    if (!requested) return "";
    return (Array.isArray(seriesKeys) ? seriesKeys : []).find((candidate) => (
      candidate === requested || String(candidate).toUpperCase() === requested.toUpperCase()
    )) || requested;
  }

  function createMainSeriesController(options = {}) {
    const hiddenSeries = options.hiddenSeries;
    if (!(hiddenSeries instanceof Set) || typeof options.getSeriesKeys !== "function") {
      throw new Error("main series controller dependencies are incomplete");
    }
    const maximumVisible = Math.max(1, Number(options.maximumVisible) || 10);
    const seriesKeys = () => options.getSeriesKeys().map(String).filter(Boolean);
    const visibleKeys = () => seriesKeys().filter((key) => !hiddenSeries.has(key));

    function setVisible(seriesKey, visible, setOptions = {}) {
      const key = resolveSeriesKey(seriesKeys(), seriesKey);
      if (!key) return false;
      if (!visible) {
        hiddenSeries.add(key);
        return true;
      }
      if (!hiddenSeries.has(key)) return true;
      if (seriesKeys().includes(key) && visibleKeys().length >= maximumVisible) {
        if (setOptions.notify !== false) options.onLimit?.(maximumVisible);
        return false;
      }
      hiddenSeries.delete(key);
      return true;
    }

    function enforceLimit() {
      const hiddenByLimit = [];
      let visibleCount = 0;
      seriesKeys().forEach((key) => {
        if (hiddenSeries.has(key)) return;
        visibleCount += 1;
        if (visibleCount <= maximumVisible) return;
        hiddenSeries.add(key);
        hiddenByLimit.push(key);
      });
      return hiddenByLimit;
    }

    function resolveVisibleStock(currentKey, isStockSeries) {
      const stocks = visibleKeys().filter((key) => isStockSeries?.(key));
      return stocks.includes(currentKey) ? currentKey : stocks.at(-1) || "";
    }

    return Object.freeze({ enforceLimit, resolveVisibleStock, setVisible, visibleKeys });
  }

  globalScope.ThinkStockMainSeriesController = Object.freeze({
    createMainSeriesController,
    resolveSeriesKey,
  });
}(typeof self !== "undefined" ? self : globalThis));
