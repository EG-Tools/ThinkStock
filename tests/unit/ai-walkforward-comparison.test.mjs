import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWalkforwardAblation,
  classifyWalkforwardContext,
  classifyWalkforwardRegime,
  compareWalkforwardReports,
  evaluateWalkforwardComparison,
} from "../../shared/ai-walkforward-comparison.mjs";

function observation(overrides = {}) {
  return {
    series: "005930.KS",
    market: "KOSPI",
    targetType: "stock",
    horizon: 126,
    directionCorrect: true,
    scenarioCorrect: true,
    actualClass: "upside",
    scenarioWeights: { upside: 60, sideways: 25, downside: 15 },
    absoluteError: 0.08,
    noChangeError: 0.1,
    momentumError: 0.11,
    signedError: 0.02,
    audit: { features: { regime_support: 0.7, regime_risk: 0.2 } },
    ...overrides,
  };
}

test("walk-forward comparison separates market regime results", () => {
  const selection = { KOSPI: ["005930.KS", "000660.KS"], KOSDAQ: ["218410.KQ", "247540.KQ"] };
  const previous = {
    selection,
    enginePathVersion: "old",
    observations: [observation()],
  };
  const current = {
    selection,
    enginePathVersion: "new",
    observations: [observation({ absoluteError: 0.06, signedError: 0.01 })],
  };
  const comparison = compareWalkforwardReports(previous, current);

  assert.equal(classifyWalkforwardRegime(current.observations[0]), "risk-on");
  assert.equal(comparison.markets.KOSPI[126].after.samples, 1);
  assert.equal(comparison.regimes["risk-on"][126].delta.errorReduction, 0.25);
  assert.equal(comparison.volatilityGroups.mid[126].after.samples, 1);
  assert.equal(comparison.behaviors.market[126].after.samples, 1);
  assert.equal(comparison.cycles.neutral[126].after.samples, 1);
  assert.equal(comparison.cohorts.all[126].after.improvementVsMomentum, 0.4545);
});

test("walk-forward comparison keeps both models in the champion cohort", () => {
  const selection = { KOSPI: ["DEV.KS", "HOLD.KS"], KOSDAQ: [] };
  const previousRows = Array.from({ length: 24 }, (_, index) => observation({
    series: "HOLD.KS",
    cutoff: `2025-01-${String(index + 1).padStart(2, "0")}`,
    targetDate: `2025-07-${String(index + 1).padStart(2, "0")}`,
    audit: { features: { regime_support: 0.8, regime_risk: 0.1 } },
  }));
  const currentRows = previousRows.map((row) => observation({
    ...row,
    absoluteError: 0.06,
    audit: { features: { regime_support: 0.1, regime_risk: 0.8 } },
  }));
  const comparison = compareWalkforwardReports(
    { selection, observations: previousRows },
    { selection, observations: currentRows },
  );

  assert.equal(comparison.matchedObservations, 24);
  assert.equal(comparison.regimes["risk-on"][126].before.samples, 24);
  assert.equal(comparison.regimes["risk-on"][126].after.samples, 24);
  assert.equal(comparison.regimes["risk-off"][126].before.samples, 0);
  assert.equal(comparison.regimes["risk-off"][126].after.samples, 0);
});

test("walk-forward comparison reports index forecasts separately from stocks", () => {
  const selection = { KOSPI: ["005930.KS", "000660.KS"], KOSDAQ: [] };
  const indexRow = observation({
    series: "^KS11",
    targetType: "index",
    absoluteError: 0.04,
    noChangeError: 0.08,
    momentumError: 0.1,
  });
  const comparison = compareWalkforwardReports(
    { selection, observations: [indexRow] },
    { selection, observations: [indexRow] },
  );

  assert.equal(comparison.indices.KOSPI[126].after.samples, 1);
  assert.equal(comparison.indices.KOSPI[126].after.improvementVsNoChange, 0.5);
  assert.equal(comparison.indices.KOSPI[126].after.improvementVsMomentum, 0.6);
  assert.equal(comparison.cohorts.all[126].after.samples, 0);
});

