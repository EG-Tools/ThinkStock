import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import macdOscillator from "../../docs/modules/macd-oscillator.mjs";
import marketTiming from "../../docs/modules/market-timing.mjs";

const {
  DEFAULT_KOREAN_VOLATILITY_POLICY,
  PROMOTED_RUNTIME_BEHAVIOR_POLICY,
  VOLATILITY_MAX_HISTORY_DAYS,
  alignedSource,
  alignAsOf,
  buildExternalVolatilityTimingRows,
  buildMarketTimingSignals,
  buildVolatilityProfile,
  calibrateTimingSignals,
  classifyBehaviorProfile,
  classifyTimingRegime,
  decorateTimingSignal,
  pricePathEfficiency,
  timingCalibrationObjective,
} = marketTiming;
const { buildMacdOscillator } = macdOscillator;

function dateAt(index) {
  return new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
}

test("runtime policy promotes the validated buy path without replacing sell signals", () => {
  assert.deepEqual(PROMOTED_RUNTIME_BEHAVIOR_POLICY, {
    enabled: true,
    buyEnabled: true,
    sellEnabled: false,
  });
});

function timingFixture({ oversold = true } = {}) {
  const dates = Array.from({ length: 130 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 65) return 100;
    if (index <= 78) return 100 - ((index - 64) * 2);
    return 72 + ((index - 78) * 1.2);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 75) return -0.6;
    if (index === 75) return -0.8;
    if (index === 76) return -0.7;
    if (index === 77) return -0.5;
    if (index === 78) return -0.25;
    return Math.min(0.5, -0.1 + ((index - 79) * 0.05));
  });
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: oversold && index >= 68 && index <= 82 ? 74 + Math.max(0, index - 76) * 2 : 100,
    fear_greed: oversold && index >= 68 && index <= 82 ? 19 + Math.max(0, index - 76) * 1.5 : 50,
  }));
  const macroRows = dates.map((_, index) => ({
    date: dateAt(index - 60),
    leading_cycle: 98 + (index * 0.02),
  }));
  return { dates, prices, oscillator, adrRows, macroRows };
}

test("as-of alignment never uses a future observation", () => {
  assert.deepEqual(
    alignAsOf([dateAt(0), dateAt(1), dateAt(2)], [{ date: dateAt(1), value: 42 }], 7),
    [null, 42, 42],
  );
});

test("provider-specific availability lag is explicit and never reads ahead", () => {
  const dates = [dateAt(0), dateAt(1), dateAt(2), dateAt(3)];
  assert.deepEqual(alignedSource(
    dates,
    [{ date: dateAt(0), value: 42 }],
    "value",
    7,
    2,
  ), [null, null, 42, 42]);
});

test("timing regimes and evidence grades remain descriptive rather than probabilistic", () => {
  assert.equal(classifyTimingRegime({
    adrMin: 72,
    fearMin: 20,
    crisis: 20,
    vkospiPercentile: 0.4,
    vixPercentile: 0.4,
  }), "stress");
  assert.equal(classifyTimingRegime({
    adrMin: 95,
    fearMin: 50,
    crisis: 10,
    vkospiPercentile: 0.4,
    vixPercentile: 0.4,
    leadingChange: -0.2,
    price20d: 5,
  }), "slowdown");
  const signal = decorateTimingSignal({
    entryMode: "turning-point",
    setupReasons: ["가격 조정", "ADR 과매도"],
    triggerReasons: ["MACD 반전"],
  });
  assert.equal(signal.evidenceCount, 3);
  assert.equal(signal.signalGrade, "보통");
  assert.equal(signal.signalRole, "predictive");
  assert.equal(decorateTimingSignal({ entryMode: "extreme-daily" }).signalRole, "warning");
  assert.deepEqual(DEFAULT_KOREAN_VOLATILITY_POLICY, {
    buyPercentile: 0.85,
    sellPercentile: 0.2,
    sellChange5: 8,
    sellRebound20: 10,
  });
});

test("delays the US VIX close by one day in Korean timing signals", () => {
  const fixture = timingFixture();
  const vixRows = fixture.dates.map((date, index) => ({ date, vix: 12 + (index * 0.1) }));
  const externalVolatilityRows = buildExternalVolatilityTimingRows(vixRows);
  const model = buildMarketTimingSignals({
    indexKey: "^KS11",
    ...fixture,
    externalVolatilityRows,
  });
  const signal = model.signals[0];
  const confirmationIndex = fixture.dates.indexOf(signal.confirmationDate);

  assert.ok(confirmationIndex > 0);
  assert.equal(signal.vix, vixRows[confirmationIndex - 1].vix);

  const changedSameDayRows = vixRows.map((row, index) => (
    index === confirmationIndex ? { ...row, vix: 99 } : row
  ));
  const sameDayModel = buildMarketTimingSignals({
    indexKey: "^KS11",
    ...fixture,
    externalVolatilityRows: buildExternalVolatilityTimingRows(changedSameDayRows),
  });
  assert.equal(sameDayModel.signals[0].vix, signal.vix);
});

test("classifies stock volatility from available history with a 15-year cap", () => {
  const buildPrices = (length, dailyMove) => {
    let price = 100;
    return Array.from({ length }, (_, index) => {
      if (index) price *= Math.exp(index % 2 ? dailyMove : -dailyMove);
      return price;
    });
  };
  const shortLowVolatility = buildVolatilityProfile(buildPrices(756, 0.004));
  const shortHighVolatility = buildVolatilityProfile(buildPrices(756, 0.03));
  const longHistory = buildVolatilityProfile(buildPrices(5000, 0.01));

  assert.equal(shortLowVolatility.historyDays.at(-1), 755);
  assert.equal(longHistory.historyDays.at(-1), VOLATILITY_MAX_HISTORY_DAYS);
  assert.ok(shortLowVolatility.scale.at(-1) < 0.9);
  assert.ok(shortHighVolatility.scale.at(-1) > 1.2);
  assert.ok(shortLowVolatility.scale.at(-1) < shortHighVolatility.scale.at(-1));
});

