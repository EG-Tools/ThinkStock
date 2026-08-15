import assert from "node:assert/strict";
import test from "node:test";

import {
  QLIB_CHALLENGER_REPORT_FORMAT,
  QLIB_KRX_MANIFEST_FORMAT,
  buildQlibKrxManifest,
  evaluateQlibChallengerReport,
} from "../../shared/qlib-challenger-contract.mjs";

function sourcePayload() {
  const cohorts = {
    development: { KOSPI: ["000001.KS"], KOSDAQ: ["000002.KQ"] },
    holdout: { KOSPI: ["000003.KS"], KOSDAQ: ["000004.KQ"] },
    audit: { KOSPI: ["000005.KS"], KOSDAQ: ["000006.KQ"] },
    confirmationAudit: { KOSPI: ["000007.KS"], KOSDAQ: ["000008.KQ"] },
  };
  const series = Object.fromEntries(Object.values(cohorts).flatMap((markets) => (
    Object.values(markets).flat().map((ticker) => [ticker, {
      dates: ["2026-01-02", "2026-01-05"],
      prices: [100, 101],
    }])
  )));
  return {
    prices: {
      format: "thinkstock-ai-walkforward-prices-v2",
      endDate: "2026-08-14",
      seed: 7,
      validationSplit: {
        development: cohorts.development,
        holdout: cohorts.holdout,
      },
      auditSelection: cohorts.audit,
      confirmationAuditSelection: cohorts.confirmationAudit,
      breadthDevelopmentSelection: { KOSPI: [], KOSDAQ: [] },
      validationSampling: { version: "stratified-v7", profiles: {} },
      dataQuality: { requiredSeries: 8, volumeSeries: 8 },
      series,
    },
    context: { format: "thinkstock-ai-walkforward-context-v6" },
  };
}

test("KRX manifest keeps Korean rules and ticker-disjoint cohorts", () => {
  const { prices, context } = sourcePayload();
  const manifest = buildQlibKrxManifest(prices, context, {
    generatedAt: "2026-08-15T00:00:00.000Z",
  });
  assert.equal(manifest.format, QLIB_KRX_MANIFEST_FORMAT);
  assert.equal(manifest.market.code, "KR");
  assert.equal(manifest.market.tradeUnit, 1);
  assert.equal(manifest.market.dailyLimitThreshold, 0.30);
  assert.equal(manifest.validation.counts.development.total, 2);
  assert.match(manifest.validation.auditPolicy, /unread/);
});

test("KRX manifest rejects cohort leakage", () => {
  const { prices, context } = sourcePayload();
  prices.auditSelection.KOSPI = ["000001.KS"];
  assert.throws(() => buildQlibKrxManifest(prices, context), /cohort validation failed/);
});

function passingMetrics() {
  return {
    samples: 200,
    rankIcDays: 30,
    improvementVsNoChange: 0.04,
    directionAccuracy: 0.54,
    meanDailyRankIc: 0.03,
    topBottomActualSpread: 0.02,
  };
}

test("Qlib report never enables runtime blending automatically", () => {
  const report = {
    format: QLIB_CHALLENGER_REPORT_FORMAT,
    backend: { qlib: true },
    task: "cross-sectional-ranking",
    market: { code: "KR", dailyLimitThreshold: 0.30 },
    audit: { status: "completed" },
    confirmationAudit: { status: "completed" },
    dataQuality: { runtimeEligible: true },
    matchedAnchor: { passed: false },
    horizons: Object.fromEntries([20, 63, 126].map((horizon) => [horizon, {
      holdout: passingMetrics(),
      audit: passingMetrics(),
      confirmationAudit: passingMetrics(),
    }])),
  };
  const result = evaluateQlibChallengerReport(report);
  assert.equal(result.researchCandidate, true);
  assert.equal(result.runtimeIntegrationEligible, false);
  assert.equal(result.nextStep, "matched-anchor-comparison-required");
});

test("audit is ignored until at least two holdout horizons pass", () => {
  const failed = { ...passingMetrics(), meanDailyRankIc: -0.01, topBottomActualSpread: -0.01 };
  const report = {
    format: QLIB_CHALLENGER_REPORT_FORMAT,
    backend: { qlib: true },
    task: "cross-sectional-ranking",
    market: { code: "KR", dailyLimitThreshold: 0.30 },
    audit: { status: "completed" },
    confirmationAudit: { status: "completed" },
    horizons: {
      20: { holdout: passingMetrics(), audit: passingMetrics() },
      63: { holdout: failed, audit: passingMetrics() },
      126: { holdout: failed, audit: passingMetrics() },
    },
  };
  const result = evaluateQlibChallengerReport(report);
  assert.equal(result.holdoutPassed, false);
  assert.equal(result.auditPassed, false);
  assert.equal(result.auditWins, 0);
});

test("a completed audit failure retains the champion instead of requesting another audit", () => {
  const failed = { ...passingMetrics(), meanDailyRankIc: -0.02, topBottomActualSpread: -0.01 };
  const report = {
    format: QLIB_CHALLENGER_REPORT_FORMAT,
    backend: { qlib: true },
    task: "cross-sectional-ranking",
    market: { code: "KR", dailyLimitThreshold: 0.30 },
    audit: { status: "completed" },
    confirmationAudit: { status: "completed" },
    horizons: {
      20: { holdout: passingMetrics(), audit: passingMetrics(), confirmationAudit: passingMetrics() },
      63: { holdout: passingMetrics(), audit: failed, confirmationAudit: passingMetrics() },
      126: { holdout: failed, audit: failed, confirmationAudit: passingMetrics() },
    },
  };
  const result = evaluateQlibChallengerReport(report);
  assert.equal(result.holdoutPassed, true);
  assert.equal(result.auditPassed, false);
  assert.equal(result.nextStep, "keep-thinkstock-champion");
});

test("runtime assist requires repeated audits, matched anchors and data quality", () => {
  const report = {
    format: QLIB_CHALLENGER_REPORT_FORMAT,
    backend: { qlib: true },
    task: "cross-sectional-ranking",
    market: { code: "KR", dailyLimitThreshold: 0.30 },
    audit: { status: "completed" },
    confirmationAudit: { status: "completed" },
    dataQuality: { runtimeEligible: true },
    matchedAnchor: { passed: true },
    horizons: Object.fromEntries([20, 63, 126].map((horizon) => [horizon, {
      holdout: passingMetrics(),
      audit: passingMetrics(),
      confirmationAudit: passingMetrics(),
    }])),
  };
  const result = evaluateQlibChallengerReport(report);
  assert.equal(result.confirmationAuditPassed, true);
  assert.equal(result.runtimeIntegrationEligible, true);
  assert.equal(result.nextStep, "export-small-qlib-assist");
});
