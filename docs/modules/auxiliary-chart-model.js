(function initThinkStockAuxiliaryChartModel(globalScope) {
  const toNumber = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );

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

  function buildAuxiliaryChartModel(payload = {}) {
    const adrRows = Array.isArray(payload.adrRows) ? payload.adrRows : [];
    const macroRows = Array.isArray(payload.macroRows) ? payload.macroRows : [];
    const startDate = String(payload.startDate || "");
    const adrLowThreshold = Number(payload.adrLowThreshold) || 80;
    const adrHighThreshold = Number(payload.adrHighThreshold) || 120;
    const newsLowThreshold = Number(payload.newsLowThreshold) || 90;
    const newsHighThreshold = Number(payload.newsHighThreshold) || 110;

    const filteredAdr = adrRows.filter((row) => !startDate || row?.date >= startDate);
    const filteredNews = macroRows.filter((row) => (
      (!startDate || row?.date >= startDate)
      && toNumber(row?.news_sentiment) !== null
    ));
    const dates = filteredAdr.map((row) => row.date);
    const kospiValues = filteredAdr.map((row) => toNumber(row.adr_kospi));
    const kosdaqValues = filteredAdr.map((row) => toNumber(row.adr_kosdaq));
    const fearGreedValues = filteredAdr.map((row) => toNumber(row.fear_greed));
    const newsDates = filteredNews.map((row) => row.date);
    const newsValues = filteredNews.map((row) => toNumber(row.news_sentiment));

    const adrNumbers = [...kospiValues, ...kosdaqValues].filter(Number.isFinite);
    const adrRawMin = adrNumbers.length ? Math.min(...adrNumbers) : adrLowThreshold;
    const adrRawMax = adrNumbers.length ? Math.max(...adrNumbers) : adrHighThreshold;
    const newsNumbers = newsValues.filter(Number.isFinite);

    return {
      dates,
      kospiValues,
      kosdaqValues,
      fearGreedValues,
      newsDates,
      newsValues,
      kospiZones: buildThresholdZones(kospiValues, adrLowThreshold, adrHighThreshold),
      kosdaqZones: buildThresholdZones(kosdaqValues, adrLowThreshold, adrHighThreshold),
      adrYMin: Math.min(adrRawMin, adrLowThreshold) - 2.5,
      adrYMax: Math.max(adrRawMax, adrHighThreshold) + 1.2,
      newsYMin: Math.min(...newsNumbers, newsLowThreshold) - 2,
      newsYMax: Math.max(...newsNumbers, newsHighThreshold) + 2,
      adrRowCount: filteredAdr.length,
      newsRowCount: filteredNews.length,
    };
  }

  globalScope.ThinkStockAuxiliaryChartModel = Object.freeze({
    buildAuxiliaryChartModel,
    buildThresholdZones,
  });
}(typeof self !== "undefined" ? self : globalThis));