test("walk-forward context separates cycle, volatility, and stock behavior", () => {
  const context = classifyWalkforwardContext(observation({
    audit: {
      features: {
        projected_volatility: 0.04,
        market_correlation: -0.3,
        market_beta: 0.5,
        leading_peak: 1,
      },
    },
  }));

  assert.deepEqual(context, {
    regime: "neutral",
    volatilityGroup: "high",
    behavior: "inverse",
    cycle: "late-cycle",
    archetype: "unclassified",
    archetypes: ["unclassified"],
    probabilisticRegime: "unclassified",
  });
});

test("walk-forward context records structural archetype and probabilistic regime", () => {
  const context = classifyWalkforwardContext(observation({
    audit: {
      features: {
        context_profile_version: 1,
        projected_volatility: 0.012,
        profile_trend_up_score: 0.2,
        profile_trend_down_score: 0.1,
        profile_range_score: 0.78,
        profile_cycle_score: 0.45,
        profile_defensive_score: 0.6,
        profile_high_volatility_score: 0.05,
        regime_probability_recovery: 0.08,
        regime_probability_expansion: 0.12,
        regime_probability_late_cycle: 0.18,
        regime_probability_slowdown: 0.14,
        regime_probability_stress: 0.1,
        regime_probability_range: 0.38,
      },
    },
  }));

  assert.equal(context.archetype, "range");
  assert.ok(context.archetypes.includes("defensive"));
  assert.equal(context.probabilisticRegime, "range");
});

test("walk-forward archetypes use trait-specific thresholds", () => {
  const context = classifyWalkforwardContext(observation({
    audit: {
      features: {
        context_profile_version: 1,
        profile_trend_up_score: 0.36,
        profile_trend_down_score: 0.2,
        profile_range_score: 0.64,
        profile_cycle_score: 0.41,
        profile_defensive_score: 0.26,
        profile_high_volatility_score: 0.64,
      },
    },
  }));

  assert.deepEqual(context.archetypes, ["trend-up", "defensive"]);
});

test("walk-forward guard rejects a meaningful holdout regression", () => {
  const selection = { KOSPI: ["DEV.KS", "HOLD.KS"], KOSDAQ: [] };
  const previousRows = Array.from({ length: 24 }, () => observation({ series: "HOLD.KS" }));
  const currentRows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    directionCorrect: false,
    absoluteError: 0.12,
    scenarioCorrect: false,
  }));
  const comparison = compareWalkforwardReports(
    { selection, observations: previousRows },
    { selection, observations: currentRows },
  );
  const result = evaluateWalkforwardComparison(comparison);

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((value) => value.includes("direction")));
  assert.ok(result.failures.some((value) => value.includes("error")));
});

test("walk-forward guard rejects worse signed bias and no-change skill", () => {
  const selection = { KOSPI: ["DEV.KS", "HOLD.KS"], KOSDAQ: [] };
  const previousRows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    absoluteError: 0.05,
    noChangeError: 0.1,
    signedError: 0.005,
  }));
  const currentRows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    absoluteError: 0.1,
    noChangeError: 0.1,
    signedError: 0.05,
  }));
  const result = evaluateWalkforwardComparison(compareWalkforwardReports(
    { selection, observations: previousRows },
    { selection, observations: currentRows },
  ));

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((value) => value.includes("signed bias")));
  assert.ok(result.failures.some((value) => value.includes("no-change skill")));
});

test("walk-forward guard rejects lost momentum-baseline skill", () => {
  const selection = { KOSPI: ["DEV.KS", "HOLD.KS"], KOSDAQ: [] };
  const previousRows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    absoluteError: 0.05,
    momentumError: 0.1,
  }));
  const currentRows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    absoluteError: 0.11,
    momentumError: 0.1,
  }));
  const result = evaluateWalkforwardComparison(compareWalkforwardReports(
    { selection, observations: previousRows },
    { selection, observations: currentRows },
  ));

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((value) => value.includes("momentum skill")));
});

