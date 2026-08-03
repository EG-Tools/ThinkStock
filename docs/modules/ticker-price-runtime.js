(function initTickerPriceRuntime(globalScope) {
  "use strict";

  const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function normalizeTicker(ticker) {
    return String(ticker || "").trim().toUpperCase();
  }

  function createStatusStore(options = {}) {
    const tickerPattern = options.tickerPattern || /^\d{6}\.(KS|KQ)$/;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const statuses = new Map();

    function normalize(ticker, value = {}) {
      const key = normalizeTicker(ticker);
      if (!tickerPattern.test(key)) return null;
      const latestDate = String(value.latestDate || "").slice(0, 10);
      return {
        ticker: key,
        source: String(value.source || "LOCAL_CACHE").trim().toUpperCase().slice(0, 40),
        latestDate: ISO_DATE_PATTERN.test(latestDate) ? latestDate : "",
        marketDate: String(value.marketDate || "").slice(0, 10),
        expectedDate: String(value.expectedDate || "").slice(0, 10),
        cached: value.cached === true,
        localCache: value.localCache === true,
        stale: value.stale === true,
        crossCheck: String(value.crossCheck || "").slice(0, 40),
        warning: String(value.warning || "").trim().slice(0, 300),
        checkedAt: Number(value.checkedAt) || now(),
      };
    }

    function set(ticker, value = {}) {
      const status = normalize(ticker, value);
      if (status) statuses.set(status.ticker, status);
      return status;
    }

    function get(ticker) {
      return statuses.get(normalizeTicker(ticker)) || null;
    }

    function visible(visibleTickers, preferredTicker = "") {
      const tickers = (Array.isArray(visibleTickers) ? visibleTickers : []).map(normalizeTicker);
      const preferred = normalizeTicker(preferredTicker);
      const target = tickers.includes(preferred) ? preferred : tickers.at(-1);
      return target ? get(target) : null;
    }

    return Object.freeze({ normalize, set, get, visible });
  }

  function clearSeries(payload, ticker) {
    if (!payload || typeof payload !== "object") return payload;
    const key = normalizeTicker(ticker);
    if (!key) return payload;
    if (Array.isArray(payload.records)) {
      payload.records.forEach((row) => {
        if (row && typeof row === "object") delete row[key];
      });
    }
    if (payload.columns && typeof payload.columns === "object") delete payload.columns[key];
    if (Array.isArray(payload.series)) payload.series = payload.series.filter((item) => item !== key);
    if (payload.display_names && typeof payload.display_names === "object") delete payload.display_names[key];
    return payload;
  }

  function mergeSeries(payload, ticker, points, displayName = "") {
    const key = normalizeTicker(ticker);
    const target = payload && typeof payload === "object" ? payload : {};
    if (!key) return target;
    const byDate = new Map();
    (target.records || []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      if (date) byDate.set(date, { ...row });
    });
    (Array.isArray(points) ? points : []).forEach((point) => {
      const date = String(point?.date || "").slice(0, 10);
      const close = Number(point?.close);
      if (!ISO_DATE_PATTERN.test(date) || !Number.isFinite(close)) return;
      const row = byDate.get(date) || { date };
      row[key] = close;
      byDate.set(date, row);
    });
    target.records = [...byDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
    if (!Array.isArray(target.series)) target.series = [];
    if (!target.series.includes(key)) target.series.push(key);
    if (!target.display_names || typeof target.display_names !== "object") target.display_names = {};
    if (displayName) target.display_names[key] = displayName;
    return target;
  }

  function latestSeriesDate(payload, ticker, toNumber = Number) {
    const key = normalizeTicker(ticker);
    let latest = "";
    (payload?.records || []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const value = toNumber(row?.[key]);
      if (!ISO_DATE_PATTERN.test(date) || value === null || !Number.isFinite(value)) return;
      if (!latest || date > latest) latest = date;
    });
    return latest;
  }

  function seriesPoints(payload, ticker, normalizePoints) {
    const key = normalizeTicker(ticker);
    const points = (payload?.records || []).map((row) => ({ date: row?.date, close: row?.[key] }));
    return typeof normalizePoints === "function" ? normalizePoints(points) : points;
  }

  function isCacheFresh(options = {}) {
    const latestDate = String(options.latestDate || "").slice(0, 10);
    if (!ISO_DATE_PATTERN.test(latestDate)) return false;
    const status = options.status;
    const recentlyConfirmed = status
      && !status.stale
      && status.expectedDate === options.expectedDate
      && Number(options.nowMs) - Number(status.checkedAt || 0) <= Number(options.maxAgeMs);
    if (recentlyConfirmed) return true;
    const requiredDate = [options.expectedDate, options.benchmarkDate]
      .filter(Boolean)
      .sort()
      .at(-1) || options.expectedDate;
    return latestDate >= requiredDate;
  }

  globalScope.ThinkStockTickerPriceRuntime = Object.freeze({
    createStatusStore,
    clearSeries,
    mergeSeries,
    latestSeriesDate,
    seriesPoints,
    isCacheFresh,
  });
}(typeof self !== "undefined" ? self : globalThis));
