(function initThinkStockMarketTimingEvaluation(globalScope) {
  "use strict";

  const HORIZONS = Object.freeze([5, 20, 60]);

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function median(values) {
    const clean = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!clean.length) return null;
    const middle = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
  }

  function rounded(value, digits = 4) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  }

  function wilsonLowerBound(successes, samples, z = 1.96) {
    const count = Math.max(0, Number(samples) || 0);
    if (!count) return null;
    const rate = Math.max(0, Math.min(1, (Number(successes) || 0) / count));
    const zSquared = z ** 2;
    const denominator = 1 + (zSquared / count);
    const center = rate + (zSquared / (2 * count));
    const margin = z * Math.sqrt(((rate * (1 - rate)) / count) + (zSquared / (4 * count ** 2)));
    return rounded((center - margin) / denominator);
  }

  function collapseSignalEpisodes(signals, dates, options = {}) {
    const minimumGap = Math.max(1, Math.round(Number(options.minimumGap) || 10));
    const indexByDate = new Map((Array.isArray(dates) ? dates : []).map((date, index) => [
      String(date || "").slice(0, 10),
      index,
    ]));
    const ordered = (Array.isArray(signals) ? signals : [])
      .map((signal) => ({
        ...signal,
        confirmationDate: String(signal?.confirmationDate || signal?.date || "").slice(0, 10),
      }))
      .filter((signal) => signal.confirmationDate)
      .sort((left, right) => left.confirmationDate.localeCompare(right.confirmationDate));
    const episodes = [];
    ordered.forEach((signal) => {
      const currentIndex = indexByDate.get(signal.confirmationDate);
      const previous = episodes.at(-1);
      const previousIndex = indexByDate.get(previous?.confirmationDate);
      const separated = Number.isInteger(currentIndex) && Number.isInteger(previousIndex)
        ? currentIndex - previousIndex > minimumGap
        : Math.round((Date.parse(`${signal.confirmationDate}T00:00:00Z`)
          - Date.parse(`${previous?.confirmationDate}T00:00:00Z`)) / 86400000) > minimumGap;
      if (!previous || separated) {
        episodes.push({ ...signal, episodeSize: 1 });
      } else {
        previous.episodeSize += 1;
      }
    });
    return Object.freeze(episodes.map(Object.freeze));
  }

  function timingTemporalCoverage(signals) {
    const dates = [...new Set((Array.isArray(signals) ? signals : [])
      .map((signal) => String(signal?.confirmationDate || signal?.date || "").slice(0, 10))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))]
      .sort();
    const yearCounts = {};
    dates.forEach((date) => { yearCounts[date.slice(0, 4)] = (yearCounts[date.slice(0, 4)] || 0) + 1; });
    const firstYear = Number(dates[0]?.slice(0, 4)) || 0;
    const lastYear = Number(dates.at(-1)?.slice(0, 4)) || firstYear;
    const spanYears = dates.length ? Math.max(1, lastYear - firstYear + 1) : 0;
    const activeYears = Object.keys(yearCounts).length;
    const maximumYearShare = dates.length
      ? Math.max(...Object.values(yearCounts)) / dates.length
      : null;
    const eligibleForCheck = dates.length >= 12 && spanYears >= 3;
    const requiredActiveYears = eligibleForCheck ? Math.min(3, spanYears) : 0;
    const passed = !eligibleForCheck
      || (activeYears >= requiredActiveYears && maximumYearShare <= 0.6);
    return Object.freeze({
      samples: dates.length,
      spanYears,
      activeYears,
      maximumYearShare: rounded(maximumYearShare),
      requiredActiveYears,
      eligibleForCheck,
      passed,
      byYear: Object.freeze(yearCounts),
    });
  }

  function buildPurgedTimingHoldout(signals, dates, options = {}) {
    const sourceDates = Array.isArray(dates) ? dates.map((date) => String(date || "").slice(0, 10)) : [];
    const indexByDate = new Map(sourceDates.map((date, index) => [date, index]));
    const holdoutRatio = Math.max(0.15, Math.min(0.5, Number(options.holdoutRatio) || 0.3));
    const horizons = Array.isArray(options.horizons) && options.horizons.length
      ? options.horizons
      : HORIZONS;
    const purgeTradingDays = Math.max(...horizons.map((value) => Math.max(1, Number(value) || 0)));
    const requestedStart = String(options.holdoutStartDate || "").slice(0, 10);
    const derivedIndex = Math.max(0, Math.min(
      sourceDates.length - 1,
      Math.floor(sourceDates.length * (1 - holdoutRatio)),
    ));
    const holdoutStartDate = indexByDate.has(requestedStart)
      ? requestedStart
      : (sourceDates[derivedIndex] || "");
    const holdoutStartIndex = indexByDate.get(holdoutStartDate);
    const developmentEndIndex = Number.isInteger(holdoutStartIndex)
      ? holdoutStartIndex - purgeTradingDays - 1
      : -1;
    const development = [];
    const holdout = [];
    let purged = 0;
    (Array.isArray(signals) ? signals : []).forEach((signal) => {
      const date = String(signal?.confirmationDate || signal?.date || "").slice(0, 10);
      const index = indexByDate.get(date);
      if (!Number.isInteger(index)) return;
      if (index <= developmentEndIndex) development.push(signal);
      else if (index >= holdoutStartIndex) holdout.push(signal);
      else purged += 1;
    });
    return Object.freeze({
      holdoutStartDate,
      purgeTradingDays,
      purged,
      development: Object.freeze(development),
      holdout: Object.freeze(holdout),
    });
  }

  function evaluateSignalSide(signals, side, dates, prices, horizons = HORIZONS) {
    const indexByDate = new Map(dates.map((date, index) => [String(date || "").slice(0, 10), index]));
    const results = Object.fromEntries(horizons.map((horizon) => [horizon, []]));
    let invalidLookAhead = 0;
    (Array.isArray(signals) ? signals : []).forEach((signal) => {
      const signalDate = String(signal?.date || "").slice(0, 10);
      const confirmationDate = String(signal?.confirmationDate || signalDate).slice(0, 10);
      if (!signalDate || !confirmationDate || confirmationDate < signalDate) {
        invalidLookAhead += 1;
        return;
      }
      const startIndex = indexByDate.get(confirmationDate);
      const startPrice = finite(prices[startIndex]);
      if (!Number.isInteger(startIndex) || startPrice === null) return;
      horizons.forEach((horizon) => {
        const endPrice = finite(prices[startIndex + horizon]);
        if (endPrice === null) return;
        const forwardReturn = endPrice / startPrice - 1;
        const directionalReturn = side === "buy" ? forwardReturn : -forwardReturn;
        const path = prices.slice(startIndex + 1, startIndex + horizon + 1)
          .map(finite)
          .filter((value) => value !== null)
          .map((value) => {
            const pathReturn = value / startPrice - 1;
            return side === "buy" ? pathReturn : -pathReturn;
          });
        results[horizon].push({
          forwardReturn,
          directionalReturn,
          correct: directionalReturn > 0,
          maxAdverseReturn: path.length ? Math.min(0, ...path) : 0,
          maxFavorableReturn: path.length ? Math.max(0, ...path) : 0,
        });
      });
    });
    return Object.freeze({
      signalCount: Array.isArray(signals) ? signals.length : 0,
      invalidLookAhead,
      horizons: Object.freeze(Object.fromEntries(horizons.map((horizon) => {
        const rows = results[horizon];
        const hits = rows.reduce((sum, row) => sum + Number(row.correct), 0);
        return [horizon, Object.freeze({
          samples: rows.length,
          hits,
          hitRate: rounded(mean(rows.map((row) => Number(row.correct)))),
          hitRateLowerBound: wilsonLowerBound(hits, rows.length),
          meanForwardReturn: rounded(mean(rows.map((row) => row.forwardReturn))),
          meanDirectionalReturn: rounded(mean(rows.map((row) => row.directionalReturn))),
          medianDirectionalReturn: rounded(median(rows.map((row) => row.directionalReturn))),
          meanMaxAdverseReturn: rounded(mean(rows.map((row) => row.maxAdverseReturn))),
          medianMaxAdverseReturn: rounded(median(rows.map((row) => row.maxAdverseReturn))),
          meanMaxFavorableReturn: rounded(mean(rows.map((row) => row.maxFavorableReturn))),
        })];
      }))),
    });
  }

  function evaluateSignalsByEntryMode(signals, side, dates, prices, horizons = HORIZONS) {
    const grouped = new Map();
    (Array.isArray(signals) ? signals : []).forEach((signal) => {
      const mode = String(signal?.entryMode || "standard").trim() || "standard";
      if (!grouped.has(mode)) grouped.set(mode, []);
      grouped.get(mode).push(signal);
    });
    return Object.freeze(Object.fromEntries([...grouped.entries()].map(([mode, rows]) => [
      mode,
      evaluateSignalSide(rows, side, dates, prices, horizons),
    ])));
  }

  function classifyTimingContext(indexKey, prices) {
    const key = String(indexKey || "").trim().toUpperCase();
    const market = key === "^KQ11" || key.endsWith(".KQ") ? "KOSDAQ" : "KOSPI";
    const history = (Array.isArray(prices) ? prices : []).slice(-(15 * 252));
    const returns = [];
    for (let index = 1; index < history.length; index += 1) {
      const current = finite(history[index]);
      const previous = finite(history[index - 1]);
      if (current !== null && previous !== null) returns.push(Math.log(current / previous));
    }
    const average = mean(returns) || 0;
    const variance = returns.length > 1
      ? returns.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (returns.length - 1)
      : 0;
    const dailyVolatility = Math.sqrt(Math.max(0, variance));
    const volatilityGroup = dailyVolatility <= 0.014
      ? "low"
      : (dailyVolatility <= 0.028 ? "mid" : "high");
    return Object.freeze({
      indexKey: key,
      market,
      kind: /^\^K[QS]11$/.test(key) ? "index" : "stock",
      dailyVolatility: rounded(dailyVolatility, 6),
      volatilityGroup,
      cohort: `${market}:${volatilityGroup}`,
    });
  }

  function holdoutQualityMetrics(value, options = {}) {
    const quality = value?.quality || value || {};
    const horizon = String(Number(options.horizon) || 20);
    const bySide = Object.freeze(Object.fromEntries(["buy", "sell"].map((side) => {
      const row = quality?.validation?.holdout?.[side]?.horizons?.[horizon] || {};
      const samples = Math.max(0, Number(row.samples) || 0);
      const hits = Number.isFinite(Number(row.hits))
        ? Number(row.hits)
        : ((Number(row.hitRate) || 0) * samples);
      return [side, Object.freeze({
        horizon: Number(horizon),
        samples,
        hits,
        hitRate: samples ? rounded(hits / samples) : null,
        hitRateLowerBound: wilsonLowerBound(hits, samples),
        meanDirectionalReturn: Number.isFinite(Number(row.meanDirectionalReturn))
          ? rounded(Number(row.meanDirectionalReturn))
          : null,
        meanMaxAdverseReturn: Number.isFinite(Number(row.meanMaxAdverseReturn))
          ? rounded(Number(row.meanMaxAdverseReturn))
          : null,
        meanMaxFavorableReturn: Number.isFinite(Number(row.meanMaxFavorableReturn))
          ? rounded(Number(row.meanMaxFavorableReturn))
          : null,
      })];
    })));
    const rows = Object.values(bySide).filter((row) => row.samples > 0);
    const samples = rows.reduce((sum, row) => sum + row.samples, 0);
    const weighted = (key) => samples
      ? rows.reduce((sum, row) => sum + ((Number(row?.[key]) || 0) * row.samples), 0) / samples
      : null;
    const hits = rows.reduce((sum, row) => (
      sum + (Number.isFinite(Number(row?.hits))
        ? Number(row.hits)
        : ((Number(row?.hitRate) || 0) * row.samples))
    ), 0);
    return Object.freeze({
      horizon: Number(horizon),
      bySide,
      samples,
      hitRate: samples ? rounded(hits / samples) : null,
      hitRateLowerBound: wilsonLowerBound(hits, samples),
      meanDirectionalReturn: rounded(weighted("meanDirectionalReturn")),
      meanMaxAdverseReturn: rounded(weighted("meanMaxAdverseReturn")),
      meanMaxFavorableReturn: rounded(weighted("meanMaxFavorableReturn")),
    });
  }

  function timingGeneralizationGap(validation, horizon = 20) {
    const key = String(Number(horizon) || 20);
    const bySide = Object.freeze(Object.fromEntries(["buy", "sell"].map((side) => {
      const development = validation?.development?.[side]?.horizons?.[key] || {};
      const holdout = validation?.holdout?.[side]?.horizons?.[key] || {};
      const developmentSamples = Math.max(0, Number(development.samples) || 0);
      const holdoutSamples = Math.max(0, Number(holdout.samples) || 0);
      const comparable = developmentSamples >= 8 && holdoutSamples >= 5;
      const hitRateGap = comparable
        ? Number(development.hitRate) - Number(holdout.hitRate)
        : null;
      const returnGap = comparable
        ? Number(development.meanDirectionalReturn) - Number(holdout.meanDirectionalReturn)
        : null;
      const overfit = comparable && (
        hitRateGap > 0.2
        || (returnGap > 0.04 && Number(holdout.meanDirectionalReturn) <= 0.005)
      );
      return [side, Object.freeze({
        developmentSamples,
        holdoutSamples,
        comparable,
        hitRateGap: rounded(hitRateGap),
        directionalReturnGap: rounded(returnGap),
        overfit,
      })];
    })));
    return Object.freeze({
      horizon: Number(key),
      bySide,
      overfit: Object.values(bySide).some((row) => row.overfit),
    });
  }

  function evaluateMarketTimingQualityGate(value, options = {}) {
    const quality = value?.quality || value || {};
    const metrics = holdoutQualityMetrics(quality, options);
    const minimumSamples = Math.max(1, Number(options.minimumSamples) || 8);
    const minimumSideSamples = Math.max(2, Number(options.minimumSideSamples) || 5);
    const minimumHitLowerBound = Math.max(0, Number(options.minimumHitLowerBound) || 0.2);
    const minimumDirectionalReturn = Number.isFinite(Number(options.minimumDirectionalReturn))
      ? Number(options.minimumDirectionalReturn)
      : 0;
    const reasons = [];
    const sideReasons = { buy: [], sell: [] };
    if (quality.pointInTimeSafe === false) reasons.push("point-in-time-unsafe");
    if (quality.overfitRisk === true) reasons.push("development-holdout-gap");
    if (quality.temporalCoverage?.eligibleForCheck && quality.temporalCoverage?.passed === false) {
      reasons.push("temporally-concentrated-signals");
    }
    if (metrics.samples < minimumSamples) reasons.push("insufficient-holdout-samples");
    if (metrics.samples >= minimumSamples && Number(metrics.hitRateLowerBound) < minimumHitLowerBound) {
      reasons.push("weak-hit-rate-lower-bound");
    }
    if (metrics.samples >= minimumSamples && Number(metrics.meanDirectionalReturn) <= minimumDirectionalReturn) {
      reasons.push("non-positive-holdout-return");
    }
    Object.entries(metrics.bySide).forEach(([side, row]) => {
      if (row.samples < minimumSideSamples) return;
      if (Number(row.hitRateLowerBound) < minimumHitLowerBound) {
        sideReasons[side].push("weak-hit-rate-lower-bound");
        reasons.push(`${side}-weak-hit-rate-lower-bound`);
      }
      if (Number(row.meanDirectionalReturn) <= minimumDirectionalReturn) {
        sideReasons[side].push("non-positive-holdout-return");
        reasons.push(`${side}-non-positive-holdout-return`);
      }
    });
    return Object.freeze({
      format: "market-timing-quality-gate-v2",
      eligible: reasons.length === 0,
      metrics,
      minimumSamples,
      minimumSideSamples,
      minimumHitLowerBound,
      minimumDirectionalReturn,
      sideReasons: Object.freeze({
        buy: Object.freeze(sideReasons.buy),
        sell: Object.freeze(sideReasons.sell),
      }),
      reasons: Object.freeze(reasons),
    });
  }

  function compareMarketTimingCandidates(champion, challenger, options = {}) {
    const championMetrics = holdoutQualityMetrics(champion, options);
    const challengerMetrics = holdoutQualityMetrics(challenger, options);
    const challengerGate = evaluateMarketTimingQualityGate(challenger, options);
    const minimumSamples = Math.max(1, Number(options.minimumSamples) || 8);
    const minimumSideSamples = Math.max(2, Number(options.minimumSideSamples) || 5);
    if (championMetrics.samples < minimumSamples || challengerMetrics.samples < minimumSamples) {
      return Object.freeze({
        decision: "insufficient-evidence",
        promote: false,
        champion: championMetrics,
        challenger: challengerMetrics,
        reasons: Object.freeze(["insufficient-comparable-holdout"]),
      });
    }
    const deltas = Object.freeze({
      hitRateLowerBound: rounded(
        Number(challengerMetrics.hitRateLowerBound) - Number(championMetrics.hitRateLowerBound),
      ),
      meanDirectionalReturn: rounded(
        Number(challengerMetrics.meanDirectionalReturn) - Number(championMetrics.meanDirectionalReturn),
      ),
      meanMaxAdverseReturn: rounded(
        Number(challengerMetrics.meanMaxAdverseReturn) - Number(championMetrics.meanMaxAdverseReturn),
      ),
    });
    const reasons = [...challengerGate.reasons];
    if (deltas.hitRateLowerBound < -(Number(options.maximumHitRateDrop) || 0.03)) {
      reasons.push("hit-rate-regression");
    }
    if (deltas.meanDirectionalReturn < -(Number(options.maximumReturnDrop) || 0.005)) {
      reasons.push("directional-return-regression");
    }
    if (deltas.meanMaxAdverseReturn < -(Number(options.maximumAdverseDrop) || 0.015)) {
      reasons.push("adverse-return-regression");
    }
    ["buy", "sell"].forEach((side) => {
      const before = championMetrics.bySide[side];
      const after = challengerMetrics.bySide[side];
      if (before.samples < minimumSideSamples || after.samples < minimumSideSamples) return;
      if (Number(after.hitRateLowerBound) - Number(before.hitRateLowerBound)
        < -(Number(options.maximumHitRateDrop) || 0.03)) {
        reasons.push(`${side}-hit-rate-regression`);
      }
      if (Number(after.meanDirectionalReturn) - Number(before.meanDirectionalReturn)
        < -(Number(options.maximumReturnDrop) || 0.005)) {
        reasons.push(`${side}-directional-return-regression`);
      }
    });
    const meaningfulImprovement = deltas.hitRateLowerBound >= (Number(options.minimumHitRateGain) || 0.02)
      || deltas.meanDirectionalReturn >= (Number(options.minimumReturnGain) || 0.005);
    if (!meaningfulImprovement) reasons.push("no-material-improvement");
    const promote = reasons.length === 0;
    return Object.freeze({
      decision: promote ? "promote-challenger" : "keep-champion",
      promote,
      champion: championMetrics,
      challenger: challengerMetrics,
      deltas,
      reasons: Object.freeze(reasons),
    });
  }

  function evaluateMarketTimingModel(model, options = {}) {
    const dates = Array.isArray(options.dates) ? options.dates : [];
    const prices = Array.isArray(options.prices) ? options.prices : [];
    const indexKey = options.indexKey || model?.indexKey
      || model?.signals?.[0]?.indexKey || model?.sellSignals?.[0]?.indexKey || "";
    const buySignals = collapseSignalEpisodes(model?.signals, dates, options.episodeOptions);
    const sellSignals = collapseSignalEpisodes(model?.sellSignals, dates, options.episodeOptions);
    const buy = evaluateSignalSide(buySignals, "buy", dates, prices, options.horizons);
    const sell = evaluateSignalSide(sellSignals, "sell", dates, prices, options.horizons);
    const byEntryMode = Object.freeze({
      buy: evaluateSignalsByEntryMode(buySignals, "buy", dates, prices, options.horizons),
      sell: evaluateSignalsByEntryMode(sellSignals, "sell", dates, prices, options.horizons),
    });
    const buySplit = buildPurgedTimingHoldout(buySignals, dates, options);
    const sellSplit = buildPurgedTimingHoldout(sellSignals, dates, options);
    const validationBase = {
      holdoutStartDate: buySplit.holdoutStartDate || sellSplit.holdoutStartDate,
      purgeTradingDays: Math.max(buySplit.purgeTradingDays, sellSplit.purgeTradingDays),
      purgedSignals: buySplit.purged + sellSplit.purged,
      development: Object.freeze({
        buy: evaluateSignalSide(buySplit.development, "buy", dates, prices, options.horizons),
        sell: evaluateSignalSide(sellSplit.development, "sell", dates, prices, options.horizons),
      }),
      holdout: Object.freeze({
        buy: evaluateSignalSide(buySplit.holdout, "buy", dates, prices, options.horizons),
        sell: evaluateSignalSide(sellSplit.holdout, "sell", dates, prices, options.horizons),
      }),
      holdoutByEntryMode: Object.freeze({
        buy: evaluateSignalsByEntryMode(buySplit.holdout, "buy", dates, prices, options.horizons),
        sell: evaluateSignalsByEntryMode(sellSplit.holdout, "sell", dates, prices, options.horizons),
      }),
    };
    const comparableHorizon = String((Array.isArray(options.horizons) && options.horizons.length
      ? options.horizons
      : HORIZONS).includes(20) ? 20 : (options.horizons || HORIZONS)[0]);
    const generalization = timingGeneralizationGap(validationBase, comparableHorizon);
    const validation = Object.freeze({ ...validationBase, generalization });
    const matureSamples = Object.values(buy.horizons).reduce((sum, row) => sum + row.samples, 0)
      + Object.values(sell.horizons).reduce((sum, row) => sum + row.samples, 0);
    const holdoutMatureSamples = [validation.holdout.buy, validation.holdout.sell]
      .reduce((total, side) => total + Object.values(side.horizons)
        .reduce((sum, row) => sum + row.samples, 0), 0);
    const developmentMatureSamples = [validation.development.buy, validation.development.sell]
      .reduce((total, side) => total + Object.values(side.horizons)
        .reduce((sum, row) => sum + row.samples, 0), 0);
    const temporalCoverage = timingTemporalCoverage([...buySignals, ...sellSignals]);
    const overfitRisk = generalization.overfit || temporalCoverage.passed === false;
    const pointInTimeSafe = buy.invalidLookAhead === 0 && sell.invalidLookAhead === 0;
    const quality = {
      format: "market-timing-quality-v5",
      context: classifyTimingContext(indexKey, prices),
      rawSignalCount: Object.freeze({
        buy: Array.isArray(model?.signals) ? model.signals.length : 0,
        sell: Array.isArray(model?.sellSignals) ? model.sellSignals.length : 0,
      }),
      episodeCount: Object.freeze({ buy: buySignals.length, sell: sellSignals.length }),
      buy,
      sell,
      byEntryMode,
      validation,
      matureSamples,
      developmentMatureSamples,
      holdoutMatureSamples,
      temporalCoverage,
      overfitRisk,
      pointInTimeSafe,
    };
    const gate = evaluateMarketTimingQualityGate(quality, options.qualityGateOptions);
    return Object.freeze({
      ...quality,
      gate,
      status: matureSamples >= 30 && gate.eligible
        ? "usable"
        : (matureSamples > 0 ? "limited" : "pending"),
    });
  }

  function createSideRows() {
    return { buy: {}, sell: {} };
  }

  function accumulateSideRows(sideRows, quality) {
    ["buy", "sell"].forEach((side) => {
      Object.entries(quality?.[side]?.horizons || {}).forEach(([horizon, row]) => {
        const samples = Math.max(0, Number(row?.samples) || 0);
        const hitRate = Number(row?.hitRate);
        const hits = Number(row?.hits);
        const meanDirectionalReturn = Number(row?.meanDirectionalReturn);
        const meanMaxAdverseReturn = Number(row?.meanMaxAdverseReturn);
        const meanMaxFavorableReturn = Number(row?.meanMaxFavorableReturn);
        sideRows[side][horizon] ||= {
          samples: 0,
          weightedHits: 0,
          directionalSamples: 0,
          weightedDirectionalReturn: 0,
          adverseSamples: 0,
          weightedMaxAdverseReturn: 0,
          favorableSamples: 0,
          weightedMaxFavorableReturn: 0,
        };
        const target = sideRows[side][horizon];
        target.samples += samples;
        if (Number.isFinite(hits)) target.weightedHits += hits;
        else if (Number.isFinite(hitRate)) target.weightedHits += hitRate * samples;
        if (Number.isFinite(meanDirectionalReturn)) {
          target.weightedDirectionalReturn += meanDirectionalReturn * samples;
          target.directionalSamples += samples;
        }
        if (Number.isFinite(meanMaxAdverseReturn)) {
          target.weightedMaxAdverseReturn += meanMaxAdverseReturn * samples;
          target.adverseSamples += samples;
        }
        if (Number.isFinite(meanMaxFavorableReturn)) {
          target.weightedMaxFavorableReturn += meanMaxFavorableReturn * samples;
          target.favorableSamples += samples;
        }
      });
    });
  }

  function finalizeSideRows(sideRows) {
    return Object.fromEntries(Object.entries(sideRows).map(([side, horizons]) => [
      side,
      Object.freeze(Object.fromEntries(Object.entries(horizons).map(([horizon, row]) => [
        horizon,
        Object.freeze({
          samples: row.samples,
          hitRate: row.samples ? rounded(row.weightedHits / row.samples) : null,
          hitRateLowerBound: wilsonLowerBound(row.weightedHits, row.samples),
          meanDirectionalReturn: row.directionalSamples
            ? rounded(row.weightedDirectionalReturn / row.directionalSamples)
            : null,
          meanMaxAdverseReturn: row.adverseSamples
            ? rounded(row.weightedMaxAdverseReturn / row.adverseSamples)
            : null,
          meanMaxFavorableReturn: row.favorableSamples
            ? rounded(row.weightedMaxFavorableReturn / row.favorableSamples)
            : null,
        }),
      ]))),
    ]));
  }

  function summarizeMarketTimingQuality(values) {
    const entries = values instanceof Map
      ? [...values.entries()]
      : Object.entries(values && typeof values === "object" ? values : {});
    const models = entries.map(([, model]) => model);
    const qualityEntries = entries.flatMap(([indexKey, model]) => (
      model?.quality ? [[indexKey, model.quality]] : []
    ));
    const statuses = { usable: 0, limited: 0, pending: 0, unknown: 0 };
    const sideRows = createSideRows();
    const cohortRows = {};
    let matureSamples = 0;
    let pointInTimeUnsafe = 0;
    let gateEligible = 0;
    let gateRejected = 0;

    qualityEntries.forEach(([indexKey, quality]) => {
      const status = Object.hasOwn(statuses, quality.status) ? quality.status : "unknown";
      statuses[status] += 1;
      matureSamples += Math.max(0, Number(quality.matureSamples) || 0);
      if (quality.pointInTimeSafe === false) pointInTimeUnsafe += 1;
      if (quality.gate?.eligible === true) gateEligible += 1;
      else if (quality.gate) gateRejected += 1;
      accumulateSideRows(sideRows, quality);
      const context = quality.context || classifyTimingContext(indexKey, []);
      const cohortKey = String(context.cohort || `${context.market || "KOSPI"}:${context.volatilityGroup || "low"}`);
      cohortRows[cohortKey] ||= { models: 0, matureSamples: 0, sideRows: createSideRows() };
      cohortRows[cohortKey].models += 1;
      cohortRows[cohortKey].matureSamples += Math.max(0, Number(quality.matureSamples) || 0);
      accumulateSideRows(cohortRows[cohortKey].sideRows, quality);
    });

    const sides = finalizeSideRows(sideRows);
    const byCohort = Object.freeze(Object.fromEntries(Object.entries(cohortRows).map(([key, row]) => {
      const cohortSides = finalizeSideRows(row.sideRows);
      return [key, Object.freeze({
        models: row.models,
        matureSamples: row.matureSamples,
        buy: cohortSides.buy,
        sell: cohortSides.sell,
      })];
    })));
    return Object.freeze({
      format: "market-timing-quality-summary-v3",
      modelCount: models.length,
      evaluatedModels: qualityEntries.length,
      matureSamples,
      pointInTimeUnsafe,
      gateEligible,
      gateRejected,
      statuses: Object.freeze(statuses),
      buy: sides.buy,
      sell: sides.sell,
      byCohort,
    });
  }

  globalScope.ThinkStockMarketTimingEvaluation = Object.freeze({
    HORIZONS,
    buildPurgedTimingHoldout,
    classifyTimingContext,
    collapseSignalEpisodes,
    compareMarketTimingCandidates,
    evaluateMarketTimingQualityGate,
    evaluateMarketTimingModel,
    evaluateSignalSide,
    evaluateSignalsByEntryMode,
    summarizeMarketTimingQuality,
    holdoutQualityMetrics,
    timingGeneralizationGap,
    timingTemporalCoverage,
    wilsonLowerBound,
  });
}(typeof self !== "undefined" ? self : globalThis));
