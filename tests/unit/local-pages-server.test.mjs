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
  fetchLocalResearchHistory,
  fetchLocalResearchUniverse,
  detectLocalResearchHistoryRebase,
  localResearchHistoryPointFromUniverse,
  normalizeLocalResearchHistoryRows,
  normalizeLocalResearchUniverseRows,
  parseLocalResearchHistory,
  projectLocalResearchHistory,
  localKrxIndexPointFromRows,
  parseAdrChartRows,
  parseEnvText,
  syncPagesDataMirror,
} from "../../scripts/local_pages_server.mjs";

let nextSafeTestPort = 20000 + (process.pid % 20000);

async function listenTestServer(server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = nextSafeTestPort;
    nextSafeTestPort += 1;
    try {
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      return port;
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No safe local test port is available");
}


test("parses the local environment without exposing values", () => {
  const parsed = parseEnvText("# local only\nDART_API_KEY='secret-value'\nEMPTY=\n");
  assert.equal(parsed.DART_API_KEY, "secret-value");
  assert.equal(parsed.EMPTY, "");
});

test("reports when the running local server source has changed", async () => {
  const server = await createThinkStockServer({
    syncPagesData: false,
    serverSourceMtimeMs: 1000,
    getServerSourceMtime: async () => 2000,
    appVersion: "2.52",
    gateway: { apiKey: "", initialize: async () => {} },
  });
  try {
    const port = await listenTestServer(server);
    const payload = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(payload.ok, true);
    assert.equal(payload.appVersion, "2.52");
    assert.equal(payload.restartRequired, true);
    assert.equal(payload.serverSourceLoadedAt, "1970-01-01T00:00:01.000Z");
    assert.equal(payload.serverSourceCurrentAt, "1970-01-01T00:00:02.000Z");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("local admin sessions use the Worker without exposing its access token to the browser", async () => {
  let forwarded = null;
  const fetchImpl = async (url, options = {}) => {
    forwarded = { url: String(url), options };
    return new Response(JSON.stringify({
      ok: true,
      sessionToken: "v1.c2lnbmVkLXNlc3Npb24.signature",
      expiresAt: Date.now() + 86400_000,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const server = await createThinkStockServer({
    syncPagesData: false,
    workerAccessToken: "local-worker-token",
    fetchImpl,
    gateway: { apiKey: "", initialize: async () => {} },
  });
  try {
    const port = await listenTestServer(server);
    const payload = await fetch(`http://127.0.0.1:${port}/api/admin/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", code: "1234567890", deviceId: "device-12345678" }),
    }).then((response) => response.json());
    assert.equal(payload.ok, true);
    assert.equal(forwarded.url, "https://thinkstock-api.keg0320.workers.dev/api/admin/session");
    assert.equal(forwarded.options.headers.Authorization, "Bearer local-worker-token");
    assert.equal(JSON.parse(forwarded.options.body).deviceId, "device-12345678");
    assert.equal(JSON.stringify(payload).includes("local-worker-token"), false);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("local crisis route fills an older Worker response with official FRED VIX", async () => {
  let fredRequests = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("/api/crisis-signal")) {
      return new Response(JSON.stringify({
        ok: true,
        latestDate: "2026-08-13",
        source: "FRED + KRX",
        records: [{ date: "2026-08-13", score: 20, stage: "stable" }],
        vkospiRows: [{ date: "2026-08-13", vkospi: 20.5 }],
        vkospiOfficialLatestDate: "2026-08-13",
      }), { status: 200 });
    }
    if (value.includes("api.stlouisfed.org") && value.includes("series_id=VIXCLS")) {
      fredRequests += 1;
      return new Response(JSON.stringify({
        observations: [
          { date: "2026-08-10", value: "15.46" },
          { date: "2026-08-11", value: "15.28" },
        ],
      }), { status: 200 });
    }
    throw new Error(`unexpected request: ${value}`);
  };
  const server = await createThinkStockServer({
    syncPagesData: false,
    workerAccessToken: "test-token",
    fredApiKey: "test-fred-key",
    fetchImpl,
    nowProvider: () => new Date("2026-08-13T10:00:00Z"),
    gateway: { apiKey: "", initialize: async () => {} },
  });
  try {
    const port = await listenTestServer(server);
    const endpoint = `http://127.0.0.1:${port}/api/crisis-signal`;
    const first = await fetch(endpoint).then((response) => response.json());
    const second = await fetch(endpoint).then((response) => response.json());
    assert.deepEqual(first.vixRows, [
      { date: "2026-08-10", vix: 15.46 },
      { date: "2026-08-11", vix: 15.28 },
    ]);
    assert.deepEqual(second.vixRows, first.vixRows);
    assert.equal(first.vixSource, "FRED VIXCLS (local latest check)");
    assert.equal(fredRequests, 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("allows only local clients and app origins", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:192.168.0.10"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isAllowedOrigin("thinkstock://localhost"), false);
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

test("normalizes local KRX research universe by market cap", () => {
  const records = normalizeLocalResearchUniverseRows([
    { ISU_CD: "KR7005930003", ISU_NM: "삼성전자", MKTCAP: "500,000", TDD_CLSPRC: "90,000" },
    { ISU_SRT_CD: "000660", ISU_NM: "SK하이닉스", MKTCAP: "400,000", TDD_CLSPRC: "250,000" },
  ], "KOSPI", 2);
  assert.deepEqual(records.map((row) => [row.ticker, row.rank]), [["005930.KS", 1], ["000660.KS", 2]]);
});

test("stock research stops requesting live prices after 4 PM Korea time", async () => {
  let naverRequests = 0;
  const payloadRows = Array.from({ length: 60 }, (_, index) => ({
    ISU_SRT_CD: String(100000 + index).slice(-6),
    ISU_NM: `종목-${index}`,
    MKTCAP: String(1_000_000_000 - index),
    TDD_CLSPRC: String(10000 + index),
    ACC_TRDVOL: String(100000 + index),
  }));
  const result = await fetchLocalResearchUniverse(async (url) => {
    const target = new URL(url);
    if (target.hostname === "stock.naver.com") naverRequests += 1;
    return new Response(JSON.stringify({ OutBlock_1: payloadRows }), { status: 200 });
  }, "krx-secret", new Date("2026-08-13T07:01:00Z"), { totalLimit: 100 });

  assert.equal(naverRequests, 0);
  assert.equal(result.records.length, 100);
  assert.deepEqual(result.selection, { KOSPI: 50, KOSDAQ: 50 });
});

test("parses local Naver research history", () => {
  assert.deepEqual(parseLocalResearchHistory(`
    <item data="20170501|100|110|90|105|0" />
    <item data="20260806|100|110|90|105|12345" />
    <item data="20260807|105|120|100|118|45678" />
  `), [
    { date: "2026-08-06", close: 105, volume: 12345 },
    { date: "2026-08-07", close: 118, volume: 45678 },
  ]);
});

test("repairs persisted local research rows while retaining a real June trading session", () => {
  assert.deepEqual(normalizeLocalResearchHistoryRows([
    { date: "2017-05-01", close: 286371, volume: 0 },
    { date: "2017-05-02", close: 272328, volume: 89745 },
    { date: "2017-06-01", close: 348397, volume: 300468 },
  ]), [
    { date: "2017-05-02", close: 272328, volume: 89745 },
    { date: "2017-06-01", close: 348397, volume: 300468 },
  ]);
});

test("full local chart history replaces a persisted AI backtest seed with Naver daily rows", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "thinkstock-display-history-"));
  const buildRows = (startDate, count, base = 700000) => {
    const rows = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    while (rows.length < count) {
      const weekday = cursor.getUTCDay();
      if (weekday !== 0 && weekday !== 6) {
        rows.push({
          date: cursor.toISOString().slice(0, 10),
          close: base + rows.length,
          volume: 100000 + rows.length,
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return rows;
  };
  const contaminated = buildRows("2017-01-02", 300, 300000);
  await writeFile(path.join(cacheDir, "207940.KS.full.json"), JSON.stringify({
    schema: 1,
    ticker: "207940.KS",
    asOfDate: "2026-08-21",
    latestDate: contaminated.at(-1).date,
    source: "LOCAL_AI_HISTORY_CACHE",
    rows: contaminated,
  }), "utf8");

  const naverRows = buildRows("2016-11-10", 320);
  let requestedStartTime = "";
  try {
    const result = await fetchLocalResearchHistory(async (url) => {
      requestedStartTime = new URL(url).searchParams.get("startTime") || "";
      const xml = naverRows.map((row) => (
        `<item data="${row.date.replaceAll("-", "")}|${row.close}|${row.close}|${row.close}|${row.close}|${row.volume}" />`
      )).join("\n");
      return new Response(xml, { status: 200 });
    }, "207940.KS", new Date("2026-08-21T09:00:00Z"), cacheDir, null, {
      fullHistory: true,
    });

    assert.equal(requestedStartTime, "19960821");
    assert.equal(result.source, "NAVER_FULL_HISTORY");
    assert.equal(result.rows[0].date, "2016-11-10");
    assert.ok(result.rows.length >= 300);
    assert.notEqual(result.rows[0].close, contaminated[0].close);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("detects a consistent split rebase but ignores ordinary price corrections", () => {
  const existing = [
    { date: "2026-08-03", close: 100000 },
    { date: "2026-08-04", close: 102000 },
    { date: "2026-08-05", close: 98000 },
  ];
  assert.equal(detectLocalResearchHistoryRebase(existing, [
    { date: "2026-08-03", close: 20000 },
    { date: "2026-08-04", close: 20400 },
    { date: "2026-08-05", close: 19600 },
  ]), true);
  assert.equal(detectLocalResearchHistoryRebase(existing, [
    { date: "2026-08-03", close: 100100 },
    { date: "2026-08-04", close: 101900 },
    { date: "2026-08-05", close: 98100 },
  ]), false);
});

test("uses a current KRX point for an ordinary next session but rejects a likely split", () => {
  const existing = [{ date: "2026-08-07", close: 100000 }];
  assert.deepEqual(localResearchHistoryPointFromUniverse(existing, {
    date: "2026-08-10",
    close: 102000,
    volume: 123456,
  }, "2026-08-10"), {
    date: "2026-08-10",
    close: 102000,
    volume: 123456,
  });
  assert.equal(localResearchHistoryPointFromUniverse(existing, {
    date: "2026-08-10",
    close: 20000,
    volume: 123456,
  }, "2026-08-10"), null);
});

test("local research history sends only an overlapping tail unless a full reset is required", () => {
  const startTime = Date.parse("2025-01-01T00:00:00Z");
  const rows = Array.from({ length: 300 }, (_, index) => ({
    date: new Date(startTime + (index * 86400000)).toISOString().slice(0, 10),
    close: 10000 + index,
    volume: 100000 + index,
  }));
  const payload = {
    ticker: "005930.KS",
    latestDate: rows.at(-1).date,
    rows,
  };
  const partial = projectLocalResearchHistory(payload, rows.at(-1).date);
  assert.equal(partial.partial, true);
  assert.equal(partial.reset, false);
  assert.equal(partial.fullRowCount, 300);
  assert.ok(partial.rows.length < rows.length);
  assert.ok(partial.rows.length >= 30);

  const reset = projectLocalResearchHistory({ ...payload, rebased: true }, rows.at(-1).date);
  assert.equal(reset.partial, false);
  assert.equal(reset.reset, true);
  assert.equal(reset.rows.length, 300);

  const full = projectLocalResearchHistory(payload, rows.at(-1).date, true);
  assert.equal(full.partial, false);
  assert.equal(full.rows.length, 300);
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

test("keeps the available local index when the other market is unavailable", async () => {
  const payload = await fetchLocalKrxCoreIndices(async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("kosdaq_dd_trd")) {
      return new Response("unavailable", { status: 503 });
    }
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: "KOSPI",
        BAS_DD: target.searchParams.get("basDd"),
        CLSPRC_IDX: "3,210.5",
      }],
    }), { status: 200 });
  }, "krx-secret", new Date("2026-08-05T10:00:00Z"));

  assert.deepEqual(payload.records.map((row) => row.ticker), ["^KS11"]);
  assert.equal(payload.partial, true);
  assert.equal(payload.stale, true);
  assert.deepEqual(payload.missingTickers, ["^KQ11"]);
  assert.match(payload.warning, /KOSDAQ/);
});

test("overlays same-day Naver indices during the Korean market session", async () => {
  const payload = await fetchLocalKrxCoreIndices(async (url, options = {}) => {
    const target = new URL(url);
    if (target.hostname === "api.finance.naver.com") {
      const kosdaq = target.searchParams.get("symbol") === "KOSDAQ";
      const previousClose = kosdaq ? 1012.3 : 3210.5;
      const currentClose = kosdaq ? 1024.4 : 3250.7;
      return new Response(JSON.stringify([
        ["20260807", previousClose, previousClose, previousClose, previousClose, 1],
        ["20260810", currentClose, currentClose, currentClose, currentClose, 1],
      ]), { status: 200 });
    }
    assert.equal(options.headers.AUTH_KEY, "krx-secret");
    const kosdaq = target.pathname.includes("kosdaq_dd_trd");
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
        BAS_DD: "20260807",
        CLSPRC_IDX: kosdaq ? "1,012.3" : "3,210.5",
      }],
    }), { status: 200 });
  }, "krx-secret", new Date("2026-08-10T00:30:00Z"));

  assert.deepEqual(payload.records, [
    { ticker: "^KS11", date: "2026-08-10", close: 3250.7, source: "NAVER_FALLBACK" },
    { ticker: "^KQ11", date: "2026-08-10", close: 1024.4, source: "NAVER_FALLBACK" },
  ]);
  assert.equal(payload.stale, false);
});

test("uses the newer Naver close before market open when KRX daily data is delayed", async () => {
  const payload = await fetchLocalKrxCoreIndices(async (url) => {
    const target = new URL(url);
    const kosdaq = target.pathname.includes("kosdaq_dd_trd")
      || target.searchParams.get("symbol") === "KOSDAQ";
    if (target.hostname === "api.finance.naver.com") {
      const previousClose = kosdaq ? 1012.3 : 3210.5;
      const latestClose = kosdaq ? 1024.4 : 3250.7;
      return new Response(JSON.stringify([
        ["20260807", previousClose, previousClose, previousClose, previousClose, 1],
        ["20260810", latestClose, latestClose, latestClose, latestClose, 1],
      ]), { status: 200 });
    }
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
        BAS_DD: "20260807",
        CLSPRC_IDX: kosdaq ? "1,012.3" : "3,210.5",
      }],
    }), { status: 200 });
  }, "krx-secret", new Date("2026-08-10T20:30:00Z"));

  assert.equal(payload.expectedDate, "2026-08-10");
  assert.equal(payload.source, "NAVER_FALLBACK");
  assert.equal(payload.latestDate, "2026-08-10");
  assert.equal(payload.stale, false);
});

test("fills the missing index sessions with a KRX-validated Naver tail", async () => {
  const payload = await fetchLocalKrxCoreIndices(async (url) => {
    const target = new URL(url);
    const kosdaq = target.pathname.includes("kosdaq_dd_trd")
      || target.searchParams.get("symbol") === "KOSDAQ";
    const latestClose = kosdaq ? 1024.4 : 3250.7;
    if (target.hostname === "api.finance.naver.com") {
      const olderClose = kosdaq ? 998.1 : 3188.2;
      return new Response(JSON.stringify([
        ["20260805", olderClose, olderClose, olderClose, olderClose, 1],
        ["20260807", latestClose - 10, latestClose - 10, latestClose - 10, latestClose - 10, 1],
        ["20260810", latestClose, latestClose, latestClose, latestClose, 1],
      ]), { status: 200 });
    }
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
        BAS_DD: "20260810",
        CLSPRC_IDX: String(latestClose),
      }],
    }), { status: 200 });
  }, "krx-secret", new Date("2026-08-10T20:30:00Z"), { since: "2026-08-05" });

  assert.deepEqual(
    payload.records.filter((row) => row.ticker === "^KS11").map((row) => row.date),
    ["2026-08-05", "2026-08-07", "2026-08-10"],
  );
  assert.equal(payload.records.at(-2).source, "NAVER_HISTORY");
  assert.equal(payload.historySince, "2026-08-05");
  assert.equal(payload.stale, false);
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
    const port = await listenTestServer(server);
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
    kofiaApiKey: "",
    workerAccessToken: "local-secret",
    gateway: { apiKey: "", initialize: async () => {} },
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      rows: [{ date: "2026-08-07", kospi_credit: 0, kosdaq_credit: 0 }],
    }), { status: 200 }),
  });
  try {
    const port = await listenTestServer(server);
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

test("loads local credit and deposits together from the shared KOFIA client", async () => {
  const server = await createThinkStockServer({
    syncPagesData: false,
    kofiaApiKey: "kofia-key",
    kofiaClient: {
      fetchCreditRows: async () => [{
        date: "2026-08-07",
        kospi_credit: 23.0999,
        kosdaq_credit: 6.1304,
      }],
      fetchDepositRows: async () => [{ date: "2026-08-07", customer_deposit: 104.2064 }],
    },
    workerAccessToken: "",
    gateway: { apiKey: "", initialize: async () => {} },
  });
  try {
    const port = await listenTestServer(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/credit?refresh=1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cached, false);
    assert.deepEqual(payload.rows.at(-1), {
      date: "2026-08-07",
      customer_deposit: 104.2064,
      kospi_credit: 23.0999,
      kosdaq_credit: 6.1304,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("synchronizes a newer local credit row to the authenticated Worker cache", async () => {
  let synchronized = null;
  const server = await createThinkStockServer({
    syncPagesData: false,
    kofiaApiKey: "kofia-key",
    kofiaClient: {
      fetchCreditRows: async () => [{
        date: "2026-08-13",
        kospi_credit: 24.5349,
        kosdaq_credit: 6.3914,
      }],
      fetchDepositRows: async () => [{ date: "2026-08-13", customer_deposit: 100.0684 }],
    },
    workerAccessToken: "local-secret",
    fetchImpl: async (url, options = {}) => {
      synchronized = {
        url: String(url),
        authorization: options.headers?.Authorization,
        body: JSON.parse(options.body),
      };
      return new Response(JSON.stringify({
        ok: true,
        latestDate: "2026-08-13",
        accepted: 1,
      }), { status: 200 });
    },
    gateway: { apiKey: "", initialize: async () => {} },
  });
  try {
    const port = await listenTestServer(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/credit?refresh=1`);
    assert.equal(response.status, 200);
    assert.match(synchronized.url, /\/api\/credit\/sync$/);
    assert.equal(synchronized.authorization, "Bearer local-secret");
    assert.deepEqual(synchronized.body.rows.at(-1), {
      date: "2026-08-13",
      customer_deposit: 100.0684,
      kospi_credit: 24.5349,
      kosdaq_credit: 6.3914,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("proxies and validates the FRED crisis signal for local pages", async () => {
  const requestedUrls = [];
  const server = await createThinkStockServer({
    syncPagesData: false,
    workerAccessToken: "local-secret",
    nowProvider: () => new Date("2026-08-12T03:00:00.000Z"),
    gateway: { apiKey: "", initialize: async () => {} },
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes("mweb-api.stockplus.com")) {
        return new Response(JSON.stringify({
          dayCandles: [
            { date: "2026-08-12T00:00:00.000+00:00", tradePrice: 55.89 },
            { date: "2026-08-11T00:00:00.000+00:00", tradePrice: 61.68 },
            { date: "2026-08-10T00:00:00.000+00:00", tradePrice: 99 },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ok: true,
        source: "FRED + KRX",
        records: [{ date: "2026-08-06", score: 58, stage: "warning", curve: 30, labor: 14, credit: 14 }],
        vkospiRows: [{ date: "2026-08-10", vkospi: 69.55 }],
        vixRows: [{ date: "2026-08-11", vix: 15.28 }],
      }), { status: 200 });
    },
  });
  try {
    const port = await listenTestServer(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/crisis-signal`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requestedUrls.some((url) => /\/api\/crisis-signal$/.test(url)), true);
    assert.equal(payload.records[0].score, 58);
    assert.deepEqual(payload.vkospiRows.slice(-3), [
      { date: "2026-08-10", vkospi: 69.55 },
      { date: "2026-08-11", vkospi: 61.68 },
      { date: "2026-08-12", vkospi: 55.89 },
    ]);
    assert.deepEqual(payload.vixRows, [{ date: "2026-08-11", vix: 15.28 }]);
    assert.equal(payload.latestDate, "2026-08-12");
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

test("uses stale local DART rows when a forced refresh fails", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "thinkstock-dart-stale-"));
  try {
    const gateway = new DartGateway("test-key", { cacheDir, disclosureTtlMs: 0 });
    await gateway.initialize();
    gateway.fetchDisclosures = async () => ([
      { ticker: "383220.KS", date: "2026-07-21", title: "saved disclosure" },
    ]);
    await gateway.disclosures("383220.KS", true);
    gateway.fetchDisclosures = async () => { throw new Error("DART unavailable"); };

    const fallback = await gateway.disclosures("383220.KS", true);
    assert.equal(fallback.cached, true);
    assert.equal(fallback.stale, true);
    assert.equal(fallback.records[0].title, "saved disclosure");
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("loads F&F's corp code from the local shard", async () => {
  const gateway = new DartGateway("test-key");
  assert.equal(await gateway.corpCode("383220"), "01568413");
});
