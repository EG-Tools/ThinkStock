import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("docs/modules/ai-forecast.js"), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(source, context);
const {
  buildContextSignal,
  buildForecast,
  calibrateForecastStrategy,
  detectMarketCycle,
  marketEnvironmentSignal,
  marketRelationship,
  nextBusinessDates,
} = context.ThinkStockAiForecast;

function tradingDates(count, start = "2020-01-02") {
  const output = [start];
  while (output.length < count) output.push(...nextBusinessDates(output.at(-1), 1));
  return output;
}

test("builds a deterministic six-month forecast from at most five years", () => {
  const dates = tradingDates(1500);
  const prices = dates.map((_, index) => 100 * Math.exp(
    (index * 0.00025)
    + (Math.sin(index / 17) * 0.04)
    + (Math.sin(index / 2.3) * 0.008),
  ));
  const chartValues = prices.map((price) => 82 + (price * 0.18));
  const options = { series: "218410.KQ", dates, prices, chartValues };
  const first = buildForecast(options);
  const second = buildForecast(options);

  assert.equal(first.dates.length, 127);
  assert.equal(first.chartValues.length, 127);
  assert.equal(first.historyDays, 1260);
  assert.equal(first.chartValues[0], chartValues.at(-1));
  assert.deepEqual(first.chartValues, second.chartValues);
  const forecastReturns = first.prices.slice(1).map((price, index) => (
    Math.log(price / first.prices[index])
  ));
  const average = forecastReturns.reduce((sum, value) => sum + value, 0) / forecastReturns.length;
  const forecastVolatility = Math.sqrt(forecastReturns.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0,
  ) / forecastReturns.length);
  const turningPoints = forecastReturns.slice(1).filter((value, index) => (
    Math.sign(value) !== Math.sign(forecastReturns[index])
  )).length;
  assert.ok(forecastVolatility >= first.projectedVolatility * 0.75);
  assert.ok(turningPoints >= 12);
  assert.ok(first.backtest.trainingSamples >= 5);
  assert.ok(first.backtest.validationSamples >= 3);
  assert.ok(first.backtest.patternWeight >= 0.35 && first.backtest.patternWeight <= 0.75);
  assert.ok(first.backtest.trendMultiplier >= -0.4 && first.backtest.trendMultiplier <= 1.25);
  assert.ok(first.backtest.directionAccuracy >= 0 && first.backtest.directionAccuracy <= 1);
  assert.ok(first.backtest.improvement >= 0 && first.backtest.improvement <= 1);
  first.dates.slice(1).forEach((date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    assert.notEqual(day, 0);
    assert.notEqual(day, 6);
  });
});

test("walk-forward calibration falls back when completed history is insufficient", () => {
  const fallback = calibrateForecastStrategy(Array(300).fill(0.001), 126);
  assert.equal(fallback.samples, 0);
  assert.equal(fallback.patternWeight, 0.52);
  assert.equal(fallback.cycleWeight, 0);
  assert.equal(fallback.volatilityRatio, 0.75);
});

test("detects a persistent two-year cycle without forcing one onto random returns", () => {
  const periodic = Array.from({ length: 1500 }, (_, index) => (
    (0.0025 * Math.sin((2 * Math.PI * index) / 504))
    + (0.0005 * Math.sin((2 * Math.PI * index) / 17))
  ));
  let seed = 123456789;
  const random = Array.from({ length: 1500 }, () => {
    seed = ((1664525 * seed) + 1013904223) >>> 0;
    return ((seed / 4294967296) - 0.5) * 0.04;
  });

  const cycle = detectMarketCycle(periodic);
  assert.ok(cycle);
  assert.ok(Math.abs(cycle.tradingDays - 504) <= 10);
  assert.ok(Math.abs(cycle.years - 2) < 0.05);
  assert.ok(cycle.strength > 0.8);
  assert.equal(detectMarketCycle(random), null);
});

test("detects a stable inverse relationship during market declines", () => {
  const marketReturns = Array.from({ length: 700 }, (_, index) => (
    (-0.0003) + (0.004 * Math.sin(index / 18))
  ));
  const stockReturns = marketReturns.map((value, index) => (
    (-0.9 * value) + (0.0002 * Math.sin(index / 5))
  ));
  const relationship = marketRelationship(stockReturns, marketReturns);

  assert.ok(relationship.downsideBeta < -0.7);
  assert.ok(relationship.downsideStrength > 0.7);
  assert.equal(relationship.inverseInDownturn, true);
});

test("selects the index with the stronger stock relationship", () => {
  const dates = tradingDates(700);
  const kospiReturns = Array.from({ length: 699 }, (_, index) => (
    (-0.0003) + (0.004 * Math.sin(index / 18))
  ));
  const kosdaqReturns = Array.from({ length: 699 }, (_, index) => (
    0.003 * Math.sin(index / 7)
  ));
  const stockReturns = kospiReturns.map((value, index) => (
    (-0.9 * value) + (0.0002 * Math.sin(index / 5))
  ));
  const pricesFromReturns = (returns) => returns.reduce(
    (prices, value) => [...prices, prices.at(-1) * Math.exp(value)],
    [100],
  );
  const prices = pricesFromReturns(stockReturns);
  const forecast = buildForecast({
    series: "218410.KQ",
    dates,
    prices,
    chartValues: prices,
    marketCandidates: [
      { series: "^KS11", dates, prices: pricesFromReturns(kospiReturns) },
      { series: "^KQ11", dates, prices: pricesFromReturns(kosdaqReturns) },
    ],
  });

  assert.equal(forecast.marketRelationship.series, "^KS11");
  assert.equal(forecast.marketRelationship.inverseInDownturn, true);
});

