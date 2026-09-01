"use strict";

  function createDataRangeCache(options = {}) {
    const toMilliseconds = typeof options.toMilliseconds === "function"
      ? options.toMilliseconds
      : (value) => Date.parse(value);
    const shouldInclude = typeof options.shouldInclude === "function"
      ? options.shouldInclude
      : () => true;
    let cache = new WeakMap();

    function traceEntry(trace) {
      const x = trace?.x;
      const fullDataStartMs = Number(trace?.meta?.fullDataStartMs);
      const fullDataEndMs = Number(trace?.meta?.fullDataEndMs);
      return {
        trace,
        x,
        length: Array.isArray(x) ? x.length : 0,
        first: Array.isArray(x) ? x[0] : undefined,
        last: Array.isArray(x) ? x[x.length - 1] : undefined,
        fullDataStartMs: Number.isFinite(fullDataStartMs) ? fullDataStartMs : null,
        fullDataEndMs: Number.isFinite(fullDataEndMs) ? fullDataEndMs : null,
      };
    }

    function entriesMatch(left, right) {
      return left.length === right.length && left.every((entry, index) => {
        const other = right[index];
        return entry.trace === other.trace
          && entry.x === other.x
          && entry.length === other.length
          && entry.first === other.first
          && entry.last === other.last
          && entry.fullDataStartMs === other.fullDataStartMs
          && entry.fullDataEndMs === other.fullDataEndMs;
      });
    }

    function findBoundary(values, fromEnd = false) {
      if (!Array.isArray(values)) return null;
      const start = fromEnd ? values.length - 1 : 0;
      const end = fromEnd ? -1 : values.length;
      const step = fromEnd ? -1 : 1;
      for (let index = start; index !== end; index += step) {
        const timestamp = toMilliseconds(values[index]);
        if (Number.isFinite(timestamp)) return timestamp;
      }
      return null;
    }

    function get(element) {
      if (!element || !Array.isArray(element.data)) return null;
      const traces = element.data.filter((trace) => Array.isArray(trace?.x) && shouldInclude(trace));
      const entries = traces.map(traceEntry);
      const prior = cache.get(element);
      if (prior && entriesMatch(prior.entries, entries)) return prior.range ? [...prior.range] : null;

      let start = Infinity;
      let end = -Infinity;
      traces.forEach((trace) => {
        const first = Number.isFinite(Number(trace?.meta?.fullDataStartMs))
          ? Number(trace.meta.fullDataStartMs)
          : findBoundary(trace.x, false);
        const last = Number.isFinite(Number(trace?.meta?.fullDataEndMs))
          ? Number(trace.meta.fullDataEndMs)
          : findBoundary(trace.x, true);
        if (Number.isFinite(first)) start = Math.min(start, first);
        if (Number.isFinite(last)) end = Math.max(end, last);
      });
      const range = Number.isFinite(start) && Number.isFinite(end) && end > start
        ? Object.freeze([start, end])
        : null;
      cache.set(element, { entries, range });
      return range ? [...range] : null;
    }

    function invalidate(element = null) {
      if (element) cache.delete(element);
      else cache = new WeakMap();
    }

    return Object.freeze({ get, invalidate });
  }

  function createRangeSyncController(scope = globalThis, options = {}) {
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    const applyRange = options.applyRange;
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    if (typeof requestFrame !== "function" || typeof applyRange !== "function") {
      throw new Error("requestAnimationFrame and applyRange are required");
    }

    let pending = null;
    let frameId = 0;
    let running = null;
    let disposed = false;
    const stats = { scheduled: 0, applied: 0, coalesced: 0 };

    function requestRun() {
      if (disposed || frameId || running || !pending) return;
      frameId = requestFrame(runNext);
    }

    function runNext() {
      frameId = 0;
      if (disposed || running || !pending) return;
      const next = pending;
      pending = null;
      stats.applied += 1;
      running = Promise.resolve()
        .then(() => applyRange(next))
        .catch((error) => onError(error, next))
        .finally(() => {
          running = null;
          requestRun();
        });
    }

    function schedule(startMs, endMs, meta = null) {
      const start = Number(startMs);
      const end = Number(endMs);
      if (disposed || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
      stats.scheduled += 1;
      if (pending) stats.coalesced += 1;
      pending = Object.freeze({ startMs: start, endMs: end, meta });
      requestRun();
      return true;
    }

    async function flush() {
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
      if (!running) runNext();
      if (running) await running;
      if (pending) return flush();
      return undefined;
    }

    function cancel() {
      pending = null;
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
    }

    function dispose() {
      disposed = true;
      cancel();
    }

    return Object.freeze({
      cancel,
      dispose,
      flush,
      schedule,
      isBusy: () => Boolean(frameId || running || pending),
      stats: () => ({
        ...stats,
        pending: Boolean(pending),
        running: Boolean(running),
        ...(typeof options.extraStats === "function"
          ? { frame: options.extraStats() }
          : {}),
      }),
    });
  }

  function resolveRelayoutViewport(eventData = {}, element = null) {
    const pair = Array.isArray(eventData["xaxis.range"])
      ? eventData["xaxis.range"].slice(0, 2)
      : null;
    const start = eventData["xaxis.range[0]"] ?? pair?.[0] ?? null;
    const end = eventData["xaxis.range[1]"] ?? pair?.[1] ?? null;
    const explicitRange = start != null && end != null;
    const autorange = eventData["xaxis.autorange"] === true;
    const renderedRange = autorange && Array.isArray(element?._fullLayout?.xaxis?.range)
      ? element._fullLayout.xaxis.range.slice(0, 2)
      : null;
    return Object.freeze({
      autorange,
      explicitRange,
      range: explicitRange ? Object.freeze([start, end]) : renderedRange,
    });
  }

  function createFutureOverlayController(options = {}) {
    const toMilliseconds = typeof options.toMilliseconds === "function"
      ? options.toMilliseconds
      : (value) => Date.parse(value);
    let entryViewport = null;
    let restoreViewport = null;
    let revealAiForecastRange = false;
    let revealEpsForecastRange = false;
    let trimFutureOverlayRange = false;
    let entryWasAtLatest = false;

    function normalizeRange(range) {
      const values = Array.isArray(range) ? range.slice(0, 2).map(toMilliseconds) : [];
      return values.length === 2 && values.every(Number.isFinite) && values[1] > values[0]
        ? values
        : null;
    }

    function capture() {
      if (entryViewport) return true;
      const range = normalizeRange(options.getPinnedRange?.())
        || normalizeRange(options.getCurrentRange?.());
      entryViewport = range ? Object.freeze({
        range: Object.freeze([...range]),
        interactionRevision: Number(options.getInteractionRevision?.()) || 0,
        userViewportPinned: options.getUserViewportPinned?.() === true,
      }) : null;
      entryWasAtLatest = Boolean(entryViewport) && options.isAtLatest?.() !== false;
      restoreViewport = null;
      return Boolean(entryViewport);
    }

    function requestReveal(kind, captureEntry = false) {
      if (captureEntry) capture();
      if (kind === "ai") revealAiForecastRange = true;
      if (kind === "eps") revealEpsForecastRange = true;
      trimFutureOverlayRange = false;
    }

    function disable(kind, active = {}) {
      if (kind === "ai") revealAiForecastRange = false;
      if (kind === "eps") revealEpsForecastRange = false;
      if (active.ai || active.eps) {
        trimFutureOverlayRange = true;
        return false;
      }

      const snapshot = entryViewport;
      entryViewport = null;
      const currentRevision = Number(options.getInteractionRevision?.()) || 0;
      restoreViewport = snapshot?.interactionRevision === currentRevision ? snapshot : null;
      trimFutureOverlayRange = !restoreViewport;
      if (!restoreViewport && entryWasAtLatest) {
        options.clampToObservedData?.({ alignLatest: true });
      }
      entryWasAtLatest = false;
      return Boolean(restoreViewport);
    }

    function reset(resetOptions = {}) {
      entryViewport = null;
      restoreViewport = null;
      revealAiForecastRange = false;
      revealEpsForecastRange = false;
      trimFutureOverlayRange = resetOptions.trim !== false;
      entryWasAtLatest = false;
    }

    function planState() {
      return {
        restoreFutureOverlayViewport: restoreViewport,
        revealAiForecastRange,
        revealEpsForecastRange,
        trimFutureOverlayRange,
      };
    }

    function applyPlan(plan = {}) {
      restoreViewport = plan.restoreFutureOverlayViewport || null;
      revealAiForecastRange = plan.revealAiForecastRange === true;
      revealEpsForecastRange = plan.revealEpsForecastRange === true;
      trimFutureOverlayRange = plan.trimFutureOverlayRange === true;
    }

    return Object.freeze({
      applyPlan,
      capture,
      disable,
      enable: (kind) => requestReveal(kind, true),
      planState,
      requestReveal,
      reset,
      stats: () => ({
        hasEntryViewport: Boolean(entryViewport),
        hasRestoreViewport: Boolean(restoreViewport),
        entryWasAtLatest,
        revealAiForecastRange,
        revealEpsForecastRange,
        trimFutureOverlayRange,
      }),
    });
  }

  function centeredZoomRange(viewRange, dataRange, direction, options = {}) {
    const currentStart = Number(viewRange?.[0]);
    const currentEnd = Number(viewRange?.[1]);
    const dataStart = Number(dataRange?.[0]);
    const dataEnd = Number(dataRange?.[1]);
    const zoomDirection = Math.sign(Number(direction));
    if (
      !Number.isFinite(currentStart)
      || !Number.isFinite(currentEnd)
      || !Number.isFinite(dataStart)
      || !Number.isFinite(dataEnd)
      || currentEnd <= currentStart
      || dataEnd <= dataStart
      || zoomDirection === 0
    ) return null;

    const ratio = Math.max(0.01, Math.min(0.5, Number(options.ratio) || 0.1));
    const minimumSpan = Math.max(1, Number(options.minimumSpan) || 1);
    const currentSpan = currentEnd - currentStart;
    const dataSpan = dataEnd - dataStart;
    const targetSpan = zoomDirection < 0
      ? Math.max(minimumSpan, currentSpan * (1 - ratio))
      : Math.min(dataSpan, currentSpan * (1 + ratio));
    if (Math.abs(targetSpan - currentSpan) < 1) return null;

    const anchorRatio = Math.max(0, Math.min(1, Number.isFinite(Number(options.anchorRatio))
      ? Number(options.anchorRatio)
      : 0.5));
    const anchor = currentStart + (currentSpan * anchorRatio);
    let start = anchor - (targetSpan * anchorRatio);
    let end = start + targetSpan;
    if (start < dataStart) {
      end += dataStart - start;
      start = dataStart;
    }
    if (end > dataEnd) {
      start -= end - dataEnd;
      end = dataEnd;
    }
    start = Math.max(dataStart, start);
    end = Math.min(dataEnd, end);
    return end > start ? [start, end] : null;
  }

  function resolveZoomAnchorRatio(viewRange, dataRange, requestedRatio, options = {}) {
    const viewEnd = Number(viewRange?.[1]);
    const dataEnd = Number(dataRange?.[1]);
    const numericRatio = Number(requestedRatio);
    const pointerRatio = Math.max(0, Math.min(1, Number.isFinite(numericRatio) ? numericRatio : 0.5));
    if (!Number.isFinite(viewEnd) || !Number.isFinite(dataEnd)) return pointerRatio;

    const tolerance = Math.max(0, Number(options.tolerance) || 0);
    return viewEnd >= dataEnd - tolerance ? 1 : pointerRatio;
  }

  function pinchZoomRange(viewRange, dataRange, startDistance, currentDistance, anchorRatio, options = {}) {
    const start = Number(viewRange?.[0]);
    const end = Number(viewRange?.[1]);
    const dataStart = Number(dataRange?.[0]);
    const dataEnd = Number(dataRange?.[1]);
    const initialDistance = Number(startDistance);
    const nextDistance = Number(currentDistance);
    if (
      !Number.isFinite(start)
      || !Number.isFinite(end)
      || !Number.isFinite(dataStart)
      || !Number.isFinite(dataEnd)
      || end <= start
      || dataEnd <= dataStart
      || initialDistance < 8
      || nextDistance < 8
    ) return null;

    const numericAnchorRatio = Number(anchorRatio);
    const ratio = Math.max(0, Math.min(1, Number.isFinite(numericAnchorRatio) ? numericAnchorRatio : 0.5));
    const minimumSpan = Math.max(1, Number(options.minimumSpan) || 1);
    const maximumScale = Math.max(1, Number(options.maximumScale) || 4);
    const scale = Math.max(1 / maximumScale, Math.min(maximumScale, initialDistance / nextDistance));
    const span = Math.max(minimumSpan, Math.min(dataEnd - dataStart, (end - start) * scale));
    const anchor = start + ((end - start) * ratio);
    let nextStart = anchor - (span * ratio);
    let nextEnd = nextStart + span;
    if (nextStart < dataStart) {
      nextEnd += dataStart - nextStart;
      nextStart = dataStart;
    }
    if (nextEnd > dataEnd) {
      nextStart -= nextEnd - dataEnd;
      nextEnd = dataEnd;
    }
    nextStart = Math.max(dataStart, nextStart);
    nextEnd = Math.min(dataEnd, nextEnd);
    return nextEnd > nextStart ? [nextStart, nextEnd] : null;
  }

  function shouldStepRangeForWheel(viewRange, dataRange, direction, currentMonths, targetMonths, options = {}) {
    const viewStart = Number(viewRange?.[0]);
    const viewEnd = Number(viewRange?.[1]);
    const dataStart = Number(dataRange?.[0]);
    const dataEnd = Number(dataRange?.[1]);
    const wheelDirection = Math.sign(Number(direction));
    const current = Number(currentMonths);
    const target = Number(targetMonths);
    if (
      !Number.isFinite(viewStart)
      || !Number.isFinite(viewEnd)
      || !Number.isFinite(dataStart)
      || !Number.isFinite(dataEnd)
      || viewEnd <= viewStart
      || dataEnd <= dataStart
      || !Number.isFinite(current)
      || !Number.isFinite(target)
      || current <= 0
      || target <= 0
      || wheelDirection === 0
      || target === current
    ) return false;

    const dataSpan = dataEnd - dataStart;
    const viewSpan = viewEnd - viewStart;
    if (wheelDirection > 0) {
      const boundaryRatio = Math.max(0.005, Math.min(0.1, Number(options.boundaryRatio) || 0.025));
      const prefetchViewRatio = Math.max(0.05, Math.min(1, Number(options.prefetchViewRatio) || 0.35));
      const minimumBoundary = Math.max(0, Number(options.minimumBoundary) || 0);
      return target > current
        && viewStart <= dataStart + Math.max(
          minimumBoundary,
          dataSpan * boundaryRatio,
          viewSpan * prefetchViewRatio,
        );
    }

    const thresholdRatio = Math.max(0.5, Math.min(1.2, Number(options.thresholdRatio) || 1.04));
    const targetSpan = dataSpan * Math.min(1, target / current);
    return target < current && viewSpan <= targetSpan * thresholdRatio;
  }

  function clampRangeToData(viewRange, dataRange, options = {}) {
    const viewStart = Number(viewRange?.[0]);
    const viewEnd = Number(viewRange?.[1]);
    const dataStart = Number(dataRange?.[0]);
    const dataEnd = Number(dataRange?.[1]);
    if (
      !Number.isFinite(viewStart)
      || !Number.isFinite(viewEnd)
      || !Number.isFinite(dataStart)
      || !Number.isFinite(dataEnd)
      || viewEnd <= viewStart
      || dataEnd <= dataStart
    ) return null;

    const clampStart = options.clampStart !== false;
    const clampEnd = options.clampEnd !== false;
    const viewSpan = viewEnd - viewStart;
    const dataSpan = dataEnd - dataStart;
    if (clampStart && clampEnd && viewSpan >= dataSpan) return [dataStart, dataEnd];

    let nextStart = viewStart;
    let nextEnd = viewEnd;
    if (clampEnd && nextEnd > dataEnd) {
      nextStart -= nextEnd - dataEnd;
      nextEnd = dataEnd;
    }
    if (clampStart && nextStart < dataStart) {
      nextEnd += dataStart - nextStart;
      nextStart = dataStart;
    }
    if (clampEnd && nextEnd > dataEnd) {
      nextStart -= nextEnd - dataEnd;
      nextEnd = dataEnd;
    }
    return nextEnd > nextStart ? [nextStart, nextEnd] : null;
  }

  function panRange(viewRange, dataRange, delta) {
    const viewStart = Number(viewRange?.[0]);
    const viewEnd = Number(viewRange?.[1]);
    const dataStart = Number(dataRange?.[0]);
    const dataEnd = Number(dataRange?.[1]);
    const shift = Number(delta);
    if (
      !Number.isFinite(viewStart)
      || !Number.isFinite(viewEnd)
      || !Number.isFinite(dataStart)
      || !Number.isFinite(dataEnd)
      || !Number.isFinite(shift)
      || viewEnd <= viewStart
      || dataEnd <= dataStart
    ) return null;
    const viewSpan = viewEnd - viewStart;
    const dataSpan = dataEnd - dataStart;
    if (viewSpan >= dataSpan) return [dataStart, dataEnd];
    let start = viewStart + shift;
    let end = viewEnd + shift;
    if (start < dataStart) {
      end += dataStart - start;
      start = dataStart;
    }
    if (end > dataEnd) {
      start -= end - dataEnd;
      end = dataEnd;
    }
    return end > start ? [start, end] : null;
  }

  function latestRange(viewRange, dataRange) {
    const viewStart = Number(viewRange?.[0]);
    const viewEnd = Number(viewRange?.[1]);
    const dataStart = Number(dataRange?.[0]);
    const dataEnd = Number(dataRange?.[1]);
    if (
      !Number.isFinite(viewStart)
      || !Number.isFinite(viewEnd)
      || !Number.isFinite(dataStart)
      || !Number.isFinite(dataEnd)
      || viewEnd <= viewStart
      || dataEnd <= dataStart
    ) return null;
    const span = Math.min(viewEnd - viewStart, dataEnd - dataStart);
    return [Math.max(dataStart, dataEnd - span), dataEnd];
  }

  function reconcileCompositionRange(viewRange, previousDataRange, nextDataRange, options = {}) {
    const viewStart = Number(viewRange?.[0]);
    const viewEnd = Number(viewRange?.[1]);
    const previousStart = Number(previousDataRange?.[0]);
    const previousEnd = Number(previousDataRange?.[1]);
    const nextStart = Number(nextDataRange?.[0]);
    const nextEnd = Number(nextDataRange?.[1]);
    if (![viewStart, viewEnd, nextStart, nextEnd].every(Number.isFinite)
      || viewEnd <= viewStart || nextEnd <= nextStart) return null;

    const previousSpan = previousEnd - previousStart;
    const tolerance = Number.isFinite(previousSpan) && previousSpan > 0
      ? Math.max(1, previousSpan * 0.005)
      : 1;
    const wasFullRange = options.forceFitFull === true || (
      Number.isFinite(previousStart)
      && Number.isFinite(previousEnd)
      && previousSpan > 0
      && Math.abs(viewStart - previousStart) <= tolerance
      && Math.abs(viewEnd - previousEnd) <= tolerance
    );
    if (wasFullRange) return [nextStart, nextEnd];
    const configuredLatestTolerance = Number(options.latestTolerance);
    const latestTolerance = Number.isFinite(configuredLatestTolerance) && configuredLatestTolerance >= 0
      ? configuredLatestTolerance
      : tolerance;
    const wasAtLatest = Number.isFinite(previousEnd)
      && Math.abs(viewEnd - previousEnd) <= latestTolerance;
    if (wasAtLatest) {
      const nextLatestRange = latestRange([viewStart, viewEnd], [nextStart, nextEnd]);
      if (nextLatestRange) return nextLatestRange;
    }
    return clampRangeToData([viewStart, viewEnd], [nextStart, nextEnd]);
  }

  function buildRenderViewportPlan(options = {}) {
    const copyRange = (range) => (
      Array.isArray(range) && range.length === 2 ? [...range] : null
    );
    const toMilliseconds = typeof options.toMilliseconds === "function"
      ? options.toMilliseconds
      : (value) => Date.parse(value);
    const toIsoRange = (range) => range.map((value) => new Date(Number(value)).toISOString());
    const preserveZoom = options.preserveZoom !== false;
    const autoChartReset = options.autoChartReset !== false;
    const showAiForecast = options.showAiForecast === true;
    const showEps = options.showEps === true;
    const aiForecastTraces = Array.isArray(options.aiForecastTraces)
      ? options.aiForecastTraces
      : [];
    const epsForecastTraces = Array.isArray(options.epsForecastTraces)
      ? options.epsForecastTraces
      : [];
    const futureTraces = Array.isArray(options.futureTraces)
      ? options.futureTraces
      : aiForecastTraces;
    const nextVisibleDataRange = copyRange(options.nextVisibleDataRange);

    let pinnedXRange = copyRange(options.pinnedXRange);
    let userViewportPinned = options.userViewportPinned === true;
    let pendingCompositionViewport = options.pendingCompositionViewport || null;
    let restoreFutureOverlayViewport = options.restoreFutureOverlayViewport
      || options.restoreAiForecastViewport
      || null;
    let revealAiForecastRange = options.revealAiForecastRange === true;
    let revealEpsForecastRange = options.revealEpsForecastRange === true;
    let trimFutureOverlayRange = options.trimFutureOverlayRange === true
      || options.trimAiForecastRange === true;

    const preserveLockedXRange = !autoChartReset && Boolean(pinnedXRange);
    const preserveUserXRange = userViewportPinned && Boolean(pinnedXRange);
    const preserveVisibleXRange = preserveZoom || preserveLockedXRange || preserveUserXRange;
    if (!preserveVisibleXRange) pinnedXRange = null;
    let savedXRange = preserveVisibleXRange
      ? (copyRange(pinnedXRange) || copyRange(options.currentXRange))
      : null;

    const rangeTimestamp = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : toMilliseconds(value);
    };
    const currentRangeMs = copyRange(options.currentXRange)?.map(rangeTimestamp);
    const pendingRangeMs = copyRange(pendingCompositionViewport?.viewRange)?.map(rangeTimestamp);
    const compositionSnapshotTolerance = Math.max(
      1,
      Number(options.compositionSnapshotTolerance) || 1000,
    );
    if (currentRangeMs?.every(Number.isFinite)
      && pendingRangeMs?.every(Number.isFinite)
      && currentRangeMs.some((value, index) => (
        Math.abs(value - pendingRangeMs[index]) > compositionSnapshotTolerance
      ))) {
      // A relayout that happened after composition capture is newer than the
      // pending snapshot. Never let the stale snapshot restore an older span.
      pendingCompositionViewport = null;
    }

    if (preserveZoom && autoChartReset && pendingCompositionViewport && nextVisibleDataRange) {
      const reconciledRange = reconcileCompositionRange(
        pendingCompositionViewport.viewRange,
        pendingCompositionViewport.dataRange,
        nextVisibleDataRange,
        {
          forceFitFull: pendingCompositionViewport.forceFitFull,
          latestTolerance: pendingCompositionViewport.latestTolerance
            ?? options.compositionLatestTolerance,
        },
      );
      if (reconciledRange) {
        savedXRange = toIsoRange(reconciledRange);
        pinnedXRange = [...savedXRange];
      }
      pendingCompositionViewport = null;
    } else if (!preserveZoom || !autoChartReset) {
      pendingCompositionViewport = null;
    }

    if (restoreFutureOverlayViewport && !showAiForecast && !showEps && nextVisibleDataRange) {
      const restoredRange = clampRangeToData(
        restoreFutureOverlayViewport.range,
        nextVisibleDataRange,
      );
      if (restoredRange) {
        savedXRange = toIsoRange(restoredRange);
        pinnedXRange = [...savedXRange];
        userViewportPinned = restoreFutureOverlayViewport.userViewportPinned === true;
      }
      restoreFutureOverlayViewport = null;
      trimFutureOverlayRange = false;
    }

    const savedYRange = preserveZoom
      ? (copyRange(options.currentYRange) || copyRange(options.lockedYRange))
      : copyRange(options.lockedYRange);
    const observedStart = options.observedStart;
    const observedEnd = options.observedEnd;
    const rightPaddingMs = Math.max(0, Number(options.rightPaddingMs) || 0);
    const observedEndMs = toMilliseconds(observedEnd);
    const paddedObservedEnd = rightPaddingMs > 0 && Number.isFinite(observedEndMs)
      ? new Date(observedEndMs + rightPaddingMs).toISOString()
      : observedEnd;
    const rawForecastEnd = futureTraces
      .map((trace) => trace?.x?.at?.(-1) || "")
      .reduce((latest, date) => date > latest ? date : latest, observedEnd);
    const rawForecastEndMs = toMilliseconds(rawForecastEnd);
    const forecastEnd = rightPaddingMs > 0 && Number.isFinite(rawForecastEndMs)
      ? new Date(rawForecastEndMs + rightPaddingMs).toISOString()
      : rawForecastEnd;
    const revealLatestToleranceMs = Math.max(0, Number(options.futureRevealLatestToleranceMs) || 0);
    const savedEndMs = toMilliseconds(savedXRange?.[1]);
    const canRevealFutureRange = !savedXRange || (
      Number.isFinite(savedEndMs)
      && Number.isFinite(observedEndMs)
      && savedEndMs >= observedEndMs - revealLatestToleranceMs
    );

    const extendSavedRangeTo = (targetEnd) => {
      const observedEndMs = toMilliseconds(paddedObservedEnd);
      const forecastEndMs = toMilliseconds(targetEnd);
      const savedStartMs = toMilliseconds(savedXRange?.[0]);
      const nextStartMs = Number.isFinite(savedStartMs) && savedStartMs < observedEndMs
        ? savedStartMs
        : toMilliseconds(observedStart);
      if (Number.isFinite(nextStartMs) && Number.isFinite(forecastEndMs)
        && forecastEndMs > observedEndMs) {
        savedXRange = toIsoRange([nextStartMs, forecastEndMs]);
        pinnedXRange = [...savedXRange];
        return true;
      }
      return false;
    };

    if (revealAiForecastRange && showAiForecast && aiForecastTraces.length) {
      if (canRevealFutureRange) extendSavedRangeTo(forecastEnd);
      revealAiForecastRange = false;
    }

    if (revealEpsForecastRange && epsForecastTraces.length) {
      if (canRevealFutureRange) extendSavedRangeTo(forecastEnd);
      revealEpsForecastRange = false;
    }

    if (trimFutureOverlayRange) {
      const remainingEndMs = toMilliseconds(forecastEnd);
      const currentSavedEndMs = toMilliseconds(savedXRange?.[1]);
      if (Number.isFinite(remainingEndMs)
        && Number.isFinite(currentSavedEndMs)
        && currentSavedEndMs > remainingEndMs) {
        const savedStartMs = toMilliseconds(savedXRange?.[0]);
        const nextStartMs = Number.isFinite(savedStartMs) && savedStartMs < remainingEndMs
          ? savedStartMs
          : toMilliseconds(observedStart);
        savedXRange = toIsoRange([nextStartMs, remainingEndMs]);
        pinnedXRange = [...savedXRange];
      }
      trimFutureOverlayRange = false;
    }

    return Object.freeze({
      defaultXRange: [observedStart, forecastEnd],
      forecastEnd,
      pendingCompositionViewport,
      pinnedXRange,
      preserveVisibleXRange,
      restoreFutureOverlayViewport,
      restoreAiForecastViewport: restoreFutureOverlayViewport,
      revealAiForecastRange,
      revealEpsForecastRange,
      savedXRange,
      savedYRange,
      trimFutureOverlayRange,
      trimAiForecastRange: trimFutureOverlayRange,
      userViewportPinned,
    });
  }

  function createZoomSession(options = {}) {
    const zoomRange = typeof options.zoomRange === "function"
      ? options.zoomRange
      : centeredZoomRange;
    let undoRange = null;

    function normalizeRange(range) {
      const start = Number(range?.[0]);
      const end = Number(range?.[1]);
      return Number.isFinite(start) && Number.isFinite(end) && end > start
        ? [start, end]
        : null;
    }

    function commit(previousRange) {
      const normalized = normalizeRange(previousRange);
      if (!normalized) return false;
      undoRange = normalized;
      return true;
    }

    function clear() {
      undoRange = null;
    }

    function restore() {
      if (!undoRange) return null;
      const restored = [...undoRange];
      clear();
      return restored;
    }

    function zoom(viewRange, dataRange, direction, zoomOptions = {}) {
      return undoRange ? zoomRange(viewRange, dataRange, direction, zoomOptions) : null;
    }

    return Object.freeze({
      clear,
      commit,
      isActive: () => Boolean(undoRange),
      restore,
      zoom,
    });
  }

