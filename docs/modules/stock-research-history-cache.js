(function initThinkStockStockResearchHistoryCache(globalScope) {
  "use strict";

  const contract = globalScope.ThinkStockStockResearchContract;
  if (!contract) throw new Error("stock research contract failed to load");
  const { HISTORY_CACHE_SCHEMA } = contract;
  const MINIMUM_HISTORY_ROWS = contract.RECENT_SIGNAL_WINDOW;
  const cacheLifecycle = globalScope.ThinkStockCacheLifecyclePolicy;
  if (!cacheLifecycle?.withCacheMetadata) throw new Error("cache lifecycle policy is required");
  const isKoreanMarketPricePoint = globalScope.ThinkStockMarketCalendar?.isKoreanMarketPricePoint
    || (() => true);

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
    const key = String(ticker || "").trim().toUpperCase();
    if (!value || value.schema !== HISTORY_CACHE_SCHEMA || value.ticker !== key) return null;
    const rows = normalizeResearchHistoryRows(value.rows);
    if (rows.length < MINIMUM_HISTORY_ROWS) return null;
    const integrity = globalScope.ThinkStockTickerPriceRuntime
      ?.inspectPriceHistoryIntegrity?.(rows);
    if (integrity && !integrity.clean) return null;
    const latestDate = rows.at(-1)?.date || "";
    const fingerprint = cacheLifecycle.contentFingerprint(rows);
    const issue = cacheLifecycle.cacheMetadataIssue(value, {
      source: "stock-research-history",
      revision: String(HISTORY_CACHE_SCHEMA),
      contentFingerprint: fingerprint,
      allowMissingTimestamp: true,
    });
    if (issue) return null;
    return cacheLifecycle.withCacheMetadata({
      ...value,
      schema: HISTORY_CACHE_SCHEMA,
      ticker: key,
      latestDate,
      rows,
    }, {
      source: "stock-research-history",
      asOf: latestDate,
      revision: String(HISTORY_CACHE_SCHEMA),
      contentFingerprint: fingerprint,
    });
  }

  function withHistoryMetadata(record, now = Date.now()) {
    return cacheLifecycle.withCacheMetadata(record, {
      source: "stock-research-history",
      asOf: record?.latestDate,
      revision: String(HISTORY_CACHE_SCHEMA),
      contentFingerprint: cacheLifecycle.contentFingerprint(record?.rows || []),
      now,
      savedAt: now,
      touch: true,
    });
  }

  function mergeResearchHistoryPayload(cachedValue, payload, ticker) {
    const key = String(ticker || "").trim().toUpperCase();
    const cachedRecord = normalizeHistoryCacheRecord(cachedValue, key);
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
          savedAt: Date.now(),
          lastAccessed: Date.now(),
          rows,
        }),
      };
    }

    const fromTime = Date.parse(`${latest.date}T00:00:00Z`);
    const toTime = Date.parse(`${date}T00:00:00Z`);
    const maxGapDays = Math.max(1, Number(options.maxGapDays) || 14);
    const ratioThreshold = Math.max(1.1, Number(options.ratioThreshold) || 1.8);
    const gapDays = Math.round((toTime - fromTime) / 86400000);
    const ratio = Math.max(close / latest.close, latest.close / close);
    if (!Number.isFinite(gapDays) || gapDays > maxGapDays || !Number.isFinite(ratio) || ratio >= ratioThreshold) {
      return null;
    }
    return {
      changed: true,
      record: withHistoryMetadata({
        ...record,
        asOfDate: date,
        latestDate: date,
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

  globalScope.ThinkStockStockResearchHistoryCache = Object.freeze({
    HISTORY_CACHE_SCHEMA,
    mergeResearchHistoryPayload,
    mergeUniversePointIntoHistoryCache,
    normalizeHistoryCacheRecord,
    normalizeResearchHistoryRows,
    researchHistoryRequestUrl,
  });
}(typeof self !== "undefined" ? self : globalThis));
