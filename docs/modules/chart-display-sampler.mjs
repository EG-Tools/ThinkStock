"use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const viewportTimeCache = new WeakMap();

  function toMilliseconds(value) {
    if (Number.isFinite(Number(value)) && typeof value !== "string") return Number(value);
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function cachedTimeValues(values, dateKey = "") {
    const source = Array.isArray(values) ? values : [];
    if (!source.length) return [];
    const cacheKey = String(dateKey || "");
    let cachedByKey = viewportTimeCache.get(source);
    if (!cachedByKey) {
      cachedByKey = new Map();
      viewportTimeCache.set(source, cachedByKey);
    }
    if (cachedByKey.has(cacheKey)) return cachedByKey.get(cacheKey);
    const times = source.map((value) => toMilliseconds(
      cacheKey && value && typeof value === "object" ? value[cacheKey] : value,
    ));
    cachedByKey.set(cacheKey, times);
    return times;
  }

  function lowerBound(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[middle] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBound(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[middle] <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function normalizeRange(range) {
    const first = toMilliseconds(range?.[0]);
    const second = toMilliseconds(range?.[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second) || first === second) return null;
    return first < second ? [first, second] : [second, first];
  }

  function resolveViewportWindow(values, viewRange, options = {}) {
    const source = Array.isArray(values) ? values : [];
    const times = cachedTimeValues(source, options.dateKey);
    if (!times.length || !Number.isFinite(times[0]) || !Number.isFinite(times.at(-1))) return null;
    const dataStartMs = times[0];
    const dataEndMs = times.at(-1);
    const normalizedView = normalizeRange(viewRange) || [dataStartMs, dataEndMs];
    const viewStartMs = Math.max(dataStartMs, normalizedView[0]);
    const viewEndMs = Math.min(dataEndMs, normalizedView[1]);
    const visibleSpanMs = Math.max(DAY_MS, viewEndMs - viewStartMs);
    const bufferRatio = Math.max(0, Number(options.bufferRatio) || 0);
    const minimumBufferMs = Math.max(0, Number(options.minimumBufferMs) || 0);
    const bufferMs = Math.max(minimumBufferMs, visibleSpanMs * bufferRatio);
    const requestedStartMs = Math.max(dataStartMs, viewStartMs - bufferMs);
    const requestedEndMs = Math.min(dataEndMs, viewEndMs + bufferMs);
    let startIndex = lowerBound(times, requestedStartMs);
    let endIndex = upperBound(times, requestedEndMs);
    // One adjacent point keeps a line continuous while a buffered window is replaced.
    if (startIndex > 0) startIndex -= 1;
    if (endIndex < times.length) endIndex += 1;
    startIndex = Math.max(0, Math.min(startIndex, times.length - 1));
    endIndex = Math.max(startIndex + 1, Math.min(endIndex, times.length));
    const startMs = times[startIndex];
    const endMs = times[endIndex - 1];
    const full = startIndex === 0 && endIndex === times.length;
    return Object.freeze({
      bufferMs,
      dataEndMs,
      dataStartMs,
      endIndex,
      endMs,
      full,
      key: `${startIndex}:${endIndex}`,
      sourceLength: times.length,
      startIndex,
      startMs,
      viewEndMs,
      viewStartMs,
    });
  }

  function buildViewportIndexes(values, viewRange, options = {}) {
    const window = resolveViewportWindow(values, viewRange, options);
    if (!window) return { indexes: null, window: null };
    if (window.full) return { indexes: null, window };
    return {
      indexes: Array.from(
        { length: window.endIndex - window.startIndex },
        (_, index) => window.startIndex + index,
      ),
      window,
    };
  }

  function inspectViewportCoverage(window, viewRange, options = {}) {
    const range = normalizeRange(viewRange);
    if (!window || !range || window.full) return { needsRefresh: false, outside: false };
    const toleranceMs = Math.max(1, Number(options.toleranceMs) || DAY_MS);
    const outside = range[0] < window.startMs - toleranceMs
      || range[1] > window.endMs + toleranceMs;
    if (outside) return { needsRefresh: true, outside: true };
    const edgeRatio = Math.max(0, Math.min(0.5, Number(options.edgeRatio) || 0.2));
    const edgeDistance = Math.max(toleranceMs, (range[1] - range[0]) * edgeRatio);
    const nearLeft = window.startIndex > 0 && range[0] - window.startMs < edgeDistance;
    const nearRight = window.endIndex < window.sourceLength && window.endMs - range[1] < edgeDistance;
    return { needsRefresh: nearLeft || nearRight, outside: false };
  }

  function sliceViewportArrays(dates, arrays, viewRange, options = {}) {
    const sourceDates = Array.isArray(dates) ? dates : [];
    const window = resolveViewportWindow(sourceDates, viewRange, options);
    if (!window) {
      return {
        dates: sourceDates,
        arrays: (arrays || []).map((values) => Array.isArray(values) ? values : []),
        window: null,
      };
    }
    return {
      dates: sourceDates.slice(window.startIndex, window.endIndex),
      arrays: (arrays || []).map((values) => (
        Array.isArray(values) ? values.slice(window.startIndex, window.endIndex) : []
      )),
      window,
    };
  }

  function sliceSeriesModels(seriesModels, indexes) {
    if (!Array.isArray(indexes)) return Array.isArray(seriesModels) ? seriesModels : [];
    const pick = (values) => indexes.map((index) => values?.[index]);
    return (Array.isArray(seriesModels) ? seriesModels : []).map((model) => ({
      ...model,
      xValues: pick(model?.xValues),
      values: pick(model?.values),
      baseValues: pick(model?.baseValues),
      rawTexts: pick(model?.rawTexts),
    }));
  }

  function createViewportWindowController(scope = globalThis, options = {}) {
    const dayMs = Math.max(1, Number(options.dayMs) || DAY_MS);
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    let current = Object.freeze({ indexes: null, window: null });
    let currentSource = null;
    let timer = 0;
    let signature = "";
    const cacheStats = {
      hits: 0,
      misses: 0,
      hitReasons: {},
      missReasons: {},
      seriesBands: {},
    };

    function resetWindowState() {
      current = Object.freeze({ indexes: null, window: null });
      currentSource = null;
      signature = "";
    }

    function seriesBand(model) {
      const count = Math.max(
        Array.isArray(model?.selected) ? model.selected.length : 0,
        Array.isArray(model?.seriesModels) ? model.seriesModels.length : 0,
      );
      if (count <= 1) return "1";
      if (count <= 5) return "2-5";
      return "6-10";
    }

    function recordBuildOutcome(model, hit, reason = "") {
      const band = seriesBand(model);
      cacheStats.seriesBands[band] ||= { hits: 0, misses: 0 };
      cacheStats.seriesBands[band][hit ? "hits" : "misses"] += 1;
      if (reason) {
        const target = hit ? cacheStats.hitReasons : cacheStats.missReasons;
        target[reason] = (Number(target[reason]) || 0) + 1;
      }
    }

    function seriesSources(seriesModels) {
      return (Array.isArray(seriesModels) ? seriesModels : []).map((model) => ({
        model,
        xValues: model?.xValues,
        values: model?.values,
        baseValues: model?.baseValues,
        rawTexts: model?.rawTexts,
      }));
    }

    function sameSeriesSources(snapshot, seriesModels) {
      const models = Array.isArray(seriesModels) ? seriesModels : [];
      return snapshot?.length === models.length && snapshot.every((entry, index) => {
        const model = models[index];
        return entry.model === model
          && entry.xValues === model?.xValues
          && entry.values === model?.values
          && entry.baseValues === model?.baseValues
          && entry.rawTexts === model?.rawTexts;
      });
    }

    function build(model, viewRange) {
      // Any committed build supersedes a previously queued edge refresh.  If
      // the old timer survives, it can redraw the same viewport after pointer
      // release and visibly apply the Y fit a second time.
      cancelScheduled();
      const stableSources = currentSource
        && currentSource.rows === model?.rows
        && currentSource.displayIndexes === model?.displayIndexes
        && sameSeriesSources(currentSource.seriesSources, model?.seriesModels);
      const coverage = stableSources
        ? inspectViewportCoverage(current.window, viewRange, {
            edgeRatio: options.edgeRatio,
            toleranceMs: dayMs,
          })
        : null;
      if (coverage && !coverage.needsRefresh) {
        cacheStats.hits += 1;
        recordBuildOutcome(model, true, "covered");
        signature = "";
        return {
          displayIndexes: current.indexes || model?.displayIndexes || null,
          ...current,
        };
      }

      const viewport = buildViewportIndexes(model?.rows || [], viewRange, {
        dateKey: options.dateKey || "date",
        bufferRatio: options.bufferRatio,
        minimumBufferMs: options.minimumBufferMs,
      });
      const canReuse = stableSources && currentSource.windowKey === viewport.window?.key;
      if (canReuse) {
        cacheStats.hits += 1;
        recordBuildOutcome(model, true, "exact");
        signature = "";
        return {
          displayIndexes: current.indexes || model?.displayIndexes || null,
          ...current,
        };
      }

      cacheStats.misses += 1;
      const missReason = !currentSource
        ? "cold"
        : currentSource.rows !== model?.rows
          ? "rows"
          : currentSource.displayIndexes !== model?.displayIndexes
            ? "display-indexes"
            : currentSource.windowKey !== viewport.window?.key
              ? "window"
              : "series";
      recordBuildOutcome(model, false, missReason);
      current = Object.freeze({
        indexes: viewport.indexes,
        window: viewport.window,
      });
      currentSource = {
        displayIndexes: model?.displayIndexes,
        rows: model?.rows,
        seriesSources: seriesSources(model?.seriesModels),
        windowKey: viewport.window?.key,
      };
      signature = "";
      return {
        displayIndexes: viewport.indexes || model?.displayIndexes || null,
        ...current,
      };
    }

    function rangeCoverage(startMs, endMs) {
      return inspectViewportCoverage(current.window, [startMs, endMs], {
        edgeRatio: options.edgeRatio,
        toleranceMs: dayMs,
      });
    }

    function eventArguments(model, fallback = {}) {
      const windowDate = (side, value) => {
        const timestamp = side === "end" ? current.window?.endMs : current.window?.startMs;
        return Number.isFinite(timestamp)
          ? new Date(timestamp).toISOString().slice(0, 10)
          : String(value || "").slice(0, 10);
      };
      const markerStart = windowDate("start", fallback.start);
      const markerEnd = windowDate("end", fallback.end);
      const rows = Array.isArray(model?.rows) ? model.rows : [];
      // Event calculations already cover the loaded history. Keep their traces
      // attached to the full parent series and let Plotly clip off-screen points;
      // the viewport window is used only to size marker spacing.
      const coverageStart = String(rows[0]?.date || fallback.start || markerStart).slice(0, 10);
      const coverageEnd = String(rows.at(-1)?.date || fallback.end || markerEnd).slice(0, 10);
      return [
        model?.selected || [],
        model?.seriesModels || [],
        coverageStart,
        coverageEnd,
        markerStart,
        markerEnd,
      ];
    }

    function schedule(startMs, endMs) {
      const coverage = rangeCoverage(startMs, endMs);
      if (!coverage.needsRefresh || typeof setTimer !== "function") return false;
      const nextSignature = `${Math.round(startMs / dayMs)}:${Math.round(endMs / dayMs)}`;
      if (timer && signature === nextSignature) return true;
      if (timer && typeof clearTimer === "function") clearTimer(timer);
      signature = nextSignature;
      const configuredDelay = Number(options.delayMs);
      const delayMs = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : 48;
      timer = setTimer(() => {
        timer = 0;
        options.requestRender?.({ outside: coverage.outside });
      }, coverage.outside ? 0 : delayMs);
      return true;
    }

    function cancelScheduled() {
      const hadPending = Boolean(timer);
      if (timer && typeof clearTimer === "function") clearTimer(timer);
      timer = 0;
      signature = "";
      return hadPending;
    }

    function invalidate() {
      cancelScheduled();
      resetWindowState();
    }

    function dispose() {
      invalidate();
    }

    return Object.freeze({
      build,
      cancelScheduled,
      dispose,
      eventArguments,
      hasScheduledRefresh: () => Boolean(timer),
      invalidate,
      needsRefresh: (startMs, endMs) => rangeCoverage(startMs, endMs).needsRefresh,
      schedule,
      snapshot: () => current,
      stats: () => {
        const total = cacheStats.hits + cacheStats.misses;
        return {
          hits: cacheStats.hits,
          misses: cacheStats.misses,
          hitRate: total ? cacheStats.hits / total : 0,
          hitReasons: { ...cacheStats.hitReasons },
          missReasons: { ...cacheStats.missReasons },
          seriesBands: Object.fromEntries(Object.entries(cacheStats.seriesBands)
            .map(([key, value]) => [key, { ...value }])),
        };
      },
    });
  }

  function thinIndexList(indexes, budget, rowCount, requiredIndexes = []) {
    const sorted = [...new Set(indexes)].sort((left, right) => left - right);
    const maximum = Math.max(2, Math.floor(Number(budget) || 2));
    if (sorted.length <= maximum) return sorted;
    const output = new Set([0, rowCount - 1, ...requiredIndexes]);
    const candidates = sorted.filter((index) => !output.has(index));
    const slots = Math.max(0, maximum - output.size);
    for (let index = 1; index <= slots; index += 1) {
      const sourceIndex = candidates[Math.round((index * (candidates.length - 1)) / (slots + 1))];
      if (Number.isInteger(sourceIndex)) output.add(sourceIndex);
    }
    return [...output].sort((left, right) => left - right);
  }

  function seriesBoundaryIndexes(targets, bySeries) {
    const boundaries = new Set();
    targets.forEach((series) => {
      const values = bySeries.get(series) || [];
      const first = values.findIndex(Number.isFinite);
      let last = values.length - 1;
      while (last >= 0 && !Number.isFinite(values[last])) last -= 1;
      if (first >= 0) boundaries.add(first);
      if (last >= 0) boundaries.add(last);
      for (let index = Math.max(1, first + 1); index <= last; index += 1) {
        const previousFinite = Number.isFinite(values[index - 1]);
        const currentFinite = Number.isFinite(values[index]);
        if (previousFinite !== currentFinite) {
          boundaries.add(index - 1);
          boundaries.add(index);
        }
      }
    });
    return [...boundaries];
  }

  function buildDisplayIndexes(
    rows,
    seriesModels,
    selected,
    hiddenSeries,
    budget,
    preserveDailyPoints = false,
  ) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const rowCount = sourceRows.length;
    const maximum = Math.max(2, Math.floor(Number(budget) || rowCount || 2));
    if (preserveDailyPoints || !rowCount || rowCount <= maximum) return null;
    const hidden = hiddenSeries instanceof Set ? hiddenSeries : new Set(hiddenSeries || []);
    const selectedSeries = Array.isArray(selected) ? selected : [];
    const visible = selectedSeries.filter((key) => !hidden.has(key));
    const targets = visible.length ? visible : selectedSeries;
    const bySeries = new Map((seriesModels || []).map((model) => [model.series, model.values]));
    const boundaryIndexes = seriesBoundaryIndexes(targets, bySeries);
    const perBucketCost = Math.max(2, targets.length * 2);
    const bucketCount = Math.max(1, Math.floor((maximum - 2) / perBucketCost));
    const bucketSize = Math.max(1, Math.ceil((rowCount - 2) / bucketCount));
    const keep = new Set([0, rowCount - 1]);

    for (let start = 1; start < rowCount - 1; start += bucketSize) {
      const end = Math.min(rowCount - 1, start + bucketSize);
      targets.forEach((series) => {
        const values = bySeries.get(series);
        if (!values) return;
        let minIndex = -1;
        let maxIndex = -1;
        let minValue = Number.POSITIVE_INFINITY;
        let maxValue = Number.NEGATIVE_INFINITY;
        for (let index = start; index < end; index += 1) {
          const value = values[index];
          if (!Number.isFinite(value)) continue;
          if (value < minValue) {
            minValue = value;
            minIndex = index;
          }
          if (value > maxValue) {
            maxValue = value;
            maxIndex = index;
          }
        }
        if (minIndex >= 0) keep.add(minIndex);
        if (maxIndex >= 0) keep.add(maxIndex);
      });
    }
    return thinIndexList([...keep, ...boundaryIndexes], maximum, rowCount, boundaryIndexes);
  }

  const chartDisplaySampler = Object.freeze({
    buildDisplayIndexes,
    buildViewportIndexes,
    createViewportWindowController,
    inspectViewportCoverage,
    resolveViewportWindow,
    seriesBoundaryIndexes,
    sliceSeriesModels,
    sliceViewportArrays,
    thinIndexList,
  });
export {
  buildDisplayIndexes,
  buildViewportIndexes,
  createViewportWindowController,
  inspectViewportCoverage,
  resolveViewportWindow,
  seriesBoundaryIndexes,
  sliceSeriesModels,
  sliceViewportArrays,
  thinIndexList,
};
export default chartDisplaySampler;
