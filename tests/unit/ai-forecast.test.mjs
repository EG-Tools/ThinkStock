import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const scenarioPathSource = await readFile(path.resolve("docs/modules/ai-scenario-paths.js"), "utf8");
const source = await readFile(path.resolve("docs/modules/ai-forecast.js"), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(scenarioPathSource, context);
vm.runInContext(source, context);
const {
  applyFeatureTransform,
  buildContextSignal,
  buildCorporateRiskSignal,
  buildForecast,
  buildInternetNewsSignal,
  buildLeadingCyclePhase,
  buildMarketRegimeSignal,
  buildPriceRegimeProfile,
  buildRotationSignal,
  globalMarketSeriesFor,
  getForecastInputKey,
  marketModelForHorizon,
  nextBusinessDates,
  parseFeatureTransform,
} = context.ThinkStockAiForecast;
const { classifyHistoricalPath } = context.ThinkStockAiScenarioPaths;

test("replays the serialized nonlinear feature transform exactly", () => {
  const transform = parseFeatureTransform({
    format: "random-tanh-v1",
    input_size: 2,
    hidden_size: 1,
    weights: [[0.5], [-0.25]],
    biases: [0.1],
  });

  const transformed = applyFeatureTransform([1, 2], transform);

  assert.deepEqual(Array.from(transformed.slice(0, 2)), [1, 2]);
  assert.ok(Math.abs(transformed[2] - Math.tanh(0.1)) < 1e-12);
});

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
  assert.equal(first.model.pathVersion, "path-v12");
  const [month, quarter, halfYear] = first.model.horizons;
  assert.equal(month.calibration.localScale, 0.33);
  assert.equal(month.calibration.regimeScale, 1);
  assert.equal(month.calibration.rangeScale, 1);
  assert.equal(quarter.calibration.localScale, 0.5);
  assert.equal(quarter.calibration.regimeScale, 0.25);
  assert.equal(quarter.calibration.rangeScale, 1.25);
  assert.equal(halfYear.calibration.localScale, 0.25);
  assert.equal(halfYear.calibration.regimeScale, 0);
  assert.equal(halfYear.calibration.rangeScale, 1);
  assert.deepEqual(Object.keys(first.attribution.horizons), ["5", "10", "20", "63", "126"]);
  Object.values(first.attribution.horizons).forEach((attribution) => {
    const componentTotal = Object.values(attribution.components)
      .reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(componentTotal - attribution.expectedLogReturn) < 1e-10);
  });
  assert.equal(first.audit.format, "ai-audit-v1");
  assert.equal(first.audit.sources.internet_news_rows, 0);
  assert.equal(first.audit.sources.analyst_report_rows, 0);
  assert.ok(first.backtest.trainingSamples >= 12);
  assert.ok(first.backtest.validationSamples >= 24);
  assert.ok(first.backtest.directionAccuracy >= 0 && first.backtest.directionAccuracy <= 1);
  first.prices.forEach((price, index) => {
    assert.ok(first.lowerPrices[index] <= price);
    assert.ok(first.upperPrices[index] >= price);
  });
  const scenarios = [first.scenarios.upside, first.scenarios.sideways, first.scenarios.downside];
  assert.equal(scenarios.reduce((sum, scenario) => sum + scenario.probability, 0), 100);
  assert.equal(scenarios.reduce((sum, scenario) => sum + scenario.weight, 0), 100);
  assert.equal(first.scenarios.calibration.weightType, "relative-scenario-weight");
  assert.equal(first.scenarios.calibration.calibratedProbability, false);
  assert.equal(first.validation.status, "experimental");
  assert.equal(first.validation.benchmarkOutperformanceConfirmed, false);
  assert.equal(first.scenarios.calibration.probabilitySignalStrength, 0.25);
  assert.equal(first.scenarios.calibration.sidewaysProbabilityScale, 0.7);
  assert.ok(scenarios.every((scenario) => scenario.prices.length === 127 && scenario.reason));
  assert.ok(scenarios.every((scenario) => scenario.patternKey && scenario.pathSource));
  assert.equal(new Set(scenarios.map((scenario) => scenario.patternKey)).size, 3);
  scenarios.forEach((scenario) => {
    const path = scenario.prices.map((price) => Math.log(price / scenario.prices[0]));
    const classified = classifyHistoricalPath(path, first.scenarios.calibration.flatBand);
    assert.equal(classified.role, scenario.key);
    assert.equal(classified.key, scenario.patternKey);
  });
  assert.equal(new Set(scenarios.map((scenario) => scenario.reason)).size, 3);
  const pathShapes = scenarios.map((scenario) => {
    const endpoint = Math.log(scenario.prices.at(-1) / scenario.prices[0]);
    return [32, 63, 95].map((index) => (
      Math.log(scenario.prices[index] / scenario.prices[0]) / endpoint
    ).toFixed(3)).join("|");
  });
  assert.equal(new Set(pathShapes).size, 3);
  assert.ok(Number.isFinite(first.scenarios.calibration.pathMomentum));
  assert.ok(first.scenarios.upside.prices.at(-1) > first.scenarios.sideways.prices.at(-1));
  assert.ok(first.scenarios.sideways.prices.at(-1) > first.scenarios.downside.prices.at(-1));
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

