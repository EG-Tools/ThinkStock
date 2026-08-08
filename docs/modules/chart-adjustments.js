(function initChartAdjustments(globalScope) {
  "use strict";

  function defaultScale(seriesKey) {
    return seriesKey === "leading_cycle" ? 20 : 1;
  }

  function resolveScale(scales, seriesKey) {
    return scales?.[seriesKey] != null ? scales[seriesKey] : defaultScale(seriesKey);
  }

  function transformValues(values, scale = 1, offset = 0) {
    if (!Array.isArray(values)) return null;
    return values.map((value) => (
      value !== null && Number.isFinite(value) ? 100 + (value - 100) * scale + offset : null
    ));
  }

  function offsetFromDrag(startOffset, startClientY, clientY, yAxis) {
    const range = yAxis?.range;
    if (!Array.isArray(range) || range.length < 2 || !Number.isFinite(yAxis?._length) || yAxis._length === 0) {
      return startOffset;
    }
    return startOffset - (clientY - startClientY) * (range[1] - range[0]) / yAxis._length;
  }

  function scaleFromDrag(startScale, startClientY, clientY, sensitivity = 150) {
    if (!Number.isFinite(sensitivity) || sensitivity === 0) return startScale;
    return startScale * (1 - (clientY - startClientY) / sensitivity);
  }

  function resetTransforms() {
    return { offsets: {}, scales: {} };
  }

  function fitRangeForTraces(traces, xRange = null, options = {}) {
    const paddingRatio = Number.isFinite(options.paddingRatio) ? options.paddingRatio : 0.08;
    const minimumPadding = Number.isFinite(options.minimumPadding) ? options.minimumPadding : 0.6;
    const parsedRange = Array.isArray(xRange) && xRange.length >= 2
      ? xRange.slice(0, 2).map((value) => Date.parse(value))
      : null;
    const hasRange = parsedRange?.every(Number.isFinite);
    const rangeLow = hasRange ? Math.min(...parsedRange) : Number.NEGATIVE_INFINITY;
    const rangeHigh = hasRange ? Math.max(...parsedRange) : Number.POSITIVE_INFINITY;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;

    (Array.isArray(traces) ? traces : []).forEach((trace) => {
      if (trace?.visible === "legendonly") return;
      const pointCount = Math.min(trace?.x?.length || 0, trace?.y?.length || 0);
      for (let index = 0; index < pointCount; index += 1) {
        const value = trace.y[index];
        if (!Number.isFinite(value)) continue;
        if (hasRange) {
          const timestamp = Date.parse(trace.x[index]);
          if (!Number.isFinite(timestamp) || timestamp < rangeLow || timestamp > rangeHigh) continue;
        }
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
    const span = maximum - minimum;
    const padding = Math.max(
      minimumPadding,
      span > 1e-9 ? span * Math.max(0, paddingRatio) : Math.abs(maximum || 100) * 0.02,
    );
    return [minimum - padding, maximum + padding];
  }

  function expandRangeToContain(currentRange, requiredRange) {
    const current = Array.isArray(currentRange) ? currentRange.slice(0, 2).map(Number) : [];
    const required = Array.isArray(requiredRange) ? requiredRange.slice(0, 2).map(Number) : [];
    if (required.length < 2 || !required.every(Number.isFinite)) return null;
    if (current.length < 2 || !current.every(Number.isFinite)) return required;
    return [
      Math.min(current[0], required[0]),
      Math.max(current[1], required[1]),
    ];
  }

  globalScope.ThinkStockChartAdjustments = Object.freeze({
    defaultScale,
    resolveScale,
    transformValues,
    offsetFromDrag,
    scaleFromDrag,
    resetTransforms,
    fitRangeForTraces,
    expandRangeToContain,
  });
}(typeof self !== "undefined" ? self : globalThis));
