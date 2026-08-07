(function initThinkStockAiForecast(globalScope) {
  "use strict";

  const TRADING_DAYS = 252;
  const MAX_STOCK_HISTORY = TRADING_DAYS * 5;
  const MAX_INDEX_HISTORY = TRADING_DAYS * 25;
  const MIN_HISTORY = TRADING_DAYS * 3;
  const FORECAST_HORIZONS = Object.freeze([20, 63, 126]);
  const FORECAST_AUDIT_HORIZONS = Object.freeze([5, 10, 20, 63, 126]);
  const FORECAST_PATH_VERSION = "path-v10";
  const STOCK_HORIZON_CALIBRATION = Object.freeze({
    20: Object.freeze({ localScale: 0.33, regimeScale: 1, rangeScale: 1 }),
    63: Object.freeze({ localScale: 0.5, regimeScale: 0.25, rangeScale: 1.25 }),
    126: Object.freeze({ localScale: 0.25, regimeScale: 0, rangeScale: 1 }),
  });
  const SAMPLE_STEP = 5;
  const EPSILON = 1e-9;
  const FORECAST_CACHE = new Map();
  const scenarioPathEngine = globalScope.ThinkStockAiScenarioPaths || null;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function compactAuditMap(source) {
    return Object.fromEntries(Object.entries(source || {}).flatMap(([key, value]) => {
      const number = finite(value);
      return number === null ? [] : [[key, Math.round(number * 1e8) / 1e8]];
    }));
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function variance(values, average = mean(values)) {
    if (values.length < 2) return 0;
    return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
  }

  function standardDeviation(values) {
    return Math.sqrt(Math.max(0, variance(values)));
  }

  function quantile(values, probability) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const position = clamp(probability, 0, 1) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] + ((sorted[upper] - sorted[lower]) * weight);
  }

  function pearson(left, right) {
    const size = Math.min(left.length, right.length);
    if (size < 8) return 0;
    const a = left.slice(-size);
    const b = right.slice(-size);
    const aMean = mean(a);
    const bMean = mean(b);
    let covariance = 0;
    let aVariance = 0;
    let bVariance = 0;
    for (let index = 0; index < size; index += 1) {
      const aDelta = a[index] - aMean;
      const bDelta = b[index] - bMean;
      covariance += aDelta * bDelta;
      aVariance += aDelta ** 2;
      bVariance += bDelta ** 2;
    }
    return covariance / Math.sqrt(Math.max(EPSILON, aVariance * bVariance));
  }

  function nextBusinessDates(lastDate, count) {
    const output = [];
    const cursor = new Date(`${lastDate}T00:00:00Z`);
    while (output.length < count) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) output.push(cursor.toISOString().slice(0, 10));
    }
    return output;
  }

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

  function featureIndexes(kind, featureCount) {
    if (kind === "price") return Array.from({ length: Math.min(10, featureCount) }, (_, index) => index);
    if (kind === "market") return Array.from({ length: Math.min(17, featureCount) }, (_, index) => index);
    return Array.from({ length: featureCount }, (_, index) => index);
  }

  function gaussianSolve(matrix, vector) {
    const size = vector.length;
    const augmented = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < size; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < size; row += 1) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
      }
      if (Math.abs(augmented[pivot][column]) < EPSILON) return null;
      [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
      const divisor = augmented[column][column];
      for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
      for (let row = 0; row < size; row += 1) {
        if (row === column) continue;
        const factor = augmented[row][column];
        for (let item = column; item <= size; item += 1) {
          augmented[row][item] -= factor * augmented[column][item];
        }
      }
    }
    return augmented.map((row) => row[size]);
  }

  function fitRidge(samples, indexes, lambda) {
    if (samples.length < 8 || !indexes.length) return null;
    const means = indexes.map((index) => mean(samples.map((sample) => sample.x[index])));
    const deviations = indexes.map((index, position) => Math.max(
      EPSILON,
      standardDeviation(samples.map((sample) => sample.x[index] - means[position])),
    ));
    const dimension = indexes.length + 1;
    const matrix = Array.from({ length: dimension }, () => Array(dimension).fill(0));
    const vector = Array(dimension).fill(0);
    samples.forEach((sample) => {
      const row = [1, ...indexes.map((index, position) => (
        (sample.x[index] - means[position]) / deviations[position]
      ))];
      for (let left = 0; left < dimension; left += 1) {
        vector[left] += row[left] * sample.y;
        for (let right = 0; right < dimension; right += 1) matrix[left][right] += row[left] * row[right];
      }
    });
    for (let index = 1; index < dimension; index += 1) matrix[index][index] += lambda;
    const coefficients = gaussianSolve(matrix, vector);
    return coefficients ? { coefficients, indexes, means, deviations, lambda } : null;
  }

  function ridgePredict(model, features) {
    if (!model) return 0;
    return model.indexes.reduce((prediction, index, position) => (
      prediction + (model.coefficients[position + 1]
        * ((features[index] - model.means[position]) / model.deviations[position]))
    ), model.coefficients[0]);
  }

  function parseFeatureTransform(source) {
    if (source === null || source === undefined) return null;
    if (!source || typeof source !== "object" || source.format !== "random-tanh-v1") return null;
    const inputSize = Number(source.input_size ?? source.inputSize);
    const hiddenSize = Number(source.hidden_size ?? source.hiddenSize);
    const weights = Array.isArray(source.weights)
      ? source.weights.map((row) => (Array.isArray(row) ? row.map(Number) : []))
      : [];
    const biases = Array.isArray(source.biases) ? source.biases.map(Number) : [];
    if (
      !Number.isInteger(inputSize)
      || inputSize <= 0
      || !Number.isInteger(hiddenSize)
      || hiddenSize <= 0
      || weights.length !== inputSize
      || weights.some((row) => row.length !== hiddenSize)
      || biases.length !== hiddenSize
      || [...weights.flat(), ...biases].some((value) => !Number.isFinite(value))
    ) return null;
    return { format: source.format, inputSize, hiddenSize, weights, biases };
  }

  function applyFeatureTransform(features, transform) {
    if (!transform) return features;
    if (features.length < transform.inputSize) return [];
    const hidden = Array.from({ length: transform.hiddenSize }, (_, hiddenIndex) => {
      let value = transform.biases[hiddenIndex];
      for (let inputIndex = 0; inputIndex < transform.inputSize; inputIndex += 1) {
        value += features[inputIndex] * transform.weights[inputIndex][hiddenIndex];
      }
      return Math.tanh(value);
    });
    return [...features, ...hidden];
  }

  function marketModelForHorizon(marketModel, horizon) {
    if (!marketModel || typeof marketModel !== "object") return null;
    const models = marketModel.horizons;
    const source = Array.isArray(models)
      ? models.find((item) => Number(item?.days ?? item?.horizon) === horizon)
      : models?.[String(horizon)];
    if (!source || typeof source !== "object") return null;
    const rawCoefficients = (source.coefficients || []).map(Number);
    const indexes = (source.indexes || source.feature_indexes || marketModel.feature_indexes
      || rawCoefficients.map((_, index) => index))
      .map(Number)
      .filter((value) => Number.isInteger(value) && value >= 0);
    const coefficients = source.intercept !== undefined
      ? [Number(source.intercept), ...rawCoefficients]
      : rawCoefficients;
    const means = (source.means || source.feature_means || []).map(Number);
    const deviations = (
      source.deviations || source.standard_deviations || source.feature_scales || []
    ).map(Number);
    const featureTransform = parseFeatureTransform(source.feature_transform ?? source.featureTransform);
    if ((source.feature_transform ?? source.featureTransform) != null && !featureTransform) return null;
    if (
      !indexes.length
      || coefficients.length !== indexes.length + 1
      || means.length !== indexes.length
      || deviations.length !== indexes.length
      || [...coefficients, ...means, ...deviations].some((value) => !Number.isFinite(value))
      || deviations.some((value) => value <= 0)
    ) return null;
    const metrics = source.metrics && typeof source.metrics === "object" ? source.metrics : {};
    const improvement = finite(metrics.improvement ?? source.improvement) || 0;
    const directionAccuracy = finite(
      metrics.directionAccuracy ?? metrics.direction_accuracy ?? source.direction_accuracy,
    ) || 0;
    const blendWeight = clamp(finite(source.blend_weight ?? source.blendWeight ?? source.reliability) || 0, 0, 1);
    const calibratedReliability = finite(source.reliability);
    const reliability = blendWeight * clamp(
      calibratedReliability === null ? 1 : calibratedReliability,
      0,
      1,
    );
    if (improvement <= 0 || directionAccuracy < 0.5 || reliability <= 0) return null;
    return {
      coefficients,
      indexes,
      means,
      deviations,
      featureTransform,
      blendWeight,
      reliability,
      residual80: Math.max(
        0,
        finite(source.residual80 ?? source.residual_80)
          || Math.max(
            Math.abs(finite(source.residual_interval_80?.lower) || 0),
            Math.abs(finite(source.residual_interval_80?.upper) || 0),
          ),
      ),
      metrics: { improvement, directionAccuracy },
    };
  }

  function marketModelPrediction(marketModel, horizon, feature) {
    const model = marketModelForHorizon(marketModel, horizon);
    if (!model) return null;
    const transformedFeatures = applyFeatureTransform(feature.features, model.featureTransform);
    if (model.indexes.some((index) => !Number.isFinite(transformedFeatures[index]))) return null;
    return {
      value: ridgePredict(model, transformedFeatures),
      reliability: model.reliability,
      residual80: model.residual80,
      metrics: model.metrics,
    };
  }

  function distanceScaler(samples, indexes) {
    return {
      means: indexes.map((index) => mean(samples.map((sample) => sample.x[index]))),
      deviations: indexes.map((index) => Math.max(EPSILON, standardDeviation(samples.map((sample) => sample.x[index])))),
    };
  }

  function neighborPrediction(samples, features, indexes, scaler, count = 12) {
    const nearest = samples.map((sample) => {
      const distance = Math.sqrt(mean(indexes.map((index, position) => (
        ((sample.x[index] - features[index]) / scaler.deviations[position]) ** 2
      ))));
      return { sample, distance };
    }).sort((left, right) => left.distance - right.distance).slice(0, Math.min(count, samples.length));
    let totalWeight = 0;
    let prediction = 0;
    nearest.forEach((item) => {
      const weight = 1 / Math.max(0.1, item.distance);
      prediction += item.sample.y * weight;
      totalWeight += weight;
    });
    return {
      prediction: totalWeight ? prediction / totalWeight : 0,
      neighbors: nearest,
    };
  }

  function evaluatePredictions(actual, predicted, baseline, horizonVolatility) {
    const errors = actual.map((value, index) => Math.abs(value - predicted[index]));
    const baselineErrors = actual.map((value, index) => Math.abs(value - baseline[index]));
    const directionAccuracy = mean(actual.map((value, index) => (
      Math.sign(value) === Math.sign(predicted[index]) ? 1 : 0
    )));
    const mae = mean(errors);
    const baselineMae = mean(baselineErrors);
    const normalizedMae = mae / Math.max(0.02, horizonVolatility);
    return {
      errors,
      mae,
      baselineMae,
      normalizedMae,
      directionAccuracy,
      improvement: baselineMae > EPSILON ? clamp((baselineMae - mae) / baselineMae, -1, 1) : 0,
      score: normalizedMae + ((1 - directionAccuracy) * 0.2),
    };
  }

  function buildValidationFolds(samples, horizon) {
    const blockSize = Math.max(8, Math.floor(samples.length * 0.1));
    return [3, 2, 1].map((remainingBlocks) => {
      const start = samples.length - (blockSize * remainingBlocks);
      const validation = samples.slice(start, start + blockSize);
      if (!validation.length) return null;
      const training = samples.filter((sample) => sample.anchor + horizon < validation[0].anchor);
      return training.length >= 16 ? { training, validation } : null;
    }).filter(Boolean);
  }

  function fallbackPrediction(feature, horizon) {
    const horizonLimit = horizon <= 20 ? 0.08 : (horizon <= 63 ? 0.15 : 0.25);
    const weights = horizon <= 20
      ? [[5, 0.25], [20, 0.55], [63, 0.2]]
      : (horizon <= 63
        ? [[5, 0.05], [20, 0.25], [63, 0.7]]
        : [[5, 0.02], [20, 0.13], [63, 0.35], [126, 0.5]]);
    const projected = weights.reduce((sum, [window, weight]) => (
      sum + ((feature.momentum[window] || 0) * (horizon / window) * weight)
    ), 0);
    return clamp(
      projected,
      Math.max(-horizonLimit, -feature.volatility * Math.sqrt(horizon) * 2.5),
      Math.min(horizonLimit, feature.volatility * Math.sqrt(horizon) * 2.5),
    );
  }

  function horizonCalibration(horizon, indexForecast) {
    return indexForecast
      ? { localScale: 1, regimeScale: 1, rangeScale: 1 }
      : (STOCK_HORIZON_CALIBRATION[horizon]
        || { localScale: 0.33, regimeScale: 0.5, rangeScale: 1 });
  }

  function trainHorizonModel(context, horizon) {
    const samples = buildSamples(context, horizon);
    if (samples.length < 24) return null;
    const folds = buildValidationFolds(samples, horizon);
    if (folds.length < 2) return null;
    const definitions = [{ kind: "baseline", lambda: null, neighborWeight: 0, indexes: [] }];
    [5, 20, 63, 126, 252].forEach((window) => {
      [0.1, 0.25, 0.5].forEach((multiplier) => {
        definitions.push({
          kind: "momentum",
          window,
          multiplier,
          lambda: null,
          neighborWeight: 0,
          indexes: [],
        });
      });
    });
    ["price", "market", "all"].forEach((kind) => {
      const indexes = featureIndexes(kind, samples[0].x.length);
      [4, 16, 64].forEach((lambda) => {
        [0, 0.25].forEach((neighborWeight) => {
          definitions.push({ kind, lambda, neighborWeight, indexes });
        });
      });
    });
    const evaluated = definitions.map((definition) => {
      const actual = [];
      const predictions = [];
      const baselinePredictions = [];
      let winningFolds = 0;
      let strongFolds = 0;
      folds.forEach(({ training, validation }) => {
        const foldActual = validation.map((sample) => sample.y);
        const foldBaseline = validation.map((sample) => fallbackPrediction(sample, horizon));
        let foldPredictions = foldBaseline;
        if (definition.kind === "momentum") {
          foldPredictions = validation.map((sample) => clamp(
            sample.momentum[definition.window] * (horizon / definition.window) * definition.multiplier,
            -sample.volatility * Math.sqrt(horizon) * 2.5,
            sample.volatility * Math.sqrt(horizon) * 2.5,
          ));
        } else if (definition.kind !== "baseline") {
          const model = fitRidge(training, definition.indexes, definition.lambda);
          const scaler = distanceScaler(training, definition.indexes);
          foldPredictions = validation.map((sample) => {
            const ridge = ridgePredict(model, sample.x);
            if (!definition.neighborWeight) return ridge;
            const neighbor = neighborPrediction(
              training,
              sample.x,
              definition.indexes,
              scaler,
            ).prediction;
            return ((1 - definition.neighborWeight) * ridge) + (definition.neighborWeight * neighbor);
          });
        }
        const foldMetrics = evaluatePredictions(
          foldActual,
          foldPredictions,
          foldBaseline,
          standardDeviation(training.map((sample) => sample.y)),
        );
        if (foldMetrics.improvement > 0 && foldMetrics.directionAccuracy >= 0.5) winningFolds += 1;
        if (foldMetrics.improvement >= 0.15 && foldMetrics.directionAccuracy >= 0.65) strongFolds += 1;
        actual.push(...foldActual);
        predictions.push(...foldPredictions);
        baselinePredictions.push(...foldBaseline);
      });
      return {
        ...definition,
        winningFolds,
        strongFolds,
        metrics: evaluatePredictions(
          actual,
          predictions,
          baselinePredictions,
          standardDeviation(samples.map((sample) => sample.y)),
        ),
      };
    }).sort((left, right) => left.metrics.score - right.metrics.score);
    const baselineCandidate = evaluated.find((candidate) => candidate.kind === "baseline");
    const learnedCandidate = evaluated.find((candidate) => (
      candidate.kind !== "baseline"
      && candidate.strongFolds === folds.length
    ));
    const selected = learnedCandidate
      && learnedCandidate.metrics.mae <= (baselineCandidate.metrics.mae * 0.7)
      && learnedCandidate.metrics.directionAccuracy >= 0.7
      ? learnedCandidate
      : baselineCandidate;
    const finalModel = selected.kind === "baseline"
      || selected.kind === "momentum"
      ? null
      : fitRidge(samples, selected.indexes, selected.lambda);
    const finalScaler = selected.kind === "baseline" || selected.kind === "momentum"
      ? null
      : distanceScaler(samples, selected.indexes);
    return {
      horizon,
      samples,
      trainingSamples: Math.min(...folds.map((fold) => fold.training.length)),
      validationSamples: folds.reduce((sum, fold) => sum + fold.validation.length, 0),
      kind: selected.kind,
      lambda: selected.lambda,
      neighborWeight: selected.neighborWeight,
      window: selected.window || null,
      multiplier: selected.multiplier || null,
      indexes: selected.indexes,
      model: finalModel,
      scaler: finalScaler,
      reliability: selected.kind === "baseline" ? 0 : (selected.kind === "momentum" ? 1 : clamp(
        0.2 + (Math.max(0, selected.metrics.improvement) * 1.5)
          + (Math.max(0, selected.metrics.directionAccuracy - 0.5) * 0.5),
        0.2,
        0.65,
      )),
      metrics: selected.metrics,
      residual68: Math.max(0.02, quantile(selected.metrics.errors, 0.8)),
      residual90: Math.max(0.03, quantile(selected.metrics.errors, 0.95)),
    };
  }

  function predictHorizon(model, feature) {
    const baseline = fallbackPrediction(feature, model?.horizon || 126);
    if (!model || model.kind === "baseline") return baseline;
    if (model.kind === "momentum") {
      return clamp(
        feature.momentum[model.window] * (model.horizon / model.window) * model.multiplier,
        -feature.volatility * Math.sqrt(model.horizon) * 2.5,
        feature.volatility * Math.sqrt(model.horizon) * 2.5,
      );
    }
    const ridge = ridgePredict(model.model, feature.features);
    const learned = !model.neighborWeight
      ? ridge
      : ((1 - model.neighborWeight) * ridge) + (model.neighborWeight
        * neighborPrediction(model.samples, feature.features, model.indexes, model.scaler).prediction);
    return baseline + ((learned - baseline) * model.reliability);
  }

  function growthSignal(current, previous) {
    if (!(Number.isFinite(current) && Number.isFinite(previous)) || Math.abs(previous) < EPSILON) return null;
    return clamp((current - previous) / Math.max(Math.abs(previous), 1), -1.5, 1.5);
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
    const consensusWeighted = consensusSignal * consensusConfidence;
    const fundamentalsWeighted = fundamentals * fundamentalsConfidence;
    const weighted = consensusWeighted + fundamentalsWeighted;
    const confidenceTotal = consensusConfidence + fundamentalsConfidence;
    const consensusAdjustment = confidenceTotal ? (consensusWeighted / confidenceTotal) * 0.04 : 0;
    const fundamentalsAdjustment = confidenceTotal ? (fundamentalsWeighted / confidenceTotal) * 0.04 : 0;
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
      combined: confidenceTotal ? clamp(weighted / confidenceTotal, -1, 1) : 0,
      adjustment: clamp(consensusAdjustment + fundamentalsAdjustment, -0.04, 0.04),
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

  function buildPriceRegimeProfile(prices, forwardReturns = [], projectedVolatility = 0) {
    const source = (Array.isArray(prices) ? prices : []).map(finite).filter((value) => value > 0);
    if (source.length < TRADING_DAYS) {
      return {
        rangeBoundScore: 0,
        position: 0.5,
        meanReversionReturn: 0,
        empiricalPrior: [0.375, 0.25, 0.375],
        sidewaysFrequency: 0.25,
        breakoutStrength: 0,
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
    const criticalPattern = /상장폐지|상장적격성|관리종목|거래정지|감사의견.{0,8}(거절|한정)|의견거절|자본잠식|회생절차|파산|영업정지|횡령|배임/;
    const financingPattern = /유상증자|감자|전환사채|신주인수권부사채|교환사채|제3자배정/;
    const warningPattern = /최대주주변경|불성실공시|소송|채무보증|담보제공|대규모손실/;
    const positivePattern = /단일판매.{0,6}공급계약|자기주식취득결정|현금.{0,5}배당/;
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
      if (criticalPattern.test(title)) {
        score += 0.8 * decay;
        terminalRisk = terminalRisk || ageDays <= 730;
        reasons.push("상장·감사 위험 공시");
      } else if (financingPattern.test(title)) {
        score += 0.24 * decay;
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

  function normalCdf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value) / Math.sqrt(2);
    const t = 1 / (1 + (0.3275911 * x));
    const polynomial = t * (0.254829592 + (t * (-0.284496736 + (t * (
      1.421413741 + (t * (-1.453152027 + (t * 1.061405429)))
    )))));
    const erf = sign * (1 - (polynomial * Math.exp(-(x ** 2))));
    return clamp(0.5 * (1 + erf), 0, 1);
  }

  function roundedScenarioProbabilities(values) {
    const normalizedTotal = Math.max(EPSILON, values.reduce((sum, value) => sum + value, 0));
    const exact = values.map((value) => (Math.max(0, value) / normalizedTotal) * 100);
    const rounded = exact.map(Math.floor);
    let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
    exact
      .map((value, index) => ({ index, fraction: value - rounded[index] }))
      .sort((left, right) => right.fraction - left.fraction)
      .forEach((item) => {
        if (remainder <= 0) return;
        rounded[item.index] += 1;
        remainder -= 1;
      });
    return rounded;
  }

  function briefScenarioReason(direction, contextSignal, marketRegime, corporateRisk, priceRegime, rotation, confidence) {
    const candidates = [];
    if (direction === "upside") {
      if (contextSignal.fundamentals > 0.15) candidates.push("실적 개선");
      if (contextSignal.consensus > 0.15) candidates.push("컨센서스 상향여력");
      candidates.push(...(rotation.supportReasons || []));
      if (priceRegime.rangeBoundScore > 0.5 && priceRegime.position < 0.3) candidates.push("박스권 하단 반등");
      candidates.push(...marketRegime.supportReasons);
      if (!candidates.length) candidates.push("가격·시장 모멘텀");
    } else if (direction === "downside") {
      candidates.push(...corporateRisk.reasons, ...(rotation.riskReasons || []), ...marketRegime.riskReasons);
      if (priceRegime.rangeBoundScore > 0.5 && priceRegime.position > 0.7) candidates.push("박스권 상단 부담");
      if (contextSignal.fundamentals < -0.15) candidates.push("실적 둔화");
      if (contextSignal.consensus < -0.15) candidates.push("목표가 하방");
      if (!candidates.length) candidates.push("변동성·하방 위험");
    } else {
      if (priceRegime.rangeBoundScore > 0.5) candidates.push("장기 박스권 반복");
      candidates.push(...(marketRegime.rangeReasons || []));
      if (marketRegime.support > 0.25 && marketRegime.risk > 0.25) candidates.push("상·하방 신호 혼재");
      if (confidence < 0.35) candidates.push("검증 신뢰도 낮음");
      if (!candidates.length) candidates.push("중립 신호 우세");
    }
    return [...new Set(candidates)].slice(0, 2).join(" · ");
  }

  function buildForecastScenarios({
    basePrice,
    cumulative,
    uncertainty,
    residual,
    projectedVolatility,
    confidence,
    contextSignal,
    marketRegime,
    corporateRisk,
    priceRegime,
    rotation,
    recentMomentum = 0,
    mediumMomentum = 0,
    probabilitySignalStrength = 1,
    sidewaysProbabilityScale = 1,
    pathLibrary = null,
  }) {
    const horizon = cumulative.length - 1;
    const median = cumulative.at(-1);
    const uncertaintyEnd = Math.max(0.03, uncertainty.at(-1));
    const sigma = Math.max(0.03, uncertaintyEnd / 1.281551565545);
    const flatBand = clamp(projectedVolatility * Math.sqrt(horizon) * 0.35, 0.05, 0.1);
    const downRaw = normalCdf((-flatBand - median) / sigma);
    const upRaw = 1 - normalCdf((flatBand - median) / sigma);
    const sidewaysRaw = Math.max(0, 1 - upRaw - downRaw);
    const structuralRange = clamp(
      (priceRegime.rangeBoundScore * 0.55)
        + ((marketRegime.rangePressure || 0) * 0.35)
        + ((rotation.rangePressure || 0) * 0.1),
      0,
      0.8,
    );
    const empiricalPrior = Array.isArray(priceRegime.empiricalPrior)
      ? priceRegime.empiricalPrior.slice(0, 3)
      : [0.375, 0.25, 0.375];
    const boostedSideways = empiricalPrior[1] + ((1 - empiricalPrior[1]) * structuralRange * 0.55);
    const directionalTotal = Math.max(EPSILON, empiricalPrior[0] + empiricalPrior[2]);
    let prior = [
      (1 - boostedSideways) * (empiricalPrior[0] / directionalTotal),
      boostedSideways,
      (1 - boostedSideways) * (empiricalPrior[2] / directionalTotal),
    ];
    const positionBias = clamp((priceRegime.position - 0.5) * 2, -1, 1) * priceRegime.rangeBoundScore;
    if (positionBias > 0) {
      const transfer = Math.min(prior[0] * 0.45, positionBias * 0.12);
      prior = [prior[0] - transfer, prior[1] + (transfer * 0.65), prior[2] + (transfer * 0.35)];
    } else if (positionBias < 0) {
      const transfer = Math.min(prior[2] * 0.45, -positionBias * 0.12);
      prior = [prior[0] + (transfer * 0.35), prior[1] + (transfer * 0.65), prior[2] - transfer];
    }
    const calibration = clamp(confidence * (1 - (structuralRange * 0.45)), 0.1, 0.75);
    const blended = [upRaw, sidewaysRaw, downRaw].map((value, index) => (
      (value * calibration) + (prior[index] * (1 - calibration))
    ));
    const rescaled = [blended[0], blended[1] * sidewaysProbabilityScale, blended[2]];
    const rescaledTotal = Math.max(EPSILON, rescaled.reduce((sum, value) => sum + value, 0));
    const signalStrength = clamp(probabilitySignalStrength, 0, 1);
    const calibratedProbabilities = rescaled.map((value) => (
      ((value / rescaledTotal) * signalStrength) + ((1 - signalStrength) / 3)
    ));
    const [upProbability, sidewaysProbability, downProbability] = roundedScenarioProbabilities(
      calibratedProbabilities,
    );
    const upEndpoint = Math.max(flatBand * 1.25, median + (uncertaintyEnd * 0.6));
    const sidewaysEndpoint = clamp(median * 0.2, -flatBand * 0.45, flatBand * 0.45);
    const downEndpoint = Math.min(-flatBand * 1.25, median - (uncertaintyEnd * 0.6));
    const momentumImpulse = clamp(
      (finite(recentMomentum) || 0)
        + ((finite(mediumMomentum) || 0) * 0.35)
        + ((marketRegime.macd || 0) * 0.04),
      -0.14,
      0.14,
    );
    const supportImpulse = clamp((marketRegime.combined || 0) * 0.06, -0.06, 0.06);
    const baseShape = cumulative.map((value, day) => value - (median * (day / Math.max(1, horizon))));
    const pathSignals = {
      momentum: momentumImpulse,
      support: clamp(
        (marketRegime.support || 0)
          + Math.max(0, contextSignal.consensus || 0) * 0.2
          + Math.max(0, contextSignal.fundamentals || 0) * 0.2
          + Math.max(0, rotation.support || 0) * 0.2,
        0,
        1,
      ),
      risk: clamp(
        (marketRegime.risk || 0)
          + (corporateRisk.score || 0) * 0.35
          + Math.max(0, rotation.risk || 0) * 0.2,
        0,
        1,
      ),
      range: structuralRange,
    };
    const morphologies = scenarioPathEngine?.buildScenarioMorphologies({
      library: pathLibrary,
      endpoints: {
        upside: upEndpoint,
        sideways: sidewaysEndpoint,
        downside: downEndpoint,
      },
      horizon,
      projectedVolatility,
      baseShape,
      signals: pathSignals,
    }) || null;
    const paths = morphologies
      ? Object.fromEntries(Object.entries(morphologies).map(([role, morphology]) => [
        role,
        morphology.path,
      ]))
      : { upside: [], sideways: [], downside: [] };
    if (!morphologies) {
      const phasePulse = (progress, start, end) => {
        if (progress <= start || progress >= end) return 0;
        return Math.sin(Math.PI * ((progress - start) / (end - start)));
      };
      const rangeDrag = clamp(structuralRange * 0.035, 0, 0.03);
      for (let day = 0; day <= horizon; day += 1) {
        const progress = day / Math.max(1, horizon);
        const localSwing = (residual[day] || 0) * 0.15;
        const earlyPulse = phasePulse(progress, 0, 0.4);
        const middlePulse = phasePulse(progress, 0.22, 0.78);
        const latePulse = phasePulse(progress, 0.55, 1);
        const upsidePhase = (momentumImpulse >= 0
          ? (momentumImpulse * 0.7 * earlyPulse) - (rangeDrag * middlePulse)
          : (momentumImpulse * 0.5 * earlyPulse) + (Math.max(0, supportImpulse) * middlePulse))
          + (Math.max(0, supportImpulse) * 0.3 * latePulse);
        const sidewaysPhase = (momentumImpulse * 0.75 * earlyPulse)
          - (momentumImpulse * 0.35 * middlePulse)
          + (supportImpulse * 0.2 * latePulse);
        const downsidePhase = (momentumImpulse >= 0
          ? (momentumImpulse * 0.65 * earlyPulse) + (Math.min(0, supportImpulse) * middlePulse)
          : (momentumImpulse * 0.75 * earlyPulse) + (Math.max(0, supportImpulse) * 0.35 * middlePulse))
          - (Math.max(0, -supportImpulse) * 0.35 * latePulse);
        paths.upside.push((baseShape[day] * 0.55) + localSwing + (upEndpoint * progress) + upsidePhase);
        paths.sideways.push((baseShape[day] * 0.22) + (localSwing * 0.5)
          + (sidewaysEndpoint * progress) + sidewaysPhase);
        paths.downside.push((baseShape[day] * 0.55) + localSwing + (downEndpoint * progress) + downsidePhase);
      }
    }
    const toPrices = (values) => values.map((value) => basePrice * Math.exp(value));
    const scenarioDetails = (role, directionLabel) => ({
      label: morphologies?.[role]?.label || directionLabel,
      shortLabel: morphologies?.[role]?.shortLabel || directionLabel,
      directionLabel,
      patternKey: morphologies?.[role]?.key || role,
      pathSource: morphologies?.[role]?.source || "legacy-fallback",
      patternAnalogCount: morphologies?.[role]?.analogCount || 0,
      patternSupport: morphologies?.[role]?.support || 0,
    });
    return {
      upside: {
        key: "upside",
        ...scenarioDetails("upside", "상승"),
        probability: upProbability,
        weight: upProbability,
        reason: briefScenarioReason("upside", contextSignal, marketRegime, corporateRisk, priceRegime, rotation, confidence),
        prices: toPrices(paths.upside),
      },
      sideways: {
        key: "sideways",
        ...scenarioDetails("sideways", "횡보"),
        probability: sidewaysProbability,
        weight: sidewaysProbability,
        reason: briefScenarioReason("sideways", contextSignal, marketRegime, corporateRisk, priceRegime, rotation, confidence),
        prices: toPrices(paths.sideways),
      },
      downside: {
        key: "downside",
        ...scenarioDetails("downside", "하락"),
        probability: downProbability,
        weight: downProbability,
        reason: briefScenarioReason("downside", contextSignal, marketRegime, corporateRisk, priceRegime, rotation, confidence),
        prices: toPrices(paths.downside),
      },
      calibration: {
        weightType: "relative-scenario-weight",
        calibratedProbability: false,
        validationStatus: "experimental",
        median,
        sigma,
        flatBand,
        structuralRange,
        prior,
        probabilitySignalStrength: signalStrength,
        sidewaysProbabilityScale,
        pathMomentum: momentumImpulse,
        pathLibrarySamples: Number(pathLibrary?.sampleCount) || 0,
      },
    };
  }

  function interpolateAnchors(anchors, day) {
    for (let index = 1; index < anchors.length; index += 1) {
      if (day > anchors[index].day) continue;
      const left = anchors[index - 1];
      const right = anchors[index];
      const position = (day - left.day) / Math.max(1, right.day - left.day);
      const smooth = position * position * (3 - (2 * position));
      return left.value + ((right.value - left.value) * smooth);
    }
    return anchors.at(-1).value;
  }

  function weightedMedian(items) {
    const sorted = items
      .filter((item) => Number.isFinite(item.value) && item.weight > 0)
      .sort((left, right) => left.value - right.value);
    const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
    let accumulated = 0;
    for (const item of sorted) {
      accumulated += item.weight;
      if (accumulated >= totalWeight / 2) return item.value;
    }
    return sorted.at(-1)?.value || 0;
  }

  function smoothPath(values) {
    return values.map((value, index) => {
      if (index === 0 || index === values.length - 1) return value;
      return (values[index - 1] * 0.2) + (value * 0.6) + (values[index + 1] * 0.2);
    });
  }

  function nearestPathSamples(model, finalFeature, count = 12) {
    if (!model?.samples?.length) return [];
    if (model.kind === "baseline" || model.kind === "momentum") {
      return model.samples.map((sample) => {
        const volatilityDistance = sample.volatility > EPSILON && finalFeature.volatility > EPSILON
          ? Math.abs(Math.log(sample.volatility / finalFeature.volatility))
          : 0;
        return {
          sample,
          distance: Math.abs(sample.momentum[5] - finalFeature.momentum[5])
            + (0.35 * Math.abs(sample.momentum[63] - finalFeature.momentum[63]))
            + (0.2 * Math.abs(sample.momentum[126] - finalFeature.momentum[126]))
            + (0.15 * volatilityDistance),
        };
      }).sort((left, right) => left.distance - right.distance).slice(0, count);
    }
    return neighborPrediction(
      model.samples,
      finalFeature.features,
      model.indexes,
      model.scaler,
      count,
    ).neighbors;
  }

  function residualPath(context, finalFeature, model, horizon, candidates = null) {
    if (!model?.samples?.length) return Array(horizon + 1).fill(0);
    const nearest = (Array.isArray(candidates) && candidates.length
      ? candidates
      : nearestPathSamples(model, finalFeature, 10)).slice(0, 10);
    const paths = nearest.filter(({ sample }) => sample.anchor + horizon < context.prices.length);
    if (!paths.length) return Array(horizon + 1).fill(0);
    const analogs = paths.map(({ sample, distance }) => {
      const weight = 1 / Math.max(0.1, distance);
      const endpoint = Math.log(context.prices[sample.anchor + horizon] / context.prices[sample.anchor]);
      const values = Array.from({ length: horizon + 1 }, (_, day) => {
        const cumulative = Math.log(context.prices[sample.anchor + day] / context.prices[sample.anchor]);
        return cumulative - ((day / horizon) * endpoint);
      });
      return { values, weight };
    });
    const totalWeight = analogs.reduce((sum, item) => sum + item.weight, 0);
    const raw = Array.from({ length: horizon + 1 }, (_, day) => {
      const items = analogs.map((item) => ({ value: item.values[day], weight: item.weight }));
      const average = items.reduce((sum, item) => sum + (item.value * item.weight), 0) / totalWeight;
      const median = weightedMedian(items);
      const closest = analogs[0]?.values[day] || 0;
      return (median * 0.6) + (average * 0.25) + (closest * 0.15);
    });
    const boundaries = [0, 20, 63, horizon];
    const detrended = raw.map((value, day) => {
      const rightIndex = boundaries.findIndex((boundary) => boundary >= day);
      const right = boundaries[Math.max(1, rightIndex)];
      const left = boundaries[Math.max(0, rightIndex - 1)];
      const position = (day - left) / Math.max(1, right - left);
      const bridge = raw[left] + ((raw[right] - raw[left]) * position);
      return day === left || day === right ? 0 : value - bridge;
    });
    const shaped = smoothPath(detrended);
    const output = Array(horizon + 1).fill(0);
    for (let segment = 1; segment < boundaries.length; segment += 1) {
      const left = boundaries[segment - 1];
      const right = boundaries[segment];
      const segmentValues = shaped.slice(left, right + 1);
      const dailyChanges = segmentValues.slice(1).map((value, index) => value - segmentValues[index]);
      const pathVolatility = standardDeviation(dailyChanges);
      const targetVolatility = clamp(finalFeature.volatility * 0.4, 0.0015, 0.02);
      const scale = pathVolatility > EPSILON
        ? clamp(targetVolatility / pathVolatility, 0.75, 2.75)
        : 1;
      const swingLimit = clamp(finalFeature.volatility * Math.sqrt(right - left) * 1.2, 0.04, 0.14);
      for (let day = left + 1; day < right; day += 1) {
        output[day] = clamp(shaped[day] * scale, -swingLimit, swingLimit);
      }
    }
    return output;
  }

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

  function latestValuesFingerprint(rows, keys) {
    const source = Array.isArray(rows) ? rows : [];
    return JSON.stringify((Array.isArray(keys) ? keys : []).map((key) => {
      for (let index = source.length - 1; index >= 0; index -= 1) {
        const value = finite(source[index]?.[key]);
        if (value !== null) return [key, String(source[index]?.date || "").slice(0, 10), value];
      }
      return [key, "", null];
    }));
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

  function numericHistoryFingerprint(values) {
    const source = Array.isArray(values) ? values : [];
    if (!source.length) return [];
    const indexes = [...new Set([
      0,
      Math.floor((source.length - 1) * 0.25),
      Math.floor((source.length - 1) * 0.5),
      Math.floor((source.length - 1) * 0.75),
      source.length - 1,
    ])];
    return [source.length, ...indexes.map((index) => finite(source[index]))];
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

  function forecastCacheKey(options, points) {
    const market = (Array.isArray(options?.marketCandidates) ? options.marketCandidates : []).map((item) => [
      item?.series,
      item?.dates?.at?.(-1),
      numericHistoryFingerprint(item?.prices),
    ]);
    const rotation = (Array.isArray(options?.rotationCandidates) ? options.rotationCandidates : []).map((item) => [
      item?.series,
      item?.dates?.at?.(-1),
      numericHistoryFingerprint(item?.prices),
    ]);
    const lastDate = points.at(-1)?.date;
    return JSON.stringify([
      FORECAST_PATH_VERSION,
      options?.series,
      lastDate,
      numericHistoryFingerprint(points.map((point) => point.price)),
      market,
      rotation,
      latestValuesFingerprint(options?.macroRows, ["leading_cycle", "news_sentiment", "policy_rate", "export_value", "import_value"]),
      latestValuesFingerprint(options?.auxiliaryRows, ["adr", "adr_kospi", "adr_kosdaq", "fear_greed"]),
      latestValuesFingerprint(options?.creditRows, ["customer_deposit", "kospi_credit", "kosdaq_credit"]),
      latestValuesFingerprint(options?.crisisRows, ["score", "curve", "labor", "credit", "fedFunds", "fedFundsChange6m"]),
      disclosureRiskFingerprint(options, lastDate),
      options?.consensus || null,
      (Array.isArray(options?.financials) ? options.financials : []).slice(-6),
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
    const contextSignal = buildContextSignal(options, options.series, dates.at(-1), prices.at(-1));
    const corporateRisk = buildCorporateRiskSignal(options, options.series, dates.at(-1));
    const priceRegime = buildPriceRegimeProfile(
      prices,
      models.at(-1).samples.map((sample) => sample.y),
      finalFeature.volatility,
    );
    const rotation = buildRotationSignal(options, options.series, dates, prices, priceRegime);
    const suppliedMacd = finite(options.macdSignal);
    const marketRegime = buildMarketRegimeSignal({
      ...options,
      macdSignal: suppliedMacd === null ? clamp(finalFeature.features[9] / 3, -1, 1) : suppliedMacd,
    }, options.series, dates.at(-1));
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
      const calibration = horizonCalibration(model.horizon, indexForecast);
      const uncalibratedLocal = predictHorizon(model, finalFeature);
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
      const riskGated = bounded > 0
        ? bounded * (1 - (corporateRisk.score * 0.6))
        : bounded;
      const regimeWeight = indexForecast ? 1.6 : 1;
      const components = {
        localModel: local,
        top400Blend: raw - local,
        empiricalGuardrail: bounded - raw,
        corporateRiskGate: riskGated - bounded,
        consensus: contextSignal.consensusAdjustment * horizonWeight,
        fundamentals: contextSignal.fundamentalsAdjustment * horizonWeight,
        marketRegime: marketRegime.adjustment * regimeWeight * horizonWeight * calibration.regimeScale,
        corporateRisk: corporateRisk.adjustment * horizonWeight,
        rotation: rotation.adjustment * horizonWeight,
      };
      const beforeStructural = Object.values(components).reduce((sum, value) => sum + value, 0);
      const structuralTarget = priceRegime.meanReversionReturn * horizonWeight;
      const rawAfterStructural = (beforeStructural * (1 - structuralWeight))
        + (structuralTarget * structuralWeight);
      components.rangeMeanReversion = (rawAfterStructural - beforeStructural) * calibration.rangeScale;
      const afterStructural = beforeStructural + components.rangeMeanReversion;
      const afterTerminalRisk = corporateRisk.terminalRisk
        ? Math.min(afterStructural, -0.08 * horizonWeight)
        : afterStructural;
      components.terminalRisk = afterTerminalRisk - afterStructural;
      const adjusted = clamp(afterTerminalRisk, -volatilityBound * 1.15, volatilityBound * 1.15);
      components.finalClamp = adjusted - afterTerminalRisk;
      return {
        day: model.horizon,
        value: adjusted,
        components,
        calibration,
        uncalibratedLocal,
        uncertainty: Math.max(model.residual68, global?.residual80 || 0)
          + ((corporateRisk.uncertainty + marketRegime.uncertainty) * Math.sqrt(horizonWeight)),
      };
    });
    const anchors = [{ day: 0, value: 0 }, ...predictions];
    const uncertaintyAnchors = [{ day: 0, value: 0 }, ...predictions.map((item) => ({
      day: item.day,
      value: item.uncertainty,
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
    const forecastPrices = cumulative.map((value) => prices.at(-1) * Math.exp(value));
    const lowerPrices = cumulative.map((value, day) => prices.at(-1) * Math.exp(value - uncertainty[day]));
    const upperPrices = cumulative.map((value, day) => prices.at(-1) * Math.exp(value + uncertainty[day]));
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
    const scenarios = buildForecastScenarios({
      basePrice: prices.at(-1),
      cumulative,
      uncertainty,
      residual,
      projectedVolatility: finalFeature.volatility,
      confidence,
      contextSignal,
      marketRegime,
      corporateRisk,
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
    const audit = {
      format: "ai-audit-v1",
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
          ["score", "curve", "labor", "credit", "fedFunds", "fedFundsChange6m"],
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
        corporate_risk_score: corporateRisk.score,
        corporate_risk_adjustment: corporateRisk.adjustment,
        corporate_terminal_risk: corporateRisk.terminalRisk ? 1 : 0,
        regime_support: marketRegime.support,
        regime_risk: marketRegime.risk,
        regime_range: marketRegime.range,
        regime_adjustment: marketRegime.adjustment,
        regime_uncertainty: marketRegime.uncertainty,
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
        price_range_bound_score: priceRegime.rangeBoundScore,
        price_range_position: priceRegime.position,
        price_mean_reversion_return: priceRegime.meanReversionReturn,
        price_annualized_return: priceRegime.annualizedReturn,
        price_trend_r_squared: priceRegime.trendRSquared,
        price_breakout_strength: priceRegime.breakoutStrength,
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
        credit_rows: Array.isArray(options?.creditRows) ? options.creditRows.length : 0,
        crisis_rows: Array.isArray(options?.crisisRows) ? options.crisisRows.length : 0,
        disclosure_rows: corporateRisk.disclosureCount,
        financial_rows: contextSignal.financialPeriods,
        consensus_institutions: contextSignal.consensusInstitutions,
        rotation_series: Array.isArray(options?.rotationCandidates) ? options.rotationCandidates.length : 0,
        path_analog_rows: pathLibrary?.sampleCount || 0,
        internet_news_rows: 0,
        analyst_report_rows: 0,
      }),
      scenarioWeights: compactAuditMap({
        upside: scenarios.upside?.weight,
        sideways: scenarios.sideways?.weight,
        downside: scenarios.downside?.weight,
      }),
    };
    const forecast = {
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
        marketModelUsed,
        globalMarketSeries: marketModelUsed ? globalMarketSeries : "",
        horizons: models.map((item) => ({
          days: item.horizon,
          kind: item.kind,
          lambda: item.lambda,
          neighborWeight: item.neighborWeight,
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
      },
      signals: {
        ...contextSignal,
        macd: marketRegime.macd,
        corporateRisk,
        marketRegime,
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
    buildForecast,
    buildForecastScenarios,
    buildLeadingCyclePhase,
    buildMarketRegimeSignal,
    buildPriceRegimeProfile,
    buildRotationSignal,
    globalMarketSeriesFor,
    getForecastInputKey,
    isForecastSeries,
    isMarketIndexSeries,
    marketModelForHorizon,
    nextBusinessDates,
    parseFeatureTransform,
  });
}(typeof self !== "undefined" ? self : globalThis));