test("classifies point-in-time stock behavior without relying on sector labels", () => {
  const rangeProfile = classifyBehaviorProfile({
    volatilityHistoryDays: 756,
    volatilityScale: 0.7,
    marketCorrelation60: 0.2,
    marketBeta60: 0.3,
    marketDownsideBeta60: 0.2,
    trendEfficiency60: 0.1,
    trendEfficiency120: 0.1,
    longTermVolatility: 18,
    price20d: -1,
    price60d: 2,
    price120d: 1,
    price252d: 3,
    price756d: 8,
    price1260d: 10,
    rangePosition120: 0.5,
  }, { isIndividualStock: true });
  const momentumProfile = classifyBehaviorProfile({
    volatilityHistoryDays: 756,
    volatilityScale: 1.5,
    marketCorrelation60: 0.8,
    marketBeta60: 1.3,
    marketDownsideBeta60: 1.5,
    trendEfficiency60: 0.75,
    trendEfficiency120: 0.8,
    price60d: 45,
    price120d: 90,
    rangePosition120: 0.95,
  }, { isIndividualStock: true });

  assert.equal(rangeProfile.dominant, "lowVolRange");
  assert.equal(momentumProfile.dominant, "highVolMomentum");
  assert.ok(rangeProfile.scores.defensive > momentumProfile.scores.defensive);
  assert.equal(rangeProfile.version, "timing-behavior-v2");
  assert.equal(rangeProfile.structural.trendDirection, "range");
  assert.equal(rangeProfile.structural.horizonDays, 1260);
  assert.equal(rangeProfile.structural.directionConsistency, 1);
  assert.equal(rangeProfile.state.return20, -1);
});

test("structural behavior combines only the available one, three, and five-year history", () => {
  const profile = classifyBehaviorProfile({
    volatilityHistoryDays: 1500,
    volatilityScale: 1,
    longTermVolatility: 30,
    marketCorrelation60: 0.5,
    marketBeta60: 1,
    marketDownsideBeta60: 1,
    trendEfficiency60: 0.4,
    trendEfficiency120: 0.4,
    price60d: 3,
    price120d: 5,
    price252d: 40,
    price756d: -10,
    price1260d: -20,
    rangePosition120: 0.6,
  }, { isIndividualStock: true });

  assert.equal(profile.structural.trendDirection, "up");
  assert.equal(profile.structural.return1y, 40);
  assert.equal(profile.structural.return3y, -10);
  assert.equal(profile.structural.return5y, -20);
  assert.equal(profile.structural.horizonDays, 1260);
  assert.ok(profile.structural.directionConsistency < 0.5);
});

test("behavior features stay unchanged when future prices are appended", () => {
  const past = Array.from({ length: 140 }, (_, index) => 100 + Math.sin(index / 8) * 4 + (index * 0.05));
  const pastEfficiency = pricePathEfficiency(past, 139, 120);
  const future = [...past, 500, 20, 700];
  assert.equal(pricePathEfficiency(future, 139, 120), pastEfficiency);
});

test("point-in-time calibration abstains only after earlier comparable failures mature", () => {
  const dates = Array.from({ length: 100 }, (_, index) => dateAt(index));
  const prices = Array.from({ length: 100 }, (_, index) => 100 - (index * 0.2));
  const profile = { dominant: "lowVolRange" };
  const signals = [10, 25, 40, 55, 80].map((index) => ({
    date: dates[index],
    confirmationDate: dates[index],
    signalFamily: "range-floor-reversal",
    behaviorProfile: profile,
  }));
  const calibrated = calibrateTimingSignals(signals, "buy", dates, prices, {
    horizon: 5,
    minimumSamples: 4,
    rejectHitRate: 0.42,
  });

  assert.equal(calibrated.abstained, 1);
  assert.equal(calibrated.signals.length, 4);
  assert.equal(calibrated.signals.at(-1).calibration.samples, 3);
  assert.equal(calibrated.signals[0].calibration.pointInTime, true);
});

test("strong buy evidence survives only a mixed-family fallback calibration veto", () => {
  const dates = Array.from({ length: 110 }, (_, index) => dateAt(index));
  const prices = Array.from({ length: 110 }, (_, index) => 100 - (index * 0.25));
  const profile = { dominant: "indexIndependent" };
  const signals = [10, 20, 30, 40, 50, 60].map((index, order) => ({
    date: dates[index],
    confirmationDate: dates[index],
    signalFamily: `fallback-family-${order}`,
    behaviorProfile: profile,
  }));
  signals.push({
    date: dates[80],
    confirmationDate: dates[80],
    signalFamily: "trend-pullback",
    behaviorProfile: profile,
    evidenceCount: 7,
  });

  const calibrated = calibrateTimingSignals(signals, "buy", dates, prices, {
    horizon: 5,
    minimumSamples: 4,
    rejectHitRate: 0.42,
  });
  const strongSignal = calibrated.signals.find((signal) => signal.date === dates[80]);

  assert.ok(strongSignal);
  assert.equal(strongSignal.calibration.cohort, "behavior");
  assert.equal(strongSignal.calibration.status, "evidence-override");
});

