"use strict";

import { chartMarkerRuntime as markerRuntime } from "./chart-marker-runtime.mjs";
import { chartTraceOverlayKind } from "./chart-render-contract.mjs";

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

  function roundedRectPath(x, y, width, height) {
    const radius = Math.min(4, width / 2, height / 2);
    const right = x + width;
    const bottom = y + height;
    return [
      `M ${x + radius} ${y}`,
      `H ${right - radius}`,
      `Q ${right} ${y} ${right} ${y + radius}`,
      `V ${bottom - radius}`,
      `Q ${right} ${bottom} ${right - radius} ${bottom}`,
      `H ${x + radius}`,
      `Q ${x} ${bottom} ${x} ${bottom - radius}`,
      `V ${y + radius}`,
      `Q ${x} ${y} ${x + radius} ${y}`,
      "Z",
    ].join(" ");
  }

  function restoreHoverGroupTransform(group) {
    const currentTransform = group?.getAttribute?.("transform") || "";
    const previousNormalizedTransform = group?.getAttribute?.(
      "data-thinkstock-normalized-transform",
    );
    if (group && (!group.hasAttribute?.("data-thinkstock-base-transform")
      || (previousNormalizedTransform && currentTransform !== previousNormalizedTransform))) {
      group.setAttribute("data-thinkstock-base-transform", currentTransform);
    }
    const baseTransform = group?.getAttribute?.("data-thinkstock-base-transform") || "";
    if (group) group.setAttribute("transform", baseTransform);
    return { baseTransform, currentTransform };
  }

  function shiftHoverGroup(group, transformState, shiftX = 0, shiftY = 0) {
    if (!group) return false;
    const { baseTransform, currentTransform } = transformState;
    const translate = String(baseTransform).match(
      /^translate\(\s*(-?[\d.]+)(?:[ ,]+)(-?[\d.]+)\s*\)$/,
    );
    if ((shiftX || shiftY) && translate) {
      const nextTransform = `translate(${Number(translate[1]) + shiftX},${Number(translate[2]) + shiftY})`;
      group.setAttribute("transform", nextTransform);
      group.setAttribute("data-thinkstock-normalized-transform", nextTransform);
      return true;
    }
    group.setAttribute("data-thinkstock-normalized-transform", baseTransform || currentTransform);
    return false;
  }

  function normalizePointHoverFrame(targetEl, hoverLayer, anchorLocalY) {
    const paths = [...(hoverLayer?.querySelectorAll?.("g.hovertext > path") || [])];
    paths.forEach((path) => {
      if (typeof path.getBBox !== "function") return;
      try {
        const group = path.parentElement;
        const transformState = restoreHoverGroupTransform(group);

        const text = group?.querySelector?.("text.nums");
        const measured = typeof text?.getBBox === "function" ? text.getBBox() : path.getBBox();
        const paddingX = text ? 8 : 0;
        const paddingY = text ? 3 : 0;
        const x = Number(measured?.x) - paddingX;
        const y = Number(measured?.y) - paddingY;
        const width = Number(measured?.width) + (paddingX * 2);
        const height = Number(measured?.height) + (paddingY * 2);
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
        path.setAttribute("d", roundedRectPath(x, y, width, height));
        path.setAttribute("data-thinkstock-flat-frame", "1");

        const frameRect = path.getBoundingClientRect?.();
        const chartRect = targetEl?.getBoundingClientRect?.();
        const xAxis = targetEl?._fullLayout?.xaxis;
        const yAxis = targetEl?._fullLayout?.yaxis;
        if (!group || !frameRect || !chartRect) return;
        const leftLimit = chartRect.left + Number(xAxis?._offset || 0) + 4;
        const rightLimit = leftLimit + Number(xAxis?._length || chartRect.width) - 8;
        const topLimit = chartRect.top + Number(yAxis?._offset || 0) + 4;
        const bottomLimit = topLimit + Number(yAxis?._length || chartRect.height) - 8;
        let shiftX = 0;
        let shiftY = Number.isFinite(anchorLocalY)
          ? chartRect.top + anchorLocalY - frameRect.top
          : 0;
        group.removeAttribute?.("data-thinkstock-anchor-local-y");
        if (Number.isFinite(anchorLocalY)) {
          group.setAttribute("data-thinkstock-anchor-local-y", String(anchorLocalY));
        }
        if (frameRect.left < leftLimit) shiftX = leftLimit - frameRect.left;
        else if (frameRect.right > rightLimit) shiftX = rightLimit - frameRect.right;
        if (frameRect.top + shiftY < topLimit) shiftY += topLimit - frameRect.top - shiftY;
        else if (frameRect.bottom + shiftY > bottomLimit) {
          shiftY += bottomLimit - frameRect.bottom - shiftY;
        }
        shiftHoverGroup(group, transformState, shiftX, shiftY);
      } catch (_) {
        // Plotly may replace the transient point popup during the same frame.
      }
    });
  }

  function normalizeUnifiedHoverFrame(targetEl, hoverLayer, anchorLocalY) {
    const group = hoverLayer?.querySelector?.("g.legend");
    if (!group) return false;
    const transformState = restoreHoverGroupTransform(group);
    group.removeAttribute?.("data-thinkstock-anchor-local-y");
    if (!Number.isFinite(anchorLocalY)) {
      shiftHoverGroup(group, transformState);
      return false;
    }
    const frameRect = group.getBoundingClientRect?.();
    const chartRect = targetEl?.getBoundingClientRect?.();
    const yAxis = targetEl?._fullLayout?.yaxis;
    if (!frameRect || !chartRect || !yAxis) return false;
    const topLimit = chartRect.top + Number(yAxis._offset || 0) + 4;
    const bottomLimit = topLimit + Number(yAxis._length || chartRect.height) - 8;
    const latestTop = Math.max(topLimit, bottomLimit - Number(frameRect.height || 0));
    const targetTop = Math.max(topLimit, Math.min(chartRect.top + anchorLocalY, latestTop));
    group.setAttribute("data-thinkstock-anchor-local-y", String(anchorLocalY));
    return shiftHoverGroup(group, transformState, 0, targetTop - frameRect.top);
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
    const hoverPopupStamps = new WeakMap();
    const hoverPopupAnchors = new WeakMap();

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
        const currentX = line.getAttribute?.("x") || "0";
        const normalizedX = line.getAttribute?.("data-thinkstock-normalized-x");
        if (!line.hasAttribute?.("data-thinkstock-base-x")
          || (normalizedX != null && currentX !== normalizedX)) {
          line.setAttribute("data-thinkstock-base-x", currentX);
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
        const normalizedX = String(baseX + contentLeft - lineLeft);
        line.setAttribute("x", normalizedX);
        line.setAttribute("data-thinkstock-normalized-x", normalizedX);
      });
      const anchorLocalY = hoverPopupAnchors.get(targetEl);
      normalizeUnifiedHoverFrame(targetEl, hoverLayer, anchorLocalY);
      normalizePointHoverFrame(targetEl, hoverLayer, anchorLocalY);
      return true;
    }

    function setHoverPopupAnchor(targetEl, localY) {
      if (!targetEl) return;
      if (Number.isFinite(localY)) hoverPopupAnchors.set(targetEl, Number(localY));
      else hoverPopupAnchors.delete(targetEl);
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

    function groupedHoverRevision(targetEl) {
      return (targetEl?.data || []).flatMap((trace) => {
        if (chartTraceOverlayKind(trace) !== "grouped-hover" || trace.visible === "legendonly") return [];
        const x = Array.isArray(trace.x) ? trace.x : [];
        return [[
          trace.meta.renderFingerprint || "",
          trace.meta.hoverGroupTicker || "",
          x.length,
          x[0] || "",
          x[x.length - 1] || "",
        ].join(":")];
      }).join("|");
    }

    function groupedDetailPointAtX(targetEl, xValue) {
      const targetDate = String(xValue || "").slice(0, 10);
      if (!targetDate) return null;
      const curveNumber = (targetEl?.data || []).findIndex((trace) => (
        trace?.meta?.isGroupedHoverOwnerTrace
      ));
      if (curveNumber < 0) return null;
      const trace = targetEl.data[curveNumber];
      const pointNumber = (trace.x || []).findIndex((date) => (
        String(date || "").slice(0, 10) === targetDate
      ));
      if (pointNumber < 0 || !trace.meta?.hoverGroupHasDetails?.[pointNumber]) return null;
      return { curveNumber, pointIndex: pointNumber, pointNumber };
    }

    function expectedHoverPopup(targetEl, expectsDetailPoint) {
      return targetEl?.querySelector?.(
        expectsDetailPoint ? ".hoverlayer > g.hovertext" : ".hoverlayer > g.legend",
      ) || null;
    }

    function hoverPopupContent(popup) {
      const pointText = popup?.querySelector?.("text.nums");
      if (pointText) {
        return String(pointText.getAttribute?.("data-unformatted") || pointText.textContent || "");
      }
      return [...(popup?.querySelectorAll?.("text.legendtitletext, text.legendtext") || [])]
        .map((node) => String(node.textContent || ""))
        .join("\n");
    }

    function stampHoverPopup(targetEl, key, expectsDetailPoint) {
      const popup = expectedHoverPopup(targetEl, expectsDetailPoint);
      if (!popup || (typeof popup !== "object" && typeof popup !== "function")) return false;
      hoverPopupStamps.set(popup, { key, content: hoverPopupContent(popup) });
      return true;
    }

    function hoverPopupMatches(targetEl, key, expectsDetailPoint) {
      const popup = expectedHoverPopup(targetEl, expectsDetailPoint);
      const stamp = popup && hoverPopupStamps.get(popup);
      return Boolean(stamp)
        && stamp.key === key
        && stamp.content === hoverPopupContent(popup);
    }

    function syncHoverToChartNow(targetEl, xValue, syncKey, preferredTraceIndex = null) {
      const plotly = scope.Plotly;
      if (!targetEl || !plotly?.Fx?.hover || xValue == null) return;
      setSyncing(true);
      const nearestPoint = findNearestHoverPoint(targetEl, xValue, preferredTraceIndex);
      const preferredTrace = Number.isInteger(preferredTraceIndex)
        ? targetEl.data?.[preferredTraceIndex]
        : null;
      const preferredScenarioPoint = preferredTrace?.meta?.overlayKind === "ai-scenario"
        ? nearestPoint
        : null;
      const groupedDetailPoint = groupedDetailPointAtX(targetEl, xValue);
      const expectsDetailPoint = Boolean(preferredScenarioPoint || groupedDetailPoint);
      let usedPointFallback = false;
      try {
        // A native hit on a large EPS point can leave Plotly in single-point hover
        // mode. Clear only that popup so xval can rebuild the shared date header.
        if (targetEl.querySelector?.(".hoverlayer > g.hovertext")) {
          plotly.Fx.unhover?.(targetEl);
        }
        // Exact marker dates already exist in the grouped owner. Addressing that
        // point directly avoids Plotly snapping EPS or event details to a nearby
        // daily price while preserving unified-x hover for ordinary prices.
        const directPoint = preferredScenarioPoint || groupedDetailPoint;
        usedPointFallback = directPoint
          ? showPointFallback(plotly, targetEl, directPoint)
          : false;
        if (!usedPointFallback) plotly.Fx.hover(targetEl, [{ xval: xValue }], ["xy"]);
        normalizeHoverPopupIndent(targetEl);
        stampHoverPopup(targetEl, syncKey, expectsDetailPoint);
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
        const pointPopupVisible = Boolean(
          targetEl.querySelector?.(".hoverlayer > g.hovertext"),
        );
        if (!unifiedPopupVisible && !pointPopupVisible && !usedPointFallback && nearestPoint) {
          showPointFallback(plotly, targetEl, nearestPoint);
        }
        normalizeHoverPopupIndent(targetEl);
        stampHoverPopup(targetEl, syncKey, expectsDetailPoint);
        setSyncing(false);
      });
    }

    function syncHoverToChart(targetEl, xValue, preferredTraceIndex = null) {
      if (!targetEl || xValue == null) return;
      const key = [
        targetEl.id || "chart",
        String(xValue),
        Number.isInteger(preferredTraceIndex) ? preferredTraceIndex : "unified",
        groupedHoverRevision(targetEl),
      ].join("|");
      pendingHoverSync = { targetEl, xValue, key, preferredTraceIndex };
      if (hoverSyncFrame) return;
      hoverSyncFrame = requestFrame(() => {
        const pending = pendingHoverSync;
        pendingHoverSync = null;
        hoverSyncFrame = 0;
        if (!pending) return;
        const expectsDetailPoint = Boolean(
          Number.isInteger(pending.preferredTraceIndex)
          || groupedDetailPointAtX(pending.targetEl, pending.xValue),
        );
        if (pending.key === lastHoverSyncKey
          && hoverPopupMatches(pending.targetEl, pending.key, expectsDetailPoint)) return;
        lastHoverSyncKey = pending.key;
        syncHoverToChartNow(
          pending.targetEl,
          pending.xValue,
          pending.key,
          pending.preferredTraceIndex,
        );
      });
    }

    function nearestMainLineDate(chartEl, xValue) {
      const targetMs = toMsSafe(xValue);
      if (!Number.isFinite(targetMs)) return "";
      let nearestDate = "";
      let nearestDistance = Number.POSITIVE_INFINITY;
      (chartEl?.data || []).forEach((trace) => {
        const kind = chartTraceOverlayKind(trace);
        if (!trace?.meta?.seriesKey
          || (kind !== "price" && kind !== "eps")
          || trace.visible === "legendonly") return;
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
      )).some((meta) => meta?.overlayKind === "grouped-hover");
      for (let curveNumber = 0; curveNumber < traceCount; curveNumber += 1) {
        const inputTrace = chartEl.data?.[curveNumber];
        const fullTrace = chartEl._fullData?.[curveNumber];
        const meta = fullTrace?.meta || inputTrace?.meta;
        if (!markerRuntime.isEventMarkerTrace(inputTrace || fullTrace)) continue;
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
      hoverPopupAnchors.delete(targetEl);
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
      setHoverPopupAnchor,
      syncHoverToChart,
    });
  }

export { createChartHoverRuntime };
