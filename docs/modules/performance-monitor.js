(function initThinkStockPerformanceMonitor(globalScope) {
  function createPerformanceMonitor(scope = globalScope, options = {}) {
    const storageKey = options.storageKey || "thinkstock-perf-debug";
    const sampleLimit = Number(options.sampleLimit) || 80;
    const frameGapIgnoreMs = Number(options.frameGapIgnoreMs) || 1000;
    const frameSampleLimit = Number(options.frameSampleLimit) || 1200;
    const longFrameMs = Number(options.longFrameMs) || 50;
    let samples = [];
    let enabled = false;
    let frameRafId = 0;
    let lastFrameAt = 0;
    let frameStats = { frames: 0, longFrames: 0, maxFrameGap: 0 };
    let frameGaps = [];

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

    function setEnabled(nextEnabled, persist = true) {
      enabled = Boolean(nextEnabled);
      if (enabled) startFrameMonitor();
      else stopFrameMonitor();
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
      lastFrameAt = 0;
      frameStats = { frames: 0, longFrames: 0, maxFrameGap: 0 };
      frameGaps = [];
    }

    function summary() {
      const pointerSamples = samples.filter((sample) => sample.label === "pointerMove");
      const refreshSamples = samples.filter((sample) => sample.label === "runtimeRefresh");
      const sortedFrameGaps = [...frameGaps].sort((left, right) => left - right);
      const p95FrameGap = sortedFrameGaps.length
        ? sortedFrameGaps[Math.floor((sortedFrameGaps.length - 1) * 0.95)]
        : 0;
      return {
        ...frameStats,
        p95FrameGap,
        longFrameRatio: frameStats.frames > 0 ? frameStats.longFrames / frameStats.frames : 0,
        pointerMoves: pointerSamples.length,
        maxPointerMove: pointerSamples.reduce(
          (max, sample) => Math.max(max, sample.duration || 0),
          0,
        ),
        runtimeRefreshes: refreshSamples.length,
        maxRuntimeRefresh: refreshSamples.reduce(
          (max, sample) => Math.max(max, sample.duration || 0),
          0,
        ),
      };
    }

    const api = Object.freeze({
      enable: () => setEnabled(true),
      disable: () => setEnabled(false),
      get: () => [...samples],
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
      scope.ThinkStockPerf = api;
      return api;
    }

    function startSample() {
      const perf = getPerformance();
      return enabled && typeof perf?.now === "function" ? perf.now() : 0;
    }

    function recordSample(label, startedAt, meta = {}) {
      const perf = getPerformance();
      if (!enabled || typeof perf?.now !== "function" || !Number.isFinite(startedAt)) return null;
      const duration = perf.now() - startedAt;
      const sample = {
        label,
        duration: Math.round(duration * 10) / 10,
        at: new Date().toISOString(),
        ...meta,
      };
      samples.push(sample);
      if (samples.length > sampleLimit) samples.splice(0, samples.length - sampleLimit);
      if (duration >= longFrameMs) {
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
      api,
    });
  }

  globalScope.ThinkStockPerformanceMonitor = Object.freeze({ createPerformanceMonitor });
}(typeof self !== "undefined" ? self : globalThis));
