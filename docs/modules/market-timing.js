(function initThinkStockMarketTiming(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const OVERSOLD_MEMORY_DAYS = 20;
  const BUY_SETUP_WINDOW_DAYS = 40;
  const SELL_SIGNAL_COOLDOWN_DAYS = 10;
  const VOLATILITY_MAX_HISTORY_DAYS = 15 * 252;
  const VOLATILITY_RECENT_DAYS = 252;
  const VOLATILITY_REFERENCE_PERCENT = 35;
  const KOREAN_VOLATILITY_RELATIONSHIP_DAYS = 126;
  const KOREAN_VOLATILITY_MINIMUM_OBSERVATIONS = 60;
  const STOCK_OVERHEAT_MEMORY_DAYS = 8;
  const CREDIT_AVAILABILITY_LAG_DAYS = 0;
  const DEFAULT_KOREAN_VOLATILITY_POLICY = Object.freeze({
    buyPercentile: 0.85,
    sellPercentile: 0.2,
    sellChange5: 8,
    sellRebound20: 10,
  });
  const DEFAULT_EXTERNAL_VOLATILITY_POLICY = Object.freeze({
    buyPercentile: 0.8,
    sellPercentile: 0.25,
    sellChange5: 6,
    sellRebound20: 8,
  });
  const DEFAULT_BEHAVIOR_POLICY = Object.freeze({
    buyEnabled: true,
    sellEnabled: true,
    sellDiscoveryEnabled: true,
    minimumHistoryDays: 120,
    rangeFloorPosition: 0.18,
    rangeCeilingPosition: 0.86,
    trendScore: 0.55,
    rangeScore: 0.55,
    calibrationHorizon: 20,
    calibrationMinimumSamples: 8,
    calibrationMaxSamples: 24,
    rejectHitRate: 0.42,
    reboundMinimumPercent: 5,
    reboundAdverseRatio: 2,
    objectiveAware: true,
  });
  const PROMOTED_RUNTIME_BEHAVIOR_POLICY = Object.freeze({
    enabled: true,
    buyEnabled: true,
    sellEnabled: false,
  });

  const toNumber = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );

  function dailyMoveReason(value) {
    const change = toNumber(value);
    if (change === null) return "";
    return `전일대비 ${Math.round(Math.abs(change))}% ${change >= 0 ? "상승" : "하락"}`;
  }

  function uniqueSignalReasons(signal) {
    return [...new Set([
      signal?.setupReasons,
      signal?.sentimentTurnReasons,
      signal?.stabilizationReasons,
      signal?.triggerReasons,
      signal?.sellSetupReasons,
      signal?.sellDeteriorationReasons,
      signal?.sellTriggerReasons,
    ].flatMap((group) => (Array.isArray(group) ? group : []))
      .map((reason) => String(reason || "").trim())
      .filter(Boolean))];
  }

  function decorateTimingSignal(signal) {
    const reasons = uniqueSignalReasons(signal);
    const exceptional = ["extreme-daily", "overheat-continuation"].includes(signal?.entryMode);
    return {
      ...signal,
      evidenceCount: reasons.length,
      signalRole: exceptional ? "warning" : "predictive",
      signalGrade: exceptional ? "이례" : (reasons.length >= 5 ? "강" : "보통"),
    };
  }

  function classifyTimingRegime(point = {}) {
    const stressCount = [
      point.adrMin !== null && point.adrMin <= 80,
      point.fearMin !== null && point.fearMin <= 25,
      point.crisis !== null && point.crisis >= 50,
      point.vkospiPercentile !== null && point.vkospiPercentile >= 0.8,
      point.vixPercentile !== null && point.vixPercentile >= 0.8,
    ].filter(Boolean).length;
    if (stressCount >= 2) return "stress";
    if ((point.priceDrawdown60 ?? 0) <= -10
      && (point.macdSlope ?? -Infinity) > 0
      && ((point.adrMin ?? Infinity) <= 85 || (point.fearMin ?? Infinity) <= 35)) {
      return "recovery";
    }
    if ((point.leadingChange ?? 0) < -0.05
      && (point.price20d ?? -Infinity) >= 0) return "slowdown";
    if ((point.price20d ?? -Infinity) >= 3
      && ((point.leadingChange ?? 0) >= 0 || (point.news ?? -Infinity) >= 100)) {
      return "expansion";
    }
    return "range";
  }

  function clampScore(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function annualizedReturnPercent(totalReturnPercent, tradingDays) {
    const total = Number(totalReturnPercent);
    const days = Math.max(1, Number(tradingDays) || 0);
    if (!Number.isFinite(total) || total <= -100) return null;
    return ((1 + (total / 100)) ** (252 / days) - 1) * 100;
  }

  function pricePathEfficiency(values, index, lookback) {
    const start = Math.max(0, index - Math.max(2, Number(lookback) || 2));
    const first = toNumber(values[start]);
    const last = toNumber(values[index]);
    if (!(first > 0 && last > 0) || index - start < Math.min(20, lookback)) return null;
    let path = 0;
    for (let cursor = start + 1; cursor <= index; cursor += 1) {
      const current = toNumber(values[cursor]);
      const previous = toNumber(values[cursor - 1]);
      if (!(current > 0 && previous > 0)) continue;
      path += Math.abs(Math.log(current / previous));
    }
    return path > 1e-9 ? Math.min(1, Math.abs(Math.log(last / first)) / path) : 0;
  }

  function classifyBehaviorProfile(point = {}, options = {}) {
    const isIndividualStock = options.isIndividualStock === true;
    if (!isIndividualStock) {
      return Object.freeze({
        version: "timing-behavior-v2",
        dominant: "market-index",
        label: "시장지수",
        structural: Object.freeze({ type: "market-index" }),
        state: Object.freeze({ regime: String(point.marketRegime || "range") }),
        scores: Object.freeze({}),
      });
    }
    const historyDays = Math.max(0, Number(point.volatilityHistoryDays) || 0);
    const minimumHistoryDays = Math.max(60, Number(options.minimumHistoryDays)
      || DEFAULT_BEHAVIOR_POLICY.minimumHistoryDays);
    if (historyDays < minimumHistoryDays) {
      return Object.freeze({
        version: "timing-behavior-v2",
        dominant: "insufficient-history",
        label: "이력부족",
        structural: Object.freeze({ historyDays, sufficient: false }),
        state: Object.freeze({ regime: String(point.marketRegime || "range") }),
        scores: Object.freeze({}),
      });
    }

    const scale = Math.max(0.65, Math.min(1.6, Number(point.volatilityScale) || 1));
    const correlation = Math.abs(Number(point.marketCorrelation60) || 0);
    const beta = Math.abs(Number(point.marketBeta60) || 0);
    const downsideBeta = Math.max(0, Number(point.marketDownsideBeta60) || beta);
    const efficiency60 = clampScore(point.trendEfficiency60);
    const efficiency120 = clampScore(point.trendEfficiency120);
    const return60 = Number(point.price60d) || 0;
    const return120 = Number(point.price120d) || 0;
    const trendMagnitude = clampScore(
      (Math.abs(return60) / Math.max(12, 24 * scale) * 0.45)
      + (Math.abs(return120) / Math.max(20, 42 * scale) * 0.55),
    );
    const trendDirection = (return60 * 0.45) + (return120 * 0.55);
    const trendPersistence = clampScore((efficiency60 * 0.45) + (efficiency120 * 0.55));
    const trendUp = trendDirection > 0 ? clampScore((trendMagnitude * 0.65) + (trendPersistence * 0.35)) : 0;
    const trendDown = trendDirection < 0 ? clampScore((trendMagnitude * 0.65) + (trendPersistence * 0.35)) : 0;
    const lowVolatility = clampScore((1.05 - scale) / 0.4);
    const highVolatility = clampScore((scale - 0.95) / 0.55);
    const indexIndependent = clampScore((0.6 - correlation) / 0.6);
    const range = clampScore(
      ((1 - trendMagnitude) * 0.45)
      + ((1 - trendPersistence) * 0.35)
      + (clampScore(1 - Math.abs((Number(point.rangePosition120) || 0.5) - 0.5) * 2) * 0.2),
    );
    const defensive = clampScore(
      (lowVolatility * 0.4)
      + (indexIndependent * 0.25)
      + (clampScore((1.15 - downsideBeta) / 1.15) * 0.35),
    );
    const highVolMomentum = clampScore(
      (highVolatility * 0.45)
      + (Math.max(trendUp, trendDown) * 0.35)
      + (trendPersistence * 0.2),
    );
    const lowVolRange = clampScore((lowVolatility * 0.5) + (range * 0.5));
    const trendFollowing = clampScore((Math.max(trendUp, trendDown) * 0.7) + (trendPersistence * 0.3));
    const indexSensitive = clampScore((correlation * 0.55) + (Math.min(1, beta / 1.4) * 0.45));
    const longTermVolatility = Number(point.longTermVolatility);
    const structuralScale = Number.isFinite(longTermVolatility) && longTermVolatility > 0
      ? Math.max(0.65, Math.min(1.6, longTermVolatility / VOLATILITY_REFERENCE_PERCENT))
      : scale;
    const structuralHorizons = [
      { days: 252, totalReturn: toNumber(point.price252d), weight: 0.5 },
      { days: 756, totalReturn: toNumber(point.price756d), weight: 0.3 },
      { days: 1260, totalReturn: toNumber(point.price1260d), weight: 0.2 },
    ].map((row) => ({
      ...row,
      annualizedReturn: annualizedReturnPercent(row.totalReturn, row.days),
    })).filter((row) => row.annualizedReturn !== null);
    const structuralWeight = structuralHorizons.reduce((sum, row) => sum + row.weight, 0);
    const annualReturn = structuralWeight > 0
      ? structuralHorizons.reduce((sum, row) => sum + (row.annualizedReturn * row.weight), 0)
        / structuralWeight
      : 0;
    const structuralDirection = annualReturn > 3 ? "up" : (annualReturn < -3 ? "down" : "range");
    const matchingDirections = structuralHorizons.filter((row) => (
      structuralDirection === "range"
        ? Math.abs(row.annualizedReturn) <= 5
        : Math.sign(row.annualizedReturn) === (structuralDirection === "up" ? 1 : -1)
    )).length;
    const structuralTrendMagnitude = clampScore(
      Math.abs(annualReturn) / Math.max(20, 45 * structuralScale),
    );
    const structural = Object.freeze({
      historyDays,
      sufficient: true,
      volatilityScale: structuralScale,
      annualReturn,
      return1y: toNumber(point.price252d),
      return3y: toNumber(point.price756d),
      return5y: toNumber(point.price1260d),
      horizonDays: structuralHorizons.at(-1)?.days || 0,
      directionConsistency: structuralHorizons.length
        ? matchingDirections / structuralHorizons.length
        : 0,
      trendDirection: structuralDirection,
      trendMagnitude: structuralTrendMagnitude,
      indexSensitivity: indexSensitive,
      downsideBeta,
    });
    const state = Object.freeze({
      regime: String(point.marketRegime || "range"),
      return20: Number(point.price20d) || 0,
      return60,
      return120,
      rangePosition120: Number.isFinite(Number(point.rangePosition120))
        ? Number(point.rangePosition120)
        : null,
      trendUp,
      trendDown,
      drawdown60: Number.isFinite(Number(point.priceDrawdown60))
        ? Number(point.priceDrawdown60)
        : null,
    });
    const scores = Object.freeze({
      lowVolatility,
      highVolatility,
      range,
      trendUp,
      trendDown,
      defensive,
      indexIndependent,
      indexSensitive,
      lowVolRange,
      highVolMomentum,
      trendFollowing,
    });
    const labels = {
      lowVolRange: "저변동·박스권",
      highVolMomentum: "고변동·모멘텀",
      trendFollowing: "추세형",
      defensive: "방어형",
      indexIndependent: "지수독립형",
    };
    const dominant = Object.keys(labels)
      .sort((left, right) => scores[right] - scores[left])[0] || "balanced";
    return Object.freeze({
      version: "timing-behavior-v2",
      dominant,
      label: labels[dominant] || "혼합형",
      historyDays,
      structural,
      state,
      scores,
    });
  }

  function timingCalibrationObjective(signal, side, objectiveAware = true) {
    if (objectiveAware === false || side !== "buy") return "terminal";
    const behavior = String(signal?.behaviorProfile?.dominant || "unclassified");
    const scores = signal?.behaviorProfile?.scores || {};
    const family = String(signal?.signalFamily || "legacy");
    const trendDown = Number(scores.trendDown) || 0;
    const trendUp = Number(scores.trendUp) || 0;
    const price120d = Number(signal?.price120d) || 0;
    const reversalFamily = [
      "capitulation-reversal",
      "correction-reversal",
      "range-floor-reversal",
      "relative-washout",
    ].includes(family);
    const persistentDecline = trendDown >= Math.max(0.35, trendUp) || price120d <= -15;
    return behavior === "highVolMomentum" && reversalFamily && persistentDecline
      ? "rebound"
      : "terminal";
  }

  function calibrateTimingSignals(signals, side, dates, prices, options = {}) {
    const horizon = Math.max(5, Number(options.horizon)
      || DEFAULT_BEHAVIOR_POLICY.calibrationHorizon);
    const minimumSamples = Math.max(4, Number(options.minimumSamples)
      || DEFAULT_BEHAVIOR_POLICY.calibrationMinimumSamples);
    const requestedMaxSamples = Number(options.maxSamples);
    const maxSamples = Number.isFinite(requestedMaxSamples) && requestedMaxSamples > 0
      ? Math.max(minimumSamples, Math.round(requestedMaxSamples))
      : (options.maxSamples === 0
        ? Infinity
        : DEFAULT_BEHAVIOR_POLICY.calibrationMaxSamples);
    const rejectHitRate = Math.max(0.25, Math.min(0.55,
      Number(options.rejectHitRate) || DEFAULT_BEHAVIOR_POLICY.rejectHitRate));
    const reboundMinimumPercent = Math.max(3, Math.min(12,
      Number(options.reboundMinimumPercent) || DEFAULT_BEHAVIOR_POLICY.reboundMinimumPercent));
    const reboundAdverseRatio = Math.max(1, Math.min(4,
      Number(options.reboundAdverseRatio) || DEFAULT_BEHAVIOR_POLICY.reboundAdverseRatio));
    const objectiveAware = options.objectiveAware !== false;
    const dateIndexes = new Map(dates.map((date, index) => [String(date || "").slice(0, 10), index]));
    const direction = side === "sell" ? -1 : 1;
    const rows = (Array.isArray(signals) ? signals : [])
      .map((signal, order) => {
        const actionDate = String(signal?.confirmationDate || signal?.date || "").slice(0, 10);
        const actionIndex = dateIndexes.get(actionDate);
        const startPrice = toNumber(prices[actionIndex]);
        const endPrice = toNumber(prices[actionIndex + horizon]);
        if (!Number.isInteger(actionIndex) || !(startPrice > 0 && endPrice > 0)) {
          return { signal, order, actionIndex, outcome: null };
        }
        const future = prices.slice(actionIndex + 1, actionIndex + horizon + 1)
          .map(toNumber)
          .filter((value) => value > 0);
        const directionalReturn = direction * ((endPrice / startPrice) - 1) * 100;
        const favorableReturn = future.length
          ? (side === "sell"
            ? (1 - (Math.min(...future) / startPrice)) * 100
            : ((Math.max(...future) / startPrice) - 1) * 100)
          : null;
        const adverseReturn = future.length
          ? (side === "sell"
            ? (1 - (Math.max(...future) / startPrice)) * 100
            : ((Math.min(...future) / startPrice) - 1) * 100)
          : null;
        const objective = timingCalibrationObjective(signal, side, objectiveAware);
        const volatilityScale = Math.max(0.65, Math.min(1.6,
          Number(signal?.volatilityScale) || 1));
        const reboundThreshold = Math.max(reboundMinimumPercent,
          Math.min(10, reboundMinimumPercent * volatilityScale));
        const reboundHit = objective === "rebound"
          && (favorableReturn ?? -Infinity) >= reboundThreshold
          && (adverseReturn ?? -Infinity) >= -(reboundThreshold * reboundAdverseRatio);
        const hit = directionalReturn > 0 || reboundHit;
        return {
          signal,
          order,
          actionIndex,
          outcome: {
            maturedIndex: actionIndex + horizon,
            directionalReturn,
            favorableReturn,
            adverseReturn,
            objectiveReturn: objective === "rebound"
              ? (favorableReturn ?? 0) - reboundThreshold
              : directionalReturn,
            reboundThreshold,
            hit,
            family: String(signal?.signalFamily || "legacy"),
            behavior: String(signal?.behaviorProfile?.dominant || "unclassified"),
            role: String(signal?.signalRole || "predictive"),
            objective,
          },
        };
      })
      .sort((left, right) => (left.actionIndex - right.actionIndex) || (left.order - right.order));
    let abstained = 0;
    const accepted = rows.flatMap((row) => {
      if (!Number.isInteger(row.actionIndex)) return [row.signal];
      const role = String(row.signal?.signalRole || "predictive");
      const objective = timingCalibrationObjective(row.signal, side, objectiveAware);
      const available = rows
        .filter((prior) => prior.outcome
          && prior.outcome.maturedIndex < row.actionIndex
          && prior.outcome.role === role
          && prior.outcome.objective === objective)
        .map((prior) => prior.outcome);
      const family = String(row.signal?.signalFamily || "legacy");
      const behavior = String(row.signal?.behaviorProfile?.dominant || "unclassified");
      const exact = available.filter((prior) => prior.family === family && prior.behavior === behavior);
      const sameBehavior = available.filter((prior) => prior.behavior === behavior);
      const cohortType = exact.length >= 4
        ? "family-behavior"
        : (sameBehavior.length >= 6 ? "behavior" : "side");
      const fullCohort = cohortType === "family-behavior"
        ? exact
        : (cohortType === "behavior" ? sameBehavior : available);
      const cohort = Number.isFinite(maxSamples) ? fullCohort.slice(-maxSamples) : fullCohort;
      const samples = cohort.length;
      const hits = cohort.filter((prior) => prior.hit).length;
      const hitRate = samples ? hits / samples : null;
      const smoothedHitRate = samples ? (hits + 2) / (samples + 4) : null;
      const meanDirectionalReturn = samples
        ? cohort.reduce((sum, prior) => sum + prior.directionalReturn, 0) / samples
        : null;
      const finiteFavorable = cohort.map((prior) => prior.favorableReturn).filter(Number.isFinite);
      const meanFavorableReturn = finiteFavorable.length
        ? finiteFavorable.reduce((sum, value) => sum + value, 0) / finiteFavorable.length
        : null;
      const meanObjectiveReturn = samples
        ? cohort.reduce((sum, prior) => sum + prior.objectiveReturn, 0) / samples
        : null;
      const finiteAdverse = cohort.map((prior) => prior.adverseReturn).filter(Number.isFinite);
      const meanAdverseReturn = finiteAdverse.length
        ? finiteAdverse.reduce((sum, value) => sum + value, 0) / finiteAdverse.length
        : null;
      const exceptional = ["extreme-daily", "overheat-continuation"].includes(row.signal?.entryMode);
      const calibrationRejected = !exceptional && samples >= minimumSamples
        && smoothedHitRate < rejectHitRate
        && (meanObjectiveReturn ?? 0) <= 0;
      // A mixed-family fallback cohort is too coarse to silence a strongly
      // confirmed buy. Exact family-behavior failures still retain veto power.
      const evidenceOverride = side === "buy"
        && calibrationRejected
        && cohortType !== "family-behavior"
        && (
          (Number(row.signal?.evidenceCount) || 0) >= 7
          || (
            (Number(row.signal?.evidenceCount) || 0) >= 6
            && family === "trend-pullback"
            && (Number(row.signal?.price60d) || 0) > 0
            && (Number(row.signal?.price120d) || 0) > 0
          )
        );
      const rejected = calibrationRejected && !evidenceOverride;
      const calibrated = {
        ...row.signal,
        calibration: Object.freeze({
          pointInTime: true,
          horizon,
          objective,
          samples,
          maxSamples: Number.isFinite(maxSamples) ? maxSamples : null,
          hitRate,
          smoothedHitRate,
          meanDirectionalReturn,
          meanFavorableReturn,
          meanObjectiveReturn,
          meanAdverseReturn,
          cohort: cohortType,
          role,
          status: rejected
            ? "abstained"
            : (evidenceOverride ? "evidence-override" : (samples >= minimumSamples ? "usable" : "pending")),
        }),
      };
      if (rejected) {
        abstained += 1;
        return [];
      }
      return [calibrated];
    });
    return Object.freeze({ signals: accepted, abstained });
  }

  function stockOverheatMemory(prices, index, lookback = STOCK_OVERHEAT_MEMORY_DAYS) {
    const extremeIndexes = [];
    const start = Math.max(1, index - Math.max(2, Number(lookback) || STOCK_OVERHEAT_MEMORY_DAYS));
    for (let cursor = start; cursor < index; cursor += 1) {
      const move = changeRate(prices, cursor, 1);
      if (move !== null && move >= 25 && move <= 31.5) extremeIndexes.push(cursor);
    }
    if (extremeIndexes.length < 2) return null;
    const firstIndex = extremeIndexes[0];
    const lastIndex = extremeIndexes.at(-1);
    const basePrice = toNumber(prices[firstIndex - 1]);
    const currentPrice = toNumber(prices[index]);
    const clusterPrices = prices.slice(firstIndex, index + 1).map(toNumber).filter(Number.isFinite);
    const clusterHigh = clusterPrices.length ? Math.max(...clusterPrices) : null;
    if (!basePrice || !currentPrice || !clusterHigh) return null;
    return {
      count: extremeIndexes.length,
      span: lastIndex - firstIndex,
      age: index - lastIndex,
      lastExtremeIndex: lastIndex,
      cumulativeGain: ((currentPrice / basePrice) - 1) * 100,
      drawdownFromHigh: ((currentPrice / clusterHigh) - 1) * 100,
    };
  }

  function trailingAverage(values, size) {
    const output = Array(values.length).fill(null);
    const queue = [];
    let sum = 0;
    let count = 0;
    values.forEach((rawValue, index) => {
      const value = toNumber(rawValue);
      queue.push(value);
      if (value !== null) {
        sum += value;
        count += 1;
      }
      if (queue.length > size) {
        const removed = queue.shift();
        if (removed !== null) {
          sum -= removed;
          count -= 1;
        }
      }
      output[index] = count ? sum / count : null;
    });
    return output;
  }

  function shiftDate(date, days) {
    const milliseconds = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(milliseconds)) return "";
    return new Date(milliseconds + (days * DAY_MS)).toISOString().slice(0, 10);
  }

  function normalizeValueRows(rows, key, transform = (value) => value, availabilityLagDays = 0) {
    const byDate = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const sourceDate = String(row?.date || "").slice(0, 10);
      const date = availabilityLagDays ? shiftDate(sourceDate, availabilityLagDays) : sourceDate;
      const value = toNumber(row?.[key]);
      if (date && value !== null) byDate.set(date, { date, value: transform(value) });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function alignAsOf(dates, rows, maxAgeDays) {
    const output = Array(dates.length).fill(null);
    let rowIndex = -1;
    dates.forEach((date, index) => {
      while (rowIndex + 1 < rows.length && rows[rowIndex + 1].date <= date) rowIndex += 1;
      if (rowIndex < 0) return;
      const age = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${rows[rowIndex].date}T00:00:00Z`)) / DAY_MS;
      if (Number.isFinite(age) && age >= 0 && age <= maxAgeDays) output[index] = rows[rowIndex].value;
    });
    return output;
  }

  function alignedSource(dates, rows, key, maxAgeDays, availabilityLagDays = 0) {
    return alignAsOf(dates, normalizeValueRows(rows, key, undefined, availabilityLagDays), maxAgeDays);
  }

  function recentFinite(values, endIndex, count) {
    return values.slice(Math.max(0, endIndex - count + 1), endIndex + 1).filter(Number.isFinite);
  }

  function changeRate(values, index, lookback) {
    const current = toNumber(values[index]);
    const previous = toNumber(values[index - lookback]);
    return current !== null && previous !== null && Math.abs(previous) > 1e-9
      ? ((current / previous) - 1) * 100
      : null;
  }

  function standardizedReturn(values, index, lookback, volatilityLookback = 63) {
    const current = toNumber(values[index]);
    const previous = toNumber(values[index - lookback]);
    if (!(current > 0 && previous > 0)) return null;
    const returns = [];
    const start = Math.max(1, index - volatilityLookback + 1);
    for (let cursor = start; cursor <= index; cursor += 1) {
      const right = toNumber(values[cursor]);
      const left = toNumber(values[cursor - 1]);
      if (right > 0 && left > 0) returns.push(Math.log(right / left));
    }
    if (returns.length < Math.min(20, volatilityLookback)) return null;
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + ((value - average) ** 2), 0)
      / Math.max(1, returns.length - 1);
    const volatility = Math.max(0.002, Math.sqrt(Math.max(0, variance)));
    return Math.log(current / previous) / (volatility * Math.sqrt(lookback));
  }

  function buildVolatilityProfile(values, options = {}) {
    const maxHistoryDays = Math.max(60, Number(options.maxHistoryDays) || VOLATILITY_MAX_HISTORY_DAYS);
    const recentDays = Math.max(60, Number(options.recentDays) || VOLATILITY_RECENT_DAYS);
    const referencePercent = Math.max(1, Number(options.referencePercent) || VOLATILITY_REFERENCE_PERCENT);
    const returns = values.map((rawValue, index) => {
      const current = toNumber(rawValue);
      const previous = toNumber(values[index - 1]);
      if (!(current > 0 && previous > 0)) return null;
      return Math.max(-0.12, Math.min(0.12, Math.log(current / previous)));
    });
    const prefixSum = Array(values.length + 1).fill(0);
    const prefixSquare = Array(values.length + 1).fill(0);
    const prefixCount = Array(values.length + 1).fill(0);
    returns.forEach((value, index) => {
      prefixSum[index + 1] = prefixSum[index] + (value ?? 0);
      prefixSquare[index + 1] = prefixSquare[index] + (value === null ? 0 : value ** 2);
      prefixCount[index + 1] = prefixCount[index] + (value === null ? 0 : 1);
    });

    function annualizedAt(index, lookback) {
      const start = Math.max(1, index - lookback + 1);
      const end = index + 1;
      const count = prefixCount[end] - prefixCount[start];
      if (count < 60) return null;
      const sum = prefixSum[end] - prefixSum[start];
      const squareSum = prefixSquare[end] - prefixSquare[start];
      const variance = Math.max(0, (squareSum - ((sum ** 2) / count)) / Math.max(1, count - 1));
      return Math.sqrt(variance * 252) * 100;
    }

    const longTerm = Array(values.length).fill(null);
    const recent = Array(values.length).fill(null);
    const effective = Array(values.length).fill(null);
    const scale = Array(values.length).fill(1);
    const historyDays = Array(values.length).fill(0);
    values.forEach((_, index) => {
      longTerm[index] = annualizedAt(index, maxHistoryDays);
      recent[index] = annualizedAt(index, recentDays);
      historyDays[index] = Math.min(maxHistoryDays, prefixCount[index + 1]);
      const structural = longTerm[index] ?? recent[index];
      const current = recent[index] ?? structural;
      if (structural === null || current === null) return;
      effective[index] = (structural * 0.75) + (current * 0.25);
      scale[index] = Math.max(0.65, Math.min(1.6, effective[index] / referencePercent));
    });
    return { longTerm, recent, effective, scale, historyDays };
  }

  function rollingMarketRelationship(prices, benchmarkPrices, index, lookback = 60) {
    const stockReturns = [];
    const marketReturns = [];
    const downsideStockReturns = [];
    const downsideMarketReturns = [];
    const start = Math.max(1, index - lookback + 1);
    for (let cursor = start; cursor <= index; cursor += 1) {
      const stock = toNumber(prices[cursor]);
      const stockPrevious = toNumber(prices[cursor - 1]);
      const market = toNumber(benchmarkPrices[cursor]);
      const marketPrevious = toNumber(benchmarkPrices[cursor - 1]);
      if (!(stock > 0 && stockPrevious > 0 && market > 0 && marketPrevious > 0)) continue;
      const stockReturn = Math.log(stock / stockPrevious);
      const marketReturn = Math.log(market / marketPrevious);
      stockReturns.push(stockReturn);
      marketReturns.push(marketReturn);
      if (marketReturn < 0) {
        downsideStockReturns.push(stockReturn);
        downsideMarketReturns.push(marketReturn);
      }
    }
    if (stockReturns.length < 30) return { correlation: null, beta: null, downsideBeta: null };

    const stockAverage = stockReturns.reduce((sum, value) => sum + value, 0) / stockReturns.length;
    const marketAverage = marketReturns.reduce((sum, value) => sum + value, 0) / marketReturns.length;
    let covariance = 0;
    let stockVariance = 0;
    let marketVariance = 0;
    stockReturns.forEach((stockReturn, returnIndex) => {
      const stockDelta = stockReturn - stockAverage;
      const marketDelta = marketReturns[returnIndex] - marketAverage;
      covariance += stockDelta * marketDelta;
      stockVariance += stockDelta ** 2;
      marketVariance += marketDelta ** 2;
    });
    if (stockVariance <= 1e-12 || marketVariance <= 1e-12) {
      return { correlation: null, beta: null, downsideBeta: null };
    }
    let downsideBeta = null;
    if (downsideMarketReturns.length >= 10) {
      const stockDownAverage = downsideStockReturns.reduce((sum, value) => sum + value, 0)
        / downsideStockReturns.length;
      const marketDownAverage = downsideMarketReturns.reduce((sum, value) => sum + value, 0)
        / downsideMarketReturns.length;
      let downsideCovariance = 0;
      let downsideVariance = 0;
      downsideMarketReturns.forEach((marketReturn, returnIndex) => {
        downsideCovariance += (downsideStockReturns[returnIndex] - stockDownAverage)
          * (marketReturn - marketDownAverage);
        downsideVariance += (marketReturn - marketDownAverage) ** 2;
      });
      if (downsideVariance > 1e-12) downsideBeta = downsideCovariance / downsideVariance;
    }
    return {
      correlation: covariance / Math.sqrt(stockVariance * marketVariance),
      beta: covariance / marketVariance,
      downsideBeta,
    };
  }

  function buildRollingReturnRelationship(leftValues, rightValues, options = {}) {
    const count = Math.min(
      Array.isArray(leftValues) ? leftValues.length : 0,
      Array.isArray(rightValues) ? rightValues.length : 0,
    );
    const lookback = Math.max(20, Number(options.lookback)
      || KOREAN_VOLATILITY_RELATIONSHIP_DAYS);
    const minimumObservations = Math.max(10, Math.min(
      lookback,
      Number(options.minimumObservations) || KOREAN_VOLATILITY_MINIMUM_OBSERVATIONS,
    ));
    const availabilityLag = Math.max(0, Number(options.availabilityLag) || 0);
    const correlation = Array(count).fill(null);
    const beta = Array(count).fill(null);
    const observations = Array(count).fill(0);
    const pairs = [];
    let head = 0;
    let sumLeft = 0;
    let sumRight = 0;
    let sumLeftSquare = 0;
    let sumRightSquare = 0;
    let sumProduct = 0;

    function remove(pair) {
      sumLeft -= pair.left;
      sumRight -= pair.right;
      sumLeftSquare -= pair.left ** 2;
      sumRightSquare -= pair.right ** 2;
      sumProduct -= pair.left * pair.right;
    }

    for (let index = 0; index < count; index += 1) {
      const returnIndex = index - availabilityLag;
      if (returnIndex >= 1) {
        const left = toNumber(leftValues[returnIndex]);
        const leftPrevious = toNumber(leftValues[returnIndex - 1]);
        const right = toNumber(rightValues[returnIndex]);
        const rightPrevious = toNumber(rightValues[returnIndex - 1]);
        if (left > 0 && leftPrevious > 0 && right > 0 && rightPrevious > 0) {
          const pair = {
            index: returnIndex,
            left: Math.log(left / leftPrevious),
            right: Math.log(right / rightPrevious),
          };
          pairs.push(pair);
          sumLeft += pair.left;
          sumRight += pair.right;
          sumLeftSquare += pair.left ** 2;
          sumRightSquare += pair.right ** 2;
          sumProduct += pair.left * pair.right;
        }
      }

      const earliestReturnIndex = returnIndex - lookback + 1;
      while (head < pairs.length && pairs[head].index < earliestReturnIndex) {
        remove(pairs[head]);
        head += 1;
      }
      if (head > 512 && head * 2 > pairs.length) {
        pairs.splice(0, head);
        head = 0;
      }

      const sampleCount = pairs.length - head;
      observations[index] = sampleCount;
      if (sampleCount < minimumObservations) continue;
      const covariance = sumProduct - ((sumLeft * sumRight) / sampleCount);
      const leftVariance = sumLeftSquare - ((sumLeft ** 2) / sampleCount);
      const rightVariance = sumRightSquare - ((sumRight ** 2) / sampleCount);
      if (leftVariance <= 1e-12 || rightVariance <= 1e-12) continue;
      correlation[index] = covariance / Math.sqrt(leftVariance * rightVariance);
      beta[index] = covariance / rightVariance;
    }
    return { correlation, beta, observations };
  }

  function volumeProfile(volumes, index) {
    const current = toNumber(volumes[index]);
    const recent = recentFinite(volumes, index - 1, 20);
    const prior = volumes.slice(Math.max(0, index - 40), Math.max(0, index - 20)).filter(Number.isFinite);
    if (current === null || recent.length < 10) return { ratio: null, trend: null };
    const recentAverage = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const priorAverage = prior.length
      ? prior.reduce((sum, value) => sum + value, 0) / prior.length
      : null;
    return {
      ratio: recentAverage > 0 ? current / recentAverage : null,
      trend: priorAverage > 0 ? recentAverage / priorAverage : null,
    };
  }

  function rollingPercentile(values, index, lookback = 252) {
    const current = toNumber(values[index]);
    if (current === null) return null;
    const history = values
      .slice(Math.max(0, index - lookback), index)
      .filter(Number.isFinite);
    if (history.length < 40) return null;
    return history.filter((value) => value <= current).length / history.length;
  }

  function buildKoreanVolatilityTimingRows(rows, options = {}) {
    const lookback = Math.max(60, Number(options.lookback) || 252);
    const minimumHistory = Math.max(40, Number(options.minimumHistory) || 60);
    const source = normalizeValueRows(rows, "vkospi");
    const values = source.map((row) => row.value);
    return source.map((row, index) => {
      const history = values
        .slice(Math.max(0, index - lookback), index)
        .filter(Number.isFinite);
      if (history.length < minimumHistory) return { date: row.date, vkospi: row.value };
      const average = history.reduce((sum, value) => sum + value, 0) / history.length;
      const variance = history.reduce((sum, value) => sum + ((value - average) ** 2), 0)
        / Math.max(1, history.length - 1);
      const deviation = Math.sqrt(Math.max(0, variance));
      const recent = values.slice(Math.max(0, index - 19), index + 1).filter(Number.isFinite);
      const recentHigh = recent.length ? Math.max(...recent) : null;
      const recentLow = recent.length ? Math.min(...recent) : null;
      return {
        date: row.date,
        vkospi: row.value,
        vkospiPercentile: history.filter((value) => value <= row.value).length / history.length,
        vkospiZScore: deviation > 1e-9 ? (row.value - average) / deviation : 0,
        vkospiChange5: changeRate(values, index, 5),
        vkospiChange20: changeRate(values, index, 20),
        vkospiDrawdown20: recentHigh > 0 ? ((row.value / recentHigh) - 1) * 100 : null,
        vkospiRebound20: recentLow > 0 ? ((row.value / recentLow) - 1) * 100 : null,
      };
    });
  }

  function buildExternalVolatilityTimingRows(rows, options = {}) {
    const lookback = Math.max(60, Number(options.lookback) || 252);
    const minimumHistory = Math.max(40, Number(options.minimumHistory) || 60);
    const source = normalizeValueRows(rows, "vix");
    const values = source.map((row) => row.value);
    return source.map((row, index) => {
      const history = values
        .slice(Math.max(0, index - lookback), index)
        .filter(Number.isFinite);
      if (history.length < minimumHistory) return { date: row.date, vix: row.value };
      const average = history.reduce((sum, value) => sum + value, 0) / history.length;
      const variance = history.reduce((sum, value) => sum + ((value - average) ** 2), 0)
        / Math.max(1, history.length - 1);
      const deviation = Math.sqrt(Math.max(0, variance));
      const recent = values.slice(Math.max(0, index - 19), index + 1).filter(Number.isFinite);
      const recentHigh = recent.length ? Math.max(...recent) : null;
      const recentLow = recent.length ? Math.min(...recent) : null;
      return {
        date: row.date,
        vix: row.value,
        vixPercentile: history.filter((value) => value <= row.value).length / history.length,
        vixZScore: deviation > 1e-9 ? (row.value - average) / deviation : 0,
        vixChange5: changeRate(values, index, 5),
        vixChange20: changeRate(values, index, 20),
        vixDrawdown20: recentHigh > 0 ? ((row.value / recentHigh) - 1) * 100 : null,
        vixRebound20: recentLow > 0 ? ((row.value / recentLow) - 1) * 100 : null,
      };
    });
  }

  function scoreTimingPoint(context, index) {
    const {
      prices,
      oscillator,
      adr,
      fearGreed,
      news,
      leading,
      creditGrowth,
      creditPercentile,
      crisis,
      koreanVolatility,
      koreanVolatilityRelationship,
      externalVolatility,
      externalVolatilityRelationship,
      benchmarkPrices,
      volumes,
      volatilityProfile,
    } = context;
    const adrWindow = recentFinite(adr, index, OVERSOLD_MEMORY_DAYS);
    const fearWindow = recentFinite(fearGreed, index, OVERSOLD_MEMORY_DAYS);
    const newsWindow = recentFinite(news, index, 20);
    const adrMin = adrWindow.length ? Math.min(...adrWindow) : null;
    const fearMin = fearWindow.length ? Math.min(...fearWindow) : null;
    const newsMin = newsWindow.length ? Math.min(...newsWindow) : null;
    const adrNow = toNumber(adr[index]);
    const fearNow = toNumber(fearGreed[index]);
    const creditChange = toNumber(creditGrowth[index]);
    const creditRank = toNumber(creditPercentile[index]);
    const recentCreditGrowth = recentFinite(creditGrowth, index, OVERSOLD_MEMORY_DAYS);
    const recentCreditRanks = recentFinite(creditPercentile, index, OVERSOLD_MEMORY_DAYS);
    const creditWashoutGrowth = recentCreditGrowth.length ? Math.min(...recentCreditGrowth) : null;
    const creditWashoutRank = recentCreditRanks.length ? Math.min(...recentCreditRanks) : null;
    const creditWashedOut = creditWashoutGrowth !== null && creditWashoutRank !== null
      && creditWashoutGrowth <= -5 && creditWashoutRank <= 0.1;

    const oscNow = toNumber(oscillator[index]);
    const osc1 = toNumber(oscillator[index - 1]);
    const osc2 = toNumber(oscillator[index - 2]);
    const macdSlope = oscNow !== null && osc1 !== null ? oscNow - osc1 : null;
    const priorMacdSlope = osc1 !== null && osc2 !== null ? osc1 - osc2 : null;

    const priceNow = toNumber(prices[index]);
    const high60Values = recentFinite(prices, index, 60);
    const high120Values = recentFinite(prices, index, 120);
    const low20Values = recentFinite(prices, index, 20);
    const high60 = high60Values.length ? Math.max(...high60Values) : null;
    const high120 = high120Values.length ? Math.max(...high120Values) : null;
    const low20 = low20Values.length ? Math.min(...low20Values) : null;
    const low120 = high120Values.length ? Math.min(...high120Values) : null;
    const priceDrawdown60 = priceNow !== null && high60 ? ((priceNow / high60) - 1) * 100 : null;
    const priceDrawdown120 = priceNow !== null && high120 ? ((priceNow / high120) - 1) * 100 : null;
    const price1d = changeRate(prices, index, 1);
    const price2d = changeRate(prices, index, 2);
    const price5d = changeRate(prices, index, 5);
    const price20d = changeRate(prices, index, 20);
    const price60d = changeRate(prices, index, 60);
    const price120d = changeRate(prices, index, 120);
    const price252d = changeRate(prices, index, 252);
    const price756d = changeRate(prices, index, 756);
    const price1260d = changeRate(prices, index, 1260);
    const price20dVolScore = standardizedReturn(prices, index, 20);
    const price60dVolScore = standardizedReturn(prices, index, 60);
    const price5dVolScore = standardizedReturn(prices, index, 5);
    const benchmark20d = changeRate(benchmarkPrices, index, 20);
    const relative20d = price20d !== null && benchmark20d !== null ? price20d - benchmark20d : null;
    const marketRelationship = rollingMarketRelationship(prices, benchmarkPrices, index);
    const volume = volumeProfile(volumes, index);

    const newsNow = toNumber(news[index]);
    const leadingNow = toNumber(leading[index]);
    const leading40 = toNumber(leading[index - 40]);
    const leadingChange = leadingNow !== null && leading40 !== null ? leadingNow - leading40 : null;
    const crisisNow = toNumber(crisis[index]);
    const koreanVolatilityNow = koreanVolatility || {};
    const externalVolatilityNow = externalVolatility || {};
    const point = {
      score: [adrMin !== null && adrMin <= 80, fearMin !== null && fearMin <= 25, creditWashedOut]
        .filter(Boolean).length,
      adrMin,
      fearMin,
      newsMin,
      oscillator: oscNow,
      price1d,
      price2d,
      price5d,
      price20d,
      price60d,
      price120d,
      price252d,
      price756d,
      price1260d,
      price20dVolScore,
      price60dVolScore,
      price5dVolScore,
      benchmark20d,
      relative20d,
      marketCorrelation60: marketRelationship.correlation,
      marketBeta60: marketRelationship.beta,
      marketDownsideBeta60: marketRelationship.downsideBeta,
      volumeRatio: volume.ratio,
      volumeTrend: volume.trend,
      price: priceNow,
      high60,
      high120,
      low20,
      low120,
      rangePosition120: priceNow !== null && high120 !== null && low120 !== null && high120 > low120
        ? (priceNow - low120) / (high120 - low120)
        : null,
      trendEfficiency60: pricePathEfficiency(prices, index, 60),
      trendEfficiency120: pricePathEfficiency(prices, index, 120),
      priceDrawdown60,
      priceDrawdown120,
      macdSlope,
      priorMacdSlope,
      adr: adrNow,
      fearGreed: fearNow,
      news: newsNow,
      leading: leadingNow,
      leadingChange,
      creditChange,
      creditPercentile: creditRank,
      creditWashoutGrowth,
      creditWashoutPercentile: creditWashoutRank,
      creditWashedOut,
      crisis: crisisNow,
      vkospi: toNumber(koreanVolatilityNow.value?.[index]),
      vkospiPercentile: toNumber(koreanVolatilityNow.percentile?.[index]),
      vkospiZScore: toNumber(koreanVolatilityNow.zScore?.[index]),
      vkospiChange5: toNumber(koreanVolatilityNow.change5?.[index]),
      vkospiChange20: toNumber(koreanVolatilityNow.change20?.[index]),
      vkospiDrawdown20: toNumber(koreanVolatilityNow.drawdown20?.[index]),
      vkospiRebound20: toNumber(koreanVolatilityNow.rebound20?.[index]),
      vkospiCorrelation126: toNumber(koreanVolatilityRelationship?.correlation?.[index]),
      vkospiBeta126: toNumber(koreanVolatilityRelationship?.beta?.[index]),
      vkospiRelationshipObservations: toNumber(
        koreanVolatilityRelationship?.observations?.[index],
      ) ?? 0,
      vix: toNumber(externalVolatilityNow.value?.[index]),
      vixPercentile: toNumber(externalVolatilityNow.percentile?.[index]),
      vixZScore: toNumber(externalVolatilityNow.zScore?.[index]),
      vixChange5: toNumber(externalVolatilityNow.change5?.[index]),
      vixChange20: toNumber(externalVolatilityNow.change20?.[index]),
      vixDrawdown20: toNumber(externalVolatilityNow.drawdown20?.[index]),
      vixRebound20: toNumber(externalVolatilityNow.rebound20?.[index]),
      vixCorrelation126: toNumber(externalVolatilityRelationship?.correlation?.[index]),
      vixBeta126: toNumber(externalVolatilityRelationship?.beta?.[index]),
      vixRelationshipObservations: toNumber(
        externalVolatilityRelationship?.observations?.[index],
      ) ?? 0,
      longTermVolatility: toNumber(volatilityProfile?.longTerm?.[index]),
      recentVolatility: toNumber(volatilityProfile?.recent?.[index]),
      effectiveVolatility: toNumber(volatilityProfile?.effective?.[index]),
      volatilityScale: toNumber(volatilityProfile?.scale?.[index]) ?? 1,
      volatilityHistoryDays: toNumber(volatilityProfile?.historyDays?.[index]) ?? 0,
    };
    return { ...point, marketRegime: classifyTimingRegime(point) };
  }

  function buildMarketTimingSignals(options = {}) {
    const dates = Array.isArray(options.dates) ? options.dates.map((date) => String(date || "").slice(0, 10)) : [];
    const prices = Array.isArray(options.prices) ? options.prices.map(toNumber) : [];
    const oscillator = Array.isArray(options.oscillator) ? options.oscillator.map(toNumber) : [];
    const benchmarkPrices = Array.isArray(options.benchmarkPrices)
      ? options.benchmarkPrices.map(toNumber)
      : [];
    const volumes = Array.isArray(options.volumes) ? options.volumes.map(toNumber) : [];
    const count = Math.min(dates.length, prices.length, oscillator.length);
    if (count < 40) return { signals: [], sellSignals: [], scores: [], coverage: 0 };

    const indexKey = String(options.indexKey || "").toUpperCase();
    const isKosdaqSeries = indexKey === "^KQ11" || indexKey.endsWith(".KQ");
    const isIndividualStock = /^\d{6}\.(KS|KQ)$/.test(indexKey);
    const isMarketIndex = indexKey === "^KS11" || indexKey === "^KQ11";
    const koreanVolatilityPolicy = options.koreanVolatilityPolicy?.enabled === true
      ? {
        enabled: true,
        buyPercentile: Number(options.koreanVolatilityPolicy.buyPercentile)
          || DEFAULT_KOREAN_VOLATILITY_POLICY.buyPercentile,
        sellPercentile: Number(options.koreanVolatilityPolicy.sellPercentile)
          || DEFAULT_KOREAN_VOLATILITY_POLICY.sellPercentile,
        sellChange5: Number(options.koreanVolatilityPolicy.sellChange5)
          || DEFAULT_KOREAN_VOLATILITY_POLICY.sellChange5,
        sellRebound20: Number(options.koreanVolatilityPolicy.sellRebound20)
          || DEFAULT_KOREAN_VOLATILITY_POLICY.sellRebound20,
        maximumCorrelation: Number.isFinite(Number(
          options.koreanVolatilityPolicy.maximumCorrelation,
        )) ? Number(options.koreanVolatilityPolicy.maximumCorrelation) : -0.15,
        minimumObservations: Math.max(30, Number(
          options.koreanVolatilityPolicy.minimumObservations,
        ) || KOREAN_VOLATILITY_MINIMUM_OBSERVATIONS),
        relationshipLookback: Math.max(60, Number(
          options.koreanVolatilityPolicy.relationshipLookback,
        ) || KOREAN_VOLATILITY_RELATIONSHIP_DAYS),
        stockBuy: options.koreanVolatilityPolicy.stockBuy !== false,
        stockSell: options.koreanVolatilityPolicy.stockSell !== false,
        indexBuy: options.koreanVolatilityPolicy.indexBuy !== false,
        indexSell: options.koreanVolatilityPolicy.indexSell !== false,
      }
      : { enabled: false };
    const externalVolatilityPolicy = options.externalVolatilityPolicy?.enabled === true
      ? {
        enabled: true,
        buyPercentile: Number(options.externalVolatilityPolicy.buyPercentile)
          || DEFAULT_EXTERNAL_VOLATILITY_POLICY.buyPercentile,
        sellPercentile: Number(options.externalVolatilityPolicy.sellPercentile)
          || DEFAULT_EXTERNAL_VOLATILITY_POLICY.sellPercentile,
        sellChange5: Number(options.externalVolatilityPolicy.sellChange5)
          || DEFAULT_EXTERNAL_VOLATILITY_POLICY.sellChange5,
        sellRebound20: Number(options.externalVolatilityPolicy.sellRebound20)
          || DEFAULT_EXTERNAL_VOLATILITY_POLICY.sellRebound20,
        maximumCorrelation: Number.isFinite(Number(
          options.externalVolatilityPolicy.maximumCorrelation,
        )) ? Number(options.externalVolatilityPolicy.maximumCorrelation) : -0.1,
        minimumObservations: Math.max(30, Number(
          options.externalVolatilityPolicy.minimumObservations,
        ) || KOREAN_VOLATILITY_MINIMUM_OBSERVATIONS),
        relationshipLookback: Math.max(60, Number(
          options.externalVolatilityPolicy.relationshipLookback,
        ) || KOREAN_VOLATILITY_RELATIONSHIP_DAYS),
        stockBuy: options.externalVolatilityPolicy.stockBuy !== false,
        stockSell: options.externalVolatilityPolicy.stockSell !== false,
        indexBuy: options.externalVolatilityPolicy.indexBuy !== false,
        indexSell: options.externalVolatilityPolicy.indexSell !== false,
      }
      : { enabled: false };
    const behaviorPolicy = options.behaviorPolicy?.enabled === true
      ? {
        enabled: true,
        buyEnabled: options.behaviorPolicy.buyEnabled !== false,
        sellEnabled: options.behaviorPolicy.sellEnabled !== false,
        sellDiscoveryEnabled: options.behaviorPolicy.sellDiscoveryEnabled !== false,
        minimumHistoryDays: Math.max(60, Number(options.behaviorPolicy.minimumHistoryDays)
          || DEFAULT_BEHAVIOR_POLICY.minimumHistoryDays),
        rangeFloorPosition: Math.max(0.05, Math.min(0.35,
          Number(options.behaviorPolicy.rangeFloorPosition)
            || DEFAULT_BEHAVIOR_POLICY.rangeFloorPosition)),
        rangeCeilingPosition: Math.max(0.65, Math.min(0.95,
          Number(options.behaviorPolicy.rangeCeilingPosition)
            || DEFAULT_BEHAVIOR_POLICY.rangeCeilingPosition)),
        trendScore: Math.max(0.35, Math.min(0.8,
          Number(options.behaviorPolicy.trendScore) || DEFAULT_BEHAVIOR_POLICY.trendScore)),
        rangeScore: Math.max(0.35, Math.min(0.8,
          Number(options.behaviorPolicy.rangeScore) || DEFAULT_BEHAVIOR_POLICY.rangeScore)),
        calibrationHorizon: Math.max(5, Number(options.behaviorPolicy.calibrationHorizon)
          || DEFAULT_BEHAVIOR_POLICY.calibrationHorizon),
        calibrationMinimumSamples: Math.max(4, Number(options.behaviorPolicy.calibrationMinimumSamples)
          || DEFAULT_BEHAVIOR_POLICY.calibrationMinimumSamples),
        calibrationMaxSamples: Number(options.behaviorPolicy.calibrationMaxSamples) === 0
          ? 0
          : Math.max(4, Number(options.behaviorPolicy.calibrationMaxSamples)
            || DEFAULT_BEHAVIOR_POLICY.calibrationMaxSamples),
        rejectHitRate: Math.max(0.25, Math.min(0.55,
          Number(options.behaviorPolicy.rejectHitRate) || DEFAULT_BEHAVIOR_POLICY.rejectHitRate)),
        reboundMinimumPercent: Math.max(3, Math.min(12,
          Number(options.behaviorPolicy.reboundMinimumPercent)
            || DEFAULT_BEHAVIOR_POLICY.reboundMinimumPercent)),
        reboundAdverseRatio: Math.max(1, Math.min(4,
          Number(options.behaviorPolicy.reboundAdverseRatio)
            || DEFAULT_BEHAVIOR_POLICY.reboundAdverseRatio)),
        objectiveAware: options.behaviorPolicy.objectiveAware !== false,
      }
      : { enabled: false };
    const adrKey = isKosdaqSeries ? "adr_kosdaq" : "adr_kospi";
    const creditKey = isKosdaqSeries ? "kosdaq_credit" : "kospi_credit";
    const adrRows = Array.isArray(options.adrRows) ? options.adrRows : [];
    const macroRows = Array.isArray(options.macroRows) ? options.macroRows : [];
    const creditRows = Array.isArray(options.creditRows) ? options.creditRows : [];
    const crisisRows = Array.isArray(options.crisisRows) ? options.crisisRows : [];
    const koreanVolatilityRows = Array.isArray(options.koreanVolatilityRows)
      ? options.koreanVolatilityRows
      : buildKoreanVolatilityTimingRows(crisisRows);
    const externalVolatilityRows = Array.isArray(options.externalVolatilityRows)
      ? options.externalVolatilityRows
      : buildExternalVolatilityTimingRows(options.volatilityRows || adrRows);

    const newsSource = normalizeValueRows(macroRows, "news_sentiment");
    const newsSmoothed = trailingAverage(newsSource.map((row) => row.value), 20);
    const smoothedNewsRows = newsSource.map((row, index) => ({ date: row.date, value: newsSmoothed[index] }));
    const aligned = {
      prices: prices.slice(0, count),
      oscillator: oscillator.slice(0, count),
      adr: alignedSource(dates, adrRows, adrKey, 7),
      fearGreed: alignedSource(dates, adrRows, "fear_greed", 7),
      news: alignAsOf(dates, smoothedNewsRows, 10),
      // ECOS observations arrive about two months later; shift availability to prevent look-ahead.
      leading: alignedSource(dates, macroRows, "leading_cycle", 75, 60),
      // The normalized runtime rows already carry the app's publication-date policy.
      // A provider-specific lag can still be supplied explicitly without double-shifting it.
      credit: alignedSource(
        dates,
        creditRows,
        creditKey,
        10,
        Math.max(0, Number(options.creditAvailabilityLagDays)
          || CREDIT_AVAILABILITY_LAG_DAYS),
      ),
      crisis: alignedSource(dates, crisisRows, "score", 14),
      koreanVolatility: {
        value: alignedSource(dates, koreanVolatilityRows, "vkospi", 14),
        percentile: alignedSource(dates, koreanVolatilityRows, "vkospiPercentile", 14),
        zScore: alignedSource(dates, koreanVolatilityRows, "vkospiZScore", 14),
        change5: alignedSource(dates, koreanVolatilityRows, "vkospiChange5", 14),
        change20: alignedSource(dates, koreanVolatilityRows, "vkospiChange20", 14),
        drawdown20: alignedSource(dates, koreanVolatilityRows, "vkospiDrawdown20", 14),
        rebound20: alignedSource(dates, koreanVolatilityRows, "vkospiRebound20", 14),
      },
      externalVolatility: {
        // A US close becomes observable only after the Korean close on the same date.
        value: alignedSource(dates, externalVolatilityRows, "vix", 14, 1),
        percentile: alignedSource(dates, externalVolatilityRows, "vixPercentile", 14, 1),
        zScore: alignedSource(dates, externalVolatilityRows, "vixZScore", 14, 1),
        change5: alignedSource(dates, externalVolatilityRows, "vixChange5", 14, 1),
        change20: alignedSource(dates, externalVolatilityRows, "vixChange20", 14, 1),
        drawdown20: alignedSource(dates, externalVolatilityRows, "vixDrawdown20", 14, 1),
        rebound20: alignedSource(dates, externalVolatilityRows, "vixRebound20", 14, 1),
      },
      benchmarkPrices: dates.map((_, index) => benchmarkPrices[index] ?? null),
      volumes: dates.map((_, index) => volumes[index] ?? null),
      volatilityProfile: buildVolatilityProfile(prices.slice(0, count)),
    };
    aligned.creditGrowth = aligned.credit.map((_, index) => changeRate(aligned.credit, index, 20));
    aligned.creditPercentile = aligned.creditGrowth.map((_, index) => (
      rollingPercentile(aligned.creditGrowth, index)
    ));
    aligned.koreanVolatilityRelationship = buildRollingReturnRelationship(
      aligned.prices,
      aligned.koreanVolatility.value,
      {
        lookback: koreanVolatilityPolicy.relationshipLookback,
        minimumObservations: koreanVolatilityPolicy.minimumObservations,
        // Decide relevance from information known before the signal date itself.
        availabilityLag: 1,
      },
    );
    aligned.externalVolatilityRelationship = buildRollingReturnRelationship(
      aligned.prices,
      aligned.externalVolatility.value,
      {
        lookback: externalVolatilityPolicy.relationshipLookback,
        minimumObservations: externalVolatilityPolicy.minimumObservations,
      },
    );

    const scores = Array(count).fill(null);
    const signals = [];
    const sellSignals = [];
    let buyEpisode = null;
    let sellEpisode = null;
    let lastHistoricalSellSignalIndex = -Infinity;
    let lastSellSignalIndex = -Infinity;
    let lastOverheatContinuationExtremeIndex = -Infinity;

    function saveEpisodeSignal(list, episode, signal) {
      const decorated = decorateTimingSignal(signal);
      const sameDateIndex = list.findIndex((existing) => existing?.date === decorated.date);
      if (sameDateIndex >= 0) {
        episode.signalSlot = sameDateIndex;
        const existingMode = list[sameDateIndex]?.entryMode;
        if (!["extreme-daily", "overheat-continuation"].includes(existingMode)) {
          list[sameDateIndex] = decorated;
        }
        return;
      }
      if (Number.isInteger(episode.signalSlot)) list[episode.signalSlot] = decorated;
      else {
        episode.signalSlot = list.length;
        list.push(decorated);
      }
    }

    for (let index = 39; index < count; index += 1) {
      const result = scoreTimingPoint(aligned, index);
      const behaviorProfile = behaviorPolicy.enabled
        ? classifyBehaviorProfile(result, {
          isIndividualStock,
          minimumHistoryDays: behaviorPolicy.minimumHistoryDays,
        })
        : null;
      if (behaviorProfile) {
        result.behaviorProfile = behaviorProfile;
        result.behaviorType = behaviorProfile.dominant;
      }
      scores[index] = result.score;
      const stockVolatilityScale = isIndividualStock
        ? Math.max(0.65, Math.min(1.6, result.volatilityScale || 1))
        : 1;
      const lowVolatilityStock = isIndividualStock && stockVolatilityScale <= 0.9;
      const validStockDailyMove = result.price1d !== null && Math.abs(result.price1d) <= 31.5;
      const validIndexDailyMove = result.price1d !== null && Math.abs(result.price1d) <= 20;
      const extremeDailyBuy = (isIndividualStock && validStockDailyMove && result.price1d <= -25)
        || (isMarketIndex && validIndexDailyMove && result.price1d <= -8);
      const extremeDailySell = (isIndividualStock && validStockDailyMove && result.price1d >= 25)
        || (isMarketIndex && validIndexDailyMove && result.price1d >= 8);
      const overheatMemory = isIndividualStock
        ? stockOverheatMemory(aligned.prices, index)
        : null;
      const overheatContinuationSell = !extremeDailySell
        && overheatMemory?.count >= 2
        && overheatMemory.span <= 5
        && overheatMemory.age <= 4
        && overheatMemory.lastExtremeIndex > lastOverheatContinuationExtremeIndex
        && overheatMemory.cumulativeGain >= 60
        && overheatMemory.drawdownFromHigh >= -5
        && result.price1d !== null && result.price1d >= 10;
      if (extremeDailyBuy) {
        saveEpisodeSignal(signals, { signalSlot: null }, {
          date: dates[index],
          setupDate: dates[index],
          confirmationDate: dates[index],
          entryMode: "extreme-daily",
          signalFamily: "shock-reversal",
          indexKey,
          ...result,
          setupReasons: [
            isIndividualStock ? "개별종목 일간 25% 이상 급락" : "시장지수 일간 8% 이상 급락",
            dailyMoveReason(result.price1d),
          ],
          sentimentTurnReasons: [],
          stabilizationReasons: ["이례적 일간 과매도"],
          triggerReasons: ["가격제한폭 수준 급락"],
        });
        buyEpisode = null;
      }
      if (extremeDailySell) {
        saveEpisodeSignal(sellSignals, { signalSlot: null }, {
          date: dates[index],
          confirmationDate: dates[index],
          peakDate: dates[index],
          entryMode: "extreme-daily",
          signalFamily: "blowoff-exhaustion",
          indexKey,
          ...result,
          sellSetupReasons: [
            isIndividualStock ? "개별종목 일간 25% 이상 급등" : "시장지수 일간 8% 이상 급등",
            dailyMoveReason(result.price1d),
          ],
          sellDeteriorationReasons: ["이례적 일간 과매수"],
          sellTriggerReasons: ["가격제한폭 수준 급등"],
        });
        sellEpisode = null;
      }
      if (overheatContinuationSell) {
        saveEpisodeSignal(sellSignals, { signalSlot: null }, {
          date: dates[index],
          confirmationDate: dates[index],
          peakDate: dates[index],
          entryMode: "overheat-continuation",
          signalFamily: "blowoff-continuation",
          indexKey,
          ...result,
          overheatLimitUpCount: overheatMemory.count,
          overheatCumulativeGain: overheatMemory.cumulativeGain,
          sellSetupReasons: [
            "상한가 누적 후 비냉각 재가속",
            dailyMoveReason(result.price1d),
          ],
          sellDeteriorationReasons: ["단기 과열이 해소되지 않은 고점 구간"],
          sellTriggerReasons: ["상한가 군집 후 하루 10% 이상 재급등"],
        });
        lastOverheatContinuationExtremeIndex = overheatMemory.lastExtremeIndex;
        sellEpisode = null;
      }
      const koreanVolatilityDirectional = koreanVolatilityPolicy.enabled
        && result.vkospiRelationshipObservations >= koreanVolatilityPolicy.minimumObservations
        && result.vkospiCorrelation126 !== null
        && result.vkospiCorrelation126 <= koreanVolatilityPolicy.maximumCorrelation
        && result.vkospiBeta126 !== null && result.vkospiBeta126 < 0;
      const koreanVolatilityBuyRole = isIndividualStock
        ? koreanVolatilityPolicy.stockBuy
        : koreanVolatilityPolicy.indexBuy;
      const koreanVolatilitySellRole = isIndividualStock
        ? koreanVolatilityPolicy.stockSell
        : koreanVolatilityPolicy.indexSell;
      const koreanVolatilityStressed = koreanVolatilityPolicy.enabled
        && koreanVolatilityDirectional
        && koreanVolatilityBuyRole
        && result.vkospiPercentile !== null
        && result.vkospiPercentile >= koreanVolatilityPolicy.buyPercentile
        && ((result.vkospiZScore ?? -Infinity) >= 0.8
          || (result.vkospiChange20 ?? -Infinity) >= 20);
      const koreanVolatilityComplacent = koreanVolatilityPolicy.enabled
        && koreanVolatilityDirectional
        && koreanVolatilitySellRole
        && result.vkospiPercentile !== null
        && result.vkospiPercentile <= koreanVolatilityPolicy.sellPercentile
        && (result.vkospiZScore ?? Infinity) <= -0.35;
      const koreanVolatilityAwakening = koreanVolatilityPolicy.enabled
        && koreanVolatilityDirectional
        && koreanVolatilitySellRole
        && result.vkospiPercentile !== null && result.vkospiPercentile <= 0.6
        && (result.vkospiChange5 ?? -Infinity) >= koreanVolatilityPolicy.sellChange5
        && (result.vkospiRebound20 ?? -Infinity) >= koreanVolatilityPolicy.sellRebound20;
      const koreanVolatilitySellSupport = koreanVolatilityComplacent || koreanVolatilityAwakening;
      const externalVolatilityDirectional = externalVolatilityPolicy.enabled
        && result.vixRelationshipObservations >= externalVolatilityPolicy.minimumObservations
        && result.vixCorrelation126 !== null
        && result.vixCorrelation126 <= externalVolatilityPolicy.maximumCorrelation
        && result.vixBeta126 !== null && result.vixBeta126 < 0;
      const externalVolatilityBuyRole = isIndividualStock
        ? externalVolatilityPolicy.stockBuy
        : externalVolatilityPolicy.indexBuy;
      const externalVolatilitySellRole = isIndividualStock
        ? externalVolatilityPolicy.stockSell
        : externalVolatilityPolicy.indexSell;
      const externalVolatilityStressed = externalVolatilityDirectional
        && externalVolatilityBuyRole
        && result.vixPercentile !== null
        && result.vixPercentile >= externalVolatilityPolicy.buyPercentile
        && ((result.vixZScore ?? -Infinity) >= 0.8
          || (result.vixChange20 ?? -Infinity) >= 20);
      const externalVolatilityComplacent = externalVolatilityDirectional
        && externalVolatilitySellRole
        && result.vixPercentile !== null
        && result.vixPercentile <= externalVolatilityPolicy.sellPercentile
        && (result.vixZScore ?? Infinity) <= -0.35;
      const externalVolatilityAwakening = externalVolatilityDirectional
        && externalVolatilitySellRole
        && result.vixPercentile !== null && result.vixPercentile <= 0.6
        && (result.vixChange5 ?? -Infinity) >= externalVolatilityPolicy.sellChange5
        && (result.vixRebound20 ?? -Infinity) >= externalVolatilityPolicy.sellRebound20;
      const externalVolatilitySellSupport = externalVolatilityComplacent
        || externalVolatilityAwakening;
      const severeReturnLimit = isKosdaqSeries ? -22 : -20;
      const severeDrawdownLimit = isKosdaqSeries ? -28 : -25;
      const shortCapitulation = result.price20d !== null && result.price20d <= severeReturnLimit
        && result.priceDrawdown60 !== null && result.priceDrawdown60 <= severeDrawdownLimit;
      const longCapitulation = result.price60d !== null && result.price60d <= -30
        && result.priceDrawdown120 !== null && result.priceDrawdown120 <= -40;
      const priceCapitulation = shortCapitulation || longCapitulation;
      const moderateReturnLimit = isKosdaqSeries ? -15 : -12;
      const moderateDrawdownLimit = isKosdaqSeries ? -20 : -16;
      const moderateCapitulation = (result.price20d !== null && result.price20d <= moderateReturnLimit
        && result.priceDrawdown60 !== null && result.priceDrawdown60 <= moderateDrawdownLimit)
        || (result.price60d !== null && result.price60d <= -20
          && result.priceDrawdown120 !== null && result.priceDrawdown120 <= -25);
      const shockCapitulation = result.price5d !== null && result.price5d <= -12
        && result.priceDrawdown60 !== null && result.priceDrawdown60 <= -15
        && result.adr !== null && result.adr <= 95;
      const adrStressed = result.adr !== null && result.adr <= 80;
      const fearStressed = result.fearGreed !== null && result.fearGreed <= 30;
      const creditStressed = result.creditChange !== null && result.creditPercentile !== null
        && result.creditChange <= -10
        && result.creditPercentile <= (longCapitulation ? 0.25 : 0.1);
      const stressReasons = [
        longCapitulation ? "장기 급락" : "",
        adrStressed ? "ADR 과매도" : "",
        fearStressed ? "공포 구간" : "",
        creditStressed ? "신용 투매" : "",
        externalVolatilityStressed ? "VIX 스트레스" : "",
      ].filter(Boolean);
      const moderateStressReasons = [
        result.adrMin !== null && result.adrMin <= 85 ? "ADR 조정" : "",
        result.fearMin !== null && result.fearMin <= 35 ? "공포 구간" : "",
        result.creditWashoutGrowth !== null && result.creditWashoutPercentile !== null
          && result.creditWashoutGrowth <= -3 && result.creditWashoutPercentile <= 0.2
          ? "신용 감소" : "",
        result.newsMin !== null && result.newsMin <= 95 ? "뉴스심리 위축" : "",
        externalVolatilityStressed ? "VIX 스트레스" : "",
      ].filter(Boolean);
      const breadthWashedOut = result.adrMin !== null && result.adrMin <= 75;
      const creditReset = result.creditWashoutGrowth !== null
        && result.creditWashoutPercentile !== null
        && result.creditWashoutGrowth <= -4
        && result.creditWashoutPercentile <= 0.15;
      const broadReturnLimit = isKosdaqSeries ? -11 : -7;
      const broadDrawdownLimit = isKosdaqSeries ? -13 : -10;
      const deepReturnLimit = isKosdaqSeries ? -15 : -10;
      const deepDrawdownLimit = isKosdaqSeries ? -17 : -11;
      const broadCorrection = result.price20d !== null && result.price20d <= broadReturnLimit
        && result.priceDrawdown60 !== null && result.priceDrawdown60 <= broadDrawdownLimit;
      const deepCorrection = result.price20d !== null && result.price20d <= deepReturnLimit
        && result.priceDrawdown60 !== null && result.priceDrawdown60 <= deepDrawdownLimit;
      // Defensive or low-beta stocks can form a useful bottom without reaching
      // broad-market capitulation. This path still requires weak market breadth.
      const stockMediumCorrection = isIndividualStock && (
        (result.price20d !== null && result.price20d <= -8 * stockVolatilityScale
          && result.priceDrawdown60 !== null && result.priceDrawdown60 <= -14 * stockVolatilityScale
          && result.adrMin !== null && result.adrMin <= (lowVolatilityStock ? 85 : 80))
        || (result.price20d !== null && result.price20d <= -5 * stockVolatilityScale
          && result.price60d !== null && result.price60d <= -8 * stockVolatilityScale
          && result.priceDrawdown120 !== null && result.priceDrawdown120 <= -14 * stockVolatilityScale
          && result.adrMin !== null && result.adrMin <= (lowVolatilityStock ? 95 : 90))
      );
      const stockRelativeWashout = isIndividualStock
        && result.price20d !== null && result.price20d <= -1 * stockVolatilityScale
        && result.priceDrawdown120 !== null && result.priceDrawdown120 <= -5 * stockVolatilityScale
        && result.relative20d !== null && result.relative20d <= -10 * stockVolatilityScale
        && result.adrMin !== null && result.adrMin <= 75
        && (result.marketCorrelation60 === null
          || result.marketCorrelation60 <= 0.35
          || result.marketBeta60 === null
          || result.marketBeta60 <= 0.35)
        && result.oscillator !== null && result.oscillator < 0;
      const behaviorScores = behaviorProfile?.scores || {};
      const behaviorSupportCount = [
        result.adrMin !== null && result.adrMin <= 95,
        result.fearMin !== null && result.fearMin <= 45,
        result.newsMin !== null && result.newsMin <= 100,
        ["stress", "recovery", "slowdown"].includes(result.marketRegime),
      ].filter(Boolean).length;
      const behaviorRangeFloorBuy = behaviorPolicy.buyEnabled && isIndividualStock
        && (behaviorScores.range ?? 0) >= behaviorPolicy.rangeScore
        && result.rangePosition120 !== null
        && result.rangePosition120 <= behaviorPolicy.rangeFloorPosition
        && result.price20d !== null
        && result.price20d <= -Math.max(3, 5 * stockVolatilityScale)
        && result.priceDrawdown120 !== null
        && result.priceDrawdown120 <= -Math.max(7, 11 * stockVolatilityScale)
        && result.oscillator !== null && result.oscillator < 0
        && behaviorSupportCount >= 1;
      const behaviorTrendPullbackBuy = behaviorPolicy.buyEnabled && isIndividualStock
        && (behaviorScores.trendUp ?? 0) >= behaviorPolicy.trendScore
        && result.price120d !== null
        && result.price120d >= Math.max(8, 13 * stockVolatilityScale)
        && result.price20d !== null
        && result.price20d <= -Math.max(4, 6 * stockVolatilityScale)
        && result.priceDrawdown60 !== null
        && result.priceDrawdown60 <= -Math.max(5, 8 * stockVolatilityScale)
        && result.oscillator !== null && result.oscillator < 0
        && behaviorSupportCount >= 1
        && result.marketRegime !== "stress";
      const broadWashoutReasons = [
        breadthWashedOut ? "시장폭 과매도" : "",
        creditReset ? "신용 정리" : "",
      ].filter(Boolean);
      const strongBuyArm = priceCapitulation && stressReasons.length >= 2;
      const moderateSupportCount = isKosdaqSeries ? 2 : 1;
      const moderateSupportScore = moderateStressReasons.length + (koreanVolatilityStressed ? 1 : 0);
      const moderateBuyArm = shockCapitulation || stockMediumCorrection || stockRelativeWashout
        || behaviorRangeFloorBuy || behaviorTrendPullbackBuy
        || (moderateCapitulation
        && moderateSupportScore >= moderateSupportCount);
      const broadBuyArm = broadCorrection && creditReset
        && (breadthWashedOut || deepCorrection);
      const buyArm = !extremeDailyBuy && (strongBuyArm || moderateBuyArm || broadBuyArm);
      const freshLow = result.price !== null && result.low20 !== null
        && result.price <= result.low20 * 1.002;
      const macdDivergence = result.oscillator !== null && result.oscillator < 0
        && result.macdSlope !== null && result.macdSlope > 0
        && (result.priorMacdSlope === null
          || result.priorMacdSlope <= 0
          || result.macdSlope >= Math.abs(result.priorMacdSlope) * 0.75);

      if (buyEpisode) {
        const failedBroadRebound = (buyEpisode.broad || buyEpisode.shock || buyEpisode.relativeWashout)
          && buyEpisode.signalLocked
          && Number.isInteger(buyEpisode.signalConfirmedAt)
          && index - buyEpisode.signalConfirmedAt >= 3
          && result.price !== null && buyEpisode.signalLowPrice > 0
          && result.price <= buyEpisode.signalLowPrice * 0.96;
        const recoveredFromLow = result.price !== null && buyEpisode.lowPrice > 0
          && result.price >= buyEpisode.lowPrice * 1.12
          && (result.adr === null || result.adr >= 95)
          && result.oscillator > 0;
        const staleEpisode = index - buyEpisode.lowIndex > BUY_SETUP_WINDOW_DAYS
          && !moderateCapitulation;
        if (failedBroadRebound || recoveredFromLow || staleEpisode) buyEpisode = null;
      }
      if (buyArm) {
        if (!buyEpisode) {
          const behaviorBuyFamily = behaviorRangeFloorBuy
            ? "range-floor-reversal"
            : (behaviorTrendPullbackBuy ? "trend-pullback" : null);
          buyEpisode = {
            lowIndex: index,
            lowPrice: result.price,
            signalSlot: null,
            signalLocked: false,
            confirmationDays: behaviorRangeFloorBuy ? 12
              : (behaviorTrendPullbackBuy ? 8
                : priceCapitulation ? 8
              : (strongBuyArm ? 5
                : ((stockMediumCorrection || stockRelativeWashout)
                  ? (lowVolatilityStock ? 10 : 7)
                  : 5))),
            signalFamily: behaviorBuyFamily || (strongBuyArm
              ? "capitulation-reversal"
              : (stockRelativeWashout ? "relative-washout" : "correction-reversal")),
            behaviorProfile,
            strong: strongBuyArm,
            shock: shockCapitulation,
            relativeWashout: stockRelativeWashout,
            broad: broadBuyArm && !strongBuyArm && !moderateBuyArm,
            setupReasons: strongBuyArm
              ? [shortCapitulation ? "20일 급락" : "장기 급락", ...stressReasons]
              : moderateBuyArm
                ? ["중간급 조정", ...moderateStressReasons]
                : ["복합 과매도", ...broadWashoutReasons],
          };
          if (stockMediumCorrection) {
            buyEpisode.setupReasons.unshift("\uAC1C\uBCC4\uC885\uBAA9 \uC911\uAE30 \uC870\uC815");
          }
          if (stockRelativeWashout) {
            buyEpisode.setupReasons.unshift("\uC800\uBCA0\uD0C0 \uC0C1\uB300 \uACFC\uB9E4\uB3C4");
          }
          if (behaviorRangeFloorBuy) buyEpisode.setupReasons.unshift("박스권 하단 반전 후보");
          if (behaviorTrendPullbackBuy) buyEpisode.setupReasons.unshift("상승추세 눌림 후보");
          if (shockCapitulation) {
            buyEpisode.setupReasons = ["5일 충격 급락", ...buyEpisode.setupReasons];
          }
          if (koreanVolatilityStressed) {
            buyEpisode.setupReasons = [...new Set([
              ...buyEpisode.setupReasons,
              "VKOSPI \uC2A4\uD2B8\uB808\uC2A4",
            ])];
          }
          if (externalVolatilityStressed) {
            buyEpisode.setupReasons = [...new Set([
              ...buyEpisode.setupReasons,
              "VIX 스트레스",
            ])];
          }
        } else if (!buyEpisode.signalLocked) {
          if (strongBuyArm) {
            buyEpisode.strong = true;
            buyEpisode.broad = false;
            buyEpisode.confirmationDays = priceCapitulation ? 8 : 5;
          } else if (moderateBuyArm) {
            buyEpisode.broad = false;
            buyEpisode.shock = buyEpisode.shock || shockCapitulation;
            if (stockMediumCorrection) {
              buyEpisode.confirmationDays = Math.max(
                lowVolatilityStock ? 10 : 7,
                buyEpisode.confirmationDays || 0,
              );
              buyEpisode.setupReasons.unshift("\uAC1C\uBCC4\uC885\uBAA9 \uC911\uAE30 \uC870\uC815");
            }
            if (stockRelativeWashout) {
              buyEpisode.relativeWashout = true;
              buyEpisode.confirmationDays = Math.max(
                lowVolatilityStock ? 10 : 7,
                buyEpisode.confirmationDays || 0,
              );
              buyEpisode.setupReasons.unshift("\uC800\uBCA0\uD0C0 \uC0C1\uB300 \uACFC\uB9E4\uB3C4");
            }
            if (behaviorRangeFloorBuy) {
              buyEpisode.signalFamily = "range-floor-reversal";
              buyEpisode.behaviorProfile = behaviorProfile;
              buyEpisode.confirmationDays = Math.max(12, buyEpisode.confirmationDays || 0);
              buyEpisode.setupReasons.unshift("박스권 하단 반전 후보");
            } else if (behaviorTrendPullbackBuy) {
              buyEpisode.signalFamily = "trend-pullback";
              buyEpisode.behaviorProfile = behaviorProfile;
              buyEpisode.confirmationDays = Math.max(8, buyEpisode.confirmationDays || 0);
              buyEpisode.setupReasons.unshift("상승추세 눌림 후보");
            }
          }
          buyEpisode.setupReasons = [...new Set([
            ...buyEpisode.setupReasons,
            ...(koreanVolatilityStressed ? ["VKOSPI \uC2A4\uD2B8\uB808\uC2A4"] : []),
            ...(externalVolatilityStressed ? ["VIX 스트레스"] : []),
            ...(strongBuyArm
              ? stressReasons
              : moderateBuyArm ? moderateStressReasons : broadWashoutReasons),
          ])];
        }
        if (result.price < buyEpisode.lowPrice) {
          buyEpisode.lowIndex = index;
          buyEpisode.lowPrice = result.price;
        }
      }
      if (buyEpisode && !buyEpisode.signalLocked && result.price < buyEpisode.lowPrice) {
        buyEpisode.lowIndex = index;
        buyEpisode.lowPrice = result.price;
      }
      if (buyEpisode && !buyEpisode.signalLocked
        && index - buyEpisode.lowIndex <= (buyEpisode.confirmationDays || 3)
        && macdDivergence) {
        const candidateIndex = buyEpisode.lowIndex;
        saveEpisodeSignal(signals, buyEpisode, {
          date: (buyEpisode.broad || buyEpisode.relativeWashout)
            ? dates[index]
            : dates[candidateIndex],
          setupDate: dates[candidateIndex],
          confirmationDate: dates[index],
          entryMode: (buyEpisode.broad || buyEpisode.relativeWashout)
            ? "confirmation"
            : "turning-point",
          signalFamily: buyEpisode.signalFamily || "correction-reversal",
          behaviorProfile: buyEpisode.behaviorProfile || behaviorProfile,
          indexKey,
          ...result,
          setupReasons: [...buyEpisode.setupReasons],
          sentimentTurnReasons: ["신저점 재시험"],
          stabilizationReasons: creditStressed
            ? ["신용 투매 동반"]
            : buyEpisode.setupReasons.filter((reason) => reason !== "중간급 조정").slice(-2),
          triggerReasons: ["MACD 상승 다이버전스"],
        });
        if (buyEpisode.broad || buyEpisode.shock || buyEpisode.relativeWashout) {
          buyEpisode.signalLocked = true;
          buyEpisode.signalConfirmedAt = index;
          buyEpisode.signalLowPrice = buyEpisode.lowPrice;
        }
      }

      const nearHigh = result.priceDrawdown60 !== null && result.priceDrawdown60 >= -2.5;
      const creditCrowded = result.creditChange !== null && result.creditPercentile !== null
        && result.creditChange >= 6 && result.creditPercentile >= 0.65;
      const sentimentCrowded = (result.fearGreed ?? -Infinity) >= 70
        || (result.news ?? -Infinity) >= 110
        || (result.adr ?? -Infinity) >= 115;
      const breadthDivergence = (result.adr ?? Infinity) <= 60
        && result.creditChange !== null && result.creditChange >= 8
        && result.creditPercentile !== null && result.creditPercentile >= 0.6;
      const priceExtended = (result.price20dVolScore ?? -Infinity) >= 1.5
        || (result.price60dVolScore ?? -Infinity) >= 1.8;
      const priceStronglyExtended = (result.price20dVolScore ?? -Infinity) >= 2.5
        || (result.price60dVolScore ?? -Infinity) >= 2.5;
      const technicalOverheat = (result.oscillator ?? -Infinity) >= 0.5;
      const volumeClimax = (result.volumeRatio ?? -Infinity) >= 1.8;
      const volumeDivergence = result.volumeTrend !== null && result.volumeTrend <= 0.72
        && (result.price20d ?? -Infinity) >= 8;
      const overheatSupportCount = [
        creditCrowded,
        sentimentCrowded,
        breadthDivergence,
        technicalOverheat,
        koreanVolatilitySellSupport,
        externalVolatilitySellSupport,
      ].filter(Boolean).length;
      const creditDrivenSellArm = nearHigh
        && result.creditChange !== null && result.creditChange >= 10
        && result.creditPercentile !== null && result.creditPercentile >= 0.75
        && result.price20d !== null && result.price20d >= 15;
      const clusteredOverheatArm = nearHigh
        && result.price20d !== null && result.price20d >= 8
        && result.creditChange !== null && result.creditChange >= 5
        && result.creditPercentile !== null && result.creditPercentile >= 0.75
        && (result.adr ?? -Infinity) >= 110
        && (result.oscillator ?? -Infinity) >= 0.5;
      const stockClimaxArm = isIndividualStock && nearHigh && (
        (result.price20d !== null && result.price20d >= Math.max(24, 35 * stockVolatilityScale)
          && (result.price20dVolScore ?? -Infinity) >= 1.5)
        || (result.price20d !== null && result.price20d >= Math.max(10, 15 * stockVolatilityScale)
          && (result.price60dVolScore ?? -Infinity) >= 1.8)
        || (result.price20d !== null && result.price20d >= Math.max(10, 15 * stockVolatilityScale)
          && result.creditChange !== null && result.creditChange >= 5
          && result.creditPercentile !== null && result.creditPercentile >= 0.75)
        || (result.price20d !== null && result.price20d >= Math.max(8, 12 * stockVolatilityScale)
          && (result.price20dVolScore ?? -Infinity) >= 1.1
          && volumeClimax)
      );
      const extremeStockExtension = result.price20d !== null && result.price20d >= 22
        && (result.price20dVolScore ?? -Infinity) >= 1.8;
      const stockDistributionArm = isIndividualStock && nearHigh
        && ((result.oscillator ?? -Infinity) >= 0.25 || extremeStockExtension)
        && (
          (result.price20d !== null && result.price20d >= Math.max(11, 18 * stockVolatilityScale)
            && (result.price20dVolScore ?? -Infinity) >= 1.5)
          || (result.price60d !== null && result.price60d >= Math.max(19, 30 * stockVolatilityScale)
            && (result.price60dVolScore ?? -Infinity) >= 1.8)
        );
      const stockMatureTopArm = isIndividualStock
        && result.priceDrawdown120 !== null && result.priceDrawdown120 >= -1.2
        && (result.oscillator ?? -Infinity) >= (lowVolatilityStock ? 0.25 : 0.4)
        && (
          (result.price20d !== null && result.price20d >= Math.max(6.5, 10 * stockVolatilityScale)
            && (result.price20dVolScore ?? -Infinity) >= (lowVolatilityStock ? 0.9 : 1.1))
          || (result.price60d !== null && result.price60d >= Math.max(11.5, 18 * stockVolatilityScale)
            && (result.price60dVolScore ?? -Infinity) >= (lowVolatilityStock ? 1.0 : 1.3))
        );
      const stockLowVolatilityTopArm = lowVolatilityStock && nearHigh
        && (result.oscillator ?? -Infinity) >= 0.2
        && (
          (result.price5d !== null && result.price5d >= Math.max(5, 9 * stockVolatilityScale)
            && (result.price5dVolScore ?? -Infinity) >= 1.35
            && volumeClimax)
          || (result.price20d !== null && result.price20d >= Math.max(6, 9 * stockVolatilityScale)
            && (result.price20dVolScore ?? -Infinity) >= 0.9)
          || (result.price60d !== null && result.price60d >= Math.max(11, 18 * stockVolatilityScale)
            && (result.price60dVolScore ?? -Infinity) >= 1.0)
        );
      const behaviorRangeCeilingSell = behaviorPolicy.sellEnabled
        && behaviorPolicy.sellDiscoveryEnabled && isIndividualStock
        && (behaviorScores.range ?? 0) >= behaviorPolicy.rangeScore
        && result.rangePosition120 !== null
        && result.rangePosition120 >= behaviorPolicy.rangeCeilingPosition
        && result.price20d !== null
        && result.price20d >= Math.max(3, 5 * stockVolatilityScale)
        && (result.oscillator ?? -Infinity) >= 0.15
        && (volumeClimax || sentimentCrowded || volumeDivergence)
        && ["range", "slowdown"].includes(result.marketRegime);
      const behaviorTrendExhaustionSell = behaviorPolicy.sellEnabled
        && behaviorPolicy.sellDiscoveryEnabled && isIndividualStock
        && (behaviorScores.trendUp ?? 0) >= behaviorPolicy.trendScore
        && nearHigh
        && result.price120d !== null
        && result.price120d >= Math.max(18, 30 * stockVolatilityScale)
        && (
          ((result.price20dVolScore ?? -Infinity) >= 1.2 && volumeDivergence)
          || ((result.price60dVolScore ?? -Infinity) >= 1.5
            && (result.oscillator ?? -Infinity) >= 0.3)
        )
        && ["expansion", "slowdown", "range"].includes(result.marketRegime);
      // A single event-driven jump stays unconfirmed. Only a multi-day,
      // volume-backed parabolic move can emit an immediate overheat warning.
      const stockParabolicArm = isIndividualStock && nearHigh
        && result.price1d !== null && result.price1d >= 15
        && result.price2d !== null && result.price2d >= 35
        && result.price5d !== null
        && result.price5d >= Math.max(45, 55 * stockVolatilityScale)
        && (result.price5dVolScore ?? -Infinity) >= 2.2
        && (result.oscillator ?? -Infinity) >= 0.5
        && volumeClimax;
      const fearRotationReason = result.fearGreed !== null && result.fearGreed <= 35
        ? "공포 피난자금 단기 과열"
        : "시장폭·심리 괴리 단기 과열";
      const fearRotationTopArm = isIndividualStock
        && nearHigh
        && result.adr !== null && result.adr <= 85
        && result.fearGreed !== null
        && (result.fearGreed <= 35 || result.fearGreed >= 60)
        && result.benchmark20d !== null && result.benchmark20d <= -3
        && result.price20d !== null && result.price20d >= 4
        && result.relative20d !== null && result.relative20d >= 9
        && (result.oscillator ?? -Infinity) >= 0.2
        && (result.marketCorrelation60 === null
          || result.marketCorrelation60 <= 0.35
          || (result.marketBeta60 ?? Infinity) <= 0.35);
      const breadthSentimentDivergenceTopArm = isIndividualStock
        && nearHigh
        && result.adr !== null && result.adr <= 88
        && result.fearGreed !== null && result.fearGreed >= 60
        && result.price20d !== null && result.price20d >= 8
        && (result.oscillator ?? -Infinity) >= 0.2
        && volumeClimax;
      const riskDrivenSellArm = creditDrivenSellArm || clusteredOverheatArm;
      const extendedOverheatArm = nearHigh && priceExtended
        && (overheatSupportCount >= 2 || (priceStronglyExtended && overheatSupportCount >= 1));
      const recentSellArm = riskDrivenSellArm || stockClimaxArm || stockDistributionArm
        || stockMatureTopArm || stockLowVolatilityTopArm
        || behaviorRangeCeilingSell || behaviorTrendExhaustionSell
        || stockParabolicArm
        || fearRotationTopArm || breadthSentimentDivergenceTopArm
        || extendedOverheatArm;
      const longNearHigh = result.priceDrawdown120 !== null && result.priceDrawdown120 >= -1.2;
      const historicalCreditCrowded = result.creditChange !== null && result.creditPercentile !== null
        && result.creditChange >= 6
        && (result.creditPercentile >= 0.9
          || (result.creditPercentile >= 0.7 && (result.oscillator ?? -Infinity) >= 0.25)
          || (result.creditChange >= 12 && result.creditPercentile >= 0.7
            && (result.price60d ?? -Infinity) >= 25));
      const historicalAdrCrowded = (result.adr ?? -Infinity) >= 119;
      const moderateAdvance = (result.price20d ?? -Infinity) >= 3
        || (result.price60d ?? -Infinity) >= 15;
      // Older history lacks several modern sentiment inputs, so use this fallback only through 2021.
      const legacyFallbackPeriod = dates[index] <= "2021-12-31";
      const historicalSignalCooledDown = index - lastHistoricalSellSignalIndex >= 35;
      const historicalSellArm = legacyFallbackPeriod && longNearHigh && moderateAdvance
        && historicalSignalCooledDown
        && (historicalCreditCrowded || historicalAdrCrowded);
      const sellArm = (recentSellArm || historicalSellArm)
        && index - lastSellSignalIndex >= SELL_SIGNAL_COOLDOWN_DAYS;
      const priorOscillator = result.oscillator !== null && result.macdSlope !== null
        ? result.oscillator - result.macdSlope
        : null;
      const recentMomentumRollover = result.oscillator !== null
        && result.macdSlope !== null && result.macdSlope <= 0
        && result.priorMacdSlope !== null && result.priorMacdSlope > 0
        && (result.oscillator > 0 || (priorOscillator !== null && priorOscillator > 0));
      const creditRiskRollover = (riskDrivenSellArm || sellEpisode?.riskDriven)
        && result.priceDrawdown60 !== null && result.priceDrawdown60 <= -0.1;
      const historicalMomentumRollover = result.macdSlope !== null && result.macdSlope <= 0
        && result.priorMacdSlope !== null && result.priorMacdSlope > 0;
      const exceptionalCreditRollover = historicalSellArm
        && result.creditChange >= 8 && result.creditPercentile >= 0.9
        && result.macdSlope !== null && result.macdSlope < 0;
      const crowdingRisk = Math.max(
        historicalAdrCrowded ? Math.max(0, (result.adr - 100) / 20) : 0,
        historicalCreditCrowded
          ? result.creditPercentile + Math.max(0, result.creditChange - 6) / 20
          : 0,
      );

      if (sellEpisode) {
        const episodeDrawdown = result.price !== null && sellEpisode.peakPrice > 0
          ? ((result.price / sellEpisode.peakPrice) - 1) * 100
          : null;
        const episodeWasConfirmed = Number.isInteger(sellEpisode.signalConfirmedAt);
        const canResetOnCorrection = !sellEpisode.reacceleration || episodeWasConfirmed;
        const meaningfulCorrection = canResetOnCorrection
          && ((result.priceDrawdown60 !== null && result.priceDrawdown60 <= -12)
            || (result.price20d !== null && result.price20d <= -10 && result.oscillator < 0));
        const completedRecentCycle = !sellEpisode.historical
          && Number.isInteger(sellEpisode.signalConfirmedAt)
          && index > sellEpisode.signalConfirmedAt
          && episodeDrawdown !== null
          && (isIndividualStock
            ? episodeDrawdown <= -Math.max(6, 12 * stockVolatilityScale)
            : (episodeDrawdown <= -5
              || (episodeDrawdown <= -3 && result.oscillator !== null && result.oscillator < 0)));
        const confirmedPullback = sellEpisode.historical
          && Number.isInteger(sellEpisode.signalConfirmedAt)
          && index > sellEpisode.signalConfirmedAt
          && result.priceDrawdown120 !== null && result.priceDrawdown120 <= -3;
        const newCycleAfterPullback = Number.isInteger(sellEpisode.signalConfirmedAt)
          && index - sellEpisode.signalConfirmedAt >= 20
          && ((result.priceDrawdown60 !== null && result.priceDrawdown60 <= -5)
            || (result.price20d !== null && result.price20d <= 0));
        if (meaningfulCorrection || completedRecentCycle || confirmedPullback || newCycleAfterPullback) {
          sellEpisode = null;
        }
      }
      const exceptionalStockReacceleration = isIndividualStock
        && sellArm
        && sellEpisode
        && Number.isInteger(sellEpisode.signalConfirmedAt)
        && index - sellEpisode.signalConfirmedAt >= SELL_SIGNAL_COOLDOWN_DAYS
        && result.price !== null && (sellEpisode.confirmedPeakPrice || sellEpisode.peakPrice) > 0
        && result.price >= (sellEpisode.confirmedPeakPrice || sellEpisode.peakPrice) * 1.05
        && result.price20d !== null && result.price20d >= 20
        && volumeClimax
        && (creditDrivenSellArm || breadthDivergence || priceStronglyExtended);
      if (exceptionalStockReacceleration) sellEpisode = null;
      if (sellArm) {
        const behaviorSellFamily = stockParabolicArm
          ? "blowoff-exhaustion"
          : (behaviorRangeCeilingSell
            ? "range-ceiling-rollover"
            : (behaviorTrendExhaustionSell
              ? "trend-exhaustion"
              : (stockDistributionArm ? "distribution-rollover" : null)));
        const setupReasons = [
          stockParabolicArm ? "\uB2E8\uAE30 \uD30C\uB77C\uBCFC\uB9AD \uACFC\uC5F4" : "",
          creditDrivenSellArm
            ? "신용 증가 동반 급등"
            : (clusteredOverheatArm
              ? "복합 과열"
              : (stockClimaxArm ? "개별종목 급등 과열" : (recentSellArm ? "변동성 대비 급등" : "중기 신고점"))),
          creditCrowded ? "신용 과열" : "",
          creditDrivenSellArm ? "신용 주도 위험" : "",
          historicalCreditCrowded && !creditCrowded ? "신용 쏠림" : "",
          sentimentCrowded ? "심리 과열" : "",
          historicalAdrCrowded && !sentimentCrowded ? "ADR 과열" : "",
          breadthDivergence ? "지수·시장폭 괴리" : "",
        ].filter(Boolean);
        if (stockDistributionArm) setupReasons.unshift("개별종목 분배형 과열");
        if (stockMatureTopArm) setupReasons.unshift("개별종목 중기 고점 둔화");
        if (koreanVolatilityComplacent) setupReasons.push("VKOSPI \uC548\uC815 \uAD6C\uAC04");
        if (koreanVolatilityAwakening) setupReasons.push("VKOSPI \uBCC0\uB3D9\uC131 \uC0C1\uC2B9");
        if (externalVolatilityComplacent) setupReasons.push("VIX 안정 구간");
        if (externalVolatilityAwakening) setupReasons.push("VIX 변동성 상승");
        if (stockLowVolatilityTopArm) {
          setupReasons.unshift("\uC800\uBCC0\uB3D9 \uC885\uBAA9 \uC0C1\uB2E8 \uC774\uD0C8");
        }
        if (behaviorRangeCeilingSell) setupReasons.unshift("박스권 상단 과열");
        if (behaviorTrendExhaustionSell) setupReasons.unshift("상승추세 소진 후보");
        if (fearRotationTopArm) setupReasons.unshift(fearRotationReason);
        if (breadthSentimentDivergenceTopArm) setupReasons.unshift("시장폭·심리 괴리 단기 과열");
        if (volumeClimax) setupReasons.push("고점 거래량 폭증");
        if (volumeDivergence) setupReasons.push("가격·거래량 둔화 괴리");
        if (!sellEpisode) {
          sellEpisode = {
            peakIndex: index,
            peakPrice: result.price,
            signalSlot: null,
            setupReasons,
            crowdingRisk,
            setupVolumeRatio: result.volumeRatio,
            setupVolumeTrend: result.volumeTrend,
            setupAdr: result.adr,
            setupFearGreed: result.fearGreed,
            setupRelative20d: result.relative20d,
            setupBenchmark20d: result.benchmark20d,
            setupMarketCorrelation60: result.marketCorrelation60,
            signalFamily: behaviorSellFamily || (riskDrivenSellArm
              ? "crowding-rollover"
              : "overheat-rollover"),
            behaviorProfile,
            riskDriven: riskDrivenSellArm,
            distribution: stockDistributionArm,
            matureTop: stockMatureTopArm,
            lowVolatility: stockLowVolatilityTopArm,
            rangeCeiling: behaviorRangeCeilingSell,
            trendExhaustion: behaviorTrendExhaustionSell,
            parabolic: stockParabolicArm,
            fearRotation: fearRotationTopArm,
            reacceleration: exceptionalStockReacceleration,
            historical: historicalSellArm,
            signalLocked: false,
          };
        } else {
          sellEpisode.setupReasons = [...new Set([...sellEpisode.setupReasons, ...setupReasons])];
          sellEpisode.historical = sellEpisode.historical || historicalSellArm;
          sellEpisode.riskDriven = sellEpisode.riskDriven || riskDrivenSellArm;
          sellEpisode.distribution = sellEpisode.distribution || stockDistributionArm;
          sellEpisode.matureTop = sellEpisode.matureTop || stockMatureTopArm;
          sellEpisode.lowVolatility = sellEpisode.lowVolatility || stockLowVolatilityTopArm;
          sellEpisode.rangeCeiling = sellEpisode.rangeCeiling || behaviorRangeCeilingSell;
          sellEpisode.trendExhaustion = sellEpisode.trendExhaustion || behaviorTrendExhaustionSell;
          if (behaviorSellFamily) sellEpisode.signalFamily = behaviorSellFamily;
          if (behaviorProfile) sellEpisode.behaviorProfile = behaviorProfile;
          sellEpisode.parabolic = sellEpisode.parabolic || stockParabolicArm;
          sellEpisode.fearRotation = sellEpisode.fearRotation || fearRotationTopArm;
          if (result.volumeRatio !== null) {
            sellEpisode.setupVolumeRatio = Math.max(sellEpisode.setupVolumeRatio ?? -Infinity, result.volumeRatio);
          }
          if (result.volumeTrend !== null) sellEpisode.setupVolumeTrend = result.volumeTrend;
          const priceNearPeak = result.price >= sellEpisode.peakPrice * 0.997;
          const riskStrengthened = crowdingRisk >= (sellEpisode.crowdingRisk || 0) + 0.05;
          if (!sellEpisode.signalLocked
            && (result.price >= sellEpisode.peakPrice || (priceNearPeak && riskStrengthened))) {
              sellEpisode.peakIndex = index;
              sellEpisode.peakPrice = result.price;
              sellEpisode.crowdingRisk = crowdingRisk;
              sellEpisode.setupAdr = result.adr;
              sellEpisode.setupFearGreed = result.fearGreed;
              sellEpisode.setupRelative20d = result.relative20d;
              sellEpisode.setupBenchmark20d = result.benchmark20d;
              sellEpisode.setupMarketCorrelation60 = result.marketCorrelation60;
            }
        }
      }
      if (sellEpisode && !sellEpisode.signalLocked && nearHigh && result.price > sellEpisode.peakPrice) {
        sellEpisode.peakIndex = index;
        sellEpisode.peakPrice = result.price;
        sellEpisode.setupAdr = result.adr;
        sellEpisode.setupFearGreed = result.fearGreed;
        sellEpisode.setupRelative20d = result.relative20d;
        sellEpisode.setupBenchmark20d = result.benchmark20d;
        sellEpisode.setupMarketCorrelation60 = result.marketCorrelation60;
      }
      const parabolicImmediate = Boolean(
        sellEpisode?.parabolic && stockParabolicArm && sellEpisode.peakIndex === index,
      );
      const episodeMomentumRollover = sellEpisode?.historical
        ? (historicalMomentumRollover || exceptionalCreditRollover)
        : (() => {
          if (parabolicImmediate) return true;
          if (!isIndividualStock) return recentMomentumRollover || creditRiskRollover;
          const episodeDrawdown = result.price !== null && sellEpisode?.peakPrice > 0
            ? ((result.price / sellEpisode.peakPrice) - 1) * 100
            : null;
          return episodeDrawdown !== null && episodeDrawdown <= -4
            && (recentMomentumRollover || creditRiskRollover);
        })();
      const distributionRollover = isIndividualStock
        && (sellEpisode?.distribution || sellEpisode?.matureTop
          || sellEpisode?.lowVolatility || sellEpisode?.fearRotation
          || sellEpisode?.rangeCeiling || sellEpisode?.trendExhaustion)
        && result.price !== null && sellEpisode.peakPrice > 0
        && ((result.price / sellEpisode.peakPrice) - 1) * 100
          <= (sellEpisode.fearRotation
            ? -2.5
            : (sellEpisode.lowVolatility ? -2
              : (sellEpisode.matureTop ? -5 : -2.5)))
        && result.macdSlope !== null && result.macdSlope <= 0
        && (sellEpisode.matureTop
          || result.oscillator > 0
          || (priorOscillator !== null && priorOscillator > 0));
      const sellConfirmationWindow = sellEpisode?.fearRotation
        ? 8
        : (sellEpisode?.matureTop
          ? 20
          : (sellEpisode?.trendExhaustion ? 15
            : (sellEpisode?.rangeCeiling || sellEpisode?.lowVolatility
              ? 12
              : (sellEpisode?.distribution ? 8 : 3))));
      if (sellEpisode && !sellEpisode.signalLocked
        && (!Number.isInteger(sellEpisode.signalConfirmedAt)
          || sellEpisode.peakIndex > sellEpisode.signalConfirmedAt)
        && index - sellEpisode.peakIndex <= sellConfirmationWindow
        && (episodeMomentumRollover || distributionRollover)) {
        saveEpisodeSignal(sellSignals, sellEpisode, {
          date: dates[sellEpisode.peakIndex],
          confirmationDate: dates[index],
          peakDate: dates[sellEpisode.peakIndex],
          signalFamily: sellEpisode.signalFamily || "overheat-rollover",
          behaviorProfile: sellEpisode.behaviorProfile || behaviorProfile,
          indexKey,
          ...result,
          setupVolumeRatio: sellEpisode.setupVolumeRatio ?? null,
          setupVolumeTrend: sellEpisode.setupVolumeTrend ?? null,
          setupAdr: sellEpisode.setupAdr ?? null,
          setupFearGreed: sellEpisode.setupFearGreed ?? null,
          setupRelative20d: sellEpisode.setupRelative20d ?? null,
          setupBenchmark20d: sellEpisode.setupBenchmark20d ?? null,
          setupMarketCorrelation60: sellEpisode.setupMarketCorrelation60 ?? null,
          reacceleration: Boolean(sellEpisode.reacceleration),
          sellSetupReasons: [...sellEpisode.setupReasons],
          sellDeteriorationReasons: breadthDivergence
            ? ["상승 중 시장폭 급락"]
            : ["고점 갱신 후 탄력 둔화"],
          sellTriggerReasons: [
            parabolicImmediate ? "\uC5F0\uC18D \uAE09\uB4F1\u00B7\uAC70\uB798\uB7C9 \uD3ED\uC99D" : "",
            distributionRollover ? "분배형 고점 이탈" : "",
            recentMomentumRollover || historicalMomentumRollover ? "MACD 상승 탄력 반전" : "",
            creditRiskRollover ? "신용 과열 속 고점 정체" : "",
          ].filter(Boolean),
        });
        sellEpisode.signalConfirmedAt = index;
        sellEpisode.confirmedPeakPrice = sellEpisode.peakPrice;
        sellEpisode.signalLocked = sellEpisode.historical;
        lastSellSignalIndex = index;
        if (sellEpisode.historical) lastHistoricalSellSignalIndex = index;
      }
    }

    const covered = scores.filter(Number.isFinite).length;
    const buyCalibration = behaviorPolicy.buyEnabled
      ? calibrateTimingSignals(signals, "buy", dates, prices, {
        horizon: behaviorPolicy.calibrationHorizon,
        minimumSamples: behaviorPolicy.calibrationMinimumSamples,
        maxSamples: behaviorPolicy.calibrationMaxSamples,
        rejectHitRate: behaviorPolicy.rejectHitRate,
        reboundMinimumPercent: behaviorPolicy.reboundMinimumPercent,
        reboundAdverseRatio: behaviorPolicy.reboundAdverseRatio,
        objectiveAware: behaviorPolicy.objectiveAware,
      })
      : { signals, abstained: 0 };
      const sellCalibration = behaviorPolicy.sellEnabled
        ? calibrateTimingSignals(sellSignals, "sell", dates, prices, {
        horizon: behaviorPolicy.calibrationHorizon,
        minimumSamples: behaviorPolicy.calibrationMinimumSamples,
        maxSamples: behaviorPolicy.calibrationMaxSamples,
        rejectHitRate: behaviorPolicy.rejectHitRate,
        reboundMinimumPercent: behaviorPolicy.reboundMinimumPercent,
          reboundAdverseRatio: behaviorPolicy.reboundAdverseRatio,
          objectiveAware: behaviorPolicy.objectiveAware,
        })
      : { signals: sellSignals, abstained: 0 };
    return {
      signals: buyCalibration.signals,
      sellSignals: sellCalibration.signals,
      scores,
      coverage: covered / count,
      strategy: behaviorPolicy.enabled
        ? (behaviorPolicy.buyEnabled && behaviorPolicy.sellEnabled
          ? (behaviorPolicy.sellDiscoveryEnabled
            ? "adaptive-behavior-v19"
            : "adaptive-behavior-v19-buy-sell-calibration")
          : (behaviorPolicy.buyEnabled
            ? "adaptive-behavior-v19-buy"
            : (behaviorPolicy.sellDiscoveryEnabled
              ? "adaptive-behavior-v19-sell"
              : "adaptive-behavior-v19-sell-calibration")))
        : (koreanVolatilityPolicy.enabled || externalVolatilityPolicy.enabled
          ? "episode-extreme-v16-regime-confirmed"
          : "episode-extreme-v13"),
      behaviorPolicy: behaviorPolicy.enabled ? { ...behaviorPolicy } : null,
      calibration: behaviorPolicy.enabled ? {
        pointInTime: true,
        buyAbstained: buyCalibration.abstained,
        sellAbstained: sellCalibration.abstained,
      } : null,
    };
  }

  globalScope.ThinkStockMarketTiming = Object.freeze({
    OVERSOLD_MEMORY_DAYS,
    BUY_SETUP_WINDOW_DAYS,
    SELL_SIGNAL_COOLDOWN_DAYS,
    STOCK_OVERHEAT_MEMORY_DAYS,
    VOLATILITY_MAX_HISTORY_DAYS,
    VOLATILITY_RECENT_DAYS,
    KOREAN_VOLATILITY_RELATIONSHIP_DAYS,
    KOREAN_VOLATILITY_MINIMUM_OBSERVATIONS,
    CREDIT_AVAILABILITY_LAG_DAYS,
    DEFAULT_KOREAN_VOLATILITY_POLICY,
    DEFAULT_EXTERNAL_VOLATILITY_POLICY,
    DEFAULT_BEHAVIOR_POLICY,
    PROMOTED_RUNTIME_BEHAVIOR_POLICY,
    alignAsOf,
    buildVolatilityProfile,
    buildKoreanVolatilityTimingRows,
    buildExternalVolatilityTimingRows,
    buildRollingReturnRelationship,
    buildMarketTimingSignals,
    classifyTimingRegime,
    classifyBehaviorProfile,
    calibrateTimingSignals,
    timingCalibrationObjective,
    decorateTimingSignal,
    alignedSource,
    rollingPercentile,
    rollingMarketRelationship,
    volumeProfile,
    scoreTimingPoint,
    pricePathEfficiency,
    stockOverheatMemory,
    standardizedReturn,
    trailingAverage,
  });
}(typeof self !== "undefined" ? self : globalThis));
