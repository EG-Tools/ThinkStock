import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/ai-context-profile.js");

const {
  MAX_HISTORY_DAYS,
  buildForecastContextProfile,
  buildMarketRegimeProbabilities,
  buildStructuralStockProfile,
  contextProfileAuditFeatures,
} = globalThis.ThinkStockAiContextProfile;

function tradingDates(count, start = "2010-01-04") {
  const output = [];
  let date = new Date(`${start}T00:00:00Z`);
  while (output.length < count) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) output.push(date.toISOString().slice(0, 10));
    date = new Date(date.getTime() + 86400000);
  }
  return output;
}

function pathFromLogReturns(returns, initial = 100) {
  return returns.reduce((values, value) => [...values, values.at(-1) * Math.exp(value)], [initial]);
}

test("structural profile separates long and recent behavior with index relationships", () => {
  const dates = tradingDates(12 * 252);
  const marketReturns = Array.from({ length: dates.length - 1 }, (_, index) => (
    0.00025 + (0.004 * Math.sin(index / 19))
  ));
  const stockReturns = marketReturns.map((value, index) => (
    0.00035 + (value * 0.8) + (0.0015 * Math.sin(index / 7))
  ));
  const prices = pathFromLogReturns(stockReturns);
  const kospi = pathFromLogReturns(marketReturns, 2200);
  const profile = buildStructuralStockProfile({
    series: "005930.KS",
    dates,
    prices,
    marketCandidates: [{ series: "^KS11", dates, prices: kospi }],
    asOfDate: dates.at(-1),
  });

  assert.ok(profile.historyYears > 10 && profile.historyYears <= 15);
  assert.ok(profile.recentYears >= 2.8 && profile.recentYears <= 3.1);
  assert.ok(profile.scores.trendUp > profile.scores.trendDown);
  assert.ok(profile.relationships.KOSPI.threeYear.correlation > 0.8);
  assert.ok(profile.relationships.KOSPI.threeYear.beta > 0.5);
  assert.equal(profile.longTerm.monthly, undefined);
  assert.equal(profile.longTerm.residuals, undefined);
});

test("stable multi-year oscillation is recorded as a cycle without forcing a forecast", () => {
  const dates = tradingDates(14 * 252);
  const prices = dates.map((_, index) => (
    100 * Math.exp((0.00003 * index) + (0.32 * Math.sin((2 * Math.PI * index) / (3 * 252))))
  ));
  const profile = buildStructuralStockProfile({
    series: "218410.KQ",
    dates,
    prices,
    asOfDate: dates.at(-1),
  });

  assert.ok(profile.cycle.periodMonths >= 32 && profile.cycle.periodMonths <= 40);
  assert.ok(profile.scores.cyclical >= 0.35);
  assert.equal(profile.cycle.stable, true);
});

test("a long decline needs price confirmation before reversal readiness rises", () => {
  const dates = tradingDates(8 * 252);
  const declining = dates.map((_, index) => 180 * Math.exp(-0.00055 * index));
  const recovering = declining.map((value, index) => (
    index < declining.length - 63 ? value : value * Math.exp((index - (declining.length - 63)) * 0.01)
  ));
  const base = buildStructuralStockProfile({
    series: "000000.KS",
    dates,
    prices: declining,
    asOfDate: dates.at(-1),
  });
  const confirmed = buildForecastContextProfile({
    series: "000001.KS",
    dates,
    prices: recovering,
    asOfDate: dates.at(-1),
    marketRegime: {},
  });
  const unconfirmed = buildForecastContextProfile({
    series: "000002.KS",
    dates,
    prices: declining,
    asOfDate: dates.at(-1),
    marketRegime: {},
  });

  assert.ok(base.scores.persistentDecline > 0.35);
  assert.ok(confirmed.state.drawdown.reversalReadiness > unconfirmed.state.drawdown.reversalReadiness);
  assert.ok(unconfirmed.state.drawdown.reversalReadiness <= 0.2);
});

test("market regime remains probabilistic and stress dominates a severe risk state", () => {
  const regime = buildMarketRegimeProbabilities({
    support: 0.1,
    risk: 2.4,
    range: 0.2,
    crisisScore: 90,
    leadingPhase: { phase: "slowdown" },
  });
  const total = Object.values(regime.probabilities).reduce((sum, value) => sum + value, 0);

  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.equal(regime.dominant, "stress");
  assert.ok(regime.probabilities.stress > regime.probabilities.expansion);
  assert.ok(regime.dominantProbability < 0.8);
});

test("market regime distinguishes recovery, slowdown, and balanced range transitions", () => {
  const recovery = buildMarketRegimeProbabilities({
    support: 0.8,
    risk: 0.45,
    range: 0.2,
    crisisScore: 20,
    adrRecentLow: 68,
    adrLatest: 82,
    leadingPhase: { phase: "expansion", recentDelta: 0.1 },
  });
  const slowdown = buildMarketRegimeProbabilities({
    support: 0.5,
    risk: 0.5,
    range: 0.4,
    crisisScore: 25,
    leadingPhase: { phase: "peak", recentDelta: -0.12 },
  });
  const range = buildMarketRegimeProbabilities({
    support: 0.3,
    risk: 0.25,
    range: 1.1,
    crisisScore: 10,
    leadingPhase: { phase: "neutral", recentDelta: 0 },
  });

  assert.equal(recovery.dominant, "recovery");
  assert.equal(slowdown.dominant, "slowdown");
  assert.equal(range.dominant, "range");
});

test("context profile exposes numeric diagnostics without changing forecast weights", () => {
  const dates = tradingDates(6 * 252);
  const prices = dates.map((_, index) => 100 + (index * 0.04) + (8 * Math.sin(index / 55)));
  const profile = buildForecastContextProfile({
    series: "218410.KQ",
    dates,
    prices,
    asOfDate: dates.at(-1),
    marketRegime: { support: 0.8, risk: 0.2, range: 0.3, leadingPhase: { phase: "expansion" } },
  });
  const features = contextProfileAuditFeatures(profile);

  assert.equal(profile.diagnosticOnly, true);
  assert.equal(features.context_profile_version, 1);
  assert.ok(Number.isFinite(features.profile_range_score));
  assert.ok(Number.isFinite(features.regime_probability_expansion));
  assert.equal(MAX_HISTORY_DAYS, 15 * 252);
});
