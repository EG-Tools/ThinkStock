import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/market-timing-evaluation.js");
const evaluation = globalThis.ThinkStockMarketTimingEvaluation;

test("evaluates exceptional and ordinary timing signals in separate cohorts", () => {
  const dates = Array.from({ length: 80 }, (_, index) => (
    new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10)
  ));
  const prices = dates.map((_, index) => 100 + index);
  const grouped = evaluation.evaluateSignalsByEntryMode([
    { date: dates[10], confirmationDate: dates[10], entryMode: "extreme-daily" },
    { date: dates[20], confirmationDate: dates[20], entryMode: "overheat-continuation" },
    { date: dates[30], confirmationDate: dates[30] },
  ], "sell", dates, prices, [5]);

  assert.deepEqual(Object.keys(grouped).sort(), ["extreme-daily", "overheat-continuation", "standard"]);
  assert.equal(grouped["extreme-daily"].horizons[5].samples, 1);
  assert.equal(grouped["overheat-continuation"].horizons[5].samples, 1);
  assert.equal(grouped.standard.horizons[5].samples, 1);
});

test("evaluates signals from confirmation dates without future leakage", () => {
  const dates = Array.from({ length: 90 }, (_, index) => {
    const date = new Date("2026-01-01T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const prices = dates.map((_, index) => index <= 40 ? 100 + index : 140 - (index - 40));
  const quality = evaluation.evaluateMarketTimingModel({
    signals: [{ date: dates[0], confirmationDate: dates[1] }],
    sellSignals: [{ date: dates[40], confirmationDate: dates[41] }],
  }, { dates, prices, horizons: [5, 20], indexKey: "^KS11" });

  assert.equal(quality.buy.horizons[5].hitRate, 1);
  assert.equal(quality.sell.horizons[20].hitRate, 1);
  assert.ok(quality.buy.horizons[5].meanDirectionalReturn > 0);
  assert.ok(quality.sell.horizons[20].meanDirectionalReturn > 0);
  assert.ok(quality.buy.horizons[5].hitRateLowerBound < 1);
  assert.equal(quality.context.market, "KOSPI");
  assert.ok(quality.buy.horizons[20].meanMaxFavorableReturn > 0);
  assert.equal(quality.buy.horizons[20].meanMaxAdverseReturn, 0);
  assert.ok(quality.sell.horizons[20].meanMaxFavorableReturn > 0);
  assert.equal(quality.pointInTimeSafe, true);
});

test("flags an impossible confirmation date before the detected signal", () => {
  const quality = evaluation.evaluateMarketTimingModel({
    signals: [{ date: "2026-01-03", confirmationDate: "2026-01-02" }],
  }, { dates: ["2026-01-02", "2026-01-03"], prices: [100, 101], horizons: [1] });
  assert.equal(quality.buy.invalidLookAhead, 1);
  assert.equal(quality.pointInTimeSafe, false);
});

test("summarizes point-in-time safety and sample-weighted hit rates", () => {
  const summary = evaluation.summarizeMarketTimingQuality(new Map([
    ["^KS11", { quality: {
      status: "usable",
      matureSamples: 40,
      pointInTimeSafe: true,
      context: { cohort: "KOSPI:low", market: "KOSPI", volatilityGroup: "low" },
      buy: { horizons: { 20: { samples: 10, hits: 7, hitRate: 0.7, meanDirectionalReturn: 0.04 } } },
      sell: { horizons: { 20: { samples: 5, hits: 3, hitRate: 0.6, meanDirectionalReturn: 0.03 } } },
    } }],
    ["^KQ11", { quality: {
      status: "limited",
      matureSamples: 12,
      pointInTimeSafe: false,
      context: { cohort: "KOSDAQ:high", market: "KOSDAQ", volatilityGroup: "high" },
      buy: { horizons: { 20: { samples: 10, hits: 5, hitRate: 0.5, meanDirectionalReturn: -0.02 } } },
      sell: { horizons: { 20: { samples: 5, hits: 2, hitRate: 0.4, meanDirectionalReturn: 0.01 } } },
    } }],
  ]));

  assert.equal(summary.modelCount, 2);
  assert.equal(summary.evaluatedModels, 2);
  assert.equal(summary.matureSamples, 52);
  assert.equal(summary.pointInTimeUnsafe, 1);
  assert.deepEqual(summary.statuses, { usable: 1, limited: 1, pending: 0, unknown: 0 });
  assert.equal(summary.buy[20].hitRate, 0.6);
  assert.equal(summary.sell[20].hitRate, 0.5);
  assert.equal(summary.buy[20].meanDirectionalReturn, 0.01);
  assert.equal(summary.sell[20].meanDirectionalReturn, 0.02);
  assert.ok(summary.buy[20].hitRateLowerBound < summary.buy[20].hitRate);
  assert.equal(summary.byCohort["KOSPI:low"].models, 1);
  assert.equal(summary.byCohort["KOSDAQ:high"].sell[20].samples, 5);
});

test("uses a conservative confidence lower bound for small signal samples", () => {
  assert.equal(evaluation.wilsonLowerBound(0, 0), null);
  assert.ok(evaluation.wilsonLowerBound(3, 3) < 0.5);
  assert.ok(evaluation.wilsonLowerBound(70, 100) > 0.6);
});

test("separates KOSPI and KOSDAQ volatility cohorts", () => {
  const stable = Array.from({ length: 300 }, (_, index) => 100 + (index * 0.02));
  const volatile = Array.from({ length: 300 }, (_, index) => 100 * Math.exp((index % 2 ? 1 : -1) * 0.04));

  assert.equal(evaluation.classifyTimingContext("005930.KS", stable).cohort, "KOSPI:low");
  assert.equal(evaluation.classifyTimingContext("247540.KQ", volatile).cohort, "KOSDAQ:high");
});

test("collapses repeated nearby markers into one signal episode", () => {
  const dates = Array.from({ length: 40 }, (_, index) => (
    new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10)
  ));
  const episodes = evaluation.collapseSignalEpisodes([
    { date: dates[5], confirmationDate: dates[5] },
    { date: dates[7], confirmationDate: dates[7] },
    { date: dates[20], confirmationDate: dates[20] },
  ], dates, { minimumGap: 5 });
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].episodeSize, 2);
  assert.equal(episodes[0].confirmationDate, dates[5]);
});

