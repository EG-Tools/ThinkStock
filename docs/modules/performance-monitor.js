(function initThinkStockPerformanceMonitor(globalScope) {
  function createPerformanceMonitor(scope = globalScope, options = {}) {
    const storageKey = options.storageKey || "thinkstock-perf-debug";
    const sampleLimit = Number(options.sampleLimit) || 80;
    const frameGapIgnoreMs = Number(options.frameGapIgnoreMs) || 1000;
    const frameSampleLimit = Number(options.frameSampleLimit) || 1200;
    const longFrameMs = Number(options.longFrameMs) || 50;
    const longTaskSampleLimit = Number(options.longTaskSampleLimit) || 40;
    const slowOperationMs = Number(options.slowOperationMs) || 80;
    const slowSampleLimit = Number(options.slowSampleLimit) || 30;
    const autoObserveLongTasks = options.autoObserveLongTasks !== false;
    let samples = [];
    let slowSamples = [];
    let enabled = false;
    let frameRafId = 0;
    let lastFrameAt = 0;
    let frameStats = { frames: 0, longFrames: 0, maxFrameGap: 0 };
    let frameGaps = [];
    let longTasks = [];
    let longTaskObserver = null;

    const getPerformance = () => scope.performance;
    const getStorage = () => scope.localStorage;

    function stopFrameMonitor() {
      if (frameRafId && typeof scope.cancelAnimationFrame === "function") {
        scope.cancelAnimationFrame(frameRafId);
      }
      frameRafId = 0;
      lastFrameAt = 0;
    }

    function startFrameMonitor() {
      if (!enabled || frameRafId || typeof scope.requestAnimationFrame !== "function") return;
      const tick = (timestamp) => {
        frameRafId = 0;
        if (!enabled) return;
        if (lastFrameAt > 0 && scope.document?.visibilityState === "visible") {
          const gap = timestamp - lastFrameAt;
          if (gap > 0 && gap < frameGapIgnoreMs) {
            const roundedGap = Math.round(gap * 10) / 10;
            frameStats.frames += 1;
            frameStats.maxFrameGap = Math.max(frameStats.maxFrameGap, roundedGap);
            frameGaps.push(roundedGap);
            if (frameGaps.length > frameSampleLimit) frameGaps.shift();
            if (gap >= longFrameMs) frameStats.longFrames += 1;
          }
        }
        lastFrameAt = timestamp;
        frameRafId = scope.requestAnimationFrame(tick);
      };
      frameRafId = scope.requestAnimationFrame(tick);
    }

    function stopLongTaskMonitor() {
      try { longTaskObserver?.disconnect?.(); } catch (_) {}
      longTaskObserver = null;
    }

    function startLongTaskMonitor() {
      if ((!enabled && !autoObserveLongTasks)
        || longTaskObserver
        || typeof scope.PerformanceObserver !== "function") return;
      try {
        longTaskObserver = new scope.PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            const attribution = Array.isArray(entry.attribution) ? entry.attribution[0] : null;
            longTasks.push({
              duration: Math.round((Number(entry.duration) || 0) * 10) / 10,
              startTime: Math.round((Number(entry.startTime) || 0) * 10) / 10,
              source: String(
                attribution?.containerId
                || attribution?.containerName
                || attribution?.name
                || entry.name
                || "main-thread",
              ),
            });
          });
          if (longTasks.length > longTaskSampleLimit) {
            longTasks.splice(0, longTasks.length - longTaskSampleLimit);
          }
        });
        longTaskObserver.observe({ type: "longtask", buffered: true });
      } catch (_) {
        stopLongTaskMonitor();
      }
    }

    function setEnabled(nextEnabled, persist = true) {
      enabled = Boolean(nextEnabled);
      if (enabled) {
        startFrameMonitor();
        startLongTaskMonitor();
      } else {
        stopFrameMonitor();
        if (!autoObserveLongTasks) stopLongTaskMonitor();
      }
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
      slowSamples = [];
      lastFrameAt = 0;
      frameStats = { frames: 0, longFrames: 0, maxFrameGap: 0 };
      frameGaps = [];
      longTasks = [];
    }

    function summary() {
      const pointerSamples = samples.filter((sample) => sample.label === "pointerMove");
      const renderSamples = samples.filter((sample) => sample.label === "renderChart");
      const auxiliaryRenderSamples = samples.filter((sample) => sample.label === "renderAdrChart");
      const refreshSamples = samples.filter((sample) => sample.label === "runtimeRefresh");
      const startupSamples = samples.filter((sample) => sample.label === "appStartup");
      const percentileDuration = (source, percentile) => {
        if (!source.length) return 0;
        const durations = source
          .map((sample) => Number(sample.duration) || 0)
          .sort((left, right) => left - right);
        return durations[Math.floor((durations.length - 1) * percentile)];
      };
      const sortedFrameGaps = [...frameGaps].sort((left, right) => left - right);
      const p95FrameGap = sortedFrameGaps.length
        ? sortedFrameGaps[Math.floor((sortedFrameGaps.length - 1) * 0.95)]
        : 0;
      const sortedLongTasks = [...longTasks].sort((left, right) => left.duration - right.duration);
      return {
        ...frameStats,
        p95FrameGap,
        longFrameRatio: frameStats.frames > 0 ? frameStats.longFrames / frameStats.frames : 0,
        longTasks: longTasks.length,
        p95LongTask: sortedLongTasks.length
          ? sortedLongTasks[Math.floor((sortedLongTasks.length - 1) * 0.95)].duration
          : 0,
        maxLongTask: sortedLongTasks.length ? sortedLongTasks[sortedLongTasks.length - 1].duration : 0,
        latestLongTaskSource: longTasks[longTasks.length - 1]?.source || "",
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
        appStarts: startupSamples.length,
        p95AppStartup: percentileDuration(startupSamples, 0.95),
        slowOperations: slowSamples.length,
        latestSlowOperation: slowSamples[slowSamples.length - 1]?.label || "",
      };
    }

    const api = Object.freeze({
      enable: () => setEnabled(true),
      disable: () => setEnabled(false),
      get: () => [...samples],
      getSlowOperations: () => [...slowSamples],
      getLongTasks: () => [...longTasks],
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
      startLongTaskMonitor();
      scope.ThinkStockPerf = api;
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
      const sample = {
        label,
        duration: Math.round(duration * 10) / 10,
        at: new Date().toISOString(),
        ...meta,
      };
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
      startFrameMonitor,
      stopFrameMonitor,
      startLongTaskMonitor,
      stopLongTaskMonitor,
      api,
    });
  }

  globalScope.ThinkStockPerformanceMonitor = Object.freeze({ createPerformanceMonitor });
}(typeof self !== "undefined" ? self : globalThis));
