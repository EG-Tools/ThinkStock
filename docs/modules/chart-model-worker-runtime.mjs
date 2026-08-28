"use strict";

function normalizeMainSources(payload, sourceCache) {
  const datasetKey = String(payload.datasetKey || "inline");
  const incoming = payload.sources || (
    Array.isArray(payload.priceRows)
      ? {
          priceRows: payload.priceRows,
          macroRows: payload.macroRows,
          creditRows: payload.creditRows,
        }
      : null
  );
  const nextCache = incoming
    ? {
        datasetKey,
        priceRows: Array.isArray(incoming.priceRows) ? incoming.priceRows : [],
        macroRows: Array.isArray(incoming.macroRows) ? incoming.macroRows : [],
        creditRows: Array.isArray(incoming.creditRows) ? incoming.creditRows : [],
      }
    : sourceCache;
  if (!nextCache || nextCache.datasetKey !== datasetKey) {
    throw new Error("chart worker source cache miss");
  }
  return {
    cache: nextCache,
    payload: {
      ...payload,
      priceRows: nextCache.priceRows,
      macroRows: nextCache.macroRows,
      creditRows: nextCache.creditRows,
    },
  };
}

function normalizeAuxiliarySources(payload, sourceCache) {
  const datasetKey = String(payload.datasetKey || "inline");
  const incoming = payload.sources || (
    Array.isArray(payload.adrRows)
      ? { adrRows: payload.adrRows, macroRows: payload.macroRows }
      : null
  );
  const nextCache = incoming
    ? {
        datasetKey,
        adrRows: Array.isArray(incoming.adrRows) ? incoming.adrRows : [],
        macroRows: Array.isArray(incoming.macroRows) ? incoming.macroRows : [],
      }
    : sourceCache;
  if (!nextCache || nextCache.datasetKey !== datasetKey) {
    throw new Error("auxiliary chart worker source cache miss");
  }
  return {
    cache: nextCache,
    payload: {
      ...payload,
      adrRows: nextCache.adrRows,
      macroRows: nextCache.macroRows,
    },
  };
}

function createChartModelWorkerRuntime(options = {}) {
  const mainChartModel = options.mainChartModel;
  const auxiliaryChartModel = options.auxiliaryChartModel;
  if (typeof mainChartModel?.buildMainChartModel !== "function") {
    throw new Error("Main chart model module failed to load");
  }
  if (typeof auxiliaryChartModel?.buildAuxiliaryChartModel !== "function") {
    throw new Error("Auxiliary chart model module failed to load");
  }

  let mainSourceCache = null;
  let auxiliarySourceCache = null;

  function handleMessage(message = {}) {
    const { id, type, payload } = message;
    if (type !== "buildMainChartModel" && type !== "buildAuxiliaryChartModel") {
      return null;
    }
    try {
      let result;
      if (type === "buildMainChartModel") {
        const normalized = normalizeMainSources(payload || {}, mainSourceCache);
        mainSourceCache = normalized.cache;
        result = mainChartModel.buildMainChartModel(normalized.payload);
      } else {
        const normalized = normalizeAuxiliarySources(payload || {}, auxiliarySourceCache);
        auxiliarySourceCache = normalized.cache;
        result = auxiliaryChartModel.buildAuxiliaryChartModel(normalized.payload);
      }
      return { id, ok: true, result };
    } catch (error) {
      return { id, ok: false, error: error?.message || String(error) };
    }
  }

  function clearSources() {
    mainSourceCache = null;
    auxiliarySourceCache = null;
  }

  return Object.freeze({ clearSources, handleMessage });
}

function attachChartModelWorker(scope, options = {}) {
  if (!scope || typeof scope.addEventListener !== "function" || typeof scope.postMessage !== "function") {
    throw new Error("Chart model worker scope is unavailable");
  }
  const runtime = createChartModelWorkerRuntime(options);
  const handleWorkerMessage = (event) => {
    const response = runtime.handleMessage(event?.data || {});
    if (response) scope.postMessage(response);
  };
  scope.addEventListener("message", handleWorkerMessage);
  return Object.freeze({
    dispose() {
      scope.removeEventListener?.("message", handleWorkerMessage);
      runtime.clearSources();
    },
    runtime,
  });
}

export {
  attachChartModelWorker,
  createChartModelWorkerRuntime,
};
