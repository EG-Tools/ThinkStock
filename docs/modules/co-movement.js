(function initThinkStockCoMovement(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTH_DAYS = 365.2425 / 12;
  const FULL_PERIOD_TOLERANCE_DAYS = 10;
  const MINIMUM_CHANGE_SAMPLES = 3;

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function toUtcMs(value) {
    const time = Date.parse(`${String(value || "").slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(time) ? time : null;
  }

  function formatPeriod(months) {
    const safeMonths = Math.max(1 / MONTH_DAYS, Number(months) || 1);
    if (safeMonths < 1) return `${Math.max(1, Math.round(safeMonths * MONTH_DAYS))}일`;
    if (safeMonths >= 11.5) return `${Math.max(1, Math.round(safeMonths / 12))}년`;
    return `${Math.max(1, Math.round(safeMonths))}개월`;
  }

  function calculateDirectionalAgreement(rows, targetKey, comparisonKey) {
    let previous = null;
    let matches = 0;
    let samples = 0;
    let firstDate = "";
    let lastDate = "";

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const target = finiteNumber(row?.[targetKey]);
      const comparison = finiteNumber(row?.[comparisonKey]);
      const date = String(row?.date || "").slice(0, 10);
      if (target === null || comparison === null || !date) return;
      if (!firstDate) firstDate = date;
      lastDate = date;
      if (previous) {
        const targetChange = target - previous.target;
        const comparisonChange = comparison - previous.comparison;
        if (targetChange !== 0 && comparisonChange !== 0) {
          samples += 1;
          if (Math.sign(targetChange) === Math.sign(comparisonChange)) matches += 1;
        }
      }
      previous = { target, comparison };
    });

    return {
      rate: samples >= MINIMUM_CHANGE_SAMPLES ? Math.round((matches / samples) * 100) : null,
      matches,
      samples,
      startDate: firstDate,
      endDate: lastDate,
    };
  }

  function lowerBoundDate(rows, target) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (String(rows[middle]?.date || "") < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBoundDate(rows, target) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (String(rows[middle]?.date || "") <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function sliceRowsByDateRange(rows, range) {
    const source = Array.isArray(rows) ? rows : [];
    const startMs = Number(range?.[0]);
    const endMs = Number(range?.[1]);
    if (!source.length || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return source;
    }
    const start = new Date(startMs).toISOString().slice(0, 10);
    const end = new Date(endMs).toISOString().slice(0, 10);
    return source.slice(lowerBoundDate(source, start), upperBoundDate(source, end));
  }

  function effectivePeriodLabel(rows, targetKey, requestedMonths) {
    const source = Array.isArray(rows) ? rows : [];
    const windowStartMs = toUtcMs(source[0]?.date);
    const targetRows = source.filter((row) => finiteNumber(row?.[targetKey]) !== null);
    const firstTargetMs = toUtcMs(targetRows[0]?.date);
    const lastTargetMs = toUtcMs(targetRows.at(-1)?.date);
    if (firstTargetMs === null || lastTargetMs === null) return "";

    const fullPeriod = windowStartMs !== null
      && firstTargetMs - windowStartMs <= FULL_PERIOD_TOLERANCE_DAYS * DAY_MS;
    if (fullPeriod) return formatPeriod(requestedMonths);
    const availableMonths = Math.min(
      Math.max(1, Number(requestedMonths) || 1),
      Math.max(1, (lastTargetMs - firstTargetMs) / (MONTH_DAYS * DAY_MS)),
    );
    return formatPeriod(availableMonths);
  }

  function buildSummary({ rows, targetKey, targetName, requestedMonths, comparisons }) {
    const periodLabel = effectivePeriodLabel(rows, targetKey, requestedMonths);
    if (!periodLabel) return null;
    return {
      targetKey,
      targetName: String(targetName || targetKey),
      periodLabel,
      comparisons: (Array.isArray(comparisons) ? comparisons : []).map((comparison) => ({
        key: comparison.key,
        label: comparison.label,
        ...calculateDirectionalAgreement(rows, targetKey, comparison.key),
      })),
    };
  }

  function createPanelController(scope = globalScope, options = {}) {
    const document = options.document || scope.document;
    const panel = options.panel || document?.getElementById?.("coMovementPanel");
    const readState = options.readState;
    if (!document || !panel || typeof readState !== "function") {
      throw new Error("co-movement panel dependencies are incomplete");
    }

    const requestFrame = options.requestFrame
      || scope.requestAnimationFrame?.bind(scope)
      || ((callback) => scope.setTimeout(callback, 0));
    const cancelFrame = options.cancelFrame
      || scope.cancelAnimationFrame?.bind(scope)
      || scope.clearTimeout?.bind(scope);
    let frame = 0;
    let lastCalculationKey = "";
    let lastPresentationKey = "";
    let cachedSummary = null;
    const counters = { calculations: 0, renders: 0, skipped: 0 };

    function hide() {
      lastCalculationKey = "";
      cachedSummary = null;
      if (panel.hidden && !panel.childNodes?.length) return;
      panel.hidden = true;
      panel.replaceChildren();
      lastPresentationKey = "";
      counters.renders += 1;
    }

    function calculationModel(state) {
      const range = Array.isArray(state.range) && state.range.length === 2
        ? state.range.map(Number)
        : null;
      const requestedMonths = Number(state.requestedMonths) || 1;
      let visibleRows = state.rows;
      let effectiveMonths = requestedMonths;
      if (range?.every(Number.isFinite)) {
        visibleRows = sliceRowsByDateRange(state.rows, range);
        const spanDays = Math.max(1, (range[1] - range[0]) / DAY_MS);
        if (spanDays <= 45) {
          const tradingDays = visibleRows.reduce((count, row) => (
            finiteNumber(row?.[state.targetKey]) !== null ? count + 1 : count
          ), 0);
          effectiveMonths = Math.max(1, tradingDays) / MONTH_DAYS;
        } else {
          effectiveMonths = spanDays / MONTH_DAYS;
        }
      }
      const comparisons = Array.isArray(state.comparisons) ? state.comparisons : [];
      const key = [
        String(state.revision || ""),
        state.targetKey,
        state.targetName,
        range?.join(":") || "full",
        requestedMonths,
        comparisons.map((item) => `${item.key}:${item.label}`).join(","),
      ].join("|");
      return { comparisons, effectiveMonths, key, visibleRows };
    }

    function applySummary(summary) {
      if (!summary) {
        hide();
        return null;
      }
      const presentationKey = JSON.stringify(summary);
      if (presentationKey === lastPresentationKey && !panel.hidden) {
        counters.skipped += 1;
        return summary;
      }

      const title = document.createElement("strong");
      title.className = "co-movement-title";
      title.textContent = `${summary.targetName} ${summary.periodLabel}`;
      const nodes = [title];
      summary.comparisons.forEach((comparison) => {
        const metric = document.createElement("span");
        metric.className = "co-movement-metric";
        metric.append(`${comparison.label} `);
        const value = document.createElement("b");
        value.textContent = Number.isFinite(comparison.rate) ? `${comparison.rate}%` : "--";
        metric.append(value);
        metric.title = comparison.samples
          ? `${comparison.startDate}~${comparison.endDate}, ${comparison.samples}회 변화 비교`
          : "비교 가능한 데이터가 부족합니다.";
        nodes.push(metric);
      });
      panel.replaceChildren(...nodes);
      panel.setAttribute("aria-label", nodes.map((node) => node.textContent).join(", "));
      panel.hidden = false;
      lastPresentationKey = presentationKey;
      counters.renders += 1;
      return summary;
    }

    function renderNow() {
      frame = 0;
      options.syncControl?.();
      const state = readState() || {};
      if (!state.enabled || !state.targetKey || !Array.isArray(state.rows) || !state.rows.length) {
        hide();
        return null;
      }
      const model = calculationModel(state);
      if (model.key !== lastCalculationKey) {
        cachedSummary = buildSummary({
          rows: model.visibleRows,
          targetKey: state.targetKey,
          targetName: state.targetName,
          requestedMonths: model.effectiveMonths,
          comparisons: model.comparisons,
        });
        lastCalculationKey = model.key;
        counters.calculations += 1;
      } else {
        counters.skipped += 1;
      }
      return applySummary(cachedSummary);
    }

    function request() {
      if (frame) return false;
      frame = requestFrame(renderNow);
      return true;
    }

    function flush() {
      if (frame) cancelFrame?.(frame);
      frame = 0;
      return renderNow();
    }

    function invalidate() {
      lastCalculationKey = "";
      lastPresentationKey = "";
      cachedSummary = null;
    }

    function dispose() {
      if (frame) cancelFrame?.(frame);
      frame = 0;
      invalidate();
    }

    return Object.freeze({
      dispose,
      flush,
      invalidate,
      renderNow,
      request,
      stats: () => Object.freeze({ ...counters, pending: Boolean(frame) }),
    });
  }

  globalScope.ThinkStockCoMovement = Object.freeze({
    buildSummary,
    calculateDirectionalAgreement,
    createPanelController,
    effectivePeriodLabel,
    formatPeriod,
    sliceRowsByDateRange,
  });
}(typeof self !== "undefined" ? self : globalThis));
