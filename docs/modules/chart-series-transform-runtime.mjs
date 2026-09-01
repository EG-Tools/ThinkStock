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
    return map(key, baseValues, activeValues, (values, output) => (
      transformValuesInto(values, scale, offset, output)
    ));
  }

  function map(key, baseValues, activeValues, transformValues) {
    if (!Array.isArray(baseValues) || typeof transformValues !== "function") return null;
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
    return transformValues(baseValues, cached.buffers[bufferIndex]);
  }

  function clear(key) {
    entriesFor(key).delete(key);
  }

  return Object.freeze({ clear, map, transform });
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
  const viewportSeriesBuffers = createAlternatingBufferPool();
  const viewportLinkedBuffers = createAlternatingBufferPool();
  const runtimeStats = {
    viewportFrames: 0,
    viewportTraceDescriptions: 0,
    viewportSeriesTransforms: 0,
    viewportLinkedTransforms: 0,
  };

  function scaleFor(seriesKey) {
    const value = Number(options.resolveScale?.(seriesKey));
    return Number.isFinite(value) ? value : 1;
  }

  function offsetFor(seriesKey) {
    const value = Number(options.resolveOffset?.(seriesKey));
    return Number.isFinite(value) ? value : 0;
  }

  function latestFiniteValue(values) {
    for (let index = (values?.length || 0) - 1; index >= 0; index -= 1) {
      const value = Number(values[index]);
      if (values[index] !== null && Number.isFinite(value)) return value;
    }
    return null;
  }

  function linkedAnchorDelta(trace, ownerBaseValues) {
    if (trace?.meta?.seriesTransformAnchor !== "latest-price") return 0;
    const anchor = Number(trace?.meta?.seriesTransformAnchorBaseValue);
    const ownerLatest = latestFiniteValue(ownerBaseValues);
    return Number.isFinite(anchor) && Number.isFinite(ownerLatest)
      ? ownerLatest - anchor
      : 0;
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
    const ownerBaseValues = options.baseValuesFor?.(seriesKey);
    traces.forEach((trace, traceIndex) => {
      if (trace?.visible === "legendonly") return;
      const descriptor = options.describeTrace(trace);
      const baseValues = trace?.meta?.seriesTransformBaseValues;
      if (descriptor?.seriesKey !== seriesKey || !Array.isArray(baseValues)) return;
      const anchoredOffset = offset + (linkedAnchorDelta(trace, ownerBaseValues) * scale);
      const nextY = linkedBuffers.transform(
        trace,
        baseValues,
        scale,
        anchoredOffset,
        trace.y,
        options.transformValuesInto,
      );
      if (!nextY) return;
      traceIndexes.push(traceIndex);
      yUpdates.push(nextY);
    });
    return { traceIndexes, yUpdates };
  }

  function collectViewportSeriesUpdates(traces, xRange, config = {}) {
    if (!Array.isArray(traces)
      || typeof options.finiteDatedRange !== "function"
      || typeof options.transformViewportValuesInto !== "function") {
      return Object.freeze({ seriesUpdates: Object.freeze([]) });
    }
    const targetSpan = Math.max(0.01, Number(config.targetSpan) || 20);
    const resolvePostScale = typeof config.resolvePostScale === "function"
      ? config.resolvePostScale
      : () => 1;
    const requestedSeries = Array.isArray(config.seriesKeys)
      ? new Set(config.seriesKeys.map(String).filter(Boolean))
      : null;
    const seriesUpdates = [];
    const adjustableEntries = [];
    const linkedBySeries = new Map();
    runtimeStats.viewportFrames += 1;
    traces.forEach((trace, traceIndex) => {
      if (trace?.visible === "legendonly") return;
      const descriptor = options.describeTrace(trace);
      runtimeStats.viewportTraceDescriptions += 1;
      const seriesKey = String(descriptor?.seriesKey || "");
      const linkedBaseValues = trace?.meta?.seriesTransformBaseValues;
      if (seriesKey && Array.isArray(linkedBaseValues)) {
        const linked = linkedBySeries.get(seriesKey) || [];
        linked.push({ trace, traceIndex, baseValues: linkedBaseValues });
        linkedBySeries.set(seriesKey, linked);
      }
      if (descriptor?.adjustable === true
        && seriesKey
        && (!requestedSeries || requestedSeries.has(seriesKey))) {
        adjustableEntries.push({ trace, traceIndex, seriesKey });
      }
    });

    adjustableEntries.forEach(({ trace, traceIndex, seriesKey }) => {
      const baseValues = options.baseValuesFor?.(seriesKey);
      if (!Array.isArray(baseValues) || baseValues.length !== trace?.x?.length) return;
      const range = options.finiteDatedRange(trace.x, baseValues, xRange);
      if (!range) return;
      const center = (range.minimum + range.maximum) / 2;
      const span = range.maximum - range.minimum;
      const postScale = Math.max(0.01, Math.abs(Number(resolvePostScale(seriesKey)) || 1));
      const viewportScale = span > 1e-9 ? (targetSpan / postScale) / span : 1;
      const seriesScale = scaleFor(seriesKey);
      const offset = offsetFor(seriesKey);
      const nextY = viewportSeriesBuffers.map(
        seriesKey,
        baseValues,
        trace.y,
        (values, output) => options.transformViewportValuesInto(
          values,
          center,
          viewportScale,
          seriesScale,
          offset,
          output,
        ),
      );
      if (!nextY) return;
      runtimeStats.viewportSeriesTransforms += 1;

      const linkedTraceIndexes = [];
      const linkedYUpdates = [];
      (linkedBySeries.get(seriesKey) || []).forEach(({
        trace: linkedTrace,
        traceIndex: linkedTraceIndex,
        baseValues: linkedBaseValues,
      }) => {
        const anchoredOffset = offset + (
          linkedAnchorDelta(linkedTrace, baseValues)
          * viewportScale
          * seriesScale
        );
        const linkedY = viewportLinkedBuffers.map(
          linkedTrace,
          linkedBaseValues,
          linkedTrace.y,
          (values, output) => options.transformViewportValuesInto(
            values,
            center,
            viewportScale,
            seriesScale,
            anchoredOffset,
            output,
          ),
        );
        if (!linkedY) return;
        linkedTraceIndexes.push(linkedTraceIndex);
        linkedYUpdates.push(linkedY);
        runtimeStats.viewportLinkedTransforms += 1;
      });
      seriesUpdates.push(Object.freeze({
        seriesKey,
        traceIndex,
        nextY,
        linkedUpdate: Object.freeze({
          traceIndexes: Object.freeze(linkedTraceIndexes),
          yUpdates: Object.freeze(linkedYUpdates),
        }),
      }));
    });
    return Object.freeze({ seriesUpdates: Object.freeze(seriesUpdates) });
  }

  function collectViewportFrameUpdates(traces, xRange, config = {}) {
    const frame = collectViewportSeriesUpdates(traces, xRange, config);
    const traceIndexes = [];
    const yUpdates = [];
    frame.seriesUpdates.forEach((seriesUpdate) => {
      traceIndexes.push(...seriesUpdate.linkedUpdate.traceIndexes, seriesUpdate.traceIndex);
      yUpdates.push(...seriesUpdate.linkedUpdate.yUpdates, seriesUpdate.nextY);
      const groupedHover = options.groupedHoverYUpdate?.(
        traces,
        seriesUpdate.traceIndex,
        seriesUpdate.nextY,
      );
      if (!groupedHover) return;
      traceIndexes.push(groupedHover.traceIndex);
      yUpdates.push(groupedHover.y);
    });
    return Object.freeze({
      seriesUpdates: frame.seriesUpdates,
      traceIndexes: Object.freeze(traceIndexes),
      yUpdates: Object.freeze(yUpdates),
    });
  }

  function viewportSeriesUpdate(traces, xRange, seriesKey, preferredIndex = -1, config = {}) {
    const key = String(seriesKey || "");
    if (!key) return null;
    return collectViewportSeriesUpdates(traces, xRange, {
      ...config,
      seriesKeys: [key],
    }).seriesUpdates.find((update) => (
      update.traceIndex === preferredIndex || update.seriesKey === key
    )) || null;
  }

  function clearSeries(seriesKey) {
    seriesBuffers.clear(seriesKey);
    viewportSeriesBuffers.clear(seriesKey);
  }

  return Object.freeze({
    clearSeries,
    collectViewportFrameUpdates,
    collectLinkedSeriesYUpdates,
    collectViewportSeriesUpdates,
    computeSeriesValues,
    findAdjustableSeriesTraceIndex,
    stats: () => Object.freeze({ ...runtimeStats }),
    viewportSeriesUpdate,
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
    const startOffset = Number(options.resolveOffset?.(seriesKey));
    const initialOffset = Number.isFinite(startOffset) ? startOffset : 0;
    const anchorCoefficient = Number(config.scaleAnchorCoefficient);
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
        if (isScale && Number.isFinite(anchorCoefficient) && typeof options.setOffset === "function") {
          options.setOffset(
            seriesKey,
            initialOffset + (anchorCoefficient * (initialValue - nextValue)),
          );
        }
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