test("purges horizon overlap between development and chronological holdout", () => {
  const dates = Array.from({ length: 100 }, (_, index) => (
    new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10)
  ));
  const signals = [10, 50, 65, 72, 90].map((index) => ({
    date: dates[index],
    confirmationDate: dates[index],
  }));
  const split = evaluation.buildPurgedTimingHoldout(signals, dates, {
    horizons: [20],
    holdoutRatio: 0.3,
  });
  assert.equal(split.holdoutStartDate, dates[70]);
  assert.deepEqual(split.development.map((signal) => signal.date), [dates[10]]);
  assert.deepEqual(split.holdout.map((signal) => signal.date), [dates[72], dates[90]]);
  assert.equal(split.purged, 2);
});

test("reports raw markers, episodes, and holdout coverage separately", () => {
  const dates = Array.from({ length: 160 }, (_, index) => (
    new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10)
  ));
  const prices = dates.map((_, index) => 100 + index);
  const quality = evaluation.evaluateMarketTimingModel({
    signals: [10, 12, 40, 80, 120, 140].map((index) => ({
      date: dates[index],
      confirmationDate: dates[index],
    })),
    sellSignals: [],
  }, { dates, prices, horizons: [5], indexKey: "^KS11", episodeOptions: { minimumGap: 5 } });
  assert.equal(quality.rawSignalCount.buy, 6);
  assert.equal(quality.episodeCount.buy, 5);
  assert.ok(quality.holdoutMatureSamples > 0);
  assert.equal(typeof quality.overfitRisk, "boolean");
});

test("quality gate rejects signals without enough honest holdout evidence", () => {
  const gate = evaluation.evaluateMarketTimingQualityGate({
    pointInTimeSafe: true,
    overfitRisk: false,
    validation: {
      holdout: {
        buy: { horizons: { 20: { samples: 2, hits: 2, hitRate: 1, meanDirectionalReturn: 0.1 } } },
        sell: { horizons: { 20: { samples: 0 } } },
      },
    },
  });
  assert.equal(gate.eligible, false);
  assert.ok(gate.reasons.includes("insufficient-holdout-samples"));
});

