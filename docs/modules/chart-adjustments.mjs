"use strict";

  const timestampCache = new WeakMap();
  const finiteRangeCache = new WeakMap();
  const RANGE_BLOCK_SIZE = 64;

  function timestampIndex(values) {
    if (!Array.isArray(values)) return null;
    const cached = timestampCache.get(values);
    const first = values[0];
    const last = values[values.length - 1];
    if (cached
      && cached.length === values.length
      && cached.first === first
      && cached.last === last) return cached;

    const timestamps = new Float64Array(values.length);
    let sorted = true;
    let previous = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < values.length; index += 1) {
      const timestamp = Date.parse(values[index]);
      timestamps[index] = timestamp;
      if (!Number.isFinite(timestamp) || timestamp < previous) sorted = false;
      if (Number.isFinite(timestamp)) previous = timestamp;
    }
    const result = { first, last, length: values.length, sorted, timestamps };
    timestampCache.set(values, result);
    return result;
  }

  function lowerBound(values, target, length) {
    let low = 0;
    let high = length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBound(values, target, length) {
    let low = 0;
    let high = length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle] <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function defaultScale(seriesKey) {
    return seriesKey === "leading_cycle" ? 20 : 1;
  }

  function resolveScale(scales, seriesKey) {
    return scales?.[seriesKey] != null ? scales[seriesKey] : defaultScale(seriesKey);
  }

  function transformValues(values, scale = 1, offset = 0) {
    if (!Array.isArray(values)) return null;
    return transformValuesInto(values, scale, offset, new Array(values.length));
  }

  function transformValuesInto(values, scale = 1, offset = 0, output = null) {
    if (!Array.isArray(values)) return null;
    const target = Array.isArray(output) && output.length === values.length
      ? output
      : new Array(values.length);
    finiteRangeCache.delete(target);
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      target[index] = value !== null && Number.isFinite(value)
        ? 100 + (value - 100) * scale + offset
        : null;
    }
    return target;
  }

  function invertTransformValues(values, scale = 1, offset = 0) {
    if (!Array.isArray(values)) return null;
    const normalizedScale = Number(scale);
    if (!Number.isFinite(normalizedScale) || Math.abs(normalizedScale) < 1e-9) return [...values];
    return transformValues(values, 1 / normalizedScale, -(Number(offset) || 0) / normalizedScale);
  }

  function finiteRangeIndex(values) {
    if (!Array.isArray(values)) return null;
    const cached = finiteRangeCache.get(values);
    if (cached?.length === values.length) return cached;
    const blockCount = Math.ceil(values.length / RANGE_BLOCK_SIZE);
    const minimums = new Float64Array(blockCount);
    const maximums = new Float64Array(blockCount);
    const counts = new Uint32Array(blockCount);
    minimums.fill(Number.POSITIVE_INFINITY);
    maximums.fill(Number.NEGATIVE_INFINITY);
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (value === null || !Number.isFinite(value)) continue;
      const block = Math.floor(index / RANGE_BLOCK_SIZE);
      if (value < minimums[block]) minimums[block] = value;
      if (value > maximums[block]) maximums[block] = value;
      counts[block] += 1;
    }
    const result = { length: values.length, minimums, maximums, counts };
    finiteRangeCache.set(values, result);
    return result;
  }

  function finiteRangeBetween(values, startIndex, endIndex) {
    const start = Math.max(0, Math.min(values.length, Number(startIndex) || 0));
    const end = Math.max(start, Math.min(values.length, Number(endIndex) || 0));
    if (end <= start) return null;
    const index = finiteRangeIndex(values);
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    let count = 0;
    let cursor = start;
    while (cursor < end && cursor % RANGE_BLOCK_SIZE !== 0) {
      const value = values[cursor];
      if (value !== null && Number.isFinite(value)) {
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
        count += 1;
      }
      cursor += 1;
    }
    while (cursor + RANGE_BLOCK_SIZE <= end) {
      const block = Math.floor(cursor / RANGE_BLOCK_SIZE);
      minimum = Math.min(minimum, index.minimums[block]);
      maximum = Math.max(maximum, index.maximums[block]);
      count += index.counts[block];
      cursor += RANGE_BLOCK_SIZE;
    }
    while (cursor < end) {
      const value = values[cursor];
      if (value !== null && Number.isFinite(value)) {
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
        count += 1;
      }
      cursor += 1;
    }
    return Number.isFinite(minimum) && Number.isFinite(maximum)
      ? { minimum, maximum, count }
      : null;
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
      const dates = hasRange ? timestampIndex(trace?.x) : null;
      const startIndex = dates?.sorted ? lowerBound(dates.timestamps, rangeLow, pointCount) : 0;
      const endIndex = dates?.sorted ? upperBound(dates.timestamps, rangeHigh, pointCount) : pointCount;
      if (!hasRange || dates?.sorted) {
        const range = finiteRangeBetween(trace.y, startIndex, endIndex);
        if (range) {
          minimum = Math.min(minimum, range.minimum);
          maximum = Math.max(maximum, range.maximum);
        }
        return;
      }
      for (let index = startIndex; index < endIndex; index += 1) {
        const value = trace.y[index];
        if (!Number.isFinite(value)) continue;
        const timestamp = dates?.timestamps?.[index];
        if (!Number.isFinite(timestamp) || timestamp < rangeLow || timestamp > rangeHigh) continue;
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

  const chartAdjustments = Object.freeze({
    defaultScale,
    resolveScale,
    transformValues,
    transformValuesInto,
    invertTransformValues,
    finiteRangeBetween,
    offsetFromDrag,
    scaleFromDrag,
    resetTransforms,
    fitRangeForTraces,
    expandRangeToContain,
  });
export {
  defaultScale,
  expandRangeToContain,
  finiteRangeBetween,
  fitRangeForTraces,
  invertTransformValues,
  offsetFromDrag,
  resetTransforms,
  resolveScale,
  scaleFromDrag,
  transformValues,
  transformValuesInto,
};
export default chartAdjustments;
