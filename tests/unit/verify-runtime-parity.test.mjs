import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
} from "../../shared/company-analysis-contract.mjs";
import { RUNTIME_API_VERSION_HEADER } from "../../shared/runtime-api-contract.mjs";
import {
  fetchRemoteCompanyAnalysis,
  verifyCompanyAnalysisRuntimeParity,
} from "../../scripts/verify_runtime_parity.mjs";

const ticker = "218410.KQ";
const payload = {
  ok: true,
  ticker,
  analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
  financialSummaryVersion: FINANCIAL_SUMMARY_VERSION,
  financials: [
    { ticker, period: "2025-12", frequency: "annual", estimate: false, eps: 1131 },
    { ticker, period: "2026-03", frequency: "quarter", estimate: false, eps: 154 },
    { ticker, period: "2026-12", frequency: "annual", estimate: true, eps: 1983 },
  ],
};

function workerResponse(value = payload, apiVersion = "3") {
  return Response.json(value, { headers: { [RUNTIME_API_VERSION_HEADER]: apiVersion } });
}

test("verifies normalized local and Worker company-analysis values", async () => {
  const results = await verifyCompanyAnalysisRuntimeParity({
    token: "private",
    tickers: [ticker],
    attempts: 1,
    localLoader: async () => ({ ...payload, savedAt: 1, cached: false }),
    fetchImpl: async () => workerResponse({ ...payload, savedAt: 2, cached: true }),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].ticker, ticker);
});

test("rejects a Worker that does not expose the runtime version", async () => {
  await assert.rejects(() => fetchRemoteCompanyAnalysis({
    ticker,
    token: "private",
    fetchImpl: async () => Response.json(payload),
  }), /incompatible/);
});

test("rejects a value mismatch even when both responses are complete", async () => {
  const changed = {
    ...payload,
    financials: payload.financials.map((record, index) => (
      index === 2 ? { ...record, eps: 2200 } : record
    )),
  };
  await assert.rejects(() => verifyCompanyAnalysisRuntimeParity({
    token: "private",
    tickers: [ticker],
    attempts: 1,
    localLoader: async () => payload,
    fetchImpl: async () => workerResponse(changed),
  }), /financials/);
});
