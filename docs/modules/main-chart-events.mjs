"use strict";

import { resolveRelayoutViewport } from "./chart-viewport-controller.mjs";

  function createMainChartEvents(scope = globalThis, options = {}) {
    const {
      HANDLE_UPDATE_DEBOUNCE_MS,
      MAX_VISIBLE_MAIN_SERIES_MESSAGE,
      chartSession,
      changeSeriesVisibility,
      clearAutoResetSeriesTransforms,
      clearHoverOnChart,
      commitViewportRange,
      configureExactDateEventHover,
      enforceMainChartSeriesLimit,
      handlePriorityChartClick,
      hideDisclosurePopover,
      interactionState,
      isCurrentRange,
      isTouchDevice,
      normalizeHoverPopupIndent,
      refreshAiForecastTargets,
      renderCoMovementPanel,
      requestChartCompositionUpdate,
      scheduleHandleUpdate,
      showChartNavigationMessage,
      syncHoverToChart,
    } = options;
    if (!scope.document || !chartSession || !interactionState
      || typeof commitViewportRange !== "function") {
      throw new Error("main chart event dependencies are incomplete");
    }

    const document = scope.document;
    const boundElements = new WeakSet();
    const requestFrame = scope.requestAnimationFrame?.bind(scope)
      || ((callback) => scope.setTimeout(callback, 16));

    function normalizeRenderedHover(element) {
      if (typeof normalizeHoverPopupIndent !== "function") return;
      normalizeHoverPopupIndent(element);
      requestFrame(() => normalizeHoverPopupIndent(element));
    }

    function bind(element) {
      if (!element?.on || boundElements.has(element)) return;

      element.on("plotly_legendclick", (eventData) => {
        const index = eventData.curveNumber;
        const key = chartSession.currentSelected[index];
        if (key) changeSeriesVisibility?.(key, chartSession.hiddenSeries.has(key));
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
        requestChartCompositionUpdate({
          progressiveComposition: true,
          reason: "series-visibility-reset",
        });
        return false;
      });
      element.on("plotly_relayout", (eventData) => {
        // Plotly emits relayout events while react/update applies an app-owned
        // viewport. Treating those as user input can replay an older range.
        if (interactionState.chartSyncing) return;
        const viewport = resolveRelayoutViewport(eventData, element);
        const hasRange = Array.isArray(viewport.range) && viewport.range.length === 2;
        const hasAuto = viewport.autorange;
        const [rangeStart, rangeEnd] = viewport.range || [];
        // Plotly can deliver a completed relayout after a newer app-owned range
        // has already won. Never let that stale event restore the old viewport.
        if (viewport.explicitRange
          && rangeStart != null
          && rangeEnd != null
          && typeof isCurrentRange === "function"
          && !isCurrentRange(element, rangeStart, rangeEnd)) return;
        if (eventData["yaxis.autorange"] === true) {
          interactionState.useViewportEventMarkerGap = false;
        }
        if (interactionState.isHandleDragging) return;
        if (interactionState.cursorSyncing && !hasRange && !hasAuto) return;
        if (hasRange) {
          commitViewportRange(viewport.range, {
            source: "main-plotly-relayout",
            liveFit: chartSession.autoChartReset,
            userInitiated: false,
          });
          return;
        }
        scheduleHandleUpdate(HANDLE_UPDATE_DEBOUNCE_MS);
        if (chartSession.showCoMovement) renderCoMovementPanel({ deferred: true });
      });
      element.on("plotly_beforehover", (eventData) => {
        if (element.classList.contains("is-hover-waiting")) return false;
        return configureExactDateEventHover(element, eventData);
      });
      element.on("plotly_hover", (eventData) => {
        if (element.classList.contains("is-hover-waiting")) return;
        normalizeRenderedHover(element);
        if (!chartSession.hoverShowPopup || interactionState.hoverSyncing) return;
        const xValue = eventData?.points?.[0]?.x;
        if (!xValue) return;
        const macdElement = document.getElementById("chart-macd");
        const adrElement = document.getElementById("chart-adr");
        if (!macdElement?.hidden) syncHoverToChart(macdElement, xValue);
        syncHoverToChart(adrElement, xValue);
      });
      element.on("plotly_unhover", () => {
        if (!chartSession.hoverShowPopup || interactionState.hoverSyncing) return;
        const macdElement = document.getElementById("chart-macd");
        const adrElement = document.getElementById("chart-adr");
        clearHoverOnChart(macdElement);
        clearHoverOnChart(adrElement);
      });
      element.on("plotly_click", (eventData) => {
        if (Date.now() < interactionState.suppressPlotlyClickUntil) return;
        if (handlePriorityChartClick?.(eventData)) return;
        if (isTouchDevice()) return;
        hideDisclosurePopover();
      });
      boundElements.add(element);
    }

    return Object.freeze({ bind });
  }

export { createMainChartEvents };
