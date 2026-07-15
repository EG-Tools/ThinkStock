const toNum = (value) => (value != null && Number.isFinite(Number(value))) ? Number(value) : null;
const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
const DAY_MS = 86400000;
const toUtcMs = (date) => Date.parse(`${date}T00:00:00Z`);

function getSeriesColumns(rows) {
  const columns = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => {
    if (key !== "date") columns.add(key);
  }));
  return [...columns];
}

function buildCreditInterpolator(creditRows, creditCols, offsetDays) {
  if (!creditRows.length) return () => null;
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
    return interpolate(baseTime + offsetDays * DAY_MS);
  };
}

function mergeSources(payload) {
  const priceRows = Array.isArray(payload.priceRows) ? payload.priceRows : [];
  const macroRows = Array.isArray(payload.macroRows) ? payload.macroRows : [];
  const creditRows = Array.isArray(payload.creditRows) ? payload.creditRows : [];
  const creditCols = Array.isArray(payload.creditCols) ? payload.creditCols : [];
  const start = String(payload.start || "");
  const end = String(payload.end || "");
  const offsetDays = Number(payload.creditOffsetDays) || 0;
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
  const calculateAlignFactor = (key) => {
    const ratios = [];
    currentDates.forEach((date) => {
      const historical = historicalCredit.get(date)?.[key];
      const current = currentCredit.get(date)?.[key];
      if (Number.isFinite(historical) && Number.isFinite(current) && historical !== 0) {
        ratios.push(current / historical);
      }
    });
    if (!ratios.length) return 1;
    ratios.sort((left, right) => left - right);
    const middle = Math.floor(ratios.length / 2);
    const median = ratios.length % 2
      ? ratios[middle]
      : (ratios[middle - 1] + ratios[middle]) / 2;
    if (!(Number.isFinite(median) && median > 0)) return 1;
    return median > 1.15 || median < 0.85 ? median : 1;
  };
  const alignFactors = Object.fromEntries(
    creditCols.map((key) => [key, calculateAlignFactor(key)]),
  );

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
  const shiftedCreditAtPriceDate = buildCreditInterpolator(creditSeriesRows, creditCols, offsetDays);
  const liveCols = getSeriesColumns(priceRows);
  const macroCols = getSeriesColumns(macroRows).filter((key) => !creditCols.includes(key));
  const rows = [];
  priceRows.forEach(({ date }) => {
    if (date < start || date > end) return;
    const row = { date };
    const prices = priceMap.get(date) || {};
    const macro = macroMap.get(date) || {};
    const exactCredit = creditByDate.get(date) || null;
    const shiftedCredit = shiftedCreditAtPriceDate(date) || exactCredit;
    liveCols.forEach((key) => { row[key] = toNum(prices[key]); });
    macroCols.forEach((key) => { row[key] = toNum(macro[key]); });
    creditCols.forEach((key) => { row[key] = shiftedCredit ? toNum(shiftedCredit[key]) : null; });
    rows.push(row);
  });
  return { rows, macroCols: [...new Set([...macroCols, ...creditCols])], liveCols };
}

function labelName(key, displayNames) {
  return displayNames?.[key] || key;
}

function sortSeries(list, priorityOrder, displayNames) {
  const priority = new Map((priorityOrder || []).map((name, index) => [name, index]));
  return [...list].sort((left, right) => {
    const leftRank = priority.has(left) ? priority.get(left) : priority.size + 1;
    const rightRank = priority.has(right) ? priority.get(right) : priority.size + 1;
    return leftRank !== rightRank
      ? leftRank - rightRank
      : labelName(left, displayNames).localeCompare(labelName(right, displayNames), "ko");
  });
}

function normalizeSeries(values) {
  const first = values.find((value) => Number.isFinite(value));
  const base = Number.isFinite(first) && first !== 0 ? first : 1;
  return values.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null));
}

function centeredScale(values, percent) {
  const ratio = percent / 100;
  return values.map((value) => (Number.isFinite(value) ? 100 + (value - 100) * ratio : null));
}

