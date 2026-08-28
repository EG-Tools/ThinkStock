"use strict";

  const MAIN_ONLY_UPDATE_CLASSES = Object.freeze(new Set([
    "markers",
    "transform",
    "forecast",
    "viewport",
  ]));
  const DATA_HYDRATION_UPDATE_CLASSES = Object.freeze(new Set(["data", "composition"]));

  /**
   * @typedef {"markers"|"transform"|"forecast"|"viewport"|"viewport-range"|"composition"|"data"} ChartUpdateClass
   * @typedef {{updateClasses?: ChartUpdateClass[], progressiveComposition?: boolean}} ChartInvalidation
   */

  /** @param {ChartInvalidation} invalidation */
  function normalizedUpdateClasses(invalidation = {}) {
    return [...new Set((invalidation.updateClasses || []).map(String).filter(Boolean))];
  }

  /** @param {ChartInvalidation} invalidation */
  function shouldUpdateAuxiliary(invalidation = {}) {
    const updateClasses = normalizedUpdateClasses(invalidation);
    if (!updateClasses.length) return true;
    return updateClasses.some((updateClass) => !MAIN_ONLY_UPDATE_CLASSES.has(updateClass));
  }

  /** @param {ChartInvalidation} invalidation */
  function shouldHydrateChartData(invalidation = {}) {
    const updateClasses = normalizedUpdateClasses(invalidation);
    if (!updateClasses.length) return true;
    return updateClasses.some((updateClass) => DATA_HYDRATION_UPDATE_CLASSES.has(updateClass));
  }

  function canReuseFutureOverlayTraces(invalidation = {}) {
    const updateClasses = normalizedUpdateClasses(invalidation);
    return updateClasses.length > 0
      && updateClasses.every((updateClass) => (
        updateClass === "viewport"
        || updateClass === "viewport-range"
        || updateClass === "transform"
      ));
  }

  function canReuseEventMarkerTraces(invalidation = {}) {
    const updateClasses = normalizedUpdateClasses(invalidation);
    return updateClasses.length > 0
      && updateClasses.every((updateClass) => (
        updateClass === "viewport" || updateClass === "viewport-range"
      ));
  }

  function createMainChartRenderGuard(options = {}) {
    const aiRevision = options.getAiRevision?.();
    const viewportRevision = options.getViewportRevision?.();
    const aiChanged = () => aiRevision !== options.getAiRevision?.();
    const viewportChanged = () => viewportRevision !== options.getViewportRevision?.();

    function queueCurrentViewportRender() {
      if (!viewportChanged()) return false;
      options.requestViewportRender?.();
      return true;
    }

    function shouldAbort(invalidation = {}) {
      return aiChanged() || viewportChanged() || Boolean(invalidation.shouldAbort?.());
    }

    return Object.freeze({
      aiChanged,
      queueCurrentViewportRender,
      shouldAbort,
      viewportChanged,
    });
  }

  function createReusableMainChartTracePlan(element, renderer, invalidation = {}, options = {}) {
    const traces = Array.isArray(element?.data) ? element.data : [];
    const deferOverlays = options.deferOverlays === true;
    const activeSeries = new Set((options.activeSeries || []).map(String).filter(Boolean));
    const hiddenSeries = options.hiddenSeries instanceof Set
      ? options.hiddenSeries
      : new Set(options.hiddenSeries || []);
    const ownerIsActive = (trace) => {
      const descriptor = renderer.chartOverlayDescriptor(trace);
      const owner = descriptor.kind === "grouped-hover"
        ? String(trace?.meta?.hoverGroupTicker || "")
        : (descriptor.kind === "eps"
          ? String(descriptor.seriesKey || "").replace(/^eps:/, "")
          : String(descriptor.seriesKey || ""));
      return !owner || (!hiddenSeries.has(owner) && (!activeSeries.size || activeSeries.has(owner)));
    };
    const reuseFutureOverlays = deferOverlays || canReuseFutureOverlayTraces(invalidation);
    const reuseEventMarkers = deferOverlays || (
      canReuseEventMarkerTraces(invalidation) && options.hasPendingEvents !== true
    );
    const futureTraces = reuseFutureOverlays
      ? traces.filter((trace) => {
        const kind = renderer.chartOverlayDescriptor(trace).kind;
        return (kind === "eps" || kind.startsWith("ai-") || kind === "ai")
          && ownerIsActive(trace);
      })
      : [];
    const epsTraces = futureTraces.filter((trace) => (
      renderer.chartOverlayDescriptor(trace).kind === "eps"
    ));
    const aiForecastTraces = futureTraces.filter((trace) => {
      const kind = renderer.chartOverlayDescriptor(trace).kind;
      return kind.startsWith("ai-") || kind === "ai";
    });
    const eventTraces = reuseEventMarkers
      ? traces.filter((trace) => renderer.isEventMarkerTrace(trace))
      : null;
    const groupedHoverTraces = deferOverlays
      ? traces.filter((trace) => (
          renderer.chartOverlayDescriptor(trace).kind === "grouped-hover"
          && ownerIsActive(trace)
        ))
      : null;
    const baseValuesBySeries = options.baseValuesBySeries || {};
    const epsTraceModel = reuseFutureOverlays && options.showEps
      ? {
          traces: epsTraces,
          baseValuesBySeries: Object.fromEntries(epsTraces.flatMap((trace) => {
            const seriesKey = String(trace?.meta?.seriesKey || "");
            return seriesKey && Array.isArray(baseValuesBySeries[seriesKey])
              ? [[seriesKey, baseValuesBySeries[seriesKey]]]
              : [];
          })),
        }
      : null;

    return Object.freeze({
      aiForecastTraces,
      epsTraceModel,
      epsTraces,
      eventTraces,
      groupedHoverTraces,
      reuseEventMarkers,
      reuseFutureOverlays,
    });
  }

  function hydrateMainChartSession(session, model, options = {}) {
    if (!session || !model) throw new Error("main chart session hydration requires state and model");
    const rows = Array.isArray(model.rows) ? model.rows : [];
    const selected = Array.isArray(model.selected) ? model.selected : [];
    session.currentMainChartModel = options.createSessionModel?.(model) || model;
    options.captureLockedFrame?.(model);
    session.currentRows = rows;
    session.currentStart = options.frameStart;
    session.currentEnd = options.frameEnd;
    session.currentDataStart = String(rows[0]?.date || options.dataStart || "").slice(0, 10);
    session.currentDataEnd = String(rows.at(-1)?.date || options.dataEnd || "").slice(0, 10);
    options.syncSeries?.(Array.isArray(model.allSeries) ? model.allSeries : []);
    session.currentSelected = [...selected];
    return session.currentMainChartModel;
  }

  async function buildMainChartRenderFrame(options = {}) {
    const renderer = options.renderer;
    const model = options.model;
    const compositionOptions = options.composition || {};
    const viewport = options.viewport || {};
    if (!renderer?.buildMainChartComposition || !model || !viewport.controller) {
      throw new Error("main chart render frame dependencies are incomplete");
    }

    const reusable = createReusableMainChartTracePlan(
      options.element,
      renderer,
      options.invalidation,
      {
        baseValuesBySeries: options.baseValuesBySeries,
        activeSeries: model.selected,
        deferOverlays: compositionOptions.deferOverlays,
        hasPendingEvents: compositionOptions.hasPendingEvents,
        hiddenSeries: compositionOptions.hiddenSeries,
        showEps: viewport.showEps,
      },
    );
    const composition = await renderer.buildMainChartComposition({
      model,
      displayIndexes: compositionOptions.displayIndexes,
      hiddenSeries: compositionOptions.hiddenSeries,
      lineTraceType: compositionOptions.lineTraceType,
      hoverShowPopup: compositionOptions.hoverShowPopup,
      labelName: compositionOptions.labelName,
      renderRevision: compositionOptions.renderRevision,
      seriesColor: compositionOptions.seriesColor,
      prebuiltEpsTraceModel: reusable.epsTraceModel,
      prebuiltAiForecastTraces: reusable.reuseFutureOverlays && viewport.showAiForecast
        ? reusable.aiForecastTraces
        : null,
      prebuiltEventTraces: reusable.eventTraces,
      prebuiltGroupedHoverTraces: reusable.groupedHoverTraces,
      deferOverlays: compositionOptions.deferOverlays,
      buildEpsTraceModel: compositionOptions.buildEpsTraceModel,
      buildAiForecastTraces: compositionOptions.buildAiForecastTraces,
      prepareEventModels: compositionOptions.prepareEventModels,
      buildEventArguments: compositionOptions.buildEventArguments,
      buildEventTraces: compositionOptions.buildEventTraces,
      eventRevisionKey: Object.entries(compositionOptions.eventRevisions || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .join("|"),
      shouldAbort: options.shouldAbort,
    });
    if (!composition) return null;

    const baseValuesBySeries = options.baseValuesBySeries || {};
    Object.keys(baseValuesBySeries)
      .filter((seriesKey) => seriesKey.startsWith("eps:"))
      .forEach((seriesKey) => { delete baseValuesBySeries[seriesKey]; });
    Object.assign(baseValuesBySeries, composition.baseValuesBySeries);

    const nextVisibleDataRange = options.visibleLineDataRangeMs?.(composition.traces) || null;
    const viewportPlan = viewport.controller.buildRenderViewportPlan({
      preserveZoom: viewport.preserveZoom,
      autoChartReset: viewport.autoChartReset,
      pinnedXRange: viewport.pinnedXRange,
      userViewportPinned: viewport.userViewportPinned,
      currentXRange: viewport.currentXRange,
      currentYRange: viewport.currentYRange,
      lockedYRange: viewport.lockedYRange,
      pendingCompositionViewport: viewport.pendingCompositionViewport,
      nextVisibleDataRange,
      ...(viewport.futurePlanState || {}),
      showAiForecast: viewport.showAiForecast,
      showEps: viewport.showEps,
      aiForecastTraces: composition.aiForecastTraces,
      epsForecastTraces: composition.epsTraces,
      futureTraces: [...composition.aiForecastTraces, ...composition.epsTraces],
      observedStart: viewport.observedStart,
      observedEnd: viewport.observedEnd,
      rightPaddingMs: viewport.rightPaddingMs,
      futureRevealLatestToleranceMs: viewport.futureRevealLatestToleranceMs,
      toMilliseconds: viewport.toMilliseconds,
    });
    const fittedDefaultYRange = viewportPlan.savedYRange ? null : viewport.fitRangeForTraces(
      composition.traces.filter((trace) => Number.isFinite(trace?.meta?.sourcePointCount)),
      viewportPlan.defaultXRange,
      { paddingRatio: 0.08, minimumPadding: 0.6 },
    );
    const longRangeTicks = renderer.buildLongRangeTicks({
      start: viewport.observedStart,
      end: viewportPlan.forecastEnd,
      xRange: viewportPlan.savedXRange,
      dayMs: viewport.dayMs,
      toMs: viewport.toMilliseconds,
    });
    const layout = renderer.buildLayout({
      horizontalMargin: viewport.horizontalMargin,
      hoverShowPopup: compositionOptions.hoverShowPopup,
      cursorLineMode: viewport.cursorLineMode,
      hoverlabel: viewport.hoverlabel,
      xRange: viewportPlan.savedXRange,
      defaultXRange: viewportPlan.defaultXRange,
      yRange: viewportPlan.savedYRange,
      fittedYRange: fittedDefaultYRange,
      longRangeTicks,
    });

    return Object.freeze({
      ...composition,
      layout,
      nextVisibleDataRange,
      viewportPlan,
    });
  }

  function applyMainChartViewportPlan(session, viewportPlan, applyFuturePlan) {
    if (!session || !viewportPlan) {
      throw new Error("main chart viewport commit requires state and plan");
    }
    session.pinnedXRange = viewportPlan.pinnedXRange;
    session.userViewportPinned = viewportPlan.userViewportPinned;
    session.pendingCompositionViewport = viewportPlan.pendingCompositionViewport;
    applyFuturePlan?.(viewportPlan);
    return viewportPlan;
  }

  function finalizeMainChartFrameState(session, frame, options = {}) {
    if (!session || !frame?.viewportPlan) {
      throw new Error("main chart frame finalization requires state and frame");
    }
    const renderedRange = options.renderedRange;
    if (Array.isArray(renderedRange) && renderedRange.length === 2) {
      session.currentStart = new Date(renderedRange[0]).toISOString().slice(0, 10);
      session.currentEnd = new Date(renderedRange[1]).toISOString().slice(0, 10);
    }
    const delayedScaleTraces = [
      ...(Array.isArray(frame.aiForecastTraces) ? frame.aiForecastTraces : []),
      ...(Array.isArray(frame.epsTraces) ? frame.epsTraces : []),
    ];
    const needsDelayedFit = session.autoChartReset === true
      && delayedScaleTraces.length > 0
      && options.tracesExceedVisibleYRange?.(
        delayedScaleTraces,
        options.xRange,
        options.yRange,
      ) === true;
    if (needsDelayedFit) {
      session.pendingAutoChartFit = true;
      session.pendingAutoChartFitExpandOnly = false;
    }
    return Object.freeze({
      delayedScaleTraceCount: delayedScaleTraces.length,
      mainRange: Array.isArray(options.xRange)
        ? [...options.xRange]
        : (frame.viewportPlan.savedXRange ? [...frame.viewportPlan.savedXRange] : null),
      needsDelayedFit,
    });
  }

  /**
   * @typedef {Object} PlotlyRelayoutEntry
   * @property {HTMLElement & {data?: Array}} element
   * @property {Object<string, unknown>} payload
   */

  function createPlotlyUpdateRuntime(scope = globalThis, options = {}) {
    let activeOperations = 0;
    const stats = {
      relayoutCalls: 0,
      restyleCalls: 0,
      updateCalls: 0,
      failedCalls: 0,
    };

    function plotly() {
      return options.getPlotly?.() || scope.Plotly || null;
    }

    function begin() {
      activeOperations += 1;
      if (activeOperations === 1) options.onBusyChange?.(true);
    }

    function finish() {
      activeOperations = Math.max(0, activeOperations - 1);
      if (!activeOperations) options.onBusyChange?.(false);
    }

    async function run(label, operation) {
      if (typeof operation !== "function") return undefined;
      begin();
      try {
        return await operation();
      } catch (error) {
        stats.failedCalls += 1;
        options.onError?.(error, String(label || "plotly-update"));
        throw error;
      } finally {
        finish();
      }
    }

    /** @param {PlotlyRelayoutEntry[]} entries */
    async function relayoutMany(entries, runtimeOptions = {}) {
      const engine = plotly();
      if (typeof engine?.relayout !== "function") return [];
      const requests = (Array.isArray(entries) ? entries : []).filter((entry) => (
        entry?.element?.data && entry?.payload && typeof entry.payload === "object"
      ));
      if (!requests.length) return [];
      stats.relayoutCalls += requests.length;
      return run(runtimeOptions.label || "relayout", async () => {
        const tasks = requests.map(({ element, payload }) => Promise.resolve(
          engine.relayout(element, payload),
        ));
        if (runtimeOptions.settle === true) {
          const results = await Promise.allSettled(tasks);
          results.forEach((result) => {
            if (result.status !== "rejected") return;
            stats.failedCalls += 1;
            options.onError?.(result.reason, String(runtimeOptions.label || "relayout"));
          });
          return results;
        }
        return Promise.all(tasks);
      });
    }

    function relayout(element, payload, runtimeOptions = {}) {
      return relayoutMany([{ element, payload }], runtimeOptions)
        .then((results) => results?.[0]);
    }

    async function restyle(element, dataUpdate, traceIndexes, runtimeOptions = {}) {
      const engine = plotly();
      if (!element?.data || typeof engine?.restyle !== "function") return undefined;
      stats.restyleCalls += 1;
      return run(runtimeOptions.label || "restyle", () => (
        engine.restyle(element, dataUpdate, traceIndexes)
      ));
    }

    async function update(element, dataUpdate, layoutUpdate, traceIndexes, runtimeOptions = {}) {
      const engine = plotly();
      if (!element?.data || typeof engine?.update !== "function") return undefined;
      stats.updateCalls += 1;
      return run(runtimeOptions.label || "update", () => (
        engine.update(element, dataUpdate, layoutUpdate, traceIndexes)
      ));
    }

    return Object.freeze({
      isBusy: () => activeOperations > 0,
      relayout,
      relayoutMany,
      restyle,
      run,
      stats: () => Object.freeze({ ...stats, activeOperations }),
      update,
    });
  }

  function createChartUpdateCoordinator(scope = globalThis, options = {}) {
    if (typeof options.requestRender !== "function") {
      throw new Error("chart render request callback is required");
    }
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    const eventLayers = Object.fromEntries((options.eventLayers || ["disclosure", "insider", "timing"])
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
      options.prepareComposition?.(Boolean(requestOptions.forceFitFull), requestOptions);
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

  /**
   * Coalesce the latest value for each key and apply one batch per animation frame.
   * @template T
   * @param {typeof globalThis} [scope]
   * @param {{
   *   apply: (batch: T[]) => unknown|Promise<unknown>,
   *   onError?: (error: unknown) => void,
   *   requestFrame?: (callback: FrameRequestCallback) => number,
   *   cancelFrame?: (id: number) => void
   * }} [options]
   */
  function createLatestKeyedFrameQueue(scope = globalThis, options = {}) {
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
    const settleWaiters = new Set();

    function isBusy() {
      return Boolean(frameId || inFlight || pending.size);
    }

    function settleWaitersIfIdle() {
      if (isBusy()) return;
      settleWaiters.forEach((resolve) => resolve());
      settleWaiters.clear();
    }

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
          if (pending.size) requestRun();
          else settleWaitersIfIdle();
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
      settleWaitersIfIdle();
    }

    async function flush() {
      if (disposed) return undefined;
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
      if (!inFlight && pending.size) runNext();
      if (inFlight) await inFlight;
      if (pending.size || frameId) return flush();
      settleWaitersIfIdle();
      return undefined;
    }

    function whenSettled() {
      if (!isBusy()) return Promise.resolve();
      return new Promise((resolve) => settleWaiters.add(resolve));
    }

    function dispose() {
      disposed = true;
      cancelPending();
      settleWaiters.forEach((resolve) => resolve());
      settleWaiters.clear();
    }

    return Object.freeze({
      cancelPending,
      dispose,
      flush,
      isBusy,
      schedule,
      stats: () => ({
        ...stats,
        inFlight: Boolean(inFlight),
        pending: pending.size,
      }),
      whenSettled,
    });
  }

  function createChartRenderScheduler(scope = globalThis, options = {}) {
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
    let completedTransactionId = 0;
    let pendingRequestCount = 0;
    let pendingProgressiveComposition = false;
    const pendingReasons = new Set();
    const pendingClasses = new Set();
    const invalidationCounts = {};
    let coalescedRequests = 0;
    let supersededTransactions = 0;
    const settleWaiters = new Set();

    function isBusy() {
      return Boolean(
        frameId || deferredTimer || inFlightPromise || renderAfterFlight || pendingReasons.size
      );
    }

    function settleWaitersIfIdle() {
      if (isBusy()) return;
      settleWaiters.forEach((resolve) => resolve());
      settleWaiters.clear();
    }

    function queueInvalidation(requestOptions = {}) {
      const reason = String(requestOptions.reason || "data");
      const updateClass = String(requestOptions.updateClass || "data");
      pendingRequestCount += 1;
      pendingReasons.add(reason);
      pendingClasses.add(updateClass);
      pendingProgressiveComposition = pendingProgressiveComposition
        || requestOptions.progressiveComposition === true;
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
        progressiveComposition: pendingProgressiveComposition,
        shouldAbort: () => transaction.superseded,
        transaction,
      });
      pendingReasons.clear();
      pendingClasses.clear();
      pendingRequestCount = 0;
      pendingProgressiveComposition = false;
      return value;
    }

    const reportError = (error) => {
      try { options.onError?.(error); } catch (_) {}
    };

    async function run(preserveZoom = true, requestOptions = null, executionOptions = {}) {
      // An explicit render consumes any work already queued for the next frame.
      // Leaving that frame alive would replay an older preserveZoom policy after
      // the immediate render and could restore a stale viewport.
      if (frameId) {
        cancelFrame(frameId);
        frameId = 0;
      }
      if (deferredTimer) {
        clearTimer(deferredTimer);
        deferredTimer = 0;
        preserveZoom = deferredPreserveZoom && preserveZoom;
        deferredPreserveZoom = true;
      }
      if (requestOptions) queueInvalidation(requestOptions);
      const queuedClassesAreMarkerOnly = pendingClasses.size > 0
        && [...pendingClasses].every((updateClass) => updateClass === "markers");
      if (!pendingReasons.size || (
        executionOptions.consumeQueuedOnly !== true
        && !requestOptions
        && queuedClassesAreMarkerOnly
      )) {
        // A direct render is a full application request. It must not be
        // downgraded to a marker-only fast path just because marker work was
        // already waiting for the same frame.
        queueInvalidation({ reason: "immediate", updateClass: "data" });
      }
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
            completedTransactionId = Math.max(completedTransactionId, nextInvalidation.transactionId);
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
            scheduleQueuedRender(retryPreserveZoom);
          }
          settleWaitersIfIdle();
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
        scheduleQueuedRender(nextPreserveZoom);
      }, deferDelayMs);
    }

    function scheduleQueuedRender(preserveZoom = true) {
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
        run(nextPreserveZoom, null, { consumeQueuedOnly: true }).catch(reportError);
      });
    }

    function request(preserveZoom = true, requestOptions = {}) {
      if (disposed) return;
      queueInvalidation(requestOptions);
      if (requestOptions.deferDuringInteraction !== false && isInteractionBusy()) {
        scheduleDeferred(preserveZoom);
        return;
      }
      scheduleQueuedRender(preserveZoom);
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
      settleWaiters.forEach((resolve) => resolve());
      settleWaiters.clear();
    }

    function whenSettled() {
      if (!isBusy()) return Promise.resolve();
      return new Promise((resolve) => settleWaiters.add(resolve));
    }

    return Object.freeze({
      dispose,
      isRendering: isBusy,
      request,
      run,
      runWhenIdleOrNow,
      whenSettled,
      stats: () => ({
        framePending: Boolean(frameId),
        inFlight: Boolean(inFlightPromise),
        deferred: Boolean(deferredTimer),
        renderAfterFlight,
        coalescedRequests,
        supersededTransactions,
        activeTransactionId: activeTransaction?.id || 0,
        completedTransactionId,
        lastTransactionId: nextTransactionId - 1,
        invalidationCounts: { ...invalidationCounts },
        pendingReasons: [...pendingReasons],
        pendingClasses: [...pendingClasses],
        pendingProgressiveComposition,
      }),
    });
  }

  function summarizeMainChartWorkload(traces = []) {
    const source = Array.isArray(traces) ? traces : [];
    const series = new Set();
    let overlays = 0;
    let points = 0;
    source.forEach((trace) => {
      points += Array.isArray(trace?.x) ? trace.x.length : 0;
      const kind = String(trace?.meta?.overlayKind || "");
      const seriesKey = String(trace?.meta?.seriesKey || "");
      if (kind === "price" && seriesKey && trace?.visible !== "legendonly") {
        series.add(seriesKey);
      } else if (kind !== "grouped-hover") {
        overlays += 1;
      }
    });
    return Object.freeze({
      traceCount: source.length,
      seriesCount: series.size,
      overlayCount: overlays,
      pointCount: points,
    });
  }

  function createMainChartRenderRuntime(scope = globalThis, options = {}) {
    const renderer = options.renderer;
    const updateRuntime = options.updateRuntime;
    if (!renderer?.render || typeof updateRuntime?.run !== "function") {
      throw new Error("main chart render runtime dependencies are incomplete");
    }

    async function apply(element, traces, layout, invalidation = {}) {
      const workload = summarizeMainChartWorkload(traces);
      const telemetryToken = options.telemetry?.begin?.({ ...invalidation, ...workload });
      const partialCandidate = renderer.canApplyPartialUpdate?.(element, traces)
        || renderer.canApplyEventMarkerUpdate?.(element, traces, invalidation)
        || renderer.canReconcileTraceStructure?.(element, traces);
      const result = await updateRuntime.run(
        partialCandidate ? "main-chart-partial-render" : "main-chart-full-render",
        () => renderer.render(
          options.getPlotly?.() || scope.Plotly,
          element,
          traces,
          layout,
          options.config || {},
          { invalidation },
        ),
      );
      options.telemetry?.complete?.(telemetryToken, result);
      return result.mode;
    }

    const scheduler = createChartRenderScheduler(scope, {
      ...(options.schedulerOptions || {}),
      render: async (...args) => {
        await options.beforeScheduledRender?.();
        return options.render?.(...args);
      },
    });
    return Object.freeze({ ...scheduler, apply });
  }