test("warning outcomes never calibrate predictive timing signals", () => {
  const dates = Array.from({ length: 80 }, (_, index) => dateAt(index));
  const prices = Array.from({ length: 80 }, (_, index) => 100 - (index * 0.3));
  const warnings = [10, 20, 30, 40].map((index) => ({
    date: dates[index],
    confirmationDate: dates[index],
    entryMode: "extreme-daily",
    signalFamily: "shock-reversal",
    signalRole: "warning",
    behaviorProfile: { dominant: "highVolMomentum" },
  }));
  const predictive = {
    date: dates[60],
    confirmationDate: dates[60],
    signalFamily: "trend-pullback",
    signalRole: "predictive",
    behaviorProfile: { dominant: "highVolMomentum" },
  };
  const calibrated = calibrateTimingSignals([...warnings, predictive], "buy", dates, prices, {
    horizon: 5,
    minimumSamples: 4,
  });

  assert.equal(calibrated.signals.at(-1).calibration.samples, 0);
  assert.equal(calibrated.signals.at(-1).calibration.role, "predictive");
});

test("high-volatility downtrend reversals calibrate against tradable rebounds", () => {
  const dates = Array.from({ length: 130 }, (_, index) => dateAt(index));
  const prices = Array.from({ length: 130 }, () => 100);
  const signalIndexes = [10, 30, 50, 70, 100];
  signalIndexes.forEach((index) => {
    prices[index + 1] = 108;
    prices[index + 5] = 99;
  });
  const profile = {
    dominant: "highVolMomentum",
    scores: { trendDown: 0.8, trendUp: 0.1 },
  };
  const signals = signalIndexes.map((index) => ({
    date: dates[index],
    confirmationDate: dates[index],
    signalFamily: "correction-reversal",
    behaviorProfile: profile,
    volatilityScale: 1.4,
    price120d: -35,
  }));
  const calibrated = calibrateTimingSignals(signals, "buy", dates, prices, {
    horizon: 5,
    minimumSamples: 4,
    rejectHitRate: 0.42,
  });

  assert.equal(timingCalibrationObjective(signals[0], "buy"), "rebound");
  assert.equal(calibrated.abstained, 0);
  assert.equal(calibrated.signals.length, signals.length);
  assert.equal(calibrated.signals.at(-1).calibration.objective, "rebound");
  assert.ok(calibrated.signals.at(-1).calibration.meanFavorableReturn >= 8);
});

test("low-volatility range signals keep terminal-return calibration", () => {
  const signal = {
    signalFamily: "range-floor-reversal",
    behaviorProfile: { dominant: "lowVolRange", scores: { trendDown: 0.8 } },
    price120d: -35,
  };
  assert.equal(timingCalibrationObjective(signal, "buy"), "terminal");
  assert.equal(timingCalibrationObjective(signal, "sell"), "terminal");
});

test("calibration decisions for an earlier signal never depend on appended future prices", () => {
  const fullDates = Array.from({ length: 130 }, (_, index) => dateAt(index));
  const fullPrices = Array.from({ length: 130 }, (_, index) => 100 - (index * 0.05));
  const signalIndexes = [10, 30, 50, 70, 90];
  const signals = signalIndexes.map((index) => ({
    date: fullDates[index],
    confirmationDate: fullDates[index],
    signalFamily: "range-floor-reversal",
    behaviorProfile: { dominant: "lowVolRange" },
  }));
  const before = calibrateTimingSignals(signals.slice(0, 4), "buy", fullDates.slice(0, 100), fullPrices.slice(0, 100), {
    horizon: 5,
    minimumSamples: 4,
  });
  const after = calibrateTimingSignals(signals, "buy", fullDates, [
    ...fullPrices.slice(0, 100),
    ...Array.from({ length: 30 }, (_, index) => index % 2 ? 1000 : 10),
  ], {
    horizon: 5,
    minimumSamples: 4,
  });

  assert.deepEqual(
    before.signals.map((signal) => [signal.date, signal.calibration.status]),
    after.signals.filter((signal) => signal.date <= fullDates[70])
      .map((signal) => [signal.date, signal.calibration.status]),
  );
});