test("keeps the forecast input key independent from viewport transforms", () => {
  const { dates, prices, kospi } = syntheticHistory(1000);
  const common = {
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
  };
  const shortViewKey = getForecastInputKey({
    ...common,
    transformPrices: prices.slice(-63),
    transformChartValues: prices.slice(-63).map((price) => price * 0.2),
  });
  const longViewKey = getForecastInputKey({
    ...common,
    transformPrices: prices,
    transformChartValues: prices.map((price) => price * 0.8),
  });

  assert.equal(shortViewKey, longViewKey);
  assert.notEqual(getForecastInputKey({
    ...common,
    internetNews: [{ date: dates.at(-1), title: "대규모 공급계약" }],
  }), longViewKey);
});

test("uses bounded recent company-news evidence in the forecast attribution", () => {
  const { dates, prices, kospi } = syntheticHistory(1000);
  const lastDate = dates.at(-1);
  const positiveNews = [{ date: lastDate, title: "사상 최대 실적과 대규모 공급계약 체결" }];
  const negativeNews = [{ date: lastDate, title: "실적 부진으로 목표가 하향" }];
  assert.ok(buildInternetNewsSignal(positiveNews, lastDate).signal > 0);
  assert.ok(buildInternetNewsSignal(negativeNews, lastDate).signal < 0);

  const common = {
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
  };
  const positive = buildForecast({ ...common, internetNews: positiveNews });
  const negative = buildForecast({ ...common, internetNews: negativeNews });
  assert.equal(positive.audit.sources.internet_news_rows, 1);
  assert.ok(positive.attribution.horizons[126].components.internetNews > 0);
  assert.ok(negative.attribution.horizons[126].components.internetNews < 0);
  assert.ok(positive.attribution.horizons[126].expectedLogReturn
    > negative.attribution.horizons[126].expectedLogReturn);
});

