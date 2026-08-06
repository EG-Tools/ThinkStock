import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createThinkStockServer,
  DartGateway,
  isAllowedOrigin,
  isPrivateAddress,
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
  const manifest = {
    format: "segmented-data-v1",
    generated_at: "2026-08-05T00:00:00Z",
    datasets: {
      adr_data: {
        recent: { file: "adr_data_recent.json" },
        history: { file: "adr_data_history.json" },
      },
    },
  };
  const fetchImpl = async (url) => new Response(
    String(url).includes("data_manifest") ? JSON.stringify(manifest) : JSON.stringify({ dates: [], columns: {} }),
    { status: 200 },
  );
  try {
    const result = await syncPagesDataMirror({ fetchImpl, cacheDir, baseUrl: "https://example.test/data/" });
    assert.deepEqual(result, { generatedAt: "2026-08-05T00:00:00Z", files: 2 });
    assert.deepEqual(JSON.parse(await readFile(path.join(cacheDir, "data_manifest.json"), "utf8")), manifest);
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
