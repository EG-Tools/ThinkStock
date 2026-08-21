import test from "node:test";
import assert from "node:assert/strict";

import {
  compactTimingSignalOutcome,
  compareSellObjectives,
  newTimingSignalRows,
  stableTimingTickerBucket,
  summarizeTimingGroups,
  summarizeTimingOutcomes,
  summarizeTimingSegments,
  summarizeSellObjectives,
  summarizeSellObjectiveGroups,
  summarizeSellTailFailures,
  sellObjectivePromotionDecision,
  timingRegimeStability,
  timingSidePromotionDecision,
  timingTemporalStability,
  timingValidationSafety,
} from "../../shared/market-timing-evaluation.mjs";

function outcome({
  ticker = "000001.KS",
  date = "2024-01-02",
  regime = "range",
  hit = true,
  type = "buy",
} = {}) {
  return {
    ticker,
    kind: "stock",
    market: ticker.endsWith(".KQ") ? "KOSDAQ" : "KOSPI",
    type,
    date,
    actionDate: date,
    marketRegime: regime,
    directional20: hit ? 0.1 : -0.1,
    directional63: hit ? 0.1 : -0.1,
    return20: type === "buy" ? (hit ? 0.1 : -0.1) : (hit ? -0.1 : 0.1),
    return63: type === "buy" ? (hit ? 0.1 : -0.1) : (hit ? -0.1 : 0.1),
    direction20: hit,
    direction63: hit,
    excursionHit: hit,
    adverse20: hit ? -0.02 : -0.1,
    favorable20: hit ? 0.15 : 0.03,
    turningDistance: hit ? 0.01 : 0.05,
    vkospiPercentile: 0.5,
    tags: [],
  };
}

function cohortRows({ date, regime, hitCount, samples = 60, tickerPrefix = "01" }) {
  return Array.from({ length: samples }, (_, index) => outcome({
    ticker: `${tickerPrefix}${String(index).padStart(4, "0")}.KS`,
    date,
    regime,
    hit: index < hitCount,
  }));
}

test("summarizes timing quality and separates stock outcomes", () => {
  const summary = summarizeTimingOutcomes([
    outcome({ hit: true }),
    outcome({ ticker: "000002.KS", hit: false }),
  ]);

  assert.equal(summary.stock.buy.samples, 2);
  assert.equal(summary.stock.buy.direction20, 0.5);
  assert.equal(summary.stock.buy.composite, 0.5);
  assert.equal(summary.index.buy.samples, 0);
  assert.equal(summary.index.buy.meanReturn20, null);
  assert.equal(
    summarizeTimingGroups([outcome({ regime: "range" })], (row) => row.marketRegime)
      .range.stock.buy.samples,
    1,
  );
});

test("temporal stability requires improvements to recur across recent windows", () => {
  const periods = ["2022-06-01", "2023-06-01", "2024-06-01", "2025-06-01"];
  const baseline = periods.flatMap((date, index) => cohortRows({
    date,
    regime: "range",
    hitCount: 30,
    tickerPrefix: `1${index}`,
  }));
  const candidate = periods.flatMap((date, index) => cohortRows({
    date,
    regime: "range",
    hitCount: index === 2 ? 28 : 36,
    tickerPrefix: `1${index}`,
  }));
  const stability = timingTemporalStability(baseline, candidate, "buy");

  assert.equal(stability.validCohorts, 4);
  assert.equal(stability.positiveCohorts, 3);
  assert.ok(stability.meanCompositeDelta > 0);
  assert.ok(stability.worstCompositeDelta < 0);
});

test("regime stability exposes a candidate that succeeds in only one market state", () => {
  const regimes = ["risk-on", "range", "stress"];
  const baseline = regimes.flatMap((regime, index) => cohortRows({
    date: "2024-06-01",
    regime,
    hitCount: 30,
    tickerPrefix: `2${index}`,
  }));
  const candidate = regimes.flatMap((regime, index) => cohortRows({
    date: "2024-06-01",
    regime,
    hitCount: index === 0 ? 42 : 24,
    tickerPrefix: `2${index}`,
  }));
  const stability = timingRegimeStability(baseline, candidate, "buy");

  assert.equal(stability.validCohorts, 3);
  assert.equal(stability.positiveCohorts, 1);
  assert.ok(stability.worstCompositeDelta < 0);
});

