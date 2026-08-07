import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createThinkStockServer,
  DartGateway,
  isAllowedOrigin,
  isPrivateAddress,
  fetchLocalKrxCoreIndices,
  localKrxIndexPointFromRows,
  parseAdrChartRows,
  parseEnvText,
  syncPagesDataMirror,
} from "../../scripts/local_pages_server.mjs";


test("parses the local environment without exposing values", () => {
  const parsed = parseEnvText("# local only\nDART_API_KEY='secret-value'\nEMPTY=\n");
  assert.equal(parsed.DART_API_KEY, "secret-value");
  assert.equal(parsed.EMPTY, "");
});

test("allows only local clients and app origins", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:192.168.0.10"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isAllowedOrigin("capacitor://localhost"), true);
  assert.equal(isAllowedOrigin("http://192.168.0.10:8787"), true);
  assert.equal(isAllowedOrigin("https://example.com"), false);
});

test("parses ADR chart arrays into one row per date", () => {
  const timestamp = Date.parse("2026-08-05T15:00:00Z");
  const rows = parseAdrChartRows(
    `<script>const kospi_adr=[[${timestamp},91.2],[${timestamp + 86400000},0]];const kosdaq_adr=[[${timestamp},87.4],[${timestamp + 86400000},0]];</script>`,
  );
  assert.deepEqual(rows, [{ date: "2026-08-06", adr_kospi: 91.2, adr_kosdaq: 87.4 }]);
});

test("mirrors deployed segmented data into an ignored local cache", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "thinkstock-pages-data-"));
  const recentText = JSON.stringify({ dates: ["2026-08-05"], columns: { adr_kospi: [90] } });
  const historyText = JSON.stringify({ dates: [], columns: {} });
  const descriptor = (file, text, rows) => ({
    file,
    rows,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  });
  const manifest = {
    format: "segmented-data-v1",
    generated_at: "2026-08-05T00:00:00Z",
    revision: "test-revision",
    datasets: {
      adr_data: {
        recent: descriptor("adr_data_recent.json", recentText, 1),
        history: descriptor("adr_data_history.json", historyText, 0),
      },
    },
  };
  let dataRequests = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("data_manifest")) return new Response(JSON.stringify(manifest), { status: 200 });
    dataRequests += 1;
    return new Response(value.includes("recent") ? recentText : historyText, { status: 200 });
  };
  try {
    const result = await syncPagesDataMirror({ fetchImpl, cacheDir, baseUrl: "https://example.test/data/" });
    assert.deepEqual(result, { generatedAt: "2026-08-05T00:00:00Z", files: 2, unchanged: false });
    assert.deepEqual(JSON.parse(await readFile(path.join(cacheDir, "data_manifest.json"), "utf8")), manifest);
    assert.equal(dataRequests, 2);

    const unchanged = await syncPagesDataMirror({ fetchImpl, cacheDir, baseUrl: "https://example.test/data/" });
    assert.deepEqual(unchanged, { generatedAt: "2026-08-05T00:00:00Z", files: 2, unchanged: true });
    assert.equal(dataRequests, 2);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("loads both core indices directly from the local KRX key", async () => {
  assert.deepEqual(localKrxIndexPointFromRows([
    { IDX_NM: "KOSPI 200", BAS_DD: "20260805", CLSPRC_IDX: "500.1" },
    { IDX_NM: "KOSPI", BAS_DD: "20260805", CLSPRC_IDX: "3,210.5" },
  ], "KOSPI"), { date: "2026-08-05", close: 3210.5 });
  const payload = await fetchLocalKrxCoreIndices(async (url, options = {}) => {
    assert.equal(options.headers.AUTH_KEY, "krx-secret");
    const target = new URL(url);
    const kosdaq = target.pathname.includes("kosdaq_dd_trd");
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
        BAS_DD: target.searchParams.get("basDd"),
        CLSPRC_IDX: kosdaq ? "1,012.3" : "3,210.5",
      }],
    }), { status: 200 });
  }, "krx-secret", new Date("2026-08-05T10:00:00Z"));
  assert.deepEqual(payload.records.map((row) => row.ticker), ["^KS11", "^KQ11"]);
});

