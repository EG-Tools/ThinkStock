import { mapWithConcurrency } from "./shared-request-registry.mjs";
import { isRuntimeSourceKey } from "../../shared/runtime-source-contract.mjs";
import { APP_DATA_COMPONENT_GROUPS } from "./app-data-store.mjs";

"use strict";

  function planRuntimeRefreshRendering(before = {}, after = {}) {
    const changed = (name) => Number(after?.[name]) !== Number(before?.[name]);
    const changedIn = (group) => (group || []).some(changed);
    const priceDataChanged = changed("price");
    const derivedInputChanged = changedIn(APP_DATA_COMPONENT_GROUPS.analysis);
    const mainDataChanged = changedIn(APP_DATA_COMPONENT_GROUPS.mainChart);
    const adrDataChanged = changedIn(APP_DATA_COMPONENT_GROUPS.auxiliary);
    const disclosureDataChanged = changedIn(APP_DATA_COMPONENT_GROUPS.disclosure);
    return Object.freeze({
      mainDataChanged,
      priceDataChanged,
      derivedInputChanged,
      adrDataChanged,
      disclosureDataChanged,
      renderAuxiliaryOnly: adrDataChanged && !mainDataChanged,
      renderDisclosureOnly: disclosureDataChanged && !mainDataChanged,
    });
  }

  function partitionRuntimeRefreshSources(sourceTasks = [], options = {}) {
    const isForeground = typeof options.isForeground === "function"
      ? options.isForeground
      : () => true;
    const entries = (Array.isArray(sourceTasks) ? sourceTasks : []).map((entry) => ({
      ...entry,
      foreground: isForeground(entry?.source) !== false,
    }));
    return Object.freeze({
      foreground: Object.freeze(entries.filter((entry) => entry.foreground)),
      deferred: Object.freeze(options.includeDeferred === true
        ? entries.filter((entry) => !entry.foreground)
        : []),
    });
  }

  function planRuntimeRefreshSources(sourceTasks = [], options = {}) {
    const shouldRefresh = typeof options.shouldRefresh === "function"
      ? options.shouldRefresh
      : () => true;
    const uniqueEntries = [];
    const skipped = [];
    const knownSources = new Set();
    (Array.isArray(sourceTasks) ? sourceTasks : []).forEach((entry) => {
      const source = String(entry?.source || "").trim();
      if (!source || typeof entry?.task !== "function" || knownSources.has(source)) {
        if (source) skipped.push(Object.freeze({ ...entry, source, reason: "duplicate" }));
        return;
      }
      knownSources.add(source);
      if (shouldRefresh(source) === false) {
        skipped.push(Object.freeze({ ...entry, source, reason: "fresh" }));
        return;
      }
      uniqueEntries.push(Object.freeze({ ...entry, source }));
    });
    const partition = partitionRuntimeRefreshSources(uniqueEntries, options);
    return Object.freeze({
      foreground: partition.foreground,
      deferred: partition.deferred,
      skipped: Object.freeze(skipped),
    });
  }

  function normalizeRuntimeRefreshSourceResult(source, result = {}) {
    const value = result && typeof result === "object" ? result : {};
    return Object.freeze({
      ...value,
      source: String(source || value.source || ""),
      info: Object.freeze(Array.isArray(value.info) ? [...value.info] : []),
      warnings: Object.freeze(Array.isArray(value.warnings) ? [...value.warnings] : []),
    });
  }

  /** One execution contract for every supplemental runtime data source. */
  function createRuntimeRefreshSourceAdapter(definition = {}) {
    const source = String(definition.source || "").trim();
    if (!source || !isRuntimeSourceKey(source) || typeof definition.load !== "function") {
      throw new Error("runtime refresh source adapter is incomplete");
    }

    async function run(context = {}) {
      if (typeof definition.enabled === "function" && definition.enabled(context) !== true) {
        return normalizeRuntimeRefreshSourceResult(source, definition.disabledResult);
      }
      try {
        const load = () => definition.load(context);
        const execute = definition.retry !== false
          && typeof context.refreshSourceWithRetry === "function"
          ? () => context.refreshSourceWithRetry(source, load, context.signal)
          : load;
        const rawResult = typeof context.trackSource === "function"
          ? await context.trackSource(source, execute, definition.skippedResult || {})
          : await execute();
        const mapped = typeof definition.mapResult === "function"
          ? definition.mapResult(rawResult || {}, context)
          : rawResult;
        return normalizeRuntimeRefreshSourceResult(source, mapped);
      } catch (error) {
        if (context.isAbortError?.(error) || error?.name === "AbortError" || context.signal?.aborted) {
          throw error;
        }
        const failure = typeof definition.onError === "function"
          ? definition.onError(error, context)
          : context.sourceFailure?.(error, definition.errorLabel || `${source} 오류`) || {
            info: [],
            warnings: [`${definition.errorLabel || `${source} 오류`}: ${error?.message || error}`],
          };
        return normalizeRuntimeRefreshSourceResult(source, failure);
      }
    }

    return Object.freeze({ source, run });
  }

  /** Shares source admission, deduplication, health, and telemetry across refresh entry points. */
  function createRuntimeSourceExecution(options = {}) {
    const forceNetwork = options.forceNetwork === true;
    const forceAttempt = options.forceAttempt === true || forceNetwork;
    const signal = options.signal || null;
    const sourceAttemptDecisions = new Map();
    const sourceRefreshPromises = new Map();

    function sourceAttempt(source) {
      if (!sourceAttemptDecisions.has(source)) {
        sourceAttemptDecisions.set(source, options.runtimeDataApp?.canAttemptSource?.(source, {
          force: forceAttempt,
        }) || { allowed: true, waitMs: 0 });
      }
      return sourceAttemptDecisions.get(source);
    }

    function trackSource(source, task, skippedResult = {}) {
      if (sourceRefreshPromises.has(source)) return sourceRefreshPromises.get(source);
      const sourceStartedAt = options.startPerfSample?.() || 0;
      const attempt = sourceAttempt(source);
      if (attempt.allowed === false) {
        options.recordPerfSample?.(`runtimeSource:${source}`, sourceStartedAt, {
          ok: true,
          skipped: true,
          waitMs: attempt.waitMs,
        });
        const skippedPromise = Promise.resolve({ ...skippedResult, skipped: true });
        sourceRefreshPromises.set(source, skippedPromise);
        return skippedPromise;
      }
      const refreshPromise = Promise.resolve()
        .then(task)
        .then((result) => {
          if (typeof options.runtimeDataApp?.noteSourceResult === "function") {
            options.runtimeDataApp.noteSourceResult(source, result);
          } else {
            options.runtimeDataApp?.noteSourceSuccess?.(source, {
              latestDate: result?.latestDate || result?.sourceLatestDate || "",
              detail: (result?.applied || result?.info || []).join?.(" · ") || "",
            });
          }
          options.recordPerfSample?.(`runtimeSource:${source}`, sourceStartedAt, { ok: true });
          return result;
        }, (error) => {
          const cancelled = options.isAbortError?.(error) === true || signal?.aborted;
          if (!cancelled) options.runtimeDataApp?.noteSourceFailure?.(source, error);
          options.recordPerfSample?.(`runtimeSource:${source}`, sourceStartedAt, {
            ok: false,
            cancelled,
            error: String(error?.message || error || "unknown").slice(0, 120),
          });
          throw error;
        });
      sourceRefreshPromises.set(source, refreshPromise);
      return refreshPromise;
    }

    return Object.freeze({ sourceAttempt, trackSource });
  }

  function createRuntimeRefreshPolicy(options = {}) {
    const normalizeSeries = (values) => [...new Set((Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean))];
    const normalizeTickers = (values) => [...new Set(
      normalizeSeries(values).map((value) => value.toUpperCase()),
    )];
    const visibleSeries = () => normalizeSeries(options.getVisibleSeries?.());
    const session = () => options.getSession?.() || {};
    const featureRequested = (feature, state = session()) => {
      if (typeof options.isFeatureRequested === "function") {
        return options.isFeatureRequested(state, feature) === true;
      }
      if (feature === "signal") return state.showRecessionSignals === true;
      if (feature === "ai") return state.showAiForecast === true;
      if (feature === "co-movement") return state.showCoMovement === true;
      if (feature === "dart") {
        return state.showDisclosures === true || state.showInsiderTrades === true
          || state.showAiForecast === true;
      }
      return false;
    };
    const marketIndexSeries = normalizeSeries(options.marketIndexSeries);
    const macroSourceSeries = normalizeSeries(options.macroSourceSeries || ["leading_cycle"]);
    const crisisSourceSeries = normalizeSeries(options.crisisSourceSeries || [
      "t10y1y",
      "us_credit_spread",
    ]);
    const claimedStockPriceRefreshes = new Set();

    function includeRequiredTickers(plan, tickers) {
      const requiredTickers = normalizeTickers([
        ...(plan?.requiredTickers || []),
        ...(tickers || []),
      ]);
      return Object.freeze({
        ...(plan || {}),
        requiredTickers: Object.freeze(requiredTickers),
        skippedTickers: Object.freeze((plan?.skippedTickers || [])
          .filter((ticker) => !requiredTickers.includes(ticker))),
        shouldRefresh: requiredTickers.length > 0,
      });
    }

    function planSeriesPriceRefresh(tickers, requestOptions = {}) {
      const targets = normalizeTickers(tickers);
      return options.planPriceRefresh({
        tickers: targets,
        latestDates: options.latestDatesByTicker?.(
          options.getPricePayload?.(),
          targets,
          options.toNumber,
        ) || {},
        forceNetwork: requestOptions.forceNetwork === true,
        now: requestOptions.now,
      });
    }

    function claimStockPriceRefresh(tickers, requestOptions = {}) {
      const targets = normalizeTickers(tickers).filter((ticker) => (
        typeof options.isStockSeries !== "function" || options.isStockSeries(ticker) === true
      ));
      const refreshTargets = requestOptions.forceNetwork === true
        ? targets
        : targets.filter((ticker) => !claimedStockPriceRefreshes.has(ticker));
      targets.forEach((ticker) => claimedStockPriceRefreshes.add(ticker));
      return planSeriesPriceRefresh(refreshTargets, requestOptions);
    }

    function forgetStockPriceRefresh(tickers) {
      const targets = Array.isArray(tickers) ? tickers : [tickers];
      normalizeTickers(targets).forEach((ticker) => claimedStockPriceRefreshes.delete(ticker));
    }

    function forecastTargets(series = visibleSeries()) {
      return series.filter((key) => options.isForecastSeries?.(key) === true);
    }

    function needsAnalysisInputs(series = visibleSeries()) {
      const chartState = session();
      return forecastTargets(series).length > 0
        && (featureRequested("signal", chartState) || featureRequested("ai", chartState));
    }

    function hasVisibleSeries(keys, hiddenSeries) {
      return normalizeSeries(keys).some((series) => !hiddenSeries?.has?.(series));
    }

    function planCriticalRefresh(requestOptions = {}) {
      const visible = visibleSeries();
      const visibleStocks = visible.filter((key) => options.isStockSeries?.(key) === true);
      const chartState = session();
      const analysisNeedsBenchmarks = forecastTargets(visible).length > 0 && (
        featureRequested("signal", chartState)
        || featureRequested("ai", chartState)
        || featureRequested("co-movement", chartState)
      );
      const indexTickers = analysisNeedsBenchmarks
        ? marketIndexSeries
        : visible.filter((key) => marketIndexSeries.includes(key));
      const missingIndexVolumes = indexTickers.filter((ticker) => (
        options.hasVolumeHistory?.(ticker) === false
      ));
      const missingStockVolumes = visibleStocks.filter((ticker) => (
        options.hasVolumeHistory?.(ticker) === false
      ));
      const indices = includeRequiredTickers(
        planSeriesPriceRefresh(indexTickers, requestOptions),
        missingIndexVolumes,
      );
      return Object.freeze({
        indices: Object.freeze({
          ...indices,
          requireVolumeHistory: missingIndexVolumes.length > 0,
        }),
        prices: includeRequiredTickers(
          claimStockPriceRefresh(visibleStocks, requestOptions),
          missingStockVolumes,
        ),
      });
    }

    function isSourceForeground(source) {
      const key = String(source || "");
      const chartState = session();
      const analysisActive = needsAnalysisInputs();
      const hiddenSeries = chartState.hiddenSeries;
      const hiddenPanels = chartState.hiddenAuxiliaryPanels;
      if (key === "crisis") {
        return analysisActive
          || !hiddenPanels?.has?.("vkospi")
          || hasVisibleSeries(crisisSourceSeries, hiddenSeries);
      }
      if (key === "disclosure") {
        return featureRequested("dart", chartState);
      }
      if (key === "fearGreed") return analysisActive || !hiddenPanels?.has?.("fearGreed");
      if (key === "adr") return analysisActive || !hiddenPanels?.has?.("adr");
      if (key === "macro") {
        return analysisActive
          || !hiddenPanels?.has?.("newsSentiment")
          || hasVisibleSeries(macroSourceSeries, hiddenSeries);
      }
      if (key === "credit") {
        return analysisActive || hasVisibleSeries(options.getCreditSeries?.(), hiddenSeries);
      }
      return true;
    }

    function shouldRefreshSource(source, requestOptions = {}) {
      if (requestOptions.forceNetwork === true) return true;
      const key = String(source || "");
      if (["indices", "prices", "prices-visible"].includes(key)) return true;
      const sourceState = options.getSourceStates?.()?.[key] || null;
      if (
        !sourceState
        || sourceState.state !== "ready"
        || sourceState.qualityState === "stale"
        || sourceState.isStale === true
      ) {
        return true;
      }
      return options.shouldConfirmSource?.(key, {
        checkedAt: sourceState.lastSuccessAt,
        now: requestOptions.now,
      }) !== false;
    }

    return Object.freeze({
      claimStockPriceRefresh,
      forgetStockPriceRefresh,
      isSourceForeground,
      planCriticalRefresh,
      planSeriesPriceRefresh,
      shouldRefreshSource,
    });
  }

  function createRuntimeRefreshChangeApplier(options = {}) {
    return async function applyRuntimeRefreshChanges(revisionsBefore, requestOptions = {}) {
      const revisionsAfter = options.getDataRevisions?.() || {};
      const changes = planRuntimeRefreshRendering(revisionsBefore, revisionsAfter);
      const {
        mainDataChanged,
        priceDataChanged,
        derivedInputChanged,
        adrDataChanged,
        disclosureDataChanged,
        renderAuxiliaryOnly,
        renderDisclosureOnly,
      } = changes;
      if (adrDataChanged) options.invalidateAuxiliary?.();
      if (mainDataChanged && options.isAutoScale?.()) options.markPendingAutoFit?.();

      const shouldFinalizeDerived = requestOptions.finalizeDerived !== false && (
        derivedInputChanged
        || requestOptions.pendingDerivedInputChanged === true
        || requestOptions.forceDerivedFinalize === true
      );
      let updateClass = "";
      if (shouldFinalizeDerived && options.isTimingVisible?.()) {
        await options.prepareTiming?.({ changes, requestOptions, revisionsAfter });
        updateClass = "timing";
      }
      else if (mainDataChanged) {
        updateClass = requestOptions.phase === "critical" && priceDataChanged ? "price" : "data";
      }

      if (updateClass) {
        options.requestMainRender?.({
          preserveViewport: requestOptions.preserveViewport !== false,
          reason: `runtime-refresh-${requestOptions.phase || "complete"}`,
          updateClass,
        });
        if (requestOptions.awaitMainRender) await options.waitForMainRender?.();
      }
      if (renderAuxiliaryOnly || (adrDataChanged && updateClass === "timing")) {
        options.requestAuxiliaryRender?.();
        if (requestOptions.awaitAuxiliaryRender) await options.waitForAuxiliaryRender?.();
      }
      if (renderDisclosureOnly && !updateClass) options.renderDisclosure?.();
      return { revisionsAfter, ...changes };
    };
  }

  function createRuntimeRefreshOrchestrator(options = {}) {
    const {
      applyRuntimeRefreshChanges,
      canUseDartGateway,
      cancelAdrFinalRetry,
      chartSession,
      getDataRevisions,
      getVisibleSinceDate,
      hasVolumeCoverage,
      hasVolumeHistory,
      isAbortError,
      isSourceForeground,
      isRetryableAdrRefreshError,
      planCriticalRefresh,
      preloadCustomStocks,
      recordPerfSample,
      refreshAdrFromWeb,
      refreshAdrFromWebWithRetry,
      refreshCoreIndexSeries,
      refreshCreditFromGateway,
      refreshCrisisSignalFromGateway,
      refreshDartDisclosuresForVisibleTickersFromApi,
      refreshEcosMacroFromGateway,
      refreshFearGreedFromWeb,
      fetchCriticalRuntimeBootstrap,
      forgetStockPriceRefresh,
      refreshSourceWithRetry,
      runRefreshPhases,
      runtimeDataApp,
      scheduleAdrFinalRetry,
      scheduleVisibleStockHistoryRefresh,
      scheduleLastRuntimeSnapshotSave,
      setMessage,
      setRuntimeRefreshStatus,
      shouldRefreshSource,
      startPerfSample,
      state,
      throwIfAborted,
      waitForStartupVisualReady,
    } = options;
    if (!state || !chartSession || !runtimeDataApp) {
      throw new Error("runtime refresh orchestrator dependencies are incomplete");
    }

    const supplementalSourceAdapters = Object.freeze([
      createRuntimeRefreshSourceAdapter({
        source: "crisis",
        errorLabel: "침체 위기신호 불러오기 오류",
        skippedResult: { applied: [], warnings: [] },
        load: ({ signal, forceNetwork }) => refreshCrisisSignalFromGateway(signal, forceNetwork),
        mapResult: (result) => ({ info: result.applied || [], warnings: result.warnings || [] }),
      }),
      createRuntimeRefreshSourceAdapter({
        source: "fearGreed",
        errorLabel: "공포탐욕 불러오기 오류",
        skippedResult: { added: 0, latestDate: "" },
        load: ({ signal, forceNetwork }) => refreshFearGreedFromWeb(signal, forceNetwork),
        mapResult: ({ added, latestDate }) => ({
          info: added > 0 ? [`공포탐욕 최신값 반영(~ ${latestDate})`] : [],
          warnings: [],
        }),
      }),
      createRuntimeRefreshSourceAdapter({
        source: "disclosure",
        retry: false,
        enabled: ({ forceNetwork }) => forceNetwork && canUseDartGateway(),
        disabledResult: { refreshed: false },
        skippedResult: { fetched: 0, failed: [] },
        errorLabel: "DART 공시 오류",
        load: ({ forceNetwork, signal }) => refreshDartDisclosuresForVisibleTickersFromApi({
          forceNetwork,
          signal,
        }),
        mapResult: (result) => ({
          info: result.fetched > 0 ? [`DART 공시 ${result.fetched}건 확인`] : [],
          warnings: result.failed || [],
          refreshed: result.fetched > 0,
        }),
        onError: (error, context) => context.sourceFailure(error, "DART 공시 오류", {
          refreshed: false,
        }),
      }),
      createRuntimeRefreshSourceAdapter({
        source: "adr",
        retry: false,
        skippedResult: { changed: 0, latestDate: "" },
        load: ({ signal, forceNetwork, singleAttempt }) => (
          singleAttempt === true && typeof refreshAdrFromWeb === "function"
            ? refreshAdrFromWeb(signal, forceNetwork)
            : refreshAdrFromWebWithRetry(signal, forceNetwork)
        ),
        mapResult: ({ changed, latestDate }) => ({
          changed: Number(changed) || 0,
          latestDate: String(latestDate || ""),
          info: changed > 0 ? [`ADR ${changed}건 최신값 반영(~ ${latestDate})`] : [],
          warnings: [],
        }),
        onError: (error, context) => {
          if (isRetryableAdrRefreshError(error) && context.allowBackgroundRetry !== false) {
            scheduleAdrFinalRetry(context.forceNetwork);
            return { info: ["ADR 백그라운드 재확인 예약"], warnings: [] };
          }
          return context.sourceFailure(error, "ADR 불러오기 오류");
        },
      }),
      createRuntimeRefreshSourceAdapter({
        source: "macro",
        errorLabel: "ECOS 지표 불러오기 오류",
        skippedResult: { applied: [], warnings: [] },
        load: ({ signal, forceNetwork }) => refreshEcosMacroFromGateway(signal, forceNetwork),
        mapResult: (result) => ({ info: result.applied || [], warnings: result.warnings || [] }),
      }),
      createRuntimeRefreshSourceAdapter({
        source: "credit",
        errorLabel: "신용·예탁금 불러오기 오류",
        skippedResult: { applied: [], warnings: [] },
        load: ({ signal, forceNetwork }) => refreshCreditFromGateway(signal, forceNetwork),
        mapResult: (result) => ({ info: result.applied || [], warnings: result.warnings || [] }),
      }),
    ]);
    const supplementalSourceAdapterByKey = new Map(
      supplementalSourceAdapters.map((adapter) => [adapter.source, adapter]),
    );

    async function runSource(source, requestOptions = {}) {
      const key = String(source || "").trim();
      const adapter = supplementalSourceAdapterByKey.get(key);
      if (!adapter) throw new Error(`Unknown runtime refresh source: ${key}`);
      const forceNetwork = requestOptions.forceNetwork === true;
      const signal = requestOptions.signal || null;
      const revisionsBefore = getDataRevisions();
      const execution = createRuntimeSourceExecution({
        forceAttempt: requestOptions.forceAttempt === true,
        forceNetwork,
        isAbortError,
        recordPerfSample,
        runtimeDataApp,
        signal,
        startPerfSample,
      });
      const sourceFailure = (error, label, fallback = {}) => {
        if (isAbortError(error) || signal?.aborted) throw error;
        return {
          info: [],
          warnings: [`${label}: ${error?.message || error}`],
          ...fallback,
        };
      };
      const result = await adapter.run({
        allowBackgroundRetry: false,
        forceNetwork,
        isAbortError,
        refreshSourceWithRetry,
        signal,
        singleAttempt: requestOptions.singleAttempt === true,
        sourceFailure,
        trackSource: execution.trackSource,
      });
      throwIfAborted(signal);
      const changes = await applyRuntimeRefreshChanges(revisionsBefore, {
        awaitAuxiliaryRender: requestOptions.awaitAuxiliaryRender === true,
        awaitMainRender: requestOptions.awaitMainRender === true,
        finalizeDerived: true,
        phase: requestOptions.phase || "source",
      });
      if (changes.mainDataChanged || changes.adrDataChanged || changes.disclosureDataChanged) {
        scheduleLastRuntimeSnapshotSave(1800);
      }
      return Object.freeze({ changes, result });
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
      let derivedInputChanged = false;
      let pendingDerivedInputChanged = false;
      let adrDataChanged = false;
      let disclosureDataChanged = false;
      let deferredVisibleStockTickers = [];
      const forceNetwork = Boolean(options?.forceNetwork);
      const signal = options?.signal || null;
      const refreshNow = options?.now instanceof Date
        ? options.now
        : new Date(options?.now || Date.now());
      const criticalPlan = typeof planCriticalRefresh === "function"
        ? planCriticalRefresh({ forceNetwork, now: refreshNow })
        : null;
      const plannedIndexTickers = Array.isArray(criticalPlan?.indices?.requiredTickers)
        ? [...criticalPlan.indices.requiredTickers]
        : null;
      const plannedPriceTickers = Array.isArray(criticalPlan?.prices?.requiredTickers)
        ? [...criticalPlan.prices.requiredTickers]
        : null;
      const refreshIndices = criticalPlan ? plannedIndexTickers.length > 0 : true;
      const refreshVisiblePrices = criticalPlan ? plannedPriceTickers.length > 0 : true;
      const visibleSinceDate = typeof getVisibleSinceDate === "function"
        ? String(getVisibleSinceDate() || "").slice(0, 10)
        : "";
      const volumeCoverageTickers = plannedIndexTickers || ["^KS11", "^KQ11"];
      const requireIndexVolumeHistory = Boolean(
        criticalPlan?.indices?.requireVolumeHistory
        || volumeCoverageTickers.some((ticker) => hasVolumeHistory?.(ticker) === false)
        || (visibleSinceDate && volumeCoverageTickers.some((ticker) => (
          hasVolumeCoverage?.(ticker, visibleSinceDate) === false
        ))),
      );
      const sourceExecution = createRuntimeSourceExecution({
        forceNetwork,
        isAbortError,
        recordPerfSample,
        runtimeDataApp,
        signal,
        startPerfSample,
      });
      const sourceAttempt = sourceExecution.sourceAttempt;
      const trackSource = sourceExecution.trackSource;
      setRuntimeRefreshStatus("loading", "가격·지수 최신분 확인 중");

      let criticalStarted = 0;
      let criticalCompleted = 0;
      const criticalTotal = Math.max(1, Number(refreshIndices) + Number(refreshVisiblePrices));
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

      const sourceFailure = (error, label, fallback = {}) => {
        if (isAbortError(error) || signal?.aborted) throw error;
        return {
          info: [],
          warnings: [`${label}: ${error?.message || error}`],
          ...fallback,
        };
      };

      let criticalBootstrapPromise = null;
      const criticalBootstrap = () => {
        if (typeof fetchCriticalRuntimeBootstrap !== "function") return Promise.resolve(null);
        if (!refreshIndices && !refreshVisiblePrices) return Promise.resolve(null);
        const indicesBlocked = !refreshIndices || sourceAttempt("indices").allowed === false;
        const pricesBlocked = !refreshVisiblePrices || sourceAttempt("prices").allowed === false;
        if (indicesBlocked && pricesBlocked) {
          return Promise.resolve(null);
        }
        if (!criticalBootstrapPromise) {
          const startedAt = startPerfSample();
          criticalBootstrapPromise = Promise.resolve()
            .then(() => fetchCriticalRuntimeBootstrap({
              forceNetwork,
              signal,
              includeIndices: refreshIndices,
              now: refreshNow,
              requireIndexVolumeHistory,
              visibleSinceDate,
              ...(plannedIndexTickers ? { indexTickers: plannedIndexTickers } : {}),
              ...(plannedPriceTickers ? { tickers: plannedPriceTickers } : {}),
            }))
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
              now: refreshNow,
              requireVolumeHistory: requireIndexVolumeHistory,
              visibleSinceDate,
              ...(plannedIndexTickers ? { tickers: plannedIndexTickers } : {}),
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
            latestOnly: true,
            signal,
            scope: "visible",
            ...(visibleSinceDate ? { visibleSinceDate } : {}),
            ...(plannedPriceTickers ? { tickers: plannedPriceTickers } : {}),
            ...(bootstrap?.prices?.ok === true ? { priceBatchPayload: bootstrap.prices } : {}),
          }),
          { failedNames: [] },
        );
        const unconfirmedTickers = result.skipped === true
          ? (plannedPriceTickers || [])
          : (result.unconfirmedTickers || []);
        if (unconfirmedTickers.length) forgetStockPriceRefresh?.(unconfirmedTickers);
        deferredVisibleStockTickers = Array.isArray(result.deferredTickers)
          ? [...result.deferredTickers]
          : [];
        return {
          info: [],
          warnings: result.failedNames.length
            ? [`일부 선택 종목을 불러오지 못했습니다: ${result.failedNames.join(", ")}`]
            : [],
        };
        } catch (error) {
          if (plannedPriceTickers?.length) forgetStockPriceRefresh?.(plannedPriceTickers);
          if (isAbortError(error) || signal?.aborted) throw error;
          return { info: [], warnings: [`Price refresh failed: ${error.message}`] };
        }
      };

      const collectResults = (results) => results.forEach((result) => {
        infoLines.push(...(result.info || []));
        warnLines.push(...(result.warnings || []));
      });
      const noteDartResult = (results) => {
        refreshedDart = refreshedDart || results.some((result) => (
          result?.source === "disclosure" && result?.refreshed === true
        ));
      };
    
      const applyPhaseChanges = async (applyOptions = {}) => {
        const finalizeDerived = applyOptions.finalizeDerived === true;
        const changes = await applyRuntimeRefreshChanges(phaseRevisions, {
          awaitMainRender: applyOptions.awaitMainRender === true,
          pendingDerivedInputChanged,
          ...applyOptions,
        });
        phaseRevisions = changes.revisionsAfter;
        mainDataChanged = mainDataChanged || changes.mainDataChanged;
        derivedInputChanged = derivedInputChanged || changes.derivedInputChanged;
        pendingDerivedInputChanged = Boolean(
          pendingDerivedInputChanged || changes.derivedInputChanged,
        );
        if (finalizeDerived) pendingDerivedInputChanged = false;
        adrDataChanged = adrDataChanged || changes.adrDataChanged;
        disclosureDataChanged = disclosureDataChanged || changes.disclosureDataChanged;
        return changes;
      };

      const sourceContext = Object.freeze({
        allowBackgroundRetry: true,
        forceNetwork,
        isAbortError,
        refreshSourceWithRetry,
        signal,
        sourceFailure,
        trackSource,
      });
      const sourceTasks = supplementalSourceAdapters.map((adapter) => ({
        source: adapter.source,
        task: () => adapter.run(sourceContext),
      }));
      const refreshDeferredSources = options?.refreshDeferredSources === true || forceNetwork;
      const sourcePlan = planRuntimeRefreshSources(sourceTasks, {
        includeDeferred: refreshDeferredSources,
        isForeground: isSourceForeground,
        shouldRefresh: (source) => typeof shouldRefreshSource !== "function"
          || shouldRefreshSource(source, { forceNetwork, now: refreshNow }) !== false,
      });
      const foregroundSourceTasks = sourcePlan.foreground;
      const deferredSourceTasks = sourcePlan.deferred;
    
      await runRefreshPhases({
        // The visible price frame owns refresh priority. Supplemental requests
        // never compete with it, even during an explicit network refresh.
        startSupplementalAfterCritical: true,
        supplementalConcurrency: options?.deferSupplementalUntilReady ? 2 : (forceNetwork ? 3 : 2),
        beforeSupplemental: options?.deferSupplementalUntilReady && typeof waitForStartupVisualReady === "function"
          ? waitForStartupVisualReady
          : null,
        criticalTasks: [
          ...(refreshIndices ? [criticalTask("indices", coreIndexTask)] : []),
          ...(refreshVisiblePrices ? [criticalTask("prices-visible", preloadTask)] : []),
        ],
        supplementalTasks: foregroundSourceTasks.map(({ task }) => task),
        deferredTasks: refreshDeferredSources
          ? deferredSourceTasks.map(({ task }) => task)
          : [],
        onCritical: async (results) => {
          throwIfAborted(signal);
          collectResults(results);
          const changes = await applyPhaseChanges({
            awaitMainRender: options?.awaitCriticalRender == null
              ? forceNetwork
              : Boolean(options.awaitCriticalRender),
            awaitAuxiliaryRender: Boolean(options?.awaitCriticalRender),
            phase: "critical",
            finalizeDerived: false,
          });
          reportCriticalProgress("chart", 96);
          runtimeDataApp.notePhase("criticalReady", options?.generation);
          setRuntimeRefreshStatus("loading", "가격·지수 반영 완료 · 보조지표 갱신 중");
          if (typeof options?.onCriticalReady === "function") {
            setMessage(msgEl, [
              ...infoLines,
              ...warnLines,
              "공시·보조지표를 백그라운드에서 갱신 중입니다.",
            ], false);
            await options.onCriticalReady({ changes, info: [...infoLines], warnings: [...warnLines] });
          }
          deferredVisibleStockTickers.forEach((ticker) => {
            scheduleVisibleStockHistoryRefresh?.(ticker, "", { forceRefresh: forceNetwork });
          });
        },
        onSupplemental: async (results) => {
          throwIfAborted(signal);
          collectResults(results);
          noteDartResult(results);
          // Mark the input bundle ready before requesting its single final
          // timing render. Otherwise an unchanged source set can leave the
          // startup chart without signals until another interaction occurs.
          runtimeDataApp.notePhase("supplementalReady", options?.generation);
          await applyPhaseChanges({
            awaitMainRender: Boolean(options?.awaitSupplementalRender),
            awaitAuxiliaryRender: Boolean(options?.awaitSupplementalRender),
            phase: "supplemental",
            finalizeDerived: true,
            forceDerivedFinalize: true,
          });
          if (refreshDeferredSources && deferredSourceTasks.length) {
            setRuntimeRefreshStatus("loading", "현재 화면 갱신 완료 · 숨은 데이터 확인 중");
          }
        },
        onDeferred: async (results) => {
          throwIfAborted(signal);
          collectResults(results);
          noteDartResult(results);
          await applyPhaseChanges({
            awaitAuxiliaryRender: false,
            phase: "deferred",
            finalizeDerived: true,
          });
          runtimeDataApp.notePhase("deferredReady", options?.generation);
        },
      });

      if (refreshedDart) {
        if (state.lastDisclosureTraceStats.markers > 0) {
          infoLines.push(`현재 차트에 공시 마커 ${state.lastDisclosureTraceStats.markers}개 표시됨`);
        } else if (chartSession.showDisclosures && state.disclosureRows.length) {
          warnLines.push("공시 데이터는 있지만 현재 차트 범위/켜진 종목에는 표시할 마커가 없습니다.");
        }
      }
      if (mainDataChanged || adrDataChanged || disclosureDataChanged) {
        scheduleLastRuntimeSnapshotSave(1800);
      }
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

    return Object.freeze({ run, runSource });
  }