test("adaptive behavior policy annotates exceptional stock signals", () => {
  const dates = Array.from({ length: 150 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => 100 + (index * 0.08));
  prices[149] = prices[148] * 1.3;
  const model = buildMarketTimingSignals({
    indexKey: "005930.KS",
    dates,
    prices,
    oscillator: dates.map(() => 0.6),
    benchmarkPrices: dates.map((_, index) => 100 + (index * 0.04)),
    behaviorPolicy: { enabled: true },
  });

  assert.equal(model.strategy, "adaptive-behavior-v19");
  assert.equal(model.sellSignals.at(-1).signalFamily, "blowoff-exhaustion");
  assert.notEqual(model.sellSignals.at(-1).behaviorProfile.dominant, "insufficient-history");
});

test("adaptive behavior policy can promote buy and sell paths independently", () => {
  const dates = Array.from({ length: 150 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => 100 + (index * 0.08));
  prices[149] = prices[148] * 1.3;
  const shared = {
    indexKey: "005930.KS",
    dates,
    prices,
    oscillator: dates.map(() => 0.6),
    benchmarkPrices: dates.map((_, index) => 100 + (index * 0.04)),
  };
  const buyOnly = buildMarketTimingSignals({
    ...shared,
    behaviorPolicy: { enabled: true, buyEnabled: true, sellEnabled: false },
  });
  const sellOnly = buildMarketTimingSignals({
    ...shared,
    behaviorPolicy: { enabled: true, buyEnabled: false, sellEnabled: true },
  });

  assert.equal(buyOnly.strategy, "adaptive-behavior-v19-buy");
  assert.equal(sellOnly.strategy, "adaptive-behavior-v19-sell");
  assert.equal(buyOnly.behaviorPolicy.sellEnabled, false);
  assert.equal(sellOnly.behaviorPolicy.buyEnabled, false);
  assert.equal(buyOnly.calibration.sellAbstained, 0);
  assert.equal(sellOnly.calibration.buyAbstained, 0);
});

test("sell calibration can be evaluated without discovering new behavior sell families", () => {
  const dates = Array.from({ length: 220 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => 100 + Math.sin(index / 11) * 8 + index * 0.04);
  const model = buildMarketTimingSignals({
    indexKey: "005930.KS",
    dates,
    prices,
    oscillator: dates.map((_, index) => Math.sin(index / 9)),
    benchmarkPrices: dates.map((_, index) => 100 + index * 0.03),
    behaviorPolicy: {
      enabled: true,
      buyEnabled: false,
      sellEnabled: true,
      sellDiscoveryEnabled: false,
    },
  });

  assert.equal(model.strategy, "adaptive-behavior-v19-sell-calibration");
  assert.equal(model.behaviorPolicy.sellEnabled, true);
  assert.equal(model.behaviorPolicy.sellDiscoveryEnabled, false);
});

test("emits one high-confidence buy signal after an oversold reversal", () => {
  const model = buildMarketTimingSignals({ indexKey: "^KS11", ...timingFixture() });

  assert.equal(model.strategy, "episode-extreme-v13");
  assert.equal(model.signals.length, 1);
  assert.ok(model.signals[0].setupReasons.length > 0);
  assert.ok(model.signals[0].stabilizationReasons.length > 0);
  assert.deepEqual(model.signals[0].triggerReasons, ["MACD 상승 다이버전스"]);
  assert.ok(model.signals[0].score >= 2);
  assert.ok(model.signals[0].confirmationDate >= model.signals[0].date);
});

test("does not emit a buy signal without prior oversold conditions", () => {
  const model = buildMarketTimingSignals({ indexKey: "^KS11", ...timingFixture({ oversold: false }) });
  assert.deepEqual(model.signals, []);
});

test("routes KOSDAQ stock timing through KOSDAQ breadth and thresholds", () => {
  const fixture = timingFixture();
  fixture.adrRows = fixture.adrRows.map((row) => ({
    ...row,
    adr_kosdaq: row.adr_kospi,
    adr_kospi: 100,
  }));

  const kosdaqStock = buildMarketTimingSignals({ indexKey: "218410.KQ", ...fixture });
  const kospiStock = buildMarketTimingSignals({ indexKey: "005930.KS", ...fixture });

  assert.equal(kosdaqStock.signals.length, 1);
  assert.ok(kosdaqStock.signals[0].setupReasons.includes("ADR 과매도"));
  assert.equal(kosdaqStock.signals[0].adrMin < 80, true);
  assert.equal(kospiStock.signals.length, 1);
  assert.equal(kospiStock.signals[0].adrMin, 100);
  assert.equal(kospiStock.signals[0].setupReasons.includes("ADR 과매도"), false);
});

test("detects a medium stock correction below the market capitulation limit", () => {
  const dates = Array.from({ length: 230 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 150) return 100;
    if (index <= 180) return 100 - ((index - 150) * 0.32);
    if (index <= 190) return 90.4 - ((index - 180) * 0.74);
    return 83 + ((index - 190) * 0.55);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 188) return -0.4;
    if (index === 188) return -0.7;
    if (index === 189) return -0.82;
    if (index === 190) return -0.9;
    return -0.68 + ((index - 191) * 0.12);
  });
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: index >= 175 && index <= 200 ? 72 : 100,
  }));
  const model = buildMarketTimingSignals({
    indexKey: "207940.KS",
    dates,
    prices,
    oscillator,
    adrRows,
  });

  assert.equal(model.signals.length, 1);
  assert.ok(model.signals[0].setupReasons.includes("\uAC1C\uBCC4\uC885\uBAA9 \uC911\uAE30 \uC870\uC815"));
  assert.ok(model.signals[0].price20d > -12);
  assert.ok(model.signals[0].confirmationDate >= model.signals[0].date);

  const noBreadthStress = buildMarketTimingSignals({
    indexKey: "207940.KS",
    dates,
    prices,
    oscillator,
    adrRows: dates.map((date) => ({ date, adr_kospi: 100 })),
  });
  assert.deepEqual(noBreadthStress.signals, []);
});

test("detects a slow stock base only after its MACD turns upward", () => {
  const dates = Array.from({ length: 250 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 155) return 102;
    if (index <= 170) return 102 + ((index - 155) * (8 / 15));
    if (index <= 220) return 110 - ((index - 170) * (17 / 50));
    return 93 + ((index - 220) * 0.45);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 217) return -0.35;
    if (index === 217) return -0.55;
    if (index === 218) return -0.7;
    if (index === 219) return -0.78;
    if (index === 220) return -0.8;
    return -0.6 + ((index - 221) * 0.12);
  });
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: index >= 205 && index <= 230 ? 84 : 100,
  }));
  const model = buildMarketTimingSignals({
    indexKey: "207940.KS",
    dates,
    prices,
    oscillator,
    adrRows,
  });

  assert.equal(model.signals.length, 1);
  assert.ok(model.signals[0].setupReasons.includes("\uAC1C\uBCC4\uC885\uBAA9 \uC911\uAE30 \uC870\uC815"));
  assert.ok(model.signals[0].price60d > -20);
  assert.ok(model.signals[0].confirmationDate > model.signals[0].date);
});

