(function initThinkStockAiForecast(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_HORIZON = 126;
  const FORECAST_SERIES_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const BACKTEST_HORIZONS = [20, 63, 126];
  const BACKTEST_HORIZON_WEIGHTS = [0.2, 0.3, 0.5];
  const BASE_STRATEGY_CANDIDATES = [
    { patternWeight: 0.52, trendMultiplier: 1, baseline: true },
    ...[0.35, 0.55, 0.75].flatMap((patternWeight) => (
      [-0.4, 0.3, 0.8, 1.25].map((trendMultiplier) => ({ patternWeight, trendMultiplier }))
    )),
  ];
  const CYCLE_STRATEGY_CANDIDATES = BASE_STRATEGY_CANDIDATES.flatMap((candidate) => (
    [0, 0.12, 0.22].map((cycleWeight) => ({
      ...candidate,
      cycleWeight,
      baseline: candidate.baseline === true && cycleWeight === 0,
    }))
  ));
  const STRATEGY_CANDIDATES = CYCLE_STRATEGY_CANDIDATES.flatMap((candidate) => (
    [0, 0.18, 0.32].map((marketWeight) => ({
      ...candidate,
      marketWeight,
      baseline: candidate.baseline === true && marketWeight === 0,
    }))
  ));
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

  function numericTrendSignal(source, lookback = 252) {
    const values = source.filter(Number.isFinite).slice(-lookback);
    if (values.length < 64) return 0;
    const changes = values.slice(1).map((value, index) => value - values[index]);
    const changeDeviation = winsorizedDeviation(changes) || 0.001;
    const shortTrend = (values.at(-1) - values.at(-22)) / (changeDeviation * Math.sqrt(21));
    const mediumTrend = (values.at(-1) - values.at(-64)) / (changeDeviation * Math.sqrt(63));
    return clamp(((shortTrend * 0.6) + (mediumTrend * 0.4)) / 2.5, -1, 1);
  }

  function latestSeriesTrendSignal(rows, key, lookback = 252) {
    return numericTrendSignal((Array.isArray(rows) ? rows : [])
      .map((row) => toNumber(row?.[key]))
      .filter(Number.isFinite), lookback);
  }

  function adrRegimeSignal(values) {
    const finite = values.filter(Number.isFinite);
    if (finite.length < 64) return 0;
    const level = clamp((100 - finite.at(-1)) / 70, -1, 1);
    const trend = numericTrendSignal(finite);
    return clamp((level * 0.45) + (trend * 0.55), -1, 1);
  }

  function latestLevelSignal(values, lookback = 252) {
    const finite = values.filter(Number.isFinite).slice(-lookback);
    if (finite.length < 12) return null;
    const deviation = winsorizedDeviation(finite) || 0;
    return deviation > 0 ? clamp((finite.at(-1) - mean(finite)) / (deviation * 2.5), -1, 1) : 0;
  }

  function creditRegimeSignal(values) {
    const finite = values.filter(Number.isFinite);
    if (finite.length < 64) return null;
    const trend = numericTrendSignal(finite);
    const excess = latestLevelSignal(finite) || 0;
    return clamp((trend * 0.45) - (excess * 0.55), -1, 1);
  }

  function fearGreedRegimeSignal(values) {
    const finite = values.filter(Number.isFinite);
    if (!finite.length) return null;
    const level = clamp((50 - finite.at(-1)) / 50, -1, 1);
    const recovery = finite.length >= 64 ? numericTrendSignal(finite) : 0;
    return clamp((level * 0.65) + (recovery * 0.35), -1, 1);
  }

  function marketEnvironmentSignal(environment = {}) {
    const components = [
      [environment.leadingCycle?.length >= 64
        ? numericTrendSignal(environment.leadingCycle)
        : null, 0.22],
      [environment.adr?.length >= 64 ? adrRegimeSignal(environment.adr) : null, 0.2],
      [environment.customerDeposit?.length >= 64
        ? numericTrendSignal(environment.customerDeposit)
        : null, 0.16],
      [creditRegimeSignal(environment.credit || []), 0.14],
      [fearGreedRegimeSignal(environment.fearGreed || []), 0.14],
      [latestLevelSignal(environment.newsSentiment || []), 0.14],
    ].filter(([value]) => value !== null && Number.isFinite(value));
    if (!components.length) return { combined: 0, coverage: 0 };
    const availableWeight = components.reduce((sum, item) => sum + item[1], 0);
    return {
      combined: clamp(
        components.reduce((sum, item) => sum + (item[0] * item[1]), 0) / availableWeight,
        -1,
        1,
      ),
      coverage: clamp(availableWeight, 0, 1),
    };
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

  function relativeChangeSignal(current, previous, scale) {
    const next = toNumber(current);
    const prior = toNumber(previous);
    if (next === null || prior === null) return null;
    const base = Math.max(Math.abs(prior), Math.abs(next) * 0.15, 1);
    return clamp(((next - prior) / base) / scale, -1, 1);
  }

  function financialSeriesSignal(records) {
    const actual = (Array.isArray(records) ? records : [])
      .filter((record) => record?.estimate !== true)
      .sort((left, right) => String(left.period).localeCompare(String(right.period)));
    if (actual.length < 2) return null;
    const previous = actual.at(-2);
    const current = actual.at(-1);
    const revenue = relativeChangeSignal(current.revenue, previous.revenue, 0.25);
    const operatingProfit = relativeChangeSignal(
      current.operatingProfit,
      previous.operatingProfit,
      0.6,
    );
    const currentRevenue = toNumber(current.revenue);
    const previousRevenue = toNumber(previous.revenue);
    const currentProfit = toNumber(current.operatingProfit);
    const previousProfit = toNumber(previous.operatingProfit);
    const margin = currentRevenue && previousRevenue && currentProfit !== null && previousProfit !== null
      ? clamp((((currentProfit / currentRevenue) - (previousProfit / previousRevenue)) / 0.08), -1, 1)
      : null;
    const components = [
      [revenue, 0.35],
      [operatingProfit, 0.4],
      [margin, 0.25],
    ].filter(([value]) => value !== null);
    if (!components.length) return null;
    const weight = components.reduce((sum, item) => sum + item[1], 0);
    return components.reduce((sum, item) => sum + (item[0] * item[1]), 0) / weight;
  }

  function estimateSignal(records) {
    const source = (Array.isArray(records) ? records : [])
      .filter((record) => record?.frequency === "annual")
      .sort((left, right) => String(left.period).localeCompare(String(right.period)));
    const estimate = source.filter((record) => record?.estimate === true).at(-1);
    const actual = source.filter((record) => record?.estimate !== true).at(-1);
    if (!estimate || !actual) return null;
    const revenue = relativeChangeSignal(estimate.revenue, actual.revenue, 0.3);
    const operatingProfit = relativeChangeSignal(estimate.operatingProfit, actual.operatingProfit, 0.7);
    const values = [revenue, operatingProfit].filter((value) => value !== null);
    return values.length ? mean(values) : null;
  }

  function earningsSurpriseSignal(records) {
    const values = (Array.isArray(records) ? records : [])
      .filter((record) => record?.estimate !== true)
      .sort((left, right) => String(left.period).localeCompare(String(right.period)))
      .slice(-2)
      .flatMap((record) => [record?.operatingProfitSurprise, record?.netIncomeSurprise])
      .map(toNumber)
      .filter((value) => value !== null)
      .map((value) => clamp(value / 30, -1, 1));
    return values.length ? mean(values) : null;
  }

  function fundamentalsSignal(financials) {
    const source = Array.isArray(financials) ? financials : [];
    const annual = financialSeriesSignal(source.filter((record) => record?.frequency === "annual"));
    const quarter = financialSeriesSignal(source.filter((record) => record?.frequency === "quarter"));
    const estimate = estimateSignal(source);
    const surprise = earningsSurpriseSignal(source);
    const components = [
      [annual, 0.35],
      [quarter, 0.35],
      [estimate, 0.15],
      [surprise, 0.15],
    ].filter(([value]) => value !== null);
    if (!components.length) return { signal: 0, confidence: 0 };
    const availableWeight = components.reduce((sum, item) => sum + item[1], 0);
    const signal = components.reduce((sum, item) => sum + (item[0] * item[1]), 0) / availableWeight;
    return {
      signal: clamp(signal * Math.min(1, availableWeight / 0.85), -1, 1),
      confidence: clamp(availableWeight / 0.85, 0, 1),
    };
  }

  function buildContextSignal(options, ticker, lastDate, currentPrice = null) {
    const macroRows = options.macroRows || [];
    const auxiliaryRows = options.auxiliaryRows || [];
    const news = latestSeriesSignal(macroRows, "news_sentiment");
    const leadingCycle = latestSeriesTrendSignal(macroRows, "leading_cycle");
    const fearGreedValue = latestValue(auxiliaryRows, "fear_greed");
    const fearGreed = fearGreedValue === null ? 0 : clamp((50 - fearGreedValue) / 50, -1, 1);
    const adrKey = String(ticker).endsWith(".KQ") || ticker === "^KQ11" ? "adr_kosdaq" : "adr_kospi";
    const adrValues = auxiliaryRows.map((row) => toNumber(row?.[adrKey])).filter(Number.isFinite);
    const adrValue = adrValues.at(-1) ?? null;
    const adrLevel = adrValue === null ? 0 : clamp((100 - adrValue) / 70, -1, 1);
    const adrTrend = numericTrendSignal(adrValues);
    const adr = adrRegimeSignal(adrValues);
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
    const fundamentals = fundamentalsSignal(options.financials);
    return {
      news,
      leadingCycle,
      fearGreed,
      adr,
      adrLevel,
      adrTrend,
      disclosure,
      consensus: consensusSignal,
      fundamentals: fundamentals.signal,
      fundamentalsConfidence: fundamentals.confidence,
      combined: clamp(
        (disclosure * 0.18)
        + (consensusSignal * 0.5)
        + (fundamentals.signal * 0.32),
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
    const recentTrend = clamp(mean(recent) / recentVolatility, -1, 1);
    const recentDownside = mean(recent.filter((value) => value < 0)) / recentVolatility;
    const candidates = [];
    const latestCandidateEnd = returns.length - horizon - 21;
    for (let end = windowSize; end <= latestCandidateEnd; end += 3) {
      const candidate = returns.slice(end - windowSize, end);
      const candidateShape = normalizedShape(candidate);
      const candidateVolatility = standardDeviation(candidate) || 0.0001;
      let shapeError = 0;
      for (let index = 0; index < windowSize; index += 1) {
        shapeError += (recentShape[index] - candidateShape[index]) ** 2;
      }
      const volatilityError = Math.abs(Math.log(
        candidateVolatility / recentVolatility,
      ));
      const trendError = Math.abs(
        recentTrend - clamp(mean(candidate) / candidateVolatility, -1, 1),
      );
      const candidateDownside = mean(candidate.filter((value) => value < 0)) / candidateVolatility;
      const downsideError = Math.abs(recentDownside - candidateDownside);
      const ageRatio = latestCandidateEnd > windowSize
        ? (latestCandidateEnd - end) / (latestCandidateEnd - windowSize)
        : 0;
      candidates.push({
        end,
        score: ((shapeError / windowSize) * 0.62)
          + (volatilityError * 0.18)
          + (trendError * 0.14)
          + (downsideError * 0.04)
          + (ageRatio * 0.02),
        future: returns.slice(end, end + horizon),
      });
    }
    const separation = Math.max(21, Math.floor(windowSize / 2));
    const matches = [];
    candidates.sort((left, right) => left.score - right.score).some((candidate) => {
      if (matches.every((match) => Math.abs(match.end - candidate.end) >= separation)) {
        matches.push(candidate);
      }
      return matches.length >= 12;
    });
    return matches;
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

  function pearsonCorrelation(left, right) {
    if (left.length !== right.length || left.length < 12) return null;
    const leftMean = mean(left);
    const rightMean = mean(right);
    let covariance = 0;
    let leftVariance = 0;
    let rightVariance = 0;
    for (let index = 0; index < left.length; index += 1) {
      const leftDelta = left[index] - leftMean;
      const rightDelta = right[index] - rightMean;
      covariance += leftDelta * rightDelta;
      leftVariance += leftDelta ** 2;
      rightVariance += rightDelta ** 2;
    }
    const denominator = Math.sqrt(leftVariance * rightVariance);
    return denominator > 0 ? covariance / denominator : null;
  }

  function regressionStats(stockReturns, marketReturns, predicate = null, lookback = 504) {
    const stock = [];
    const market = [];
    const start = Math.max(0, Math.min(stockReturns.length, marketReturns.length) - lookback);
    const windowSize = 20;
    for (let index = start + windowSize - 1;
      index < Math.min(stockReturns.length, marketReturns.length);
      index += 5) {
      let stockReturn = 0;
      let marketReturn = 0;
      let valid = true;
      for (let offset = 0; offset < windowSize; offset += 1) {
        const stockValue = toNumber(stockReturns[index - offset]);
        const marketValue = toNumber(marketReturns[index - offset]);
        if (stockValue === null || marketValue === null) {
          valid = false;
          break;
        }
        stockReturn += stockValue;
        marketReturn += marketValue;
      }
      if (!valid || (predicate && !predicate(marketReturn))) continue;
      stock.push(stockReturn);
      market.push(marketReturn);
    }
    if (stock.length < 12) return null;
    const marketMean = mean(market);
    const stockMean = mean(stock);
    let covariance = 0;
    let variance = 0;
    for (let index = 0; index < stock.length; index += 1) {
      covariance += (market[index] - marketMean) * (stock[index] - stockMean);
      variance += (market[index] - marketMean) ** 2;
    }
    return {
      beta: variance > 0 ? clamp(covariance / variance, -2.5, 2.5) : 0,
      correlation: pearsonCorrelation(stock, market) || 0,
      samples: stock.length,
    };
  }

  function stableConditionalRelationship(stockReturns, marketReturns, predicate) {
    const broad = regressionStats(stockReturns, marketReturns, predicate, 504);
    const recent = regressionStats(stockReturns, marketReturns, predicate, 252);
    if (!broad) {
      return { beta: 0, correlation: 0, samples: 0, strength: 0 };
    }
    if (!recent) {
      return {
        beta: broad.beta,
        correlation: broad.correlation,
        samples: broad.samples,
        strength: clamp(Math.abs(broad.correlation) * clamp(broad.samples / 24, 0, 1) * 0.5, 0, 1),
      };
    }
    const signConsistency = Math.sign(broad.beta) === Math.sign(recent.beta) ? 1 : 0.2;
    const correlation = Math.min(Math.abs(broad.correlation), Math.abs(recent.correlation));
    const sampleConfidence = clamp(recent.samples / 24, 0, 1);
    return {
      beta: clamp((broad.beta * 0.4) + (recent.beta * 0.6), -2.5, 2.5),
      correlation: (broad.correlation * 0.4) + (recent.correlation * 0.6),
      samples: recent.samples,
      strength: clamp(correlation * sampleConfidence * signConsistency, 0, 1),
    };
  }

  function marketRelationship(stockReturns, marketReturns) {
    if (!Array.isArray(marketReturns) || marketReturns.length < 252) return null;
    const downside = stableConditionalRelationship(
      stockReturns,
      marketReturns,
      (value) => value < 0,
    );
    const upside = stableConditionalRelationship(
      stockReturns,
      marketReturns,
      (value) => value >= 0,
    );
    const finiteMarketReturns = marketReturns.filter(Number.isFinite);
    const marketVolatility = clamp(
      winsorizedDeviation(finiteMarketReturns.slice(-63)) || 0.01,
      0.003,
      0.08,
    );
    const marketMomentum = momentumReturn(finiteMarketReturns, marketVolatility);
    const active = marketMomentum < 0 ? downside : upside;
    return {
      beta: active.beta,
      correlation: active.correlation,
      downsideBeta: downside.beta,
      downsideStrength: downside.strength,
      upsideBeta: upside.beta,
      upsideStrength: upside.strength,
      inverseInDownturn: downside.beta < -0.1 && downside.strength >= 0.1,
      marketMomentum,
      strength: active.strength,
    };
  }

  function sliceEnvironment(environment, end) {
    return Object.fromEntries(Object.entries(environment || {}).map(([key, values]) => (
      [key, Array.isArray(values) ? values.slice(0, end) : []]
    )));
  }

  function buildMarketReturnPath(stockReturns, marketReturns, horizon, environment = {}) {
    const relationship = marketRelationship(stockReturns, marketReturns);
    const environmentSignal = marketEnvironmentSignal(environment);
    if (!relationship || relationship.strength <= 0) {
      return { environment: environmentSignal, relationship, path: Array(horizon).fill(0) };
    }
    const cleanMarketReturns = marketReturns.filter(Number.isFinite);
    const volatility = clamp(
      winsorizedDeviation(cleanMarketReturns.slice(-63)) || 0.01,
      0.003,
      0.08,
    );
    const stockVolatility = clamp(
      winsorizedDeviation(stockReturns.slice(-63)) || 0.01,
      0.003,
      0.08,
    );
    const windowSize = Math.min(63, Math.max(30, Math.floor(cleanMarketReturns.length / 6)));
    const matches = findPatternMatches(cleanMarketReturns, windowSize, horizon);
    const momentum = momentumReturn(cleanMarketReturns, volatility);
    const path = Array.from({ length: horizon }, (_, index) => {
      const pattern = weightedPatternReturn(matches, index);
      const trend = momentum * Math.exp(-index / 100);
      const baseMarketReturn = pattern === null ? trend : ((pattern * 0.55) + (trend * 0.45));
      const environmentBias = environmentSignal.combined
        * environmentSignal.coverage
        * volatility
        * 0.06
        * Math.exp(-index / 90);
      const marketReturn = baseMarketReturn + environmentBias;
      const beta = marketReturn < 0 ? relationship.downsideBeta : relationship.upsideBeta;
      return clamp(beta * marketReturn, -stockVolatility * 0.18, stockVolatility * 0.18);
    });
    return { environment: environmentSignal, relationship, path };
  }

  function cycleSignal(returns) {
    const shortWindow = 63;
    const longWindow = 252;
    const signal = [];
    let shortSum = 0;
    let longSum = 0;
    for (let index = 0; index < returns.length; index += 1) {
      shortSum += returns[index];
      longSum += returns[index];
      if (index >= shortWindow) shortSum -= returns[index - shortWindow];
      if (index >= longWindow) longSum -= returns[index - longWindow];
      if (index >= longWindow - 1) signal.push(shortSum - (longSum * (shortWindow / longWindow)));
    }
    return signal;
  }

  function lagCorrelation(values, lag, maxPairs = null) {
    if (lag < 1 || values.length < lag * 2) return null;
    const pairCount = Math.min(values.length - lag, maxPairs || values.length);
    const start = values.length - pairCount;
    return pearsonCorrelation(
      values.slice(start, start + pairCount),
      values.slice(start - lag, start - lag + pairCount),
    );
  }

  function detectMarketCycle(returns) {
    const signal = cycleSignal(Array.isArray(returns) ? returns : []);
    const minLag = 126;
    const maxLag = Math.min(630, Math.floor(signal.length / 2));
    if (maxLag < minLag) return null;

    let best = null;
    for (let lag = minLag; lag <= maxLag; lag += 5) {
      const correlation = lagCorrelation(signal, lag);
      const recentCorrelation = lagCorrelation(signal, lag, Math.min(signal.length - lag, 504));
      if (!Number.isFinite(correlation) || !Number.isFinite(recentCorrelation)) continue;
      const repeatCoverage = clamp(signal.length / (lag * 2.5), 0, 1);
      const score = ((correlation * 0.58) + (recentCorrelation * 0.42)) * repeatCoverage;
      if (!best || score > best.score) {
        best = { lag, correlation, recentCorrelation, repeatCoverage, score };
      }
    }
    // Searching many smooth lags can manufacture weak cycles, so only retain
    // correlations above the empirical 99% random-walk threshold.
    if (!best || best.correlation < 0.72 || best.recentCorrelation < 0.65 || best.score < 0.6) {
      return null;
    }
    return {
      tradingDays: best.lag,
      years: best.lag / 252,
      correlation: best.correlation,
      recentCorrelation: best.recentCorrelation,
      strength: clamp((best.score - 0.55) / 0.35, 0, 1),
    };
  }

  function buildCycleReturnPath(returns, cycle, horizon) {
    if (!cycle || cycle.tradingDays < horizon || returns.length < cycle.tradingDays + horizon) {
      return Array(horizon).fill(0);
    }
    const start = returns.length - cycle.tradingDays;
    const source = returns.slice(start, start + horizon);
    const center = mean(source);
    const volatility = clamp(winsorizedDeviation(returns.slice(-63)) || 0.01, 0.003, 0.08);
    return Array.from({ length: horizon }, (_, index) => clamp(
      (source[index] || 0) - center,
      -volatility * 2.5,
      volatility * 2.5,
    ));
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

  function calibrateForecastStrategy(
    returns,
    horizon = DEFAULT_HORIZON,
    marketReturns = [],
    environment = {},
  ) {
    const fallback = {
      patternWeight: 0.52,
      trendMultiplier: 1,
      cycleWeight: 0,
      marketWeight: 0,
      volatilityRatio: 0.75,
      samples: 0,
      trainingSamples: 0,
      validationSamples: 0,
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
    if (anchors.length < 8) return fallback;

    const volatilityRatios = [];
    const samples = [];
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
      const cycle = detectMarketCycle(history);
      const cyclePath = buildCycleReturnPath(history, cycle, horizon);
      const marketModel = buildMarketReturnPath(
        history,
        marketReturns.slice(0, anchor),
        horizon,
        sliceEnvironment(environment, anchor + 1),
      );
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
      samples.push({
        actualFuture,
        cyclePath,
        cycleStrength: cycle?.strength || 0,
        historyVolatility,
        marketPath: marketModel.path,
        marketStrength: marketModel.relationship?.strength || 0,
        patternPath,
        sampleWeight,
        trendPath,
      });
    });
    if (samples.length < 8) return fallback;

    const validationCount = Math.min(5, Math.max(3, Math.floor(samples.length / 3)));
    const candidateScores = STRATEGY_CANDIDATES.map((candidate) => ({
      ...candidate,
      trainingError: 0,
      trainingHits: 0,
      trainingTrials: 0,
      trainingWeight: 0,
      validationError: 0,
      validationHits: 0,
      validationTrials: 0,
      validationWeight: 0,
    }));
    samples.forEach((sample, sampleIndex) => {
      const group = sampleIndex < validationCount ? "validation" : "training";
      candidateScores.forEach((candidate) => {
        let weightedError = 0;
        BACKTEST_HORIZONS.forEach((endpoint, endpointIndex) => {
          const actual = sample.actualFuture.slice(0, endpoint)
            .reduce((sum, value) => sum + value, 0);
          const pattern = sample.patternPath.slice(0, endpoint)
            .reduce((sum, value) => sum + value, 0);
          const trend = sample.trendPath.slice(0, endpoint)
            .reduce((sum, value) => sum + value, 0);
          const cycleReturn = sample.cyclePath.slice(0, endpoint)
            .reduce((sum, value) => sum + value, 0);
          const marketReturn = sample.marketPath.slice(0, endpoint)
            .reduce((sum, value) => sum + value, 0);
          const basePrediction = (pattern * candidate.patternWeight)
            + (trend * candidate.trendMultiplier * (1 - candidate.patternWeight));
          const cycleBlend = clamp(candidate.cycleWeight * sample.cycleStrength, 0, 0.22);
          const cyclePrediction = (basePrediction * (1 - cycleBlend))
            + (cycleReturn * cycleBlend);
          const marketBlend = clamp(candidate.marketWeight * sample.marketStrength, 0, 0.32);
          const predicted = cyclePrediction + (marketReturn * marketBlend);
          const scale = Math.max(0.01, sample.historyVolatility * Math.sqrt(endpoint));
          const directionMiss = Math.sign(predicted) !== Math.sign(actual) ? 0.35 : 0;
          weightedError += BACKTEST_HORIZON_WEIGHTS[endpointIndex]
            * (Math.min(4, Math.abs(predicted - actual) / scale) + directionMiss);
          candidate[`${group}Hits`] += sample.sampleWeight
            * (Math.sign(predicted) === Math.sign(actual) ? 1 : 0);
          candidate[`${group}Trials`] += sample.sampleWeight;
        });
        candidate[`${group}Error`] += weightedError * sample.sampleWeight;
        candidate[`${group}Weight`] += sample.sampleWeight;
      });
    });

    const ranked = candidateScores
      .filter((candidate) => candidate.trainingWeight > 0 && candidate.validationWeight > 0)
      .map((candidate) => ({
        ...candidate,
        score: candidate.trainingError / candidate.trainingWeight,
        accuracy: candidate.validationTrials
          ? candidate.validationHits / candidate.validationTrials
          : 0,
        validationScore: candidate.validationError / candidate.validationWeight,
        productionScore: (candidate.trainingError + candidate.validationError)
          / (candidate.trainingWeight + candidate.validationWeight),
      }))
      .sort((left, right) => left.score - right.score);
    if (!ranked.length) return fallback;
    const uniqueStrategyShapes = (candidates) => {
      const seen = new Set();
      return candidates.filter((candidate) => {
        const key = `${candidate.patternWeight}|${candidate.trendMultiplier}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const trainingBestScore = ranked[0].score;
    const baseline = ranked.find((candidate) => candidate.baseline) || ranked[0];
    let validationSelected = uniqueStrategyShapes(ranked
      .filter((candidate) => candidate.score <= baseline.score + Number.EPSILON))
      .slice(0, 3);
    const bestNoCycle = ranked.find((candidate) => candidate.cycleWeight === 0) || baseline;
    const cycleValidationScore = mean(validationSelected.map((candidate) => candidate.validationScore));
    if (validationSelected.some((candidate) => candidate.cycleWeight > 0)
        && cycleValidationScore >= bestNoCycle.validationScore * 0.99) {
      validationSelected = uniqueStrategyShapes(ranked
        .filter((candidate) => candidate.cycleWeight === 0
          && candidate.score <= baseline.score + Number.EPSILON))
        .slice(0, 3);
    }
    const bestNoMarket = ranked.find((candidate) => candidate.marketWeight === 0) || baseline;
    const bestNoMarketValidation = Math.min(...ranked
      .filter((candidate) => candidate.marketWeight === 0)
      .map((candidate) => candidate.validationScore));
    if (validationSelected.some((candidate) => candidate.marketWeight > 0)
        && mean(validationSelected.map((candidate) => candidate.validationScore))
          >= Math.min(bestNoMarket.validationScore, bestNoMarketValidation) * 0.97) {
      validationSelected = uniqueStrategyShapes(ranked
        .filter((candidate) => candidate.marketWeight === 0
          && candidate.score <= baseline.score + Number.EPSILON))
        .slice(0, 3);
    }
    if (!validationSelected.length || mean(validationSelected.map((candidate) => candidate.validationScore))
        > baseline.validationScore * 1.02) {
      validationSelected = [baseline];
    }
    validationSelected = validationSelected.map((candidate) => ({
      ...candidate,
      ensembleWeight: Math.exp(-2.2 * (candidate.score - trainingBestScore)),
    }));
    const validationEnsembleWeight = validationSelected
      .reduce((sum, candidate) => sum + candidate.ensembleWeight, 0);
    const validationBlend = (key) => validationSelected.reduce((sum, candidate) => (
      sum + (candidate[key] * candidate.ensembleWeight)
    ), 0) / validationEnsembleWeight;

    const productionRanked = [...ranked]
      .sort((left, right) => left.productionScore - right.productionScore);
    const productionBestScore = productionRanked[0].productionScore;
    const productionBaseline = productionRanked.find((candidate) => candidate.baseline)
      || productionRanked[0];
    let selected = uniqueStrategyShapes(productionRanked
      .filter((candidate) => candidate.productionScore
        <= productionBaseline.productionScore + Number.EPSILON))
      .slice(0, 3);
    const productionNoCycle = productionRanked.find((candidate) => candidate.cycleWeight === 0)
      || productionBaseline;
    if (selected.some((candidate) => candidate.cycleWeight > 0)
        && mean(selected.map((candidate) => candidate.validationScore))
          >= productionNoCycle.validationScore * 0.99) {
      selected = uniqueStrategyShapes(productionRanked
        .filter((candidate) => candidate.cycleWeight === 0
          && candidate.productionScore <= productionBaseline.productionScore + Number.EPSILON))
        .slice(0, 3);
    }
    const productionNoMarket = productionRanked.find((candidate) => candidate.marketWeight === 0)
      || productionBaseline;
    const productionNoMarketValidation = Math.min(...productionRanked
      .filter((candidate) => candidate.marketWeight === 0)
      .map((candidate) => candidate.validationScore));
    if (selected.some((candidate) => candidate.marketWeight > 0)
        && mean(selected.map((candidate) => candidate.validationScore))
          >= Math.min(productionNoMarket.validationScore, productionNoMarketValidation) * 0.97) {
      selected = uniqueStrategyShapes(productionRanked
        .filter((candidate) => candidate.marketWeight === 0
          && candidate.productionScore <= productionBaseline.productionScore + Number.EPSILON))
        .slice(0, 3);
    }
    if (!selected.length) selected = [productionBaseline];
    selected = selected.map((candidate) => ({
        ...candidate,
        ensembleWeight: Math.exp(-2.2 * (candidate.productionScore - productionBestScore)),
    }));
    const ensembleWeight = selected.reduce((sum, candidate) => sum + candidate.ensembleWeight, 0);
    const blend = (key) => selected.reduce((sum, candidate) => (
      sum + (candidate[key] * candidate.ensembleWeight)
    ), 0) / ensembleWeight;
    const directionAccuracy = validationBlend("accuracy");
    const normalizedError = validationBlend("validationScore");
    const sampleConfidence = clamp(validationCount / 5, 0, 1);
    const accuracyConfidence = clamp((directionAccuracy - 0.45) / 0.25, 0, 1);
    const errorConfidence = clamp(1 - (normalizedError / 2.2), 0, 1);
    const rawConfidence = clamp(
      0.15 + (sampleConfidence * 0.2) + (accuracyConfidence * 0.2) + (errorConfidence * 0.45),
      0.2,
      0.9,
    );
    const accuracyCap = clamp(0.35 + ((directionAccuracy - 0.45) * 2), 0.35, 0.9);
    return {
      patternWeight: blend("patternWeight"),
      trendMultiplier: blend("trendMultiplier"),
      cycleWeight: blend("cycleWeight"),
      marketWeight: blend("marketWeight"),
      volatilityRatio: weightedMedian(volatilityRatios) || fallback.volatilityRatio,
      samples: validationCount,
      trainingSamples: samples.length - validationCount,
      validationSamples: validationCount,
      directionAccuracy,
      normalizedError,
      improvement: baseline.validationScore > 0
        ? clamp((baseline.validationScore - normalizedError) / baseline.validationScore, 0, 1)
        : 0,
      confidence: Math.min(rawConfidence, accuracyCap),
    };
  }

  function cachedForecastCalibration(
    ticker,
    points,
    returns,
    horizon,
    marketReturns = [],
    environment = {},
  ) {
    const lastPoint = points.at(-1);
    const lastMarketReturn = marketReturns.findLast?.(Number.isFinite) || "";
    const environmentRevision = Object.values(environment)
      .map((values) => `${values?.length || 0}:${values?.findLast?.(Number.isFinite) || ""}`)
      .join(",");
    const key = `${ticker}|${lastPoint?.date || ""}|${points.length}|${lastPoint?.price || ""}|${horizon}|${marketReturns.length}|${lastMarketReturn}|${environmentRevision}`;
    if (calibrationCache.has(key)) return calibrationCache.get(key);
    const calibration = calibrateForecastStrategy(returns, horizon, marketReturns, environment);
    calibrationCache.set(key, calibration);
    while (calibrationCache.size > 60) calibrationCache.delete(calibrationCache.keys().next().value);
    return calibration;
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

  function alignedMarketReturns(points, marketDates, marketPrices) {
    if (!Array.isArray(marketPrices)) return [];
    const marketByDate = new Map();
    for (let index = 0; index < Math.min(marketDates.length, marketPrices.length); index += 1) {
      const date = String(marketDates[index] || "").slice(0, 10);
      const price = toNumber(marketPrices[index]);
      if (date && price !== null && price > 0) marketByDate.set(date, price);
    }
    const returns = [];
    for (let index = 1; index < points.length; index += 1) {
      const previous = marketByDate.get(points[index - 1].date);
      const current = marketByDate.get(points[index].date);
      returns.push(previous > 0 && current > 0 ? Math.log(current / previous) : null);
    }
    return returns;
  }

  function selectMarketReturns(points, options, ticker, stockReturns) {
    if (ticker.startsWith("^")) return { series: ticker, returns: [...stockReturns] };
    const configured = Array.isArray(options.marketCandidates) && options.marketCandidates.length
      ? options.marketCandidates
      : [{
        series: options.marketSeries || "",
        dates: options.marketDates || options.dates,
        prices: options.marketPrices,
      }];
    const candidates = configured.map((candidate) => {
      const returns = alignedMarketReturns(
        points,
        Array.isArray(candidate?.dates) ? candidate.dates : options.dates,
        candidate?.prices,
      );
      return {
        series: String(candidate?.series || ""),
        returns,
        relationship: marketRelationship(stockReturns, returns),
      };
    }).filter((candidate) => candidate.returns.length === stockReturns.length);
    candidates.sort((left, right) => (
      (right.relationship?.strength || 0) - (left.relationship?.strength || 0)
    ));
    return candidates[0] || { series: "", returns: [] };
  }

  function alignedSeriesValues(points, rows, key) {
    const samples = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        date: String(row?.date || "").slice(0, 10),
        value: toNumber(row?.[key]),
      }))
      .filter((sample) => /^\d{4}-\d{2}-\d{2}$/.test(sample.date) && sample.value !== null)
      .sort((left, right) => left.date.localeCompare(right.date));
    const values = [];
    let cursor = 0;
    let current = null;
    points.forEach((point) => {
      while (cursor < samples.length && samples[cursor].date <= point.date) {
        current = samples[cursor].value;
        cursor += 1;
      }
      values.push(current);
    });
    return values;
  }

  function alignedMarketEnvironment(points, options, ticker) {
    const isKosdaq = ticker.endsWith(".KQ") || ticker === "^KQ11";
    return {
      leadingCycle: alignedSeriesValues(points, options.macroRows, "leading_cycle"),
      newsSentiment: alignedSeriesValues(points, options.macroRows, "news_sentiment"),
      adr: alignedSeriesValues(
        points,
        options.auxiliaryRows,
        isKosdaq ? "adr_kosdaq" : "adr_kospi",
      ),
      fearGreed: alignedSeriesValues(points, options.auxiliaryRows, "fear_greed"),
      customerDeposit: alignedSeriesValues(points, options.creditRows, "customer_deposit"),
      credit: alignedSeriesValues(
        points,
        options.creditRows,
        isKosdaq ? "kosdaq_credit" : "kospi_credit",
      ),
    };
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
    const selectedMarket = selectMarketReturns(points, options, ticker, returns);
    const marketReturns = selectedMarket.returns;
    const marketEnvironment = alignedMarketEnvironment(points, options, ticker);

    const transformPrices = Array.isArray(options.transformPrices)
      ? options.transformPrices
      : prices;
    const transformChartValues = Array.isArray(options.transformChartValues)
      ? options.transformChartValues
      : chartValues;
    const transformPoints = [];
    for (let index = 0; index < Math.min(transformPrices.length, transformChartValues.length); index += 1) {
      const price = toNumber(transformPrices[index]);
      const chart = toNumber(transformChartValues[index]);
      if (price !== null && price > 0 && chart !== null) transformPoints.push({ price, chart });
    }

    const horizon = clamp(Math.round(Number(options.horizon) || DEFAULT_HORIZON), 20, 260);
    const windowSize = Math.min(63, Math.max(30, Math.floor(returns.length / 6)));
    const matches = findPatternMatches(returns, windowSize, horizon);
    const volatility = clamp(winsorizedDeviation(returns.slice(-63)) || 0.01, 0.003, 0.08);
    const momentum = momentumReturn(returns, volatility);
    const technical = rsiSignal(returns);
    const macd = clamp(toNumber(options.macdSignal) || 0, -1, 1);
    const lastPoint = points.at(-1);
    const calibration = cachedForecastCalibration(
      ticker,
      points,
      returns,
      horizon,
      marketReturns,
      marketEnvironment,
    );
    const signals = buildContextSignal(options, ticker, lastPoint.date, lastPoint.price);
    const historyConfidence = clamp((points.length - 60) / 192, 0.2, 1);
    const patternPath = Array.from({ length: horizon }, (_, index) => (
      weightedPatternReturn(matches, index)
    ));
    const cycle = detectMarketCycle(returns);
    const cyclePath = buildCycleReturnPath(returns, cycle, horizon);
    const marketModel = buildMarketReturnPath(
      returns,
      marketReturns,
      horizon,
      marketEnvironment,
    );
    const calibratedConfidence = clamp(Number(calibration.confidence) || 0.2, 0.2, 0.9);
    const effectivePatternWeight = clamp(
      calibration.patternWeight * (0.55 + (calibratedConfidence * 0.45)),
      0.25,
      0.75,
    );
    const effectiveCycleWeight = clamp(
      (Number(calibration.cycleWeight) || 0) * (Number(cycle?.strength) || 0),
      0,
      0.22,
    );
    const effectiveMarketWeight = clamp(
      Math.max(
        Number(calibration.marketWeight) || 0,
        Number(marketModel.environment?.coverage) >= 0.5 ? 0.08 : 0,
      )
        * (Number(marketModel.relationship?.strength) || 0),
      0,
      0.32,
    );
    const candidateReturns = [];
    for (let index = 0; index < horizon; index += 1) {
      const pattern = patternPath[index];
      const trend = momentum * Math.exp(-index / 100);
      const technicalBias = (
        (technical * 0.8 * Math.exp(-index / 35))
        + (macd * 0.2 * Math.exp(-index / 12))
      ) * volatility * 0.025 * historyConfidence;
      const contextBias = signals.combined * volatility * 0.018 * historyConfidence * Math.exp(-index / 150);
      const calibratedTrend = trend * calibration.trendMultiplier;
      const baseDirectionalTarget = pattern === null
        ? calibratedTrend
        : ((pattern * effectivePatternWeight)
          + (calibratedTrend * (1 - effectivePatternWeight)));
      const directionalTarget = ((baseDirectionalTarget * (1 - effectiveCycleWeight))
        + ((cyclePath[index] || 0) * effectiveCycleWeight))
        + ((marketModel.path[index] || 0) * effectiveMarketWeight)
        + technicalBias
        + contextBias;
      candidateReturns.push(directionalTarget);
    }

    const volatilityCeiling = ticker.startsWith("^") ? 0.025 : 0.04;
    const projectedVolatility = clamp(
      volatility * calibration.volatilityRatio * 0.8,
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

    const transform = fitChartTransform(transformPoints);
    const lastChart = toNumber(transformPoints.at(-1)?.chart);
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
      signals: { ...signals, technical, macd },
      patternMatches: matches.length,
      historyDays: points.length,
      horizon,
      projectedVolatility,
      cycle: cycle ? { ...cycle, weight: effectiveCycleWeight } : null,
      marketRelationship: marketModel.relationship
        ? {
          ...marketModel.relationship,
          series: selectedMarket.series,
          weight: effectiveMarketWeight,
        }
        : null,
      marketEnvironment: marketModel.environment,
      backtest: {
        ...calibration,
        effectivePatternWeight,
        effectiveCycleWeight,
        effectiveMarketWeight,
      },
    };
  }

  globalScope.ThinkStockAiForecast = Object.freeze({
    buildContextSignal,
    buildForecast,
    calibrateForecastStrategy,
    detectMarketCycle,
    marketEnvironmentSignal,
    marketRelationship,
    isForecastSeries,
    nextBusinessDates,
  });
}(typeof self !== "undefined" ? self : globalThis));
