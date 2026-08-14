(function initThinkStockRuntimeSnapshotController(globalScope) {
  "use strict";

  function createRuntimeSnapshotController(scope = globalScope, options = {}) {
    if (typeof options.getSignature !== "function"
      || typeof options.buildSnapshot !== "function"
      || typeof options.applySnapshot !== "function") {
      throw new Error("runtime snapshot controller dependencies are incomplete");
    }
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    const requestIdle = options.requestIdle || scope.requestIdleCallback?.bind(scope);
    const cancelIdle = options.cancelIdle || scope.cancelIdleCallback?.bind(scope);
    const idleTimeoutMs = Math.max(0, Number(options.idleTimeoutMs) || 3500);
    let idleTimer = 0;
    let saveTimer = 0;
    let writePromise = null;
    let writeSignature = "";
    let savedSignature = "";
    let persistedRevisions = {};
    let exitBound = false;
    const counters = { builds: 0, writes: 0, skips: 0, componentWrites: 0 };

    function cancelIdleSave() {
      if (!idleTimer) return;
      if (typeof cancelIdle === "function") {
        try { cancelIdle(idleTimer); } catch (_) {}
      } else {
        clearTimer?.(idleTimer);
      }
      idleTimer = 0;
    }

    function cancelScheduledSave() {
      if (saveTimer) clearTimer?.(saveTimer);
      saveTimer = 0;
      cancelIdleSave();
    }

    async function read() {
      try {
        const snapshot = await options.readPrimary?.();
        if (snapshot) return snapshot;
      } catch (_) {}
      return options.readFallback?.() || null;
    }

    async function clear() {
      cancelScheduledSave();
      if (writePromise) await writePromise.catch(() => false);
      try { await options.deletePrimary?.(); } catch (_) {}
      try { options.deleteFallback?.(); } catch (_) {}
      savedSignature = "";
      persistedRevisions = {};
    }

    async function load() {
      const snapshot = await read();
      const applied = options.applySnapshot(snapshot);
      if (!applied && snapshot) await clear();
      return applied;
    }

    async function save() {
      const signature = String(options.getSignature() || "");
      if (signature === savedSignature) {
        counters.skips += 1;
        return false;
      }
      if (writePromise) {
        if (signature === writeSignature) {
          counters.skips += 1;
          return writePromise;
        }
        await writePromise.catch(() => false);
        return save();
      }

      counters.builds += 1;
      const snapshotBundle = options.buildSnapshot();
      if (!snapshotBundle) return false;
      const task = (async () => {
        try {
          await options.writePrimary?.(snapshotBundle);
          persistedRevisions = { ...(snapshotBundle.manifest?.revisions || {}) };
          counters.componentWrites += Object.keys(snapshotBundle.components || {}).length;
          try { options.deleteFallback?.(); } catch (_) {}
          return true;
        } catch (primaryError) {
          try {
            options.writeFallback?.(options.buildFallbackSnapshot?.());
            return true;
          } catch (fallbackError) {
            throw new Error(
              fallbackError?.message || primaryError?.message || "runtime cache write failed",
            );
          }
        }
      })();
      writePromise = task;
      writeSignature = signature;
      try {
        const saved = await task;
        if (saved) {
          savedSignature = signature;
          counters.writes += 1;
        }
        return saved;
      } finally {
        if (writePromise === task) {
          writePromise = null;
          writeSignature = "";
        }
      }
    }

    function queueIdleSave() {
      cancelIdleSave();
      const run = () => {
        idleTimer = 0;
        if (options.isInteractionBusy?.()) {
          schedule(1200);
          return;
        }
        save().catch(() => {});
      };
      if (typeof requestIdle === "function") {
        idleTimer = requestIdle(run, { timeout: idleTimeoutMs });
      } else {
        idleTimer = setTimer?.(run, 250) || 0;
      }
    }

    function schedule(delayMs = 1500) {
      if (saveTimer) clearTimer?.(saveTimer);
      saveTimer = setTimer?.(() => {
        saveTimer = 0;
        queueIdleSave();
      }, Math.max(0, Number(delayMs) || 0)) || 0;
    }

    async function prepareForClear() {
      cancelScheduledSave();
      if (writePromise) await writePromise.catch(() => false);
      savedSignature = "";
      persistedRevisions = {};
    }

    function markRestored(signature, revisions = {}) {
      savedSignature = String(signature || "");
      persistedRevisions = { ...(revisions || {}) };
    }

    function bindExitSave() {
      if (exitBound || !scope?.addEventListener) return false;
      exitBound = true;
      const flush = () => {
        if (saveTimer) clearTimer?.(saveTimer);
        saveTimer = 0;
        cancelIdleSave();
        save().catch(() => {});
      };
      scope.addEventListener("pagehide", flush);
      scope.document?.addEventListener?.("visibilitychange", () => {
        if (scope.document.visibilityState === "hidden") flush();
      });
      return true;
    }

    return Object.freeze({
      bindExitSave,
      cancelScheduledSave,
      clear,
      load,
      markRestored,
      persistedRevisions: () => ({ ...persistedRevisions }),
      prepareForClear,
      read,
      save,
      schedule,
      stats: () => Object.freeze({
        ...counters,
        idlePending: Boolean(idleTimer),
        savePending: Boolean(saveTimer),
        writePending: Boolean(writePromise),
      }),
    });
  }

  globalScope.ThinkStockRuntimeSnapshotController = Object.freeze({
    createRuntimeSnapshotController,
  });
}(typeof self !== "undefined" ? self : globalThis));

