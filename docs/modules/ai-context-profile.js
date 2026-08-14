(function initThinkStockAiContextProfile(globalScope) {
  "use strict";

  const TRADING_DAYS = 252;
  const MAX_HISTORY_DAYS = 15 * TRADING_DAYS;
  const RECENT_HISTORY_DAYS = 3 * TRADING_DAYS;
  const PROFILE_CACHE_LIMIT = 48;
  const PROFILE_VERSION = "context-profile-v1";
  const PROFILE_CACHE = new Map();
  const math = globalScope.ThinkStockAiForecastMath || {};

  const clamp = math.clamp || ((value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value)));
  const mean = math.mean || ((values) => (
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  ));
  const standardDeviation = math.standardDeviation || ((values) => {
    if (values.length < 2) return 0;
    const average = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
  });
  const pearson = math.pearson || ((left, right) => {
    const count = Math.min(left.length, right.length);
    if (count < 3) return 0;
    const leftValues = left.slice(-count);
    const rightValues = right.slice(-count);
    const leftMean = mean(leftValues);
    const rightMean = mean(rightValues);
    let numerator = 0;
    let leftSum = 0;
    let rightSum = 0;
    for (let index = 0; index < count; index += 1) {
      const leftDelta = leftValues[index] - leftMean;
      const rightDelta = rightValues[index] - rightMean;
      numerator += leftDelta * rightDelta;
      leftSum += leftDelta ** 2;
      rightSum += rightDelta ** 2;
    }
    return leftSum > 0 && rightSum > 0 ? numerator / Math.sqrt(leftSum * rightSum) : 0;
  });

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function quantile(values, probability) {
    const source = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!source.length) return 0;
    const position = clamp(probability, 0, 1) * (source.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return source[lower];
    return source[lower] + ((source[upper] - source[lower]) * (position - lower));
  }

  function percentileRank(values, target) {
    const source = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!source.length || !Number.isFinite(target)) return 0.5;
    let below = 0;
    let equal = 0;
    source.forEach((value) => {
      if (value < target) below += 1;
      else if (value === target) equal += 1;
    });
    return clamp((below + (equal * 0.5)) / source.length, 0, 1);
  }

  function normalizeDate(value) {
    const date = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  }

  function pricePoints(dates, prices, asOfDate = "9999-99-99") {
    const output = [];
    const limit = Math.min(Array.isArray(dates) ? dates.length : 0, Array.isArray(prices) ? prices.length : 0);
    for (let index = 0; index < limit; index += 1) {
      const date = normalizeDate(dates[index]);
      const price = finite(prices[index]);
      if (date && date <= asOfDate && price > 0) output.push({ date, price });
    }
    output.sort((left, right) => left.date.localeCompare(right.date));
    const deduplicated = [];
    output.forEach((point) => {
      if (deduplicated.at(-1)?.date === point.date) deduplicated[deduplicated.length - 1] = point;
      else deduplicated.push(point);
    });
    return deduplicated.slice(-MAX_HISTORY_DAYS);
  }

  function previousMonthPoints(points) {
    if (!points.length) return [];
    const currentMonth = points.at(-1).date.slice(0, 7);
    const completed = points.filter((point) => point.date.slice(0, 7) < currentMonth);
    return completed.length >= TRADING_DAYS ? completed : points;
  }

  function monthlyPoints(points) {
    const byMonth = new Map();
    points.forEach((point) => byMonth.set(point.date.slice(0, 7), point));
    return [...byMonth.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function logarithmicReturns(points) {
    const output = [];
    for (let index = 1; index < points.length; index += 1) {
      output.push(Math.log(points[index].price / points[index - 1].price));
    }
    return output;
  }

  function historyYears(points) {
    if (points.length < 2) return 0;
    const start = Date.parse(`${points[0].date}T00:00:00Z`);
    const end = Date.parse(`${points.at(-1).date}T00:00:00Z`);
    return Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, (end - start) / (365.25 * 86400000))
      : points.length / TRADING_DAYS;
  }

  function linearProfile(values) {
    const count = values.length;
    if (count < 3) return { slope: 0, intercept: values[0] || 0, rSquared: 0, residuals: values.map(() => 0) };
    const center = (count - 1) / 2;
    const average = mean(values);
    let numerator = 0;
    let denominator = 0;
    values.forEach((value, index) => {
      const x = index - center;
      numerator += x * (value - average);
      denominator += x ** 2;
    });
    const slope = denominator > 0 ? numerator / denominator : 0;
    const intercept = average - (slope * center);
    const fitted = values.map((_, index) => intercept + (slope * index));
    const residuals = values.map((value, index) => value - fitted[index]);
    const total = values.reduce((sum, value) => sum + ((value - average) ** 2), 0);
    const unexplained = residuals.reduce((sum, value) => sum + (value ** 2), 0);
    return {
      slope,
      intercept,
      rSquared: total > 0 ? clamp(1 - (unexplained / total), 0, 1) : 0,
      residuals,
    };
  }

  function trendProfile(points) {
    const monthly = monthlyPoints(points);
    const logs = monthly.map((point) => Math.log(point.price));
    const trend = linearProfile(logs);
    const years = Math.max(0.25, historyYears(points));
    const annualizedReturn = logs.length > 1 ? (logs.at(-1) - logs[0]) / years : 0;
    const annualizedSlope = trend.slope * 12;
    const pathLength = logs.slice(1).reduce((sum, value, index) => sum + Math.abs(value - logs[index]), 0);
    const efficiency = pathLength > 0 ? Math.abs(logs.at(-1) - logs[0]) / pathLength : 0;
    const median = quantile(logs, 0.5);
    const width = Math.max(0.0001, quantile(logs, 0.9) - quantile(logs, 0.1));
    let crossings = 0;
    let priorSign = 0;
    logs.forEach((value) => {
      const delta = value - median;
      const sign = Math.abs(delta) <= width * 0.03 ? 0 : Math.sign(delta);
      if (sign && priorSign && sign !== priorSign) crossings += 1;
      if (sign) priorSign = sign;
    });
    const returns = logarithmicReturns(points);
    const annualizedVolatility = standardDeviation(returns) * Math.sqrt(TRADING_DAYS);
    const normalizedTrend = clamp(Math.abs(annualizedSlope) / Math.max(0.08, annualizedVolatility * 0.65), 0, 1);
    const trendStrength = normalizedTrend * (0.35 + (trend.rSquared * 0.35) + (efficiency * 0.3));
    const lowTrend = 1 - normalizedTrend;
    const rangeScore = clamp(
      (lowTrend * 0.28)
        + ((1 - trend.rSquared) * 0.2)
        + ((1 - efficiency) * 0.22)
        + (clamp((crossings / years) / 1.5, 0, 1) * 0.3),
      0,
      1,
    );
    return {
      years,
      annualizedReturn,
      annualizedSlope,
      annualizedVolatility,
      rSquared: trend.rSquared,
      efficiency,
      crossingsPerYear: crossings / years,
      upScore: annualizedSlope > 0 ? trendStrength : 0,
      downScore: annualizedSlope < 0 ? trendStrength : 0,
      rangeScore,
      monthly,
      residuals: trend.residuals,
    };
  }

  function lagCorrelation(values, lag) {
    if (lag < 1 || values.length < lag + 8) return 0;
    return pearson(values.slice(lag), values.slice(0, -lag));
  }

  function cycleProfile(trend) {
    const values = trend.residuals || [];
    const maximumLag = Math.min(60, Math.floor((values.length - 8) / 2));
    if (maximumLag < 12) return { periodMonths: 0, confidence: 0, stable: false, cyclesObserved: 0 };
    const first = values.slice(0, Math.ceil(values.length * 0.65));
    const second = values.slice(Math.floor(values.length * 0.35));
    let best = null;
    for (let lag = 12; lag <= maximumLag; lag += 1) {
      const fullCorrelation = lagCorrelation(values, lag);
      const firstCorrelation = lagCorrelation(first, lag);
      const secondCorrelation = lagCorrelation(second, lag);
      const stableCorrelation = Math.min(Math.max(0, firstCorrelation), Math.max(0, secondCorrelation));
      const cyclesObserved = values.length / lag;
      const coverage = clamp((cyclesObserved - 1.5) / 2.5, 0, 1);
      const confidence = clamp(
        (Math.max(0, fullCorrelation) * 0.45)
          + (stableCorrelation * 0.4)
          + (coverage * 0.15),
        0,
        1,
      ) * coverage;
      if (!best || confidence > best.confidence) {
        best = { periodMonths: lag, confidence, fullCorrelation, stableCorrelation, cyclesObserved };
      }
    }
    if (!best || best.fullCorrelation < 0.2 || best.stableCorrelation < 0.08) {
      return { periodMonths: best?.periodMonths || 0, confidence: 0, stable: false, cyclesObserved: best?.cyclesObserved || 0 };
    }
    return { ...best, stable: best.confidence >= 0.35 };
  }

  function buildRuns(monthly) {
    const logs = monthly.map((point) => Math.log(point.price));
    const changes = logs.slice(1).map((value, index) => value - logs[index]);
    const threshold = Math.max(0.025, standardDeviation(changes) * Math.sqrt(6) * 0.3);
    const states = logs.map((value, index) => {
      if (index < 3) return 0;
      const lookback = Math.min(6, index);
      const change = value - logs[index - lookback];
      return change > threshold ? 1 : (change < -threshold ? -1 : 0);
    });
    const runs = [];
    let active = null;
    states.forEach((state) => {
      if (!state) {
        if (active) active.duration += 1;
        return;
      }
      if (active?.state === state) active.duration += 1;
      else {
        if (active) runs.push(active);
        active = { state, duration: 1 };
      }
    });
    if (active) runs.push(active);
    const current = runs.at(-1) || { state: 0, duration: 0 };
    const durations = (state) => runs.filter((run) => run.state === state).map((run) => run.duration);
    return {
      state: current.state,
      durationMonths: current.duration,
      upMedianMonths: quantile(durations(1), 0.5),
      upUpperMonths: quantile(durations(1), 0.75),
      downMedianMonths: quantile(durations(-1), 0.5),
      downUpperMonths: quantile(durations(-1), 0.75),
    };
  }

  function drawdownProfile(monthly, runProfile) {
    if (!monthly.length) {
      return { current: 0, durationMonths: 0, durationRank: 0.5, depthRank: 0.5, reversalReadiness: 0 };
    }
    let peakIndex = 0;
    let peakPrice = monthly[0].price;
    let activeStart = null;
    let activeDepth = 0;
    const completed = [];
    monthly.forEach((point, index) => {
      if (point.price >= peakPrice) {
        if (activeStart !== null) {
          completed.push({ duration: index - activeStart, depth: activeDepth });
          activeStart = null;
          activeDepth = 0;
        }
        peakPrice = point.price;
        peakIndex = index;
      } else {
        if (activeStart === null) activeStart = index;
        activeDepth = Math.min(activeDepth, (point.price / peakPrice) - 1);
      }
    });
    const latest = monthly.at(-1).price;
    const current = (latest / peakPrice) - 1;
    const durationMonths = Math.max(0, monthly.length - 1 - peakIndex);
    const durationRank = percentileRank(completed.map((item) => item.duration), durationMonths);
    const depthRank = percentileRank(completed.map((item) => Math.abs(item.depth)), Math.abs(current));
    const oneMonthReturn = monthly.length > 1 ? Math.log(latest / monthly.at(-2).price) : 0;
    const threeMonthReturn = monthly.length > 3 ? Math.log(latest / monthly.at(-4).price) : oneMonthReturn;
    const priceConfirmation = clamp(
      (Math.max(0, oneMonthReturn) / 0.08) * 0.45
        + (Math.max(0, threeMonthReturn) / 0.18) * 0.55,
      0,
      1,
    );
    const pressure = current < -0.08
      ? clamp((durationRank * 0.45) + (depthRank * 0.55), 0, 1)
      : 0;
    return {
      current,
      durationMonths,
      durationRank,
      depthRank,
      priceConfirmation,
      reversalReadiness: pressure * (0.15 + (priceConfirmation * 0.85)),
      unconfirmedPressure: pressure * (1 - priceConfirmation),
      completedEpisodes: completed.length,
    };
  }

  function candidateSeries(candidate) {
    const sourceDates = Array.isArray(candidate?.dates) ? candidate.dates : [];
    const sourcePrices = Array.isArray(candidate?.prices) ? candidate.prices : [];
    const points = [];
    for (let index = 0; index < Math.min(sourceDates.length, sourcePrices.length); index += 1) {
      const date = normalizeDate(sourceDates[index]);
      const price = finite(sourcePrices[index]);
      if (date && price > 0) points.push({ date, price });
    }
    points.sort((left, right) => left.date.localeCompare(right.date));
    return points;
  }

  function alignedReturns(stockPoints, candidate) {
    const marketPoints = candidateSeries(candidate);
    if (stockPoints.length < 3 || marketPoints.length < 3) return { stock: [], market: [] };
    let marketIndex = 0;
    let latest = null;
    const aligned = stockPoints.map((point) => {
      while (marketIndex < marketPoints.length && marketPoints[marketIndex].date <= point.date) {
        latest = marketPoints[marketIndex].price;
        marketIndex += 1;
      }
      return { stock: point.price, market: latest };
    }).filter((point) => point.market > 0);
    const stock = [];
    const market = [];
    for (let index = 1; index < aligned.length; index += 1) {
      stock.push(Math.log(aligned[index].stock / aligned[index - 1].stock));
      market.push(Math.log(aligned[index].market / aligned[index - 1].market));
    }
    return { stock, market };
  }

  function relationshipAt(aligned, window) {
    const count = Math.min(window, aligned.stock.length, aligned.market.length);
    if (count < 60) return { samples: count, correlation: 0, beta: 0, downsideBeta: 0 };
    const stock = aligned.stock.slice(-count);
    const market = aligned.market.slice(-count);
    const correlation = pearson(stock, market);
    const marketMean = mean(market);
    const marketVariance = mean(market.map((value) => (value - marketMean) ** 2));
    const stockMean = mean(stock);
    const covariance = mean(stock.map((value, index) => (
      (value - stockMean) * (market[index] - marketMean)
    )));
    const downsideIndexes = market.map((value, index) => value < 0 ? index : -1).filter((index) => index >= 0);
    const downMarket = downsideIndexes.map((index) => market[index]);
    const downStock = downsideIndexes.map((index) => stock[index]);
    const downMarketMean = mean(downMarket);
    const downStockMean = mean(downStock);
    const downVariance = mean(downMarket.map((value) => (value - downMarketMean) ** 2));
    const downCovariance = mean(downStock.map((value, index) => (
      (value - downStockMean) * (downMarket[index] - downMarketMean)
    )));
    const beta = marketVariance > 0 ? covariance / marketVariance : 0;
    return {
      samples: count,
      correlation: clamp(correlation, -1, 1),
      beta: clamp(beta, -3, 3),
      downsideBeta: clamp(downVariance > 0 ? downCovariance / downVariance : beta, -3, 3),
    };
  }

  function marketRelationships(points, candidates) {
    const output = {};
    (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
      const series = String(candidate?.series || "").toUpperCase();
      const key = series === "^KS11" ? "KOSPI" : (series === "^KQ11" ? "KOSDAQ" : "");
      if (!key) return;
      const aligned = alignedReturns(points, candidate);
      output[key] = {
        oneYear: relationshipAt(aligned, TRADING_DAYS),
        threeYear: relationshipAt(aligned, 3 * TRADING_DAYS),
        tenYear: relationshipAt(aligned, 10 * TRADING_DAYS),
      };
    });
    return output;
  }

  function semanticPriors(options) {
    const text = [
      options?.name,
      options?.companyName,
      options?.industry,
      options?.sector,
      options?.category,
      ...(Array.isArray(options?.themes) ? options.themes : []),
    ].filter(Boolean).join(" ");
    return {
      available: text.length > 0,
      holding: /지주|홀딩스|holding/i.test(text) ? 1 : 0,
      dividendDefensive: /배당|리츠|은행|보험|통신/i.test(text) ? 1 : 0,
      pharmaBiotech: /제약|바이오|의약/i.test(text) ? 1 : 0,
      exportCyclical: /반도체|자동차|조선|화학|철강|기계|전기전자|수출/i.test(text) ? 1 : 0,
    };
  }

  function profileCacheKey(options, points, relationships) {
    const semantic = semanticPriors(options);
    const marketKey = Object.entries(relationships).map(([key, value]) => (
      `${key}:${value.tenYear.samples}:${value.tenYear.correlation.toFixed(3)}`
    )).join("|");
    return [
      String(options?.series || ""),
      points[0]?.date,
      points.at(-1)?.date,
      points.length,
      points.at(-1)?.price,
      marketKey,
      semantic.holding,
      semantic.dividendDefensive,
      semantic.pharmaBiotech,
      semantic.exportCyclical,
    ].join("|");
  }

  function rememberProfile(key, value) {
    PROFILE_CACHE.set(key, value);
    while (PROFILE_CACHE.size > PROFILE_CACHE_LIMIT) PROFILE_CACHE.delete(PROFILE_CACHE.keys().next().value);
    return value;
  }

  function compactTrendProfile(profile) {
    const { monthly, residuals, ...summary } = profile;
    return summary;
  }

  function buildStructuralStockProfile(options = {}) {
    const asOfDate = normalizeDate(options.asOfDate) || "9999-99-99";
    const allPoints = pricePoints(options.dates, options.prices, asOfDate);
    const structuralPoints = previousMonthPoints(allPoints);
    if (structuralPoints.length < TRADING_DAYS) return null;
    const relationships = marketRelationships(structuralPoints, options.marketCandidates);
    const key = profileCacheKey(options, structuralPoints, relationships);
    if (PROFILE_CACHE.has(key)) return PROFILE_CACHE.get(key);
    const longTrend = trendProfile(structuralPoints);
    const recentTrend = trendProfile(structuralPoints.slice(-RECENT_HISTORY_DAYS));
    const cycle = cycleProfile(longTrend);
    const runs = buildRuns(longTrend.monthly);
    const drawdown = drawdownProfile(longTrend.monthly, runs);
    const primaryMarket = /\.KQ$/i.test(String(options.series || "")) ? "KOSDAQ" : "KOSPI";
    const primaryRelationship = relationships[primaryMarket]?.threeYear
      || relationships[primaryMarket]?.oneYear
      || { correlation: 0, beta: 0, downsideBeta: 0, samples: 0 };
    const blendedVolatility = (longTrend.annualizedVolatility * 0.55) + (recentTrend.annualizedVolatility * 0.45);
    // Korean equities commonly exceed developed-market volatility thresholds.
    // Keep the scores soft and overlapping so the backtest can compare mixed archetypes.
    const lowVolatility = clamp((0.5 - blendedVolatility) / 0.35, 0, 1);
    const highVolatility = clamp((blendedVolatility - 0.35) / 0.45, 0, 1);
    const trendUp = clamp((longTrend.upScore * 0.55) + (recentTrend.upScore * 0.45), 0, 1);
    const trendDown = clamp((longTrend.downScore * 0.55) + (recentTrend.downScore * 0.45), 0, 1);
    const range = clamp((longTrend.rangeScore * 0.65) + (recentTrend.rangeScore * 0.35), 0, 1);
    const indexIndependent = clamp(1 - Math.abs(primaryRelationship.correlation), 0, 1);
    const defensive = clamp(
      (lowVolatility * 0.35)
        + (clamp((1 - primaryRelationship.downsideBeta) / 1.5, 0, 1) * 0.4)
        + (indexIndependent * 0.25),
      0,
      1,
    );
    const persistentDecline = clamp(
      (longTrend.downScore * 0.35)
        + (recentTrend.downScore * 0.4)
        + (drawdown.unconfirmedPressure * 0.25),
      0,
      1,
    );
    const semantic = semanticPriors(options);
    const scores = {
      trendUp,
      trendDown,
      range,
      cyclical: cycle.confidence,
      lowVolatility,
      highVolatility,
      defensive,
      indexIndependent,
      persistentDecline,
    };
    const dominant = Object.entries(scores)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([name, score]) => ({ name, score }));
    return rememberProfile(key, {
      version: PROFILE_VERSION,
      asOfDate: structuralPoints.at(-1).date,
      historyYears: historyYears(structuralPoints),
      recentYears: recentTrend.years,
      longTerm: compactTrendProfile(longTrend),
      recent: compactTrendProfile(recentTrend),
      cycle,
      runs,
      drawdown,
      relationships,
      primaryMarket,
      primaryRelationship,
      semantic,
      scores,
      dominant,
      quality: clamp(
        (Math.min(1, historyYears(structuralPoints) / 10) * 0.65)
          + (Math.min(1, primaryRelationship.samples / (3 * TRADING_DAYS)) * 0.35),
        0,
        1,
      ),
    });
  }

  function softmax(scores) {
    const entries = Object.entries(scores);
    const maximum = Math.max(...entries.map(([, value]) => value));
    const weighted = entries.map(([key, value]) => [key, Math.exp((value - maximum) / 1.25)]);
    const total = weighted.reduce((sum, [, value]) => sum + value, 0);
    return Object.fromEntries(weighted.map(([key, value]) => [key, value / total]));
  }

  function buildMarketRegimeProbabilities(marketRegime = {}) {
    const support = Math.max(0, finite(marketRegime.support) || 0);
    const risk = Math.max(0, finite(marketRegime.risk) || 0);
    const range = Math.max(0, finite(marketRegime.range) || 0);
    const crisis = clamp((finite(marketRegime.crisisScore) || 0) / 100, 0, 1);
    const phase = String(marketRegime.leadingPhase?.phase || "neutral");
    const leadingDelta = finite(marketRegime.leadingPhase?.recentDelta) || 0;
    const difference = support - risk;
    const adrDepressionExit = Number.isFinite(finite(marketRegime.adrRecentLow))
      && finite(marketRegime.adrRecentLow) <= 75
      && finite(marketRegime.adrLatest) > 75;
    const slowingPeak = phase === "peak"
      && (leadingDelta < -0.05 || risk >= Math.max(0.2, support * 0.75));
    const balanced = Math.abs(difference) < 0.2;
    const scores = {
      recovery: 0.2 + (phase === "recovery" ? 0.85 : 0) + (adrDepressionExit ? 0.9 : 0)
        + (Math.max(0, difference) * 0.3)
        + (phase === "slowdown" && difference > 0 ? 0.35 : 0),
      expansion: 0.25 + (phase === "expansion" ? 0.65 : 0) + (support * 0.36) - (crisis * 0.2),
      lateCycle: 0.2 + (phase === "peak" ? 0.55 : 0) + (range * 0.25)
        + (!slowingPeak && phase === "peak" ? 0.2 : 0),
      slowdown: 0.2 + (phase === "slowdown" ? 0.8 : 0) + (slowingPeak ? 0.8 : 0)
        + (risk * 0.34),
      stress: 0.1 + (crisis * 1.15) + (Math.max(0, -difference) * 0.5),
      range: 0.25 + (range * 0.65) + (balanced ? 0.4 : 0)
        + (phase === "peak" && balanced ? 0.2 : 0),
    };
    const probabilities = softmax(scores);
    const ordered = Object.entries(probabilities).sort((left, right) => right[1] - left[1]);
    const entropy = -Object.values(probabilities)
      .reduce((sum, probability) => sum + (probability > 0 ? probability * Math.log(probability) : 0), 0)
      / Math.log(Object.keys(probabilities).length);
    return {
      version: PROFILE_VERSION,
      probabilities,
      dominant: ordered[0][0],
      dominantProbability: ordered[0][1],
      confidence: clamp(1 - entropy, 0, 1),
      entropy: clamp(entropy, 0, 1),
      scores,
    };
  }

  function currentState(options = {}) {
    const asOfDate = normalizeDate(options.asOfDate) || "9999-99-99";
    const points = pricePoints(options.dates, options.prices, asOfDate);
    const monthly = monthlyPoints(points);
    const runs = buildRuns(monthly);
    const drawdown = drawdownProfile(monthly, runs);
    const latest = points.at(-1)?.price || 0;
    const returnAt = (days) => points.length > days
      ? Math.log(latest / points.at(-(days + 1)).price)
      : 0;
    return {
      asOfDate: points.at(-1)?.date || "",
      return20: returnAt(20),
      return63: returnAt(63),
      return126: returnAt(126),
      runState: runs.state,
      runDurationMonths: runs.durationMonths,
      drawdown,
    };
  }

  function buildForecastContextProfile(options = {}) {
    const structural = options.structuralProfile || buildStructuralStockProfile(options);
    const market = buildMarketRegimeProbabilities(options.marketRegime);
    return {
      version: PROFILE_VERSION,
      asOfDate: normalizeDate(options.asOfDate),
      structural,
      state: currentState(options),
      market,
      diagnosticOnly: true,
    };
  }

  function contextProfileAuditFeatures(profile) {
    const structural = profile?.structural;
    const state = profile?.state;
    const market = profile?.market;
    if (!structural || !market) return {};
    const relationship = (name, window) => structural.relationships?.[name]?.[window] || {};
    return {
      context_profile_version: 1,
      profile_history_years: structural.historyYears,
      profile_quality: structural.quality,
      profile_long_volatility: structural.longTerm.annualizedVolatility,
      profile_recent_volatility: structural.recent.annualizedVolatility,
      profile_trend_up_score: structural.scores.trendUp,
      profile_trend_down_score: structural.scores.trendDown,
      profile_range_score: structural.scores.range,
      profile_cycle_score: structural.scores.cyclical,
      profile_cycle_period_months: structural.cycle.periodMonths,
      profile_low_volatility_score: structural.scores.lowVolatility,
      profile_high_volatility_score: structural.scores.highVolatility,
      profile_defensive_score: structural.scores.defensive,
      profile_index_independent_score: structural.scores.indexIndependent,
      profile_persistent_decline_score: structural.scores.persistentDecline,
      profile_holding_prior: structural.semantic.holding,
      profile_dividend_defensive_prior: structural.semantic.dividendDefensive,
      profile_pharma_biotech_prior: structural.semantic.pharmaBiotech,
      profile_export_cyclical_prior: structural.semantic.exportCyclical,
      profile_current_drawdown: state.drawdown.current,
      profile_current_drawdown_months: state.drawdown.durationMonths,
      profile_reversal_readiness: state.drawdown.reversalReadiness,
      profile_reversal_unconfirmed_pressure: state.drawdown.unconfirmedPressure,
      profile_current_run_state: state.runState,
      profile_current_run_months: state.runDurationMonths,
      profile_return_20d: state.return20,
      profile_return_63d: state.return63,
      profile_return_126d: state.return126,
      profile_kospi_correlation_1y: relationship("KOSPI", "oneYear").correlation,
      profile_kospi_beta_3y: relationship("KOSPI", "threeYear").beta,
      profile_kospi_downside_beta_3y: relationship("KOSPI", "threeYear").downsideBeta,
      profile_kosdaq_correlation_1y: relationship("KOSDAQ", "oneYear").correlation,
      profile_kosdaq_beta_3y: relationship("KOSDAQ", "threeYear").beta,
      profile_kosdaq_downside_beta_3y: relationship("KOSDAQ", "threeYear").downsideBeta,
      regime_probability_recovery: market.probabilities.recovery,
      regime_probability_expansion: market.probabilities.expansion,
      regime_probability_late_cycle: market.probabilities.lateCycle,
      regime_probability_slowdown: market.probabilities.slowdown,
      regime_probability_stress: market.probabilities.stress,
      regime_probability_range: market.probabilities.range,
      regime_probability_confidence: market.confidence,
      regime_probability_entropy: market.entropy,
    };
  }

  globalScope.ThinkStockAiContextProfile = Object.freeze({
    MAX_HISTORY_DAYS,
    PROFILE_VERSION,
    buildForecastContextProfile,
    buildMarketRegimeProbabilities,
    buildStructuralStockProfile,
    contextProfileAuditFeatures,
  });
}(typeof self !== "undefined" ? self : globalThis));
