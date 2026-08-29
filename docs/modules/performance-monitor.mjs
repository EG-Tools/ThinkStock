function createPerformanceMonitor(scope = globalThis, options = {}) {
    const storageKey = options.storageKey || "thinkstock-perf-debug";
    const sampleLimit = Number(options.sampleLimit) || 80;
    const longFrameMs = Number(options.longFrameMs) || 50;
    const slowOperationMs = Number(options.slowOperationMs) || 80;
    const slowSampleLimit = Number(options.slowSampleLimit) || 30;
    const diagnosticSampleLimit = Number(options.diagnosticSampleLimit) || 120;
    const errorSampleLimit = Number(options.errorSampleLimit) || 30;
    let samples = [];
    let diagnosticSamples = [];
    let pointerDurations = [];
    let pointerDurationCursor = 0;
    let slowSamples = [];
    let errorSamples = [];
    let enabled = false;
    let latestOperations = {};
    let browserMetricsProvider = null;

    const getPerformance = () => scope.performance;
    const getStorage = () => scope.localStorage;

    function attachBrowserMetricsProvider(provider) {
      if (provider === browserMetricsProvider) return () => {};
      browserMetricsProvider?.dispose?.();
      browserMetricsProvider = provider && typeof provider === "object" ? provider : null;
      browserMetricsProvider?.setEnabled?.(enabled);
      return () => {
        if (browserMetricsProvider !== provider) return false;
        browserMetricsProvider?.dispose?.();
        browserMetricsProvider = null;
        return true;
      };
    }

    function setEnabled(nextEnabled, persist = true) {
      enabled = Boolean(nextEnabled);
      browserMetricsProvider?.setEnabled?.(enabled);
      if (persist) {
        try {
          if (enabled) getStorage()?.setItem(storageKey, "1");
          else getStorage()?.removeItem(storageKey);
        } catch (_) {}
      }
      return enabled;
    }

    function clear() {
      samples = [];
      diagnosticSamples = [];
      pointerDurations = [];
      pointerDurationCursor = 0;
      slowSamples = [];
      errorSamples = [];
      latestOperations = {};
      browserMetricsProvider?.clear?.();
    }

    function summary() {
      const pointerSamples = pointerDurations.map((duration) => ({ duration }));
      const renderSamples = diagnosticSamples.filter((sample) => sample.label === "renderChart");
      const auxiliaryRenderSamples = diagnosticSamples.filter((sample) => sample.label === "renderAdrChart");
      const refreshSamples = diagnosticSamples.filter((sample) => sample.label === "runtimeRefresh");
      const startupSamples = diagnosticSamples.filter((sample) => sample.label === "appStartup");
      const startupVisualSamples = diagnosticSamples.filter((sample) => sample.label === "startup:visual");
      const percentileDuration = (source, percentile) => {
        if (!source.length) return 0;
        const durations = source
          .map((sample) => Number(sample.duration) || 0)
          .sort((left, right) => left - right);
        return durations[Math.floor((durations.length - 1) * percentile)];
      };
      const browserMetrics = browserMetricsProvider?.summary?.() || {};
      return {
        frames: Math.max(0, Number(browserMetrics.frames) || 0),
        longFrames: Math.max(0, Number(browserMetrics.longFrames) || 0),
        maxFrameGap: Math.max(0, Number(browserMetrics.maxFrameGap) || 0),
        p95FrameGap: Math.max(0, Number(browserMetrics.p95FrameGap) || 0),
        longFrameRatio: Math.max(0, Number(browserMetrics.longFrameRatio) || 0),
        longTasks: Math.max(0, Number(browserMetrics.longTasks) || 0),
        p95LongTask: Math.max(0, Number(browserMetrics.p95LongTask) || 0),
        maxLongTask: Math.max(0, Number(browserMetrics.maxLongTask) || 0),
        latestLongTaskSource: String(browserMetrics.latestLongTaskSource || ""),
        pointerMoves: pointerSamples.length,
        p95PointerMove: percentileDuration(pointerSamples, 0.95),
        maxPointerMove: pointerSamples.reduce(
          (max, sample) => Math.max(max, sample.duration || 0),
          0,
        ),
        renderCharts: renderSamples.length,
        p95RenderChart: percentileDuration(renderSamples, 0.95),
        auxiliaryRenders: auxiliaryRenderSamples.length,
        p95AuxiliaryRender: percentileDuration(auxiliaryRenderSamples, 0.95),
        runtimeRefreshes: refreshSamples.length,
        maxRuntimeRefresh: refreshSamples.reduce(
          (max, sample) => Math.max(max, sample.duration || 0),
          0,
        ),
        startupVisuals: startupVisualSamples.length,
        p95StartupVisual: percentileDuration(startupVisualSamples, 0.95),
        appStarts: startupSamples.length,
        p95AppStartup: percentileDuration(startupSamples, 0.95),
        slowOperations: slowSamples.length,
        latestSlowOperation: slowSamples[slowSamples.length - 1]?.label || "",
        recentErrors: errorSamples.length,
        latestError: errorSamples[errorSamples.length - 1]?.source || "",
      };
    }

    function operationProfiles(limit = 8) {
      const profileLimit = Math.min(20, Math.max(1, Number(limit) || 8));
      const grouped = new Map();
      diagnosticSamples.forEach((sample) => {
        const label = String(sample?.label || "").trim();
        const duration = Number(sample?.duration);
        if (!label || !Number.isFinite(duration) || duration < 0) return;
        const current = grouped.get(label) || { durations: [], latestAt: "" };
        current.durations.push(duration);
        current.latestAt = String(sample?.at || current.latestAt || "");
        grouped.set(label, current);
      });
      if (pointerDurations.length) {
        grouped.set("pointerMove", {
          durations: [...pointerDurations],
          latestAt: String(latestOperations.pointerMove?.at || ""),
        });
      }
      const percentile = (values, ratio) => {
        if (!values.length) return 0;
        return values[Math.floor((values.length - 1) * ratio)];
      };
      return [...grouped.entries()]
        .map(([label, profile]) => {
          const durations = [...profile.durations].sort((left, right) => left - right);
          return {
            label,
            count: durations.length,
            p50: percentile(durations, 0.5),
            p95: percentile(durations, 0.95),
            max: durations[durations.length - 1] || 0,
            latestAt: profile.latestAt,
          };
        })
        .sort((left, right) => (
          right.p95 - left.p95
          || right.max - left.max
          || right.count - left.count
          || left.label.localeCompare(right.label)
        ))
        .slice(0, profileLimit);
    }

    function recordError(source, error, meta = {}) {
      const sample = {
        source: String(source || "unknown"),
        message: String(error?.message || error || "Unknown error").slice(0, 300),
        at: new Date().toISOString(),
        ...meta,
      };
      errorSamples.push(sample);
      if (errorSamples.length > errorSampleLimit) {
        errorSamples.splice(0, errorSamples.length - errorSampleLimit);
      }
      return sample;
    }

    const api = Object.freeze({
      enable: () => setEnabled(true),
      disable: () => setEnabled(false),
      get: () => [...samples],
      getLatestOperations: () => ({ ...latestOperations }),
      getOperationProfiles: (limit) => operationProfiles(limit),
      getSlowOperations: () => [...slowSamples],
      getLongTasks: () => browserMetricsProvider?.getLongTasks?.() || [],
      getRecentErrors: () => [...errorSamples],
      isEnabled: () => enabled,
      attachBrowserMetricsProvider,
      recordError,
      clear,
      summary,
    });

    function init() {
      try {
        const params = new URLSearchParams(scope.location?.search || "");
        const shouldEnable = params.get("perf") === "1" || getStorage()?.getItem(storageKey) === "1";
        setEnabled(shouldEnable, false);
      } catch (_) {
        setEnabled(false, false);
      }
      return api;
    }

    function startSample() {
      const perf = getPerformance();
      return typeof perf?.now === "function" ? perf.now() : 0;
    }

    function recordSample(label, startedAt, meta = {}) {
      const perf = getPerformance();
      if (typeof perf?.now !== "function" || !Number.isFinite(startedAt) || startedAt <= 0) return null;
      const duration = perf.now() - startedAt;
      const roundedDuration = Math.round(duration * 10) / 10;
      if (label === "pointerMove") {
        if (pointerDurations.length < diagnosticSampleLimit) {
          pointerDurations.push(roundedDuration);
        } else if (diagnosticSampleLimit > 0) {
          pointerDurations[pointerDurationCursor] = roundedDuration;
          pointerDurationCursor = (pointerDurationCursor + 1) % diagnosticSampleLimit;
        }
        const latest = latestOperations.pointerMove || { label, duration: 0, at: "" };
        latest.duration = roundedDuration;
        if (meta.chart != null) latest.chart = meta.chart;
        latestOperations.pointerMove = latest;
        if (!enabled && duration < slowOperationMs) return latest;
      }
      const sample = {
        label,
        duration: roundedDuration,
        at: new Date().toISOString(),
        ...meta,
      };
      latestOperations[label] = sample;
      if (label !== "pointerMove") {
        diagnosticSamples.push(sample);
        if (diagnosticSamples.length > diagnosticSampleLimit) {
          diagnosticSamples.splice(0, diagnosticSamples.length - diagnosticSampleLimit);
        }
      }
      if (enabled) {
        samples.push(sample);
        if (samples.length > sampleLimit) samples.splice(0, samples.length - sampleLimit);
      }
      if (duration >= slowOperationMs) {
        slowSamples.push(sample);
        if (slowSamples.length > slowSampleLimit) {
          slowSamples.splice(0, slowSamples.length - slowSampleLimit);
        }
      }
      if (enabled && duration >= longFrameMs) {
        try { scope.console?.debug?.("[ThinkStockPerf]", sample); } catch (_) {}
      }
      return sample;
    }

    return Object.freeze({
      init,
      isEnabled: () => enabled,
      startSample,
      recordSample,
      recordError,
      attachBrowserMetricsProvider,
      api,
    });
  }

  function createRuntimeDiagnosticStateCollector(readers = {}, options = {}) {
    const entries = Object.entries(readers).filter(([, reader]) => typeof reader === "function");
    const onError = typeof options.onError === "function" ? options.onError : null;

    function snapshot() {
      const state = {};
      entries.forEach(([key, reader]) => {
        try {
          const value = reader();
          if (value !== undefined) state[key] = value;
        } catch (error) {
          onError?.(error, key);
          state[key] = null;
        }
      });
      return state;
    }

    return Object.freeze({ snapshot });
  }

  function createChartRenderTelemetry(scope = globalThis, options = {}) {
    const counts = { skipped: 0, partial: 0, structural: 0, full: 0 };
    const durations = { skipped: 0, partial: 0, structural: 0, full: 0 };
    const maximums = { skipped: 0, partial: 0, structural: 0, full: 0 };
    const fallbacks = {};
    const classes = {};
    const classModes = {};
    const updateScopes = {};
    const traceBands = {};
    const seriesBands = {};
    const recent = [];
    const recentLimit = Math.max(1, Number(options.recentLimit) || 20);
    let fallbackRenderCount = 0;

    function now() {
      return typeof scope.performance?.now === "function" ? scope.performance.now() : Date.now();
    }

    function summarizeWorkload(traces = []) {
      const source = Array.isArray(traces) ? traces : [];
      const series = new Set();
      let overlayCount = 0;
      let pointCount = 0;
      source.forEach((trace) => {
        pointCount += Array.isArray(trace?.x) ? trace.x.length : 0;
        const kind = String(trace?.meta?.overlayKind || "");
        const seriesKey = String(trace?.meta?.seriesKey || "");
        if (kind === "price" && seriesKey && trace?.visible !== "legendonly") {
          series.add(seriesKey);
        } else if (kind !== "grouped-hover") {
          overlayCount += 1;
        }
      });
      return {
        traceCount: source.length,
        seriesCount: series.size,
        overlayCount,
        pointCount,
      };
    }

    function begin(invalidation = {}, traces = []) {
      const workload = summarizeWorkload(traces);
      return Object.freeze({
        startedAt: now(),
        transactionId: Number(invalidation.transactionId) || 0,
        requestCount: Math.max(1, Number(invalidation.requestCount) || 1),
        traceCount: Math.max(0, Number(invalidation.traceCount) || workload.traceCount),
        seriesCount: Math.max(0, Number(invalidation.seriesCount) || workload.seriesCount),
        overlayCount: Math.max(0, Number(invalidation.overlayCount) || workload.overlayCount),
        pointCount: Math.max(0, Number(invalidation.pointCount) || workload.pointCount),
        updateClasses: [...(invalidation.updateClasses || [])],
      });
    }

    function traceBand(traceCount) {
      if (traceCount <= 1) return "1";
      if (traceCount <= 5) return "2-5";
      if (traceCount <= 10) return "6-10";
      return "11+";
    }

    function complete(token, result = {}) {
      const mode = ["skipped", "partial", "structural", "full"].includes(result.mode)
        ? result.mode
        : "full";
      const duration = Math.max(0, now() - Number(token?.startedAt || now()));
      const updateClasses = token?.updateClasses?.length ? token.updateClasses : ["unknown"];
      const fallbackPaths = [...new Set((result.fallbacks || []).map(String).filter(Boolean))];
      const updateScope = String(result.updateScope || "");
      const band = traceBand(Number(token?.traceCount) || 0);
      const seriesBand = traceBand(Number(token?.seriesCount) || 0);
      counts[mode] += 1;
      durations[mode] += duration;
      maximums[mode] = Math.max(maximums[mode], duration);
      updateClasses.forEach((key) => {
        classes[key] = (Number(classes[key]) || 0) + 1;
        classModes[key] ||= { skipped: 0, partial: 0, structural: 0, full: 0 };
        classModes[key][mode] += 1;
      });
      fallbackPaths.forEach((key) => {
        fallbacks[key] = (Number(fallbacks[key]) || 0) + 1;
      });
      if (fallbackPaths.length) fallbackRenderCount += 1;
      if (updateScope) updateScopes[updateScope] = (Number(updateScopes[updateScope]) || 0) + 1;
      traceBands[band] ||= { renders: 0, full: 0, totalMs: 0, maximumMs: 0, maximumPoints: 0 };
      traceBands[band].renders += 1;
      traceBands[band].full += mode === "full" ? 1 : 0;
      traceBands[band].totalMs += duration;
      traceBands[band].maximumMs = Math.max(traceBands[band].maximumMs, duration);
      traceBands[band].maximumPoints = Math.max(
        traceBands[band].maximumPoints,
        Number(token?.pointCount) || 0,
      );
      seriesBands[seriesBand] ||= {
        renders: 0,
        full: 0,
        totalMs: 0,
        maximumMs: 0,
        maximumOverlays: 0,
        maximumPoints: 0,
      };
      seriesBands[seriesBand].renders += 1;
      seriesBands[seriesBand].full += mode === "full" ? 1 : 0;
      seriesBands[seriesBand].totalMs += duration;
      seriesBands[seriesBand].maximumMs = Math.max(seriesBands[seriesBand].maximumMs, duration);
      seriesBands[seriesBand].maximumOverlays = Math.max(
        seriesBands[seriesBand].maximumOverlays,
        Number(token?.overlayCount) || 0,
      );
      seriesBands[seriesBand].maximumPoints = Math.max(
        seriesBands[seriesBand].maximumPoints,
        Number(token?.pointCount) || 0,
      );
      recent.push(Object.freeze({
        transactionId: Number(token?.transactionId) || 0,
        requestCount: Math.max(1, Number(token?.requestCount) || 1),
        mode,
        durationMs: Math.round(duration * 10) / 10,
        traceCount: Number(token?.traceCount) || 0,
        seriesCount: Number(token?.seriesCount) || 0,
        overlayCount: Number(token?.overlayCount) || 0,
        pointCount: Number(token?.pointCount) || 0,
        updateClasses: Object.freeze([...updateClasses]),
        fallbacks: Object.freeze(fallbackPaths),
        ...(updateScope ? { updateScope } : {}),
      }));
      while (recent.length > recentLimit) recent.shift();
      return duration;
    }

    function snapshot() {
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      const ratio = (value) => (total ? Math.round((value / total) * 1000) / 1000 : 0);
      return Object.freeze({
        total,
        counts: Object.freeze({ ...counts }),
        fullRenderRate: ratio(counts.full),
        partialReuseRate: ratio(counts.skipped + counts.partial + counts.structural),
        fallbackRate: ratio(fallbackRenderCount),
        averageMs: Object.freeze(Object.fromEntries(Object.keys(counts).map((mode) => [
          mode,
          counts[mode] ? Math.round((durations[mode] / counts[mode]) * 10) / 10 : 0,
        ]))),
        maximumMs: Object.freeze(Object.fromEntries(Object.entries(maximums)
          .map(([key, value]) => [key, Math.round(value * 10) / 10]))),
        fallbacks: Object.freeze({ ...fallbacks }),
        updateScopes: Object.freeze({ ...updateScopes }),
        updateClasses: Object.freeze({ ...classes }),
        byUpdateClass: Object.freeze(Object.fromEntries(Object.entries(classModes).map(([key, value]) => [
          key,
          Object.freeze({
            ...value,
            total: value.skipped + value.partial + value.structural + value.full,
          }),
        ]))),
        byTraceBand: Object.freeze(Object.fromEntries(Object.entries(traceBands).map(([key, value]) => [
          key,
          Object.freeze({
            renders: value.renders,
            full: value.full,
            averageMs: value.renders
              ? Math.round((value.totalMs / value.renders) * 10) / 10
              : 0,
            maximumMs: Math.round(value.maximumMs * 10) / 10,
            maximumPoints: value.maximumPoints,
          }),
        ]))),
        bySeriesBand: Object.freeze(Object.fromEntries(Object.entries(seriesBands).map(([key, value]) => [
          key,
          Object.freeze({
            renders: value.renders,
            full: value.full,
            averageMs: value.renders
              ? Math.round((value.totalMs / value.renders) * 10) / 10
              : 0,
            maximumMs: Math.round(value.maximumMs * 10) / 10,
            maximumOverlays: value.maximumOverlays,
            maximumPoints: value.maximumPoints,
          }),
        ]))),
        recent: Object.freeze([...recent]),
      });
    }

    return Object.freeze({ begin, complete, snapshot });
  }

export {
  createChartRenderTelemetry,
  createPerformanceMonitor,
  createRuntimeDiagnosticStateCollector,
};
