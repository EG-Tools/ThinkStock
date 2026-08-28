import {
  EVENT_MARKER_FONT_FAMILY,
  buildEventMarkerTextFont,
} from "./chart-render-contract.mjs";

const defaultScope = typeof self !== "undefined" ? self : globalThis;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const EVENT_MARKER_DESCRIPTORS = Object.freeze([
    Object.freeze({ id: "crisis", kind: "crisis", layer: "timing", identity: "crisis-signal" }),
    Object.freeze({ id: "timing-buy", kind: "timing-buy", layer: "timing", identity: "market-timing-buy" }),
    Object.freeze({ id: "timing-sell", kind: "timing-sell", layer: "timing", identity: "market-timing-sell" }),
    Object.freeze({ id: "insider", kind: "insider", layer: "insider", key: "insiderTradeSide" }),
    Object.freeze({ id: "disclosure", kind: "disclosure", layer: "disclosure" }),
  ]);
  const CHART_MARKER_DEFAULTS = Object.freeze({
    colors: Object.freeze({
      crisis: "#60a5fa",
      disclosure: "#fde047",
      timingBuy: "#f9a8d4",
      timingSell: "#7dd3fc",
    }),
    constants: Object.freeze({
      disclosureIconText: "◆",
      disclosureTextSize: 13,
      disclosureTraceName: "공시",
      eventMarkerDownText: "▼",
      eventMarkerTextSize: 15,
      eventMarkerUpText: "▲",
      eventMarkerGapRatio: 0.02,
      insiderLineGapRatio: 2,
      insiderTimingCollisionDistanceRatio: 0.9,
      insiderTimingCollisionOffsetRatio: 2.2,
      pairedInsiderBuyOffsetRatio: 0.3,
      pairedInsiderSellOffsetRatio: 0.95,
      timingGapMultiplier: 1.1,
    }),
    highlightSizeDelta: 3,
  });

  function eventMarkerKind(trace) {
    if (trace?.meta?.isCrisisSignalTrace) return "crisis";
    if (trace?.meta?.isMarketTimingBuyTrace) return "timing-buy";
    if (trace?.meta?.isMarketTimingSellTrace) return "timing-sell";
    if (trace?.meta?.isInsiderTradeTrace) return "insider";
    if (trace?.meta?.isDisclosureTrace) return "disclosure";
    return "";
  }

  function eventMarkerDescriptor(traceOrKind) {
    const kind = typeof traceOrKind === "string" ? traceOrKind : eventMarkerKind(traceOrKind);
    return EVENT_MARKER_DESCRIPTORS.find((descriptor) => descriptor.kind === kind) || null;
  }

  function eventMarkerLayer(traceOrKind) {
    return eventMarkerDescriptor(traceOrKind)?.layer || "";
  }

  function eventMarkerIdentity(trace) {
    const kind = eventMarkerKind(trace);
    if (!kind) return "";
    if (kind === "insider") {
      return `insider:${String(trace?.meta?.insiderTradeSide || "")}`;
    }
    return eventMarkerDescriptor(kind)?.identity || kind;
  }

  function isEventMarkerTrace(trace) {
    return Boolean(eventMarkerKind(trace));
  }

  function isTimingSignalTrace(trace) {
    return eventMarkerLayer(trace) === "timing";
  }

  function isDirectlyInteractiveEventMarkerTrace(trace) {
    return isEventMarkerTrace(trace);
  }

  function createEventMarkerSpecs(bindings = {}) {
    return EVENT_MARKER_DESCRIPTORS.map((descriptor) => {
      const binding = bindings[descriptor.id] || {};
      return {
        id: descriptor.id,
        layer: descriptor.layer,
        enabled: Boolean(binding.enabled),
        matches: (trace) => eventMarkerKind(trace) === descriptor.kind,
        ...(descriptor.key
          ? { keyOf: (trace) => trace?.meta?.[descriptor.key] }
          : {}),
        build: binding.build,
      };
    });
  }

  function materializeEventMarkerTraces(specs = []) {
    return (Array.isArray(specs) ? specs : []).flatMap((spec) => {
      if (!spec?.enabled) return [];
      const value = typeof spec.build === "function" ? spec.build() : spec.traces;
      return Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
    });
  }

  function collectCrisisSignalEntries(rows) {
    const stageRank = { stable: 0, caution: 1, warning: 2, crisis: 3 };
    let previousRank = 0;
    const events = [];
    (rows || []).forEach((row) => {
      const score = Number(row?.score);
      const rank = stageRank[row?.stage]
        ?? (score >= 75 ? 3 : score >= 50 ? 2 : score >= 25 ? 1 : 0);
      if (rank >= 2 && rank > previousRank) events.push(row);
      previousRank = rank;
    });
    return events;
  }

  function createEventMarkerRenderState() {
    return Object.seal({
      highlight: null,
      disclosureStats: { total: 0, candidates: 0, markers: 0 },
      insiderStats: { total: 0, candidates: 0, markers: 0 },
      partialUpdateCount: 0,
      highlightDomUpdateCount: 0,
    });
  }

  function findPointOnOrAfterDate(eventDate, ticker, pointIndex, maxDays = 14) {
    const points = pointIndex?.[ticker];
    if (!points?.length) return null;
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (points[middle].date < eventDate) low = middle + 1;
      else high = middle;
    }
    const point = points[low];
    if (!point) return null;
    const eventMs = Date.parse(`${eventDate}T00:00:00Z`);
    const pointMs = Date.parse(`${point.date}T00:00:00Z`);
    return Number.isFinite(eventMs)
      && Number.isFinite(pointMs)
      && pointMs - eventMs <= maxDays * DAY_MS
      ? { date: point.date, y: point.y }
      : null;
  }

  function compactTimingReasons(reasonGroups, fallback = "복합 조건 충족", limit = 2, separator = " · ") {
    const reasons = [];
    (Array.isArray(reasonGroups) ? reasonGroups : []).forEach((group) => {
      (Array.isArray(group) ? group : []).forEach((rawReason) => {
        const reason = String(rawReason || "").trim();
        if (!reason || reasons.includes(reason)) return;
        reasons.push(reason.length > 14 ? `${reason.slice(0, 13)}…` : reason);
      });
    });
    return reasons.slice(0, Math.max(1, limit)).join(separator) || fallback;
  }

  function timingRegimeLabel(value) {
    return ({
      expansion: "상승",
      slowdown: "둔화",
      stress: "위험",
      recovery: "회복",
      range: "횡보",
    })[String(value || "")] || "혼조";
  }

  function timingFamilyLabel(value) {
    return ({
      "shock-reversal": "급락 과매도 경고",
      "capitulation-reversal": "투매 반전",
      "range-floor-reversal": "박스권 하단",
      "trend-pullback": "추세 눌림",
      "relative-washout": "상대 과매도",
      "correction-reversal": "조정 반전",
      "blowoff-exhaustion": "급등 소진",
      "blowoff-continuation": "과열 연장",
      "range-ceiling-rollover": "박스권 상단",
      "trend-exhaustion": "추세 소진",
      "distribution-rollover": "분배 전환",
      "crowding-rollover": "쏠림 전환",
      "overheat-rollover": "과열 전환",
    })[String(value || "")] || "복합 판정";
  }

  function timingReasonEvents(value, fallback) {
    const reasons = String(value || fallback)
      .split(/<br\s*\/?\s*>\s*·?\s*|\s+·\s+/i)
      .map((reason) => reason.trim())
      .filter(Boolean);
    return reasons.map((reason, index) => ({
      title: index === 0 ? `근거: ${reason}` : `· ${reason}`,
    }));
  }

  function buildTimingSignalPopoverGroup(point) {
    const meta = point?.data?.meta || {};
    const values = Array.isArray(point?.customdata) ? point.customdata : [];
    const date = String(point?.x || "").slice(0, 10);
    if (meta.isMarketTimingBuyTrace) {
      const title = values[10] || "매수 신호";
      return {
        name: values[0] || point.data.name || "타이밍",
        plotDate: date,
        events: [
          { title: `${title} · ${values[5] || "보통"}` },
          ...timingReasonEvents(values[1], "과매도·반전"),
          { title: `ADR ${values[2] ?? "-"} · 공포 ${values[3] ?? "-"} · MACD ${values[4] ?? "-"}` },
          { title: `시장 ${timingRegimeLabel(values[6])} · 근거 ${values[7] ?? "-"}개` },
          { title: `${timingFamilyLabel(values[8])} · ${values[9] || "혼합형"}` },
        ],
      };
    }
    if (meta.isMarketTimingSellTrace) {
      const title = values[9] || "매도 신호";
      return {
        name: values[0] || point.data.name || "타이밍",
        plotDate: date,
        events: [
          { title: `${title} · ${values[4] || "보통"}` },
          ...timingReasonEvents(values[1], "과열·추세 둔화"),
          { title: `신용20일 ${values[2] ?? "-"}% · 고점대비 ${values[3] ?? "-"}%` },
          { title: `시장 ${timingRegimeLabel(values[5])} · 근거 ${values[6] ?? "-"}개` },
          { title: `${timingFamilyLabel(values[7])} · ${values[8] || "혼합형"}` },
        ],
      };
    }
    if (meta.isCrisisSignalTrace) {
      return {
        name: values[0] || point.data.name || "타이밍",
        plotDate: date,
        events: [
          { title: `침체 ${values[1] ?? "경고"} · 종합 ${values[2] ?? "-"}점` },
          { title: `금리 ${values[3] ?? "-"} · 고용 ${values[4] ?? "-"} · 신용 ${values[5] ?? "-"}` },
        ],
      };
    }
    return null;
  }

  function buildEventMarkerPopoverGroup(point) {
    const pointIndex = point?.pointIndex ?? point?.pointNumber;
    const embedded = point?.data?.meta?.eventGroups?.[pointIndex];
    if (embedded?.events?.length) return embedded;
    return isTimingSignalTrace(point?.data) ? buildTimingSignalPopoverGroup(point) : null;
  }

  function createChartMarkerRuntime(scope = defaultScope, options = {}) {
    const {
      colors: colorOverrides = {},
      constants: constantOverrides = {},
      chartEventLayer,
      chartSession,
      buildInsiderMarkerTraces,
      dataRevisionSignature,
      ensureMarketTimingFeature,
      escapeHtml,
      getAdrRows,
      getCreditRows,
      getCrisisRows,
      getDisclosureRows,
      getInsiderTradeRows,
      getMacroRows,
      getMarketTimingService,
      getPricePayload,
      getTickerVolumeSeriesByTicker,
      getUseViewportMarkerGap,
      getViewportYRange,
      isForecastSeries,
      labelName,
      netSameReporterInsiderTrades,
      recordPerfSample,
      recordRuntimeError,
      signalProgress,
      seriesColor,
      startPerfSample,
      toNum,
      toUtcMs,
    } = options;
    const colors = { ...CHART_MARKER_DEFAULTS.colors, ...colorOverrides };
    const constants = { ...CHART_MARKER_DEFAULTS.constants, ...constantOverrides };
    if (!chartEventLayer || !chartSession || typeof toUtcMs !== "function") {
      throw new Error("chart marker runtime dependencies are incomplete");
    }

    const eventMarkerGapRatio = Number(constants.eventMarkerGapRatio) || 0.02;
    const timingGapMultiplier = Number(constants.timingGapMultiplier) || 1.1;
    const insiderLineGapRatio = Number(constants.insiderLineGapRatio) || 2;
    const pairedInsiderBuyOffsetRatio = Number(constants.pairedInsiderBuyOffsetRatio) || 0.3;
    const pairedInsiderSellOffsetRatio = Number(constants.pairedInsiderSellOffsetRatio) || 0.95;
    const insiderTimingCollisionDistanceRatio = Number(constants.insiderTimingCollisionDistanceRatio) || 0.9;
    const insiderTimingCollisionOffsetRatio = Number(constants.insiderTimingCollisionOffsetRatio) || 2.2;
    const eventMarkerUpText = String(constants.eventMarkerUpText || "▲");
    const eventMarkerDownText = String(constants.eventMarkerDownText || "▼");
    const eventMarkerTextSize = Number(constants.eventMarkerTextSize) || 13;
    const pointIndexCache = new WeakMap();
    let lastTimingPreparationKey = "";
    let pendingTimingPreparation = null;

    function transformSignature(indexedTickers) {
      return [...indexedTickers]
        .map(String)
        .sort()
        .map((ticker) => {
          const offset = Number(chartSession.seriesOffsets?.[ticker]);
          const scale = Number(chartSession.seriesScales?.[ticker]);
          return `${ticker}:${Number.isFinite(offset) ? offset : 0}:${Number.isFinite(scale) ? scale : 1}`;
        })
        .join("|");
    }

    function cachedPointIndex(seriesModels, indexedTickers) {
      if (!Array.isArray(seriesModels)) {
        return chartEventLayer.buildPointIndex(seriesModels || [], indexedTickers, toUtcMs);
      }
      const key = [...indexedTickers].map(String).sort().join("|");
      const geometryKey = transformSignature(indexedTickers);
      let cached = pointIndexCache.get(seriesModels);
      if (!cached || cached.geometryKey !== geometryKey) {
        cached = { geometryKey, entries: new Map() };
        pointIndexCache.set(seriesModels, cached);
      }
      if (cached.entries.has(key)) return cached.entries.get(key);
      const value = chartEventLayer.buildPointIndex(seriesModels, indexedTickers, toUtcMs);
      cached.entries.set(key, value);
      return value;
    }

    function visibleTimingSeries(selected, seriesModels) {
      const available = new Set((seriesModels || [])
        .map((model) => String(model?.series || "").toUpperCase()));
      return (selected || []).filter((ticker) => (
        isForecastSeries(ticker)
        && available.has(ticker)
        && !chartSession.hiddenSeries.has(ticker)
      ));
    }

    function createFrame({
      selected,
      seriesModels,
      start,
      end,
      markerStart = start,
      markerEnd = end,
      viewportRange = null,
    }) {
      const selectedSet = new Set(selected || []);
      const available = new Set((seriesModels || [])
        .map((model) => String(model?.series || "").toUpperCase()));
      const visibleTickers = new Set([...selectedSet].filter((ticker) => (
        available.has(ticker) && !chartSession.hiddenSeries.has(ticker)
      )));
      const timingSeries = chartSession.showRecessionSignals
        ? visibleTimingSeries(selected, seriesModels)
        : [];
      const indexedTickers = new Set(timingSeries);
      const addEventTickers = (rows) => {
        if (indexedTickers.size >= visibleTickers.size) return;
        for (const row of rows || []) {
          const ticker = String(row?.ticker || "").trim().toUpperCase();
          if (visibleTickers.has(ticker)) indexedTickers.add(ticker);
          if (indexedTickers.size >= visibleTickers.size) break;
        }
      };
      if (chartSession.showDisclosures) addEventTickers(getDisclosureRows?.() || []);
      if (chartSession.showInsiderTrades) addEventTickers(getInsiderTradeRows?.() || []);
      const hasIndexedMarkers = indexedTickers.size > 0;
      return {
        selected: [...(selected || [])],
        selectedSet,
        seriesModels: seriesModels || [],
        start,
        end,
        markerStart,
        markerEnd,
        timingSeries,
        crisisEvents: chartSession.showRecessionSignals
          ? collectCrisisSignalEntries(getCrisisRows?.() || [])
          : [],
        pointIndex: hasIndexedMarkers
          ? cachedPointIndex(seriesModels || [], indexedTickers)
          : {},
        markerGap: hasIndexedMarkers
          ? chartEventLayer.markerGap(seriesModels || [], markerStart, markerEnd, {
            ratio: eventMarkerGapRatio,
            hiddenSeries: chartSession.hiddenSeries,
            useViewport: Boolean(getUseViewportMarkerGap?.()),
            viewportRange: Array.isArray(viewportRange) ? viewportRange : getViewportYRange?.(),
          })
          : 0,
      };
    }

    function getMarketTimingModel(ticker) {
      return getMarketTimingService?.()?.get(ticker) || null;
    }

    function buildCrisis(frame) {
      const crisisRows = getCrisisRows?.() || [];
      if (!chartSession.showRecessionSignals || !crisisRows.length || !frame.seriesModels.length) {
        return { trace: null, count: 0 };
      }
      const indexes = ["^KS11", "^KQ11"].filter((ticker) => (
        frame.selectedSet.has(ticker) && !chartSession.hiddenSeries.has(ticker)
      ));
      if (!indexes.length || !frame.crisisEvents.length) return { trace: null, count: 0 };
      const points = [];
      frame.crisisEvents.forEach((event) => {
        if (event.date > frame.end) return;
        indexes.forEach((ticker) => {
          const point = findPointOnOrAfterDate(event.date, ticker, frame.pointIndex);
          if (!point || point.date < frame.start || point.date > frame.end) return;
          points.push({
            event,
            ticker,
            date: point.date,
            y: point.y + frame.markerGap * timingGapMultiplier,
          });
        });
      });
      if (!points.length) return { trace: null, count: 0 };
      const stageName = (stage) => stage === "crisis" ? "위기" : "경고";
      return {
        count: points.length,
        trace: {
          x: points.map((point) => point.date),
          y: points.map((point) => point.y),
          customdata: points.map(({ event, ticker }) => [
            labelName(ticker),
            stageName(event.stage),
            event.score,
            event.curve,
            event.labor,
            event.credit,
          ]),
          text: points.map(() => eventMarkerDownText),
          type: "scatter",
          mode: "text",
          name: "침체 위기신호",
          showlegend: false,
          cliponaxis: false,
          yaxis: "y",
          hoverinfo: chartSession.hoverShowPopup ? undefined : "none",
          hovertemplate: chartSession.hoverShowPopup
            ? "<b>%{customdata[0]} 침체 %{customdata[1]} %{customdata[2]}점</b>"
              + "<br>금리 %{customdata[3]} · 고용 %{customdata[4]} · 신용 %{customdata[5]}<extra></extra>"
            : undefined,
          meta: {
            overlayKind: "crisis",
            isCrisisSignalTrace: true,
            pointTickers: points.map((point) => point.ticker),
          },
          textposition: "middle center",
          textfont: buildEventMarkerTextFont(colors.crisis, eventMarkerTextSize),
        },
      };
    }

    function buildTiming(frame, side) {
      if (!chartSession.showRecessionSignals || !frame.seriesModels.length || !frame.timingSeries.length) {
        return { trace: null, count: 0 };
      }
      const sell = side === "sell";
      const points = [];
      frame.timingSeries.forEach((ticker) => {
        const model = getMarketTimingModel(ticker);
        const signals = sell ? model?.sellSignals : model?.signals;
        (signals || []).forEach((signal) => {
          if (signal.date > frame.end) return;
          const point = findPointOnOrAfterDate(signal.date, ticker, frame.pointIndex, 4);
          if (!point || point.date < frame.start || point.date > frame.end) return;
          points.push({
            signal,
            ticker,
            date: point.date,
            y: point.y + frame.markerGap * timingGapMultiplier * (sell ? 1 : -1),
          });
        });
      });
      if (!points.length) return { trace: null, count: 0 };
      points.sort((left, right) => (
        left.date.localeCompare(right.date) || left.ticker.localeCompare(right.ticker)
      ));
      const printable = (value, digits = 1, suffix = "") => (
        Number.isFinite(toNum(value)) ? `${toNum(value).toFixed(digits)}${suffix}` : "-"
      );
      const customdata = sell
        ? points.map(({ signal, ticker }) => [
          labelName(ticker),
          compactTimingReasons([
            signal.sellSetupReasons,
            signal.sellDeteriorationReasons,
            signal.sellTriggerReasons,
          ], "과열·추세 둔화"),
          Number.isFinite(signal.creditChange) ? signal.creditChange.toFixed(1) : "-",
          Number.isFinite(signal.priceDrawdown60) ? signal.priceDrawdown60.toFixed(1) : "-",
          signal.signalGrade || "보통",
          signal.marketRegime || "range",
          Number.isFinite(signal.evidenceCount) ? signal.evidenceCount : "-",
          signal.signalFamily || "overheat-rollover",
          signal.behaviorProfile?.label || "혼합형",
          signal.signalRole === "warning" ? "과매수 경고" : "매도 신호",
        ])
        : points.map(({ signal, ticker }) => [
          labelName(ticker),
          compactTimingReasons([
            signal.setupReasons,
            signal.sentimentTurnReasons,
            signal.stabilizationReasons,
            signal.triggerReasons,
          ], "과매도·반전"),
          printable(signal.adrMin),
          printable(signal.fearMin),
          printable(signal.oscillator, 3),
          signal.signalGrade || "보통",
          signal.marketRegime || "range",
          Number.isFinite(signal.evidenceCount) ? signal.evidenceCount : "-",
          signal.signalFamily || "correction-reversal",
          signal.behaviorProfile?.label || "혼합형",
          signal.signalRole === "warning" ? "과매도 경고" : "매수 신호",
        ]);
      const hovertemplate = customdata.map((values) => {
        const reasons = String(escapeHtml?.(values[1]) ?? values[1]).replace(" · ", "<br>· ");
        return sell
          ? `<b>%{customdata[0]} %{customdata[9]}</b><br>근거: ${reasons}`
            + "<br>신용20일 %{customdata[2]}% · 고점대비 %{customdata[3]}%<extra></extra>"
          : `<b>%{customdata[0]} %{customdata[10]}</b><br>근거: ${reasons}`
            + "<br>ADR %{customdata[2]} · 공포 %{customdata[3]} · MACD %{customdata[4]}<extra></extra>";
      });
      const trace = {
        x: points.map((point) => point.date),
        y: points.map((point) => point.y),
        customdata,
        text: points.map(() => sell ? eventMarkerDownText : eventMarkerUpText),
        type: "scatter",
        mode: "text",
        name: sell ? "타이밍 매도신호" : "타이밍 매수신호",
        showlegend: false,
        cliponaxis: false,
        yaxis: "y",
        hoverinfo: chartSession.hoverShowPopup ? undefined : "none",
        hovertemplate: chartSession.hoverShowPopup ? hovertemplate : undefined,
        meta: {
          overlayKind: sell ? "timing-sell" : "timing-buy",
          [sell ? "isMarketTimingSellTrace" : "isMarketTimingBuyTrace"]: true,
          pointTickers: points.map((point) => point.ticker),
        },
        textposition: "middle center",
        textfont: buildEventMarkerTextFont(
          sell ? colors.timingSell : colors.timingBuy,
          eventMarkerTextSize,
        ),
      };
      return { trace, count: points.length };
    }

    function buildDisclosure(frame) {
      const disclosureRows = getDisclosureRows?.() || [];
      const stats = { total: disclosureRows.length, candidates: 0, markers: 0 };
      if (!disclosureRows.length || !frame.seriesModels.length) {
        return { trace: null, stats, groups: new Map() };
      }
      const candidates = disclosureRows.filter((event) => (
        frame.selectedSet.has(event.ticker)
        && !chartSession.hiddenSeries.has(event.ticker)
        && event.date >= frame.start
        && event.date <= frame.end
      ));
      stats.candidates = candidates.length;
      const grouped = new Map();
      candidates.forEach((event) => {
        const point = chartEventLayer.findPointOnDate(event.date, event.ticker, frame.pointIndex);
        if (!point) return;
        const key = `${event.ticker}|${point.date}`;
        const group = grouped.get(key) || {
          ticker: event.ticker,
          name: event.name || labelName(event.ticker),
          color: seriesColor(event.ticker),
          plotDate: point.date,
          y: point.y + frame.markerGap,
          events: [],
        };
        group.events.push(event);
        grouped.set(key, group);
      });
      const groups = [...grouped.values()].sort((left, right) => (
        left.plotDate.localeCompare(right.plotDate)
      ));
      stats.markers = groups.length;
      const groupsById = new Map();
      if (!groups.length) return { trace: null, stats, groups: groupsById };
      const groupIds = groups.map((group) => {
        const id = `d|${group.ticker}|${group.plotDate}`;
        groupsById.set(id, group);
        return id;
      });
      return {
        stats,
        groups: groupsById,
        trace: {
          x: groups.map((group) => group.plotDate),
          y: groups.map((group) => group.y),
          text: groups.map(() => String(constants.disclosureIconText || "◆")),
          customdata: groupIds.map((id) => [id]),
          type: "scatter",
          mode: "text",
          name: constants.disclosureTraceName,
          showlegend: false,
          cliponaxis: false,
          yaxis: "y",
          hovertemplate: groups.map((group) => {
            const first = group.events[0];
            const more = group.events.length > 1 ? ` 외 ${group.events.length - 1}건` : "";
            return `<span style="color:#f59e0b"><b>공시</b></span>`
              + `<br>${escapeHtml(first.type)}: ${escapeHtml(first.title)}${more}`
              + "<extra></extra>";
          }),
          meta: {
            overlayKind: "disclosure",
            isDisclosureTrace: true,
            pointTickers: groups.map((group) => group.ticker),
            // Keep each popup payload with the rendered trace. Async marker
            // refreshes may replace the shared lookup map before this trace is
            // replaced, but a visible marker must always remain clickable.
            eventGroups: groups,
          },
          textposition: "middle center",
          textfont: buildEventMarkerTextFont(
            groups.map((group) => group.color || colors.disclosure),
            constants.disclosureTextSize,
          ),
        },
      };
    }

    function collectTimingMarkerYByKey(frame) {
      const markerYs = new Map();
      if (!chartSession.showRecessionSignals) return markerYs;
      const add = (ticker, point, offset) => {
        if (!point || point.date < frame.start || point.date > frame.end) return;
        const key = `${ticker}|${point.date}`;
        const values = markerYs.get(key) || [];
        values.push(point.y + offset);
        markerYs.set(key, values);
      };
      frame.timingSeries.forEach((ticker) => {
        const model = getMarketTimingModel(ticker);
        (model?.signals || []).forEach((signal) => {
          if (signal.date <= frame.end) add(
            ticker,
            findPointOnOrAfterDate(signal.date, ticker, frame.pointIndex, 4),
            -frame.markerGap * timingGapMultiplier,
          );
        });
        (model?.sellSignals || []).forEach((signal) => {
          if (signal.date <= frame.end) add(
            ticker,
            findPointOnOrAfterDate(signal.date, ticker, frame.pointIndex, 4),
            frame.markerGap * timingGapMultiplier,
          );
        });
      });
      ["^KS11", "^KQ11"].filter((ticker) => (
        frame.selectedSet.has(ticker) && !chartSession.hiddenSeries.has(ticker)
      )).forEach((ticker) => {
        frame.crisisEvents.forEach((event) => {
          if (event.date <= frame.end) add(
            ticker,
            findPointOnOrAfterDate(event.date, ticker, frame.pointIndex),
            frame.markerGap * timingGapMultiplier,
          );
        });
      });
      return markerYs;
    }

    function buildInsider(frame) {
      const insiderRows = getInsiderTradeRows?.() || [];
      const stats = { total: insiderRows.length, candidates: 0, markers: 0 };
      if (!insiderRows.length || !frame.seriesModels.length) return { traces: [], stats };
      const candidates = netSameReporterInsiderTrades(insiderRows.filter((event) => (
        frame.selectedSet.has(event.ticker)
        && !chartSession.hiddenSeries.has(event.ticker)
        && event.date >= frame.start
        && event.date <= frame.end
      )));
      stats.candidates = candidates.length;
      const grouped = new Map();
      candidates.forEach((event) => {
        const point = chartEventLayer.findPointOnDate(event.date, event.ticker, frame.pointIndex);
        if (!point) return;
        const side = event.side === "sell" ? "sell" : "buy";
        const key = `${event.ticker}|${point.date}|${side}`;
        const group = grouped.get(key) || {
          ticker: event.ticker,
          name: labelName(event.ticker),
          side,
          plotDate: point.date,
          y: point.y - frame.markerGap * insiderLineGapRatio,
          anchorY: point.y,
          events: [],
        };
        group.events.push(event);
        grouped.set(key, group);
      });
      const groups = [...grouped.values()];
      const sidesByMarker = new Map();
      groups.forEach((group) => {
        const key = `${group.ticker}|${group.plotDate}`;
        const sides = sidesByMarker.get(key) || new Set();
        sides.add(group.side);
        sidesByMarker.set(key, sides);
      });
      groups.forEach((group) => {
        const paired = sidesByMarker.get(`${group.ticker}|${group.plotDate}`)?.size > 1;
        group.paired = paired;
        if (!paired) return;
        const offsetRatio = group.side === "buy"
          ? pairedInsiderBuyOffsetRatio
          : pairedInsiderSellOffsetRatio;
        const offset = frame.markerGap * offsetRatio;
        group.y += group.side === "buy" ? offset : -offset;
      });
      const timingMarkerYByKey = collectTimingMarkerYByKey(frame);
      groups.forEach((group) => {
        const timingYs = timingMarkerYByKey.get(`${group.ticker}|${group.plotDate}`) || [];
        const overlapsTiming = timingYs.some((timingY) => (
          Math.abs(group.y - timingY) < frame.markerGap * insiderTimingCollisionDistanceRatio
        ));
        if (overlapsTiming) {
          group.y = group.anchorY - frame.markerGap * insiderTimingCollisionOffsetRatio;
        }
      });
      groups.sort((left, right) => (
        left.plotDate.localeCompare(right.plotDate) || left.side.localeCompare(right.side)
      ));
      stats.markers = groups.length;
      return {
        traces: buildInsiderMarkerTraces(groups, { textSize: eventMarkerTextSize }),
        stats,
      };
    }

    async function prepareMarketTimingModels(selected, seriesModels) {
      const targets = visibleTimingSeries(selected, seriesModels);
      if (!chartSession.showRecessionSignals || !targets.length) return;
      const taskKey = `signal:${targets.join(",")}`;
      const taskLabel = "신호 계산중";
      let progressStarted = false;
      const beginProgress = () => {
        if (progressStarted) return;
        progressStarted = signalProgress?.begin?.(taskKey, taskLabel) === true;
      };
      const cancelProgress = () => {
        if (progressStarted) signalProgress?.cancel?.(taskKey);
      };

      if (!getMarketTimingService?.()) {
        beginProgress();
        signalProgress?.update?.(taskKey, 0.08, taskLabel);
        try {
          await ensureMarketTimingFeature();
        } catch (error) {
          cancelProgress();
          throw error;
        }
      }
      const service = getMarketTimingService?.();
      if (!service) {
        cancelProgress();
        return;
      }
      const pricePayload = getPricePayload?.();
      const records = Array.isArray(pricePayload?.records)
        ? pricePayload.records
        : [];
      if (!records.length) {
        cancelProgress();
        return;
      }

      const sourceTickers = [...new Set([
        "^KS11",
        "^KQ11",
        ...targets,
      ].filter(isForecastSeries))].sort();
      const sourceRevision = dataRevisionSignature("price", "macro", "credit", "adr", "crisis");
      const first = records[0] || {};
      const latest = records.at(-1) || {};
      const signature = [
        "market-timing-v6",
        sourceRevision,
        sourceTickers.join(","),
        first.date || "",
        latest.date || "",
      ].join("|");
      const preparationKey = `${signature}|${targets.join(",")}`;
      if (lastTimingPreparationKey === preparationKey
        && targets.every((ticker) => service.has?.(ticker))) {
        cancelProgress();
        return;
      }
      if (pendingTimingPreparation?.key === preparationKey) {
        return pendingTimingPreparation.promise;
      }
      beginProgress();
      signalProgress?.update?.(taskKey, 0.22, taskLabel);
      let sources;
      if (service.stats().signature !== signature) {
        const volumeMaps = getTickerVolumeSeriesByTicker?.() || new Map();
        const dates = records.map((row) => String(row?.date || "").slice(0, 10));
        const pricesByTicker = Object.fromEntries(sourceTickers.map((ticker) => [
          ticker,
          records.map((row) => row?.[ticker] ?? null),
        ]));
        const volumesByTicker = Object.fromEntries(sourceTickers.flatMap((ticker) => {
          const entries = [...(volumeMaps.get(ticker)?.entries() || [])]
            .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
          return entries.length ? [[ticker, entries]] : [];
        }));
        const volatilityRows = getAdrRows?.() || [];
        sources = {
          dates,
          pricesByTicker,
          volumesByTicker,
          adrRows: volatilityRows,
          volatilityRows,
          macroRows: getMacroRows?.() || [],
          creditRows: getCreditRows?.() || [],
          crisisRows: getCrisisRows?.() || [],
        };
      }
      signalProgress?.update?.(taskKey, 0.42, taskLabel);
      const startedAt = startPerfSample();
      const preparation = (async () => {
        await service.prepare({
          signature,
          targets,
          ...(sources ? { sources } : {}),
        });
        signalProgress?.update?.(taskKey, 0.92, taskLabel);
        lastTimingPreparationKey = preparationKey;
        recordPerfSample("prepareMarketTimingModels", startedAt, {
          targets: targets.length,
          models: service.stats().modelCount,
        });
      })();
      pendingTimingPreparation = { key: preparationKey, promise: preparation };
      try {
        await preparation;
        signalProgress?.complete?.(taskKey, taskLabel);
      } catch (error) {
        cancelProgress();
        recordRuntimeError("market-timing-worker", error, { targets: targets.length });
      } finally {
        if (pendingTimingPreparation?.promise === preparation) pendingTimingPreparation = null;
      }
    }

    return Object.freeze({
      buildCrisis,
      buildDisclosure,
      buildInsider,
      buildTimingBuy: (frame) => buildTiming(frame, "buy"),
      buildTimingSell: (frame) => buildTiming(frame, "sell"),
      collectCrisisSignalEntries,
      createFrame,
      findPointOnOrAfterDate,
      prepareMarketTimingModels,
      visibleTimingSeries,
    });
  }

  export const chartMarkerRuntime = Object.freeze({
    CHART_MARKER_DEFAULTS,
    EVENT_MARKER_DESCRIPTORS,
    EVENT_MARKER_FONT_FAMILY,
    buildEventMarkerTextFont,
    buildEventMarkerPopoverGroup,
    collectCrisisSignalEntries,
    buildTimingSignalPopoverGroup,
    compactTimingReasons,
    createEventMarkerRenderState,
    createEventMarkerSpecs,
    createChartMarkerRuntime,
    eventMarkerDescriptor,
    eventMarkerIdentity,
    eventMarkerKind,
    eventMarkerLayer,
    findPointOnOrAfterDate,
    isDirectlyInteractiveEventMarkerTrace,
    isEventMarkerTrace,
    isTimingSignalTrace,
    materializeEventMarkerTraces,
  });

