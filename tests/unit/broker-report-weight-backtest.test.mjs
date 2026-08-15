import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePolicyCandidates } from "../../scripts/backtest_broker_report_weights.mjs";

function risingRows() {
  return Array.from({ length: 150 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, 5 + index)).toISOString().slice(0, 10),
    close: 100 + index,
  }));
}

test("report weight calibration refuses to promote an undersized sample", () => {
  const result = evaluatePolicyCandidates({
    events: [{
      ticker: "005930.KS",
      reportId: "1",
      publishedDate: "2026-01-02",
      evidence: { epsChange: 0.2, roeChange: 2, parserConfidence: 0.8, primaryCoverage: 1 },
    }],
    priceByTicker: { "005930.KS": risingRows() },
  });
  assert.equal(result.recommendation.status, "keep-baseline");
  assert.equal(result.eventCount, 1);
});
