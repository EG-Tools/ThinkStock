import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
  compareCompanyAnalysisPayloads,
  inspectCompanyAnalysisQuality,
  mergeCompanyFinancialRecords,
} from "../../shared/company-analysis-contract.mjs";

const ticker = "218410.KQ";

function completePayload(overrides = {}) {
  return {
    ok: true,
    ticker,
    financialSummaryVersion: FINANCIAL_SUMMARY_VERSION,
    financials: [
      { ticker, period: "2025-12", frequency: "annual", estimate: false, eps: 1131 },
      { ticker, period: "2026-03", frequency: "quarter", estimate: false, eps: 154 },
      { ticker, period: "2026-12", frequency: "annual", estimate: true, eps: 1983 },
    ],
    ...overrides,
  };
}

test("requires both annual and quarterly EPS data before a summary is current", () => {
  const partial = completePayload({
    financials: [{ ticker, period: "2026-12", frequency: "annual", estimate: true, eps: 1983 }],
  });
  const partialQuality = inspectCompanyAnalysisQuality(partial);
  assert.equal(partialQuality.completeFinancialSummary, false);
  assert.ok(partialQuality.issues.includes("missing-quarter-summary"));

  const completeQuality = inspectCompanyAnalysisQuality(completePayload());
  assert.equal(completeQuality.contractVersion, COMPANY_ANALYSIS_CONTRACT_VERSION);
  assert.equal(completeQuality.completeFinancialSummary, true);
  assert.equal(completeQuality.counts.actualEps, 2);
  assert.equal(completeQuality.counts.estimateEps, 1);
});

test("keeps completed DART EPS when a rolling provider record is merged later", () => {
  const [record] = mergeCompanyFinancialRecords([
    { ticker, period: "2025-12", frequency: "annual", estimate: false, eps: 1131, source: "DART" },
  ], [
    { ticker, period: "2025-12", frequency: "annual", estimate: false, eps: 1120, revenue: 5000, source: "Naver" },
  ]);
  assert.equal(record.eps, 1131);
  assert.equal(record.source, "DART");
  assert.equal(record.revenue, 5000);
});

test("compares value data while ignoring cache and request timing metadata", () => {
  const left = completePayload({ savedAt: 1, cached: false });
  const right = completePayload({ savedAt: 2, cached: true, stale: true });
  const matching = compareCompanyAnalysisPayloads(left, right);
  assert.equal(matching.equal, true);
  assert.equal(matching.left.fingerprint, matching.right.fingerprint);

  const changed = completePayload({
    financials: completePayload().financials.map((record, index) => (
      index === 2 ? { ...record, eps: 2100 } : record
    )),
  });
  const mismatch = compareCompanyAnalysisPayloads(left, changed);
  assert.equal(mismatch.equal, false);
  assert.deepEqual([...mismatch.differences], ["financials"]);
});
