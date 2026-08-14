(function initThinkStockRuntimeRefreshOrchestrator(globalScope) {
  "use strict";

  function planRuntimeRefreshRendering(before = {}, after = {}) {
    const changed = (name) => Number(after?.[name]) !== Number(before?.[name]);
    const mainDataChanged = ["price", "macro", "credit", "crisis"].some(changed);
    const adrDataChanged = changed("adr");
    const disclosureDataChanged = changed("disclosure");
    return Object.freeze({
      mainDataChanged,
      adrDataChanged,
      disclosureDataChanged,
      renderAuxiliaryOnly: adrDataChanged && !mainDataChanged,
      renderDisclosureOnly: disclosureDataChanged && !mainDataChanged,
    });
  }

  function createRuntimeRefreshOrchestrator(options = {}) {
    const {
      applyRuntimeRefreshChanges,
      canUseDartGateway,
      cancelAdrFinalRetry,
      chartSession,
      getDataRevisions,
      isAbortError,
      isRetryableAdrRefreshError,
      preloadCustomStocks,
      recordPerfSample,
      refreshAdrFromWebWithRetry,
      refreshCoreIndexSeries,
      refreshCreditFromGateway,
      refreshCrisisSignalFromGateway,
      refreshDartDisclosuresForVisibleTickersFromApi,
      refreshEcosMacroFromGateway,
      refreshFearGreedFromWeb,
      fetchCriticalRuntimeBootstrap,
      refreshSourceWithRetry,
      runRefreshPhases,
      runtimeDataApp,
      scheduleAdrFinalRetry,
      scheduleLastRuntimeSnapshotSave,
      setMessage,
      setRuntimeRefreshStatus,
      startPerfSample,
      state,
      throwIfAborted,
    } = options;
    if (!state || !chartSession || !runtimeDataApp) {
      throw new Error("runtime refresh orchestrator dependencies are incomplete");
    }

    async function run(msgEl, options = {}) {
      cancelAdrFinalRetry();
      const revisionsBeforeRefresh = getDataRevisions();
      const perfStartedAt = startPerfSample();
      const infoLines = [];
      const warnLines = [];
      let refreshedDart = false;
      let phaseRevisions = revisionsBeforeRefresh;
      let mainDataChanged = false;
      let adrDataChanged = false;
      let disclosureDataChanged = false;
      const forceNetwork = Boolean(options?.forceNetwork);
      const signal = options?.signal || null;
      const sourceAttemptDecisions = new Map();
      const sourceAttempt = (source) => {
        if (!sourceAttemptDecisions.has(source)) {
          sourceAttemptDecisions.set(source, runtimeDataApp.canAttemptSource?.(source, {
            force: forceNetwork,
          }) || { allowed: true, waitMs: 0 });
        }
        return sourceAttemptDecisions.get(source);
      };
      setRuntimeRefreshStatus("loading", "가격·지수 최신분 확인 중");
      const trackSource = (source, task, skippedResult = {}) => {
        const sourceStartedAt = startPerfSample();
        const attempt = sourceAttempt(source);
        if (attempt.allowed === false) {
          recordPerfSample(`runtimeSource:${source}`, sourceStartedAt, {
            ok: true,
            skipped: true,
            waitMs: attempt.waitMs,
          });
          return Promise.resolve({ ...skippedResult, skipped: true });
        }
        return Promise.resolve()
          .then(task)
          .then((result) => {
            if (typeof runtimeDataApp.noteSourceResult === "function") {
              runtimeDataApp.noteSourceResult(source, result);
            } else {
              runtimeDataApp.noteSourceSuccess?.(source, {
                latestDate: result?.latestDate || result?.sourceLatestDate || "",
                detail: (result?.applied || result?.info || []).join?.(" · ") || "",
              });
            }
            recordPerfSample(`runtimeSource:${source}`, sourceStartedAt, { ok: true });
            return result;
          }, (error) => {
            runtimeDataApp.noteSourceFailure?.(source, error);
            recordPerfSample(`runtimeSource:${source}`, sourceStartedAt, {
              ok: false,
              error: String(error?.message || error || "unknown").slice(0, 120),
            });
            throw error;
          });
      };

      let releaseHiddenPriceRefresh = null;
      const hiddenPriceGate = new Promise((resolve) => { releaseHiddenPriceRefresh = resolve; });
      let criticalStarted = 0;
      let criticalCompleted = 0;
      const criticalTotal = 2;
      const reportCriticalProgress = (source, percent = null) => {
        if (typeof options?.onCriticalProgress !== "function") return;
        const value = Number.isFinite(percent)
          ? percent
          : 88 + ((criticalCompleted / criticalTotal) * 4);
        try {
          options.onCriticalProgress({
            source,
            completed: criticalCompleted,
            total: criticalTotal,
            percent: Math.min(96, value),
          });
        } catch (_) {}
      };
      const criticalTask = (source, task) => async () => {
        criticalStarted += 1;
        reportCriticalProgress(source, 84 + ((criticalStarted / criticalTotal) * 4));
        try {
          return await task();
        } finally {
          criticalCompleted += 1;
          reportCriticalProgress(source);
        }
      };

      let criticalBootstrapPromise = null;
      const criticalBootstrap = () => {
        if (typeof fetchCriticalRuntimeBootstrap !== "function") return Promise.resolve(null);
        if (sourceAttempt("indices").allowed === false && sourceAttempt("prices").allowed === false) {
          return Promise.resolve(null);
        }
        if (!criticalBootstrapPromise) {
          const startedAt = startPerfSample();
          criticalBootstrapPromise = Promise.resolve()
            .then(() => fetchCriticalRuntimeBootstrap({ forceNetwork, signal }))
            .then((payload) => {
              recordPerfSample("runtimeSource:bootstrap", startedAt, {
                ok: Boolean(payload),
                fallback: !payload,
              });
              return payload;
            });
        }
        return criticalBootstrapPromise;
      };
    
      const coreIndexTask = async () => {
        const bootstrap = await criticalBootstrap();
        try {
          const result = await trackSource("indices", () => refreshSourceWithRetry(
            "indices",
            () => refreshCoreIndexSeries({
              signal,
              forceNetwork,
              ...(bootstrap?.indices?.ok === true ? { payload: bootstrap.indices } : {}),
            }),
            signal,
          ), { applied: [], warnings: [] });
          return { info: result.applied || [], warnings: result.warnings || [] };
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) throw error;
          return { info: [], warnings: [`KRX 지수 갱신 오류: ${error.message}`] };
        }
      };
    
      const preloadTask = async () => {
        const bootstrap = await criticalBootstrap();
        try {
        const result = await trackSource(
          "prices",
          () => preloadCustomStocks({
            forceRefresh: forceNetwork,
            signal,
            scope: "visible",
            ...(bootstrap?.prices?.ok === true ? { priceBatchPayload: bootstrap.prices } : {}),
          }),
          { failedNames: [] },
        );
        return {
          info: [],
          warnings: result.failedNames.length
            ? [`일부 선택 종목을 불러오지 못했습니다: ${result.failedNames.join(", ")}`]
            : [],
        };
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) throw error;
          return { info: [], warnings: [`Price refresh failed: ${error.message}`] };
        }
      };

      const hiddenPriceTask = async () => {
        await hiddenPriceGate;
        throwIfAborted(signal);
        return trackSource(
          "prices-hidden",
          () => preloadCustomStocks({ forceRefresh: forceNetwork, signal, scope: "hidden" }),
          { failedNames: [] },
        ).then((result) => ({
          info: [],
          warnings: result.failedNames.length
            ? [`일부 비활성 종목을 불러오지 못했습니다: ${result.failedNames.join(", ")}`]
            : [],
        })).catch((error) => {
          if (isAbortError(error) || signal?.aborted) throw error;
          return { info: [], warnings: [`Background price refresh failed: ${error.message}`] };
        });
      };
    
      const adrTask = () => trackSource(
        "adr",
        () => refreshAdrFromWebWithRetry(signal, forceNetwork),
        { changed: 0, latestDate: "" },
      )
        .then(({ changed, latestDate }) => ({
          info: changed > 0 ? [`ADR ${changed}건 최신값 반영(~ ${latestDate})`] : [],
          warnings: [],
        }))
        .catch((adrErr) => {
          if (isAbortError(adrErr) || signal?.aborted) throw adrErr;
          if (isRetryableAdrRefreshError(adrErr)) {
            scheduleAdrFinalRetry(forceNetwork);
            return { info: ["ADR 백그라운드 재확인 예약"], warnings: [] };
          }
          return { info: [], warnings: [`ADR 불러오기 오류: ${adrErr.message}`] };
        });
    
      const fearGreedTask = () => trackSource("fearGreed", () => refreshSourceWithRetry(
        "fearGreed",
        () => refreshFearGreedFromWeb(signal),
        signal,
      ), { added: 0, latestDate: "" })
        .then(({ added, latestDate }) => ({
          info: added > 0 ? [`공포탐욕 최신값 반영(~ ${latestDate})`] : [],
          warnings: [],
        }))
        .catch((error) => ({ info: [], warnings: [`공포탐욕 불러오기 오류: ${error.message}`] }));
    
      const ecosTask = () => trackSource("macro", () => refreshSourceWithRetry(
        "macro",
        () => refreshEcosMacroFromGateway(signal, forceNetwork),
        signal,
      ), { applied: [], warnings: [] })
        .then((result) => ({ info: result.applied || [], warnings: result.warnings || [] }))
        .catch((error) => ({ info: [], warnings: [`ECOS 지표 불러오기 오류: ${error.message}`] }));
    
      const creditTask = () => {
        return trackSource("credit", () => refreshSourceWithRetry(
          "credit",
          () => refreshCreditFromGateway(signal, forceNetwork),
          signal,
        ), { applied: [], warnings: [] })
          .then((result) => ({ info: result.applied || [], warnings: result.warnings || [] }))
          .catch((error) => ({ info: [], warnings: [`신용·예탁금 불러오기 오류: ${error.message}`] }));
      };
    
      const crisisTask = () => trackSource("crisis", () => refreshSourceWithRetry(
        "crisis",
        () => refreshCrisisSignalFromGateway(signal, forceNetwork),
        signal,
      ), { applied: [], warnings: [] })
        .then((result) => ({ info: result.applied || [], warnings: result.warnings || [] }))
        .catch((error) => ({ info: [], warnings: [`침체 위기신호 불러오기 오류: ${error.message}`] }));
    
      const dartTask = () => {
        if (!forceNetwork || !canUseDartGateway()) {
          return Promise.resolve({ info: [], warnings: [], refreshed: false });
        }
        return trackSource("disclosure", () => refreshDartDisclosuresForVisibleTickersFromApi("gateway", {
          forceNetwork,
          signal,
        }), { fetched: 0, failed: [] }).then((result) => ({
          info: result.fetched > 0 ? [`DART 공시 ${result.fetched}건 확인`] : [],
          warnings: result.failed || [],
          refreshed: result.fetched > 0,
        })).catch((error) => ({
          info: [],
          warnings: [`DART 공시 오류: ${error.message}`],
          refreshed: false,
        }));
      };
    
      const collectResults = (results) => results.forEach((result) => {
        infoLines.push(...(result.info || []));
        warnLines.push(...(result.warnings || []));
      });
    
      const applyPhaseChanges = async (awaitMainRender = false) => {
        const changes = await applyRuntimeRefreshChanges(phaseRevisions, { awaitMainRender });
        phaseRevisions = changes.revisionsAfter;
        mainDataChanged = mainDataChanged || changes.mainDataChanged;
        adrDataChanged = adrDataChanged || changes.adrDataChanged;
        disclosureDataChanged = disclosureDataChanged || changes.disclosureDataChanged;
        return changes;
      };
    
      await runRefreshPhases({
        criticalTasks: [
          criticalTask("indices", coreIndexTask),
          criticalTask("prices-visible", preloadTask),
        ],
        supplementalTasks: [
          adrTask,
          fearGreedTask,
          dartTask,
          ecosTask,
          creditTask,
          crisisTask,
          hiddenPriceTask,
        ],
        onCritical: async (results) => {
          throwIfAborted(signal);
          collectResults(results);
          const changes = await applyPhaseChanges(Boolean(options?.awaitCriticalRender));
          reportCriticalProgress("chart", 96);
          runtimeDataApp.notePhase("criticalReady");
          setRuntimeRefreshStatus("loading", "가격·지수 반영 완료 · 보조지표 갱신 중");
          if (typeof options?.onCriticalReady === "function") {
            setMessage(msgEl, [
              ...infoLines,
              ...warnLines,
              "공시·보조지표를 백그라운드에서 갱신 중입니다.",
            ], false);
            await options.onCriticalReady({ changes, info: [...infoLines], warnings: [...warnLines] });
          }
          releaseHiddenPriceRefresh?.();
        },
        onSupplemental: async (results) => {
          throwIfAborted(signal);
          collectResults(results);
          refreshedDart = Boolean(results[2]?.refreshed);
          await applyPhaseChanges(false);
          runtimeDataApp.notePhase("supplementalReady");
        },
      });
    
      if (refreshedDart) {
        if (state.lastDisclosureTraceStats.markers > 0) {
          infoLines.push(`현재 차트에 공시 마커 ${state.lastDisclosureTraceStats.markers}개 표시됨`);
        } else if (chartSession.showDisclosures && state.disclosureRows.length) {
          warnLines.push("공시 데이터는 있지만 현재 차트 범위/켜진 종목에는 표시할 마커가 없습니다.");
        }
      }
      scheduleLastRuntimeSnapshotSave(1800);
      if (perfStartedAt) {
        recordPerfSample("runtimeRefresh", perfStartedAt, {
          mainDataChanged,
          adrDataChanged,
          disclosureDataChanged,
        });
      }
    
      if (infoLines.length || warnLines.length) {
        setMessage(msgEl, [...infoLines, ...warnLines], infoLines.length === 0);
      } else {
        setMessage(msgEl, []);
      }
      const timeText = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      setRuntimeRefreshStatus(
        "ready",
        warnLines.length ? `최신 확인 ${timeText} · 일부 항목은 이전 값 유지` : `최신 확인 ${timeText}`,
      );
    }

    return Object.freeze({ run });
  }

  globalScope.ThinkStockRuntimeRefreshOrchestrator = Object.freeze({
    createRuntimeRefreshOrchestrator,
    planRuntimeRefreshRendering,
  });
}(typeof self !== "undefined" ? self : globalThis));

