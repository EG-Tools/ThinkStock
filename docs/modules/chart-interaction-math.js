(function initChartInteractionMath(globalScope) {
  "use strict";

  function toMsSafe(value) {
    if (value == null) return null;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toFiniteNumber(value) {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function getTraceTimeMsArray(trace) {
    const xs = trace?.x;
    if (!Array.isArray(xs) || !xs.length) return [];
    const cached = trace._thinkStockTimeMs;
    if (
      Array.isArray(cached)
      && cached.length === xs.length
      && cached._firstX === xs[0]
      && cached._lastX === xs[xs.length - 1]
    ) {
      return cached;
    }

    const times = xs.map((value) => toMsSafe(value));
    times._firstX = xs[0];
    times._lastX = xs[xs.length - 1];
    try {
      trace._thinkStockTimeMs = times;
    } catch (_) {
      // The cache is optional when a trace is immutable.
    }
    return times;
  }

  function findNearestHoverPoint(element, xValue) {
    if (!element?.data?.length) return null;
    const targetMs = toMsSafe(xValue);
    if (targetMs === null) return null;

    let best = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    element.data.forEach((trace, curveNumber) => {
      if (
        !trace
        || trace.visible === "legendonly"
        || trace.hoverinfo === "skip"
        || !Array.isArray(trace.x)
        || !trace.x.length
      ) return;

      const times = getTraceTimeMsArray(trace);
      let low = 0;
      let high = times.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const milliseconds = times[middle];
        if (!Number.isFinite(milliseconds)) return;
        if (milliseconds < targetMs) low = middle + 1;
        else high = middle - 1;
      }

      const candidates = [low, low - 1].filter((index) => index >= 0 && index < times.length);
      candidates.forEach((pointNumber) => {
        if (!Number.isFinite(times[pointNumber])) return;
        const difference = Math.abs(times[pointNumber] - targetMs);
        if (difference < bestDiff) {
          bestDiff = difference;
          best = { curveNumber, pointNumber };
        }
      });
    });
    return best;
  }

  function getChartInteractionGeometry(element) {
    const xAxis = element?._fullLayout?.xaxis;
    const yAxis = element?._fullLayout?.yaxis;
    if (!element || !xAxis) return null;
    return { rect: element.getBoundingClientRect(), xa: xAxis, ya: yAxis };
  }

  function axisPixelToXValue(element, clientX, clampToAxis = false, geometry = null) {
    const xAxis = geometry?.xa || element?._fullLayout?.xaxis;
    if (!xAxis || !Number.isFinite(clientX)) return null;
    const rect = geometry?.rect || element.getBoundingClientRect();
    let pixel = clientX - rect.left - xAxis._offset;
    if (!Number.isFinite(pixel)) return null;
    if (pixel < 0 || pixel > xAxis._length) {
      if (!clampToAxis) return null;
      pixel = Math.max(0, Math.min(xAxis._length, pixel));
    }

    try {
      if (typeof xAxis.p2d === "function") {
        const value = xAxis.p2d(pixel);
        if (value != null) return value;
      }
    } catch (_) {
      // Fall through to the linear-axis converter.
    }

    try {
      if (typeof xAxis.p2l === "function") return xAxis.p2l(pixel);
      if (typeof xAxis.p2c === "function") return xAxis.p2c(pixel);
    } catch (_) {
      return null;
    }
    return null;
  }

  function xRangeMatches(element, start, end, toleranceMs = 2) {
    const current = element?._fullLayout?.xaxis?.range;
    if (!Array.isArray(current) || current.length < 2) return false;
    const values = [
      toMsSafe(current[0]),
      toMsSafe(current[1]),
      toMsSafe(start),
      toMsSafe(end),
    ];
    if (!values.every(Number.isFinite)) return false;
    return Math.abs(values[0] - values[2]) < toleranceMs
      && Math.abs(values[1] - values[3]) < toleranceMs;
  }

  function yValueToLocalPixel(element, value) {
    return yValueToLocalPixelFromAxis(element?._fullLayout?.yaxis, value);
  }

  function yValueToLocalPixelFromAxis(yAxis, value) {
    const range = yAxis?.range;
    if (!yAxis || !Array.isArray(range) || range.length < 2 || !Number.isFinite(value)) return null;
    const [minimum, maximum] = range;
    const span = maximum - minimum;
    if (!Number.isFinite(span) || span === 0) return null;
    return yAxis._offset + yAxis._length * (1 - ((value - minimum) / span));
  }

  function interpolateTraceYAtMs(trace, targetMs) {
    if (!trace || !Array.isArray(trace.x) || !Array.isArray(trace.y) || !Number.isFinite(targetMs)) return null;
    const times = getTraceTimeMsArray(trace);
    if (!times.length || times.length !== trace.x.length) return null;

    let low = 0;
    let high = times.length - 1;
    let rightIndex = times.length;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (!Number.isFinite(times[middle]) || times[middle] < targetMs) low = middle + 1;
      else {
        rightIndex = middle;
        high = middle - 1;
      }
    }

    let left = null;
    for (let index = Math.min(rightIndex, times.length - 1); index >= 0; index -= 1) {
      const y = toFiniteNumber(trace.y[index]);
      const time = times[index];
      if (y === null || !Number.isFinite(time) || time > targetMs) continue;
      if (time === targetMs) return y;
      left = { time, y };
      break;
    }

    let right = null;
    for (let index = Math.max(0, rightIndex); index < times.length; index += 1) {
      const y = toFiniteNumber(trace.y[index]);
      const time = times[index];
      if (y === null || !Number.isFinite(time) || time < targetMs) continue;
      if (time === targetMs) return y;
      right = { time, y };
      break;
    }

    if (!left || !right || right.time <= left.time) return null;
    const ratio = (targetMs - left.time) / (right.time - left.time);
    return left.y + ((right.y - left.y) * ratio);
  }

  function buildLineHitIndex(traces, seriesKeys) {
    return (Array.isArray(traces) ? traces : []).map((trace, traceIndex) => {
      const seriesKey = seriesKeys?.[traceIndex] || "";
      if (!trace || !seriesKey || !Array.isArray(trace.x) || !Array.isArray(trace.y)) return null;
      return {
        trace,
        traceIndex,
        seriesKey,
        xValues: trace.x,
        yValues: trace.y,
        times: getTraceTimeMsArray(trace),
        numericY: trace.y.map((value) => toFiniteNumber(value)),
      };
    }).filter(Boolean);
  }

  function lineHitIndexMatches(index, traces, seriesKeys) {
    if (!Array.isArray(index)) return false;
    const expected = (Array.isArray(traces) ? traces : []).reduce((count, trace, traceIndex) => (
      trace && seriesKeys?.[traceIndex] && Array.isArray(trace.x) && Array.isArray(trace.y)
        ? count + 1
        : count
    ), 0);
    if (index.length !== expected) return false;
    return index.every((entry) => (
      entry.trace === traces?.[entry.traceIndex]
      && entry.seriesKey === seriesKeys?.[entry.traceIndex]
      && entry.xValues === entry.trace.x
      && entry.yValues === entry.trace.y
    ));
  }

  function interpolateLineHitEntry(entry, targetMs) {
    const times = entry?.times;
    const ys = entry?.numericY;
    if (!Array.isArray(times) || !Array.isArray(ys) || !Number.isFinite(targetMs)) return null;
    let low = 0;
    let high = times.length - 1;
    let rightIndex = times.length;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (!Number.isFinite(times[middle]) || times[middle] < targetMs) low = middle + 1;
      else {
        rightIndex = middle;
        high = middle - 1;
      }
    }

    let leftIndex = Math.min(rightIndex, times.length - 1);
    while (
      leftIndex >= 0
      && (!Number.isFinite(times[leftIndex]) || ys[leftIndex] === null || times[leftIndex] > targetMs)
    ) leftIndex -= 1;

    let nextIndex = Math.max(0, rightIndex);
    while (
      nextIndex < times.length
      && (!Number.isFinite(times[nextIndex]) || ys[nextIndex] === null || times[nextIndex] < targetMs)
    ) nextIndex += 1;

    if (leftIndex >= 0 && times[leftIndex] === targetMs) return ys[leftIndex];
    if (nextIndex < times.length && times[nextIndex] === targetMs) return ys[nextIndex];
    if (leftIndex < 0 || nextIndex >= times.length || times[nextIndex] <= times[leftIndex]) return null;
    const ratio = (targetMs - times[leftIndex]) / (times[nextIndex] - times[leftIndex]);
    return ys[leftIndex] + ((ys[nextIndex] - ys[leftIndex]) * ratio);
  }

  function findNearestLineTarget(index, targetMs, localY, yAxis, tolerance) {
    if (!Array.isArray(index) || !Number.isFinite(targetMs) || !Number.isFinite(localY)) return null;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    index.forEach((entry) => {
      if (entry.trace?.visible === "legendonly") return;
      const y = interpolateLineHitEntry(entry, targetMs);
      const pixelY = yValueToLocalPixelFromAxis(yAxis, y);
      if (!Number.isFinite(pixelY)) return;
      const distance = Math.abs(pixelY - localY);
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        best = { traceIndex: entry.traceIndex, seriesKey: entry.seriesKey };
      }
    });
    return best;
  }

  globalScope.ThinkStockChartInteractionMath = Object.freeze({
    toMsSafe,
    getTraceTimeMsArray,
    findNearestHoverPoint,
    getChartInteractionGeometry,
    axisPixelToXValue,
    xRangeMatches,
    yValueToLocalPixel,
    yValueToLocalPixelFromAxis,
    interpolateTraceYAtMs,
    buildLineHitIndex,
    lineHitIndexMatches,
    findNearestLineTarget,
  });
}(typeof self !== "undefined" ? self : globalThis));
