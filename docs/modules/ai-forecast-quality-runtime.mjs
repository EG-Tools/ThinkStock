"use strict";

  const STOCK_TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const EMPTY_QUALITY_SUMMARY = Object.freeze({
    seriesCount: 0,
    statuses: Object.freeze({}),
    weakSeries: Object.freeze([]),
    byContext: Object.freeze({}),
    byCohort: Object.freeze({}),
    byShock: Object.freeze({}),
    series: Object.freeze({}),
  });

  function normalizeTicker(value) {
    const ticker = String(value || "").trim().toUpperCase();
    return STOCK_TICKER_PATTERN.test(ticker) ? ticker : "";
  }

  function replaceTickerRecords(pool, ticker, records) {
    const key = normalizeTicker(ticker);
    if (!key) return Array.isArray(pool) ? [...pool] : [];
    return [
      ...(Array.isArray(pool) ? pool : []).filter((record) => record?.ticker !== key),
      ...(Array.isArray(records) ? records : []),
    ];
  }

  function recordSignature(records) {
    try {
      return JSON.stringify(Array.isArray(records) ? records : []);
    } catch (_) {
      return "";
    }
  }

  function createAiForecastQualityRuntime(scope = globalThis, options = {}) {
    const getFeature = options.getFeature;
    const readTicker = options.readTicker || (async () => null);
    const writeTicker = options.writeTicker || (async () => false);
    const readAll = options.readAll || (async () => []);
    const isActivePayload = options.isActivePayload || (() => true);
    const schedulePrune = options.schedulePrune || (() => Promise.resolve(false));
    const isRemoteEnabled = options.isRemoteEnabled || (() => false);
    const readRemote = options.readRemote || (async () => []);
    const writeRemote = options.writeRemote || (async () => false);
    const now = options.now || Date.now;
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope) || setTimeout;
    const poolTtlMs = Math.max(0, Number(options.poolTtlMs) || 30000);
    const maxDiagnostics = Math.max(1, Math.trunc(Number(options.maxDiagnostics) || 24));
    const maxQueued = Math.max(1, Math.trunc(Number(options.maxQueued) || 120));
    const recordsByTicker = new Map();
    const persistedSignatures = new Map();
    const readPromises = new Map();
    const writePromises = new Map();
    const syncPromises = new Map();
    const queued = new Set();
    const poolOverlays = new Map();
    const diagnostics = new Map();
    let poolCache = { loaded: false, expiresAt: 0, records: [] };
    let poolPromise = null;
    const counters = {
      tickerReads: 0,
      tickerReadHits: 0,
      tickerReadCoalesced: 0,
      tickerWrites: 0,
      tickerWriteSkips: 0,
      poolReads: 0,
      poolHits: 0,
      poolReadCoalesced: 0,
      syncs: 0,
      syncCoalesced: 0,
      calibrationRuns: 0,
      calibrationApplied: 0,
      calibrationPending: 0,
      correctionEligibleHorizons: 0,
      walkForwardRejectedHorizons: 0,
      staleInputRuns: 0,
    };

    function feature() {
      return typeof getFeature === "function" ? getFeature() : null;
    }

    function normalizeRecords(values) {
      const journal = feature()?.journal;
      return journal?.mergeForecastRecords
        ? journal.mergeForecastRecords([], Array.isArray(values) ? values : [])
        : [];
    }

    async function readTickerRecords(ticker) {
      const key = normalizeTicker(ticker);
      if (!key) return [];
      if (recordsByTicker.has(key)) {
        counters.tickerReadHits += 1;
        return recordsByTicker.get(key);
      }
      if (readPromises.has(key)) {
        counters.tickerReadCoalesced += 1;
        return readPromises.get(key);
      }
      counters.tickerReads += 1;
      const task = Promise.resolve(readTicker(key))
        .then((payload) => normalizeRecords(payload?.records || []))
        .catch(() => [])
        .then((records) => {
          recordsByTicker.set(key, records);
          persistedSignatures.set(key, recordSignature(records));
          return records;
        })
        .finally(() => {
          if (readPromises.get(key) === task) readPromises.delete(key);
        });
      readPromises.set(key, task);
      return task;
    }

    function updatePoolTicker(ticker, records) {
      const key = normalizeTicker(ticker);
      if (!key) return;
      poolOverlays.set(key, records);
      if (!poolCache.loaded) return;
      poolCache = {
        loaded: true,
        expiresAt: now() + poolTtlMs,
        records: replaceTickerRecords(poolCache.records, key, records),
      };
    }

    async function writeTickerRecords(ticker, values) {
      const key = normalizeTicker(ticker);
      const journal = feature()?.journal;
      if (!key || !journal?.mergeForecastRecords) return [];
      const previous = writePromises.get(key) || Promise.resolve();
      let task;
      task = previous.catch(() => undefined).then(async () => {
        const current = recordsByTicker.has(key)
          ? recordsByTicker.get(key)
          : await readTickerRecords(key);
        const records = journal.mergeForecastRecords(current, Array.isArray(values) ? values : []);
        const signature = recordSignature(records);
        recordsByTicker.set(key, records);
        updatePoolTicker(key, records);
        if (signature && signature === persistedSignatures.get(key)) {
          counters.tickerWriteSkips += 1;
          return records;
        }
        const savedAt = now();
        try {
          await writeTicker(key, {
            schema: journal.SCHEMA_VERSION,
            ticker: key,
            savedAt,
            lastAccessed: savedAt,
            records,
          });
          persistedSignatures.set(key, signature);
          counters.tickerWrites += 1;
          Promise.resolve(schedulePrune()).catch(() => false);
        } catch (_) {
          // Persistence is an optimization; keep the current session usable.
        }
        return records;
      }).finally(() => {
        if (writePromises.get(key) === task) writePromises.delete(key);
      });
      writePromises.set(key, task);
      return task;
    }

    async function readPoolRecords() {
      if (poolCache.loaded && now() < poolCache.expiresAt) {
        counters.poolHits += 1;
        return poolCache.records;
      }
      if (poolPromise) {
        counters.poolReadCoalesced += 1;
        return poolPromise;
      }
      counters.poolReads += 1;
      poolPromise = Promise.resolve(readAll())
        .then((payloads) => (Array.isArray(payloads) ? payloads : [])
          .filter((payload) => isActivePayload(payload))
          .flatMap((payload) => (Array.isArray(payload?.records) ? payload.records : []))
          .map((record) => feature()?.journal?.normalizeForecastRecord?.(record))
          .filter(Boolean))
        .catch(() => [])
        .then((loadedRecords) => {
          let records = loadedRecords;
          poolOverlays.forEach((tickerRecords, ticker) => {
            records = replaceTickerRecords(records, ticker, tickerRecords);
          });
          poolCache = { loaded: true, expiresAt: now() + poolTtlMs, records };
          return records;
        })
        .finally(() => { poolPromise = null; });
      return poolPromise;
    }

    function rememberDiagnostic(ticker, diagnostic) {
      const key = normalizeTicker(ticker);
      if (!key || !diagnostic) return;
      diagnostics.delete(key);
      diagnostics.set(key, diagnostic);
      while (diagnostics.size > maxDiagnostics) {
        diagnostics.delete(diagnostics.keys().next().value);
      }
    }

    async function calibrate(ticker, forecast, historyRows, forecastOptions) {
      const key = normalizeTicker(ticker);
      const currentFeature = feature();
      if (!forecast || !key || !currentFeature?.journal || !currentFeature?.calibration) return forecast;
      const priceHistory = (Array.isArray(historyRows) ? historyRows : []).map((row) => ({
        date: row?.date,
        close: row?.[key],
      }));
      const ownRecords = currentFeature.journal
        .scoreForecastRecords(await readTickerRecords(key), priceHistory)
        .filter(Boolean);
      if (ownRecords.length) await writeTickerRecords(key, ownRecords);
      let records = await readPoolRecords();
      records = replaceTickerRecords(records, key, ownRecords);
      poolCache = { loaded: true, expiresAt: now() + poolTtlMs, records };
      poolOverlays.set(key, ownRecords);
      const quality = currentFeature.journal.summarizeForecastQuality(records, {
        asOf: forecast?.dates?.[0] || forecast?.asOf,
      });
      const profile = currentFeature.calibration.buildCalibrationProfile({
        ticker: key,
        forecast,
        records,
        quality,
      });
      const horizonRows = Object.values(profile?.horizons || {});
      counters.calibrationRuns += 1;
      if (profile?.applied) counters.calibrationApplied += 1;
      if (!(Number(profile?.totalSamples) > 0)) counters.calibrationPending += 1;
      counters.correctionEligibleHorizons += horizonRows
        .filter((row) => row?.correctionEligible === true).length;
      counters.walkForwardRejectedHorizons += horizonRows
        .filter((row) => row?.walkForward?.applied === true && row.walkForward.passed === false).length;
      if ((profile?.inputReliability?.staleSources || []).length) counters.staleInputRuns += 1;
      rememberDiagnostic(key, currentFeature.calibration.buildForecastQualityDiagnostic(
        profile,
        quality,
        { asOf: quality?.asOf || forecast?.dates?.[0] || forecast?.asOf },
      ));
      const calibrated = currentFeature.calibration.applyForecastCalibration(forecast, profile);
      return currentFeature.forecast.applyChartTransform(calibrated, forecastOptions);
    }

    function remoteRecords(payload) {
      if (Array.isArray(payload)) return payload;
      return payload?.records || payload?.journal?.records || [];
    }

    async function sync(ticker, forecast, historyRows) {
      const key = normalizeTicker(ticker);
      const currentFeature = feature();
      const record = currentFeature?.journal?.buildForecastRecord?.({
        ticker: key,
        modelVersion: forecast?.model?.version || forecast?.model?.name || "local-v1",
        forecast,
      });
      if (!record) return null;
      if (syncPromises.has(record.id)) {
        counters.syncCoalesced += 1;
        return syncPromises.get(record.id);
      }
      counters.syncs += 1;
      const task = (async () => {
        let records = await readTickerRecords(key);
        if (isRemoteEnabled()) {
          try {
            records = currentFeature.journal.mergeForecastRecords(records, remoteRecords(await readRemote(key)));
          } catch (_) {}
        }
        const priceHistory = (Array.isArray(historyRows) ? historyRows : []).map((row) => ({
          date: row?.date,
          close: row?.[key],
        }));
        records = currentFeature.journal
          .scoreForecastRecords(currentFeature.journal.mergeForecastRecords(records, [record]), priceHistory)
          .filter(Boolean);
        records = await writeTickerRecords(key, records);
        if (isRemoteEnabled()) {
          try { await writeRemote(key, records); } catch (_) {}
        }
        return records;
      })().finally(() => syncPromises.delete(record.id));
      syncPromises.set(record.id, task);
      return task;
    }

    function queue(ticker, forecast, historyRows) {
      const key = normalizeTicker(ticker);
      const queueKey = `${key}:${forecast?.dates?.[0] || ""}:${forecast?.model?.version || ""}`;
      if (!key || queued.has(queueKey)) return false;
      queued.add(queueKey);
      while (queued.size > maxQueued) queued.delete(queued.values().next().value);
      setTimer(() => {
        sync(key, forecast, historyRows).catch(() => queued.delete(queueKey));
      }, 0);
      return true;
    }

    function summarizeDiagnostics() {
      const summarize = feature()?.calibration?.summarizeForecastQualityDiagnostics;
      return typeof summarize === "function" ? summarize(diagnostics) : EMPTY_QUALITY_SUMMARY;
    }

    function invalidateTicker(ticker) {
      const key = normalizeTicker(ticker);
      if (!key) return false;
      recordsByTicker.delete(key);
      persistedSignatures.delete(key);
      poolOverlays.delete(key);
      diagnostics.delete(key);
      if (poolCache.loaded) {
        poolCache = {
          ...poolCache,
          records: replaceTickerRecords(poolCache.records, key, []),
        };
      }
      return true;
    }

    return Object.freeze({
      calibrate,
      invalidateTicker,
      queue,
      readPoolRecords,
      readTickerRecords,
      summarizeDiagnostics,
      sync,
      stats: () => Object.freeze({
        ...counters,
        cachedTickers: recordsByTicker.size,
        diagnostics: diagnostics.size,
        pendingReads: readPromises.size,
        pendingWrites: writePromises.size,
        pendingSyncs: syncPromises.size,
        queued: queued.size,
        poolLoaded: poolCache.loaded,
        poolRecords: poolCache.records.length,
      }),
    });
  }

  const aiForecastQualityRuntime = Object.freeze({
    createAiForecastQualityRuntime,
    normalizeTicker,
    replaceTickerRecords,
  });

export {
  createAiForecastQualityRuntime,
  normalizeTicker,
  replaceTickerRecords,
};
export default aiForecastQualityRuntime;
