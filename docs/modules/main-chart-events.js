(function initThinkStockMainChartEvents(globalScope) {
  "use strict";

  function createMainChartEvents(scope = globalScope, options = {}) {
    const {
      HANDLE_UPDATE_DEBOUNCE_MS,
      MAX_VISIBLE_MAIN_SERIES_MESSAGE,
      chartSession,
      clearAutoResetSeriesTransforms,
      clearHoverOnChart,
      configureExactDateEventHover,
      enforceMainChartSeriesLimit,
      handleAiForecastClick,
      handleDisclosureClick,
      handleTimingSignalClick,
      hideDisclosurePopover,
      interactionState,
      isTouchDevice,
      noteStockVisibilityChange,
      refreshAiForecastTargets,
      renderCoMovementPanel,
      requestChartCompositionUpdate,
      resetDisclosureHoverHighlight,
      scheduleDisclosureHoverHighlight,
      scheduleHandleUpdate,
      scheduleViewportRangeSync,
      setAiForecastTargetVisibility,
      setMainChartSeriesVisible,
      showChartNavigationMessage,
      syncHoverToChart,
      toMsSafe,
    } = options;
    if (!scope.document || !chartSession || !interactionState) {
      throw new Error("main chart event dependencies are incomplete");
    }

    const document = scope.document;
    const boundElements = new WeakSet();

    function bind(element) {
      if (!element?.on || boundElements.has(element)) return;

      element.on("plotly_legendclick", (eventData) => {
        const index = eventData.curveNumber;
        const key = chartSession.currentSelected[index];
        if (key) {
          const becomingVisible = chartSession.hiddenSeries.has(key);
          if (becomingVisible) {
            if (!setMainChartSeriesVisible(key, true)) return false;
            clearAutoResetSeriesTransforms(key);
          } else {
            setMainChartSeriesVisible(key, false);
          }
          noteStockVisibilityChange(key);
          setAiForecastTargetVisibility(key, becomingVisible);
        }
        requestChartCompositionUpdate();
        return false;
      });
      element.on("plotly_legenddoubleclick", () => {
        chartSession.hiddenSeries.clear();
        const hiddenByLimit = enforceMainChartSeriesLimit();
        if (hiddenByLimit.length) {
          showChartNavigationMessage(MAX_VISIBLE_MAIN_SERIES_MESSAGE, 3000);
        }
        clearAutoResetSeriesTransforms();
        refreshAiForecastTargets();
        requestChartCompositionUpdate();
        return false;
      });
      element.on("plotly_relayout", (eventData) => {
        const rangePair = Array.isArray(eventData["xaxis.range"])
          ? eventData["xaxis.range"]
          : null;
        const hasRange = (
          eventData["xaxis.range[0]"] != null
          && eventData["xaxis.range[1]"] != null
        ) || (Array.isArray(rangePair) && rangePair.length === 2);
        const hasAuto = eventData["xaxis.autorange"] === true;
        const rangeStart = eventData["xaxis.range[0]"]
          ?? (Array.isArray(rangePair) ? rangePair[0] : null);
        const rangeEnd = eventData["xaxis.range[1]"]
          ?? (Array.isArray(rangePair) ? rangePair[1] : null);
        if (eventData["yaxis.autorange"] === true) {
          interactionState.useViewportEventMarkerGap = false;
        }
        if (!interactionState.isHandleDragging && hasRange && rangeStart != null && rangeEnd != null) {
          chartSession.pinnedXRange = [rangeStart, rangeEnd];
          const startMs = toMsSafe(rangeStart);
          const endMs = toMsSafe(rangeEnd);
          if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
            chartSession.currentStart = new Date(Math.min(startMs, endMs)).toISOString().slice(0, 10);
            chartSession.currentEnd = new Date(Math.max(startMs, endMs)).toISOString().slice(0, 10);
          }
        }
        if (!interactionState.chartSyncing) {
          scheduleHandleUpdate(hasRange || hasAuto ? 0 : HANDLE_UPDATE_DEBOUNCE_MS);
          if (chartSession.showCoMovement && (hasRange || hasAuto)) renderCoMovementPanel();
        }
        if (interactionState.chartSyncing || interactionState.isHandleDragging) return;
        if (interactionState.cursorSyncing && !hasRange && !hasAuto) return;

        const syncedCharts = [
          document.getElementById("chart-macd"),
          document.getElementById("chart-adr"),
        ].filter((target) => target?.data && !target.hidden);
        if (!syncedCharts.length) return;
        if (rangeStart != null && rangeEnd != null) {
          syncedCharts.forEach((target) => scheduleViewportRangeSync(target, {
            "xaxis.range[0]": rangeStart,
            "xaxis.range[1]": rangeEnd,
          }));
          return;
        }
        if (!hasAuto) return;
        chartSession.pinnedXRange = null;
        const mainRange = element._fullLayout?.xaxis?.range?.slice();
        if (Array.isArray(mainRange) && mainRange.length === 2) {
          syncedCharts.forEach((target) => scheduleViewportRangeSync(target, {
            "xaxis.range[0]": mainRange[0],
            "xaxis.range[1]": mainRange[1],
          }));
        } else {
          syncedCharts.forEach((target) => scheduleViewportRangeSync(target, {
            "xaxis.autorange": true,
          }));
        }
      });
      element.on("plotly_beforehover", (eventData) => {
        configureExactDateEventHover(element, eventData);
      });
      element.on("plotly_hover", (eventData) => {
        scheduleDisclosureHoverHighlight(eventData);
        if (!chartSession.hoverShowPopup || interactionState.hoverSyncing) return;
        const xValue = eventData?.points?.[0]?.x;
        if (!xValue) return;
        const macdElement = document.getElementById("chart-macd");
        const adrElement = document.getElementById("chart-adr");
        if (!macdElement?.hidden) syncHoverToChart(macdElement, xValue);
        syncHoverToChart(adrElement, xValue);
      });
      element.on("plotly_unhover", () => {
        resetDisclosureHoverHighlight(element);
        if (!chartSession.hoverShowPopup || interactionState.hoverSyncing) return;
        const macdElement = document.getElementById("chart-macd");
        const adrElement = document.getElementById("chart-adr");
        clearHoverOnChart(macdElement);
        clearHoverOnChart(adrElement);
      });
      element.on("plotly_click", (eventData) => {
        if (Date.now() < interactionState.suppressPlotlyClickUntil) return;
        if (handleDisclosureClick(eventData)) return;
        if (handleTimingSignalClick(eventData)) return;
        if (handleAiForecastClick?.(eventData)) return;
        if (isTouchDevice()) return;
        hideDisclosurePopover();
      });
      boundElements.add(element);
    }

    return Object.freeze({ bind });
  }

  globalScope.ThinkStockMainChartEvents = Object.freeze({
    createMainChartEvents,
  });
}(typeof self !== "undefined" ? self : globalThis));
