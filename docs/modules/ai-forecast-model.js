(function initThinkStockAiForecastModel(globalScope) {
  "use strict";

  function createForecastModelEngine(options = {}) {
    const {
      EPSILON,
      STOCK_HORIZON_CALIBRATION,
      buildSamples,
      clamp,
      finite,
      mean,
      quantile,
      standardDeviation,
    } = options;
    if ([buildSamples, clamp, finite, mean, quantile, standardDeviation]
      .some((value) => typeof value !== "function")) {
      throw new Error("AI forecast model dependencies are required");
    }

  function featureIndexes(kind, featureCount, environment = []) {
    if (kind === "price") return Array.from({ length: Math.min(10, featureCount) }, (_, index) => index);
    if (kind === "market") return Array.from({ length: Math.min(17, featureCount) }, (_, index) => index);
    if (kind === "environment-core") {
      const indexes = Array.from({ length: Math.min(17, featureCount) }, (_, index) => index);
      environment.forEach((item, position) => {
        if (["vkospi", "vix", "krw"].includes(String(item?.name || ""))) return;
        indexes.push(17 + (position * 2), 18 + (position * 2));
      });
      return indexes.filter((index) => index < featureCount);
    }
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
    const crossSectional = source.cross_sectional_holdout;
    const crossMetrics = crossSectional?.metrics;
    if (
      marketModel.format === "thinkstock-ai-market-model-v3"
      && (
        crossSectional?.ticker_disjoint !== true
        || crossSectional?.passed !== true
        || (finite(crossMetrics?.improvement) || 0) <= 0
        || (finite(crossMetrics?.direction_accuracy) || 0) < 0.5
      )
    ) return null;
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
      metrics: {
        improvement,
        directionAccuracy,
        crossSectionalImprovement: finite(crossMetrics?.improvement),
        crossSectionalDirectionAccuracy: finite(crossMetrics?.direction_accuracy),
      },
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
      // MAE is the primary objective. Direction is only a small tie-breaker so
      // an honest no-change forecast can beat an unskilled directional guess.
      score: normalizedMae + (Math.max(0, 0.5 - directionAccuracy) * 0.04),
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
    const definitions = [{
      kind: "abstain",
      lambda: null,
      neighborWeight: 0,
      predictionScale: 0,
      indexes: [],
    }];
    [-0.5, -0.25, 0.25, 0.5, 0.75, 1].forEach((predictionScale) => {
      definitions.push({
        kind: "baseline",
        lambda: null,
        neighborWeight: 0,
        predictionScale,
        indexes: [],
      });
    });
    [5, 20, 63, 126, 252].forEach((window) => {
      [-0.5, -0.25, -0.1, 0.1, 0.25, 0.5].forEach((multiplier) => {
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
    ["price", "market", "environment-core", "all"].forEach((kind) => {
      const indexes = featureIndexes(kind, samples[0].x.length, context.environment);
      [4, 16, 64].forEach((lambda) => {
        [0, 0.25].forEach((neighborWeight) => {
          [0.25, 0.5, 0.75, 1].forEach((predictionScale) => {
            definitions.push({ kind, lambda, neighborWeight, predictionScale, indexes });
          });
        });
      });
    });
    const foldRidgePredictionCache = new Map();
    const foldNeighborPredictionCache = new Map();
    const evaluated = definitions.map((definition) => {
      const actual = [];
      const predictions = [];
      const baselinePredictions = [];
      let winningFolds = 0;
      let strongFolds = 0;
      let losingFolds = 0;
      folds.forEach(({ training, validation }, foldIndex) => {
        const foldActual = validation.map((sample) => sample.y);
        const foldBaseline = validation.map(() => 0);
        let foldPredictions = foldBaseline;
        if (definition.kind === "baseline") {
          foldPredictions = validation.map((sample) => (
            fallbackPrediction(sample, horizon) * definition.predictionScale
          ));
        }
        if (definition.kind === "momentum") {
          foldPredictions = validation.map((sample) => clamp(
            sample.momentum[definition.window] * (horizon / definition.window) * definition.multiplier,
            -sample.volatility * Math.sqrt(horizon) * 2.5,
            sample.volatility * Math.sqrt(horizon) * 2.5,
          ));
        } else if (definition.kind !== "baseline" && definition.kind !== "abstain") {
          const ridgeKey = [foldIndex, definition.kind, definition.lambda].join("|");
          let ridgePredictions = foldRidgePredictionCache.get(ridgeKey);
          if (!ridgePredictions) {
            const model = fitRidge(training, definition.indexes, definition.lambda);
            ridgePredictions = validation.map((sample) => ridgePredict(model, sample.x));
            foldRidgePredictionCache.set(ridgeKey, ridgePredictions);
          }
          let unscaledPredictions = ridgePredictions;
          if (definition.neighborWeight) {
            const neighborKey = [foldIndex, definition.kind].join("|");
            let neighborPredictions = foldNeighborPredictionCache.get(neighborKey);
            if (!neighborPredictions) {
              const scaler = distanceScaler(training, definition.indexes);
              neighborPredictions = validation.map((sample) => neighborPrediction(
                training,
                sample.x,
                definition.indexes,
                scaler,
              ).prediction);
              foldNeighborPredictionCache.set(neighborKey, neighborPredictions);
            }
            unscaledPredictions = ridgePredictions.map((ridge, index) => (
              ((1 - definition.neighborWeight) * ridge)
                + (definition.neighborWeight * neighborPredictions[index])
            ));
          }
          foldPredictions = unscaledPredictions.map((value) => value * definition.predictionScale);
        }
        const foldMetrics = evaluatePredictions(
          foldActual,
          foldPredictions,
          foldBaseline,
          standardDeviation(training.map((sample) => sample.y)),
        );
        if (foldMetrics.improvement > 0.005) winningFolds += 1;
        if (foldMetrics.improvement >= 0.15 && foldMetrics.directionAccuracy >= 0.65) strongFolds += 1;
        if (foldMetrics.improvement < -0.08) losingFolds += 1;
        actual.push(...foldActual);
        predictions.push(...foldPredictions);
        baselinePredictions.push(...foldBaseline);
      });
      return {
        ...definition,
        winningFolds,
        strongFolds,
        losingFolds,
        metrics: evaluatePredictions(
          actual,
          predictions,
          baselinePredictions,
          standardDeviation(samples.map((sample) => sample.y)),
        ),
      };
    }).sort((left, right) => left.metrics.score - right.metrics.score);
    const requiredWinningFolds = Math.max(2, folds.length - 1);
    const eligible = evaluated.filter((candidate) => (
      candidate.kind === "abstain"
      || (
        candidate.winningFolds >= requiredWinningFolds
        && candidate.losingFolds === 0
        && candidate.metrics.improvement >= 0.01
        && (candidate.metrics.directionAccuracy >= 0.5 || candidate.metrics.improvement >= 0.04)
      )
    ));
    const selected = eligible[0] || evaluated.find((candidate) => candidate.kind === "abstain");
    const finalModel = selected.kind === "abstain"
      || selected.kind === "baseline"
      || selected.kind === "momentum"
      ? null
      : fitRidge(samples, selected.indexes, selected.lambda);
    const finalScaler = selected.kind === "abstain"
      || selected.kind === "baseline"
      || selected.kind === "momentum"
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
      predictionScale: selected.predictionScale ?? 1,
      window: selected.window || null,
      multiplier: selected.multiplier || null,
      indexes: selected.indexes,
      model: finalModel,
      scaler: finalScaler,
      reliability: selected.kind === "abstain" ? 0 : clamp(
        0.2 + (Math.max(0, selected.metrics.improvement) * 2)
          + (Math.max(0, selected.metrics.directionAccuracy - 0.5) * 0.75)
          + (selected.winningFolds / Math.max(1, folds.length) * 0.2),
        0.2,
        0.9,
      ),
      metrics: selected.metrics,
      residual68: Math.max(0.02, quantile(selected.metrics.errors, 0.8)),
      residual90: Math.max(0.03, quantile(selected.metrics.errors, 0.95)),
    };
  }

  function predictHorizon(model, feature) {
    if (!model || model.kind === "abstain") return 0;
    const baseline = fallbackPrediction(feature, model.horizon);
    if (model.kind === "baseline") return baseline * model.predictionScale;
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
    return learned * model.predictionScale;
  }

    return Object.freeze({
      applyFeatureTransform,
      fallbackPrediction,
      horizonCalibration,
      marketModelForHorizon,
      marketModelPrediction,
      neighborPrediction,
      parseFeatureTransform,
      predictHorizon,
      trainHorizonModel,
    });
  }

  globalScope.ThinkStockAiForecastModel = Object.freeze({ createForecastModelEngine });
}(typeof self !== "undefined" ? self : globalThis));
