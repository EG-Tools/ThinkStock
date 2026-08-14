(function initThinkStockSharedRequestRegistry(globalScope) {
  "use strict";

  function abortError(reason) {
    if (reason instanceof Error) return reason;
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    return error;
  }

  async function mapWithConcurrency(items, limit, worker) {
    const source = Array.isArray(items) ? items : [];
    if (!source.length) return [];
    if (typeof worker !== "function") throw new TypeError("concurrency worker is required");
    const size = Math.max(1, Math.min(Number(limit) || 1, source.length));
    const results = Array(source.length);
    let nextIndex = 0;
    await Promise.all(Array.from({ length: size }, async () => {
      while (nextIndex < source.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(source[index], index);
      }
    }));
    return results;
  }

  function createSharedRequestRegistry(options = {}) {
    const entries = new Map();
    const counters = { started: 0, sharedHits: 0, completed: 0, failed: 0, cancelled: 0 };

    function run(keyValue, factory, runOptions = {}) {
      const key = String(keyValue || "");
      if (!key || typeof factory !== "function") return Promise.reject(new Error("shared request key and factory are required"));
      const callerSignal = runOptions.signal || null;
      if (callerSignal?.aborted) return Promise.reject(abortError(callerSignal.reason));

      let entry = entries.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = {
          controller,
          subscribers: new Set(),
          settled: false,
          promise: null,
        };
        entries.set(key, entry);
        counters.started += 1;
        entry.promise = Promise.resolve()
          .then(() => factory(controller.signal))
          .then((value) => {
            entry.settled = true;
            counters.completed += 1;
            [...entry.subscribers].forEach((subscriber) => subscriber.resolve(value));
            return value;
          }, (error) => {
            entry.settled = true;
            counters.failed += 1;
            [...entry.subscribers].forEach((subscriber) => subscriber.reject(error));
            return undefined;
          })
          .finally(() => {
            entries.delete(key);
            entry.subscribers.clear();
          });
      } else {
        counters.sharedHits += 1;
      }

      return new Promise((resolve, reject) => {
        let finished = false;
        const cleanup = () => callerSignal?.removeEventListener?.("abort", onAbort);
        const subscriber = {
          resolve(value) {
            if (finished) return;
            finished = true;
            cleanup();
            entry.subscribers.delete(subscriber);
            resolve(value);
          },
          reject(error) {
            if (finished) return;
            finished = true;
            cleanup();
            entry.subscribers.delete(subscriber);
            reject(error);
          },
        };
        const onAbort = () => {
          counters.cancelled += 1;
          subscriber.reject(abortError(callerSignal?.reason));
          if (!entry.settled && entry.subscribers.size === 0) entry.controller.abort(callerSignal?.reason);
        };
        entry.subscribers.add(subscriber);
        callerSignal?.addEventListener?.("abort", onAbort, { once: true });
      });
    }

    function cancel(keyValue, reason = null) {
      const entry = entries.get(String(keyValue || ""));
      if (!entry || entry.settled) return false;
      entry.controller.abort(reason || abortError());
      return true;
    }

    function cancelAll(reason = null) {
      let cancelled = 0;
      entries.forEach((entry) => {
        if (entry.settled) return;
        entry.controller.abort(reason || abortError());
        cancelled += 1;
      });
      return cancelled;
    }

    return Object.freeze({
      cancel,
      cancelAll,
      run,
      stats: () => Object.freeze({ ...counters, inFlight: entries.size }),
    });
  }

  globalScope.ThinkStockSharedRequestRegistry = Object.freeze({
    abortError,
    createSharedRequestRegistry,
    mapWithConcurrency,
  });
}(typeof self !== "undefined" ? self : globalThis));
