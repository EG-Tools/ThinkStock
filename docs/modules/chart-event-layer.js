(function initChartEventLayer(globalScope) {
  "use strict";

  const markerPixelCache = new WeakMap();

  function getMarkerPixelIndex(element, options = {}) {
    if (!element?._fullLayout || !Array.isArray(element.data)) return null;
    const tracePredicate = typeof options.tracePredicate === "function"
      ? options.tracePredicate
      : (trace) => trace?.meta?.isDisclosureTrace;
    const traceEntries = element.data
      .map((trace, traceIndex) => ({ trace, traceIndex }))
      .filter(({ trace }) => tracePredicate(trace) && trace.visible !== "legendonly");
    const xAxis = element._fullLayout.xaxis;
    if (!traceEntries.length || !xAxis || typeof xAxis.d2p !== "function") return null;

    const axisKeyParts = [
      xAxis._offset,
      xAxis._length,
      ...(Array.isArray(xAxis.range) ? xAxis.range : []),
    ];
    traceEntries.forEach(({ trace }) => {
      const yAxis = trace?.yaxis === "y2" ? element._fullLayout.yaxis2 : element._fullLayout.yaxis;
      axisKeyParts.push(
        yAxis?._offset,
        yAxis?._length,
        ...(Array.isArray(yAxis?.range) ? yAxis.range : []),
      );
    });
    const axisKey = axisKeyParts.map((value) => String(value ?? "")).join("|");
    const cacheKey = String(options.cacheKey || "disclosure");
    let cacheByKey = markerPixelCache.get(element);
    const cached = cacheByKey?.get(cacheKey);
    const tracesUnchanged = cached?.traceEntries?.length === traceEntries.length
      && traceEntries.every(({ trace, traceIndex }, index) => (
        cached.traceEntries[index]?.trace === trace
        && cached.traceEntries[index]?.traceIndex === traceIndex
        && cached.traceEntries[index]?.xValues === trace.x
        && cached.traceEntries[index]?.yValues === trace.y
      ));
    if (tracesUnchanged && cached.axisKey === axisKey) {
      return cached;
    }

    const points = [];
    traceEntries.forEach(({ trace, traceIndex }) => {
      const yAxis = trace?.yaxis === "y2" ? element._fullLayout.yaxis2 : element._fullLayout.yaxis;
      if (!yAxis || typeof yAxis.d2p !== "function") return;
      const pointCount = Math.min(Array.isArray(trace.x) ? trace.x.length : 0, Array.isArray(trace.y) ? trace.y.length : 0);
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const x = Number(xAxis._offset || 0) + xAxis.d2p(trace.x[pointIndex]);
        const y = Number(yAxis._offset || 0) + yAxis.d2p(trace.y[pointIndex]);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y, traceIndex, pointIndex });
      }
    });
    points.sort((left, right) => left.x - right.x);
    const index = {
      traceEntries: traceEntries.map(({ trace, traceIndex }) => ({
        trace,
        traceIndex,
        xValues: trace.x,
        yValues: trace.y,
      })),
      axisKey,
      points,
    };
    if (!cacheByKey) {
      cacheByKey = new Map();
      markerPixelCache.set(element, cacheByKey);
    }
    cacheByKey.set(cacheKey, index);
    return index;
  }

  function findMarkerAtClientPoint(element, clientX, clientY, options = {}) {
    const markerIndex = getMarkerPixelIndex(element, options);
    if (!markerIndex) return null;
    const rect = options.geometry?.rect || element.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const hitRadius = options.isTouch ? options.touchRadius : options.mouseRadius;
    if (!Number.isFinite(hitRadius) || hitRadius <= 0) return null;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let low = 0;
    let high = markerIndex.points.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (markerIndex.points[middle].x < localX - hitRadius) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < markerIndex.points.length; index += 1) {
      const point = markerIndex.points[index];
      if (point.x > localX + hitRadius) break;
      if (Math.abs(point.y - localY) > hitRadius) continue;
      const distance = Math.hypot(localX - point.x, localY - point.y);
      if (distance <= hitRadius && distance < bestDistance) {
        bestDistance = distance;
        best = { traceIndex: point.traceIndex, pointIndex: point.pointIndex };
      }
    }
    return best;
  }

  function invalidateMarkerPixels(element) {
    if (element) markerPixelCache.delete(element);
  }

  function buildPointIndex(seriesModels, tickers, toMilliseconds = Date.parse) {
    const index = {};
    const modelBySeries = new Map((seriesModels || []).map((model) => [model.series, model]));
    (tickers || []).forEach((ticker) => {
      const model = modelBySeries.get(ticker);
      if (!model) return;
      const pointCount = Math.min(model.xValues?.length || 0, model.values?.length || 0);
      index[ticker] = Array.from({ length: pointCount }, (_, pointIndex) => {
        const date = String(model.xValues[pointIndex] || "").slice(0, 10);
        const y = model.values[pointIndex];
        const milliseconds = toMilliseconds(date);
        return date && Number.isFinite(y) && Number.isFinite(milliseconds) ? { date, y, milliseconds } : null;
      }).filter(Boolean);
    });
    return index;
  }

  function findPointOnDate(eventDate, ticker, pointIndex) {
    const points = pointIndex?.[ticker];
    if (!points?.length) return null;
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (points[middle].date < eventDate) low = middle + 1;
      else high = middle;
    }
    const point = points[low];
    return point?.date === eventDate ? { date: point.date, y: point.y } : null;
  }

  function markerGap(seriesModels, start, end, options = {}) {
    const ratio = Number(options.ratio);
    const viewportRange = options.viewportRange;
    if (options.useViewport && Array.isArray(viewportRange) && viewportRange.length >= 2) {
      const viewportSpan = Math.abs(Number(viewportRange[1]) - Number(viewportRange[0]));
      if (Number.isFinite(viewportSpan) && viewportSpan > 1e-9) return viewportSpan * ratio;
    }
    const hiddenSeries = options.hiddenSeries instanceof Set ? options.hiddenSeries : new Set(options.hiddenSeries || []);
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    (seriesModels || []).forEach((model) => {
      if (hiddenSeries.has(model.series)) return;
      const count = Math.min(model.xValues?.length || 0, model.values?.length || 0);
      for (let index = 0; index < count; index += 1) {
        const date = String(model.xValues[index] || "").slice(0, 10);
        const value = model.values[index];
        if (date < start || date > end || !Number.isFinite(value)) continue;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return 1;
    const span = maximum - minimum;
    return span > 1e-9 ? span * ratio : Math.max(Math.abs(maximum) * 0.006, 0.6);
  }

  globalScope.ThinkStockChartEventLayer = Object.freeze({
    getMarkerPixelIndex,
    findMarkerAtClientPoint,
    invalidateMarkerPixels,
    buildPointIndex,
    findPointOnDate,
    markerGap,
  });
}(typeof self !== "undefined" ? self : globalThis));
