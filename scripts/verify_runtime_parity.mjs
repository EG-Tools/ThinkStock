import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
  compareCompanyAnalysisPayloads,
  inspectCompanyAnalysisQuality,
} from "../shared/company-analysis-contract.mjs";
import {
  MINIMUM_RUNTIME_API_VERSION,
  RUNTIME_API_VERSION_HEADER,
  runtimeApiCompatibility,
} from "../shared/runtime-api-contract.mjs";
import { fetchCompanyAnalysis } from "../worker/src/company-analysis.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WORKER_URL = "https://thinkstock-api.keg0320.workers.dev";
const DEFAULT_TICKERS = Object.freeze(["218410.KQ", "005930.KS"]);

function parseEnvText(text) {
  return Object.fromEntries(String(text || "").split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return [];
    const splitAt = line.indexOf("=");
    const key = line.slice(0, splitAt).trim();
    const value = line.slice(splitAt + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    return key ? [[key, value]] : [];
  }));
}

async function wait(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs) || 0)));
}

export async function fetchRemoteCompanyAnalysis(options = {}) {
  const ticker = String(options.ticker || "").trim().toUpperCase();
  const endpoint = new URL("/api/analysis", String(options.workerUrl || DEFAULT_WORKER_URL));
  endpoint.searchParams.set("ticker", ticker);
  endpoint.searchParams.set("refresh", "1");
  endpoint.searchParams.set("parity", String(Date.now()));
  const response = await (options.fetchImpl || fetch)(endpoint, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${String(options.token || "")}`,
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(Math.max(5000, Number(options.timeoutMs) || 30000)),
  });
  const apiVersion = response.headers.get(RUNTIME_API_VERSION_HEADER);
  const compatibility = runtimeApiCompatibility(apiVersion, {
    allowMissing: false,
    minimum: MINIMUM_RUNTIME_API_VERSION,
  });
  assert.equal(compatibility.compatible, true, `Worker API ${apiVersion || "missing"} is incompatible`);
  const payload = await response.json().catch(() => null);
  assert.equal(response.ok, true, payload?.error || `Worker analysis HTTP ${response.status}`);
  assert.equal(payload?.ok, true, payload?.error || "Worker analysis failed");
  assert.ok(
    Number(payload.analysisContractVersion) >= COMPANY_ANALYSIS_CONTRACT_VERSION,
    `Worker analysis contract ${payload?.analysisContractVersion || "missing"} is stale`,
  );
  return payload;
}

export async function verifyCompanyAnalysisRuntimeParity(options = {}) {
  const tickers = [...new Set((options.tickers || DEFAULT_TICKERS)
    .map((ticker) => String(ticker || "").trim().toUpperCase())
    .filter(Boolean))];
  const attempts = Math.max(1, Number(options.attempts) || 3);
  const localLoader = options.localLoader || (async (ticker) => ({
    ok: true,
    ticker,
    ...(await fetchCompanyAnalysis(ticker, options.fetchImpl || fetch)),
  }));
  const results = [];
  for (const ticker of tickers) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const [local, remote] = await Promise.all([
          localLoader(ticker),
          fetchRemoteCompanyAnalysis({ ...options, ticker }),
        ]);
        const localQuality = inspectCompanyAnalysisQuality(local, { ticker });
        const remoteQuality = inspectCompanyAnalysisQuality(remote, { ticker });
        assert.equal(localQuality.completeFinancialSummary, true, `Local ${ticker} summary is incomplete: ${localQuality.issues.join(",")}`);
        assert.equal(remoteQuality.completeFinancialSummary, true, `Worker ${ticker} summary is incomplete: ${remoteQuality.issues.join(",")}`);
        assert.ok(Number(local.financialSummaryVersion) >= FINANCIAL_SUMMARY_VERSION);
        const comparison = compareCompanyAnalysisPayloads(local, remote, {
          ticker,
          annualLimit: 8,
          quarterLimit: 12,
        });
        assert.equal(
          comparison.equal,
          true,
          `${ticker} local/Worker mismatch: ${comparison.differences.join(",")}`,
        );
        results.push(Object.freeze({
          ticker,
          attempts: attempt,
          fingerprint: comparison.left.fingerprint,
          quality: localQuality,
        }));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await wait(options.retryDelayMs ?? 3000);
      }
    }
    if (lastError) throw lastError;
  }
  return Object.freeze(results);
}

async function main() {
  const envFile = parseEnvText(await readFile(path.join(root, ".env.local"), "utf8").catch(() => ""));
  const token = String(process.env.THINKSTOCK_ACCESS_TOKEN || envFile.THINKSTOCK_ACCESS_TOKEN || "").trim();
  assert.ok(token, "THINKSTOCK_ACCESS_TOKEN is required for runtime parity verification");
  const tickers = String(process.env.THINKSTOCK_PARITY_TICKERS || "")
    .split(",")
    .map((ticker) => ticker.trim())
    .filter(Boolean);
  const results = await verifyCompanyAnalysisRuntimeParity({
    token,
    tickers: tickers.length ? tickers : DEFAULT_TICKERS,
  });
  results.forEach((result) => {
    console.log(`Runtime parity verified: ${result.ticker} ${result.fingerprint}, attempt ${result.attempts}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Runtime parity verification failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
