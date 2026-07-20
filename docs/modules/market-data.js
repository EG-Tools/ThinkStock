(function initThinkStockMarketData(globalScope) {
  const DEFAULT_DAY_MS = 24 * 60 * 60 * 1000;

  const toNum = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const toUtcMs = (date) => Date.parse(`${date}T00:00:00Z`);

  function normalizePayloadRecords(records) {
    const shared = globalScope.ThinkStockDataPayload?.normalizePayloadRecords;
    if (typeof shared === "function") return shared(records);
    return (Array.isArray(records) ? records : [])
      .map((row) => {
        const source = row && typeof row === "object" ? row : {};
        const output = { date: String(source.date || "").slice(0, 10) };
        Object.entries(source).forEach(([key, value]) => {
          if (key !== "date") output[key] = toNum(value);
        });
        return output;
      })
      .filter((row) => row.date)
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  function rowsFromPayload(payload) {
    const shared = globalScope.ThinkStockDataPayload?.rowsFromColumnarPayload;
    if (typeof shared === "function") return shared(payload);
    const dates = Array.isArray(payload?.dates) ? payload.dates : [];
    const columns = payload?.columns && typeof payload.columns === "object" ? payload.columns : null;
    if (!dates.length || !columns) return normalizePayloadRecords(payload?.records);
    const series = Array.isArray(payload.series) && payload.series.length
      ? payload.series.map(String).filter(Boolean)
      : Object.keys(columns);
    return dates.map((date, index) => {
      const row = { date: String(date || "").slice(0, 10) };
      series.forEach((key) => { row[key] = toNum(columns[key]?.[index]); });
      return row;
    }).filter((row) => row.date).sort((left, right) => left.date.localeCompare(right.date));
  }

  function getSeriesColumns(rows) {
    const columns = new Set();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (key !== "date") columns.add(key);
      });
    });
    return [...columns];
  }

  function copyDisplayNames(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return Object.fromEntries(
      Object.entries(source)
        .filter(([key, value]) => key && typeof value === "string" && value.trim())
        .map(([key, value]) => [key, value.trim()]),
    );
  }

  function sanitizePricePayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const records = Array.isArray(raw.records)
      ? normalizePayloadRecords(raw.records)
      : rowsFromPayload(raw);
    if (!records.length) return null;
    return {
      generated_at: typeof raw.generated_at === "string" ? raw.generated_at : "",
      records,
      series: Array.isArray(raw.series) ? raw.series.filter(Boolean) : getSeriesColumns(records),
      display_names: copyDisplayNames(raw.display_names),
    };
  }

  function mergeRowsPreservingExisting(existingRows, incomingRows) {
    const byDate = new Map();
    normalizePayloadRecords(existingRows).forEach((row) => byDate.set(row.date, { ...row }));
    normalizePayloadRecords(incomingRows).forEach((row) => {
      const previous = byDate.get(row.date);
      if (!previous) {
        byDate.set(row.date, { ...row });
        return;
      }
      const merged = { ...previous };
      Object.entries(row).forEach(([key, value]) => {
        if (key !== "date" && toNum(merged[key]) === null && toNum(value) !== null) {
          merged[key] = toNum(value);
        }
      });
      byDate.set(row.date, merged);
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function mergePricePayloadPreservingExisting(existingPayload, incomingPayload) {
    const existing = sanitizePricePayload(existingPayload);
    const incoming = sanitizePricePayload(incomingPayload);
    if (!existing) return incoming;
    if (!incoming) return existing;
    const records = mergeRowsPreservingExisting(existing.records, incoming.records);
    return {
      ...incoming,
      records,
      series: [...new Set([
        ...(incoming.series || []),
        ...(existing.series || []),
        ...getSeriesColumns(records),
      ])],
      display_names: {
        ...(incoming.display_names || {}),
        ...(existing.display_names || {}),
      },
    };
  }

  function normalizeTickerPricePoints(points) {
    const byDate = new Map();
    (Array.isArray(points) ? points : []).forEach((point) => {
      const date = String(point?.date || "").slice(0, 10);
      const close = toNum(point?.close);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null) return;
      byDate.set(date, { date, close });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function priceDivergenceRatio(leftValue, rightValue) {
    const left = toNum(leftValue);
    const right = toNum(rightValue);
    if (left === null || right === null || left <= 0 || right <= 0) return 1;
    const ratio = Math.max(left, right) / Math.min(left, right);
    return Number.isFinite(ratio) ? ratio : 1;
  }

  function dateDistanceDays(leftDate, rightDate, dayMs = DEFAULT_DAY_MS) {
    const left = Date.parse(`${String(leftDate || "").slice(0, 10)}T00:00:00Z`);
    const right = Date.parse(`${String(rightDate || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return Math.abs(Math.round((right - left) / dayMs));
  }

  function findTickerPriceRebaseSignal(existingPoints, incomingPoints, options = {}) {
    const ratioThreshold = Number(options.ratioThreshold) || 1.8;
    const boundaryDays = Number(options.boundaryDays) || 14;
    const existing = normalizeTickerPricePoints(existingPoints);
    const incoming = normalizeTickerPricePoints(incomingPoints);
    if (!existing.length || !incoming.length) return null;

    const existingByDate = new Map(existing.map((point) => [point.date, point.close]));
    for (const point of incoming) {
      if (!existingByDate.has(point.date)) continue;
      const ratio = priceDivergenceRatio(existingByDate.get(point.date), point.close);
      if (ratio >= ratioThreshold) return { type: "overlap", date: point.date, ratio };
    }

    const latestExisting = existing[existing.length - 1];
    const firstIncoming = incoming.find((point) => point.date > latestExisting.date);
    if (!firstIncoming) return null;
    const gapDays = dateDistanceDays(latestExisting.date, firstIncoming.date);
    if (gapDays === null || gapDays > boundaryDays) return null;
    const ratio = priceDivergenceRatio(latestExisting.close, firstIncoming.close);
    return ratio >= ratioThreshold
      ? { type: "boundary", date: firstIncoming.date, ratio }
      : null;
  }

  function shiftIsoDateByDays(date, days = 0) {
    const baseTime = toUtcMs(String(date || "").slice(0, 10));
    if (!Number.isFinite(baseTime)) return String(date || "").slice(0, 10);
    const shiftDays = Number(days) || 0;
    return new Date(baseTime + shiftDays * DEFAULT_DAY_MS).toISOString().slice(0, 10);
  }

  function buildCreditInterpolator(creditRows, creditCols) {
    if (!Array.isArray(creditRows) || !creditRows.length) return () => null;
    const points = creditRows
      .map((row) => {
        const point = { time: toUtcMs(row.date) };
        creditCols.forEach((key) => { point[key] = toNum(row[key]); });
        return point;
      })
      .filter((row) => Number.isFinite(row.time))
      .sort((left, right) => left.time - right.time);
    if (!points.length) return () => null;

    const byTime = new Map(points.map((point) => [point.time, point]));
    const firstTime = points[0].time;
    const lastTime = points[points.length - 1].time;
    const interpolate = (targetTime) => {
      if (targetTime < firstTime || targetTime > lastTime) return null;
      const exact = byTime.get(targetTime);
      if (exact) return exact;
      let low = 0;
      let high = points.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (points[middle].time < targetTime) low = middle + 1;
        else high = middle - 1;
      }
      const right = points[low];
      const left = points[low - 1];
      if (!left || !right) return null;
      const span = right.time - left.time;
      if (!Number.isFinite(span) || span <= 0) return null;
      const ratio = (targetTime - left.time) / span;
      const output = {};
      creditCols.forEach((key) => {
        const leftValue = left[key];
        const rightValue = right[key];
        if (leftValue === null && rightValue === null) output[key] = null;
        else if (leftValue === null) output[key] = rightValue;
        else if (rightValue === null) output[key] = leftValue;
        else output[key] = leftValue + (rightValue - leftValue) * ratio;
      });
      return output;
    };

    return (priceDate) => {
      const baseTime = toUtcMs(priceDate);
      if (!Number.isFinite(baseTime)) return null;
      return interpolate(baseTime);
    };
  }

  function mergeSources(payload = {}) {
    const priceRows = Array.isArray(payload.priceRows) ? payload.priceRows : [];
    const macroRows = Array.isArray(payload.macroRows) ? payload.macroRows : [];
    const creditRows = Array.isArray(payload.creditRows) ? payload.creditRows : [];
    const creditCols = Array.isArray(payload.creditCols) ? payload.creditCols : [];
    const start = String(payload.start || "");
    const end = String(payload.end || "");
    const priceMap = new Map(priceRows.map((row) => [row.date, row]));
    const macroMap = new Map(macroRows.map((row) => [row.date, row]));

    const historicalCredit = new Map();
    macroRows.forEach((row) => {
      const values = {};
      creditCols.forEach((key) => { values[key] = toNum(row[key]); });
      historicalCredit.set(row.date, values);
    });
    const currentCredit = new Map();
    creditRows.forEach((row) => {
      const date = String(row.date || "").slice(0, 10);
      if (!date) return;
      const previous = currentCredit.get(date) || {};
      const values = {};
      creditCols.forEach((key) => { values[key] = toNum(row[key]) ?? previous[key] ?? null; });
      currentCredit.set(date, values);
    });

    const currentDates = [...currentCredit.keys()].sort();
    const firstCurrentDate = currentDates[0] || "";
    const alignFactors = Object.fromEntries(creditCols.map((key) => {
      const ratios = [];
      currentDates.forEach((date) => {
        const historical = historicalCredit.get(date)?.[key];
        const current = currentCredit.get(date)?.[key];
        if (Number.isFinite(historical) && Number.isFinite(current) && historical !== 0) {
          ratios.push(current / historical);
        }
      });
      if (!ratios.length) return [key, 1];
      ratios.sort((left, right) => left - right);
      const middle = Math.floor(ratios.length / 2);
      const median = ratios.length % 2
        ? ratios[middle]
        : (ratios[middle - 1] + ratios[middle]) / 2;
      const factor = Number.isFinite(median) && median > 0 && (median > 1.15 || median < 0.85)
        ? median
        : 1;
      return [key, factor];
    }));

    const creditByDate = new Map();
    historicalCredit.forEach((values, date) => {
      const shouldAlign = firstCurrentDate && date < firstCurrentDate;
      const output = {};
      creditCols.forEach((key) => {
        const value = values?.[key];
        output[key] = shouldAlign && Number.isFinite(value)
          ? value * (alignFactors[key] ?? 1)
          : value;
      });
      creditByDate.set(date, output);
    });
    currentCredit.forEach((values, date) => {
      const previous = creditByDate.get(date) || {};
      const output = {};
      creditCols.forEach((key) => {
        output[key] = Number.isFinite(values[key]) ? values[key] : (previous[key] ?? null);
      });
      creditByDate.set(date, output);
    });

    const creditSeriesRows = [...creditByDate.entries()]
      .map(([date, values]) => ({ date, ...values }))
      .sort((left, right) => left.date.localeCompare(right.date));
    const creditAtPriceDate = buildCreditInterpolator(creditSeriesRows, creditCols);
    const liveCols = getSeriesColumns(priceRows);
    const macroCols = getSeriesColumns(macroRows).filter((key) => !creditCols.includes(key));
    const rows = [];
    priceRows.forEach(({ date }) => {
      if (date < start || date > end) return;
      const row = { date };
      const prices = priceMap.get(date) || {};
      const macro = macroMap.get(date) || {};
      const exactCredit = creditByDate.get(date) || null;
      const interpolatedCredit = creditAtPriceDate(date) || exactCredit;
      liveCols.forEach((key) => { row[key] = toNum(prices[key]); });
      macroCols.forEach((key) => { row[key] = toNum(macro[key]); });
      creditCols.forEach((key) => {
        row[key] = interpolatedCredit ? toNum(interpolatedCredit[key]) : null;
      });
      rows.push(row);
    });
    return { rows, macroCols: [...new Set([...macroCols, ...creditCols])], liveCols };
  }

  function normalizeSeries(values) {
    const first = values.find((value) => Number.isFinite(value));
    const base = Number.isFinite(first) && first !== 0 ? first : 1;
    return values.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null));
  }

  function centeredScale(values, percent, normalized = true) {
    const numbers = values.filter((value) => Number.isFinite(value));
    if (!numbers.length) return values;
    const pivot = normalized ? 100 : (Math.min(...numbers) + Math.max(...numbers)) / 2;
    const ratio = percent / 100;
    return values.map((value) => (
      Number.isFinite(value) ? pivot + (value - pivot) * ratio : null
    ));
  }

  function autoFitScales(rows, selected, normBases) {
    const info = [];
    selected.forEach((series) => {
      if (series === "leading_cycle") return;
      let values = rows.map((row) => toNum(row[series])).filter((value) => value !== null);
      if (!values.length) return;
      const base = normBases[series];
      values = base && base !== 0
        ? values.map((value) => (value / base) * 100)
        : normalizeSeries(values).filter((value) => Number.isFinite(value));
      const range = Math.max(Math.max(...values) - Math.min(...values), 1);
      info.push([series, range]);
    });
    if (!info.length) return {};
    const sorted = info.map(([, range]) => range).sort((left, right) => left - right);
    const target = sorted[Math.floor(sorted.length / 2)];
    return Object.fromEntries(info.map(([series, range]) => [
      series,
      Math.max(5, Math.min(5000, Math.round((target / range) * 100))),
    ]));
  }

  globalScope.ThinkStockMarketData = Object.freeze({
    getSeriesColumns,
    copyDisplayNames,
    sanitizePricePayload,
    mergeRowsPreservingExisting,
    mergePricePayloadPreservingExisting,
    normalizeTickerPricePoints,
    priceDivergenceRatio,
    dateDistanceDays,
    findTickerPriceRebaseSignal,
    shiftIsoDateByDays,
    buildCreditInterpolator,
    mergeSources,
    normalizeSeries,
    centeredScale,
    autoFitScales,
  });
}(typeof self !== "undefined" ? self : globalThis));
