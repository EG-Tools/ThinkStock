import { chartLoader } from "./chart-loader.mjs";
import { chartMarkerRuntime as markerRuntime } from "./chart-marker-runtime.mjs";
import { assertChartRenderPayload } from "./chart-render-contract.mjs";

  const DAY_MS = 24 * 60 * 60 * 1000;
  if (!chartLoader?.layoutStyle || !chartLoader?.axisStyle) {
    throw new Error("Chart visual contract failed to load");
  }
  const CHART_HOVER_DATE_FORMAT = chartLoader.PLOTLY_THEME.hoverDateFormat;
  const KOREAN_EQUITY_PATTERN = /^\d{6}\.(?:KS|KQ)$/;
  const LONG_NON_TRADING_GAP_DAYS = 10;
  const NON_TRADING_MARKET_SESSIONS = 3;
  const EPS_HOVER_MARKER_SIZE = 36;
  const PREPARED_LINE_VIEWPORT_CACHE_LIMIT = 6;
  const FULL_LINE_VIEWPORT_KEY = Symbol("full-line-viewport");
  const normalizedLineDataCache = new WeakMap();
  const preparedLineDataCache = new WeakMap();
  const preparedLineDataCacheCounters = {
    normalizedHits: 0,
    normalizedMisses: 0,
    viewportHits: 0,
    viewportMisses: 0,
    evictions: 0,
  };
  const traceTimeCache = new WeakMap();
  const priceHoverLookupCache = new WeakMap();
  const overlayDescriptorCache = new WeakMap();
  const GROUPED_HOVER_CACHE_LIMIT = 4;
  const groupedHoverTraceCache = new Map();
  const groupedHoverCacheCounters = { hits: 0, misses: 0, evictions: 0 };
  const OVERLAY_HOVER_PRIORITIES = Object.freeze({
    eps: 10,
    disclosure: 20,
    "timing-buy": 30,
    "timing-sell": 30,
    crisis: 35,
    insider: 40,
  });

  function legacyOverlayKind(trace) {
    if (trace?.meta?.isGroupedHoverTrace) return "grouped-hover";
    const markerKind = markerRuntime?.eventMarkerKind?.(trace) || "";
    if (markerKind) return markerKind;
    if (trace?.meta?.isAiForecastBand) return "ai-band";
    if (trace?.meta?.isAiForecastScenarioTrace) return "ai-scenario";
    if (trace?.meta?.isAiReportMarkerTrace) return "ai-report";
    if (trace?.meta?.isAiForecastTrace) return "ai";
    if (trace?.meta?.isEpsTrace) return "eps";
    return trace?.meta?.seriesKey ? "price" : "";
  }

  function chartOverlayDescriptor(trace) {
    if (!trace || typeof trace !== "object") {
      return {
        adjustable: false,
        event: false,
        grouped: false,
        hoverPriority: 100,
        identity: "",
        kind: "",
        rangeRole: "historical",
        seriesKey: "",
      };
    }
    const cached = overlayDescriptorCache.get(trace);
    const kind = String(trace?.meta?.overlayKind || legacyOverlayKind(trace));
    const seriesKey = String(trace?.meta?.seriesKey || "");
    const role = String(trace?.meta?.aiTraceRole || "");
    const hoverTicker = String(trace?.meta?.hoverGroupTicker || "");
    const markerIdentity = markerRuntime?.eventMarkerIdentity?.(trace) || "";
    const signature = [kind, seriesKey, role, hoverTicker, markerIdentity].join("|");
    if (cached?.signature === signature) return cached.descriptor;

    let identity = "";
    if (kind === "grouped-hover") identity = `hover-group:${hoverTicker}`;
    else if (markerIdentity) identity = markerIdentity;
    else if (kind === "ai-band") identity = `ai-band:${seriesKey}:${role}`;
    else if (kind === "ai-scenario") identity = `ai-scenario:${seriesKey}:${role}`;
    else if (kind === "ai-report") identity = `ai-report:${seriesKey}`;
    else if (kind === "ai") identity = `ai:${seriesKey}`;
    else if (seriesKey) identity = `series:${seriesKey}`;

    const event = Boolean(markerIdentity);
    const grouped = kind === "grouped-hover";
    const rangeRole = kind === "eps" || kind === "ai-scenario"
      ? "future"
      : (event || grouped || kind.startsWith("ai-") || kind === "ai" ? "none" : "historical");
    const descriptor = Object.freeze({
      adjustable: kind === "price" || kind === "eps",
      event,
      grouped,
      hoverPriority: OVERLAY_HOVER_PRIORITIES[kind] || 100,
      identity,
      kind,
      rangeRole,
      seriesKey,
    });
    overlayDescriptorCache.set(trace, { descriptor, signature });
    return descriptor;
  }

  function traceIdentity(trace) {
    return chartOverlayDescriptor(trace).identity;
  }

  function rangeBearingTraces(traces, roles = ["historical", "future"]) {
    const allowedRoles = roles instanceof Set ? roles : new Set(roles);
    return (Array.isArray(traces) ? traces : []).filter((trace) => (
      trace?.visible !== "legendonly"
      && allowedRoles.has(chartOverlayDescriptor(trace).rangeRole)
    ));
  }

  function traceOwnerSeries(trace) {
    const descriptor = chartOverlayDescriptor(trace);
    if (descriptor.event) return "";
    if (descriptor.kind === "grouped-hover") {
      return String(trace?.meta?.hoverGroupTicker || "");
    }
    if (descriptor.kind === "eps") return descriptor.seriesKey.replace(/^eps:/, "");
    return descriptor.seriesKey;
  }

  function buildSeriesVisibilityUpdate(traces, seriesKey, visible, options = {}) {
    const key = String(seriesKey || "").trim();
    if (!key) return Object.freeze({ traceIndexes: [], values: [] });
    const includedKinds = new Set(
      (Array.isArray(options.includeKinds) ? options.includeKinds : [])
        .map((kind) => String(kind || "").trim())
        .filter(Boolean),
    );
    const traceIndexes = [];
    const values = [];
    (Array.isArray(traces) ? traces : []).forEach((trace, index) => {
      if (traceOwnerSeries(trace) !== key) return;
      if (includedKinds.size && !includedKinds.has(chartOverlayDescriptor(trace).kind)) return;
      traceIndexes.push(index);
      values.push(visible ? true : "legendonly");
    });
    return Object.freeze({ traceIndexes, values });
  }

  function buildSeriesEventPointHideUpdate(traces, seriesKey) {
    const key = String(seriesKey || "").trim();
    if (!key) return Object.freeze({ traceIndexes: [], values: [] });
    const traceIndexes = [];
    const values = [];
    (Array.isArray(traces) ? traces : []).forEach((trace, traceIndex) => {
      if (!isEventMarkerTrace(trace) || !Array.isArray(trace?.x)) return;
      const pointTickers = Array.isArray(trace?.meta?.pointTickers)
        ? trace.meta.pointTickers
        : [];
      if (!pointTickers.some((ticker) => String(ticker || "") === key)) return;
      let changed = false;
      const nextX = trace.x.map((value, pointIndex) => {
        if (String(pointTickers[pointIndex] || "") !== key || value === null) return value;
        changed = true;
        return null;
      });
      if (!changed) return;
      traceIndexes.push(traceIndex);
      values.push(nextX);
    });
    return Object.freeze({ traceIndexes, values });
  }

  function canApplyPartialUpdate(element, traces) {
    if (!element?._fullLayout?.xaxis || !element?._fullLayout?.yaxis || !Array.isArray(element.data)) {
      return false;
    }
    if (!Array.isArray(traces) || element.data.length !== traces.length || !traces.length) return false;
    return traces.every((trace, index) => (
      traceIdentity(trace)
      && traceIdentity(trace) === traceIdentity(element.data[index])
      && trace.type === element.data[index]?.type
      && trace.mode === element.data[index]?.mode
    ));
  }

  function uniqueTraceIdentities(traces) {
    const identities = (Array.isArray(traces) ? traces : []).map(traceIdentity);
    return identities.every(Boolean) && new Set(identities).size === identities.length
      ? identities
      : null;
  }

  function isEventMarkerTrace(trace) {
    return chartOverlayDescriptor(trace).event;
  }

  function isMarkerOnlyInvalidation(invalidation = {}) {
    const updateClasses = [...new Set((invalidation?.updateClasses || []).map(String))];
    return updateClasses.length === 1 && updateClasses[0] === "markers";
  }

  function canApplyEventMarkerUpdate(element, traces, invalidation = {}) {
    if (!isMarkerOnlyInvalidation(invalidation)) return false;
    if (!element?._fullLayout?.xaxis || !element?._fullLayout?.yaxis || !Array.isArray(element.data)) {
      return false;
    }
    const currentIds = uniqueTraceIdentities(element.data);
    const nextIds = uniqueTraceIdentities(traces);
    if (!currentIds || !nextIds) return false;
    const currentStatic = element.data.filter((trace) => !isEventMarkerTrace(trace));
    const nextStatic = traces.filter((trace) => !isEventMarkerTrace(trace));
    if (currentStatic.length !== nextStatic.length) return false;
    return currentStatic.every((trace, index) => (
      traceIdentity(trace) === traceIdentity(nextStatic[index])
      && trace.type === nextStatic[index]?.type
      && trace.mode === nextStatic[index]?.mode
    ));
  }

  function canReconcileTraceStructure(element, traces) {
    if (!element?._fullLayout?.xaxis || !element?._fullLayout?.yaxis || !Array.isArray(element.data)) return false;
    const currentIds = uniqueTraceIdentities(element.data);
    const nextIds = uniqueTraceIdentities(traces);
    if (!currentIds || !nextIds || currentIds.join("|") === nextIds.join("|")) return false;
    const currentById = new Map(element.data.map((trace) => [traceIdentity(trace), trace]));
    const nextById = new Map(traces.map((trace) => [traceIdentity(trace), trace]));
    const commonCurrent = currentIds.filter((id) => nextById.has(id));
    const commonNext = nextIds.filter((id) => currentById.has(id));
    if (!commonCurrent.length) return false;
    if (commonCurrent.join("|") !== commonNext.join("|")) return false;
    return commonCurrent.every((id) => {
      const current = currentById.get(id);
      const next = nextById.get(id);
      return current?.type === next?.type && current?.mode === next?.mode;
    });
  }

  async function reconcileTraceStructure(plotly, element, traces) {
    const nextIds = uniqueTraceIdentities(traces);
    if (!nextIds) throw new Error("chart trace identities are not unique");
    const desired = new Set(nextIds);
    const deleteIndexes = element.data.flatMap((trace, index) => (
      desired.has(traceIdentity(trace)) ? [] : [index]
    )).sort((left, right) => right - left);
    if (deleteIndexes.length) await plotly.deleteTraces(element, deleteIndexes);
    for (let index = 0; index < traces.length; index += 1) {
      if (traceIdentity(element.data[index]) === nextIds[index]) continue;
      await plotly.addTraces(element, traces[index], index);
    }
    const reconciledIds = uniqueTraceIdentities(element.data);
    if (!reconciledIds || reconciledIds.join("|") !== nextIds.join("|")) {
      throw new Error("chart trace reconciliation failed");
    }
  }

  function finiteTracePoints(xValues, yValues, textValues = [], baseValues = []) {
    const x = [];
    const y = [];
    const text = [];
    const base = [];
    const count = Math.min(
      Array.isArray(xValues) ? xValues.length : 0,
      Array.isArray(yValues) ? yValues.length : 0,
    );
    for (let index = 0; index < count; index += 1) {
      if (!Number.isFinite(yValues[index])) continue;
      x.push(xValues[index]);
      y.push(yValues[index]);
      text.push(textValues[index]);
      base.push(Number.isFinite(baseValues[index]) ? baseValues[index] : null);
    }
    return { x, y, text, base };
  }

  function escapeHoverHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function hoverTemplateAt(trace, index) {
    const template = trace?.meta?.hoverDetailTemplates ?? trace?.hovertemplate;
    return Array.isArray(template) ? template[index] : template;
  }

  function expandedHoverTemplate(trace, index, label) {
    const template = String(hoverTemplateAt(trace, index) || "");
    if (!template) return "";
    const customdata = Array.isArray(trace?.customdata?.[index]) ? trace.customdata[index] : [];
    const text = trace?.text?.[index] ?? "";
    let result = template
      .replace(/%\{customdata\[(\d+)\](?::[^}]*)?\}/g, (_match, offset) => (
        escapeHoverHtml(customdata[Number(offset)] ?? "-")
      ))
      .replace(/%\{text\}/g, escapeHoverHtml(text))
      .replace(/<extra>[\s\S]*?<\/extra>/g, "")
      .trim();
    const escapedLabel = escapeHoverHtml(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escapedLabel) result = result.replace(new RegExp(`<b>\\s*${escapedLabel}\\s+`, "i"), "<b>");
    return result
      .replace(/<b(?:\s[^>]*)?>/gi, "")
      .replace(/<\/b>/gi, "");
  }

  function eventPointTicker(trace, index) {
    const explicit = String(trace?.meta?.pointTickers?.[index] || "").trim();
    if (explicit) return explicit;
    const kind = chartOverlayDescriptor(trace).kind;
    if (kind === "insider") {
      return String(trace?.customdata?.[index]?.[0] || "").trim();
    }
    if (kind === "disclosure") {
      return String(trace?.customdata?.[index]?.[0] || "").split("|")[1] || "";
    }
    return "";
  }

  function hoverDetailPriority(trace) {
    return chartOverlayDescriptor(trace).hoverPriority;
  }

  function cleanEpsHoverText(value) {
    return String(value || "")
      .replace(/^\d{4}년\s+/, "")
      .replace(/\s+EPS\s+/, " ")
      .trim();
  }

  function groupedHoverTemplate(includeDate = false) {
    return includeDate
      ? `%{x|${CHART_HOVER_DATE_FORMAT}}<br>%{customdata}<extra></extra>`
      : "%{text}<extra></extra>";
  }

  function priceTextAtOrBefore(trace, value, maximumGapDays = 7) {
    const target = Date.parse(String(value || ""));
    const xValues = Array.isArray(trace?.x) ? trace.x : [];
    if (!Number.isFinite(target) || !xValues.length) return "";
    let lookup = priceHoverLookupCache.get(trace);
    if (!lookup || lookup.x !== xValues || lookup.count !== xValues.length) {
      const times = xValues.map((date) => Date.parse(String(date || "")));
      lookup = { count: xValues.length, times, x: xValues };
      priceHoverLookupCache.set(trace, lookup);
    }
    const index = upperBoundTime(lookup.times, target) - 1;
    if (index < 0 || !Number.isFinite(lookup.times[index])) return "";
    const maximumGapMs = Math.max(0, Number(maximumGapDays) || 0) * 24 * 60 * 60 * 1000;
    if (target - lookup.times[index] > maximumGapMs) return "";
    return String(trace?.text?.[index] ?? "");
  }

  function sampledTraceValue(values, index) {
    if (!Array.isArray(values) || !values.length) return "";
    return String(values[Math.max(0, Math.min(values.length - 1, index))] ?? "");
  }

  function traceContentFingerprint(trace) {
    const explicit = String(trace?.meta?.renderFingerprint || "");
    if (explicit) return explicit;
    const x = Array.isArray(trace?.x) ? trace.x : [];
    const y = Array.isArray(trace?.y) ? trace.y : [];
    const text = Array.isArray(trace?.text) ? trace.text : [];
    const middle = Math.floor(Math.max(x.length, y.length, text.length) / 2);
    return [
      traceIdentity(trace),
      x.length,
      sampledTraceValue(x, 0),
      sampledTraceValue(x, middle),
      sampledTraceValue(x, x.length - 1),
      y.length,
      sampledTraceValue(y, 0),
      sampledTraceValue(y, middle),
      sampledTraceValue(y, y.length - 1),
      text.length,
      sampledTraceValue(text, 0),
      sampledTraceValue(text, middle),
      sampledTraceValue(text, text.length - 1),
    ].join(":");
  }

  function groupedHoverCacheKey({
    activeSeries,
    priceTraces,
    traces,
    labels,
    revision,
  }) {
    const sourceFingerprints = traces.filter((trace) => (
      chartOverlayDescriptor(trace).kind === "eps" || isEventMarkerTrace(trace)
    )).map(traceContentFingerprint);
    return [
      String(revision || ""),
      activeSeries.map((series) => [
        series,
        labels.get(series)?.label || "",
        labels.get(series)?.color || "",
        traceContentFingerprint(priceTraces.get(series)),
      ].join(":" )).join("|"),
      sourceFingerprints.join("|"),
    ].join("||");
  }

  function cloneGroupedHoverTrace(trace) {
    return {
      ...trace,
      meta: {
        ...trace.meta,
        hoverGroupPointKinds: trace.meta?.hoverGroupPointKinds,
      },
      marker: {
        ...trace.marker,
        line: trace.marker?.line ? { ...trace.marker.line } : trace.marker?.line,
      },
    };
  }

  function readGroupedHoverCache(key, traces) {
    const cached = groupedHoverTraceCache.get(key);
    if (!cached) {
      groupedHoverCacheCounters.misses += 1;
      return null;
    }
    groupedHoverTraceCache.delete(key);
    groupedHoverTraceCache.set(key, cached);
    cached.suppressedEventIdentities.forEach((identity) => {
      const trace = traces.find((candidate) => traceIdentity(candidate) === identity);
      if (!trace) return;
      trace.hoverinfo = "skip";
      trace.hovertemplate = undefined;
    });
    groupedHoverCacheCounters.hits += 1;
    return cached.traces.map(cloneGroupedHoverTrace);
  }

  function rememberGroupedHoverCache(key, traces, suppressedEventIdentities) {
    groupedHoverTraceCache.set(key, {
      traces: traces.map(cloneGroupedHoverTrace),
      suppressedEventIdentities: new Set(suppressedEventIdentities),
    });
    while (groupedHoverTraceCache.size > GROUPED_HOVER_CACHE_LIMIT) {
      groupedHoverTraceCache.delete(groupedHoverTraceCache.keys().next().value);
      groupedHoverCacheCounters.evictions += 1;
    }
  }

  function buildGroupedHoverTraces(options = {}) {
    if (!options.enabled) return [];
    const traces = Array.isArray(options.traces) ? options.traces : [];
    const seriesOrder = [...new Set((Array.isArray(options.seriesOrder) ? options.seriesOrder : [])
      .map((series) => String(series || "").trim())
      .filter(Boolean))];
    const labelName = typeof options.labelName === "function"
      ? options.labelName
      : (series) => series;
    const requestedSeries = new Set(seriesOrder);
    const priceTraces = new Map();
    traces.forEach((trace) => {
      const series = String(trace?.meta?.seriesKey || "");
      if (
        requestedSeries.has(series)
        && !priceTraces.has(series)
        && chartOverlayDescriptor(trace).kind === "price"
        && trace?.visible !== "legendonly"
      ) {
        priceTraces.set(series, trace);
      }
    });
    const activeSeries = seriesOrder.filter((series) => priceTraces.has(series));
    if (!activeSeries.length) return [];
    const activeSet = new Set(activeSeries);
    const labels = new Map(activeSeries.map((series) => [series, {
      label: labelName(series),
      color: priceTraces.get(series)?.line?.color || "#eeeeee",
    }]));
    activeSeries.forEach((series) => {
      const trace = priceTraces.get(series);
      trace.hoverinfo = "skip";
      trace.hovertemplate = undefined;
    });
    traces.forEach((trace) => {
      if (chartOverlayDescriptor(trace).kind !== "eps") return;
      const series = String(trace.meta.seriesKey || "").replace(/^eps:/, "");
      if (!activeSet.has(series)) return;
      trace.hoverinfo = "skip";
      trace.hovertemplate = undefined;
    });
    const cacheKey = groupedHoverCacheKey({
      activeSeries,
      priceTraces,
      traces,
      labels,
      revision: options.revision,
    });
    const cachedTraces = readGroupedHoverCache(cacheKey, traces);
    if (cachedTraces) return cachedTraces;
    const rowsBySeries = new Map(activeSeries.map((series) => [series, new Map()]));
    const suppressedEventIdentities = new Set();
    const ensureRow = (series, date, y) => {
      const rows = rowsBySeries.get(series);
      if (!rows || !date) return null;
      const row = rows.get(date) || {
        date,
        y: Number(y),
        price: "",
        details: [],
        hoverSize: 1,
        anchorKind: "price",
      };
      if (!Number.isFinite(row.y) && Number.isFinite(Number(y))) row.y = Number(y);
      rows.set(date, row);
      return row;
    };

    activeSeries.forEach((series) => {
      const trace = priceTraces.get(series);
      (trace.x || []).forEach((date, index) => {
        const row = ensureRow(series, String(date || ""), trace.y?.[index]);
        if (row) row.price = String(trace.text?.[index] ?? "-");
      });
    });

    traces.forEach((trace) => {
      if (chartOverlayDescriptor(trace).kind === "eps") {
        const series = String(trace.meta.seriesKey || "").replace(/^eps:/, "");
        if (!activeSet.has(series)) return;
        (trace.x || []).forEach((date, index) => {
          const row = ensureRow(series, String(date || ""), trace.y?.[index]);
          const detail = cleanEpsHoverText(trace.text?.[index]);
          if (row && detail) {
            if (Number.isFinite(Number(trace.y?.[index]))) row.y = Number(trace.y[index]);
            if (!row.price) row.price = priceTextAtOrBefore(priceTraces.get(series), date);
            row.anchorKind = "eps";
            row.details.push({
              priority: 10,
              // The unified chart header owns date formatting for every layer.
              html: `EPS · ${escapeHoverHtml(detail)}`,
            });
            row.hoverSize = EPS_HOVER_MARKER_SIZE;
          }
        });
        return;
      }
      if (!isEventMarkerTrace(trace)) return;
      let coveredPoints = 0;
      (trace.x || []).forEach((date, index) => {
        const series = eventPointTicker(trace, index);
        if (!activeSet.has(series)) return;
        const row = ensureRow(series, String(date || ""), trace.y?.[index]);
        const html = expandedHoverTemplate(trace, index, labelName(series));
        if (row && html) {
          row.details.push({ priority: hoverDetailPriority(trace), html });
          coveredPoints += 1;
        }
      });
      if (coveredPoints === (trace.x || []).length && coveredPoints > 0) {
        trace.hoverinfo = "skip";
        trace.hovertemplate = undefined;
        suppressedEventIdentities.add(traceIdentity(trace));
      }
    });

    const overlayRevision = traces.filter((trace) => (
      chartOverlayDescriptor(trace).kind === "eps" || isEventMarkerTrace(trace)
    )).map((trace) => (
      trace?.meta?.renderFingerprint
      || `${traceIdentity(trace)}:${trace?.x?.length || 0}:${trace?.x?.at?.(-1) || ""}:${trace?.y?.at?.(-1) || ""}`
    )).join("|");

    const groupedTraces = activeSeries.flatMap((series, seriesIndex) => {
      const { label, color } = labels.get(series);
      const rows = [...rowsBySeries.get(series).values()]
        .filter((row) => Number.isFinite(row.y))
        .sort((left, right) => left.date.localeCompare(right.date));
      if (!rows.length) return [];
      const separator = seriesIndex < activeSeries.length - 1
        ? '<br><span style="color:rgba(180,180,180,0.42)">────────────</span>'
        : "";
      const hoverText = rows.map((row) => {
        const detailLines = [...row.details]
          .sort((left, right) => left.priority - right.priority)
          .map((detail) => `<br>${detail.html}`)
          .join("");
        const price = row.price
          ? `<b style="color:${color}">${escapeHoverHtml(label)}</b> · 가격 ${escapeHoverHtml(row.price)}`
          : `<b style="color:${color}">${escapeHoverHtml(label)}</b>`;
        return `${price}${detailLines}${separator}`;
      });
      return [{
        x: rows.map((row) => row.date),
        y: rows.map((row) => row.y),
        text: hoverText,
        // Unified and point-fallback popups share one content source. Horizontal
        // alignment is normalized in chart-hover-runtime after Plotly renders it.
        customdata: hoverText,
        // Invisible hover targets can contain decades of daily points. WebGL keeps
        // multi-series viewport movement from repeatedly laying out SVG markers.
        type: "scattergl",
        mode: "markers",
        name: "",
        showlegend: false,
        cliponaxis: true,
        // The x-unified popup owns the shared date header. Repeating it here adds
        // one date per visible series in Chromium.
        hovertemplate: groupedHoverTemplate(false),
        meta: {
          overlayKind: "grouped-hover",
          isGroupedHoverTrace: true,
          hoverGroupTicker: series,
          hoverGroupPointKinds: rows.map((row) => row.anchorKind),
          pointHoverTemplate: groupedHoverTemplate(true),
          renderFingerprint: `hover:${series}:${priceTraces.get(series)?.meta?.renderFingerprint || ""}:${overlayRevision}`,
        },
        marker: {
          size: rows.map((row) => row.hoverSize),
          color: "rgba(0,0,0,0)",
          line: { width: 0 },
          opacity: 0,
        },
      }];
    });
    rememberGroupedHoverCache(cacheKey, groupedTraces, suppressedEventIdentities);
    return groupedTraces;
  }

  function groupedHoverCacheStats() {
    return Object.freeze({
      ...groupedHoverCacheCounters,
      entries: groupedHoverTraceCache.size,
      limit: GROUPED_HOVER_CACHE_LIMIT,
    });
  }

  function groupedHoverYUpdate(traces, sourceTraceIndex, values) {
    const sourceTrace = Array.isArray(traces) ? traces[sourceTraceIndex] : null;
    const sourceSeries = String(sourceTrace?.meta?.seriesKey || "");
    if (!sourceSeries || !Array.isArray(values)) return null;
    const sourceKind = chartOverlayDescriptor(sourceTrace).kind === "eps" ? "eps" : "price";
    const ticker = sourceSeries.replace(/^eps:/, "");
    const groupedIndex = traces.findIndex((trace) => (
      trace?.meta?.isGroupedHoverTrace && trace.meta.hoverGroupTicker === ticker
    ));
    if (groupedIndex < 0) return null;
    const grouped = traces[groupedIndex];
    const byDate = new Map((sourceTrace.x || []).map((date, index) => [String(date || ""), values[index]]));
    const pointKinds = grouped?.meta?.hoverGroupPointKinds;
    const y = (grouped.x || []).map((date, index) => (
      (!Array.isArray(pointKinds) || pointKinds[index] === sourceKind)
        && byDate.has(String(date || ""))
        ? byDate.get(String(date || ""))
        : grouped.y?.[index]
    ));
    return { traceIndex: groupedIndex, y };
  }

  function lowerBoundTime(sortedTimes, target) {
    let low = 0;
    let high = sortedTimes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sortedTimes[middle] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBoundTime(sortedTimes, target) {
    let low = 0;
    let high = sortedTimes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sortedTimes[middle] <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function marketSessionsBetween(sortedTimes, startTime, endTime) {
    if (!Array.isArray(sortedTimes) || !sortedTimes.length) return 0;
    return Math.max(
      0,
      lowerBoundTime(sortedTimes, endTime) - upperBoundTime(sortedTimes, startTime),
    );
  }

  function carryNonTradingGaps(xValues, yValues, textValues = [], baseValues = [], options = {}) {
    const x = Array.isArray(xValues) ? xValues : [];
    const y = Array.isArray(yValues) ? [...yValues] : [];
    const text = Array.isArray(textValues) ? [...textValues] : [];
    const base = Array.isArray(baseValues) ? [...baseValues] : [];
    const minimumGapDays = Math.max(
      1,
      Math.floor(Number(options.minimumGapDays) || LONG_NON_TRADING_GAP_DAYS),
    );
    const minimumMarketSessions = Math.max(
      1,
      Math.floor(Number(options.minimumMarketSessions) || NON_TRADING_MARKET_SESSIONS),
    );
    const marketTimes = Array.isArray(options.marketTimes)
      ? options.marketTimes.filter(Number.isFinite).sort((left, right) => left - right)
      : [];
    let previousFiniteIndex = -1;
    let filledPointCount = 0;

    for (let index = 0; index < y.length; index += 1) {
      if (!Number.isFinite(y[index])) continue;
      if (previousFiniteIndex >= 0) {
        const previousTime = Date.parse(String(x[previousFiniteIndex] || ""));
        const currentTime = Date.parse(String(x[index] || ""));
        const gapDays = Number.isFinite(previousTime) && Number.isFinite(currentTime)
          ? Math.round((currentTime - previousTime) / DAY_MS)
          : 0;
        const missingMarketSessions = Number.isFinite(previousTime) && Number.isFinite(currentTime)
          ? marketSessionsBetween(marketTimes, previousTime, currentTime)
          : 0;
        if (gapDays > minimumGapDays || missingMarketSessions >= minimumMarketSessions) {
          for (let gapIndex = previousFiniteIndex + 1; gapIndex < index; gapIndex += 1) {
            const gapTime = Date.parse(String(x[gapIndex] || ""));
            if (!Number.isFinite(gapTime) || Number.isFinite(y[gapIndex])) continue;
            y[gapIndex] = y[previousFiniteIndex];
            base[gapIndex] = Number.isFinite(base[previousFiniteIndex])
              ? base[previousFiniteIndex]
              : null;
            text[gapIndex] = String(options.missingText || "거래 없음");
            filledPointCount += 1;
          }
        }
      }
      previousFiniteIndex = index;
    }

    return { x, y, text, base, filledPointCount };
  }

  const carryLongNonTradingGaps = carryNonTradingGaps;

  function visibleEndpointValues(trace, values = trace?.y, xRange = null, interpolateAtMs = null) {
    const xValues = Array.isArray(trace?.x) ? trace.x : [];
    const yValues = Array.isArray(values) ? values : [];
    const count = Math.min(xValues.length, yValues.length);
    if (!count) return { first: null, last: null };
    const startMs = Date.parse(String(xRange?.[0] || ""));
    const endMs = Date.parse(String(xRange?.[1] || ""));
    const hasRange = Number.isFinite(startMs) && Number.isFinite(endMs);
    const low = hasRange ? Math.min(startMs, endMs) : -Infinity;
    const high = hasRange ? Math.max(startMs, endMs) : Infinity;
    let cachedTimes = traceTimeCache.get(trace);
    if (!cachedTimes || cachedTimes.x !== xValues || cachedTimes.count !== count) {
      const times = xValues.slice(0, count).map((value) => Date.parse(String(value || "")));
      let sorted = times.every(Number.isFinite);
      for (let index = 1; sorted && index < times.length; index += 1) {
        if (times[index] < times[index - 1]) sorted = false;
      }
      cachedTimes = { x: xValues, count, times, sorted };
      traceTimeCache.set(trace, cachedTimes);
    }
    const firstIndex = hasRange && cachedTimes.sorted
      ? lowerBoundTime(cachedTimes.times, low)
      : 0;
    const lastIndex = hasRange && cachedTimes.sorted
      ? upperBoundTime(cachedTimes.times, high)
      : count;
    let first = null;
    let last = null;
    const visibleValueAt = (index) => {
      const rawValue = yValues[index];
      if (rawValue === null) return null;
      const value = Number(rawValue);
      const time = cachedTimes.times[index];
      return Number.isFinite(value)
        && (!hasRange || (Number.isFinite(time) && time >= low && time <= high))
        ? value
        : null;
    };
    for (let index = firstIndex; index < lastIndex; index += 1) {
      first = visibleValueAt(index);
      if (first !== null) break;
    }
    for (let index = lastIndex - 1; index >= firstIndex; index -= 1) {
      last = visibleValueAt(index);
      if (last !== null) break;
    }
    if (hasRange && trace?.meta?.isEpsTrace && typeof interpolateAtMs === "function") {
      const interpolationTrace = values === trace.y ? trace : { ...trace, y: yValues };
      const leftBoundary = interpolateAtMs(interpolationTrace, low);
      const rightBoundary = interpolateAtMs(interpolationTrace, high);
      if (Number.isFinite(leftBoundary)) first = leftBoundary;
      if (Number.isFinite(rightBoundary)) last = rightBoundary;
    }
    return { first, last };
  }

  function isSeriesHandleTrace(trace, baseValuesBySeries = {}) {
    const descriptor = chartOverlayDescriptor(trace);
    const seriesKey = descriptor.seriesKey;
    return Boolean(
      seriesKey
      && trace?.visible !== "legendonly"
      && descriptor.adjustable
      && baseValuesBySeries[seriesKey]
    );
  }

  function adjustableSeriesKeys(traces, baseValuesBySeries = {}) {
    return (Array.isArray(traces) ? traces : []).map((trace) => (
      isSeriesHandleTrace(trace, baseValuesBySeries)
        ? String(trace.meta.seriesKey)
        : ""
    ));
  }

  function buildHandleLayouts(traces, baseValues, xAxis, yAxis, fallbackColors = {}, options = {}) {
    if (!Array.isArray(traces) || !xAxis?._length || !yAxis?._length) return { signature: "", items: [] };
    const keys = adjustableSeriesKeys(traces, baseValues);
    const toPixelY = (value) => {
      if (typeof yAxis.l2p === "function") return yAxis._offset + yAxis.l2p(value);
      const span = Number(yAxis.range?.[1]) - Number(yAxis.range?.[0]);
      return Number.isFinite(span) && Math.abs(span) >= 1e-9
        ? yAxis._offset + yAxis._length * (1 - ((value - yAxis.range[0]) / span))
        : Number.NaN;
    };
    const items = traces.flatMap((trace, traceIndex) => {
      const seriesKey = keys[traceIndex];
      if (!seriesKey) return [];
      const { first, last } = visibleEndpointValues(
        trace,
        trace.y,
        xAxis.range,
        options.interpolateAtMs,
      );
      const leftY = toPixelY(first);
      const rightY = toPixelY(last);
      if (!Number.isFinite(leftY) || !Number.isFinite(rightY)) return [];
      return [{
        traceIndex,
        seriesKey,
        leftY,
        rightY,
        rightX: xAxis._offset + xAxis._length + 6,
        color: trace?.line?.color || fallbackColors[seriesKey] || "#d4d4d4",
        isEps: chartOverlayDescriptor(trace).kind === "eps",
        handleLabel: String(trace?.meta?.handleLabel || ""),
      }];
    });
    const signature = [xAxis.range, yAxis.range, xAxis._offset, xAxis._length, yAxis._offset, yAxis._length,
      ...items.flatMap((item) => [item.seriesKey, item.leftY, item.rightY, item.color])].join("|");
    return { signature, items };
  }

  function restylePayload(traces) {
    return {
      x: traces.map((trace) => trace.x || []),
      y: traces.map((trace) => trace.y || []),
      name: traces.map((trace) => trace.name ?? ""),
      text: traces.map((trace) => trace.text ?? null),
      customdata: traces.map((trace) => trace.customdata ?? null),
      meta: traces.map((trace) => trace.meta ?? null),
      line: traces.map((trace) => trace.line ?? null),
      marker: traces.map((trace) => trace.marker ?? null),
      textfont: traces.map((trace) => trace.textfont ?? null),
      textposition: traces.map((trace) => trace.textposition ?? null),
      connectgaps: traces.map((trace) => trace.connectgaps ?? false),
      cliponaxis: traces.map((trace) => trace.cliponaxis ?? true),
      showlegend: traces.map((trace) => trace.showlegend ?? true),
      legendgroup: traces.map((trace) => trace.legendgroup ?? ""),
      yaxis: traces.map((trace) => trace.yaxis ?? "y"),
      hoverinfo: traces.map((trace) => trace.hoverinfo ?? null),
      hovertemplate: traces.map((trace) => trace.hovertemplate ?? null),
      visible: traces.map((trace) => trace.visible ?? true),
      fill: traces.map((trace) => trace.fill ?? "none"),
      fillcolor: traces.map((trace) => trace.fillcolor ?? null),
    };
  }

  function relayoutPayload(layout) {
    const payload = {
      hovermode: layout.hovermode,
      "xaxis.autorange": false,
      "xaxis.range": [...layout.xaxis.range],
      "xaxis.tickmode": layout.xaxis.tickmode || "auto",
      "xaxis.tickvals": Array.isArray(layout.xaxis.tickvals) ? [...layout.xaxis.tickvals] : null,
      "xaxis.ticktext": Array.isArray(layout.xaxis.ticktext) ? [...layout.xaxis.ticktext] : null,
      "xaxis.tick0": layout.xaxis.tick0 ?? null,
      "xaxis.dtick": layout.xaxis.dtick ?? null,
    };
    ["xaxis", "yaxis"].forEach((axisKey) => {
      ["showspikes", "spikecolor", "spikedash", "spikemode", "spikesnap", "spikethickness"]
        .forEach((property) => {
          payload[`${axisKey}.${property}`] = layout?.[axisKey]?.[property] ?? null;
        });
    });
    if (Array.isArray(layout.yaxis.range) && layout.yaxis.range.length === 2) {
      payload["yaxis.autorange"] = false;
      payload["yaxis.range"] = [...layout.yaxis.range];
    } else {
      payload["yaxis.autorange"] = true;
    }
    return payload;
  }

  const RENDER_FINGERPRINT_PROPERTY = "__thinkStockMainChartFingerprintV1";
  const RENDER_STATE_PROPERTY = "__thinkStockMainChartRenderStateV1";

  function invalidateRenderFingerprint(element) {
    if (!element) return false;
    const hadFingerprint = Boolean(
      element[RENDER_FINGERPRINT_PROPERTY]
      || element[RENDER_STATE_PROPERTY],
    );
    try {
      delete element[RENDER_FINGERPRINT_PROPERTY];
      delete element[RENDER_STATE_PROPERTY];
    } catch (_) {
      element[RENDER_FINGERPRINT_PROPERTY] = "";
      element[RENDER_STATE_PROPERTY] = null;
    }
    return hadFingerprint;
  }

  function mixFingerprintToken(state, token) {
    const text = String(token);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      state.left = Math.imul(state.left ^ code, 16777619) >>> 0;
      state.right = Math.imul(state.right ^ (code + index), 2246822519) >>> 0;
    }
    state.left = Math.imul(state.left ^ text.length, 16777619) >>> 0;
    state.right = Math.imul(state.right ^ (text.length + 0x9e3779b9), 3266489917) >>> 0;
  }

  function fingerprintValue(value, state, ancestors) {
    if (value === null) {
      mixFingerprintToken(state, "null");
      return;
    }
    const valueType = typeof value;
    if (valueType === "number") {
      mixFingerprintToken(state, Number.isNaN(value)
        ? "number:nan"
        : `number:${Object.is(value, -0) ? "-0" : value}`);
      return;
    }
    if (valueType === "string") {
      mixFingerprintToken(state, `string:${value.length}:${value}`);
      return;
    }
    if (valueType === "boolean" || valueType === "undefined" || valueType === "bigint") {
      mixFingerprintToken(state, `${valueType}:${String(value)}`);
      return;
    }
    if (valueType === "function" || valueType === "symbol") {
      mixFingerprintToken(state, valueType);
      return;
    }
    if (ancestors.has(value)) {
      mixFingerprintToken(state, "circular");
      return;
    }
    ancestors.add(value);
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      mixFingerprintToken(state, `array:${value.length}`);
      for (let index = 0; index < value.length; index += 1) {
        fingerprintValue(value[index], state, ancestors);
      }
    } else if (value instanceof Date) {
      mixFingerprintToken(state, `date:${value.toISOString()}`);
    } else {
      const keys = Object.keys(value).sort();
      mixFingerprintToken(state, `object:${keys.length}`);
      keys.forEach((key) => {
        mixFingerprintToken(state, `key:${key}`);
        fingerprintValue(value[key], state, ancestors);
      });
    }
    ancestors.delete(value);
  }

  function valueFingerprint(value) {
    const state = { left: 2166136261, right: 2654435761 };
    fingerprintValue(value, state, new Set());
    return `${state.left.toString(16).padStart(8, "0")}${state.right.toString(16).padStart(8, "0")}`;
  }

  function traceRenderFingerprint(trace) {
    const identity = traceIdentity(trace);
    const fastFingerprint = String(trace?.meta?.renderFingerprint || "");
    if (fastFingerprint) return valueFingerprint([identity, fastFingerprint]);
    return valueFingerprint([
      identity,
      trace?.type,
      trace?.mode,
      trace?.x,
      trace?.y,
      trace?.name,
      trace?.text,
      trace?.customdata,
      trace?.meta,
      trace?.line,
      trace?.marker,
      trace?.textfont,
      trace?.textposition,
      trace?.connectgaps,
      trace?.cliponaxis,
      trace?.showlegend,
      trace?.legendgroup,
      trace?.yaxis,
      trace?.hoverinfo,
      trace?.hovertemplate,
      trace?.visible,
      trace?.fill,
      trace?.fillcolor,
    ]);
  }

  function buildRenderState(traces, layout, config = {}) {
    const traceFingerprints = (Array.isArray(traces) ? traces : []).map(traceRenderFingerprint);
    const layoutFingerprint = valueFingerprint([layout, config]);
    return Object.freeze({
      fingerprint: valueFingerprint([traceFingerprints, layoutFingerprint]),
      layoutFingerprint,
      traceFingerprints: Object.freeze(traceFingerprints),
    });
  }

  function renderFingerprint(traces, layout, config = {}) {
    return buildRenderState(traces, layout, config).fingerprint;
  }

  function changedTraceIndexes(previousState, nextState) {
    if (!previousState || previousState.traceFingerprints?.length !== nextState.traceFingerprints.length) {
      return nextState.traceFingerprints.map((_, index) => index);
    }
    return nextState.traceFingerprints.flatMap((fingerprint, index) => (
      fingerprint === previousState.traceFingerprints[index] ? [] : [index]
    ));
  }

  function rememberRenderFingerprint(element, renderState, result) {
    if (element && renderState?.fingerprint) {
      element[RENDER_FINGERPRINT_PROPERTY] = renderState.fingerprint;
      element[RENDER_STATE_PROPERTY] = renderState;
    }
    return result;
  }

  function dateBounds(rowGroups, fallbackDate = "") {
    const starts = [];
    const ends = [];
    (Array.isArray(rowGroups) ? rowGroups : []).forEach((rows) => {
      if (!Array.isArray(rows) || !rows.length) return;
      const first = String(rows[0]?.date || "").slice(0, 10);
      const last = String(rows.at(-1)?.date || "").slice(0, 10);
      if (first) starts.push(first);
      if (last) ends.push(last);
    });
    const maxDate = ends.length
      ? ends.reduce((latest, date) => date > latest ? date : latest, ends[0])
      : fallbackDate;
    const minDate = starts.length
      ? starts.reduce((earliest, date) => date < earliest ? date : earliest, starts[0])
      : maxDate;
    return { minDate, maxDate };
  }

  function sameLineSources(sources, seriesModels) {
    return Array.isArray(sources)
      && sources.length === seriesModels.length
      && sources.every((source, index) => {
        const model = seriesModels[index];
        return source.model === model
          && source.series === model?.series
          && source.baseLineWidth === model?.baseLineWidth
          && source.xValues === model?.xValues
          && source.values === model?.values
          && source.rawTexts === model?.rawTexts
          && source.baseValues === model?.baseValues;
      });
  }

  function lineSources(seriesModels) {
    return seriesModels.map((model) => ({
      model,
      series: model?.series,
      baseLineWidth: model?.baseLineWidth,
      xValues: model?.xValues,
      values: model?.values,
      rawTexts: model?.rawTexts,
      baseValues: model?.baseValues,
    }));
  }

  function normalizedLineData(seriesModels) {
    const cached = normalizedLineDataCache.get(seriesModels);
    if (cached && sameLineSources(cached.sources, seriesModels)) {
      preparedLineDataCacheCounters.normalizedHits += 1;
      return cached.lines;
    }
    preparedLineDataCacheCounters.normalizedMisses += 1;

    const modelBySeries = new Map(seriesModels.map((model) => [String(model?.series || ""), model]));
    const marketTimes = Object.fromEntries([
      ["KS", "^KS11"],
      ["KQ", "^KQ11"],
    ].map(([market, benchmark]) => {
      const model = modelBySeries.get(benchmark);
      const times = (Array.isArray(model?.xValues) ? model.xValues : []).flatMap((date, index) => (
        Number.isFinite(model?.values?.[index]) && Number.isFinite(Date.parse(String(date || "")))
          ? [Date.parse(String(date))]
          : []
      ));
      return [market, times];
    }));
    const lines = seriesModels.map((model) => {
      const series = model?.series;
      const xValues = Array.isArray(model?.xValues) ? model.xValues : [];
      const values = Array.isArray(model?.values) ? model.values : [];
      const rawTexts = Array.isArray(model?.rawTexts) ? model.rawTexts : [];
      const baseValues = Array.isArray(model?.baseValues) ? model.baseValues : [];
      const market = String(series || "").endsWith(".KQ") ? "KQ" : "KS";
      const renderValues = KOREAN_EQUITY_PATTERN.test(String(series || ""))
        ? carryNonTradingGaps(xValues, values, rawTexts, baseValues, { marketTimes: marketTimes[market] })
        : { x: xValues, y: values, text: rawTexts, base: baseValues, filledPointCount: 0 };
      let fullDataStartMs = NaN;
      let fullDataEndMs = NaN;
      for (let index = 0; index < renderValues.x.length; index += 1) {
        if (!Number.isFinite(renderValues.y[index])) continue;
        const time = Date.parse(String(renderValues.x[index] || ""));
        if (!Number.isFinite(time)) continue;
        if (!Number.isFinite(fullDataStartMs)) fullDataStartMs = time;
        fullDataEndMs = time;
      }
      return {
        series,
        baseLineWidth: model?.baseLineWidth,
        sourcePointCount: xValues.length,
        fullDataEndMs,
        fullDataStartMs,
        longGapFillPointCount: renderValues.filledPointCount,
        x: renderValues.x,
        y: renderValues.y,
        text: renderValues.text,
        base: renderValues.base,
      };
    });
    normalizedLineDataCache.set(seriesModels, {
      sources: lineSources(seriesModels),
      lines,
    });
    return lines;
  }

  function preparedLineData(seriesModels, displayIndexes, renderRevision = "") {
    const normalizedLines = normalizedLineData(seriesModels);
    let cached = preparedLineDataCache.get(seriesModels);
    if (!cached || cached.normalizedLines !== normalizedLines) {
      cached = { normalizedLines, viewports: new Map() };
      preparedLineDataCache.set(seriesModels, cached);
    }
    const viewportKey = renderRevision
      ? `revision:${renderRevision}`
      : (Array.isArray(displayIndexes) ? displayIndexes : FULL_LINE_VIEWPORT_KEY);
    if (cached.viewports.has(viewportKey)) {
      preparedLineDataCacheCounters.viewportHits += 1;
      const lines = cached.viewports.get(viewportKey);
      cached.viewports.delete(viewportKey);
      cached.viewports.set(viewportKey, lines);
      return lines;
    }
    preparedLineDataCacheCounters.viewportMisses += 1;

    const pick = (values) => (
      Array.isArray(displayIndexes)
        ? displayIndexes.map((index) => values[index])
        : values
    );
    const lines = normalizedLines.map((line) => ({
      ...line,
      ...finiteTracePoints(
        pick(line.x),
        pick(line.y),
        pick(line.text),
        pick(line.base),
      ),
    }));
    cached.viewports.set(viewportKey, lines);
    while (cached.viewports.size > PREPARED_LINE_VIEWPORT_CACHE_LIMIT) {
      cached.viewports.delete(cached.viewports.keys().next().value);
      preparedLineDataCacheCounters.evictions += 1;
    }
    return lines;
  }

  function lineDataCacheStats() {
    return Object.freeze({ ...preparedLineDataCacheCounters });
  }

  function buildLineTraces(options = {}) {
    const {
      seriesModels = [],
      displayIndexes = null,
      displayPointCount = null,
      hiddenSeries = new Set(),
      lineTraceType = "scatter",
      hoverShowPopup = false,
      labelName = (series) => String(series || ""),
      seriesColor = () => "#ffffff",
      renderRevision = "",
    } = options;
    const baseValuesBySeries = {};
    const traces = preparedLineData(seriesModels, displayIndexes, renderRevision).map((lineData) => {
      const {
        series,
        baseLineWidth,
        sourcePointCount,
        fullDataEndMs,
        fullDataStartMs,
        longGapFillPointCount,
        x,
        y,
        text,
        base,
      } = lineData;
      baseValuesBySeries[series] = base;
      const color = seriesColor(series);
      return {
        x,
        y,
        text,
        type: lineTraceType,
        mode: "lines",
        name: labelName(series),
        visible: hiddenSeries.has(series) ? "legendonly" : true,
        connectgaps: false,
        meta: {
          overlayKind: "price",
          seriesKey: series,
          baseLineWidth,
          sourcePointCount,
          fullDataEndMs,
          fullDataStartMs,
          longGapFillPointCount,
          displayPointCount: Number.isFinite(displayPointCount)
            ? displayPointCount
            : x.length,
          renderFingerprint: [
            renderRevision,
            series,
            color,
            hiddenSeries.has(series) ? "hidden" : "visible",
            hoverShowPopup ? "hover" : "plain",
            lineTraceType,
          ].join("|"),
        },
        line: { color, width: baseLineWidth, shape: "linear" },
        marker: { symbol: "circle", size: 7, color },
        hoverinfo: hoverShowPopup ? undefined : "skip",
        hovertemplate: hoverShowPopup ? "%{text}<extra>%{fullData.name}</extra>" : undefined,
      };
    });
    return { traces, baseValuesBySeries };
  }

  async function buildMainChartComposition(options = {}) {
    const model = options.model || {};
    const rows = Array.isArray(model.rows) ? model.rows : [];
    const selected = Array.isArray(model.selected) ? model.selected : [];
    const seriesModels = Array.isArray(model.seriesModels) ? model.seriesModels : [];
    const displayIndexes = Array.isArray(options.displayIndexes) ? options.displayIndexes : null;
    const displayPointCount = displayIndexes ? displayIndexes.length : rows.length;
    const lineTraceModel = buildLineTraces({
      seriesModels,
      displayIndexes,
      displayPointCount,
      hiddenSeries: options.hiddenSeries,
      lineTraceType: options.lineTraceType,
      hoverShowPopup: options.hoverShowPopup,
      labelName: options.labelName,
      renderRevision: options.renderRevision,
      seriesColor: options.seriesColor,
    });
    const deferOverlays = options.deferOverlays === true;
    const emptyEpsTraceModel = { traces: [], baseValuesBySeries: {} };
    const epsTraceModel = options.prebuiltEpsTraceModel
      || (!deferOverlays ? options.buildEpsTraceModel?.(seriesModels) : null)
      || emptyEpsTraceModel;
    let forecastResult = options.prebuiltAiForecastTraces || [];
    if (!deferOverlays) {
      [forecastResult] = await Promise.all([
        options.prebuiltAiForecastTraces
          || options.buildAiForecastTraces?.(rows, seriesModels)
          || [],
        options.prepareEventModels?.(selected, seriesModels),
      ]);
    }
    if (options.shouldAbort?.()) return null;

    const aiForecastTraces = Array.isArray(forecastResult) ? forecastResult : [];
    const epsTraces = Array.isArray(epsTraceModel.traces) ? epsTraceModel.traces : [];
    const eventTraces = Array.isArray(options.prebuiltEventTraces)
      ? options.prebuiltEventTraces
      : (!deferOverlays
        ? (options.buildEventTraces?.(options.buildEventArguments?.(model)) || [])
        : []);
    const traces = [
      ...lineTraceModel.traces,
      ...epsTraces,
      ...aiForecastTraces,
      ...(Array.isArray(eventTraces) ? eventTraces : []),
    ];
    const groupedHoverTraces = deferOverlays && Array.isArray(options.prebuiltGroupedHoverTraces)
      ? options.prebuiltGroupedHoverTraces
      : buildGroupedHoverTraces({
          enabled: options.hoverShowPopup,
          traces,
          seriesOrder: selected,
          labelName: options.labelName,
          revision: String(options.eventRevisionKey || ""),
        });
    traces.unshift(...groupedHoverTraces);
    return {
      aiForecastTraces,
      baseValuesBySeries: {
        ...lineTraceModel.baseValuesBySeries,
        ...(epsTraceModel.baseValuesBySeries || {}),
      },
      displayPointCount,
      deferredOverlays: deferOverlays,
      epsTraces,
      traces,
    };
  }

  function buildLongRangeTicks(options = {}) {
    const {
      start = "",
      end = "",
      xRange = null,
      dayMs = 24 * 60 * 60 * 1000,
      toMs = (value) => Date.parse(String(value || "")),
    } = options;
    const visibleStart = String(xRange?.[0] || start).slice(0, 10);
    const visibleEnd = String(xRange?.[1] || end).slice(0, 10);
    const visibleSpan = toMs(visibleEnd) - toMs(visibleStart);
    if (!Number.isFinite(visibleSpan) || visibleSpan < dayMs * 365 * 15) return null;
    const startYear = Number(visibleStart.slice(0, 4));
    const endYear = Number(visibleEnd.slice(0, 4));
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
    const tickvals = [visibleStart];
    const ticktext = [String(startYear)];
    for (let year = Math.ceil((startYear + 1) / 5) * 5; year <= endYear; year += 5) {
      tickvals.push(`${year}-01-01`);
      ticktext.push(String(year));
    }
    return { tickmode: "array", tickvals, ticktext };
  }

  function normalizeCursorLineMode(mode) {
    return ["vertical", "horizontal", "cross"].includes(mode) ? mode : "vertical";
  }

  function buildCursorHoverMode(hoverShowPopup, mode) {
    if (!hoverShowPopup) return false;
    normalizeCursorLineMode(mode);
    return "x unified";
  }

  function buildCursorLineAxisLayout(mode, axis = "x") {
    normalizeCursorLineMode(mode);
    String(axis || "x");
    return {
      // The original synchronized overlay remains the only cursor renderer.
      // Plotly spikes duplicate that line and add work on every pointer move.
      showspikes: false,
      spikecolor: "rgba(0,0,0,0)",
      spikedash: "solid",
      spikemode: "across",
      spikesnap: "cursor",
      spikethickness: 1,
    };
  }

  function buildLayout(options = {}) {
    const {
      horizontalMargin = 24,
      hoverShowPopup = false,
      cursorLineMode = "vertical",
      hoverlabel = {},
      xRange = null,
      defaultXRange = [],
      yRange = null,
      fittedYRange = null,
      longRangeTicks = null,
    } = options;
    return {
      ...chartLoader.layoutStyle(),
      margin: { l: horizontalMargin, r: horizontalMargin, t: 28, b: 32 },
      hovermode: buildCursorHoverMode(hoverShowPopup, cursorLineMode),
      showlegend: false,
      legend: { orientation: "h", x: 0, y: 1.08, font: { color: "rgba(255,255,255,0.7)", size: 11 } },
      xaxis: {
        ...chartLoader.axisStyle({ tickFontSize: 10 }),
        fixedrange: false,
        ...buildCursorLineAxisLayout(cursorLineMode, "x"),
        hoverformat: CHART_HOVER_DATE_FORMAT,
        ...(longRangeTicks || {}),
        ...(xRange ? { range: xRange } : { range: defaultXRange, autorange: false }),
      },
      yaxis: {
        ...chartLoader.axisStyle({ tickFontSize: 10 }),
        showticklabels: false,
        title: "",
        fixedrange: true,
        ...buildCursorLineAxisLayout(cursorLineMode, "y"),
        ...(yRange
          ? { range: yRange, autorange: false }
          : (fittedYRange ? { range: fittedYRange, autorange: false } : {})),
      },
      hoverlabel,
      dragmode: false,
    };
  }

  async function render(plotly, element, traces, layout, config, options = {}) {
    assertChartRenderPayload(traces, layout);
    let attemptedPartial = false;
    const fallbacks = [];
    const nextRenderState = buildRenderState(traces, layout, config);
    const previousRenderState = element?.[RENDER_STATE_PROPERTY] || null;
    if (
      options.skipUnchanged !== false
      && element?._fullLayout?.xaxis
      && element?._fullLayout?.yaxis
      && element[RENDER_FINGERPRINT_PROPERTY] === nextRenderState.fingerprint
    ) {
      return { mode: "skipped", attemptedPartial: false, updateScope: "unchanged" };
    }
    if (canApplyEventMarkerUpdate(element, traces, options.invalidation)) {
      attemptedPartial = true;
      try {
        const structureChanged = uniqueTraceIdentities(element.data)?.join("|")
          !== uniqueTraceIdentities(traces)?.join("|");
        if (structureChanged) await reconcileTraceStructure(plotly, element, traces);
        // Grouped hover traces contain the event summaries. Refresh them with
        // the visible marker layers so a marker-only update cannot leave stale
        // disclosure or insider text behind.
        const allMarkerIndexes = traces.flatMap((trace, index) => (
          isEventMarkerTrace(trace) || chartOverlayDescriptor(trace).grouped ? [index] : []
        ));
        const changedIndexes = new Set(
          options.skipUnchanged === false
            ? traces.map((_, index) => index)
            : changedTraceIndexes(previousRenderState, nextRenderState),
        );
        const markerIndexes = structureChanged
          ? allMarkerIndexes
          : allMarkerIndexes.filter((index) => changedIndexes.has(index));
        if (markerIndexes.length) {
          await plotly.update(
            element,
            restylePayload(markerIndexes.map((index) => traces[index])),
            {},
            markerIndexes,
          );
        }
        return rememberRenderFingerprint(element, nextRenderState, {
          mode: structureChanged ? "structural" : "partial",
          attemptedPartial,
          updateScope: "markers",
        });
      } catch (_) {
        fallbacks.push("markers");
      }
    }
    if (canApplyPartialUpdate(element, traces)) {
      attemptedPartial = true;
      try {
        const traceIndexes = options.skipUnchanged === false
          ? traces.map((_, index) => index)
          : changedTraceIndexes(previousRenderState, nextRenderState);
        const layoutChanged = previousRenderState?.layoutFingerprint !== nextRenderState.layoutFingerprint;
        if (!traceIndexes.length && layoutChanged && typeof plotly.relayout === "function") {
          await plotly.relayout(element, relayoutPayload(layout));
          return rememberRenderFingerprint(element, nextRenderState, {
            mode: "partial",
            attemptedPartial,
            updateScope: "layout",
          });
        }
        await plotly.update(
          element,
          restylePayload(traceIndexes.map((index) => traces[index])),
          layoutChanged ? relayoutPayload(layout) : {},
          traceIndexes,
        );
        return rememberRenderFingerprint(element, nextRenderState, { mode: "partial", attemptedPartial });
      } catch (_) {
        // A plugin may mutate the trace structure between compatibility check and update.
        fallbacks.push("partial");
      }
    }
    if (canReconcileTraceStructure(element, traces)) {
      attemptedPartial = true;
      try {
        await reconcileTraceStructure(plotly, element, traces);
        await plotly.update(
          element,
          restylePayload(traces),
          relayoutPayload(layout),
          traces.map((_, index) => index),
        );
        return rememberRenderFingerprint(element, nextRenderState, { mode: "structural", attemptedPartial });
      } catch (_) {
        // A full render restores a consistent graph after any plugin-side mutation.
        fallbacks.push("structural");
      }
    }
    await plotly.react(element, traces, layout, config);
    return rememberRenderFingerprint(element, nextRenderState, {
      mode: "full",
      attemptedPartial,
      ...(fallbacks.length ? { fallbacks } : {}),
    });
  }

  export const mainChartRenderer = Object.freeze({
    buildLayout,
    chartOverlayDescriptor,
    buildCursorLineAxisLayout,
    buildCursorHoverMode,
    buildGroupedHoverTraces,
    buildMainChartComposition,
    buildSeriesEventPointHideUpdate,
    buildSeriesVisibilityUpdate,
    groupedHoverCacheStats,
    buildHandleLayouts,
    groupedHoverYUpdate,
    buildLineTraces,
    lineDataCacheStats,
    buildLongRangeTicks,
    carryNonTradingGaps,
    carryLongNonTradingGaps,
    canApplyPartialUpdate,
    canApplyEventMarkerUpdate,
    adjustableSeriesKeys,
    canReconcileTraceStructure,
    dateBounds,
    finiteTracePoints,
    isEventMarkerTrace,
    isMarkerOnlyInvalidation,
    isSeriesHandleTrace,
    invalidateRenderFingerprint,
    normalizeCursorLineMode,
    rangeBearingTraces,
    renderFingerprint,
    relayoutPayload,
    reconcileTraceStructure,
    render,
    restylePayload,
    traceIdentity,
    visibleEndpointValues,
  });
