import adjustments from "./chart-adjustments.mjs";
import displaySampler from "./chart-display-sampler.mjs";
import marketData from "./market-data.mjs";


  "use strict";

  const toNum = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
  const dependencyModules = Object.freeze({ marketData, adjustments, displaySampler });

  function dependencies() {
    const { marketData, adjustments, displaySampler } = dependencyModules;
    if (!marketData || !adjustments || !displaySampler) {
      throw new Error("Main chart model dependencies failed to load");
    }
    return { marketData, adjustments, displaySampler };
  }

  function labelName(key, displayNames) {
    return displayNames?.[key] || key;
  }

  function sortSeries(list, priorityOrder = [], displayNames = {}) {
    const priority = new Map(priorityOrder.map((name, index) => [name, index]));
    return [...list].sort((left, right) => {
      const leftRank = priority.has(left) ? priority.get(left) : priority.size + 1;
      const rightRank = priority.has(right) ? priority.get(right) : priority.size + 1;
      return leftRank !== rightRank
        ? leftRank - rightRank
        : labelName(left, displayNames).localeCompare(labelName(right, displayNames), "ko");
    });
  }

  function buildMainChartRenderInputs(options = {}) {
    const priceRows = Array.isArray(options.priceRows) ? options.priceRows : [];
    const fallbackDate = String(options.fallbackDate || "").slice(0, 10);
    const dateBounds = typeof options.dateBounds === "function"
      ? options.dateBounds
      : () => ({ minDate: fallbackDate, maxDate: fallbackDate });
    const shiftMonths = typeof options.shiftMonths === "function"
      ? options.shiftMonths
      : (date) => date;
    const toUtcMs = typeof options.toUtcMs === "function"
      ? options.toUtcMs
      : (value) => Date.parse(String(value || ""));
    const { minDate, maxDate } = dateBounds([
      priceRows,
      ...(Array.isArray(options.boundRows) ? options.boundRows : []),
    ], fallbackDate);
    const end = maxDate;
    const requestedStart = shiftMonths(end, Number(options.activeMonths) || 0);
    const start = requestedStart < minDate ? minDate : requestedStart;
    const historyMonths = Math.max(1, Number(options.historyMonths) || 360);
    const dataStart = [minDate, shiftMonths(maxDate, historyMonths)].sort().at(-1);
    const dataEnd = maxDate;
    const preservedFrameRange = Array.isArray(options.preservedFrameRange)
      && options.preservedFrameRange.length === 2
      ? options.preservedFrameRange
      : null;
    const frameStart = preservedFrameRange
      ? new Date(Math.max(toUtcMs(dataStart), Number(preservedFrameRange[0]))).toISOString().slice(0, 10)
      : start;
    const frameEnd = preservedFrameRange
      ? new Date(Math.min(toUtcMs(dataEnd), Number(preservedFrameRange[1]))).toISOString().slice(0, 10)
      : end;
    const allowedSeries = new Set([
      ...(Array.isArray(options.coreSeries) ? options.coreSeries : []),
      ...(Array.isArray(options.customSeries) ? options.customSeries : []),
    ]);
    const supplemental = new Set(options.supplementalSeries || []);
    const hidden = options.hiddenSeries instanceof Set
      ? options.hiddenSeries
      : new Set(options.hiddenSeries || []);
    const visibleSeriesCount = [...allowedSeries]
      .filter((key) => !supplemental.has(key) && !hidden.has(key))
      .length;
    return {
      allowedSeries,
      dataEnd,
      dataStart,
      displayBudget: typeof options.resolveDisplayBudget === "function"
        ? options.resolveDisplayBudget(visibleSeriesCount)
        : Math.max(1, Number(options.displayBudget) || priceRows.length || 1),
      end,
      frameEnd,
      frameStart,
      priceRows,
      start,
      visibleSeriesCount,
    };
  }

  function mainChartCalcCacheKey(options = {}) {
    return [
      options.dataStart,
      options.dataEnd,
      options.frameStart,
      options.frameEnd,
      options.activeMonths,
      options.creditOffsetDays,
      options.priceFingerprint,
      options.supplementalRevision,
      options.customStocksSignature,
      options.hiddenSeriesSignature,
      options.offsetsSignature,
      options.scalesSignature,
      options.chartFrameSignature,
      options.displayBudget,
      options.preserveDailyPoints ? "daily-points" : "sampled-points",
    ].join("::");
  }

  function createMainChartSessionModel(model) {
    if (!model || typeof model !== "object") return model;
    return {
      ...model,
      seriesModels: (Array.isArray(model.seriesModels) ? model.seriesModels : []).map((item) => ({
        ...item,
        values: Array.isArray(item?.values) ? [...item.values] : item?.values,
      })),
    };
  }

  function buildMainChartModel(payload = {}) {
    const { marketData, adjustments, displaySampler } = dependencies();
    const {
      mergeSources,
      normalizeSeries,
      centeredScale,
      autoFitScales,
      resolveNormalizationBases,
      mergeFixedAutoScales,
      shiftIsoDateByDays,
    } = marketData;
    const { resolveScale, transformValues } = adjustments;
    const { rows, macroCols, liveCols } = mergeSources(payload);
    const allowed = new Set(payload.allowedSeries || []);
    const hidden = new Set(payload.hiddenSeries || []);
    const excluded = new Set(payload.excludedSeries || []);
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
      allSeries.filter((series) => !excluded.has(series)),
      priorityOrder,
      displayNames,
    );
    if (!selected.length) selected.push(...allSeries.slice(0, 2));

    const frameStart = String(payload.frameStart || payload.start || "");
    const frameEnd = String(payload.frameEnd || payload.end || "");
    const calculationRows = rows.filter((row) => row.date >= frameStart && row.date <= frameEnd);
    const frameRows = calculationRows.length ? calculationRows : rows;
    const normBases = resolveNormalizationBases(frameRows, selected, payload.fixedNormBases);
    const visible = selected.filter((series) => !hidden.has(series));
    const autoScales = mergeFixedAutoScales(
      autoFitScales(frameRows, visible.length ? visible : selected, normBases),
      payload.fixedAutoScales,
    );
    const baseXValues = rows.map((row) => row.date);
    const seriesModels = selected.map((series) => {
      const rawValues = rows.map((row) => toNum(row[series]));
      const rawTexts = rawValues.map((value) => (
        Number.isFinite(value) ? numberFormat.format(value) : "N/A"
      ));
      const base = normBases[series];
      let baseValues = (base && base !== 0)
        ? rawValues.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null))
        : normalizeSeries(rawValues);
      baseValues = centeredScale(
        baseValues,
        series === "leading_cycle" ? 100 : (autoScales[series] || 100),
        true,
      );
      const values = transformValues(
        baseValues,
        resolveScale(scales, series),
        offsets[series] || 0,
      );
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
      normBases,
      autoScales,
      displayIndexes: displaySampler.buildDisplayIndexes(
        rows,
        seriesModels,
        selected,
        hidden,
        budget,
        payload.preserveDailyPoints,
      ),
    };
  }

  const mainChartModel = Object.freeze({
    buildMainChartRenderInputs,
    buildMainChartModel,
    createMainChartSessionModel,
    mainChartCalcCacheKey,
    sortSeries,
  });
export {
  buildMainChartModel,
  buildMainChartRenderInputs,
  createMainChartSessionModel,
  mainChartCalcCacheKey,
  sortSeries,
};
export default mainChartModel;
