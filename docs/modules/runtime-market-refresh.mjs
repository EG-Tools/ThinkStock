import {
  expectedLatestKoreanTradingDate,
  isKoreanCurrentPriceWindow,
  koreanDateText,
} from "../../shared/market-calendar.mjs";

"use strict";

  /**
   * @typedef {{date: string, close: number, volume?: number}} RuntimeTickerPoint
   * @typedef {{records?: Array<Record<string, unknown>>}|null} RuntimePricePayload
   * @typedef {{forceNetwork?: boolean, signal?: AbortSignal|null, payload?: object|null}} RuntimeRequestOptions
   */

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const STOCK_TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const INDEX_VOLUME_HISTORY_DAYS = 120;

  function dateDaysBefore(value, days) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    const time = Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
    return new Date(time - Math.max(0, Number(days) || 0) * 86400000)
      .toISOString()
      .slice(0, 10);
  }

  function throwIfRequestAborted(signal) {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error("runtime market refresh aborted");
    error.name = "AbortError";
    throw error;
  }

  function isRetryableAdrRefreshError(error) {
    const message = String(error?.message || error || "");
    return error?.retryable === true
      || /\b(?:403|408|425|429|500|502|503|504)\b|failed to fetch|fetch failed|network|timed?\s*out|timeout/i.test(message);
  }

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
      const volume = toNumber(row?.volume);
      byDate.set(date, {
        date,
        close,
        ...(Number.isFinite(volume) && volume > 0 ? { volume } : {}),
      });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function normalizeStockTickers(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map((ticker) => String(ticker || "").trim().toUpperCase())
      .filter((ticker) => STOCK_TICKER_PATTERN.test(ticker)))];
  }

  /**
   * Selects only price series whose latest saved point can be stale now.
   * During the live market window the active series is checked once per app
   * activation even when today's point already exists because its value can move.
   */
  function planKoreanPriceRefresh(options = {}) {
    const tickers = [...new Set((Array.isArray(options.tickers) ? options.tickers : [])
      .map((ticker) => String(ticker || "").trim().toUpperCase())
      .filter(Boolean))];
    const latestDates = options.latestDates || {};
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const live = isKoreanCurrentPriceWindow(now, { closeHour: 16 });
    const targetDate = live
      ? koreanDateText(now)
      : expectedLatestKoreanTradingDate(now);
    const force = options.forceNetwork === true;
    const requiredTickers = tickers.filter((ticker) => {
      if (force || live) return true;
      const latestDate = String(latestDates[ticker] || "").slice(0, 10);
      return !latestDate || !targetDate || latestDate < targetDate;
    });
    return Object.freeze({
      force,
      live,
      targetDate,
      requiredTickers: Object.freeze(requiredTickers),
      skippedTickers: Object.freeze(tickers.filter((ticker) => !requiredTickers.includes(ticker))),
      shouldRefresh: requiredTickers.length > 0,
    });
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
      const requestedTickers = Array.isArray(requestOptions.tickers)
        ? normalizeStockTickers(requestOptions.tickers)
        : visibleTickers();
      const indexTickers = Array.isArray(requestOptions.indexTickers)
        ? requestOptions.indexTickers
        : ["^KS11", "^KQ11"];
      const latestIndices = options.latestDatesByTicker?.(
        options.getPricePayload?.(),
        indexTickers,
        options.toNumber,
      ) || {};
      const latestSince = Object.values(latestIndices).filter(Boolean).sort()[0] || "";
      const since = requestOptions.requireIndexVolumeHistory === true
        ? [latestSince, dateDaysBefore(requestOptions.now, INDEX_VOLUME_HISTORY_DAYS)]
          .filter(Boolean)
          .sort()[0]
        : latestSince;
      try {
        return await options.gatewayClient.fetchBootstrap({
          tickers: requestedTickers,
          includeIndices: requestOptions.includeIndices !== false,
          since,
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
            ...(Number.isFinite(options.toNumber?.(point?.volume))
              ? { volume: options.toNumber(point.volume) }
              : {}),
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
    const defaultTickers = Object.freeze(["^KS11", "^KQ11"]);
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
      const tickers = [...new Set((Array.isArray(requestOptions.tickers)
        ? requestOptions.tickers
        : defaultTickers)
        .map((ticker) => String(ticker || "").trim().toUpperCase())
        .filter((ticker) => defaultTickers.includes(ticker)))];
      if (!tickers.length) return { applied, warnings };
      if (!options.isLocalRuntime && !options.canUseGateway?.()) return { applied, warnings };
      const beforeLatest = latestDatesByTicker(options.getPricePayload(), tickers, options.toNumber);
      const volumeHistoryRequired = requestOptions.requireVolumeHistory === true
        || tickers.some((ticker) => options.hasVolumeHistory?.(ticker) === false);
      const latestSince = Object.values(beforeLatest).filter(Boolean).sort()[0] || "";
      const since = volumeHistoryRequired
        ? [latestSince, dateDaysBefore(requestOptions.now, INDEX_VOLUME_HISTORY_DAYS)]
          .filter(Boolean)
          .sort()[0]
        : latestSince;

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
          since,
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
    const adrKeys = Object.freeze([...(options.adrKeys || ["adr_kospi", "adr_kosdaq"])]);
    const fearGreedKey = String(options.fearGreedKey || "fear_greed");
    const canFetchProtected = () => options.isLocal === true || options.canUseGateway?.() === true;

    function latestPoint(rows, keys) {
      for (let index = (Array.isArray(rows) ? rows.length : 0) - 1; index >= 0; index -= 1) {
        const row = rows[index];
        const date = String(row?.date || "").slice(0, 10);
        if (!DATE_PATTERN.test(date)) continue;
        if (keys.some((key) => Number.isFinite(Number(row?.[key])))) return row;
      }
      return null;
    }

    function sameLatestPoint(currentRows, incomingRows, keys) {
      const current = latestPoint(currentRows, keys);
      const incoming = latestPoint(incomingRows, keys);
      if (!current || !incoming || current.date !== incoming.date) return false;
      return keys.every((key) => {
        const incomingValue = Number(incoming[key]);
        if (!Number.isFinite(incomingValue)) return true;
        return Number(current[key]) === incomingValue;
      });
    }

    function volatilityValidation(validation = {}) {
      return {
        gapPolicies: {},
        ...validation,
      };
    }

    function applyVkospiRows(liveRows, transaction = null) {
      const controller = getSeriesController();
      // Some upstream VKOSPI histories resume after a provider gap. Value checks
      // remain active while the chart renders separate valid segments.
      const validation = volatilityValidation();
      if (!transaction) {
        return controller.applyAuxiliarySeriesRows(liveRows, "vkospi", "VKOSPI", validation);
      }
      return transaction.stage(
        controller.buildAuxiliarySeriesRows(liveRows, "vkospi", transaction.rows()),
        ["vkospi"],
        { label: "VKOSPI", validation },
      );
    }

    function applyVixRows(liveRows, transaction = null) {
      const controller = getSeriesController();
      const validation = volatilityValidation();
      if (!transaction) {
        return controller.applyAuxiliarySeriesRows(liveRows, "vix", "VIX", validation);
      }
      return transaction.stage(
        controller.buildAuxiliarySeriesRows(liveRows, "vix", transaction.rows()),
        ["vix"],
        { label: "VIX", validation },
      );
    }

    function applyAuxiliaryGroup(liveRows, keys, label) {
      const controller = getSeriesController();
      const transaction = controller.beginTransaction("adr");
      const latestDates = [];
      let updated = 0;
      for (const key of keys) {
        const result = transaction.stage(
          controller.buildAuxiliarySeriesRows(liveRows, key, transaction.rows()),
          [key],
          { label, validation: { gapPolicies: {} } },
        );
        updated += result.updated;
        if (result.latestDate) latestDates.push(result.latestDate);
      }
      transaction.commit();
      return { updated, changed: updated, latestDate: latestDates.sort().at(-1) || "" };
    }

    function isAdrDelayed(sourceLatestDate, upstreamDelayed = false) {
      const benchmarkDate = String(options.getAdrBenchmarkDate?.() || "").slice(0, 10);
      return benchmarkDate ? !sourceLatestDate || sourceLatestDate < benchmarkDate : upstreamDelayed;
    }

    async function fetchAdrPayload(signal, forceNetwork, latestOnly = false) {
      const payload = await gateway.fetchAdr({ signal, forceNetwork, latestOnly, timeoutMs });
      throwIfRequestAborted(signal);
      return payload;
    }

    async function refreshAdr(signal = null, forceNetwork = false) {
      let endpointError = null;
      if (canFetchProtected()) {
        try {
          const latestPayload = await fetchAdrPayload(signal, forceNetwork, true);
          const sourceLatestDate = latestPayload.latestDate || "";
          const currentRows = options.getAdrRows?.() || [];
          if (!latestPayload.stale && !isAdrDelayed(sourceLatestDate, latestPayload.delayed === true)
            && sameLatestPoint(currentRows, latestPayload.rows, adrKeys)) {
            return { changed: 0, updated: 0, latestDate: sourceLatestDate, sourceLatestDate, stale: false, delayed: false };
          }
          const payload = await fetchAdrPayload(signal, forceNetwork, false);
          const latestDate = payload.latestDate || payload.rows.at(-1)?.date || "";
          const result = applyAuxiliaryGroup(payload.rows, adrKeys, "ADR");
          if (!payload.stale && !isAdrDelayed(latestDate, payload.delayed === true)) {
            return { ...result, sourceLatestDate: latestDate, stale: false, delayed: false };
          }
          endpointError = new Error(payload.delayed === true
            ? `ADR 최신 날짜 지연(${latestDate || "없음"})`
            : "ADR Worker returned cached stale data");
          endpointError.retryable = true;
        } catch (error) {
          if (options.isAbortError?.(error) || signal?.aborted) throw error;
          endpointError = error;
        }
      }

      try {
        const payload = await options.fetchAdrFallback?.(signal);
        const rows = Array.isArray(payload) ? payload : payload?.rows;
        if (!Array.isArray(rows) || !rows.length) throw new Error("ADR fallback contained no usable rows");
        throwIfRequestAborted(signal);
        const sourceLatestDate = String(payload?.latestDate || rows.at(-1)?.date || "").slice(0, 10);
        if (isAdrDelayed(sourceLatestDate)) {
          const error = new Error(`ADR 최신 날짜 지연(${sourceLatestDate || "없음"})`);
          error.retryable = true;
          throw error;
        }
        return {
          ...applyAuxiliaryGroup(rows, adrKeys, "ADR"),
          sourceLatestDate,
          delayed: false,
          stale: false,
        };
      } catch (error) {
        if (options.isAbortError?.(error) || signal?.aborted) throw error;
        const combined = new Error([endpointError?.message, error?.message].filter(Boolean).join(" / "));
        combined.retryable = true;
        throw combined;
      }
    }

    function refreshAdrWithRetry(signal = null, forceNetwork = false) {
      if (!forceNetwork || typeof options.retryOnce !== "function") return refreshAdr(signal, forceNetwork);
      return options.retryOnce(
        () => refreshAdr(signal, forceNetwork),
        {
          delayMs: Math.max(0, Number(options.adrRetryDelayMs) || 0),
          signal,
          shouldRetry: (error) => !options.isAbortError?.(error) && isRetryableAdrRefreshError(error),
        },
      );
    }

    async function refreshFearGreed(signal = null, forceNetwork = false) {
      const currentRows = options.getAdrRows?.() || [];
      let latestPayload = null;
      try {
        latestPayload = await gateway.fetchFearGreed({ signal, forceNetwork, latestOnly: true, timeoutMs });
        throwIfRequestAborted(signal);
        if (sameLatestPoint(currentRows, latestPayload.rows, [fearGreedKey])) {
          return { added: 0, updated: 0, latestDate: latestPayload.latestDate || "" };
        }
      } catch (error) {
        if (options.isAbortError?.(error) || signal?.aborted) throw error;
      }
      const payload = await gateway.fetchFearGreed({ signal, forceNetwork, latestOnly: false, timeoutMs });
      throwIfRequestAborted(signal);
      const result = applyAuxiliaryGroup(payload.rows, [fearGreedKey], "fear greed");
      return { ...result, added: result.updated, latestDate: result.latestDate || latestPayload?.latestDate || "" };
    }

    async function refreshMacro(signal = null, forceNetwork = false) {
      if (!canFetchProtected()) return { applied: [], warnings: [], components: {} };
      const payload = await gateway.fetchMacro({ signal, forceNetwork, timeoutMs });
      throwIfRequestAborted(signal);
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
      const transaction = controller.beginTransaction("macro");

      const applyComponent = (component, rows, build, keys, label, displayLabel, validation = {}) => {
        if (!Array.isArray(rows) || !rows.length) return;
        attempted += 1;
        try {
          const result = transaction.stage(
            build(rows, transaction.rows()),
            keys,
            { label, validation },
          );
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
        (rows, sourceRows) => controller.buildLeadingCycleLiveRows(rows, sourceRows), ["leading_cycle"],
        "leading cycle", "선행순환변동", {
          allowLatestRegressionKeys: ["leading_cycle"],
          allowCountDecreaseKeys: ["leading_cycle"],
        });
      applyComponent("macro:news", payload.newsRows,
        (rows, sourceRows) => controller.buildNewsSentimentLiveRows(rows, sourceRows), ["news_sentiment"],
        "news sentiment", "뉴스심리");
      applyComponent("macro:policyRate", payload.policyRateRows,
        (rows, sourceRows) => controller.buildMacroIndicatorLiveRows(rows, ["policy_rate"], sourceRows), ["policy_rate"],
        "policy rate", "기준금리");
      applyComponent("macro:trade:export", payload.tradeRows,
        (rows, sourceRows) => controller.buildMacroIndicatorLiveRows(rows, ["export_value"], sourceRows), ["export_value"],
        "exports", "수출");
      applyComponent("macro:trade:import", payload.tradeRows,
        (rows, sourceRows) => controller.buildMacroIndicatorLiveRows(rows, ["import_value"], sourceRows), ["import_value"],
        "imports", "수입");

      if (attempted > 0 && accepted === 0 && failures.length) throw failures[0];
      transaction.commit();
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
      throwIfRequestAborted(signal);
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
      const transaction = controller.beginTransaction("credit");
      for (const key of creditKeys) {
        try {
          const result = transaction.stage(
            controller.buildCreditLiveRows(
              scaledRows,
              transaction.rows(),
              [key],
              { normalized: true },
            ),
            [key],
            { label: labels[key] },
          );
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
      transaction.commit();
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
      throwIfRequestAborted(signal);
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
      const macroTransaction = controller.beginTransaction("macro");
      const volatilityTransaction = controller.beginTransaction("adr");
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

      applyComponent("macro:termSpread", () => macroTransaction.stage(
        controller.buildMacroIndicatorLiveRows(
          payload.termSpreadRows,
          ["t10y1y"],
          macroTransaction.rows(),
          { positiveOnly: false },
        ),
        ["t10y1y"],
        { label: "US Treasury 10Y-1Y spread" },
      ), "장단기금리차");
      applyComponent("macro:creditSpread", () => macroTransaction.stage(
        controller.buildMacroIndicatorLiveRows(
          payload.creditSpreadRows,
          ["us_credit_spread"],
          macroTransaction.rows(),
          { positiveOnly: false },
        ),
        ["us_credit_spread"],
        { label: "US 3Y AAA-AA-A corporate minus Treasury spread" },
      ), "신용스프레드");
      applyComponent("crisis:signal", () => controller.applyCrisisSignalRows(payload.records), "침체 위기신호");
      applyComponent("volatility:vkospi", () => applyVkospiRows(payload.vkospiRows, volatilityTransaction), "VKOSPI");
      applyComponent("volatility:vix", () => applyVixRows(payload.vixRows, volatilityTransaction), "VIX");
      if (!accepted && failures.length) throw failures[0];
      macroTransaction.commit();
      volatilityTransaction.commit();
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
      refreshAdr,
      refreshAdrWithRetry,
      refreshCredit,
      refreshCrisis,
      refreshFearGreed,
      refreshMacro,
    });
  }

export {
  componentResult,
  createRuntimeBootstrapService,
  createRuntimeIndexRefreshService,
  createRuntimeMarketRefresh,
  isRetryableAdrRefreshError,
  latestDatesByTicker,
  normalizeStockTickers,
  normalizeTickerPoints,
  planKoreanPriceRefresh,
};
