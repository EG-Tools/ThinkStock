importScripts("./market-data.js?v=dev");
importScripts("./auxiliary-chart-model.js?v=dev");
const marketDataModule = self.ThinkStockMarketData;
if (!marketDataModule) throw new Error("Market data module failed to load");
const {
  mergeSources,
  normalizeSeries,
  centeredScale,
  autoFitScales,
  shiftIsoDateByDays,
} = marketDataModule;
const auxiliaryChartModelModule = self.ThinkStockAuxiliaryChartModel;
if (!auxiliaryChartModelModule) throw new Error("Auxiliary chart model module failed to load");
const { buildAuxiliaryChartModel } = auxiliaryChartModelModule;

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

function thinIndexList(indexes, budget, rowCount) {
  const sorted = [...new Set(indexes)].sort((left, right) => left - right);
  if (sorted.length <= budget) return sorted;
  const output = new Set([0, rowCount - 1]);
  const slots = Math.max(1, budget - 2);
  for (let index = 1; index <= slots; index += 1) {
    const sourceIndex = sorted[Math.round((index * (sorted.length - 1)) / (slots + 1))];
    if (Number.isInteger(sourceIndex)) output.add(sourceIndex);
  }
  return [...output].sort((left, right) => left - right);
}

function buildDisplayIndexes(rows, seriesModels, selected, hiddenSeries, budget) {
  const rowCount = rows.length;
  if (!rowCount || rowCount <= budget) return null;
  const hidden = new Set(hiddenSeries || []);
  const visible = selected.filter((key) => !hidden.has(key));
  const targets = visible.length ? visible : selected;
  const bySeries = new Map(seriesModels.map((model) => [model.series, model.values]));
  const perBucketCost = Math.max(2, targets.length * 2);
  const bucketCount = Math.max(1, Math.floor((budget - 2) / perBucketCost));
  const bucketSize = Math.max(1, Math.ceil((rowCount - 2) / bucketCount));
  const keep = new Set([0, rowCount - 1]);

  for (let start = 1; start < rowCount - 1; start += bucketSize) {
    const end = Math.min(rowCount - 1, start + bucketSize);
    targets.forEach((series) => {
      const values = bySeries.get(series);
      if (!values) return;
      let minIndex = -1;
      let maxIndex = -1;
      let minValue = Number.POSITIVE_INFINITY;
      let maxValue = Number.NEGATIVE_INFINITY;
      for (let index = start; index < end; index += 1) {
        const value = values[index];
        if (!Number.isFinite(value)) continue;
        if (value < minValue) {
          minValue = value;
          minIndex = index;
        }
        if (value > maxValue) {
          maxValue = value;
          maxIndex = index;
        }
      }
      if (minIndex >= 0) keep.add(minIndex);
      if (maxIndex >= 0) keep.add(maxIndex);
    });
  }
  return thinIndexList([...keep], budget, rowCount);
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

  const commonNormBases = {};
  const firstDates = selected.map((series) => {
    const row = rows.find((item) => toNum(item[series]) !== null);
    return row?.date || null;
  }).filter(Boolean);
  const commonBaseDate = firstDates.length
    ? firstDates.reduce((latest, value) => (value > latest ? value : latest))
    : null;
  if (commonBaseDate) {
    selected.forEach((series) => {
      const row = rows.find((item) => item.date >= commonBaseDate && toNum(item[series]) !== null);
      commonNormBases[series] = row ? toNum(row[series]) : null;
    });
  }

  const visible = selected.filter((series) => !hidden.has(series));
  const autoScales = autoFitScales(rows, visible.length ? visible : selected, commonNormBases);
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
      baseLineWidth: macroCols.includes(series) ? 3 : 2,
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
    displayIndexes: buildDisplayIndexes(rows, seriesModels, selected, payload.hiddenSeries, budget),
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
