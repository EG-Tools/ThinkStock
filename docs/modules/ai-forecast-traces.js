(function initThinkStockAiForecastTraces(globalScope) {
  "use strict";

  const SCENARIO_KEYS = Object.freeze(["upside", "sideways", "downside"]);

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
        const decisionDate = [priceDate, analysisAsOf?.asOf || "", disclosureDate]
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
        const scenarioStyles = {
          upside: { color: "rgba(220, 220, 220, 0.88)", width: 2.1, textposition: "top left" },
          sideways: { color: "rgba(178, 178, 178, 0.78)", width: 1.9, textposition: "middle left" },
          downside: { color: "rgba(142, 142, 142, 0.82)", width: 1.8, textposition: "bottom left" },
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
        SCENARIO_KEYS.forEach((scenarioKey) => {
          const scenario = forecast.scenarios?.[scenarioKey];
          if (!scenario?.prices?.length || !scenario?.chartValues?.length) return;
          const style = scenarioStyles[scenarioKey];
          const scenarioWeight = scenarioPresentation.weights[scenarioKey];
          const isRawPrimaryScenario = scenarioKey === scenarioPresentation.rawPrimaryKey;
          const isPrimaryScenario = scenarioKey === scenarioPresentation.representativeKey;
          const isDecisivePrimary = isPrimaryScenario && scenarioPresentation.decisive;
          const lineColor = isDecisivePrimary
            ? "rgba(248, 248, 248, 0.98)"
            : (isPrimaryScenario ? "rgba(232, 232, 232, 0.9)" : style.color);
          const lineWidth = isDecisivePrimary ? 2.9 : (isPrimaryScenario ? 2.45 : style.width);
          const scenarioLabel = String(scenario.label || scenario.directionLabel || scenarioKey);
          const scenarioShortLabel = String(scenario.shortLabel || scenarioLabel);
          const endpointText = `${scenarioShortLabel} 가중치 ${scenarioWeight}%`;
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
                + `<br>${escapeHtml(scenario.reason)} · 실제 확률 아님<extra></extra>`
              : undefined,
            textposition: style.textposition,
            textfont: { color: lineColor, size: isDecisivePrimary ? 12 : 11 },
            line: { color: lineColor, width: lineWidth, dash: "dot", shape: "linear" },
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
              isDecisiveAiScenario: scenarioPresentation.decisive,
              aiScenarioLead: scenarioPresentation.lead,
              aiExpectedDirection: scenarioPresentation.expectedDirection,
              scenarioReason: scenario.reason,
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
    createAiForecastTraces,
  });
}(typeof self !== "undefined" ? self : globalThis));
