"use strict";

const EVENT_MARKER_FONT_FAMILY = "Arial Black, Apple SD Gothic Neo, sans-serif";
const MAIN_CHART_OVERLAY_KINDS = Object.freeze([
  "price",
  "eps",
  "ai",
  "ai-band",
  "ai-scenario",
  "ai-report",
  "grouped-hover",
  "crisis",
  "timing-buy",
  "timing-sell",
  "insider",
  "disclosure",
]);
const EVENT_MARKER_OVERLAY_KINDS = Object.freeze([
  "crisis",
  "timing-buy",
  "timing-sell",
  "insider",
  "disclosure",
]);
const MAIN_CHART_OVERLAY_KIND_SET = new Set(MAIN_CHART_OVERLAY_KINDS);
const SERIES_OVERLAY_KIND_SET = new Set([
  "price",
  "eps",
  "ai",
  "ai-band",
  "ai-scenario",
  "ai-report",
]);

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
  if (value.empty !== true && (!rows.length || !seriesModels.length)) return null;
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

function chartTraceOverlayKind(trace) {
  return String(trace?.meta?.overlayKind || "");
}

function mainChartTraceContractIssue(trace, index = 0) {
  const kind = chartTraceOverlayKind(trace);
  if (!kind) return `main chart trace ${index} must declare meta.overlayKind`;
  if (!MAIN_CHART_OVERLAY_KIND_SET.has(kind)) {
    return `main chart trace ${index} has unknown overlay kind ${kind}`;
  }
  if (SERIES_OVERLAY_KIND_SET.has(kind) && !String(trace?.meta?.seriesKey || "")) {
    return `main chart trace ${index} ${kind} must declare meta.seriesKey`;
  }
  if (kind === "grouped-hover" && !String(trace?.meta?.hoverGroupTicker || "")) {
    return `main chart trace ${index} grouped-hover must declare meta.hoverGroupTicker`;
  }
  return "";
}

function mainChartRenderPayloadIssue(traces, layout) {
  const payloadIssue = chartRenderPayloadIssue(traces, layout);
  if (payloadIssue) return payloadIssue;
  for (let index = 0; index < traces.length; index += 1) {
    const issue = mainChartTraceContractIssue(traces[index], index);
    if (issue) return issue;
  }
  return "";
}

function assertMainChartRenderPayload(traces, layout) {
  const issue = mainChartRenderPayloadIssue(traces, layout);
  if (issue) throw new TypeError(issue);
  return true;
}

export {
  EVENT_MARKER_OVERLAY_KINDS,
  EVENT_MARKER_FONT_FAMILY,
  MAIN_CHART_OVERLAY_KINDS,
  assertChartRenderPayload,
  assertMainChartRenderPayload,
  buildEventMarkerTextFont,
  chartRenderPayloadIssue,
  chartTraceOverlayKind,
  mainChartRenderPayloadIssue,
  mainChartTraceContractIssue,
  normalizeAuxiliaryChartModel,
  normalizeMainChartModel,
};
