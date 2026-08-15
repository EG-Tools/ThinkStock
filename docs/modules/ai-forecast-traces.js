(function initThinkStockAiForecastTraces(globalScope) {
  "use strict";

  const SCENARIO_KEYS = Object.freeze(["upside", "sideways", "downside"]);
  const PRIMARY_SCENARIO_STYLE = Object.freeze({
    color: "rgba(248, 248, 248, 0.98)",
    width: 2.9,
  });
  const SECONDARY_SCENARIO_STYLE = Object.freeze({
    color: "rgba(138, 138, 138, 0.48)",
    width: 1.8,
  });

  function resolveScenarioTraceStyle(isHighestProbability) {
    return isHighestProbability ? PRIMARY_SCENARIO_STYLE : SECONDARY_SCENARIO_STYLE;
  }

  function isThickestAiScenarioTrace(trace) {
    if (!trace?.meta?.isAiForecastScenarioTrace) return false;
    const renderedWidth = Number(trace.line?.width);
    const thickestWidth = Number(trace.meta?.thickestAiScenarioLineWidth);
    return Number.isFinite(renderedWidth)
      && Number.isFinite(thickestWidth)
      && Math.abs(renderedWidth - thickestWidth) < 0.001;
  }

  function withoutStockCode(value) {
    return String(value || "").replace(/\s*\(\d{6}\)/g, "").replace(/\s{2,}/g, " ").trim();
  }

  function buildRepresentativeReportLink(
    report,
    escapeHtml = (value) => String(value || ""),
  ) {
    if (!report?.sourceUrl || !report?.title) return "";
    const date = String(report.publishedDate || "").slice(0, 10);
    const title = withoutStockCode(report.title);
    return `<br>참고 리포트 · ${escapeHtml(date)} · ${escapeHtml(title).replaceAll("%", "&#37;")}`;
  }

  function representativeReportFromForecastClick(eventData) {
    const point = eventData?.points?.find((candidate) => (
      isThickestAiScenarioTrace(candidate?.data)
      && candidate?.data?.meta?.representativeReport
    ));
    const report = point?.data?.meta?.representativeReport;
    if (!report?.sourceUrl || !report?.title) return null;
    try {
      const url = new URL(String(report.sourceUrl));
      const allowed = url.protocol === "https:" && (
        url.hostname === "consensus.hankyung.com"
        || (url.hostname === "stock.pstatic.net"
          && /^\/stock-research\/company\/\d{1,4}\/20\d{6}_company_\d{1,12}\.pdf$/i.test(url.pathname))
      );
      if (!allowed) return null;
      return Object.freeze({ point, report: Object.freeze({
        broker: String(report.broker || ""),
        publishedDate: String(report.publishedDate || "").slice(0, 10),
        sourceUrl: url.toString(),
        title: String(report.title || "").trim(),
      }) });
    } catch (_) {
      return null;
    }
  }

  function createAiForecastTraces(options = {}) {
    const {
      MAIN_LINE_TRACE_TYPE,
      aiForecastApp,
      aiForecastContextPendingForSeries,
      aiForecastHistoryRows,
      aiForecastInputsPending,
      aiRotationCandidatesForForecast,
      applyAiForecastJournalCalibration,
      chartSession,
      currentDate,
      disclosureRowsForTicker,
      ensureAiFeatureModules,
      escapeHtml,
      formatActualValue,
      getAiForecastCacheService,
      getMacdModelForSeries,
      getStructuralProfile,
      labelName,
      queueAiForecastJournalSync,
      resetAiForecastProgress,
      runAiForecast,
      setAiForecastProgress,
      showAiForecastUnavailable,
      startAiForecastProgress,
      state,
      syncAiForecastToggleButton,
      waitForAiProgressPaint,
    } = options;
    if (!state || !chartSession || !aiForecastApp) {
      throw new Error("AI forecast trace dependencies are incomplete");
    }

    async function build(rows, seriesModels) {
      if (!chartSession.showAiForecast) {
        state.lastAiForecastTraceCount = 0;
        syncAiForecastToggleButton(0);
        return [];
      }
      await ensureAiFeatureModules();
      const resolveScenarioPresentation = globalScope.ThinkStockAiForecastScenarios
        ?.resolveScenarioPresentation;
      if (typeof resolveScenarioPresentation !== "function") {
        throw new Error("AI scenario presentation dependency is unavailable");
      }
      const traces = [];
      const unavailableForecasts = [];
      let forecastCount = 0;
      const targetRevisionAtStart = state.aiForecastTargetRevision;
      const forecastCandidates = (seriesModels || []).filter((model) => {
        const series = String(model?.series || "").toUpperCase();
        return state.aiForecastTargetSeries.has(series);
      });
      const workItems = forecastCandidates.flatMap((model) => {
        const series = String(model?.series || "").toUpperCase();
        const analysis = state.aiAnalysisByTicker.get(series) || null;
        if (state.aiContextPendingTickers.has(series)) return [];
        if (state.aiAnalysisPendingTickers.has(series) && !analysis) return [];
        const brokerResearch = state.brokerResearchByTicker.get(series) || null;
        const historyRows = aiForecastHistoryRows(series);
        const macdModel = getMacdModelForSeries(series);
        const priceDate = String(historyRows.at(-1)?.date || "").slice(0, 10);
        const today = typeof currentDate === "function" ? currentDate() : priceDate;
        const analysisAsOf = state.aiFeature.analysis.selectAnalysisAsOf?.(analysis, today) || null;
        const disclosures = disclosureRowsForTicker(series);
        const disclosureDate = disclosures.reduce((latest, row) => {
          const date = String(row?.date || "").slice(0, 10);
          return date <= today && date > latest ? date : latest;
        }, "");
        const decisionDate = [
          priceDate,
          analysisAsOf?.asOf || "",
          disclosureDate,
          String(brokerResearch?.latestAvailableDate || brokerResearch?.latestDate || "").slice(0, 10),
        ]
          .sort()
          .at(-1);
        const options = {
          series,
          decisionDate,
          dates: historyRows.map((row) => row.date),
          prices: historyRows.map((row) => row[series]),
          transformPrices: (rows || []).map((row) => row?.[series]),
          transformChartValues: model.values,
          macroRows: state.macroRows,
          auxiliaryRows: state.adrRows,
          creditRows: state.creditRows,
          marketCandidates: ["^KS11", "^KQ11"].map((marketSeries) => ({
            series: marketSeries,
            dates: historyRows.map((row) => row.date),
            prices: historyRows.map((row) => row[marketSeries]),
          })),
          rotationCandidates: aiRotationCandidatesForForecast(),
          crisisRows: state.crisisRows,
          koreanVolatilityCandidate: true,
          externalRiskCandidates: true,
          disclosures,
          consensus: analysisAsOf?.consensus || null,
          financials: analysisAsOf?.financials || [],
          internetNews: analysisAsOf?.news || [],
          brokerResearch,
          structuralProfile: typeof getStructuralProfile === "function"
            ? getStructuralProfile(series)
            : null,
          marketModel: state.aiMarketModel,
          macdSignal: macdModel?.signal || 0,
          horizon: 126,
        };
        const inputKey = state.aiFeature.forecast.getForecastInputKey(options);
        const availability = inputKey
          ? null
          : state.aiFeature.forecast.getForecastAvailability?.(options) || null;
        const cached = state.aiForecastResultBySeries.get(series);
        const contextPending = aiForecastContextPendingForSeries(series);
        // Rendering changes never alter inputKey. Real price, event, analysis, or macro
        // changes do, so only the affected forecast is recalculated.
        const reusableCache = inputKey && cached
          && (cached.inputKey === inputKey || contextPending)
          ? cached
          : null;
        return [{
          model,
          series,
          historyRows,
          options,
          inputKey,
          cached: reusableCache,
          contextPending,
          availability,
        }];
      });
      const forecastCache = getAiForecastCacheService();
      await Promise.all(workItems.map(async (item) => {
        if (item.cached || item.contextPending || !item.inputKey) return;
        const forecast = await forecastCache.get(item.series, item.inputKey);
        if (forecast) item.cached = { inputKey: item.inputKey, forecast };
      }));
      const calculationItems = workItems.filter((item) => (
        !item.cached
        && !item.contextPending
        && item.availability?.available !== false
        && !state.aiForecastDeferredSeries.has(item.series)
      ));
      if (calculationItems.length && !aiForecastApp.isProgressActive()) startAiForecastProgress();
      const reportCalculationProgress = calculationItems.length > 0 && !aiForecastInputsPending();
      let completedCalculations = 0;
      for (const item of workItems) {
        if (targetRevisionAtStart !== state.aiForecastTargetRevision) return [];
        const { series, historyRows, options } = item;
        if (item.availability?.available === false) {
          unavailableForecasts.push({ series, ...item.availability });
          continue;
        }
        let forecast = item.cached
          ? state.aiFeature.forecast.applyChartTransform(item.cached.forecast, options)
          : null;
        let calculatedNow = false;
        if (!forecast) {
          if (item.contextPending || state.aiForecastDeferredSeries.has(series)) continue;
          const seriesProgressLabel = `${labelName(series)} (${completedCalculations + 1}/${calculationItems.length})`;
          if (reportCalculationProgress) {
            resetAiForecastProgress(`${seriesProgressLabel} 준비`);
            await waitForAiProgressPaint();
            setAiForecastProgress(25, `${seriesProgressLabel} 계산`);
          }
          forecast = await runAiForecast(options);
          completedCalculations += 1;
          if (targetRevisionAtStart !== state.aiForecastTargetRevision) return [];
          calculatedNow = Boolean(forecast);
          if (calculatedNow) {
            state.aiForecastCalculationCounts.set(series, (state.aiForecastCalculationCounts.get(series) || 0) + 1);
          }
          if (forecast && item.inputKey) {
            await forecastCache.set(series, item.inputKey, forecast);
          }
          if (reportCalculationProgress) {
            setAiForecastProgress(85, `${seriesProgressLabel} 차트 생성`);
            await waitForAiProgressPaint();
          }
        }
        if (targetRevisionAtStart !== state.aiForecastTargetRevision) return [];
        if (!forecast) {
          unavailableForecasts.push({
            series,
            available: false,
            reasonCode: "model-training-failed",
            historyDays: historyRows.length,
          });
          continue;
        }
        forecast = await applyAiForecastJournalCalibration(series, forecast, historyRows, options);
        if (targetRevisionAtStart !== state.aiForecastTargetRevision) return [];
        if (calculatedNow && state.aiMarketModelLoadSettled && /^\d{6}\.(KS|KQ)$/.test(series)) {
          queueAiForecastJournalSync(series, forecast, historyRows);
        }
        forecastCount += 1;
        const consensusUsed = Number(forecast.signals?.consensusConfidence) > 0;
        const fundamentalsUsed = Number(forecast.signals?.fundamentalsConfidence) > 0;
        const backtestSamples = Number(forecast.backtest?.samples) || 0;
        const backtestAccuracy = Number(forecast.backtest?.directionAccuracy);
        const marketWeight = Number(forecast.marketRelationship?.weight) || 0;
        const confidence = Number(forecast.backtest?.confidence) || 0;
        const commonMeta = {
          seriesKey: series,
          historyDays: forecast.historyDays,
          backtestSamples,
          backtestAccuracy: Number.isFinite(backtestAccuracy) ? backtestAccuracy : null,
          backtestConfidence: confidence,
          modelName: String(forecast.model?.name || ""),
        };
        const scenarioTextPositions = {
          upside: "top left",
          sideways: "middle left",
          downside: "bottom left",
        };
        const forecastBasePrice = Number(forecast.prices?.[0]);
        const forecastEndPrice = Number(forecast.prices?.at(-1));
        const expectedReturn = forecastBasePrice > 0 && forecastEndPrice > 0
          ? Math.log(forecastEndPrice / forecastBasePrice)
          : 0;
        const scenarioPresentation = resolveScenarioPresentation(forecast.scenarios, {
          expectedReturn,
          flatBand: forecast.scenarios?.calibration?.flatBand,
        });
        const representativeReport = options.brokerResearch?.representativeReports?.reference
          || null;
        const highestScenarioWeight = Math.max(...Object.values(scenarioPresentation.weights));
        SCENARIO_KEYS.forEach((scenarioKey) => {
          const scenario = forecast.scenarios?.[scenarioKey];
          if (!scenario?.prices?.length || !scenario?.chartValues?.length) return;
          const scenarioWeight = scenarioPresentation.weights[scenarioKey];
          const isRawPrimaryScenario = scenarioKey === scenarioPresentation.rawPrimaryKey;
          const isEmphasizedScenario = scenarioWeight === highestScenarioWeight;
          const isPrimaryScenario = scenarioKey === scenarioPresentation.representativeKey;
          const traceStyle = resolveScenarioTraceStyle(isEmphasizedScenario);
          const scenarioLabel = String(scenario.label || scenario.directionLabel || scenarioKey);
          const scenarioShortLabel = String(scenario.shortLabel || scenarioLabel);
          const endpointText = `${scenarioShortLabel} 가중치 ${scenarioWeight}%`;
          const reportLink = isRawPrimaryScenario
            ? buildRepresentativeReportLink(representativeReport, escapeHtml)
            : "";
          const labels = forecast.dates.map((_, index) => (
            index === forecast.dates.length - 1 ? endpointText : ""
          ));
          traces.push({
            x: forecast.dates,
            y: scenario.chartValues,
            text: labels,
            hovertext: scenario.prices.map((value) => formatActualValue(value)),
            customdata: scenario.prices,
            type: MAIN_LINE_TRACE_TYPE,
            mode: "lines+text",
            name: `${labelName(series)} AI ${scenarioLabel}`,
            showlegend: false,
            connectgaps: false,
            cliponaxis: false,
            hoverinfo: chartSession.hoverShowPopup ? undefined : "skip",
            hovertemplate: chartSession.hoverShowPopup
              ? `<b>${escapeHtml(scenarioLabel)} 가중치 ${scenarioWeight}%</b> · %{hovertext}`
                + `<br>${escapeHtml(scenario.reason)} · 실제 확률 아님${reportLink}<extra></extra>`
              : undefined,
            textposition: scenarioTextPositions[scenarioKey],
            textfont: { color: traceStyle.color, size: isEmphasizedScenario ? 12 : 11 },
            line: { color: traceStyle.color, width: traceStyle.width, dash: "dot", shape: "linear" },
            meta: {
              ...commonMeta,
              isAiForecastTrace: scenarioKey === "sideways",
              isAiForecastScenarioTrace: true,
              aiTraceRole: scenarioKey,
              scenarioProbability: scenario.probability,
              scenarioWeight,
              calibratedProbability: forecast.validation?.calibratedProbability === true,
              validationStatus: String(forecast.validation?.status || "experimental"),
              isPrimaryAiScenario: isPrimaryScenario,
              isRawPrimaryAiScenario: isRawPrimaryScenario,
              isEmphasizedAiScenario: isEmphasizedScenario,
              thickestAiScenarioLineWidth: PRIMARY_SCENARIO_STYLE.width,
              isDecisiveAiScenario: scenarioPresentation.decisive,
              aiScenarioLead: scenarioPresentation.lead,
              aiExpectedDirection: scenarioPresentation.expectedDirection,
              scenarioReason: scenario.reason,
              representativeReport,
              scenarioPatternKey: String(scenario.patternKey || scenarioKey),
              scenarioPathSource: String(scenario.pathSource || ""),
              scenarioPatternAnalogCount: Number(scenario.patternAnalogCount) || 0,
              scenarioPatternSupport: Number(scenario.patternSupport) || 0,
              patternMatches: forecast.patternMatches,
              marketWeight,
              marketSeries: String(forecast.marketRelationship?.series || ""),
              marketDownsideBeta: Number(forecast.marketRelationship?.downsideBeta) || 0,
              marketEnvironment: Number(forecast.marketEnvironment?.combined) || 0,
              forecastMode: String(forecast.signals?.forecastMode || "stock"),
              consensusUsed,
              fundamentalsUsed,
            },
          });
        });
        if (reportCalculationProgress && calculatedNow) {
          const seriesProgressLabel = `${labelName(series)} (${completedCalculations}/${calculationItems.length})`;
          setAiForecastProgress(100, `${seriesProgressLabel} 완료`);
          if (completedCalculations < calculationItems.length) await waitForAiProgressPaint(160);
        }
      }
      state.lastAiForecastTraceCount = forecastCount;
      syncAiForecastToggleButton(forecastCount);
      if (unavailableForecasts.length) showAiForecastUnavailable?.(unavailableForecasts);
      return traces;
    }

    return Object.freeze({ build });
  }

  globalScope.ThinkStockAiForecastTraces = Object.freeze({
    buildRepresentativeReportLink,
    createAiForecastTraces,
    isThickestAiScenarioTrace,
    representativeReportFromForecastClick,
    resolveScenarioTraceStyle,
    withoutStockCode,
  });
}(typeof self !== "undefined" ? self : globalThis));
