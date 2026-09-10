import { chartLoader } from "./chart-loader.mjs";
import { assertChartRenderPayload } from "./chart-render-contract.mjs";
import {
  AUXILIARY_LAYOUT_METRICS,
  TECHNICAL_SERIES_DEFINITIONS,
  TECHNICAL_SERIES_KEYS,
} from "./auxiliary-chart-contract.mjs";
import {
  createAuxiliaryPanelControlView,
  syncControl,
} from "./control-state-view.mjs";
import { orderItemsByActivation } from "./chart-session-controller.mjs";
import { resolveRelayoutViewport } from "./chart-viewport-controller.mjs";

const defaultScope = typeof self !== "undefined" ? self : globalThis;

  const AUXILIARY_STRUCTURE_PROPERTY = "__thinkStockAuxiliaryStructureV1";
  const AUXILIARY_RENDER_STATE_PROPERTY = "__thinkStockAuxiliaryRenderStateV1";
  if (!chartLoader?.layoutStyle || !chartLoader?.axisStyle || !chartLoader?.hoverLabel) {
    throw new Error("Chart visual contract failed to load");
  }
  const PLOTLY_CONFIG = chartLoader.PLOTLY_CONFIG;
  const CHART_HOVER_DATE_FORMAT = chartLoader.PLOTLY_THEME.hoverDateFormat;
  const ADR_KOSPI_COLOR = "#facc15";
  const ADR_KOSDAQ_COLOR = "#f472b6";
  const MACD_LINE_KEYS = TECHNICAL_SERIES_KEYS;

  function auxiliaryTraceStructureKey(trace) {
    const meta = trace?.meta || {};
    return [
      String(meta.macdSeriesKey || meta.auxiliarySeriesKey || trace?.name || ""),
      String(meta.macdLineKind || ""),
      String(meta.auxiliaryZoneGroup || ""),
      String(meta.auxiliaryZoneFill || ""),
      meta.auxiliaryIsolatedMarker === true ? "isolated-marker" : "",
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
    let workerDatasetKey = "";
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
          const datasetKey = String(payload?.datasetKey || "inline");
          const workerPayload = workerDatasetKey === datasetKey
            ? { ...payload, sources: undefined }
            : payload;
          model = normalizeModel(await requestModel(workerPayload));
          if (!model) throw new Error("auxiliary chart worker returned an invalid model");
          workerDatasetKey = datasetKey;
          counters.worker += 1;
        } catch (_) {
          source = "sync";
          workerDatasetKey = "";
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
        workerDatasetCached: Boolean(workerDatasetKey),
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

  async function settleAuxiliaryRenderTasks(tasks) {
    const results = await Promise.allSettled(Array.isArray(tasks) ? tasks : []);
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      const error = new Error(`${failures.length} auxiliary chart renders failed`);
      error.causes = failures;
      throw error;
    }
    return results.map((result) => result.value);
  }

function buildTechnicalSeriesTraces(options = {}) {
    const series = String(options.series || "");
    const name = String(options.name || series);
    const disparityDays = Math.max(1, Math.round(Number(options.disparityDays) || 60));
    const legendgroup = `macd:${series}`;
    const inputs = {
      oscillator: { dates: options.dates, values: options.values },
      disparity: { dates: options.disparityDates, values: options.disparityValues },
      obv: { dates: options.obvDates, values: options.obvValues },
    };
    return Object.freeze(TECHNICAL_SERIES_DEFINITIONS.map((definition) => {
      const input = inputs[definition.kind] || {};
      const trace = {
        x: Array.isArray(input.dates) ? input.dates : [],
        y: Array.isArray(input.values) ? input.values : [],
        type: "scatter",
        mode: "lines",
        name,
        legendgroup,
        showlegend: false,
        yaxis: definition.axis,
        line: { color: definition.color, width: 1 },
        opacity: 1,
        visible: options.active?.[definition.kind] !== false,
        hoverinfo: options.showHover ? undefined : "skip",
        meta: {
          macdSeriesKey: series,
          macdLineKind: definition.kind,
          macdSignal: definition.kind === "oscillator" ? options.signal : undefined,
          macdDisparityDays: definition.kind === "disparity" ? disparityDays : undefined,
        },
      };
      if (options.showHover) {
        if (definition.kind === "oscillator") {
          trace.hovertemplate = "오실레이터 %{y:.3f}%<extra>%{fullData.name}</extra>";
        } else if (definition.kind === "disparity") {
          trace.hovertemplate = `이격도(${disparityDays}) %{y:.2f}%<extra>%{fullData.name}</extra>`;
        } else {
          trace.hovertemplate = "OBV %{y:,.0f}<extra>%{fullData.name}</extra>";
        }
      }
      return trace;
    }));
}

function isolatedAuxiliaryMarkerSizes(values, markerSize = 5) {
  const source = (Array.isArray(values) ? values : []).map((value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  });
  const size = Math.max(1, Number(markerSize) || 5);
  return source.map((value, index) => {
    if (value === null) return 0;
    const connectedLeft = index > 0 && source[index - 1] !== null;
    const connectedRight = index + 1 < source.length && source[index + 1] !== null;
    return connectedLeft || connectedRight ? 0 : size;
  });
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
      commitViewportRange,
      auxiliaryDataRevisionSignature,
      dataRevisionSignature,
      dataState,
      getAuxiliaryChartModel: externalGetAuxiliaryChartModel,
      getAuxiliaryChartModelSource: externalGetAuxiliaryChartModelSource,
      getMacdModelForSeries,
      getPreferredTechnicalSeries,
      fitRangeForTraces,
      isTouchDevice,
      labelName,
      persistState,
      recordPerfSample,
      runPlotlyUpdate,
      seriesColor,
      startPerfSample,
      supportsTechnicalSeries = () => false,
      syncHoverToChart,
      syncState,
      thinMacdPoints,
    } = options;
    if (!scope.document
      || !dataState
      || !syncState
      || !chartDisplaySampler
      || typeof commitViewportRange !== "function"
      || typeof runPlotlyUpdate !== "function"
      || typeof buildThresholdFillPolygons !== "function"
      || typeof fitRangeForTraces !== "function") {
      throw new Error("auxiliary chart runtime dependencies are incomplete");
    }

    function renderManagedAuxiliaryPlot(label, element, traces, layout) {
      return runPlotlyUpdate(label, element, () => (
        renderAuxiliaryPlot(scope.Plotly, element, traces, layout, PLOTLY_CONFIG)
      ));
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
      : (renderKey, startDate, seriesKeys, datasetKey) => auxiliaryModelResolver.resolve(renderKey, {
        datasetKey,
        sources: { adrRows: dataState.adrRows, macroRows: dataState.macroRows },
        startDate,
        seriesKeys,
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

    function buildMacdViewportYRanges(element, xRange) {
      if (!element?.data || !Array.isArray(xRange)) return null;
      const ranges = {};
      TECHNICAL_SERIES_DEFINITIONS.forEach((definition) => {
        const fitted = fitRangeForTraces(
          element.data.filter((trace) => (
            trace?.meta?.macdLineKind === definition.kind
            && trace.visible !== false
            && trace.visible !== "legendonly"
          )),
          xRange,
          { paddingRatio: 0.08, minimumPadding: definition.minimumPadding },
        );
        if (!fitted) {
          ranges[definition.kind] = null;
          return;
        }
        if (!definition.symmetric) {
          ranges[definition.kind] = fitted;
          return;
        }
        const maxAbs = Math.max(0.02, Math.abs(fitted[0]), Math.abs(fitted[1]));
        ranges[definition.kind] = [-maxAbs, maxAbs];
      });
      return Object.values(ranges).some(Array.isArray) ? ranges : null;
    }

    function macdViewportRelayout(ranges) {
      if (!ranges) return null;
      const relayout = {};
      const addRange = (axisKey, range) => {
        if (!Array.isArray(range)) return;
        relayout[`${axisKey}.range[0]`] = range[0];
        relayout[`${axisKey}.range[1]`] = range[1];
        relayout[`${axisKey}.autorange`] = false;
      };
      TECHNICAL_SERIES_DEFINITIONS.forEach((definition) => {
        const axisKey = definition.axis === "y" ? "yaxis" : `yaxis${definition.axis.slice(1)}`;
        addRange(axisKey, ranges[definition.kind]);
      });
      return Object.keys(relayout).length ? relayout : null;
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
      if (!targetElement || !payload) return payload;
      const xRange = viewportRangeFromRelayout(payload);
      if (!xRange) return payload;
      if (targetElement.id === "chart-macd") {
        const yPayload = macdViewportRelayout(buildMacdViewportYRanges(targetElement, xRange));
        return yPayload ? { ...payload, ...yPayload } : payload;
      }
      if (!chartSession.autoChartReset) return payload;
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
    const auxiliarySeparatorFrames = new WeakMap();
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
    const boundAuxiliaryInteractions = new WeakSet();

    function bindAuxiliaryInteractions(element, source, targetIds) {
      if (!element?.on || boundAuxiliaryInteractions.has(element)) return false;
      element.on("plotly_relayout", (eventData) => {
        if (syncState.chartSyncing) return;
        const viewport = resolveRelayoutViewport(eventData, element);
        if (syncState.cursorSyncing && !viewport.range && !viewport.autorange) return;
        if (!viewport.range) return;
        commitViewportRange(viewport.range, {
          source,
          forceCompanionElementId: element.id,
          liveFit: chartSession.autoChartReset,
        });
      });
      bindAuxiliaryHoverHandlers(element, targetIds);
      boundAuxiliaryInteractions.add(element);
      return true;
    }
    let lastAdrRenderKey = "";
    let auxiliaryChartRenderGeneration = 0;
    let lastMacdTraceCount = 0;
    let lastMacdRenderKey = "";
    let lastMacdViewportWindows = [];
    let lastAdrViewportWindows = [];
    let auxiliaryPartialRenderCount = 0;
    let auxiliaryFullRenderCount = 0;
    let auxiliarySkippedRenderCount = 0;

    function recordAuxiliaryRenderResult(renderResult) {
      if (renderResult?.mode === "partial") auxiliaryPartialRenderCount += 1;
      else if (renderResult?.mode === "full") auxiliaryFullRenderCount += 1;
      else auxiliarySkippedRenderCount += 1;
      return renderResult;
    }

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
    const viewportTime = (value) => (
      typeof value === "number" && Number.isFinite(value)
        ? value
        : Date.parse(String(value || ""))
    );
    const viewportWindowNeedsRefresh = (window, xRange) => {
      if (!window || !Array.isArray(xRange) || xRange.length !== 2) return false;
      const startMs = viewportTime(xRange[0]);
      const endMs = viewportTime(xRange[1]);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs === endMs) return false;
      const low = Math.max(Math.min(startMs, endMs), Number(window.dataStartMs));
      const high = Math.min(Math.max(startMs, endMs), Number(window.dataEndMs));
      if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return false;
      return chartDisplaySampler.inspectViewportCoverage(window, [low, high], {
        edgeRatio: 0.35,
        toleranceMs: 24 * 60 * 60 * 1000,
      }).needsRefresh;
    };
    const viewportWindowsNeedRefresh = (windows, xRange) => (
      (Array.isArray(windows) ? windows : []).some((window) => (
        viewportWindowNeedsRefresh(window, xRange)
      ))
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
      text: panel.text || "",
    })));
    const panelControlView = createAuxiliaryPanelControlView(scope, {
      state: chartSession,
      panelKeys: AUXILIARY_PANEL_KEYS,
      seriesKeys: [
        ...Object.values(AUXILIARY_SERIES_KEYS),
        ...Object.values(MACD_LINE_KEYS),
      ],
      controlsSignature,
      persist: persistState,
      onChange: (change) => {
        const mainRange = document.getElementById("chart")?._fullLayout?.xaxis?.range?.slice() || null;
        const target = Object.values(MACD_LINE_KEYS).includes(change?.key)
          ? "macd"
          : "auxiliary";
        if (typeof options.requestRender === "function") {
          options.requestRender({ targets: [target], xRange: mainRange });
          return;
        }
        const render = target === "macd" ? renderMacdChart : renderAdrChart;
        Promise.resolve(render(mainRange)).catch((error) => {
          scope.console?.error?.("auxiliary chart visibility update failed", error);
        });
      },
    });
    const bindAuxiliaryToggle = panelControlView.bindToggle;
    const isAuxiliaryPanelVisible = panelControlView.isPanelVisible;
    const normalizeAuxiliaryPanelOrder = panelControlView.normalizeOrder;
    const normalizeAuxiliarySeriesOrder = panelControlView.seriesOrder;
    const syncAuxiliaryRepresentativeToggles = panelControlView.syncRepresentativeToggles;
    const toggleAuxiliaryPanel = panelControlView.togglePanel;
    const toggleAuxiliarySeries = panelControlView.toggleSeries;
    function createAuxiliarySeriesToggle(control = {}) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "auxiliary-series-toggle";
      button.dataset.auxiliarySeries = String(control.key || "");
      syncControl(button, { active: control.active, pressed: control.active });
      button.setAttribute("aria-label", `${control.text} 선 ${control.active ? "숨기기" : "표시"}`);
      button.disabled = control.available === false;
      button.style.setProperty("--auxiliary-series-color", control.color || "#ffffff");
      button.textContent = String(control.text || "");
      bindAuxiliaryToggle(button, () => toggleAuxiliarySeries(control.key));
      return button;
    }
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
      const buildFill = (direction, threshold, fillcolor) => {
        const polygons = buildThresholdFillPolygons(dates, sourceValues, threshold, direction);
        if (!polygons.length) return [];
        const x = [];
        const y = [];
        polygons.forEach((polygon, index) => {
          if (index) {
            x.push(null);
            y.push(null);
          }
          x.push(...polygon.dates);
          y.push(...polygon.values);
        });
        return [{
          ...base,
          x,
          y,
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
        }];
      };
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
      const markerSizes = isolatedAuxiliaryMarkerSizes(sourceValues);
      const isolatedDates = [];
      const isolatedValues = [];
      markerSizes.forEach((size, index) => {
        if (!(size > 0) || !dates?.[index]) return;
        isolatedDates.push(dates[index]);
        isolatedValues.push(sourceValues[index]);
      });
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
        ...(isolatedDates.length ? [{
          x: isolatedDates,
          y: isolatedValues,
          type: "scatter",
          mode: "markers",
          connectgaps: false,
          meta: { auxiliarySeriesKey: seriesKey, auxiliaryIsolatedMarker: true },
          visible: chartSession.hiddenAuxiliarySeries.has(seriesKey) ? "legendonly" : true,
          name: `${legendName} 최신점`,
          showlegend: false,
          marker: { color: mainColor, size: 5, symbol: "circle" },
          hoverinfo: "skip",
          hovertemplate: undefined,
        }] : []),
      ];
    }

    function renderAuxiliarySeparators(el, rebuildHeadings) {
      const layer = el?.querySelector(":scope > .auxiliary-separator-layer");
      if (!el || !layer) return;
      const representativeRow = el.querySelector(":scope > .auxiliary-representative-toggles");
      const plotSize = el._fullLayout?._size;
      const top = Number(plotSize?.t) || 14;
      const bottom = Number(plotSize?.b) || AUXILIARY_LAYOUT_METRICS.bottomMargin;
      const plotHeight = Number(plotSize?.h) || Math.max(
        1,
        AUXILIARY_LAYOUT_METRICS.controlsOnlyHeight - top - bottom,
      );
      const chartHeight = top + plotHeight + bottom;
      const representativeBottom = representativeRow
        ? AUXILIARY_LAYOUT_METRICS.controlsOnlyHeight - 2
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
        const lineTop = Math.max(0, Math.min(chartHeight - 1, separator.top));
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
              heading.style.top = `${lineTop + 3}px`;
            }
            return;
          }
          const heading = document.createElement("div");
          heading.className = "auxiliary-panel-heading";
          heading.dataset.panelKey = visiblePanelTitles[index].key;
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
          (visiblePanelTitles[index].controls || []).forEach((control) => {
            heading.append(createAuxiliarySeriesToggle(control));
          });
          headingFragment.append(heading);
        }
      });
      layer.replaceChildren(separatorFragment);
      if (headingFragment) el.append(headingFragment);
    }

    function scheduleAuxiliarySeparatorLayout(el, rebuildHeadings = false) {
      const pending = auxiliarySeparatorFrames.get(el);
      if (pending) {
        pending.rebuildHeadings ||= rebuildHeadings;
        return;
      }
      const frame = { rebuildHeadings, requestId: 0 };
      auxiliarySeparatorFrames.set(el, frame);
      const apply = () => {
        if (auxiliarySeparatorFrames.get(el) !== frame) return;
        auxiliarySeparatorFrames.delete(el);
        renderAuxiliarySeparators(el, frame.rebuildHeadings);
      };
      if (typeof scope.requestAnimationFrame === "function") {
        frame.requestId = scope.requestAnimationFrame(apply);
      } else {
        apply();
      }
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
      if (Array.isArray(panelTitles) && rebuildHeadings) {
        el.auxiliaryPanelTitles = panelTitles.map((panel) => ({ ...panel }));
        el.auxiliaryPanelTitlesSignature = nextPanelTitlesSignature;
      }
      let layer = el.querySelector(":scope > .auxiliary-separator-layer");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "auxiliary-separator-layer";
        el.append(layer);
      }
      syncAuxiliaryRepresentativeToggles(el, representativeControls);
      scheduleAuxiliarySeparatorLayout(el, rebuildHeadings);
      if (!el.auxiliarySeparatorResizeObserver && typeof scope.ResizeObserver === "function") {
        el.auxiliarySeparatorResizeObserver = new scope.ResizeObserver(() => {
          syncAuxiliarySeparators(el);
        });
        el.auxiliarySeparatorResizeObserver.observe(el);
      }
    }

    function syncMacdHeading(el, options = {}) {
      if (!el) return;
      let heading = el.querySelector(":scope > .auxiliary-macd-heading");
      if (!heading) {
        heading = document.createElement("div");
        heading.className = "auxiliary-panel-heading auxiliary-macd-heading";
        el.append(heading);
      }
      const plotSize = el._fullLayout?._size;
      heading.style.top = `${Math.max(0, (Number(plotSize?.t) || 34) - 27)}px`;
      const controls = document.createElement("div");
      controls.className = "auxiliary-macd-controls";
      const title = document.createElement("button");
      title.type = "button";
      title.className = "auxiliary-chart-label auxiliary-macd-target";
      title.textContent = String(options.targetName || options.target || "");
      title.style.setProperty("--auxiliary-series-color", options.targetColor || "#ffffff");
      title.setAttribute("aria-label", `${title.textContent} · 다음 보이는 차트로 전환`);
      title.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onCycleTarget?.(options.target);
      });
      controls.append(
        title,
        ...(options.seriesControls || []).map(createAuxiliarySeriesToggle),
      );
      heading.dataset.macdTarget = String(options.target || "");
      heading.replaceChildren(controls);
    }

    async function renderMacdChart(xRange) {
      const perfStartedAt = startPerfSample();
      const el = document.getElementById("chart-macd");
      if (!el) return;
      const renderedSeries = (chartSession.currentMainChartModel?.seriesModels || [])
        .map((model) => String(model?.series || "").toUpperCase())
        .filter((series) => series && !chartSession.hiddenSeries.has(series));
      const orderedVisibleSeries = orderItemsByActivation(
        renderedSeries.filter((series) => supportsTechnicalSeries(series)),
        chartSession.mainHoverSeriesOrder,
      );
      const requestedTarget = String(getPreferredTechnicalSeries?.() || "").toUpperCase();
      const targetSeries = orderedVisibleSeries.includes(requestedTarget)
        ? requestedTarget
        : orderedVisibleSeries.at(-1) || "";
      const visibleSeries = targetSeries ? [targetSeries] : [];
      if (!visibleSeries.length) {
        el.hidden = true;
        lastMacdTraceCount = 0;
        lastMacdViewportWindows = [];
        return;
      }
    
      el.hidden = false;
      const dataStart = chartSession.currentDataStart || String(dataState.pricePayload?.records?.[0]?.date || "").slice(0, 10);
      const dataEnd = chartSession.currentDataEnd || String(dataState.pricePayload?.records?.at(-1)?.date || "").slice(0, 10);
      const disparityDays = Number(chartSession.macdDisparityDays) || 60;
      const targetModel = getMacdModelForSeries(targetSeries);
      const modelValues = {
        oscillator: targetModel?.normalized,
        disparity: targetModel?.disparity,
        obv: targetModel?.obv,
      };
      const activeByKind = Object.fromEntries(TECHNICAL_SERIES_DEFINITIONS.map((definition) => [
        definition.kind,
        !chartSession.hiddenAuxiliarySeries.has(definition.key),
      ]));
      const availableByKind = Object.fromEntries(TECHNICAL_SERIES_DEFINITIONS.map((definition) => [
        definition.kind,
        Boolean(modelValues[definition.kind]?.some(Number.isFinite)),
      ]));
      const targetColor = seriesColor(targetSeries);
      const headingOptions = {
        target: targetSeries,
        targetName: labelName(targetSeries),
        targetColor,
        onCycleTarget: options.cycleTechnicalSeriesTarget,
        seriesControls: TECHNICAL_SERIES_DEFINITIONS.map((definition) => ({
          active: activeByKind[definition.kind],
          available: availableByKind[definition.kind],
          color: definition.color,
          key: definition.key,
          text: definition.label,
        })),
      };
      const renderKey = [
        dataStart,
        dataEnd,
        viewportRenderKey(xRange),
        chartSession.hoverShowPopup ? 1 : 0,
        chartSession.cursorLineMode,
        dataRevisionSignature("price"),
        visibleSeries.join(","),
        disparityDays,
        ...TECHNICAL_SERIES_DEFINITIONS.map((definition) => (
          activeByKind[definition.kind] ? 1 : 0
        )),
      ].join("::");
      if (lastMacdRenderKey === renderKey && el.data?.length) {
        syncMacdHeading(el, headingOptions);
        return;
      }
    
      const totalPointBudget = isTouchDevice() ? 10000 : 18000;
      const pointBudget = Math.max(
        1800,
        Math.min(9000, Math.floor(totalPointBudget / Math.max(1, visibleSeries.length))),
      );
      const lineTraces = [];
      const oscillatorValues = [];
      const disparityValues = [];
      const obvValues = [];
      const viewportWindows = [];
      visibleSeries.forEach((series) => {
        const model = series === targetSeries ? targetModel : getMacdModelForSeries(series);
        if (!model) return;
        const viewportSeries = sliceViewport(
          model.dates,
          [model.normalized, model.disparity, model.obv],
          xRange,
        );
        if (viewportSeries.window) viewportWindows.push(viewportSeries.window);
        const viewportDates = viewportSeries.dates;
        const viewportMacdValues = viewportSeries.arrays[0] || [];
        const viewportDisparityValues = viewportSeries.arrays[1] || [];
        const viewportObvValues = viewportSeries.arrays[2] || [];
        const displayMacdDates = [];
        const displayMacdValues = [];
        const displayDisparityDates = [];
        const displayDisparityValues = [];
        const displayObvDates = [];
        const displayObvValues = [];
        viewportDates.forEach((date, index) => {
          if ((dataStart && date < dataStart) || (dataEnd && date > dataEnd)) return;
          const macdValue = viewportMacdValues[index];
          if (Number.isFinite(macdValue)) {
            displayMacdDates.push(date);
            displayMacdValues.push(macdValue);
          }
          const disparityValue = viewportDisparityValues[index];
          if (Number.isFinite(disparityValue)) {
            displayDisparityDates.push(date);
            displayDisparityValues.push(disparityValue);
          }
          const obvValue = viewportObvValues[index];
          if (Number.isFinite(obvValue)) {
            displayObvDates.push(date);
            displayObvValues.push(obvValue);
          }
        });
        if (!displayMacdValues.length && !displayDisparityValues.length && !displayObvValues.length) return;
        const thinnedMacd = thinMacdPoints(displayMacdDates, displayMacdValues, pointBudget);
        const thinnedDisparity = thinMacdPoints(
          displayDisparityDates,
          displayDisparityValues,
          pointBudget,
        );
        const thinnedObv = thinMacdPoints(displayObvDates, displayObvValues, pointBudget);
        if (activeByKind.oscillator) oscillatorValues.push(...thinnedMacd.values.filter(Number.isFinite));
        if (activeByKind.disparity) {
          disparityValues.push(...thinnedDisparity.values.filter(Number.isFinite));
        }
        if (activeByKind.obv) obvValues.push(...thinnedObv.values.filter(Number.isFinite));
        const technicalTraces = buildTechnicalSeriesTraces({
          series,
          name: labelName(series),
          dates: thinnedMacd.dates,
          values: thinnedMacd.values,
          disparityDates: thinnedDisparity.dates,
          disparityValues: thinnedDisparity.values,
          disparityDays,
          obvDates: thinnedObv.dates,
          obvValues: thinnedObv.values,
          active: activeByKind,
          signal: model.signal,
          showHover: chartSession.hoverShowPopup,
        });
        lineTraces.push(...technicalTraces);
      });

      const traces = lineTraces;
      lastMacdTraceCount = lineTraces.length;
      const symmetricRange = (values) => {
        const maxAbs = values.length
          ? Math.max(0.02, ...values.map((value) => Math.abs(value)))
          : 1;
        return [-maxAbs * 1.08, maxAbs * 1.08];
      };
      const naturalRange = (values) => {
        if (!values.length) return [-1, 1];
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const padding = Math.max(1, (maximum - minimum) * 0.08, Math.abs(maximum) * 0.01);
        return [minimum - padding, maximum + padding];
      };
      const viewportYRanges = buildMacdViewportYRanges({ data: lineTraces }, xRange);
      const primaryRange = viewportYRanges?.oscillator || symmetricRange(oscillatorValues);
      const secondaryRange = viewportYRanges?.disparity || symmetricRange(disparityValues);
      const obvRange = viewportYRanges?.obv || naturalRange(obvValues);
      const hasVisibleTraceData = traces.some((trace) => (
        trace.visible !== false && trace.y?.some(Number.isFinite)
      ));
      const layout = {
        ...chartLoader.layoutStyle(),
        margin: {
          l: auxiliaryChartHorizontalMargin(),
          r: auxiliaryChartHorizontalMargin(),
          t: 34,
          b: AUXILIARY_LAYOUT_METRICS.bottomMargin,
        },
        hovermode: buildCursorHoverMode(
          chartSession.hoverShowPopup,
          chartSession.cursorLineMode,
        ),
        showlegend: false,
        barmode: "overlay",
        bargap: 0,
        shapes: [{
          type: "line", xref: "paper", yref: "paper",
          x0: 0, x1: 1, y0: 0.5, y1: 0.5,
          line: referenceLineStyle("rgba(255,255,255,0.42)"),
        }],
        annotations: hasVisibleTraceData ? [] : [{
          xref: "paper", yref: "paper", x: 0.5, y: 0.5,
          text: Object.values(activeByKind).some(Boolean)
            ? "표시 중인 종목의 보조차트 이력이 부족합니다."
            : "MACD와 이격도, OBV가 꺼져 있습니다.",
          showarrow: false,
          font: { color: "rgba(255,255,255,0.55)", size: 11 },
        }],
        xaxis: {
          ...chartLoader.axisStyle({ tickFontSize: 9 }),
          showticklabels: false,
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
          range: primaryRange,
        },
        yaxis2: {
          ...chartLoader.axisStyle({ showGrid: false, axisColor: "rgba(0,0,0,0)" }),
          overlaying: "y",
          side: "right",
          visible: false,
          fixedrange: true,
          range: secondaryRange,
        },
        yaxis3: {
          ...chartLoader.axisStyle({ showGrid: false, axisColor: "rgba(0,0,0,0)" }),
          overlaying: "y",
          side: "right",
          visible: false,
          fixedrange: true,
          range: obvRange,
        },
        hoverlabel: plotlyHoverLabel(11),
        dragmode: false,
      };
    
      stampAuxiliaryTraceRevisions(traces, renderKey);
      const renderResult = await renderManagedAuxiliaryPlot(
        "auxiliary-macd-render",
        el,
        traces,
        layout,
      );
      recordAuxiliaryRenderResult(renderResult);
      const committedTarget = String(getPreferredTechnicalSeries?.() || "").toUpperCase();
      if (committedTarget !== targetSeries) {
        lastMacdRenderKey = "";
        requestRender?.({ targets: ["macd"], xRange: Array.isArray(xRange) ? [...xRange] : null });
        return;
      }
      syncMacdHeading(el, headingOptions);
      lastMacdRenderKey = renderKey;
      lastMacdViewportWindows = viewportWindows;
      bindAuxiliaryInteractions(
        el,
        "macd-plotly-relayout",
        ["chart", "chart-adr"],
      );
      recordPerfSample("renderMacdChart", perfStartedAt, {
        traces: lineTraces.length,
        points: lineTraces.reduce((sum, trace) => sum + (trace.x?.length || 0), 0),
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
      const panelOrder = normalizeAuxiliaryPanelOrder();
      const seriesOrder = normalizeAuxiliarySeriesOrder();
      const activeModelSeriesKeys = [
        ...(!chartSession.hiddenAuxiliaryPanels.has("adr")
          ? [AUXILIARY_SERIES_KEYS.adrKospi, AUXILIARY_SERIES_KEYS.adrKosdaq] : []),
        ...(!chartSession.hiddenAuxiliaryPanels.has("fearGreed")
          ? [AUXILIARY_SERIES_KEYS.fearGreed] : []),
        ...(!chartSession.hiddenAuxiliaryPanels.has("newsSentiment")
          ? [AUXILIARY_SERIES_KEYS.newsSentiment] : []),
        ...(!chartSession.hiddenAuxiliaryPanels.has("vkospi")
          ? [AUXILIARY_SERIES_KEYS.vkospi, AUXILIARY_SERIES_KEYS.vix] : []),
      ];
      const sourceRevision = typeof auxiliaryDataRevisionSignature === "function"
        ? auxiliaryDataRevisionSignature(...activeModelSeriesKeys)
        : dataRevisionSignature("adr", "macro");
      const sourceDatasetKey = dataRevisionSignature("adr", "macro");
      const modelKey = [
        startDate,
        sourceRevision,
        activeModelSeriesKeys.join(","),
        chartSession.newsSentimentMovingAverageDays,
      ].join("::");
      const renderKey = [
        modelKey,
        endDate,
        viewportRenderKey(AUXILIARY_PANEL_KEYS.some((key) => isAuxiliaryPanelVisible(key)) ? xRange : null),
        chartSession.hoverShowPopup ? 1 : 0,
        chartSession.cursorLineMode,
        [...chartSession.hiddenAuxiliarySeries].sort().join(","),
        [...chartSession.hiddenAuxiliaryPanels].sort().join(","),
        panelOrder.join(","),
        seriesOrder.join(","),
      ].join("::");
      if (lastAdrRenderKey === renderKey
        && (el.data?.length || el.dataset.auxiliaryEmpty === "true")) {
        recordPerfSample("renderAdrChart", perfStartedAt, { rows: el.data[0]?.x?.length || 0, cacheHit: true });
        return;
      }

      const renderGeneration = ++auxiliaryChartRenderGeneration;
      const model = await getAuxiliaryChartModel(
        modelKey,
        startDate,
        activeModelSeriesKeys,
        sourceDatasetKey,
      );
      if (!model
        || renderGeneration !== auxiliaryChartRenderGeneration) return;
      const adrKospiAvailable = model.availability?.adrKospi === true || hasFiniteValues(model.adrKospiValues);
      const adrKosdaqAvailable = model.availability?.adrKosdaq === true || hasFiniteValues(model.adrKosdaqValues);
      const fearGreedAvailable = model.availability?.fearGreed === true || hasFiniteValues(model.fearGreedValues);
      const newsSentimentAvailable = model.availability?.newsSentiment === true || hasFiniteValues(model.newsValues);
      const vkospiAvailable = model.availability?.vkospi === true || hasFiniteValues(model.vkospiValues);
      const vixAvailable = model.availability?.vix === true || hasFiniteValues(model.vixValues);
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
      const viewportWindows = [
        commonSlice.window,
        adrKospiSlice.window,
        adrKosdaqSlice.window,
        fearGreedSlice.window,
        newsSlice.window,
        vkospiSlice.window,
        vixSlice.window,
      ].filter(Boolean);
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
      const chartMargin = {
        l: horizontalMargin,
        r: horizontalMargin,
        t: AUXILIARY_LAYOUT_METRICS.topMargin,
        b: AUXILIARY_LAYOUT_METRICS.bottomMargin,
      };
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
        controls: key === "adr" ? [
          {
            key: AUXILIARY_SERIES_KEYS.adrKospi,
            text: "KOSPI",
            active: adrKospiVisible,
            available: adrKospiAvailable,
            color: ADR_KOSPI_COLOR,
          },
          {
            key: AUXILIARY_SERIES_KEYS.adrKosdaq,
            text: "KOSDAQ",
            active: adrKosdaqVisible,
            available: adrKosdaqAvailable,
            color: ADR_KOSDAQ_COLOR,
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
        boundAuxiliaryInteractions.delete(el);
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
          meta: { auxiliaryHoverProxy: true },
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
    
      const unorderedTraces = [
        ...adrZoneFillTraces,
        ...buildAdrZoneTraces(
          adrKospiDates,
          adrKospiValues,
          ADR_KOSPI_COLOR,
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
          ADR_KOSDAQ_COLOR,
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
      const backgroundTraces = unorderedTraces.filter((trace) => trace.meta?.auxiliaryZoneFill);
      const hoverTraces = unorderedTraces.filter((trace) => trace.meta?.auxiliaryHoverProxy === true);
      const foregroundTraces = unorderedTraces.filter((trace) => (
        !trace.meta?.auxiliaryZoneFill && trace.meta?.auxiliaryHoverProxy !== true
      ));
      const traces = [
        ...backgroundTraces,
        ...orderItemsByActivation(
          foregroundTraces,
          seriesOrder,
          (trace) => trace?.meta?.auxiliarySeriesKey,
        ),
        ...hoverTraces,
      ];

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
          showticklabels: false,
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
      let renderResult;
      try {
        renderResult = await renderManagedAuxiliaryPlot(
          "auxiliary-panels-render",
          el,
          traces,
          layout,
        );
        recordAuxiliaryRenderResult(renderResult);
        lastAdrRenderKey = renderKey;
        lastAdrViewportWindows = viewportWindows;
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
    
      bindAuxiliaryInteractions(
        el,
        "auxiliary-plotly-relayout",
        ["chart", "chart-macd"],
      );
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
      const range = Array.isArray(xRange) && xRange.length === 2
        ? xRange.slice(0, 2)
        : null;
      return renderAdrChartNow(range);
    }

    function invalidateAdr() {
      lastAdrRenderKey = "";
      lastAdrViewportWindows = [];
      auxiliaryChartRenderGeneration += 1;
      auxiliaryModelResolver?.invalidate();
    }

    function invalidateMacd() {
      lastMacdRenderKey = "";
      lastMacdViewportWindows = [];
    }

    function viewportRefreshTargets(xRange) {
      const targets = [];
      if (viewportWindowsNeedRefresh(lastMacdViewportWindows, xRange)) targets.push("macd");
      if (viewportWindowsNeedRefresh(lastAdrViewportWindows, xRange)) targets.push("auxiliary");
      return targets;
    }

    async function renderAll(xRange, options = {}) {
      const range = Array.isArray(xRange) && xRange.length === 2
        ? xRange.slice(0, 2)
        : null;
      const requestedTargets = new Set(
        Array.isArray(options.targets) && options.targets.length
          ? options.targets.map(String)
          : ["macd", "auxiliary"],
      );
      const tasks = [];
      if (requestedTargets.has("macd")) {
        tasks.push(renderMacdChart(range ? [...range] : null));
      }
      if (requestedTargets.has("auxiliary")) {
        tasks.push(renderAdrChart(range ? [...range] : null));
      }
      return settleAuxiliaryRenderTasks(tasks);
    }

    return Object.freeze({
      invalidateAdr,
      invalidateMacd,
      addViewportYRangeToRelayout,
      cachedModel: () => auxiliaryModelResolver?.cachedModel?.() || null,
      viewportRefreshTargets,
      renderAll,
      renderAdrChart,
      renderMacdChart,
      stats: () => ({
        adrRenderKey: lastAdrRenderKey,
        adrRenderGeneration: auxiliaryChartRenderGeneration,
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
    buildTechnicalSeriesTraces,
    canApplyAuxiliaryUpdate,
    createAuxiliaryChartModelResolver,
    createAuxiliaryChartRuntime,
    renderAuxiliaryPlot,
    isolatedAuxiliaryMarkerSizes,
    settleAuxiliaryRenderTasks,
    stampAuxiliaryTraceRevisions,
  });
