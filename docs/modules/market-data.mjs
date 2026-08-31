import sharedDataPayload from "./data-payload.mjs";


  const DEFAULT_DAY_MS = 24 * 60 * 60 * 1000;

  const toNum = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const toCreditNum = (value) => {
    const number = toNum(value);
    return number !== null && number > 0 ? number : null;
  };
  const toUtcMs = (date) => Date.parse(`${date}T00:00:00Z`);

  function normalizePayloadRecords(records) {
    const shared = sharedDataPayload?.normalizePayloadRecords;
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
    const shared = sharedDataPayload?.rowsFromColumnarPayload;
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

  function normalizeFearGreedRows(payload) {
    const sourceRows = Array.isArray(payload?.rows) && payload.rows.length
      ? payload.rows
      : [{ date: payload?.updated, score: payload?.score }];
    const byDate = new Map();
    sourceRows.forEach((row) => {
      const date = String(row?.date || row?.updated || "").slice(0, 10);
      const score = toNum(row?.fear_greed ?? row?.score);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || score === null || score < 0 || score > 100) return;
      byDate.set(date, { date, fear_greed: score });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
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

  function sanitizeKoreanEquityPricePayload(raw, options = {}) {
    const payload = sanitizePricePayload(raw);
    if (!payload) return null;
    const equityPattern = options.equityPattern instanceof RegExp
      ? options.equityPattern
      : /^\d{6}\.(KS|KQ)$/;
    const isTradingDate = typeof options.isTradingDate === "function"
      ? options.isTradingDate
      : () => true;
    const equitySeries = [...new Set([
      ...(payload.series || []),
      ...getSeriesColumns(payload.records),
    ])].filter((key) => equityPattern.test(String(key)));
    if (!equitySeries.length) return payload;

    const records = payload.records.map((row) => {
      const date = String(row?.date || "").slice(0, 10);
      if (isTradingDate(date)) return row;
      const next = { ...row };
      equitySeries.forEach((key) => { delete next[key]; });
      return next;
    }).filter((row) => Object.keys(row).some((key) => key !== "date" && toNum(row[key]) !== null));
    return { ...payload, records };
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

  function mergeRowsPreferIncoming(existingRows, incomingRows) {
    const byDate = new Map();
    normalizePayloadRecords(existingRows).forEach((row) => byDate.set(row.date, { ...row }));
    normalizePayloadRecords(incomingRows).forEach((row) => {
      const merged = { ...(byDate.get(row.date) || { date: row.date }) };
      Object.entries(row).forEach(([key, value]) => {
        const number = toNum(value);
        if (key !== "date" && number !== null) merged[key] = number;
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

  function mergePricePayloadPreferIncoming(existingPayload, incomingPayload) {
    const existing = sanitizePricePayload(existingPayload);
    const incoming = sanitizePricePayload(incomingPayload);
    if (!existing) return incoming;
    if (!incoming) return existing;
    const records = mergeRowsPreferIncoming(existing.records, incoming.records);
    return {
      ...existing,
      ...incoming,
      records,
      series: [...new Set([
        ...(incoming.series || []),
        ...(existing.series || []),
        ...getSeriesColumns(records),
      ])],
      display_names: {
        ...(existing.display_names || {}),
        ...(incoming.display_names || {}),
      },
    };
  }

  function normalizeTickerPricePoints(points) {
    const byDate = new Map();
    (Array.isArray(points) ? points : []).forEach((point) => {
      const date = String(point?.date || "").slice(0, 10);
      const close = toNum(point?.close);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null) return;
      const volume = toNum(point?.volume);
      if (volume !== null && volume <= 0) return;
      byDate.set(date, {
        date,
        close,
        ...(volume !== null && volume >= 0 ? { volume } : {}),
      });
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

  function shiftIsoDateByMonths(date, months = 0) {
    const value = String(date || "").slice(0, 10);
    const shifted = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(shifted.getTime())) return value;
    const originalDay = shifted.getUTCDate();
    shifted.setUTCMonth(shifted.getUTCMonth() - (Number(months) || 0));
    if (shifted.getUTCDate() !== originalDay) shifted.setUTCDate(0);
    return shifted.toISOString().slice(0, 10);
  }

  function buildDenseMacroRows(sourceRows, targetDates, options = {}) {
    const sorted = [...(Array.isArray(sourceRows) ? sourceRows : [])]
      .sort((left, right) => String(left?.date || "").localeCompare(String(right?.date || "")));
    const columns = getSeriesColumns(sorted);
    if (!sorted.length || !Array.isArray(targetDates) || !targetDates.length || !columns.length) {
      return sorted;
    }
    const carryForwardAfterLast = options.carryForwardAfterLast === true;
    const targets = targetDates.map((date) => ({ date, time: toUtcMs(date) }));
    const dense = targets.map(({ date }) => ({ date }));

    columns.forEach((column) => {
      const points = sorted
        .map((row) => ({ time: toUtcMs(row.date), value: toNum(row[column]) }))
        .filter((point) => Number.isFinite(point.time) && point.value !== null)
        .sort((left, right) => left.time - right.time);
      if (!points.length) {
        targets.forEach((_, index) => { dense[index][column] = null; });
        return;
      }
      let pointer = 0;
      targets.forEach(({ time }, index) => {
        if (!Number.isFinite(time) || time < points[0].time) {
          dense[index][column] = null;
          return;
        }
        if (time > points.at(-1).time) {
          dense[index][column] = carryForwardAfterLast ? points.at(-1).value : null;
          return;
        }
        while (pointer + 1 < points.length && points[pointer + 1].time < time) pointer += 1;
        const left = points[pointer];
        const right = points[pointer + 1];
        if (!right || left.time === time || left.time === right.time) {
          dense[index][column] = left.value;
          return;
        }
        if (right.time === time) {
          dense[index][column] = right.value;
          return;
        }
        const ratio = (time - left.time) / (right.time - left.time);
        dense[index][column] = left.value + (right.value - left.value) * ratio;
      });
    });
    return dense.filter((row) => columns.some((column) => toNum(row[column]) !== null));
  }

  function buildCreditInterpolator(creditRows, creditCols) {
    if (!Array.isArray(creditRows) || !creditRows.length) return () => null;
    const points = creditRows
      .map((row) => {
        const point = { time: toUtcMs(row.date) };
        creditCols.forEach((key) => { point[key] = toCreditNum(row[key]); });
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
      creditCols.forEach((key) => { values[key] = toCreditNum(row[key]); });
      historicalCredit.set(row.date, values);
    });
    const currentCredit = new Map();
    creditRows.forEach((row) => {
      const date = String(row.date || "").slice(0, 10);
      if (!date) return;
      const previous = currentCredit.get(date) || {};
      const values = {};
      creditCols.forEach((key) => { values[key] = toCreditNum(row[key]) ?? previous[key] ?? null; });
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
    const sourceDates = new Set([
      ...priceMap.keys(),
      ...macroMap.keys(),
      ...creditByDate.keys(),
    ]);
    const rows = [];
    [...sourceDates].sort().forEach((date) => {
      if (date < start || date > end) return;
      const row = { date };
      const prices = priceMap.get(date) || {};
      const macro = macroMap.get(date) || {};
      const exactCredit = creditByDate.get(date) || null;
      const interpolatedCredit = creditAtPriceDate(date) || exactCredit;
      liveCols.forEach((key) => { row[key] = toNum(prices[key]); });
      macroCols.forEach((key) => { row[key] = toNum(macro[key]); });
      creditCols.forEach((key) => {
        row[key] = interpolatedCredit ? toCreditNum(interpolatedCredit[key]) : null;
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

  function autoFitScales(rows, selected, normBases, options = {}) {
    const additiveSeries = new Set(options.additiveSeries || options.zeroCenteredSeries || []);
    const postScaleBySeries = options.postScaleBySeries || {};
    const minimumTargetRange = Math.max(0.01, Number(options.minimumTargetRange) || 20);
    const minimumScalePercent = Math.max(0.001, Number(options.minimumScalePercent) || 0.1);
    const maximumScalePercent = Math.max(
      minimumScalePercent,
      Number(options.maximumScalePercent) || 20000,
    );
    const info = [];
    selected.forEach((series) => {
      let values = rows.map((row) => toNum(row[series])).filter((value) => value !== null);
      if (!values.length) return;
      const base = normBases[series];
      const isAdditive = additiveSeries.has(series);
      values = isAdditive
        ? values.map((value) => 100 + value - (Number.isFinite(base) ? base : values[0]))
        : (base && base !== 0
          ? values.map((value) => (value / base) * 100)
          : normalizeSeries(values).filter((value) => Number.isFinite(value)));
      // Auto scale has one rule for every visible line: fit its current-window
      // movement to the same target span. A larger price-only floor made quiet
      // stocks and deposits look flat whenever they were mixed with macro data.
      const range = Math.max(Math.max(...values) - Math.min(...values), 0.01);
      info.push({ series, range });
    });
    if (!info.length) return {};
    return Object.fromEntries(info.map(({ series, range }) => {
      const postScale = Math.max(0.01, Number(postScaleBySeries[series]) || 1);
      const requestedScale = (minimumTargetRange / range / postScale) * 100;
      const fittedScale = Math.max(
        minimumScalePercent,
        Math.min(maximumScalePercent, requestedScale),
      );
      return [
        series,
        Math.round(fittedScale * 1000) / 1000,
      ];
    }));
  }

  function resolveNormalizationBases(rows, selected, fixedBases = {}, options = {}) {
    const additiveSeries = new Set(options.additiveSeries || options.zeroCenteredSeries || []);
    const centerCurrentRange = options.centerCurrentRange === true;
    const bases = {};
    const seriesList = Array.isArray(selected) ? selected : [];
    const firstDates = centerCurrentRange ? [] : seriesList.map((series) => {
      const row = rows.find((item) => toNum(item?.[series]) !== null);
      return row?.date || null;
    }).filter(Boolean);
    const commonBaseDate = firstDates.length
      ? firstDates.reduce((latest, date) => (date > latest ? date : latest))
      : null;

    seriesList.forEach((series) => {
      const fixed = toNum(fixedBases?.[series]);
      const isAdditive = additiveSeries.has(series);
      if (fixed !== null && (isAdditive || Math.abs(fixed) > 1e-9)) {
        bases[series] = fixed;
        return;
      }
      if (centerCurrentRange) {
        const values = rows.map((row) => toNum(row?.[series])).filter((value) => value !== null);
        if (!values.length) return;
        const midpoint = (Math.min(...values) + Math.max(...values)) / 2;
        if (Number.isFinite(midpoint) && (isAdditive || Math.abs(midpoint) > 1e-9)) {
          bases[series] = midpoint;
        }
        return;
      }
      if (!commonBaseDate) return;
      const row = rows.find((item) => (
        item.date >= commonBaseDate && toNum(item?.[series]) !== null
      ));
      const value = toNum(row?.[series]);
      if (value !== null && (isAdditive || Math.abs(value) > 1e-9)) bases[series] = value;
    });
    return bases;
  }

  function mergeFixedAutoScales(calculatedScales, fixedScales = {}) {
    const merged = { ...(calculatedScales || {}) };
    Object.entries(fixedScales || {}).forEach(([series, rawValue]) => {
      const value = toNum(rawValue);
      if (value !== null && value > 0) merged[series] = value;
    });
    return merged;
  }

  const marketData = Object.freeze({
    getSeriesColumns,
    normalizeFearGreedRows,
    copyDisplayNames,
    sanitizePricePayload,
    sanitizeKoreanEquityPricePayload,
    mergeRowsPreservingExisting,
    mergeRowsPreferIncoming,
    mergePricePayloadPreservingExisting,
    mergePricePayloadPreferIncoming,
    normalizeTickerPricePoints,
    priceDivergenceRatio,
    dateDistanceDays,
    findTickerPriceRebaseSignal,
    shiftIsoDateByDays,
    shiftIsoDateByMonths,
    buildDenseMacroRows,
    buildCreditInterpolator,
    mergeSources,
    normalizeSeries,
    centeredScale,
    autoFitScales,
    resolveNormalizationBases,
    mergeFixedAutoScales,
  });
export {
  autoFitScales,
  buildCreditInterpolator,
  buildDenseMacroRows,
  centeredScale,
  copyDisplayNames,
  dateDistanceDays,
  findTickerPriceRebaseSignal,
  getSeriesColumns,
  mergeFixedAutoScales,
  mergePricePayloadPreferIncoming,
  mergePricePayloadPreservingExisting,
  mergeRowsPreferIncoming,
  mergeRowsPreservingExisting,
  mergeSources,
  normalizeFearGreedRows,
  normalizeSeries,
  normalizeTickerPricePoints,
  priceDivergenceRatio,
  resolveNormalizationBases,
  sanitizeKoreanEquityPricePayload,
  sanitizePricePayload,
  shiftIsoDateByDays,
  shiftIsoDateByMonths,
};
export default marketData;
