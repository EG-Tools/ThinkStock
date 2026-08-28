import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/runtime-foundation.mjs");
await import("../../shared/ai-context-classifier.mjs");
const { default: calibration } = await import("../../docs/modules/ai-forecast-calibration.mjs");

const audit = (overrides = {}) => ({
  format: "ai-audit-v1",
  features: {
    projected_volatility: 0.02,
    market_is_kospi: 1,
    regime_support: 0.65,
    regime_risk: 0.1,
    regime_range: 0.2,
    regime_crisis_score: 10,
    ...overrides,
  },
});

function scoredRecord(index, error = 0.08) {
  const asOf = `2025-${String(index + 1).padStart(2, "0")}-01`;
  const score = {
    actualDate: `2025-${String(index + 1).padStart(2, "0")}-28`,
    signedLogError: error,
    directionCorrect: true,
    intervalCovered: true,
  };
  return {
    ticker: `${String(100000 + index).slice(-6)}.KS`,
    asOf,
    modelVersion: "v2",
    audit: audit(),
    horizons: Object.fromEntries(calibration.HORIZONS.map((horizon) => [horizon, { score }])),
  };
}

function forecast(overrides = {}) {
  const prices = Array.from({ length: 127 }, (_, index) => 100 + index * 0.1);
  return {
    dates: ["2026-07-01"],
    prices,
    lowerPrices: prices.map((value) => value * 0.9),
    upperPrices: prices.map((value) => value * 1.1),
    scenarios: {
      upside: { weight: 35, probability: 35, prices: prices.map((value) => value * 1.1) },
      sideways: { weight: 35, probability: 35, prices },
      downside: { weight: 30, probability: 30, prices: prices.map((value) => value * 0.9) },
    },
    audit: audit(),
    model: { version: "v2" },
    validation: { calibratedProbability: false },
    ...overrides,
  };
}

test("uses completed forecasts from the same stock group and regime to estimate bias", () => {
  const records = Array.from({ length: 8 }, (_, index) => scoredRecord(index));
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: forecast(),
    records,
  });

  assert.equal(profile.applied, true);
  assert.equal(profile.horizons[126].tier, "cohort-regime");
  assert.equal(profile.horizons[126].samples, 8);
  assert.ok(profile.horizons[126].correction > 0);
  assert.ok(profile.horizons[126].correction < 0.08);
});

test("calibrates an overbought forecast from matching shock records before normal records", () => {
  const overboughtFeatures = {
    price_shock_active: 1,
    price_shock_signed_strength: 1.1,
  };
  const matching = Array.from({ length: 6 }, (_, index) => {
    const record = scoredRecord(index, -0.05);
    return { ...record, audit: audit(overboughtFeatures) };
  });
  const normal = Array.from({ length: 8 }, (_, index) => scoredRecord(index + 2, 0.08));
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: forecast({ audit: audit(overboughtFeatures) }),
    records: [...matching, ...normal],
  });

  assert.equal(profile.context.shock, "overbought");
  assert.equal(profile.horizons[126].tier, "shock-cohort");
  assert.equal(profile.horizons[126].samples, 6);
  assert.ok(profile.horizons[126].correction < 0);
});

test("prefers the stock's own completed history before broader market cohorts", () => {
  const records = Array.from({ length: 5 }, (_, index) => ({
    ...scoredRecord(index, 0.05),
    ticker: "005930.KS",
  }));
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: forecast(),
    records,
  });

  assert.equal(profile.horizons[126].tier, "own-regime");
  assert.equal(profile.horizons[126].samples, 5);
});

