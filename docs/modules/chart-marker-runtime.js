(function initThinkStockChartMarkerRuntime(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

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

  function compactTimingReasons(reasonGroups, fallback = "복합 조건 충족", limit = 2) {
    const reasons = [];
    (Array.isArray(reasonGroups) ? reasonGroups : []).forEach((group) => {
      (Array.isArray(group) ? group : []).forEach((rawReason) => {
        const reason = String(rawReason || "").trim();
        if (!reason || reasons.includes(reason)) return;
        reasons.push(reason.length > 14 ? `${reason.slice(0, 13)}…` : reason);
      });
    });
    return reasons.slice(0, Math.max(1, limit)).join(" · ") || fallback;
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

  function buildTimingSignalPopoverGroup(point) {
    const meta = point?.data?.meta || {};
    const values = Array.isArray(point?.customdata) ? point.customdata : [];
    const date = String(point?.x || "").slice(0, 10);
    if (meta.isMarketTimingBuyTrace) {
      return {
        name: values[0] || point.data.name || "타이밍",
        plotDate: date,
        events: [
          { title: `매수 신호 · ${values[5] || "보통"}` },
          { title: `근거: ${values[1] || "과매도·반전"}` },
          { title: `ADR ${values[2] ?? "-"} · 공포 ${values[3] ?? "-"} · MACD ${values[4] ?? "-"}` },
          { title: `시장 ${timingRegimeLabel(values[6])} · 근거 ${values[7] ?? "-"}개` },
        ],
      };
    }
    if (meta.isMarketTimingSellTrace) {
      return {
        name: values[0] || point.data.name || "타이밍",
        plotDate: date,
        events: [
          { title: `매도 신호 · ${values[4] || "보통"}` },
          { title: `근거: ${values[1] || "과열·추세 둔화"}` },
          { title: `신용20일 ${values[2] ?? "-"}% · 고점대비 ${values[3] ?? "-"}%` },
          { title: `시장 ${timingRegimeLabel(values[5])} · 근거 ${values[6] ?? "-"}개` },
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

  function createChartMarkerRuntime(scope = globalScope, options = {}) {
    const {
      colors = {},
      constants = {},
      chartEventLayer,
      chartSession,
      buildInsiderMarkerTraces,
      dataRevisionSignature,
      ensureMarketTimingFeature,
      escapeHtml,
      getAdrRows,
      getCreditRows,
      getCrisisRows,
      getCustomStocks,
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
      seriesColor,
      startPerfSample,
      toNum,
      toUtcMs,
    } = options;
    if (!chartEventLayer || !chartSession || typeof toUtcMs !== "function") {
      throw new Error("chart marker runtime dependencies are incomplete");
    }

    const eventMarkerGapRatio = Number(constants.eventMarkerGapRatio) || 0.02;
    const timingGapMultiplier = Number(constants.timingGapMultiplier) || 1.1;
    const insiderLineGapRatio = Number(constants.insiderLineGapRatio) || 1.7;
    const pairedInsiderBuyOffsetRatio = Number(constants.pairedInsiderBuyOffsetRatio) || 0.3;
    const pairedInsiderSellOffsetRatio = Number(constants.pairedInsiderSellOffsetRatio) || 0.95;
    const insiderTimingCollisionDistanceRatio = Number(constants.insiderTimingCollisionDistanceRatio) || 0.9;
    const insiderTimingCollisionOffsetRatio = Number(constants.insiderTimingCollisionOffsetRatio) || 2.2;
    const pointIndexCache = new WeakMap();
    let lastTimingPreparationKey = "";

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
            viewportRange: getViewportYRange?.(),
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
          type: "scatter",
          mode: "markers",
          name: "침체 위기신호",
          showlegend: false,
          cliponaxis: false,
          yaxis: "y",
          hoverinfo: chartSession.hoverShowPopup ? undefined : "none",
          hovertemplate: chartSession.hoverShowPopup
            ? "<b>%{customdata[0]} 침체 %{customdata[1]} %{customdata[2]}점</b>"
              + "<br>금리 %{customdata[3]} · 고용 %{customdata[4]} · 신용 %{customdata[5]}<extra></extra>"
            : undefined,
          meta: { isCrisisSignalTrace: true },
          marker: {
            symbol: "triangle-down",
            size: 13,
            color: colors.crisis,
            line: { color: "rgba(0,0,0,0.88)", width: 1.2 },
          },
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
      const trace = sell ? {
        x: points.map((point) => point.date),
        y: points.map((point) => point.y),
        customdata: points.map(({ signal, ticker }) => [
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
        ]),
        type: "scatter",
        mode: "markers",
        name: "타이밍 매도신호",
        showlegend: false,
        cliponaxis: false,
        yaxis: "y",
        hoverinfo: chartSession.hoverShowPopup ? undefined : "none",
        hovertemplate: chartSession.hoverShowPopup
          ? "<b>%{customdata[0]} 매도 신호</b>"
            + "<br>근거 · %{customdata[1]}"
            + "<br>신용20일 %{customdata[2]}% · 고점대비 %{customdata[3]}%<extra></extra>"
          : undefined,
        meta: { isMarketTimingSellTrace: true },
        marker: {
          symbol: "triangle-down",
          size: 13,
          color: colors.timingSell,
          line: { color: "rgba(0,0,0,0.88)", width: 1.2 },
        },
      } : {
        x: points.map((point) => point.date),
        y: points.map((point) => point.y),
        customdata: points.map(({ signal, ticker }) => [
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
        ]),
        type: "scatter",
        mode: "markers",
        name: "타이밍 매수신호",
        showlegend: false,
        cliponaxis: false,
        yaxis: "y",
        hoverinfo: chartSession.hoverShowPopup ? undefined : "none",
        hovertemplate: chartSession.hoverShowPopup
          ? "<b>%{customdata[0]} 매수 신호</b>"
            + "<br>근거 · %{customdata[1]}"
            + "<br>ADR %{customdata[2]} · 공포 %{customdata[3]} · MACD %{customdata[4]}<extra></extra>"
          : undefined,
        meta: { isMarketTimingBuyTrace: true },
        marker: {
          symbol: "triangle-up",
          size: 13,
          color: colors.timingBuy,
          line: { color: "rgba(0,0,0,0.88)", width: 1.2 },
        },
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
          text: groups.map(() => constants.disclosureIconText),
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
          meta: { isDisclosureTrace: true },
          textposition: "middle center",
          textfont: {
            color: groups.map((group) => group.color || colors.disclosure),
            size: constants.disclosureTextSize,
            family: "Arial Black, sans-serif",
          },
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
      return { traces: buildInsiderMarkerTraces(groups), stats };
    }

    async function prepareMarketTimingModels(selected, seriesModels) {
      if (!chartSession.showRecessionSignals) return;
      if (!getMarketTimingService?.()) await ensureMarketTimingFeature();
      const service = getMarketTimingService?.();
      const targets = visibleTimingSeries(selected, seriesModels);
      if (!service || !targets.length) return;
      const pricePayload = getPricePayload?.();
      const records = Array.isArray(pricePayload?.records)
        ? pricePayload.records
        : [];
      if (!records.length) return;

      const sourceTickers = [...new Set([
        "^KS11",
        "^KQ11",
        ...targets,
      ].filter(isForecastSeries))].sort();
      const sourceRevision = dataRevisionSignature("price", "macro", "credit", "adr", "crisis");
      const first = records[0] || {};
      const latest = records.at(-1) || {};
      const signature = [
        "market-timing-v5",
        sourceRevision,
        sourceTickers.join(","),
        first.date || "",
        latest.date || "",
      ].join("|");
      const preparationKey = `${signature}|${targets.join(",")}`;
      if (lastTimingPreparationKey === preparationKey
        && targets.every((ticker) => service.has?.(ticker))) return;
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
      const startedAt = startPerfSample();
      try {
        await service.prepare({
          signature,
          targets,
          ...(sources ? { sources } : {}),
        });
        lastTimingPreparationKey = preparationKey;
        recordPerfSample("prepareMarketTimingModels", startedAt, {
          targets: targets.length,
          models: service.stats().modelCount,
        });
      } catch (error) {
        recordRuntimeError("market-timing-worker", error, { targets: targets.length });
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

  globalScope.ThinkStockChartMarkerRuntime = Object.freeze({
    collectCrisisSignalEntries,
    buildTimingSignalPopoverGroup,
    compactTimingReasons,
    createChartMarkerRuntime,
    findPointOnOrAfterDate,
  });
}(typeof self !== "undefined" ? self : globalThis));

// Marker payload layout belongs to the marker runtime.
(function initThinkStockChartMarkerLayout(globalScope) {
  "use strict";

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

  globalScope.ThinkStockChartMarkerLayout = Object.freeze({
    collectYUpdates,
    markerArrayMatches,
    markerPayloadMatches,
  });
}(typeof self !== "undefined" ? self : globalThis));
