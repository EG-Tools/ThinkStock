"use strict";

const EVENT_MARKER_TARGET = "event-marker";
const AI_REPORT_TARGET = "ai-report";
const LINE_TARGET = "line";
const MOUSE_PRESS_MOVEMENT_PX = 8;
const TOUCH_PRESS_MOVEMENT_PX = 14;

function chartPressMovementPx(isTouch = false) {
  return isTouch ? TOUCH_PRESS_MOVEMENT_PX : MOUSE_PRESS_MOVEMENT_PX;
}

function createChartTargetRuntime(options = {}) {
  let lineHitIndexCache = new WeakMap();
  let aiReportLineHitIndexCache = new WeakMap();

  function isMainChart(element) {
    return Boolean(
      element
      && element === options.getMainElement?.()
      && element._fullLayout
      && Array.isArray(element.data),
    );
  }

  function chartPoint(element, clientX, clientY, geometry) {
    const xAxis = geometry?.xa || element?._fullLayout?.xaxis;
    const yAxis = geometry?.ya || element?._fullLayout?.yaxis;
    if (!xAxis || !yAxis) return null;
    const rect = geometry?.rect || element.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < xAxis._offset || localX > xAxis._offset + xAxis._length
      || localY < yAxis._offset || localY > yAxis._offset + yAxis._length) return null;
    const xValue = options.axisPixelToXValue?.(element, clientX, false, geometry);
    const targetMs = options.toMilliseconds?.(xValue);
    return Number.isFinite(targetMs) ? { localX, localY, targetMs, xAxis, yAxis } : null;
  }

  function findNearestLineDragTarget(element, clientX, clientY, isTouch = false, geometry = null) {
    if (!isMainChart(element)) return null;
    const point = chartPoint(element, clientX, clientY, geometry);
    if (!point) return null;
    const seriesKeys = options.adjustableSeriesKeys?.(
      element.data,
      options.getBaseTraceValues?.(),
    ) || [];
    let index = lineHitIndexCache.get(element);
    if (!options.lineHitIndexMatches?.(index, element.data, seriesKeys)) {
      index = options.buildLineHitIndex?.(element.data, seriesKeys) || [];
      lineHitIndexCache.set(element, index);
    }
    const epsPoint = options.findNearestMarkerTarget?.(
      index,
      point.localX,
      point.localY,
      point.xAxis,
      point.yAxis,
      options.interactiveMarkerHitRadius?.(isTouch),
      (entry, pointIndex) => Number(entry.trace.marker?.size?.[pointIndex]) > 0,
      (entry) => entry.trace?.meta?.isEpsTrace,
      point.targetMs,
    );
    if (epsPoint) return epsPoint;
    const tolerance = isTouch
      ? Number(options.lineTouchTolerancePx) || 24
      : Number(options.lineTolerancePx) || 14;
    return options.findNearestLineTarget?.(
      index,
      point.targetMs,
      point.localY,
      point.yAxis,
      tolerance,
    ) || null;
  }

  function findAiForecastReportAtClientPoint(
    element,
    clientX,
    clientY,
    isTouch = false,
    geometry = null,
  ) {
    if (!isMainChart(element) || typeof options.isAiReportTrace !== "function") return null;
    const point = chartPoint(element, clientX, clientY, geometry);
    if (!point) return null;
    const markerTarget = options.findMarkerAtClientPoint?.(element, clientX, clientY, {
      geometry,
      cacheKey: "ai-report-markers",
      tracePredicate: (trace) => trace?.meta?.isAiReportMarkerTrace,
      isTouch,
    });
    if (markerTarget) return markerTarget;
    const traceKeys = element.data.map((trace, traceIndex) => (
      options.isAiReportTrace(trace) && trace?.meta?.representativeReport
        ? `ai-report:${traceIndex}`
        : ""
    ));
    let index = aiReportLineHitIndexCache.get(element);
    if (!options.lineHitIndexMatches?.(index, element.data, traceKeys)) {
      index = options.buildLineHitIndex?.(element.data, traceKeys) || [];
      aiReportLineHitIndexCache.set(element, index);
    }
    const tolerance = isTouch
      ? Number(options.aiReportTouchTolerancePx) || 20
      : Number(options.aiReportTolerancePx) || 10;
    const target = options.findNearestLineTarget?.(
      index,
      point.targetMs,
      point.localY,
      point.yAxis,
      tolerance,
    );
    return target ? { traceIndex: target.traceIndex } : null;
  }

  function isInteractiveEventMarkerTrace(trace) {
    return Boolean(options.isInteractiveEventMarkerTrace?.(trace));
  }

  function findEventMarkerAtClientPoint(element, clientX, clientY, isTouch = false, geometry = null) {
    return options.findMarkerAtClientPoint?.(element, clientX, clientY, {
      geometry,
      cacheKey: "interactive-markers",
      tracePredicate: isInteractiveEventMarkerTrace,
      isTouch,
    }) || null;
  }

  function eventMarkerPoint(element, hit) {
    const trace = element?.data?.[hit?.traceIndex];
    if (!trace) return null;
    const pointIndex = hit?.pointIndex;
    return {
      curveNumber: hit?.traceIndex,
      pointIndex,
      pointNumber: pointIndex,
      data: trace,
      x: trace?.x?.[pointIndex],
      y: trace?.y?.[pointIndex],
      customdata: trace?.customdata?.[pointIndex],
      xaxis: element?._fullLayout?.xaxis,
      yaxis: trace?.yaxis === "y2" ? element?._fullLayout?.yaxis2 : element?._fullLayout?.yaxis,
    };
  }

  function openAiForecastReportHit(element, hit, sourceEvent) {
    const trace = element?.data?.[hit?.traceIndex];
    if (!trace) return false;
    return Boolean(options.openAiForecastReport?.({
      event: sourceEvent,
      points: [{ curveNumber: hit.traceIndex, data: trace }],
    }));
  }

  function openEventMarkerHit(element, hit, sourceEvent) {
    const group = options.buildEventMarkerPopoverGroup?.(eventMarkerPoint(element, hit));
    return group ? Boolean(options.showEventMarkerPopover?.(group, sourceEvent)) : false;
  }

  function invalidate(element = null, invalidateOptions = {}) {
    if (element) {
      if (invalidateOptions.lines !== false) lineHitIndexCache.delete(element);
      if (invalidateOptions.reports !== false) aiReportLineHitIndexCache.delete(element);
      if (invalidateOptions.markers !== false) options.invalidateMarkerPixels?.(element);
      return;
    }
    if (invalidateOptions.lines !== false) lineHitIndexCache = new WeakMap();
    if (invalidateOptions.reports !== false) aiReportLineHitIndexCache = new WeakMap();
  }

  return Object.freeze({
    findAiForecastReportAtClientPoint,
    findEventMarkerAtClientPoint,
    findNearestLineDragTarget,
    invalidate,
    isInteractiveEventMarkerTrace,
    openAiForecastReportHit,
    openEventMarkerHit,
  });
}