test("keeps range-bound evidence ahead of broader uptrend cohorts", () => {
  const rangeRows = Array.from({ length: 8 }, (_, index) => {
    const record = scoredRecord(index, -0.05);
    return {
      ...record,
      audit: audit({
        price_range_bound_score: 0.8,
        ...(index < 4 ? { leading_recovery: 1 } : { leading_peak: 1 }),
      }),
    };
  });
  const uptrendRows = Array.from({ length: 8 }, (_, index) => {
    const record = scoredRecord(index, 0.12);
    return {
      ...record,
      ticker: `${String(200000 + index).slice(-6)}.KS`,
      audit: audit({
        price_annualized_return: 0.2,
        price_trend_r_squared: 0.5,
      }),
    };
  });
  const profile = calibration.buildCalibrationProfile({
    ticker: "078930.KS",
    forecast: forecast({ audit: audit({ price_range_bound_score: 0.8 }) }),
    records: [...rangeRows, ...uptrendRows],
  });

  assert.equal(profile.context.trend, "range");
  assert.equal(profile.horizons[126].tier, "trend-regime");
  assert.equal(profile.horizons[126].samples, 8);
  assert.ok(profile.horizons[126].correction < 0);
});

test("calibration preserves the anchor and shifts paths without overriding hard negative gates", () => {
  const records = Array.from({ length: 8 }, (_, index) => scoredRecord(index));
  const base = forecast();
  const profile = calibration.buildCalibrationProfile({ ticker: "005930.KS", forecast: base, records });
  const adjusted = calibration.applyForecastCalibration(base, profile);
  assert.equal(adjusted.prices[0], base.prices[0]);
  assert.ok(adjusted.prices[126] > base.prices[126]);
  assert.equal(adjusted.validation.calibratedProbability, true);
  assert.equal(Object.values(adjusted.scenarios).reduce((sum, item) => sum + item.weight, 0), 100);

  const blockedBase = forecast({ audit: audit({ corporate_terminal_risk: 1 }) });
  const blocked = calibration.applyForecastCalibration(blockedBase, profile);
  assert.equal(blocked.prices[126], blockedBase.prices[126]);
});

test("does not claim calibration when the completed sample is insufficient", () => {
  const base = forecast();
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: base,
    records: [scoredRecord(0), scoredRecord(1)],
  });
  assert.equal(profile.applied, false);
  assert.equal(calibration.applyForecastCalibration(base, profile), base);
});

test("lowers an overconfident upside scenario after comparable realized declines", () => {
  const records = Array.from({ length: 8 }, (_, index) => {
    const record = scoredRecord(index, 0);
    return {
      ...record,
      audit: {
        ...record.audit,
        scenarioWeights: { upside: 70, sideways: 20, downside: 10 },
      },
      horizons: Object.fromEntries(calibration.HORIZONS.map((horizon) => [horizon, {
        score: {
          ...record.horizons[horizon].score,
          actualLogReturn: -0.15,
        },
      }])),
    };
  });
  const base = forecast();
  const profile = calibration.buildCalibrationProfile({ ticker: "005930.KS", forecast: base, records });
  const adjusted = calibration.applyForecastCalibration(base, profile);
  assert.equal(profile.horizons[126].probability.samples, 8);
  assert.ok(profile.horizons[126].probability.observed.downside > profile.horizons[126].probability.predicted.downside);
  assert.ok(adjusted.scenarios.upside.weight < base.scenarios.upside.weight);
  assert.ok(adjusted.scenarios.downside.weight > base.scenarios.downside.weight);
});

test("widens uncertainty bands when comparable forecasts repeatedly miss their interval", () => {
  const records = Array.from({ length: 8 }, (_, index) => {
    const record = scoredRecord(index, 0.12);
    return {
      ...record,
      horizons: Object.fromEntries(calibration.HORIZONS.map((horizon) => [horizon, {
        score: { ...record.horizons[horizon].score, intervalCovered: false },
      }])),
    };
  });
  const base = forecast();
  const profile = calibration.buildCalibrationProfile({ ticker: "005930.KS", forecast: base, records });
  const adjusted = calibration.applyForecastCalibration(base, profile);
  const baseWidth = Math.log(base.upperPrices[126] / base.lowerPrices[126]);
  const adjustedWidth = Math.log(adjusted.upperPrices[126] / adjusted.lowerPrices[126]);

  assert.ok(profile.horizons[126].intervalScale > 1);
  assert.ok(adjustedWidth > baseWidth);
});

