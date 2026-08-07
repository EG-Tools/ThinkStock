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
