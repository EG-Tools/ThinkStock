(function initThinkStockBrokerReportWorkerClient(globalScope) {
  "use strict";

  function createBrokerReportWorkerClient(scope = globalScope, options = {}) {
    const workerUrl = String(options.workerUrl || "");
    const timeoutMs = Math.max(3000, Number(options.timeoutMs) || 30000);
    let worker = null;
    let sequence = 0;
    let disposed = false;
    const pending = new Map();

    function rejectAll(error) {
      pending.forEach((request) => {
        scope.clearTimeout(request.timer);
        request.reject(error);
      });
      pending.clear();
    }

    function reset(target = worker) {
      if (target === worker) worker = null;
      try { target?.terminate(); } catch (_) {}
    }

    function ensureWorker() {
      if (worker) return worker;
      if (disposed || typeof scope.Worker !== "function" || !workerUrl) {
        throw new Error("Broker report PDF worker is unavailable");
      }
      const next = new scope.Worker(workerUrl, { type: "module" });
      next.onmessage = (event) => {
        const id = Number(event.data?.id);
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        scope.clearTimeout(request.timer);
        if (event.data?.error) request.reject(new Error(event.data.error));
        else request.resolve(Array.isArray(event.data?.pages) ? event.data.pages : []);
      };
      next.onerror = (event) => {
        if (worker !== next) return;
        rejectAll(new Error(event?.message || "Broker report PDF worker failed"));
        reset(next);
      };
      worker = next;
      return worker;
    }

    function extractPages(bytes, extractOptions = {}) {
      if (disposed) return Promise.reject(new Error("Broker report PDF worker is disposed"));
      const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      if (!source.byteLength) return Promise.resolve([]);
      const transferable = source.slice();
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        let target;
        try {
          target = ensureWorker();
        } catch (error) {
          reject(error);
          return;
        }
        const timer = scope.setTimeout(() => {
          if (!pending.has(id)) return;
          rejectAll(new Error("Broker report PDF worker timeout"));
          reset(target);
        }, Math.max(3000, Number(extractOptions.timeoutMs) || timeoutMs));
        pending.set(id, { reject, resolve, timer });
        try {
          target.postMessage({ id, bytes: transferable.buffer }, [transferable.buffer]);
        } catch (error) {
          rejectAll(error);
          reset(target);
        }
      });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      rejectAll(new Error("Broker report PDF worker is disposed"));
      reset();
    }

    return Object.freeze({ dispose, extractPages });
  }

  globalScope.ThinkStockBrokerReportWorkerClient = Object.freeze({
    createBrokerReportWorkerClient,
  });
}(typeof self !== "undefined" ? self : globalThis));
