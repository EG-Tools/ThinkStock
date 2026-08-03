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
    const safeMonths = Math.max(1, Number(months) || 1);
    if (safeMonths >= 12) return `${Math.max(1, Math.round(safeMonths / 12))}년`;
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

  globalScope.ThinkStockCoMovement = Object.freeze({
    buildSummary,
    calculateDirectionalAgreement,
    effectivePeriodLabel,
    formatPeriod,
  });
}(typeof self !== "undefined" ? self : globalThis));
