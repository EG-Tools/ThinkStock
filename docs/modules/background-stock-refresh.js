(function initThinkStockBackgroundStockRefresh(globalScope) {
  "use strict";

  function createBackgroundStockRefresh(scope = globalScope, options = {}) {
    const refresh = options.refresh;
    const hasHidden = typeof options.hasHidden === "function" ? options.hasHidden : () => false;
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    const delayMs = Math.max(1000, Number(options.delayMs) || 3500);
    let delayHandle = 0;
    let idleHandle = 0;
    let running = null;

    function cancelPending() {
      if (delayHandle) scope.clearTimeout(delayHandle);
      if (idleHandle && typeof scope.cancelIdleCallback === "function") {
        scope.cancelIdleCallback(idleHandle);
      }
      delayHandle = 0;
      idleHandle = 0;
    }

    function inputPending() {
      try { return scope.navigator?.scheduling?.isInputPending?.() === true; }
      catch (_) { return false; }
    }

    function schedule(runOptions = {}) {
      cancelPending();
      if (typeof refresh !== "function" || !hasHidden()) return false;
      const signal = runOptions.signal || null;
      const execute = () => {
        idleHandle = 0;
        if (signal?.aborted || !hasHidden()) return;
        if (inputPending()) {
          delayHandle = scope.setTimeout(() => schedule(runOptions), 1200);
          return;
        }
        running = Promise.resolve(refresh({
          forceRefresh: runOptions.forceRefresh === true,
          preserveFailed: true,
          scope: "hidden",
          signal,
        })).catch((error) => {
          if (!signal?.aborted) onError(error);
        }).finally(() => { running = null; });
      };
      delayHandle = scope.setTimeout(() => {
        delayHandle = 0;
        if (typeof scope.requestIdleCallback === "function") {
          idleHandle = scope.requestIdleCallback(execute, { timeout: 6000 });
        } else {
          execute();
        }
      }, delayMs);
      return true;
    }

    return Object.freeze({
      cancelPending,
      isRunning: () => Boolean(running),
      schedule,
    });
  }

  globalScope.ThinkStockBackgroundStockRefresh = Object.freeze({
    createBackgroundStockRefresh,
  });
}(typeof self !== "undefined" ? self : globalThis));