test("reports weak skill against a no-change baseline and lowers confidence honestly", () => {
  const records = Array.from({ length: 8 }, (_, index) => {
    const record = scoredRecord(index, 0.14);
    return {
      ...record,
      horizons: Object.fromEntries(calibration.HORIZONS.map((horizon) => [horizon, {
        score: {
          ...record.horizons[horizon].score,
          actualLogReturn: 0.03,
          momentumAbsLogError: 0.04,
          directionCorrect: false,
          intervalCovered: false,
        },
      }])),
    };
  });
  const base = forecast();
  const profile = calibration.buildCalibrationProfile({ ticker: "005930.KS", forecast: base, records });
  const adjusted = calibration.applyForecastCalibration(base, profile);

  assert.ok(profile.horizons[126].skillVsNoChange < 0);
  assert.ok(profile.horizons[126].skillVsMomentum < 0);
  assert.ok(profile.horizons[126].confidenceScale < 1);
  assert.ok(profile.horizons[126].intervalScale > 1);
  assert.equal(
    adjusted.audit.features.journal_skill_vs_no_change_126,
    profile.horizons[126].skillVsNoChange,
  );
  assert.equal(
    adjusted.audit.features.journal_skill_vs_momentum_126,
    profile.horizons[126].skillVsMomentum,
  );
});

test("moves scenario probabilities toward neutral when historical confidence is weak", () => {
  const base = forecast({
    scenarios: {
      upside: { weight: 70, probability: 70, prices: [100, 120] },
      sideways: { weight: 20, probability: 20, prices: [100, 100] },
      downside: { weight: 10, probability: 10, prices: [100, 80] },
    },
  });
  const profile = {
    applied: true,
    horizons: Object.fromEntries(calibration.HORIZONS.map((horizon) => [horizon, {
      correction: 0,
      intervalScale: 1,
      confidenceScale: 0.5,
      probability: { logAdjustments: {}, confidenceScale: 0.5 },
    }])),
  };
  const adjusted = calibration.applyForecastCalibration(base, profile);

  assert.ok(adjusted.scenarios.upside.weight < base.scenarios.upside.weight);
  assert.ok(adjusted.scenarios.downside.weight > base.scenarios.downside.weight);
  assert.equal(Object.values(adjusted.scenarios).reduce((sum, item) => sum + item.weight, 0), 100);
});

test("does not turn consistently wrong directional history into a price correction", () => {
  const records = Array.from({ length: 8 }, (_, index) => {
    const record = scoredRecord(index, 0.12);
    return {
      ...record,
      horizons: Object.fromEntries(calibration.HORIZONS.map((horizon) => [horizon, {
        score: {
          ...record.horizons[horizon].score,
          actualLogReturn: -0.03,
          directionCorrect: false,
        },
      }])),
    };
  });
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: forecast(),
    records,
  });

  assert.equal(profile.format, "ai-calibration-v10");
  assert.equal(profile.horizons[126].directionQuality, 0);
  assert.equal(profile.horizons[126].correction, 0);
});

test("selects a structural archetype and market phase before broad cohorts", () => {
  const contextFeatures = {
    context_profile_version: 1,
    profile_range_score: 0.9,
    regime_probability_slowdown: 0.8,
  };
  const records = Array.from({ length: 8 }, (_, index) => {
    const record = scoredRecord(index, 0.08);
    return {
      ...record,
      audit: audit({
        ...contextFeatures,
        projected_volatility: index < 4 ? 0.01 : 0.04,
      }),
    };
  });
  const profile = calibration.buildCalibrationProfile({
    ticker: "078930.KS",
    forecast: forecast({ audit: audit(contextFeatures) }),
    records,
  });

  assert.equal(profile.context.archetype, "range");
  assert.equal(profile.context.probabilisticRegime, "slowdown");
  assert.equal(profile.horizons[126].tier, "archetype-phase-regime");
  assert.equal(profile.horizons[126].walkForward.applied, true);
  assert.ok(profile.horizons[126].correction > 0);
});

test("rejects a historical bias when the newest holdout reverses direction", () => {
  const samples = Array.from({ length: 10 }, (_, index) => ({
    asOf: `2025-${String(index + 1).padStart(2, "0")}-01`,
    error: index < 7 ? 0.08 : -0.08,
    weight: 1,
    directionCorrect: true,
    intervalCovered: true,
  }));
  const result = calibration.walkForwardBiasValidation(samples, 126);

  assert.equal(result.applied, true);
  assert.equal(result.passed, false);
  assert.equal(result.scale, 0);
  assert.ok(result.correctedError > result.baselineError);
});