function findPriorityChartTarget(element, clientX, clientY, isTouch, geometry, options = {}) {
  const markerHit = options.findEventMarkerAtClientPoint?.(
    element,
    clientX,
    clientY,
    isTouch,
    geometry,
  );
  if (markerHit) return { kind: EVENT_MARKER_TARGET, ...markerHit };
  const reportHit = options.findAiForecastReportAtClientPoint?.(
    element,
    clientX,
    clientY,
    isTouch,
    geometry,
  );
  return reportHit ? { kind: AI_REPORT_TARGET, ...reportHit } : null;
}

function findChartInteractionTarget(element, clientX, clientY, isTouch, geometry, options = {}) {
  const priorityTarget = findPriorityChartTarget(
    element,
    clientX,
    clientY,
    isTouch,
    geometry,
    options,
  );
  if (priorityTarget) return priorityTarget;
  const lineHit = options.findNearestLineDragTarget?.(
    element,
    clientX,
    clientY,
    isTouch,
    geometry,
  );
  return lineHit ? { kind: LINE_TARGET, ...lineHit } : null;
}

function samePriorityChartTarget(left, right) {
  if (!left || !right || left.kind !== right.kind || left.traceIndex !== right.traceIndex) return false;
  return left.kind !== EVENT_MARKER_TARGET || left.pointIndex === right.pointIndex;
}

function createPriorityChartPress(target, event, now = Date.now()) {
  if (!target || !event) return null;
  return {
    target,
    at: Number(now) || Date.now(),
    clientX: Number(event.clientX),
    clientY: Number(event.clientY),
  };
}

function isPriorityChartPressValid(press, target, event, options = {}) {
  if (!press || !target || !event || !samePriorityChartTarget(press.target, target)) return false;
  const ageMs = Math.max(0, Number(options.ageMs) || 800);
  const movementPx = Math.max(0, Number(options.movementPx) || chartPressMovementPx(false));
  const now = Number(options.now) || Date.now();
  return now - press.at <= ageMs
    && Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) <= movementPx;
}

function openPriorityChartTarget(element, target, sourceEvent, options = {}) {
  if (!target) return false;
  if (target.kind === EVENT_MARKER_TARGET) {
    return Boolean(options.openEventMarkerHit?.(element, target, sourceEvent));
  }
  if (target.kind === AI_REPORT_TARGET) {
    return Boolean(options.openAiForecastReportHit?.(element, target, sourceEvent));
  }
  return false;
}

export {
  AI_REPORT_TARGET,
  EVENT_MARKER_TARGET,
  LINE_TARGET,
  chartPressMovementPx,
  createChartTargetRuntime,
  createPriorityChartPress,
  findChartInteractionTarget,
  findPriorityChartTarget,
  isPriorityChartPressValid,
  openPriorityChartTarget,
  samePriorityChartTarget,
};