test("keeps the previous pages-data generation when a downloaded hash is invalid", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "thinkstock-pages-data-invalid-"));
  const oldManifest = { format: "segmented-data-v1", revision: "old" };
  await writeFile(path.join(cacheDir, "data_manifest.json"), JSON.stringify(oldManifest), "utf8");
  const file = "prices_recent.json";
  const manifest = {
    format: "segmented-data-v1",
    generated_at: "2026-08-06T00:00:00Z",
    revision: "new",
    datasets: {
      prices: {
        recent: { file, rows: 1, sha256: "0".repeat(64) },
        history: { file: "prices_history.json", rows: 0, sha256: "0".repeat(64) },
      },
    },
  };
  const fetchImpl = async (url) => new Response(
    String(url).includes("data_manifest")
      ? JSON.stringify(manifest)
      : JSON.stringify({ dates: ["2026-08-06"], columns: { AAA: [100] } }),
    { status: 200 },
  );
  try {
    await assert.rejects(
      syncPagesDataMirror({ fetchImpl, cacheDir, baseUrl: "https://example.test/data/" }),
      /hash mismatch/,
    );
    assert.deepEqual(JSON.parse(await readFile(path.join(cacheDir, "data_manifest.json"), "utf8")), oldManifest);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("proxies local insider requests with the server-side access token", async () => {
  let requestedUrl = "";
  let authorization = "";
  const server = await createThinkStockServer({
    syncPagesData: false,
    workerAccessToken: "local-secret",
    gateway: { apiKey: "", initialize: async () => {} },
    fetchImpl: async (url, init = {}) => {
      requestedUrl = String(url);
      authorization = String(init.headers?.Authorization || "");
      return new Response(JSON.stringify({ ok: true, records: [] }), { status: 200 });
    },
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/dart/insider-trades?ticker=005930.KS`);
    assert.equal(response.status, 200);
    assert.match(requestedUrl, /\/api\/dart\/insider-trades\?ticker=005930\.KS$/);
    assert.equal(authorization, "Bearer local-secret");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("rejects an unusable proxied credit response before it reaches the browser", async () => {
  const server = await createThinkStockServer({
    syncPagesData: false,
    workerAccessToken: "local-secret",
    gateway: { apiKey: "", initialize: async () => {} },
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      rows: [{ date: "2026-08-07", kospi_credit: 0, kosdaq_credit: 0 }],
    }), { status: 200 }),
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/credit`);
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /no usable rows/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("proxies and validates the FRED crisis signal for local pages", async () => {
  let requestedUrl = "";
  const server = await createThinkStockServer({
    syncPagesData: false,
    workerAccessToken: "local-secret",
    gateway: { apiKey: "", initialize: async () => {} },
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        ok: true,
        records: [{ date: "2026-08-06", score: 58, stage: "warning", curve: 30, labor: 14, credit: 14 }],
      }), { status: 200 });
    },
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/crisis-signal`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.match(requestedUrl, /\/api\/crisis-signal$/);
    assert.equal(payload.records[0].score, 58);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("filters low-impact disclosures before returning them", () => {
  const important = DartGateway.recordFromItem("383220.KS", {
    rcept_dt: "20260721",
    report_nm: "단일판매ㆍ공급계약체결",
    rcept_no: "1",
  });
  const lowImpact = DartGateway.recordFromItem("383220.KS", {
    rcept_dt: "20260721",
    report_nm: "기업설명회(IR)개최",
    rcept_no: "2",
  });
  assert.ok(important);
  assert.equal(lowImpact, null);
});

test("uses the per-ticker disk cache after the first request", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "thinkstock-dart-"));
  try {
    const gateway = new DartGateway("test-key", { cacheDir, disclosureTtlMs: 3600000 });
    await gateway.initialize();
    let requests = 0;
    gateway.fetchDisclosures = async () => {
      requests += 1;
      return [{ ticker: "383220.KS", date: "2026-07-21", title: "중요 공시" }];
    };
    const first = await gateway.disclosures("383220.KS");
    const second = await gateway.disclosures("383220.KS");
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(second.records.length, 1);
    assert.equal(requests, 1);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("loads F&F's corp code from the local shard", async () => {
  const gateway = new DartGateway("test-key");
  assert.equal(await gateway.corpCode("383220"), "01568413");
});
