import adjustments from "./chart-adjustments.mjs";
import displaySampler from "./chart-display-sampler.mjs";
import marketData from "./market-data.mjs";


  "use strict";

  const toNum = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
  const ADDITIVE_NORMALIZED_SERIES = Object.freeze(["t10y1y", "us_credit_spread"]);
  const additiveNormalizedSeries = new Set(ADDITIVE_NORMALIZED_SERIES);
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

  function resolvePreservedFrameRange(pinnedRange, currentRange, toMilliseconds = Date.parse) {
    const pinned = Array.isArray(pinnedRange) && pinnedRange.length === 2
      ? pinnedRange.map(toMilliseconds)
      : null;
    return pinned?.every(Number.isFinite) ? pinned : currentRange;
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

  function mainChartDatasetKey(options = {}) {
    return [
      String(options.priceFingerprint || ""),
      String(options.supplementalRevision || ""),
    ].join("|");
  }

  function sortedObjectSignature(value) {
    if (!value || typeof value !== "object") return "";
    return Object.keys(value)
      .sort()
      .map((key) => `${key}:${value[key]}`)
      .join("|");
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

  function buildMainChartModelRequest(options = {}) {
    const fixedFrame = options.fixedFrame && typeof options.fixedFrame === "object"
      ? options.fixedFrame
      : null;
    const fixedNormBases = fixedFrame ? { ...(fixedFrame.normBases || {}) } : null;
    const fixedAutoScales = fixedFrame ? { ...(fixedFrame.autoScales || {}) } : null;
    const fixedFrameSignature = fixedFrame ? [
      sortedObjectSignature(fixedNormBases),
      sortedObjectSignature(fixedAutoScales),
    ].join("|") : "";
    const hiddenSeries = [...(options.hiddenSeries || [])];
    const supplementalSeries = [...(options.supplementalSeries || [])];
    const allowedSeries = [...(options.allowedSeries || [])];
    const config = {
      creditCols: [...(options.creditCols || [])],
      creditOffsetDays: Number(options.creditOffsetDays) || 0,
      start: String(options.dataStart || ""),
      end: String(options.dataEnd || ""),
      frameStart: String(options.frameStart || ""),
      frameEnd: String(options.frameEnd || ""),
      allowedSeries,
      excludedSeries: supplementalSeries,
      priorityOrder: [...(options.priorityOrder || [])],
      displayNames: { ...(options.displayNames || {}) },
      hiddenSeries,
      seriesOffsets: { ...(options.seriesOffsets || {}) },
      seriesScales: { ...(options.seriesScales || {}) },
      fixedNormBases,
      fixedAutoScales,
      displayBudget: Math.max(1, Number(options.displayBudget) || 1),
      preserveDailyPoints: options.preserveDailyPoints !== false,
    };
    const cacheKey = mainChartCalcCacheKey({
      activeMonths: options.activeMonths,
      chartFrameSignature: fixedFrameSignature || "auto-frame",
      creditOffsetDays: config.creditOffsetDays,
      customStocksSignature: String(options.customStocksSignature || ""),
      dataStart: config.start,
      dataEnd: config.end,
      displayBudget: config.displayBudget,
      frameStart: fixedFrameSignature ? "fixed-frame" : config.frameStart,
      frameEnd: fixedFrameSignature ? "fixed-frame" : config.frameEnd,
      hiddenSeriesSignature: hiddenSeries.sort().join(","),
      offsetsSignature: sortedObjectSignature(config.seriesOffsets),
      preserveDailyPoints: config.preserveDailyPoints,
      priceFingerprint: options.priceFingerprint,
      scalesSignature: sortedObjectSignature(config.seriesScales),
      supplementalRevision: options.supplementalRevision,
    });
    const sources = {
      priceRows: Array.isArray(options.sources?.priceRows) ? options.sources.priceRows : [],
      macroRows: Array.isArray(options.sources?.macroRows) ? options.sources.macroRows : [],
      creditRows: Array.isArray(options.sources?.creditRows) ? options.sources.creditRows : [],
    };
    return {
      cacheKey,
      workerPayload: {
        ...config,
        datasetKey: mainChartDatasetKey(options),
        sources,
      },
      syncPayload: { ...config, ...sources },
    };
  }

  function buildMainChartModel(payload = {}) {
    const { marketData, adjustments, displaySampler } = dependencies();
    const {
      normalizeSeries,
      centeredScale,
      autoFitScales,
      resolveNormalizationBases,
      mergeFixedAutoScales,
      shiftIsoDateByDays,
    } = marketData;
    const { resolveScale, transformValues } = adjustments;
    const preparedDataset = payload.preparedDataset?.hasFiniteSeries
      ? payload.preparedDataset
      : null;
    const merged = preparedDataset || marketData.mergeSources(payload);
    const { rows, macroCols, liveCols } = merged;
    const baseXValues = preparedDataset?.baseXValues || rows.map((row) => row.date);
    const hasFiniteSeries = preparedDataset?.hasFiniteSeries
      || ((series) => rows.some((row) => toNum(row?.[series]) !== null));
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
        .filter(hasFiniteSeries),
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
    const calculationRows = preparedDataset?.rowsInRange
      ? preparedDataset.rowsInRange(frameStart, frameEnd)
      : rows.filter((row) => row.date >= frameStart && row.date <= frameEnd);
    const frameRows = calculationRows.length ? calculationRows : rows;
    const visible = selected.filter((series) => !hidden.has(series));
    // Hidden series keep their trace slot for stable toggle behavior, but do not
    // pay the cost of normalizing and transforming decades of unused points.
    const normalizationOptions = {
      additiveSeries: ADDITIVE_NORMALIZED_SERIES,
      centerCurrentRange: true,
      frameEnd,
      frameStart,
      minimumTargetRange: 20,
      postScaleBySeries: {
        leading_cycle: adjustments.defaultScale("leading_cycle"),
      },
    };
    const normBases = resolveNormalizationBases(
      frameRows,
      visible,
      payload.fixedNormBases,
      normalizationOptions,
    );
    const autoScales = mergeFixedAutoScales(
      autoFitScales(frameRows, visible, normBases, normalizationOptions),
      payload.fixedAutoScales,
    );
    const seriesModels = selected.map((series) => {
      if (hidden.has(series)) {
        return {
          series,
          hidden: true,
          rawTexts: [],
          baseLineWidth: 1,
          xValues: [],
          values: [],
          baseValues: [],
        };
      }
      const rawValues = preparedDataset?.rawValuesFor(series)
        || rows.map((row) => toNum(row?.[series]));
      const isAdditiveNormalized = additiveNormalizedSeries.has(series);
      const rawTexts = isAdditiveNormalized
        ? rawValues.map((value) => (
          Number.isFinite(value) ? `${numberFormat.format(value)}%p` : "N/A"
        ))
        : (preparedDataset?.rawTextsFor(series)
          || rawValues.map((value) => (Number.isFinite(value) ? numberFormat.format(value) : "N/A")));
      const base = normBases[series];
      let baseValues = isAdditiveNormalized
        ? rawValues.map((value) => (
          Number.isFinite(value) && Number.isFinite(base) ? 100 + value - base : null
        ))
        : ((base && base !== 0)
          ? rawValues.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null))
          : normalizeSeries(rawValues));
      baseValues = centeredScale(
        baseValues,
        autoScales[series] || 100,
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
    buildMainChartModelRequest,
    buildMainChartRenderInputs,
    buildMainChartModel,
    createMainChartSessionModel,
    mainChartCalcCacheKey,
    mainChartDatasetKey,
    resolvePreservedFrameRange,
    sortedObjectSignature,
    sortSeries,
  });
export {
    buildMainChartModel,
    buildMainChartModelRequest,
    buildMainChartRenderInputs,
    createMainChartSessionModel,
    mainChartCalcCacheKey,
    mainChartDatasetKey,
    resolvePreservedFrameRange,
    sortedObjectSignature,
    sortSeries,
};
export default mainChartModel;
