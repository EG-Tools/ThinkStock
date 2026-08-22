(function initThinkStockStockResearchWorkerClient(globalScope) {
  "use strict";

  const contract = globalScope.ThinkStockStockResearchContract;
  if (!contract) throw new Error("stock research contract failed to load");

  function createWorkerLane(scope, workerUrl, shared) {
    const worker = new scope.Worker(workerUrl);
    let sequence = 0;
    const pending = new Map();
    worker.onmessage = (event) => {
      const request = pending.get(Number(event.data?.id));
      if (!request) return;
      pending.delete(Number(event.data.id));
      if (event.data?.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data);
    };
    worker.onerror = (event) => {
      const error = new Error(event?.message || "종목탐구 작업 영역 오류");
      pending.forEach((request) => request.reject(error));
      pending.clear();
    };
    const request = (payload) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...payload });
    });
    return request({ type: "init", shared }).then(() => ({
      analyze: (item, rows, asOfDate, filter, timingCacheRecord = null) => request({
        type: "analyze",
        item,
        rows,
        asOfDate,
        minimumSignals: filter.todayOnly ? 1 : contract.MINIMUM_LOW,
        includeBuy: filter.includeBuy,
        includeSell: filter.includeSell,
        todayOnly: filter.todayOnly,
        collectAllSignals: filter.collectAllSignals === true,
        timingCacheRecord,
      }),
      terminate: () => worker.terminate(),
    }));
  }

  globalScope.ThinkStockStockResearchWorkerClient = Object.freeze({ createWorkerLane });
}(typeof self !== "undefined" ? self : globalThis));
