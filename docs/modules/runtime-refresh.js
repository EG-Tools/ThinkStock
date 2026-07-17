(function initThinkStockRuntimeRefresh(global) {
  function startTaskFactories(taskFactories) {
    return (Array.isArray(taskFactories) ? taskFactories : []).map((factory) => (
      Promise.resolve().then(() => factory())
    ));
  }

  async function runRefreshPhases(options = {}) {
    const criticalPromise = Promise.all(startTaskFactories(options.criticalTasks));
    const supplementalPromise = Promise.all(startTaskFactories(options.supplementalTasks));
    // Prevent an early supplemental rejection from becoming unhandled while critical work finishes.
    supplementalPromise.catch(() => {});

    const criticalResults = await criticalPromise;
    if (typeof options.onCritical === "function") await options.onCritical(criticalResults);

    const supplementalResults = await supplementalPromise;
    if (typeof options.onSupplemental === "function") await options.onSupplemental(supplementalResults);

    return { criticalResults, supplementalResults };
  }

  global.ThinkStockRuntimeRefresh = { runRefreshPhases };
}(typeof self !== "undefined" ? self : globalThis));