test("validation safety includes long-term structural direction cohorts", () => {
  const baselineRows = Array.from({ length: 20 }, (_, index) => ({
    ...outcome({ ticker: `${String(index).padStart(6, "0")}.KS`, hit: index < 16 }),
    structuralDirection: "range",
  }));
  const candidateRows = Array.from({ length: 20 }, (_, index) => ({
    ...outcome({ ticker: `${String(index).padStart(6, "0")}.KS`, hit: index < 4 }),
    structuralDirection: "range",
  }));
  const safety = timingValidationSafety(
    summarizeTimingSegments(baselineRows),
    summarizeTimingSegments(candidateRows),
  );

  assert.equal(safety.passed, false);
  assert.ok(safety.issues.some((issue) => (
    issue.family === "byStructuralDirection" && issue.name === "range"
  )));
});

test("new signal detection treats nearby dates as one timing episode", () => {
  const baseline = [outcome({ date: "2024-01-10" })];
  const candidate = [
    outcome({ date: "2024-01-14" }),
    outcome({ ticker: "000002.KS", date: "2024-01-14" }),
  ];

  assert.deepEqual(
    newTimingSignalRows(candidate, baseline).map((row) => row.ticker),
    ["000002.KS"],
  );
});

test("promotion rejects an apparent average gain that fails across market regimes", () => {
  const bucketZeroTickers = [];
  for (let index = 0; bucketZeroTickers.length < 180; index += 1) {
    const ticker = `${String(index).padStart(6, "0")}.KS`;
    if (stableTimingTickerBucket(ticker) === 0) bucketZeroTickers.push(ticker);
  }
  const regimes = ["risk-on", "range", "stress"];
  const baseline = regimes.flatMap((regime, regimeIndex) => (
    Array.from({ length: 60 }, (_, index) => outcome({
      ticker: bucketZeroTickers[(regimeIndex * 60) + index],
      date: "2024-06-01",
      regime,
      hit: index < 30,
    }))
  ));
  const candidateHits = [54, 24, 24];
  const candidate = regimes.flatMap((regime, regimeIndex) => (
    Array.from({ length: 60 }, (_, index) => outcome({
      ticker: bucketZeroTickers[(regimeIndex * 60) + index],
      date: "2024-06-01",
      regime,
      hit: index < candidateHits[regimeIndex],
    }))
  ));
  const decision = timingSidePromotionDecision(baseline, candidate, "buy");

  assert.equal(decision.promote, false);
  assert.ok(decision.deltas.composite > 0);
  assert.ok(decision.reasons.includes("cohort-regression"));
  assert.ok(decision.reasons.includes("unstable-market-regimes"));
});

test("promotion excludes risk warnings from predictive accuracy", () => {
  const tickers = [];
  for (let index = 0; tickers.length < 120; index += 1) {
    const ticker = `${String(index).padStart(6, "0")}.KS`;
    if (stableTimingTickerBucket(ticker) === 0) tickers.push(ticker);
  }
  const baseline = tickers.map((ticker, index) => ({
    ...outcome({ ticker, hit: index < 60 }),
    signalRole: "predictive",
  }));
  const candidate = [
    ...baseline,
    ...tickers.map((ticker) => ({
      ...outcome({ ticker, hit: false }),
      signalRole: "warning",
    })),
  ];
  const decision = timingSidePromotionDecision(baseline, candidate, "buy");

  assert.equal(decision.candidate.samples, 120);
  assert.equal(decision.deltas.composite, 0);
  assert.deepEqual(decision.excludedWarnings, { baseline: 0, candidate: 120 });
});

test("sell objectives keep a quick correction separate from a medium trend reversal", () => {
  const rows = [
    {
      ...outcome({ type: "sell" }),
      return5: -0.06,
      return10: -0.08,
      return20: 0.02,
      return63: 0.04,
      directional20: -0.02,
      directional63: -0.04,
      direction5: true,
      direction10: true,
      direction20: false,
      direction63: false,
      persistentDirection: false,
      excursion10Hit: true,
      excursionHit: true,
      daysToExcursion20: 4,
    },
    {
      ...outcome({ ticker: "000002.KS", type: "sell" }),
      return5: 0.02,
      return10: 0.01,
      return20: -0.05,
      return63: -0.12,
      directional20: 0.05,
      directional63: 0.12,
      direction5: false,
      direction10: false,
      direction20: true,
      direction63: true,
      persistentDirection: true,
      excursion10Hit: false,
      excursionHit: false,
    },
  ];

  const summary = summarizeSellObjectives(rows);
  assert.equal(summary.shortCorrection.composite, 0.5);
  assert.equal(summary.shortCorrection.meanDaysToExcursion20, 4);
  assert.equal(summary.shortCorrection.meanNetExcursion20, 0.13);
  assert.equal(summary.shortCorrection.tailContainment20, 1);
  assert.equal(summary.shortCorrection.lowerDecileDirectional20, -0.02);
  assert.equal(summary.mediumTrendReversal.composite, 0.5);
  assert.equal(summary.mediumTrendReversal.tailContainment63, 1);
  assert.equal(summary.mediumTrendReversal.lowerDecileDirectional63, -0.04);
  assert.equal(
    summarizeSellObjectiveGroups(rows, (row) => row.signalFamily || "legacy").legacy.samples,
    2,
  );
});

