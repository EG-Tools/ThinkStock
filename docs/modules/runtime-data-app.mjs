import { createRuntimeSourceHealth } from "./runtime-source-health.mjs";

"use strict";

  function createRuntimeDataApp(scope = globalThis, options = {}) {
    let refreshController = null;
    let refreshPromise = null;
    let refreshGeneration = 0;
    const phaseStats = { criticalReady: 0, supplementalReady: 0 };
    let status = { state: "idle", detail: "", updatedAt: 0 };
    let statusHideTimer = 0;
    let statusFadeTimer = 0;
    const sourceLedger = options.sourceLedger || createRuntimeSourceHealth(scope, { storage: null });

    function setStatus(state, detail = "") {
      status = { state, detail: String(detail || ""), updatedAt: Date.now() };
      const element = scope.document?.getElementById("runtimeRefreshStatus");
      if (!element) return;
      if (statusHideTimer) scope.clearTimeout(statusHideTimer);
      if (statusFadeTimer) scope.clearTimeout(statusFadeTimer);
      statusHideTimer = 0;
      statusFadeTimer = 0;
      element.hidden = false;
      element.classList.remove("is-fading");
      element.classList.toggle("is-loading", state === "loading");
      element.classList.toggle("is-error", state === "error");
      element.dataset.state = state;
      element.textContent = status.detail || "최신 데이터 확인 대기";
      if (state === "loading") return;
      statusHideTimer = scope.setTimeout(() => {
        element.classList.add("is-fading");
        statusFadeTimer = scope.setTimeout(() => {
          element.hidden = true;
          element.classList.remove("is-fading");
          statusFadeTimer = 0;
        }, 2000);
      }, 3000);
    }

    function notePhase(name) {
      if (Object.hasOwn(phaseStats, name)) phaseStats[name] += 1;
    }

    function sourceResultDetail(result = {}) {
      const quality = result?.quality && typeof result.quality === "object" ? result.quality : {};
      return {
        firstDate: quality.firstDate || result.firstDate || result.sourceFirstDate || "",
        latestDate: quality.latestDate || result.latestDate || result.sourceLatestDate || "",
        anomalyCount: quality.anomalyCount ?? result.anomalyCount ?? 0,
        gapCount: quality.gapCount ?? result.gapCount ?? 0,
        isEmpty: quality.isEmpty === true || result.isEmpty === true,
        isStale: quality.isStale === true || result.stale === true || result.isStale === true,
        revision: quality.revision || result.revision || "",
        detail: (result.applied || result.info || []).join?.(" · ") || result.detail || "",
      };
    }

    function noteSourceResult(source, result = {}) {
      const detail = sourceResultDetail(result);
      let sourceState = null;
      if (result?.ok === false) {
        const error = new Error(result.error || `${source} refresh failed`);
        sourceState = sourceLedger?.failure?.(source, error) || null;
      } else {
        if (typeof sourceLedger?.recordSuccess === "function") {
          sourceState = sourceLedger.recordSuccess(source, detail);
        } else {
          sourceLedger?.success?.(source, detail);
          sourceState = sourceLedger?.observe?.(source, detail) || null;
        }
      }
      Object.entries(result?.components || {}).forEach(([component, componentResult]) => {
        const componentSource = component.includes(":") ? component : `${source}:${component}`;
        noteSourceResult(componentSource, componentResult || {});
      });
      return sourceState;
    }

    function isAbort(error, signal) {
      return signal?.aborted || error?.name === "AbortError" || options.isAbortError?.(error) === true;
    }

    function refresh(messageElement, refreshOptions = {}) {
      const forceNetwork = Boolean(refreshOptions.forceNetwork);
      if (refreshPromise && !forceNetwork) return refreshPromise;
      if (refreshController) {
        const superseded = new Error("Superseded by a newer data refresh");
        superseded.name = "AbortError";
        refreshController.abort(superseded);
      }
      const controller = new AbortController();
      const generation = ++refreshGeneration;
      refreshController = controller;
      const task = Promise.resolve(options.runRefresh(messageElement, {
        ...refreshOptions,
        signal: controller.signal,
        generation,
      })).catch((error) => {
        if (isAbort(error, controller.signal)) return { cancelled: true };
        setStatus("error", "최신 데이터 확인 실패 · 저장된 값 사용 중");
        throw error;
      }).finally(() => {
        if (refreshGeneration !== generation) return;
        refreshController = null;
        refreshPromise = null;
      });
      refreshPromise = task;
      return task;
    }

    async function prepareInitialData(flow = {}) {
      const restoredSnapshot = await flow.restoreSnapshot();
      if (restoredSnapshot) flow.setProgress?.(42, "Restoring last view");
      else {
        await flow.loadSeed();
        flow.setProgress?.(45, "Loading saved data");
      }
      if (flow.needsHistorical?.()) {
        flow.setProgress?.(50, "Loading historical data");
        try {
          await flow.loadHistorical();
        } catch (error) {
          flow.onHistoricalError?.(error);
        }
      }
      flow.setProgress?.(56, "Loading chart engine");
      const plotlyResult = await flow.plotlyReady;
      if (plotlyResult?.error) throw plotlyResult.error;
      await flow.renderMain();
      flow.setProgress?.(72, restoredSnapshot ? "Rendering last view" : "Rendering saved data");
      return Boolean(restoredSnapshot);
    }

    function waitForFirstPaint() {
      return new Promise((resolve) => {
        const done = () => scope.setTimeout(resolve, 0);
        if (typeof scope.requestAnimationFrame === "function") scope.requestAnimationFrame(done);
        else done();
      });
    }

    async function refreshDuringStartup(messageElement, flow = {}) {
      if (flow.restoredSnapshot) await flow.mergeSeed?.();
      let releaseCritical = null;
      let criticalReleased = false;
      const criticalReady = new Promise((resolve) => {
        releaseCritical = (result) => {
          if (criticalReleased) return;
          criticalReleased = true;
          resolve(result);
        };
      });
      const refreshTask = refresh(messageElement, {
        awaitCriticalRender: true,
        awaitSupplementalRender: true,
        deferSupplementalUntilReady: true,
        incrementalSupplementalRender: true,
        onCriticalProgress: flow.onCriticalProgress,
        onCriticalReady: () => releaseCritical({ ok: true }),
      }).then((result) => {
        releaseCritical({ ok: !result?.cancelled });
      }).catch((error) => {
        flow.onError?.(error);
        releaseCritical({ ok: false });
      });
      const criticalResult = await criticalReady;
      const settleAfterCriticalMs = Math.max(0, Number(flow.settleAfterCriticalMs) || 0);
      if (!settleAfterCriticalMs) return { critical: criticalResult, settled: false };

      let settleTimer = 0;
      const settled = await Promise.race([
        refreshTask.then(() => true, () => true),
        new Promise((resolve) => {
          settleTimer = scope.setTimeout(() => resolve(false), settleAfterCriticalMs);
        }),
      ]);
      if (settleTimer) scope.clearTimeout?.(settleTimer);
      return { critical: criticalResult, settled };
    }

    return Object.freeze({
      canAttemptSource: (source, attemptOptions) => sourceLedger?.canAttempt?.(source, attemptOptions)
        || { allowed: true, source: String(source || ""), waitMs: 0, state: null },
      getSourceStates: () => sourceLedger?.snapshot?.() || {},
      getPhaseStats: () => ({ ...phaseStats }),
      getStatus: () => ({ ...status }),
      noteSourceFailure: (source, error) => sourceLedger?.failure?.(source, error) || null,
      noteSourceQuality: (source, detail) => sourceLedger?.observe?.(source, detail) || null,
      noteSourceResult,
      noteSourceSuccess: (source, detail) => sourceLedger?.success?.(source, detail) || null,
      notePhase,
      prepareInitialData,
      refresh,
      refreshDuringStartup,
      setStatus,
      dispose: () => {
        if (refreshController) {
          const closed = new Error("Runtime data app disposed");
          closed.name = "AbortError";
          refreshController.abort(closed);
        }
        refreshGeneration += 1;
        refreshController = null;
        refreshPromise = null;
        if (statusHideTimer) scope.clearTimeout?.(statusHideTimer);
        if (statusFadeTimer) scope.clearTimeout?.(statusFadeTimer);
        statusHideTimer = 0;
        statusFadeTimer = 0;
        sourceLedger?.dispose?.();
      },
      waitForFirstPaint,
    });
  }

export { createRuntimeDataApp };
