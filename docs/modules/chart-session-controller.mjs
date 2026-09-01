"use strict";

  function relatedSeriesTransformKeys(seriesKey) {
    const key = String(seriesKey || "").trim();
    if (!key) return [];
    return key.startsWith("eps:") ? [key] : [key, `eps:${key}`];
  }

  function clearSeriesTransforms(state, seriesKey = "") {
    if (!state || typeof state !== "object") return false;
    const offsets = state.seriesOffsets && typeof state.seriesOffsets === "object"
      ? state.seriesOffsets : {};
    const scales = state.seriesScales && typeof state.seriesScales === "object"
      ? state.seriesScales : {};
    const keys = relatedSeriesTransformKeys(seriesKey);
    if (!keys.length) {
      const changed = Object.keys(offsets).length > 0 || Object.keys(scales).length > 0;
      state.seriesOffsets = {};
      state.seriesScales = {};
      return changed;
    }

    let changed = false;
    keys.forEach((key) => {
      changed = Object.hasOwn(offsets, key) || Object.hasOwn(scales, key) || changed;
      delete offsets[key];
      delete scales[key];
    });
    return changed;
  }

  function finiteSeriesMap(source) {
    return Object.fromEntries(Object.entries(source || {}).filter(([, value]) => (
      Number.isFinite(Number(value)) && Math.abs(Number(value)) > 1e-9
    )));
  }

  function captureLockedChartFrame(state, model) {
    if (!state || state.autoChartReset || !model) return state?.lockedChartFrame || null;
    state.lockedChartFrame = {
      // Existing entries win so moving the history window cannot silently rebase a visible series.
      normBases: {
        ...finiteSeriesMap(model.normBases),
        ...finiteSeriesMap(state.lockedChartFrame?.normBases),
      },
      autoScales: {
        ...finiteSeriesMap(model.autoScales),
        ...finiteSeriesMap(state.lockedChartFrame?.autoScales),
      },
    };
    return state.lockedChartFrame;
  }

  function captureLockedHistoryYRange(state, range, model) {
    if (!state || state.autoChartReset) return state?.lockedHistoryYRange || null;
    captureLockedChartFrame(state, model);
    if (Array.isArray(range) && range.length >= 2
      && range.every((value) => Number.isFinite(Number(value)))) {
      state.lockedHistoryYRange = [Number(range[0]), Number(range[1])];
    }
    return state.lockedHistoryYRange || null;
  }

  function createChartSessionController(scope = globalThis, options = {}) {
    const state = options.state;
    if (!state || typeof state !== "object") {
      throw new Error("chart session state is required");
    }

    let disposed = false;

    function applyResetPolicy(change) {
      if (disposed) return false;
      const kind = String(change || "");
      if (kind === "manual") {
        state.pendingAutoChartFit = false;
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
        return true;
      }
      return false;
    }

    function setAutoScale(enabled) {
      if (disposed) return { enabled: state.autoChartReset, visibleRange: null };
      const nextEnabled = Boolean(enabled);
      const visibleRange = nextEnabled ? options.getVisibleRange?.() : null;

      state.autoChartReset = nextEnabled;
      state.pendingAutoChartFit = false;
      state.pendingCompositionViewport = null;

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
    }

    return Object.freeze({
      applyResetPolicy,
      dispose,
      setAutoScale,
      stats: () => ({ autoFitPending: false, disposed }),
    });
  }

// Session state belongs to the chart session lifecycle.

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

