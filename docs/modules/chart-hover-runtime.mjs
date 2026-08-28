"use strict";

  // Match Plotly's price-only unified popup so every popup keeps one visual rhythm.
  const HOVER_CONTENT_INDENT_PX = 38;
  const HOVER_DATE_TEXT_PATTERN = /^\d{4}\.\d{1,2}\.\d{1,2}$/;

  function hoverTextStartX(line) {
    try {
      if (typeof line?.getStartPositionOfChar === "function"
        && typeof line?.getScreenCTM === "function"
        && String(line.textContent || "").length) {
        const point = line.getStartPositionOfChar(0);
        const matrix = line.getScreenCTM();
        if (point && matrix) {
          const screenPoint = typeof point.matrixTransform === "function"
            ? point.matrixTransform(matrix)
            : { x: (Number(point.x) * Number(matrix.a || 1)) + Number(matrix.e || 0) };
          if (Number.isFinite(Number(screenPoint?.x))) return Number(screenPoint.x);
        }
      }
    } catch (_) {
      // Detached hover nodes can disappear while Plotly replaces the popup.
    }
    return Number(line?.getBoundingClientRect?.().left);
  }

  function createChartHoverRuntime(scope = globalThis, options = {}) {
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

    function normalizeHoverPopupIndent(targetEl) {
      const hoverLayer = targetEl?.querySelector?.(".hoverlayer");
      if (!hoverLayer?.querySelectorAll) return false;
      const pointLines = [...hoverLayer.querySelectorAll("text.nums > tspan.line")];
      const pointDate = pointLines.find((line) => (
        HOVER_DATE_TEXT_PATTERN.test(String(line.textContent || "").trim())
      ));
      const unifiedDate = [...hoverLayer.querySelectorAll("text.legendtitletext")].find((line) => (
        HOVER_DATE_TEXT_PATTERN.test(String(line.textContent || "").trim())
      ));
      const dateLine = pointDate || unifiedDate;
      if (!dateLine?.getBoundingClientRect) return false;

      const contentCandidates = pointDate
        ? pointLines
        : [...hoverLayer.querySelectorAll("text.legendtext")];
      const contentLines = contentCandidates.filter((line) => (
        line !== dateLine
        && !dateLine.contains?.(line)
        && String(line.textContent || "").trim()
        && !HOVER_DATE_TEXT_PATTERN.test(String(line.textContent || "").trim())
        && typeof line.getBoundingClientRect === "function"
        && typeof line.setAttribute === "function"
      ));
      if (!contentLines.length) return false;

      contentLines.forEach((line) => {
        if (!line.hasAttribute?.("data-thinkstock-base-x")) {
          line.setAttribute("data-thinkstock-base-x", line.getAttribute?.("x") || "0");
        }
        line.setAttribute("x", line.getAttribute("data-thinkstock-base-x") || "0");
      });
      const dateLeft = hoverTextStartX(dateLine);
      if (!Number.isFinite(dateLeft)) return false;
      const contentLeft = dateLeft + HOVER_CONTENT_INDENT_PX;
      contentLines.forEach((line) => {
        const baseX = Number.parseFloat(line.getAttribute("data-thinkstock-base-x"));
        const lineLeft = hoverTextStartX(line);
        if (!Number.isFinite(baseX) || !Number.isFinite(lineLeft)) return;
        line.setAttribute("x", String(baseX + contentLeft - lineLeft));
      });
      return true;
    }

    function showPointFallback(plotly, targetEl, nearestPoint) {
      if (!nearestPoint) return false;
      const curveNumber = Number(nearestPoint.curveNumber);
      const inputTrace = targetEl.data?.[curveNumber];
      const fullTrace = targetEl._fullData?.[curveNumber];
      const pointTemplate = fullTrace?.meta?.pointHoverTemplate
        || inputTrace?.meta?.pointHoverTemplate;
      const inputTemplate = inputTrace?.hovertemplate;
      const fullTemplate = fullTrace?.hovertemplate;
      if (pointTemplate) {
        if (inputTrace) inputTrace.hovertemplate = pointTemplate;
        if (fullTrace) fullTrace.hovertemplate = pointTemplate;
      }
      try {
        plotly.Fx.unhover?.(targetEl);
        plotly.Fx.hover(targetEl, [nearestPoint], ["xy"]);
        return true;
      } catch (_) {
        return false;
      } finally {
        if (pointTemplate) {
          if (inputTrace) inputTrace.hovertemplate = inputTemplate;
          if (fullTrace) fullTrace.hovertemplate = fullTemplate;
        }
      }
    }

    function syncHoverToChartNow(targetEl, xValue) {
      const plotly = scope.Plotly;
      if (!targetEl || !plotly?.Fx?.hover || xValue == null) return;
      setSyncing(true);
      const nearestPoint = findNearestHoverPoint(targetEl, xValue);
      let usedPointFallback = false;
      try {
        // A native hit on a large EPS point can leave Plotly in single-point hover
        // mode. Clear only that popup so xval can rebuild the shared date header.
        if (targetEl.querySelector?.(".hoverlayer > g.hovertext")) {
          plotly.Fx.unhover?.(targetEl);
        }
        // xval lets Plotly rebuild the complete unified popup. A single point is
        // only a compatibility fallback for chart types that reject xval.
        plotly.Fx.hover(targetEl, [{ xval: xValue }], ["xy"]);
        normalizeHoverPopupIndent(targetEl);
      } catch (_) {
        if (!nearestPoint) {
          requestFrame(() => setSyncing(false));
          return;
        }
        usedPointFallback = showPointFallback(plotly, targetEl, nearestPoint);
      }
      requestFrame(() => {
        const unifiedPopupVisible = Boolean(
          targetEl.querySelector?.(".hoverlayer > g.legend"),
        );
        if (!unifiedPopupVisible && !usedPointFallback && nearestPoint) {
          showPointFallback(plotly, targetEl, nearestPoint);
        }
        normalizeHoverPopupIndent(targetEl);
        setSyncing(false);
      });
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
        if (!pending) return;
        // A point fallback is only a temporary compatibility path. Treating it
        // as a completed popup leaves the first EPS hover in the compact format
        // until the pointer visits another date. Only a unified popup is stable.
        const unifiedPopupVisible = Boolean(
          pending.targetEl.querySelector?.(".hoverlayer > g.legend"),
        );
        if (pending.key === lastHoverSyncKey && unifiedPopupVisible) return;
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
      const hasGroupedHoverTrace = Array.from({ length: traceCount }, (_, curveNumber) => (
        chartEl._fullData?.[curveNumber]?.meta || chartEl.data?.[curveNumber]?.meta
      )).some((meta) => meta?.isGroupedHoverTrace);
      for (let curveNumber = 0; curveNumber < traceCount; curveNumber += 1) {
        const inputTrace = chartEl.data?.[curveNumber];
        const fullTrace = chartEl._fullData?.[curveNumber];
        const meta = fullTrace?.meta || inputTrace?.meta;
        if (!meta?.isDisclosureTrace
          && !meta?.isInsiderTradeTrace
          && !meta?.isCrisisSignalTrace
          && !meta?.isMarketTimingBuyTrace
          && !meta?.isMarketTimingSellTrace) continue;
        if (hasGroupedHoverTrace) {
          // The invisible grouped trace owns the unified popup. Keeping visual
          // glyph traces silent avoids duplicate dates and raw ◆/▲/▼ labels.
          if (inputTrace) inputTrace.hoverinfo = "skip";
          if (fullTrace) fullTrace.hoverinfo = "skip";
          continue;
        }
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
      normalizeHoverPopupIndent,
      syncHoverToChart,
    });
  }

export { createChartHoverRuntime };
