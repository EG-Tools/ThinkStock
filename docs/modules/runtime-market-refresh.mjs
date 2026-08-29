"use strict";

  /**
   * @typedef {{date: string, close: number}} RuntimeTickerPoint
   * @typedef {{records?: Array<Record<string, unknown>>}|null} RuntimePricePayload
   * @typedef {{forceNetwork?: boolean, signal?: AbortSignal|null, payload?: object|null}} RuntimeRequestOptions
   */

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const STOCK_TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;

  /**
   * @param {RuntimePricePayload} payload
   * @param {string[]} tickers
   * @param {(value: unknown) => number} [toNumber]
   * @returns {Record<string, string>}
   */
  function latestDatesByTicker(payload, tickers, toNumber = Number) {
    const latest = Object.fromEntries((tickers || []).map((ticker) => [ticker, ""]));
    (payload?.records || []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      if (!DATE_PATTERN.test(date)) return;
      Object.keys(latest).forEach((ticker) => {
        const value = toNumber(row?.[ticker]);
        if (!Number.isFinite(value)) return;
        if (!latest[ticker] || date > latest[ticker]) latest[ticker] = date;
      });
    });
    return latest;
  }

  /** @returns {RuntimeTickerPoint[]} */
  function normalizeTickerPoints(records, ticker, toNumber = Number) {
    const byDate = new Map();
    (Array.isArray(records) ? records : []).forEach((row) => {
      if (row?.ticker !== ticker) return;
      const date = String(row?.date || "").slice(0, 10);
      const close = toNumber(row?.close);
      if (!DATE_PATTERN.test(date) || !Number.isFinite(close) || close <= 0) return;
      byDate.set(date, { date, close });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function normalizeStockTickers(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map((ticker) => String(ticker || "").trim().toUpperCase())
      .filter((ticker) => STOCK_TICKER_PATTERN.test(ticker)))];
  }

  function createRuntimeBootstrapService(options = {}) {
    function visibleTickers() {
      return normalizeStockTickers((options.getCustomStocks?.() || [])
        .filter((item) => !options.isHidden?.(String(item?.ticker || "").trim().toUpperCase()))
        .map((item) => item?.ticker));
    }

    /** @param {RuntimeRequestOptions} [requestOptions] */
    async function fetchCritical(requestOptions = {}) {
      if (!options.canUseGateway?.()) return null;
      const latestIndices = options.latestDatesByTicker?.(
        options.getPricePayload?.(),
        ["^KS11", "^KQ11"],
        options.toNumber,
      ) || {};
      try {
        return await options.gatewayClient.fetchBootstrap({
          tickers: visibleTickers(),
          since: Object.values(latestIndices).filter(Boolean).sort()[0] || "",
          forceNetwork: Boolean(requestOptions.forceNetwork),
          signal: requestOptions.signal || null,
          timeoutMs: options.timeoutMs,
        });
      } catch (error) {
        if (options.isAbortError?.(error) || requestOptions.signal?.aborted) throw error;
        return null;
      }
    }

    /**
     * @param {string[]} tickers
     * @param {RuntimeRequestOptions} [requestOptions]
     * @returns {Promise<Map<string, RuntimeTickerPoint[]>>}
     */
    async function fetchLatestPriceSeriesBatch(tickers, requestOptions = {}) {
      const keys = normalizeStockTickers(tickers);
      const pointsByTicker = new Map(keys.map((ticker) => [ticker, []]));
      if (!keys.length || !options.canUseGateway?.()) return pointsByTicker;

      let payloads = [];
      if (requestOptions.payload?.ok === true) {
        payloads = [requestOptions.payload];
      } else {
        const chunks = [];
        for (let index = 0; index < keys.length; index += 10) chunks.push(keys.slice(index, index + 10));
        payloads = await options.mapWithConcurrency(chunks, 2, (chunk) => (
          options.gatewayClient.fetchPrices(chunk, {
            forceNetwork: Boolean(requestOptions.forceNetwork),
            signal: requestOptions.signal || null,
            timeoutMs: options.timeoutMs,
          })
        ));
      }

      payloads.flatMap((payload) => payload.results || []).forEach((result) => {
        const key = String(result?.ticker || "").trim().toUpperCase();
        if (!pointsByTicker.has(key)) return;
        if (result?.ok !== true) {
          const previous = options.getTickerStatus?.(key) || {};
          options.setTickerStatus?.(key, {
            ...previous,
            source: previous.source || "LOCAL_CACHE",
            localCache: true,
            cached: true,
            stale: true,
            warning: result?.error || "Latest price refresh failed",
          });
          return;
        }
        options.setTickerStatus?.(key, {
          source: result.source,
          latestDate: result.latestDate,
          marketDate: result.marketDate,
          expectedDate: result.expectedDate,
          cached: result.cached,
          stale: result.stale,
          crossCheck: result.crossCheck,
          warning: result.warning,
        });
        pointsByTicker.set(key, (Array.isArray(result.records) ? result.records : [])
          .map((point) => ({
            date: String(point?.date || "").slice(0, 10),
            close: options.toNumber?.(point?.close),
          }))
          .filter((point) => DATE_PATTERN.test(point.date)
            && point.close !== null
            && point.close !== undefined
            && Number.isFinite(point.close)
            && point.close > 0));
      });
      return pointsByTicker;
    }

    return Object.freeze({ fetchCritical, fetchLatestPriceSeriesBatch, visibleTickers });
  }

  function createRuntimeIndexRefreshService(options = {}) {
    const tickers = Object.freeze(["^KS11", "^KQ11"]);
    const gatewayClient = options.gatewayClient;
    if (!gatewayClient?.fetchIndices || typeof options.getPricePayload !== "function") {
      throw new Error("runtime index refresh dependencies are incomplete");
    }

    async function readLocalHealth(signal) {
      if (!options.isLocalRuntime || typeof options.fetchWithTimeout !== "function") return null;
      try {
        const response = await options.fetchWithTimeout(options.healthEndpoint || "./api/health", {
          cache: "no-store",
          signal,
        }, options.timeoutMs);
        return response.ok ? response.json().catch(() => null) : null;
      } catch (error) {
        if (options.isAbortError?.(error) || signal?.aborted) throw error;
        return null;
      }
    }

    async function refresh(requestOptions = {}) {
      const signal = requestOptions.signal || null;
      options.throwIfAborted?.(signal);
      const applied = [];
      const warnings = [];
      if (!options.isLocalRuntime && !options.canUseGateway?.()) return { applied, warnings };
      const beforeLatest = latestDatesByTicker(options.getPricePayload(), tickers, options.toNumber);

      try {
        const health = await readLocalHealth(signal);
        const expectedAppVersion = String(options.appVersion || "").trim();
        const localServerVersion = String(health?.appVersion || "").trim();
        const versionMismatch = Boolean(
          expectedAppVersion
          && localServerVersion
          && expectedAppVersion !== localServerVersion,
        );
        if (health?.restartRequired === true || versionMismatch) {
          warnings.push("로컬 서버 업데이트 감지 · ThinkStock 로컬서버를 다시 실행해 주세요.");
        }
        const payload = requestOptions.payload || await gatewayClient.fetchIndices({
          signal,
          forceNetwork: requestOptions.forceNetwork,
          since: Object.values(beforeLatest).filter(Boolean).sort()[0] || "",
          timeoutMs: options.timeoutMs,
        });
        if (payload?.ok !== true) throw new Error(payload?.error || "KRX index response is invalid");
        const records = Array.isArray(payload.records) ? payload.records : [];
        const referenceDates = [...new Set(records.flatMap((row) => (
          tickers.includes(String(row?.ticker || "")) && DATE_PATTERN.test(String(row?.date || "").slice(0, 10))
            ? [String(row.date).slice(0, 10)]
            : []
        )))].sort();
        tickers.forEach((ticker) => {
          const points = normalizeTickerPoints(records, ticker, options.toNumber);
          if (!points.length) {
            warnings.push(`${options.labelName?.(ticker) || ticker} 갱신 오류: KRX index data is empty`);
            return;
          }
          try {
            options.validateTickerPoints?.(ticker, points, { referenceDates });
            options.mergeTickerSeries(ticker, points);
          } catch (error) {
            warnings.push(`${options.labelName?.(ticker) || ticker}은 이전 값 유지: ${error?.message || error}`);
            return;
          }
          const latestDate = points.at(-1).date;
          if (latestDate !== beforeLatest[ticker]) {
            applied.push(`${options.labelName?.(ticker) || ticker} 반영(${latestDate})`);
          }
        });
        if (payload.warning) warnings.push(String(payload.warning));
      } catch (error) {
        if (options.isAbortError?.(error) || signal?.aborted) throw error;
        if (options.isRetryableError?.(error)) throw error;
        warnings.push(`KRX 지수 갱신 오류: ${error?.message || error}`);
      }
      return { applied, warnings };
    }

    return Object.freeze({ refresh });
  }

  function componentResult(result = {}, error = null) {
    if (error) {
      return Object.freeze({
        ok: false,
        error: String(error?.message || error || "refresh failed").slice(0, 300),
        latestDate: "",
        updated: 0,
      });
    }
    return Object.freeze({
      ok: true,
      latestDate: String(result?.latestDate || "").slice(0, 10),
      updated: Math.max(0, Number(result?.updated) || 0),
      isEmpty: !String(result?.latestDate || "").slice(0, 10),
    });
  }

  function createRuntimeMarketRefresh(options = {}) {
    const gateway = options.gateway;
    const getSeriesController = options.getSeriesController;
    if (!gateway || typeof getSeriesController !== "function") {
      throw new Error("runtime market refresh dependencies are incomplete");
    }
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 12000);
    const creditKeys = Object.freeze([...(options.creditKeys || [])]);
    const vkospiSeries = Object.freeze([...(options.vkospiSeries || ["vkospi"])]);
    const vixSeries = Object.freeze([...(options.vixSeries || ["vix"])]);
    const canFetchProtected = () => options.isLocal === true || options.canUseGateway?.() === true;
    const policiesFor = (keys) => options.policiesFor?.(keys) || {};

    function applyVolatilityRows(liveRows, key, label, seriesKeys, validation = {}) {
      return getSeriesController().applyAuxiliarySeriesRows(liveRows, key, label, {
        gapPolicies: policiesFor(seriesKeys),
        gapLookbackDays: 45,
        ...validation,
      });
    }

    function applyVkospiRows(liveRows) {
      const referenceDates = (options.getPricePayload?.()?.records || []).flatMap((row) => (
        Number.isFinite(Number(row?.["^KS11"])) ? [String(row.date || "").slice(0, 10)] : []
      ));
      return applyVolatilityRows(liveRows, "vkospi", "VKOSPI", vkospiSeries, { referenceDates });
    }

    function applyVixRows(liveRows) {
      return applyVolatilityRows(liveRows, "vix", "VIX", vixSeries);
    }

    async function refreshMacro(signal = null, forceNetwork = false) {
      if (!canFetchProtected()) return { applied: [], warnings: [], components: {} };
      const payload = await gateway.fetchMacro({ signal, forceNetwork, timeoutMs });
      const controller = getSeriesController();
      const applied = [];
      const warnings = [
        ...(payload.warning ? [payload.warning] : []),
        ...(Array.isArray(payload.componentWarnings) ? payload.componentWarnings : []),
      ];
      const latestDates = [];
      const failures = [];
      const components = {};
      let attempted = 0;
      let accepted = 0;

      const applyComponent = (component, rows, build, keys, label, displayLabel, validation = {}) => {
        if (!Array.isArray(rows) || !rows.length) return;
        attempted += 1;
        try {
          const result = controller.commitMacroBuild(build(rows), keys, { label, validation });
          accepted += 1;
          components[component] = componentResult(result);
          if (result.latestDate) latestDates.push(result.latestDate);
          if (result.updated) applied.push(`${displayLabel} ${result.updated}건 반영(~ ${result.latestDate})`);
        } catch (error) {
          failures.push(error);
          components[component] = componentResult(null, error);
          warnings.push(`${displayLabel}은 이전 값 유지: ${error.message}`);
        }
      };

      applyComponent("macro:leading", payload.leadingRows,
        (rows) => controller.buildLeadingCycleLiveRows(rows), ["leading_cycle"],
        "leading cycle", "선행순환변동", {
          allowLatestRegressionKeys: ["leading_cycle"],
          allowCountDecreaseKeys: ["leading_cycle"],
        });
      applyComponent("macro:news", payload.newsRows,
        (rows) => controller.buildNewsSentimentLiveRows(rows), ["news_sentiment"],
        "news sentiment", "뉴스심리");
      applyComponent("macro:policyRate", payload.policyRateRows,
        (rows) => controller.buildMacroIndicatorLiveRows(rows, ["policy_rate"]), ["policy_rate"],
        "policy rate", "기준금리");
      applyComponent("macro:trade:export", payload.tradeRows,
        (rows) => controller.buildMacroIndicatorLiveRows(rows, ["export_value"]), ["export_value"],
        "exports", "수출");
      applyComponent("macro:trade:import", payload.tradeRows,
        (rows) => controller.buildMacroIndicatorLiveRows(rows, ["import_value"]), ["import_value"],
        "imports", "수입");

      if (attempted > 0 && accepted === 0 && failures.length) throw failures[0];
      return {
        applied,
        warnings,
        components: Object.freeze(components),
        latestDate: latestDates.sort().at(-1) || "",
      };
    }

    async function refreshCredit(signal = null, forceNetwork = false) {
      if (!canFetchProtected()) return { applied: [], warnings: [], components: {} };
      const payload = await gateway.fetchCredit({ signal, forceNetwork, timeoutMs });
      const controller = getSeriesController();
      const scaledRows = controller.scaleCreditRowsToExisting(
        payload.rows,
        options.getCreditRows?.() || [],
      );
      const labels = {
        customer_deposit: "고객예탁금",
        kospi_credit: "코스피 신용",
        kosdaq_credit: "코스닥 신용",
      };
      const warnings = [
        ...(payload.warning ? [payload.warning] : []),
        ...(Array.isArray(payload.componentWarnings) ? payload.componentWarnings : []),
      ];
      const latestDates = [];
      const failures = [];
      const components = {};
      let updated = 0;
      let accepted = 0;
      for (const key of creditKeys) {
        try {
          const result = controller.applyCreditLiveRows(scaledRows, [key], labels[key]);
          accepted += 1;
          updated += result.updated;
          components[`credit:${key}`] = componentResult(result);
          if (result.latestDate) latestDates.push(result.latestDate);
        } catch (error) {
          failures.push(error);
          components[`credit:${key}`] = componentResult(null, error);
          warnings.push(`${labels[key]}은 이전 값 유지: ${error.message}`);
        }
      }
      if (!accepted && failures.length) throw failures[0];
      const latestDate = latestDates.sort().at(-1) || "";
      return {
        applied: updated ? [`신용·예탁금 ${updated}건 반영(~ ${latestDate})`] : [],
        warnings,
        components: Object.freeze(components),
        latestDate,
      };
    }

    async function refreshCrisis(signal = null, forceNetwork = false) {
      const payload = await gateway.fetchCrisisSignal({ signal, forceNetwork, timeoutMs });
      const controller = getSeriesController();
      const applied = [];
      const warnings = [
        ...(payload.warning ? [payload.warning] : []),
        ...(Array.isArray(payload.componentWarnings) ? payload.componentWarnings : []),
      ];
      const latestDates = [];
      const failures = [];
      const components = {};
      let accepted = 0;
      const applyComponent = (component, task, displayLabel) => {
        try {
          const result = task();
          accepted += 1;
          components[component] = componentResult(result);
          if (result.latestDate) latestDates.push(result.latestDate);
          if (result.updated) applied.push(`${displayLabel} ${result.updated}건 반영(~ ${result.latestDate})`);
        } catch (error) {
          failures.push(error);
          components[component] = componentResult(null, error);
          warnings.push(`${displayLabel}는 이전 값 유지: ${error.message}`);
        }
      };

      applyComponent("crisis:signal", () => controller.applyCrisisSignalRows(payload.records), "침체 위기신호");
      applyComponent("volatility:vkospi", () => applyVkospiRows(payload.vkospiRows), "VKOSPI");
      applyComponent("volatility:vix", () => applyVixRows(payload.vixRows), "VIX");
      if (!accepted && failures.length) throw failures[0];
      return {
        applied,
        warnings,
        components: Object.freeze(components),
        latestDate: latestDates.sort().at(-1) || "",
      };
    }

    return Object.freeze({
      applyVixRows,
      applyVkospiRows,
      refreshCredit,
      refreshCrisis,
      refreshMacro,
    });
  }

export {
  componentResult,
  createRuntimeBootstrapService,
  createRuntimeIndexRefreshService,
  createRuntimeMarketRefresh,
  latestDatesByTicker,
  normalizeStockTickers,
  normalizeTickerPoints,
};
