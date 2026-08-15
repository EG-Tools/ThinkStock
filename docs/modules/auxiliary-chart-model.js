(function initThinkStockAuxiliaryChartModel(globalScope) {
  const NEWS_MOVING_AVERAGE_DAYS = 1;
  const NEWS_MOVING_AVERAGE_MIN_DAYS = 1;
  const NEWS_MOVING_AVERAGE_MAX_DAYS = 20;
  const AUXILIARY_PANEL_KEYS = Object.freeze([
    "adr",
    "fearGreed",
    "newsSentiment",
    "vkospi",
  ]);
  const AUXILIARY_CHART_CONFIG = Object.freeze({
    adrBandColor: "rgba(100,100,100,0.06)",
    adrHighThreshold: 120,
    adrLowThreshold: 80,
    adrZoneHighColor: "#e6adad",
    adrZoneLowColor: "#b0c6ed",
    fearGreedHighThreshold: 75,
    fearGreedLowThreshold: 25,
    newsSentimentHighThreshold: 110,
    newsSentimentLowThreshold: 90,
    zoneHighFillColor: "rgba(230,173,173,0.15)",
    zoneLowFillColor: "rgba(176,198,237,0.15)",
    seriesKeys: Object.freeze({
      adrKospi: "adr_kospi",
      adrKosdaq: "adr_kosdaq",
      fearGreed: "fear_greed",
      newsSentiment: "news_sentiment",
      vkospi: "vkospi",
      vix: "vix",
    }),
  });

  const toNumber = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );

  function normalizeNewsMovingAverageDays(value, fallback = NEWS_MOVING_AVERAGE_DAYS) {
    const numeric = Math.round(Number(value));
    const fallbackValue = Number.isFinite(Number(fallback))
      ? Math.round(Number(fallback))
      : NEWS_MOVING_AVERAGE_DAYS;
    return Math.min(
      NEWS_MOVING_AVERAGE_MAX_DAYS,
      Math.max(NEWS_MOVING_AVERAGE_MIN_DAYS, Number.isFinite(numeric) ? numeric : fallbackValue),
    );
  }

  function rollingAverage(values, windowSize = NEWS_MOVING_AVERAGE_DAYS) {
    const window = Math.max(1, Number(windowSize) || 1);
    const output = [];
    const queue = [];
    let sum = 0;
    let count = 0;
    values.forEach((value) => {
      const numeric = toNumber(value);
      queue.push(numeric);
      if (Number.isFinite(numeric)) {
        sum += numeric;
        count += 1;
      }
      if (queue.length > window) {
        const removed = queue.shift();
        if (Number.isFinite(removed)) {
          sum -= removed;
          count -= 1;
        }
      }
      output.push(count ? sum / count : null);
    });
    return output;
  }

  function buildThresholdZones(values, lowThreshold, highThreshold) {
    const low = [];
    const middle = [];
    const high = [];
    const lowBaseline = [];
    const highBaseline = [];

    values.forEach((value) => {
      const isLow = value !== null && value < lowThreshold;
      const isHigh = value !== null && value > highThreshold;
      const isMiddle = value !== null && !isLow && !isHigh;
      low.push(isLow ? value : null);
      middle.push(isMiddle ? value : null);
      high.push(isHigh ? value : null);
      lowBaseline.push(isLow ? lowThreshold : null);
      highBaseline.push(isHigh ? highThreshold : null);
    });

    for (let index = 1; index < values.length; index += 1) {
      const value = values[index];
      const previous = values[index - 1];
      if (value === null || previous === null) continue;
      if (value < lowThreshold && previous >= lowThreshold) {
        middle[index] = value;
        lowBaseline[index] = lowThreshold;
      }
      if (value >= lowThreshold && previous < lowThreshold) {
        low[index] = value;
        lowBaseline[index] = lowThreshold;
      }
      if (value > highThreshold && previous <= highThreshold) {
        middle[index] = value;
        highBaseline[index] = highThreshold;
      }
      if (value <= highThreshold && previous > highThreshold) {
        high[index] = value;
        highBaseline[index] = highThreshold;
      }
    }

    return { low, middle, high, lowBaseline, highBaseline };
  }

  function buildThresholdFillPolygons(dates, values, threshold, direction = "low") {
    const safeDates = Array.isArray(dates) ? dates : [];
    const safeValues = Array.isArray(values) ? values : [];
    const limit = Math.min(safeDates.length, safeValues.length);
    const boundary = toNumber(threshold);
    if (!limit || boundary === null) return [];
    const timestamp = (date) => Date.parse(`${String(date || "").slice(0, 10)}T00:00:00Z`);
    const pointIsValid = (index) => (
      Number.isFinite(timestamp(safeDates[index])) && toNumber(safeValues[index]) !== null
    );
    const isBeyond = direction === "high"
      ? (value) => value > boundary
      : (value) => value < boundary;
    const crossingDate = (leftIndex, rightIndex) => {
      const leftValue = toNumber(safeValues[leftIndex]);
      const rightValue = toNumber(safeValues[rightIndex]);
      const leftTime = timestamp(safeDates[leftIndex]);
      const rightTime = timestamp(safeDates[rightIndex]);
      const difference = rightValue - leftValue;
      if (!Number.isFinite(difference) || difference === 0 || rightTime <= leftTime) {
        return String(safeDates[rightIndex] || "").slice(0, 10);
      }
      const ratio = Math.max(0, Math.min(1, (boundary - leftValue) / difference));
      return new Date(leftTime + (rightTime - leftTime) * ratio).toISOString();
    };
    const polygons = [];
    let segmentStart = 0;
    while (segmentStart < limit) {
      while (segmentStart < limit && !pointIsValid(segmentStart)) segmentStart += 1;
      if (segmentStart >= limit) break;
      let segmentEnd = segmentStart;
      while (segmentEnd + 1 < limit && pointIsValid(segmentEnd + 1)) segmentEnd += 1;
      let cursor = segmentStart;
      while (cursor <= segmentEnd) {
        while (cursor <= segmentEnd && !isBeyond(toNumber(safeValues[cursor]))) cursor += 1;
        if (cursor > segmentEnd) break;
        const runStart = cursor;
        while (cursor + 1 <= segmentEnd && isBeyond(toNumber(safeValues[cursor + 1]))) cursor += 1;
        const runEnd = cursor;
        const polygonDates = [];
        const polygonValues = [];
        if (runStart > segmentStart) {
          polygonDates.push(crossingDate(runStart - 1, runStart));
          polygonValues.push(boundary);
        }
        for (let index = runStart; index <= runEnd; index += 1) {
          polygonDates.push(String(safeDates[index] || "").slice(0, 10));
          polygonValues.push(toNumber(safeValues[index]));
        }
        if (runEnd < segmentEnd) {
          polygonDates.push(crossingDate(runEnd, runEnd + 1));
          polygonValues.push(boundary);
        }
        const firstDate = polygonDates[0];
        const lastDate = polygonDates.at(-1);
        polygons.push({
          dates: [...polygonDates, lastDate, firstDate],
          values: [...polygonValues, boundary, boundary],
        });
        cursor += 1;
      }
      segmentStart = segmentEnd + 1;
    }
    return polygons;
  }

  function buildThresholdEnvelopeSeries(seriesList, direction = "low") {
    const valuesByDate = new Map();
    (Array.isArray(seriesList) ? seriesList : []).forEach((series) => {
      const dates = Array.isArray(series?.dates) ? series.dates : [];
      const values = Array.isArray(series?.values) ? series.values : [];
      const limit = Math.min(dates.length, values.length);
      for (let index = 0; index < limit; index += 1) {
        const date = String(dates[index] || "").slice(0, 10);
        if (!date) continue;
        if (!valuesByDate.has(date)) valuesByDate.set(date, []);
        const value = toNumber(values[index]);
        if (value !== null) valuesByDate.get(date).push(value);
      }
    });
    const dates = [...valuesByDate.keys()].sort();
    const select = direction === "high" ? Math.max : Math.min;
    return {
      dates,
      values: dates.map((date) => {
        const values = valuesByDate.get(date) || [];
        return values.length ? select(...values) : null;
      }),
    };
  }

  const sortedDateCache = new WeakMap();

  function sortedDateInfo(dates) {
    if (!Array.isArray(dates)) return { sorted: false, start: 0, end: 0 };
    const cached = sortedDateCache.get(dates);
    const first = dates[0];
    const last = dates.at(-1);
    if (cached && cached.length === dates.length && cached.first === first && cached.last === last) {
      return cached;
    }
    let sorted = true;
    for (let index = 1; index < dates.length; index += 1) {
      if (String(dates[index - 1] || "").slice(0, 10) > String(dates[index] || "").slice(0, 10)) {
        sorted = false;
        break;
      }
    }
    const result = { sorted, first, last, length: dates.length };
    sortedDateCache.set(dates, result);
    return result;
  }

  function dateLowerBound(dates, target) {
    let low = 0;
    let high = dates.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (String(dates[middle] || "").slice(0, 10) < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function dateUpperBound(dates, target) {
    let low = 0;
    let high = dates.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (String(dates[middle] || "").slice(0, 10) <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function finiteRangeExtrema(dates, valueSeries, startDate = "", endDate = "") {
    const safeDates = Array.isArray(dates) ? dates : [];
    const safeSeries = Array.isArray(valueSeries) ? valueSeries : [];
    const dateInfo = sortedDateInfo(safeDates);
    const startIndex = dateInfo.sorted && startDate ? dateLowerBound(safeDates, startDate) : 0;
    const endIndex = dateInfo.sorted && endDate ? dateUpperBound(safeDates, endDate) : safeDates.length;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (let index = startIndex; index < endIndex; index += 1) {
      if (!dateInfo.sorted) {
        const date = String(safeDates[index] || "").slice(0, 10);
        if (!date || (startDate && date < startDate) || (endDate && date > endDate)) continue;
      }
      for (const values of safeSeries) {
        const value = toNumber(values?.[index]);
        if (value === null) continue;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
        count += 1;
      }
    }
    return { minimum, maximum, count };
  }

  function mergeExtrema(...items) {
    const valid = items.filter((item) => item?.count > 0);
    return {
      count: valid.reduce((sum, item) => sum + item.count, 0),
      minimum: valid.length ? Math.min(...valid.map((item) => item.minimum)) : Number.POSITIVE_INFINITY,
      maximum: valid.length ? Math.max(...valid.map((item) => item.maximum)) : Number.NEGATIVE_INFINITY,
    };
  }

  function insertDatedGapBreaks(rows, key, maximumCalendarGap = 20) {
    const source = (Array.isArray(rows) ? rows : [])
      .flatMap((row) => {
        const date = String(row?.date || "").slice(0, 10);
        const value = toNumber(row?.[key]);
        return date && value !== null ? [{ date, value }] : [];
      })
      .sort((left, right) => left.date.localeCompare(right.date));
    const dates = [];
    const values = [];
    let previousDate = "";
    source.forEach((row) => {
      const previousTime = Date.parse(`${previousDate}T00:00:00Z`);
      const currentTime = Date.parse(`${row.date}T00:00:00Z`);
      if (previousDate && Number.isFinite(previousTime) && Number.isFinite(currentTime)
        && currentTime - previousTime > maximumCalendarGap * 86400000) {
        dates.push(new Date(previousTime + 86400000).toISOString().slice(0, 10));
        values.push(null);
      }
      dates.push(row.date);
      values.push(row.value);
      previousDate = row.date;
    });
    return { dates, values, rowCount: source.length };
  }

  function buildAuxiliaryPanelLayout(visibility = {}, options = {}) {
    const panelSpecByKey = {
      adr: { key: "adr", pixels: 180 },
      fearGreed: { key: "fearGreed", pixels: 85 },
      newsSentiment: { key: "newsSentiment", pixels: 85 },
      vkospi: { key: "vkospi", pixels: 85 },
    };
    const requestedOrder = Array.isArray(options.panelOrder) ? options.panelOrder : [];
    const orderedKeys = [...new Set([...requestedOrder, ...AUXILIARY_PANEL_KEYS])]
      .filter((key) => AUXILIARY_PANEL_KEYS.includes(key));
    const panelSpecs = orderedKeys.map((key) => panelSpecByKey[key]);
    const activePanels = panelSpecs.filter((panel) => visibility[panel.key] !== false);
    const gapPixels = 18;
    // Plotly sizes its SVG from the border box, then removes the 52/36px
    // margins. Keeping this value exact prevents panel heights from drifting.
    const fixedChromePixels = 88;
    const controlsOnlyPixels = 42;
    const panelPixels = activePanels.reduce((sum, panel) => sum + panel.pixels, 0);
    const totalGapPixels = Math.max(0, activePanels.length - 1) * gapPixels;
    const paperPixels = Math.max(1, panelPixels + totalGapPixels);
    const domains = {};
    const axes = {};
    const separators = [];
    let cursor = 1;
    activePanels.forEach((panel, index) => {
      axes[panel.key] = index === 0 ? "y" : `y${index + 1}`;
      const panelRatio = panel.pixels / paperPixels;
      const lower = Math.max(0, cursor - panelRatio);
      domains[panel.key] = [lower, cursor];
      if (index < activePanels.length - 1) {
        const gapRatio = gapPixels / paperPixels;
        separators.push(lower);
        cursor = Math.max(0, lower - gapRatio);
      } else {
        cursor = lower;
      }
    });
    return Object.freeze({
      active: Object.freeze(Object.fromEntries(panelSpecs.map((panel) => [
        panel.key,
        activePanels.includes(panel),
      ]))),
      activeKeys: Object.freeze(activePanels.map((panel) => panel.key)),
      axes: Object.freeze(axes),
      bottomAxis: axes[activePanels.at(-1)?.key] || "",
      chartHeight: activePanels.length
        ? fixedChromePixels + panelPixels + totalGapPixels
        : controlsOnlyPixels,
      domains: Object.freeze(domains),
      panelPixels: Object.freeze(Object.fromEntries(activePanels.map((panel) => [
        panel.key,
        panel.pixels,
      ]))),
      plotHeight: activePanels.length ? panelPixels + totalGapPixels : 0,
      separators: Object.freeze(separators),
    });
  }

  function buildAuxiliaryViewportRanges(model = {}, range = [], options = {}) {
    const rawStart = String(range?.[0] || "").slice(0, 10);
    const rawEnd = String(range?.[1] || "").slice(0, 10);
    const startDate = rawStart && rawEnd && rawStart > rawEnd ? rawEnd : rawStart;
    const endDate = rawStart && rawEnd && rawStart > rawEnd ? rawStart : rawEnd;
    const adrLowThreshold = Number(options.adrLowThreshold) || 80;
    const adrHighThreshold = Number(options.adrHighThreshold) || 120;
    const newsLowThreshold = Number(options.newsLowThreshold) || 90;
    const newsHighThreshold = Number(options.newsHighThreshold) || 110;
    const adrRange = mergeExtrema(
      finiteRangeExtrema(
        model.adrKospiDates || model.dates,
        [model.adrKospiValues || model.kospiValues],
        startDate,
        endDate,
      ),
      finiteRangeExtrema(
        model.adrKosdaqDates || model.dates,
        [model.adrKosdaqValues || model.kosdaqValues],
        startDate,
        endDate,
      ),
    );
    const newsRange = finiteRangeExtrema(
      model.newsDates,
      [model.newsValues],
      startDate,
      endDate,
    );
    const vkospiRange = finiteRangeExtrema(
      model.vkospiDates,
      [model.vkospiValues],
      startDate,
      endDate,
    );
    const vixRange = finiteRangeExtrema(
      model.vixDates,
      [model.vixValues],
      startDate,
      endDate,
    );
    const volatilityRange = mergeExtrema(vkospiRange, vixRange);
    const adrMinimum = adrRange.count ? Math.min(adrRange.minimum, adrLowThreshold) : adrLowThreshold;
    const adrMaximum = adrRange.count ? Math.max(adrRange.maximum, adrHighThreshold) : adrHighThreshold;
    const newsMinimum = newsRange.count ? Math.min(newsRange.minimum, newsLowThreshold) : newsLowThreshold;
    const newsMaximum = newsRange.count ? Math.max(newsRange.maximum, newsHighThreshold) : newsHighThreshold;
    const vkospiMinimum = volatilityRange.count ? volatilityRange.minimum : 10;
    const vkospiMaximum = volatilityRange.count ? volatilityRange.maximum : 40;
    const vkospiPadding = Math.max(1, (vkospiMaximum - vkospiMinimum) * 0.08);

    return {
      adr: [adrMinimum - 2.5, adrMaximum + 1.2],
      news: [newsMinimum - 2, newsMaximum + 2],
      vkospi: [Math.max(0, vkospiMinimum - vkospiPadding), vkospiMaximum + vkospiPadding],
    };
  }

  function buildAuxiliaryChartModel(payload = {}) {
    const adrRows = Array.isArray(payload.adrRows) ? payload.adrRows : [];
    const macroRows = Array.isArray(payload.macroRows) ? payload.macroRows : [];
    const startDate = String(payload.startDate || "");
    const adrLowThreshold = Number(payload.adrLowThreshold) || 80;
    const adrHighThreshold = Number(payload.adrHighThreshold) || 120;
    const newsLowThreshold = Number(payload.newsLowThreshold) || 90;
    const newsHighThreshold = Number(payload.newsHighThreshold) || 110;
    const newsMovingAverageDays = normalizeNewsMovingAverageDays(payload.newsMovingAverageDays);

    const filteredAuxiliary = adrRows.filter((row) => !startDate || row?.date >= startDate);
    const filteredAdr = filteredAuxiliary.filter((row) => (
      toNumber(row?.adr_kospi) !== null || toNumber(row?.adr_kosdaq) !== null
    ));
    const filteredNews = macroRows.filter((row) => (
      (!startDate || row?.date >= startDate)
      && toNumber(row?.news_sentiment) !== null
    ));
    const adrKospi = insertDatedGapBreaks(filteredAuxiliary, "adr_kospi");
    const adrKosdaq = insertDatedGapBreaks(filteredAuxiliary, "adr_kosdaq");
    const fearGreed = insertDatedGapBreaks(filteredAuxiliary, "fear_greed");
    const vkospi = insertDatedGapBreaks(filteredAuxiliary, "vkospi");
    const vix = insertDatedGapBreaks(filteredAuxiliary, "vix");
    const dates = filteredAdr.map((row) => row.date);
    const kospiValues = filteredAdr.map((row) => toNumber(row.adr_kospi));
    const kosdaqValues = filteredAdr.map((row) => toNumber(row.adr_kosdaq));
    const fearGreedValues = fearGreed.values;
    const newsDates = filteredNews.map((row) => row.date);
    const newsRawValues = filteredNews.map((row) => toNumber(row.news_sentiment));
    const newsValues = rollingAverage(newsRawValues, newsMovingAverageDays);

    const adrNumbers = [...adrKospi.values, ...adrKosdaq.values].filter(Number.isFinite);
    const adrRawMin = adrNumbers.length ? Math.min(...adrNumbers) : adrLowThreshold;
    const adrRawMax = adrNumbers.length ? Math.max(...adrNumbers) : adrHighThreshold;
    const newsNumbers = newsValues.filter(Number.isFinite);

    return {
      dates,
      kospiValues,
      kosdaqValues,
      adrKospiDates: adrKospi.dates,
      adrKospiValues: adrKospi.values,
      adrKosdaqDates: adrKosdaq.dates,
      adrKosdaqValues: adrKosdaq.values,
      fearGreedDates: fearGreed.dates,
      fearGreedValues,
      newsDates,
      newsValues,
      newsRawValues,
      newsMovingAverageDays,
      vkospiDates: vkospi.dates,
      vkospiValues: vkospi.values,
      vixDates: vix.dates,
      vixValues: vix.values,
      kospiZones: buildThresholdZones(adrKospi.values, adrLowThreshold, adrHighThreshold),
      kosdaqZones: buildThresholdZones(adrKosdaq.values, adrLowThreshold, adrHighThreshold),
      fearGreedZones: buildThresholdZones(
        fearGreedValues,
        AUXILIARY_CHART_CONFIG.fearGreedLowThreshold,
        AUXILIARY_CHART_CONFIG.fearGreedHighThreshold,
      ),
      newsSentimentZones: buildThresholdZones(newsValues, newsLowThreshold, newsHighThreshold),
      adrYMin: Math.min(adrRawMin, adrLowThreshold) - 2.5,
      adrYMax: Math.max(adrRawMax, adrHighThreshold) + 1.2,
      newsYMin: Math.min(...newsNumbers, newsLowThreshold) - 2,
      newsYMax: Math.max(...newsNumbers, newsHighThreshold) + 2,
      adrRowCount: filteredAdr.length,
      newsRowCount: filteredNews.length,
      vkospiRowCount: vkospi.rowCount,
      vixRowCount: vix.rowCount,
    };
  }

  globalScope.ThinkStockAuxiliaryChartModel = Object.freeze({
    AUXILIARY_PANEL_KEYS,
    AUXILIARY_CHART_CONFIG,
    buildAuxiliaryPanelLayout,
    buildAuxiliaryViewportRanges,
    buildAuxiliaryChartModel,
    buildThresholdZones,
    buildThresholdFillPolygons,
    buildThresholdEnvelopeSeries,
    insertDatedGapBreaks,
    NEWS_MOVING_AVERAGE_DAYS,
    NEWS_MOVING_AVERAGE_MIN_DAYS,
    NEWS_MOVING_AVERAGE_MAX_DAYS,
    normalizeNewsMovingAverageDays,
    rollingAverage,
  });
}(typeof self !== "undefined" ? self : globalThis));
