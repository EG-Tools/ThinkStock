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
  compareRuntimeRecords,
  verifyMarketRuntimeParity,
} from "../../scripts/verify_runtime_parity.mjs";

const ticker = "218410.KQ";

test("market parity detects stale dates and changed volume even with equal prices", () => {
  const a = [{ date: "2026-09-14", close: 203000, volume: 100 }];
  assert.equal(compareRuntimeRecords(a, [{ ...a[0], volume: 101 }]).equal, false);
  assert.match(compareRuntimeRecords(a, [{ ...a[0], date: "2026-09-15" }]).differences[0], /missing/);
  assert.equal(compareRuntimeRecords(a, [...a]).equal, true);
});

test("parity uses local and deployed routes for seeds, prices, volume and report lists", async () => {
  const urls = [];
  const results = await verifyMarketRuntimeParity({
    token: "private", tickers: [ticker],
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.pathname.endsWith("history")) return Response.json({ ok: true,
        rows: [{ date: "2026-09-14", close: 1, volume: 2 }] });
      if (url.pathname.endsWith("broker-reports")) return Response.json({ ok: true, reports: [] });
      return Response.json({ records: [{ date: "2026-09-14", value: 1 }] });
    },
  });
  assert.equal(results.length, 7);
  assert.equal(urls.filter((url) => url.hostname === "127.0.0.1").length, 7);
  assert.equal(urls.filter((url) => url.hostname === "eg-tools.github.io").length, 4);
});
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
