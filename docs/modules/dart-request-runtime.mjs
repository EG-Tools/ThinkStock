"use strict";

  const DART_TICKER_PATTERN = /^[0-9]{6}\.(KS|KQ)$/;
  const DEFAULT_MESSAGES = Object.freeze({
    auth: "Think Stock 접속 코드가 만료되었거나 올바르지 않습니다. 설정에서 다시 저장해 주세요.",
    company: "DART 회사코드를 찾지 못했습니다. 배포 데이터 갱신 후 다시 시도해 주세요.",
    connection: "ThinkStock DART 중계 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    token: "설정에서 Think Stock 접속 코드를 먼저 저장해 주세요.",
  });

  function normalizeDartTicker(value, tickerPattern = DART_TICKER_PATTERN) {
    const ticker = String(value || "").trim().toUpperCase();
    return tickerPattern.test(ticker) ? ticker : "";
  }

  async function resolveDartCompanyContext(ticker, options = {}) {
    const target = normalizeDartTicker(ticker, options.tickerPattern || DART_TICKER_PATTERN);
    if (!target) return null;
    const stockCode = target.slice(0, 6);
    const loaded = await options.ensureCorpCode?.(stockCode);
    const corpCode = String(options.getCorpCode?.(stockCode) || "").trim();
    if (!loaded || !/^\d{8}$/.test(corpCode)) {
      throw new Error(options.messages?.company || DEFAULT_MESSAGES.company);
    }
    if (options.requireAccessToken && !String(options.getAccessToken?.() || "").trim()) {
      throw new Error(options.messages?.token || DEFAULT_MESSAGES.token);
    }
    return Object.freeze({ ticker: target, stockCode, corpCode });
  }

  function toDartGatewayError(error, messages = {}) {
    if (error?.name === "AbortError" || error?.status) {
      if (error?.status !== 401) return error;
      const authError = new Error(messages.auth || DEFAULT_MESSAGES.auth);
      authError.status = 401;
      return authError;
    }
    return new Error(messages.connection || DEFAULT_MESSAGES.connection);
  }

  function createProgressTask() {
    let progress = null;
    let key = "";
    let label = "DART";
    let started = false;
    let settled = false;
    let latestValue = 0;
    return Object.freeze({
      enable(options = {}) {
        if (settled || options.enabled !== true || !options.progress) return false;
        if (started) return true;
        progress = options.progress;
        key = String(options.key || "");
        label = String(options.label || "DART");
        latestValue = Math.max(latestValue, Number(options.initialValue) || 0);
        if (!key) return false;
        started = progress.begin(key, label) !== false;
        if (started && latestValue > 0) progress.update(key, latestValue, label);
        return started;
      },
      update(value) {
        latestValue = Math.max(latestValue, Number(value) || 0);
        return started ? progress.update(key, value, label) : false;
      },
      complete() {
        if (settled) return false;
        settled = true;
        if (!started) return false;
        started = false;
        return progress.complete(key, label);
      },
    });
  }

  function createDartRequestRuntime(registry) {
    if (!registry?.run) throw new Error("shared request registry is required");
    const progressByEntry = new WeakMap();

    const requestKey = (kind, identity = "global") => (
      `dart:${String(kind || "request")}:${String(identity || "global").toUpperCase()}`
    );

    function run(kind, identity, factory, options = {}) {
      const key = requestKey(kind, identity);
      const force = options.force === true;
      return registry.run(key, factory, {
        signal: options.signal || null,
        tag: force ? "force" : "normal",
        afterCurrent: force && registry.has(key) && registry.tag(key) !== "force",
        onEntry: options.onEntry,
      });
    }

    function identities(kind) {
      const prefix = requestKey(kind, "").replace(/GLOBAL$/, "");
      return registry.keys()
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    }

    function cancel(kind, identity, reason = null) {
      return registry.cancel(requestKey(kind, identity), reason);
    }

    function cancelKind(kind, reason = null) {
      return identities(kind).reduce((count, identity) => (
        count + Number(cancel(kind, identity, reason))
      ), 0);
    }

    function runTracked(kind, identity, factory, options = {}) {
      let progressTask = null;
      return run(kind, identity, async (signal) => {
        return factory(signal, progressTask);
      }, {
        ...options,
        onEntry(entryToken, requestPromise) {
          progressTask = progressByEntry.get(entryToken);
          if (!progressTask) {
            progressTask = createProgressTask();
            progressByEntry.set(entryToken, progressTask);
            requestPromise.finally(() => progressTask.complete());
          }
          progressTask.enable({
            enabled: options.trackProgress === true,
            progress: options.progress,
            key: options.progressKey,
            label: options.progressLabel,
            initialValue: options.initialProgress,
          });
        },
      });
    }

    return Object.freeze({
      cancel,
      cancelKind,
      has: (kind, identity) => registry.has(requestKey(kind, identity)),
      identities,
      run,
      runTracked,
      tag: (kind, identity) => registry.tag(requestKey(kind, identity)),
    });
  }

  async function fetchProgressiveRecords(options = {}) {
    const fetchPage = options.fetchPage;
    const normalizeRecords = options.normalizeRecords;
    const mergeRecords = options.mergeRecords;
    if (typeof fetchPage !== "function"
      || typeof normalizeRecords !== "function"
      || typeof mergeRecords !== "function") {
      throw new Error("progressive DART request dependencies are incomplete");
    }
    let page = 1;
    let since = String(options.since || "");
    let collected = [];
    while (page) {
      const payload = await fetchPage({ page, since });
      if (payload?.ok === false) {
        const error = options.createResponseError?.(payload)
          || new Error(String(payload?.error || "DART request failed"));
        throw error;
      }
      const batch = normalizeRecords(payload?.records || []);
      collected = mergeRecords(collected, batch);
      await options.onBatch?.(batch, {
        page: Number(payload?.page || page),
        totalPages: Math.max(1, Number(payload?.totalPages || 1)),
        complete: payload?.nextPage === null || payload?.complete === true,
        accumulatedCount: Number(payload?.accumulatedCount || collected.length),
        cached: payload?.cached === true,
      });
      if (payload?.checkedFrom) since = String(payload.checkedFrom).slice(0, 10);
      const nextPage = Number(payload?.nextPage || 0);
      page = Number.isInteger(nextPage) && nextPage > page ? nextPage : 0;
    }
    return collected;
  }

  function createDartEventLifecycle(scope = globalThis, options = {}) {
    const tickerPattern = options.tickerPattern || DART_TICKER_PATTERN;
    const getStocks = typeof options.getStocks === "function" ? options.getStocks : () => [];
    const isHidden = typeof options.isHidden === "function" ? options.isHidden : () => false;
    const mapWithConcurrency = options.mapWithConcurrency;
    const requestDisclosure = options.requestDisclosure;
    const requestInsider = options.requestInsider;
    const isInsiderEnabled = typeof options.isInsiderEnabled === "function"
      ? options.isInsiderEnabled
      : () => false;
    const canUseGateway = typeof options.canUseGateway === "function"
      ? options.canUseGateway
      : () => false;
    const hasRequest = typeof options.hasRequest === "function" ? options.hasRequest : () => false;
    const isAbortError = typeof options.isAbortError === "function" ? options.isAbortError : () => false;
    const recordError = typeof options.recordError === "function" ? options.recordError : () => {};
    const onPendingChange = typeof options.onPendingChange === "function"
      ? options.onPendingChange
      : () => {};
    const concurrency = Math.max(1, Number(options.concurrency) || 1);
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    if (typeof mapWithConcurrency !== "function"
      || typeof requestDisclosure !== "function"
      || typeof requestInsider !== "function"
      || typeof setTimer !== "function"
      || typeof clearTimer !== "function") {
      throw new Error("DART event lifecycle dependencies are incomplete");
    }

    const loadedInsiders = new Set();
    const pendingInsiders = new Set();
    let insiderRefreshTimer = 0;

    function normalizeTicker(value) {
      return normalizeDartTicker(value, tickerPattern);
    }

    function targetTickers(targetOptions = {}) {
      const visibleOnly = targetOptions.visible === true;
      return [...new Set((getStocks() || [])
        .map((stock) => normalizeTicker(stock?.ticker))
        .filter((ticker) => ticker && (!visibleOnly || !isHidden(ticker))))];
    }

    function setInsiderPending(ticker, pending) {
      const target = normalizeTicker(ticker);
      if (!target) return false;
      if (pending) pendingInsiders.add(target);
      else pendingInsiders.delete(target);
      onPendingChange(pendingInsiders.size);
      return true;
    }

    async function prepareVisibleDisclosures(messageElement) {
      return mapWithConcurrency(
        targetTickers({ visible: true }),
        concurrency,
        async (ticker) => {
          try {
            return { status: "fulfilled", value: await requestDisclosure(ticker, messageElement) };
          } catch (reason) {
            return { status: "rejected", reason };
          }
        },
      );
    }

    async function refreshVisibleInsiders(refreshOptions = {}) {
      if (!isInsiderEnabled() || !canUseGateway()) return 0;
      const tickers = targetTickers({ visible: true });
      if (!tickers.length) return 0;
      const results = await mapWithConcurrency(tickers, concurrency, async (ticker) => {
        try {
          return { ticker, rows: await requestInsider(ticker, refreshOptions) };
        } catch (error) {
          if (isAbortError(error) || refreshOptions.signal?.aborted) throw error;
          return { ticker, rows: [], error };
        }
      });
      const failures = results.filter((result) => result?.error);
      failures.forEach((result) => recordError(`insider:${result.ticker}`, result.error));
      if (failures.length === results.length) throw failures[0].error;
      return results.reduce((count, result) => count + (result?.rows?.length || 0), 0);
    }

    async function restoreVisibleLayers(restoreOptions = {}) {
      const result = {
        disclosures: [],
        insiderCount: 0,
      };
      // Restore one DART layer at a time so the shared progress view has one
      // stable owner and the gateway is not flooded immediately after boot.
      if (restoreOptions.disclosures === true) {
        result.disclosures = await prepareVisibleDisclosures(restoreOptions.messageElement || null);
      }
      if (restoreOptions.insiders === true) {
        result.insiderCount = await refreshVisibleInsiders({
          ...(restoreOptions.insiderOptions || {}),
          trackProgress: restoreOptions.trackProgress !== false,
        });
      }
      return Object.freeze(result);
    }

    function cancelScheduledInsiderRefresh() {
      if (!insiderRefreshTimer) return false;
      clearTimer(insiderRefreshTimer);
      insiderRefreshTimer = 0;
      return true;
    }

    function scheduleInsiderRefresh() {
      if (!isInsiderEnabled() || !canUseGateway()) {
        cancelScheduledInsiderRefresh();
        return false;
      }
      const missing = targetTickers({ visible: true }).filter((ticker) => (
        !loadedInsiders.has(ticker) && !hasRequest("insider", ticker)
      ));
      if (!missing.length || insiderRefreshTimer) return false;
      insiderRefreshTimer = setTimer(() => {
        insiderRefreshTimer = 0;
        refreshVisibleInsiders().catch(() => {});
      }, 0);
      return true;
    }

    function dispose() {
      cancelScheduledInsiderRefresh();
      loadedInsiders.clear();
      pendingInsiders.clear();
      onPendingChange(0);
    }

    return Object.freeze({
      dispose,
      isInsiderLoaded: (ticker) => loadedInsiders.has(normalizeTicker(ticker)),
      markInsiderLoaded: (ticker) => {
        const target = normalizeTicker(ticker);
        if (target) loadedInsiders.add(target);
        return Boolean(target);
      },
      pendingInsiderCount: () => pendingInsiders.size,
      prepareVisibleDisclosures,
      refreshVisibleInsiders,
      restoreVisibleLayers,
      scheduleInsiderRefresh,
      setInsiderPending,
      snapshot: () => Object.freeze({
        loadedTickers: [...loadedInsiders],
        pendingTickers: [...pendingInsiders],
        visibleTickers: targetTickers({ visible: true }),
      }),
      targetTickers,
    });
  }

export {
  DART_TICKER_PATTERN,
  createDartEventLifecycle,
  createDartRequestRuntime,
  fetchProgressiveRecords,
  normalizeDartTicker,
  resolveDartCompanyContext,
  toDartGatewayError,
};
