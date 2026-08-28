"use strict";

const EVENT_MARKER_FONT_FAMILY = "Arial Black, Apple SD Gothic Neo, sans-serif";

function buildEventMarkerTextFont(color, size, fallbackSize = 13) {
  return {
    color,
    family: EVENT_MARKER_FONT_FAMILY,
    size: Number(size) || fallbackSize,
  };
}

/**
 * @typedef {Object} MainChartSeriesModel
 * @property {string} series
 * @property {Array<unknown>} xValues
 * @property {Array<number|null>} values
 * @property {Array<number|null>=} baseValues
 */

/** @param {unknown} value */
function normalizeMainChartModel(value) {
  if (!value || typeof value !== "object") return null;
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const seriesModels = Array.isArray(value.seriesModels) ? value.seriesModels : [];
  if (!rows.length || !seriesModels.length) return null;
  const validSeries = seriesModels.every((model) => {
    const xValues = Array.isArray(model?.xValues) ? model.xValues : [];
    const values = Array.isArray(model?.values) ? model.values : [];
    const baseValues = Array.isArray(model?.baseValues) ? model.baseValues : null;
    if (!String(model?.series || "")) return false;
    if (model?.hidden === true) {
      return xValues.length === 0
        && values.length === 0
        && (!baseValues || baseValues.length === 0);
    }
    return xValues.length > 0
      && xValues.length === values.length
      && (!baseValues || baseValues.length === values.length);
  });
  if (!validSeries) return null;
  return {
    ...value,
    rows,
    allSeries: Array.isArray(value.allSeries) ? value.allSeries : [],
    selected: Array.isArray(value.selected) ? value.selected : [],
    seriesModels,
    normBases: value.normBases && typeof value.normBases === "object" ? value.normBases : {},
    autoScales: value.autoScales && typeof value.autoScales === "object" ? value.autoScales : {},
    displayIndexes: Array.isArray(value.displayIndexes) ? value.displayIndexes : null,
  };
}

const AUXILIARY_SERIES_PAIRS = Object.freeze([
  ["adrKospiDates", "adrKospiValues"],
  ["adrKosdaqDates", "adrKosdaqValues"],
  ["fearGreedDates", "fearGreedValues"],
  ["newsDates", "newsValues"],
  ["vkospiDates", "vkospiValues"],
  ["vixDates", "vixValues"],
]);

/** @param {unknown} value */
function normalizeAuxiliaryChartModel(value) {
  if (!value || typeof value !== "object") return null;
  const valid = AUXILIARY_SERIES_PAIRS.every(([datesKey, valuesKey]) => {
    const dates = value[datesKey];
    const values = value[valuesKey];
    return Array.isArray(dates) && Array.isArray(values) && dates.length === values.length;
  });
  return valid ? value : null;
}

function chartRenderPayloadIssue(traces, layout) {
  if (!Array.isArray(traces)) return "chart traces must be an array";
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return "chart layout must be an object";
  }
  for (let index = 0; index < traces.length; index += 1) {
    const trace = traces[index];
    if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
      return `chart trace ${index} must be an object`;
    }
    if (trace.x != null && !Array.isArray(trace.x)) return `chart trace ${index} x must be an array`;
    if (trace.y != null && !Array.isArray(trace.y)) return `chart trace ${index} y must be an array`;
    if (Array.isArray(trace.x) && Array.isArray(trace.y) && trace.x.length !== trace.y.length) {
      return `chart trace ${index} x/y length mismatch`;
    }
  }
  return "";
}

function assertChartRenderPayload(traces, layout) {
  const issue = chartRenderPayloadIssue(traces, layout);
  if (issue) throw new TypeError(issue);
  return true;
}

export {
  EVENT_MARKER_FONT_FAMILY,
  assertChartRenderPayload,
  buildEventMarkerTextFont,
  chartRenderPayloadIssue,
  normalizeAuxiliaryChartModel,
  normalizeMainChartModel,
};