// Handle layout is part of viewport policy.
  const HANDLE_LAYOUT = Object.freeze({
    mainMargin: 36,
    auxiliaryMargin: 36,
    controlLeft: 35,
    controlRight: 34,
    sliderInset: 44,
  });
  const HANDLE_FREE_LAYOUT = Object.freeze({
    mainMargin: 36,
    auxiliaryMargin: 36,
    controlLeft: 14,
    controlRight: 12,
    sliderInset: 20,
  });

  function resolve(handlesVisible) {
    return handlesVisible ? HANDLE_LAYOUT : HANDLE_FREE_LAYOUT;
  }

  function applyContainer(container, handlesVisible) {
    if (!container) return resolve(handlesVisible);
    const layout = resolve(handlesVisible);
    container.classList.toggle("handles-hidden", !handlesVisible);
    container.style.setProperty("--chart-control-left", `${layout.controlLeft}px`);
    container.style.setProperty("--chart-control-right", `${layout.controlRight}px`);
    container.style.setProperty("--chart-history-inset", `${layout.sliderInset}px`);
    return layout;
  }

// Composition capture is part of viewport policy.
  function visibleLineDataRangeMs(traces, options = {}) {
    const toMilliseconds = typeof options.toMilliseconds === "function"
      ? options.toMilliseconds
      : (value) => Date.parse(String(value || ""));
    let start = Infinity;
    let end = -Infinity;
    const series = [];
    (Array.isArray(traces) ? traces : []).forEach((trace) => {
      const seriesKey = String(trace?.meta?.seriesKey || "");
      if (trace?.visible === "legendonly"
        || !seriesKey
        || !String(trace?.mode || "").includes("lines")
        || !Array.isArray(trace?.x)) return;
      series.push(seriesKey);
      const fullDataStartMs = Number(trace?.meta?.fullDataStartMs);
      const fullDataEndMs = Number(trace?.meta?.fullDataEndMs);
      if (Number.isFinite(fullDataStartMs)) start = Math.min(start, fullDataStartMs);
      else {
        for (let index = 0; index < trace.x.length; index += 1) {
          const timestamp = toMilliseconds(trace.x[index]);
          if (!Number.isFinite(timestamp)) continue;
          start = Math.min(start, timestamp);
          break;
        }
      }
      if (Number.isFinite(fullDataEndMs)) end = Math.max(end, fullDataEndMs);
      else {
        for (let index = trace.x.length - 1; index >= 0; index -= 1) {
          const timestamp = toMilliseconds(trace.x[index]);
          if (!Number.isFinite(timestamp)) continue;
          end = Math.max(end, timestamp);
          break;
        }
      }
    });
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? Object.freeze({ range: Object.freeze([start, end]), series: Object.freeze([...new Set(series)]) })
      : null;
  }

  function captureCompositionViewport(options = {}) {
    if (options.autoScale === false) return null;
    const viewRange = typeof options.getViewRange === "function"
      ? options.getViewRange(options.element)
      : null;
    const visible = visibleLineDataRangeMs(options.element?.data, {
      toMilliseconds: options.toMilliseconds,
    });
    if (!Array.isArray(viewRange) || !visible?.range) return null;
    const tolerance = options.timelinePolicy?.latestToleranceMs?.(visible.series);
    const rightPaddingMs = Math.max(0, Number(options.rightPaddingMs) || 0);
    return Object.freeze({
      viewRange: Object.freeze([...viewRange]),
      dataRange: Object.freeze([visible.range[0], visible.range[1] + rightPaddingMs]),
      visibleSeries: visible.series,
      forceFitFull: options.forceFitFull === true,
      latestTolerance: Number.isFinite(Number(tolerance)) ? Number(tolerance) : undefined,
    });
  }

export {
  applyContainer,
  buildRenderViewportPlan,
  captureCompositionViewport,
  centeredZoomRange,
  clampRangeToData,
  createDataRangeCache,
  createFutureOverlayController,
  createRangeSyncController,
  createZoomSession,
  latestRange,
  panRange,
  pinchZoomRange,
  reconcileCompositionRange,
  resolve,
  resolveRelayoutViewport,
  resolveZoomAnchorRatio,
  shouldStepRangeForWheel,
  visibleLineDataRangeMs,
};