// Snapshot policy and persistence share one lifecycle.
(function initThinkStockRuntimeSnapshotPolicy(globalScope) {
  "use strict";

  function createRevisionTracker(componentNames = []) {
    const names = [...new Set(componentNames.map(String).filter(Boolean))];
    const revisions = Object.fromEntries(names.map((name) => [name, 0]));
    const componentCache = new Map();

    function getRevisions() {
      return { ...revisions };
    }

    function markChanged(changedNames) {
      (Array.isArray(changedNames) ? changedNames : []).forEach((name) => {
        if (!Object.prototype.hasOwnProperty.call(revisions, name)) return;
        revisions[name] = (Number(revisions[name]) || 0) + 1;
        componentCache.delete(name);
      });
    }

    function applyRevisions(incomingRevisions, loadedNames) {
      const source = incomingRevisions && typeof incomingRevisions === "object"
        ? incomingRevisions
        : {};
      (Array.isArray(loadedNames) ? loadedNames : []).forEach((name) => {
        if (!Object.prototype.hasOwnProperty.call(revisions, name)) return;
        const incoming = Number(source[name]);
        revisions[name] = Number.isFinite(incoming) && incoming > 0
          ? incoming
          : (Number(revisions[name]) || 0) + 1;
        componentCache.delete(name);
      });
    }

    function getComponent(name, resolver) {
      const revision = Number(revisions[name]) || 0;
      const cached = componentCache.get(name);
      if (cached?.revision === revision) return cached.value;
      const value = typeof resolver === "function" ? resolver(name) : null;
      componentCache.set(name, { revision, value });
      return value;
    }

    function seedComponent(name, value) {
      if (!Object.prototype.hasOwnProperty.call(revisions, name)) return;
      componentCache.set(name, {
        revision: Number(revisions[name]) || 0,
        value,
      });
    }

    return Object.freeze({
      applyRevisions,
      getComponent,
      getRevisions,
      markChanged,
      seedComponent,
    });
  }

  function buildSignature(historicalDataLoaded, componentNames, revisions) {
    const source = revisions && typeof revisions === "object" ? revisions : {};
    return [
      historicalDataLoaded ? "history" : "recent",
      ...(componentNames || []).map((name) => `${name}:${source[name] || 0}`),
    ].join("::");
  }

  function rowsCoverMonths(rows, months, valueColumns = []) {
    const columns = (Array.isArray(valueColumns) ? valueColumns : [])
      .map(String)
      .filter(Boolean);
    const dates = (Array.isArray(rows) ? rows : [])
      .filter((row) => (
        !columns.length
        || columns.some((column) => {
          const value = row?.[column];
          return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
        })
      ))
      .map((row) => String(row?.date || "").slice(0, 10))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
    if (dates.length < 2) return false;
    const first = dates.reduce((minimum, date) => (date < minimum ? date : minimum));
    const last = dates.reduce((maximum, date) => (date > maximum ? date : maximum));
    const cutoff = new Date(`${last}T00:00:00Z`);
    const originalDay = cutoff.getUTCDate();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - Math.max(1, Number(months) || 1));
    if (cutoff.getUTCDate() !== originalDay) cutoff.setUTCDate(0);
    return first < cutoff.toISOString().slice(0, 10);
  }

  function hasCoreHistoricalCoverage(components, months) {
    const source = components && typeof components === "object" ? components : {};
    return (
      rowsCoverMonths(source.price, months, ["^KS11", "^KQ11"])
      && rowsCoverMonths(source.macro, months, ["leading_cycle"])
      && rowsCoverMonths(source.credit, months, ["customer_deposit", "kospi_credit", "kosdaq_credit"])
    );
  }

  function isSnapshotUsable(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== "object") return false;
    if (snapshot.version !== options.schemaVersion) return false;
    const savedAtMs = Date.parse(String(snapshot.saved_at || ""));
    if (!Number.isFinite(savedAtMs)) return false;
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const futureToleranceMs = Math.max(0, Number(options.futureToleranceMs) || 0);
    const maxAgeMs = Math.max(0, Number(options.maxAgeMs) || 0);
    if (savedAtMs > now + futureToleranceMs) return false;
    if (maxAgeMs && now - savedAtMs > maxAgeMs) return false;
    return true;
  }

  function buildCompactSnapshot(options = {}) {
    const maxRows = Math.max(0, Number(options.maxRows) || 0);
    const maxDisclosures = Math.max(0, Number(options.maxDisclosures) || 0);
    const components = options.components || {};
    const pricePayload = components.price;
    return {
      ...options.metadata,
      historical_data_loaded: false,
      revisions: { ...(options.revisions || {}) },
      pricePayload: pricePayload ? {
        ...pricePayload,
        records: (pricePayload.records || []).slice(-maxRows),
      } : null,
      macroRows: (components.macro || []).slice(-maxRows),
      creditRows: (components.credit || []).slice(-maxRows),
      adrRows: (components.adr || []).slice(-maxRows),
      crisisRows: (components.crisis || []).slice(-maxRows),
      disclosureRows: (components.disclosure || []).slice(-maxDisclosures),
    };
  }

  globalScope.ThinkStockRuntimeSnapshotPolicy = Object.freeze({
    buildCompactSnapshot,
    buildSignature,
    createRevisionTracker,
    hasCoreHistoricalCoverage,
    isSnapshotUsable,
    rowsCoverMonths,
  });
}(typeof self !== "undefined" ? self : globalThis));