test("carries the automatic forecast quality summary into the calibration audit", () => {
  const quality = { format: "ai-forecast-quality-v1", status: "limited", totalSamples: 4 };
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: forecast(),
    records: [],
    quality,
  });
  assert.equal(profile.quality, quality);
});

test("moves scenario probabilities toward neutral only after quality has enough weak samples", () => {
  const base = forecast();
  const quality = {
    format: "ai-forecast-quality-v1",
    status: "usable",
    totalSamples: 24,
    horizons: {
      126: {
        samples: 24,
        directionAccuracy: 0.25,
        skillVsNoChange: -0.5,
        skillVsMomentum: -0.4,
      },
    },
  };
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: base,
    records: [],
    quality,
  });
  const adjusted = calibration.applyForecastCalibration(base, profile);
  const distanceFromNeutral = (scenarios) => ["upside", "sideways", "downside"]
    .reduce((sum, key) => sum + Math.abs(Number(scenarios[key].weight) - (100 / 3)), 0);

  assert.ok(profile.qualityConfidenceScale < 1);
  assert.equal(profile.applied, true);
  assert.ok(distanceFromNeutral(adjusted.scenarios) < distanceFromNeutral(base.scenarios));
  assert.equal(
    adjusted.audit.features.journal_quality_confidence_scale,
    profile.qualityConfidenceScale,
  );
});

test("summarizes forecast quality by the current market regime", () => {
  const first = calibration.buildForecastQualityDiagnostic({
    context: {
      market: "KOSPI",
      regime: "risk-off",
      behavior: "defensive",
      trend: "range",
      cycle: "late-cycle",
    },
    totalSamples: 40,
    qualityConfidenceScale: 0.9,
    applied: true,
    horizons: {
      126: {
        samples: 8,
        tier: "market-regime",
        confidenceScale: 0.8,
        directionAccuracy: 0.5,
        skillVsNoChange: -0.1,
        intervalCoverage: 0.6,
        probability: { confidenceScale: 0.95, brierScore: 0.24 },
      },
    },
  }, { status: "usable", totalSamples: 16 }, { asOf: "2026-08-13" });
  const second = calibration.buildForecastQualityDiagnostic({
    context: {
      market: "KOSPI",
      regime: "risk-off",
      behavior: "market",
      trend: "downtrend",
      cycle: "late-cycle",
    },
    totalSamples: 60,
    qualityConfidenceScale: 0.9,
    applied: true,
    horizons: {
      126: {
        samples: 12,
        tier: "group-regime",
        confidenceScale: 0.9,
        directionAccuracy: 0.6,
        skillVsNoChange: 0.1,
        probability: { confidenceScale: 1 },
      },
    },
  }, { status: "limited", totalSamples: 20 }, { asOf: "2026-08-13" });
  const summary = calibration.summarizeForecastQualityDiagnostics(new Map([
    ["005930.KS", first],
    ["000660.KS", second],
  ]));

  assert.equal(first.confidenceScale, 0.8);
  assert.equal(first.tier, "market-regime");
  assert.deepEqual(summary.statuses, { usable: 1, limited: 1, pending: 0, unknown: 0 });
  assert.equal(summary.byContext["KOSPI:risk-off"].seriesCount, 2);
  assert.equal(summary.byContext["KOSPI:risk-off"].samples, 20);
  assert.equal(summary.byContext["KOSPI:risk-off"].averageConfidenceScale, 0.85);
  assert.equal(summary.byContext["KOSPI:risk-off"].directionAccuracy, 0.56);
  assert.equal(summary.byCohort["KOSPI:risk-off:unknown"].seriesCount, 2);
  assert.equal(summary.byShock["KOSPI:normal"].seriesCount, 2);
  assert.deepEqual(summary.weakSeries, ["005930.KS", "000660.KS"]);
});

