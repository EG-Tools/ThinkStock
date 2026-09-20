"use strict";

  const contract = require("./stock-research-contract.js");
  if (!contract) throw new Error("stock research contract failed to load");

  function waitForTask(task, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      Promise.resolve(task).then(resolve, reject)
        .finally(() => signal?.removeEventListener("abort", abort));
    });
  }

  function createWorkerLane(scope, workerUrl, shared, options = {}) {
    const worker = new scope.Worker(workerUrl);
    let sequence = 0;
    let terminated = false;
    const pending = new Map();
    const setTimer = scope.setTimeout?.bind(scope) || setTimeout;
    const clearTimer = scope.clearTimeout?.bind(scope) || clearTimeout;
    const signal = options.signal;
    const onAbort = () => terminate(signal.reason || new DOMException("Aborted", "AbortError"));
    const terminate = (reason = null) => {
      if (terminated) return false;
      terminated = true;
      const error = reason instanceof Error
        ? reason
        : new Error(String(reason || "종목탐구 작업 영역이 종료되었습니다."));
      pending.forEach((request) => { clearTimer(request.timer); request.reject(error); });
      pending.clear();
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      return true;
    };
    worker.onmessage = (event) => {
      if (terminated) return;
      const request = pending.get(Number(event.data?.id));
      if (!request) return;
      pending.delete(Number(event.data.id));
      clearTimer(request.timer);
      if (event.data?.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data);
    };
    worker.onerror = (event) => {
      const error = new Error(event?.message || "종목탐구 작업 영역 오류");
      terminate(error);
    };
    const request = (payload) => new Promise((resolve, reject) => {
      if (terminated) {
        reject(new Error("종목탐구 작업 영역이 종료되었습니다."));
        return;
      }
      const id = ++sequence;
      const timer = setTimer(() => {
        const error = new Error("종목탐구 계산 시간 초과");
        error.code = "worker-timeout";
        terminate(error);
      }, Math.max(1000, Number(options.timeoutMs) || 30000));
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, ...payload }); }
      catch (error) { terminate(error); }
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return request({ type: "init", shared }).then(() => ({
      analyze: (item, rows, asOfDate, filter, timingCacheRecord = null) => {
        const signalWindowDays = contract.normalizeSignalWindowDays(
          filter?.signalWindowDays,
          filter?.todayOnly === true,
        );
        return request({
          type: "analyze",
          item,
          rows,
          asOfDate,
          minimumSignals: filter?.collectAllSignals === true
            ? contract.MINIMUM_LOW
            : Math.max(
              contract.MINIMUM_LOW,
              Math.min(contract.MINIMUM_HIGH, Math.round(Number(filter?.minimumSignals) || contract.MINIMUM_LOW)),
            ),
          includeBuy: filter.includeBuy,
          includeSell: filter.includeSell,
          signalWindowDays,
          collectAllSignals: filter.collectAllSignals === true,
          timingCacheRecord,
        });
      },
      terminate,
      isTerminated: () => terminated,
    })).catch((error) => {
      terminate(error);
      throw error;
    });
  }

  const stockResearchWorkerClient = Object.freeze({ createWorkerLane, waitForTask });

module.exports = stockResearchWorkerClient;
