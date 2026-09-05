"use strict";

  const markerPixelCache = new WeakMap();
  const markerNodeCache = new WeakMap();
  const LINE_HIGHLIGHT_EXTRA_WIDTH = 1;
  // Shared by disclosure, insider, timing, EPS, and report point targets.
  function interactiveMarkerHitRadius(isTouch = false) {
    return isTouch ? 36 : 26;
  }

  function interactiveLineWidth(baseWidth = 1, highlighted = false) {
    const normalizedBase = Number(baseWidth);
    const width = Number.isFinite(normalizedBase) && normalizedBase > 0 ? normalizedBase : 1;
    return highlighted ? width + LINE_HIGHLIGHT_EXTRA_WIDTH : width;
  }

  function traceMarkerNodes(element, traceIndex) {
    if (!element || !Number.isInteger(traceIndex) || traceIndex < 0) return [];
    let cache = markerNodeCache.get(element);
    const trace = element.data?.[traceIndex];
    const cached = cache?.get(traceIndex);
    const cachedNodesAreCurrent = cached?.nodes?.length > 0
      && cached.nodes.every((node) => (
        node?.isConnected !== false
        && (typeof element.contains !== "function" || element.contains(node))
      ));
    if (cached?.trace === trace && cachedNodesAreCurrent) return cached.nodes;

    const groups = [...(element.querySelectorAll?.(".scatterlayer .trace.scatter") || [])];
    const uid = String(element._fullData?.[traceIndex]?.uid || trace?.uid || "");
    const group = (uid ? groups.find((node) => node.classList?.contains?.(`trace${uid}`)) : null)
      || groups[traceIndex]
      || null;
    const markerNodes = group ? [...group.querySelectorAll(".points path.point")] : [];
    const nodes = markerNodes.length
      ? markerNodes
      : (group ? [...group.querySelectorAll(".textpoint text")] : []);
    if (!cache) {
      cache = new Map();
      markerNodeCache.set(element, cache);
    }
    cache.set(traceIndex, { trace, nodes });
    return nodes;
  }

  function markerStyleAt(value, pointIndex, fallback = "") {
    if (Array.isArray(value)) return value[pointIndex] ?? fallback;
    return value ?? fallback;
  }

  function setMarkerHighlighted(element, traceIndex, pointIndex, highlighted, options = {}) {
    const trace = element?.data?.[traceIndex];
    const node = traceMarkerNodes(element, traceIndex)[pointIndex];
    if (!trace || !node) return false;
    if (String(trace.mode || "").includes("text")) {
      const baseFill = markerStyleAt(trace.textfont?.color, pointIndex, options.fallbackFill || "");
      const baseSize = Number(markerStyleAt(
        trace.textfont?.size,
        pointIndex,
        options.fallbackSize ?? 13,
      )) || 13;
      const fill = highlighted ? (options.highlightFill ?? baseFill) : baseFill;
      const requestedHighlightSize = Number(options.highlightSize);
      const highlightSizeDelta = Number(options.highlightSizeDelta);
      const size = highlighted
        ? (Number.isFinite(requestedHighlightSize) && requestedHighlightSize > 0
          ? requestedHighlightSize
          : baseSize + (Number.isFinite(highlightSizeDelta) ? highlightSizeDelta : 0))
        : baseSize;
      node.style.fill = String(fill);
      node.style.fontSize = `${size}px`;
      node.setAttribute?.("fill", String(fill));
      node.setAttribute?.("font-size", String(size));
      node.classList?.toggle?.("is-marker-highlighted", Boolean(highlighted));
      return true;
    }
    const baseFill = markerStyleAt(trace.marker?.color, pointIndex, options.fallbackFill || "");
    const baseStroke = markerStyleAt(trace.marker?.line?.color, pointIndex, options.fallbackStroke || "none");
    const baseStrokeWidth = markerStyleAt(trace.marker?.line?.width, pointIndex, options.fallbackStrokeWidth ?? 0);
    const fill = highlighted ? (options.highlightFill ?? baseFill) : baseFill;
    const stroke = highlighted ? (options.highlightStroke ?? baseStroke) : baseStroke;
    const strokeWidth = highlighted
      ? (options.highlightStrokeWidth ?? baseStrokeWidth)
      : baseStrokeWidth;
    node.style.fill = String(fill);
    node.style.stroke = String(stroke);
    node.style.strokeWidth = `${Number(strokeWidth) || 0}px`;
    node.setAttribute?.("fill", String(fill));
    node.setAttribute?.("stroke", String(stroke));
    node.setAttribute?.("stroke-width", String(Number(strokeWidth) || 0));
    node.classList?.toggle?.("is-marker-highlighted", Boolean(highlighted));
    return true;
  }

  function getMarkerPixelIndex(element, options = {}) {
    if (!element?._fullLayout || !Array.isArray(element.data)) return null;
    const tracePredicate = typeof options.tracePredicate === "function"
      ? options.tracePredicate
      : (trace) => trace?.meta?.overlayKind === "disclosure";
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
    const requestedRadius = options.isTouch ? options.touchRadius : options.mouseRadius;
    const hitRadius = Number.isFinite(Number(requestedRadius))
      ? Number(requestedRadius)
      : interactiveMarkerHitRadius(options.isTouch);
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

  function isPlotlyPointAtClientPoint(element, point, sourceEvent, options = {}) {
    const clientX = Number(sourceEvent?.clientX);
    const clientY = Number(sourceEvent?.clientY);
    const xAxis = point?.xaxis;
    const yAxis = point?.yaxis;
    if (!element || !Number.isFinite(clientX) || !Number.isFinite(clientY)
      || typeof xAxis?.d2p !== "function" || typeof yAxis?.d2p !== "function") return false;
    const rect = options.geometry?.rect || element.getBoundingClientRect();
    const markerX = Number(xAxis._offset || 0) + xAxis.d2p(point.x);
    const markerY = Number(yAxis._offset || 0) + yAxis.d2p(point.y);
    const requestedRadius = Number(options.radius);
    const radius = Number.isFinite(requestedRadius) && requestedRadius > 0
      ? requestedRadius
      : interactiveMarkerHitRadius(options.isTouch);
    return Math.hypot(
      clientX - rect.left - markerX,
      clientY - rect.top - markerY,
    ) <= radius;
  }

  function invalidateMarkerPixels(element) {
    if (element) {
      markerPixelCache.delete(element);
      markerNodeCache.delete(element);
    }
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
        const baseY = Number(model.baseValues?.[pointIndex]);
        const milliseconds = toMilliseconds(date);
        return date && Number.isFinite(y) && Number.isFinite(milliseconds)
          ? { date, y, baseY: Number.isFinite(baseY) ? baseY : y, milliseconds }
          : null;
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
    return point?.date === eventDate
      ? {
        date: point.date,
        y: point.y,
        ...(Number.isFinite(point.baseY) ? { baseY: point.baseY } : {}),
      }
      : null;
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

export {
  interactiveLineWidth,
  interactiveMarkerHitRadius,
  getMarkerPixelIndex,
  findMarkerAtClientPoint,
  isPlotlyPointAtClientPoint,
  invalidateMarkerPixels,
  setMarkerHighlighted,
  traceMarkerNodes,
  buildPointIndex,
  findPointOnDate,
  markerGap,
};