// Retry and phase helpers belong to runtime refresh orchestration.
  function startTaskFactories(taskFactories, runner = null) {
    return (Array.isArray(taskFactories) ? taskFactories : []).map((factory, index) => (
      Promise.resolve().then(() => (
        typeof runner === "function" ? runner(factory, index) : factory()
      ))
    ));
  }

  function runTaskFactoriesWithConcurrency(taskFactories, concurrency, runner = null) {
    return mapWithConcurrency(taskFactories, concurrency, (factory, index) => (
      Promise.resolve().then(() => (
        typeof runner === "function" ? runner(factory, index) : factory()
      ))
    ));
  }

  async function runRefreshPhases(options = {}) {
    const criticalPromise = Promise.all(startTaskFactories(options.criticalTasks));
    const supplementalConcurrency = Number(options.supplementalConcurrency);
    const supplementalRunner = typeof options.runSupplementalTask === "function"
      ? options.runSupplementalTask
      : null;
    const startSupplemental = () => (
      Number.isFinite(supplementalConcurrency) && supplementalConcurrency > 0
        ? runTaskFactoriesWithConcurrency(
          options.supplementalTasks,
          supplementalConcurrency,
          supplementalRunner,
        )
        : Promise.all(startTaskFactories(options.supplementalTasks, supplementalRunner))
    );
    let supplementalPromise = options.startSupplementalAfterCritical ? null : startSupplemental();
    // Prevent an early supplemental rejection from becoming unhandled while critical work finishes.
    supplementalPromise?.catch(() => {});

    const criticalResults = await criticalPromise;
    if (typeof options.onCritical === "function") await options.onCritical(criticalResults);

    if (!supplementalPromise) {
      if (typeof options.beforeSupplemental === "function") await options.beforeSupplemental();
      supplementalPromise = startSupplemental();
    }
    const supplementalResults = await supplementalPromise;
    if (typeof options.onSupplemental === "function") await options.onSupplemental(supplementalResults);

    if (!Array.isArray(options.deferredTasks) || !options.deferredTasks.length) {
      return { criticalResults, supplementalResults };
    }
    const deferredResults = Number.isFinite(supplementalConcurrency) && supplementalConcurrency > 0
      ? await runTaskFactoriesWithConcurrency(
        options.deferredTasks,
        supplementalConcurrency,
        supplementalRunner,
      )
      : await Promise.all(startTaskFactories(options.deferredTasks, supplementalRunner));
    if (typeof options.onDeferred === "function") await options.onDeferred(deferredResults);
    return { criticalResults, supplementalResults, deferredResults };
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

export {
  createRuntimeRefreshChangeApplier,
  createRuntimeRefreshSourceAdapter,
  createRuntimeRefreshPolicy,
  createRuntimeSourceExecution,
  createRuntimeRefreshOrchestrator,
  isRetryableRuntimeError,
  planRuntimeRefreshSources,
  planRuntimeRefreshRendering,
  partitionRuntimeRefreshSources,
  retryOnce,
  retryRuntimeSource,
  retryWithDelays,
  runRefreshPhases,
  runTaskFactoriesWithConcurrency,
  waitForRetryDelay,
};
