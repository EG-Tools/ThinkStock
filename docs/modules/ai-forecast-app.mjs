"use strict";

import {
  createIdleResourceLifecycle,
  createWorkerInstance,
} from "./worker-lifecycle.mjs";

  function createAiForecastApp(scope = globalThis, options = {}) {
    const workerUrl = String(options.workerUrl || "");
    const buildFallback = options.buildFallback;
    let worker = null;
    let sequence = 0;
    let pending = new Map();
    let progressActive = false;
    let progressValue = 0;
    let progressHideTimer = 0;
    let renderHoldDepth = 0;
    let deferredRender = null;
    const createProgressView = options.createProgressView;
    if (typeof createProgressView !== "function") {
      throw new Error("progress view module is unavailable");
    }
    const progressView = createProgressView(scope, {
      getRoot: () => scope.document?.getElementById("aiForecastProgress"),
      getText: () => scope.document?.getElementById("aiForecastProgressText"),
      getBar: () => scope.document?.getElementById("aiForecastProgressBar"),
    });

    function terminateWorker(target = worker) {
      workerLifecycle.cancel();
      if (target === worker) worker = null;
      try { target?.terminate(); } catch (_) {}
    }

    const workerLifecycle = createIdleResourceLifecycle(scope, {
      idleMs: Math.max(10000, Number(options.workerIdleMs) || 60000),
      onIdle: () => {
        if (!pending.size) terminateWorker();
      },
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
      terminateWorker();
    }

    function requestRender(render) {
      if (typeof render !== "function") return false;
      if (renderHoldDepth > 0) {
        deferredRender = render;
        return false;
      }
      return render();
    }

    async function withRenderHold(task, optionsValue = {}) {
      if (typeof task !== "function") return undefined;
      const flush = optionsValue.flush !== false;
      renderHoldDepth += 1;
      try {
        return await task();
      } finally {
        renderHoldDepth = Math.max(0, renderHoldDepth - 1);
        if (renderHoldDepth === 0) {
          const render = deferredRender;
          deferredRender = null;
          if (flush && typeof render === "function") render();
        }
      }
    }

    function ensureWorker() {
      workerLifecycle.markBusy();
      if (worker) return worker;
      if (!workerUrl || typeof scope.Worker !== "function") return null;
      const instance = createWorkerInstance(scope, workerUrl, {
        type: options.workerType,
        name: options.workerName,
      });
      instance.onmessage = (event) => {
        const request = pending.get(Number(event.data?.id));
        if (!request) return;
        pending.delete(Number(event.data.id));
        if (event.data?.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data?.forecast || null);
        if (!pending.size) workerLifecycle.markIdle();
      };
      instance.onerror = () => {
        pending.forEach(({ reject }) => reject(new Error("AI forecast worker failed")));
        pending.clear();
        terminateWorker(instance);
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
          if (!pending.size) workerLifecycle.markIdle();
          resolve(buildFallback?.(optionsValue) || null);
        }
      });
    }

    return Object.freeze({
      cancelCalculations,
      dispose: () => {
        cancelCalculations();
        deferredRender = null;
        renderHoldDepth = 0;
        workerLifecycle.dispose();
      },
      finishProgress,
      isProgressActive: () => progressActive,
      resetProgress,
      requestRender,
      run,
      setProgress,
      startProgress,
      stopProgress,
      waitForProgressPaint,
      withRenderHold,
      workerStats: () => workerLifecycle.stats(),
    });
  }

  function createAiForecastInputCache(options = {}) {
    const maxEntries = Math.max(1, Math.round(Number(options.maxEntries) || 20));
    const entries = new Map();

    function resolve(keyValue, producer) {
      const key = String(keyValue || "");
      if (!key || typeof producer !== "function") return producer?.();
      if (entries.has(key)) {
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      }
      const value = producer();
      entries.set(key, value);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    }

    return Object.freeze({
      clear: () => entries.clear(),
      resolve,
      stats: () => Object.freeze({ entries: entries.size, maxEntries }),
    });
  }

  function createSeriesRevisionCache(options = {}) {
    const fingerprint = options.fingerprint;
    if (typeof fingerprint !== "function") throw new Error("series fingerprint callback is required");
    const maxEntries = Math.max(1, Math.round(Number(options.maxEntries) || 30));
    const logicVersion = String(options.logicVersion || "ai-series-revision-v1");
    const entries = new Map();

    function resolve(seriesValue, rows, sourceRevision, keys = []) {
      const series = String(seriesValue || "").trim().toUpperCase();
      if (!series) return "";
      const revision = String(sourceRevision || "");
      const cached = entries.get(series);
      if (cached?.sourceRevision === revision) return cached.fingerprint;
      const source = Array.isArray(rows) ? rows : [];
      const value = fingerprint(source, keys, {
        tail: Math.max(1, source.length),
        logicVersion,
      });
      entries.delete(series);
      entries.set(series, { sourceRevision: revision, fingerprint: value });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    }

    return Object.freeze({
      clear: () => entries.clear(),
      resolve,
      stats: () => Object.freeze({ entries: entries.size, maxEntries }),
    });
  }

const aiForecastApp = Object.freeze({ createAiForecastApp });
const aiForecastInputCache = Object.freeze({
  createAiForecastInputCache,
  createSeriesRevisionCache,
});

export {
  aiForecastApp,
  aiForecastInputCache,
  createAiForecastApp,
  createAiForecastInputCache,
  createSeriesRevisionCache,
};
