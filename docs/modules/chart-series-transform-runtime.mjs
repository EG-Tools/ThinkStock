"use strict";

function createAlternatingBufferPool() {
  const objectEntries = new WeakMap();
  const primitiveEntries = new Map();

  function entriesFor(key) {
    return key !== null && (typeof key === "object" || typeof key === "function")
      ? objectEntries
      : primitiveEntries;
  }

  function transform(key, baseValues, scale, offset, activeValues, transformValuesInto) {
    if (!Array.isArray(baseValues) || typeof transformValuesInto !== "function") return null;
    const entries = entriesFor(key);
    let cached = entries.get(key);
    if (!cached || cached.baseValues !== baseValues || cached.length !== baseValues.length) {
      cached = {
        baseValues,
        length: baseValues.length,
        buffers: [new Array(baseValues.length), new Array(baseValues.length)],
        cursor: 0,
      };
      entries.set(key, cached);
    }
    let bufferIndex = cached.cursor;
    if (cached.buffers[bufferIndex] === activeValues) bufferIndex = bufferIndex === 0 ? 1 : 0;
    cached.cursor = bufferIndex === 0 ? 1 : 0;
    return transformValuesInto(
      baseValues,
      scale,
      offset,
      cached.buffers[bufferIndex],
    );
  }

  function clear(key) {
    entriesFor(key).delete(key);
  }

  return Object.freeze({ clear, transform });
}

function createChartSeriesTransformRuntime(options = {}) {
  if (typeof options.transformValuesInto !== "function") {
    throw new Error("series transform callback is required");
  }
  if (typeof options.describeTrace !== "function") {
    throw new Error("chart trace descriptor callback is required");
  }
  const seriesBuffers = createAlternatingBufferPool();
  const linkedBuffers = createAlternatingBufferPool();

  function scaleFor(seriesKey) {
    const value = Number(options.resolveScale?.(seriesKey));
    return Number.isFinite(value) ? value : 1;
  }

  function offsetFor(seriesKey) {
    const value = Number(options.resolveOffset?.(seriesKey));
    return Number.isFinite(value) ? value : 0;
  }

  function computeSeriesValues(seriesKey, traceIndex = -1, element = null) {
    const baseValues = options.baseValuesFor?.(seriesKey);
    if (!Array.isArray(baseValues)) return null;
    const activeValues = Number.isInteger(traceIndex) ? element?.data?.[traceIndex]?.y : null;
    return seriesBuffers.transform(
      seriesKey,
      baseValues,
      scaleFor(seriesKey),
      offsetFor(seriesKey),
      activeValues,
      options.transformValuesInto,
    );
  }

  function findAdjustableSeriesTraceIndex(traces, seriesKey, preferredIndex = null) {
    const items = Array.isArray(traces) ? traces : [];
    const matches = (trace) => {
      const descriptor = options.describeTrace(trace);
      return descriptor?.seriesKey === seriesKey && descriptor?.adjustable === true;
    };
    if (Number.isInteger(preferredIndex) && matches(items[preferredIndex])) return preferredIndex;
    return items.findIndex(matches);
  }

  function collectLinkedSeriesYUpdates(traces, seriesKey) {
    if (!Array.isArray(traces)) return { traceIndexes: [], yUpdates: [] };
    const traceIndexes = [];
    const yUpdates = [];
    const scale = scaleFor(seriesKey);
    const offset = offsetFor(seriesKey);
    traces.forEach((trace, traceIndex) => {
      if (trace?.visible === "legendonly") return;
      const descriptor = options.describeTrace(trace);
      const baseValues = trace?.meta?.seriesTransformBaseValues;
      if (descriptor?.seriesKey !== seriesKey || !Array.isArray(baseValues)) return;
      const nextY = linkedBuffers.transform(
        trace,
        baseValues,
        scale,
        offset,
        trace.y,
        options.transformValuesInto,
      );
      if (!nextY) return;
      traceIndexes.push(traceIndex);
      yUpdates.push(nextY);
    });
    return { traceIndexes, yUpdates };
  }

  function clearSeries(seriesKey) {
    seriesBuffers.clear(seriesKey);
  }

  return Object.freeze({
    clearSeries,
    collectLinkedSeriesYUpdates,
    computeSeriesValues,
    findAdjustableSeriesTraceIndex,
  });
}

function createSeriesTransformGestureRuntime(options = {}) {
  if (typeof options.getDragController !== "function") {
    throw new Error("series transform drag controller is required");
  }

  function start(kind, config = {}) {
    const seriesKey = String(config.seriesKey || "");
    const startClientY = Number(config.startClientY);
    if (!seriesKey || !Number.isFinite(startClientY)) return false;
    const isScale = kind === "scale";
    const startValue = Number(
      isScale ? options.resolveScale?.(seriesKey) : options.resolveOffset?.(seriesKey),
    );
    const initialValue = Number.isFinite(startValue) ? startValue : (isScale ? 1 : 0);
    const applyFromPointer = isScale
      ? options.scaleFromDrag
      : options.offsetFromDrag;
    const assignValue = isScale ? options.setScale : options.setOffset;
    if (typeof applyFromPointer !== "function" || typeof assignValue !== "function") return false;

    return options.getDragController().start({
      ...config,
      applyValue: (clientY) => {
        const nextValue = isScale
          ? applyFromPointer(initialValue, startClientY, clientY)
          : applyFromPointer(initialValue, startClientY, clientY, config.axis);
        assignValue(seriesKey, nextValue);
      },
      onClick: typeof config.onClick === "function"
        ? (event) => config.onClick({ ...event, startValue: initialValue })
        : undefined,
    });
  }

  return Object.freeze({
    startOffset: (config) => start("offset", config),
    startScale: (config) => start("scale", config),
  });
}

export { createChartSeriesTransformRuntime, createSeriesTransformGestureRuntime };