// Visible-series policy belongs to the chart session lifecycle.

  function resolveSeriesKey(seriesKeys, requestedKey) {
    const requested = String(requestedKey || "").trim();
    if (!requested) return "";
    return (Array.isArray(seriesKeys) ? seriesKeys : []).find((candidate) => (
      candidate === requested || String(candidate).toUpperCase() === requested.toUpperCase()
    )) || requested;
  }

  function seriesOrderIdentity(value) {
    return String(value || "").trim().toUpperCase();
  }

  function uniqueSeriesOrder(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).flatMap((value) => {
      const key = String(value || "").trim();
      const identity = seriesOrderIdentity(key);
      if (!key || seen.has(identity)) return [];
      seen.add(identity);
      return [key];
    });
  }

  /** Later activations render later so their opaque stroke owns overlap pixels. */
  function orderItemsByActivation(items, activationOrder, resolveKey = (item) => item) {
    const source = Array.isArray(items) ? items : [];
    const ranks = new Map(uniqueSeriesOrder(activationOrder).map((key, index) => (
      [seriesOrderIdentity(key), index]
    )));
    return source.map((item, index) => ({
      index,
      item,
      rank: ranks.get(seriesOrderIdentity(resolveKey(item))),
    })).sort((left, right) => {
      const leftRanked = Number.isInteger(left.rank);
      const rightRanked = Number.isInteger(right.rank);
      if (leftRanked && rightRanked) return left.rank - right.rank || left.index - right.index;
      if (leftRanked !== rightRanked) return leftRanked ? 1 : -1;
      return left.index - right.index;
    }).map(({ item }) => item);
  }

  /** Keeps prior activation order and appends newly visible series. */
  function reconcileSeriesActivationOrder(order, visibleSeries) {
    const visible = uniqueSeriesOrder(visibleSeries);
    const visibleByIdentity = new Map(visible.map((key) => [seriesOrderIdentity(key), key]));
    const reconciled = uniqueSeriesOrder(order).flatMap((key) => {
      const visibleKey = visibleByIdentity.get(seriesOrderIdentity(key));
      if (!visibleKey) return [];
      visibleByIdentity.delete(seriesOrderIdentity(key));
      return [visibleKey];
    });
    return [...reconciled, ...visibleByIdentity.values()];
  }

  /** A newly activated series always becomes the last information row. */
  function updateSeriesActivationOrder(order, seriesKey, visible) {
    const key = String(seriesKey || "").trim();
    const identity = seriesOrderIdentity(key);
    if (!identity) return uniqueSeriesOrder(order);
    const next = uniqueSeriesOrder(order).filter((item) => (
      seriesOrderIdentity(item) !== identity
    ));
    if (visible) next.push(key);
    return next;
  }

  function createMainSeriesController(options = {}) {
    const hiddenSeries = options.hiddenSeries;
    if (!(hiddenSeries instanceof Set) || typeof options.getSeriesKeys !== "function") {
      throw new Error("main series controller dependencies are incomplete");
    }
    const maximumVisible = Math.max(1, Number(options.maximumVisible) || 10);
    const seriesKeys = () => options.getSeriesKeys().map(String).filter(Boolean);
    const visibleKeys = () => seriesKeys().filter((key) => !hiddenSeries.has(key));
    const readActivationOrder = () => options.getActivationOrder?.() || [];
    const writeActivationOrder = (value) => options.setActivationOrder?.(value);

    function activationOrder(visibleSeries = visibleKeys()) {
      // Only authoritative visibility may mutate the persisted activation order.
      // An older async render can pass a partial series list here after a newer
      // toggle; that list is only a projection and must not rewrite user order.
      const current = reconcileSeriesActivationOrder(readActivationOrder(), visibleKeys());
      writeActivationOrder(current);
      return reconcileSeriesActivationOrder(current, visibleSeries);
    }

    function noteActivation(seriesKey, visible) {
      const next = updateSeriesActivationOrder(readActivationOrder(), seriesKey, visible);
      writeActivationOrder(next);
      return next;
    }

    function setVisible(seriesKey, visible, setOptions = {}) {
      const key = resolveSeriesKey(seriesKeys(), seriesKey);
      if (!key) return false;
      const wasVisible = !hiddenSeries.has(key);
      if (!visible) {
        hiddenSeries.add(key);
        if (wasVisible) noteActivation(key, false);
        return true;
      }
      if (!hiddenSeries.has(key)) {
        const identity = seriesOrderIdentity(key);
        if (!uniqueSeriesOrder(readActivationOrder()).some((item) => (
          seriesOrderIdentity(item) === identity
        ))) noteActivation(key, true);
        return true;
      }
      if (seriesKeys().includes(key) && visibleKeys().length >= maximumVisible) {
        if (setOptions.notify !== false) options.onLimit?.(maximumVisible);
        return false;
      }
      hiddenSeries.delete(key);
      noteActivation(key, true);
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
      activationOrder(visibleKeys());
      return hiddenByLimit;
    }

    function forget(seriesKey) {
      const key = resolveSeriesKey(seriesKeys(), seriesKey);
      hiddenSeries.delete(key);
      noteActivation(key, false);
      return key;
    }

    function resolveVisibleStock(currentKey, isStockSeries) {
      const stocks = visibleKeys().filter((key) => isStockSeries?.(key));
      return stocks.includes(currentKey) ? currentKey : stocks.at(-1) || "";
    }

    return Object.freeze({
      activationOrder,
      enforceLimit,
      forget,
      resolveVisibleStock,
      setVisible,
      visibleKeys,
    });
  }

export {
  captureLockedChartFrame,
  captureLockedHistoryYRange,
  clearSeriesTransforms,
  createChartSessionController,
  createChartSessionState,
  createMainSeriesController,
  orderItemsByActivation,
  reconcileSeriesActivationOrder,
  relatedSeriesTransformKeys,
  resolveSeriesKey,
  updateSeriesActivationOrder,
};
