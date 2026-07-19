(function initThinkStockPerformanceDiagnostics(globalScope) {
  "use strict";

  function formatMilliseconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? `${Math.round(number)}ms` : "-";
  }

  function formatMegabytes(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? `${Math.round((number / (1024 * 1024)) * 10) / 10}MB`
      : "-";
  }

  function createPerformanceDiagnostics(scope = globalScope, options = {}) {
    const storageKey = String(options.storageKey || "thinkstock-performance-history-v1");
    const historyLimit = Math.max(1, Number(options.historyLimit) || 24);
    const performanceApi = options.performanceApi || scope.ThinkStockPerf;
    const sessionId = String(
      options.sessionId
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    let automaticStop = null;

    function readHistory() {
      try {
        const parsed = JSON.parse(scope.localStorage?.getItem(storageKey) || "[]");
        return Array.isArray(parsed) ? parsed.slice(0, historyLimit) : [];
      } catch (_) {
        return [];
      }
    }

    function writeHistory(history) {
      try {
        scope.localStorage?.setItem(storageKey, JSON.stringify(history.slice(0, historyLimit)));
      } catch (_) {
        // Diagnostics must not interfere with normal storage use.
      }
    }

    async function readStorageState() {
      const storage = scope.navigator?.storage;
      let estimate = {};
      let persisted = null;
      try { estimate = await storage?.estimate?.() || {}; } catch (_) {}
      try { persisted = await storage?.persisted?.(); } catch (_) {}
      return {
        usage: Number(estimate.usage) || 0,
        quota: Number(estimate.quota) || 0,
        persisted: persisted === true,
      };
    }

    async function capture(metadata = {}) {
      const report = {
        id: `${String(metadata.appVersion || "")}:${String(metadata.buildVersion || "")}:${sessionId}`,
        sessionId,
        at: new Date().toISOString(),
        appVersion: String(metadata.appVersion || ""),
        buildVersion: String(metadata.buildVersion || ""),
        reason: String(metadata.reason || "manual"),
        performance: performanceApi?.summary?.() || {},
        latestOperations: performanceApi?.getLatestOperations?.() || {},
        slowOperations: (performanceApi?.getSlowOperations?.() || []).slice(-5),
        storage: await readStorageState(),
      };
      const history = readHistory().filter((item) => item?.id !== report.id);
      history.unshift(report);
      writeHistory(history);
      return report;
    }

    function percentile(values, ratio) {
      const sorted = values
        .map((value) => Number(value) || 0)
        .filter((value) => value > 0)
        .sort((left, right) => left - right);
      return sorted.length ? sorted[Math.floor((sorted.length - 1) * ratio)] : 0;
    }

    function summarizeVersion(history, appVersion) {
      const reports = history.filter((item) => item?.appVersion === appVersion);
      const operationDurations = (name) => reports.map(
        (item) => item?.latestOperations?.[name]?.duration,
      );
      const metricValues = (name) => reports.map((item) => item?.performance?.[name]);
      return {
        appVersion,
        sessions: new Set(reports.map((item) => item?.sessionId).filter(Boolean)).size,
        startupP50: percentile(operationDurations("appStartup"), 0.5),
        startupP95: percentile(operationDurations("appStartup"), 0.95),
        chartP95: percentile([
          ...operationDurations("renderChart"),
          ...metricValues("p95RenderChart"),
        ], 0.95),
        pointerP95: percentile(metricValues("p95PointerMove"), 0.95),
      };
    }

    function comparisonFor(report) {
      const history = readHistory();
      const previousVersion = history.find(
        (item) => item?.appVersion && item.appVersion !== report?.appVersion,
      )?.appVersion || "";
      return {
        current: summarizeVersion(history, report?.appVersion || ""),
        previous: previousVersion ? summarizeVersion(history, previousVersion) : null,
      };
    }

    function startAutomaticCapture(metadata = {}, captureOptions = {}) {
      automaticStop?.();
      const delayMs = Math.max(1000, Number(captureOptions.delayMs) || 15000);
      const minimumIntervalMs = Math.max(1000, Number(captureOptions.minimumIntervalMs) || 30000);
      let lastCaptureAt = 0;
      let stopped = false;
      let timerId = 0;

      const captureReason = (reason) => {
        const now = Date.now();
        if (stopped || now - lastCaptureAt < minimumIntervalMs) return;
        lastCaptureAt = now;
        capture({ ...metadata, reason }).catch(() => {});
      };
      const onVisibilityChange = () => {
        if (scope.document?.visibilityState === "hidden") captureReason("hidden");
      };
      const onPageHide = () => captureReason("pagehide");

      timerId = scope.setTimeout?.(() => captureReason("idle"), delayMs) || 0;
      scope.document?.addEventListener?.("visibilitychange", onVisibilityChange);
      scope.addEventListener?.("pagehide", onPageHide);
      automaticStop = () => {
        stopped = true;
        if (timerId) scope.clearTimeout?.(timerId);
        scope.document?.removeEventListener?.("visibilitychange", onVisibilityChange);
        scope.removeEventListener?.("pagehide", onPageHide);
        automaticStop = null;
      };
      return automaticStop;
    }

    function clear() {
      try { scope.localStorage?.removeItem(storageKey); } catch (_) {}
    }

    function reportLines(report, comparison = null) {
      if (!report) return ["아직 측정된 기록이 없습니다."];
      const latest = report.latestOperations || {};
      const perf = report.performance || {};
      const storage = report.storage || {};
      const current = comparison?.current;
      const lines = [
        current?.sessions
          ? `현재 ${report.appVersion || "-"} · ${current.sessions}회 · 부팅 중앙 ${formatMilliseconds(current.startupP50)} / 느린 ${formatMilliseconds(current.startupP95)}`
          : `현재 ${report.appVersion || "-"} · 부팅 ${formatMilliseconds(latest.appStartup?.duration)}`,
        `차트 ${formatMilliseconds(current?.chartP95 || latest.renderChart?.duration)} · 포인터 ${formatMilliseconds(current?.pointerP95 || perf.p95PointerMove)}`,
        `긴 작업 ${Number(perf.longTasks) || 0}회 · 최대 ${formatMilliseconds(perf.maxLongTask)}`,
        `저장공간 ${formatMegabytes(storage.usage)} / ${formatMegabytes(storage.quota)}${storage.persisted ? " · 보호됨" : ""}`,
      ];
      if (comparison?.previous) {
        lines.push(
          `이전 ${comparison.previous.appVersion || "-"} · ${comparison.previous.sessions}회 · 부팅 느린 ${formatMilliseconds(comparison.previous.startupP95)}`,
        );
      }
      return lines;
    }

    return Object.freeze({
      capture,
      clear,
      comparisonFor,
      readHistory,
      readStorageState,
      reportLines,
      startAutomaticCapture,
      summarizeVersion,
    });
  }

  globalScope.ThinkStockPerformanceDiagnostics = Object.freeze({
    createPerformanceDiagnostics,
    formatMegabytes,
    formatMilliseconds,
  });
}(typeof self !== "undefined" ? self : globalThis));