test("detects a low-beta stock washout relative to a rising market", () => {
  const dates = Array.from({ length: 260 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 210) return 100 + (Math.sin(index / 5) * 0.5);
    if (index <= 230) return 100 - ((index - 210) * 0.3);
    return 94 + ((index - 230) * 0.45);
  });
  const benchmarkPrices = dates.map((_, index) => (
    index < 210 ? 100 + (Math.cos(index / 4) * 0.7) : 100 + ((index - 210) * 0.65)
  ));
  const oscillator = dates.map((_, index) => {
    if (index < 228) return -0.3;
    if (index === 228) return -0.55;
    if (index === 229) return -0.7;
    if (index === 230) return -0.78;
    return -0.58 + ((index - 231) * 0.12);
  });
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: index >= 215 && index <= 240 ? 70 : 100,
  }));
  const model = buildMarketTimingSignals({
    indexKey: "017670.KS",
    dates,
    prices,
    oscillator,
    benchmarkPrices,
    adrRows,
  });

  assert.equal(model.signals.length, 1);
  assert.equal(model.signals[0].entryMode, "confirmation");
  assert.ok(model.signals[0].setupReasons.includes("\uC800\uBCA0\uD0C0 \uC0C1\uB300 \uACFC\uB9E4\uB3C4"));
  assert.ok(model.signals[0].relative20d <= -10);

  const noRelativeWashout = buildMarketTimingSignals({
    indexKey: "017670.KS",
    dates,
    prices,
    oscillator,
    benchmarkPrices: [...prices],
    adrRows,
  });
  assert.deepEqual(noRelativeWashout.signals, []);
});

test("rejects a buy signal when the index remains near its recent high", () => {
  const fixture = timingFixture();
  fixture.prices = fixture.prices.map((_, index) => 100 + (index * 0.08));
  const model = buildMarketTimingSignals({ indexKey: "^KS11", ...fixture });
  assert.deepEqual(model.signals, []);
});

test("turns exceptional credit growth near a market high into one sell signal", () => {
  const dates = Array.from({ length: 360 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index <= 309) return 100 + (index * 0.12);
    if (index <= 329) return 137.08 + ((index - 309) * 2);
    return 177.08 - ((index - 329) * 1.2);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 326) return 0.25;
    if (index <= 329) return 0.25 + ((index - 325) * 0.08);
    return 0.57 - ((index - 329) * 0.09);
  });
  const creditRows = dates.map((date, index) => ({
    date,
    kospi_credit: index < 285 ? 100 : 100 * Math.exp(0.0004 * ((index - 284) ** 2)),
  }));
  const adrRows = dates.map((date) => ({ date, adr_kospi: 125, fear_greed: 80 }));
  const macroRows = dates.map((_, index) => ({
    date: dateAt(index - 60),
    leading_cycle: 108 - (index * 0.02),
  }));
  const model = buildMarketTimingSignals({
    indexKey: "^KS11",
    dates,
    prices,
    oscillator,
    creditRows,
    adrRows,
    macroRows,
  });

  assert.equal(model.signals.length, 0);
  assert.equal(model.sellSignals.length, 1);
  assert.equal(model.sellSignals[0].date, dates[329]);
  assert.equal(model.sellSignals[0].confirmationDate, dates[330]);
  assert.ok(model.sellSignals[0].creditChange >= 8);
  assert.ok(model.sellSignals[0].sellSetupReasons.includes("신용 과열"));
  assert.ok(model.sellSignals[0].sellDeteriorationReasons.includes("고점 갱신 후 탄력 둔화"));
  assert.deepEqual(model.sellSignals[0].sellTriggerReasons, [
    "MACD 상승 탄력 반전",
    "신용 과열 속 고점 정체",
  ]);
});

test("applies one volatility-adjusted sell formula to KOSPI and KOSDAQ", () => {
  const dates = Array.from({ length: 360 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 300) return 100 + (index * 0.03);
    if (index <= 329) return 109 + ((index - 299) * 0.55);
    return 125.5 - ((index - 329) * 0.8);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 326) return 0.45;
    if (index <= 329) return 0.45 + ((index - 325) * 0.08);
    return 0.77 - ((index - 329) * 0.12);
  });
  const creditRows = dates.map((date, index) => {
    const credit = index < 290 ? 100 : 100 * Math.exp(0.00025 * ((index - 289) ** 2));
    return { date, kospi_credit: credit, kosdaq_credit: credit };
  });
  const adrRows = dates.map((date) => ({
    date,
    adr_kospi: 122,
    adr_kosdaq: 122,
    fear_greed: 78,
  }));
  const common = { dates, prices, oscillator, creditRows, adrRows };
  const kospi = buildMarketTimingSignals({ indexKey: "^KS11", ...common });
  const kosdaq = buildMarketTimingSignals({ indexKey: "^KQ11", ...common });

  assert.equal(kospi.sellSignals.length, 1);
  assert.equal(kosdaq.sellSignals.length, 1);
  assert.equal(kospi.sellSignals[0].date, kosdaq.sellSignals[0].date);
  assert.equal(kospi.sellSignals[0].confirmationDate, kosdaq.sellSignals[0].confirmationDate);
  assert.ok(kospi.sellSignals[0].price20d < 20);
  assert.ok(kosdaq.sellSignals[0].sellSetupReasons.includes("변동성 대비 급등"));
});

test("detects a gradual stock distribution top after a volatility-adjusted advance", () => {
  const dates = Array.from({ length: 300 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 250) return 100;
    if (index <= 270) return 100 + ((index - 250) * 1.5);
    return 130 - ((index - 270) * 1.1);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 266) return 0.3;
    if (index <= 270) return 0.3 + ((index - 265) * 0.12);
    return 0.9 - ((index - 270) * 0.13);
  });
  const model = buildMarketTimingSignals({
    indexKey: "008770.KS",
    dates,
    prices,
    oscillator,
  });

  assert.equal(model.sellSignals.length, 1);
  assert.equal(model.sellSignals[0].date, dates[270]);
  assert.ok(model.sellSignals[0].confirmationDate <= dates[278]);
  assert.ok(model.sellSignals[0].sellSetupReasons.includes("개별종목 분배형 과열"));
  assert.ok(model.sellSignals[0].sellTriggerReasons.includes("분배형 고점 이탈"));
});

