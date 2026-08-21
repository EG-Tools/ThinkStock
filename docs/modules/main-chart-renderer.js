(function initThinkStockMainChartRenderer(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const KOREAN_EQUITY_PATTERN = /^\d{6}\.(?:KS|KQ)$/;
  const LONG_NON_TRADING_GAP_DAYS = 10;
  const NON_TRADING_MARKET_SESSIONS = 3;

  function traceIdentity(trace) {
    if (trace?.meta?.isCrisisSignalTrace) return "crisis-signal";
    if (trace?.meta?.isMarketTimingBuyTrace) return "market-timing-buy";
    if (trace?.meta?.isMarketTimingSellTrace) return "market-timing-sell";
    if (trace?.meta?.isDisclosureTrace) return "disclosure";
    if (trace?.meta?.isInsiderTradeTrace) {
      return `insider:${String(trace.meta.insiderTradeSide || "")}`;
    }
    if (trace?.meta?.isAiForecastBand) {
      return `ai-band:${String(trace.meta.seriesKey || "")}:${String(trace.meta.aiTraceRole || "")}`;
    }
    if (trace?.meta?.isAiForecastScenarioTrace) {
      return `ai-scenario:${String(trace.meta.seriesKey || "")}:${String(trace.meta.aiTraceRole || "")}`;
    }
    if (trace?.meta?.isAiForecastTrace) return `ai:${String(trace.meta.seriesKey || "")}`;
    const seriesKey = String(trace?.meta?.seriesKey || "");
    return seriesKey ? `series:${seriesKey}` : "";
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
    return Boolean(
      trace?.meta?.isCrisisSignalTrace
      || trace?.meta?.isMarketTimingBuyTrace
      || trace?.meta?.isMarketTimingSellTrace
      || trace?.meta?.isDisclosureTrace
      || trace?.meta?.isInsiderTradeTrace
    );
  }

  function canApplyEventMarkerUpdate(element, traces, invalidation = {}) {
    const updateClasses = [...new Set((invalidation?.updateClasses || []).map(String))];
    if (updateClasses.length !== 1 || updateClasses[0] !== "markers") return false;
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

  function visibleEndpointValues(trace, values = trace?.y, xRange = null) {
    const xValues = Array.isArray(trace?.x) ? trace.x : [];
    const yValues = Array.isArray(values) ? values : [];
    const count = Math.min(xValues.length, yValues.length);
    if (!count) return { first: null, last: null };
    const startMs = Date.parse(String(xRange?.[0] || ""));
    const endMs = Date.parse(String(xRange?.[1] || ""));
    const hasRange = Number.isFinite(startMs) && Number.isFinite(endMs);
    const low = hasRange ? Math.min(startMs, endMs) : -Infinity;
    const high = hasRange ? Math.max(startMs, endMs) : Infinity;
    let first = null;
    let last = null;
    for (let index = 0; index < count; index += 1) {
      const value = Number(yValues[index]);
      const time = Date.parse(String(xValues[index] || ""));
      if (!Number.isFinite(value) || (hasRange && (!Number.isFinite(time) || time < low || time > high))) continue;
      if (first === null) first = value;
      last = value;
    }
    return { first, last };
  }

  function isSeriesHandleTrace(trace, baseValuesBySeries = {}) {
    const seriesKey = String(trace?.meta?.seriesKey || "");
    return Boolean(
      seriesKey
      && trace?.visible !== "legendonly"
      && !trace?.meta?.isAiForecastTrace
      && !trace?.meta?.isAiForecastBand
      && !trace?.meta?.isAiForecastScenarioTrace
      && baseValuesBySeries[seriesKey]
    );
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

  function renderFingerprint(traces, layout, config = {}) {
    const state = { left: 2166136261, right: 2654435761 };
    const traceInputs = (Array.isArray(traces) ? traces : []).map((trace) => {
      const fastFingerprint = String(trace?.meta?.renderFingerprint || "");
      if (fastFingerprint) return [traceIdentity(trace), fastFingerprint];
      return [
        traceIdentity(trace),
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
      ];
    });
    fingerprintValue([traceInputs, layout, config], state, new Set());
    return `${state.left.toString(16).padStart(8, "0")}${state.right.toString(16).padStart(8, "0")}`;
  }

  function rememberRenderFingerprint(element, fingerprint, result) {
    if (element && fingerprint) element[RENDER_FINGERPRINT_PROPERTY] = fingerprint;
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
    const pick = (values) => (
      Array.isArray(displayIndexes)
        ? displayIndexes.map((index) => values[index])
        : values
    );
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
    const baseValuesBySeries = {};
    const traces = seriesModels.map((model) => {
      const series = model?.series;
      const xValues = Array.isArray(model?.xValues) ? model.xValues : [];
      const values = Array.isArray(model?.values) ? model.values : [];
      const rawTexts = Array.isArray(model?.rawTexts) ? model.rawTexts : [];
      const baseValues = Array.isArray(model?.baseValues) ? model.baseValues : [];
      const baseLineWidth = model?.baseLineWidth;
      const market = String(series || "").endsWith(".KQ") ? "KQ" : "KS";
      const renderValues = KOREAN_EQUITY_PATTERN.test(String(series || ""))
        ? carryNonTradingGaps(xValues, values, rawTexts, baseValues, { marketTimes: marketTimes[market] })
        : { x: xValues, y: values, text: rawTexts, base: baseValues, filledPointCount: 0 };
      const tracePoints = finiteTracePoints(
        pick(renderValues.x),
        pick(renderValues.y),
        pick(renderValues.text),
        pick(renderValues.base),
      );
      baseValuesBySeries[series] = tracePoints.base;
      const color = seriesColor(series);
      return {
        x: tracePoints.x,
        y: tracePoints.y,
        text: tracePoints.text,
        type: lineTraceType,
        mode: "lines",
        name: labelName(series),
        visible: hiddenSeries.has(series) ? "legendonly" : true,
        connectgaps: false,
        meta: {
          seriesKey: series,
          baseLineWidth,
           sourcePointCount: xValues.length,
          longGapFillPointCount: renderValues.filledPointCount,
          displayPointCount: Number.isFinite(displayPointCount)
            ? displayPointCount
            : tracePoints.x.length,
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
      paper_bgcolor: "transparent",
      plot_bgcolor: "#111111",
      margin: { l: horizontalMargin, r: horizontalMargin, t: 28, b: 32 },
      hovermode: buildCursorHoverMode(hoverShowPopup, cursorLineMode),
      showlegend: false,
      legend: { orientation: "h", x: 0, y: 1.08, font: { color: "rgba(255,255,255,0.7)", size: 11 } },
      xaxis: {
        showgrid: true,
        gridcolor: "rgba(255,255,255,0.06)",
        gridwidth: 1,
        zeroline: false,
        color: "#666",
        tickfont: { size: 10 },
        fixedrange: false,
        ...buildCursorLineAxisLayout(cursorLineMode, "x"),
        hoverformat: "%Y.%-m.%-d",
        ...(longRangeTicks || {}),
        ...(xRange ? { range: xRange } : { range: defaultXRange, autorange: false }),
      },
      yaxis: {
        showticklabels: false,
        title: "",
        showgrid: true,
        gridcolor: "rgba(255,255,255,0.06)",
        gridwidth: 1,
        zeroline: false,
        fixedrange: true,
        ...buildCursorLineAxisLayout(cursorLineMode, "y"),
        ...(yRange
          ? { range: yRange, autorange: false }
          : (fittedYRange ? { range: fittedYRange, autorange: false } : {})),
      },
      font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
      hoverlabel,
      dragmode: false,
    };
  }

  async function render(plotly, element, traces, layout, config, options = {}) {
    let attemptedPartial = false;
    const fallbacks = [];
    const fingerprint = renderFingerprint(traces, layout, config);
    if (
      options.skipUnchanged !== false
      && element?._fullLayout?.xaxis
      && element?._fullLayout?.yaxis
      && element[RENDER_FINGERPRINT_PROPERTY] === fingerprint
    ) {
      return { mode: "skipped", attemptedPartial: false, updateScope: "unchanged" };
    }
    if (canApplyEventMarkerUpdate(element, traces, options.invalidation)) {
      attemptedPartial = true;
      try {
        const structureChanged = uniqueTraceIdentities(element.data)?.join("|")
          !== uniqueTraceIdentities(traces)?.join("|");
        if (structureChanged) await reconcileTraceStructure(plotly, element, traces);
        const markerIndexes = traces.flatMap((trace, index) => (
          isEventMarkerTrace(trace) ? [index] : []
        ));
        if (markerIndexes.length) {
          await plotly.update(
            element,
            restylePayload(markerIndexes.map((index) => traces[index])),
            {},
            markerIndexes,
          );
        }
        return rememberRenderFingerprint(element, fingerprint, {
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
        await plotly.update(
          element,
          restylePayload(traces),
          relayoutPayload(layout),
          traces.map((_, index) => index),
        );
        return rememberRenderFingerprint(element, fingerprint, { mode: "partial", attemptedPartial });
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
        return rememberRenderFingerprint(element, fingerprint, { mode: "structural", attemptedPartial });
      } catch (_) {
        // A full render restores a consistent graph after any plugin-side mutation.
        fallbacks.push("structural");
      }
    }
    await plotly.react(element, traces, layout, config);
    return rememberRenderFingerprint(element, fingerprint, {
      mode: "full",
      attemptedPartial,
      ...(fallbacks.length ? { fallbacks } : {}),
    });
  }

  globalScope.ThinkStockMainChartRenderer = Object.freeze({
    buildLayout,
    buildCursorLineAxisLayout,
    buildCursorHoverMode,
    buildLineTraces,
    buildLongRangeTicks,
    carryNonTradingGaps,
    carryLongNonTradingGaps,
    canApplyPartialUpdate,
    canApplyEventMarkerUpdate,
    canReconcileTraceStructure,
    dateBounds,
    finiteTracePoints,
    isEventMarkerTrace,
    isSeriesHandleTrace,
    normalizeCursorLineMode,
    renderFingerprint,
    relayoutPayload,
    reconcileTraceStructure,
    render,
    restylePayload,
    traceIdentity,
    visibleEndpointValues,
  });
}(typeof self !== "undefined" ? self : globalThis));