function autoFitScales(rows, selected, normBases) {
  const info = [];
  selected.forEach((series) => {
    if (series === "leading_cycle") return;
    let values = rows.map((row) => toNum(row[series])).filter((value) => value !== null);
    if (!values.length) return;
    const base = normBases[series];
    values = (base && base !== 0)
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

function thinIndexList(indexes, budget, rowCount) {
  const sorted = [...new Set(indexes)].sort((left, right) => left - right);
  if (sorted.length <= budget) return sorted;
  const output = new Set([0, rowCount - 1]);
  const slots = Math.max(1, budget - 2);
  for (let index = 1; index <= slots; index += 1) {
    const sourceIndex = sorted[Math.round((index * (sorted.length - 1)) / (slots + 1))];
    if (Number.isInteger(sourceIndex)) output.add(sourceIndex);
  }
  return [...output].sort((left, right) => left - right);
}

function buildDisplayIndexes(rows, seriesModels, selected, hiddenSeries, budget) {
  const rowCount = rows.length;
  if (!rowCount || rowCount <= budget) return null;
  const hidden = new Set(hiddenSeries || []);
  const visible = selected.filter((key) => !hidden.has(key));
  const targets = visible.length ? visible : selected;
  const bySeries = new Map(seriesModels.map((model) => [model.series, model.values]));
  const perBucketCost = Math.max(2, targets.length * 2);
  const bucketCount = Math.max(1, Math.floor((budget - 2) / perBucketCost));
  const bucketSize = Math.max(1, Math.ceil((rowCount - 2) / bucketCount));
  const keep = new Set([0, rowCount - 1]);

  for (let start = 1; start < rowCount - 1; start += bucketSize) {
    const end = Math.min(rowCount - 1, start + bucketSize);
    targets.forEach((series) => {
      const values = bySeries.get(series);
      if (!values) return;
      let minIndex = -1;
      let maxIndex = -1;
      let minValue = Number.POSITIVE_INFINITY;
      let maxValue = Number.NEGATIVE_INFINITY;
      for (let index = start; index < end; index += 1) {
        const value = values[index];
        if (!Number.isFinite(value)) continue;
        if (value < minValue) {
          minValue = value;
          minIndex = index;
        }
        if (value > maxValue) {
          maxValue = value;
          maxIndex = index;
        }
      }
      if (minIndex >= 0) keep.add(minIndex);
      if (maxIndex >= 0) keep.add(maxIndex);
    });
  }
  return thinIndexList([...keep], budget, rowCount);
}

function buildMainChartModel(payload) {
  const { rows, macroCols, liveCols } = mergeSources(payload);
  const allowed = new Set(payload.allowedSeries || []);
  const hidden = new Set(payload.hiddenSeries || []);
  const priorityOrder = payload.priorityOrder || [];
  const displayNames = payload.displayNames || {};
  const offsets = payload.seriesOffsets || {};
  const scales = payload.seriesScales || {};
  const budget = Math.max(1, Number(payload.displayBudget) || rows.length || 1);

  const allSeries = sortSeries(
    [...new Set([...liveCols, ...macroCols])]
      .filter((series) => allowed.has(series))
      .filter((series) => rows.some((row) => toNum(row[series]) !== null)),
    priorityOrder,
    displayNames,
  );
  const selected = sortSeries(
    allSeries.filter((series) => !["adr_kospi", "adr_kosdaq"].includes(series)),
    priorityOrder,
    displayNames,
  );
  if (!selected.length) selected.push(...allSeries.slice(0, 2));

  const commonNormBases = {};
  const firstDates = selected.map((series) => {
    const row = rows.find((item) => toNum(item[series]) !== null);
    return row?.date || null;
  }).filter(Boolean);
  const commonBaseDate = firstDates.length
    ? firstDates.reduce((latest, value) => (value > latest ? value : latest))
    : null;
  if (commonBaseDate) {
    selected.forEach((series) => {
      const row = rows.find((item) => item.date >= commonBaseDate && toNum(item[series]) !== null);
      commonNormBases[series] = row ? toNum(row[series]) : null;
    });
  }

  const visible = selected.filter((series) => !hidden.has(series));
  const autoScales = autoFitScales(rows, visible.length ? visible : selected, commonNormBases);
  const xValues = rows.map((row) => row.date);
  const seriesModels = selected.map((series) => {
    const rawValues = rows.map((row) => toNum(row[series]));
    const rawTexts = rawValues.map((value) => Number.isFinite(value) ? numberFormat.format(value) : "N/A");
    const base = commonNormBases[series];
    let values = (base && base !== 0)
      ? rawValues.map((value) => Number.isFinite(value) ? (value / base) * 100 : null)
      : normalizeSeries(rawValues);
    values = centeredScale(values, series === "leading_cycle" ? 100 : (autoScales[series] || 100));
    const baseValues = values;
    const userScale = scales[series] != null ? scales[series] : (series === "leading_cycle" ? 20 : 1);
    if (userScale !== 1) {
      values = values.map((value) => value !== null ? 100 + (value - 100) * userScale : null);
    }
    const offset = offsets[series] || 0;
    if (offset) values = values.map((value) => value !== null ? value + offset : null);
    return {
      series,
      rawTexts,
      baseLineWidth: macroCols.includes(series) ? 3 : 2,
      xValues,
      values,
      baseValues,
    };
  });

  return {
    rows,
    allSeries,
    selected,
    seriesModels,
    displayIndexes: buildDisplayIndexes(rows, seriesModels, selected, payload.hiddenSeries, budget),
  };
}

self.addEventListener("message", (event) => {
  const { id, type, payload } = event.data || {};
  if (type !== "buildMainChartModel") return;
  try {
    self.postMessage({ id, ok: true, result: buildMainChartModel(payload || {}) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
