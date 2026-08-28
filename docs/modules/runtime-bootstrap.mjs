"use strict";

  const STOCK_TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;

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
        // A not-yet-updated Worker transparently falls back to the separate routes.
        return null;
      }
    }

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
          .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date)
            && point.close !== null
            && point.close !== undefined
            && Number.isFinite(point.close)
            && point.close > 0));
      });
      return pointsByTicker;
    }

    return Object.freeze({ fetchCritical, fetchLatestPriceSeriesBatch, visibleTickers });
  }

export {
  createRuntimeBootstrapService,
  normalizeStockTickers,
};