// Marker payload layout belongs to the marker runtime.
  const seriesMarkerBindingCache = new WeakMap();
  const markerTraceEntryCache = new WeakMap();

  function asTraceList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }

  function markerArrayMatches(left, right) {
    if (left === right) return true;
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      const leftValue = left[index];
      const rightValue = right[index];
      if (leftValue === rightValue) continue;
      if (leftValue == null || rightValue == null) return false;
      if (typeof leftValue !== "object" || typeof rightValue !== "object") return false;
      if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) return false;
    }
    return true;
  }

  function markerPayloadMatches(current, next) {
    return ["x", "customdata", "text", "hovertext", "ids"].every((key) => (
      markerArrayMatches(current?.[key] ?? null, next?.[key] ?? null)
    ));
  }

  function collectYUpdates(element, specs = []) {
    const traceIndexes = [];
    const yUpdates = [];
    const updated = [];
    let structureChanged = false;
    const currentTraces = Array.isArray(element?.data) ? element.data : [];

    (Array.isArray(specs) ? specs : []).forEach((spec) => {
      if (!spec?.enabled || typeof spec.matches !== "function") return;
      const nextTraces = asTraceList(typeof spec.build === "function" ? spec.build() : spec.traces);
      const currentIndexes = currentTraces.flatMap((trace, index) => (
        spec.matches(trace) ? [index] : []
      ));
      const keyOf = typeof spec.keyOf === "function" ? spec.keyOf : null;

      currentIndexes.forEach((traceIndex, index) => {
        const current = currentTraces[traceIndex];
        const next = keyOf
          ? nextTraces.find((trace) => keyOf(trace) === keyOf(current))
          : nextTraces[index];
        if (!next || !Array.isArray(next.y)) {
          structureChanged = true;
          return;
        }
        if (!markerPayloadMatches(current, next)) {
          structureChanged = true;
          return;
        }
        if (markerArrayMatches(current.y, next.y)) return;
        traceIndexes.push(traceIndex);
        yUpdates.push(next.y);
        if (spec.id && !updated.includes(spec.id)) updated.push(spec.id);
      });
      if (nextTraces.length !== currentIndexes.length) structureChanged = true;
    });

    return { traceIndexes, yUpdates, updated, structureChanged };
  }

  function markerTraceEntries(element, traces) {
    let markerCount = 0;
    for (let index = 0; index < traces.length; index += 1) {
      const trace = traces[index];
      if (Array.isArray(trace?.meta?.pointTickers) && Array.isArray(trace.x) && Array.isArray(trace.y)) {
        markerCount += 1;
      }
    }
    const cached = markerTraceEntryCache.get(element);
    const reusable = cached?.traceCount === traces.length
      && cached.markerCount === markerCount
      && cached.traceRefs.every((trace, index) => trace === traces[index])
      && cached.entries.every((entry) => (
        entry.xValues === entry.trace.x
        && entry.pointTickers === entry.trace.meta?.pointTickers
        && entry.pointCount === Math.min(entry.trace.x.length, entry.trace.y.length, entry.pointTickers.length)
        && entry.firstX === entry.trace.x[0]
        && entry.lastX === entry.trace.x[entry.trace.x.length - 1]
      ));
    if (reusable) return cached.entries;
    const entries = traces.flatMap((trace, traceIndex) => {
      const pointTickers = trace?.meta?.pointTickers;
      if (!Array.isArray(pointTickers) || !Array.isArray(trace.x) || !Array.isArray(trace.y)) return [];
      return [{
        trace,
        traceIndex,
        xValues: trace.x,
        pointTickers,
        pointCount: Math.min(trace.x.length, trace.y.length, pointTickers.length),
        firstX: trace.x[0],
        lastX: trace.x[trace.x.length - 1],
      }];
    });
    markerTraceEntryCache.set(element, {
      traceCount: traces.length,
      markerCount,
      traceRefs: traces.slice(),
      entries,
    });
    return entries;
  }

  function markerBindingMatches(cached, traces, sourceTrace, markerEntries) {
    if (!cached
      || cached.traceCount !== traces.length
      || cached.sourceTrace !== sourceTrace
      || cached.sourceX !== sourceTrace.x
      || cached.sourceCount !== sourceTrace.x.length
      || cached.sourceFirstX !== sourceTrace.x[0]
      || cached.sourceLastX !== sourceTrace.x[sourceTrace.x.length - 1]
      || cached.markerEntries.length !== markerEntries.length) return false;
    return markerEntries.every((entry, index) => {
      const previous = cached.markerEntries[index];
      return previous.trace === entry.trace
        && previous.traceIndex === entry.traceIndex
        && previous.xValues === entry.xValues
        && previous.pointTickers === entry.pointTickers
        && previous.pointCount === entry.pointCount
        && previous.firstX === entry.firstX
        && previous.lastX === entry.lastX;
    });
  }

  function buildSeriesMarkerBindings(traces, sourceTrace, seriesKey, markerEntries) {
    const sourceIndexByDate = new Map();
    sourceTrace.x.forEach((date, index) => sourceIndexByDate.set(String(date || ""), index));
    const bindings = markerEntries.flatMap((entry) => {
      const markerIndexes = [];
      const sourceIndexes = [];
      for (let pointIndex = 0; pointIndex < entry.pointCount; pointIndex += 1) {
        if (String(entry.pointTickers[pointIndex] || "") !== seriesKey) continue;
        const sourceIndex = sourceIndexByDate.get(String(entry.xValues[pointIndex] || ""));
        if (!Number.isInteger(sourceIndex)) continue;
        markerIndexes.push(pointIndex);
        sourceIndexes.push(sourceIndex);
      }
      return markerIndexes.length ? [{ ...entry, markerIndexes, sourceIndexes }] : [];
    });
    return {
      traceCount: traces.length,
      sourceTrace,
      sourceX: sourceTrace.x,
      sourceCount: sourceTrace.x.length,
      sourceFirstX: sourceTrace.x[0],
      sourceLastX: sourceTrace.x[sourceTrace.x.length - 1],
      markerEntries,
      bindings,
    };
  }

  function seriesMarkerBindings(element, traces, sourceTrace, seriesKey) {
    let cache = seriesMarkerBindingCache.get(element);
    if (!cache) {
      cache = new Map();
      seriesMarkerBindingCache.set(element, cache);
    }
    const markerEntries = markerTraceEntries(element, traces);
    let cached = cache.get(seriesKey);
    if (!markerBindingMatches(cached, traces, sourceTrace, markerEntries)) {
      cached = buildSeriesMarkerBindings(traces, sourceTrace, seriesKey, markerEntries);
      cache.set(seriesKey, cached);
    }
    return cached.bindings;
  }

  function clearSeriesYDeltaCache(element = null) {
    if (element) {
      seriesMarkerBindingCache.delete(element);
      markerTraceEntryCache.delete(element);
    }
  }

  function collectSeriesYDeltaUpdates(element, options = {}) {
    const traces = Array.isArray(element?.data) ? element.data : [];
    const seriesKey = String(options.seriesKey || "");
    const sourceTrace = traces[Number(options.sourceTraceIndex)];
    const nextSourceY = Array.isArray(options.nextY) ? options.nextY : [];
    if (!seriesKey || !sourceTrace || !Array.isArray(sourceTrace.x)
      || !Array.isArray(sourceTrace.y) || !nextSourceY.length) {
      return { traceIndexes: [], yUpdates: [] };
    }

    const sourceCount = Math.min(sourceTrace.x.length, sourceTrace.y.length, nextSourceY.length);
    const traceIndexes = [];
    const yUpdates = [];
    const bindings = seriesMarkerBindings(element, traces, sourceTrace, seriesKey);
    bindings.forEach((binding) => {
      const trace = traces[binding.traceIndex];
      if (!trace || !Array.isArray(trace.y)) return;
      let y = null;
      let changed = false;
      for (let pairIndex = 0; pairIndex < binding.markerIndexes.length; pairIndex += 1) {
        const markerIndex = binding.markerIndexes[pairIndex];
        const sourceIndex = binding.sourceIndexes[pairIndex];
        if (sourceIndex >= sourceCount) continue;
        const currentSource = Number(sourceTrace.y[sourceIndex]);
        const nextSource = Number(nextSourceY[sourceIndex]);
        const currentMarker = Number(trace.y[markerIndex]);
        const delta = nextSource - currentSource;
        if (!Number.isFinite(delta) || !Number.isFinite(currentMarker) || delta === 0) continue;
        if (!y) y = trace.y.slice();
        y[markerIndex] = currentMarker + delta;
        changed = true;
      }
      if (!changed) return;
      traceIndexes.push(binding.traceIndex);
      yUpdates.push(y);
    });
    return { traceIndexes, yUpdates };
  }

  export const chartMarkerLayout = Object.freeze({
    clearSeriesYDeltaCache,
    collectSeriesYDeltaUpdates,
    collectYUpdates,
    markerArrayMatches,
    markerPayloadMatches,
  });
