import assert from "node:assert/strict";
import test from "node:test";

import { auditWalkforwardPointInTime } from "../../shared/ai-point-in-time-audit.mjs";

function report(overrides = {}) {
  return {
    sourceCoverage: { currentTop400ArtifactUsed: false },
    observations: [{
      series: "005930.KS",
      cutoff: "2025-01-10",
      targetDate: "2025-07-10",
      basePrice: 100,
      predictedPrice: 110,
      audit: {
        asOfDate: "2025-01-10",
        priceAsOfDate: "2025-01-10",
        sourceDates: { price: "2025-01-10", macro: "2024-11-01" },
      },
    }],
    ...overrides,
  };
}

test("point-in-time audit accepts sources available by the forecast cutoff", () => {
  const result = auditWalkforwardPointInTime(report());
  assert.equal(result.passed, true);
  assert.equal(result.auditedSourceDates, 2);
});

test("point-in-time audit rejects future inputs and a mismatched audit date", () => {
  const value = report();
  value.observations[0].audit.asOfDate = "2025-01-09";
  value.observations[0].audit.priceAsOfDate = "2025-01-08";
  value.observations[0].audit.sourceDates.macro = "2025-01-11";
  const result = auditWalkforwardPointInTime(value);
  assert.equal(result.passed, false);
  assert.equal(result.issueCounts["audit-as-of-mismatch"], 1);
  assert.equal(result.issueCounts["audit-price-as-of-mismatch"], 1);
  assert.equal(result.issueCounts["future-source-date"], 1);
});