test("hard-gates an optimistic forecast when fresh company news reports a critical event", () => {
  const { dates, prices, kospi } = syntheticHistory(1100);
  const lastDate = dates.at(-1);
  const criticalNews = [{ date: lastDate, title: "기업 파산 및 상장폐지 절차 개시" }];
  const relievedNews = [{ date: lastDate, title: "유상증자 결정 철회" }];
  const ambiguousSplit = buildInternetNewsSignal(
    [{ date: lastDate, title: "기업분할 결정" }],
    lastDate,
  );
  const positiveSplit = buildInternetNewsSignal(
    [{ date: lastDate, title: "인적분할로 주주가치 제고" }],
    lastDate,
  );
  const negativeSplit = buildInternetNewsSignal(
    [{ date: lastDate, title: "물적분할 후 중복상장 우려와 주주가치 훼손" }],
    lastDate,
  );
  const criticalSignal = buildInternetNewsSignal(criticalNews, lastDate);
  assert.equal(criticalSignal.criticalRisk, true);
  assert.equal(criticalSignal.criticalSeverity, 1);
  assert.equal(buildInternetNewsSignal(relievedNews, lastDate).criticalRisk, false);
  assert.equal(ambiguousSplit.signal, 0);
  assert.equal(ambiguousSplit.ambiguousCount, 1);
  assert.ok(positiveSplit.signal > 0);
  assert.ok(negativeSplit.signal < 0);

  const forecast = buildForecast({
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
    consensus: { targetPrice: prices.at(-1) * 1.5, opinion: 5, institutions: 12 },
    internetNews: criticalNews,
  });
  assert.equal(forecast.signals.internetNewsCriticalRisk, true);
  assert.ok(forecast.prices.at(-1) < forecast.prices[0]);
  assert.equal(forecast.scenarios.upside.probability, 0);
  assert.ok(forecast.scenarios.downside.probability >= 85);
  assert.ok(forecast.attribution.horizons[126].components.criticalNewsGate < 0);
  assert.equal(forecast.audit.features.internet_news_critical_risk, 1);
  assert.match(forecast.scenarios.downside.reason, /초대형 악재/);
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

test("records the real consensus contribution and moves the forecast when only consensus changes", () => {
  const { dates, prices, kospi } = syntheticHistory(1100);
  const common = {
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
  };
  const positive = buildForecast({
    ...common,
    consensus: { targetPrice: prices.at(-1) * 1.4, opinion: 4.5, institutions: 8 },
  });
  const negative = buildForecast({
    ...common,
    consensus: { targetPrice: prices.at(-1) * 0.7, opinion: 2, institutions: 8 },
  });

  assert.ok(positive.attribution.horizons[126].components.consensus > 0);
  assert.ok(negative.attribution.horizons[126].components.consensus < 0);
  assert.ok(positive.prices.at(-1) > negative.prices.at(-1));
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
    auxiliaryRows: [
      ...auxiliaryRows,
      { date: nextBusinessDates(dates.at(-1), 1)[0], adr_kosdaq: 999, fear_greed: 999 },
    ],
  });

  assert.equal(forecast.marketEnvironment.coverage, 1);
  assert.ok(Number.isFinite(forecast.marketEnvironment.combined));
  assert.ok(Number.isFinite(forecast.audit.features.adr_latest));
  assert.ok(Number.isFinite(forecast.audit.features.adr_change_28d));
  assert.ok(Number.isFinite(forecast.audit.features.adr_recent_high_28d));
  assert.notEqual(forecast.audit.features.aux_adr_kosdaq, 999);
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
      blend_weight: 1,
      reliability: 0.4,
      residual80: 0.03,
      metrics: { improvement: 0.1, directionAccuracy: 0.6 },
    }])),
  };
  const blended = buildForecast({ ...common, marketModel });

  assert.equal(blended.model.marketModelUsed, true);
  assert.match(blended.model.name, /top-400/);
  assert.equal(blended.model.version, "2026-07-23|path-v12");
  assert.equal(blended.model.pathVersion, "path-v12");
  assert.equal(blended.scenarios.calibration.probabilitySignalStrength, 0.5);
  assert.equal(blended.scenarios.calibration.sidewaysProbabilityScale, 0.7);
  assert.equal(blended.model.globalMarketSeries, "^KS11");
  assert.equal(marketModelForHorizon(marketModel, 20).reliability, 0.4);
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
  assert.equal(forecast.model.name, "calibrated risk-gated purged multi-horizon ensemble");
});

