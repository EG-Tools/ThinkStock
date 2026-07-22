(function initThinkStockAiForecast(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_HORIZON = 126;
  const FORECAST_SERIES_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const BACKTEST_HORIZONS = [20, 63, 126];
  const BACKTEST_HORIZON_WEIGHTS = [0.2, 0.3, 0.5];
  const STRATEGY_CANDIDATES = [
    { patternWeight: 0.52, trendMultiplier: 1, baseline: true },
    ...[0.35, 0.55, 0.75].flatMap((patternWeight) => (
      [-0.4, 0.3, 0.8, 1.25].map((trendMultiplier) => ({ patternWeight, trendMultiplier }))
    )),
  ];
  const calibrationCache = new Map();

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

  function winsorizedDeviation(values, trimRatio = 0.1) {
    if (values.length < 10) return standardDeviation(values);
    const sorted = [...values].sort((left, right) => left - right);
    const low = sorted[Math.floor((sorted.length - 1) * trimRatio)];
    const high = sorted[Math.ceil((sorted.length - 1) * (1 - trimRatio))];
    return standardDeviation(values.map((value) => clamp(value, low, high)));
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

  function momentumReturn(returns, volatility) {
    return clamp(
      (mean(returns.slice(-20)) * 0.5)
      + (mean(returns.slice(-60)) * 0.3)
      + (mean(returns.slice(-126)) * 0.2),
      -volatility * 0.16,
      volatility * 0.16,
    );
  }

  function regimeFeatures(returns) {
    const recent = returns.slice(-63);
    const volatility = clamp(winsorizedDeviation(recent) || 0.01, 0.003, 0.08);
    const longVolatility = clamp(winsorizedDeviation(returns.slice(-126)) || volatility, 0.003, 0.08);
    return {
      trend: clamp((mean(recent) * Math.sqrt(Math.max(1, recent.length))) / volatility, -2.5, 2.5),
      volatilityRatio: clamp(volatility / longVolatility, 0.5, 2),
    };
  }

  function regimeWeight(current, historical) {
    const trendDistance = Math.abs(current.trend - historical.trend) / 2.5;
    const volatilityDistance = Math.abs(Math.log(
      current.volatilityRatio / historical.volatilityRatio,
    ));
    return 0.3 + (0.7 * Math.exp(-1.1 * (trendDistance + volatilityDistance)));
  }

  function weightedMedian(entries) {
    if (!entries.length) return null;
    const sorted = [...entries].sort((left, right) => left.value - right.value);
    const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
    let cumulative = 0;
    for (const entry of sorted) {
      cumulative += entry.weight;
      if (cumulative >= total / 2) return entry.value;
    }
    return sorted.at(-1).value;
  }

  function calibrateForecastStrategy(returns, horizon = DEFAULT_HORIZON) {
    const fallback = {
      patternWeight: 0.52,
      trendMultiplier: 1,
      volatilityRatio: 0.75,
      samples: 0,
      directionAccuracy: null,
      normalizedError: null,
      improvement: 0,
      confidence: 0.2,
    };
    if (returns.length < 420 || horizon < 63) return fallback;

    const currentRegime = regimeFeatures(returns);
    const latestAnchor = returns.length - horizon;
    const earliestAnchor = Math.max(294, latestAnchor - 3 * 252);
    const anchors = [];
    for (let anchor = latestAnchor; anchor >= earliestAnchor && anchors.length < 14; anchor -= 42) {
      anchors.push(anchor);
    }
    if (anchors.length < 5) return fallback;

    const candidateScores = STRATEGY_CANDIDATES.map((candidate) => ({
      ...candidate,
      error: 0,
      hits: 0,
      trials: 0,
      weight: 0,
    }));
    const volatilityRatios = [];
    let validSamples = 0;
    anchors.forEach((anchor) => {
      const history = returns.slice(0, anchor);
      const actualFuture = returns.slice(anchor, anchor + horizon);
      if (history.length < 294 || actualFuture.length < horizon) return;
      const historyVolatility = clamp(
        winsorizedDeviation(history.slice(-63)) || 0.01,
        0.003,
        0.08,
      );
      const windowSize = Math.min(63, Math.max(30, Math.floor(history.length / 6)));
      const matches = findPatternMatches(history, windowSize, horizon);
      if (!matches.length) return;
      const patternPath = Array.from({ length: horizon }, (_, index) => (
        weightedPatternReturn(matches, index) || 0
      ));
      const anchorMomentum = momentumReturn(history, historyVolatility);
      const trendPath = Array.from({ length: horizon }, (_, index) => (
        anchorMomentum * Math.exp(-index / 100)
      ));
      const historicalRegime = regimeFeatures(history);
      const similarity = regimeWeight(currentRegime, historicalRegime);
      const recency = Math.exp(-(latestAnchor - anchor) / (3 * 252));
      const sampleWeight = similarity * (0.55 + (0.45 * recency));
      const futureVolatility = winsorizedDeviation(actualFuture);
      if (futureVolatility > 0) {
        volatilityRatios.push({
          value: clamp(futureVolatility / historyVolatility, 0.5, 1.15),
          weight: sampleWeight,
        });
      }

      candidateScores.forEach((candidate) => {
        let weightedError = 0;
        BACKTEST_HORIZONS.forEach((endpoint, endpointIndex) => {
          const actual = actualFuture.slice(0, endpoint).reduce((sum, value) => sum + value, 0);
          const pattern = patternPath.slice(0, endpoint).reduce((sum, value) => sum + value, 0);
          const trend = trendPath.slice(0, endpoint).reduce((sum, value) => sum + value, 0);
          const predicted = (pattern * candidate.patternWeight)
            + (trend * candidate.trendMultiplier * (1 - candidate.patternWeight));
          const scale = Math.max(0.01, historyVolatility * Math.sqrt(endpoint));
          const directionMiss = Math.sign(predicted) !== Math.sign(actual) ? 0.35 : 0;
          weightedError += BACKTEST_HORIZON_WEIGHTS[endpointIndex]
            * (Math.min(4, Math.abs(predicted - actual) / scale) + directionMiss);
          candidate.hits += sampleWeight * (Math.sign(predicted) === Math.sign(actual) ? 1 : 0);
          candidate.trials += sampleWeight;
        });
        candidate.error += weightedError * sampleWeight;
        candidate.weight += sampleWeight;
      });
      validSamples += 1;
    });
    if (validSamples < 5) return fallback;

    const ranked = candidateScores
      .filter((candidate) => candidate.weight > 0)
      .map((candidate) => ({
        ...candidate,
        score: candidate.error / candidate.weight,
        accuracy: candidate.trials ? candidate.hits / candidate.trials : 0,
      }))
      .sort((left, right) => left.score - right.score);
    if (!ranked.length) return fallback;
    const bestScore = ranked[0].score;
    const baselineScore = ranked.find((candidate) => candidate.baseline)?.score || bestScore;
    const selected = ranked
      .filter((candidate) => candidate.score <= baselineScore + Number.EPSILON)
      .slice(0, 3)
      .map((candidate) => ({
      ...candidate,
      ensembleWeight: Math.exp(-2.2 * (candidate.score - bestScore)),
      }));
    const ensembleWeight = selected.reduce((sum, candidate) => sum + candidate.ensembleWeight, 0);
    const blend = (key) => selected.reduce((sum, candidate) => (
      sum + (candidate[key] * candidate.ensembleWeight)
    ), 0) / ensembleWeight;
    const directionAccuracy = blend("accuracy");
    const normalizedError = blend("score");
    const sampleConfidence = clamp(validSamples / 12, 0, 1);
    const accuracyConfidence = clamp((directionAccuracy - 0.45) / 0.25, 0, 1);
    const errorConfidence = clamp(1 - (normalizedError / 2.2), 0, 1);
    const rawConfidence = clamp(
      0.2 + (sampleConfidence * 0.35) + (accuracyConfidence * 0.25) + (errorConfidence * 0.2),
      0.2,
      0.9,
    );
    const accuracyCap = clamp(0.35 + ((directionAccuracy - 0.45) * 2), 0.35, 0.9);
    return {
      patternWeight: blend("patternWeight"),
      trendMultiplier: blend("trendMultiplier"),
      volatilityRatio: weightedMedian(volatilityRatios) || fallback.volatilityRatio,
      samples: validSamples,
      directionAccuracy,
      normalizedError,
      improvement: baselineScore > 0
        ? clamp((baselineScore - normalizedError) / baselineScore, 0, 1)
        : 0,
      confidence: Math.min(rawConfidence, accuracyCap),
    };
  }

  function cachedForecastCalibration(ticker, points, returns, horizon) {
    const lastPoint = points.at(-1);
    const key = `${ticker}|${lastPoint?.date || ""}|${points.length}|${lastPoint?.price || ""}|${horizon}`;
    if (calibrationCache.has(key)) return calibrationCache.get(key);
    const calibration = calibrateForecastStrategy(returns, horizon);
    calibrationCache.set(key, calibration);
    while (calibrationCache.size > 60) calibrationCache.delete(calibrationCache.keys().next().value);
    return calibration;
  }

  function buildAnalogWave(matches, returns, horizon) {
    const matched = matches[0]?.future || [];
    const fallbackLength = Math.min(126, returns.length);
    const source = matched.some(Number.isFinite)
      ? matched
      : returns.slice(-fallbackLength);
    const finite = source.filter(Number.isFinite);
    if (finite.length < 2) return Array(horizon).fill(0);
    const center = mean(finite);
    return Array.from({ length: horizon }, (_, index) => {
      const value = source[index % source.length];
      return Number.isFinite(value) ? value - center : 0;
    });
  }

  function calibrateForecastVolatility(values, targetVolatility) {
    if (!values.length) return [];
    const center = mean(values);
    const deviation = standardDeviation(values);
    const scale = deviation > 0 ? targetVolatility / deviation : 0;
    const dailyLimit = Math.max(0.012, targetVolatility * 3.2);
    return values.map((value) => clamp(
      center + ((value - center) * scale),
      -dailyLimit,
      dailyLimit,
    ));
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
    const volatility = clamp(winsorizedDeviation(returns.slice(-63)) || 0.01, 0.003, 0.08);
    const momentum = momentumReturn(returns, volatility);
    const technical = rsiSignal(returns);
    const lastPoint = points.at(-1);
    const calibration = cachedForecastCalibration(ticker, points, returns, horizon);
    const signals = buildContextSignal(options, ticker, lastPoint.date, lastPoint.price);
    const historyConfidence = clamp((points.length - 60) / 192, 0.2, 1);
    const patternPath = Array.from({ length: horizon }, (_, index) => (
      weightedPatternReturn(matches, index)
    ));
    const finitePatternReturns = patternPath.filter(Number.isFinite);
    const patternCenter = finitePatternReturns.length ? mean(finitePatternReturns) : 0;
    const analogWave = buildAnalogWave(matches, returns, horizon);
    const candidateReturns = [];
    let directionalReturn = momentum;
    for (let index = 0; index < horizon; index += 1) {
      const pattern = patternPath[index];
      const trend = momentum * Math.exp(-index / 100);
      const technicalBias = technical * volatility * 0.025 * historyConfidence * Math.exp(-index / 35);
      const contextBias = signals.combined * volatility * 0.018 * historyConfidence * Math.exp(-index / 150);
      const calibratedTrend = trend * calibration.trendMultiplier;
      const directionalTarget = (pattern === null
        ? calibratedTrend
        : ((pattern * calibration.patternWeight)
          + (calibratedTrend * (1 - calibration.patternWeight))))
        + technicalBias
        + contextBias;
      directionalReturn = (directionalReturn * 0.84) + (directionalTarget * 0.16);
      const ensembleWave = pattern === null ? 0 : pattern - patternCenter;
      candidateReturns.push(
        directionalReturn
        + (analogWave[index] * 0.68)
        + (ensembleWave * 0.22),
      );
    }

    const volatilityCeiling = ticker.startsWith("^") ? 0.025 : 0.04;
    const projectedVolatility = clamp(
      volatility * calibration.volatilityRatio,
      0.003,
      volatilityCeiling,
    );
    const forecastReturns = calibrateForecastVolatility(candidateReturns, projectedVolatility);
    const factors = [1];
    let cumulative = 0;
    forecastReturns.forEach((dailyReturn) => {
      cumulative = clamp(cumulative + dailyReturn, Math.log(0.35), Math.log(2.5));
      factors.push(Math.exp(cumulative));
    });

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
      projectedVolatility,
      backtest: { ...calibration },
    };
  }

  globalScope.ThinkStockAiForecast = Object.freeze({
    buildContextSignal,
    buildForecast,
    calibrateForecastStrategy,
    isForecastSeries,
    nextBusinessDates,
  });
}(typeof self !== "undefined" ? self : globalThis));
