(function initThinkStockAiForecastScenarios(globalScope) {
  "use strict";

  const SCENARIO_KEYS = Object.freeze(["upside", "sideways", "downside"]);
  const DECISIVE_SCENARIO_MINIMUM_WEIGHT = 40;
  const DECISIVE_SCENARIO_MINIMUM_LEAD = 8;

  function resolveScenarioPresentation(scenarios, options = {}) {
    const weights = Object.fromEntries(SCENARIO_KEYS.map((key) => [
      key,
      Math.max(0, Number(scenarios?.[key]?.weight ?? scenarios?.[key]?.probability) || 0),
    ]));
    const ranked = [...SCENARIO_KEYS].sort((left, right) => weights[right] - weights[left]);
    const rawPrimaryKey = ranked[0];
    const topWeight = weights[rawPrimaryKey];
    const secondWeight = weights[ranked[1]];
    const lead = topWeight - secondWeight;
    const minimumWeight = Number.isFinite(Number(options.minimumWeight))
      ? Number(options.minimumWeight)
      : DECISIVE_SCENARIO_MINIMUM_WEIGHT;
    const minimumLead = Number.isFinite(Number(options.minimumLead))
      ? Number(options.minimumLead)
      : DECISIVE_SCENARIO_MINIMUM_LEAD;
    const expectedReturn = Number(options.expectedReturn) || 0;
    const flatBand = Math.max(0.01, Number(options.flatBand) || 0.07);
    const expectedDirection = expectedReturn > flatBand
      ? "upside"
      : (expectedReturn < -flatBand ? "downside" : "sideways");
    const decisive = topWeight >= minimumWeight && lead >= minimumLead;
    const representativeKey = decisive || expectedDirection === rawPrimaryKey
      ? rawPrimaryKey
      : "sideways";
    return Object.freeze({
      weights: Object.freeze(weights),
      rawPrimaryKey,
      representativeKey,
      expectedDirection,
      decisive,
      topWeight,
      secondWeight,
      lead,
    });
  }

  function createForecastScenarioEngine(options = {}) {
    const {
      EPSILON,
      clamp,
      finite,
      neighborPrediction,
      scenarioPathEngine,
      standardDeviation,
    } = options;
    if ([clamp, finite, neighborPrediction, standardDeviation]
      .some((value) => typeof value !== "function")) {
      throw new Error("AI forecast scenario dependencies are required");
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
    const shockDirection = priceRegime?.shortTermShock?.active
      ? priceRegime.shortTermShock.direction
      : "neutral";
    if (direction === "upside") {
      if (shockDirection === "overbought") candidates.push("과열 조정 후 재반등");
      if (shockDirection === "oversold") candidates.push("투매 후 반등 확장");
      if (contextSignal.internetNews > 0.2) candidates.push("최근 종목뉴스 우호적");
      if (contextSignal.fundamentals > 0.15) candidates.push("실적 개선");
      if (contextSignal.consensus > 0.15) candidates.push("컨센서스 상향여력");
      candidates.push(...(rotation.supportReasons || []));
      if (priceRegime.rangeBoundScore > 0.5 && priceRegime.position < 0.3) candidates.push("박스권 하단 반등");
      candidates.push(...marketRegime.supportReasons);
      if (!candidates.length) candidates.push("가격·시장 모멘텀");
    } else if (direction === "downside") {
      if (shockDirection === "overbought") candidates.push("과열 후 추가 조정");
      if (shockDirection === "oversold") candidates.push("급반등 후 저점 재시험");
      if (contextSignal.internetNewsCriticalRisk) candidates.push("최신 초대형 악재");
      if (corporateRisk.recentDilutionRisk) candidates.push("최근 희석성 자금조달");
      if (contextSignal.internetNews < -0.2) candidates.push("최근 종목뉴스 부담");
      candidates.push(...corporateRisk.reasons, ...(rotation.riskReasons || []), ...marketRegime.riskReasons);
      if (priceRegime.rangeBoundScore > 0.5 && priceRegime.position > 0.7) candidates.push("박스권 상단 부담");
      if (contextSignal.fundamentals < -0.15) candidates.push("실적 둔화");
      if (contextSignal.consensus < -0.15) candidates.push("목표가 하방");
      if (!candidates.length) candidates.push("변동성·하방 위험");
    } else {
      if (shockDirection === "overbought") candidates.push("과열 해소 박스권");
      if (shockDirection === "oversold") candidates.push("투매 진정 후 횡보");
      if (contextSignal.internetNewsAmbiguousRows > 0) candidates.push("기업 이벤트 영향 불확실");
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
    let calibratedProbabilities = rescaled.map((value) => (
      ((value / rescaledTotal) * signalStrength) + ((1 - signalStrength) / 3)
    ));
    const ambiguousNewsRows = Math.max(0, Number(contextSignal.internetNewsAmbiguousRows) || 0);
    if (ambiguousNewsRows > 0) {
      const directional = Math.max(EPSILON, calibratedProbabilities[0] + calibratedProbabilities[2]);
      const sidewaysTransfer = Math.min(0.2, ambiguousNewsRows * 0.06, directional * 0.8);
      calibratedProbabilities = [
        calibratedProbabilities[0] * (1 - (sidewaysTransfer / directional)),
        calibratedProbabilities[1] + sidewaysTransfer,
        calibratedProbabilities[2] * (1 - (sidewaysTransfer / directional)),
      ];
    }
    const shortTermShock = priceRegime?.shortTermShock || {};
    const shockStrength = shortTermShock.active
      ? clamp(Number(shortTermShock.strength) || 0, 0, 1.5)
      : 0;
    if (shortTermShock.direction === "overbought" && shockStrength > 0) {
      const transfer = Math.min(
        calibratedProbabilities[0] * 0.55,
        0.08 + (shockStrength * 0.08),
      );
      calibratedProbabilities = [
        calibratedProbabilities[0] - transfer,
        calibratedProbabilities[1] + (transfer * 0.6),
        calibratedProbabilities[2] + (transfer * 0.4),
      ];
    } else if (shortTermShock.direction === "oversold" && shockStrength > 0) {
      const transfer = Math.min(
        calibratedProbabilities[2] * 0.55,
        0.08 + (shockStrength * 0.08),
      );
      calibratedProbabilities = [
        calibratedProbabilities[0] + (transfer * 0.4),
        calibratedProbabilities[1] + (transfer * 0.6),
        calibratedProbabilities[2] - transfer,
      ];
    }
    const hardNegativeRisk = Boolean(
      corporateRisk.terminalRisk
      || corporateRisk.recentDilutionRisk
      || contextSignal.internetNewsCriticalRisk
    );
    if (hardNegativeRisk) {
      const terminalSeverity = corporateRisk.terminalRisk
        || Number(contextSignal.internetNewsCriticalSeverity) >= 1;
      const sideways = clamp(calibratedProbabilities[1], 0.1, terminalSeverity ? 0.15 : 0.3);
      calibratedProbabilities = [0, sideways, 1 - sideways];
    }
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
          + Math.max(0, contextSignal.internetNews || 0) * 0.08
          + Math.max(0, rotation.support || 0) * 0.2,
        0,
        1,
      ),
      risk: clamp(
        (marketRegime.risk || 0)
          + (corporateRisk.score || 0) * 0.35
          + Math.max(0, -(contextSignal.internetNews || 0)) * 0.08
          + Math.max(0, rotation.risk || 0) * 0.2,
        0,
        1,
      ),
      range: structuralRange,
      shock: shortTermShock.active ? Number(shortTermShock.signedStrength) || 0 : 0,
      shockAge: shortTermShock.age,
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
        shortTermShockDirection: shortTermShock.direction || "neutral",
        shortTermShockStrength: shockStrength,
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

    return Object.freeze({
      buildForecastScenarios,
      interpolateAnchors,
      nearestPathSamples,
      residualPath,
    });
  }

  globalScope.ThinkStockAiForecastScenarios = Object.freeze({
    createForecastScenarioEngine,
    resolveScenarioPresentation,
  });
}(typeof self !== "undefined" ? self : globalThis));
