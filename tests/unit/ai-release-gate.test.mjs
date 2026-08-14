import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAiReleaseGate } from "../../shared/ai-release-gate.mjs";

function fixtures(overrides = {}) {
  return {
    runtimePathVersion: "path-v20",
    runtimeChanged: false,
    summary: {
      challengerVersion: "local|path-v20",
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

test("allows an unrelated release while retaining the validated champion", () => {
  const result = evaluateAiReleaseGate(fixtures());
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes("champion-retained"));
});

test("blocks changed AI runtime code when the matched regression gate failed", () => {
  const result = evaluateAiReleaseGate(fixtures({ runtimeChanged: true }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("runtime-regression-detected"));
});

test("rejects stale validation versions and unmatched comparisons", () => {
  const result = evaluateAiReleaseGate(fixtures({
    summary: {
      challengerVersion: "local|path-v19",
      regressionPassed: true,
      pointInTime: { auditPassed: true, coverage: { companyEvidenceReady: true } },
    },
    comparison: { format: "thinkstock-ai-walkforward-comparison-v5", matchedObservations: 0 },
  }));
  assert.ok(result.errors.includes("validation-version-mismatch"));
  assert.ok(result.errors.includes("comparison-format-outdated"));
  assert.ok(result.errors.includes("matched-observations-missing"));
});
