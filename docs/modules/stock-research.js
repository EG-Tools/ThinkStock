(function initThinkStockStockResearch(globalScope) {
  "use strict";

  const contract = globalScope.ThinkStockStockResearchContract;
  if (!contract) throw new Error("stock research contract failed to load");
  const CALCULATION_VERSION = contract.CALCULATION_VERSION;
  const STRATEGY_VERSION = CALCULATION_VERSION;
  const DAY_MS = 86400000;
  const RECENT_SIGNAL_WINDOW = contract.RECENT_SIGNAL_WINDOW;
  const ONE_MONTH_SIGNAL_WINDOW = contract.ONE_MONTH_SIGNAL_WINDOW;

  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  function percentile(values, ratio) {
    const clean = (values || []).filter(Number.isFinite).sort((left, right) => left - right);
    if (!clean.length) return null;
    const position = (clean.length - 1) * ratio;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return lower === upper
      ? clean[lower]
      : clean[lower] + ((clean[upper] - clean[lower]) * (position - lower));
  }

  function percentChange(rows, days) {
    if (!Array.isArray(rows) || rows.length <= days) return null;
    return ((rows.at(-1).close / rows.at(-(days + 1)).close) - 1) * 100;
  }

  function buildDirectionalSignalRuns(signals, transitionSignals, dateIndexes) {
    const events = [
      ...(signals || []).map((signal) => ({ type: "signal", signal, index: dateIndexes.get(signal.date) })),
      ...(transitionSignals || []).map((signal) => ({ type: "transition", signal, index: dateIndexes.get(signal.date) })),
    ].filter((event) => Number.isInteger(event.index))
      .sort((left, right) => left.index - right.index || (left.type === "transition" ? -1 : 1));
    const runs = [];
    let activeSignals = [];
    events.forEach((event) => {
      if (event.type === "signal") {
        activeSignals.push({ ...event.signal, index: event.index });
        return;
      }
      if (activeSignals.length) {
        runs.push({
          signals: activeSignals,
          transition: { ...event.signal, index: event.index },
        });
      }
      activeSignals = [];
    });
    if (activeSignals.length) runs.push({ signals: activeSignals, transition: null });
    return runs;
  }

  function buildSignalRuns(buySignals, sellSignals, dateIndexes) {
    return buildDirectionalSignalRuns(buySignals, sellSignals, dateIndexes)
      .map((run) => ({ buys: run.signals, sell: run.transition }));
  }

  function annualizedVolatility(rows, days = 60) {
    const sample = (rows || []).slice(-(days + 1));
    const returns = sample.slice(1).map((row, index) => Math.log(row.close / sample[index].close));
    if (returns.length < Math.min(30, days)) return null;
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + ((value - average) ** 2), 0)
      / Math.max(1, returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  function isRecentEnough(latestDate, asOfDate, maxDays = 14) {
    const latest = Date.parse(`${latestDate}T00:00:00Z`);
    const asOf = Date.parse(`${asOfDate}T00:00:00Z`);
    return Number.isFinite(latest) && Number.isFinite(asOf) && asOf - latest <= maxDays * DAY_MS;
  }

  function assessTicker(options = {}) {
    const item = options.item || {};
    const behaviorPolicy = options.behaviorPolicy
      || globalScope.ThinkStockMarketTiming?.PROMOTED_RUNTIME_BEHAVIOR_POLICY;
    const includeBuy = options.includeBuy !== false;
    const includeSell = options.includeSell === true;
    const todayOnly = options.todayOnly === true;
    const collectAllSignals = options.collectAllSignals === true;
    if (!includeBuy && !includeSell) return null;
    const configuredMinimum = number(options.minimumSignals ?? options.minimumBuySignals);
    const minimumSignals = todayOnly || collectAllSignals
      ? 1
      : Math.max(1, Math.min(10, Math.round(configuredMinimum || 5)));
    const rowsByDate = new Map();
    (options.rows || []).forEach((row) => {
      const normalized = {
        date: String(row?.date || "").slice(0, 10),
        close: number(row?.close),
        volume: number(row?.volume),
      };
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized.date) && normalized.close > 0) {
        rowsByDate.set(normalized.date, normalized);
      }
    });
    const currentDate = String(item.baseDate || "").slice(0, 10);
    const analysisDate = String(options.asOfDate || "").slice(0, 10);
    const currentClose = number(item.close);
    const currentVolume = number(item.volume);
    if (/^\d{4}-\d{2}-\d{2}$/.test(currentDate)
      && currentClose > 0
      && (!analysisDate || currentDate === analysisDate)) {
      const existing = rowsByDate.get(currentDate);
      rowsByDate.set(currentDate, {
        date: currentDate,
        close: currentClose,
        volume: currentVolume ?? existing?.volume ?? null,
      });
    }
    const rows = [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    if (rows.length < RECENT_SIGNAL_WINDOW * 2
      || !isRecentEnough(rows.at(-1).date, options.asOfDate || rows.at(-1).date)) return null;
    if (todayOnly && rows.at(-1).date !== String(options.asOfDate || "").slice(0, 10)) return null;
    const macd = options.buildMacdOscillator({
      dates: rows.map((row) => row.date),
      prices: rows.map((row) => row.close),
    });
    if (!macd) return null;
    const benchmark = new Map((options.benchmarkRows || []).map((row) => [row.date, number(row.close)]));
    const timing = options.buildMarketTimingSignals({
      indexKey: item.ticker,
      dates: macd.dates,
      prices: macd.prices,
      oscillator: macd.normalized,
      benchmarkPrices: macd.dates.map((date) => benchmark.get(date) ?? null),
      volumes: rows.map((row) => row.volume),
      adrRows: options.adrRows || [],
      macroRows: options.macroRows || [],
      creditRows: options.creditRows || [],
      crisisRows: options.crisisRows || [],
      koreanVolatilityRows: options.koreanVolatilityRows || [],
      externalVolatilityRows: options.externalVolatilityRows || [],
      koreanVolatilityPolicy: options.koreanVolatilityPolicy || {},
      externalVolatilityPolicy: options.externalVolatilityPolicy || {},
      ...(behaviorPolicy ? { behaviorPolicy } : {}),
    });
    const dateIndexes = new Map(rows.map((row, index) => [row.date, index]));
    const latestIndex = rows.length - 1;
    const recentSignalStartIndex = Math.max(0, latestIndex - RECENT_SIGNAL_WINDOW + 1);
    const oneMonthSignalStartIndex = Math.max(0, latestIndex - ONE_MONTH_SIGNAL_WINDOW + 1);
    const recentRows = rows.slice(-60);
    const medianTradeValue = percentile(recentRows.map((row) => (
      Number.isFinite(row.volume) ? row.close * row.volume : null
    )), 0.5);
    const volatility = annualizedVolatility(rows);
    const return20 = percentChange(rows, 20);
    const return60 = percentChange(rows, 60);
    const riskyName = /(스팩|우B?$|우선주|레버리지|인버스|ETN|ETF)/i.test(String(item.name || ""));
    if (riskyName
      || !Number.isFinite(medianTradeValue) || medianTradeValue < 500_000_000
      || !Number.isFinite(volatility)
      || !Number.isFinite(return20)) return null;

    const marketRankCeiling = Math.max(1, Number(contract.UNIVERSE_SIZE_HIGH) / 2 || 500);
    const rankQuality = Math.max(0, 1 - (
      (Math.max(1, Number(item.rank) || marketRankCeiling) - 1)
      / Math.max(1, marketRankCeiling - 1)
    ));
    const volatilityQuality = Math.max(0, Math.min(1, (140 - volatility) / 100));
    const baseCandidate = {
      ticker: item.ticker,
      code: item.code || String(item.ticker || "").slice(0, 6),
      name: item.name,
      market: item.market,
      marketRank: Number(item.rank) || null,
      marketCap: number(item.marketCap),
      latestDate: rows.at(-1).date,
      return20Percent: Number(return20.toFixed(1)),
      annualVolatilityPercent: Number(volatility.toFixed(1)),
    };

    if (todayOnly) {
      const latestDate = rows.at(-1).date;
      const occursOnLatestDate = (signal) => (
        String(signal?.date || "").slice(0, 10) === latestDate
      );
      const buyMatches = includeBuy
        ? (timing.signals || []).filter(occursOnLatestDate)
        : [];
      const sellMatches = includeSell
        ? (timing.sellSignals || []).filter(occursOnLatestDate)
        : [];
      if (!buyMatches.length && !sellMatches.length) return null;
      const signalLabels = [
        ...(buyMatches.length ? ["매수"] : []),
        ...(sellMatches.length ? ["매도"] : []),
      ];
      const score = 100 * (
        rankQuality * 0.34
        + volatilityQuality * 0.16
        + 0.5
      );
      return {
        ...baseCandidate,
        signalMode: signalLabels.length > 1 ? "both" : (buyMatches.length ? "buy" : "sell"),
        status: `당일 ${signalLabels.join("·")}`,
        score: Number(score.toFixed(1)),
        signalCount: buyMatches.length + sellMatches.length,
        buyCount: buyMatches.length,
        sellCount: sellMatches.length,
        recentMonthBuyCount: buyMatches.length,
        recentMonthSellCount: sellMatches.length,
        firstBuyDate: buyMatches[0]?.date || null,
        lastBuyDate: buyMatches.at(-1)?.date || null,
        firstBuyConfirmationDate: buyMatches[0]?.confirmationDate || buyMatches[0]?.date || null,
        lastBuyConfirmationDate: buyMatches.at(-1)?.confirmationDate || buyMatches.at(-1)?.date || null,
        firstSellDate: sellMatches[0]?.date || null,
        lastSellDate: sellMatches.at(-1)?.date || null,
        firstSellConfirmationDate: sellMatches[0]?.confirmationDate || sellMatches[0]?.date || null,
        lastSellConfirmationDate: sellMatches.at(-1)?.confirmationDate || sellMatches.at(-1)?.date || null,
        sellDate: sellMatches.at(-1)?.date || null,
        bottomDate: null,
        reboundPercent: null,
        reasons: [
          `${latestDate} ${signalLabels.join("·")}신호`,
          `20일 등락 ${return20.toFixed(1)}%`,
          volatility > 80 ? "고변동 주의" : "변동성 보통",
        ],
      };
    }

    let buyCandidate = null;
    if (includeBuy) {
      const run = buildSignalRuns(timing.signals, timing.sellSignals, dateIndexes).at(-1);
      const recentBuys = (run?.buys || []).filter((signal) => signal.index >= recentSignalStartIndex);
      const recentMonthBuyCount = recentBuys
        .filter((signal) => signal.index >= oneMonthSignalStartIndex).length;
      const buyThresholdMet = collectAllSignals
        ? recentBuys.length >= 1
        : (minimumSignals === 1 ? recentMonthBuyCount >= 1 : recentBuys.length >= minimumSignals);
      if (buyThresholdMet) {
        const firstBuy = recentBuys[0];
        const lastBuy = recentBuys.at(-1);
        const validSell = !run.sell || (run.sell.index > lastBuy.index && run.sell.index >= recentSignalStartIndex);
        if (validSell) {
          const postBuyRows = rows.slice(lastBuy.index);
          const bottom = postBuyRows.reduce((best, row) => (
            row.close < best.close ? row : best
          ), postBuyRows[0]);
          const rebound = ((rows.at(-1).close / bottom.close) - 1) * 100;
          const oscillatorNow = number(macd.normalized.at(-1));
          const oscillator20 = number(macd.normalized.at(-ONE_MONTH_SIGNAL_WINDOW));
          const oscillatorImprovement = oscillatorNow !== null && oscillator20 !== null
            ? oscillatorNow - oscillator20
            : null;
          const stabilization = rebound >= 2
            && return20 >= -8
            && (oscillatorNow >= -50 || oscillatorImprovement >= 7);
          const recency = Math.max(0, 1 - ((latestIndex - lastBuy.index) / RECENT_SIGNAL_WINDOW));
          const signalDepth = Math.max(0, Math.min(1, (recentBuys.length - 2) / 6));
          const recoveryQuality = Math.max(0, 1 - Math.abs(rebound - 15) / 40);
          const trendQuality = Math.max(0, Math.min(1, (return20 + 8) / 24));
          const score = 100 * (
            recency * 0.27
            + rankQuality * 0.18
            + signalDepth * 0.2
            + recoveryQuality * 0.1
            + trendQuality * 0.09
            + (run.sell ? 1 : 0.6) * 0.1
            + volatilityQuality * 0.06
          );
          buyCandidate = {
            ...baseCandidate,
            signalMode: "buy",
            status: run.sell ? "반전 확인" : (stabilization ? "바닥 점검" : "매수 누적"),
            score: Number(score.toFixed(1)),
            signalCount: recentBuys.length,
            buyCount: recentBuys.length,
            sellCount: run.sell ? 1 : 0,
            recentMonthBuyCount,
            recentMonthSellCount: run.sell?.index >= oneMonthSignalStartIndex ? 1 : 0,
            firstBuyDate: firstBuy.date,
            lastBuyDate: lastBuy.date,
            firstBuyConfirmationDate: firstBuy.confirmationDate || firstBuy.date,
            lastBuyConfirmationDate: lastBuy.confirmationDate || lastBuy.date,
            firstSellDate: run.sell?.date || null,
            lastSellDate: run.sell?.date || null,
            firstSellConfirmationDate: run.sell?.confirmationDate || run.sell?.date || null,
            lastSellConfirmationDate: run.sell?.confirmationDate || run.sell?.date || null,
            sellDate: run.sell?.date || null,
            bottomDate: bottom.date,
            reboundPercent: Number(rebound.toFixed(1)),
            reasons: [
              `매수 ${recentBuys.length}회 연속`,
              run.sell
                ? `매도 전환 ${run.sell.date}`
                : (stabilization ? "최근 저점 안정화 관찰" : "반전 확인 전"),
              `저점 대비 ${rebound.toFixed(1)}%`,
              volatility > 80 ? "고변동 주의" : "변동성 보통",
            ],
          };
        }
      }
    }

    let sellCandidate = null;
    if (includeSell) {
      const run = buildDirectionalSignalRuns(timing.sellSignals, timing.signals, dateIndexes).at(-1);
      const recentSells = (run?.signals || []).filter((signal) => signal.index >= recentSignalStartIndex);
      const recentMonthSellCount = recentSells
        .filter((signal) => signal.index >= oneMonthSignalStartIndex).length;
      const lastSell = recentSells.at(-1);
      const sellThresholdMet = collectAllSignals
        ? recentSells.length >= 1
        : (minimumSignals === 1 ? recentMonthSellCount >= 1 : recentSells.length >= minimumSignals);
      if (sellThresholdMet && lastSell) {
        const recency = Math.max(0, 1 - ((latestIndex - lastSell.index) / RECENT_SIGNAL_WINDOW));
        const signalDepth = Math.max(0, Math.min(1, (recentSells.length - 2) / 6));
        const trendHeat = Math.max(0, Math.min(1, (return20 + 5) / 30));
        const score = 100 * (
          recency * 0.38
          + rankQuality * 0.22
          + signalDepth * 0.2
          + trendHeat * 0.12
          + volatilityQuality * 0.08
        );
        sellCandidate = {
          ...baseCandidate,
          signalMode: "sell",
          status: "매도 누적",
          score: Number(score.toFixed(1)),
          signalCount: recentSells.length,
          buyCount: 0,
          sellCount: recentSells.length,
          recentMonthBuyCount: 0,
          recentMonthSellCount,
          firstBuyDate: null,
          lastBuyDate: null,
          firstBuyConfirmationDate: null,
          lastBuyConfirmationDate: null,
          firstSellDate: recentSells[0].date,
          lastSellDate: lastSell.date,
          firstSellConfirmationDate: recentSells[0].confirmationDate || recentSells[0].date,
          lastSellConfirmationDate: lastSell.confirmationDate || lastSell.date,
          sellDate: lastSell.date,
          bottomDate: null,
          reboundPercent: null,
          reasons: [
            `매도 ${recentSells.length}회 연속`,
            `마지막 매도 ${lastSell.date}`,
            `20일 등락 ${return20.toFixed(1)}%`,
            volatility > 80 ? "고변동 주의" : "변동성 보통",
          ],
        };
      }
    }

    if (!buyCandidate) return sellCandidate;
    if (!sellCandidate) return buyCandidate;
    return {
      ...buyCandidate,
      signalMode: "both",
      status: "매수·매도 누적",
      score: Math.max(buyCandidate.score, sellCandidate.score),
      signalCount: buyCandidate.buyCount + sellCandidate.sellCount,
      sellCount: sellCandidate.sellCount,
      recentMonthSellCount: sellCandidate.recentMonthSellCount,
      firstSellDate: sellCandidate.firstSellDate,
      lastSellDate: sellCandidate.lastSellDate,
      firstSellConfirmationDate: sellCandidate.firstSellConfirmationDate,
      lastSellConfirmationDate: sellCandidate.lastSellConfirmationDate,
      sellDate: sellCandidate.sellDate,
      reasons: [...new Set([...buyCandidate.reasons, ...sellCandidate.reasons])],
    };
  }

  function rankCandidates(candidates, limit = 10) {
    return (candidates || []).filter(Boolean)
      .sort((left, right) => right.score - left.score
        || left.marketRank - right.marketRank
        || left.ticker.localeCompare(right.ticker))
      .slice(0, Math.max(1, Number(limit) || 10));
  }

  globalScope.ThinkStockStockResearch = Object.freeze({
    CALCULATION_VERSION,
    STRATEGY_VERSION,
    RECENT_SIGNAL_WINDOW,
    ONE_MONTH_SIGNAL_WINDOW,
    annualizedVolatility,
    assessTicker,
    buildDirectionalSignalRuns,
    buildSignalRuns,
    isRecentEnough,
    percentile,
    rankCandidates,
  });
}(typeof self !== "undefined" ? self : globalThis));
