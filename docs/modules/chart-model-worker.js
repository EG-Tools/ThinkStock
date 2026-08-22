importScripts("./market-data.js?v=dev");
importScripts("./auxiliary-chart-model.js?v=dev");
importScripts("./chart-display-sampler.js?v=dev");
const marketDataModule = self.ThinkStockMarketData;
if (!marketDataModule) throw new Error("Market data module failed to load");
const {
  mergeSources,
  normalizeSeries,
  centeredScale,
  autoFitScales,
  resolveNormalizationBases,
  mergeFixedAutoScales,
  shiftIsoDateByDays,
} = marketDataModule;
const auxiliaryChartModelModule = self.ThinkStockAuxiliaryChartModel;
if (!auxiliaryChartModelModule) throw new Error("Auxiliary chart model module failed to load");
const { buildAuxiliaryChartModel } = auxiliaryChartModelModule;
const chartDisplaySampler = self.ThinkStockChartDisplaySampler;
if (!chartDisplaySampler) throw new Error("Chart display sampler failed to load");

const toNum = (value) => (value != null && Number.isFinite(Number(value))) ? Number(value) : null;
const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
let sourceCache = null;
let auxiliarySourceCache = null;

function resolvePayloadSources(payload) {
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
  if (incoming) {
    sourceCache = {
      datasetKey,
      priceRows: Array.isArray(incoming.priceRows) ? incoming.priceRows : [],
      macroRows: Array.isArray(incoming.macroRows) ? incoming.macroRows : [],
      creditRows: Array.isArray(incoming.creditRows) ? incoming.creditRows : [],
    };
  }
  if (!sourceCache || sourceCache.datasetKey !== datasetKey) {
    throw new Error("chart worker source cache miss");
  }
  return {
    ...payload,
    priceRows: sourceCache.priceRows,
    macroRows: sourceCache.macroRows,
    creditRows: sourceCache.creditRows,
  };
}

function resolveAuxiliaryPayloadSources(payload) {
  const datasetKey = String(payload.datasetKey || "inline");
  const incoming = payload.sources || (
    Array.isArray(payload.adrRows)
      ? { adrRows: payload.adrRows, macroRows: payload.macroRows }
      : null
  );
  if (incoming) {
    auxiliarySourceCache = {
      datasetKey,
      adrRows: Array.isArray(incoming.adrRows) ? incoming.adrRows : [],
      macroRows: Array.isArray(incoming.macroRows) ? incoming.macroRows : [],
    };
  }
  if (!auxiliarySourceCache || auxiliarySourceCache.datasetKey !== datasetKey) {
    throw new Error("auxiliary chart worker source cache miss");
  }
  return {
    ...payload,
    adrRows: auxiliarySourceCache.adrRows,
    macroRows: auxiliarySourceCache.macroRows,
  };
}

function labelName(key, displayNames) {
  return displayNames?.[key] || key;
}

function sortSeries(list, priorityOrder, displayNames) {
  const priority = new Map((priorityOrder || []).map((name, index) => [name, index]));
  return [...list].sort((left, right) => {
    const leftRank = priority.has(left) ? priority.get(left) : priority.size + 1;
    const rightRank = priority.has(right) ? priority.get(right) : priority.size + 1;
    return leftRank !== rightRank
      ? leftRank - rightRank
      : labelName(left, displayNames).localeCompare(labelName(right, displayNames), "ko");
  });
}

function buildMainChartModel(payload) {
  payload = resolvePayloadSources(payload);
  const { rows, macroCols, liveCols } = mergeSources(payload);
  const allowed = new Set(payload.allowedSeries || []);
  const hidden = new Set(payload.hiddenSeries || []);
  const priorityOrder = payload.priorityOrder || [];
  const displayNames = payload.displayNames || {};
  const offsets = payload.seriesOffsets || {};
  const scales = payload.seriesScales || {};
  const creditCols = Array.isArray(payload.creditCols) ? payload.creditCols : [];
  const creditOffsetDays = Number(payload.creditOffsetDays) || 0;
  const budget = Math.max(1, Number(payload.displayBudget) || rows.length || 1);

  const allSeries = sortSeries(
    [...new Set([...liveCols, ...macroCols])]
      .filter((series) => allowed.has(series))
      .filter((series) => rows.some((row) => toNum(row[series]) !== null)),
    priorityOrder,
    displayNames,
  );
  const selected = sortSeries(
    allSeries.filter((series) => !["adr_kospi", "adr_kosdaq"].includes(series)),
    priorityOrder,
    displayNames,
  );
  if (!selected.length) selected.push(...allSeries.slice(0, 2));

  const frameStart = String(payload.frameStart || payload.start || "");
  const frameEnd = String(payload.frameEnd || payload.end || "");
  const calculationRows = rows.filter((row) => row.date >= frameStart && row.date <= frameEnd);
  const frameRows = calculationRows.length ? calculationRows : rows;
  const commonNormBases = resolveNormalizationBases(frameRows, selected, payload.fixedNormBases);

  const visible = selected.filter((series) => !hidden.has(series));
  const autoScales = mergeFixedAutoScales(
    autoFitScales(frameRows, visible.length ? visible : selected, commonNormBases),
    payload.fixedAutoScales,
  );
  const baseXValues = rows.map((row) => row.date);
  const seriesModels = selected.map((series) => {
    const rawValues = rows.map((row) => toNum(row[series]));
    const rawTexts = rawValues.map((value) => Number.isFinite(value) ? numberFormat.format(value) : "N/A");
    const base = commonNormBases[series];
    let values = (base && base !== 0)
      ? rawValues.map((value) => Number.isFinite(value) ? (value / base) * 100 : null)
      : normalizeSeries(rawValues);
    values = centeredScale(values, series === "leading_cycle" ? 100 : (autoScales[series] || 100));
    const baseValues = values;
    const userScale = scales[series] != null ? scales[series] : (series === "leading_cycle" ? 20 : 1);
    if (userScale !== 1) {
      values = values.map((value) => value !== null ? 100 + (value - 100) * userScale : null);
    }
    const offset = offsets[series] || 0;
    if (offset) values = values.map((value) => value !== null ? value + offset : null);
    const xValues = creditCols.includes(series) && creditOffsetDays
      ? baseXValues.map((date) => shiftIsoDateByDays(date, -creditOffsetDays))
      : baseXValues;
    return {
      series,
      rawTexts,
      baseLineWidth: 1,
      xValues,
      values,
      baseValues,
    };
  });

  return {
    rows,
    allSeries,
    selected,
    seriesModels,
    normBases: commonNormBases,
    autoScales,
    displayIndexes: chartDisplaySampler.buildDisplayIndexes(
      rows,
      seriesModels,
      selected,
      payload.hiddenSeries,
      budget,
      payload.preserveDailyPoints,
    ),
  };
}

self.addEventListener("message", (event) => {
  const { id, type, payload } = event.data || {};
  try {
    let result = null;
    if (type === "buildMainChartModel") {
      result = buildMainChartModel(payload || {});
    } else if (type === "buildAuxiliaryChartModel") {
      result = buildAuxiliaryChartModel(resolveAuxiliaryPayloadSources(payload || {}));
    } else {
      return;
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
