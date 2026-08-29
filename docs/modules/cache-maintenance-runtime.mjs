"use strict";

  function parseJson(value) {
    try { return JSON.parse(String(value || "null")); } catch (_) { return null; }
  }

  function createCacheMigrator(scope = globalThis, options = {}) {
    const storage = options.storage || scope.localStorage;
    const markerKey = String(options.markerKey || "thinkstock-cache-migrations-v1");
    const migrations = [...(Array.isArray(options.migrations) ? options.migrations : [])]
      .filter((entry) => Number.isInteger(Number(entry?.version)) && typeof entry?.migrate === "function")
      .sort((left, right) => Number(left.version) - Number(right.version));
    const currentVersion = Math.max(0, Math.round(Number(options.currentVersion) || 0));

    function readJson(key) {
      try { return parseJson(storage?.getItem(key)); } catch (_) { return null; }
    }

    function writeJson(key, value) {
      storage?.setItem(key, JSON.stringify(value));
      return value;
    }

    function copyFirstAvailable(targetKey, sourceKeys, transform = (value) => value) {
      if (storage?.getItem(targetKey) != null) return false;
      for (const sourceKey of Array.isArray(sourceKeys) ? sourceKeys : []) {
        const source = readJson(sourceKey);
        if (!source || typeof source !== "object") continue;
        const next = transform(source, sourceKey);
        if (!next || typeof next !== "object") continue;
        writeJson(targetKey, next);
        return true;
      }
      return false;
    }

    function updateJson(key, updater) {
      const current = readJson(key);
      if (!current || typeof current !== "object") return false;
      const next = updater(current);
      if (!next || typeof next !== "object") return false;
      writeJson(key, next);
      return true;
    }

    function storedVersion() {
      try {
        return Math.max(0, Math.min(currentVersion, Math.round(Number(storage?.getItem(markerKey)) || 0)));
      } catch (_) {
        return 0;
      }
    }

    function run() {
      const fromVersion = storedVersion();
      let version = fromVersion;
      const applied = [];
      try {
        for (const entry of migrations) {
          const targetVersion = Number(entry.version);
          if (targetVersion <= version || targetVersion > currentVersion) continue;
          entry.migrate({ copyFirstAvailable, readJson, storage, updateJson, writeJson });
          storage?.setItem(markerKey, String(targetVersion));
          version = targetVersion;
          applied.push(targetVersion);
        }
        if (version < currentVersion && migrations.every((entry) => Number(entry.version) <= version)) {
          storage?.setItem(markerKey, String(currentVersion));
          version = currentVersion;
        }
        return { ok: true, fromVersion, version, applied };
      } catch (error) {
        return { ok: false, fromVersion, version, applied, error };
      }
    }

    return Object.freeze({ run, storedVersion });
  }

  function createCacheMaintenanceRuntime(scope = globalThis, options = {}) {
    const store = options.store;
    const lifecyclePolicy = options.lifecyclePolicy;
    if (!store || !lifecyclePolicy) {
      throw new Error("cache maintenance dependencies are incomplete");
    }
    const pruneIntervalMs = Math.max(0, Number(options.pruneIntervalMs) || 0);
    const defaultStoreNames = [...new Set((options.storeNames || []).map(String).filter(Boolean))];
    const validators = options.validators instanceof Map
      ? options.validators
      : new Map(Object.entries(options.validators || {}));
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    const scheduler = options.scheduler || null;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const stateStore = options.stateStore || null;
    const repairVersions = new Map(Object.entries(options.repairVersions || {}));
    const pruneTasks = new Map();
    const pruneSchedules = new Map();
    const storedState = (() => {
      try {
        const value = stateStore?.read?.({});
        return value && typeof value === "object" ? value : {};
      } catch (_) {
        return {};
      }
    })();
    const lastPrunedAt = new Map(Object.entries(storedState.prunedAt || {}).map(
      ([key, value]) => [key, Math.max(0, Number(value) || 0)],
    ));
    const completedRepairVersions = new Map(Object.entries(storedState.repairVersions || {}).map(
      ([key, value]) => [key, String(value || "")],
    ));
    let nextStoreIndex = Math.max(0, Number(storedState.nextStoreIndex) || 0);
    const counters = { runs: 0, transactions: 0, deleted: 0, repaired: 0 };

    function persistState() {
      if (!stateStore?.write) return;
      try {
        stateStore.write({
          prunedAt: Object.fromEntries(lastPrunedAt),
          repairVersions: Object.fromEntries(completedRepairVersions),
          nextStoreIndex,
        });
      } catch (_) {
        // Cache maintenance metadata must never block normal cache reads.
      }
    }

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

    async function pruneStore(storeName, maxRecords = null, taskContext = null) {
      const key = String(storeName || "");
      const activeTask = pruneTasks.get(key);
      if (activeTask) return activeTask;
      const task = (async () => {
        let deletedCount = 0;
        let completed = false;
        try {
          await taskContext?.checkpoint?.();
          if (taskContext?.signal?.aborted) return 0;
          const validate = validators.get(key);
          const repairVersion = String(repairVersions.get(key) || "");
          const needsRepair = validate
            && typeof store.repairStore === "function"
            && (!repairVersion || completedRepairVersions.get(key) !== repairVersion);
          if (needsRepair) {
            const repairedCount = await store.repairStore(key, validate);
            if (repairedCount > 0) {
              counters.transactions += 1;
              counters.deleted += repairedCount;
              counters.repaired += repairedCount;
              deletedCount += repairedCount;
            }
            if (repairVersion) completedRepairVersions.set(key, repairVersion);
          }
          await taskContext?.checkpoint?.();
          if (taskContext?.signal?.aborted) return 0;
          const policy = lifecyclePolicy.storePolicy(key, {
            ...(maxRecords != null && Number.isFinite(Number(maxRecords)) && Number(maxRecords) > 0
              ? { maxRecords: Number(maxRecords) }
              : {}),
          });
          const prunedCount = await store.pruneStore(key, {
            maxRecords: policy.maxRecords,
            maxIdleMs: policy.maxIdleMs,
          });
          deletedCount += prunedCount;
          if (prunedCount > 0) {
            counters.transactions += 1;
            counters.deleted += prunedCount;
          }
          completed = true;
        } catch (_) {
          deletedCount = 0;
        } finally {
          counters.runs += 1;
          if (completed) {
            lastPrunedAt.set(key, now());
            persistState();
          }
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
      const repairVersion = String(repairVersions.get(key) || "");
      const repairPending = Boolean(
        repairVersion
        && validators.has(key)
        && completedRepairVersions.get(key) !== repairVersion
      );
      if (!repairPending
        && now() - (Number(lastPrunedAt.get(key)) || 0) < pruneIntervalMs) {
        return Promise.resolve(0);
      }

      let resolveSchedule;
      const promise = new Promise((resolve) => { resolveSchedule = resolve; });
      if (scheduler?.enqueue) {
        const scheduled = scheduler.enqueue(`cache-prune:${key}`, (taskContext) => (
          pruneStore(key, maxRecords, taskContext)
        ), {
          group: "cache-maintenance",
          delayMs: Math.max(0, Number(delayMs) || 0),
          priority: -30,
        });
        pruneSchedules.set(key, { promise, scheduled });
        scheduled.then(resolveSchedule, () => resolveSchedule(0)).finally(() => {
          pruneSchedules.delete(key);
        });
        return promise;
      }
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

    function scheduleDueBatch(delayMs = 2500, maxStores = 3, staggerMs = 1200) {
      if (!defaultStoreNames.length) return [];
      const currentTime = now();
      const limit = Math.min(
        defaultStoreNames.length,
        Math.max(1, Math.round(Number(maxStores) || 3)),
      );
      const ordered = Array.from({ length: defaultStoreNames.length }, (_, offset) => (
        (nextStoreIndex + offset) % defaultStoreNames.length
      ));
      const selectedIndexes = ordered.filter((index) => {
        const key = defaultStoreNames[index];
        const repairVersion = String(repairVersions.get(key) || "");
        const repairPending = Boolean(
          repairVersion
          && validators.has(key)
          && completedRepairVersions.get(key) !== repairVersion
        );
        return repairPending
          || currentTime - (Number(lastPrunedAt.get(key)) || 0) >= pruneIntervalMs;
      }).slice(0, limit);
      if (!selectedIndexes.length) return [];
      nextStoreIndex = (selectedIndexes.at(-1) + 1) % defaultStoreNames.length;
      persistState();
      return selectedIndexes.map((index, order) => schedulePrune(
        defaultStoreNames[index],
        null,
        Math.max(0, Number(delayMs) || 0) + order * Math.max(0, Number(staggerMs) || 0),
      ));
    }

    function dispose() {
      pruneSchedules.forEach(({ timer }, key) => {
        if (timer) clearTimer?.(timer);
        scheduler?.cancel?.(`cache-prune:${key}`);
      });
      pruneSchedules.clear();
    }

    return Object.freeze({
      dispose,
      pruneStore,
      readActiveRecord,
      removeInvalidRecord,
      scheduleAll,
      scheduleDueBatch,
      schedulePrune,
      stats: () => Object.freeze({
        ...counters,
        activePrunes: pruneTasks.size,
        scheduledPrunes: pruneSchedules.size,
      }),
    });
  }

export { createCacheMaintenanceRuntime, createCacheMigrator, parseJson };
