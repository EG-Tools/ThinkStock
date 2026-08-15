import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAiReleaseGate } from "../../shared/ai-release-gate.mjs";

function fixtures(overrides = {}) {
  return {
    runtimePathVersion: "path-v20",
    runtimeChanged: false,
    summary: {
      championVersion: "local|path-v19",
      challengerVersion: "local|path-v20",
      activeVersion: "local|path-v19",
      regressionPassed: false,
      benchmarkOutperformanceConfirmed: false,
      releaseDecision: "keep-champion",
      pointInTime: { auditPassed: true, coverage: { companyEvidenceReady: false } },
    },
    comparison: {
      format: "thinkstock-ai-walkforward-comparison-v6",
      matchedObservations: 400,
    },
    ...overrides,
  };
}

test("blocks an unpromoted challenger from becoming the deployed runtime", () => {
  const result = evaluateAiReleaseGate(fixtures());
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("unpromoted-challenger-active"));
  assert.ok(result.warnings.includes("champion-retained"));
});

test("allows an unrelated release when the runtime still matches the champion", () => {
  const result = evaluateAiReleaseGate(fixtures({ runtimePathVersion: "path-v19" }));
  assert.equal(result.ok, true);
  assert.equal(result.activeVersion, "local|path-v19");
});

test("allows the documented operational incumbent only while its runtime files are unchanged", () => {
  const summary = {
    ...fixtures().summary,
    championVersion: "local|path-v19",
    challengerVersion: "local|path-v21",
    activeVersion: "local|path-v19",
    releaseDecision: "keep-champion",
    promotionAllowed: false,
  };
  const unchanged = evaluateAiReleaseGate(fixtures({
    runtimePathVersion: "path-v20",
    approvedIncumbentPathVersion: "path-v20",
    runtimeChanged: false,
    summary,
  }));
  const changed = evaluateAiReleaseGate(fixtures({
    runtimePathVersion: "path-v20",
    approvedIncumbentPathVersion: "path-v20",
    runtimeChanged: true,
    summary,
  }));

  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.runtimeIsApprovedIncumbent, true);
  assert.ok(unchanged.warnings.includes("approved-incumbent-differs-from-benchmark-champion"));
  assert.equal(changed.ok, false);
  assert.ok(changed.errors.includes("validation-version-mismatch"));
});

test("allows a challenger only after the validation summary promotes it", () => {
  const result = evaluateAiReleaseGate(fixtures({
    summary: {
      championVersion: "local|path-v19",
      challengerVersion: "local|path-v20",
      activeVersion: "local|path-v20",
      regressionPassed: true,
      benchmarkOutperformanceConfirmed: true,
      promotionAllowed: true,
      releaseDecision: "promote-challenger",
      pointInTime: { auditPassed: true, coverage: { companyEvidenceReady: true } },
    },
  }));
  assert.equal(result.ok, true);
});

test("blocks changed AI runtime code when the matched regression gate failed", () => {
  const result = evaluateAiReleaseGate(fixtures({ runtimeChanged: true }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("runtime-regression-detected"));
});

test("rejects stale validation versions and unmatched comparisons", () => {
  const result = evaluateAiReleaseGate(fixtures({
    summary: {
      championVersion: "local|path-v18",
      challengerVersion: "local|path-v19",
      activeVersion: "local|path-v18",
      regressionPassed: true,
      pointInTime: { auditPassed: true, coverage: { companyEvidenceReady: true } },
    },
    comparison: { format: "thinkstock-ai-walkforward-comparison-v5", matchedObservations: 0 },
  }));
  assert.ok(result.errors.includes("validation-version-mismatch"));
  assert.ok(result.errors.includes("comparison-format-outdated"));
  assert.ok(result.errors.includes("matched-observations-missing"));
});
