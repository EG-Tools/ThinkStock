import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
} from "../../shared/company-analysis-contract.mjs";
import { RUNTIME_API_VERSION_HEADER } from "../../shared/runtime-api-contract.mjs";
import {
  fetchRemoteCompanyAnalysis,
  compareCompanyAnalysisRuntimePayloads,
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

test("market parity keeps today's provisional row but compares every settled row", () => {
  const local = [
    { date: "2026-09-28", close: 100, volume: 10 },
    { date: "2026-09-29", close: 110, volume: 20 },
  ];
  const remote = [
    { date: "2026-09-28", close: 100, volume: 10 },
    { date: "2026-09-29", close: 111, volume: 21 },
  ];
  assert.equal(compareRuntimeRecords(local, remote, {
    fields: ["close", "volume"],
    ignoreFieldKeys: ["2026-09-29"],
  }).equal, true);
  assert.equal(compareRuntimeRecords(local, remote, {
    fields: ["close", "volume"],
    ignoreFieldKeys: ["2026-09-28"],
  }).equal, false);
});

test("market parity still rejects a missing provisional row", () => {
  const local = [{ date: "2026-09-29", close: 110, volume: 20 }];
  assert.equal(compareRuntimeRecords(local, [], {
    fields: ["close", "volume"],
    ignoreFieldKeys: ["2026-09-29"],
  }).equal, false);
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

test("allows Worker-only historical financial enrichment without weakening core parity", () => {
  const local = {
    ...payload,
    financials: payload.financials.map((record, index) => (
      index === 1 ? { ...record, revenue: 687.94, operatingProfit: 114.86 } : record
    )),
  };
  const remote = {
    ...local,
    financials: local.financials.map((record, index) => (
      index === 1 ? {
        ...record,
        reportDate: "2026-04-27",
        operatingProfitConsensus: 90.33,
        operatingProfitSurprise: 27.16,
        operatingProfitYoy: 349.86,
      } : record
    )),
  };
  const comparison = compareCompanyAnalysisRuntimePayloads(local, remote, {
    ticker,
    annualLimit: 8,
    quarterLimit: 12,
  });
  assert.equal(comparison.equal, true);
  assert.equal(comparison.enriched, true);
});

test("rejects changed core financial values and lost local enrichment", () => {
  const local = {
    ...payload,
    financials: payload.financials.map((record, index) => (
      index === 1 ? { ...record, revenue: 687.94, reportDate: "2026-04-27" } : record
    )),
  };
  const changedValue = {
    ...local,
    financials: local.financials.map((record, index) => (
      index === 1 ? { ...record, revenue: 700 } : record
    )),
  };
  const lostMetadata = {
    ...local,
    financials: local.financials.map((record, index) => (
      index === 1 ? { ...record, reportDate: "" } : record
    )),
  };
  assert.equal(compareCompanyAnalysisRuntimePayloads(local, changedValue, { ticker }).equal, false);
  assert.equal(compareCompanyAnalysisRuntimePayloads(local, lostMetadata, { ticker }).equal, false);
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