test("combines leading, breadth, liquidity, credit, fear, and news signals", () => {
  const rising = Array.from({ length: 252 }, (_, index) => 100 + (index * 0.02));
  const falling = [...rising].reverse();
  const positive = marketEnvironmentSignal({
    leadingCycle: rising,
    adr: Array.from({ length: 252 }, (_, index) => 65 + (index * 0.1)),
    customerDeposit: rising,
    credit: falling,
    fearGreed: Array.from({ length: 252 }, (_, index) => 15 + (index * 0.08)),
    newsSentiment: rising,
  });
  const negative = marketEnvironmentSignal({
    leadingCycle: falling,
    adr: Array.from({ length: 252 }, (_, index) => 135 - (index * 0.1)),
    customerDeposit: falling,
    credit: rising,
    fearGreed: Array.from({ length: 252 }, (_, index) => 85 - (index * 0.08)),
    newsSentiment: falling,
  });

  assert.equal(positive.coverage, 1);
  assert.equal(negative.coverage, 1);
  assert.ok(positive.combined > negative.combined);
});

test("does not forecast newly listed stocks with fewer than 90 trading days", () => {
  const dates = tradingDates(89);
  const prices = dates.map((_, index) => 100 + index);
  assert.equal(buildForecast({
    series: "218410.KQ",
    dates,
    prices,
    chartValues: prices.map((price) => price / 2),
  }), null);
});

test("keeps predicted prices identical when only the visible chart range changes", () => {
  const dates = tradingDates(900);
  const prices = dates.map((_, index) => 100 * Math.exp(
    (index * 0.00018) + (Math.sin(index / 19) * 0.035),
  ));
  const buildWithVisiblePoints = (count) => buildForecast({
    series: "218410.KQ",
    dates,
    prices,
    transformPrices: prices.slice(-count),
    transformChartValues: prices.slice(-count).map((price) => 60 + (price * 0.25)),
  });
  const threeMonths = buildWithVisiblePoints(63);
  const thirtyYears = buildWithVisiblePoints(900);
  assert.ok(threeMonths);
  assert.deepEqual(threeMonths.prices, thirtyYears.prices);
  assert.equal(threeMonths.historyDays, 900);
  assert.equal(threeMonths.chartValues[0], 60 + (prices.at(-1) * 0.25));
});

test("weights reliable consensus direction into the context signal", () => {
  const positive = buildContextSignal({
    consensus: { targetPrice: 150, opinion: 4.5, institutions: 8 },
  }, "218410.KQ", "2026-07-22", 100);
  const unavailable = buildContextSignal({}, "218410.KQ", "2026-07-22", 100);
  assert.ok(positive.consensus > 0.8);
  assert.ok(positive.combined > unavailable.combined);
});

test("uses accumulated earnings growth as a bounded context signal", () => {
  const improving = buildContextSignal({
    financials: [
      { period: "2024-12", frequency: "annual", revenue: 1000, operatingProfit: 80 },
      { period: "2025-12", frequency: "annual", revenue: 1300, operatingProfit: 160 },
      { period: "2025-12", frequency: "quarter", revenue: 300, operatingProfit: 32 },
      { period: "2026-03", frequency: "quarter", revenue: 390, operatingProfit: 58 },
      { period: "2026-12", frequency: "annual", estimate: true, revenue: 1600, operatingProfit: 220 },
    ],
  }, "218410.KQ", "2026-07-22", 100);
  const deteriorating = buildContextSignal({
    financials: [
      { period: "2024-12", frequency: "annual", revenue: 1300, operatingProfit: 160 },
      { period: "2025-12", frequency: "annual", revenue: 1000, operatingProfit: 40 },
      { period: "2025-12", frequency: "quarter", revenue: 390, operatingProfit: 58 },
      { period: "2026-03", frequency: "quarter", revenue: 300, operatingProfit: 10 },
    ],
  }, "218410.KQ", "2026-07-22", 100);

  assert.ok(improving.fundamentals > 0.5);
  assert.ok(deteriorating.fundamentals < -0.5);
  assert.ok(improving.combined > deteriorating.combined);
  assert.ok(improving.fundamentalsConfidence > 0.8);
});

test("uses reported earnings surprises as a conservative fundamentals signal", () => {
  const positive = buildContextSignal({
    financials: [{
      period: "2026-03",
      frequency: "quarter",
      operatingProfit: 120,
      operatingProfitSurprise: 24,
      netIncomeSurprise: 12,
    }],
  }, "218410.KQ", "2026-07-22", 100);
  const negative = buildContextSignal({
    financials: [{
      period: "2026-03",
      frequency: "quarter",
      operatingProfit: 80,
      operatingProfitSurprise: -24,
      netIncomeSurprise: -12,
    }],
  }, "218410.KQ", "2026-07-22", 100);
  assert.ok(positive.fundamentals > 0);
  assert.ok(negative.fundamentals < 0);
  assert.ok(positive.combined > negative.combined);
});

test("uses MACD as a bounded part of the forecast technical signal", () => {
  const dates = tradingDates(500);
  const prices = dates.map((_, index) => 100 * Math.exp(
    (index * 0.0002) + (Math.sin(index / 13) * 0.025),
  ));
  const chartValues = prices.map((price) => 70 + (price * 0.3));
  const positive = buildForecast({
    series: "218410.KQ", dates, prices, chartValues, macdSignal: 1,
  });
  const negative = buildForecast({
    series: "218410.KQ", dates, prices, chartValues, macdSignal: -1,
  });

  assert.equal(positive.signals.macd, 1);
  assert.equal(negative.signals.macd, -1);
  assert.ok(positive.prices.at(-1) > negative.prices.at(-1));
});
