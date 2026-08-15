(function initThinkStockChartRenderTelemetry(globalScope) {
  "use strict";

  function createChartRenderTelemetry(scope = globalScope, options = {}) {
    const counts = { partial: 0, structural: 0, full: 0 };
    const durations = { partial: 0, structural: 0, full: 0 };
    const maximums = { partial: 0, structural: 0, full: 0 };
    const fallbacks = {};
    const classes = {};
    const classModes = {};
    const updateScopes = {};
    const recent = [];
    const recentLimit = Math.max(1, Number(options.recentLimit) || 20);
    let fallbackRenderCount = 0;

    function now() {
      return typeof scope.performance?.now === "function" ? scope.performance.now() : Date.now();
    }

    function begin(invalidation = {}) {
      return Object.freeze({
        startedAt: now(),
        transactionId: Number(invalidation.transactionId) || 0,
        requestCount: Math.max(1, Number(invalidation.requestCount) || 1),
        updateClasses: [...(invalidation.updateClasses || [])],
      });
    }

    function complete(token, result = {}) {
      const mode = ["partial", "structural", "full"].includes(result.mode) ? result.mode : "full";
      const duration = Math.max(0, now() - Number(token?.startedAt || now()));
      const updateClasses = token?.updateClasses?.length ? token.updateClasses : ["unknown"];
      const fallbackPaths = [...new Set((result.fallbacks || []).map(String).filter(Boolean))];
      const updateScope = String(result.updateScope || "");
      counts[mode] += 1;
      durations[mode] += duration;
      maximums[mode] = Math.max(maximums[mode], duration);
      updateClasses.forEach((key) => {
        classes[key] = (Number(classes[key]) || 0) + 1;
        classModes[key] ||= { partial: 0, structural: 0, full: 0 };
        classModes[key][mode] += 1;
      });
      fallbackPaths.forEach((key) => {
        fallbacks[key] = (Number(fallbacks[key]) || 0) + 1;
      });
      if (fallbackPaths.length) fallbackRenderCount += 1;
      if (updateScope) updateScopes[updateScope] = (Number(updateScopes[updateScope]) || 0) + 1;
      recent.push(Object.freeze({
        transactionId: Number(token?.transactionId) || 0,
        requestCount: Math.max(1, Number(token?.requestCount) || 1),
        mode,
        durationMs: Math.round(duration * 10) / 10,
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
        partialReuseRate: ratio(counts.partial + counts.structural),
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
            total: value.partial + value.structural + value.full,
          }),
        ]))),
        recent: Object.freeze([...recent]),
      });
    }

    return Object.freeze({ begin, complete, snapshot });
  }

  globalScope.ThinkStockChartRenderTelemetry = Object.freeze({ createChartRenderTelemetry });
}(typeof self !== "undefined" ? self : globalThis));
