"use strict";

import marketData from "./market-data.mjs";

const toFiniteNumber = (value) => (
  value != null && Number.isFinite(Number(value)) ? Number(value) : null
);
const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });

function prepareMainChartDataset(payload = {}) {
  const { rows, macroCols, liveCols } = marketData.mergeSources(payload);
  const availability = new Map();
  const valuesBySeries = new Map();
  const textsBySeries = new Map();
  const counters = { availabilityScans: 0, rangeSlices: 0, valueBuilds: 0, textBuilds: 0 };
  const findDateIndex = (date, includeEqual) => {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const candidate = String(rows[middle]?.date || "");
      if (candidate < date || (includeEqual && candidate === date)) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const rawValuesFor = (series) => {
    const key = String(series || "");
    if (!valuesBySeries.has(key)) {
      counters.valueBuilds += 1;
      valuesBySeries.set(key, rows.map((row) => toFiniteNumber(row?.[key])));
    }
    return valuesBySeries.get(key);
  };
  const rawTextsFor = (series) => {
    const key = String(series || "");
    if (!textsBySeries.has(key)) {
      counters.textBuilds += 1;
      textsBySeries.set(key, rawValuesFor(key).map((value) => (
        Number.isFinite(value) ? numberFormat.format(value) : "N/A"
      )));
    }
    return textsBySeries.get(key);
  };
  return Object.freeze({
    baseXValues: Object.freeze(rows.map((row) => row.date)),
    hasFiniteSeries(series) {
      const key = String(series || "");
      if (!availability.has(key)) {
        counters.availabilityScans += 1;
        availability.set(key, rows.some((row) => toFiniteNumber(row?.[key]) !== null));
      }
      return availability.get(key);
    },
    liveCols: Object.freeze([...liveCols]),
    macroCols: Object.freeze([...macroCols]),
    rawTextsFor,
    rawValuesFor,
    rows,
    rowsInRange(start, end) {
      const startDate = String(start || "");
      const endDate = String(end || "");
      if (!startDate || !endDate || !rows.length) return rows;
      counters.rangeSlices += 1;
      return rows.slice(findDateIndex(startDate, false), findDateIndex(endDate, true));
    },
    stats: () => Object.freeze({
      ...counters,
      cachedSeries: valuesBySeries.size,
      cachedTexts: textsBySeries.size,
    }),
  });
}

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
  const prepareMainDataset = options.prepareMainChartDataset || prepareMainChartDataset;
  if (typeof mainChartModel?.buildMainChartModel !== "function") {
    throw new Error("Main chart model module failed to load");
  }
  if (typeof auxiliaryChartModel?.buildAuxiliaryChartModel !== "function") {
    throw new Error("Auxiliary chart model module failed to load");
  }

  let mainSourceCache = null;
  let mainPreparedDataset = null;
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
        if (normalized.cache !== mainSourceCache || !mainPreparedDataset) {
          mainPreparedDataset = prepareMainDataset(normalized.payload);
        }
        mainSourceCache = normalized.cache;
        result = mainChartModel.buildMainChartModel({
          ...normalized.payload,
          ...(mainPreparedDataset ? { preparedDataset: mainPreparedDataset } : {}),
        });
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
    mainPreparedDataset = null;
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
  prepareMainChartDataset,
};
