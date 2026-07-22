(function initThinkStockAiForecast(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_HORIZON = 126;
  const FORECAST_SERIES_PATTERN = /^\d{6}\.(KS|KQ)$/;

  const toNumber = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const mean = (values) => (
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  );

  function standardDeviation(values) {
    if (values.length < 2) return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
  }

  function normalizedShape(values) {
    const average = mean(values);
    const deviation = standardDeviation(values) || 1;
    return values.map((value) => (value - average) / deviation);
  }

  function isForecastSeries(series) {
    return FORECAST_SERIES_PATTERN.test(String(series || "").toUpperCase())
      || ["^KS11", "^KQ11"].includes(String(series || "").toUpperCase());
  }

  function nextBusinessDates(lastDate, count) {
    const start = Date.parse(`${String(lastDate || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(start)) return [];
    const dates = [];
    let cursor = start;
    while (dates.length < count) {
      cursor += DAY_MS;
      const date = new Date(cursor);
      const day = date.getUTCDay();
      if (day !== 0 && day !== 6) dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
  }

  function latestSeriesSignal(rows, key, lookback = 252) {
    const values = (Array.isArray(rows) ? rows : [])
      .map((row) => toNumber(row?.[key]))
      .filter(Number.isFinite)
      .slice(-lookback);
    if (values.length < 12) return 0;
    const deviation = standardDeviation(values);
    if (!deviation) return 0;
    return clamp((values.at(-1) - mean(values)) / (deviation * 2.5), -1, 1);
  }

  function latestValue(rows, key) {
    const source = Array.isArray(rows) ? rows : [];
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const value = toNumber(source[index]?.[key]);
      if (value !== null) return value;
    }
    return null;
  }

  function disclosureSignal(disclosures, ticker, lastDate) {
    const lastMs = Date.parse(`${lastDate}T00:00:00Z`);
    if (!Number.isFinite(lastMs)) return 0;
    const positive = /수주|공급계약|배당|자사주.*취득|실적.*증가|영업이익.*증가|흑자전환|특허|승인/;
    const negative = /유상증자|감자|거래정지|횡령|배임|적자전환|관리종목|상장폐지|회생|파산/;
    let weighted = 0;
    let weightTotal = 0;
    (Array.isArray(disclosures) ? disclosures : []).forEach((item) => {
      if (String(item?.ticker || "").toUpperCase() !== ticker) return;
      const eventMs = Date.parse(`${String(item?.date || "").slice(0, 10)}T00:00:00Z`);
      const ageDays = (lastMs - eventMs) / DAY_MS;
      if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 120) return;
      const title = String(item?.title || "");
      const score = positive.test(title) ? 1 : (negative.test(title) ? -1 : 0);
      const weight = Math.exp(-ageDays / 45);
      weighted += score * weight;
      weightTotal += weight;
    });
    return weightTotal ? clamp(weighted / Math.max(1, weightTotal), -1, 1) : 0;
  }

  function buildContextSignal(options, ticker, lastDate, currentPrice = null) {
    const macroRows = options.macroRows || [];
    const auxiliaryRows = options.auxiliaryRows || [];
    const news = latestSeriesSignal(macroRows, "news_sentiment");
    const fearGreedValue = latestValue(auxiliaryRows, "fear_greed");
    const fearGreed = fearGreedValue === null ? 0 : clamp((50 - fearGreedValue) / 50, -1, 1);
    const adrKey = String(ticker).endsWith(".KQ") || ticker === "^KQ11" ? "adr_kosdaq" : "adr_kospi";
    const adrValue = latestValue(auxiliaryRows, adrKey);
    const adr = adrValue === null ? 0 : clamp((100 - adrValue) / 70, -1, 1);
    const disclosure = disclosureSignal(options.disclosures, ticker, lastDate);
    const consensus = options.consensus || null;
    const targetPrice = toNumber(consensus?.targetPrice);
    const opinion = toNumber(consensus?.opinion);
    const institutions = toNumber(consensus?.institutions);
    const reliability = institutions === null ? 0 : clamp(institutions / 8, 0, 1);
    const targetSignal = targetPrice !== null && currentPrice > 0
      ? clamp(((targetPrice / currentPrice) - 1) / 0.5, -1, 1)
      : 0;
    const opinionSignal = opinion === null ? 0 : clamp((opinion - 3) / 2, -1, 1);
    const consensusSignal = ((targetSignal * 0.7) + (opinionSignal * 0.3)) * reliability;
    return {
      news,
      fearGreed,
      adr,
      disclosure,
      consensus: consensusSignal,
      combined: clamp(
        (news * 0.28)
        + (fearGreed * 0.18)
        + (adr * 0.14)
        + (disclosure * 0.1)
        + (consensusSignal * 0.3),
        -1,
        1,
      ),
    };
  }

  function rsiSignal(returns) {
    const recent = returns.slice(-14);
    if (recent.length < 8) return 0;
    let gains = 0;
    let losses = 0;
    recent.forEach((value) => {
      const simpleReturn = Math.exp(value) - 1;
      if (simpleReturn >= 0) gains += simpleReturn;
      else losses -= simpleReturn;
    });
    if (!losses) return -1;
    const rsi = 100 - (100 / (1 + (gains / losses)));
    return clamp((50 - rsi) / 35, -1, 1);
  }

  function findPatternMatches(returns, windowSize, horizon) {
    const recent = returns.slice(-windowSize);
    const recentShape = normalizedShape(recent);
    const recentVolatility = standardDeviation(recent) || 0.0001;
    const matches = [];
    const latestCandidateEnd = returns.length - horizon - 21;
    for (let end = windowSize; end <= latestCandidateEnd; end += 3) {
      const candidate = returns.slice(end - windowSize, end);
      const candidateShape = normalizedShape(candidate);
      let shapeError = 0;
      for (let index = 0; index < windowSize; index += 1) {
        shapeError += (recentShape[index] - candidateShape[index]) ** 2;
      }
      const volatilityError = Math.abs(Math.log(
        Math.max(0.0001, standardDeviation(candidate)) / recentVolatility,
      ));
      matches.push({
        score: (shapeError / windowSize) + (volatilityError * 0.35),
        future: returns.slice(end, end + horizon),
      });
    }
    return matches.sort((left, right) => left.score - right.score).slice(0, 12);
  }

  function weightedPatternReturn(matches, index) {
    if (!matches.length) return null;
    let total = 0;
    let weightTotal = 0;
    matches.forEach((match) => {
      const value = match.future[index];
      if (!Number.isFinite(value)) return;
      const weight = 1 / (0.08 + match.score);
      total += value * weight;
      weightTotal += weight;
    });
    return weightTotal ? total / weightTotal : null;
  }

  function fitChartTransform(points) {
    const pairs = points
      .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.chart))
      .slice(-252);
    if (pairs.length < 2) return null;
    const priceMean = mean(pairs.map((point) => point.price));
    const chartMean = mean(pairs.map((point) => point.chart));
    let covariance = 0;
    let variance = 0;
    pairs.forEach((point) => {
      covariance += (point.price - priceMean) * (point.chart - chartMean);
      variance += (point.price - priceMean) ** 2;
    });
    const slope = variance ? covariance / variance : 0;
    if (!Number.isFinite(slope) || slope <= 0) return null;
    return { slope, intercept: chartMean - (slope * priceMean) };
  }

  function buildForecast(options = {}) {
    const ticker = String(options.series || "").toUpperCase();
    if (!isForecastSeries(ticker)) return null;
    const dates = Array.isArray(options.dates) ? options.dates : [];
    const prices = Array.isArray(options.prices) ? options.prices : [];
    const chartValues = Array.isArray(options.chartValues) ? options.chartValues : [];
    const points = [];
    for (let index = 0; index < Math.min(dates.length, prices.length); index += 1) {
      const price = toNumber(prices[index]);
      const date = String(dates[index] || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || price === null || price <= 0) continue;
      points.push({ date, price, chart: toNumber(chartValues[index]) });
    }
    if (points.length > 1260) points.splice(0, points.length - 1260);
    if (points.length < 90) return null;

    const returns = [];
    for (let index = 1; index < points.length; index += 1) {
      const value = Math.log(points[index].price / points[index - 1].price);
      if (Number.isFinite(value)) returns.push(value);
    }
    if (returns.length < 60) return null;

    const horizon = clamp(Math.round(Number(options.horizon) || DEFAULT_HORIZON), 20, 260);
    const windowSize = Math.min(63, Math.max(30, Math.floor(returns.length / 6)));
    const matches = findPatternMatches(returns, windowSize, horizon);
    const volatility = clamp(standardDeviation(returns.slice(-63)) || 0.01, 0.003, 0.08);
    const momentum = clamp(
      (mean(returns.slice(-20)) * 0.5)
      + (mean(returns.slice(-60)) * 0.3)
      + (mean(returns.slice(-126)) * 0.2),
      -volatility * 0.16,
      volatility * 0.16,
    );
    const technical = rsiSignal(returns);
    const lastPoint = points.at(-1);
    const signals = buildContextSignal(options, ticker, lastPoint.date, lastPoint.price);
    const historyConfidence = clamp((points.length - 60) / 192, 0.2, 1);
    const factors = [1];
    let cumulative = 0;
    let smoothed = momentum;
    for (let index = 0; index < horizon; index += 1) {
      const pattern = weightedPatternReturn(matches, index);
      const trend = momentum * Math.exp(-index / 100);
      const technicalBias = technical * volatility * 0.025 * historyConfidence * Math.exp(-index / 35);
      const contextBias = signals.combined * volatility * 0.018 * historyConfidence * Math.exp(-index / 150);
      const raw = (pattern === null ? trend : ((pattern * 0.78) + (trend * 0.22)))
        + technicalBias
        + contextBias;
      smoothed = (smoothed * 0.72) + (raw * 0.28);
      cumulative = clamp(cumulative + clamp(smoothed, -volatility * 2.5, volatility * 2.5), Math.log(0.35), Math.log(2.5));
      factors.push(Math.exp(cumulative));
    }

    const transform = fitChartTransform(points);
    const lastChart = toNumber(lastPoint.chart);
    if (!transform || lastChart === null) return null;
    const anchorCorrection = lastChart - ((transform.slope * lastPoint.price) + transform.intercept);
    const futureDates = nextBusinessDates(lastPoint.date, horizon);
    return {
      series: ticker,
      dates: [lastPoint.date, ...futureDates],
      prices: factors.map((factor) => lastPoint.price * factor),
      chartValues: factors.map((factor) => (
        (transform.slope * lastPoint.price * factor) + transform.intercept + anchorCorrection
      )),
      signals: { ...signals, technical },
      patternMatches: matches.length,
      historyDays: points.length,
      horizon,
    };
  }

  globalScope.ThinkStockAiForecast = Object.freeze({
    buildContextSignal,
    buildForecast,
    isForecastSeries,
    nextBusinessDates,
  });
}(typeof self !== "undefined" ? self : globalThis));