test("confirms a mature stock top after a slower medium-term rollover", () => {
  const dates = Array.from({ length: 320 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 250) return 100;
    if (index <= 290) return 100 + ((index - 250) * 0.6);
    return 124 - ((index - 290) * 0.55);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 286) return 0.45;
    if (index <= 290) return 0.45 + ((index - 285) * 0.08);
    return 0.85 - ((index - 290) * 0.07);
  });
  const model = buildMarketTimingSignals({
    indexKey: "207940.KS",
    dates,
    prices,
    oscillator,
  });

  assert.equal(model.sellSignals.length, 1);
  assert.equal(model.sellSignals[0].date, dates[290]);
  assert.ok(model.sellSignals[0].confirmationDate <= dates[310]);
  assert.ok(model.sellSignals[0].sellSetupReasons.includes("개별종목 중기 고점 둔화"));
});

test("starts a new stock sell episode after exceptional reacceleration", () => {
  const dates = Array.from({ length: 340 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 250) return 100 + (Math.sin(index / 5) * 0.4);
    if (index <= 270) return 100 + ((index - 250) * 1.25);
    if (index <= 278) return 125 - ((index - 270) * 1.25);
    if (index <= 292) return 115 + ((index - 278) * 2.5);
    return 150 - ((index - 292) * 3.5);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 266) return 0.35;
    if (index <= 270) return 0.35 + ((index - 265) * 0.12);
    if (index <= 278) return 0.95 - ((index - 270) * 0.16);
    if (index <= 292) return -0.33 + ((index - 278) * 0.095);
    return 1 - ((index - 292) * 0.24);
  });
  const volumes = dates.map((_, index) => (
    index === 270 || index === 292 ? 3000 : 1000
  ));
  const creditRows = dates.map((date, index) => ({
    date,
    kospi_credit: index < 265 ? 100 : 100 * Math.exp((index - 265) * 0.01),
  }));
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: index >= 280 ? 55 : 100,
  }));
  const model = buildMarketTimingSignals({
    indexKey: "017670.KS",
    dates,
    prices,
    oscillator,
    volumes,
    creditRows,
    adrRows,
  });

  assert.equal(model.sellSignals.length, 2);
  assert.equal(model.sellSignals[0].date, dates[270]);
  assert.equal(model.sellSignals[1].date, dates[292]);
  assert.ok(model.sellSignals[1].confirmationDate > model.sellSignals[1].date);
});

test("detects a short refuge-flow top while the broad market is fearful", () => {
  const dates = Array.from({ length: 300 }, (_, index) => dateAt(index));
  const benchmarkPrices = dates.map((_, index) => {
    if (index < 250) return 100 + Math.sin(index / 4) * 0.4;
    return 100 - ((index - 250) * 0.5);
  });
  const prices = dates.map((_, index) => {
    if (index < 250) return 100 + Math.cos(index / 3) * 0.5;
    if (index <= 270) return 100 + ((index - 250) * 0.75);
    return 115 - ((index - 270) * 0.8);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 265) return 0.3;
    if (index <= 270) return 0.3 + ((index - 265) * 0.1);
    return 0.8 - ((index - 270) * 0.12);
  });
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: index >= 250 ? 72 : 100,
    fear_greed: index >= 250 ? 24 : 50,
  }));
  const model = buildMarketTimingSignals({
    indexKey: "207940.KS",
    dates,
    prices,
    oscillator,
    benchmarkPrices,
    adrRows,
  });

  assert.equal(model.sellSignals.length, 1);
  assert.equal(model.sellSignals[0].date, dates[270]);
  assert.ok(model.sellSignals[0].confirmationDate <= dates[278]);
  assert.ok(model.sellSignals[0].sellSetupReasons.includes("공포 피난자금 단기 과열"));
  assert.ok(model.sellSignals[0].relative20d >= 9);
});

test("uses a hidden volume climax as supporting evidence for a stock top", () => {
  const dates = Array.from({ length: 300 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 250) return 100 + Math.sin(index / 5) * 0.4;
    if (index <= 270) return 100 + ((index - 250) * 0.65);
    return 113 - ((index - 270) * 0.75);
  });
  const oscillator = dates.map((_, index) => (
    index <= 270 ? 0.45 + Math.max(0, index - 260) * 0.04 : 0.85 - ((index - 270) * 0.12)
  ));
  const volumes = dates.map((_, index) => (index === 270 ? 2800 : 1000));
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: index >= 250 ? 82 : 100,
    fear_greed: index >= 250 ? 72 : 50,
  }));
  const model = buildMarketTimingSignals({
    indexKey: "207940.KS",
    dates,
    prices,
    oscillator,
    volumes,
    adrRows,
  });

  assert.equal(model.sellSignals.length, 1);
  assert.equal(model.sellSignals[0].date, dates[270]);
  assert.ok(model.sellSignals[0].sellSetupReasons.includes("고점 거래량 폭증"));
  assert.ok(model.sellSignals[0].sellSetupReasons.includes("시장폭·심리 괴리 단기 과열"));
  assert.ok(model.sellSignals[0].setupVolumeRatio >= 1.8);
});