test("gates optimistic forecasts when recent disclosures and losses show terminal risk", () => {
  const { dates, prices, kospi } = syntheticHistory(1100);
  const common = {
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
  };
  const clean = buildForecast(common);
  const risky = buildForecast({
    ...common,
    disclosures: [{
      ticker: "005930.KS",
      date: dates.at(-2),
      title: "상장폐지 및 거래정지 관련 안내",
    }],
    financials: [
      { period: "2021-06", frequency: "quarter", estimate: false, operatingProfit: -20, netIncome: -30 },
      { period: "2021-09", frequency: "quarter", estimate: false, operatingProfit: -25, netIncome: -35 },
      { period: "2021-12", frequency: "quarter", estimate: false, operatingProfit: -40, netIncome: -45 },
      { period: "2022-03", frequency: "quarter", estimate: false, operatingProfit: -50, netIncome: -60 },
    ],
  });

  assert.ok(risky.signals.corporateRisk.score >= 0.9);
  assert.equal(risky.signals.corporateRisk.terminalRisk, true);
  assert.ok(risky.prices.at(-1) < clean.prices.at(-1));
  assert.ok(risky.scenarios.downside.probability > clean.scenarios.downside.probability);
  assert.match(risky.scenarios.downside.reason, /상장|적자|손실/);
  assert.ok(buildCorporateRiskSignal({ disclosures: [] }, "005930.KS", dates.at(-1)).score === 0);

  const dilution = buildForecast({
    ...common,
    disclosures: [{ ticker: "005930.KS", date: dates.at(-1), title: "유상증자 결정" }],
  });
  assert.equal(dilution.signals.corporateRisk.recentDilutionRisk, true);
  assert.ok(dilution.prices.at(-1) < dilution.prices[0]);
  assert.equal(dilution.scenarios.upside.probability, 0);
  assert.ok(dilution.scenarios.downside.probability >= 70);
  assert.equal(buildCorporateRiskSignal({
    disclosures: [{ ticker: "005930.KS", date: dates.at(-1), title: "유상증자 결정 철회" }],
  }, "005930.KS", dates.at(-1)).recentDilutionRisk, false);
});

test("uses a macro-first model for KOSPI and reacts to rates, trade, and recession risk", () => {
  const { dates, kospi, kosdaq } = syntheticHistory(1500);
  const monthlyDates = dates.filter((_, index) => index % 21 === 0);
  const macroRows = (riskOn) => monthlyDates.map((date, index) => ({
    date,
    leading_cycle: 98 + (index * (riskOn ? 0.08 : -0.08)),
    policy_rate: riskOn ? 4 - (index * 0.02) : 1 + (index * 0.02),
    export_value: 50000 * Math.exp(index * (riskOn ? 0.012 : -0.012)),
    import_value: 48000 * Math.exp(index * (riskOn ? 0.004 : 0.008)),
    news_sentiment: riskOn ? 108 : 82,
  }));
  const common = {
    series: "^KS11",
    dates,
    prices: kospi,
    marketCandidates: [{ series: "^KQ11", dates, prices: kosdaq }],
  };
  const supportive = buildForecast({
    ...common,
    macroRows: macroRows(true),
    crisisRows: [{ date: dates.at(-2), score: 12, fedFundsChange6m: -0.5 }],
  });
  const defensive = buildForecast({
    ...common,
    macroRows: macroRows(false),
    crisisRows: [{ date: dates.at(-2), score: 78, fedFundsChange6m: 0.75 }],
  });

  assert.equal(supportive.signals.forecastMode, "macro-index");
  assert.equal(supportive.model.marketModelUsed, false);
  assert.match(supportive.model.name, /macro-regime/);
  supportive.model.horizons.forEach((horizon) => {
    assert.equal(horizon.calibration.localScale, 1);
    assert.equal(horizon.calibration.regimeScale, 1);
    assert.equal(horizon.calibration.rangeScale, 1);
  });
  assert.equal(supportive.scenarios.calibration.probabilitySignalStrength, 1);
  assert.equal(supportive.scenarios.calibration.sidewaysProbabilityScale, 1);
  assert.ok(supportive.prices.at(-1) > defensive.prices.at(-1));
  assert.ok(defensive.scenarios.downside.probability > supportive.scenarios.downside.probability);
  const regime = buildMarketRegimeSignal({
    macroRows: macroRows(true),
    crisisRows: [{ date: dates.at(-2), score: 12, fedFundsChange6m: -0.5 }],
  }, "^KS11", dates.at(-1));
  assert.ok(regime.support > regime.risk);
});

