(function initThinkStockDartRequestRuntime(globalScope) {
  "use strict";

  function createDartRequestRuntime(registry) {
    if (!registry?.run) throw new Error("shared request registry is required");

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
      });
    }

    function identities(kind) {
      const prefix = requestKey(kind, "").replace(/GLOBAL$/, "");
      return registry.keys()
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    }

    return Object.freeze({
      has: (kind, identity) => registry.has(requestKey(kind, identity)),
      identities,
      run,
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

  function createDartEventLifecycle(scope = globalScope, options = {}) {
    const tickerPattern = options.tickerPattern || /^[0-9]{6}\.(KS|KQ)$/;
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
      const ticker = String(value || "").trim().toUpperCase();
      return tickerPattern.test(ticker) ? ticker : "";
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
      return Promise.allSettled(targetTickers({ visible: true }).map((ticker) => (
        requestDisclosure(ticker, messageElement)
      )));
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

  globalScope.ThinkStockDartRequestRuntime = Object.freeze({
    createDartEventLifecycle,
    createDartRequestRuntime,
    fetchProgressiveRecords,
  });
}(typeof self !== "undefined" ? self : globalThis));