test("uses effective sample size so a few dominant records cannot overstate calibration evidence", () => {
  const records = Array.from({ length: 8 }, (_, index) => {
    const record = scoredRecord(index, 0.1);
    return {
      ...record,
      asOf: index === 7 ? "2026-06-30" : `2020-0${index + 1}-01`,
      horizons: Object.fromEntries(calibration.HORIZONS.map((horizon) => [horizon, {
        score: {
          ...record.horizons[horizon].score,
          actualDate: index === 7 ? "2026-06-30" : `2020-0${index + 1}-28`,
          actualLogReturn: 0.12,
          momentumAbsLogError: 0.02,
        },
      }])),
    };
  });
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: forecast(),
    records,
  });

  assert.ok(profile.horizons[126].effectiveSamples < profile.horizons[126].samples);
  assert.equal(profile.qualitySource, "global");
  assert.equal(profile.contextQuality.horizons[126].status, "limited");
});

test("keeps KOSPI volatility cohorts separate in quality diagnostics", () => {
  const summary = calibration.summarizeForecastQualityDiagnostics({
    low: { market: "KOSPI", regime: "range", volatilityGroup: "low", horizonSamples: 10, confidenceScale: 0.9 },
    high: { market: "KOSPI", regime: "range", volatilityGroup: "high", horizonSamples: 12, confidenceScale: 0.7 },
  });

  assert.equal(summary.byContext["KOSPI:range"].seriesCount, 2);
  assert.equal(summary.byCohort["KOSPI:range:low"].seriesCount, 1);
  assert.equal(summary.byCohort["KOSPI:range:high"].samples, 12);
});

test("validates report-backed forecasts as a separate cohort before broad calibration", () => {
  const reportFeatures = {
    broker_research_reports: 3,
    broker_research_confidence: 0.7,
  };
  const reportRows = Array.from({ length: 8 }, (_, index) => ({
    ...scoredRecord(index, -0.06),
    audit: audit(reportFeatures),
  }));
  const broadRows = Array.from({ length: 8 }, (_, index) => ({
    ...scoredRecord(index, 0.08),
    ticker: `${String(200000 + index).slice(-6)}.KS`,
  }));
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: forecast({ audit: audit(reportFeatures) }),
    records: [...reportRows, ...broadRows],
  });

  assert.equal(profile.context.researchCohort, "report-backed");
  assert.equal(profile.horizons[126].tier, "research-cohort-regime");
  assert.ok(profile.horizons[126].correction < 0);

  const diagnostic = calibration.buildForecastQualityDiagnostic(profile, null);
  const summary = calibration.summarizeForecastQualityDiagnostics({ report: diagnostic });
  assert.equal(diagnostic.brokerReportCount, 3);
  assert.equal(summary.byResearch["KOSPI:report-backed"].seriesCount, 1);
});

test("keeps overbought and oversold quality diagnostics separate", () => {
  const summary = calibration.summarizeForecastQualityDiagnostics({
    hot: {
      market: "KOSPI",
      regime: "risk-on",
      volatilityGroup: "high",
      shock: "overbought",
      horizonSamples: 10,
      confidenceScale: 0.8,
      directionAccuracy: 0.4,
    },
    washed: {
      market: "KOSPI",
      regime: "risk-off",
      volatilityGroup: "high",
      shock: "oversold",
      horizonSamples: 12,
      confidenceScale: 0.9,
      directionAccuracy: 0.75,
    },
  });

  assert.equal(summary.byShock["KOSPI:overbought"].samples, 10);
  assert.equal(summary.byShock["KOSPI:overbought"].directionAccuracy, 0.4);
  assert.equal(summary.byShock["KOSPI:oversold"].samples, 12);
  assert.equal(summary.byShock["KOSPI:oversold"].directionAccuracy, 0.75);
});