test("keeps a historically range-bound stock from inheriting an unconditional growth bias", () => {
  const dates = tradingDates(1500);
  const prices = dates.map((_, index) => 100 * Math.exp(
    (0.055 * Math.sin((index * Math.PI * 2) / 252))
      + (0.012 * Math.sin((index * Math.PI * 2) / 21)),
  ));
  const kospi = dates.map((_, index) => 2200 * Math.exp(index * 0.00022));
  const forecast = buildForecast({
    series: "123456.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
    consensus: { targetPrice: prices.at(-1) * 1.4, opinion: 4.5, institutions: 12 },
    financials: [
      { period: "2024-12", frequency: "annual", revenue: 1000, operatingProfit: 90 },
      { period: "2025-12", frequency: "annual", revenue: 1080, operatingProfit: 105 },
      { period: "2026-03", frequency: "quarter", revenue: 280, operatingProfit: 29 },
      { period: "2026-06", frequency: "quarter", revenue: 295, operatingProfit: 34 },
    ],
    macdSignal: 0.3,
  });

  assert.ok(forecast.signals.priceRegime.rangeBoundScore > 0.5);
  assert.ok(forecast.scenarios.sideways.probability >= forecast.scenarios.upside.probability);
  assert.match(forecast.scenarios.sideways.reason, /박스권/);
});

test("does not force a persistent trend stock into the range-bound prior", () => {
  const dates = tradingDates(1500);
  const prices = dates.map((_, index) => 100 * Math.exp(
    (index * 0.00075) + (0.012 * Math.sin(index / 17)),
  ));
  const profile = buildPriceRegimeProfile(
    prices,
    Array.from({ length: 80 }, (_, index) => 0.08 + ((index % 5) * 0.005)),
    0.012,
  );

  assert.ok(profile.rangeBoundScore < 0.35);
  assert.ok(profile.annualizedReturn > 0.1);
});

test("classifies a flattened historical-high leading cycle as a peak regime", () => {
  const dates = tradingDates(2520).filter((_, index) => index % 21 === 0);
  const macroRows = dates.map((date, index) => ({
    date,
    leading_cycle: 98 + (Math.min(index, dates.length - 12) * 0.055),
  }));
  const phase = buildLeadingCyclePhase(macroRows, dates.at(-1));

  assert.equal(phase.phase, "peak");
  assert.ok(phase.rank >= 0.85);
  assert.ok(phase.rangePressure > 0);
});

test("detects cooling semiconductor leadership instead of extending it indefinitely", () => {
  const dates = tradingDates(1000);
  const benchmark = dates.map((_, index) => 100 * Math.exp(index * 0.0002));
  const leader = dates.map((_, index) => {
    const coolingStart = dates.length - 22;
    const relativeLog = index <= coolingStart
      ? index * 0.0008
      : (coolingStart * 0.0008) - ((index - coolingStart) * 0.0015);
    return benchmark[index] * Math.exp(relativeLog);
  });
  const rotation = buildRotationSignal({
    marketCandidates: [{ series: "^KS11", dates, prices: benchmark }],
    rotationCandidates: [
      { series: "005930.KS", dates, prices: leader },
      { series: "000660.KS", dates, prices: leader.map((value, index) => value * (1 + (0.01 * Math.sin(index / 9)))) },
    ],
  }, "005930.KS", dates, leader, { rangeBoundScore: 0.1 });

  assert.ok(rotation.leaderCooling > 0.25);
  assert.ok(rotation.risk > 0);
  assert.ok(rotation.adjustment < 0);
  assert.match(rotation.riskReasons.join(" "), /주도주 모멘텀 둔화/);
});

test("accepts every validated horizon in the generated top-400 artifact", async () => {
  const marketModel = JSON.parse(await readFile(path.resolve("docs/data/ai_market_model.json"), "utf8"));
  for (const horizon of [20, 63, 126]) {
    const model = marketModelForHorizon(marketModel, horizon);
    assert.ok(model);
    const expectedFeatures = 17 + (model.featureTransform?.hiddenSize || 0);
    assert.equal(model.coefficients.length, expectedFeatures + 1);
    assert.equal(model.indexes.length, expectedFeatures);
    assert.ok(model.reliability > 0);
    assert.ok(model.reliability <= 1);
  }
});
