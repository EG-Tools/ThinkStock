(function initTickerPriceRuntime(globalScope) {
  "use strict";

  const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const HISTORY_COVERAGE_FULL = "full";
  const HISTORY_COVERAGE_PARTIAL = "partial";
  const HISTORY_COVERAGE_UNKNOWN = "unknown";
  const DEFAULT_CACHE_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const CORPORATE_ACTION_RATIO_THRESHOLD = 1.5;
  const CORPORATE_ACTION_MAX_BOUNDARY_DAYS = 3660;
  const INTEGRITY_MAX_TRANSITION_GAP_DAYS = 370;

  function normalizeTicker(ticker) {
    return String(ticker || "").trim().toUpperCase();
  }

  function normalizeHistoryCoverage(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === HISTORY_COVERAGE_FULL) return HISTORY_COVERAGE_FULL;
    if (normalized === HISTORY_COVERAGE_PARTIAL) return HISTORY_COVERAGE_PARTIAL;
    return HISTORY_COVERAGE_UNKNOWN;
  }

  function resolveHistoryFetchSinceDate(options = {}) {
    const latestDate = String(options.latestDate || "").slice(0, 10);
    const canExtendTail = options.hasExisting === true
      && options.hasVolumeHistory === true
      && normalizeHistoryCoverage(options.historyCoverage) === HISTORY_COVERAGE_FULL
      && ISO_DATE_PATTERN.test(latestDate);
    return canExtendTail ? latestDate : "";
  }

  function filterLatestTailPoints(existingPoints, latestPoints) {
    const existingDates = (Array.isArray(existingPoints) ? existingPoints : [])
      .map((point) => String(point?.date || "").slice(0, 10))
      .filter((date) => ISO_DATE_PATTERN.test(date));
    if (!existingDates.length) return Array.isArray(latestPoints) ? latestPoints : [];
    const latestExistingDate = existingDates.sort().at(-1);
    return (Array.isArray(latestPoints) ? latestPoints : []).filter((point) => {
      const date = String(point?.date || "").slice(0, 10);
      return ISO_DATE_PATTERN.test(date) && date >= latestExistingDate;
    });
  }

  function shouldTouchCacheRecord(lastAccessed, nowMs = Date.now(), intervalMs = DEFAULT_CACHE_TOUCH_INTERVAL_MS) {
    const previous = Number(lastAccessed);
    const current = Number(nowMs);
    const interval = Math.max(0, Number(intervalMs) || 0);
    if (!Number.isFinite(previous) || previous <= 0) return true;
    if (!Number.isFinite(current) || current <= 0) return false;
    return current < previous || current - previous >= interval;
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
      if (!ISO_DATE_PATTERN.test(date) || !Number.isFinite(close) || close <= 0) return;
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

  function normalizeResearchHistoryCache(value, ticker, normalizePoints, options = {}) {
    const key = normalizeTicker(ticker);
    const rows = typeof normalizePoints === "function" ? normalizePoints(value?.rows, key) : [];
    const schema = Number(options.schema) || 1;
    const minimumPoints = Math.max(1, Number(options.minimumPoints) || 252);
    if (Number(value?.schema) !== schema
      || normalizeTicker(value?.ticker) !== key
      || rows.length < minimumPoints) return null;
    if (!inspectPriceHistoryIntegrity(rows).clean) return null;
    return {
      ...value,
      schema,
      ticker: key,
      asOfDate: String(value?.asOfDate || rows.at(-1)?.date || "").slice(0, 10),
      latestDate: rows.at(-1)?.date || "",
      rows,
    };
  }

  function priceCacheToResearchHistory(value, ticker, normalizePoints, options = {}) {
    const key = normalizeTicker(ticker);
    const rows = typeof normalizePoints === "function" ? normalizePoints(value?.points, key) : [];
    const priceSchema = Number(options.priceSchema);
    const researchSchema = Number(options.researchSchema) || 1;
    const minimumPoints = Math.max(1, Number(options.minimumPoints) || 252);
    if (Number(value?.schema) !== priceSchema
      || normalizeTicker(value?.ticker) !== key
      || rows.length < minimumPoints) return null;
    if (!inspectPriceHistoryIntegrity(rows).clean) return null;
    const now = typeof options.now === "function" ? options.now() : Date.now();
    return {
      schema: researchSchema,
      ticker: key,
      asOfDate: rows.at(-1)?.date || "",
      latestDate: rows.at(-1)?.date || "",
      source: value?.status?.source || "ticker-price-cache",
      savedAt: Number(value?.savedAt) || now,
      lastAccessed: now,
      rows,
    };
  }

  function inspectPriceHistoryIntegrity(history, options = {}) {
    const sourceRows = Array.isArray(history?.rows)
      ? history.rows
      : (Array.isArray(history) ? history : []);
    const threshold = Math.max(1.31, Number(options.ratioThreshold)
      || CORPORATE_ACTION_RATIO_THRESHOLD);
    const maximumGapMs = Math.max(7, Number(options.maximumTransitionGapDays)
      || INTEGRITY_MAX_TRANSITION_GAP_DAYS) * 24 * 60 * 60 * 1000;
    const rows = sourceRows
      .map((point) => ({
        date: String(point?.date || "").slice(0, 10),
        close: Number(point?.close),
      }))
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date)
        && Number.isFinite(point.close)
        && point.close > 0)
      .sort((left, right) => left.date.localeCompare(right.date));
    let anomalyCount = 0;
    let maxRatio = 1;
    let firstDate = "";
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      const gapMs = Date.parse(`${current.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`);
      if (!Number.isFinite(gapMs) || gapMs > maximumGapMs) continue;
      const ratio = Math.max(previous.close, current.close) / Math.min(previous.close, current.close);
      if (!Number.isFinite(ratio) || ratio < threshold) continue;
      anomalyCount += 1;
      if (!firstDate) firstDate = current.date;
      maxRatio = Math.max(maxRatio, ratio);
    }
    return Object.freeze({
      anomalyCount,
      clean: anomalyCount === 0,
      firstDate,
      maxRatio,
      points: rows.length,
    });
  }

  function inspectPricePayloadIntegrity(payload, options = {}) {
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const tickerPattern = options.tickerPattern || /^\d{6}\.(KS|KQ)$/;
    const declaredSeries = Array.isArray(payload?.series) ? payload.series : [];
    const tickerSet = new Set();
    declaredSeries.forEach((value) => {
      const ticker = normalizeTicker(value);
      if (tickerPattern.test(ticker)) tickerSet.add(ticker);
    });
    records.forEach((row) => {
      if (!row || typeof row !== "object") return;
      Object.keys(row).forEach((value) => {
        const ticker = normalizeTicker(value);
        if (tickerPattern.test(ticker)) tickerSet.add(ticker);
      });
    });
    const tickers = [...tickerSet];
    const threshold = Math.max(1.31, Number(options.ratioThreshold)
      || CORPORATE_ACTION_RATIO_THRESHOLD);
    const maximumGapMs = Math.max(7, Number(options.maximumTransitionGapDays)
      || INTEGRITY_MAX_TRANSITION_GAP_DAYS) * 24 * 60 * 60 * 1000;
    for (const ticker of tickers) {
      let previousClose = null;
      let previousDate = "";
      let points = 0;
      let anomalyCount = 0;
      let firstDate = "";
      let maxRatio = 1;
      let requiresSortedFallback = false;
      for (const row of records) {
        const date = String(row?.date || "").slice(0, 10);
        const close = Number(row?.[ticker]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue;
        if (previousDate && date < previousDate) {
          requiresSortedFallback = true;
          break;
        }
        points += 1;
        const gapMs = previousDate
          ? Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)
          : 0;
        if (previousClose !== null && Number.isFinite(gapMs) && gapMs <= maximumGapMs) {
          const ratio = Math.max(previousClose, close) / Math.min(previousClose, close);
          if (Number.isFinite(ratio) && ratio >= threshold) {
            anomalyCount += 1;
            if (!firstDate) firstDate = date;
            maxRatio = Math.max(maxRatio, ratio);
          }
        }
        previousClose = close;
        previousDate = date;
      }
      const integrity = requiresSortedFallback
        ? inspectPriceHistoryIntegrity(records.map((row) => ({ date: row?.date, close: row?.[ticker] })), options)
        : { anomalyCount, clean: anomalyCount === 0, firstDate, maxRatio, points };
      if (!integrity.clean) return Object.freeze({ ...integrity, ticker, clean: false });
    }
    return Object.freeze({ anomalyCount: 0, clean: true, firstDate: "", maxRatio: 1, ticker: "" });
  }

  function selectPreferredResearchHistory(priceHistory, researchHistory) {
    if (!priceHistory) return researchHistory || null;
    if (!researchHistory) return priceHistory;
    const priceDate = String(priceHistory.latestDate || priceHistory.rows?.at?.(-1)?.date || "").slice(0, 10);
    const researchDate = String(researchHistory.latestDate || researchHistory.rows?.at?.(-1)?.date || "").slice(0, 10);
    if (researchDate > priceDate) return researchHistory;
    if (priceDate > researchDate) return priceHistory;
    const priceIntegrity = inspectPriceHistoryIntegrity(priceHistory);
    const researchIntegrity = inspectPriceHistoryIntegrity(researchHistory);
    const researchCoverageIsComplete = shouldReplaceFullHistory(
      priceHistory.rows,
      researchHistory.rows,
    );
    if (researchCoverageIsComplete
      && researchIntegrity.anomalyCount < priceIntegrity.anomalyCount) {
      return researchHistory;
    }
    if (priceIntegrity.anomalyCount < researchIntegrity.anomalyCount) {
      return priceHistory;
    }
    // The price cache owns the adjusted-price basis. A research record only wins
    // when it is newer or clearly repairs a same-day corporate-action boundary.
    return priceHistory;
  }

  function shouldReplaceFullHistory(existingPoints, incomingPoints, options = {}) {
    const existing = Array.isArray(existingPoints) ? existingPoints : [];
    const incoming = Array.isArray(incomingPoints) ? incomingPoints : [];
    if (!incoming.length) return false;
    if (!existing.length) return true;
    const minimumCoverageRatio = Math.max(0.5, Math.min(1, Number(options.minimumCoverageRatio) || 0.8));
    return incoming.length >= Math.floor(existing.length * minimumCoverageRatio);
  }

  function createPayloadController(options = {}) {
    const volumesByTicker = options.volumesByTicker instanceof Map
      ? options.volumesByTicker
      : new Map();
    const getPayload = options.getPayload;
    const setPayload = options.setPayload;
    const toNumber = typeof options.toNumber === "function" ? options.toNumber : Number;
    const normalizePoints = typeof options.normalizePoints === "function"
      ? options.normalizePoints
      : (points) => (Array.isArray(points) ? points : []);
    const sameNumber = typeof options.sameNumber === "function"
      ? options.sameNumber
      : (left, right) => left === right;
    if (typeof getPayload !== "function" || typeof setPayload !== "function") {
      throw new Error("ticker price payload controller dependencies are incomplete");
    }

    function clear(ticker) {
      const key = normalizeTicker(ticker);
      const payload = getPayload();
      if (!key || !payload || typeof payload !== "object") return false;
      const hadSeries = (payload.series || []).includes(key)
        || (payload.records || []).some((row) => toNumber(row?.[key]) !== null);
      setPayload(clearSeries(payload, key));
      volumesByTicker.delete(key);
      options.onClear?.(key);
      if (hadSeries) options.onChanged?.(key);
      return hadSeries;
    }

    function merge(ticker, points, mergeOptions = {}) {
      const key = normalizeTicker(ticker);
      const sourcePoints = normalizePoints(Array.isArray(points) ? points : [], key);
      const currentPayload = getPayload();
      const replacing = mergeOptions.replace === true;
      const payload = replacing ? clearSeries(currentPayload, key) : currentPayload;
      if (replacing) volumesByTicker.delete(key);
      options.assertPoints?.({ ticker: key, currentPayload: payload, incomingPoints: sourcePoints });
      const existingByDate = new Map((payload?.records || []).map((row) => [
        String(row?.date || "").slice(0, 10),
        row,
      ]));
      const volumes = new Map(volumesByTicker.get(key) || []);
      let changed = replacing || !(payload?.series || []).includes(key);
      sourcePoints.forEach((point) => {
        const date = String(point?.date || "").slice(0, 10);
        const close = toNumber(point?.close);
        const volume = toNumber(point?.volume);
        if (ISO_DATE_PATTERN.test(date) && close !== null
          && !sameNumber(existingByDate.get(date)?.[key], close)) changed = true;
        if (ISO_DATE_PATTERN.test(date) && volume !== null && volume >= 0
          && !sameNumber(volumes.get(date), volume)) changed = true;
        if (ISO_DATE_PATTERN.test(date) && volume !== null && volume >= 0) volumes.set(date, volume);
      });
      if (volumes.size) volumesByTicker.set(key, volumes);
      setPayload(mergeSeries(payload, key, sourcePoints, options.displayName?.(key) || ""));
      if (changed) options.onChanged?.(key);
      return changed;
    }

    function points(ticker) {
      const key = normalizeTicker(ticker);
      const volumes = volumesByTicker.get(key);
      return seriesPoints(getPayload(), key, (values) => normalizePoints(values, key)).map((point) => ({
        ...point,
        ...(volumes?.has(point.date) ? { volume: volumes.get(point.date) } : {}),
      }));
    }

    return Object.freeze({
      clear,
      merge,
      latestDate: (ticker) => latestSeriesDate(getPayload(), ticker, toNumber),
      points,
      hasVolumeHistory: (ticker, minimumPoints = 20) => points(ticker)
        .filter((point) => Number.isFinite(point.volume) && point.volume > 0)
        .length >= Math.max(1, Number(minimumPoints) || 20),
    });
  }

  function createSeriesLoader(options = {}) {
    const required = [
      "applySharedCache",
      "assessPriceUpdate",
      "clearSeries",
      "fetchHistory",
      "fetchLatest",
      "getPoints",
      "hasSeries",
      "hasVolumeHistory",
      "invalidateCache",
      "isCacheFresh",
      "latestDate",
      "mergePoints",
      "normalizePoints",
      "setStatus",
      "writeCache",
    ];
    required.forEach((name) => {
      if (typeof options[name] !== "function") {
        throw new Error(`ticker series loader dependency is missing: ${name}`);
      }
    });
    const throwIfAborted = typeof options.throwIfAborted === "function"
      ? options.throwIfAborted
      : (signal) => {
        if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
      };

    async function load(ticker, loadOptions = {}) {
      const key = normalizeTicker(ticker);
      const forceRefresh = loadOptions.forceRefresh === true;
      const displayName = String(loadOptions.displayName || options.displayName?.(key) || "").trim();
      const signal = loadOptions.signal || null;
      const hasPrefetchedLatest = Object.prototype.hasOwnProperty.call(loadOptions, "latestPoints");
      const prefetchedLatest = hasPrefetchedLatest
        ? options.normalizePoints(loadOptions.latestPoints, key)
        : [];
      throwIfAborted(signal);
      const cacheInfo = await options.applySharedCache(key, displayName);
      throwIfAborted(signal);
      const hasExisting = options.hasSeries(key);
      const historyCoverage = normalizeHistoryCoverage(cacheInfo.historyCoverage);
      let latestExisting = cacheInfo.latestDate || options.latestDate(key);
      let latestBoundaryAssessment = null;
      if (hasExisting && typeof options.inspectHistoryIntegrity === "function") {
        const integrity = options.inspectHistoryIntegrity(options.getPoints(key));
        if (integrity?.anomalyCount > 0) {
          latestBoundaryAssessment = options.assessPriceUpdate(
            options.getPoints(key),
            [],
            {
              rebaseSignal: {
                type: "overlap",
                date: integrity.firstDate,
                ratio: integrity.maxRatio,
                source: "cached-history-integrity",
              },
            },
          );
        }
      }
      if (hasExisting && loadOptions.returnAfterCache === true && !latestBoundaryAssessment) {
        return { ready: true, cached: true, deferredRefresh: true, latestDate: latestExisting };
      }
      if (hasExisting && !forceRefresh && !latestBoundaryAssessment) {
        try {
          const rawLatestPoints = hasPrefetchedLatest
            ? prefetchedLatest
            : await options.fetchLatest(key, { signal });
          const latestPoints = filterLatestTailPoints(options.getPoints(key), rawLatestPoints);
          if (latestPoints.length) {
            const existingPoints = options.getPoints(key);
            const rebaseSignal = options.findRebaseSignal?.(existingPoints, latestPoints) || null;
            const assessment = options.assessPriceUpdate(existingPoints, latestPoints, { rebaseSignal });
            if (assessment.fullHistoryRequired) {
              // Keep the known-good series visible until a complete adjusted history succeeds.
              latestBoundaryAssessment = assessment;
            } else {
              if (assessment.invalidateDerived) await options.invalidateCache(key, assessment);
              options.mergePoints(key, latestPoints);
              latestExisting = options.latestDate(key);
              await options.writeCache(key, options.getPoints(key), displayName, { historyCoverage });
            }
          }
        } catch (error) {
          if (options.isAbortError?.(error) || signal?.aborted) throw error;
        }
        if (!latestBoundaryAssessment
          && options.isCacheFresh(latestExisting, key)
          && options.hasVolumeHistory(key)
          && historyCoverage === HISTORY_COVERAGE_FULL) {
          return { ready: true, cached: true, deferredRefresh: false, latestDate: latestExisting };
        }
      }

      try {
        const existingPoints = options.getPoints(key);
        const sinceDate = latestBoundaryAssessment ? "" : resolveHistoryFetchSinceDate({
          hasExisting,
          hasVolumeHistory: options.hasVolumeHistory(key),
          historyCoverage,
          latestDate: options.latestDate(key),
        });
        let points = await options.fetchHistory(key, {
          forceNetwork: forceRefresh,
          sinceDate,
          signal,
          ...(hasPrefetchedLatest ? { latestPoints: prefetchedLatest } : {}),
        });
        throwIfAborted(signal);
        if (!points.length) throw new Error(`${key} price history is empty`);
        if (typeof options.inspectHistoryIntegrity === "function") {
          const fetchedIntegrity = options.inspectHistoryIntegrity(points);
          if (fetchedIntegrity?.anomalyCount > 0) {
            throw new Error(`${key} fetched price history failed integrity validation`);
          }
        }
        let fetchedFullHistory = !sinceDate;
        const rebaseSignal = sinceDate ? options.findRebaseSignal?.(existingPoints, points) : null;
        const assessment = latestBoundaryAssessment
          || options.assessPriceUpdate(existingPoints, points, { rebaseSignal });
        if (assessment.fullHistoryRequired && sinceDate) {
          points = await options.fetchHistory(key, {
            forceNetwork: forceRefresh,
            signal,
            ...(hasPrefetchedLatest ? { latestPoints: prefetchedLatest } : {}),
          });
          throwIfAborted(signal);
          if (!points.length) throw new Error(`${key} price history is empty`);
          if (typeof options.inspectHistoryIntegrity === "function") {
            const fetchedIntegrity = options.inspectHistoryIntegrity(points);
            if (fetchedIntegrity?.anomalyCount > 0) {
              throw new Error(`${key} full price history failed integrity validation`);
            }
          }
          fetchedFullHistory = true;
        }
        const replaceFullHistory = fetchedFullHistory
          && shouldReplaceFullHistory(existingPoints, points);
        if (assessment.fullHistoryRequired && !replaceFullHistory) {
          throw new Error(`${key} adjusted price history is incomplete`);
        }
        if (assessment.fullHistoryRequired) {
          await options.invalidateCache(key, assessment);
          options.clearSeries(key);
        } else if (assessment.invalidateDerived) {
          await options.invalidateCache(key, assessment);
        }
        throwIfAborted(signal);
        options.mergePoints(key, points, { replace: replaceFullHistory });
        await options.writeCache(key, options.getPoints(key), displayName, {
          historyCoverage: HISTORY_COVERAGE_FULL,
        });
        return {
          ready: true,
          cached: false,
          deferredRefresh: false,
          latestDate: options.latestDate(key),
        };
      } catch (error) {
        if (hasExisting || cacheInfo.applied) {
          const previous = options.getStatus?.(key) || {};
          options.setStatus(key, {
            ...previous,
            source: previous.source || "LOCAL_CACHE",
            latestDate: previous.latestDate || latestExisting,
            cached: true,
            localCache: true,
            stale: true,
            warning: previous.warning || `최신 가격 갱신 실패: ${error?.message || error}`,
          });
          return {
            ready: true,
            cached: true,
            stale: true,
            deferredRefresh: false,
            latestDate: latestExisting,
          };
        }
        throw error;
      }
    }

    return Object.freeze({ load });
  }

  globalScope.ThinkStockTickerPriceRuntime = Object.freeze({
    CORPORATE_ACTION_MAX_BOUNDARY_DAYS,
    CORPORATE_ACTION_RATIO_THRESHOLD,
    filterLatestTailPoints,
    HISTORY_COVERAGE_FULL,
    HISTORY_COVERAGE_PARTIAL,
    HISTORY_COVERAGE_UNKNOWN,
    createStatusStore,
    createPayloadController,
    createSeriesLoader,
    clearSeries,
    mergeSeries,
    latestSeriesDate,
    seriesPoints,
    isCacheFresh,
    inspectPriceHistoryIntegrity,
    inspectPricePayloadIntegrity,
    normalizeHistoryCoverage,
    normalizeResearchHistoryCache,
    priceCacheToResearchHistory,
    selectPreferredResearchHistory,
    resolveHistoryFetchSinceDate,
    shouldTouchCacheRecord,
    shouldReplaceFullHistory,
  });
}(typeof self !== "undefined" ? self : globalThis));
