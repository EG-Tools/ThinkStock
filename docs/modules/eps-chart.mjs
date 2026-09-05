"use strict";

  const STOCK_TICKER_PATTERN = /^\d{6}\.(?:KS|KQ)$/;
  const NORMALIZED_CENTER = 100;
  const DART_EPS_HISTORY_VERSION = 1;
  const DART_EPS_HISTORY_YEARS = 10;
  const QUARTER_MONTHS = Object.freeze([3, 6, 9, 12]);
  const CORPORATE_ACTION_RATIOS = Object.freeze([2, 3, 4, 5, 10, 20, 50, 100]);
  const CORPORATE_ACTION_MAX_ERROR = 0.04;
  const CORPORATE_ACTION_MIN_IMPROVEMENT = 0.8;
  const epsFingerprintCache = new WeakMap();
  const epsPointCache = new WeakMap();
  const epsBaseTrendCache = new WeakMap();

  /**
   * @typedef {Object} EpsPoint
   * @property {string} ticker
   * @property {string} period
   * @property {string} date
   * @property {"quarter"|"annual"} frequency
   * @property {boolean} estimate
   * @property {number} eps
   * @property {number} [chartEps]
   * @property {number} [annualEps]
   * @property {string} [basis]
   * @property {string} source
   */

  function epsDataFingerprint(analysis) {
    const source = Array.isArray(analysis?.financials) ? analysis.financials : [];
    const cached = epsFingerprintCache.get(source);
    if (cached) return cached;
    const financials = source
      .map((record) => {
        const value = Number(record?.eps);
        return [
          String(record?.ticker || "").toUpperCase(),
          String(record?.period || ""),
          String(record?.frequency || ""),
          Number.isFinite(value) ? value : "",
          record?.estimate === true ? 1 : 0,
          String(record?.source || ""),
        ].join(":");
      })
      .sort();
    const fingerprint = financials.join("|");
    epsFingerprintCache.set(source, fingerprint);
    return fingerprint;
  }

  function epsSeriesKey(ticker) {
    return `eps:${String(ticker || "").trim().toUpperCase()}`;
  }

  function completedFinancialYearRange(asOf = new Date().toISOString().slice(0, 10)) {
    const date = String(asOf || "").slice(0, 10);
    const currentYear = Number(date.slice(0, 4));
    const endYear = currentYear - (date.slice(5) >= "04-01" ? 1 : 2);
    const startYear = Math.max(2015, endYear - DART_EPS_HISTORY_YEARS + 1);
    return Number.isInteger(endYear) && endYear >= 2015
      ? { startYear, endYear }
      : { startYear: 0, endYear: 0 };
  }

  function createEpsDataController(scope = globalThis, options = {}) {
    const attemptedTickers = new Set();
    const tickerPattern = options.tickerPattern || STOCK_TICKER_PATTERN;
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    let refreshTimer = 0;
    let lastPrepareResult = Object.freeze({ changedCount: 0, loadedCount: 0, tickers: [] });

    const currentRange = () => completedFinancialYearRange(options.today?.());
    const hasHistoryCoverage = (analysis) => options.hasHistoryCoverage?.(
      analysis,
      currentRange(),
      DART_EPS_HISTORY_VERSION,
    ) === true;
    const normalizeTickers = (values) => [...new Set((Array.isArray(values) ? values : [])
      .map((ticker) => String(ticker || "").trim().toUpperCase())
      .filter((ticker) => tickerPattern.test(ticker) && !options.isHidden?.(ticker)))];

    async function loadHistory(ticker, requestOptions = {}) {
      const target = String(ticker || "").trim().toUpperCase();
      if (!tickerPattern.test(target) || !options.canUseGateway?.()) {
        return options.getAnalysis?.(target) || null;
      }
      let analysis = options.getAnalysis?.(target) || await options.readAnalysis?.(target) || null;
      if (analysis) options.setAnalysis?.(target, analysis);
      attemptedTickers.add(target);
      if (requestOptions.forceHistory !== true && hasHistoryCoverage(analysis)) return analysis;

      const corpCode = String(await options.resolveCorpCode?.(target) || "");
      if (!/^\d{8}$/.test(corpCode)) return analysis;
      const range = currentRange();
      const completed = new Set((Array.isArray(analysis?.dartEpsCompletedYears)
        ? analysis.dartEpsCompletedYears : []).map(Number));
      const missingYears = [];
      for (let year = range.startYear; year <= range.endYear; year += 1) {
        if (!completed.has(year)) missingYears.push(year);
      }
      if (!missingYears.length) return analysis;

      const progressKey = `eps:${target}`;
      const label = `${options.labelName?.(target) || target} EPS`;
      return options.runRequest(target, async (signal) => {
        let completedCount = 0;
        let requestError = null;
        const records = [];
        options.setPending?.(target, true);
        options.progress?.begin(progressKey, label);
        options.sync?.();
        try {
          for (const year of missingYears) {
            const payload = await options.fetchYear({ ticker: target, corpCode, year }, {
              forceNetwork: requestOptions.forceNetwork === true && year === range.endYear,
              signal,
              timeoutMs: 45000,
            });
            options.throwIfAborted?.(signal);
            completed.add(year);
            completedCount += 1;
            records.push(...(Array.isArray(payload?.records) ? payload.records : []));
            options.progress?.update(
              progressKey,
              completedCount / missingYears.length,
              `${label} ${year}`,
            );
          }
        } catch (error) {
          requestError = error;
          if (!options.isAbortError?.(error)) options.onError?.(`eps-history:${target}`, error);
        }
        try {
          if (completedCount) {
            const next = options.normalizeAnalysis?.(target, {
              savedAt: Date.now(),
              financials: records,
              dartEpsHistoryVersion: DART_EPS_HISTORY_VERSION,
              dartEpsCompletedYears: [...completed],
              dartEpsHistoryStartYear: range.startYear,
              dartEpsHistoryEndYear: range.endYear,
            }, analysis);
            if (next) {
              analysis = next;
              options.setAnalysis?.(target, analysis);
              await options.saveAnalysis?.(target, analysis);
            }
          }
        } catch (error) {
          requestError ||= error;
          options.onError?.(`eps-history-save:${target}`, error);
        } finally {
          if (requestError) options.progress?.cancel(progressKey);
          else options.progress?.complete(progressKey, label);
          options.setPending?.(target, false);
          options.sync?.();
        }
        return analysis;
      }, requestOptions);
    }

    async function prepare(requestOptions = {}) {
      if (!options.isEnabled?.()) {
        lastPrepareResult = Object.freeze({ changedCount: 0, loadedCount: 0, tickers: [] });
        return 0;
      }
      const tickers = normalizeTickers(requestOptions.tickers || options.getVisibleTickers?.());
      if (!tickers.length) {
        lastPrepareResult = Object.freeze({ changedCount: 0, loadedCount: 0, tickers: [] });
        return 0;
      }
      options.sync?.();
      let changedCount = 0;
      await options.mapWithConcurrency(tickers, 2, async (ticker) => {
        const before = epsDataFingerprint(options.getAnalysis?.(ticker));
        const forceCurrent = requestOptions.forceNetwork === true
          || options.consumeForcedCurrent?.(ticker) === true;
        await options.ensureCurrent?.(ticker, {
          ...requestOptions,
          forceNetwork: forceCurrent,
          requireEps: true,
        });
        await loadHistory(ticker, requestOptions);
        const after = epsDataFingerprint(options.getAnalysis?.(ticker));
        if (after !== before) changedCount += 1;
        return options.getAnalysis?.(ticker) || null;
      });
      options.sync?.();
      const loadedCount = tickers.filter((ticker) => options.hasEps?.(options.getAnalysis?.(ticker))).length;
      lastPrepareResult = Object.freeze({ changedCount, loadedCount, tickers: [...tickers] });
      options.onPrepared?.(loadedCount, requestOptions, lastPrepareResult);
      return loadedCount;
    }

    function schedule() {
      if (!options.isEnabled?.() || refreshTimer || !setTimer) return false;
      const pending = normalizeTickers(options.getVisibleTickers?.()).filter((ticker) => (
        (options.needsCurrent?.(ticker) || !hasHistoryCoverage(options.getAnalysis?.(ticker)))
        && !attemptedTickers.has(ticker)
        && !options.isPending?.(ticker)
      ));
      if (!pending.length) return false;
      refreshTimer = setTimer(() => {
        refreshTimer = 0;
        prepare({ tickers: pending }).catch((error) => {
          options.onError?.("eps-data-load", error);
          options.sync?.();
        });
      }, 0);
      return true;
    }

    function reset() {
      if (refreshTimer && clearTimer) clearTimer(refreshTimer);
      refreshTimer = 0;
      attemptedTickers.clear();
      options.progress?.cancel();
    }

    return Object.freeze({
      hasHistoryCoverage,
      lastPrepareResult: () => lastPrepareResult,
      loadHistory,
      prepare,
      reset,
      schedule,
    });
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function periodEndDate(period) {
    const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return "";
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return "";
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }

  function epsDisplayDate(value) {
    const match = String(value || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[1]}.${Number(match[2])}.${Number(match[3])}` : "";
  }

  function normalizeRecord(value, ticker) {
    const target = String(value?.ticker || ticker || "").trim().toUpperCase();
    const period = String(value?.period || "").slice(0, 7);
    const frequency = ["quarter", "annual"].includes(value?.frequency) ? value.frequency : "";
    const eps = finiteOrNull(value?.eps);
    if (!STOCK_TICKER_PATTERN.test(target)
      || !/^\d{4}-\d{2}$/.test(period)
      || !frequency
      || eps === null) return null;
    const date = periodEndDate(period);
    return date ? {
      ticker: target,
      period,
      date,
      frequency,
      estimate: value?.estimate === true,
      eps,
      source: String(value?.source || ""),
    } : null;
  }

  function preferEpsRecord(current, candidate) {
    if (!current) return candidate;
    if (current.estimate !== candidate.estimate) {
      return current.estimate ? candidate : current;
    }
    const currentIsDart = current.source.toUpperCase() === "DART";
    const candidateIsDart = candidate.source.toUpperCase() === "DART";
    if (currentIsDart !== candidateIsDart) return candidateIsDart ? candidate : current;
    return candidate;
  }

  function epsCorporateActionFactor(date, actions) {
    return (Array.isArray(actions) ? actions : [])
      .filter((action) => String(date || "") < action.boundaryDate)
      .reduce((product, action) => product * action.factor, 1);
  }

  function latestQuarterlySeasonality(merged, targetYear, actions) {
    const years = [...new Set([...merged.values()]
      .map((point) => Number(String(point?.period || "").slice(0, 4)))
      .filter((year) => Number.isInteger(year) && year < targetYear))]
      .sort((left, right) => right - left);
    for (const year of years) {
      const points = QUARTER_MONTHS.map((month) => (
        merged.get(periodEndDate(`${year}-${String(month).padStart(2, "0")}`))
      ));
      if (points.some((point) => point?.basis !== "quarter" || !Number.isFinite(point.eps))) continue;
      const values = points.map((point) => (
        point.eps * epsCorporateActionFactor(point.date, actions)
      ));
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        sourceYear: year,
        deviations: values.map((value) => value - mean),
      };
    }
    return null;
  }

  function seasonalAnnualForecastValues(record, existing, missingMonths, merged, actions) {
    if (record?.estimate !== true || !missingMonths.length) return null;
    const hasQuarterlyForecast = existing.some((point) => point.estimate === true);
    if (hasQuarterlyForecast) return null;
    const year = Number(String(record.period || "").slice(0, 4));
    const seasonality = latestQuarterlySeasonality(merged, year, actions);
    if (!seasonality) return null;
    const recordedTotal = existing.reduce((sum, point) => sum + Number(point.eps), 0);
    const missingDeviations = missingMonths.map((month) => (
      seasonality.deviations[QUARTER_MONTHS.indexOf(month)]
    ));
    const baseline = (
      Number(record.eps)
      - recordedTotal
      - missingDeviations.reduce((sum, value) => sum + value, 0)
    ) / missingMonths.length;
    return {
      sourceYear: seasonality.sourceYear,
      values: missingDeviations.map((deviation) => baseline + deviation),
    };
  }

  function epsReconciliationError(value, annualEps, quarters) {
    const scale = Math.max(
      1,
      Math.abs(Number(annualEps) || 0),
      (Array.isArray(quarters) ? quarters : [])
        .reduce((sum, quarter) => sum + Math.abs(Number(quarter) || 0), 0) * 0.25,
    );
    return Math.abs(Number(value) - Number(annualEps)) / scale;
  }

  function detectEpsCorporateActions(records) {
    const values = Array.isArray(records) ? records : [];
    const years = [...new Set(values.map((record) => Number(record?.period?.slice(0, 4)))
      .filter(Number.isInteger))].sort((left, right) => left - right);
    const actions = [];
    years.forEach((year) => {
      const annual = values.find((record) => (
        record.frequency === "annual"
        && record.period === `${year}-12`
        && record.estimate !== true
        && Number.isFinite(record.eps)
      ));
      const quarters = QUARTER_MONTHS.map((month) => values.find((record) => (
        record.frequency === "quarter"
        && record.period === `${year}-${String(month).padStart(2, "0")}`
        && record.estimate !== true
        && Number.isFinite(record.eps)
      ))?.eps);
      if (!annual || quarters.some((value) => !Number.isFinite(value))) return;
      const rawTotal = quarters.reduce((sum, value) => sum + value, 0);
      const rawError = epsReconciliationError(rawTotal, annual.eps, quarters);
      if (rawError <= CORPORATE_ACTION_MAX_ERROR) return;

      let best = null;
      const factors = CORPORATE_ACTION_RATIOS.flatMap((ratio) => [
        { factor: 1 / ratio, ratio, type: "split" },
        { factor: ratio, ratio, type: "consolidation" },
      ]);
      for (let prefixCount = 1; prefixCount <= quarters.length; prefixCount += 1) {
        const prefix = quarters.slice(0, prefixCount).reduce((sum, value) => sum + value, 0);
        const suffix = quarters.slice(prefixCount).reduce((sum, value) => sum + value, 0);
        factors.forEach((candidate) => {
          const adjustedTotal = (prefix * candidate.factor) + suffix;
          const error = epsReconciliationError(adjustedTotal, annual.eps, quarters);
          if (!best || error < best.error) best = { ...candidate, error, prefixCount };
        });
      }
      if (!best
        || best.error > CORPORATE_ACTION_MAX_ERROR
        || best.error > rawError * (1 - CORPORATE_ACTION_MIN_IMPROVEMENT)) return;
      const boundaryDate = best.prefixCount < QUARTER_MONTHS.length
        ? periodEndDate(`${year}-${String(QUARTER_MONTHS[best.prefixCount]).padStart(2, "0")}`)
        : `${year + 1}-01-01`;
      actions.push(Object.freeze({
        boundaryDate,
        factor: best.factor,
        ratio: best.ratio,
        type: best.type,
        sourceYear: year,
      }));
    });
    return actions.sort((left, right) => left.boundaryDate.localeCompare(right.boundaryDate));
  }

  function applyEpsCorporateActions(points, actions) {
    if (!Array.isArray(points) || !Array.isArray(actions) || !actions.length) return points;
    return points.map((point) => {
      const applied = actions.filter((action) => point.date < action.boundaryDate);
      const factor = epsCorporateActionFactor(point.date, actions);
      if (Math.abs(factor - 1) < 1e-9) return point;
      return {
        ...point,
        reportedEps: point.eps,
        eps: point.eps * factor,
        chartEps: point.chartEps * factor,
        ...(Number.isFinite(point.annualEps) ? {
          reportedAnnualEps: point.annualEps,
          annualEps: point.annualEps * factor,
        } : {}),
        corporateActionAdjusted: true,
        epsAdjustmentFactor: factor,
        corporateActionRatios: applied.map((action) => action.ratio),
      };
    });
  }

  /** @returns {EpsPoint[]} */
  function selectEpsPoints(financials, ticker) {
    const source = Array.isArray(financials) ? financials : [];
    const target = String(ticker || "").trim().toUpperCase();
    const cached = epsPointCache.get(source);
    if (cached?.ticker === target) return cached.points;
    const records = source
      .map((record) => normalizeRecord(record, ticker))
      .filter(Boolean)
      .sort((left, right) => (
        left.period.localeCompare(right.period) || left.frequency.localeCompare(right.frequency)
      ));
    const uniqueByFrequencyAndPeriod = new Map();
    records.forEach((record) => {
      const key = `${record.frequency}:${record.period}`;
      uniqueByFrequencyAndPeriod.set(
        key,
        preferEpsRecord(uniqueByFrequencyAndPeriod.get(key), record),
      );
    });
    const selectedRecords = [...uniqueByFrequencyAndPeriod.values()];
    const corporateActions = detectEpsCorporateActions(selectedRecords);
    const annual = selectedRecords
      .filter((record) => record.frequency === "annual");
    const quarterly = selectedRecords
      .filter((record) => record.frequency === "quarter")
      .map((record) => ({
        ...record,
        chartEps: record.eps,
        basis: "quarter",
      }));
    const merged = new Map(quarterly.map((record) => [record.date, record]));
    annual.forEach((record) => {
      const year = Number(record.period.slice(0, 4));
      if (!Number.isInteger(year)) return;
      const existing = QUARTER_MONTHS.flatMap((month) => {
        const period = `${year}-${String(month).padStart(2, "0")}`;
        const date = periodEndDate(period);
        const point = merged.get(date);
        return point ? [point] : [];
      });
      const missingMonths = QUARTER_MONTHS.filter((month) => {
        const period = `${year}-${String(month).padStart(2, "0")}`;
        return !merged.has(periodEndDate(period));
      });
      if (!missingMonths.length) return;
      const recordedTotal = existing.reduce((sum, point) => sum + Number(point.eps), 0);
      const allocatedEps = (record.eps - recordedTotal) / missingMonths.length;
      const seasonalFallback = seasonalAnnualForecastValues(
        record,
        existing,
        missingMonths,
        merged,
        corporateActions,
      );
      missingMonths.forEach((month, index) => {
        const period = `${year}-${String(month).padStart(2, "0")}`;
        const date = periodEndDate(period);
        const chartEps = seasonalFallback?.values?.[index] ?? allocatedEps;
        merged.set(date, {
          ...record,
          period,
          date,
          frequency: "quarter",
          eps: chartEps,
          chartEps,
          annualEps: record.eps,
          ...(seasonalFallback ? { seasonalitySourceYear: seasonalFallback.sourceYear } : {}),
          basis: seasonalFallback
            ? "annual-seasonal-fallback"
            : "annual-quarterly-fallback",
        });
      });
    });
    const points = applyEpsCorporateActions(
      [...merged.values()].sort((left, right) => left.date.localeCompare(right.date)),
      corporateActions,
    );
    epsPointCache.set(source, { ticker: target, points });
    return points;
  }

  function normalizeEpsTrend(points) {
    const values = (Array.isArray(points) ? points : []).map((point) => finiteOrNull(point?.chartEps));
    const first = values.find((value) => value !== null);
    if (first === undefined) return [];
    const absoluteValues = values
      .filter((value) => value !== null)
      .map((value) => Math.abs(value))
      .sort((left, right) => left - right);
    const median = absoluteValues.length
      ? (absoluteValues[Math.floor((absoluteValues.length - 1) / 2)]
        + absoluteValues[Math.ceil((absoluteValues.length - 1) / 2)]) / 2
      : 0;
    const maximum = absoluteValues.at(-1) || 0;
    // Keep a linear relationship without letting a near-zero first quarter explode the viewport.
    const scale = Math.max(1, Math.abs(first), median * 0.5, maximum / 4);
    return values.map((value) => {
      if (value === null) return null;
      return NORMALIZED_CENTER + (((value - first) / scale) * 100);
    });
  }

  function anchorEpsTrendToStock(epsValues, stockValues) {
    const eps = (Array.isArray(epsValues) ? epsValues : []).filter(Number.isFinite);
    const stock = (Array.isArray(stockValues) ? stockValues : [])
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    if (!eps.length || !stock.length) return Array.isArray(epsValues) ? [...epsValues] : [];
    const quantile = (ratio) => stock[Math.min(stock.length - 1, Math.floor((stock.length - 1) * ratio))];
    const offset = quantile(0.5) - eps[0];
    return epsValues.map((value) => Number.isFinite(value) ? value + offset : null);
  }

  function cachedAnchoredEpsTrend(financials, points, stockValues) {
    if (!Array.isArray(financials) || !Array.isArray(stockValues)) {
      return anchorEpsTrendToStock(normalizeEpsTrend(points), stockValues);
    }
    const cached = epsBaseTrendCache.get(financials);
    if (cached?.points === points) return cached.base;
    const base = anchorEpsTrendToStock(normalizeEpsTrend(points), stockValues);
    // Viewport and visibility changes rebuild the stock model. Keep the EPS
    // anchor stable until its financial source changes instead of vertically
    // shifting the line whenever that transient model receives a new array.
    epsBaseTrendCache.set(financials, { points, base });
    return base;
  }

  /** @param {EpsPoint} point */
  function epsPointText(point) {
    const format = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
    const estimate = point.estimate ? " 전망" : "";
    const adjusted = point.corporateActionAdjusted ? " · 분할환산" : "";
    const year = String(point.period || "").slice(0, 4);
    if (point.frequency === "quarter") {
      const month = Number(String(point.period || "").slice(5, 7));
      const quarter = Number.isInteger(month) && month >= 3 && month <= 12
        ? Math.ceil(month / 3)
        : "";
      if (point.basis === "annual-seasonal-fallback") {
        return `${year}년 ${quarter}분기${estimate} 계절환산 EPS ${format.format(point.eps)}`
          + ` · 연간 ${format.format(point.annualEps)}${adjusted}`;
      }
      if (point.basis === "annual-quarterly-fallback") {
        return `${year}년 ${quarter}분기${estimate} 환산 EPS ${format.format(point.eps)}`
          + ` · 연간 ${format.format(point.annualEps)}${adjusted}`;
      }
      return `${year}년 ${quarter}분기${estimate} EPS ${format.format(point.eps)}${adjusted}`;
    }
    return `${year}년 연간${estimate} EPS ${format.format(point.eps)}${adjusted}`;
  }

  /**
   * @returns {{traces: Object[], baseValuesBySeries: Object<string, number[]>}}
   */
  function buildEpsTraceModel(options = {}) {
    const analysesByTicker = options.analysesByTicker instanceof Map
      ? options.analysesByTicker
      : new Map(Object.entries(options.analysesByTicker || {}));
    const hiddenSeries = options.hiddenSeries instanceof Set
      ? options.hiddenSeries
      : new Set(options.hiddenSeries || []);
    const seriesColor = typeof options.seriesColor === "function"
      ? options.seriesColor
      : () => "#d4d4d4";
    const labelName = typeof options.labelName === "function"
      ? options.labelName
      : (ticker) => ticker;
    const transformValues = typeof options.transformValues === "function"
      ? options.transformValues
      : (values) => values;
    const seriesScales = options.seriesScales || {};
    const seriesOffsets = options.seriesOffsets || {};
    const traces = [];
    const baseValuesBySeries = {};
    (Array.isArray(options.seriesModels) ? options.seriesModels : []).forEach((model) => {
      const ticker = String(model?.series || "").trim().toUpperCase();
      if (!STOCK_TICKER_PATTERN.test(ticker) || hiddenSeries.has(ticker)) return;
      const financials = analysesByTicker.get(ticker)?.financials;
      const points = selectEpsPoints(financials, ticker);
      if (!points.length) return;
      const base = cachedAnchoredEpsTrend(financials, points, model?.values);
      const handleSeriesKey = epsSeriesKey(ticker);
      const scale = Number.isFinite(Number(seriesScales[handleSeriesKey]))
        ? Number(seriesScales[handleSeriesKey]) : 1;
      const offset = Number.isFinite(Number(seriesOffsets[handleSeriesKey]))
        ? Number(seriesOffsets[handleSeriesKey]) : 0;
      const y = transformValues(
        base,
        scale,
        offset,
      );
      const color = seriesColor(ticker);
      const text = points.map(epsPointText);
      const pointRevision = points.map((point) => (
        `${point.period}:${point.frequency}:${point.eps}:${point.estimate ? 1 : 0}`
      )).join(",");
      const baseRevision = base.map((value) => (
        Number.isFinite(value) ? Number(value).toFixed(6) : ""
      )).join(",");
      baseValuesBySeries[handleSeriesKey] = base;
      traces.push({
        x: points.map((point) => point.date),
        y,
        text,
        customdata: points.map((point) => [epsDisplayDate(point.date)]),
        type: String(options.lineTraceType || "scatter"),
        mode: points.length > 1 ? "lines+markers" : "markers",
        name: "EPS",
        connectgaps: false,
        showlegend: false,
        meta: {
          overlayKind: "eps",
          seriesKey: handleSeriesKey,
          renderRevision: 4,
          renderFingerprint: `eps:${ticker}:${pointRevision}:${baseRevision}:${scale}:${offset}:${color}:${options.hoverShowPopup ? 1 : 0}`,
          handleLabel: `${labelName(ticker)} EPS`,
          baseLineWidth: 1,
          sourcePointCount: points.length,
        },
        line: { color, width: 1, dash: "dot", shape: "linear" },
        marker: {
          color: points.map((point) => point.frequency === "quarter" ? "#000000" : color),
          line: { color, width: 1 },
          size: points.map((point) => point.frequency === "quarter" ? 12 : 0),
          symbol: points.map(() => "circle"),
        },
        // The invisible grouped trace owns every popup. A second native EPS
        // popup caused historical and forecast points to use different spacing.
        hoverinfo: "skip",
        hovertemplate: undefined,
      });
    });
    return { traces, baseValuesBySeries };
  }

  const epsChart = Object.freeze({
    DART_EPS_HISTORY_VERSION,
    buildEpsTraceModel,
    applyEpsCorporateActions,
    anchorEpsTrendToStock,
    completedFinancialYearRange,
    createEpsDataController,
    epsDataFingerprint,
    epsDisplayDate,
    detectEpsCorporateActions,
    normalizeEpsTrend,
    periodEndDate,
    selectEpsPoints,
  });

export { epsChart };