// Retry and phase helpers belong to runtime refresh orchestration.
(function initThinkStockRuntimeRefresh(global) {
  function startTaskFactories(taskFactories) {
    return (Array.isArray(taskFactories) ? taskFactories : []).map((factory) => (
      Promise.resolve().then(() => factory())
    ));
  }

  async function runRefreshPhases(options = {}) {
    const criticalPromise = Promise.all(startTaskFactories(options.criticalTasks));
    const supplementalPromise = Promise.all(startTaskFactories(options.supplementalTasks));
    // Prevent an early supplemental rejection from becoming unhandled while critical work finishes.
    supplementalPromise.catch(() => {});

    const criticalResults = await criticalPromise;
    if (typeof options.onCritical === "function") await options.onCritical(criticalResults);

    const supplementalResults = await supplementalPromise;
    if (typeof options.onSupplemental === "function") await options.onSupplemental(supplementalResults);

    return { criticalResults, supplementalResults };
  }

  function abortReason(signal) {
    if (signal?.reason) return signal.reason;
    const error = new Error("Request aborted");
    error.name = "AbortError";
    return error;
  }

  function waitForRetryDelay(delayMs, signal, sleep) {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (typeof sleep === "function") {
      return Promise.resolve(sleep(delayMs, signal)).then(() => {
        if (signal?.aborted) throw abortReason(signal);
      });
    }

    return new Promise((resolve, reject) => {
      let timer = null;
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortReason(signal));
      };
      timer = setTimeout(() => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve();
      }, Math.max(0, Number(delayMs) || 0));
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });
  }

  async function retryWithDelays(task, options = {}) {
    const delaysMs = Array.isArray(options.delaysMs) ? options.delaysMs : [];
    let attempt = 0;
    while (true) {
      try {
        return await task(attempt);
      } catch (error) {
        const shouldRetry = typeof options.shouldRetry === "function"
          ? options.shouldRetry(error, attempt)
          : true;
        if (options.signal?.aborted || !shouldRetry || attempt >= delaysMs.length) throw error;
        await waitForRetryDelay(delaysMs[attempt], options.signal, options.sleep);
        if (options.signal?.aborted) throw abortReason(options.signal);
        attempt += 1;
      }
    }
  }

  function retryOnce(task, options = {}) {
    return retryWithDelays(task, { ...options, delaysMs: [options.delayMs] });
  }

  function isRetryableRuntimeError(error) {
    if (!error || error.name === "AbortError" || error.code === "RUNTIME_DATA_REJECTED") return false;
    const status = Number(error.status);
    if ([408, 425, 429].includes(status) || status >= 500) return true;
    if ([400, 401, 403, 404].includes(status)) return false;
    const message = String(error.message || error);
    if (/\b(?:400|401|403|404)\b|접속 코드|parse|parsing|invalid|validation|형식|불일치/i.test(message)) {
      return false;
    }
    return /\b(?:408|425|429|500|502|503|504)\b|failed to fetch|fetch failed|network|timed?\s*out|timeout|connection|econn/i.test(message);
  }

  function retryRuntimeSource(task, options = {}) {
    return retryWithDelays(task, {
      ...options,
      shouldRetry: options.shouldRetry || isRetryableRuntimeError,
    });
  }

  global.ThinkStockRuntimeRefresh = {
    isRetryableRuntimeError,
    retryOnce,
    retryRuntimeSource,
    retryWithDelays,
    runRefreshPhases,
    waitForDelay: waitForRetryDelay,
  };
}(typeof self !== "undefined" ? self : globalThis));