test("flags a multi-day parabolic stock move immediately", () => {
  const dates = Array.from({ length: 300 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => 100 + (Math.sin(index / 7) * 0.4));
  [100, 100, 100, 130, 169, 219.7].forEach((price, offset) => {
    prices[prices.length - 6 + offset] = price;
  });
  const oscillator = dates.map((_, index) => (
    index < dates.length - 6 ? 0.2 : 0.5 + ((index - dates.length + 6) * 0.3)
  ));
  const volumes = dates.map((_, index) => (index >= dates.length - 3 ? 10000 : 1000));
  const model = buildMarketTimingSignals({
    indexKey: "001210.KS",
    dates,
    prices,
    oscillator,
    volumes,
  });

  const latest = model.sellSignals.at(-1);
  assert.equal(latest.date, dates.at(-1));
  assert.equal(latest.confirmationDate, dates.at(-1));
  assert.ok(latest.price1d >= 29);
  assert.ok(latest.sellSetupReasons.some((reason) => reason.includes("25% 이상 급등")));
});

test("turns an SK Hynix limit-up day into an immediate large-cap overbought signal", () => {
  const dates = Array.from({ length: 300 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => 100 + (Math.sin(index / 7) * 0.4));
  prices[prices.length - 1] = prices[prices.length - 2] * 1.3;
  const oscillator = dates.map(() => 0.8);
  const volumes = dates.map((_, index) => (index === dates.length - 1 ? 10000 : 1000));
  const model = buildMarketTimingSignals({
    indexKey: "000660.KS",
    dates,
    prices,
    oscillator,
    volumes,
  });

  assert.equal(model.sellSignals.at(-1).date, dates.at(-1));
  assert.equal(model.sellSignals.at(-1).entryMode, "extreme-daily");
  assert.ok(model.sellSignals.at(-1).sellSetupReasons.includes("개별종목 일간 25% 이상 급등"));
  assert.ok(model.sellSignals.at(-1).sellSetupReasons.includes("전일대비 30% 상승"));
});

test("flags a Goldstar-style renewed surge before clustered limit-ups have cooled", () => {
  const dates = Array.from({ length: 280 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => 2500 + (Math.sin(index / 9) * 20));
  const volumes = dates.map(() => 100000);
  const tail = [
    ["2026-06-24", 2500, 90421],
    ["2026-06-25", 3250, 3536002],
    ["2026-06-26", 4225, 2121912],
    ["2026-06-29", 5490, 3908301],
    ["2026-06-30", 5870, 23319653],
    ["2026-07-01", 6945, 13157331],
  ];
  tail.forEach(([date, close, volume]) => {
    dates.push(date);
    prices.push(close);
    volumes.push(volume);
  });
  const oscillator = dates.map(() => 0.8);
  const model = buildMarketTimingSignals({
    indexKey: "001210.KS",
    dates,
    prices,
    oscillator,
    volumes,
  });

  const signal = model.sellSignals.find((item) => item.date === "2026-07-01");
  assert.equal(signal?.entryMode, "overheat-continuation");
  assert.equal(signal?.overheatLimitUpCount, 3);
  assert.ok(signal?.overheatCumulativeGain >= 175);
  assert.ok(signal?.sellSetupReasons.includes("상한가 누적 후 비냉각 재가속"));
  assert.ok(signal?.sellSetupReasons.includes("전일대비 18% 상승"));
});

test("turns a stock limit-down day into an immediate oversold signal", () => {
  const dates = Array.from({ length: 300 }, (_, index) => dateAt(index));
  const prices = dates.map(() => 100);
  prices[prices.length - 1] = 70;
  const oscillator = dates.map(() => -0.8);
  const model = buildMarketTimingSignals({
    indexKey: "005930.KS",
    dates,
    prices,
    oscillator,
  });

  assert.equal(model.signals.at(-1).date, dates.at(-1));
  assert.equal(model.signals.at(-1).entryMode, "extreme-daily");
  assert.ok(model.signals.at(-1).setupReasons.includes("개별종목 일간 25% 이상 급락"));
  assert.ok(model.signals.at(-1).setupReasons.includes("전일대비 30% 하락"));
});

test("flags an eight-percent KOSPI daily move as an exceptional market signal", () => {
  const dates = Array.from({ length: 160 }, (_, index) => dateAt(index));
  const prices = dates.map(() => 100);
  prices[prices.length - 1] = 108;
  const oscillator = dates.map(() => 0.2);
  const model = buildMarketTimingSignals({ indexKey: "^KS11", dates, prices, oscillator });

  assert.equal(model.sellSignals.at(-1).date, dates.at(-1));
  assert.ok(model.sellSignals.at(-1).sellSetupReasons.includes("시장지수 일간 8% 이상 급등"));
});

test("ignores split-like daily jumps beyond the Korean price-limit range", () => {
  const dates = Array.from({ length: 160 }, (_, index) => dateAt(index));
  const prices = dates.map(() => 100);
  prices[prices.length - 1] = 200;
  const oscillator = dates.map(() => 0.2);
  const model = buildMarketTimingSignals({ indexKey: "005930.KS", dates, prices, oscillator });

  assert.equal(model.sellSignals.some((signal) => signal.entryMode === "extreme-daily"), false);
});

test("detects a five-day market shock only after MACD starts recovering", () => {
  const dates = Array.from({ length: 180 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 140) return 120;
    if (index <= 145) return 120 - ((index - 140) * 4);
    return 100 + ((index - 145) * 1.2);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 145) return -0.2;
    if (index === 145) return -1.5;
    return -1.1 + ((index - 146) * 0.2);
  });
  const adrRows = dates.map((date) => ({ date, adr_kospi: 90 }));
  const model = buildMarketTimingSignals({ indexKey: "^KS11", dates, prices, oscillator, adrRows });

  assert.equal(model.signals.length, 1);
  assert.equal(model.signals[0].date, dates[145]);
  assert.ok(model.signals[0].confirmationDate > model.signals[0].date);
  assert.ok(model.signals[0].setupReasons.includes("5일 충격 급락"));
});

test("allows washed-out credit to arm a buy only after price and MACD recover", () => {
  const dates = Array.from({ length: 340 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 275) return 100;
    if (index <= 290) return 100 - ((index - 274) * 2);
    return 68 + ((index - 290) * 0.6);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 289) return -0.6;
    if (index === 289) return -0.9;
    return Math.min(0.4, -0.5 + ((index - 290) * 0.14));
  });
  const creditRows = dates.map((date, index) => ({
    date,
    kospi_credit: index < 270 ? 100 : Math.max(55, 100 - ((index - 269) * 1.8)),
  }));
  const macroRows = dates.map((date, index) => ({
    date,
    news_sentiment: 85 + (index * 0.02),
  }));
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: index >= 275 && index <= 305 ? 72 + Math.max(0, index - 292) * 2 : 100,
    fear_greed: 50,
  }));
  const model = buildMarketTimingSignals({
    indexKey: "^KS11",
    dates,
    prices,
    oscillator,
    creditRows,
    macroRows,
    adrRows,
  });

  assert.equal(model.signals.length, 1);
  assert.equal(model.signals[0].creditWashedOut, true);
  assert.ok(model.signals[0].setupReasons.includes("신용 투매"));
  assert.deepEqual(model.signals[0].triggerReasons, ["MACD 상승 다이버전스"]);
  assert.ok(model.signals[0].confirmationDate >= model.signals[0].date);
});

