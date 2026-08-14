(function initThinkStockAiForecastApp(globalScope) {
  "use strict";

  function createAiForecastApp(scope = globalScope, options = {}) {
    const workerUrl = String(options.workerUrl || "");
    const buildFallback = options.buildFallback;
    let worker = null;
    let sequence = 0;
    let pending = new Map();
    let progressActive = false;
    let progressValue = 0;
    let progressHideTimer = 0;
    const createProgressView = options.createProgressView
      || scope.ThinkStockProgressView?.createProgressView
      || globalScope.ThinkStockProgressView?.createProgressView;
    if (typeof createProgressView !== "function") {
      throw new Error("progress view module is unavailable");
    }
    const progressView = createProgressView(scope, {
      getRoot: () => scope.document?.getElementById("aiForecastProgress"),
      getText: () => scope.document?.getElementById("aiForecastProgressText"),
      getBar: () => scope.document?.getElementById("aiForecastProgressBar"),
    });

    function setProgress(value, label = "AI 계산") {
      if (!progressActive) return;
      const requested = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      progressValue = Math.max(progressValue, requested);
      progressView.paint(progressValue, `${label} ${progressValue}%`, { visible: true });
    }

    function resetProgress(label = "AI 계산 준비") {
      if (!progressActive) return;
      progressValue = 0;
      setProgress(0, label);
    }

    function waitForProgressPaint(delay = 0) {
      return new Promise((resolve) => {
        const done = () => (delay > 0 ? scope.setTimeout(resolve, delay) : resolve());
        if (typeof scope.requestAnimationFrame === "function") scope.requestAnimationFrame(done);
        else done();
      });
    }

    function startProgress(label = "AI 자료 준비") {
      if (progressHideTimer) scope.clearTimeout(progressHideTimer);
      progressHideTimer = 0;
      progressValue = 0;
      progressActive = true;
      setProgress(0, label);
    }

    function finishProgress(label = "AI 계산 완료") {
      if (!progressActive) return;
      setProgress(100, label);
      progressHideTimer = scope.setTimeout(() => {
        progressActive = false;
        progressView.setVisible(false);
      }, 650);
    }

    function stopProgress() {
      progressActive = false;
      progressValue = 0;
      if (progressHideTimer) scope.clearTimeout(progressHideTimer);
      progressHideTimer = 0;
      progressView.reset({ hide: true });
    }

    function cancelCalculations() {
      if (!worker) return;
      pending.forEach(({ resolve }) => resolve(null));
      pending.clear();
      worker.terminate();
      worker = null;
    }

    function ensureWorker() {
      if (worker) return worker;
      if (!workerUrl || typeof scope.Worker !== "function") return null;
      const instance = new scope.Worker(workerUrl);
      instance.onmessage = (event) => {
        const request = pending.get(Number(event.data?.id));
        if (!request) return;
        pending.delete(Number(event.data.id));
        if (event.data?.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data?.forecast || null);
      };
      instance.onerror = () => {
        pending.forEach(({ reject }) => reject(new Error("AI forecast worker failed")));
        pending.clear();
        instance.terminate();
        if (worker === instance) worker = null;
      };
      worker = instance;
      return worker;
    }

    function run(optionsValue) {
      const activeWorker = ensureWorker();
      if (!activeWorker) return Promise.resolve(buildFallback?.(optionsValue) || null);
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          activeWorker.postMessage({ id, options: optionsValue });
        } catch (_) {
          pending.delete(id);
          resolve(buildFallback?.(optionsValue) || null);
        }
      });
    }

    return Object.freeze({
      cancelCalculations,
      finishProgress,
      isProgressActive: () => progressActive,
      resetProgress,
      run,
      setProgress,
      startProgress,
      stopProgress,
      waitForProgressPaint,
    });
  }

  globalScope.ThinkStockAiForecastApp = Object.freeze({ createAiForecastApp });
}(typeof self !== "undefined" ? self : globalThis));
