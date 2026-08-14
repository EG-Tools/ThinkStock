(function initThinkStockCacheMaintenanceRuntime(globalScope) {
  "use strict";

  function createCacheMaintenanceRuntime(scope = globalScope, options = {}) {
    const store = options.store;
    const lifecyclePolicy = options.lifecyclePolicy;
    if (!store || !lifecyclePolicy) {
      throw new Error("cache maintenance dependencies are incomplete");
    }
    const pruneIntervalMs = Math.max(0, Number(options.pruneIntervalMs) || 0);
    const defaultStoreNames = [...new Set((options.storeNames || []).map(String).filter(Boolean))];
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    const now = typeof options.now === "function" ? options.now : Date.now;
    const pruneTasks = new Map();
    const pruneSchedules = new Map();
    const lastPrunedAt = new Map();
    const counters = { runs: 0, transactions: 0, deleted: 0, repaired: 0 };

    async function readActiveRecord(storeName, key) {
      const record = await store.readRecord(storeName, key);
      if (!record) return null;
      if (lifecyclePolicy.recordLifecycle(record, storeName, { now: now() }) === "active") return record;
      await store.deleteRecord(storeName, key).catch(() => {});
      counters.transactions += 1;
      counters.deleted += 1;
      return null;
    }

    async function removeInvalidRecord(storeName, key) {
      try {
        await store.deleteRecord(storeName, key);
        counters.transactions += 1;
        counters.deleted += 1;
        counters.repaired += 1;
        return true;
      } catch (_) {
        return false;
      }
    }

    async function pruneStore(storeName, maxRecords = null) {
      const key = String(storeName || "");
      const activeTask = pruneTasks.get(key);
      if (activeTask) return activeTask;
      const task = (async () => {
        let deletedCount = 0;
        try {
          const policy = lifecyclePolicy.storePolicy(key, {
            ...(maxRecords != null && Number.isFinite(Number(maxRecords)) && Number(maxRecords) > 0
              ? { maxRecords: Number(maxRecords) }
              : {}),
          });
          deletedCount = await store.pruneStore(key, {
            maxRecords: policy.maxRecords,
            maxIdleMs: policy.maxIdleMs,
          });
          if (deletedCount > 0) {
            counters.transactions += 1;
            counters.deleted += deletedCount;
          }
        } catch (_) {
          deletedCount = 0;
        } finally {
          counters.runs += 1;
          lastPrunedAt.set(key, now());
        }
        return deletedCount;
      })().finally(() => pruneTasks.delete(key));
      pruneTasks.set(key, task);
      return task;
    }

    function schedulePrune(storeName, maxRecords = null, delayMs = 2500) {
      const key = String(storeName || "");
      if (!key) return Promise.resolve(0);
      const activeTask = pruneTasks.get(key);
      if (activeTask) return activeTask;
      const scheduled = pruneSchedules.get(key);
      if (scheduled) return scheduled.promise;
      if (now() - (Number(lastPrunedAt.get(key)) || 0) < pruneIntervalMs) return Promise.resolve(0);

      let resolveSchedule;
      const promise = new Promise((resolve) => { resolveSchedule = resolve; });
      const timer = setTimer?.(() => {
        pruneSchedules.delete(key);
        pruneStore(key, maxRecords).then(resolveSchedule, () => resolveSchedule(0));
      }, Math.max(0, Number(delayMs) || 0));
      pruneSchedules.set(key, { promise, timer });
      return promise;
    }

    function scheduleAll(delayMs = 2500) {
      return defaultStoreNames.map((storeName) => schedulePrune(storeName, null, delayMs));
    }

    function dispose() {
      pruneSchedules.forEach(({ timer }) => {
        if (timer) clearTimer?.(timer);
      });
      pruneSchedules.clear();
    }

    return Object.freeze({
      dispose,
      pruneStore,
      readActiveRecord,
      removeInvalidRecord,
      scheduleAll,
      schedulePrune,
      stats: () => Object.freeze({
        ...counters,
        activePrunes: pruneTasks.size,
        scheduledPrunes: pruneSchedules.size,
      }),
    });
  }

  globalScope.ThinkStockCacheMaintenanceRuntime = Object.freeze({
    createCacheMaintenanceRuntime,
  });
}(typeof self !== "undefined" ? self : globalThis));
