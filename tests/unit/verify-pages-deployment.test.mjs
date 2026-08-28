import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePagesAppVersion,
  parsePagesBundleSource,
  inspectNewsSentimentCoverage,
  sha256,
  verifyPagesDeployment,
  verifyWorkerRuntime,
} from "../../scripts/verify_pages_deployment.mjs";

test("parses the visible app version and stamped bundle source", () => {
  const html = '<span id="appVersionText">2.51</span><script src="./assets/app.bundle.min.js?v=123-abc&amp;x=1"></script>';
  assert.equal(parsePagesAppVersion(html), "2.51");
  assert.equal(parsePagesBundleSource(html), "./assets/app.bundle.min.js?v=123-abc&x=1");
});

test("inspects columnar news sentiment coverage across history and recent segments", () => {
  assert.deepEqual(inspectNewsSentimentCoverage(
    { dates: ["2005-01-01", "2005-01-02"], columns: { news_sentiment: [95, null] } },
    { dates: ["2026-08-12"], columns: { news_sentiment: [101] } },
  ), {
    count: 2,
    firstDate: "2005-01-01",
    latestDate: "2026-08-12",
  });
});

test("public deployment verifier rejects stale HTML and accepts the matching bundle", async () => {
  const bundle = Buffer.from("matching-bundle");
  let indexRequests = 0;
  const result = await verifyPagesDeployment({
    pageUrl: "https://example.test/ThinkStock/",
    expectedVersion: "2.51",
    expectedBuild: "123-abcdef",
    expectedBundleHash: sha256(bundle),
    attempts: 2,
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      const target = new URL(url);
      if (target.pathname.endsWith("app.bundle.min.js")) return new Response(bundle);
      indexRequests += 1;
      const version = indexRequests === 1 ? "2.50" : "2.51";
      return new Response(`<span id="appVersionText">${version}</span><script src="./assets/app.bundle.min.js?v=123-abcdef"></script>`);
    },
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.deployedVersion, "2.51");
});

test("public deployment verifier checks deployed macro files and long news history", async () => {
  const bundle = Buffer.from("matching-bundle");
  const history = {
    dates: Array.from({ length: 3000 }, (_, index) => {
      const date = new Date(Date.UTC(2005, 0, 1 + index));
      return date.toISOString().slice(0, 10);
    }),
    columns: { news_sentiment: Array(3000).fill(95) },
  };
  const recent = {
    dates: Array.from({ length: 2500 }, (_, index) => {
      const date = new Date(Date.UTC(2015, 0, 1 + index));
      return date.toISOString().slice(0, 10);
    }),
    columns: { news_sentiment: Array(2500).fill(101) },
  };
  const historyBytes = Buffer.from(JSON.stringify(history));
  const recentBytes = Buffer.from(JSON.stringify(recent));
  const manifest = {
    format: "segmented-data-v1",
    revision: "data-revision",
    datasets: {
      macro_data: {
        history: { file: "macro_data_history.json", rows: 3000, sha256: sha256(historyBytes) },
        recent: { file: "macro_data_recent.json", rows: 2500, sha256: sha256(recentBytes) },
      },
    },
  };

  const result = await verifyPagesDeployment({
    pageUrl: "https://example.test/ThinkStock/",
    expectedVersion: "2.75",
    expectedBuild: "123-abcdef",
    expectedBundleHash: sha256(bundle),
    expectedDataManifest: manifest,
    attempts: 1,
    fetchImpl: async (url) => {
      const target = new URL(url);
      if (target.pathname.endsWith("app.bundle.min.js")) return new Response(bundle);
      if (target.pathname.endsWith("data_manifest.json")) return Response.json(manifest);
      if (target.pathname.endsWith("macro_data_history.json")) return new Response(historyBytes);
      if (target.pathname.endsWith("macro_data_recent.json")) return new Response(recentBytes);
      return new Response('<span id="appVersionText">2.75</span><script src="./assets/app.bundle.min.js?v=123-abcdef"></script>');
    },
  });

  assert.equal(result.dataRevision, "data-revision");
  assert.equal(result.newsSentimentCoverage.count, 5500);
  assert.equal(result.newsSentimentCoverage.firstDate, "2005-01-01");
});

test("public deployment verifier rejects a stale Worker contract", async () => {
  const requestedPaths = [];
  await assert.rejects(() => verifyWorkerRuntime({
    workerUrl: "https://worker.example.test",
    fetchImpl: async (url) => {
      requestedPaths.push(new URL(url).pathname);
      return Response.json({
        ok: true,
        analysisContractVersion: 0,
        financialSummaryVersion: 2,
      }, { headers: { "X-ThinkStock-API-Version": "3" } });
    },
  }), /company-analysis contract is stale/);

  const result = await verifyWorkerRuntime({
    workerUrl: "https://worker.example.test",
    fetchImpl: async (url) => {
      requestedPaths.push(new URL(url).pathname);
      return Response.json({
        ok: true,
        analysisContractVersion: 1,
        financialSummaryVersion: 3,
      }, { headers: { "X-ThinkStock-API-Version": "3" } });
    },
  });
  assert.deepEqual(requestedPaths, ["/health", "/health"]);
  assert.deepEqual(result, {
    apiVersion: 3,
    analysisContractVersion: 1,
    financialSummaryVersion: 3,
  });
});
