"use strict";

import {
  AI_REPORT_TARGET,
  EVENT_MARKER_TARGET,
  LINE_TARGET,
  chartPressMovementPx,
  createPriorityChartPress,
  findChartInteractionTarget,
  findPriorityChartTarget,
  isPriorityChartPressValid,
  openPriorityChartTarget,
} from "./chart-target-activation.mjs";

  function createHoverIdleController(scope = globalThis, options = {}) {
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    const waitingClass = String(options.waitingClass || "is-hover-waiting");
    const setTimer = scope.setTimeout.bind(scope);
    const clearTimer = scope.clearTimeout.bind(scope);
    let timer = 0;
    let pendingSample = null;
    let waiting = false;

    const elements = () => (options.getElements?.() || []).filter(Boolean);
    const setWaiting = (value) => {
      waiting = Boolean(value);
      elements().forEach((element) => element.classList?.toggle(waitingClass, waiting));
    };

    function cancel() {
      if (timer) clearTimer(timer);
      timer = 0;
      pendingSample = null;
      setWaiting(false);
    }

    function schedule(sample) {
      pendingSample = sample;
      if (!waiting) {
        setWaiting(true);
        options.onWaitStart?.();
      }
      if (timer) clearTimer(timer);
      timer = setTimer(() => {
        timer = 0;
        const latest = pendingSample;
        pendingSample = null;
        setWaiting(false);
        if (latest) options.onIdle?.(latest);
      }, delayMs);
    }

    return Object.freeze({ cancel, schedule, isWaiting: () => waiting });
  }

  function dispatchNativeHoverAtPoint(scope, sourceEl, clientX, clientY) {
    if (!sourceEl || typeof scope.MouseEvent !== "function") return false;
    const pointedElement = scope.document?.elementFromPoint?.(clientX, clientY);
    const target = pointedElement && sourceEl.contains?.(pointedElement)
      ? pointedElement
      : sourceEl.querySelector?.(".nsewdrag, .drag");
    if (!target?.dispatchEvent) return false;
    target.dispatchEvent(new scope.MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: scope,
    }));
    return true;
  }

  function createChartPointerRuntime(scope = globalThis, options = {}) {
    const {
      CHART_GEOMETRY_CACHE_MS,
      DAY_MS,
      HOVER_IDLE_DELAY_MS,
      LINE_HIT_TEST_INTERVAL_MS,
      MIN_CHART_VIEW_SPAN_MS,
      applyChartResetPolicy,
      applySyncedXRangeMs,
      axisPixelToXValue,
      beginLineOffsetDrag,
      chartSession,
      chartViewportControllerModule,
      clearHoverOnChart,
      createPointerFrameController,
      ensureFullHistoryDataReady,
      findAiForecastReportAtClientPoint,
      findEventMarkerAtClientPoint,
      findNearestLineDragTarget,
      getChartCursorSyncController,
      getChartInteractionGeometry,
      getChartNavigationDataRangeMs,
      getChartRangeSyncController,
      getCurrentXRangeMs,
      hideDisclosurePopover,
      interactionState,
      isTouchDevice,
      latestPointerSample,
      nearestMainLineDate,
      openAiForecastReportHit,
      openEventMarkerHit,
      recordPerfSample,
      resetEventMarkerHoverHighlight,
      scheduleEventMarkerHoverHighlight,
      scheduleSyncedCursor,
      setHoveredLineTarget,
      showChartNavigationMessage,
      startPerfSample,
      syncHoverToChart,
      zoomChartViewport,
    } = options;
    if (!scope.document || !interactionState
      || typeof createPointerFrameController !== "function") {
      throw new Error("chart pointer runtime dependencies are incomplete");
    }

    const window = scope;
    const document = scope.document;
    const Element = scope.Element;
    const setTimeout = scope.setTimeout.bind(scope);
    const clearTimeout = scope.clearTimeout.bind(scope);
    let cursorMoveBound = false;
    let chartInteractionsBound = false;
    let pointerMoveController = null;
    let lastTouchTapAt = 0;
    let lastTouchTapX = null;
    let lastTouchTapEl = null;
    let fullLifetimeRestoreRange = null;
    let touchSelectionPinned = false;
    let lastTouchFullLifetimeToggleAt = 0;
    let suppressTouchSelectionUntil = 0;
    let fullLifetimeToggleTask = Promise.resolve(false);
    let activeHoverIdleController = null;
    let clearActiveViewportDrag = null;
    const boundListeners = [];

    function listen(target, eventName, listener, optionsValue) {
      target?.addEventListener?.(eventName, listener, optionsValue);
      boundListeners.push(() => target?.removeEventListener?.(eventName, listener, optionsValue));
    }

    function destroy() {
      activeHoverIdleController?.cancel();
      activeHoverIdleController = null;
      pointerMoveController?.cancel();
      pointerMoveController = null;
      clearActiveViewportDrag?.();
      clearActiveViewportDrag = null;
      while (boundListeners.length) boundListeners.pop()?.();
      cursorMoveBound = false;
      chartInteractionsBound = false;
    }

    function bind() {
      const mainEl = document.getElementById("chart");
      const macdEl = document.getElementById("chart-macd");
      const adrEl = document.getElementById("chart-adr");
      let priorityPointerDown = null;
      let lastEventMarkerHoverHit = null;
      if (!mainEl || !adrEl) return;
      getChartCursorSyncController().prepare([mainEl, macdEl, adrEl]);
      if (cursorMoveBound && chartInteractionsBound) return;

      const hoverIdleController = createHoverIdleController(window, {
        delayMs: HOVER_IDLE_DELAY_MS,
        getElements: () => [mainEl, macdEl, adrEl],
        onIdle: ({ sourceEl, clientX, clientY }) => {
          if (!chartSession.hoverShowPopup || interactionState.handleDragging
            || interactionState.viewportDragging || interactionState.wheelZooming) return;
          if (sourceEl === mainEl) {
            const geometry = getChartInteractionGeometry(sourceEl);
            const markerTarget = findNearestLineDragTarget(
              sourceEl,
              clientX,
              clientY,
              false,
              geometry,
            );
            const markerTrace = sourceEl.data?.[markerTarget?.traceIndex];
            const markerX = markerTrace?.meta?.isEpsTrace
              && Number.isInteger(markerTarget?.pointIndex)
              ? markerTrace.x?.[markerTarget.pointIndex]
              : null;
            if (markerX != null && typeof syncHoverToChart === "function") {
              syncHoverToChart(sourceEl, markerX);
              return;
            }
          }
          dispatchNativeHoverAtPoint(window, sourceEl, clientX, clientY);
        },
      });
      activeHoverIdleController = hoverIdleController;
    
      let touchStartPoint = null;
      let dragState = null;
      let pinchState = null;
      const activeTouchPointers = new Map();

      const scheduleViewportRange = (range, meta) => {
        if (!range) return false;
        return applySyncedXRangeMs(range[0], range[1], meta);
      };
    
      const moveAt = (sourceEl, clientX, clientY, geometry = null, resolvedXValue = null) => {
        const xValue = resolvedXValue ?? axisPixelToXValue(sourceEl, clientX, false, geometry);
        if (xValue == null) {
          scheduleSyncedCursor(null);
          return;
        }
        const sourceLocalX = geometry?.rect ? clientX - geometry.rect.left : null;
        const sourceLocalY = geometry?.rect ? clientY - geometry.rect.top : null;
        scheduleSyncedCursor(
          xValue,
          sourceEl,
          clientX,
          sourceLocalX,
          clientY,
          sourceLocalY,
        );
      };
    
      const processPointerMove = ({
        sourceEl,
        clientX,
        clientY,
        geometry,
        runHitTest,
      }) => {
        const perfStartedAt = startPerfSample();
        const interactionContext = {};
        if (runHitTest && !interactionState.viewportDragging) {
          const interactionTarget = findChartInteractionTarget(
            sourceEl,
            clientX,
            clientY,
            false,
            geometry,
            {
              findAiForecastReportAtClientPoint,
              findEventMarkerAtClientPoint,
              findNearestLineDragTarget,
              interactionContext,
            },
          );
          const eventMarkerTarget = interactionTarget?.kind === EVENT_MARKER_TARGET
            ? interactionTarget
            : null;
          lastEventMarkerHoverHit = eventMarkerTarget
            ? {
              ...eventMarkerTarget,
              sourceEl,
              trace: sourceEl.data?.[eventMarkerTarget.traceIndex],
              clientX,
              clientY,
            }
            : null;
          sourceEl.classList.toggle("is-event-marker-hovering", Boolean(eventMarkerTarget));
          const aiReportTarget = interactionTarget?.kind === AI_REPORT_TARGET ? interactionTarget : null;
          sourceEl.classList.toggle("is-ai-report-hovering", Boolean(aiReportTarget));
          if (eventMarkerTarget) {
            const trace = sourceEl.data?.[eventMarkerTarget.traceIndex];
            scheduleEventMarkerHoverHighlight({
              points: [{
                curveNumber: eventMarkerTarget.traceIndex,
                pointIndex: eventMarkerTarget.pointIndex,
                pointNumber: eventMarkerTarget.pointIndex,
                data: trace,
              }],
            });
          } else {
            resetEventMarkerHoverHighlight(sourceEl);
          }
          const lineTarget = interactionTarget?.kind === LINE_TARGET ? interactionTarget : null;
          setHoveredLineTarget(lineTarget);
        }
        moveAt(
          sourceEl,
          clientX,
          clientY,
          geometry,
          interactionContext.chartPoint?.xValue,
        );
        if (perfStartedAt) recordPerfSample("pointerMove", perfStartedAt, { chart: sourceEl.id || "unknown" });
      };
    
      pointerMoveController = createPointerFrameController(window, {
        geometryTtlMs: CHART_GEOMETRY_CACHE_MS,
        hitTestIntervalMs: LINE_HIT_TEST_INTERVAL_MS,
        readGeometry: getChartInteractionGeometry,
        processFrame: processPointerMove,
      });
    
      const schedulePointerMove = (sourceEl, clientX, clientY, findLineTarget) => {
        pointerMoveController.schedule({ sourceEl, clientX, clientY, findLineTarget });
      };

      const previewSyncedCursor = (sourceEl, clientX, clientY) => {
        const controller = getChartCursorSyncController();
        if (typeof controller.previewClientPoint === "function") {
          controller.previewClientPoint(sourceEl, clientX, clientY);
          return;
        }
        controller.previewClientX?.(clientX);
      };

      const hideSyncedCursor = () => {
        const controller = getChartCursorSyncController();
        controller.cancel?.();
        controller.apply?.({ xValue: null });
      };
    
      const onLeave = (event) => {
        if (interactionState.handleDragging || interactionState.viewportDragging) return;
        if (event?.pointerType === "touch" && touchSelectionPinned) return;
        hoverIdleController.cancel();
        pointerMoveController.cancel();
        setHoveredLineTarget(null);
        mainEl.classList.remove("is-event-marker-hovering", "is-ai-report-hovering");
        lastEventMarkerHoverHit = null;
        resetEventMarkerHoverHighlight(mainEl);
        scheduleSyncedCursor(null);
        clearHoverOnChart(mainEl);
        clearHoverOnChart(macdEl);
        clearHoverOnChart(adrEl);
      };
    
      const invalidatePointerGeometry = () => {
        pointerMoveController?.invalidate();
        getChartCursorSyncController().invalidateGeometry?.();
      };
      listen(window, "resize", invalidatePointerGeometry, { passive: true });
      listen(window, "scroll", invalidatePointerGeometry, { passive: true });
    
      const onPriorityClick = (event) => {
        if (event.target instanceof Element && event.target.closest(".disclosure-popover")) return;
        const now = Date.now();
        const geometry = getChartInteractionGeometry(mainEl);
        const detectedTarget = findPriorityChartTarget(
          mainEl,
          event.clientX,
          event.clientY,
          isTouchDevice(),
          geometry,
          { findEventMarkerAtClientPoint, findAiForecastReportAtClientPoint },
        );
        const directPress = isPriorityChartPressValid(priorityPointerDown, detectedTarget, event, { now });
        const target = directPress ? priorityPointerDown.target : detectedTarget;
        priorityPointerDown = null;
        if (now < interactionState.suppressPlotlyClickUntil && !directPress) return;
        if (!target) {
          hideDisclosurePopover();
          return;
        }
        const opened = openPriorityChartTarget(mainEl, target, event, {
          openAiForecastReportHit,
          openEventMarkerHit,
        });
        if (!opened) return;
        event.preventDefault();
        event.stopPropagation();
      };
    
      const beginViewportDrag = (event, sourceEl) => {
        const startRange = getCurrentXRangeMs(sourceEl);
        const dataRange = getChartNavigationDataRangeMs(mainEl);
        const geometry = getChartInteractionGeometry(sourceEl);
        const axisLength = Number(geometry?.xa?._length);
        if (!startRange || !dataRange || !(axisLength > 0)) return false;
        dragState = {
          sourceEl,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startRange: [...startRange],
          dataRange: [...dataRange],
          axisLength,
          moved: false,
        };
        interactionState.viewportDragging = true;
        hoverIdleController.cancel();
        touchSelectionPinned = false;
        sourceEl.classList.add("is-viewport-panning");
        pointerMoveController?.cancel();
        hideSyncedCursor();
        try { sourceEl.setPointerCapture?.(event.pointerId); } catch (_) {}
        window.addEventListener("pointermove", onWindowPointerMove, { passive: false });
        window.addEventListener("pointerup", onWindowPointerUp);
        window.addEventListener("pointercancel", onWindowPointerCancel);
        return true;
      };
    
      const clearViewportDrag = () => {
        const state = dragState;
        if (!state) return null;
        dragState = null;
        interactionState.viewportDragging = false;
        state.sourceEl.classList.remove("is-viewport-panning");
        window.removeEventListener("pointermove", onWindowPointerMove);
        window.removeEventListener("pointerup", onWindowPointerUp);
        window.removeEventListener("pointercancel", onWindowPointerCancel);
        try { state.sourceEl.releasePointerCapture?.(state.pointerId); } catch (_) {}
        return state;
      };
      clearActiveViewportDrag = clearViewportDrag;

      const viewportDragRange = (state, clientX) => {
        if (!state || !Number.isFinite(Number(clientX)) || !(state.axisLength > 0)) return null;
        const span = state.startRange[1] - state.startRange[0];
        const shift = -((Number(clientX) - state.startClientX) / state.axisLength) * span;
        return chartViewportControllerModule.panRange(
          state.startRange,
          state.dataRange,
          shift,
        );
      };
    
      const stopViewportDrag = (upEvent, cancelled = false) => {
        if (!dragState || upEvent.pointerId !== dragState.pointerId) return;
        const st = clearViewportDrag();
        if (!st) return;
        const sample = latestPointerSample(upEvent);
        previewSyncedCursor(st.sourceEl, sample.clientX, sample.clientY);
        schedulePointerMove(st.sourceEl, sample.clientX, sample.clientY, false);
        if (!cancelled && upEvent.pointerType === "mouse" && chartSession.hoverShowPopup) {
          hoverIdleController.schedule({
            sourceEl: st.sourceEl,
            clientX: sample.clientX,
            clientY: sample.clientY,
          });
        }
        if (cancelled || !st.moved) {
          getChartRangeSyncController().cancel?.();
          return;
        }
        const finalRange = viewportDragRange(st, sample.clientX);
        if (finalRange) scheduleViewportRange(finalRange, {
          source: "blank-pan-final",
          fit: false,
          liveFit: chartSession.autoChartReset,
        });
        interactionState.suppressPlotlyClickUntil = Date.now() + 700;
        Promise.resolve(getChartRangeSyncController().flush())
          .finally(() => applyChartResetPolicy("viewport", 80));
      };
    
      const startPinchZoom = (sourceEl) => {
        const points = [...activeTouchPointers.values()].filter((point) => point.sourceEl === sourceEl).slice(0, 2);
        if (points.length < 2) return false;
        const startRange = getCurrentXRangeMs(sourceEl);
        const navigationRange = getChartNavigationDataRangeMs(document.getElementById("chart"));
        if (!startRange || !navigationRange) return false;
        const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        if (distance < 8) return false;
        const geometry = getChartInteractionGeometry(sourceEl);
        const midpointX = (points[0].x + points[1].x) / 2;
        const axisLeft = Number(geometry?.rect?.left) + Number(geometry?.xa?._offset);
        const axisLength = Number(geometry?.xa?._length);
        const requestedAnchorRatio = Number.isFinite(axisLeft) && axisLength > 0
          ? Math.max(0, Math.min(1, (midpointX - axisLeft) / axisLength))
          : 0.5;
        const anchorRatio = chartViewportControllerModule.resolveZoomAnchorRatio(
          startRange,
          navigationRange,
          requestedAnchorRatio,
          { tolerance: DAY_MS * 2 },
        );
        getChartRangeSyncController().cancel?.();
        clearViewportDrag();
        pinchState = {
          sourceEl,
          startRange: [...startRange],
          dataRange: [
            Math.min(startRange[0], navigationRange[0]),
            Math.max(startRange[1], navigationRange[1]),
          ],
          startDistance: distance,
          anchorRatio,
        };
        interactionState.viewportDragging = true;
        hoverIdleController.cancel();
        touchSelectionPinned = false;
        touchStartPoint = null;
        lastTouchTapAt = 0;
        lastTouchTapX = null;
        lastTouchTapEl = null;
        hideDisclosurePopover();
        resetEventMarkerHoverHighlight(mainEl);
        return true;
      };
    
      const updatePinchZoom = () => {
        if (!pinchState) return false;
        const points = [...activeTouchPointers.values()]
          .filter((point) => point.sourceEl === pinchState.sourceEl)
          .slice(0, 2);
        if (points.length < 2) return false;
        const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        const currentRange = getCurrentXRangeMs(pinchState.sourceEl);
        if (distance > pinchState.startDistance
          && currentRange
          && currentRange[1] - currentRange[0] <= MIN_CHART_VIEW_SPAN_MS * 1.001) {
          showChartNavigationMessage("기간을 더 이상 줄일 수 없습니다.");
          return false;
        }
        const nextRange = chartViewportControllerModule.pinchZoomRange(
          pinchState.startRange,
          pinchState.dataRange,
          pinchState.startDistance,
          distance,
          pinchState.anchorRatio,
          { minimumSpan: MIN_CHART_VIEW_SPAN_MS },
        );
        if (!nextRange) return false;
        scheduleViewportRange(nextRange, {
          source: "touch-pinch",
          fit: false,
          liveFit: chartSession.autoChartReset,
        });
        return true;
      };
    
      const finishPinchZoom = () => {
        if (!pinchState) return;
        pinchState = null;
        interactionState.viewportDragging = false;
        interactionState.suppressPlotlyClickUntil = Date.now() + 700;
        pointerMoveController?.cancel();
        scheduleSyncedCursor(null);
        Promise.resolve(getChartRangeSyncController().flush())
          .finally(() => applyChartResetPolicy("viewport", 80));
      };
    
      const performFullVisibleLifetimeToggle = async () => {
        // History preparation may redraw the chart. Preserve the user's range
        // before that work starts rather than reading an already-expanded view.
        const requestedRange = getCurrentXRangeMs(mainEl);
        await ensureFullHistoryDataReady();
        const dataRange = getChartNavigationDataRangeMs(mainEl);
        if (!dataRange) return false;
        const currentRange = requestedRange || getCurrentXRangeMs(mainEl);
        if (fullLifetimeRestoreRange) {
          const restored = chartViewportControllerModule.clampRangeToData(
            fullLifetimeRestoreRange,
            dataRange,
          );
          fullLifetimeRestoreRange = null;
          if (!restored) return false;
          applySyncedXRangeMs(restored[0], restored[1], { source: "full-lifetime-restore" });
        } else {
          const dataSpan = Math.max(1, dataRange[1] - dataRange[0]);
          const tolerance = Math.max(DAY_MS, dataSpan * 0.001);
          const isFullLifetime = currentRange
            && Math.abs(currentRange[0] - dataRange[0]) <= tolerance
            && Math.abs(currentRange[1] - dataRange[1]) <= tolerance;
          if (currentRange && !isFullLifetime) fullLifetimeRestoreRange = [...currentRange];
          applySyncedXRangeMs(dataRange[0], dataRange[1], { source: "full-lifetime" });
        }
        await getChartRangeSyncController().flush();
        return true;
      };

      const toggleFullVisibleLifetime = () => {
        const task = fullLifetimeToggleTask.then(performFullVisibleLifetimeToggle);
        fullLifetimeToggleTask = task.catch(() => false);
        return task;
      };
    
      const onChartDoubleClick = (event) => {
        if (event.button !== 0) return;
        const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
        const insideChart = [mainEl, macdEl, adrEl].filter(Boolean).some((chartEl) => (
          eventPath.includes(chartEl)
          || (typeof scope.Node === "function"
            && event.target instanceof scope.Node
            && chartEl.contains(event.target))
        ));
        if (!insideChart) return;
        if (Date.now() - lastTouchFullLifetimeToggleAt < 500) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (event.target instanceof Element
          && event.target.closest(".disclosure-popover, .legend, .modebar-container")) return;
        void toggleFullVisibleLifetime();
        hideDisclosurePopover();
        event.preventDefault();
        event.stopImmediatePropagation();
      };
    
      let wheelRangeTimer = 0;
      const onWheelRange = (event) => {
        if (event.ctrlKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
        event.preventDefault();
        if (interactionState.handleDragging || interactionState.viewportDragging) return;
        hoverIdleController.cancel();
        interactionState.wheelZooming = true;
        const sourceEl = event.currentTarget;
        const geometry = getChartInteractionGeometry(sourceEl);
        const axisLeft = Number(geometry?.rect?.left) + Number(geometry?.xa?._offset);
        const axisLength = Number(geometry?.xa?._length);
        const requestedAnchorRatio = Number.isFinite(axisLeft) && axisLength > 0
          ? Math.max(0, Math.min(1, (event.clientX - axisLeft) / axisLength))
          : 0.5;
        const anchorRatio = chartViewportControllerModule.resolveZoomAnchorRatio(
          getCurrentXRangeMs(sourceEl),
          getChartNavigationDataRangeMs(document.getElementById("chart")),
          requestedAnchorRatio,
          { tolerance: DAY_MS * 2 },
        );
        zoomChartViewport(event.deltaY > 0 ? 1 : -1, "wheel-zoom", { anchorRatio });
        if (wheelRangeTimer) clearTimeout(wheelRangeTimer);
        wheelRangeTimer = setTimeout(() => {
          wheelRangeTimer = 0;
          interactionState.wheelZooming = false;
          Promise.resolve(getChartRangeSyncController().flush())
            .finally(() => applyChartResetPolicy("viewport", 80));
        }, 160);
      };
    
      const onWindowPointerMove = (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const sample = latestPointerSample(event);
        const delta = Math.abs(sample.clientX - dragState.startClientX);
        if (delta >= 3 && !dragState.moved) {
          dragState.moved = true;
          interactionState.suppressPlotlyClickUntil = Date.now() + 700;
          resetEventMarkerHoverHighlight(dragState.sourceEl);
        }
        const nextRange = viewportDragRange(dragState, sample.clientX);
        if (nextRange) scheduleViewportRange(nextRange, {
          source: "blank-pan",
          fit: false,
          liveFit: chartSession.autoChartReset,
        });
      };
      const onWindowPointerUp = (event) => stopViewportDrag(event, false);
      const onWindowPointerCancel = (event) => stopViewportDrag(event, true);
    
      const onPointerDown = (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (event.target instanceof Element
          && event.target.closest(".disclosure-popover, .legend, .modebar-container")) return;
        const sourceEl = event.currentTarget;
        hoverIdleController.cancel();
        const xa = sourceEl?._fullLayout?.xaxis;
        if (!xa) return;
        const isTouch = event.pointerType === "touch";
        if (isTouch) {
          activeTouchPointers.set(event.pointerId, {
            sourceEl,
            x: event.clientX,
            y: event.clientY,
          });
          if (activeTouchPointers.size >= 2) {
            if (startPinchZoom(sourceEl)) event.preventDefault();
            return;
          }
        }
        if (!event.isPrimary) return;
        const geometry = getChartInteractionGeometry(sourceEl);
        priorityPointerDown = null;
        if (isTouch) touchStartPoint = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    
        const interactionTarget = findChartInteractionTarget(
          sourceEl,
          event.clientX,
          event.clientY,
          isTouch,
          geometry,
          {
            findAiForecastReportAtClientPoint,
            findEventMarkerAtClientPoint,
            findNearestLineDragTarget,
          },
        );
        let priorityTarget = interactionTarget?.kind === LINE_TARGET ? null : interactionTarget;
        const canReuseHoveredMarker = !priorityTarget
          && !isTouch
          && lastEventMarkerHoverHit?.sourceEl === sourceEl
          && lastEventMarkerHoverHit.trace === sourceEl.data?.[lastEventMarkerHoverHit.traceIndex]
          && Math.hypot(
            event.clientX - lastEventMarkerHoverHit.clientX,
            event.clientY - lastEventMarkerHoverHit.clientY,
          ) <= chartPressMovementPx(false);
        if (canReuseHoveredMarker) {
          priorityTarget = { kind: EVENT_MARKER_TARGET, ...lastEventMarkerHoverHit };
        }
        if (priorityTarget) {
          priorityPointerDown = createPriorityChartPress(priorityTarget, event);
          setHoveredLineTarget(null);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
    
        const lineTarget = interactionTarget?.kind === LINE_TARGET ? interactionTarget : null;
        if (lineTarget && beginLineOffsetDrag(sourceEl, lineTarget, event.clientY, event.pointerId)) {
          event.preventDefault();
          event.stopPropagation();
          setHoveredLineTarget(lineTarget);
          lastTouchTapAt = 0;
          lastTouchTapX = null;
          lastTouchTapEl = null;
          return;
        }
    
        setHoveredLineTarget(null);
        if (isTouch) {
          hideDisclosurePopover();
          event.preventDefault();
          moveAt(sourceEl, event.clientX, event.clientY, geometry);
          const now = Date.now();
          const sameTarget = lastTouchTapEl === sourceEl;
          const nearX = Number.isFinite(lastTouchTapX) ? Math.abs(lastTouchTapX - event.clientX) <= 28 : false;
          const isDoubleTap = sameTarget && nearX && (now - lastTouchTapAt) <= 320;
          if (isDoubleTap) {
            touchSelectionPinned = false;
            lastTouchFullLifetimeToggleAt = now;
            suppressTouchSelectionUntil = now + 400;
            void toggleFullVisibleLifetime();
            lastTouchTapAt = 0;
            lastTouchTapX = null;
            lastTouchTapEl = null;
            return;
          }
          lastTouchTapAt = now;
          lastTouchTapX = event.clientX;
          lastTouchTapEl = sourceEl;
          beginViewportDrag(event, sourceEl);
          return;
        }
    
        if (event.pointerType !== "mouse") return;
        if (beginViewportDrag(event, sourceEl)) event.preventDefault();
      };
    
      const onPointerMove = (event) => {
        if (event.pointerType === "touch" && activeTouchPointers.has(event.pointerId)) {
          const point = activeTouchPointers.get(event.pointerId);
          activeTouchPointers.set(event.pointerId, { ...point, x: event.clientX, y: event.clientY });
          if (pinchState) {
            event.preventDefault();
            updatePinchZoom();
            return;
          }
        }
        if (!event.isPrimary || interactionState.handleDragging || interactionState.viewportDragging) {
          if (event.pointerType === "mouse") hoverIdleController.cancel();
          return;
        }
        if (event.target instanceof Element
          && event.target.closest(".disclosure-popover, .legend, .modebar-container")) {
          if (event.pointerType === "mouse") hoverIdleController.cancel();
          return;
        }
        const sample = latestPointerSample(event);
        if (event.pointerType === "mouse") {
          if (chartSession.hoverShowPopup && !interactionState.wheelZooming) {
            hoverIdleController.schedule({
              sourceEl: event.currentTarget,
              clientX: sample.clientX,
              clientY: sample.clientY,
            });
          } else {
            hoverIdleController.cancel();
          }
        }
        previewSyncedCursor(event.currentTarget, sample.clientX, sample.clientY);
        if (event.pointerType === "touch") {
          event.preventDefault();
          if (touchStartPoint?.pointerId === event.pointerId && Math.hypot(
            sample.clientX - touchStartPoint.x,
            sample.clientY - touchStartPoint.y,
          ) > 8) {
            touchSelectionPinned = false;
            interactionState.suppressPlotlyClickUntil = Date.now() + 500;
          }
          schedulePointerMove(event.currentTarget, sample.clientX, sample.clientY, false);
          return;
        }
        schedulePointerMove(
          event.currentTarget,
          sample.clientX,
          sample.clientY,
          event.currentTarget === mainEl,
        );
      };

      const onPointerEnd = (event) => {
        if (event.pointerType === "touch") {
          activeTouchPointers.delete(event.pointerId);
          if (pinchState) {
            event.preventDefault();
            if (activeTouchPointers.size < 2) finishPinchZoom();
            return;
          }
        }
        const priorityPress = priorityPointerDown;
        if (priorityPress) {
          const isTouch = event.pointerType === "touch";
          const geometry = getChartInteractionGeometry(mainEl);
          const target = isTouch
            ? findPriorityChartTarget(
              mainEl,
              event.clientX,
              event.clientY,
              true,
              geometry,
              { findEventMarkerAtClientPoint, findAiForecastReportAtClientPoint },
            )
            : priorityPress.target;
          const validPress = isPriorityChartPressValid(priorityPress, target, event, {
          movementPx: chartPressMovementPx(isTouch),
          });
          priorityPointerDown = null;
          if (validPress) {
            const opened = openPriorityChartTarget(mainEl, target, event, {
              openAiForecastReportHit,
              openEventMarkerHit,
            });
            if (opened) {
              if (isTouch) touchStartPoint = null;
              interactionState.suppressPlotlyClickUntil = Date.now() + 400;
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
        }
        if (event.pointerType !== "touch" || touchStartPoint?.pointerId !== event.pointerId) return;
        const startPoint = touchStartPoint;
        const tapDistance = Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y);
        const viewportState = dragState?.pointerId === event.pointerId ? dragState : null;
        touchStartPoint = null;
        if (viewportState) stopViewportDrag(event, false);
        setHoveredLineTarget(null);
        if (Date.now() < suppressTouchSelectionUntil) return;
        if ((!viewportState || !viewportState.moved) && tapDistance <= chartPressMovementPx(false)) {
          const sourceEl = viewportState?.sourceEl || event.currentTarget;
          const geometry = getChartInteractionGeometry(sourceEl);
          const xValue = axisPixelToXValue(sourceEl, event.clientX, false, geometry);
          const selectedXValue = sourceEl === mainEl && typeof nearestMainLineDate === "function"
            ? (nearestMainLineDate(mainEl, xValue) || xValue)
            : xValue;
          touchSelectionPinned = selectedXValue != null;
          if (selectedXValue != null) {
            const sourceRect = sourceEl.getBoundingClientRect();
            scheduleSyncedCursor(
              selectedXValue,
              sourceEl,
              event.clientX,
              event.clientX - sourceRect.left,
              event.clientY,
              event.clientY - sourceRect.top,
            );
            if (chartSession.hoverShowPopup && typeof syncHoverToChart === "function") {
              syncHoverToChart(sourceEl, selectedXValue);
            }
          }
          return;
        }
        touchSelectionPinned = false;
        onLeave(event);
      };
    
      const preventGesture = (event) => event.preventDefault();
      [mainEl, macdEl, adrEl].filter(Boolean).forEach((chartEl) => {
        listen(chartEl, "pointerdown", onPointerDown, { passive: false, capture: true });
        listen(chartEl, "pointermove", onPointerMove, { passive: false, capture: true });
        listen(chartEl, "pointerleave", onLeave);
        listen(chartEl, "gesturestart", preventGesture, { passive: false });
        listen(chartEl, "gesturechange", preventGesture, { passive: false });
        listen(chartEl, "wheel", onWheelRange, { passive: false });
      });
      listen(window, "pointerup", onPointerEnd, true);
      listen(window, "pointercancel", onPointerEnd, true);
      listen(document, "dblclick", onChartDoubleClick, true);
      listen(mainEl, "click", onPriorityClick, true);
      cursorMoveBound = true;
      chartInteractionsBound = true;
    }

    return Object.freeze({
      bind,
      destroy,
      isBound: () => cursorMoveBound && chartInteractionsBound,
    });
  }

export {
  createHoverIdleController,
  createChartPointerRuntime,
  dispatchNativeHoverAtPoint,
};