test("recovers major historical KOSPI turning points without future-dated markers", () => {
  const columnarRows = (filename) => {
    const payload = JSON.parse(fs.readFileSync(new URL(`../../docs/data/${filename}`, import.meta.url), "utf8"));
    return payload.dates.map((date, index) => Object.fromEntries([
      ["date", date],
      ...Object.entries(payload.columns).map(([key, values]) => [key, values[index]]),
    ]));
  };
  const pricePayload = JSON.parse(
    fs.readFileSync(new URL("../../docs/data/prices.json", import.meta.url), "utf8"),
  );
  const buildHistoricalModel = (indexKey) => {
    const macd = buildMacdOscillator({
      dates: pricePayload.dates,
      prices: pricePayload.columns[indexKey],
    });
    return buildMarketTimingSignals({
      indexKey,
      dates: macd.dates,
      prices: macd.prices,
      oscillator: macd.normalized,
      adrRows: columnarRows("adr_data.json"),
      macroRows: columnarRows("macro_data.json"),
      creditRows: columnarRows("credit_data.json"),
    });
  };
  const model = buildHistoricalModel("^KS11");
  const kosdaqModel = buildHistoricalModel("^KQ11");
  const rfhicModel = buildHistoricalModel("218410.KQ");
  const sells = new Set(model.sellSignals.map((signal) => signal.date));
  const tradingIndex = new Map(pricePayload.dates.map((date, index) => [date, index]));
  const nearestTradingDays = (targetDate, signalDates) => {
    const targetIndex = tradingIndex.get(targetDate);
    return Math.min(...signalDates.filter((date) => tradingIndex.has(date)).map((date) => (
      Math.abs(tradingIndex.get(date) - targetIndex)
    )));
  };

  ["2007-08-17", "2008-10-24", "2008-11-20", "2011-09-26", "2022-07-06"]
    .forEach((date) => assert.ok(
      nearestTradingDays(date, model.signals.map((signal) => signal.date)) <= 2,
      `missing buy near ${date}`,
    ));
  assert.ok(model.signals.length >= 18 && model.signals.length <= 55);
  const combinedBuyDates = [...model.signals, ...kosdaqModel.signals]
    .map((signal) => signal.date)
    .filter((date) => tradingIndex.has(date));
  [model, kosdaqModel].forEach((marketModel) => assert.ok(
    nearestTradingDays("2026-03-04", marketModel.signals.map((signal) => signal.date)) <= 1,
    "missing market-shock buy near 2026-03-04",
  ));
  ["2013-06-25", "2018-10-30", "2019-08-07", "2023-10-23", "2025-04-15"]
    .forEach((targetDate) => {
      assert.ok(nearestTradingDays(targetDate, combinedBuyDates) <= 4, `missing buy near ${targetDate}`);
    });
  [...model.signals, ...kosdaqModel.signals]
    .filter((signal) => signal.entryMode === "confirmation")
    .forEach((signal) => {
      assert.equal(signal.date, signal.confirmationDate);
      assert.ok(signal.setupDate <= signal.date);
    });
  ["2011-04-18", "2018-01-29", "2021-05-10"]
    .forEach((date) => assert.ok(sells.has(date), `missing sell ${date}`));
  assert.ok(
    nearestTradingDays("2021-01-22", model.sellSignals.map((signal) => signal.date)) <= 1,
    "missing sell near 2021-01-22",
  );
  ["2026-06-01", "2026-06-18"]
    .forEach((date) => assert.ok(
      nearestTradingDays(date, model.sellSignals.map((signal) => signal.date)) <= 1,
      `missing recent sell near ${date}`,
    ));
  const kosdaqSells = new Set(kosdaqModel.sellSignals.map((signal) => signal.date));
  ["2023-04-11", "2026-01-29"]
    .forEach((date) => assert.ok(kosdaqSells.has(date), `missing KOSDAQ sell ${date}`));
  assert.ok(
    nearestTradingDays("2026-04-27", kosdaqModel.sellSignals.map((signal) => signal.date)) <= 2,
    "missing KOSDAQ clustered-overheat sell near 2026-04-27",
  );
  ["2026-03-11", "2026-04-22", "2026-05-12"].forEach((date) => assert.ok(
    nearestTradingDays(date, rfhicModel.sellSignals.map((signal) => signal.date)) <= 1,
    `missing RFHIC sell near ${date}`,
  ));
  assert.ok(
    nearestTradingDays("2026-02-20", rfhicModel.sellSignals.map((signal) => signal.date)) > 3,
    "RFHIC intermediate high should remain inside the March peak episode",
  );
  [...model.signals, ...model.sellSignals, ...rfhicModel.sellSignals].forEach((signal) => {
    assert.ok(signal.confirmationDate >= signal.date);
  });
});
