import test from "node:test";
import assert from "node:assert/strict";

import { compareQlibObvAblation } from "../../shared/qlib-obv-ablation.mjs";

function report(featureSet, metrics = {}) {
  const featureNames = featureSet === "obv"
    ? [
      "return_20",
      "volume_surprise_20",
      "obv_change_20",
      "obv_change_63",
      "obv_price_divergence_20",
    ]
    : ["return_20", "volume_surprise_20"];
  return {
    featureSet,
    manifest: { priceFingerprint: "prices", contextFingerprint: "context" },
    sample: { featureNames },
    horizons: Object.fromEntries([20, 63, 126].map((horizon) => [horizon, {
      holdout: {
        samples: 120,
        firstDate: "2025-01-01",
        lastDate: "2025-12-31",
        meanDailyRankIc: 0.03,
        topBottomActualSpread: 0.02,
        directionAccuracy: 0.52,
        improvementVsNoChange: 0.04,
        ...(metrics[horizon] || {}),
      },
    }])),
  };
}

test("OBV ablation advances only after paired holdout gains", () => {
  const baseline = report("baseline");
  const candidate = report("obv", {
    20: { meanDailyRankIc: 0.034, topBottomActualSpread: 0.022 },
    63: { meanDailyRankIc: 0.033, topBottomActualSpread: 0.023 },
    126: { meanDailyRankIc: 0.031, topBottomActualSpread: 0.021 },
  });
  const result = compareQlibObvAblation(baseline, candidate);

  assert.equal(result.valid, true);
  assert.equal(result.wins, 2);
  assert.equal(result.passed, true);
  assert.equal(result.decision, "freeze-obv-for-sealed-audit");
  assert.equal(result.runtimeIntegrationEligible, false);
});

test("OBV ablation rejects sample drift and a severe horizon regression", () => {
  const baseline = report("baseline");
  const candidate = report("obv", {
    20: { meanDailyRankIc: 0.04, topBottomActualSpread: 0.03 },
    63: { samples: 119, meanDailyRankIc: 0.04, topBottomActualSpread: 0.03 },
    126: { meanDailyRankIc: 0.02, topBottomActualSpread: 0.01 },
  });
  const result = compareQlibObvAblation(baseline, candidate);

  assert.equal(result.horizons[63].samplesMatch, false);
  assert.equal(result.horizons[126].severeRegression, true);
  assert.equal(result.passed, false);
  assert.equal(result.decision, "keep-baseline");
});

test("OBV ablation rejects any non-OBV feature change", () => {
  const baseline = report("baseline");
  const candidate = report("obv");
  candidate.sample.featureNames.push("new_macro_feature");
  const result = compareQlibObvAblation(baseline, candidate);

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("non-obv-feature-set-mismatch"));
});
