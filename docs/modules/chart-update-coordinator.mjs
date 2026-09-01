"use strict";

  const MAIN_ONLY_UPDATE_CLASSES = Object.freeze(new Set([
    "markers",
    "timing",
    "transform",
    "forecast",
    "viewport",
  ]));
  const DATA_HYDRATION_UPDATE_CLASSES = Object.freeze(new Set(["data", "composition", "timing"]));

  /**
   * @typedef {"markers"|"price"|"timing"|"transform"|"forecast"|"viewport"|"viewport-range"|"composition"|"data"} ChartUpdateClass
   * @typedef {{updateClasses?: ChartUpdateClass[], progressiveComposition?: boolean}} ChartInvalidation
   */

  /** @param {ChartInvalidation} invalidation */
  function normalizedUpdateClasses(invalidation = {}) {
    if (invalidation?.plan?.normalized === true) return invalidation.updateClasses;
    return [...new Set((invalidation.updateClasses || []).map(String).filter(Boolean))];
  }

  /** Builds every layer decision once for one render transaction. */
  function normalizeChartInvalidation(invalidation = {}) {
    if (invalidation?.plan?.normalized === true) return invalidation;
    const updateClasses = Object.freeze(normalizedUpdateClasses(invalidation));
    const fullUpdate = updateClasses.length === 0;
    const plan = Object.freeze({
      normalized: true,
      updateAuxiliary: fullUpdate
        || updateClasses.some((updateClass) => !MAIN_ONLY_UPDATE_CLASSES.has(updateClass)),
      hydrateData: fullUpdate
        || updateClasses.some((updateClass) => DATA_HYDRATION_UPDATE_CLASSES.has(updateClass)),
      reuseFutureOverlays: !fullUpdate && updateClasses.every((updateClass) => (
        updateClass === "viewport"
        || updateClass === "viewport-range"
        || updateClass === "transform"
        || updateClass === "price"
        || updateClass === "timing"
      )),
      reuseEventMarkers: !fullUpdate && updateClasses.every((updateClass) => (
        updateClass === "viewport"
        || updateClass === "viewport-range"
        || updateClass === "price"
      )),
    });
    return Object.freeze({ ...invalidation, updateClasses, plan });
  }

  /** @param {ChartInvalidation} invalidation */
  function shouldUpdateAuxiliary(invalidation = {}) {
    return normalizeChartInvalidation(invalidation).plan.updateAuxiliary;
  }

  /** @param {ChartInvalidation} invalidation */
  function shouldHydrateChartData(invalidation = {}) {
    return normalizeChartInvalidation(invalidation).plan.hydrateData;
  }

  function canReuseFutureOverlayTraces(invalidation = {}) {
    return normalizeChartInvalidation(invalidation).plan.reuseFutureOverlays;
  }

  function canReuseEventMarkerTraces(invalidation = {}) {
    return normalizeChartInvalidation(invalidation).plan.reuseEventMarkers;
  }

  function numericRangeMatches(left, right, tolerance = 0.001) {
    const a = Array.isArray(left) ? left.slice(0, 2).map(Number) : [];
    const b = Array.isArray(right) ? right.slice(0, 2).map(Number) : [];
    if (a.length !== 2 || b.length !== 2 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) {
      return false;
    }
    const span = Math.max(1, Math.abs(b[1] - b[0]));
    return Math.abs(a[0] - b[0]) <= span * tolerance
      && Math.abs(a[1] - b[1]) <= span * tolerance;
  }

  /** Couples the newest horizontal window and its fitted vertical range in one frame. */
  function buildLiveViewportRangePayload(options = {}) {
    const payload = { ...(options.payload || {}) };
    if (options.enabled !== true || typeof options.fitRangeForTraces !== "function") {
      return Object.freeze({ enabled: false, payload, fittedYRange: null, yChanged: false });
    }
    const fittedYRange = options.fitRangeForTraces(
      Array.isArray(options.traces) ? options.traces : [],
      options.xRange,
      options.fitOptions || {},
    );
    if (!Array.isArray(fittedYRange) || fittedYRange.length < 2
      || !fittedYRange.slice(0, 2).every(Number.isFinite)) {
      return Object.freeze({ enabled: true, payload, fittedYRange: null, yChanged: false });
    }
    const range = fittedYRange.slice(0, 2).map(Number);
    return Object.freeze({
      enabled: true,
      payload: {
        ...payload,
        "yaxis.range[0]": range[0],
        "yaxis.range[1]": range[1],
        "yaxis.autorange": false,
      },
      fittedYRange: Object.freeze(range),
      yChanged: !numericRangeMatches(options.currentYRange, range),
    });
  }

  function isVisibleRangeCompanion(element) {
    return Boolean(
      element
      && !element.hidden
      && Array.isArray(element.data)
      && element.data.some((trace) => (
        trace?.visible !== false
        && trace?.visible !== "legendonly"
        && Array.isArray(trace?.x)
        && trace.x.length > 0
      )),
    );
  }

  function hasVisibleDatedDataInRange(element, range, selectTraces) {
    const [start, end] = Array.isArray(range) ? range.slice(0, 2).map(Number) : [];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    const traces = typeof selectTraces === "function"
      ? selectTraces(element?.data || [])
      : element?.data || [];
    return (Array.isArray(traces) ? traces : []).some((trace) => {
      if (trace?.visible === false || trace?.visible === "legendonly") return false;
      const dates = Array.isArray(trace?.x) ? trace.x : [];
      const values = Array.isArray(trace?.y) ? trace.y : [];
      return dates.some((date, index) => {
        const timestamp = typeof date === "number" ? date : Date.parse(String(date || ""));
        return timestamp >= start && timestamp <= end && Number.isFinite(Number(values[index]));
      });
    });
  }

  function stageTraceYUpdates(traces, traceIndexes, yUpdates) {
    const source = Array.isArray(traces) ? traces : [];
    const compacted = compactTraceYUpdates(traceIndexes, yUpdates);
    if (!compacted.traceIndexes.length) {
      return Object.freeze({
        traceIndexes: Object.freeze([]),
        traces: source,
        yUpdates: Object.freeze([]),
      });
    }
    const valuesByIndex = new Map(compacted.traceIndexes.map((traceIndex, index) => (
      [traceIndex, compacted.yUpdates[index]]
    )));
    const staged = source.map((trace, traceIndex) => (
      valuesByIndex.has(traceIndex)
        ? { ...trace, y: valuesByIndex.get(traceIndex) }
        : trace
    ));
    return Object.freeze({
      traceIndexes: Object.freeze([...compacted.traceIndexes]),
      traces: staged,
      yUpdates: Object.freeze([...compacted.yUpdates]),
    });
  }

  /** Builds one linked-chart relayout plan without coupling it to application state. */
  function buildLinkedViewportRangePlan(options = {}) {
    const mainElement = options.mainElement;
    const companionElements = Array.isArray(options.companionElements)
      ? options.companionElements
      : [];
    const [rangeStart, rangeEnd] = Array.isArray(options.xRange) ? options.xRange : [];
    const payload = {
      "xaxis.range[0]": rangeStart,
      "xaxis.range[1]": rangeEnd,
    };
    const requestedTraceUpdates = options.traceYUpdates || {};
    let stagedMain = stageTraceYUpdates(
      mainElement?.data,
      requestedTraceUpdates.traceIndexes,
      requestedTraceUpdates.yUpdates,
    );
    const rangeChanged = (element) => Boolean(
      element?.data
      && options.xRangeMatches?.(element, rangeStart, rangeEnd) !== true
    );
    const liveFit = buildLiveViewportRangePayload({
      enabled: Boolean(
        mainElement?.data
        && options.liveFit === true
        && options.autoScale === true
      ),
      payload,
      traces: options.rangeBearingTraces?.(stagedMain.traces) || [],
      xRange: [rangeStart, rangeEnd],
      currentYRange: mainElement?._fullLayout?.yaxis?.range,
      fitRangeForTraces: options.fitRangeForTraces,
      fitOptions: options.fitOptions,
    });
    if (liveFit.fittedYRange && typeof options.collectAnchoredYUpdates === "function") {
      const anchored = options.collectAnchoredYUpdates(
        mainElement,
        { traces: stagedMain.traces, viewportRange: liveFit.fittedYRange },
      ) || { traceIndexes: [], yUpdates: [] };
      if (anchored.traceIndexes?.length) {
        stagedMain = stageTraceYUpdates(
          mainElement?.data,
          [...stagedMain.traceIndexes, ...anchored.traceIndexes],
          [...stagedMain.yUpdates, ...anchored.yUpdates],
        );
      }
    }
    const companionVisibility = options.isCompanionVisible || isVisibleRangeCompanion;
    const companionUpdates = companionElements.map((element) => Boolean(
      companionVisibility(element) && rangeChanged(element)
    ));
    const needsMainDataRefresh = Boolean(
      mainElement?.data
      && rangeChanged(mainElement)
      && liveFit.enabled
      && !liveFit.fittedYRange
    );
    const updateMain = Boolean(mainElement?.data && (
      rangeChanged(mainElement)
      || liveFit.yChanged
      || stagedMain.traceIndexes.length
    ));
    return Object.freeze({
      any: updateMain || companionUpdates.some(Boolean),
      companionUpdates: Object.freeze(companionUpdates),
      liveFit,
      mainPayload: liveFit.payload,
      mainTraceIndexes: stagedMain.traceIndexes,
      mainYUpdates: stagedMain.yUpdates,
      needsMainDataRefresh,
      updateMain,
    });
  }

  /** Prepares a newly composed trace frame through the same Y-fit and marker-anchor path as live viewport input. */
  function prepareViewportTraceFrame(options = {}) {
    const traces = Array.isArray(options.traces) ? options.traces : [];
    const xRange = Array.isArray(options.xRange) ? options.xRange.slice(0, 2) : [];
    if (!traces.length || xRange.length !== 2 || typeof options.collectTraceYUpdates !== "function") {
      return Object.freeze({ fittedYRange: null, traces, traceIndexes: Object.freeze([]) });
    }
    const stagingElement = {
      data: traces,
      _fullLayout: {
        xaxis: { range: xRange },
        yaxis: { range: options.currentYRange || null },
      },
    };
    const traceYUpdates = options.collectTraceYUpdates(stagingElement, xRange, {
      liveFit: true,
      source: String(options.source || "render-frame"),
    }) || { traceIndexes: [], yUpdates: [] };
    const plan = buildLinkedViewportRangePlan({
      mainElement: stagingElement,
      companionElements: [],
      xRange,
      // The staging frame already owns this exact range. Only its transformed
      // traces and anchored markers need to be reconciled.
      xRangeMatches: () => true,
      liveFit: true,
      autoScale: true,
      rangeBearingTraces: options.rangeBearingTraces,
      fitRangeForTraces: options.fitRangeForTraces,
      fitOptions: options.fitOptions,
      traceYUpdates,
      collectAnchoredYUpdates: options.collectAnchoredYUpdates,
    });
    const staged = stageTraceYUpdates(traces, plan.mainTraceIndexes, plan.mainYUpdates);
    return Object.freeze({
      // Plotly mutates axis range arrays internally, especially in WebKit.
      // Keep coordinator snapshots immutable but hand the renderer a mutable boundary copy.
      fittedYRange: plan.liveFit.fittedYRange
        ? [...plan.liveFit.fittedYRange]
        : null,
      traces: staged.traces,
      traceIndexes: staged.traceIndexes,
    });
  }

  /** Owns one linked viewport commit across the main chart and every visible companion. */
  function createLinkedViewportFrameRuntime(options = {}) {
    const updateRuntime = options.updateRuntime;
    if (!updateRuntime?.relayoutMany || !updateRuntime?.relayout || !updateRuntime?.update) {
      throw new Error("linked viewport update runtime is required");
    }
    const stats = {
      requested: 0,
      applied: 0,
      skipped: 0,
      mainUpdates: 0,
      companionUpdates: 0,
      dataRefreshes: 0,
    };

    async function apply(request = {}) {
      const startMs = Number(request.startMs);
      const endMs = Number(request.endMs);
      const meta = request.meta || {};
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        stats.skipped += 1;
        return Object.freeze({ applied: false, reason: "invalid-range" });
      }
      stats.requested += 1;
      await options.beforeApply?.({ startMs, endMs, meta });
      const requestContext = { startMs, endMs, meta };
      const isRequestCurrent = () => options.isRequestCurrent?.(requestContext) !== false;
      if (!isRequestCurrent()) {
        stats.skipped += 1;
        return Object.freeze({ applied: false, reason: "stale-request" });
      }

      const mainElement = options.getMainElement?.() || null;
      const companionElements = (options.getCompanionElements?.() || []).filter(Boolean);
      const formatRangeValue = options.formatRangeValue || ((value) => new Date(value).toISOString());
      const xRange = [formatRangeValue(startMs), formatRangeValue(endMs)];
      const traceYUpdates = options.collectTraceYUpdates?.(mainElement, xRange, meta)
        || { seriesUpdates: [], traceIndexes: [], yUpdates: [] };
      const plan = buildLinkedViewportRangePlan({
        mainElement,
        companionElements,
        xRange,
        xRangeMatches: options.xRangeMatches,
        liveFit: Boolean(meta.liveFit),
        autoScale: options.isAutoScale?.() === true,
        rangeBearingTraces: options.rangeBearingTraces,
        fitRangeForTraces: options.fitRangeForTraces,
        fitOptions: options.fitOptions,
        traceYUpdates,
        collectAnchoredYUpdates: options.collectAnchoredYUpdates,
        isCompanionVisible: options.isCompanionVisible,
      });
      if (!plan.any) {
        stats.skipped += 1;
        return Object.freeze({ applied: false, plan, traceYUpdates });
      }
      if (!isRequestCurrent()) {
        stats.skipped += 1;
        return Object.freeze({ applied: false, plan, traceYUpdates, reason: "stale-request" });
      }

      const rangePayload = {
        "xaxis.range[0]": xRange[0],
        "xaxis.range[1]": xRange[1],
      };
      const companionEntries = plan.companionUpdates.flatMap((shouldUpdate, index) => {
        if (!shouldUpdate) return [];
        const element = companionElements[index];
        const payload = options.buildCompanionPayload?.(element, rangePayload) || rangePayload;
        return [{ element, payload }];
      });
      const applyCompanions = () => (
        companionEntries.length
          ? updateRuntime.relayoutMany(companionEntries, {
              label: options.companionLabel || "viewport-range-sync-companions",
            })
          : Promise.resolve([])
      );

      if (plan.needsMainDataRefresh) {
        stats.dataRefreshes += 1;
        stats.companionUpdates += companionEntries.length;
        options.requestMainDataRefresh?.({ xRange, meta, plan });
        await applyCompanions();
        return Object.freeze({
          applied: true,
          mainDataRefresh: true,
          plan,
          traceYUpdates,
        });
      }

      options.beforeMainUpdate?.({ mainElement, plan, traceYUpdates, xRange, meta });
      const updates = [applyCompanions()];
      if (plan.updateMain) {
        if (plan.mainTraceIndexes.length) {
          updates.push(updateRuntime.update(
            mainElement,
            { y: plan.mainYUpdates },
            plan.mainPayload,
            plan.mainTraceIndexes,
            { label: options.mainFrameLabel || "viewport-range-sync-main-frame" },
          ));
        } else {
          updates.push(updateRuntime.relayout(mainElement, plan.mainPayload, {
            label: options.mainLabel || "viewport-range-sync-main",
          }));
        }
      }
      await Promise.all(updates);
      stats.applied += 1;
      stats.mainUpdates += plan.updateMain ? 1 : 0;
      stats.companionUpdates += companionEntries.length;
      await options.afterCommit?.({
        mainElement,
        companionElements,
        plan,
        traceYUpdates,
        xRange,
        meta,
      });
      return Object.freeze({ applied: true, plan, traceYUpdates });
    }

    return Object.freeze({
      apply,
      stats: () => Object.freeze({ ...stats }),
    });
  }

  /** Finalizes one viewport interaction without allowing an older transaction to win. */
  async function settleViewportRenderTransaction(options = {}) {
    const requestedRange = Array.isArray(options.requestedRange)
      ? options.requestedRange.slice(0, 2).map(Number)
      : null;
    const hasRange = requestedRange?.length === 2
      && requestedRange.every(Number.isFinite)
      && requestedRange[1] > requestedRange[0];
    const ownerRevision = options.interactionRevision;
    const isCurrent = () => ownerRevision === options.getInteractionRevision?.();
    let rendered = false;
    let corrected = false;
    if (!isCurrent()) return { rendered, corrected, stale: true };
    await options.rangeController?.flush?.();
    if (!isCurrent()) return { rendered, corrected, stale: true };
    if (hasRange) options.setPinnedRange?.(requestedRange);
    const needsRender = Boolean(
      hasRange
      && (
        options.viewportWindowController?.needsRefresh?.(requestedRange[0], requestedRange[1])
        || !hasVisibleDatedDataInRange(
          options.mainElement,
          requestedRange,
          options.rangeBearingTraces,
        )
      ),
    );
    if (needsRender) {
      options.viewportWindowController?.cancelScheduled?.();
      options.requestRender?.({
        preserveZoom: options.preserveZoom !== false,
        reason: options.reason || "viewport-settle",
        updateClass: options.updateClass || "viewport",
      });
      rendered = true;
    }
    await options.whenRenderSettled?.();
    if (!isCurrent()) return { rendered, corrected, stale: true };

    const currentRange = options.getCurrentRange?.();
    const tolerance = hasRange
      ? Math.max(1000, (requestedRange[1] - requestedRange[0]) * 0.00001)
      : 1000;
    const mismatch = hasRange && !currentRange?.every((value, index) => (
      Math.abs(Number(value) - requestedRange[index]) <= tolerance
    ));
    if (mismatch) {
      options.rangeController?.schedule?.(requestedRange[0], requestedRange[1], {
        source: `${options.reason || "viewport-settle"}-correction`,
        fit: false,
        liveFit: options.liveFit === true,
        userInitiated: false,
        interactionRevision: ownerRevision,
      });
      await options.rangeController?.flush?.();
      corrected = true;
    }
    if (!isCurrent()) return { rendered, corrected, stale: true };
    // The main window may have refreshed during the interaction already.  In
    // that case `rendered` is false here, but companion traces can still be
    // backed by the previous buffered window.  Let the companion owner check
    // its own coverage instead of coupling that decision to the main chart.
    if (options.refreshCompanions === true) await options.refreshCompanionsNow?.();
    else options.flushCoMovement?.();
    return { rendered, corrected, stale: false };
  }

  function createMainChartRenderGuard(options = {}) {
    const aiRevision = options.getAiRevision?.();
    const viewportRevision = options.getViewportRevision?.();
    let viewportSignature = options.getViewportSignature?.();
    const aiChanged = () => aiRevision !== options.getAiRevision?.();
    const viewportChanged = () => (
      viewportRevision !== options.getViewportRevision?.()
      || viewportSignature !== options.getViewportSignature?.()
    );
    let viewportWindowPrepared = false;
    let viewportWindowCommitted = false;

    function discardViewportWindow() {
      if (viewportWindowPrepared && !viewportWindowCommitted) {
        options.invalidateViewportWindow?.();
      }
      viewportWindowPrepared = false;
      viewportWindowCommitted = false;
    }

    function queueCurrentViewportRender() {
      if (!viewportChanged()) return false;
      discardViewportWindow();
      options.onViewportChanged?.();
      options.requestViewportRender?.();
      return true;
    }

    function shouldAbort(invalidation = {}) {
      return aiChanged() || viewportChanged() || Boolean(invalidation.shouldAbort?.());
    }

    function abortPreparedFrame(invalidation = {}) {
      const abort = shouldAbort(invalidation);
      const queued = queueCurrentViewportRender();
      if (abort && !queued) discardViewportWindow();
      return abort || queued;
    }

    function acceptRenderedViewport() {
      if (viewportRevision !== options.getViewportRevision?.()) return false;
      viewportSignature = options.getViewportSignature?.();
      return true;
    }

    return Object.freeze({
      acceptRenderedViewport,
      abortPreparedFrame,
      aiChanged,
      commitViewportWindow: () => {
        viewportWindowPrepared = true;
        viewportWindowCommitted = true;
      },
      discardViewportWindow,
      prepareViewportWindow: () => {
        viewportWindowPrepared = true;
        viewportWindowCommitted = false;
      },
      queueCurrentViewportRender,
      shouldAbort,
      viewportChanged,
    });
  }

  function acceptPlannedViewportRender(renderGuard, element, viewportPlan, rangeMatches) {
    const range = viewportPlan?.savedXRange || viewportPlan?.defaultXRange;
    return Array.isArray(range)
      && range.length === 2
      && rangeMatches?.(element, range[0], range[1]) === true
      && renderGuard?.acceptRenderedViewport?.() === true;
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
    const desiredHoverOrder = (Array.isArray(options.hoverSeriesOrder)
      ? options.hoverSeriesOrder
      : options.activeSeries || [])
      .map(String)
      .filter((series) => activeSeries.has(series) && !hiddenSeries.has(series));
    const reusableGroupedHoverTraces = traces.filter((trace) => (
          renderer.chartOverlayDescriptor(trace).kind === "grouped-hover"
          && ownerIsActive(trace)
        ));
    const reusableHoverOrder = reusableGroupedHoverTraces.map((trace) => (
      String(trace?.meta?.hoverGroupTicker || "")
    ));
    const groupedHoverOrderMatches = desiredHoverOrder.length === reusableHoverOrder.length
      && desiredHoverOrder.every((series, index) => series === reusableHoverOrder[index]);
    const groupedHoverTraces = deferOverlays && groupedHoverOrderMatches
      ? reusableGroupedHoverTraces
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
        hoverSeriesOrder: compositionOptions.hoverSeriesOrder,
        showEps: viewport.showEps,
      },
    );
    const composition = await renderer.buildMainChartComposition({
      model,
      displayIndexes: compositionOptions.displayIndexes,
      hiddenSeries: compositionOptions.hiddenSeries,
      lineTraceType: compositionOptions.lineTraceType,
      hoverShowPopup: compositionOptions.hoverShowPopup,
      hoverLabelName: compositionOptions.hoverLabelName,
      hoverSeriesOrder: compositionOptions.hoverSeriesOrder,
      labelName: compositionOptions.labelName,
      renderRevision: compositionOptions.renderRevision,
      seriesColor: compositionOptions.seriesColor,
      seriesOrder: compositionOptions.seriesOrder,
      stackedPriceSeries: compositionOptions.stackedPriceSeries,
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
    const fittedViewportRange = viewportPlan.savedXRange || viewportPlan.defaultXRange;
    const preparedViewportFrame = viewport.autoChartReset
      ? prepareViewportTraceFrame({
          traces: composition.traces,
          xRange: fittedViewportRange,
          currentYRange: viewport.currentYRange,
          collectTraceYUpdates: viewport.collectTraceYUpdates,
          collectAnchoredYUpdates: viewport.collectAnchoredYUpdates,
          rangeBearingTraces: renderer.rangeBearingTraces,
          fitRangeForTraces: viewport.fitRangeForTraces,
          fitOptions: { paddingRatio: 0.08, minimumPadding: 0.6 },
        })
      : { fittedYRange: null, traces: composition.traces };
    const frameTraces = preparedViewportFrame.traces;
    const remapPreparedTraceGroup = (group) => {
      const requested = new Set(Array.isArray(group) ? group : []);
      return composition.traces.flatMap((trace, index) => (
        requested.has(trace) && frameTraces[index] ? [frameTraces[index]] : []
      ));
    };
    const fittedDefaultYRange = viewportPlan.savedYRange
      ? null
      : (preparedViewportFrame.fittedYRange || viewport.fitRangeForTraces(
          frameTraces.filter((trace) => Number.isFinite(trace?.meta?.sourcePointCount)),
          fittedViewportRange,
          { paddingRatio: 0.08, minimumPadding: 0.6 },
        ));
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
      aiForecastTraces: remapPreparedTraceGroup(composition.aiForecastTraces),
      epsTraces: remapPreparedTraceGroup(composition.epsTraces),
      traces: frameTraces,
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

  async function fitMainChartToViewport(options = {}) {
    const element = options.element;
    const renderer = options.renderer;
    const updateRuntime = options.updateRuntime;
    if (!element?._fullLayout?.yaxis
      || !renderer?.rangeBearingTraces
      || typeof options.fitRangeForTraces !== "function"
      || !updateRuntime) return null;

    const primaryTraces = renderer.rangeBearingTraces(element.data);
    const fittedRange = options.fitRangeForTraces(primaryTraces, options.xRange, {
      paddingRatio: options.paddingRatio ?? 0.08,
      minimumPadding: options.minimumPadding ?? 0.6,
    });
    const yRange = options.expandOnly && typeof options.expandRangeToContain === "function"
      ? options.expandRangeToContain(element._fullLayout.yaxis.range, fittedRange)
      : fittedRange;
    if (!yRange) return null;

    options.beforeApply?.(yRange);
    const layoutUpdate = {
      "yaxis.range[0]": yRange[0],
      "yaxis.range[1]": yRange[1],
      "yaxis.autorange": false,
    };
    const markerTraceIndexes = [];
    const markerYUpdates = [];
    const markerUpdate = options.syncMarkers !== false
      && options.hasEventMarkers
      && typeof options.appendEventMarkerYUpdates === "function"
      ? options.appendEventMarkerYUpdates(element, markerTraceIndexes, markerYUpdates, {
        viewportRange: yRange,
      })
      : { structureChanged: false, disclosureUpdated: false };

    if (markerTraceIndexes.length && !markerUpdate.structureChanged) {
      await updateRuntime.update(
        element,
        { y: markerYUpdates },
        layoutUpdate,
        markerTraceIndexes,
        { label: options.markerUpdateLabel || "fit-main-range-markers" },
      );
      options.onMarkerPartialUpdate?.(markerUpdate);
      return Object.freeze({ mode: "update", markerUpdate, yRange });
    }

    await updateRuntime.relayout(element, layoutUpdate, {
      label: options.relayoutLabel || "fit-main-range",
    });
    if (markerUpdate.structureChanged) options.onMarkerStructureChange?.(markerUpdate);
    return Object.freeze({ mode: "relayout", markerUpdate, yRange });
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
    const pendingRelayouts = new WeakMap();
    const elementOperationTails = new WeakMap();
    const stats = {
      relayoutCalls: 0,
      coalescedRelayoutCalls: 0,
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

    function payloadSignature(payload) {
      return Object.keys(payload || {}).sort().map((key) => {
        const value = payload[key];
        return `${key}:${Array.isArray(value) ? JSON.stringify(value) : String(value)}`;
      }).join("|");
    }

    function enqueueElementOperation(element, operation) {
      if (!element || typeof operation !== "function") return Promise.resolve(undefined);
      const previous = elementOperationTails.get(element);
      let task;
      if (previous) {
        task = Promise.resolve(previous)
          .catch(() => undefined)
          .then(operation);
      } else {
        try {
          task = Promise.resolve(operation());
        } catch (error) {
          task = Promise.reject(error);
        }
      }
      elementOperationTails.set(element, task);
      task.finally(() => {
        if (elementOperationTails.get(element) === task) elementOperationTails.delete(element);
      }).catch(() => {});
      return task;
    }

    function relayoutElement(engine, element, payload) {
      const signature = payloadSignature(payload);
      const pending = pendingRelayouts.get(element);
      if (pending?.signature === signature) {
        stats.coalescedRelayoutCalls += 1;
        return pending.promise;
      }
      const promise = enqueueElementOperation(element, () => engine.relayout(element, payload));
      const state = { promise, signature };
      pendingRelayouts.set(element, state);
      promise.finally(() => {
        if (pendingRelayouts.get(element) === state) pendingRelayouts.delete(element);
      }).catch(() => {});
      return promise;
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

    function runElement(label, element, operation) {
      return run(label, () => enqueueElementOperation(element, operation));
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
        const tasks = requests.map(({ element, payload }) => relayoutElement(
          engine,
          element,
          payload,
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
      return runElement(runtimeOptions.label || "restyle", element, () => (
        engine.restyle(element, dataUpdate, traceIndexes)
      ));
    }

    async function update(element, dataUpdate, layoutUpdate, traceIndexes, runtimeOptions = {}) {
      const engine = plotly();
      if (!element?.data || typeof engine?.update !== "function") return undefined;
      stats.updateCalls += 1;
      return runElement(runtimeOptions.label || "update", element, () => (
        engine.update(element, dataUpdate, layoutUpdate, traceIndexes)
      ));
    }

    return Object.freeze({
      isBusy: () => activeOperations > 0,
      relayout,
      relayoutMany,
      restyle,
      run,
      runElement,
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

  function createChartRenderFacade(options = {}) {
    const getCoordinator = options.getCoordinator;
    const getScheduler = options.getScheduler;
    if (typeof getCoordinator !== "function" || typeof getScheduler !== "function") {
      throw new Error("chart render facade dependencies are incomplete");
    }

    function request(preserveZoom = true, requestOptions = {}) {
      return getCoordinator().requestRender(preserveZoom, requestOptions);
    }

    function requestComposition(requestOptions = {}) {
      const state = options.getState?.() || {};
      const preserveFutureOverlayViewport = requestOptions.preserveFutureOverlayViewport
        ?? Boolean(state.showAiForecast || state.showEps);
      return getCoordinator().requestComposition({
        ...requestOptions,
        preserveFutureOverlayViewport,
      });
    }

    function requestFutureOverlayComposition() {
      return requestComposition({
        preserveFutureOverlayViewport: true,
        reason: "future-overlay-composition",
      });
    }

    function requestAiForecast() {
      const render = () => request(true, {
        deferDuringInteraction: false,
        reason: "ai-forecast",
        updateClass: "forecast",
      });
      const aiApp = options.getAiApp?.();
      return aiApp?.requestRender ? aiApp.requestRender(render) : render();
    }

    return Object.freeze({
      request,
      requestAiForecast,
      requestComposition,
      requestFutureOverlayComposition,
      run: (preserveZoom = true) => getScheduler().run(preserveZoom),
      runWhenIdleOrNow: (preserveZoom = true) => getScheduler().runWhenIdleOrNow(preserveZoom),
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
    const yieldBetweenTransactions = options.yieldBetweenTransactions === true;
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
    let yieldedTransactions = 0;
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
        // A newer viewport request can abort a data/composition frame before it
        // reaches auxiliary charts. Carry the unfinished frame's scope forward
        // so the replacement cannot silently downgrade required work.
        activeTransaction.reasons.forEach((item) => pendingReasons.add(item));
        activeTransaction.updateClasses.forEach((item) => pendingClasses.add(item));
        pendingProgressiveComposition = pendingProgressiveComposition
          || activeTransaction.progressiveComposition;
        activeTransaction.superseded = true;
        supersededTransactions += 1;
      }
    }

    function takeInvalidation() {
      const reasons = [...pendingReasons];
      const updateClasses = [...pendingClasses];
      const transaction = {
        id: nextTransactionId,
        requestCount: pendingRequestCount,
        reasons,
        updateClasses,
        progressiveComposition: pendingProgressiveComposition,
        superseded: false,
      };
      nextTransactionId += 1;
      const value = normalizeChartInvalidation({
        reasons,
        updateClasses,
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
              await options.afterBatch?.({
                invalidation: nextInvalidation,
                preserveZoom: nextPreserveZoom,
              });
              break;
            }
            if (yieldBetweenTransactions) {
              yieldedTransactions += 1;
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
            if (isInteractionBusy()) scheduleDeferred(retryPreserveZoom);
            else scheduleQueuedRender(retryPreserveZoom);
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
        yieldedTransactions,
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

  function createMainChartRenderRuntime(scope = globalThis, options = {}) {
    const renderer = options.renderer;
    const updateRuntime = options.updateRuntime;
    if (!renderer?.render || (
      typeof updateRuntime?.runElement !== "function"
      && typeof updateRuntime?.run !== "function"
    )) {
      throw new Error("main chart render runtime dependencies are incomplete");
    }

    async function apply(element, traces, layout, invalidation = {}) {
      const telemetryEnabled = typeof options.telemetry?.isLoaded !== "function"
        || options.telemetry.isLoaded();
      const telemetryToken = telemetryEnabled
        ? options.telemetry?.begin?.(invalidation, traces)
        : null;
      const runUpdate = typeof updateRuntime.runElement === "function"
        ? (label, operation) => updateRuntime.runElement(label, element, operation)
        : (label, operation) => updateRuntime.run(label, operation);
      const result = await runUpdate(
        "main-chart-render",
        () => renderer.render(
          options.getPlotly?.() || scope.Plotly,
          element,
          traces,
          layout,
          options.config || {},
          { invalidation },
        ),
      );
      if (telemetryToken) options.telemetry?.complete?.(telemetryToken, result);
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
      const update = options.update || plotly?.update?.bind(plotly);
      if (!element?.data || typeof restyle !== "function") return;
      const traceIndexes = [];
      const yUpdates = [];
      const handleUpdates = [];
      const seriesUpdates = Array.isArray(frame.series) ? frame.series : [];
      const commitFrame = seriesUpdates.some((item) => item?.commit === true);
      seriesUpdates.forEach(({ seriesKey, traceIndex: preferredIndex }) => {
        const traceIndex = options.resolveTraceIndex?.(element, seriesKey, preferredIndex) ?? -1;
        const computedUpdate = options.computeSeriesUpdate?.(seriesKey, traceIndex, element) || null;
        const nextY = computedUpdate?.nextY
          || options.computeValues?.(seriesKey, traceIndex, element);
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
        const linkedUpdate = computedUpdate?.linkedUpdate
          || options.collectLinkedTraceUpdates?.(element, {
            seriesKey,
            sourceTraceIndex: traceIndex,
            nextY,
          })
          || { traceIndexes: [], yUpdates: [] };
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
        let compacted = compactTraceYUpdates(traceIndexes, yUpdates);
        const staged = stageTraceYUpdates(
          element.data,
          compacted.traceIndexes,
          compacted.yUpdates,
        );
        const requestedYRange = seriesUpdates.length
          ? options.resolveExpandedYRange?.(element, staged.traces, frame)
          : null;
        const expandedYRange = Array.isArray(requestedYRange)
          && requestedYRange.length >= 2
          && requestedYRange.slice(0, 2).every(Number.isFinite)
          && !numericRangeMatches(element?._fullLayout?.yaxis?.range, requestedYRange)
          ? requestedYRange.slice(0, 2).map(Number)
          : null;
        if (expandedYRange && typeof options.collectAnchoredYUpdates === "function") {
          const anchored = options.collectAnchoredYUpdates(
            element,
            { traces: staged.traces, viewportRange: expandedYRange },
          ) || { traceIndexes: [], yUpdates: [] };
          compacted = compactTraceYUpdates(
            [...compacted.traceIndexes, ...(anchored.traceIndexes || [])],
            [...compacted.yUpdates, ...(anchored.yUpdates || [])],
          );
        }
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
        if (expandedYRange && typeof update === "function") {
          await update(
            element,
            { y: compacted.yUpdates },
            {
              "yaxis.range[0]": expandedYRange[0],
              "yaxis.range[1]": expandedYRange[1],
              "yaxis.autorange": false,
            },
            compacted.traceIndexes,
            { label: "chart-visual-frame-expanded" },
          );
        } else {
          await restyle(element, { y: compacted.yUpdates }, compacted.traceIndexes, {
            label: "chart-visual-frame",
          });
        }
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
  acceptPlannedViewportRender,
  applyMainChartViewportPlan,
  canReuseEventMarkerTraces,
  canReuseFutureOverlayTraces,
  buildMainChartRenderFrame,
  buildLiveViewportRangePayload,
  buildLinkedViewportRangePlan,
  prepareViewportTraceFrame,
  createLinkedViewportFrameRuntime,
  hasVisibleDatedDataInRange,
  isVisibleRangeCompanion,
  settleViewportRenderTransaction,
  compactTraceYUpdates,
  createMainChartRenderGuard,
  createMainChartRenderRuntime,
  createReusableMainChartTracePlan,
  createChartRenderScheduler,
  createChartRenderFacade,
  createChartUpdateCoordinator,
  createCoordinator,
  createLatestKeyedFrameQueue,
  createPlotlyUpdateRuntime,
  createSeriesFrameApplier,
  finalizeMainChartFrameState,
  fitMainChartToViewport,
  hydrateMainChartSession,
  normalizeChartInvalidation,
  shouldHydrateChartData,
  shouldUpdateAuxiliary,
};