test("rejects a timing model whose apparent quality is concentrated in one year", () => {
  const coverage = evaluation.timingTemporalCoverage(Array.from({ length: 14 }, (_, index) => ({
    confirmationDate: index < 12
      ? `2024-${String(index + 1).padStart(2, "0")}-01`
      : `${2022 + index - 12}-01-03`,
  })));
  assert.equal(coverage.eligibleForCheck, true);
  assert.equal(coverage.passed, false);

  const gate = evaluation.evaluateMarketTimingQualityGate({
    pointInTimeSafe: true,
    overfitRisk: false,
    temporalCoverage: coverage,
    validation: {
      holdout: {
        buy: { horizons: { 20: { samples: 10, hits: 8, meanDirectionalReturn: 0.03 } } },
        sell: { horizons: { 20: { samples: 10, hits: 8, meanDirectionalReturn: 0.03 } } },
      },
    },
  });
  assert.equal(gate.eligible, false);
  assert.ok(gate.reasons.includes("temporally-concentrated-signals"));
});

test("measures development-to-holdout deterioration by signal side", () => {
  const gap = evaluation.timingGeneralizationGap({
    development: {
      buy: { horizons: { 20: { samples: 20, hitRate: 0.8, meanDirectionalReturn: 0.08 } } },
      sell: { horizons: { 20: { samples: 20, hitRate: 0.6, meanDirectionalReturn: 0.02 } } },
    },
    holdout: {
      buy: { horizons: { 20: { samples: 8, hitRate: 0.4, meanDirectionalReturn: -0.01 } } },
      sell: { horizons: { 20: { samples: 8, hitRate: 0.58, meanDirectionalReturn: 0.018 } } },
    },
  }, 20);
  assert.equal(gap.bySide.buy.overfit, true);
  assert.equal(gap.bySide.sell.overfit, false);
  assert.equal(gap.overfit, true);
});

test("quality gate rejects a weak side even when the combined result looks healthy", () => {
  const gate = evaluation.evaluateMarketTimingQualityGate({
    pointInTimeSafe: true,
    overfitRisk: false,
    validation: {
      holdout: {
        buy: { horizons: { 20: {
          samples: 20,
          hits: 18,
          hitRate: 0.9,
          meanDirectionalReturn: 0.08,
        } } },
        sell: { horizons: { 20: {
          samples: 8,
          hits: 1,
          hitRate: 0.125,
          meanDirectionalReturn: -0.04,
        } } },
      },
    },
  });

  assert.equal(gate.metrics.hitRate > 0.65, true);
  assert.equal(gate.eligible, false);
  assert.ok(gate.reasons.includes("sell-weak-hit-rate-lower-bound"));
  assert.ok(gate.reasons.includes("sell-non-positive-holdout-return"));
});

test("records holdout timing quality by entry mode", () => {
  const dates = Array.from({ length: 120 }, (_, index) => (
    new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10)
  ));
  const prices = dates.map((_, index) => 100 + index);
  const quality = evaluation.evaluateMarketTimingModel({
    signals: [80, 100].map((index, offset) => ({
      date: dates[index],
      confirmationDate: dates[index],
      entryMode: offset ? "extreme-daily" : "standard",
    })),
    sellSignals: [],
  }, { dates, prices, horizons: [5], holdoutRatio: 0.4 });

  assert.equal(quality.validation.holdoutByEntryMode.buy.standard.horizons[5].samples, 1);
  assert.equal(quality.validation.holdoutByEntryMode.buy["extreme-daily"].horizons[5].samples, 1);
});

test("promotes a timing challenger only when holdout quality improves", () => {
  const quality = (hits, directionalReturn, adverseReturn = -0.03) => ({
    pointInTimeSafe: true,
    overfitRisk: false,
    validation: {
      holdout: {
        buy: { horizons: { 20: {
          samples: 20,
          hits,
          hitRate: hits / 20,
          meanDirectionalReturn: directionalReturn,
          meanMaxAdverseReturn: adverseReturn,
          meanMaxFavorableReturn: 0.08,
        } } },
        sell: { horizons: { 20: { samples: 0 } } },
      },
    },
  });
  const result = evaluation.compareMarketTimingCandidates(
    quality(11, 0.02),
    quality(15, 0.045),
  );
  assert.equal(result.promote, true);
  assert.equal(result.decision, "promote-challenger");

  const unsafe = evaluation.compareMarketTimingCandidates(
    quality(11, 0.02),
    { ...quality(15, 0.045), pointInTimeSafe: false },
  );
  assert.equal(unsafe.promote, false);
  assert.ok(unsafe.reasons.includes("point-in-time-unsafe"));
});
