"use strict";

  const contract = require("./stock-research-contract.js");
  if (!contract) throw new Error("stock research contract failed to load");
  const { HISTORY_CACHE_SCHEMA, HISTORY_QUALITY_VERSION } = contract;
  const MINIMUM_HISTORY_ROWS = contract.RECENT_SIGNAL_WINDOW;
  let tickerPriceRuntime = null;
  function configureTickerPriceRuntime(runtime) {
    tickerPriceRuntime = runtime?.inspectPriceHistoryIntegrity ? runtime : null;
    return tickerPriceRuntime;
  }
  const historyCoverageVersion = () => tickerPriceRuntime?.HISTORY_COVERAGE_VERSION || 1;
  let cacheLifecycle = null;
  function configureCacheLifecycle(runtime) {
    cacheLifecycle = runtime?.withCacheMetadata ? runtime : null;
    return cacheLifecycle;
  }
  function requireCacheLifecycle() {
    if (!cacheLifecycle) throw new Error("cache lifecycle policy is required");
    return cacheLifecycle;
  }
  let marketCalendar = null;
  function configureMarketCalendar(runtime) {
    marketCalendar = runtime?.isKoreanTradingDate ? runtime : null;
    return marketCalendar;
  }
  const isKoreanMarketPricePoint = (...args) => (
    marketCalendar?.isKoreanMarketPricePoint?.(...args) ?? true
  );
  const isKoreanTradingDate = (date) => (
    marketCalendar?.isKoreanTradingDate?.(date) ?? (() => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return weekday !== 0 && weekday !== 6;
    })()
  );

  function expectedTradingDatesAfter(anchorDate, targetDate) {
    const anchorTime = Date.parse(`${String(anchorDate || "").slice(0, 10)}T00:00:00Z`);
    const target = String(targetDate || "").slice(0, 10);
    const targetTime = Date.parse(`${target}T00:00:00Z`);
    if (!Number.isFinite(anchorTime) || !Number.isFinite(targetTime) || anchorTime >= targetTime) return [];
    const dates = [];
    for (let timestamp = anchorTime + 86400000; timestamp <= targetTime; timestamp += 86400000) {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      if (isKoreanTradingDate(date)) dates.push(date);
    }
    return dates;
  }

  function normalizeResearchHistoryRows(rows) {
    const byDate = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const close = Number(row?.close);
      const volume = Number(row?.volume);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) return;
      if (row?.volume != null && Number.isFinite(volume) && volume <= 0) return;
      if (!isKoreanMarketPricePoint(date, row?.volume)) return;
      byDate.set(date, {
        date,
        close,
        volume: row?.volume != null && Number.isFinite(volume) && volume >= 0 ? volume : null,
      });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function normalizeHistoryCacheRecord(value, ticker) {
    const lifecycle = requireCacheLifecycle();
    const key = String(ticker || "").trim().toUpperCase();
    if (!value
      || value.schema !== HISTORY_CACHE_SCHEMA
      || Number(value.historyQualityVersion) !== HISTORY_QUALITY_VERSION
      || value.ticker !== key) return null;
    const rows = normalizeResearchHistoryRows(value.rows);
    if (rows.length < MINIMUM_HISTORY_ROWS) return null;
    const integrity = tickerPriceRuntime?.inspectPriceHistoryIntegrity?.(rows);
    if (integrity && !integrity.clean) return null;
    const latestDate = rows.at(-1)?.date || "";
    const fingerprint = lifecycle.contentFingerprint(rows);
    const issue = lifecycle.cacheMetadataIssue(value, {
      source: "stock-research-history",
      revision: String(HISTORY_CACHE_SCHEMA),
      contentFingerprint: fingerprint,
      allowMissingTimestamp: true,
    });
    if (issue) return null;
    return lifecycle.withCacheMetadata({
      ...value,
      schema: HISTORY_CACHE_SCHEMA,
      ticker: key,
      latestDate,
      historyCoverage: Number(value?.historyCoverageVersion) === historyCoverageVersion()
        && String(value?.historyCoverage || "").toLowerCase() === "full"
        ? "full"
        : "partial",
      historyCoverageVersion: historyCoverageVersion(),
      historyQualityVersion: HISTORY_QUALITY_VERSION,
      historyValidationDate: String(value?.historyValidationDate || value?.asOfDate || "").slice(0, 10),
      priceIntegrityVersion: tickerPriceRuntime?.PRICE_HISTORY_INTEGRITY_VERSION || 1,
      rows,
    }, {
      source: "stock-research-history",
      asOf: latestDate,
      revision: String(HISTORY_CACHE_SCHEMA),
      contentFingerprint: fingerprint,
    });
  }

  function withHistoryMetadata(record, now = Date.now()) {
    const lifecycle = requireCacheLifecycle();
    return lifecycle.withCacheMetadata(record, {
      source: "stock-research-history",
      asOf: record?.latestDate,
      revision: String(HISTORY_CACHE_SCHEMA),
      contentFingerprint: lifecycle.contentFingerprint(record?.rows || []),
      now,
      savedAt: now,
      touch: true,
    });
  }

  function mergeResearchHistoryPayload(cachedValue, payload, ticker) {
    const key = String(ticker || "").trim().toUpperCase();
    const cachedRecord = normalizeHistoryCacheRecord(cachedValue, key);
    if (Number(payload?.historyQualityVersion) !== HISTORY_QUALITY_VERSION) return null;
    const incoming = normalizeResearchHistoryRows(payload?.rows);
    if (!incoming.length) return null;
    const rows = payload?.partial === true && cachedRecord && payload?.reset !== true
      ? normalizeResearchHistoryRows([...cachedRecord.rows, ...incoming])
      : incoming;
    if (rows.length < MINIMUM_HISTORY_ROWS) return null;
    return withHistoryMetadata({
      schema: HISTORY_CACHE_SCHEMA,
      ticker: key,
      asOfDate: String(payload?.asOfDate || rows.at(-1)?.date || "").slice(0, 10),
      latestDate: rows.at(-1)?.date || "",
      historyCoverage: payload?.partial === true
        ? (cachedRecord?.historyCoverage || "partial")
        : (Number(payload?.historyCoverageVersion) === historyCoverageVersion()
          && String(payload?.historyCoverage || "").toLowerCase() === "full"
          ? "full"
          : "partial"),
      historyCoverageVersion: historyCoverageVersion(),
      historyQualityVersion: HISTORY_QUALITY_VERSION,
      historyValidationDate: String(payload?.historyValidationDate || payload?.asOfDate || "").slice(0, 10),
      priceIntegrityVersion: tickerPriceRuntime?.PRICE_HISTORY_INTEGRITY_VERSION || 1,
      source: String(payload?.source || cachedRecord?.source || ""),
      savedAt: Date.now(),
      lastAccessed: Date.now(),
      rows,
    });
  }

  function mergeUniversePointIntoHistoryCache(cachedValue, item, options = {}) {
    const ticker = String(item?.ticker || "").trim().toUpperCase();
    const record = normalizeHistoryCacheRecord(cachedValue, ticker);
    if (!record) return null;
    const date = String(item?.baseDate || item?.date || "").slice(0, 10);
    const close = Number(item?.close);
    const volume = Number(item?.volume);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) return null;
    const latest = record.rows.at(-1);
    if (!latest) return null;
    if (date < latest.date) return { changed: false, record };

    const normalizedVolume = Number.isFinite(volume) && volume >= 0 ? volume : latest.volume;
    if (date === latest.date) {
      if (latest.close === close && latest.volume === normalizedVolume) return { changed: false, record };
      const rows = [...record.rows.slice(0, -1), { date, close, volume: normalizedVolume }];
      return {
        changed: true,
        record: withHistoryMetadata({
          ...record,
          asOfDate: date,
          latestDate: date,
          historyValidationDate: date,
          savedAt: Date.now(),
          lastAccessed: Date.now(),
          rows,
        }),
      };
    }

    const maxGapDays = Math.max(1, Number(options.maxGapDays) || 14);
    const ratioThreshold = Math.max(1.1, Number(options.ratioThreshold) || 1.8);
    const verifiedThrough = String(record.historyValidationDate || "").slice(0, 10);
    const anchorDate = /^\d{4}-\d{2}-\d{2}$/.test(verifiedThrough) && verifiedThrough >= latest.date
      ? verifiedThrough
      : latest.date;
    const expectedDates = expectedTradingDatesAfter(anchorDate, date);
    const gapDays = Math.round((Date.parse(`${date}T00:00:00Z`)
      - Date.parse(`${latest.date}T00:00:00Z`)) / 86400000);
    const ratio = Math.max(close / latest.close, latest.close / close);
    if (expectedDates.length !== 1
      || expectedDates[0] !== date
      || !Number.isFinite(gapDays)
      || gapDays > maxGapDays
      || !Number.isFinite(ratio)
      || ratio >= ratioThreshold) {
      return null;
    }
    return {
      changed: true,
      record: withHistoryMetadata({
        ...record,
        asOfDate: date,
        latestDate: date,
        historyValidationDate: date,
        savedAt: Date.now(),
        lastAccessed: Date.now(),
        rows: [...record.rows, { date, close, volume: normalizedVolume }],
      }),
    };
  }

  function researchHistoryRequestUrl(baseUrl, ticker, cachedValue = null, forceFull = false) {
    const query = new URLSearchParams({ ticker: String(ticker || "").trim().toUpperCase() });
    const latestDate = String(cachedValue?.latestDate || "").slice(0, 10);
    if (!forceFull && /^\d{4}-\d{2}-\d{2}$/.test(latestDate)) query.set("since", latestDate);
    if (forceFull) query.set("full", "1");
    return `${baseUrl}?${query}`;
  }

  const stockResearchHistoryCache = Object.freeze({
    HISTORY_CACHE_SCHEMA,
    HISTORY_QUALITY_VERSION,
    configureCacheLifecycle,
    configureMarketCalendar,
    configureTickerPriceRuntime,
    mergeResearchHistoryPayload,
    mergeUniversePointIntoHistoryCache,
    normalizeHistoryCacheRecord,
    normalizeResearchHistoryRows,
    researchHistoryRequestUrl,
  });

module.exports = stockResearchHistoryCache;