// Visual-frame coalescing shares the chart update lifecycle.

  function createSeriesFrameApplier(options = {}) {
    return async function applySeriesFrame(frame = {}) {
      const element = options.getElement?.();
      const plotly = options.getPlotly?.() || globalThis.Plotly;
      const restyle = options.restyle || plotly?.restyle?.bind(plotly);
      if (!element?.data || typeof restyle !== "function") return;
      const traceIndexes = [];
      const yUpdates = [];
      const handleUpdates = [];
      const seriesUpdates = Array.isArray(frame.series) ? frame.series : [];
      const commitFrame = seriesUpdates.some((item) => item?.commit === true);
      seriesUpdates.forEach(({ seriesKey, traceIndex: preferredIndex }) => {
        const traceIndex = options.resolveTraceIndex?.(element, seriesKey, preferredIndex) ?? -1;
        const nextY = options.computeValues?.(seriesKey, traceIndex, element);
        if (traceIndex < 0 || !nextY) return;
        if (frame.markers && !seriesKey.startsWith("eps:")) {
          const markerUpdate = options.collectMarkerUpdates?.(element, {
            seriesKey,
            sourceTraceIndex: traceIndex,
            nextY,
          }) || { traceIndexes: [], yUpdates: [] };
          traceIndexes.push(...markerUpdate.traceIndexes);
          yUpdates.push(...markerUpdate.yUpdates);
        }
        const linkedUpdate = options.collectLinkedTraceUpdates?.(element, {
          seriesKey,
          sourceTraceIndex: traceIndex,
          nextY,
        }) || { traceIndexes: [], yUpdates: [] };
        traceIndexes.push(...linkedUpdate.traceIndexes);
        yUpdates.push(...linkedUpdate.yUpdates);
        traceIndexes.push(traceIndex);
        yUpdates.push(nextY);
        if (commitFrame) {
          if (!seriesKey.startsWith("eps:")) options.commitSeries?.(seriesKey);
          const groupedUpdate = options.groupedHoverUpdate?.(element.data, traceIndex, nextY);
          if (groupedUpdate) {
            traceIndexes.push(groupedUpdate.traceIndex);
            yUpdates.push(groupedUpdate.y);
          }
        }
        if (frame.handles) handleUpdates.push({ seriesKey, nextY });
      });
      // Markers stay constrained to their dated series point during transforms.
      // Rebuild their visual gap only when the axis itself changes.
      const rebuildEventMarkers = frame.markers
        && options.hasEventModel?.()
        && seriesUpdates.length === 0;
      const eventUpdate = rebuildEventMarkers
        ? options.appendEventUpdates?.(element, traceIndexes, yUpdates)
        : { structureChanged: false, disclosureUpdated: false };
      if (eventUpdate.disclosureUpdated) options.onDisclosureUpdated?.();
      if (traceIndexes.length) {
        const compacted = compactTraceYUpdates(traceIndexes, yUpdates);
        if (typeof options.invalidateInteractionCaches === "function") {
          const seriesChanged = seriesUpdates.length > 0;
          options.invalidateInteractionCaches(element, {
            lines: seriesChanged,
            markers: frame.markers,
            reports: seriesChanged,
          });
        } else {
          options.invalidateLineHits?.(element);
          if (frame.markers) options.invalidateMarkerPixels?.(element);
        }
        // Direct restyles change rendered data outside the main renderer.
        // Invalidate its snapshot so a later reset is never skipped as unchanged.
        options.invalidateRenderState?.(element);
        await restyle(element, { y: compacted.yUpdates }, compacted.traceIndexes, {
          label: "chart-visual-frame",
        });
      }
      const frameGeometry = frame.handles ? options.readGeometry?.(element) || null : null;
      handleUpdates.forEach(({ seriesKey, nextY }) => {
        options.positionHandles?.(element, seriesKey, nextY, frameGeometry);
      });
      if (frame.handles && !(frame.series || []).length) options.updateHandles?.(frameGeometry);
      if (eventUpdate.structureChanged) options.requestStructureRender?.();
    };
  }

  function compactTraceYUpdates(traceIndexes, yUpdates) {
    const indexes = Array.isArray(traceIndexes) ? traceIndexes : [];
    const values = Array.isArray(yUpdates) ? yUpdates : [];
    const count = Math.min(indexes.length, values.length);
    const positions = new Map();
    let hasDuplicates = false;
    for (let index = 0; index < count; index += 1) {
      const traceIndex = indexes[index];
      if (positions.has(traceIndex)) {
        hasDuplicates = true;
      } else {
        positions.set(traceIndex, index);
      }
    }
    if (!hasDuplicates && count === indexes.length && count === values.length) {
      return { traceIndexes: indexes, yUpdates: values };
    }
    const compactIndexes = [];
    const compactValues = [];
    positions.clear();
    for (let index = 0; index < count; index += 1) {
      const traceIndex = indexes[index];
      const position = positions.get(traceIndex);
      if (position == null) {
        positions.set(traceIndex, compactIndexes.length);
        compactIndexes.push(traceIndex);
        compactValues.push(values[index]);
      } else {
        compactValues[position] = values[index];
      }
    }
    return { traceIndexes: compactIndexes, yUpdates: compactValues };
  }

  function createCoordinator(scope = globalThis, options = {}) {
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
    const stats = {
      scheduled: 0,
      coalesced: 0,
      applied: 0,
      seriesUpdates: 0,
      markerFrames: 0,
      handleFrames: 0,
    };
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
      stats.applied += 1;
      stats.seriesUpdates += frame.series.length;
      if (frame.markers) stats.markerFrames += 1;
      if (frame.handles) stats.handleFrames += 1;
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
      stats.scheduled += 1;
      const seriesKey = String(update.seriesKey || "");
      const hadMarkers = pendingMarkers;
      const hadHandles = pendingHandles;
      if (seriesKey) {
        const previous = pendingSeries.get(seriesKey);
        if (previous) stats.coalesced += 1;
        const next = {
          seriesKey,
          traceIndex: Number.isInteger(update.traceIndex) ? update.traceIndex : null,
        };
        if (previous?.commit === true || update.commit === true) next.commit = true;
        pendingSeries.set(seriesKey, next);
      }
      pendingMarkers = pendingMarkers || update.markers === true;
      pendingHandles = pendingHandles || update.handles === true;
      if (!seriesKey && (
        (hadMarkers && update.markers === true)
        || (hadHandles && update.handles === true)
      )) stats.coalesced += 1;
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
      stats: () => Object.freeze({
        ...stats,
        framePending: Boolean(frameId),
        inFlight: Boolean(inFlightPromise),
        pendingSeries: pendingSeries.size,
        pendingMarkers,
        pendingHandles,
      }),
    });
  }

export {
  applyMainChartViewportPlan,
  canReuseEventMarkerTraces,
  canReuseFutureOverlayTraces,
  buildMainChartRenderFrame,
  compactTraceYUpdates,
  createMainChartRenderGuard,
  createMainChartRenderRuntime,
  createReusableMainChartTracePlan,
  createChartRenderScheduler,
  createChartUpdateCoordinator,
  createCoordinator,
  createLatestKeyedFrameQueue,
  createPlotlyUpdateRuntime,
  createSeriesFrameApplier,
  finalizeMainChartFrameState,
  hydrateMainChartSession,
  summarizeMainChartWorkload,
  shouldHydrateChartData,
  shouldUpdateAuxiliary,
};