test("reduces confidence and widens uncertainty when core forecast inputs are stale", () => {
  const base = forecast({
    dates: ["2026-08-13"],
    audit: {
      ...audit({ environment_coverage: 0.25 }),
      asOfDate: "2026-08-13",
      priceAsOfDate: "2026-07-20",
      sourceDates: {
        price: "2026-07-20",
        market: "2026-07-20",
        auxiliary: "2026-07-18",
        credit: "2026-07-10",
        macro: "2026-04-01",
      },
    },
  });
  const profile = calibration.buildCalibrationProfile({
    ticker: "005930.KS",
    forecast: base,
    records: [],
  });
  const adjusted = calibration.applyForecastCalibration(base, profile);
  const distanceFromNeutral = (scenarios) => calibration.HORIZONS.length && [
    "upside",
    "sideways",
    "downside",
  ].reduce((sum, key) => sum + Math.abs(Number(scenarios[key].weight) - (100 / 3)), 0);
  const baseWidth = Math.log(base.upperPrices[126] / base.lowerPrices[126]);
  const adjustedWidth = Math.log(adjusted.upperPrices[126] / adjusted.lowerPrices[126]);

  assert.equal(profile.applied, true);
  assert.equal(profile.inputReliability.status, "weak");
  assert.ok(profile.inputReliability.staleSources.includes("price"));
  assert.ok(profile.inputReliability.confidenceScale < 0.72);
  assert.ok(distanceFromNeutral(adjusted.scenarios) < distanceFromNeutral(base.scenarios));
  assert.ok(adjustedWidth > baseWidth);
  assert.equal(
    adjusted.audit.features.input_confidence_scale,
    profile.inputReliability.confidenceScale,
  );
});

test("keeps confidence intact for fresh well-covered inputs and matched evidence", () => {
  const reliability = calibration.buildInputReliability({
    dates: ["2026-08-13"],
    audit: {
      asOfDate: "2026-08-13",
      priceAsOfDate: "2026-08-13",
      sourceDates: {
        price: "2026-08-13",
        market: "2026-08-13",
        auxiliary: "2026-08-12",
        credit: "2026-08-10",
        macro: "2026-07-01",
      },
      features: { environment_coverage: 1 },
    },
    backtest: { validationSamples: 80, directionAccuracy: 0.6 },
  }, {
    effectiveSamples: 12,
    samples: 12,
    tier: "own-regime",
  });

  assert.equal(reliability.status, "usable");
  assert.equal(reliability.confidenceScale, 1);
  assert.deepEqual(reliability.staleSources, []);
});

test("never revives upside probability after a hard negative risk gate", () => {
  const base = forecast({
    audit: audit({ corporate_terminal_risk: 1 }),
    scenarios: {
      upside: { weight: 70, probability: 70, prices: [100, 120] },
      sideways: { weight: 20, probability: 20, prices: [100, 100] },
      downside: { weight: 10, probability: 10, prices: [100, 80] },
    },
  });
  const profile = {
    applied: true,
    qualityConfidenceScale: 0.6,
    inputReliability: { confidenceScale: 0.6, intervalScale: 1.2, staleSources: [] },
    horizons: Object.fromEntries(calibration.HORIZONS.map((horizon) => [horizon, {
      correction: 0.04,
      intervalScale: 1,
      confidenceScale: 0.7,
      probability: { logAdjustments: {}, confidenceScale: 0.7 },
    }])),
  };
  const adjusted = calibration.applyForecastCalibration(base, profile);

  assert.equal(adjusted.scenarios.upside.weight, 0);
  assert.equal(adjusted.scenarios.upside.probability, 0);
  assert.equal(Object.values(adjusted.scenarios).reduce((sum, item) => sum + item.weight, 0), 100);
});

test("reports stale-input confidence in the per-series quality diagnostic", () => {
  const diagnostic = calibration.buildForecastQualityDiagnostic({
    qualityConfidenceScale: 0.95,
    inputReliability: {
      confidenceScale: 0.6,
      status: "weak",
      staleSources: ["price", "market"],
    },
    context: { market: "KOSPI", regime: "risk-off" },
    horizons: {
      126: {
        samples: 8,
        effectiveSamples: 8,
        confidenceScale: 0.9,
        probability: { confidenceScale: 0.85 },
      },
    },
  }, { status: "usable", totalSamples: 24 }, { asOf: "2026-08-13" });

  assert.equal(diagnostic.confidenceScale, 0.6);
  assert.equal(diagnostic.inputStatus, "weak");
  assert.deepEqual(diagnostic.staleSources, ["price", "market"]);
});