test("compact signal diagnostics retain the short and medium objective fields", () => {
  const compact = compactTimingSignalOutcome({
    ...outcome({ type: "sell" }),
    return5: -0.04,
    return10: -0.08,
    direction5: true,
    direction10: true,
    persistentDirection: false,
    excursion10Hit: true,
    daysToExcursion20: 6,
  });

  assert.equal(compact.return5, -0.04);
  assert.equal(compact.direction10, true);
  assert.equal(compact.excursion10Hit, true);
  assert.equal(compact.daysToExcursion20, 6);
});

test("sell tail diagnostics retain only the worst predictive stock outcomes", () => {
  const rows = [
    {
      ...outcome({ ticker: "000001.KS", type: "sell" }),
      directional63: -0.45,
      return63: 0.45,
      signalRole: "predictive",
    },
    {
      ...outcome({ ticker: "000002.KQ", type: "sell" }),
      directional63: -0.2,
      return63: 0.2,
      signalRole: "predictive",
    },
    {
      ...outcome({ ticker: "000003.KS", type: "sell" }),
      directional63: -0.9,
      return63: 0.9,
      signalRole: "warning",
    },
  ];
  const failures = summarizeSellTailFailures(rows, {
    "000001.KS": "첫번째",
    "000002.KQ": "두번째",
  }, { limit: 1 });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].ticker, "000001.KS");
  assert.equal(failures[0].name, "첫번째");
  assert.equal(failures[0].directionalReturn, -0.45);
  assert.equal(failures[0].horizon, 63);
});

test("sell objective comparison exposes a short-term gain that harms trend reversal quality", () => {
  const sellRow = (ticker, shortHit, mediumHit) => ({
    ...outcome({ ticker, type: "sell" }),
    return5: shortHit ? -0.05 : 0.03,
    return10: shortHit ? -0.08 : 0.04,
    return20: mediumHit ? -0.06 : 0.05,
    return63: mediumHit ? -0.12 : 0.08,
    direction5: shortHit,
    direction10: shortHit,
    direction20: mediumHit,
    direction63: mediumHit,
    persistentDirection: mediumHit,
    excursion10Hit: shortHit,
    excursionHit: shortHit,
    daysToExcursion20: shortHit ? 5 : null,
  });
  const baseline = [
    sellRow("000001.KS", true, true),
    sellRow("000002.KS", true, true),
    sellRow("000003.KS", false, false),
    sellRow("000004.KS", false, false),
  ];
  const candidate = [
    sellRow("000001.KS", true, true),
    sellRow("000002.KS", true, false),
    sellRow("000003.KS", true, false),
    sellRow("000004.KS", false, false),
  ];

  const comparison = compareSellObjectives(baseline, candidate);
  assert.equal(comparison.deltas.shortCorrection.composite, 0.25);
  assert.equal(comparison.deltas.mediumTrendReversal.composite, -0.25);
});

test("sell objective promotion accepts one improved objective only when the other stays safe", () => {
  const rows = (shortHits, mediumHits) => Array.from({ length: 40 }, (_, index) => ({
    ...outcome({ ticker: `${String(index).padStart(6, "0")}.KS`, type: "sell" }),
    return5: index < shortHits ? -0.05 : 0.04,
    return10: index < shortHits ? -0.08 : 0.06,
    return20: index < mediumHits ? -0.06 : 0.05,
    return63: index < mediumHits ? -0.1 : 0.09,
    directional5: index < shortHits ? 0.05 : -0.04,
    directional10: index < shortHits ? 0.08 : -0.06,
    directional20: index < mediumHits ? 0.06 : -0.05,
    directional63: index < mediumHits ? 0.1 : -0.09,
    direction5: index < shortHits,
    direction10: index < shortHits,
    direction20: index < mediumHits,
    direction63: index < mediumHits,
    persistentDirection: index < mediumHits,
    excursion10Hit: index < shortHits,
    excursionHit: index < shortHits,
    daysToExcursion20: index < shortHits ? 5 : null,
  }));
  const baseline = rows(20, 20);
  const safeCandidate = rows(24, 20);
  const unsafeCandidate = rows(24, 10);

  const accepted = sellObjectivePromotionDecision(baseline, safeCandidate, {
    minimumSamples: 30,
  });
  const rejected = sellObjectivePromotionDecision(baseline, unsafeCandidate, {
    minimumSamples: 30,
  });
  assert.equal(accepted.promote, true);
  assert.deepEqual(accepted.promotedObjectives, ["short-correction"]);
  assert.equal(rejected.promote, false);
});
