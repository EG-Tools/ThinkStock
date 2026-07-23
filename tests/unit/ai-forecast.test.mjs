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
  globalMarketSeriesFor,
  marketModelForHorizon,
  nextBusinessDates,
} = context.ThinkStockAiForecast;

test("uses the same benchmark mapping as the cross-sectional training model", () => {
  assert.equal(globalMarketSeriesFor("005930.KS"), "^KS11");
  assert.equal(globalMarketSeriesFor("218410.KQ"), "^KQ11");
  assert.equal(globalMarketSeriesFor("218410.KQ", {
    feature_schema: { market_mapping: { KOSDAQ: "CUSTOM-KQ" } },
  }), "CUSTOM-KQ");
});

function tradingDates(count, start = "2018-01-02") {
  const output = [start];
  while (output.length < count) output.push(...nextBusinessDates(output.at(-1), 1));
  return output;
}

function pricesFromReturns(returns, initial = 100) {
  return returns.reduce(
    (prices, value) => [...prices, prices.at(-1) * Math.exp(value)],
    [initial],
  );
}

function standardDeviation(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function syntheticHistory(count = 1300) {
  const dates = tradingDates(count);
  const marketReturns = Array.from({ length: count - 1 }, (_, index) => (
    0.00015 + (0.004 * Math.sin(index / 31)) + (0.002 * Math.sin(index / 7))
  ));
  const stockReturns = marketReturns.map((marketReturn, index) => (
    0.0002 + (marketReturn * 0.7) + (0.006 * Math.sin(index / 19))
  ));
  const prices = pricesFromReturns(stockReturns);
  const kospi = pricesFromReturns(marketReturns, 2200);
  const kosdaq = pricesFromReturns(marketReturns.map((value, index) => (
    (value * 0.1) + (0.004 * Math.sin(index / 5))
  )), 700);
  return { dates, prices, kospi, kosdaq };
}

test("trains deterministic 20, 63, and 126-day models with uncertainty bands", () => {
  const { dates, prices, kospi, kosdaq } = syntheticHistory(1500);
  const chartValues = prices.map((price) => 50 + (price * 0.25));
  const options = {
    series: "218410.KQ",
    dates,
    prices,
    transformPrices: prices,
    transformChartValues: chartValues,
    marketCandidates: [
      { series: "^KS11", dates, prices: kospi },
      { series: "^KQ11", dates, prices: kosdaq },
    ],
  };
  const first = buildForecast(options);
  const second = buildForecast(options);

  assert.ok(first);
  assert.equal(first.dates.length, 127);
  assert.equal(first.prices.length, 127);
  assert.equal(first.historyDays, 1260);
  const recentReturns = prices.slice(-64).slice(1).map((price, index) => Math.log(price / prices.slice(-64)[index]));
  const forecastReturns = first.prices.slice(1).map((price, index) => Math.log(price / first.prices[index]));
  assert.ok(standardDeviation(forecastReturns) >= standardDeviation(recentReturns) * 0.2);
  assert.ok(standardDeviation(forecastReturns) <= standardDeviation(recentReturns) * 1.2);
  assert.deepEqual(first.prices, second.prices);
  assert.equal(first.model.horizons.map((item) => item.days).join(","), "20,63,126");
  assert.ok(first.backtest.trainingSamples >= 12);
  assert.ok(first.backtest.validationSamples >= 24);
  assert.ok(first.backtest.directionAccuracy >= 0 && first.backtest.directionAccuracy <= 1);
  first.prices.forEach((price, index) => {
    assert.ok(first.lowerPrices[index] <= price);
    assert.ok(first.upperPrices[index] >= price);
  });
  assert.equal(first.chartValues[0], chartValues.at(-1));
  first.dates.slice(1).forEach((date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    assert.notEqual(day, 0);
    assert.notEqual(day, 6);
  });
});

test("does not forecast when three years of history are unavailable", () => {
  const dates = tradingDates(755);
  const prices = dates.map((_, index) => 100 + index);
  assert.equal(buildForecast({ series: "005930.KS", dates, prices }), null);
});

test("keeps the learned prices independent from the visible chart range", () => {
  const { dates, prices, kospi } = syntheticHistory(1000);
  const common = {
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
  };
  const shortView = buildForecast({
    ...common,
    transformPrices: prices.slice(-63),
    transformChartValues: prices.slice(-63).map((price) => 10 + (price * 0.2)),
  });
  const longView = buildForecast({
    ...common,
    transformPrices: prices,
    transformChartValues: prices.map((price) => 80 + (price * 0.5)),
  });

  assert.deepEqual(shortView.prices, longView.prices);
  assert.notDeepEqual(shortView.chartValues, longView.chartValues);
  assert.equal(shortView.chartValues[0], 10 + (prices.at(-1) * 0.2));
  assert.equal(longView.chartValues[0], 80 + (prices.at(-1) * 0.5));
});

test("anchors the forecast to the latest valid chart point when the newest row is empty", () => {
  const { dates, prices, kospi } = syntheticHistory(1000);
  const visiblePrices = [...prices.slice(-126), null];
  const visibleValues = [...prices.slice(-126).map((price) => 25 + (price * 0.4)), null];
  const forecast = buildForecast({
    series: "034220.KS",
    dates,
    prices,
    transformPrices: visiblePrices,
    transformChartValues: visibleValues,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
  });

  assert.ok(forecast);
  assert.equal(forecast.chartValues[0], visibleValues.at(-2));
  assert.equal(forecast.lowerChartValues[0], visibleValues.at(-2));
  assert.equal(forecast.upperChartValues[0], visibleValues.at(-2));
});

test("learns the strongest market relationship without assuming its direction", () => {
  const count = 1100;
  const dates = tradingDates(count);
  const kospiReturns = Array.from({ length: count - 1 }, (_, index) => (
    -0.0001 + (0.005 * Math.sin(index / 21))
  ));
  const stockReturns = kospiReturns.map((value, index) => (
    (-0.85 * value) + (0.0003 * Math.sin(index / 4))
  ));
  const kosdaqReturns = Array.from({ length: count - 1 }, (_, index) => 0.005 * Math.sin(index / 5));
  const forecast = buildForecast({
    series: "218410.KQ",
    dates,
    prices: pricesFromReturns(stockReturns),
    marketCandidates: [
      { series: "^KS11", dates, prices: pricesFromReturns(kospiReturns) },
      { series: "^KQ11", dates, prices: pricesFromReturns(kosdaqReturns) },
    ],
    marketModel: {
      generated_at: "fixed-market-test",
      feature_schema: { market_mapping: { KOSPI: "^KS11", KOSDAQ: "^KQ11" } },
      horizons: Object.fromEntries([20, 63, 126].map((horizon) => [String(horizon), {
        indexes: [0], coefficients: [0.01, 0], means: [0], deviations: [1], reliability: 0.2,
        metrics: { improvement: 0.05, directionAccuracy: 0.55 },
      }])),
    },
  });

  assert.equal(forecast.marketRelationship.series, "^KS11");
  assert.equal(forecast.model.globalMarketSeries, "^KQ11");
  assert.ok(forecast.marketRelationship.correlation < -0.8);
  assert.ok(forecast.marketRelationship.downsideBeta < -0.7);
  assert.equal(forecast.marketRelationship.inverseInDownturn, true);
});

test("uses only bounded current consensus and financial context", () => {
  const positive = buildContextSignal({
    consensus: { targetPrice: 160, opinion: 4.5, institutions: 8 },
    financials: [
      { period: "2024-12", frequency: "annual", revenue: 1000, operatingProfit: 80 },
      { period: "2025-12", frequency: "annual", revenue: 1300, operatingProfit: 160 },
      { period: "2025-12", frequency: "quarter", revenue: 300, operatingProfit: 30 },
      { period: "2026-03", frequency: "quarter", revenue: 390, operatingProfit: 60, operatingProfitSurprise: 20 },
    ],
  }, "218410.KQ", "2026-07-22", 100);
  const negative = buildContextSignal({
    consensus: { targetPrice: 70, opinion: 2, institutions: 8 },
    financials: [
      { period: "2024-12", frequency: "annual", revenue: 1300, operatingProfit: 160 },
      { period: "2025-12", frequency: "annual", revenue: 1000, operatingProfit: 40 },
      { period: "2025-12", frequency: "quarter", revenue: 390, operatingProfit: 60 },
      { period: "2026-03", frequency: "quarter", revenue: 300, operatingProfit: 10, operatingProfitSurprise: -20 },
    ],
  }, "218410.KQ", "2026-07-22", 100);

  assert.ok(positive.combined > negative.combined);
  assert.ok(positive.fundamentals > 0);
  assert.ok(negative.fundamentals < 0);
  assert.ok(Math.abs(positive.adjustment) <= 0.04);
  assert.ok(Math.abs(negative.adjustment) <= 0.04);
});

test("reports point-in-time environment coverage when data is available", () => {
  const { dates, prices, kosdaq } = syntheticHistory(1000);
  const macroRows = dates.map((date, index) => ({
    date,
    leading_cycle: 100 + (index * 0.005),
    news_sentiment: 95 + (index * 0.01),
  }));
  const creditRows = dates.map((date, index) => ({
    date,
    customer_deposit: 70 + (index * 0.01),
    kosdaq_credit: 15 - (index * 0.002),
  }));
  const auxiliaryRows = dates.map((date, index) => ({
    date,
    adr_kosdaq: 110 - (index * 0.02),
    fear_greed: 70 - (index * 0.01),
  }));
  const forecast = buildForecast({
    series: "218410.KQ",
    dates,
    prices,
    marketCandidates: [{ series: "^KQ11", dates, prices: kosdaq }],
    macroRows,
    creditRows,
    auxiliaryRows,
  });

  assert.equal(forecast.marketEnvironment.coverage, 1);
  assert.ok(Number.isFinite(forecast.marketEnvironment.combined));
});

test("blends a validated top-400 market model without replacing the local guardrails", () => {
  const { dates, prices, kospi } = syntheticHistory(1100);
  const common = {
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
  };
  const local = buildForecast(common);
  const marketModel = {
    format: "thinkstock-ai-market-model-v1",
    generated_at: "2026-07-23",
    horizons: Object.fromEntries([20, 63, 126].map((horizon) => [String(horizon), {
      indexes: [0],
      coefficients: [0.2, 0],
      means: [0],
      deviations: [1],
      reliability: 0.4,
      residual80: 0.03,
      metrics: { improvement: 0.1, directionAccuracy: 0.6 },
    }])),
  };
  const blended = buildForecast({ ...common, marketModel });

  assert.equal(blended.model.marketModelUsed, true);
  assert.match(blended.model.name, /top-400/);
  assert.equal(blended.model.version, "2026-07-23|path-v4");
  assert.equal(blended.model.pathVersion, "path-v4");
  assert.equal(blended.model.globalMarketSeries, "^KS11");
  assert.ok(blended.prices.at(-1) > local.prices.at(-1));
});

test("ignores a market model that did not beat its validation baseline", () => {
  const { dates, prices, kospi } = syntheticHistory(1000);
  const forecast = buildForecast({
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
    marketModel: {
      generated_at: "rejected",
      horizons: Object.fromEntries([20, 63, 126].map((horizon) => [String(horizon), {
        indexes: [0], coefficients: [1, 0], means: [0], deviations: [1], reliability: 0.6,
        metrics: { improvement: -0.1, directionAccuracy: 0.7 },
      }])),
    },
  });

  assert.equal(forecast.model.marketModelUsed, false);
  assert.equal(forecast.model.name, "purged multi-horizon ensemble");
});

test("accepts every validated horizon in the generated top-400 artifact", async () => {
  const marketModel = JSON.parse(await readFile(path.resolve("docs/data/ai_market_model.json"), "utf8"));
  for (const horizon of [20, 63, 126]) {
    const model = marketModelForHorizon(marketModel, horizon);
    assert.ok(model);
    assert.equal(model.coefficients.length, 18);
    assert.equal(model.indexes.length, 17);
    assert.ok(model.reliability > 0);
  }
});
