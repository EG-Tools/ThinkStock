(function initThinkStockMarketTiming(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const OVERSOLD_MEMORY_DAYS = 20;
  const BUY_SETUP_WINDOW_DAYS = 40;
  const SELL_SIGNAL_COOLDOWN_DAYS = 10;

  const toNumber = (value) => (
    value != null && Number.isFinite(Number(value)) ? Number(value) : null
  );

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

  function rollingMarketRelationship(prices, benchmarkPrices, index, lookback = 60) {
    const stockReturns = [];
    const marketReturns = [];
    const start = Math.max(1, index - lookback + 1);
    for (let cursor = start; cursor <= index; cursor += 1) {
      const stock = toNumber(prices[cursor]);
      const stockPrevious = toNumber(prices[cursor - 1]);
      const market = toNumber(benchmarkPrices[cursor]);
      const marketPrevious = toNumber(benchmarkPrices[cursor - 1]);
      if (!(stock > 0 && stockPrevious > 0 && market > 0 && marketPrevious > 0)) continue;
      stockReturns.push(Math.log(stock / stockPrevious));
      marketReturns.push(Math.log(market / marketPrevious));
    }
    if (stockReturns.length < 30) return { correlation: null, beta: null };

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
    if (stockVariance <= 1e-12 || marketVariance <= 1e-12) return { correlation: null, beta: null };
    return {
      correlation: covariance / Math.sqrt(stockVariance * marketVariance),
      beta: covariance / marketVariance,
    };
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
      benchmarkPrices,
      volumes,
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
    const priceDrawdown60 = priceNow !== null && high60 ? ((priceNow / high60) - 1) * 100 : null;
    const priceDrawdown120 = priceNow !== null && high120 ? ((priceNow / high120) - 1) * 100 : null;
    const price5d = changeRate(prices, index, 5);
    const price20d = changeRate(prices, index, 20);
    const price60d = changeRate(prices, index, 60);
    const price20dVolScore = standardizedReturn(prices, index, 20);
    const price60dVolScore = standardizedReturn(prices, index, 60);
    const benchmark20d = changeRate(benchmarkPrices, index, 20);
    const relative20d = price20d !== null && benchmark20d !== null ? price20d - benchmark20d : null;
    const marketRelationship = rollingMarketRelationship(prices, benchmarkPrices, index);
    const volume = volumeProfile(volumes, index);

    const newsNow = toNumber(news[index]);
    const leadingNow = toNumber(leading[index]);
    const leading40 = toNumber(leading[index - 40]);
    const leadingChange = leadingNow !== null && leading40 !== null ? leadingNow - leading40 : null;
    const crisisNow = toNumber(crisis[index]);
    return {
      score: [adrMin !== null && adrMin <= 80, fearMin !== null && fearMin <= 25, creditWashedOut]
        .filter(Boolean).length,
      adrMin,
      fearMin,
      newsMin,
      oscillator: oscNow,
      price5d,
      price20d,
      price60d,
      price20dVolScore,
      price60dVolScore,
      benchmark20d,
      relative20d,
      marketCorrelation60: marketRelationship.correlation,
      marketBeta60: marketRelationship.beta,
      volumeRatio: volume.ratio,
      volumeTrend: volume.trend,
      price: priceNow,
      high60,
      high120,
      low20,
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
    };
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
    const adrKey = isKosdaqSeries ? "adr_kosdaq" : "adr_kospi";
    const creditKey = isKosdaqSeries ? "kosdaq_credit" : "kospi_credit";
    const adrRows = Array.isArray(options.adrRows) ? options.adrRows : [];
    const macroRows = Array.isArray(options.macroRows) ? options.macroRows : [];
    const creditRows = Array.isArray(options.creditRows) ? options.creditRows : [];
    const crisisRows = Array.isArray(options.crisisRows) ? options.crisisRows : [];

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
      credit: alignedSource(dates, creditRows, creditKey, 10),
      crisis: alignedSource(dates, crisisRows, "score", 14),
      benchmarkPrices: dates.map((_, index) => benchmarkPrices[index] ?? null),
      volumes: dates.map((_, index) => volumes[index] ?? null),
    };
    aligned.creditGrowth = aligned.credit.map((_, index) => changeRate(aligned.credit, index, 20));
    aligned.creditPercentile = aligned.creditGrowth.map((_, index) => (
      rollingPercentile(aligned.creditGrowth, index)
    ));

    const scores = Array(count).fill(null);
    const signals = [];
    const sellSignals = [];
    let buyEpisode = null;
    let sellEpisode = null;
    let lastHistoricalSellSignalIndex = -Infinity;
    let lastSellSignalIndex = -Infinity;

    function saveEpisodeSignal(list, episode, signal) {
      if (Number.isInteger(episode.signalSlot)) list[episode.signalSlot] = signal;
      else {
        episode.signalSlot = list.length;
        list.push(signal);
      }
    }

    for (let index = 39; index < count; index += 1) {
      const result = scoreTimingPoint(aligned, index);
      scores[index] = result.score;
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
      ].filter(Boolean);
      const moderateStressReasons = [
        result.adrMin !== null && result.adrMin <= 85 ? "ADR 조정" : "",
        result.fearMin !== null && result.fearMin <= 35 ? "공포 구간" : "",
        result.creditWashoutGrowth !== null && result.creditWashoutPercentile !== null
          && result.creditWashoutGrowth <= -3 && result.creditWashoutPercentile <= 0.2
          ? "신용 감소" : "",
        result.newsMin !== null && result.newsMin <= 95 ? "뉴스심리 위축" : "",
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
        (result.price20d !== null && result.price20d <= -8
          && result.priceDrawdown60 !== null && result.priceDrawdown60 <= -15
          && result.adrMin !== null && result.adrMin <= 80)
        || (result.price20d !== null && result.price20d <= -5
          && result.price60d !== null && result.price60d <= -8
          && result.priceDrawdown120 !== null && result.priceDrawdown120 <= -14
          && result.adrMin !== null && result.adrMin <= 90)
      );
      const stockRelativeWashout = isIndividualStock
        && result.price20d !== null && result.price20d <= -1
        && result.priceDrawdown120 !== null && result.priceDrawdown120 <= -5
        && result.relative20d !== null && result.relative20d <= -10
        && result.adrMin !== null && result.adrMin <= 75
        && (result.marketCorrelation60 === null
          || result.marketCorrelation60 <= 0.35
          || result.marketBeta60 === null
          || result.marketBeta60 <= 0.35)
        && result.oscillator !== null && result.oscillator < 0;
      const broadWashoutReasons = [
        breadthWashedOut ? "시장폭 과매도" : "",
        creditReset ? "신용 정리" : "",
      ].filter(Boolean);
      const strongBuyArm = priceCapitulation && stressReasons.length >= 2;
      const moderateSupportCount = isKosdaqSeries ? 2 : 1;
      const moderateBuyArm = shockCapitulation || stockMediumCorrection || stockRelativeWashout
        || (moderateCapitulation
        && moderateStressReasons.length >= moderateSupportCount);
      const broadBuyArm = broadCorrection && creditReset
        && (breadthWashedOut || deepCorrection);
      const buyArm = strongBuyArm || moderateBuyArm || broadBuyArm;
      const freshLow = result.price !== null && result.low20 !== null
        && result.price <= result.low20 * 1.002;
      const macdDivergence = result.oscillator !== null && result.oscillator < 0
        && result.macdSlope !== null && result.macdSlope > 0
        && (result.priorMacdSlope === null
          || result.priorMacdSlope <= 0
          || result.macdSlope >= Math.abs(result.priorMacdSlope) * 0.75);

      if (buyEpisode) {
        const failedBroadRebound = (buyEpisode.broad || buyEpisode.shock) && buyEpisode.signalLocked
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
          buyEpisode = {
            lowIndex: index,
            lowPrice: result.price,
            signalSlot: null,
            signalLocked: false,
            confirmationDays: strongBuyArm ? 3
              : ((stockMediumCorrection || stockRelativeWashout) ? 6 : 5),
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
          if (shockCapitulation) {
            buyEpisode.setupReasons = ["5일 충격 급락", ...buyEpisode.setupReasons];
          }
        } else if (!buyEpisode.signalLocked) {
          if (strongBuyArm) {
            buyEpisode.strong = true;
            buyEpisode.broad = false;
            buyEpisode.confirmationDays = 3;
          } else if (moderateBuyArm) {
            buyEpisode.broad = false;
            buyEpisode.shock = buyEpisode.shock || shockCapitulation;
            if (stockMediumCorrection) {
              buyEpisode.confirmationDays = Math.max(6, buyEpisode.confirmationDays || 0);
              buyEpisode.setupReasons.unshift("\uAC1C\uBCC4\uC885\uBAA9 \uC911\uAE30 \uC870\uC815");
            }
            if (stockRelativeWashout) {
              buyEpisode.relativeWashout = true;
              buyEpisode.confirmationDays = Math.max(6, buyEpisode.confirmationDays || 0);
              buyEpisode.setupReasons.unshift("\uC800\uBCA0\uD0C0 \uC0C1\uB300 \uACFC\uB9E4\uB3C4");
            }
          }
          buyEpisode.setupReasons = [...new Set([
            ...buyEpisode.setupReasons,
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
        (result.price20d !== null && result.price20d >= 35
          && (result.price20dVolScore ?? -Infinity) >= 1.5)
        || (result.price20d !== null && result.price20d >= 15
          && (result.price60dVolScore ?? -Infinity) >= 1.8)
        || (result.price20d !== null && result.price20d >= 15
          && result.creditChange !== null && result.creditChange >= 5
          && result.creditPercentile !== null && result.creditPercentile >= 0.75)
        || (result.price20d !== null && result.price20d >= 12
          && (result.price20dVolScore ?? -Infinity) >= 1.1
          && volumeClimax)
      );
      const extremeStockExtension = result.price20d !== null && result.price20d >= 22
        && (result.price20dVolScore ?? -Infinity) >= 1.8;
      const stockDistributionArm = isIndividualStock && nearHigh
        && ((result.oscillator ?? -Infinity) >= 0.25 || extremeStockExtension)
        && (
          (result.price20d !== null && result.price20d >= 18
            && (result.price20dVolScore ?? -Infinity) >= 1.5)
          || (result.price60d !== null && result.price60d >= 30
            && (result.price60dVolScore ?? -Infinity) >= 1.8)
        );
      const stockMatureTopArm = isIndividualStock
        && result.priceDrawdown120 !== null && result.priceDrawdown120 >= -1.2
        && (result.oscillator ?? -Infinity) >= 0.4
        && (
          (result.price20d !== null && result.price20d >= 10
            && (result.price20dVolScore ?? -Infinity) >= 1.1)
          || (result.price60d !== null && result.price60d >= 20
            && (result.price60dVolScore ?? -Infinity) >= 1.3)
        );
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
      const recentSellArm = riskDrivenSellArm || stockClimaxArm || stockDistributionArm
        || stockMatureTopArm || fearRotationTopArm || breadthSentimentDivergenceTopArm
        || (nearHigh && priceExtended
        && (overheatSupportCount >= 2 || (priceStronglyExtended && overheatSupportCount >= 1)));
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
            ? episodeDrawdown <= -12
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
        const setupReasons = [
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
            riskDriven: riskDrivenSellArm,
            distribution: stockDistributionArm,
            matureTop: stockMatureTopArm,
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
      const episodeMomentumRollover = sellEpisode?.historical
        ? (historicalMomentumRollover || exceptionalCreditRollover)
        : (() => {
          if (!isIndividualStock) return recentMomentumRollover || creditRiskRollover;
          const episodeDrawdown = result.price !== null && sellEpisode?.peakPrice > 0
            ? ((result.price / sellEpisode.peakPrice) - 1) * 100
            : null;
          return episodeDrawdown !== null && episodeDrawdown <= -4
            && (recentMomentumRollover || creditRiskRollover);
        })();
      const distributionRollover = isIndividualStock
        && (sellEpisode?.distribution || sellEpisode?.matureTop || sellEpisode?.fearRotation)
        && result.price !== null && sellEpisode.peakPrice > 0
        && ((result.price / sellEpisode.peakPrice) - 1) * 100
          <= (sellEpisode.fearRotation ? -2.5 : (sellEpisode.matureTop ? -5 : -2.5))
        && result.macdSlope !== null && result.macdSlope <= 0
        && (sellEpisode.matureTop
          || result.oscillator > 0
          || (priorOscillator !== null && priorOscillator > 0));
      const sellConfirmationWindow = sellEpisode?.fearRotation
        ? 8
        : (sellEpisode?.matureTop ? 20 : (sellEpisode?.distribution ? 8 : 3));
      if (sellEpisode && !sellEpisode.signalLocked
        && (!Number.isInteger(sellEpisode.signalConfirmedAt)
          || sellEpisode.peakIndex > sellEpisode.signalConfirmedAt)
        && index - sellEpisode.peakIndex <= sellConfirmationWindow
        && (episodeMomentumRollover || distributionRollover)) {
        saveEpisodeSignal(sellSignals, sellEpisode, {
          date: dates[sellEpisode.peakIndex],
          confirmationDate: dates[index],
          peakDate: dates[sellEpisode.peakIndex],
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
    return { signals, sellSignals, scores, coverage: covered / count, strategy: "episode-extreme-v12" };
  }

  globalScope.ThinkStockMarketTiming = Object.freeze({
    OVERSOLD_MEMORY_DAYS,
    BUY_SETUP_WINDOW_DAYS,
    SELL_SIGNAL_COOLDOWN_DAYS,
    alignAsOf,
    buildMarketTimingSignals,
    rollingPercentile,
    rollingMarketRelationship,
    volumeProfile,
    scoreTimingPoint,
    standardizedReturn,
    trailingAverage,
  });
}(typeof self !== "undefined" ? self : globalThis));
