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

  globalScope.ThinkStockChartAdjustments = Object.freeze({
    defaultScale,
    resolveScale,
    transformValues,
    offsetFromDrag,
    scaleFromDrag,
    resetTransforms,
  });
}(typeof self !== "undefined" ? self : globalThis));
