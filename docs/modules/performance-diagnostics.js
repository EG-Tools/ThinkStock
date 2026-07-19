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
    const historyLimit = Math.max(1, Number(options.historyLimit) || 12);
    const performanceApi = options.performanceApi || scope.ThinkStockPerf;

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
        at: new Date().toISOString(),
        appVersion: String(metadata.appVersion || ""),
        buildVersion: String(metadata.buildVersion || ""),
        performance: performanceApi?.summary?.() || {},
        latestOperations: performanceApi?.getLatestOperations?.() || {},
        slowOperations: (performanceApi?.getSlowOperations?.() || []).slice(-5),
        storage: await readStorageState(),
      };
      const history = readHistory().filter((item) => (
        item?.buildVersion !== report.buildVersion || item?.appVersion !== report.appVersion
      ));
      history.unshift(report);
      writeHistory(history);
      return report;
    }

    function clear() {
      try { scope.localStorage?.removeItem(storageKey); } catch (_) {}
    }

    function reportLines(report, previous = null) {
      if (!report) return ["아직 측정된 기록이 없습니다."];
      const latest = report.latestOperations || {};
      const perf = report.performance || {};
      const storage = report.storage || {};
      const lines = [
        `현재 ${report.appVersion || "-"} · 부팅 ${formatMilliseconds(latest.appStartup?.duration)}`,
        `차트 ${formatMilliseconds(latest.renderChart?.duration)} · 보조차트 ${formatMilliseconds(latest.renderAdrChart?.duration)}`,
        `긴 작업 ${Number(perf.longTasks) || 0}회 · 최대 ${formatMilliseconds(perf.maxLongTask)}`,
        `저장공간 ${formatMegabytes(storage.usage)} / ${formatMegabytes(storage.quota)}${storage.persisted ? " · 보호됨" : ""}`,
      ];
      if (previous) {
        lines.push(
          `이전 ${previous.appVersion || "-"} · 부팅 ${formatMilliseconds(previous.latestOperations?.appStartup?.duration)}`,
        );
      }
      return lines;
    }

    return Object.freeze({
      capture,
      clear,
      readHistory,
      readStorageState,
      reportLines,
    });
  }

  globalScope.ThinkStockPerformanceDiagnostics = Object.freeze({
    createPerformanceDiagnostics,
    formatMegabytes,
    formatMilliseconds,
  });
}(typeof self !== "undefined" ? self : globalThis));
