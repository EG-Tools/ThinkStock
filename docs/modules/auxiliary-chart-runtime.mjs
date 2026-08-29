import { chartLoader } from "./chart-loader.mjs";
import { assertChartRenderPayload } from "./chart-render-contract.mjs";
import {
  createAuxiliaryPanelControlView,
  syncControl,
} from "./control-state-view.mjs";

const defaultScope = typeof self !== "undefined" ? self : globalThis;

  const AUXILIARY_STRUCTURE_PROPERTY = "__thinkStockAuxiliaryStructureV1";
  const AUXILIARY_RENDER_STATE_PROPERTY = "__thinkStockAuxiliaryRenderStateV1";
  if (!chartLoader?.layoutStyle || !chartLoader?.axisStyle || !chartLoader?.hoverLabel) {
    throw new Error("Chart visual contract failed to load");
  }
  const PLOTLY_CONFIG = chartLoader.PLOTLY_CONFIG;
  const CHART_HOVER_DATE_FORMAT = chartLoader.PLOTLY_THEME.hoverDateFormat;

  function auxiliaryTraceStructureKey(trace) {
    const meta = trace?.meta || {};
    return [
      String(meta.macdSeriesKey || meta.auxiliarySeriesKey || trace?.name || ""),
      String(meta.auxiliaryZoneGroup || ""),
      String(meta.auxiliaryZoneFill || ""),
      meta.auxiliaryHoverProxy === true ? "hover-proxy" : "",
      String(trace?.type || "scatter"),
      String(trace?.mode || ""),
      String(trace?.yaxis || "y"),
      String(trace?.fill || "none"),
    ].join("|");
  }

  function auxiliaryLayoutTopology(layout = {}) {
    return Object.keys(layout)
      .filter((key) => /^xaxis\d*$|^yaxis\d*$/.test(key))
      .sort()
      .map((key) => {
        const axis = layout[key] || {};
        return [
          key,
          Array.isArray(axis.domain) ? axis.domain.join(",") : "",
          String(axis.anchor || ""),
          String(axis.overlaying || ""),
          String(axis.position ?? ""),
          axis.visible === false ? "hidden" : "visible",
        ].join(":");
      })
      .join("|");
  }

  function auxiliaryRestylePayload(traces) {
    return {
      x: traces.map((trace) => trace.x || []),
      y: traces.map((trace) => trace.y || []),
      name: traces.map((trace) => trace.name ?? ""),
      text: traces.map((trace) => trace.text ?? null),
      customdata: traces.map((trace) => trace.customdata ?? null),
      meta: traces.map((trace) => trace.meta ?? null),
      line: traces.map((trace) => trace.line ?? null),
      marker: traces.map((trace) => trace.marker ?? null),
      hoverinfo: traces.map((trace) => trace.hoverinfo ?? null),
      hovertemplate: traces.map((trace) => trace.hovertemplate ?? null),
      visible: traces.map((trace) => trace.visible ?? true),
      fill: traces.map((trace) => trace.fill ?? "none"),
      fillcolor: traces.map((trace) => trace.fillcolor ?? null),
      connectgaps: traces.map((trace) => trace.connectgaps ?? false),
      showlegend: traces.map((trace) => trace.showlegend ?? true),
      yaxis: traces.map((trace) => trace.yaxis ?? "y"),
    };
  }

  function auxiliaryTraceFingerprint(trace) {
    const meta = trace?.meta || {};
    const explicitRevision = String(meta.renderFingerprint || "");
    const visualRevision = JSON.stringify([
      trace?.name ?? "",
      trace?.visible ?? true,
      trace?.line ?? null,
      trace?.marker ?? null,
      trace?.fill ?? "none",
      trace?.fillcolor ?? null,
      trace?.hoverinfo ?? null,
      trace?.hovertemplate ?? null,
      trace?.showlegend ?? true,
    ]);
    if (explicitRevision) {
      return `${auxiliaryTraceStructureKey(trace)}::${explicitRevision}::${visualRevision}`;
    }
    return `${auxiliaryTraceStructureKey(trace)}::${visualRevision}::${JSON.stringify([
      trace?.x || [],
      trace?.y || [],
      trace?.text || null,
      trace?.customdata || null,
    ])}`;
  }

  function auxiliaryLayoutFingerprint(layout) {
    return JSON.stringify(layout || {});
  }

  function rememberAuxiliaryRenderState(element, traces, layout, signature) {
    element[AUXILIARY_STRUCTURE_PROPERTY] = signature;
    element[AUXILIARY_RENDER_STATE_PROPERTY] = Object.freeze({
      layout: auxiliaryLayoutFingerprint(layout),
      traces: Object.freeze((traces || []).map(auxiliaryTraceFingerprint)),
    });
  }

  function stampAuxiliaryTraceRevisions(traces, revision, variant = null) {
    (traces || []).forEach((trace) => {
      const suffix = typeof variant === "function" ? variant(trace) : "";
      trace.meta = {
        ...(trace.meta || {}),
        renderFingerprint: [revision, auxiliaryTraceStructureKey(trace), suffix].join("::"),
      };
    });
    return traces;
  }

  function createAuxiliaryChartModelResolver(options = {}) {
    const requestModel = options.requestModel;
    const buildModel = options.buildModel;
    const normalizeModel = options.normalizeModel || ((value) => value);
    if (typeof requestModel !== "function"
      || typeof buildModel !== "function"
      || typeof normalizeModel !== "function") {
      throw new Error("auxiliary chart model resolver dependencies are incomplete");
    }
    let cached = null;
    let generation = 0;
    let latestRequest = 0;
    let lastSource = "none";
    const pending = new Map();
    const counters = { hits: 0, misses: 0, coalesced: 0, worker: 0, fallbacks: 0, invalidations: 0 };

    async function resolve(renderKey, payload) {
      const key = String(renderKey || "");
      if (!key) throw new Error("auxiliary chart model key is required");
      if (cached?.key === key) {
        counters.hits += 1;
        return cached.model;
      }
      if (pending.has(key)) {
        counters.coalesced += 1;
        return pending.get(key);
      }
      counters.misses += 1;
      const requestId = ++latestRequest;
      const requestGeneration = generation;
      const task = (async () => {
        let model = null;
        let source = "worker";
        try {
          model = normalizeModel(await requestModel(payload));
          if (!model) throw new Error("auxiliary chart worker returned an invalid model");
          counters.worker += 1;
        } catch (_) {
          source = "sync";
          model = normalizeModel(buildModel({
            ...payload,
            adrRows: payload?.sources?.adrRows || [],
            macroRows: payload?.sources?.macroRows || [],
          }));
          if (!model) throw new Error("auxiliary chart model contract failed");
          counters.fallbacks += 1;
        }
        if (generation === requestGeneration && requestId === latestRequest) {
          cached = { key, model };
          lastSource = source;
        }
        return model;
      })().finally(() => {
        if (pending.get(key) === task) pending.delete(key);
      });
      pending.set(key, task);
      return task;
    }

    function invalidate() {
      generation += 1;
      latestRequest += 1;
      cached = null;
      pending.clear();
      counters.invalidations += 1;
    }

    return Object.freeze({
      cachedModel: () => cached?.model || null,
      invalidate,
      resolve,
      source: () => lastSource,
      stats: () => Object.freeze({
        ...counters,
        cached: Boolean(cached),
        pending: pending.size,
        source: lastSource,
      }),
    });
  }

  function auxiliaryStructureSignature(traces, layout) {
    return `${auxiliaryLayoutTopology(layout)}::${(traces || []).map(auxiliaryTraceStructureKey).join("::")}`;
  }

  function canApplyAuxiliaryUpdate(element, traces, layout) {
    if (!element?._fullLayout?.xaxis || !Array.isArray(element.data) || !element.data.length) return false;
    if (!Array.isArray(traces) || traces.length !== element.data.length || !traces.length) return false;
    const signature = auxiliaryStructureSignature(traces, layout);
    return element[AUXILIARY_STRUCTURE_PROPERTY] === signature
      && traces.every((trace, index) => (
        auxiliaryTraceStructureKey(trace) === auxiliaryTraceStructureKey(element.data[index])
      ));
  }

  async function renderAuxiliaryPlot(plotly, element, traces, layout, config) {
    assertChartRenderPayload(traces, layout);
    const signature = auxiliaryStructureSignature(traces, layout);
    let attemptedPartial = false;
    if (canApplyAuxiliaryUpdate(element, traces, layout)) {
      attemptedPartial = true;
      try {
        const previous = element[AUXILIARY_RENDER_STATE_PROPERTY] || null;
        const nextTraceFingerprints = traces.map(auxiliaryTraceFingerprint);
        const nextLayoutFingerprint = auxiliaryLayoutFingerprint(layout);
        const changedIndexes = previous
          ? nextTraceFingerprints.flatMap((fingerprint, index) => (
            fingerprint === previous.traces?.[index] ? [] : [index]
          ))
          : traces.map((_, index) => index);
        const layoutChanged = previous?.layout !== nextLayoutFingerprint;
        if (!changedIndexes.length && !layoutChanged) {
          return { mode: "skipped", attemptedPartial, updateScope: "unchanged" };
        }
        if (!changedIndexes.length && layoutChanged && typeof plotly.relayout === "function") {
          await plotly.relayout(element, layout);
          rememberAuxiliaryRenderState(element, traces, layout, signature);
          return { mode: "partial", attemptedPartial, updateScope: "layout" };
        }
        const changedTraces = changedIndexes.map((index) => traces[index]);
        await plotly.update(
          element,
          auxiliaryRestylePayload(changedTraces),
          layoutChanged ? layout : {},
          changedIndexes,
        );
        rememberAuxiliaryRenderState(element, traces, layout, signature);
        return { mode: "partial", attemptedPartial, updateScope: "traces" };
      } catch (_) {
        // Plotly plugins can alter axis topology; a full render restores it safely.
      }
    }
    await plotly.react(element, traces, layout, config);
    rememberAuxiliaryRenderState(element, traces, layout, signature);
    return { mode: "full", attemptedPartial };
  }

  function createAuxiliaryChartRuntime(scope = defaultScope, options = {}) {
    const {
      ADR_BAND_COLOR,
      ADR_HIGH_THRESH,
      ADR_LOW_THRESH,
      ADR_ZONE_HIGH_COLOR,
      ADR_ZONE_LOW_COLOR,
      AUXILIARY_ZONE_HIGH_FILL_COLOR,
      AUXILIARY_ZONE_LOW_FILL_COLOR,
      AUXILIARY_PANEL_KEYS,
      AUXILIARY_SERIES_KEYS,
      FEAR_GREED_HIGH_THRESH,
      FEAR_GREED_LOW_THRESH,
      MACD_STOCK_PATTERN,
      NEWS_SENTIMENT_HIGH_THRESH,
      NEWS_SENTIMENT_LOW_THRESH,
      SERIES_COLORS,
      auxiliaryChartHorizontalMargin,
      buildCursorHoverMode,
      buildCursorLineAxisLayout,
      buildAuxiliaryPanelLayout,
      buildAuxiliaryViewportRanges,
      buildThresholdEnvelopeSeries,
      buildThresholdFillPolygons,
      chartDisplaySampler,
      chartSession,
      clearHoverOnChart,
      dataRevisionSignature,
      dataState,
      getAuxiliaryChartModel: externalGetAuxiliaryChartModel,
      getAuxiliaryChartModelSource: externalGetAuxiliaryChartModelSource,
      getMacdModelForSeries,
      fitRangeForTraces,
      isTouchDevice,
      labelName,
      persistState,
      recordPerfSample,
      scheduleViewportRangeSync,
      setNewsSentimentMovingAverageDays,
      seriesColor,
      startPerfSample,
      syncHoverToChart,
      syncState,
      thinMacdPoints,
      xRangeMatches,
    } = options;
    if (!scope.document
      || !dataState
      || !syncState
      || !chartDisplaySampler
      || typeof buildThresholdFillPolygons !== "function"
      || typeof fitRangeForTraces !== "function") {
      throw new Error("auxiliary chart runtime dependencies are incomplete");
    }

    const auxiliaryModelResolver = typeof externalGetAuxiliaryChartModel === "function"
      ? null
      : createAuxiliaryChartModelResolver({
        requestModel: options.requestAuxiliaryChartModel,
        buildModel: options.buildAuxiliaryChartModel,
        normalizeModel: options.normalizeAuxiliaryChartModel,
      });
    const getAuxiliaryChartModel = typeof externalGetAuxiliaryChartModel === "function"
      ? externalGetAuxiliaryChartModel
      : (renderKey, startDate) => auxiliaryModelResolver.resolve(renderKey, {
        datasetKey: dataRevisionSignature("adr", "macro"),
        sources: { adrRows: dataState.adrRows, macroRows: dataState.macroRows },
        startDate,
        adrLowThreshold: ADR_LOW_THRESH,
        adrHighThreshold: ADR_HIGH_THRESH,
        newsLowThreshold: NEWS_SENTIMENT_LOW_THRESH,
        newsHighThreshold: NEWS_SENTIMENT_HIGH_THRESH,
        newsMovingAverageDays: chartSession.newsSentimentMovingAverageDays,
      });
    const getAuxiliaryChartModelSource = typeof externalGetAuxiliaryChartModelSource === "function"
      ? externalGetAuxiliaryChartModelSource
      : () => auxiliaryModelResolver.source();

    function viewportRangeFromRelayout(payload) {
      if (!payload || typeof payload !== "object") return null;
      const pair = Array.isArray(payload["xaxis.range"])
        ? payload["xaxis.range"].slice(0, 2)
        : [payload["xaxis.range[0]"], payload["xaxis.range[1]"]];
      return pair.length === 2 && pair.every((value) => value != null) ? pair : null;
    }

    function buildMacdViewportYRange(element, xRange) {
      if (!element?.data || !Array.isArray(xRange)) return null;
      const fitted = fitRangeForTraces(
        element.data.filter((trace) => trace?.meta?.macdSeriesKey),
        xRange,
        { paddingRatio: 0.08, minimumPadding: 0.02 },
      );
      if (!fitted) return null;
      const maxAbs = Math.max(0.02, Math.abs(fitted[0]), Math.abs(fitted[1]));
      return [-maxAbs, maxAbs];
    }

    function buildAuxiliaryViewportRelayout(model, xRange, targetElement) {
      if (!model || !Array.isArray(xRange) || !targetElement?.data) return null;
      const ranges = buildAuxiliaryViewportRanges(model, xRange, {
        adrLowThreshold: ADR_LOW_THRESH,
        adrHighThreshold: ADR_HIGH_THRESH,
        newsLowThreshold: NEWS_SENTIMENT_LOW_THRESH,
        newsHighThreshold: NEWS_SENTIMENT_HIGH_THRESH,
        activePanels: {
          adr: !chartSession.hiddenAuxiliaryPanels.has("adr"),
          newsSentiment: !chartSession.hiddenAuxiliaryPanels.has("newsSentiment"),
          vkospi: !chartSession.hiddenAuxiliaryPanels.has("vkospi"),
        },
      });
      const relayout = {};
      const addRange = (seriesKeys, range) => {
        const trace = targetElement.data.find((candidate) => (
          candidate.visible !== false
          && candidate.visible !== "legendonly"
          && seriesKeys.includes(candidate.meta?.auxiliarySeriesKey)
        ));
        if (!trace || !Array.isArray(range)) return;
        const axisReference = trace.yaxis || "y";
        const axisKey = axisReference === "y" ? "yaxis" : `yaxis${axisReference.slice(1)}`;
        relayout[`${axisKey}.range[0]`] = range[0];
        relayout[`${axisKey}.range[1]`] = range[1];
        relayout[`${axisKey}.autorange`] = false;
      };
      addRange([AUXILIARY_SERIES_KEYS.adrKospi, AUXILIARY_SERIES_KEYS.adrKosdaq], ranges.adr);
      addRange([AUXILIARY_SERIES_KEYS.newsSentiment], ranges.news);
      addRange([AUXILIARY_SERIES_KEYS.vkospi, AUXILIARY_SERIES_KEYS.vix], ranges.vkospi);
      return Object.keys(relayout).length ? relayout : null;
    }

    function addViewportYRangeToRelayout(targetElement, payload) {
      if (!chartSession.autoChartReset || !targetElement || !payload) return payload;
      const xRange = viewportRangeFromRelayout(payload);
      if (!xRange) return payload;
      if (targetElement.id === "chart-macd") {
        const range = buildMacdViewportYRange(targetElement, xRange);
        return range ? {
          ...payload,
          "yaxis.range[0]": range[0],
          "yaxis.range[1]": range[1],
          "yaxis.autorange": false,
        } : payload;
      }
      if (targetElement.id === "chart-adr") {
        const yPayload = buildAuxiliaryViewportRelayout(
          auxiliaryModelResolver?.cachedModel?.(),
          xRange,
          targetElement,
        );
        return yPayload ? { ...payload, ...yPayload } : payload;
      }
      return payload;
    }

    const document = scope.document;
    const plotlyHoverLabel = (fontSize) => chartLoader.hoverLabel(
      chartSession.hoverShowPopup,
      fontSize,
    );
    const REFERENCE_LINE_DASH = "2px,4px";
    const referenceLineStyle = (color) => ({
      color,
      width: 1,
      dash: REFERENCE_LINE_DASH,
    });
    const multiPanelCursorAxisLayout = () => ({
      ...buildCursorLineAxisLayout(chartSession.cursorLineMode, "y"),
      // A shared 1px overlay draws the horizontal cursor once. Plotly would
      // otherwise stack one spike per visible auxiliary y-axis.
      showspikes: false,
      spikecolor: "rgba(0,0,0,0)",
    });

    function relayoutViewport(eventData = {}) {
      const pair = Array.isArray(eventData["xaxis.range"]) ? eventData["xaxis.range"] : null;
      const start = eventData["xaxis.range[0]"] ?? pair?.[0] ?? null;
      const end = eventData["xaxis.range[1]"] ?? pair?.[1] ?? null;
      return {
        autorange: eventData["xaxis.autorange"] === true,
        range: start != null && end != null ? [start, end] : null,
      };
    }

    function bindAuxiliaryHoverHandlers(element, targetIds) {
      const targets = () => targetIds
        .map((id) => document.getElementById(id))
        .filter((target) => target && !target.hidden);
      element.on("plotly_beforehover", () => (
        element.classList.contains("is-hover-waiting") ? false : undefined
      ));
      element.on("plotly_hover", (eventData) => {
        if (element.classList.contains("is-hover-waiting")) return;
        if (!chartSession.hoverShowPopup || syncState.hoverSyncing) return;
        const xValue = eventData?.points?.[0]?.x;
        if (!xValue) return;
        targets().forEach((target) => syncHoverToChart(target, xValue));
      });
      element.on("plotly_unhover", () => {
        if (!chartSession.hoverShowPopup || syncState.hoverSyncing) return;
        targets().forEach(clearHoverOnChart);
      });
    }
    let adrHandlerSet = false;
    let lastAdrRenderKey = "";
    let auxiliaryChartRenderGeneration = 0;
    let pendingAdrRenderRequest = null;
    let adrRenderPromise = null;
    let lastMacdTraceCount = 0;
    let lastMacdRenderKey = "";
    let macdHandlerSet = false;
    let auxiliaryPartialRenderCount = 0;
    let auxiliaryFullRenderCount = 0;
    let auxiliarySkippedRenderCount = 0;

    const viewportSliceOptions = Object.freeze({
      bufferRatio: 2,
      minimumBufferMs: 45 * 24 * 60 * 60 * 1000,
    });
    const sliceViewport = (dates, arrays, xRange) => chartDisplaySampler.sliceViewportArrays(
      dates,
      arrays,
      xRange,
      viewportSliceOptions,
    );
    const viewportRenderKey = (xRange) => (
      Array.isArray(xRange) && xRange.length === 2
        ? xRange.map((value) => String(value || "").slice(0, 19)).join(":")
        : "full"
    );
    const hasFiniteValues = (values) => Array.isArray(values) && values.some(Number.isFinite);
    const emptyViewportSlice = (arrayCount = 1) => ({
      dates: [],
      arrays: Array.from({ length: Math.max(0, arrayCount) }, () => []),
    });
    const sliceVisiblePanel = (visible, dates, arrays, xRange) => (
      visible ? sliceViewport(dates, arrays, xRange) : emptyViewportSlice(arrays.length)
    );
    const controlsSignature = (controls) => JSON.stringify((controls || []).map((control) => ({
      active: control.active !== false,
      available: control.available !== false,
      color: control.color || "",
      key: control.key || "",
      panelKey: control.panelKey || "",
      text: control.text || "",
    })));
    const panelTitlesSignature = (panels) => JSON.stringify((panels || []).map((panel) => ({
      color: panel.color || "",
      controls: controlsSignature(panel.controls),
      key: panel.key || "",
      presets: (panel.presets || []).map((preset) => ({
        active: preset.active === true,
        days: Number(preset.days) || 0,
      })),
      text: panel.text || "",
    })));
    const panelControlView = createAuxiliaryPanelControlView(scope, {
      state: chartSession,
      panelKeys: AUXILIARY_PANEL_KEYS,
      controlsSignature,
      persist: persistState,
      onChange: () => {
        const mainRange = document.getElementById("chart")?._fullLayout?.xaxis?.range?.slice() || null;
        Promise.resolve(renderAdrChart(mainRange)).catch((error) => {
          scope.console?.error?.("auxiliary chart visibility update failed", error);
        });
      },
    });
    const bindAuxiliaryToggle = panelControlView.bindToggle;
    const isAuxiliaryPanelVisible = panelControlView.isPanelVisible;
    const normalizeAuxiliaryPanelOrder = panelControlView.normalizeOrder;
    const syncAuxiliaryRepresentativeToggles = panelControlView.syncRepresentativeToggles;
    const toggleAuxiliaryPanel = panelControlView.togglePanel;
    const toggleAuxiliarySeries = panelControlView.toggleSeries;
    const auxiliaryNumber = (value) => (
      value != null && Number.isFinite(Number(value)) ? Number(value) : null
    );

    function findAuxiliaryDate(rows, key = "", fromEnd = false) {
      const source = Array.isArray(rows) ? rows : [];
      for (
        let index = fromEnd ? source.length - 1 : 0;
        fromEnd ? index >= 0 : index < source.length;
        index += fromEnd ? -1 : 1
      ) {
        const row = source[index];
        if (row?.date && (!key || auxiliaryNumber(row[key]) !== null)) return row.date;
      }
      return "";
    }

    const findLatestAuxiliaryDate = (rows, key = "") => findAuxiliaryDate(rows, key, true);
    const findEarliestAuxiliaryDate = (rows, key = "") => findAuxiliaryDate(rows, key, false);

    function buildThresholdZoneFillTraces(dates, values, legendName, seriesKey = "", options = {}) {
      const sourceValues = (Array.isArray(values) ? values : []).map(auxiliaryNumber);
      const base = {
        type: "scatter",
        mode: "lines",
        connectgaps: false,
        visible: seriesKey && chartSession.hiddenAuxiliarySeries.has(seriesKey) ? "legendonly" : true,
      };
      const noHover = { hoverinfo: "skip", hovertemplate: undefined };
      const zoneGroup = String(options.zoneGroup || seriesKey || "");
      const buildFill = (direction, threshold, fillcolor) => (
        buildThresholdFillPolygons(dates, sourceValues, threshold, direction).map((polygon) => ({
          ...base,
          x: polygon.dates,
          y: polygon.values,
          name: legendName,
          meta: {
            ...(seriesKey ? { auxiliarySeriesKey: seriesKey } : {}),
            auxiliaryZoneGroup: zoneGroup,
            auxiliaryZoneFill: direction,
          },
          showlegend: false,
          line: { color: "transparent", width: 0 },
          fill: "toself",
          fillcolor,
          ...noHover,
        }))
      );
      return [
        ...(options.includeLow === false ? [] : buildFill(
          "low",
          Number(options.lowThreshold ?? ADR_LOW_THRESH),
          AUXILIARY_ZONE_LOW_FILL_COLOR,
        )),
        ...(options.includeHigh === false ? [] : buildFill(
          "high",
          Number(options.highThreshold ?? ADR_HIGH_THRESH),
          AUXILIARY_ZONE_HIGH_FILL_COLOR,
        )),
      ];
    }

    function buildAdrZoneTraces(dates, values, mainColor, legendName, seriesKey, options = {}) {
      const sourceValues = (Array.isArray(values) ? values : []).map(auxiliaryNumber);
      const fillTraces = options.includeFill === false
        ? []
        : buildThresholdZoneFillTraces(dates, sourceValues, legendName, seriesKey, options);
      return [
        ...fillTraces,
        {
          x: dates,
          y: sourceValues,
          type: "scatter",
          mode: "lines",
          connectgaps: false,
          meta: { auxiliarySeriesKey: seriesKey },
          visible: chartSession.hiddenAuxiliarySeries.has(seriesKey) ? "legendonly" : true,
          name: legendName,
          showlegend: false,
          line: { color: mainColor, width: 1 },
          hoverinfo: "skip",
          hovertemplate: undefined,
        },
      ];
    }

    function syncAuxiliarySeparators(
      el,
      separatorPaperPositions = null,
      panelTitles = null,
      representativeControls = null,
    ) {
      if (!el) return;
      const panelTitlesProvided = Array.isArray(panelTitles);
      const nextPanelTitlesSignature = panelTitlesProvided
        ? panelTitlesSignature(panelTitles)
        : "";
      const existingHeadingCount = el.querySelectorAll(":scope > .auxiliary-panel-heading").length;
      const rebuildHeadings = panelTitlesProvided && (
        nextPanelTitlesSignature !== String(el.auxiliaryPanelTitlesSignature || "")
        || existingHeadingCount !== panelTitles.length
      );
      if (Array.isArray(separatorPaperPositions)) {
        el.auxiliarySeparatorPaperPositions = [...separatorPaperPositions];
      }
      if (Array.isArray(panelTitles)) {
        if (rebuildHeadings) {
          el.auxiliaryPanelTitles = panelTitles.map((panel) => ({ ...panel }));
          el.auxiliaryPanelTitlesSignature = nextPanelTitlesSignature;
        }
      }
      let layer = el.querySelector(":scope > .auxiliary-separator-layer");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "auxiliary-separator-layer";
        el.append(layer);
      }
      const representativeRow = syncAuxiliaryRepresentativeToggles(el, representativeControls);
      const plotSize = el._fullLayout?._size;
      const top = Number(plotSize?.t) || 14;
      const plotHeight = Number(plotSize?.h)
        || Math.max(1, el.clientHeight - top - 36);
      const containerRect = el.getBoundingClientRect();
      const representativeRect = representativeRow?.getBoundingClientRect();
      const representativeBottom = representativeRect?.height
        ? representativeRect.bottom - containerRect.top + 5
        : Math.max(0, top - 8);
      const paperPositions = Array.isArray(el.auxiliarySeparatorPaperPositions)
        ? el.auxiliarySeparatorPaperPositions
        : [];
      const visiblePanelTitles = Array.isArray(el.auxiliaryPanelTitles)
        ? el.auxiliaryPanelTitles
        : [];
      const separators = [
        { key: "controls", top: representativeBottom },
        ...paperPositions.map((paperY) => ({
          key: String(paperY),
          paperY,
          top: top + ((1 - paperY) * plotHeight),
        })),
      ];
      const separatorFragment = document.createDocumentFragment();
      const headingFragment = rebuildHeadings ? document.createDocumentFragment() : null;
      if (rebuildHeadings) {
        el.querySelectorAll(":scope > .auxiliary-panel-heading").forEach((heading) => heading.remove());
      }
      separators.forEach((separator, index) => {
        const lineTop = Math.max(0, Math.min(el.clientHeight - 1, separator.top));
        const line = document.createElement("i");
        line.className = "auxiliary-section-separator";
        line.setAttribute("aria-hidden", "true");
        line.dataset.separator = separator.key;
        if (visiblePanelTitles[index]?.key) {
          line.dataset.panelKey = visiblePanelTitles[index].key;
        }
        if (separator.paperY) line.dataset.paperY = String(separator.paperY);
        line.style.top = `${lineTop}px`;
        separatorFragment.append(line);
        if (visiblePanelTitles[index]?.text) {
          if (!rebuildHeadings) {
            const heading = el.querySelector(
              `:scope > .auxiliary-panel-heading[data-panel-key="${visiblePanelTitles[index].key}"]`,
            );
            if (heading) {
              heading.style.left = `${Number(plotSize?.l) || 0}px`;
              heading.style.top = `${lineTop + 3}px`;
            }
            return;
          }
          const heading = document.createElement("div");
          heading.className = "auxiliary-panel-heading";
          heading.dataset.panelKey = visiblePanelTitles[index].key;
          heading.style.left = `${Number(plotSize?.l) || 0}px`;
          heading.style.top = `${lineTop + 3}px`;
          const title = document.createElement("button");
          title.type = "button";
          title.className = "auxiliary-panel-title";
          title.dataset.panelKey = visiblePanelTitles[index].key;
          syncControl(title, { active: true, pressed: true });
          title.setAttribute("aria-label", `${visiblePanelTitles[index].text} 보조차트 숨기기`);
          title.style.setProperty(
            "--auxiliary-series-color",
            visiblePanelTitles[index].color || "#ffffff",
          );
          title.textContent = visiblePanelTitles[index].text;
          bindAuxiliaryToggle(
            title,
            () => toggleAuxiliaryPanel(visiblePanelTitles[index].key),
          );
          heading.append(title);
          const presets = visiblePanelTitles[index].presets || [];
          if (presets.length) {
            const presetGroup = document.createElement("div");
            presetGroup.className = "auxiliary-average-presets";
            presetGroup.setAttribute("role", "group");
            presetGroup.setAttribute("aria-label", "뉴스심리 이동평균 빠른 선택");
            presets.forEach((preset) => {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "auxiliary-average-preset";
              button.dataset.newsSentimentAverageDays = String(preset.days);
              syncControl(button, { active: preset.active, pressed: preset.active });
              button.setAttribute("aria-label", `뉴스심리 ${preset.days}일 이동평균`);
              const label = document.createElement("span");
              label.textContent = String(preset.days);
              button.append(label);
              bindAuxiliaryToggle(button, () => {
                if (typeof setNewsSentimentMovingAverageDays === "function") {
                  setNewsSentimentMovingAverageDays(preset.days);
                }
              });
              presetGroup.append(button);
            });
            heading.append(presetGroup);
          }
          (visiblePanelTitles[index].controls || []).forEach((control) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "auxiliary-series-toggle";
            button.dataset.auxiliarySeries = control.key;
            syncControl(button, { active: control.active, pressed: control.active });
            button.setAttribute("aria-label", `${control.text} 선 ${control.active ? "숨기기" : "표시"}`);
            button.disabled = control.available === false;
            button.style.setProperty("--auxiliary-series-color", control.color || "#ffffff");
            button.textContent = control.text;
            bindAuxiliaryToggle(button, () => toggleAuxiliarySeries(control.key));
            heading.append(button);
          });
          headingFragment.append(heading);
        }
      });
      layer.replaceChildren(separatorFragment);
      if (headingFragment) el.append(headingFragment);
      if (!el.auxiliarySeparatorResizeObserver && typeof scope.ResizeObserver === "function") {
        el.auxiliarySeparatorResizeObserver = new scope.ResizeObserver(() => {
          scope.requestAnimationFrame?.(() => syncAuxiliarySeparators(el));
        });
        el.auxiliarySeparatorResizeObserver.observe(el);
      }
    }

    async function renderMacdChart(xRange) {
      const perfStartedAt = startPerfSample();
      const el = document.getElementById("chart-macd");
      if (!el) return;
      const renderedSeries = (chartSession.currentMainChartModel?.seriesModels || [])
        .map((model) => String(model?.series || "").toUpperCase())
        .filter((series) => series && !chartSession.hiddenSeries.has(series));
      const visibleSeries = renderedSeries.filter((series) => MACD_STOCK_PATTERN.test(series));
      if (!visibleSeries.length) {
        el.hidden = true;
        lastMacdTraceCount = 0;
        return;
      }
    
      el.hidden = false;
      const dataStart = chartSession.currentDataStart || String(dataState.pricePayload?.records?.[0]?.date || "").slice(0, 10);
      const dataEnd = chartSession.currentDataEnd || String(dataState.pricePayload?.records?.at(-1)?.date || "").slice(0, 10);
      const renderKey = [
        dataStart,
        dataEnd,
        viewportRenderKey(xRange),
        chartSession.hoverShowPopup ? 1 : 0,
        chartSession.cursorLineMode,
        dataRevisionSignature("price"),
        visibleSeries.join(","),
      ].join("::");
      if (lastMacdRenderKey === renderKey && el.data?.length) {
        if (Array.isArray(xRange)
          && xRange.length === 2
          && !xRangeMatches(el, xRange[0], xRange[1])) {
          scheduleViewportRangeSync(el, { "xaxis.range[0]": xRange[0], "xaxis.range[1]": xRange[1] });
        }
        return;
      }
    
      const totalPointBudget = isTouchDevice() ? 10000 : 18000;
      const pointBudget = Math.max(
        1800,
        Math.min(9000, Math.floor(totalPointBudget / Math.max(1, visibleSeries.length))),
      );
      const traces = [];
      const allValues = [];
      visibleSeries.forEach((series) => {
        const model = getMacdModelForSeries(series);
        if (!model) return;
        const viewportSeries = sliceViewport(model.dates, [model.normalized], xRange);
        const viewportDates = viewportSeries.dates;
        const viewportValues = viewportSeries.arrays[0] || [];
        const displayDates = [];
        const displayValues = [];
        viewportDates.forEach((date, index) => {
          if ((dataStart && date < dataStart) || (dataEnd && date > dataEnd)) return;
          const value = viewportValues[index];
          if (!Number.isFinite(value)) return;
          displayDates.push(date);
          displayValues.push(value);
        });
        if (!displayValues.length) return;
        const thinned = thinMacdPoints(displayDates, displayValues, pointBudget);
        const baseColor = seriesColor(series);
        allValues.push(...thinned.values.filter(Number.isFinite));
        traces.push({
          x: thinned.dates,
          y: thinned.values,
          type: "scatter",
          mode: "lines",
          name: labelName(series),
          line: {
            color: baseColor,
            width: 1,
          },
          opacity: visibleSeries.length > 1 ? 0.78 : 0.9,
          hoverinfo: chartSession.hoverShowPopup ? undefined : "skip",
          hovertemplate: chartSession.hoverShowPopup
            ? "%{x|%Y.%-m.%-d}<br>오실레이터 %{y:.3f}%<extra>%{fullData.name}</extra>"
            : undefined,
          meta: { macdSeriesKey: series, macdSignal: model.signal },
        });
      });
    
      lastMacdTraceCount = traces.length;
      const maxAbs = allValues.length
        ? Math.max(0.02, ...allValues.map((value) => Math.abs(value)))
        : 1;
      const viewportYRange = buildMacdViewportYRange({ data: traces }, xRange);
      const layout = {
        ...chartLoader.layoutStyle(),
        margin: { l: auxiliaryChartHorizontalMargin(), r: auxiliaryChartHorizontalMargin(), t: 34, b: 30 },
        hovermode: buildCursorHoverMode(
          chartSession.hoverShowPopup,
          chartSession.cursorLineMode,
        ),
        showlegend: traces.length > 0,
        legend: {
          orientation: "h", x: 0.5, y: 1.18, xanchor: "center",
          font: { color: "rgba(255,255,255,0.72)", size: 10 },
        },
        barmode: "overlay",
        bargap: 0,
        shapes: [{
          type: "line", xref: "paper", yref: "y",
          x0: 0, x1: 1, y0: 0, y1: 0,
          line: referenceLineStyle("rgba(255,255,255,0.42)"),
        }],
        annotations: traces.length ? [{
          xref: "paper", yref: "paper", x: 0, y: 1.18,
          xanchor: "left", yanchor: "middle",
          text: "MACD",
          showarrow: false,
          font: { color: "rgba(255,255,255,0.72)", size: 11 },
        }] : [{
          xref: "paper", yref: "paper", x: 0.5, y: 0.5,
          text: "표시 중인 종목의 MACD 이력이 부족합니다.",
          showarrow: false,
          font: { color: "rgba(255,255,255,0.55)", size: 11 },
        }],
        xaxis: {
          ...chartLoader.axisStyle({ tickFontSize: 9 }),
          fixedrange: false,
          ...buildCursorLineAxisLayout(chartSession.cursorLineMode, "x"),
          hoverformat: CHART_HOVER_DATE_FORMAT,
          ...(Array.isArray(xRange) && xRange.length === 2 ? { range: xRange } : {}),
        },
        yaxis: {
          ...chartLoader.axisStyle({
            axisColor: "#777",
            gridColor: "rgba(255,255,255,0.055)",
            tickFontSize: 9,
          }),
          ticksuffix: "%",
          tickformat: ".2f", fixedrange: true,
          ...buildCursorLineAxisLayout(chartSession.cursorLineMode, "y"),
          range: viewportYRange || [-maxAbs * 1.08, maxAbs * 1.08],
        },
        hoverlabel: plotlyHoverLabel(11),
        dragmode: false,
      };
    
      stampAuxiliaryTraceRevisions(traces, renderKey);
      const renderResult = await renderAuxiliaryPlot(scope.Plotly, el, traces, layout, PLOTLY_CONFIG);
      if (renderResult.mode === "partial") auxiliaryPartialRenderCount += 1;
      else if (renderResult.mode === "full") auxiliaryFullRenderCount += 1;
      else auxiliarySkippedRenderCount += 1;
      lastMacdRenderKey = renderKey;
      if (!macdHandlerSet) {
        el.on("plotly_relayout", (eventData) => {
          if (syncState.chartSyncing) return;
          const viewport = relayoutViewport(eventData);
          if (!viewport.range) return;
          chartSession.pinnedXRange = viewport.range;
          [document.getElementById("chart"), document.getElementById("chart-adr")]
            .filter((target) => target?.data)
            .forEach((target) => scheduleViewportRangeSync(target, {
              "xaxis.range[0]": viewport.range[0],
              "xaxis.range[1]": viewport.range[1],
            }));
        });
        bindAuxiliaryHoverHandlers(el, ["chart", "chart-adr"]);
        macdHandlerSet = true;
      }
      recordPerfSample("renderMacdChart", perfStartedAt, {
        traces: traces.length,
        points: traces.reduce((sum, trace) => sum + (trace.x?.length || 0), 0),
        renderMode: renderResult.mode,
        updateScope: renderResult.updateScope || "",
      });
    }

    async function renderAdrChartNow(xRange) {
      const perfStartedAt = startPerfSample();
      const el = document.getElementById("chart-adr");
      const latestAdrDate = findLatestAuxiliaryDate(dataState.adrRows);
      const latestNewsDate = findLatestAuxiliaryDate(dataState.macroRows, "news_sentiment");
      const latestVkospiDate = findLatestAuxiliaryDate(dataState.adrRows, "vkospi");
      const latestVixDate = findLatestAuxiliaryDate(dataState.adrRows, "vix");
      if (!el || (!latestAdrDate && !latestNewsDate && !latestVkospiDate && !latestVixDate)) return;
    
      const earliestAdrDate = findEarliestAuxiliaryDate(dataState.adrRows);
      const earliestNewsDate = findEarliestAuxiliaryDate(dataState.macroRows, "news_sentiment");
      const earliestVkospiDate = findEarliestAuxiliaryDate(dataState.adrRows, "vkospi");
      const earliestVixDate = findEarliestAuxiliaryDate(dataState.adrRows, "vix");
      const availableStart = [earliestAdrDate, earliestNewsDate, earliestVkospiDate, earliestVixDate]
        .filter(Boolean).sort()[0] || "";
      const startDate = chartSession.currentDataStart || availableStart;
      const endDate = chartSession.currentDataEnd
        || [latestAdrDate, latestNewsDate, latestVkospiDate, latestVixDate]
          .filter(Boolean).sort().slice(-1)[0]
        || "";
      const modelKey = [
        startDate,
        dataRevisionSignature("adr", "macro"),
        chartSession.newsSentimentMovingAverageDays,
      ].join("::");
      const panelOrder = normalizeAuxiliaryPanelOrder();
      const renderKey = [
        modelKey,
        endDate,
        viewportRenderKey(AUXILIARY_PANEL_KEYS.some((key) => isAuxiliaryPanelVisible(key)) ? xRange : null),
        chartSession.hoverShowPopup ? 1 : 0,
        chartSession.cursorLineMode,
        [...chartSession.hiddenAuxiliarySeries].sort().join(","),
        [...chartSession.hiddenAuxiliaryPanels].sort().join(","),
        panelOrder.join(","),
      ].join("::");
      if (lastAdrRenderKey === renderKey
        && (el.data?.length || el.dataset.auxiliaryEmpty === "true")) {
        if (el.data?.length
          && Array.isArray(xRange)
          && xRange.length === 2
          && !xRangeMatches(el, xRange[0], xRange[1])) {
          const rangePayload = addViewportYRangeToRelayout(el, {
            "xaxis.range[0]": xRange[0],
            "xaxis.range[1]": xRange[1],
          });
          syncState.chartSyncing = true;
          try {
            await scope.Plotly.relayout(el, rangePayload);
          } catch (_) {
            // A newer queued viewport request will retry with the latest range.
          } finally {
            syncState.chartSyncing = false;
          }
        }
        recordPerfSample("renderAdrChart", perfStartedAt, { rows: el.data[0]?.x?.length || 0, cacheHit: true });
        return;
      }

      const renderGeneration = ++auxiliaryChartRenderGeneration;
      const model = await getAuxiliaryChartModel(modelKey, startDate);
      if (!model
        || renderGeneration !== auxiliaryChartRenderGeneration
        || pendingAdrRenderRequest) return;
      const adrKospiAvailable = hasFiniteValues(model.adrKospiValues);
      const adrKosdaqAvailable = hasFiniteValues(model.adrKosdaqValues);
      const fearGreedAvailable = hasFiniteValues(model.fearGreedValues);
      const newsSentimentAvailable = hasFiniteValues(model.newsValues);
      const vkospiAvailable = hasFiniteValues(model.vkospiValues);
      const vixAvailable = hasFiniteValues(model.vixValues);
      const panelLayout = buildAuxiliaryPanelLayout({
        adr: isAuxiliaryPanelVisible("adr") && (adrKospiAvailable || adrKosdaqAvailable),
        fearGreed: isAuxiliaryPanelVisible("fearGreed") && fearGreedAvailable,
        newsSentiment: isAuxiliaryPanelVisible("newsSentiment") && newsSentimentAvailable,
        vkospi: isAuxiliaryPanelVisible("vkospi") && (vkospiAvailable || vixAvailable),
      }, { panelOrder });
      const commonSlice = sliceVisiblePanel(
        panelLayout.active.adr,
        model.dates,
        [model.kospiValues, model.kosdaqValues],
        xRange,
      );
      const adrKospiSlice = sliceVisiblePanel(
        panelLayout.active.adr,
        model.adrKospiDates,
        [model.adrKospiValues],
        xRange,
      );
      const adrKosdaqSlice = sliceVisiblePanel(
        panelLayout.active.adr,
        model.adrKosdaqDates,
        [model.adrKosdaqValues],
        xRange,
      );
      const fearGreedSlice = sliceVisiblePanel(
        panelLayout.active.fearGreed,
        model.fearGreedDates,
        [model.fearGreedValues],
        xRange,
      );
      const newsSlice = sliceVisiblePanel(
        panelLayout.active.newsSentiment,
        model.newsDates,
        [model.newsValues],
        xRange,
      );
      const vkospiSlice = sliceVisiblePanel(
        panelLayout.active.vkospi,
        model.vkospiDates,
        [model.vkospiValues],
        xRange,
      );
      const vixSlice = sliceVisiblePanel(
        panelLayout.active.vkospi,
        model.vixDates,
        [model.vixValues],
        xRange,
      );
      const renderModel = {
        ...model,
        dates: commonSlice.dates,
        kospiValues: commonSlice.arrays[0] || [],
        kosdaqValues: commonSlice.arrays[1] || [],
        adrKospiDates: adrKospiSlice.dates,
        adrKospiValues: adrKospiSlice.arrays[0] || [],
        adrKosdaqDates: adrKosdaqSlice.dates,
        adrKosdaqValues: adrKosdaqSlice.arrays[0] || [],
        fearGreedDates: fearGreedSlice.dates,
        fearGreedValues: fearGreedSlice.arrays[0] || [],
        newsDates: newsSlice.dates,
        newsValues: newsSlice.arrays[0] || [],
        vkospiDates: vkospiSlice.dates,
        vkospiValues: vkospiSlice.arrays[0] || [],
        vixDates: vixSlice.dates,
        vixValues: vixSlice.arrays[0] || [],
      };
      const {
        dates,
        kospiValues: kospiVals,
        kosdaqValues: kosdaqVals,
        adrKospiDates,
        adrKospiValues,
        adrKosdaqDates,
        adrKosdaqValues,
        fearGreedDates,
        fearGreedValues: fearGreedVals,
        newsDates,
        newsValues: newsSentimentVals,
        vkospiDates,
        vkospiValues,
        vixDates,
        vixValues,
        adrRowCount,
        newsRowCount,
        vkospiRowCount,
        vixRowCount,
      } = renderModel;
      if (!adrRowCount && !newsRowCount && !vkospiRowCount && !vixRowCount) return;
      const viewportRanges = buildAuxiliaryViewportRanges(model, xRange, {
        adrLowThreshold: ADR_LOW_THRESH,
        adrHighThreshold: ADR_HIGH_THRESH,
        newsLowThreshold: NEWS_SENTIMENT_LOW_THRESH,
        newsHighThreshold: NEWS_SENTIMENT_HIGH_THRESH,
        activePanels: panelLayout.active,
      });
      const [adrYMin, adrYMax] = viewportRanges.adr;
      const [newsYMin, newsYMax] = viewportRanges.news;
      const [vkospiYMin, vkospiYMax] = viewportRanges.vkospi;
      const horizontalMargin = auxiliaryChartHorizontalMargin();
      const chartMargin = { l: horizontalMargin, r: horizontalMargin, t: 52, b: 36 };
      const hiddenAuxiliary = chartSession.hiddenAuxiliarySeries;
      const adrKospiEnabled = !hiddenAuxiliary.has(AUXILIARY_SERIES_KEYS.adrKospi)
        && adrKospiAvailable;
      const adrKosdaqEnabled = !hiddenAuxiliary.has(AUXILIARY_SERIES_KEYS.adrKosdaq)
        && adrKosdaqAvailable;
      const vkospiEnabled = !hiddenAuxiliary.has(AUXILIARY_SERIES_KEYS.vkospi)
        && vkospiAvailable;
      const vixEnabled = !hiddenAuxiliary.has(AUXILIARY_SERIES_KEYS.vix)
        && vixAvailable;
      const adrKospiVisible = panelLayout.active.adr && adrKospiEnabled;
      const adrKosdaqVisible = panelLayout.active.adr && adrKosdaqEnabled;
      const vkospiVisible = panelLayout.active.vkospi && vkospiEnabled;
      const vixVisible = panelLayout.active.vkospi && vixEnabled;
      const adrEnvelopeSources = [
        ...(adrKospiVisible ? [{ dates: adrKospiDates, values: adrKospiValues }] : []),
        ...(adrKosdaqVisible ? [{ dates: adrKosdaqDates, values: adrKosdaqValues }] : []),
      ];
      const adrLowEnvelope = buildThresholdEnvelopeSeries(adrEnvelopeSources, "low");
      const adrHighEnvelope = buildThresholdEnvelopeSeries(adrEnvelopeSources, "high");
      const adrZoneFillTraces = [
        ...buildThresholdZoneFillTraces(
          adrLowEnvelope.dates,
          adrLowEnvelope.values,
          "ADR",
          "",
          {
            zoneGroup: "adr",
            lowThreshold: ADR_LOW_THRESH,
            includeHigh: false,
          },
        ),
        ...buildThresholdZoneFillTraces(
          adrHighEnvelope.dates,
          adrHighEnvelope.values,
          "ADR",
          "",
          {
            zoneGroup: "adr",
            highThreshold: ADR_HIGH_THRESH,
            includeLow: false,
          },
        ),
      ].map((trace) => ({
        ...trace,
        yaxis: panelLayout.axes.adr,
        showlegend: false,
        visible: panelLayout.active.adr,
      }));
      const chartHeight = panelLayout.chartHeight;
      const chartHeightText = `${chartHeight}px`;
      el.style.height = chartHeightText;
      el.style.minHeight = chartHeightText;
      el.style.maxHeight = chartHeightText;

      const titleByPanel = {
        adr: "ADR",
        fearGreed: "공포탐욕",
        newsSentiment: "뉴스심리",
        vkospi: "변동성",
      };
      const colorByPanel = {
        adr: "#fb7185",
        fearGreed: SERIES_COLORS.fear_greed,
        newsSentiment: SERIES_COLORS.news_sentiment,
        vkospi: "rgba(255,255,255,0.72)",
      };
      const representativeControls = [
        {
          panelKey: "adr",
          text: "ADR",
          active: panelLayout.active.adr,
          available: adrKospiAvailable || adrKosdaqAvailable,
          color: colorByPanel.adr,
        },
        {
          panelKey: "vkospi",
          text: "변동성",
          active: panelLayout.active.vkospi,
          available: vkospiAvailable || vixAvailable,
          color: colorByPanel.vkospi,
        },
        {
          panelKey: "fearGreed",
          key: AUXILIARY_SERIES_KEYS.fearGreed,
          text: "공포탐욕",
          active: panelLayout.active.fearGreed,
          available: fearGreedAvailable,
          color: colorByPanel.fearGreed,
        },
        {
          panelKey: "newsSentiment",
          key: AUXILIARY_SERIES_KEYS.newsSentiment,
          text: "뉴스심리",
          active: panelLayout.active.newsSentiment,
          available: newsSentimentAvailable,
          color: colorByPanel.newsSentiment,
        },
      ];
      const panelTitles = panelLayout.activeKeys.map((key) => ({
        key,
        text: titleByPanel[key],
        color: colorByPanel[key],
        presets: key === "newsSentiment"
          ? [1, 5, 20].map((days) => ({
            days,
            active: Number(chartSession.newsSentimentMovingAverageDays) === days,
          }))
          : [],
        controls: key === "adr" ? [
          {
            key: AUXILIARY_SERIES_KEYS.adrKospi,
            text: "KOSPI",
            active: adrKospiVisible,
            available: adrKospiAvailable,
            color: "#facc15",
          },
          {
            key: AUXILIARY_SERIES_KEYS.adrKosdaq,
            text: "KOSDAQ",
            active: adrKosdaqVisible,
            available: adrKosdaqAvailable,
            color: "#f472b6",
          },
        ] : (key === "vkospi" ? [
          {
            key: AUXILIARY_SERIES_KEYS.vkospi,
            text: "VKOSPI",
            active: vkospiVisible,
            available: vkospiAvailable,
            color: SERIES_COLORS.vkospi,
          },
          {
            key: AUXILIARY_SERIES_KEYS.vix,
            text: "VIX",
            active: vixVisible,
            available: vixAvailable,
            color: SERIES_COLORS.vix,
          },
        ] : []),
      }));

      if (!panelLayout.activeKeys.length) {
        scope.Plotly.purge(el);
        delete el[AUXILIARY_STRUCTURE_PROPERTY];
        delete el[AUXILIARY_RENDER_STATE_PROPERTY];
        el.replaceChildren();
        el.dataset.auxiliaryEmpty = "true";
        adrHandlerSet = false;
        syncAuxiliarySeparators(el, [], [], representativeControls);
        lastAdrRenderKey = renderKey;
        recordPerfSample("renderAdrChart", perfStartedAt, {
          rows: adrRowCount,
          newsRows: newsRowCount,
          vkospiRows: vkospiRowCount,
          vixRows: vixRowCount,
          cacheHit: true,
          activePanels: 0,
        });
        return;
      }
      delete el.dataset.auxiliaryEmpty;

      const hoverProxyTraces = [
        {
          x: dates,
          y: dates.map((_, i) => {
            const k = kospiVals[i];
            const q = kosdaqVals[i];
            return Number.isFinite(k) ? k : (Number.isFinite(q) ? q : null);
          }),
          customdata: dates.map((_, i) => [
            Number.isFinite(kospiVals[i]) ? `${kospiVals[i].toFixed(2)}%` : "N/A",
            Number.isFinite(kosdaqVals[i]) ? `${kosdaqVals[i].toFixed(2)}%` : "N/A",
          ]),
          type: "scatter",
          mode: "lines",
          name: "ADR HOVER",
          yaxis: panelLayout.axes.adr,
          showlegend: false,
          visible: panelLayout.active.adr,
          connectgaps: false,
          line: { color: "rgba(0,0,0,0)", width: 1 },
          hoverinfo: chartSession.hoverShowPopup ? undefined : "skip",
          hovertemplate: chartSession.hoverShowPopup ? "KOSPI. %{customdata[0]}<br>KOSDAQ. %{customdata[1]}<extra></extra>" : undefined,
        },
        {
          x: fearGreedDates,
          y: fearGreedVals,
          type: "scatter",
          mode: "lines",
          name: "공포탐욕",
          meta: {
            auxiliaryHoverProxy: true,
            auxiliarySeriesKey: AUXILIARY_SERIES_KEYS.fearGreed,
          },
          yaxis: panelLayout.axes.fearGreed,
          showlegend: false,
          visible: panelLayout.active.fearGreed,
          connectgaps: false,
          line: { color: "rgba(0,0,0,0)", width: 1 },
          hoverinfo: chartSession.hoverShowPopup ? undefined : "skip",
          hovertemplate: chartSession.hoverShowPopup ? "공포탐욕. %{y:.0f}<extra></extra>" : undefined,
        },
        {
          x: newsDates,
          y: newsSentimentVals,
          type: "scatter",
          mode: "lines",
          name: "뉴스심리",
          meta: {
            auxiliaryHoverProxy: true,
            auxiliarySeriesKey: AUXILIARY_SERIES_KEYS.newsSentiment,
          },
          yaxis: panelLayout.axes.newsSentiment,
          showlegend: false,
          visible: panelLayout.active.newsSentiment,
          connectgaps: false,
          line: { color: "rgba(0,0,0,0)", width: 1 },
          hoverinfo: chartSession.hoverShowPopup ? undefined : "skip",
          hovertemplate: chartSession.hoverShowPopup ? "뉴스심리. %{y:.2f}<extra></extra>" : undefined,
        },
      ];
    
      const traces = [
        ...adrZoneFillTraces,
        ...buildAdrZoneTraces(
          adrKospiDates,
          adrKospiValues,
          "#facc15",
          "KOSPI",
          AUXILIARY_SERIES_KEYS.adrKospi,
          { includeFill: false },
        ).map((trace) => ({
          ...trace,
          yaxis: panelLayout.axes.adr,
          showlegend: false,
          visible: adrKospiVisible,
        })),
        ...buildAdrZoneTraces(
          adrKosdaqDates,
          adrKosdaqValues,
          "#f472b6",
          "KOSDAQ",
          AUXILIARY_SERIES_KEYS.adrKosdaq,
          { includeFill: false },
        ).map((trace) => ({
          ...trace,
          yaxis: panelLayout.axes.adr,
          showlegend: false,
          visible: adrKosdaqVisible,
        })),
        ...buildAdrZoneTraces(
          fearGreedDates,
          fearGreedVals,
          SERIES_COLORS.fear_greed,
          "공포탐욕",
          AUXILIARY_SERIES_KEYS.fearGreed,
          {
            lowThreshold: FEAR_GREED_LOW_THRESH,
            highThreshold: FEAR_GREED_HIGH_THRESH,
          },
        ).map((trace) => ({
          ...trace,
          yaxis: panelLayout.axes.fearGreed,
          showlegend: false,
          visible: panelLayout.active.fearGreed,
        })),
        ...buildAdrZoneTraces(
          newsDates,
          newsSentimentVals,
          SERIES_COLORS.news_sentiment,
          "뉴스심리",
          AUXILIARY_SERIES_KEYS.newsSentiment,
          {
            lowThreshold: NEWS_SENTIMENT_LOW_THRESH,
            highThreshold: NEWS_SENTIMENT_HIGH_THRESH,
          },
        ).map((trace) => ({
          ...trace,
          yaxis: panelLayout.axes.newsSentiment,
          showlegend: false,
          visible: panelLayout.active.newsSentiment,
        })),
        {
          x: vkospiDates,
          y: vkospiValues,
          yaxis: panelLayout.axes.vkospi,
          type: "scatter",
          mode: "lines",
          name: "VKOSPI",
          meta: { auxiliarySeriesKey: AUXILIARY_SERIES_KEYS.vkospi },
          showlegend: false,
          visible: vkospiVisible,
          connectgaps: false,
          line: { color: SERIES_COLORS.vkospi, width: 1 },
          hoverinfo: chartSession.hoverShowPopup ? undefined : "skip",
          hovertemplate: chartSession.hoverShowPopup ? "VKOSPI. %{y:.2f}<extra></extra>" : undefined,
        },
        {
          x: vixDates,
          y: vixValues,
          yaxis: panelLayout.axes.vkospi,
          type: "scatter",
          mode: "lines",
          name: "VIX",
          meta: { auxiliarySeriesKey: AUXILIARY_SERIES_KEYS.vix },
          showlegend: false,
          visible: vixVisible,
          connectgaps: false,
          line: { color: SERIES_COLORS.vix, width: 1 },
          hoverinfo: chartSession.hoverShowPopup ? undefined : "skip",
          hovertemplate: chartSession.hoverShowPopup ? "VIX. %{y:.2f}<extra></extra>" : undefined,
        },
        ...hoverProxyTraces,
      ].filter((trace) => trace.visible !== false);

      const annotations = [
        ...(panelLayout.active.adr ? [
          {
            xref: "paper", yref: panelLayout.axes.adr, x: 1.005, y: ADR_LOW_THRESH,
            text: "80%", showarrow: false, xanchor: "left",
            font: { color: "#ffffff", size: 11 },
          },
          {
            xref: "paper", yref: panelLayout.axes.adr, x: 1.005, y: ADR_HIGH_THRESH,
            text: "120%", showarrow: false, xanchor: "left",
            font: { color: "#ffffff", size: 11 },
          },
        ] : []),
        ...(panelLayout.active.fearGreed ? [
          {
            xref: "paper", yref: panelLayout.axes.fearGreed, x: 1.005, y: FEAR_GREED_LOW_THRESH,
            text: "공포", showarrow: false, xanchor: "left",
            font: { color: "#ffffff", size: 11 },
          },
          {
            xref: "paper", yref: panelLayout.axes.fearGreed, x: 1.005, y: FEAR_GREED_HIGH_THRESH,
            text: "탐욕", showarrow: false, xanchor: "left",
            font: { color: "#ffffff", size: 11 },
          },
        ] : []),
        ...(panelLayout.active.newsSentiment ? [
          {
            xref: "paper", yref: panelLayout.axes.newsSentiment, x: 1.005, y: NEWS_SENTIMENT_LOW_THRESH,
            text: "부정", showarrow: false, xanchor: "left",
            font: { color: "#ffffff", size: 11 },
          },
          {
            xref: "paper", yref: panelLayout.axes.newsSentiment, x: 1.005, y: NEWS_SENTIMENT_HIGH_THRESH,
            text: "긍정", showarrow: false, xanchor: "left",
            font: { color: "#ffffff", size: 11 },
          },
        ] : []),
      ].filter(Boolean);

      const axisLayoutKey = (axisReference) => (
        axisReference === "y" ? "yaxis" : `yaxis${String(axisReference).slice(1)}`
      );
      const yAxisLayouts = {};
      if (panelLayout.active.adr) {
        yAxisLayouts[axisLayoutKey(panelLayout.axes.adr)] = {
          ...chartLoader.axisStyle({ tickFontSize: 9 }),
          visible: true,
          fixedrange: true, ticksuffix: "%",
          tickformat: ".0f",
          autorange: false,
          range: [adrYMin, adrYMax],
          domain: panelLayout.domains.adr,
          ...multiPanelCursorAxisLayout(),
        };
      }
      if (panelLayout.active.fearGreed) {
        yAxisLayouts[axisLayoutKey(panelLayout.axes.fearGreed)] = {
          ...chartLoader.axisStyle({ showGrid: false, axisColor: "#777", tickFontSize: 9 }),
          visible: true,
          tickvals: [0, FEAR_GREED_LOW_THRESH, 50, FEAR_GREED_HIGH_THRESH, 100],
          fixedrange: true,
          range: [0, 100],
          domain: panelLayout.domains.fearGreed,
          ...multiPanelCursorAxisLayout(),
        };
      }
      if (panelLayout.active.newsSentiment) {
        yAxisLayouts[axisLayoutKey(panelLayout.axes.newsSentiment)] = {
          ...chartLoader.axisStyle({ showGrid: false, axisColor: "#777", tickFontSize: 9 }),
          visible: true,
          tickvals: [NEWS_SENTIMENT_LOW_THRESH, 100, NEWS_SENTIMENT_HIGH_THRESH],
          fixedrange: true,
          range: [newsYMin, newsYMax],
          domain: panelLayout.domains.newsSentiment,
          ...multiPanelCursorAxisLayout(),
        };
      }
      if (panelLayout.active.vkospi) {
        yAxisLayouts[axisLayoutKey(panelLayout.axes.vkospi)] = {
          ...chartLoader.axisStyle({ showGrid: false, axisColor: "#777", tickFontSize: 9 }),
          visible: true,
          tickformat: ".1f",
          fixedrange: true,
          range: [vkospiYMin, vkospiYMax],
          domain: panelLayout.domains.vkospi,
          ...multiPanelCursorAxisLayout(),
        };
      }

      const layout = {
        ...chartLoader.layoutStyle({ plotBackground: "rgba(0,0,0,0)" }),
        // A transparent subplot background prevents Plotly's fallback axis from
        // covering a lower panel while the axis topology changes.
        height: chartHeight,
        autosize: true,
        // Every chart shares fixed side rails so dates, cursors, and labels stay aligned.
        margin: chartMargin,
        hovermode: buildCursorHoverMode(
          chartSession.hoverShowPopup,
          chartSession.cursorLineMode,
        ),
        showlegend: false,
        shapes: [
          {
            type: "rect", xref: "paper", yref: panelLayout.axes.adr,
            visible: panelLayout.active.adr,
            x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_HIGH_THRESH,
            fillcolor: ADR_BAND_COLOR, line: { width: 0 }, layer: "below",
          },
          // 80% reference line
          {
            type: "line", xref: "paper", yref: panelLayout.axes.adr,
            visible: panelLayout.active.adr,
            x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_LOW_THRESH,
            line: referenceLineStyle(ADR_ZONE_LOW_COLOR),
          },
          // 120% reference line
          {
            type: "line", xref: "paper", yref: panelLayout.axes.adr,
            visible: panelLayout.active.adr,
            x0: 0, x1: 1, y0: ADR_HIGH_THRESH, y1: ADR_HIGH_THRESH,
            line: referenceLineStyle(ADR_ZONE_HIGH_COLOR),
          },
          // 100% center line
          {
            type: "line", xref: "paper", yref: panelLayout.axes.adr,
            visible: panelLayout.active.adr,
            x0: 0, x1: 1, y0: 100, y1: 100,
            line: referenceLineStyle("rgba(255,255,255,0.15)"),
          },
          {
            type: "line", xref: "paper", yref: panelLayout.axes.fearGreed,
            visible: panelLayout.active.fearGreed,
            x0: 0, x1: 1, y0: FEAR_GREED_LOW_THRESH, y1: FEAR_GREED_LOW_THRESH,
            line: referenceLineStyle(ADR_ZONE_LOW_COLOR),
          },
          {
            type: "line", xref: "paper", yref: panelLayout.axes.fearGreed,
            visible: panelLayout.active.fearGreed,
            x0: 0, x1: 1, y0: 50, y1: 50,
            line: referenceLineStyle("rgba(255,255,255,0.15)"),
          },
          {
            type: "line", xref: "paper", yref: panelLayout.axes.fearGreed,
            visible: panelLayout.active.fearGreed,
            x0: 0, x1: 1, y0: FEAR_GREED_HIGH_THRESH, y1: FEAR_GREED_HIGH_THRESH,
            line: referenceLineStyle(ADR_ZONE_HIGH_COLOR),
          },
          {
            type: "line", xref: "paper", yref: panelLayout.axes.newsSentiment,
            visible: panelLayout.active.newsSentiment,
            x0: 0, x1: 1, y0: NEWS_SENTIMENT_LOW_THRESH, y1: NEWS_SENTIMENT_LOW_THRESH,
            line: referenceLineStyle(ADR_ZONE_LOW_COLOR),
          },
          {
            type: "line", xref: "paper", yref: panelLayout.axes.newsSentiment,
            visible: panelLayout.active.newsSentiment,
            x0: 0, x1: 1, y0: 100, y1: 100,
            line: referenceLineStyle("rgba(255,255,255,0.15)"),
          },
          {
            type: "line", xref: "paper", yref: panelLayout.axes.newsSentiment,
            visible: panelLayout.active.newsSentiment,
            x0: 0, x1: 1, y0: NEWS_SENTIMENT_HIGH_THRESH, y1: NEWS_SENTIMENT_HIGH_THRESH,
            line: referenceLineStyle(ADR_ZONE_HIGH_COLOR),
          },
        ].filter((shape) => shape.visible !== false),
        annotations,
        xaxis: {
          ...chartLoader.axisStyle({ tickFontSize: 9 }),
          fixedrange: false,
          visible: panelLayout.activeKeys.length > 0,
          anchor: "free",
          position: 0,
          ...buildCursorLineAxisLayout(chartSession.cursorLineMode, "x"),
          hoverformat: CHART_HOVER_DATE_FORMAT,
          ...(xRange ? { range: xRange } : {}),
        },
        ...yAxisLayouts,
        hoverlabel: plotlyHoverLabel(11),
        dragmode: false,
      };
    
      const traceDataRevision = [modelKey, endDate, viewportRenderKey(xRange)].join("::");
      stampAuxiliaryTraceRevisions(traces, traceDataRevision, (trace) => (
        trace?.meta?.auxiliaryZoneGroup === "adr"
          ? `${adrKospiVisible ? 1 : 0}:${adrKosdaqVisible ? 1 : 0}`
          : String(trace?.visible ?? true)
      ));
      try {
        const renderResult = await renderAuxiliaryPlot(scope.Plotly, el, traces, layout, PLOTLY_CONFIG);
        if (renderResult.mode === "partial") auxiliaryPartialRenderCount += 1;
        else if (renderResult.mode === "full") auxiliaryFullRenderCount += 1;
        else auxiliarySkippedRenderCount += 1;
        lastAdrRenderKey = renderKey;
        syncAuxiliarySeparators(
          el,
          panelLayout.separators,
          panelTitles,
          representativeControls,
        );
      } catch (error) {
        if (lastAdrRenderKey === renderKey) lastAdrRenderKey = "";
        throw error;
      }
    
      if (!adrHandlerSet) {
        el.on("plotly_relayout", (eventData) => {
          const viewport = relayoutViewport(eventData);
          if (syncState.chartSyncing) return;
          if (syncState.cursorSyncing && !viewport.range && !viewport.autorange) return;
          const syncedCharts = [
            document.getElementById("chart"),
            document.getElementById("chart-macd"),
          ].filter((target) => target?.data && !target.hidden);
          if (syncedCharts.length) {
            if (viewport.range) {
              chartSession.pinnedXRange = viewport.range;
              syncedCharts.forEach((target) => scheduleViewportRangeSync(target, {
                "xaxis.range[0]": viewport.range[0],
                "xaxis.range[1]": viewport.range[1],
              }));
            } else if (viewport.autorange) {
              chartSession.pinnedXRange = null;
              const adrRange = el._fullLayout?.xaxis?.range?.slice();
              if (Array.isArray(adrRange) && adrRange.length === 2) {
                syncedCharts.forEach((target) => scheduleViewportRangeSync(target, {
                  "xaxis.range[0]": adrRange[0],
                  "xaxis.range[1]": adrRange[1],
                }));
              } else {
                syncedCharts.forEach((target) => scheduleViewportRangeSync(target, { "xaxis.autorange": true }));
              }
            }
          }
        });
        bindAuxiliaryHoverHandlers(el, ["chart", "chart-macd"]);
        adrHandlerSet = true;
      }
      recordPerfSample("renderAdrChart", perfStartedAt, {
        rows: adrRowCount,
        newsRows: newsRowCount,
        vkospiRows: vkospiRowCount,
        cacheHit: false,
        modelSource: getAuxiliaryChartModelSource(),
        renderMode: renderResult.mode,
        updateScope: renderResult.updateScope || "",
      });
    }

    function renderAdrChart(xRange) {
      pendingAdrRenderRequest = {
        xRange: Array.isArray(xRange) && xRange.length === 2 ? xRange.slice(0, 2) : null,
      };
      if (adrRenderPromise) return adrRenderPromise;
      adrRenderPromise = (async () => {
        while (pendingAdrRenderRequest) {
          const request = pendingAdrRenderRequest;
          pendingAdrRenderRequest = null;
          try {
            await renderAdrChartNow(request.xRange);
          } catch (error) {
            if (!pendingAdrRenderRequest) throw error;
          }
        }
      })().finally(() => {
        adrRenderPromise = null;
      });
      return adrRenderPromise;
    }

    function invalidateAdr() {
      lastAdrRenderKey = "";
      auxiliaryChartRenderGeneration += 1;
      auxiliaryModelResolver?.invalidate();
    }

    function invalidateMacd() {
      lastMacdRenderKey = "";
    }

    async function renderAll(xRange) {
      const range = Array.isArray(xRange) && xRange.length === 2
        ? xRange.slice(0, 2)
        : null;
      return Promise.allSettled([
        renderMacdChart(range ? [...range] : null),
        renderAdrChart(range ? [...range] : null),
      ]);
    }

    return Object.freeze({
      invalidateAdr,
      invalidateMacd,
      addViewportYRangeToRelayout,
      cachedModel: () => auxiliaryModelResolver?.cachedModel?.() || null,
      renderAll,
      renderAdrChart,
      renderMacdChart,
      stats: () => ({
        adrRenderKey: lastAdrRenderKey,
        macdRenderKey: lastMacdRenderKey,
        macdTraces: lastMacdTraceCount,
        partialRenders: auxiliaryPartialRenderCount,
        fullRenders: auxiliaryFullRenderCount,
        skippedRenders: auxiliarySkippedRenderCount,
        model: auxiliaryModelResolver?.stats?.() || null,
        modelSource: getAuxiliaryChartModelSource(),
      }),
    });
  }

  export const auxiliaryChartRuntime = Object.freeze({
    auxiliaryLayoutFingerprint,
    auxiliaryLayoutTopology,
    auxiliaryRestylePayload,
    auxiliaryTraceFingerprint,
    auxiliaryTraceStructureKey,
    canApplyAuxiliaryUpdate,
    createAuxiliaryChartModelResolver,
    createAuxiliaryChartRuntime,
    renderAuxiliaryPlot,
    stampAuxiliaryTraceRevisions,
  });
