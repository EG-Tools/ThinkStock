(function initThinkStockAiForecast(globalScope) {
  "use strict";

  const TRADING_DAYS = 252;
  const MAX_HISTORY = TRADING_DAYS * 5;
  const MIN_HISTORY = TRADING_DAYS * 3;
  const FORECAST_HORIZONS = Object.freeze([20, 63, 126]);
  const FORECAST_PATH_VERSION = "path-v5";
  const SAMPLE_STEP = 5;
  const EPSILON = 1e-9;
  const FORECAST_CACHE = new Map();

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
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
    return deduplicated.slice(-MAX_HISTORY);
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

  function rowsToSeries(rows, keys, dates) {
    const source = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const date = String(row?.date || "").slice(0, 10);
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
    return (Array.isArray(options?.marketCandidates) ? options.marketCandidates : [])
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
    return [
      { name: "leading", values: rowsToSeries(options?.macroRows, ["leading_cycle"], dates), direction: 1 },
      { name: "adr", values: rowsToSeries(options?.auxiliaryRows, isKosdaq ? ["adr_kosdaq", "adr"] : ["adr_kospi", "adr"], dates), direction: -1 },
      { name: "deposit", values: rowsToSeries(options?.creditRows, ["customer_deposit"], dates), direction: 1 },
      { name: "credit", values: rowsToSeries(options?.creditRows, isKosdaq ? ["kosdaq_credit"] : ["kospi_credit"], dates), direction: -1 },
      { name: "fear", values: rowsToSeries(options?.auxiliaryRows, ["fear_greed"], dates), direction: -1 },
      { name: "news", values: rowsToSeries(options?.macroRows, ["news_sentiment"], dates), direction: 1 },
    ];
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
    if (improvement <= 0 || directionAccuracy < 0.5 || blendWeight <= 0) return null;
    return {
      coefficients,
      indexes,
      means,
      deviations,
      featureTransform,
      reliability: blendWeight,
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
    const multiplier = horizon <= 20 ? 0.25 : 0.1;
    const horizonLimit = horizon <= 20 ? 0.08 : (horizon <= 63 ? 0.15 : 0.25);
    return clamp(
      feature.momentum[5] * (horizon / 5) * multiplier,
      Math.max(-horizonLimit, -feature.volatility * Math.sqrt(horizon) * 2.5),
      Math.min(horizonLimit, feature.volatility * Math.sqrt(horizon) * 2.5),
    );
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
    const weighted = (consensusSignal * consensusConfidence) + (fundamentals * fundamentalsConfidence);
    const confidenceTotal = consensusConfidence + fundamentalsConfidence;
    return {
      ticker,
      consensus: consensusSignal,
      consensusConfidence,
      fundamentals,
      fundamentalsConfidence,
      combined: confidenceTotal ? clamp(weighted / confidenceTotal, -1, 1) : 0,
      adjustment: confidenceTotal ? clamp((weighted / confidenceTotal) * 0.04, -0.04, 0.04) : 0,
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

  function residualPath(context, finalFeature, model, horizon) {
    if (!model?.samples?.length) return Array(horizon + 1).fill(0);
    const nearest = model.kind === "baseline" || model.kind === "momentum"
      ? model.samples.map((sample) => ({
        sample,
        distance: Math.abs(sample.momentum[5] - finalFeature.momentum[5])
          + (0.35 * Math.abs(sample.momentum[63] - finalFeature.momentum[63])),
      })).sort((left, right) => left.distance - right.distance).slice(0, 10)
      : neighborPrediction(
        model.samples,
        finalFeature.features,
        model.indexes,
        model.scaler,
        7,
      ).neighbors;
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

  function latestRowFingerprint(rows) {
    const source = Array.isArray(rows) ? rows : [];
    return source.length ? JSON.stringify(source.at(-1)) : "";
  }

  function forecastCacheKey(options, points) {
    const market = (Array.isArray(options?.marketCandidates) ? options.marketCandidates : []).map((item) => [
      item?.series,
      item?.dates?.at?.(-1),
      item?.prices?.at?.(-1),
      item?.prices?.length,
    ]);
    return JSON.stringify([
      FORECAST_PATH_VERSION,
      options?.series,
      points.length,
      points.at(-1)?.date,
      points.at(-1)?.price,
      market,
      latestRowFingerprint(options?.macroRows),
      latestRowFingerprint(options?.auxiliaryRows),
      latestRowFingerprint(options?.creditRows),
      options?.consensus || null,
      (Array.isArray(options?.financials) ? options.financials : []).slice(-4),
      options?.marketModel?.generated_at || options?.marketModel?.generatedAt || null,
    ]);
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
    const globalMarketSeries = globalMarketSeriesFor(options.series, options.marketModel);
    const globalFeature = featureVector(context, prices.length - 1, { marketSeries: globalMarketSeries });
    const contextSignal = buildContextSignal(options, options.series, dates.at(-1), prices.at(-1));
    let marketModelUsed = false;
    const predictions = models.map((model) => {
      const local = predictHorizon(model, finalFeature);
      const global = globalFeature.marketSeries === globalMarketSeries
        ? marketModelPrediction(options.marketModel, model.horizon, globalFeature)
        : null;
      const raw = global
        ? local + ((global.value - local) * global.reliability)
        : local;
      if (global) marketModelUsed = true;
      const labels = model.samples.map((sample) => sample.y);
      const empiricalLow = quantile(labels, 0.05);
      const empiricalHigh = quantile(labels, 0.95);
      const volatilityBound = finalFeature.volatility * Math.sqrt(model.horizon) * 2.5;
      const bounded = clamp(raw, Math.max(empiricalLow, -volatilityBound), Math.min(empiricalHigh, volatilityBound));
      return {
        day: model.horizon,
        value: bounded + (contextSignal.adjustment * (model.horizon / 126)),
        uncertainty: Math.max(model.residual68, global?.residual80 || 0),
      };
    });
    const anchors = [{ day: 0, value: 0 }, ...predictions];
    const uncertaintyAnchors = [{ day: 0, value: 0 }, ...predictions.map((item) => ({
      day: item.day,
      value: item.uncertainty,
    }))];
    const residual = residualPath(context, finalFeature, models.at(-1), 126);
    const cumulative = Array.from({ length: 127 }, (_, day) => (
      interpolateAnchors(anchors, day) + residual[day]
    ));
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
    const market = selectMarketAt(returns, context.markets, prices.length - 1);
    const forecast = {
      dates: [dates.at(-1), ...nextBusinessDates(dates.at(-1), 126)],
      prices: forecastPrices,
      lowerPrices,
      upperPrices,
      historyDays: points.length,
      projectedVolatility: finalFeature.volatility,
      patternMatches: models.at(-1).kind === "baseline" ? 0 : 10,
      model: {
        name: marketModelUsed
          ? "top-400 cross-sectional + purged local ensemble"
          : "purged multi-horizon ensemble",
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
        combined: finalFeature.environmentCombined,
        coverage: finalFeature.environmentCoverage,
      },
      signals: {
        ...contextSignal,
        macd: clamp(finite(options.macdSignal) || 0, -1, 1),
      },
    };
    rememberForecast(cacheKey, forecast);
    return applyChartTransform(forecast, options);
  }

  globalScope.ThinkStockAiForecast = Object.freeze({
    applyFeatureTransform,
    buildContextSignal,
    buildForecast,
    globalMarketSeriesFor,
    isForecastSeries,
    marketModelForHorizon,
    nextBusinessDates,
    parseFeatureTransform,
  });
}(typeof self !== "undefined" ? self : globalThis));
