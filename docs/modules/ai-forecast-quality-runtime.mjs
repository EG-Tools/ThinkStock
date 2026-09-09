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
  const DECISION_HORIZONS = Object.freeze([20, 63, 126]);
  const DECISION_COMPONENT_LABELS = Object.freeze({
    localModel: "가격 흐름",
    top400Blend: "유사 종목",
    empiricalGuardrail: "경험 보정",
    corporateRiskGate: "기업위험 제한",
    criticalNewsGate: "중대 뉴스",
    consensus: "컨센서스",
    fundamentals: "실적",
    internetNews: "뉴스",
    brokerResearch: "증권사 리포트",
    marketRegime: "시장 국면",
    corporateRisk: "공시 위험",
    rotation: "수급 순환",
    rangeMeanReversion: "평균회귀",
    terminalRisk: "장기 위험",
    finalClamp: "안전 제한",
    analogPath: "유사 경로",
    journalCalibration: "사후 검증",
  });
  const DECISION_SOURCE_LABELS = Object.freeze({
    price: "가격",
    market: "시장",
    rotation: "수급",
    macro: "거시지표",
    auxiliary: "보조지표",
    vkospi: "VKOSPI",
    credit: "신용",
    crisis: "위기지표",
    disclosure: "공시",
    internetNews: "뉴스",
    consensus: "컨센서스",
    financials: "실적",
    brokerResearch: "증권사 리포트",
  });

  function decisionFinite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function decisionClamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  function signedPercentPoints(value) {
    const number = decisionFinite(value);
    if (number === null) return "-";
    const points = number * 100;
    return `${points > 0 ? "+" : ""}${points.toFixed(1)}%p`;
  }

  function simpleReturnFromLog(value) {
    const number = decisionFinite(value);
    return number === null ? null : Math.expm1(number);
  }

  function simpleReturnDifference(currentLogReturn, previousLogReturn) {
    const current = simpleReturnFromLog(currentLogReturn);
    const previous = simpleReturnFromLog(previousLogReturn);
    return current === null || previous === null ? null : current - previous;
  }

  function componentReturnContribution(expectedLogReturn, componentLogReturn) {
    const expected = decisionFinite(expectedLogReturn);
    const component = decisionFinite(componentLogReturn);
    return expected === null || component === null
      ? null
      : Math.expm1(expected) - Math.expm1(expected - component);
  }

  function horizonValue(source, horizon) {
    return source?.[horizon] || source?.[String(horizon)] || null;
  }

  function horizonDecision(forecast, profile, horizon) {
    const local = (forecast?.model?.horizons || []).find((row) => Number(row?.days) === horizon) || {};
    const journal = horizonValue(profile?.horizons, horizon) || {};
    const localSamples = Math.max(0, Number(local.validationSamples) || 0);
    const journalSamples = Math.max(0, Number(journal.effectiveSamples ?? journal.samples) || 0);
    const directionAccuracy = decisionFinite(journal.directionAccuracy)
      ?? decisionFinite(local.directionAccuracy);
    const localReliability = decisionFinite(local.reliability);
    const confidenceScale = Math.min(
      decisionClamp(profile?.qualityConfidenceScale ?? 1, 0, 1),
      decisionClamp(profile?.inputReliability?.confidenceScale ?? 1, 0, 1),
      decisionClamp(journal.confidenceScale ?? 1, 0, 1),
      decisionClamp(journal.probability?.confidenceScale ?? 1, 0, 1),
    );
    const holdReasons = [];
    if (profile?.inputReliability?.status === "weak") holdReasons.push("입력 신뢰 약함");
    if (localSamples < 12) holdReasons.push("검증 표본 부족");
    if (directionAccuracy !== null && directionAccuracy < 0.45) holdReasons.push("방향 검증 약함");
    if (localReliability !== null && localReliability < 0.25) holdReasons.push("모델 신뢰 약함");
    if (journal.walkForward?.applied === true && journal.walkForward.passed === false) {
      holdReasons.push("순차 검증 실패");
    }
    const skillVsNoChange = decisionFinite(journal.skillVsNoChange);
    if (journalSamples >= 8 && skillVsNoChange !== null && skillVsNoChange < 0) {
      holdReasons.push("무변화 기준 미달");
    }
    let status = "usable";
    if (holdReasons.length) status = "hold";
    else if (journalSamples < 8
      || confidenceScale < 0.82
      || (directionAccuracy !== null && directionAccuracy < 0.52)
      || (localReliability !== null && localReliability < 0.45)) status = "limited";
    return Object.freeze({
      horizon,
      status,
      label: status === "hold" ? "보류" : (status === "limited" ? "제한" : "참고"),
      localSamples,
      journalSamples,
      directionAccuracy,
      confidenceScale,
      reasons: Object.freeze(holdReasons),
    });
  }

  function previousForecastRecord(records, forecast) {
    const asOf = String(forecast?.dates?.[0] || forecast?.asOf || "").slice(0, 10);
    const modelVersion = String(forecast?.model?.version || "");
    const eligible = (Array.isArray(records) ? records : []).filter((record) => (
      String(record?.asOf || "").slice(0, 10) < asOf
    ));
    const sameModel = eligible.filter((record) => String(record?.modelVersion || "") === modelVersion);
    return (sameModel.length ? sameModel : eligible)
      .sort((left, right) => String(right?.asOf || "").localeCompare(String(left?.asOf || "")))[0]
      || null;
  }

  function attributionAt(source, horizon) {
    return horizonValue(source?.attribution?.horizons, horizon)
      || horizonValue(source?.horizons, horizon)?.attribution
      || null;
  }

  function rankedComponents(currentAttribution, previousAttribution = null) {
    const current = currentAttribution?.components || {};
    const previous = previousAttribution?.components || {};
    const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
    return [...keys].map((key) => ({
      label: DECISION_COMPONENT_LABELS[key] || key,
      current: decisionFinite(current[key]) || 0,
      delta: previousAttribution
        ? (decisionFinite(current[key]) || 0) - (decisionFinite(previous[key]) || 0)
        : null,
    }));
  }

  function changedSourceLabels(currentAudit, previousAudit) {
    if (!previousAudit) return [];
    const current = currentAudit?.sourceDates || {};
    const previous = previousAudit?.sourceDates || {};
    return Object.keys(DECISION_SOURCE_LABELS).filter((key) => (
      String(current[key] || "") > String(previous[key] || "")
    )).map((key) => DECISION_SOURCE_LABELS[key]);
  }

  function buildForecastDecisionSupport(options = {}) {
    const forecast = options.forecast || null;
    const profile = options.profile || null;
    if (!forecast) return null;
    const horizons = (options.horizons || DECISION_HORIZONS)
      .map((horizon) => horizonDecision(forecast, profile, Number(horizon)));
    const horizonLine = `기간별 신뢰 · ${horizons.map((row) => `${row.horizon}일 ${row.label}`).join(" / ")}`;
    const previous = previousForecastRecord(options.records, forecast);
    const currentAttribution = attributionAt(forecast, 126);
    const previousAttribution = attributionAt(previous, 126);
    const components = rankedComponents(currentAttribution, previousAttribution);
    const rankedChanges = components
      .filter((row) => row.delta !== null && Math.abs(row.delta) >= 0.001)
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
    const rankedCurrent = components
      .filter((row) => Math.abs(row.current) >= 0.001)
      .sort((left, right) => Math.abs(right.current) - Math.abs(left.current));
    const currentExpected = decisionFinite(currentAttribution?.expectedLogReturn) || 0;
    const previousExpected = decisionFinite(previousAttribution?.expectedLogReturn);
    const change = previousExpected === null
      ? null
      : simpleReturnDifference(currentExpected, previousExpected);
    const factorRows = (previous ? rankedChanges : rankedCurrent)
      .slice(0, 2)
      .map((row) => `${row.label} ${signedPercentPoints(componentReturnContribution(
        currentExpected,
        previous ? row.delta : row.current,
      ))}`);
    const changeLine = previous
      ? `전회 대비 126일 전망 ${signedPercentPoints(change)}${factorRows.length ? ` · ${factorRows.join(" · ")}` : ""}`
      : `현재 126일 주요 영향${factorRows.length ? ` · ${factorRows.join(" · ")}` : " · 기록 축적 중"}`;
    const freshSources = changedSourceLabels(forecast.audit, previous?.audit);
    const opposing = rankedCurrent.filter((row) => (
      currentExpected >= 0 ? row.current < -0.001 : row.current > 0.001
    )).slice(0, 2).map((row) => row.label);
    const evidenceParts = [];
    if (freshSources.length) evidenceParts.push(`새 근거 ${freshSources.slice(0, 3).join("·")}`);
    if (opposing.length) evidenceParts.push(`반대 근거 ${opposing.join("·")}`);
    const staleSources = (profile?.inputReliability?.staleSources || [])
      .map((key) => DECISION_SOURCE_LABELS[key] || key)
      .slice(0, 3);
    const recheckSubjects = staleSources.length
      ? staleSources
      : [...new Set([...opposing, "가격", "공시·실적"])].slice(0, 3);
    return Object.freeze({
      format: "ai-decision-support-v1",
      horizons: Object.freeze(horizons),
      previousAsOf: String(previous?.asOf || ""),
      change,
      freshSources: Object.freeze(freshSources),
      opposingFactors: Object.freeze(opposing),
      hoverLines: Object.freeze([
        horizonLine,
        changeLine,
        evidenceParts.join(" · "),
        `재검토 · ${recheckSubjects.join("·")} 최신값 또는 방향 변경 시`,
      ].filter(Boolean)),
    });
  }

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
    const onRemoteError = options.onRemoteError || (() => undefined);
    const isRemoteRetryable = options.isRemoteRetryable || ((error) => {
      const status = Number(error?.status);
      return !Number.isFinite(status) || status === 408 || status === 429 || status >= 500;
    });
    const now = options.now || Date.now;
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope) || setTimeout;
    const remoteRetryAttempts = Math.max(1, Math.min(
      3,
      Math.trunc(Number(options.remoteRetryAttempts) || 2),
    ));
    const requestedRemoteRetryDelay = Number(options.remoteRetryDelayMs);
    const remoteRetryDelayMs = Math.max(
      0,
      Number.isFinite(requestedRemoteRetryDelay) ? requestedRemoteRetryDelay : 500,
    );
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
      remoteReads: 0,
      remoteWrites: 0,
      remoteRetries: 0,
      remoteFailures: 0,
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

    async function runRemote(operation, phase) {
      let lastError = null;
      for (let attempt = 1; attempt <= remoteRetryAttempts; attempt += 1) {
        try {
          const result = await operation();
          if (result === false) {
            const error = new Error(`AI forecast journal ${phase} failed`);
            error.status = 503;
            throw error;
          }
          return result;
        } catch (error) {
          lastError = error;
          if (attempt >= remoteRetryAttempts || !isRemoteRetryable(error)) break;
          counters.remoteRetries += 1;
          if (remoteRetryDelayMs > 0) {
            await new Promise((resolve) => setTimer(resolve, remoteRetryDelayMs));
          }
        }
      }
      counters.remoteFailures += 1;
      try { onRemoteError(lastError, { phase }); } catch (_) {}
      throw lastError || new Error(`AI forecast journal ${phase} failed`);
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
      const transformed = currentFeature.forecast.applyChartTransform(calibrated, forecastOptions);
      const decisionSupport = buildForecastDecisionSupport({
        forecast: transformed,
        profile,
        records: ownRecords,
        ticker: key,
      }) || null;
      return decisionSupport ? { ...transformed, decisionSupport } : transformed;
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
          counters.remoteReads += 1;
          try {
            records = currentFeature.journal.mergeForecastRecords(
              records,
              remoteRecords(await runRemote(() => readRemote(key), "read")),
            );
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
          counters.remoteWrites += 1;
          try { await runRemote(() => writeRemote(key, records), "write"); } catch (_) {}
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
    buildForecastDecisionSupport,
    createAiForecastQualityRuntime,
    horizonDecision,
    normalizeTicker,
    replaceTickerRecords,
  });

export {
  buildForecastDecisionSupport,
  createAiForecastQualityRuntime,
  horizonDecision,
  normalizeTicker,
  replaceTickerRecords,
};
export default aiForecastQualityRuntime;
