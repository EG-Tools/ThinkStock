(function initThinkStockChartDisplaySampler(globalScope) {
  "use strict";

  function thinIndexList(indexes, budget, rowCount, requiredIndexes = []) {
    const sorted = [...new Set(indexes)].sort((left, right) => left - right);
    const maximum = Math.max(2, Math.floor(Number(budget) || 2));
    if (sorted.length <= maximum) return sorted;
    const output = new Set([0, rowCount - 1, ...requiredIndexes]);
    const candidates = sorted.filter((index) => !output.has(index));
    const slots = Math.max(0, maximum - output.size);
    for (let index = 1; index <= slots; index += 1) {
      const sourceIndex = candidates[Math.round((index * (candidates.length - 1)) / (slots + 1))];
      if (Number.isInteger(sourceIndex)) output.add(sourceIndex);
    }
    return [...output].sort((left, right) => left - right);
  }

  function seriesBoundaryIndexes(targets, bySeries) {
    const boundaries = new Set();
    targets.forEach((series) => {
      const values = bySeries.get(series) || [];
      const first = values.findIndex(Number.isFinite);
      let last = values.length - 1;
      while (last >= 0 && !Number.isFinite(values[last])) last -= 1;
      if (first >= 0) boundaries.add(first);
      if (last >= 0) boundaries.add(last);
      for (let index = Math.max(1, first + 1); index <= last; index += 1) {
        const previousFinite = Number.isFinite(values[index - 1]);
        const currentFinite = Number.isFinite(values[index]);
        if (previousFinite !== currentFinite) {
          boundaries.add(index - 1);
          boundaries.add(index);
        }
      }
    });
    return [...boundaries];
  }

  function buildDisplayIndexes(
    rows,
    seriesModels,
    selected,
    hiddenSeries,
    budget,
    preserveDailyPoints = false,
  ) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const rowCount = sourceRows.length;
    const maximum = Math.max(2, Math.floor(Number(budget) || rowCount || 2));
    if (preserveDailyPoints || !rowCount || rowCount <= maximum) return null;
    const hidden = hiddenSeries instanceof Set ? hiddenSeries : new Set(hiddenSeries || []);
    const selectedSeries = Array.isArray(selected) ? selected : [];
    const visible = selectedSeries.filter((key) => !hidden.has(key));
    const targets = visible.length ? visible : selectedSeries;
    const bySeries = new Map((seriesModels || []).map((model) => [model.series, model.values]));
    const boundaryIndexes = seriesBoundaryIndexes(targets, bySeries);
    const perBucketCost = Math.max(2, targets.length * 2);
    const bucketCount = Math.max(1, Math.floor((maximum - 2) / perBucketCost));
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
    return thinIndexList([...keep, ...boundaryIndexes], maximum, rowCount, boundaryIndexes);
  }

  globalScope.ThinkStockChartDisplaySampler = Object.freeze({
    buildDisplayIndexes,
    seriesBoundaryIndexes,
    thinIndexList,
  });
}(typeof self !== "undefined" ? self : globalThis));
