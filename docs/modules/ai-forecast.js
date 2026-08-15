(function initThinkStockAiForecast(globalScope) {
  "use strict";

  const TRADING_DAYS = 252;
  const MAX_STOCK_HISTORY = TRADING_DAYS * 5;
  const MAX_INDEX_HISTORY = TRADING_DAYS * 25;
  const MIN_HISTORY = TRADING_DAYS * 3;
  const FORECAST_HORIZONS = Object.freeze([20, 63, 126]);
  const FORECAST_AUDIT_HORIZONS = Object.freeze([5, 10, 20, 63, 126]);
  const FORECAST_PATH_VERSION = "path-v20";
  const STOCK_HORIZON_CALIBRATION = Object.freeze({
    20: Object.freeze({ localScale: 0.33, regimeScale: 1, rangeScale: 1 }),
    63: Object.freeze({ localScale: 0.125, regimeScale: 0, rangeScale: 0.3 }),
    126: Object.freeze({ localScale: 0.25, regimeScale: 0, rangeScale: 1 }),
  });
  const SAMPLE_STEP = 5;
  const FORECAST_CACHE = new Map();
  const scenarioPathEngine = globalScope.ThinkStockAiScenarioPaths || null;
  const newsEvidenceEngine = globalScope.ThinkStockAiNewsEvidence || null;
  const contextProfileEngine = globalScope.ThinkStockAiContextProfile || null;

  const forecastMath = globalScope.ThinkStockAiForecastMath;
  if (!forecastMath) throw new Error("AI forecast math module failed to load");
  const {
    EPSILON,
    clamp,
    compactAuditMap,
    finite,
    mean,
    nextBusinessDates,
    pearson,
    quantile,
    standardDeviation,
    variance,
  } = forecastMath;

  function isForecastSeries(series) {
    const normalized = String(series || "").toUpperCase();
    return /(?:\.KS|\.KQ)$/.test(normalized) || normalized === "^KS11" || normalized === "^KQ11";
  }

  function isMarketIndexSeries(series) {
    const normalized = String(series || "").toUpperCase();
    return normalized === "^KS11" || normalized === "^KQ11";
  }

  function cleanPriceHistory(options) {
    const dates = Array.isArray(options?.dates) ? options.dates : [];
    const prices = Array.isArray(options?.prices) ? options.prices : [];
    const points = [];
    for (let index = 0; index < Math.min(dates.length, prices.length); index += 1) {
      const date = String(dates[index] || "").slice(0, 10);
      const price = finite(prices[index]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && price > 0) points.push({ date, price });
    }
    points.sort((left, right) => left.date.localeCompare(right.date));
    const deduplicated = [];
    for (const point of points) {
      if (deduplicated.at(-1)?.date === point.date) deduplicated[deduplicated.length - 1] = point;
      else deduplicated.push(point);
    }
    const historyLimit = isMarketIndexSeries(options?.series)
      ? MAX_INDEX_HISTORY
      : MAX_STOCK_HISTORY;
    return deduplicated.slice(-historyLimit);
  }

  function getForecastAvailability(options = {}) {
    const points = cleanPriceHistory(options);
    if (!isForecastSeries(options.series)) {
      return {
        available: false,
        reasonCode: "unsupported-series",
        historyDays: points.length,
        minimumHistoryDays: MIN_HISTORY,
        minimumHistoryYears: MIN_HISTORY / TRADING_DAYS,
      };
    }
    if (points.length < MIN_HISTORY) {
      return {
        available: false,
        reasonCode: "insufficient-history",
        historyDays: points.length,
        minimumHistoryDays: MIN_HISTORY,
        minimumHistoryYears: MIN_HISTORY / TRADING_DAYS,
      };
    }
    return {
      available: true,
      reasonCode: "",
      historyDays: points.length,
      minimumHistoryDays: MIN_HISTORY,
      minimumHistoryYears: MIN_HISTORY / TRADING_DAYS,
    };
  }

  function logarithmicReturns(prices) {
    const output = [];
    for (let index = 1; index < prices.length; index += 1) {
      output.push(Math.log(prices[index] / prices[index - 1]));
    }
    return output;
  }

  function sliceReturns(returns, priceIndex, window) {
    return returns.slice(Math.max(0, priceIndex - window), priceIndex);
  }

  function windowReturn(prices, priceIndex, window) {
    const start = Math.max(0, priceIndex - window);
    return Math.log(prices[priceIndex] / prices[start]);
  }

  function downsideDeviation(values) {
    const negative = values.filter((value) => value < 0);
    return negative.length ? Math.sqrt(mean(negative.map((value) => value ** 2))) : 0;
  }

  function maximumDrawdown(prices, endIndex, window) {
    const start = Math.max(0, endIndex - window + 1);
    let peak = prices[start];
    let drawdown = 0;
    for (let index = start; index <= endIndex; index += 1) {
      peak = Math.max(peak, prices[index]);
      drawdown = Math.min(drawdown, (prices[index] / peak) - 1);
    }
    return drawdown;
  }

  function relativeStrengthIndex(returns, priceIndex, window = 14) {
    const recent = sliceReturns(returns, priceIndex, window);
    let gains = 0;
    let losses = 0;
    recent.forEach((value) => {
      if (value >= 0) gains += value;
      else losses -= value;
    });
    if (gains + losses < EPSILON) return 0;
    return ((gains / (gains + losses)) - 0.5) * 2;
  }

  function exponentialMovingAverage(values, period) {
    const output = [];
    const alpha = 2 / (period + 1);
    let current = values[0] || 0;
    values.forEach((value, index) => {
      current = index === 0 ? value : ((alpha * value) + ((1 - alpha) * current));
      output.push(current);
    });
    return output;
  }

  function macdOscillator(prices) {
    const logs = prices.map((price) => Math.log(price));
    const fast = exponentialMovingAverage(logs, 12);
    const slow = exponentialMovingAverage(logs, 26);
    const macd = logs.map((_, index) => fast[index] - slow[index]);
    const signal = exponentialMovingAverage(macd, 9);
    return macd.map((value, index) => value - signal[index]);
  }

  function shiftIsoDate(date, days) {
    const timestamp = Date.parse(`${String(date || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(timestamp)) return "";
    return new Date(timestamp + (Math.max(0, Number(days) || 0) * 86400000)).toISOString().slice(0, 10);
  }

  function rowsToSeries(rows, keys, dates, availabilityLagDays = 0) {
    const source = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const date = shiftIsoDate(row?.date, availabilityLagDays);
        const value = keys.map((key) => finite(row?.[key])).find((item) => item !== null);
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && value !== undefined ? { date, value } : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.date.localeCompare(right.date));
    const output = [];
    let sourceIndex = 0;
    let latest = null;
    dates.forEach((date) => {
      while (sourceIndex < source.length && source[sourceIndex].date <= date) {
        latest = source[sourceIndex].value;
        sourceIndex += 1;
      }
      output.push(latest);
    });
    return output;
  }

  function marketPriceSeries(candidate, dates) {
    const sourceDates = Array.isArray(candidate?.dates) ? candidate.dates : [];
    const sourcePrices = Array.isArray(candidate?.prices) ? candidate.prices : [];
    const byDate = new Map();
    for (let index = 0; index < Math.min(sourceDates.length, sourcePrices.length); index += 1) {
      const value = finite(sourcePrices[index]);
      if (value > 0) byDate.set(String(sourceDates[index]).slice(0, 10), value);
    }
    let latest = null;
    return dates.map((date) => {
      if (byDate.has(date)) latest = byDate.get(date);
      return latest;
    });
  }

  function prepareMarketCandidates(options, dates) {
    const target = String(options?.series || "").toUpperCase();
    return (Array.isArray(options?.marketCandidates) ? options.marketCandidates : [])
      .filter((candidate) => (
        !isMarketIndexSeries(target)
        || String(candidate?.series || "").toUpperCase() !== target
      ))
      .map((candidate) => {
        const prices = marketPriceSeries(candidate, dates);
        const validCount = prices.filter((value) => value > 0).length;
        if (validCount < Math.min(200, Math.floor(dates.length * 0.6))) return null;
        const filled = prices.map((value, index) => value || prices.slice(index).find((item) => item > 0) || 1);
        return {
          series: String(candidate?.series || ""),
          prices: filled,
          returns: logarithmicReturns(filled),
        };
      })
      .filter(Boolean);
  }

  function relationshipAt(stockReturns, market, priceIndex) {
    if (!market) return { correlation: 0, beta: 0, downsideBeta: 0, strength: 0 };
    const stock = sliceReturns(stockReturns, priceIndex, TRADING_DAYS);
    const indexReturns = sliceReturns(market.returns, priceIndex, TRADING_DAYS);
    const size = Math.min(stock.length, indexReturns.length);
    const alignedStock = stock.slice(-size);
    const alignedMarket = indexReturns.slice(-size);
    const correlation = pearson(alignedStock, alignedMarket);
    const marketVariance = variance(alignedMarket);
    const beta = marketVariance > EPSILON
      ? pearson(alignedStock, alignedMarket) * standardDeviation(alignedStock) / Math.sqrt(marketVariance)
      : 0;
    const downsideIndexes = alignedMarket
      .map((value, index) => value < 0 ? index : -1)
      .filter((index) => index >= 0);
    const downMarket = downsideIndexes.map((index) => alignedMarket[index]);
    const downStock = downsideIndexes.map((index) => alignedStock[index]);
    const downVariance = variance(downMarket);
    const downsideBeta = downVariance > EPSILON
      ? pearson(downStock, downMarket) * standardDeviation(downStock) / Math.sqrt(downVariance)
      : beta;
    return {
      correlation,
      beta: clamp(beta, -3, 3),
      downsideBeta: clamp(downsideBeta, -3, 3),
      strength: Math.abs(correlation),
    };
  }

  function selectMarketAt(stockReturns, markets, priceIndex) {
    let selected = null;
    markets.forEach((market) => {
      const relationship = relationshipAt(stockReturns, market, priceIndex);
      if (!selected || relationship.strength > selected.relationship.strength) {
        selected = { market, relationship };
      }
    });
    return selected;
  }

  function globalMarketSeriesFor(series, marketModel = null) {
    const normalized = String(series || "").toUpperCase();
    const market = /\.KQ$/.test(normalized) || normalized === "^KQ11" ? "KOSDAQ" : "KOSPI";
    const configured = marketModel?.feature_schema?.market_mapping?.[market]
      || marketModel?.featureSchema?.marketMapping?.[market];
    return String(configured || (market === "KOSDAQ" ? "^KQ11" : "^KS11"));
  }

  function pointInTimeSignal(values, priceIndex, direction = 1) {
    const available = values.slice(Math.max(0, priceIndex - TRADING_DAYS + 1), priceIndex + 1)
      .filter((value) => value !== null && Number.isFinite(value));
    if (available.length < 8) return { level: 0, trend: 0, available: 0 };
    const current = available.at(-1);
    const average = mean(available);
    const deviation = standardDeviation(available);
    const lag = available[Math.max(0, available.length - 22)];
    return {
      level: clamp(direction * (current - average) / Math.max(EPSILON, deviation), -3, 3),
      trend: clamp(direction * (current - lag) / Math.max(EPSILON, deviation), -3, 3),
      available: 1,
    };
  }

  function prepareEnvironment(options, dates, series) {
    const isKosdaq = /\.KQ$/i.test(series) || String(series || "").toUpperCase() === "^KQ11";
    const environment = [
      { name: "leading", values: rowsToSeries(options?.macroRows, ["leading_cycle"], dates, 62), direction: 1 },
      { name: "adr", values: rowsToSeries(options?.auxiliaryRows, isKosdaq ? ["adr_kosdaq", "adr"] : ["adr_kospi", "adr"], dates), direction: -1 },
      { name: "deposit", values: rowsToSeries(options?.creditRows, ["customer_deposit"], dates, 1), direction: 1 },
      { name: "credit", values: rowsToSeries(options?.creditRows, isKosdaq ? ["kosdaq_credit"] : ["kospi_credit"], dates, 1), direction: -1 },
      { name: "fear", values: rowsToSeries(options?.auxiliaryRows, ["fear_greed"], dates), direction: -1 },
      { name: "news", values: rowsToSeries(options?.macroRows, ["news_sentiment"], dates, 1), direction: 1 },
    ];
    if ((Array.isArray(options?.macroRows) ? options.macroRows : []).some((row) => finite(row?.policy_rate) !== null)) {
      environment.push({
        name: "policy-rate",
        values: rowsToSeries(options.macroRows, ["policy_rate"], dates),
        direction: -1,
      });
    }
    if ((Array.isArray(options?.macroRows) ? options.macroRows : []).some((row) => finite(row?.export_value) !== null)) {
      environment.push({
        name: "exports",
        values: rowsToSeries(options.macroRows, ["export_value"], dates, 46),
        direction: 1,
      });
    }
    if ((Array.isArray(options?.macroRows) ? options.macroRows : []).some((row) => finite(row?.import_value) !== null)) {
      environment.push({
        name: "imports",
        values: rowsToSeries(options.macroRows, ["import_value"], dates, 46),
        direction: 1,
      });
    }
    if ((Array.isArray(options?.crisisRows) ? options.crisisRows : []).some((row) => finite(row?.score) !== null)) {
      environment.push({
        name: "crisis",
        values: rowsToSeries(options.crisisRows, ["score"], dates, 1),
        direction: -1,
      });
    }
    if (options?.externalRiskCandidates === true) {
      const auxiliaryRows = Array.isArray(options?.auxiliaryRows) ? options.auxiliaryRows : [];
      const crisisRows = Array.isArray(options?.crisisRows) ? options.crisisRows : [];
      const vixRows = auxiliaryRows.some((row) => finite(row?.vix) !== null)
        ? auxiliaryRows
        : crisisRows;
      if (vixRows.some((row) => finite(row?.vix) !== null)) {
        environment.push({
          name: "vix",
          // The US close is only known after the Korean session, so expose it one day later.
          values: rowsToSeries(vixRows, ["vix"], dates, 1),
          direction: -1,
        });
      }
      if (crisisRows.some((row) => finite(row?.krwUsd) !== null)) {
        environment.push({
          name: "krw",
          values: rowsToSeries(crisisRows, ["krwUsd"], dates, 1),
          direction: -1,
        });
      }
    }
    return environment;
  }

  function featureVector(context, priceIndex, options = {}) {
    const { prices, returns, macd, markets, environment } = context;
    const volatility20 = standardDeviation(sliceReturns(returns, priceIndex, 20));
    const volatility63 = standardDeviation(sliceReturns(returns, priceIndex, 63));
    const volatility126 = standardDeviation(sliceReturns(returns, priceIndex, 126));
    const scale = Math.max(0.002, volatility63);
    const normalizedReturn = (window) => clamp(
      windowReturn(prices, priceIndex, window) / (scale * Math.sqrt(window)),
      -4,
      4,
    );
    const recentReturns = sliceReturns(returns, priceIndex, 63);
    const fixedMarketSeries = String(options?.marketSeries || "");
    const fixedMarket = fixedMarketSeries
      ? markets.find((item) => item.series === fixedMarketSeries)
      : null;
    const selected = fixedMarket
      ? { market: fixedMarket, relationship: relationshipAt(returns, fixedMarket, priceIndex) }
      : selectMarketAt(returns, markets, priceIndex);
    const market = selected?.market || null;
    const relationship = selected?.relationship || { correlation: 0, beta: 0, downsideBeta: 0 };
    const marketVolatility = market
      ? Math.max(0.002, standardDeviation(sliceReturns(market.returns, priceIndex, 63)))
      : 1;
    const marketReturn = (window) => market
      ? clamp(windowReturn(market.prices, priceIndex, window) / (marketVolatility * Math.sqrt(window)), -4, 4)
      : 0;
    const environmentSignals = environment.map((item) => pointInTimeSignal(item.values, priceIndex, item.direction));
    const environmentCoverage = mean(environmentSignals.map((item) => item.available));
    const features = [
      normalizedReturn(5),
      normalizedReturn(20),
      normalizedReturn(63),
      normalizedReturn(126),
      clamp(Math.log(Math.max(EPSILON, volatility20) / Math.max(EPSILON, volatility63)), -2, 2),
      clamp(Math.log(Math.max(EPSILON, volatility63) / Math.max(EPSILON, volatility126)), -2, 2),
      clamp(downsideDeviation(recentReturns) / scale, 0, 3),
      clamp(maximumDrawdown(prices, priceIndex, 63) / (scale * Math.sqrt(63)), -4, 0),
      relativeStrengthIndex(returns, priceIndex),
      clamp(macd[priceIndex] / Math.max(EPSILON, scale), -3, 3),
      marketReturn(20),
      marketReturn(63),
      marketReturn(126),
      clamp(relationship.correlation, -1, 1),
      clamp(relationship.beta, -3, 3),
      clamp(relationship.downsideBeta, -3, 3),
      clamp(normalizedReturn(63) - marketReturn(63), -4, 4),
      ...environmentSignals.flatMap((item) => [item.level, item.trend]),
      environmentCoverage,
    ];
    return {
      features,
      momentum: Object.fromEntries([5, 20, 63, 126, 252].map((window) => [
        window,
        windowReturn(prices, priceIndex, window),
      ])),
      marketSeries: market?.series || "",
      relationship,
      environmentCoverage,
      environmentCombined: environmentCoverage
        ? mean(environmentSignals.filter((item) => item.available).map((item) => (item.level + item.trend) / 2))
        : 0,
      volatility: scale,
    };
  }

  function buildSamples(context, horizon) {
    const samples = [];
    for (let anchor = TRADING_DAYS; anchor + horizon < context.prices.length; anchor += SAMPLE_STEP) {
      const feature = featureVector(context, anchor);
      samples.push({
        anchor,
        x: feature.features,
        momentum: feature.momentum,
        volatility: feature.volatility,
        y: Math.log(context.prices[anchor + horizon] / context.prices[anchor]),
      });
    }
    return samples;
  }

  const forecastModelModule = globalScope.ThinkStockAiForecastModel;
  if (!forecastModelModule) throw new Error("AI forecast model module failed to load");
  const forecastModelEngine = forecastModelModule.createForecastModelEngine({
    EPSILON,
    STOCK_HORIZON_CALIBRATION,
    buildSamples,
    clamp,
    finite,
    mean,
    quantile,
    standardDeviation,
  });
  const {
    applyFeatureTransform,
    fallbackPrediction,
    horizonCalibration,
    marketModelForHorizon,
    marketModelPrediction,
    neighborPrediction,
    parseFeatureTransform,
    predictHorizon,
    trainHorizonModel,
  } = forecastModelEngine;

  function growthSignal(current, previous) {
    if (!(Number.isFinite(current) && Number.isFinite(previous)) || Math.abs(previous) < EPSILON) return null;
    return clamp((current - previous) / Math.max(Math.abs(previous), 1), -1.5, 1.5);
  }

  function buildInternetNewsSignal(rows, lastDate) {
    const positivePattern = /수주|공급계약|계약\s*체결|흑자\s*전환|실적\s*(개선|호조)|사상\s*(최대|최고)|승인|허가|증설|자사주|배당\s*(확대|증가)|목표가\s*상향|신제품/;
    const negativePattern = /적자|실적\s*(부진|악화)|급락|목표가\s*하향|리콜|소송|제재|압수수색|횡령|배임|유상증자|감자|상장폐지|거래정지|파산|부도|해킹|화재|생산\s*중단/;
    const terminalPattern = /기업\s*파산|파산|부도|상장폐지|상장적격성|관리종목|회생절차|기업회생|감사의견.{0,8}(거절|한정)|의견거절|완전자본잠식/;
    const dilutionPattern = /유상증자|감자/;
    const reliefPattern = /철회|취소|부인|해소|기각|종료|무혐의|해제/;
    const ambiguousEventPattern = /기업분할|회사분할|인적분할|물적분할|분할합병|합병|사업양수도|지주회사\s*전환/;
    const explicitPositivePattern = /주주가치\s*(제고|확대)|기업가치\s*재평가|독립경영|경영효율/;
    const explicitNegativePattern = /주주가치\s*(훼손|하락)|중복상장|소액주주\s*피해|주주\s*반발/;
    const seen = new Set();
    const clusteredRows = newsEvidenceEngine?.normalizeAnalysisNewsEvidence
      ? newsEvidenceEngine.normalizeAnalysisNewsEvidence(rows, {
        ticker: String(rows?.[0]?.ticker || "005930.KS"),
        requireTrustedUrl: false,
        maximumRows: 40,
      })
      : (Array.isArray(rows) ? rows : []);
    const items = clusteredRows.flatMap((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const title = String(row?.title || "").replace(/\s+/g, " ").trim();
      const ageDays = daysBetweenDates(date, lastDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || date > lastDate || ageDays > 180) return [];
      const key = `${date}|${title.toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const relieved = reliefPattern.test(title);
      const criticalSeverity = !relieved && ageDays <= 10
        ? (terminalPattern.test(title) ? 1 : (dilutionPattern.test(title) ? 0.75 : 0))
        : 0;
      const ambiguousEvent = ambiguousEventPattern.test(title);
      const positive = ambiguousEvent
        ? (explicitPositivePattern.test(title) ? 1 : 0)
        : (positivePattern.test(title) ? 1 : 0);
      const negative = !relieved && (ambiguousEvent
        ? (explicitNegativePattern.test(title) ? 1 : 0)
        : (negativePattern.test(title) ? 1 : 0));
      const direction = positive === negative ? 0 : positive - negative;
      return [{
        date,
        title,
        ageDays,
        clusterSize: Math.max(1, Number(row?.clusterSize) || 1),
        direction: criticalSeverity > 0 ? -1 : direction,
        criticalSeverity,
        ambiguous: ambiguousEvent && positive === negative,
      }];
    }).sort((left, right) => left.ageDays - right.ageDays).slice(0, 40);
    const directional = items.filter((item) => item.direction !== 0);
    const critical = items.filter((item) => item.criticalSeverity > 0);
    const ambiguous = items.filter((item) => item.ambiguous);
    const criticalSeverity = critical.reduce((highest, item) => Math.max(highest, item.criticalSeverity), 0);
    if (!directional.length) {
      return {
        signal: 0,
        confidence: 0,
        adjustment: 0,
        count: items.length,
        directionalCount: 0,
        criticalRisk: false,
        criticalSeverity: 0,
        criticalCount: 0,
        ambiguousCount: ambiguous.length,
        mentionCount: items.reduce((sum, item) => sum + item.clusterSize, 0),
      };
    }
    const weighted = directional.reduce((sum, item) => (
      sum + (item.direction * Math.exp(-item.ageDays / 45))
    ), 0);
    const weightTotal = directional.reduce((sum, item) => sum + Math.exp(-item.ageDays / 45), 0);
    const signal = clamp(weighted / Math.max(EPSILON, weightTotal), -1, 1);
    const confidence = clamp((directional.length / 10) * (0.5 + (Math.abs(signal) * 0.5)), 0, 0.65);
    return {
      signal,
      confidence,
      adjustment: critical.length
        ? -clamp(0.04 + (criticalSeverity * 0.04), 0.04, 0.08)
        : clamp(signal * confidence * 0.02, -0.013, 0.013),
      count: items.length,
      directionalCount: directional.length,
      criticalRisk: critical.length > 0,
      criticalSeverity,
      criticalCount: critical.length,
      ambiguousCount: ambiguous.length,
      mentionCount: items.reduce((sum, item) => sum + Math.max(1, Number(item.clusterSize) || 1), 0),
    };
  }

  function buildContextSignal(options, ticker, lastDate, currentPrice) {
    const consensus = options?.consensus || {};
    const targetPrice = finite(consensus.targetPrice ?? consensus.target_price);
    const institutions = finite(consensus.institutions ?? consensus.count) || 0;
    const opinion = finite(consensus.opinion);
    let consensusSignal = 0;
    let consensusConfidence = 0;
    if (targetPrice > 0 && currentPrice > 0) {
      consensusSignal = clamp(Math.log(targetPrice / currentPrice) / 0.25, -1, 1);
      consensusConfidence = clamp(institutions / 8, 0.25, 1);
    } else if (opinion !== null) {
      consensusSignal = clamp((opinion - 3) / 1.5, -1, 1);
      consensusConfidence = clamp(institutions / 8, 0.15, 0.8);
    }

    const financials = (Array.isArray(options?.financials) ? options.financials : [])
      .filter((row) => String(row?.period || "").slice(0, 10) <= String(lastDate || "9999-99-99"))
      .sort((left, right) => String(left.period).localeCompare(String(right.period)));
    const annual = financials.filter((row) => row.frequency === "annual" && !row.estimate).slice(-2);
    const quarterly = financials.filter((row) => row.frequency === "quarter" && !row.estimate).slice(-2);
    const fundamentalParts = [];
    [annual, quarterly].forEach((rows) => {
      if (rows.length < 2) return;
      const revenueGrowth = growthSignal(finite(rows[1].revenue), finite(rows[0].revenue));
      const profitGrowth = growthSignal(finite(rows[1].operatingProfit), finite(rows[0].operatingProfit));
      if (revenueGrowth !== null) fundamentalParts.push(revenueGrowth * 0.4);
      if (profitGrowth !== null) fundamentalParts.push(profitGrowth * 0.6);
    });
    const latestQuarter = quarterly.at(-1) || financials.filter((row) => row.frequency === "quarter").at(-1);
    [latestQuarter?.operatingProfitSurprise, latestQuarter?.netIncomeSurprise].forEach((value) => {
      const surprise = finite(value);
      if (surprise !== null) fundamentalParts.push(clamp(surprise / 30, -1, 1));
    });
    const fundamentals = fundamentalParts.length ? clamp(mean(fundamentalParts), -1, 1) : 0;
    const fundamentalsConfidence = clamp(fundamentalParts.length / 3, 0, 1);
    const internetNews = buildInternetNewsSignal(options?.internetNews, lastDate);
    const brokerSummary = options?.brokerResearch
      && String(options.brokerResearch.latestAvailableDate || options.brokerResearch.latestDate || "").slice(0, 10)
        <= String(lastDate || "9999-99-99")
      ? options.brokerResearch
      : null;
    const brokerReportCount = Math.max(0, Number(brokerSummary?.reportCount) || 0);
    const brokerCoverage = brokerReportCount
      ? clamp(brokerReportCount / 3, 0.35, 1)
      : 0;
    const brokerPrimaryCoverage = clamp(Number(brokerSummary?.primaryCoverage) || 0, 0, 1);
    const brokerTargetRevisionAvailable = finite(brokerSummary?.targetRevisionChange) !== null;
    const brokerTargetCut = finite(brokerSummary?.targetRevisionChange) < -0.015;
    const brokerEvidenceScale = clamp(
      (brokerPrimaryCoverage * 0.75)
        + (brokerTargetRevisionAvailable ? (brokerTargetCut ? 0.45 : 0.25) : 0),
      0,
      1,
    );
    const brokerSignal = brokerSummary
      ? clamp(Number(brokerSummary.signal) || 0, -1, 1)
      : 0;
    const brokerConfidence = brokerSummary
      ? clamp((Number(brokerSummary.confidence) || 0) * brokerCoverage * brokerEvidenceScale, 0, 0.8)
      : 0;
    const brokerAdjustment = brokerSummary
      ? clamp((Number(brokerSummary.adjustment) || 0) * brokerCoverage * brokerEvidenceScale, -0.024, 0.018)
      : 0;
    const consensusWeighted = consensusSignal * consensusConfidence;
    const fundamentalsWeighted = fundamentals * fundamentalsConfidence;
    const structuralConfidence = consensusConfidence + fundamentalsConfidence;
    const weighted = consensusWeighted
      + fundamentalsWeighted
      + (internetNews.signal * internetNews.confidence)
      + (brokerSignal * brokerConfidence);
    const confidenceTotal = structuralConfidence + internetNews.confidence + brokerConfidence;
    const consensusAdjustment = structuralConfidence ? (consensusWeighted / structuralConfidence) * 0.04 : 0;
    const fundamentalsAdjustment = structuralConfidence ? (fundamentalsWeighted / structuralConfidence) * 0.04 : 0;
    return {
      ticker,
      consensus: consensusSignal,
      consensusConfidence,
      consensusAdjustment,
      consensusInstitutions: institutions,
      fundamentals,
      fundamentalsConfidence,
      fundamentalsAdjustment,
      financialPeriods: financials.length,
      internetNews: internetNews.signal,
      internetNewsConfidence: internetNews.confidence,
      internetNewsAdjustment: internetNews.adjustment,
      internetNewsRows: internetNews.count,
      internetNewsMentions: internetNews.mentionCount,
      internetNewsDirectionalRows: internetNews.directionalCount,
      internetNewsCriticalRisk: internetNews.criticalRisk,
      internetNewsCriticalSeverity: internetNews.criticalSeverity,
      internetNewsCriticalRows: internetNews.criticalCount,
      internetNewsAmbiguousRows: internetNews.ambiguousCount,
      brokerResearch: brokerSignal,
      brokerResearchConfidence: brokerConfidence,
      brokerResearchAdjustment: brokerAdjustment,
      brokerResearchReports: brokerReportCount,
      brokerResearchPrimaryCoverage: brokerPrimaryCoverage,
      brokerResearchTargetRevision: finite(brokerSummary?.targetRevisionChange) !== null
        ? finite(brokerSummary.targetRevisionChange)
        : null,
      brokerResearchConflict: brokerSummary?.primaryConflict === true,
      combined: confidenceTotal ? clamp(weighted / confidenceTotal, -1, 1) : 0,
      adjustment: clamp(
        consensusAdjustment + fundamentalsAdjustment + internetNews.adjustment + brokerAdjustment,
        -0.065,
        0.065,
      ),
    };
  }

  function daysBetweenDates(left, right) {
    const leftTime = Date.parse(`${String(left || "").slice(0, 10)}T00:00:00Z`);
    const rightTime = Date.parse(`${String(right || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Infinity;
    return Math.max(0, Math.round((rightTime - leftTime) / 86400000));
  }

  function finiteSeriesRows(rows, key, lastDate, availabilityLagDays = 0) {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        date: shiftIsoDate(row?.date, availabilityLagDays),
        value: finite(row?.[key]),
      }))
      .filter((row) => (
        /^\d{4}-\d{2}-\d{2}$/.test(row.date)
        && row.date <= String(lastDate || "9999-99-99")
        && row.value !== null
      ))
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  function seriesValueBeforeDays(rows, days) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const latestTime = Date.parse(`${rows.at(-1).date}T00:00:00Z`);
    if (!Number.isFinite(latestTime)) return null;
    const targetTime = latestTime - (Math.max(0, Number(days) || 0) * 86400000);
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const rowTime = Date.parse(`${rows[index].date}T00:00:00Z`);
      if (Number.isFinite(rowTime) && rowTime <= targetTime) return rows[index].value;
    }
    return null;
  }

  function percentileRank(values, current) {
    const source = values.filter(Number.isFinite);
    if (!source.length || !Number.isFinite(current)) return 0.5;
    return source.filter((value) => value <= current).length / source.length;
  }

  function buildKoreanVolatilityProfile(options, series, lastDate) {
    const target = String(series || "").trim().toUpperCase();
    const indexForecast = isMarketIndexSeries(target);
    const empty = {
      enabled: options?.koreanVolatilityCandidate === true,
      available: false,
      mode: indexForecast ? "index-regime" : "stock-uncertainty",
      latestDate: "",
      latest: null,
      ageDays: null,
      rowCount: 0,
      zScore: 0,
      percentile: 0.5,
      change20: null,
      stress: 0,
      complacency: 0,
      intervalExpansion: 0,
      directionalWeight: 0,
      indexAdjustment126: 0,
    };
    if (!empty.enabled) return empty;

    // VKOSPI is finalized after the market close. A one-day availability lag
    // prevents same-day values from leaking into historical forecasts.
    const rowsByDate = new Map();
    [options?.crisisRows, options?.auxiliaryRows].forEach((rows) => {
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const date = String(row?.date || "").slice(0, 10);
        const value = finite(row?.vkospi);
        const availableDate = shiftIsoDate(date, 1);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
          || !availableDate
          || availableDate > String(lastDate || "9999-99-99")
          || value === null
          || value <= 0) return;
        rowsByDate.set(date, { date, value });
      });
    });
    const rows = [...rowsByDate.values()]
      .sort((left, right) => left.date.localeCompare(right.date));
    const latestRow = rows.at(-1);
    const ageDays = latestRow ? daysBetweenDates(latestRow.date, lastDate) : null;
    if (rows.length < 60 || !latestRow || ageDays > 14) {
      return { ...empty, latestDate: latestRow?.date || "", ageDays, rowCount: rows.length };
    }

    const lookback = rows.slice(-TRADING_DAYS);
    const values = lookback.map((row) => row.value);
    const latest = latestRow.value;
    const deviation = standardDeviation(values);
    const zScore = deviation > EPSILON
      ? clamp((latest - mean(values)) / deviation, -4, 4)
      : 0;
    const percentile = percentileRank(values, latest);
    const lag20 = seriesValueBeforeDays(rows, 28);
    const change20 = lag20 === null ? null : latest - lag20;
    const levelStress = Math.max(
      clamp((zScore - 0.75) / 1.75, 0, 1),
      clamp((percentile - 0.8) / 0.2, 0, 1),
    );
    const shockStress = change20 === null ? 0 : clamp((change20 - 3) / 12, 0, 1);
    const stress = clamp(Math.max(levelStress, shockStress * 0.75), 0, 1);
    const complacency = Math.max(
      clamp((-zScore - 0.75) / 1.75, 0, 1),
      clamp((0.2 - percentile) / 0.2, 0, 1),
    );
    // Walk-forward validation supported a small KOSPI regime adjustment, but
    // not a directional VKOSPI adjustment for KOSDAQ. KOSDAQ still benefits
    // from the wider uncertainty interval below.
    const directionalWeight = target === "^KS11" ? 1 : 0;
    const indexAdjustment126 = ((0.02 * levelStress) - (0.01 * complacency))
      * directionalWeight;

    return {
      ...empty,
      available: true,
      latestDate: latestRow.date,
      latest,
      ageDays,
      rowCount: rows.length,
      zScore,
      percentile,
      change20,
      stress,
      complacency,
      // Stocks keep the same median path; stress only widens their interval.
      intervalExpansion: stress * (indexForecast ? 0.15 : 0.2),
      directionalWeight,
      indexAdjustment126,
    };
  }

  function linearTrendProfile(values) {
    const source = values.filter(Number.isFinite);
    if (source.length < 3) return { slope: 0, rSquared: 0 };
    const xMean = (source.length - 1) / 2;
    const yMean = mean(source);
    let covariance = 0;
    let xVariance = 0;
    let yVariance = 0;
    source.forEach((value, index) => {
      const xDelta = index - xMean;
      const yDelta = value - yMean;
      covariance += xDelta * yDelta;
      xVariance += xDelta ** 2;
      yVariance += yDelta ** 2;
    });
    const slope = covariance / Math.max(EPSILON, xVariance);
    const rSquared = (covariance ** 2) / Math.max(EPSILON, xVariance * yVariance);
    return { slope, rSquared: clamp(rSquared, 0, 1) };
  }

  function buildShortTermShockProfile(prices, options = {}) {
    const source = (Array.isArray(prices) ? prices : []).map(finite).filter((value) => value > 0);
    const neutral = {
      active: false,
      direction: "neutral",
      strength: 0,
      signedStrength: 0,
      age: null,
      eventMovePct: null,
      latestMovePct: null,
      cumulative5Pct: null,
      extremeCount: 0,
    };
    if (source.length < 6) return neutral;
    const indexForecast = options.indexForecast === true;
    const threshold = indexForecast ? 0.08 : 0.25;
    const maximumValidMove = indexForecast ? 0.2 : 0.315;
    const start = Math.max(1, source.length - 9);
    const moves = [];
    for (let index = start; index < source.length; index += 1) {
      const value = (source[index] / source[index - 1]) - 1;
      if (Math.abs(value) <= maximumValidMove) {
        moves.push({ index, age: source.length - 1 - index, value });
      }
    }
    const latestMove = moves.find((item) => item.age === 0)?.value ?? null;
    const cumulative = (days) => {
      const anchor = Math.max(0, source.length - 1 - days);
      return (source.at(-1) / source[anchor]) - 1;
    };
    const cumulative5 = cumulative(5);
    const cumulative8 = cumulative(8);

    function directionalProfile(direction) {
      const sign = direction === "overbought" ? 1 : -1;
      const events = moves.filter((item) => (
        item.age <= 4 && (item.value * sign) >= threshold
      ));
      const widerEvents = moves.filter((item) => (item.value * sign) >= threshold);
      const event = events.slice().sort((left, right) => left.age - right.age)[0] || null;
      const clusterContinuation = !indexForecast
        && widerEvents.length >= 2
        && (cumulative8 * sign) >= 0.5
        && latestMove !== null
        && (latestMove * sign) >= 0.08;
      if (!event && !clusterContinuation) return null;
      const referenceEvent = event
        || widerEvents.slice().sort((left, right) => left.age - right.age)[0];
      const eventStrength = referenceEvent
        ? ((Math.abs(referenceEvent.value) / threshold) * (1 - (referenceEvent.age * 0.1)))
        : 0;
      const clusterStrength = clusterContinuation
        ? 1 + Math.min(0.5, ((widerEvents.length - 2) * 0.18) + Math.max(0, Math.abs(cumulative8) - 0.5))
        : 0;
      const eventPrice = referenceEvent ? source[referenceEvent.index] : source.at(-1);
      const postEventMove = (source.at(-1) / eventPrice) - 1;
      const cooled = direction === "overbought" ? postEventMove <= -0.12 : postEventMove >= 0.12;
      const strength = clamp(Math.max(eventStrength, clusterStrength) * (cooled ? 0.35 : 1), 0, 1.5);
      return {
        active: strength >= 0.75,
        direction,
        strength,
        signedStrength: strength * sign,
        age: referenceEvent?.age ?? 0,
        eventMovePct: referenceEvent ? referenceEvent.value * 100 : null,
        latestMovePct: latestMove === null ? null : latestMove * 100,
        cumulative5Pct: cumulative5 * 100,
        extremeCount: widerEvents.length,
        cooled,
      };
    }

    const overbought = directionalProfile("overbought");
    const oversold = directionalProfile("oversold");
    const selected = [overbought, oversold]
      .filter((profile) => profile?.active)
      .sort((left, right) => right.strength - left.strength || left.age - right.age)[0];
    return selected || neutral;
  }

  function buildPriceRegimeProfile(prices, forwardReturns = [], projectedVolatility = 0, options = {}) {
    const source = (Array.isArray(prices) ? prices : []).map(finite).filter((value) => value > 0);
    const shortTermShock = buildShortTermShockProfile(source, options);
    if (source.length < TRADING_DAYS) {
      return {
        rangeBoundScore: 0,
        position: 0.5,
        meanReversionReturn: 0,
        empiricalPrior: [0.375, 0.25, 0.375],
        sidewaysFrequency: 0.25,
        breakoutStrength: 0,
        shortTermShock,
      };
    }
    const recent = source.slice(-Math.min(source.length, MAX_STOCK_HISTORY));
    const monthly = recent.filter((_, index) => index % 21 === 0);
    if (monthly.at(-1) !== recent.at(-1)) monthly.push(recent.at(-1));
    const logMonthly = monthly.map(Math.log);
    const trend = linearTrendProfile(logMonthly);
    const years = Math.max(1, (recent.length - 1) / TRADING_DAYS);
    const annualizedReturn = Math.log(recent.at(-1) / recent[0]) / years;
    const annualizedSlope = trend.slope * 12;
    const monthlyChanges = logMonthly.slice(1).map((value, index) => value - logMonthly[index]);
    const pathLength = monthlyChanges.reduce((sum, value) => sum + Math.abs(value), 0);
    const efficiency = Math.abs(logMonthly.at(-1) - logMonthly[0]) / Math.max(EPSILON, pathLength);
    const medianLog = quantile(logMonthly, 0.5);
    const rangeWidth = Math.max(EPSILON, quantile(logMonthly, 0.9) - quantile(logMonthly, 0.1));
    let crossings = 0;
    let previousSign = 0;
    logMonthly.forEach((value) => {
      const delta = value - medianLog;
      const sign = Math.abs(delta) <= rangeWidth * 0.03 ? 0 : Math.sign(delta);
      if (sign && previousSign && sign !== previousSign) crossings += 1;
      if (sign) previousSign = sign;
    });
    const crossingsPerYear = crossings / years;
    const lower = quantile(logMonthly, 0.1);
    const upper = quantile(logMonthly, 0.9);
    const currentLog = logMonthly.at(-1);
    const position = clamp((currentLog - lower) / Math.max(EPSILON, upper - lower), 0, 1);
    const flatBand = clamp(projectedVolatility * Math.sqrt(126) * 0.35, 0.05, 0.1);
    const historical = (Array.isArray(forwardReturns) ? forwardReturns : []).filter(Number.isFinite);
    const upCount = historical.filter((value) => value > flatBand).length;
    const downCount = historical.filter((value) => value < -flatBand).length;
    const sidewaysCount = Math.max(0, historical.length - upCount - downCount);
    const empiricalTotal = historical.length + 6;
    const empiricalPrior = [
      (upCount + 2) / empiricalTotal,
      (sidewaysCount + 2) / empiricalTotal,
      (downCount + 2) / empiricalTotal,
    ];
    const sidewaysFrequency = historical.length ? sidewaysCount / historical.length : 0.25;
    const lowNetTrend = clamp((0.1 - Math.abs(annualizedReturn)) / 0.1, 0, 1);
    const lowSlope = clamp((0.1 - Math.abs(annualizedSlope)) / 0.1, 0, 1);
    const lowTrendFit = clamp((0.55 - trend.rSquared) / 0.55, 0, 1);
    const repeatedCrossings = clamp(crossingsPerYear / 1.5, 0, 1);
    const lowEfficiency = clamp((0.45 - efficiency) / 0.4, 0, 1);
    const historicalSideways = clamp((sidewaysFrequency - 0.2) / 0.45, 0, 1);
    const rawRangeBoundScore = clamp(
      (historicalSideways * 0.25)
        + (lowNetTrend * 0.2)
        + (lowSlope * 0.15)
        + (lowTrendFit * 0.15)
        + (repeatedCrossings * 0.15)
        + (lowEfficiency * 0.1),
      0,
      1,
    );
    const recent63 = recent.length > 63 ? Math.log(recent.at(-1) / recent.at(-64)) : 0;
    const breakoutDistance = rangeWidth > EPSILON
      ? Math.max(0, currentLog - upper, lower - currentLog) / rangeWidth
      : 0;
    const outsideRangeWeight = clamp((breakoutDistance - 0.03) * 4, 0, 1);
    const breakoutStrength = clamp(
      Math.max(0, breakoutDistance - 0.05) * 3
        + (outsideRangeWeight
          * Math.max(0, Math.abs(recent63) - flatBand)
          / Math.max(flatBand, 0.01)),
      0,
      1,
    );
    const rangeBoundScore = rawRangeBoundScore * (1 - (breakoutStrength * 0.7));
    const positionPressure = clamp((position - 0.5) * 2, -1, 1);
    return {
      rangeBoundScore,
      rawRangeBoundScore,
      position,
      meanReversionReturn: -positionPressure * flatBand * 0.8,
      empiricalPrior,
      sidewaysFrequency,
      annualizedReturn,
      annualizedSlope,
      trendRSquared: trend.rSquared,
      crossingsPerYear,
      efficiency,
      breakoutStrength,
      flatBand,
      shortTermShock,
    };
  }

  function buildLeadingCyclePhase(macroRows, lastDate) {
    const rows = finiteSeriesRows(macroRows, "leading_cycle", lastDate, 62);
    if (!rows.length) return { phase: "unknown", rank: 0.5, rangePressure: 0, recentDelta: 0 };
    const latest = rows.at(-1).value;
    const lag90 = seriesValueBeforeDays(rows, 90);
    const lag180 = seriesValueBeforeDays(rows, 180);
    const recentDelta = lag90 === null ? 0 : latest - lag90;
    const previousDelta = lag90 === null || lag180 === null ? 0 : lag90 - lag180;
    const cutoff = shiftIsoDate(rows.at(-1).date, -(365 * 15));
    const rank = percentileRank(rows.filter((row) => row.date >= cutoff).map((row) => row.value), latest);
    const slowing = recentDelta < previousDelta - 0.05;
    let phase = "neutral";
    if (rank >= 0.85 && (recentDelta <= 0.1 || slowing)) phase = "peak";
    else if (recentDelta <= -0.15) phase = "slowdown";
    else if (rank <= 0.2 && recentDelta >= 0.05) phase = "recovery";
    else if (recentDelta >= 0.15) phase = "expansion";
    return {
      phase,
      rank,
      latest,
      recentDelta,
      previousDelta,
      rangePressure: phase === "peak" ? 0.6 : (phase === "slowdown" ? 0.3 : 0),
    };
  }

  function buildCorporateRiskSignal(options, ticker, lastDate) {
    const target = String(ticker || "").trim().toUpperCase();
    const reasons = [];
    let score = 0;
    let terminalRisk = false;
    let recentDilutionRisk = false;
    let recentGovernanceRisk = false;
    const terminalPattern = /상장폐지|상장적격성|관리종목|감사의견.{0,8}(거절|한정)|의견거절|자본잠식|회생절차|파산|영업정지/;
    const governancePattern = /횡령|배임/;
    const financingPattern = /유상증자|감자|전환사채|신주인수권부사채|교환사채|제3자배정/;
    const warningPattern = /최대주주변경|불성실공시|소송|채무보증|담보제공|대규모손실/;
    const positivePattern = /단일판매.{0,6}공급계약|자기주식취득결정|현금.{0,5}배당/;
    const reliefPattern = /철회|취소|부인|해소|기각|종료|무혐의|해제/;
    const disclosures = (Array.isArray(options?.disclosures) ? options.disclosures : [])
      .filter((row) => (
        String(row?.ticker || "").trim().toUpperCase() === target
        && String(row?.date || "").slice(0, 10) <= String(lastDate || "9999-99-99")
      ))
      .sort((left, right) => String(left.date).localeCompare(String(right.date)))
      .slice(-40);
    disclosures.forEach((row) => {
      const title = String(row?.title || row?.report_nm || "");
      const ageDays = daysBetweenDates(row?.date, lastDate);
      if (ageDays > 1095) return;
      const decay = Math.exp(-ageDays / 365);
      const relieved = reliefPattern.test(title);
      if (!relieved && terminalPattern.test(title)) {
        score += 0.8 * decay;
        terminalRisk = terminalRisk || ageDays <= 365;
        reasons.push("상장·감사 위험 공시");
      } else if (!relieved && governancePattern.test(title)) {
        score += 0.45 * decay;
        recentGovernanceRisk = recentGovernanceRisk || ageDays <= 90;
        reasons.push("횡령·배임 위험 공시");
      } else if (!relieved && financingPattern.test(title)) {
        score += 0.24 * decay;
        recentDilutionRisk = recentDilutionRisk || (ageDays <= 14 && /유상증자|감자/.test(title));
        reasons.push("희석성 자금조달");
      } else if (warningPattern.test(title)) {
        score += 0.18 * decay;
        reasons.push("경영 위험 공시");
      } else if (positivePattern.test(title)) {
        score -= 0.05 * decay;
      }
    });

    const actuals = (Array.isArray(options?.financials) ? options.financials : [])
      .filter((row) => (
        row?.estimate !== true
        && String(row?.period || "").slice(0, 7) <= String(lastDate || "9999-99-99").slice(0, 7)
      ))
      .sort((left, right) => String(left.period).localeCompare(String(right.period)));
    const recent = actuals.slice(-4);
    const operatingValues = recent.map((row) => finite(row?.operatingProfit)).filter(Number.isFinite);
    const netIncomeValues = recent.map((row) => finite(row?.netIncome)).filter(Number.isFinite);
    if (operatingValues.length >= 2 && operatingValues.filter((value) => value < 0).length >= 2) {
      score += 0.28;
      reasons.push("반복 영업적자");
    }
    if (netIncomeValues.length >= 2 && netIncomeValues.filter((value) => value < 0).length >= 2) {
      score += 0.16;
      reasons.push("반복 순손실");
    }
    const latest = recent.at(-1);
    const previous = recent.at(-2);
    const latestRevenue = finite(latest?.revenue);
    const previousRevenue = finite(previous?.revenue);
    if (latestRevenue > 0 && previousRevenue > 0 && latestRevenue < previousRevenue * 0.8) {
      score += 0.12;
      reasons.push("매출 급감");
    }
    const latestProfit = finite(latest?.operatingProfit);
    const previousProfit = finite(previous?.operatingProfit);
    if (latestProfit !== null && previousProfit > 0 && latestProfit < 0) {
      score += 0.16;
      reasons.push("영업이익 적자전환");
    }

    const normalizedScore = clamp(score, 0, 1);
    return {
      score: normalizedScore,
      terminalRisk,
      recentDilutionRisk,
      recentGovernanceRisk,
      adjustment: -0.14 * normalizedScore,
      uncertainty: 0.07 * normalizedScore,
      reasons: [...new Set(reasons)].slice(0, 3),
      disclosureCount: disclosures.length,
      financialPeriods: recent.length,
    };
  }

  function buildMarketRegimeSignal(options, series, lastDate) {
    const isKosdaq = /\.KQ$/i.test(series) || String(series || "").toUpperCase() === "^KQ11";
    const macd = clamp(finite(options?.macdSignal) || 0, -1, 1);
    const supportFactors = [];
    const riskFactors = [];
    const rangeFactors = [];
    const addSupport = (weight, reason) => {
      if (weight > 0) supportFactors.push({ weight, reason });
    };
    const addRisk = (weight, reason) => {
      if (weight > 0) riskFactors.push({ weight, reason });
    };
    const addRange = (weight, reason) => {
      if (weight > 0) rangeFactors.push({ weight, reason });
    };

    const leadingPhase = buildLeadingCyclePhase(options?.macroRows, lastDate);
    if (leadingPhase.phase === "expansion") {
      addSupport(clamp(leadingPhase.recentDelta / 1.2, 0.1, 0.8), "선행순환 확장");
    } else if (leadingPhase.phase === "recovery") {
      addSupport(clamp(leadingPhase.recentDelta / 1.2, 0.1, 0.55), "선행순환 회복");
    } else if (leadingPhase.phase === "peak") {
      addRange(0.6, "선행순환 역사적 고점권");
      if (leadingPhase.recentDelta < -0.05) addRisk(0.12, "선행순환 고점 통과");
    } else if (leadingPhase.phase === "slowdown") {
      addRisk(clamp(-leadingPhase.recentDelta / 1.2, 0.1, 0.8), "선행순환 둔화");
      addRange(0.25, "경기 모멘텀 둔화");
    }

    const news = finiteSeriesRows(options?.macroRows, "news_sentiment", lastDate, 1);
    if (news.length) {
      const latest = news.at(-1).value;
      const lag = seriesValueBeforeDays(news, 28);
      if (lag !== null && latest >= 100 && latest > lag) addSupport(clamp((latest - lag) / 15, 0.1, 0.45), "뉴스심리 개선");
      if (latest < 90 && macd < 0) addRisk(clamp((90 - latest) / 25, 0.1, 0.4), "뉴스심리 위축");
      if (latest > 115 && macd > 0.35) addRisk(clamp((latest - 115) / 25, 0.1, 0.35), "뉴스심리 과열");
    }

    const policyRate = finiteSeriesRows(options?.macroRows, "policy_rate", lastDate);
    const policyRateLag = seriesValueBeforeDays(policyRate, 120);
    let policyRateChange = null;
    if (policyRate.length && policyRateLag !== null) {
      policyRateChange = policyRate.at(-1).value - policyRateLag;
      if (policyRateChange >= 0.25) addRisk(clamp(policyRateChange / 2, 0.12, 0.5), "한국 기준금리 인상");
      if (policyRateChange <= -0.25) addSupport(clamp(-policyRateChange / 2, 0.12, 0.45), "한국 기준금리 인하");
    }

    const exports = finiteSeriesRows(options?.macroRows, "export_value", lastDate, 46);
    const imports = finiteSeriesRows(options?.macroRows, "import_value", lastDate, 46);
    const exportsYearAgo = seriesValueBeforeDays(exports, 365);
    const importsYearAgo = seriesValueBeforeDays(imports, 365);
    const exportsQuarterAgo = seriesValueBeforeDays(exports, 100);
    let exportGrowth = null;
    if (exports.length && exportsYearAgo > 0) {
      exportGrowth = Math.log(exports.at(-1).value / Math.max(EPSILON, exportsYearAgo));
      const importGrowth = imports.length && importsYearAgo > 0
        ? Math.log(imports.at(-1).value / Math.max(EPSILON, importsYearAgo))
        : 0;
      const marketWeight = isKosdaq ? 0.55 : 0.85;
      if (exportGrowth >= 0.03) {
        addSupport(clamp(exportGrowth / 0.25, 0.1, 0.65) * marketWeight, "수출 증가");
      }
      if (exportGrowth <= -0.03) {
        addRisk(clamp(-exportGrowth / 0.25, 0.1, 0.65) * marketWeight, "수출 감소");
      }
      if (exportGrowth - importGrowth >= 0.05) {
        addSupport(clamp((exportGrowth - importGrowth) / 0.3, 0.08, 0.4) * marketWeight, "무역 모멘텀 개선");
      }
      if (exportsQuarterAgo > 0) {
        const quarterGrowth = Math.log(exports.at(-1).value / Math.max(EPSILON, exportsQuarterAgo));
        if (exportGrowth > 0.03 && quarterGrowth <= 0) addRange(0.25, "수출 강세 후 모멘텀 정체");
      }
      if (exportGrowth > 0.03 && leadingPhase.phase === "peak") {
        addRange(0.4, "수출 강세·선행순환 고점");
      }
    }

    const deposits = finiteSeriesRows(options?.creditRows, "customer_deposit", lastDate, 1);
    const depositsLag = seriesValueBeforeDays(deposits, 28);
    if (deposits.length && depositsLag > 0) {
      const growth = Math.log(deposits.at(-1).value / Math.max(EPSILON, depositsLag));
      if (growth > 0.015) addSupport(clamp(growth / 0.08, 0.1, 0.5), "고객예탁금 증가");
      if (growth < -0.015) addRisk(clamp(-growth / 0.08, 0.1, 0.5), "고객예탁금 감소");
    }

    const creditKey = isKosdaq ? "kosdaq_credit" : "kospi_credit";
    const credit = finiteSeriesRows(options?.creditRows, creditKey, lastDate, 1);
    const creditLag = seriesValueBeforeDays(credit, 28);
    if (credit.length && creditLag > 0) {
      const recentValues = credit.slice(-252).map((row) => row.value);
      const latest = credit.at(-1).value;
      const rank = percentileRank(recentValues, latest);
      const growth = Math.log(latest / Math.max(EPSILON, creditLag));
      if (rank >= 0.8) addRisk(clamp((rank - 0.7) * 1.5, 0.1, 0.45), "신용잔고 과밀");
      if (growth >= 0.06) addRisk(clamp(growth / 0.16, 0.15, 0.55), "신용잔고 급증");
      if (rank <= 0.25 && macd >= 0) addSupport(clamp((0.35 - rank) * 1.2, 0.1, 0.4), "신용잔고 저점");
    }

    const adrKey = isKosdaq ? "adr_kosdaq" : "adr_kospi";
    const adr = finiteSeriesRows(options?.auxiliaryRows, adrKey, lastDate);
    const adrFallback = adr.length ? adr : finiteSeriesRows(options?.auxiliaryRows, "adr", lastDate);
    let adrLatest = null;
    let adrChange28 = null;
    let adrRecentHigh = null;
    let adrRecentLow = null;
    if (adrFallback.length) {
      const latest = adrFallback.at(-1).value;
      const lag = seriesValueBeforeDays(adrFallback, 28);
      const recentValues = adrFallback.filter((row) => daysBetweenDates(row.date, lastDate) <= 28)
        .map((row) => row.value);
      adrLatest = latest;
      adrChange28 = lag === null ? null : latest - lag;
      adrRecentHigh = recentValues.length ? Math.max(...recentValues) : latest;
      adrRecentLow = recentValues.length ? Math.min(...recentValues) : latest;
      if (latest >= 120) addRisk(clamp((latest - 110) / 40, 0.15, 0.5), "ADR 과열");
      if (latest <= 75 && macd >= 0) addSupport(clamp((85 - latest) / 35, 0.15, 0.45), "ADR 침체 후 회복");
      if (latest <= 70 && macd < 0) addRisk(0.2, "시장 폭 약화");
    }

    const fear = finiteSeriesRows(options?.auxiliaryRows, "fear_greed", lastDate);
    if (fear.length) {
      const latest = fear.at(-1).value;
      if (latest >= 75) addRisk(clamp((latest - 65) / 35, 0.15, 0.45), "탐욕 구간");
      if (latest <= 25 && macd >= 0) addSupport(clamp((35 - latest) / 35, 0.15, 0.4), "공포 구간 후 반등");
      if (latest <= 20 && macd < 0) addRisk(0.2, "공포 추세 지속");
    }

    const crisis = finiteSeriesRows(options?.crisisRows, "score", lastDate, 1);
    const crisisScore = crisis.at(-1)?.value ?? 0;
    if (crisisScore >= 50) addRisk(clamp((crisisScore - 35) / 65, 0.25, 0.9), "FED 침체위험 상승");
    else if (crisisScore >= 25) addRisk(clamp((crisisScore - 20) / 80, 0.08, 0.3), "경기주의 구간");
    const fedFundsChange = finiteSeriesRows(options?.crisisRows, "fedFundsChange6m", lastDate, 1).at(-1)?.value;
    if (Number.isFinite(fedFundsChange) && fedFundsChange >= 0.25) {
      addRisk(clamp(fedFundsChange / 2, 0.12, 0.5), "미 연준 긴축");
    }
    if (Number.isFinite(fedFundsChange) && fedFundsChange <= -0.25) {
      if (crisisScore < 50) addSupport(clamp(-fedFundsChange / 2, 0.12, 0.45), "미 연준 완화");
      else addRisk(0.25, "침체성 미 금리인하");
    }
    if (Number.isFinite(fedFundsChange) && Math.abs(fedFundsChange) < 0.125) {
      addRange(0.15, "미국 금리 정체");
    }
    if (policyRateChange >= 0.25 && Number.isFinite(fedFundsChange) && fedFundsChange < 0.125) {
      addRisk(0.12, "한국 긴축·미국 동결 차별화");
      addRange(0.25, "한미 통화정책 차별화");
    }

    if (macd >= 0.15) addSupport(clamp(macd * 0.45, 0.08, 0.45), "MACD 회복");
    if (macd <= -0.15) addRisk(clamp(-macd * 0.45, 0.08, 0.45), "MACD 약화");

    const support = supportFactors.reduce((sum, item) => sum + item.weight, 0);
    const risk = riskFactors.reduce((sum, item) => sum + item.weight, 0);
    const range = rangeFactors.reduce((sum, item) => sum + item.weight, 0);
    const combined = clamp((support - risk) / Math.max(1, support + risk + (range * 0.5)), -1, 1);
    const strongest = (items) => items
      .sort((left, right) => right.weight - left.weight)
      .map((item) => item.reason)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 3);
    return {
      combined,
      support,
      risk,
      range,
      rangePressure: clamp(range / Math.max(1, support + risk + range), 0, 0.85),
      adjustment: combined * 0.06,
      uncertainty: clamp((Math.min(support, risk) * 0.015) + ((crisisScore / 100) * 0.03), 0, 0.06),
      supportReasons: strongest(supportFactors),
      riskReasons: strongest(riskFactors),
      rangeReasons: strongest(rangeFactors),
      leadingPhase,
      policyRateChange,
      exportGrowth,
      crisisScore,
      macd,
      adrLatest,
      adrChange28,
      adrRecentHigh,
      adrRecentLow,
    };
  }

  function candidateWindowReturn(candidate, dates, window) {
    if (!candidate || !Array.isArray(dates) || dates.length <= window) return null;
    const values = marketPriceSeries(candidate, dates);
    const latest = finite(values.at(-1));
    const previous = finite(values.at(-(window + 1)));
    return latest > 0 && previous > 0 ? Math.log(latest / previous) : null;
  }

  function buildRotationSignal(options, series, dates, prices, priceRegime) {
    const target = String(series || "").toUpperCase();
    const empty = {
      adjustment: 0,
      support: 0,
      risk: 0,
      rangePressure: 0,
      supportReasons: [],
      riskReasons: [],
      leaderCooling: 0,
      coverage: 0,
    };
    if (!target.endsWith(".KS") && target !== "^KS11") return empty;
    const marketCandidates = Array.isArray(options?.marketCandidates) ? options.marketCandidates : [];
    const benchmark = marketCandidates.find((candidate) => String(candidate?.series || "").toUpperCase() === "^KS11");
    if (!benchmark) return empty;
    const leaderTickers = new Set(["005930.KS", "000660.KS"]);
    const rotationCandidates = (Array.isArray(options?.rotationCandidates) ? options.rotationCandidates : [])
      .filter((candidate) => leaderTickers.has(String(candidate?.series || "").toUpperCase()));
    const leaders = rotationCandidates.map((candidate) => {
      const longReturn = candidateWindowReturn(candidate, dates, 126);
      const shortReturn = candidateWindowReturn(candidate, dates, 20);
      const benchmarkLong = candidateWindowReturn(benchmark, dates, 126);
      const benchmarkShort = candidateWindowReturn(benchmark, dates, 20);
      if (![longReturn, shortReturn, benchmarkLong, benchmarkShort].every(Number.isFinite)) return null;
      return {
        series: String(candidate.series || "").toUpperCase(),
        longRelative: longReturn - benchmarkLong,
        shortRelative: shortReturn - benchmarkShort,
      };
    }).filter(Boolean);
    if (!leaders.length) return empty;
    const coverage = clamp(leaders.length / leaderTickers.size, 0, 1);
    const leaderLong = mean(leaders.map((item) => item.longRelative));
    const leaderShort = mean(leaders.map((item) => item.shortRelative));
    const expectedShort = leaderLong * (20 / 126);
    const leaderCooling = leaderLong > 0.03
      ? clamp((expectedShort - leaderShort) / 0.05, 0, 1) * coverage
      : 0;
    if (leaderCooling <= 0) return { ...empty, coverage, leaderCooling, leaderLong, leaderShort };

    const isLeader = leaderTickers.has(target);
    if (isLeader) {
      return {
        ...empty,
        adjustment: -0.018 * leaderCooling,
        risk: leaderCooling,
        rangePressure: 0.15 * leaderCooling,
        riskReasons: ["반도체 주도주 모멘텀 둔화"],
        leaderCooling,
        leaderLong,
        leaderShort,
        coverage,
      };
    }
    const targetCandidate = { series: target, dates, prices };
    const targetLong = candidateWindowReturn(targetCandidate, dates, 126);
    const targetShort = candidateWindowReturn(targetCandidate, dates, 20);
    const benchmarkLong = candidateWindowReturn(benchmark, dates, 126);
    const benchmarkShort = candidateWindowReturn(benchmark, dates, 20);
    if (![targetLong, targetShort, benchmarkLong, benchmarkShort].every(Number.isFinite)) {
      return { ...empty, coverage, leaderCooling, leaderLong, leaderShort };
    }
    const longRelative = targetLong - benchmarkLong;
    const shortRelative = targetShort - benchmarkShort;
    const participation = clamp((shortRelative - (longRelative * (20 / 126)) + 0.025) / 0.08, 0, 1);
    const support = leaderCooling * clamp(priceRegime?.rangeBoundScore || 0, 0, 1) * participation;
    return {
      ...empty,
      adjustment: 0.015 * support,
      support,
      rangePressure: 0.25 * leaderCooling,
      supportReasons: support > 0.08 ? ["반도체 집중 완화·순환매 가능성"] : [],
      leaderCooling,
      leaderLong,
      leaderShort,
      targetLongRelative: longRelative,
      targetShortRelative: shortRelative,
      coverage,
    };
  }

  const forecastScenarioModule = globalScope.ThinkStockAiForecastScenarios;
  if (!forecastScenarioModule) throw new Error("AI forecast scenario module failed to load");
  const forecastScenarioEngine = forecastScenarioModule.createForecastScenarioEngine({
    EPSILON,
    clamp,
    finite,
    neighborPrediction,
    scenarioPathEngine,
    standardDeviation,
  });
  const {
    buildForecastScenarios,
    interpolateAnchors,
    nearestPathSamples,
    residualPath,
  } = forecastScenarioEngine;

  function chartTransformer(options, lastPrice, lastChartValue) {
    const prices = Array.isArray(options?.transformPrices) ? options.transformPrices : options?.prices;
    const values = Array.isArray(options?.transformChartValues)
      ? options.transformChartValues
      : (Array.isArray(options?.chartValues) ? options.chartValues : prices);
    const pairs = [];
    for (let index = 0; index < Math.min(prices?.length || 0, values?.length || 0); index += 1) {
      const price = finite(prices[index]);
      const value = finite(values[index]);
      if (price > 0 && value !== null) pairs.push({ price, value });
    }
    const recent = pairs.slice(-126);
    const priceMean = mean(recent.map((item) => item.price));
    const valueMean = mean(recent.map((item) => item.value));
    const priceVariance = recent.reduce((sum, item) => sum + ((item.price - priceMean) ** 2), 0);
    const covariance = recent.reduce((sum, item) => (
      sum + ((item.price - priceMean) * (item.value - valueMean))
    ), 0);
    const slope = priceVariance > EPSILON ? covariance / priceVariance : 1;
    return (price) => lastChartValue + ((price - lastPrice) * slope);
  }

  function latestChartAnchor(options, fallbackPrice) {
    const prices = Array.isArray(options?.transformPrices) ? options.transformPrices : options?.prices;
    const values = Array.isArray(options?.transformChartValues)
      ? options.transformChartValues
      : (Array.isArray(options?.chartValues) ? options.chartValues : prices);
    for (let index = Math.min(prices?.length || 0, values?.length || 0) - 1; index >= 0; index -= 1) {
      const price = finite(prices[index]);
      const value = finite(values[index]);
      if (price > 0 && value !== null) return { price, value };
    }
    return { price: fallbackPrice, value: fallbackPrice };
  }

  function updateFingerprintHash(hash, value) {
    const text = String(value ?? "");
    let next = hash >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      next ^= text.charCodeAt(index);
      next = Math.imul(next, 16777619) >>> 0;
    }
    return next;
  }

  function seriesHistoryFingerprint(rows, keys, lastDate, availabilityLagDays = 0) {
    const source = Array.isArray(rows) ? rows : [];
    const cutoff = String(lastDate || "9999-99-99").slice(0, 10);
    return (Array.isArray(keys) ? keys : []).map((key) => {
      let hash = 2166136261;
      const recent = [];
      let count = 0;
      source.forEach((row) => {
        const date = String(row?.date || "").slice(0, 10);
        const value = finite(row?.[key]);
        const availableDate = availabilityLagDays > 0
          ? shiftIsoDate(date, availabilityLagDays)
          : date;
        if (value === null || (availableDate && availableDate > cutoff)) return;
        hash = updateFingerprintHash(hash, `${date}:${value}|`);
        count += 1;
        recent.push([date, value]);
        if (recent.length > 8) recent.shift();
      });
      return [key, count, hash.toString(36), recent];
    });
  }

  function latestAuditFeatures(rows, keys, prefix, lastDate) {
    const source = Array.isArray(rows) ? rows : [];
    return Object.fromEntries((Array.isArray(keys) ? keys : []).flatMap((key) => {
      for (let index = source.length - 1; index >= 0; index -= 1) {
        const value = finite(source[index]?.[key]);
        if (value === null) continue;
        const date = String(source[index]?.date || "").slice(0, 10);
        if (date && date > String(lastDate || "9999-99-99")) continue;
        return [
          [`${prefix}_${key}`, value],
          [`${prefix}_${key}_age_days`, daysBetweenDates(date, lastDate)],
        ];
      }
      return [];
    }));
  }

  function latestSourceDate(rows, lastDate) {
    const cutoff = String(lastDate || "9999-99-99").slice(0, 10);
    return (Array.isArray(rows) ? rows : []).reduce((latest, row) => {
      const date = String(
        row?.date || row?.asOfDate || row?.reportDate || row?.report_date || row?.fetchedAt || "",
      ).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= cutoff && date > latest ? date : latest;
    }, "");
  }

  function sourceCountAsOf(rows, lastDate) {
    const cutoff = String(lastDate || "9999-99-99").slice(0, 10);
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const date = String(
        row?.date || row?.asOfDate || row?.reportDate || row?.report_date || row?.fetchedAt || "",
      ).slice(0, 10);
      return !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= cutoff;
    }).length;
  }

  function forecastDecisionDate(options, priceDate) {
    const latestPriceDate = String(priceDate || "").slice(0, 10);
    const requested = String(options?.decisionDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) return latestPriceDate;
    return requested > latestPriceDate ? requested : latestPriceDate;
  }

  function latestCandidateSourceDate(candidates, lastDate) {
    return (Array.isArray(candidates) ? candidates : []).reduce((latest, candidate) => {
      const date = latestSourceDate((candidate?.dates || []).map((value) => ({ date: value })), lastDate);
      return date > latest ? date : latest;
    }, "");
  }

  function numericHistoryFingerprint(values, dates = []) {
    const source = Array.isArray(values) ? values : [];
    if (!source.length) return [];
    const dateSource = Array.isArray(dates) ? dates : [];
    let hash = 2166136261;
    source.forEach((value, index) => {
      hash = updateFingerprintHash(
        hash,
        `${String(dateSource[index] || "").slice(0, 10)}:${finite(value)}|`,
      );
    });
    const indexes = [...new Set([
      0,
      Math.floor((source.length - 1) * 0.25),
      Math.floor((source.length - 1) * 0.5),
      Math.floor((source.length - 1) * 0.75),
      source.length - 1,
    ])];
    const recentStart = Math.max(0, source.length - 16);
    const recent = source.slice(recentStart).map((value, offset) => [
      String(dateSource[recentStart + offset] || "").slice(0, 10),
      finite(value),
    ]);
    return [
      source.length,
      hash.toString(36),
      indexes.map((index) => finite(source[index])),
      recent,
    ];
  }

  function disclosureRiskFingerprint(options, lastDate) {
    const target = String(options?.series || "").trim().toUpperCase();
    return (Array.isArray(options?.disclosures) ? options.disclosures : [])
      .filter((row) => (
        String(row?.ticker || "").trim().toUpperCase() === target
        && String(row?.date || "").slice(0, 10) <= String(lastDate || "9999-99-99")
      ))
      .sort((left, right) => String(left.date).localeCompare(String(right.date)))
      .slice(-24)
      .map((row) => [String(row?.date || "").slice(0, 10), String(row?.title || row?.report_nm || "")]);
  }

  function internetNewsFingerprint(options, lastDate) {
    const rows = newsEvidenceEngine?.normalizeAnalysisNewsEvidence
      ? newsEvidenceEngine.normalizeAnalysisNewsEvidence(options?.internetNews, {
        ticker: String(options?.series || "005930.KS"),
        requireTrustedUrl: false,
        maximumRows: 40,
      })
      : (Array.isArray(options?.internetNews) ? options.internetNews : []);
    return rows
      .filter((row) => String(row?.date || "").slice(0, 10) <= String(lastDate || "9999-99-99"))
      .sort((left, right) => String(left.date).localeCompare(String(right.date)))
      .slice(-40)
      .map((row) => [String(row?.date || "").slice(0, 10), String(row?.title || "")]);
  }

  function forecastCacheKey(options, points) {
    const market = (Array.isArray(options?.marketCandidates) ? options.marketCandidates : []).map((item) => [
      item?.series,
      item?.dates?.at?.(-1),
      numericHistoryFingerprint(item?.prices, item?.dates),
    ]);
    const rotation = (Array.isArray(options?.rotationCandidates) ? options.rotationCandidates : []).map((item) => [
      item?.series,
      item?.dates?.at?.(-1),
      numericHistoryFingerprint(item?.prices, item?.dates),
    ]);
    const lastDate = points.at(-1)?.date;
    const decisionDate = forecastDecisionDate(options, lastDate);
    return JSON.stringify([
      FORECAST_PATH_VERSION,
      options?.series,
      lastDate,
      decisionDate,
      numericHistoryFingerprint(
        points.map((point) => point.price),
        points.map((point) => point.date),
      ),
      market,
      rotation,
      seriesHistoryFingerprint(options?.macroRows, ["leading_cycle", "news_sentiment", "policy_rate", "export_value", "import_value"], lastDate),
      seriesHistoryFingerprint(options?.auxiliaryRows, ["adr", "adr_kospi", "adr_kosdaq", "fear_greed"], lastDate),
      options?.koreanVolatilityCandidate === true ? [
        seriesHistoryFingerprint(options?.auxiliaryRows, ["vkospi"], lastDate, 1),
        seriesHistoryFingerprint(options?.crisisRows, ["vkospi"], lastDate, 1),
      ] : null,
      options?.externalRiskCandidates === true
        ? seriesHistoryFingerprint(options?.auxiliaryRows, ["vix"], lastDate, 1)
        : null,
      seriesHistoryFingerprint(options?.creditRows, ["customer_deposit", "kospi_credit", "kosdaq_credit"], lastDate),
      seriesHistoryFingerprint(options?.crisisRows, ["score", "curve", "labor", "credit", "fedFunds", "fedFundsChange6m", "vix", "vixChange20", "krwUsd", "krwUsdChange20"], lastDate),
      options?.koreanVolatilityCandidate === true,
      options?.externalRiskCandidates === true,
      disclosureRiskFingerprint(options, decisionDate),
      internetNewsFingerprint(options, decisionDate),
      options?.consensus || null,
      (Array.isArray(options?.financials) ? options.financials : []).slice(-6),
      options?.brokerResearch ? {
        latestDate: options.brokerResearch.latestDate,
        latestAvailableDate: options.brokerResearch.latestAvailableDate,
        usedReportIds: options.brokerResearch.usedReportIds,
        signal: options.brokerResearch.signal,
        confidence: options.brokerResearch.confidence,
        primaryConflict: options.brokerResearch.primaryConflict,
        targetRevisionChange: options.brokerResearch.targetRevisionChange,
        metrics: options.brokerResearch.metrics,
      } : null,
      finite(options?.macdSignal),
      options?.marketModel?.generated_at || options?.marketModel?.generatedAt || null,
    ]);
  }

  function getForecastInputKey(options = {}) {
    const points = cleanPriceHistory(options);
    if (!isForecastSeries(options.series) || points.length < MIN_HISTORY) return "";
    return forecastCacheKey(options, points);
  }

  function rememberForecast(key, forecast) {
    FORECAST_CACHE.set(key, forecast);
    while (FORECAST_CACHE.size > 12) FORECAST_CACHE.delete(FORECAST_CACHE.keys().next().value);
  }

  function applyChartTransform(forecast, options) {
    const lastPrice = forecast.prices[0];
    const anchor = latestChartAnchor(options, lastPrice);
    const transform = chartTransformer(options, anchor.price, anchor.value);
    return {
      ...forecast,
      chartValues: forecast.prices.map(transform),
      lowerChartValues: forecast.lowerPrices.map(transform),
      upperChartValues: forecast.upperPrices.map(transform),
      scenarios: Object.fromEntries(Object.entries(forecast.scenarios || {}).map(([key, scenario]) => [
        key,
        scenario?.prices
          ? { ...scenario, chartValues: scenario.prices.map(transform) }
          : scenario,
      ])),
    };
  }

  function buildForecast(options = {}) {
    const points = cleanPriceHistory(options);
    if (!isForecastSeries(options.series) || points.length < MIN_HISTORY) return null;
    const cacheKey = forecastCacheKey(options, points);
    const cached = FORECAST_CACHE.get(cacheKey);
    if (cached) return applyChartTransform(cached, options);
    const dates = points.map((point) => point.date);
    const prices = points.map((point) => point.price);
    const decisionDate = forecastDecisionDate(options, dates.at(-1));
    const suppliedStructuralProfile = options.structuralProfile;
    const structuralProfile = suppliedStructuralProfile?.version === contextProfileEngine?.PROFILE_VERSION
      && String(suppliedStructuralProfile.asOfDate || "") <= dates.at(-1)
      ? suppliedStructuralProfile
      : (contextProfileEngine?.buildStructuralStockProfile({
        ...options,
        asOfDate: dates.at(-1),
      }) || null);
    const returns = logarithmicReturns(prices);
    const context = {
      dates,
      prices,
      returns,
      macd: macdOscillator(prices),
      markets: prepareMarketCandidates(options, dates),
      environment: prepareEnvironment(options, dates, options.series),
    };
    const models = FORECAST_HORIZONS.map((horizon) => trainHorizonModel(context, horizon));
    if (models.some((model) => !model)) return null;
    const finalFeature = featureVector(context, prices.length - 1);
    const indexForecast = isMarketIndexSeries(options.series);
    const globalMarketSeries = globalMarketSeriesFor(options.series, options.marketModel);
    const globalFeature = featureVector(context, prices.length - 1, { marketSeries: globalMarketSeries });
    const contextSignal = buildContextSignal(options, options.series, decisionDate, prices.at(-1));
    const corporateRisk = buildCorporateRiskSignal(options, options.series, decisionDate);
    const priceRegime = buildPriceRegimeProfile(
      prices,
      models.at(-1).samples.map((sample) => sample.y),
      finalFeature.volatility,
      { indexForecast },
    );
    const rotation = buildRotationSignal(options, options.series, dates, prices, priceRegime);
    const suppliedMacd = finite(options.macdSignal);
    const marketRegime = buildMarketRegimeSignal({
      ...options,
      macdSignal: suppliedMacd === null ? clamp(finalFeature.features[9] / 3, -1, 1) : suppliedMacd,
    }, options.series, dates.at(-1));
    const contextProfile = contextProfileEngine?.buildForecastContextProfile({
      ...options,
      asOfDate: dates.at(-1),
      marketRegime,
      structuralProfile,
    }) || null;
    const contextProfileFeatures = contextProfileEngine?.contextProfileAuditFeatures(contextProfile) || {};
    const trendUpArchetype = Number(structuralProfile?.scores?.trendUp) >= 0.35;
    const highVolatilityArchetype = Number(structuralProfile?.scores?.highVolatility) >= 0.65;
    const lateCycleRegime = contextProfile?.market?.dominant === "lateCycle";
    const koreanVolatility = buildKoreanVolatilityProfile(
      options,
      options.series,
      dates.at(-1),
    );
    const structuralWeight = clamp(
      (priceRegime.rangeBoundScore * (indexForecast ? 0.35 : 0.55))
        + (marketRegime.rangePressure * (indexForecast ? 0.55 : 0.25))
        + (rotation.rangePressure * 0.1)
        - (rotation.support * 0.15),
      0,
      0.72,
    );
    let marketModelUsed = false;
    const predictions = models.map((model) => {
      const baseCalibration = horizonCalibration(model.horizon, indexForecast);
      const leadingPhase = marketRegime.leadingPhase?.phase || "unknown";
      const neutralCycle = !["peak", "slowdown", "recovery"].includes(leadingPhase);
      const rangeRegime = marketRegime.crisisScore < 50
        && Math.abs(marketRegime.support - marketRegime.risk) < 0.2
        && marketRegime.range >= 0.45;
      const contextualFallback = !indexForecast && (
        (model.horizon === 20 && neutralCycle)
        || (model.horizon === 63 && (neutralCycle || rangeRegime))
        || (model.horizon === 126 && finalFeature.volatility <= 0.014)
      );
      const calibration = contextualFallback && model.horizon === 63
        ? { ...baseCalibration, localScale: 0.5 }
        : baseCalibration;
      const uncalibratedLocal = contextualFallback
        ? fallbackPrediction(finalFeature, model.horizon)
        : predictHorizon(model, finalFeature);
      const local = uncalibratedLocal * calibration.localScale;
      const global = !indexForecast && globalFeature.marketSeries === globalMarketSeries
        ? marketModelPrediction(options.marketModel, model.horizon, globalFeature)
        : null;
      const globalReliability = global
        ? global.reliability * (1 - (priceRegime.rangeBoundScore * 0.5))
        : 0;
      const raw = global
        ? local + ((global.value - local) * globalReliability)
        : local;
      if (global) marketModelUsed = true;
      const labels = model.samples.map((sample) => sample.y);
      const empiricalLow = quantile(labels, 0.05);
      const empiricalHigh = quantile(labels, 0.95);
      const volatilityBound = finalFeature.volatility * Math.sqrt(model.horizon) * 2.5;
      const bounded = clamp(raw, Math.max(empiricalLow, -volatilityBound), Math.min(empiricalHigh, volatilityBound));
      const horizonWeight = model.horizon / 126;
      const hardCorporateRisk = corporateRisk.terminalRisk || corporateRisk.recentDilutionRisk;
      const longHorizonSoftRisk = model.horizon === 126
        && (highVolatilityArchetype || lateCycleRegime);
      const mediumHorizonTrendRisk = model.horizon === 63 && trendUpArchetype;
      const directionalCorporateRiskScale = hardCorporateRisk
        || corporateRisk.recentGovernanceRisk
        || model.horizon <= 20
        || mediumHorizonTrendRisk
        || longHorizonSoftRisk
        ? 1
        : 0;
      const riskGated = bounded > 0
        ? bounded * (1 - (corporateRisk.score * 0.6 * directionalCorporateRiskScale))
        : bounded;
      const regimeWeight = indexForecast ? 1.6 : 1;
      const components = {
        localModel: local,
        top400Blend: raw - local,
        empiricalGuardrail: bounded - raw,
        corporateRiskGate: riskGated - bounded,
        consensus: contextSignal.consensusAdjustment * horizonWeight,
        fundamentals: contextSignal.fundamentalsAdjustment * horizonWeight,
        internetNews: contextSignal.internetNewsAdjustment * horizonWeight,
        brokerResearch: contextSignal.brokerResearchAdjustment * horizonWeight,
        marketRegime: marketRegime.adjustment * regimeWeight * horizonWeight * calibration.regimeScale,
        koreanVolatility: koreanVolatility.indexAdjustment126 * horizonWeight,
        corporateRisk: corporateRisk.adjustment * horizonWeight * directionalCorporateRiskScale,
        rotation: rotation.adjustment * horizonWeight,
      };
      const beforeStructural = Object.values(components).reduce((sum, value) => sum + value, 0);
      const structuralTarget = priceRegime.meanReversionReturn * horizonWeight;
      const rawAfterStructural = (beforeStructural * (1 - structuralWeight))
        + (structuralTarget * structuralWeight);
      components.rangeMeanReversion = (rawAfterStructural - beforeStructural) * calibration.rangeScale;
      const afterStructural = beforeStructural + components.rangeMeanReversion;
      const corporateRiskFloor = corporateRisk.terminalRisk ? -0.1 : -0.06;
      const afterTerminalRisk = hardCorporateRisk
        ? Math.min(afterStructural, corporateRiskFloor * horizonWeight)
        : afterStructural;
      components.terminalRisk = afterTerminalRisk - afterStructural;
      const criticalNewsFloor = -0.12
        * Math.max(0.5, Number(contextSignal.internetNewsCriticalSeverity) || 0)
        * horizonWeight;
      const afterCriticalNews = contextSignal.internetNewsCriticalRisk
        ? Math.min(afterTerminalRisk, criticalNewsFloor)
        : afterTerminalRisk;
      components.criticalNewsGate = afterCriticalNews - afterTerminalRisk;
      const adjusted = clamp(afterCriticalNews, -volatilityBound * 1.15, volatilityBound * 1.15);
      components.finalClamp = adjusted - afterCriticalNews;
      const baseUncertainty = Math.max(model.residual68, global?.residual80 || 0)
        + ((corporateRisk.uncertainty + marketRegime.uncertainty
          + ((Number(contextSignal.internetNewsCriticalSeverity) || 0) * 0.05)
          + Math.min(0.03, (Number(contextSignal.internetNewsAmbiguousRows) || 0) * 0.008))
          * Math.sqrt(horizonWeight));
      return {
        day: model.horizon,
        value: adjusted,
        components,
        calibration,
        localMode: contextualFallback ? "contextual-fallback" : "skill-gated",
        uncalibratedLocal,
        uncertainty: baseUncertainty,
        intervalUncertainty: baseUncertainty
          * (1 + (koreanVolatility.intervalExpansion * Math.sqrt(horizonWeight))),
      };
    });
    const anchors = [{ day: 0, value: 0 }, ...predictions];
    const uncertaintyAnchors = [{ day: 0, value: 0 }, ...predictions.map((item) => ({
      day: item.day,
      value: item.uncertainty,
    }))];
    const intervalUncertaintyAnchors = [{ day: 0, value: 0 }, ...predictions.map((item) => ({
      day: item.day,
      value: item.intervalUncertainty,
    }))];
    const pathCandidates = nearestPathSamples(
      models.at(-1),
      finalFeature,
      indexForecast ? 180 : 96,
    );
    const pathLibrary = scenarioPathEngine?.buildHistoricalPathLibrary({
      prices: context.prices,
      candidates: pathCandidates,
      horizon: 126,
      projectedVolatility: finalFeature.volatility,
    }) || null;
    const residual = residualPath(context, finalFeature, models.at(-1), 126, pathCandidates);
    const cumulative = Array.from({ length: 127 }, (_, day) => (
      interpolateAnchors(anchors, day) + residual[day]
    ));
    const componentKeys = Object.keys(predictions[0].components);
    const componentAnchors = Object.fromEntries(componentKeys.map((key) => [
      key,
      [{ day: 0, value: 0 }, ...predictions.map((item) => ({
        day: item.day,
        value: item.components[key],
      }))],
    ]));
    const attributionHorizons = Object.fromEntries(FORECAST_AUDIT_HORIZONS.map((day) => [
      day,
      {
        days: day,
        expectedLogReturn: cumulative[day],
        components: {
          ...Object.fromEntries(componentKeys.map((key) => [
            key,
            interpolateAnchors(componentAnchors[key], day),
          ])),
          analogPath: residual[day] || 0,
        },
      },
    ]));
    const uncertainty = Array.from({ length: 127 }, (_, day) => interpolateAnchors(uncertaintyAnchors, day));
    const intervalUncertainty = Array.from(
      { length: 127 },
      (_, day) => interpolateAnchors(intervalUncertaintyAnchors, day),
    );
    const forecastPrices = cumulative.map((value) => prices.at(-1) * Math.exp(value));
    const lowerPrices = cumulative.map((value, day) => (
      prices.at(-1) * Math.exp(value - intervalUncertainty[day])
    ));
    const upperPrices = cumulative.map((value, day) => (
      prices.at(-1) * Math.exp(value + intervalUncertainty[day])
    ));
    const validationSamples = models.reduce((sum, model) => sum + model.validationSamples, 0);
    const weightedAccuracy = models.reduce((sum, model) => (
      sum + (model.metrics.directionAccuracy * model.validationSamples)
    ), 0) / validationSamples;
    const weightedMae = models.reduce((sum, model) => (
      sum + (model.metrics.mae * model.validationSamples)
    ), 0) / validationSamples;
    const weightedImprovement = models.reduce((sum, model) => (
      sum + (Math.max(0, model.metrics.improvement) * model.validationSamples)
    ), 0) / validationSamples;
    const confidence = clamp(
      0.15 + (Math.max(0, weightedAccuracy - 0.5) * 1.5) + (weightedImprovement * 0.5),
      0.1,
      0.8,
    );
    const scenarioCorporateRisk = corporateRisk.terminalRisk || corporateRisk.recentDilutionRisk
      ? corporateRisk
      : { ...corporateRisk, score: 0, adjustment: 0 };
    const scenarios = buildForecastScenarios({
      basePrice: prices.at(-1),
      cumulative,
      uncertainty,
      residual,
      projectedVolatility: finalFeature.volatility,
      confidence,
      contextSignal,
      marketRegime,
      corporateRisk: scenarioCorporateRisk,
      priceRegime,
      rotation,
      recentMomentum: finalFeature.momentum?.[20],
      mediumMomentum: finalFeature.momentum?.[63],
      probabilitySignalStrength: indexForecast ? 1 : (marketModelUsed ? 0.5 : 0.25),
      sidewaysProbabilityScale: indexForecast ? 1 : 0.7,
      pathLibrary,
    });
    const market = selectMarketAt(returns, context.markets, prices.length - 1);
    const selectedMarketSeries = String(market?.market?.series || "").toUpperCase();
    const leadingPhase = marketRegime.leadingPhase?.phase || "neutral";
    const sourceDates = Object.freeze({
      price: dates.at(-1),
      market: latestCandidateSourceDate(options?.marketCandidates, dates.at(-1)),
      rotation: latestCandidateSourceDate(options?.rotationCandidates, dates.at(-1)),
      macro: latestSourceDate(options?.macroRows, dates.at(-1)),
      auxiliary: latestSourceDate(options?.auxiliaryRows, dates.at(-1)),
      vkospi: koreanVolatility.latestDate,
      credit: latestSourceDate(options?.creditRows, dates.at(-1)),
      crisis: latestSourceDate(options?.crisisRows, dates.at(-1)),
      disclosure: latestSourceDate(options?.disclosures, decisionDate),
      internetNews: latestSourceDate(options?.internetNews, decisionDate),
      consensus: latestSourceDate(options?.consensus ? [options.consensus] : [], decisionDate),
      financials: latestSourceDate(options?.financials, decisionDate),
      brokerResearch: String(
        options?.brokerResearch?.latestAvailableDate || options?.brokerResearch?.latestDate || "",
      ).slice(0, 10),
    });
    const featureFamilies = Object.freeze({
      price: Object.freeze({ count: points.length, latestDate: sourceDates.price }),
      market: Object.freeze({ count: context.markets.length, latestDate: sourceDates.market }),
      macro: Object.freeze({
        count: sourceCountAsOf(options?.macroRows, decisionDate),
        latestDate: sourceDates.macro,
      }),
      auxiliary: Object.freeze({
        count: sourceCountAsOf(options?.auxiliaryRows, decisionDate),
        latestDate: sourceDates.auxiliary,
      }),
      credit: Object.freeze({
        count: sourceCountAsOf(options?.creditRows, decisionDate),
        latestDate: sourceDates.credit,
      }),
      crisis: Object.freeze({
        count: sourceCountAsOf(options?.crisisRows, decisionDate),
        latestDate: sourceDates.crisis,
      }),
      disclosures: Object.freeze({
        count: sourceCountAsOf(options?.disclosures, decisionDate),
        latestDate: sourceDates.disclosure,
      }),
      consensus: Object.freeze({
        count: options?.consensus ? 1 : 0,
        latestDate: sourceDates.consensus,
      }),
      financials: Object.freeze({
        count: sourceCountAsOf(options?.financials, decisionDate),
        latestDate: sourceDates.financials,
      }),
      internetNews: Object.freeze({
        count: sourceCountAsOf(options?.internetNews, decisionDate),
        latestDate: sourceDates.internetNews,
      }),
      brokerResearch: Object.freeze({
        count: Math.max(0, Number(options?.brokerResearch?.reportCount) || 0),
        latestDate: sourceDates.brokerResearch,
      }),
    });
    const audit = {
      format: "ai-audit-v1",
      asOfDate: decisionDate,
      priceAsOfDate: dates.at(-1),
      sourceDates,
      featureFamilies,
      features: compactAuditMap({
        ...Object.fromEntries(finalFeature.features.map((value, index) => [
          `model_feature_${String(index).padStart(2, "0")}`,
          value,
        ])),
        ...Object.fromEntries(Object.entries(finalFeature.momentum || {}).map(([window, value]) => [
          `price_momentum_${window}`,
          value,
        ])),
        ...latestAuditFeatures(
          options?.macroRows,
          ["leading_cycle", "news_sentiment", "policy_rate", "export_value", "import_value"],
          "macro",
          dates.at(-1),
        ),
        ...latestAuditFeatures(
          options?.auxiliaryRows,
          ["adr", "adr_kospi", "adr_kosdaq", "fear_greed"],
          "aux",
          dates.at(-1),
        ),
        ...latestAuditFeatures(
          options?.creditRows,
          ["customer_deposit", "kospi_credit", "kosdaq_credit"],
          "credit",
          dates.at(-1),
        ),
        ...latestAuditFeatures(
          options?.crisisRows,
          ["score", "curve", "labor", "credit", "fedFunds", "fedFundsChange6m", "vix", "vixChange20", "krwUsd", "krwUsdChange20"],
          "crisis",
          dates.at(-1),
        ),
        projected_volatility: finalFeature.volatility,
        environment_coverage: finalFeature.environmentCoverage,
        environment_combined: finalFeature.environmentCombined,
        market_correlation: market?.relationship?.correlation,
        market_beta: market?.relationship?.beta,
        market_downside_beta: market?.relationship?.downsideBeta,
        market_is_kospi: selectedMarketSeries === "^KS11" ? 1 : 0,
        market_is_kosdaq: selectedMarketSeries === "^KQ11" ? 1 : 0,
        consensus_signal: contextSignal.consensus,
        consensus_confidence: contextSignal.consensusConfidence,
        consensus_adjustment: contextSignal.consensusAdjustment,
        fundamentals_signal: contextSignal.fundamentals,
        fundamentals_confidence: contextSignal.fundamentalsConfidence,
        fundamentals_adjustment: contextSignal.fundamentalsAdjustment,
        internet_news_signal: contextSignal.internetNews,
        internet_news_confidence: contextSignal.internetNewsConfidence,
        internet_news_adjustment: contextSignal.internetNewsAdjustment,
        internet_news_critical_risk: contextSignal.internetNewsCriticalRisk ? 1 : 0,
        internet_news_critical_severity: contextSignal.internetNewsCriticalSeverity,
        internet_news_critical_rows: contextSignal.internetNewsCriticalRows,
        internet_news_ambiguous_rows: contextSignal.internetNewsAmbiguousRows,
        broker_research_signal: contextSignal.brokerResearch,
        broker_research_confidence: contextSignal.brokerResearchConfidence,
        broker_research_adjustment: contextSignal.brokerResearchAdjustment,
        broker_research_reports: contextSignal.brokerResearchReports,
        broker_research_primary_coverage: contextSignal.brokerResearchPrimaryCoverage,
        broker_research_target_revision: contextSignal.brokerResearchTargetRevision,
        broker_research_conflict: contextSignal.brokerResearchConflict ? 1 : 0,
        corporate_risk_score: corporateRisk.score,
        corporate_risk_adjustment: corporateRisk.adjustment,
        corporate_terminal_risk: corporateRisk.terminalRisk ? 1 : 0,
        corporate_recent_dilution_risk: corporateRisk.recentDilutionRisk ? 1 : 0,
        corporate_recent_governance_risk: corporateRisk.recentGovernanceRisk ? 1 : 0,
        regime_support: marketRegime.support,
        regime_risk: marketRegime.risk,
        regime_range: marketRegime.range,
        regime_combined: marketRegime.combined,
        regime_range_pressure: marketRegime.rangePressure,
        regime_adjustment: marketRegime.adjustment,
        regime_uncertainty: marketRegime.uncertainty,
        ...contextProfileFeatures,
        vkospi_latest: koreanVolatility.latest,
        vkospi_age_days: koreanVolatility.ageDays,
        vkospi_z_score: koreanVolatility.zScore,
        vkospi_percentile: koreanVolatility.percentile,
        vkospi_change_20d: koreanVolatility.change20,
        vkospi_stress: koreanVolatility.stress,
        vkospi_complacency: koreanVolatility.complacency,
        vkospi_interval_expansion: koreanVolatility.intervalExpansion,
        vkospi_directional_weight: koreanVolatility.directionalWeight,
        vkospi_index_adjustment_126d: koreanVolatility.indexAdjustment126,
        regime_crisis_score: marketRegime.crisisScore,
        regime_macd: marketRegime.macd,
        adr_latest: marketRegime.adrLatest,
        adr_change_28d: marketRegime.adrChange28,
        adr_recent_high_28d: marketRegime.adrRecentHigh,
        adr_recent_low_28d: marketRegime.adrRecentLow,
        adr_overheat_recent_28d: Number.isFinite(marketRegime.adrRecentHigh)
          ? (marketRegime.adrRecentHigh >= 120 ? 1 : 0)
          : null,
        adr_depressed_recent_28d: Number.isFinite(marketRegime.adrRecentLow)
          ? (marketRegime.adrRecentLow <= 75 ? 1 : 0)
          : null,
        adr_overheat_current: Number.isFinite(marketRegime.adrLatest)
          ? (marketRegime.adrLatest >= 120 ? 1 : 0)
          : null,
        adr_overheat_exit_28d: Number.isFinite(marketRegime.adrLatest)
          && Number.isFinite(marketRegime.adrRecentHigh)
          ? (marketRegime.adrRecentHigh >= 120 && marketRegime.adrLatest < 120 ? 1 : 0)
          : null,
        adr_depressed_current: Number.isFinite(marketRegime.adrLatest)
          ? (marketRegime.adrLatest <= 75 ? 1 : 0)
          : null,
        adr_depression_exit_28d: Number.isFinite(marketRegime.adrLatest)
          && Number.isFinite(marketRegime.adrRecentLow)
          ? (marketRegime.adrRecentLow <= 75 && marketRegime.adrLatest > 75 ? 1 : 0)
          : null,
        leading_peak: leadingPhase === "peak" ? 1 : 0,
        leading_slowdown: leadingPhase === "slowdown" ? 1 : 0,
        leading_recovery: leadingPhase === "recovery" ? 1 : 0,
        leading_expansion: leadingPhase === "expansion" ? 1 : 0,
        leading_recent_delta: marketRegime.leadingPhase?.recentDelta,
        leading_previous_delta: marketRegime.leadingPhase?.previousDelta,
        price_range_bound_score: priceRegime.rangeBoundScore,
        price_range_position: priceRegime.position,
        price_mean_reversion_return: priceRegime.meanReversionReturn,
        price_annualized_return: priceRegime.annualizedReturn,
        price_trend_r_squared: priceRegime.trendRSquared,
        price_breakout_strength: priceRegime.breakoutStrength,
        price_shock_active: priceRegime.shortTermShock?.active ? 1 : 0,
        price_shock_signed_strength: priceRegime.shortTermShock?.signedStrength,
        price_shock_age: priceRegime.shortTermShock?.age,
        price_shock_event_move: priceRegime.shortTermShock?.eventMovePct,
        price_shock_latest_move: priceRegime.shortTermShock?.latestMovePct,
        price_shock_cumulative_5d: priceRegime.shortTermShock?.cumulative5Pct,
        price_shock_extreme_count: priceRegime.shortTermShock?.extremeCount,
        rotation_support: rotation.support,
        rotation_risk: rotation.risk,
        rotation_adjustment: rotation.adjustment,
        rotation_leader_cooling: rotation.leaderCooling,
        structural_weight: structuralWeight,
        local_scale_20: horizonCalibration(20, indexForecast).localScale,
        local_scale_63: horizonCalibration(63, indexForecast).localScale,
        local_scale_126: horizonCalibration(126, indexForecast).localScale,
        regime_scale_20: horizonCalibration(20, indexForecast).regimeScale,
        regime_scale_63: horizonCalibration(63, indexForecast).regimeScale,
        regime_scale_126: horizonCalibration(126, indexForecast).regimeScale,
        range_scale_20: horizonCalibration(20, indexForecast).rangeScale,
        range_scale_63: horizonCalibration(63, indexForecast).rangeScale,
        range_scale_126: horizonCalibration(126, indexForecast).rangeScale,
      }),
      sources: compactAuditMap({
        price_rows: points.length,
        market_series: context.markets.length,
        macro_rows: Array.isArray(options?.macroRows) ? options.macroRows.length : 0,
        auxiliary_rows: Array.isArray(options?.auxiliaryRows) ? options.auxiliaryRows.length : 0,
        vkospi_rows: koreanVolatility.rowCount,
        credit_rows: Array.isArray(options?.creditRows) ? options.creditRows.length : 0,
        crisis_rows: Array.isArray(options?.crisisRows) ? options.crisisRows.length : 0,
        disclosure_rows: corporateRisk.disclosureCount,
        financial_rows: contextSignal.financialPeriods,
        consensus_institutions: contextSignal.consensusInstitutions,
        rotation_series: Array.isArray(options?.rotationCandidates) ? options.rotationCandidates.length : 0,
        path_analog_rows: pathLibrary?.sampleCount || 0,
        internet_news_rows: contextSignal.internetNewsRows,
        internet_news_mentions: contextSignal.internetNewsMentions,
        analyst_report_rows: 0,
      }),
      scenarioWeights: compactAuditMap({
        upside: scenarios.upside?.weight,
        sideways: scenarios.sideways?.weight,
        downside: scenarios.downside?.weight,
      }),
    };
    const forecast = {
      decisionDate,
      dates: [dates.at(-1), ...nextBusinessDates(dates.at(-1), 126)],
      prices: forecastPrices,
      lowerPrices,
      upperPrices,
      scenarios,
      validation: {
        status: "experimental",
        label: "실험 단계",
        calibratedProbability: false,
        benchmarkOutperformanceConfirmed: false,
        note: "상대 시나리오 가중치이며 실제 확률이 아님",
      },
      attribution: {
        format: "ai-attribution-v1",
        horizons: attributionHorizons,
      },
      audit,
      historyDays: points.length,
      projectedVolatility: finalFeature.volatility,
      patternMatches: pathLibrary?.sampleCount || 0,
      model: {
        name: marketModelUsed
          ? "calibrated risk-gated top-400 + purged local ensemble"
          : (indexForecast
            ? "macro-regime purged index ensemble"
            : "calibrated risk-gated purged multi-horizon ensemble"),
        version: `${String(
          options.marketModel?.generated_at
          || options.marketModel?.generatedAt
          || "local",
        )}|${FORECAST_PATH_VERSION}`,
        pathVersion: FORECAST_PATH_VERSION,
        contextProfileVersion: contextProfile?.version || "",
        contextProfileDiagnosticOnly: contextProfile?.diagnosticOnly === true,
        marketModelUsed,
        globalMarketSeries: marketModelUsed ? globalMarketSeries : "",
        horizons: models.map((item) => ({
          days: item.horizon,
          kind: item.kind,
          lambda: item.lambda,
          neighborWeight: item.neighborWeight,
          predictionScale: item.predictionScale,
          window: item.window,
          multiplier: item.multiplier,
          reliability: item.reliability,
          localMode: predictions.find((prediction) => prediction.day === item.horizon)?.localMode,
          validationSamples: item.validationSamples,
          mae: item.metrics.mae,
          directionAccuracy: item.metrics.directionAccuracy,
          calibration: horizonCalibration(item.horizon, indexForecast),
        })),
      },
      backtest: {
        samples: validationSamples,
        trainingSamples: Math.min(...models.map((model) => model.trainingSamples)),
        validationSamples,
        directionAccuracy: weightedAccuracy,
        meanAbsoluteError: weightedMae,
        improvement: weightedImprovement,
        confidence,
        intervalLevel: 0.8,
      },
      marketRelationship: {
        series: market?.market?.series || "",
        correlation: market?.relationship?.correlation || 0,
        beta: market?.relationship?.beta || 0,
        downsideBeta: market?.relationship?.downsideBeta || 0,
        inverseInDownturn: (market?.relationship?.downsideBeta || 0) < -0.2,
        weight: models.some((model) => model.kind !== "price" && model.kind !== "baseline")
          ? Math.abs(market?.relationship?.correlation || 0)
          : 0,
      },
      marketEnvironment: {
        combined: marketRegime.combined,
        learnedCombined: finalFeature.environmentCombined,
        coverage: finalFeature.environmentCoverage,
        support: marketRegime.support,
        risk: marketRegime.risk,
        range: marketRegime.range,
        rangePressure: marketRegime.rangePressure,
        leadingPhase: marketRegime.leadingPhase,
        crisisScore: marketRegime.crisisScore,
        mode: indexForecast ? "macro-index" : "stock",
        koreanVolatilityCandidateUsed: koreanVolatility.available,
        koreanVolatility,
        externalRiskCandidateUsed: options?.externalRiskCandidates === true
          && context.environment.some((candidate) => ["vix", "krw"].includes(candidate?.name))
          && models.some((model) => model.kind === "all"),
      },
      signals: {
        ...contextSignal,
        macd: marketRegime.macd,
        corporateRisk,
        marketRegime,
        koreanVolatility,
        contextProfile,
        priceRegime,
        rotation,
        structuralWeight,
        forecastMode: indexForecast ? "macro-index" : "stock",
      },
    };
    rememberForecast(cacheKey, forecast);
    return applyChartTransform(forecast, options);
  }

  globalScope.ThinkStockAiForecast = Object.freeze({
    applyChartTransform,
    applyFeatureTransform,
    buildContextSignal,
    buildCorporateRiskSignal,
    buildInternetNewsSignal,
    buildForecast,
    buildForecastScenarios,
    buildKoreanVolatilityProfile,
    buildLeadingCyclePhase,
    buildMarketRegimeSignal,
    buildPriceRegimeProfile,
    buildRotationSignal,
    buildShortTermShockProfile,
    globalMarketSeriesFor,
    getForecastAvailability,
    getForecastInputKey,
    isForecastSeries,
    isMarketIndexSeries,
    marketModelForHorizon,
    nextBusinessDates,
    parseFeatureTransform,
  });
}(typeof self !== "undefined" ? self : globalThis));
