(function initThinkStockAuxiliaryChartRuntime(globalScope) {
  "use strict";

  function createAuxiliaryChartRuntime(scope = globalScope, options = {}) {
    const {
      ADR_BAND_COLOR,
      ADR_HIGH_THRESH,
      ADR_LOW_THRESH,
      ADR_ZONE_HIGH_COLOR,
      ADR_ZONE_LOW_COLOR,
      AUXILIARY_PANEL_KEYS,
      AUXILIARY_SERIES_KEYS,
      FEAR_GREED_HIGH_THRESH,
      FEAR_GREED_LOW_THRESH,
      MACD_STOCK_PATTERN,
      NEWS_SENTIMENT_HIGH_THRESH,
      NEWS_SENTIMENT_LOW_THRESH,
      PLOTLY_CONFIG,
      SERIES_COLORS,
      addViewportYRangeToRelayout,
      auxiliaryChartHorizontalMargin,
      buildAdrZoneTraces,
      buildCursorHoverMode,
      buildCursorLineAxisLayout,
      buildAuxiliaryPanelLayout,
      buildAuxiliaryViewportRanges,
      buildMacdViewportYRange,
      buildThresholdEnvelopeSeries,
      buildThresholdZoneFillTraces,
      chartSession,
      clearHoverOnChart,
      dataRevisionSignature,
      dataState,
      findEarliestAuxiliaryDate,
      findLatestAuxiliaryDate,
      getAuxiliaryChartModel,
      getAuxiliaryChartModelSource,
      getMacdModelForSeries,
      isTouchDevice,
      labelName,
      plotlyHoverLabel,
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
    if (!scope.document || !dataState || !syncState) {
      throw new Error("auxiliary chart runtime dependencies are incomplete");
    }

    const document = scope.document;
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
    let adrHandlerSet = false;
    let lastAdrRenderKey = "";
    let auxiliaryChartRenderGeneration = 0;
    let pendingAdrRenderRequest = null;
    let adrRenderPromise = null;
    let lastMacdTraceCount = 0;
    let lastMacdRenderKey = "";
    let macdHandlerSet = false;

    function normalizeAuxiliaryPanelOrder() {
      const current = Array.isArray(chartSession.auxiliaryPanelOrder)
        ? chartSession.auxiliaryPanelOrder
        : [];
      const normalized = [...new Set([...current, ...AUXILIARY_PANEL_KEYS])]
        .filter((key) => AUXILIARY_PANEL_KEYS.includes(key));
      chartSession.auxiliaryPanelOrder = normalized;
      return normalized;
    }

    function moveAuxiliaryPanelToBottom(panelKey) {
      if (!AUXILIARY_PANEL_KEYS.includes(panelKey)) return;
      chartSession.auxiliaryPanelOrder = [
        ...normalizeAuxiliaryPanelOrder().filter((key) => key !== panelKey),
        panelKey,
      ];
    }

    function isAuxiliaryPanelVisible(panelKey) {
      return AUXILIARY_PANEL_KEYS.includes(panelKey)
        && !chartSession.hiddenAuxiliaryPanels.has(panelKey);
    }

    function syncAuxiliaryToggleStates() {
      const el = document.getElementById("chart-adr");
      if (!el) return;
      el.querySelectorAll(".auxiliary-representative-toggle[data-auxiliary-panel]")
        .forEach((button) => {
          button.setAttribute(
            "aria-pressed",
            isAuxiliaryPanelVisible(button.dataset.auxiliaryPanel) ? "true" : "false",
          );
        });
      el.querySelectorAll(".auxiliary-series-toggle[data-auxiliary-series]")
        .forEach((button) => {
          button.setAttribute(
            "aria-pressed",
            chartSession.hiddenAuxiliarySeries.has(button.dataset.auxiliarySeries) ? "false" : "true",
          );
        });
    }

    function requestAuxiliaryVisibilityUpdate() {
      persistState?.();
      syncAuxiliaryToggleStates();
      const mainRange = document.getElementById("chart")?._fullLayout?.xaxis?.range?.slice() || null;
      Promise.resolve(renderAdrChart(mainRange)).catch((error) => {
        scope.console?.error?.("auxiliary chart visibility update failed", error);
      });
    }

    function toggleAuxiliarySeries(key) {
      if (!key) return;
      if (chartSession.hiddenAuxiliarySeries.has(key)) chartSession.hiddenAuxiliarySeries.delete(key);
      else chartSession.hiddenAuxiliarySeries.add(key);
      requestAuxiliaryVisibilityUpdate();
    }

    function toggleAuxiliaryPanel(panelKey) {
      if (!AUXILIARY_PANEL_KEYS.includes(panelKey)) return;
      const wasHidden = chartSession.hiddenAuxiliaryPanels.has(panelKey);
      if (wasHidden) {
        chartSession.hiddenAuxiliaryPanels.delete(panelKey);
        moveAuxiliaryPanelToBottom(panelKey);
      } else {
        chartSession.hiddenAuxiliaryPanels.add(panelKey);
      }
      requestAuxiliaryVisibilityUpdate();
    }

    function toggleAdrPanel() {
      toggleAuxiliaryPanel("adr");
    }

    function toggleVolatilityPanel() {
      toggleAuxiliaryPanel("vkospi");
    }

    function bindAuxiliaryToggle(button, action) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail === 0) action();
      });
    }

    function syncAuxiliaryRepresentativeToggles(el, controls = null) {
      if (!el) return null;
      if (Array.isArray(controls)) {
        el.auxiliaryRepresentativeControls = controls.map((control) => ({ ...control }));
      }
      const representativeControls = Array.isArray(el.auxiliaryRepresentativeControls)
        ? el.auxiliaryRepresentativeControls
        : [];
      let row = el.querySelector(":scope > .auxiliary-representative-toggles");
      if (!row) {
        row = document.createElement("div");
        row.className = "auxiliary-representative-toggles";
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", "보조지표 표시");
        el.append(row);
      }
      if (!Array.isArray(controls)) return row;

      const fragment = document.createDocumentFragment();
      representativeControls.forEach((control) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "auxiliary-representative-toggle";
        button.dataset.auxiliaryPanel = control.panelKey;
        button.setAttribute("aria-pressed", control.active ? "true" : "false");
        button.setAttribute("aria-label", `${control.text} 보조지표 ${control.active ? "숨기기" : "표시"}`);
        button.disabled = control.available === false;
        button.style.setProperty("--auxiliary-series-color", control.color || "#ffffff");
        button.textContent = control.text;
        const action = control.panelKey === "adr"
          ? toggleAdrPanel
          : (control.panelKey === "vkospi"
            ? toggleVolatilityPanel
            : () => toggleAuxiliaryPanel(control.panelKey));
        bindAuxiliaryToggle(button, action);
        fragment.append(button);
      });
      row.replaceChildren(fragment);
      return row;
    }

    function syncAuxiliarySeparators(
      el,
      separatorPaperPositions = null,
      panelTitles = null,
      representativeControls = null,
    ) {
      if (!el) return;
      const rebuildHeadings = Array.isArray(panelTitles);
      if (Array.isArray(separatorPaperPositions)) {
        el.auxiliarySeparatorPaperPositions = [...separatorPaperPositions];
      }
      if (Array.isArray(panelTitles)) {
        el.auxiliaryPanelTitles = panelTitles.map((panel) => ({ ...panel }));
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
          title.setAttribute("aria-pressed", "true");
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
              button.setAttribute("aria-pressed", preset.active ? "true" : "false");
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
            button.setAttribute("aria-pressed", control.active ? "true" : "false");
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
        const displayDates = [];
        const displayValues = [];
        model.dates.forEach((date, index) => {
          if ((dataStart && date < dataStart) || (dataEnd && date > dataEnd)) return;
          const value = model.normalized[index];
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
          type: "bar",
          name: labelName(series),
          marker: {
            color: baseColor,
            line: { width: 0 },
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
        paper_bgcolor: "transparent",
        plot_bgcolor: "#111111",
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
          showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1,
          zeroline: false, color: "#666", tickfont: { size: 9 }, fixedrange: false,
          ...buildCursorLineAxisLayout(chartSession.cursorLineMode, "x"),
          hoverformat: "%Y.%-m.%-d",
          ...(Array.isArray(xRange) && xRange.length === 2 ? { range: xRange } : {}),
        },
        yaxis: {
          showgrid: true, gridcolor: "rgba(255,255,255,0.055)", gridwidth: 1,
          zeroline: false, color: "#777", tickfont: { size: 9 }, ticksuffix: "%",
          tickformat: ".2f", fixedrange: true,
          ...buildCursorLineAxisLayout(chartSession.cursorLineMode, "y"),
          range: viewportYRange || [-maxAbs * 1.08, maxAbs * 1.08],
        },
        font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
        hoverlabel: plotlyHoverLabel(11),
        dragmode: false,
      };
    
      await scope.Plotly.react(el, traces, layout, PLOTLY_CONFIG);
      lastMacdRenderKey = renderKey;
      if (!macdHandlerSet) {
        el.on("plotly_relayout", (eventData) => {
          if (syncState.chartSyncing) return;
          const rangePair = Array.isArray(eventData["xaxis.range"]) ? eventData["xaxis.range"] : null;
          const r0 = eventData["xaxis.range[0]"] ?? rangePair?.[0];
          const r1 = eventData["xaxis.range[1]"] ?? rangePair?.[1];
          if (r0 == null || r1 == null) return;
          chartSession.pinnedXRange = [r0, r1];
          [document.getElementById("chart"), document.getElementById("chart-adr")]
            .filter((target) => target?.data)
            .forEach((target) => scheduleViewportRangeSync(target, {
              "xaxis.range[0]": r0,
              "xaxis.range[1]": r1,
            }));
        });
        el.on("plotly_beforehover", () => (
          el.classList.contains("is-hover-waiting") ? false : undefined
        ));
        el.on("plotly_hover", (eventData) => {
          if (el.classList.contains("is-hover-waiting")) return;
          if (!chartSession.hoverShowPopup || syncState.hoverSyncing) return;
          const xValue = eventData?.points?.[0]?.x;
          if (!xValue) return;
          syncHoverToChart(document.getElementById("chart"), xValue);
          syncHoverToChart(document.getElementById("chart-adr"), xValue);
        });
        el.on("plotly_unhover", () => {
          if (!chartSession.hoverShowPopup || syncState.hoverSyncing) return;
          clearHoverOnChart(document.getElementById("chart"));
          clearHoverOnChart(document.getElementById("chart-adr"));
        });
        macdHandlerSet = true;
      }
      recordPerfSample("renderMacdChart", perfStartedAt, {
        traces: traces.length,
        points: traces.reduce((sum, trace) => sum + (trace.x?.length || 0), 0),
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
      } = model;
      if (!adrRowCount && !newsRowCount && !vkospiRowCount && !vixRowCount) return;
      const viewportRanges = buildAuxiliaryViewportRanges(model, xRange, {
        adrLowThreshold: ADR_LOW_THRESH,
        adrHighThreshold: ADR_HIGH_THRESH,
        newsLowThreshold: NEWS_SENTIMENT_LOW_THRESH,
        newsHighThreshold: NEWS_SENTIMENT_HIGH_THRESH,
      });
      const [adrYMin, adrYMax] = viewportRanges.adr;
      const [newsYMin, newsYMax] = viewportRanges.news;
      const [vkospiYMin, vkospiYMax] = viewportRanges.vkospi;
      const horizontalMargin = auxiliaryChartHorizontalMargin();
      const chartMargin = { l: horizontalMargin, r: horizontalMargin, t: 52, b: 36 };
      const hiddenAuxiliary = chartSession.hiddenAuxiliarySeries;
      const adrKospiAvailable = adrKospiValues.some(Number.isFinite);
      const adrKosdaqAvailable = adrKosdaqValues.some(Number.isFinite);
      const adrKospiEnabled = !hiddenAuxiliary.has(AUXILIARY_SERIES_KEYS.adrKospi)
        && adrKospiAvailable;
      const adrKosdaqEnabled = !hiddenAuxiliary.has(AUXILIARY_SERIES_KEYS.adrKosdaq)
        && adrKosdaqAvailable;
      const vkospiAvailable = vkospiValues.some(Number.isFinite);
      const vixAvailable = vixValues.some(Number.isFinite);
      const vkospiEnabled = !hiddenAuxiliary.has(AUXILIARY_SERIES_KEYS.vkospi)
        && vkospiAvailable;
      const vixEnabled = !hiddenAuxiliary.has(AUXILIARY_SERIES_KEYS.vix)
        && vixAvailable;
      const panelLayout = buildAuxiliaryPanelLayout({
        adr: isAuxiliaryPanelVisible("adr") && (adrKospiAvailable || adrKosdaqAvailable),
        fearGreed: isAuxiliaryPanelVisible("fearGreed")
          && fearGreedVals.some(Number.isFinite),
        newsSentiment: isAuxiliaryPanelVisible("newsSentiment")
          && newsSentimentVals.some(Number.isFinite),
        vkospi: isAuxiliaryPanelVisible("vkospi") && (vkospiAvailable || vixAvailable),
      }, { panelOrder });
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
          panelKey: "fearGreed",
          key: AUXILIARY_SERIES_KEYS.fearGreed,
          text: "공포탐욕",
          active: panelLayout.active.fearGreed,
          available: fearGreedVals.some(Number.isFinite),
          color: colorByPanel.fearGreed,
        },
        {
          panelKey: "newsSentiment",
          key: AUXILIARY_SERIES_KEYS.newsSentiment,
          text: "뉴스심리",
          active: panelLayout.active.newsSentiment,
          available: newsSentimentVals.some(Number.isFinite),
          color: colorByPanel.newsSentiment,
        },
        {
          panelKey: "vkospi",
          text: "변동성",
          active: panelLayout.active.vkospi,
          available: vkospiAvailable || vixAvailable,
          color: colorByPanel.vkospi,
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
          showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1,
          zeroline: false, color: "#666", tickfont: { size: 9 },
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
          showgrid: false,
          zeroline: false,
          visible: true,
          color: "#777",
          tickfont: { size: 9 },
          tickvals: [0, FEAR_GREED_LOW_THRESH, 50, FEAR_GREED_HIGH_THRESH, 100],
          fixedrange: true,
          range: [0, 100],
          domain: panelLayout.domains.fearGreed,
          ...multiPanelCursorAxisLayout(),
        };
      }
      if (panelLayout.active.newsSentiment) {
        yAxisLayouts[axisLayoutKey(panelLayout.axes.newsSentiment)] = {
          showgrid: false,
          zeroline: false,
          visible: true,
          color: "#777",
          tickfont: { size: 9 },
          tickvals: [NEWS_SENTIMENT_LOW_THRESH, 100, NEWS_SENTIMENT_HIGH_THRESH],
          fixedrange: true,
          range: [newsYMin, newsYMax],
          domain: panelLayout.domains.newsSentiment,
          ...multiPanelCursorAxisLayout(),
        };
      }
      if (panelLayout.active.vkospi) {
        yAxisLayouts[axisLayoutKey(panelLayout.axes.vkospi)] = {
          showgrid: false,
          zeroline: false,
          visible: true,
          color: "#777",
          tickfont: { size: 9 },
          tickformat: ".1f",
          fixedrange: true,
          range: [vkospiYMin, vkospiYMax],
          domain: panelLayout.domains.vkospi,
          ...multiPanelCursorAxisLayout(),
        };
      }

      const layout = {
        paper_bgcolor: "transparent",
        // A transparent subplot background prevents Plotly's fallback axis from
        // covering a lower panel while the axis topology changes.
        plot_bgcolor: "rgba(0,0,0,0)",
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
          showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1,
          zeroline: false, color: "#666", tickfont: { size: 9 },
          fixedrange: false,
          visible: panelLayout.activeKeys.length > 0,
          anchor: "free",
          position: 0,
          ...buildCursorLineAxisLayout(chartSession.cursorLineMode, "x"),
          hoverformat: "%Y, %-m, %-d",
          ...(xRange ? { range: xRange } : {}),
        },
        ...yAxisLayouts,
        font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
        hoverlabel: plotlyHoverLabel(11),
        dragmode: false,
      };
    
      try {
        await scope.Plotly.react(el, traces, layout, PLOTLY_CONFIG);
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
          const rangePair = Array.isArray(eventData["xaxis.range"]) ? eventData["xaxis.range"] : null;
          const hasRange = (eventData["xaxis.range[0]"] != null && eventData["xaxis.range[1]"] != null)
            || (Array.isArray(rangePair) && rangePair.length === 2);
          const hasAuto = eventData["xaxis.autorange"] === true;
          if (syncState.chartSyncing) return;
          if (syncState.cursorSyncing && !hasRange && !hasAuto) return;
          const syncedCharts = [
            document.getElementById("chart"),
            document.getElementById("chart-macd"),
          ].filter((target) => target?.data && !target.hidden);
          if (syncedCharts.length) {
            const r0 = eventData["xaxis.range[0]"] ?? (Array.isArray(rangePair) ? rangePair[0] : null);
            const r1 = eventData["xaxis.range[1]"] ?? (Array.isArray(rangePair) ? rangePair[1] : null);
            if (r0 != null && r1 != null) {
              chartSession.pinnedXRange = [r0, r1];
              syncedCharts.forEach((target) => scheduleViewportRangeSync(target, {
                "xaxis.range[0]": r0,
                "xaxis.range[1]": r1,
              }));
            } else if (hasAuto) {
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
        el.on("plotly_beforehover", () => (
          el.classList.contains("is-hover-waiting") ? false : undefined
        ));
        el.on("plotly_hover", (eventData) => {
          if (el.classList.contains("is-hover-waiting")) return;
          if (!chartSession.hoverShowPopup || syncState.hoverSyncing) return;
          const xValue = eventData?.points?.[0]?.x;
          if (!xValue) return;
          const mainEl = document.getElementById("chart");
          const macdEl = document.getElementById("chart-macd");
          syncHoverToChart(mainEl, xValue);
          if (!macdEl?.hidden) syncHoverToChart(macdEl, xValue);
        });
        el.on("plotly_unhover", () => {
          if (!chartSession.hoverShowPopup || syncState.hoverSyncing) return;
          const mainEl = document.getElementById("chart");
          const macdEl = document.getElementById("chart-macd");
          clearHoverOnChart(mainEl);
          clearHoverOnChart(macdEl);
        });
        adrHandlerSet = true;
      }
      recordPerfSample("renderAdrChart", perfStartedAt, {
        rows: adrRowCount,
        newsRows: newsRowCount,
        vkospiRows: vkospiRowCount,
        cacheHit: false,
        modelSource: getAuxiliaryChartModelSource(),
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
    }

    function invalidateMacd() {
      lastMacdRenderKey = "";
    }

    return Object.freeze({
      invalidateAdr,
      invalidateMacd,
      renderAdrChart,
      renderMacdChart,
      stats: () => ({
        adrRenderKey: lastAdrRenderKey,
        macdRenderKey: lastMacdRenderKey,
        macdTraces: lastMacdTraceCount,
      }),
    });
  }

  globalScope.ThinkStockAuxiliaryChartRuntime = Object.freeze({
    createAuxiliaryChartRuntime,
  });
}(typeof self !== "undefined" ? self : globalThis));
