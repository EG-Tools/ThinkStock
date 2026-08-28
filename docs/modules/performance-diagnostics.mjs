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

  const SENSITIVE_KEY_PATTERN = /(?:token|secret|password|api[_-]?key|service[_-]?key|crtfc[_-]?key|access[_-]?(?:code|key)|auth(?:orization)?[_-]?key|credential)/i;
  const SENSITIVE_TEXT_PATTERN = /((?:token|secret|password|api[_-]?key|service[_-]?key|crtfc[_-]?key|access[_-]?(?:code|key)|auth(?:orization)?[_-]?key|credential)\s*[=:]\s*)[^\s&#,;]+/gi;
  const ECOS_KEY_PATH_PATTERN = /(\/StatisticSearch\/)[^/\s]+(?=\/)/gi;

  function sanitizeForExport(value, seen = new WeakSet()) {
    if (typeof value === "string") {
      return value
        .replace(SENSITIVE_TEXT_PATTERN, "$1[redacted]")
        .replace(ECOS_KEY_PATH_PATTERN, "$1[redacted]");
    }
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => sanitizeForExport(item, seen));
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (
      SENSITIVE_KEY_PATTERN.test(key)
        ? []
        : [[key, sanitizeForExport(item, seen)]]
    )));
  }

  // Continuous browser observers stay in the delayed diagnostics bundle so normal use only
  // pays for explicit operation timings recorded by the lightweight performance core.
  function createBrowserPerformanceMonitor(scope = globalThis, options = {}) {
    const frameGapIgnoreMs = Number(options.frameGapIgnoreMs) || 1000;
    const frameSampleLimit = Number(options.frameSampleLimit) || 1200;
    const longFrameMs = Number(options.longFrameMs) || 50;
    const longTaskSampleLimit = Number(options.longTaskSampleLimit) || 40;
    let enabled = false;
    let frameRafId = 0;
    let lastFrameAt = 0;
    let frameStats = { frames: 0, longFrames: 0, maxFrameGap: 0 };
    let frameGaps = [];
    let longTasks = [];
    let longTaskObserver = null;

    function stopFrameMonitor() {
      if (frameRafId && typeof scope.cancelAnimationFrame === "function") {
        scope.cancelAnimationFrame(frameRafId);
      }
      frameRafId = 0;
      lastFrameAt = 0;
    }

    function startFrameMonitor() {
      if (!enabled || frameRafId || typeof scope.requestAnimationFrame !== "function") return;
      const tick = (timestamp) => {
        frameRafId = 0;
        if (!enabled) return;
        if (lastFrameAt > 0 && scope.document?.visibilityState === "visible") {
          const gap = timestamp - lastFrameAt;
          if (gap > 0 && gap < frameGapIgnoreMs) {
            const roundedGap = Math.round(gap * 10) / 10;
            frameStats.frames += 1;
            frameStats.maxFrameGap = Math.max(frameStats.maxFrameGap, roundedGap);
            frameGaps.push(roundedGap);
            if (frameGaps.length > frameSampleLimit) frameGaps.shift();
            if (gap >= longFrameMs) frameStats.longFrames += 1;
          }
        }
        lastFrameAt = timestamp;
        frameRafId = scope.requestAnimationFrame(tick);
      };
      frameRafId = scope.requestAnimationFrame(tick);
    }

    function stopLongTaskMonitor() {
      try { longTaskObserver?.disconnect?.(); } catch (_) {}
      longTaskObserver = null;
    }

    function startLongTaskMonitor() {
      if (!enabled || longTaskObserver || typeof scope.PerformanceObserver !== "function") return;
      try {
        longTaskObserver = new scope.PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            const attribution = Array.isArray(entry.attribution) ? entry.attribution[0] : null;
            longTasks.push({
              duration: Math.round((Number(entry.duration) || 0) * 10) / 10,
              startTime: Math.round((Number(entry.startTime) || 0) * 10) / 10,
              source: String(
                attribution?.containerId
                || attribution?.containerName
                || attribution?.name
                || entry.name
                || "main-thread",
              ),
            });
          });
          if (longTasks.length > longTaskSampleLimit) {
            longTasks.splice(0, longTasks.length - longTaskSampleLimit);
          }
        });
        longTaskObserver.observe({ type: "longtask", buffered: true });
      } catch (_) {
        stopLongTaskMonitor();
      }
    }

    function setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      if (enabled) {
        startFrameMonitor();
        startLongTaskMonitor();
      } else {
        stopFrameMonitor();
        stopLongTaskMonitor();
      }
      return enabled;
    }

    function clear() {
      lastFrameAt = 0;
      frameStats = { frames: 0, longFrames: 0, maxFrameGap: 0 };
      frameGaps = [];
      longTasks = [];
    }

    function summary() {
      const sortedFrameGaps = [...frameGaps].sort((left, right) => left - right);
      const sortedLongTasks = [...longTasks].sort((left, right) => left.duration - right.duration);
      return {
        ...frameStats,
        p95FrameGap: sortedFrameGaps.length
          ? sortedFrameGaps[Math.floor((sortedFrameGaps.length - 1) * 0.95)]
          : 0,
        longFrameRatio: frameStats.frames > 0 ? frameStats.longFrames / frameStats.frames : 0,
        longTasks: longTasks.length,
        p95LongTask: sortedLongTasks.length
          ? sortedLongTasks[Math.floor((sortedLongTasks.length - 1) * 0.95)].duration
          : 0,
        maxLongTask: sortedLongTasks.at(-1)?.duration || 0,
        latestLongTaskSource: longTasks.at(-1)?.source || "",
      };
    }

    function dispose() {
      stopFrameMonitor();
      stopLongTaskMonitor();
    }

    return Object.freeze({
      clear,
      dispose,
      getLongTasks: () => [...longTasks],
      setEnabled,
      startFrameMonitor,
      startLongTaskMonitor,
      stopFrameMonitor,
      stopLongTaskMonitor,
      summary,
    });
  }

  function createPerformanceDiagnostics(scope = globalThis, options = {}) {
    const storageKey = String(options.storageKey || "thinkstock-performance-history-v1");
    const historyLimit = Math.max(1, Number(options.historyLimit) || 24);
    const performanceApi = options.performanceApi || null;
    const browserPerformanceMonitor = typeof performanceApi?.attachBrowserMetricsProvider === "function"
      ? createBrowserPerformanceMonitor(scope, options.browserPerformance || {})
      : null;
    const detachBrowserPerformance = browserPerformanceMonitor
      ? performanceApi.attachBrowserMetricsProvider(browserPerformanceMonitor)
      : null;
    const evaluateBudget = typeof options.evaluateBudget === "function"
      ? options.evaluateBudget
      : null;
    const evaluateChartRenderBudget = typeof options.evaluateChartRenderBudget === "function"
      ? options.evaluateChartRenderBudget
      : null;
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
      const performance = performanceApi?.summary?.() || {};
      const history = readHistory();
      const reportId = `${String(metadata.appVersion || "")}:${String(metadata.buildVersion || "")}:${sessionId}`;
      const previous = history.find((item) => item?.id === reportId);
      const appState = {
        ...(previous?.appState || {}),
        ...(metadata?.appState || {}),
      };
      const budgetResults = [
        evaluateBudget ? evaluateBudget(performance) : null,
        evaluateChartRenderBudget ? evaluateChartRenderBudget(appState.chartRender || {}) : null,
      ].filter(Boolean);
      const budget = budgetResults.length ? {
        ok: budgetResults.every((result) => result.ok !== false),
        skipped: budgetResults.flatMap((result) => result.skipped || []),
        violations: budgetResults.flatMap((result) => result.violations || []),
      } : null;
      const report = {
        id: reportId,
        sessionId,
        at: new Date().toISOString(),
        appVersion: String(metadata.appVersion || ""),
        buildVersion: String(metadata.buildVersion || ""),
        reason: String(metadata.reason || "manual"),
        performance,
        budget,
        latestOperations: performanceApi?.getLatestOperations?.() || {},
        operationProfiles: performanceApi?.getOperationProfiles?.() || [],
        slowOperations: (performanceApi?.getSlowOperations?.() || []).slice(-5),
        recentErrors: (performanceApi?.getRecentErrors?.() || []).slice(-5),
        storage: await readStorageState(),
        appState,
      };
      const nextHistory = history.filter((item) => item?.id !== report.id);
      nextHistory.unshift(report);
      writeHistory(nextHistory);
      return report;
    }

    function percentile(values, ratio) {
      const sorted = values
        .map((value) => Number(value) || 0)
        .filter((value) => value > 0)
        .sort((left, right) => left - right);
      return sorted.length ? sorted[Math.floor((sorted.length - 1) * ratio)] : 0;
    }

    function summarizeChartSeriesBands(reports) {
      const bands = new Map();
      reports.forEach((report) => {
        const values = report?.appState?.chartRender?.bySeriesBand || {};
        Object.entries(values).forEach(([name, sample]) => {
          const renders = Math.max(0, Number(sample?.renders) || 0);
          if (!renders) return;
          const group = bands.get(name) || {
            sessions: 0,
            renders: 0,
            weightedDuration: 0,
            maximumMs: 0,
            maximumOverlays: 0,
            maximumPoints: 0,
          };
          group.sessions += 1;
          group.renders += renders;
          group.weightedDuration += Math.max(0, Number(sample?.averageMs) || 0) * renders;
          group.maximumMs = Math.max(group.maximumMs, Number(sample?.maximumMs) || 0);
          group.maximumOverlays = Math.max(
            group.maximumOverlays,
            Number(sample?.maximumOverlays) || 0,
          );
          group.maximumPoints = Math.max(group.maximumPoints, Number(sample?.maximumPoints) || 0);
          bands.set(name, group);
        });
      });
      return Object.freeze(Object.fromEntries([...bands.entries()].map(([name, group]) => [
        name,
        Object.freeze({
          sessions: group.sessions,
          renders: group.renders,
          averageMs: group.renders
            ? Math.round((group.weightedDuration / group.renders) * 10) / 10
            : 0,
          maximumMs: Math.round(group.maximumMs * 10) / 10,
          maximumOverlays: group.maximumOverlays,
          maximumPoints: group.maximumPoints,
        }),
      ])));
    }

    function summarizeVersion(history, appVersion) {
      const reports = history.filter((item) => item?.appVersion === appVersion);
      const operationDurations = (name) => reports.map(
        (item) => item?.latestOperations?.[name]?.duration,
      );
      const metricValues = (name) => reports.map((item) => item?.performance?.[name]);
      const operationGroups = new Map();
      reports.forEach((report) => {
        (report?.operationProfiles || []).forEach((profile) => {
          const label = String(profile?.label || "").trim();
          const duration = Number(profile?.p95);
          if (!label || !Number.isFinite(duration)) return;
          const group = operationGroups.get(label) || { durations: [], samples: 0 };
          group.durations.push(duration);
          group.samples += Math.max(0, Number(profile?.count) || 0);
          operationGroups.set(label, group);
        });
      });
      const topOperations = [...operationGroups.entries()].map(([label, group]) => ({
        label,
        sessions: group.durations.length,
        samples: group.samples,
        p50: percentile(group.durations, 0.5),
        p95: percentile(group.durations, 0.95),
        max: Math.max(0, ...group.durations),
      })).sort((left, right) => right.p95 - left.p95 || right.samples - left.samples).slice(0, 8);
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
        chartSeriesBands: summarizeChartSeriesBands(reports),
        topOperations,
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
        Promise.resolve().then(async () => {
          let dynamicMetadata = {};
          try {
            dynamicMetadata = await captureOptions.metadataProvider?.({ reason }) || {};
          } catch (_) {
            // A diagnostics provider must never interfere with the app lifecycle.
          }
          return capture({
            ...metadata,
            ...dynamicMetadata,
            reason,
            appState: {
              ...(metadata?.appState || {}),
              ...(dynamicMetadata?.appState || {}),
            },
          });
        }).catch(() => {});
      };
      const onVisibilityChange = () => {
        if (scope.document?.visibilityState === "hidden") captureReason("hidden");
      };
      const onPageHide = () => captureReason("pagehide");

      if (captureOptions.captureOnIdle !== false) {
        timerId = scope.setTimeout?.(() => captureReason("idle"), delayMs) || 0;
      }
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

    function dispose() {
      automaticStop?.();
      detachBrowserPerformance?.();
    }

    async function exportSnapshot(metadata = {}) {
      const report = await capture({ ...metadata, reason: "manual-export" });
      return sanitizeForExport({
        format: "thinkstock-diagnostics-v1",
        exportedAt: new Date().toISOString(),
        current: report,
        history: readHistory(),
      });
    }

    function downloadSnapshot(payload, filename = "thinkstock-diagnostics.json") {
      if (!scope.document?.createElement || !scope.URL?.createObjectURL || typeof scope.Blob !== "function") {
        return false;
      }
      const blob = new scope.Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = scope.URL.createObjectURL(blob);
      const anchor = scope.document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.hidden = true;
      scope.document.body?.append?.(anchor);
      anchor.click();
      anchor.remove?.();
      scope.setTimeout?.(() => scope.URL.revokeObjectURL(url), 0);
      return true;
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
      const latestError = report.recentErrors?.at(-1);
      if (latestError) lines.push(`최근 오류 ${latestError.source}: ${latestError.message}`);
      if (report.budget?.violations?.length) {
        lines.push(`Performance warning: ${report.budget.violations.map((item) => item.metric).join(", ")}`);
      }
      return lines;
    }

    return Object.freeze({
      capture,
      clear,
      comparisonFor,
      dispose,
      downloadSnapshot,
      exportSnapshot,
      readHistory,
      readStorageState,
      reportLines,
      startAutomaticCapture,
      summarizeVersion,
    });
  }

const performanceDiagnostics = Object.freeze({
    createBrowserPerformanceMonitor,
    createPerformanceDiagnostics,
    formatMegabytes,
    formatMilliseconds,
    sanitizeForExport,
});

export {
  createBrowserPerformanceMonitor,
  createPerformanceDiagnostics,
  formatMegabytes,
  formatMilliseconds,
  sanitizeForExport,
};
export default performanceDiagnostics;