test("walk-forward guard rejects an unchanged model below the absolute trust floor", () => {
  const selection = { KOSPI: ["DEV.KS", "HOLD.KS"], KOSDAQ: [] };
  const rows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    directionCorrect: false,
    absoluteError: 0.13,
    noChangeError: 0.1,
    scenarioCorrect: false,
    scenarioWeights: { upside: 90, sideways: 5, downside: 5 },
  }));
  const result = evaluateWalkforwardComparison(compareWalkforwardReports(
    { selection, observations: rows },
    { selection, observations: rows },
  ));

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((value) => value.includes("absolute direction")));
  assert.ok(result.failures.some((value) => value.includes("absolute no-change skill")));
});

test("walk-forward guard can pass regression safety while keeping trust experimental", () => {
  const selection = { KOSPI: ["DEV.KS", "HOLD.KS"], KOSDAQ: [] };
  const rows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    directionCorrect: true,
    absoluteError: 0.101,
    noChangeError: 0.1,
  }));
  const result = evaluateWalkforwardComparison(compareWalkforwardReports(
    { selection, observations: rows },
    { selection, observations: rows },
  ));

  assert.equal(result.passed, true);
  assert.equal(result.benchmarkOutperformanceConfirmed, false);
  assert.equal(result.promotionRecommended, false);
  assert.equal(result.decision, "insufficient-evidence");
  assert.ok(result.warnings.some((value) => value.includes("no-change")));
});

test("walk-forward guard promotes only a materially better challenger", () => {
  const selection = { KOSPI: ["DEV.KS", "HOLD.KS"], KOSDAQ: [] };
  const previousRows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    absoluteError: 0.08,
    noChangeError: 0.1,
    momentumError: 0.11,
  }));
  const currentRows = Array.from({ length: 24 }, () => observation({
    series: "HOLD.KS",
    absoluteError: 0.05,
    noChangeError: 0.1,
    momentumError: 0.11,
  }));
  const result = evaluateWalkforwardComparison(compareWalkforwardReports(
    { selection, observations: previousRows },
    { selection, observations: currentRows },
  ), { minimumComparableHorizons: 1 });

  assert.equal(result.passed, true);
  assert.equal(result.promotionRecommended, true);
  assert.equal(result.decision, "promote-challenger");
  assert.deepEqual(result.promotionEvidence.improvedHorizons, [126]);
});

test("walk-forward guard prefers improved probability calibration over top-class noise", () => {
  const result = evaluateWalkforwardComparison({
    cohorts: { holdout: {} },
    volatilityGroups: {
      low: {
        126: {
          after: { samples: 24 },
          delta: {
            directionAccuracyPoints: 0,
            errorReduction: 0,
            signedBiasAbsoluteIncrease: 0,
            noChangeSkillPoints: 0,
            scenarioAccuracyPoints: -12,
            scenarioBrierReduction: 0.04,
          },
        },
      },
    },
  });

  assert.equal(result.passed, true);
});

test("ablation reports whether company, market, and range inputs improve actual error", () => {
  const report = {
    observations: [
      observation({
        actualReturn: 0.04,
        predictedReturn: 0.05,
        audit: { features: { price_range_bound_score: 0.8 } },
        attribution: {
          components: {
            localModel: 0.02,
            consensus: 0.01,
            marketRegime: 0.015,
            rangeMeanReversion: 0.005,
          },
        },
      }),
      observation({
        actualReturn: -0.03,
        predictedReturn: -0.02,
        audit: { features: { price_range_bound_score: 0.7 } },
        attribution: {
          components: {
            localModel: -0.01,
            consensus: 0.005,
            marketRegime: -0.01,
            rangeMeanReversion: -0.005,
          },
        },
      }),
    ],
  };
  const result = buildWalkforwardAblation(report);
  assert.equal(result.byHorizon[126].variants.full.samples, 2);
  assert.equal(result.rangeBound[126].variants.full.samples, 2);
  assert.equal(result.byHorizon[126].impact.companyEvidence.samples, 2);
  assert.equal(result.probabilityMetricsExcluded, true);
});
