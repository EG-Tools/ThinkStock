import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { expectedLatestKoreanTradingDate, koreanDateText } from "../../shared/market-calendar.mjs";

import {
  handleRequest,
  creditRefreshWindowDate,
  insiderRecordFromItem,
  isAllowedOrigin,
  krxIndexPointFromRows,
  krxStockPointFromRows,
  krxMarketSnapshotFromRows,
  mergeAnalysisSnapshots,
  mergeFinancialRecords,
  mergeForecastJournalRecords,
  mergeInsiderRecords,
  mergeRecords,
  parseFreesisPayload,
  parseNaverPriceText,
  parseNaverResearchHistory,
  detectResearchHistoryRebase,
  projectResearchHistoryPayload,
  evaluateNaverPriceFallback,
  parseMajorHolderDocument,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
  parseNaverNewsHtml,
} from "../../worker/src/index.mjs";


function memoryKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key, type) {
      const value = values.get(key) ?? null;
      return type === "json" && value ? JSON.parse(value) : value;
    },
    async put(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

function request(path, options = {}) {
  const body = options.body === undefined
    ? undefined
    : (typeof options.body === "string" ? options.body : JSON.stringify(options.body));
  return new Request(`https://thinkstock-api.keg0320.workers.dev${path}`, {
    method: options.method || "GET",
    headers: {
      Origin: "https://eg-tools.github.io",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    body,
  });
}

function forecastRecord(overrides = {}) {
  return {
    id: "218410.KQ:2026-07-23:model-1",
    ticker: "218410.KQ",
    asOf: "2026-07-23",
    basePrice: 32000,
    modelVersion: "model-1",
    createdAt: 1784736000000,
    updatedAt: 1784736000000,
    horizons: {
      20: {
        targetDate: "2026-08-20",
        predictedPrice: 35000,
        lowerPrice: 29000,
        upperPrice: 41000,
      },
    },
    ...overrides,
  };
}

test("allows only ThinkStock and local app origins", () => {
  assert.equal(isAllowedOrigin("https://eg-tools.github.io"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:8787"), true);
  assert.equal(isAllowedOrigin("https://example.com"), false);
});

test("allows authenticated journal POST requests through CORS preflight", async () => {
  const response = await handleRequest(request("/api/forecast-journal", { method: "OPTIONS" }), {});
  assert.equal(response.status, 204);
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /POST/);
});

test("rejects disclosure requests without the personal access token", async () => {
  const response = await handleRequest(
    request("/api/dart/disclosures?ticker=005930.KS&corpCode=00126380"),
    { DART_API_KEY: "dart", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).ok, false);
});

test("checks the personal access token without requiring a ticker", async () => {
  const env = { THINKSTOCK_ACCESS_TOKEN: "private" };
  const valid = await handleRequest(request("/api/auth/check", { token: "private" }), env);
  const invalid = await handleRequest(request("/api/auth/check", { token: "wrong" }), env);

  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).ok, true);
  assert.equal(invalid.status, 401);
});

test("issues and renews server-signed admin sessions while rejecting retired codes", async () => {
  const cache = memoryKv();
  const legacyCode = "0987654321";
  const env = {
    THINKSTOCK_ACCESS_TOKEN: "private",
    THINKSTOCK_ADMIN_CODE: "1234567890",
    THINKSTOCK_ADMIN_SESSION_SECRET: "test-session-secret-that-is-longer-than-thirty-two-characters",
    DISCLOSURE_CACHE: cache,
  };
  const deviceId = "device-12345678";
  const login = await handleRequest(request("/api/admin/session", {
    method: "POST",
    token: "private",
    body: { action: "login", code: "1234567890", deviceId },
  }), env);
  const loginPayload = await login.json();
  assert.equal(login.status, 200);
  assert.equal(loginPayload.ok, true);
  assert.equal(JSON.stringify(loginPayload).includes("1234567890"), false);

  const refresh = await handleRequest(request("/api/admin/session", {
    method: "POST",
    token: "private",
    body: { action: "refresh", sessionToken: loginPayload.sessionToken, deviceId },
  }), env);
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).renewed, true);

  const legacyLogin = await handleRequest(request("/api/admin/session", {
    method: "POST",
    token: "private",
    body: { action: "login", code: legacyCode, deviceId: "legacy-login-device" },
  }), env);
  const legacyLoginPayload = await legacyLogin.json();
  assert.equal(legacyLogin.status, 401);
  assert.equal(legacyLoginPayload.ok, false);
  assert.equal(JSON.stringify(legacyLoginPayload).includes(legacyCode), false);

  const migration = await handleRequest(request("/api/admin/session", {
    method: "POST",
    token: "private",
    body: { action: "migrate", legacyProof: "a".repeat(64), deviceId: "legacy-device-123" },
  }), env);
  assert.equal(migration.status, 400);
  assert.equal((await migration.json()).ok, false);

  const rejected = await handleRequest(request("/api/admin/session", {
    method: "POST",
    token: "private",
    body: { action: "login", code: "0000000000", deviceId },
  }), env);
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).error, "접속코드가 틀렸습니다.");
});

test("admin sessions require the private gateway token and reject migration requests", async () => {
  const env = {
    THINKSTOCK_ACCESS_TOKEN: "private",
    THINKSTOCK_ADMIN_CODE: "1234567890",
    THINKSTOCK_ADMIN_SESSION_SECRET: "test-session-secret-that-is-longer-than-thirty-two-characters",
    DISCLOSURE_CACHE: memoryKv(),
  };
  const unauthorized = await handleRequest(request("/api/admin/session", {
    method: "POST",
    body: { action: "login", code: "1234567890", deviceId: "device-12345678" },
  }), env);
  assert.equal(unauthorized.status, 401);

  const retiredMigration = await handleRequest(request("/api/admin/session", {
    method: "POST",
    token: "private",
    body: { action: "migrate", legacyProof: "b".repeat(64), deviceId: "device-12345678" },
  }), env);
  assert.equal(retiredMigration.status, 400);
});

test("serves cached public VIX data without a personal access token or forced upstream refresh", async () => {
  const now = new Date();
  const checkDate = koreanDateText(now);
  const officialDate = expectedLatestKoreanTradingDate(now, { closeHour: 16, closeMinute: 0 });
  const savedAt = Date.now();
  const cache = memoryKv({
    "fred-crisis-signal:8": JSON.stringify({
      schema: 8,
      savedAt,
      lastCheckedDate: checkDate,
      latestDate: officialDate,
      source: "FRED + KRX",
      records: [{ date: officialDate, score: 0.2 }],
      vixRows: [{ date: officialDate, vix: 19.5 }],
      vkospiRows: [{ date: officialDate, vkospi: 21.2 }],
      vkospiOfficialLatestDate: officialDate,
      vkospiOfficialCheckedAt: savedAt,
      vkospiLiveDate: checkDate,
      vkospiLiveAttemptedAt: savedAt,
      vkospiLiveCheckedAt: savedAt,
      vkospiLive: true,
    }),
  });
  const response = await handleRequest(request("/api/crisis-signal?refresh=1"), {
    FRED_API_KEY: "fred",
    THINKSTOCK_ACCESS_TOKEN: "private",
    DISCLOSURE_CACHE: cache,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.cached, true);
  assert.deepEqual(payload.vixRows, [{ date: officialDate, vix: 19.5 }]);
});

test("returns authenticated ADR data and reuses the short Worker cache", async () => {
  const originalFetch = globalThis.fetch;
  const cache = memoryKv();
  const timestamp = Date.parse("2026-08-06T00:00:00+09:00");
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      `<script>const kospi_adr=[[${timestamp},91.2]];const kosdaq_adr=[[${timestamp},87.4]];</script>`,
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  };
  try {
    const env = { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache };
    const refreshed = await handleRequest(request("/api/adr?refresh=1", { token: "private" }), env);
    const payload = await refreshed.json();
    assert.equal(refreshed.status, 200);
    assert.equal(payload.cached, false);
    assert.deepEqual(payload.rows.at(-1), {
      date: "2026-08-06",
      adr_kospi: 91.2,
      adr_kosdaq: 87.4,
    });

    const cached = await handleRequest(request("/api/adr", { token: "private" }), env);
    assert.equal((await cached.json()).cached, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns the last validated ADR cache when every upstream path fails", async () => {
  const originalFetch = globalThis.fetch;
  const cache = memoryKv();
  const timestamp = Date.parse("2026-08-06T00:00:00+09:00");
  globalThis.fetch = async () => new Response(
    `<script>const kospi_adr=[[${timestamp},91.2]];const kosdaq_adr=[[${timestamp},87.4]];</script>`,
    { status: 200 },
  );
  try {
    const env = { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache };
    await handleRequest(request("/api/adr?refresh=1", { token: "private" }), env);
    globalThis.fetch = async () => new Response("blocked", { status: 503 });
    const response = await handleRequest(request("/api/adr?refresh=1", { token: "private" }), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cached, true);
    assert.equal(payload.stale, true);
    assert.equal(payload.latestDate, "2026-08-06");
    assert.equal(payload.rows.at(-1).adr_kospi, 91.2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns authenticated ECOS macro updates and reuses the Worker cache", async () => {
  const originalFetch = globalThis.fetch;
  const cache = memoryKv();
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const target = String(url);
    let rows;
    if (target.includes("/901Y067/")) rows = [{ TIME: "202607", DATA_VALUE: "104.8" }];
    else if (target.includes("/521Y001/")) rows = [{ TIME: "20260803", DATA_VALUE: "101.2" }];
    else if (target.includes("/722Y001/")) rows = [{ TIME: "202607", DATA_VALUE: "2.5" }];
    else if (target.includes("T002")) rows = [{ TIME: "202606", DATA_VALUE: "102166000" }];
    else rows = [{ TIME: "202606", DATA_VALUE: "66078000" }];
    return new Response(JSON.stringify({ StatisticSearch: { row: rows } }), { status: 200 });
  };
  try {
    const env = { ECOS_API_KEY: "ecos", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache };
    const refreshed = await handleRequest(request("/api/macro?refresh=1", { token: "private" }), env);
    const payload = await refreshed.json();
    assert.equal(refreshed.status, 200);
    assert.deepEqual(payload.leadingRows.at(-1), { date: "2026-07-01", leading_cycle: 104.8 });
    assert.deepEqual(payload.newsRows.at(-1), { date: "2026-08-03", news_sentiment: 101.2 });
    assert.deepEqual(payload.policyRateRows.at(-1), { date: "2026-07-01", policy_rate: 2.5 });
    assert.deepEqual(payload.tradeRows.at(-1), {
      date: "2026-06-01",
      export_value: 102166000,
      import_value: 66078000,
    });
    const cached = await handleRequest(request("/api/macro", { token: "private" }), env);
    assert.equal((await cached.json()).cached, true);
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps valid ECOS components when one macro series fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/901Y067/")) return new Response("unavailable", { status: 503 });
    let rows;
    if (target.includes("/521Y001/")) rows = [{ TIME: "20260812", DATA_VALUE: "101.2" }];
    else if (target.includes("/722Y001/")) rows = [{ TIME: "202607", DATA_VALUE: "2.5" }];
    else if (target.includes("/T002")) rows = [{ TIME: "202607", DATA_VALUE: "102166000" }];
    else rows = [{ TIME: "202607", DATA_VALUE: "66078000" }];
    return new Response(JSON.stringify({ StatisticSearch: { row: rows } }), { status: 200 });
  };
  try {
    const response = await handleRequest(request("/api/macro?refresh=1", { token: "private" }), {
      ECOS_API_KEY: "ecos",
      THINKSTOCK_ACCESS_TOKEN: "private",
      DISCLOSURE_CACHE: memoryKv(),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.leadingRows, []);
    assert.equal(payload.newsRows.at(-1).news_sentiment, 101.2);
    assert.equal(payload.policyRateRows.at(-1).policy_rate, 2.5);
    assert.equal(payload.partial, true);
    assert.match(payload.warning, /901Y067|선행/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns authenticated recent credit balances and caches the KOFIA response", async () => {
  const originalFetch = globalThis.fetch;
  const cache = memoryKv();
  let calls = 0;
  globalThis.fetch = async (url, options = {}) => {
    calls += 1;
    if (String(url).includes("indexergo.com")) {
      return new Response("blocked", { status: 403 });
    }
    if (String(url).includes("freesis.kofia.or.kr")) {
      const objectName = JSON.parse(options.body).dmSearch.OBJ_NM;
      const isFreesisDeposit = objectName === "STATSCU0100000060BO";
      return new Response(JSON.stringify({
        ds1: [isFreesisDeposit
          ? { TMPV1: "20260803", TMPV2: "68,700,000,000,000" }
          : {
            TMPV1: "20260803",
            TMPV3: "123,400,000,000,000",
            TMPV4: "45,600,000,000,000",
          }],
      }), { status: 200 });
    }
    const isDeposit = String(url).includes("getSecuritiesMarketTotalCapitalInfo");
    const item = isDeposit
      ? { basDt: "20260803", invrDpsgAmt: "68,700,000,000,000" }
      : { basDt: "20260803", crdTrFingScrs: "123,400,000,000,000", crdTrFingKosdaq: "45,600,000,000,000" };
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
        body: { items: { item: [item] }, totalCount: 1, numOfRows: 1000, pageNo: 1 },
      },
    }), { status: 200 });
  };
  try {
    const env = { THINKSTOCK_ACCESS_TOKEN: "private", KOFIA_API_KEY: "kofia-key", DISCLOSURE_CACHE: cache };
    const refreshed = await handleRequest(request("/api/credit?refresh=1", { token: "private" }), env);
    const payload = await refreshed.json();
    assert.equal(refreshed.status, 200);
    assert.deepEqual(payload.rows.at(-1), {
      date: "2026-08-03",
      customer_deposit: 68.7,
      kospi_credit: 123.4,
      kosdaq_credit: 45.6,
    });
    const callsAfterRefresh = calls;
    const cached = await handleRequest(request("/api/credit", { token: "private" }), env);
    assert.equal((await cached.json()).cached, true);
    assert.equal(callsAfterRefresh, 4);
    assert.equal(calls, callsAfterRefresh);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unpublished zero credit balances from newer KOFIA rows", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const isDeposit = String(url).includes("getSecuritiesMarketTotalCapitalInfo");
    const items = isDeposit
      ? [{ basDt: "20260804", invrDpsgAmt: "69,000,000,000,000" }]
      : [
        { basDt: "20260804", crdTrFingScrs: "0", crdTrFingKosdaq: "0" },
        { basDt: "20260803", crdTrFingScrs: "21,600,000,000,000", crdTrFingKosdaq: "5,800,000,000,000" },
      ];
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
        body: { items: { item: items }, totalCount: items.length },
      },
    }), { status: 200 });
  };
  try {
    const response = await handleRequest(request("/api/credit?refresh=1", { token: "private" }), {
      THINKSTOCK_ACCESS_TOKEN: "private",
      KOFIA_API_KEY: "kofia-key",
      DISCLOSURE_CACHE: memoryKv(),
    });
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.rows.some((row) => row.kospi_credit === 0 || row.kosdaq_credit === 0), false);
    assert.deepEqual(payload.rows.at(-1), { date: "2026-08-04", customer_deposit: 69 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts authenticated recent local credit rows and merges them into Worker storage", async () => {
  const cache = memoryKv();
  const response = await handleRequest(request("/api/credit/sync", {
    method: "POST",
    token: "private",
    body: {
      rows: [{
        date: "2026-08-13",
        customer_deposit: 100.0684,
        kospi_credit: 24.5349,
        kosdaq_credit: 6.3914,
      }],
    },
  }), {
    THINKSTOCK_ACCESS_TOKEN: "private",
    DISCLOSURE_CACHE: cache,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.latestDate, "2026-08-13");
  assert.equal(payload.accepted, 1);
  const stored = JSON.parse(cache.values.get("credit-macro:5"));
  assert.deepEqual(stored.rows.at(-1), {
    date: "2026-08-13",
    customer_deposit: 100.0684,
    kospi_credit: 24.5349,
    kosdaq_credit: 6.3914,
  });
});

test("rejects incomplete or implausible local credit synchronization", async () => {
  const response = await handleRequest(request("/api/credit/sync", {
    method: "POST",
    token: "private",
    body: { rows: [{ date: "2026-08-13", kospi_credit: 99999 }] },
  }), {
    THINKSTOCK_ACCESS_TOKEN: "private",
    DISCLOSURE_CACHE: memoryKv(),
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /유효한 신용 데이터/);
});

test("parses valid Freesis JSON without modifying numeric values", () => {
  const payload = parseFreesisPayload('{"ds1":[{"TMPV1":"20260804","TMPV3":21589187771369,"TMPV4":5814640223301}]}');
  assert.equal(payload.ds1[0].TMPV3, 21589187771369);
  assert.equal(payload.ds1[0].TMPV4, 5814640223301);
});

test("rejects masked Freesis numbers instead of converting them to zero", () => {
  assert.throws(
    () => parseFreesisPayload('{"ds1":[{"TMPV1":"20260804","TMPV3":2158918#######,"TMPV4":581464#######}]}'),
    /masked numeric values/,
  );
});

test("checks credit balances once after the 09:31 Korean market-data window", () => {
  assert.equal(creditRefreshWindowDate(new Date("2026-08-05T00:30:00Z")), "");
  assert.equal(creditRefreshWindowDate(new Date("2026-08-05T00:31:00Z")), "2026-08-05");
  assert.equal(creditRefreshWindowDate(new Date("2026-08-08T01:00:00Z")), "");
});

test("returns the latest authenticated KRX close for a stock", async () => {
  assert.deepEqual(krxStockPointFromRows([
    { ISU_CD: "005930", BAS_DD: "20260803", TDD_CLSPRC: "90,000" },
    { ISU_CD: "383220", BAS_DD: "20260803", TDD_CLSPRC: "61,800" },
  ], "383220.KS"), { date: "2026-08-03", close: 61800 });

  const originalFetch = globalThis.fetch;
  let authKey = "";
  const requestedPaths = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url);
    requestedPaths.push(target.pathname);
    if (target.hostname === "api.finance.naver.com") {
      return new Response('["20260803", 73900, 74000, 61400, 61800, 403680]', { status: 200 });
    }
    authKey = String(new Headers(options.headers).get("AUTH_KEY") || "");
    return new Response(JSON.stringify({
      OutBlock_1: [{ ISU_CD: "383220", BAS_DD: "20260803", TDD_CLSPRC: "61,800" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handleRequest(
      request("/api/prices?ticker=383220.KS", { token: "private" }),
      { KRX_API_KEY: "krx-secret", THINKSTOCK_ACCESS_TOKEN: "private" },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.source, "KRX");
    assert.deepEqual(payload.records, [{ date: "2026-08-03", close: 61800 }]);
    assert.equal(authKey, "krx-secret");
    assert.equal(requestedPaths.includes("/svc/apis/sto/stk_bydd_trd"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns both authenticated KRX core indices", async () => {
  assert.deepEqual(krxIndexPointFromRows([
    { IDX_NM: "KOSPI 200", BAS_DD: "20260805", CLSPRC_IDX: "500.1" },
    { IDX_NM: "KOSPI", BAS_DD: "20260805", CLSPRC_IDX: "3,210.5" },
  ], "KOSPI"), { date: "2026-08-05", close: 3210.5 });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url);
    assert.equal(String(new Headers(options.headers).get("AUTH_KEY") || ""), "krx-secret");
    const kosdaq = target.pathname.includes("kosdaq_dd_trd");
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
        BAS_DD: target.searchParams.get("basDd"),
        CLSPRC_IDX: kosdaq ? "1,012.3" : "3,210.5",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handleRequest(
      request("/api/indices", { token: "private" }),
      { KRX_API_KEY: "krx-secret", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.records.map((row) => row.ticker), ["^KS11", "^KQ11"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a partial index response even when one market and cache writes fail", async () => {
  const originalFetch = globalThis.fetch;
  const latestDate = expectedLatestKoreanTradingDate(new Date());
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.hostname === "api.finance.naver.com") return new Response("[]", { status: 200 });
    if (target.pathname.includes("kosdaq_dd_trd")) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({
      OutBlock_1: [{ IDX_NM: "KOSPI", BAS_DD: latestDate.replaceAll("-", ""), CLSPRC_IDX: "3,210.5" }],
    }), { status: 200 });
  };
  try {
    const response = await handleRequest(request("/api/indices?refresh=1", { token: "private" }), {
      KRX_API_KEY: "krx-secret",
      THINKSTOCK_ACCESS_TOKEN: "private",
      DISCLOSURE_CACHE: {
        async get() { return null; },
        async put() { throw new Error("KV unavailable"); },
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.records.map((row) => row.ticker), ["^KS11"]);
    assert.equal(payload.partial, true);
    assert.equal(payload.stale, true);
    assert.deepEqual(payload.missingTickers, ["^KQ11"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves last-good indices with authoritative stale metadata when both markets fail", async () => {
  const originalFetch = globalThis.fetch;
  const latestDate = expectedLatestKoreanTradingDate(new Date());
  let failSources = false;
  globalThis.fetch = async (url) => {
    if (failSources) throw new Error("upstream unavailable");
    const target = new URL(url);
    const kosdaq = target.pathname.includes("kosdaq_dd_trd");
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
        BAS_DD: latestDate.replaceAll("-", ""),
        CLSPRC_IDX: kosdaq ? "1,012.3" : "3,210.5",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const env = {
      KRX_API_KEY: "krx-secret",
      THINKSTOCK_ACCESS_TOKEN: "private",
      DISCLOSURE_CACHE: memoryKv(),
    };
    const initial = await handleRequest(request("/api/indices", { token: "private" }), env);
    assert.equal(initial.status, 200);
    assert.deepEqual((await initial.json()).records.map((row) => row.ticker), ["^KS11", "^KQ11"]);

    failSources = true;
    const response = await handleRequest(request("/api/indices?refresh=1", { token: "private" }), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cached, true);
    assert.equal(payload.stale, true);
    assert.deepEqual(payload.records.map((row) => row.ticker), ["^KS11", "^KQ11"]);
    assert.match(payload.warning, /KRX/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a validated recent index tail when the client supplies its latest date", async () => {
  const latestDate = expectedLatestKoreanTradingDate(new Date());
  const previous = new Date(`${latestDate}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousDate = previous.toISOString().slice(0, 10);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    const kosdaq = target.pathname.includes("kosdaq_dd_trd")
      || target.searchParams.get("symbol") === "KOSDAQ";
    const latestClose = kosdaq ? 1012.3 : 3210.5;
    if (target.hostname === "api.finance.naver.com") {
      const previousClose = latestClose - 10;
      return new Response(JSON.stringify([
        [previousDate.replaceAll("-", ""), previousClose, previousClose, previousClose, previousClose, 1],
        [latestDate.replaceAll("-", ""), latestClose, latestClose, latestClose, latestClose, 1],
      ]), { status: 200 });
    }
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
        BAS_DD: latestDate.replaceAll("-", ""),
        CLSPRC_IDX: String(latestClose),
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handleRequest(
      request(`/api/indices?since=${previousDate}`, { token: "private" }),
      { KRX_API_KEY: "krx-secret", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(
      payload.records.filter((row) => row.ticker === "^KS11").map((row) => row.date),
      [previousDate, latestDate],
    );
    assert.equal(payload.historySince, previousDate);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit KRX index refresh bypasses a fresh Worker cache", async () => {
  const originalFetch = globalThis.fetch;
  let sourceCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url);
    sourceCalls += 1;
    assert.equal(String(new Headers(options.headers).get("AUTH_KEY") || ""), "krx-secret");
    const kosdaq = target.pathname.includes("kosdaq_dd_trd");
    return new Response(JSON.stringify({
      OutBlock_1: [{
        IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
        BAS_DD: target.searchParams.get("basDd"),
        CLSPRC_IDX: kosdaq ? "1,012.3" : "3,210.5",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const cache = memoryKv();
    const env = {
      KRX_API_KEY: "krx-secret",
      THINKSTOCK_ACCESS_TOKEN: "private",
      DISCLOSURE_CACHE: cache,
    };
    const first = await handleRequest(request("/api/indices", { token: "private" }), env);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).cached, false);
    const firstSourceCalls = sourceCalls;
    assert.ok(firstSourceCalls >= 2);

    const cached = await handleRequest(request("/api/indices", { token: "private" }), env);
    assert.equal((await cached.json()).cached, true);
    assert.equal(sourceCalls, firstSourceCalls);

    const refreshed = await handleRequest(request("/api/indices?refresh=1", { token: "private" }), env);
    assert.equal((await refreshed.json()).cached, false);
    assert.ok(sourceCalls > firstSourceCalls);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses Naver only when it is newer than a delayed KRX close", async () => {
  assert.deepEqual(parseNaverPriceText(`
    [['날짜', '시가', '고가', '저가', '종가', '거래량'],
    ["20260731", 78900, 80600, 75900, 80500, 106753],
    ["20260803", 73900, 74000, 61400, 61800, 403680]]
  `), { date: "2026-08-03", close: 61800 });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.hostname === "api.finance.naver.com") {
      return new Response(`[
        ["20260731", 78900, 80600, 75900, 80500, 106753],
        ["20260803", 73900, 74000, 61400, 61800, 403680]
      ]`, { status: 200 });
    }
    return new Response(JSON.stringify({
      OutBlock_1: [{ ISU_CD: "383220", BAS_DD: "20260731", TDD_CLSPRC: "80,500" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handleRequest(
      request("/api/prices?ticker=383220.KS", { token: "private" }),
      { KRX_API_KEY: "krx-secret", THINKSTOCK_ACCESS_TOKEN: "private" },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.source, "NAVER_FALLBACK");
    assert.equal(payload.latestDate, "2026-08-03");
    assert.deepEqual(payload.records, [{ date: "2026-08-03", close: 61800 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parses Naver research history with close and volume", () => {
  assert.deepEqual(parseNaverResearchHistory(`
    <item data="20260806|100|110|90|105|12345" />
    <item data="20260807|105|120|100|118|45678" />
  `), [
    { date: "2026-08-06", close: 105, volume: 12345 },
    { date: "2026-08-07", close: 118, volume: 45678 },
  ]);
});

test("worker research history detects rebases and projects only the requested tail", () => {
  const existing = [
    { date: "2026-08-03", close: 100000 },
    { date: "2026-08-04", close: 102000 },
    { date: "2026-08-05", close: 98000 },
  ];
  assert.equal(detectResearchHistoryRebase(existing, [
    { date: "2026-08-03", close: 20000 },
    { date: "2026-08-04", close: 20400 },
    { date: "2026-08-05", close: 19600 },
  ]), true);

  const startTime = Date.parse("2025-01-01T00:00:00Z");
  const rows = Array.from({ length: 300 }, (_, index) => ({
    date: new Date(startTime + (index * 86400000)).toISOString().slice(0, 10),
    close: 10000 + index,
    volume: 100000 + index,
  }));
  const partial = projectResearchHistoryPayload({
    ticker: "005930.KS",
    latestDate: rows.at(-1).date,
    rows,
  }, rows.at(-1).date);
  assert.equal(partial.partial, true);
  assert.equal(partial.fullRowCount, 300);
  assert.ok(partial.rows.length < rows.length);

  const reset = projectResearchHistoryPayload({
    ticker: "005930.KS",
    latestDate: rows.at(-1).date,
    rebased: true,
    rows,
  }, rows.at(-1).date);
  assert.equal(reset.partial, false);
  assert.equal(reset.reset, true);
  assert.equal(reset.rows.length, 300);
});

test("stores and returns an authenticated stock-research summary", async () => {
  const cache = memoryKv();
  const env = { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache };
  const query = "/api/research/summary?strategy=top400-recovery-v1&minimum=5";
  const saved = await handleRequest(request(query, {
    method: "POST",
    token: "private",
    body: {
      schema: 1,
      strategy: "top400-recovery-v1",
      baseDate: "2026-08-07",
      minimumBuySignals: 5,
      universeTickers: ["005930.KS"],
      candidatePool: [{
        ticker: "005930.KS",
        name: "삼성전자",
        market: "KOSPI",
        marketRank: 1,
        buyCount: 5,
        lastBuyDate: "2026-08-01",
      }],
    },
  }), env);
  assert.equal(saved.status, 200);

  const loaded = await handleRequest(request(query, { token: "private" }), env);
  const payload = await loaded.json();
  assert.equal(loaded.status, 200);
  assert.equal(payload.candidatePool[0].ticker, "005930.KS");
});

test("loads a fresh research profile when the Worker cache is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    '<a href="/sise/sise_group_detail.naver?type=upjong&no=1">Semiconductor</a>',
    { status: 200 },
  );
  try {
    const response = await handleRequest(
      request("/api/research/profile?ticker=005930.KS", { token: "private" }),
      {
        THINKSTOCK_ACCESS_TOKEN: "private",
        DISCLOSURE_CACHE: {
          async get() { throw new Error("KV read unavailable"); },
          async put() { throw new Error("KV write unavailable"); },
        },
      },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cached, false);
    assert.equal(payload.category, "Semiconductor");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a Naver fallback when its overlapping KRX close does not match", () => {
  const evaluation = evaluateNaverPriceFallback(
    { date: "2026-07-31", close: 80500 },
    [
      { date: "2026-07-31", close: 60000 },
      { date: "2026-08-03", close: 61800 },
    ],
  );
  assert.equal(evaluation.accepted, false);
  assert.equal(evaluation.status, "mismatch");
});

test("accepts a same-day Naver quote only during the current-price window", () => {
  const krxPoint = { date: "2026-08-10", close: 233000 };
  const naverPoints = [
    { date: "2026-08-07", close: 231000 },
    { date: "2026-08-10", close: 233500 },
  ];
  assert.equal(evaluateNaverPriceFallback(krxPoint, naverPoints).accepted, false);
  assert.deepEqual(evaluateNaverPriceFallback(krxPoint, naverPoints, { allowSameDate: true }), {
    accepted: true,
    status: "matched-live",
    point: { date: "2026-08-10", close: 233500 },
    overlapRatio: 233500 / 233000,
    jumpRatio: null,
  });
});

test("reuses one compact KRX market snapshot for multiple stocks", async () => {
  const expectedDate = expectedLatestKoreanTradingDate(new Date());
  const rawDate = expectedDate.replaceAll("-", "");
  const rows = [
    { ISU_CD: "005930", BAS_DD: rawDate, TDD_CLSPRC: "90,000" },
    { ISU_CD: "383220", BAS_DD: rawDate, TDD_CLSPRC: "61,800" },
  ];
  const snapshot = krxMarketSnapshotFromRows(rows, "KS", expectedDate);
  assert.deepEqual(snapshot.prices, { "005930": 90000, "383220": 61800 });

  const originalFetch = globalThis.fetch;
  const cache = memoryKv();
  let krxCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).hostname === "api.finance.naver.com") {
      return new Response("[]", { status: 200 });
    }
    krxCalls += 1;
    return new Response(JSON.stringify({ OutBlock_1: rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const env = {
    KRX_API_KEY: "krx-secret",
    THINKSTOCK_ACCESS_TOKEN: "private",
    DISCLOSURE_CACHE: cache,
  };
  try {
    const first = await handleRequest(request("/api/prices?ticker=005930.KS", { token: "private" }), env);
    const second = await handleRequest(request("/api/prices?ticker=383220.KS", { token: "private" }), env);
    assert.equal((await first.json()).cached, false);
    assert.equal((await second.json()).cached, true);
    assert.equal(krxCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns multiple current prices through one batch request", async () => {
  const expectedDate = expectedLatestKoreanTradingDate(new Date());
  const rawDate = expectedDate.replaceAll("-", "");
  const rows = [
    { ISU_CD: "005930", BAS_DD: rawDate, TDD_CLSPRC: "90,000" },
    { ISU_CD: "000660", BAS_DD: rawDate, TDD_CLSPRC: "300,000" },
  ];
  const originalFetch = globalThis.fetch;
  let krxCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).hostname === "api.finance.naver.com") {
      return new Response("[]", { status: 200 });
    }
    krxCalls += 1;
    return new Response(JSON.stringify({ OutBlock_1: rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await handleRequest(
      request("/api/prices/batch?tickers=005930.KS,000660.KS", { token: "private" }),
      {
        KRX_API_KEY: "krx-secret",
        THINKSTOCK_ACCESS_TOKEN: "private",
        DISCLOSURE_CACHE: memoryKv(),
      },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.requested, 2);
    assert.equal(payload.succeeded, 2);
    assert.deepEqual(payload.results.map((result) => result.ticker), ["005930.KS", "000660.KS"]);
    assert.equal(krxCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns indices and visible prices through one authenticated bootstrap request", async () => {
  const expectedDate = expectedLatestKoreanTradingDate(new Date());
  const rawDate = expectedDate.replaceAll("-", "");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.hostname === "api.finance.naver.com") {
      return new Response("[]", { status: 200 });
    }
    if (target.pathname.includes("/idx/")) {
      const kosdaq = target.pathname.includes("kosdaq_dd_trd");
      return new Response(JSON.stringify({
        OutBlock_1: [{
          IDX_NM: kosdaq ? "KOSDAQ" : "KOSPI",
          BAS_DD: rawDate,
          CLSPRC_IDX: kosdaq ? "860" : "3,200",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      OutBlock_1: [{ ISU_CD: "005930", BAS_DD: rawDate, TDD_CLSPRC: "90,000" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handleRequest(
      request("/api/bootstrap?tickers=005930.KS", { token: "private" }),
      {
        KRX_API_KEY: "krx-secret",
        THINKSTOCK_ACCESS_TOKEN: "private",
        DISCLOSURE_CACHE: memoryKv(),
      },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.partial, false);
    assert.deepEqual(payload.indices.records.map((row) => row.ticker), ["^KS11", "^KQ11"]);
    assert.deepEqual(payload.prices.results.map((row) => row.ticker), ["005930.KS"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a fresh per-ticker KV cache without contacting DART", async () => {
  const cachedRecord = { ticker: "005930.KS", date: "2026-07-21", title: "유상증자 결정" };
  const cache = memoryKv({
    "ticker:005930.KS": JSON.stringify({
      schema: 1,
      ticker: "005930.KS",
      savedAt: Date.now(),
      latestDate: "2026-07-21",
      records: [cachedRecord],
    }),
  });
  const response = await handleRequest(
    request("/api/dart/disclosures?ticker=005930.KS&corpCode=00126380", { token: "private" }),
    { DART_API_KEY: "dart", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.cached, true);
  assert.deepEqual(payload.records, [cachedRecord]);
});

test("rechecks DART instead of trusting a fresh empty ticker cache", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const cache = memoryKv({
    "ticker:259960.KS": JSON.stringify({
      schema: 1,
      ticker: "259960.KS",
      savedAt: Date.now(),
      latestDate: "",
      complete: true,
      records: [],
    }),
  });
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({
      status: "000",
      total_page: 1,
      list: [{
        corp_name: "크래프톤",
        report_nm: "연결재무제표기준영업(잠정)실적(공정공시)",
        rcept_dt: "20260701",
        rcept_no: "202607010001",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handleRequest(
      request("/api/dart/disclosures?ticker=259960.KS&corpCode=00760971&progressive=1&page=1", { token: "private" }),
      { DART_API_KEY: "dart", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cached, false);
    assert.equal(payload.records.length, 1);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns newest DART pages progressively and completes the ticker cache", async () => {
  const originalFetch = globalThis.fetch;
  const requestedPages = [];
  const cache = memoryKv();
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get("page_no"));
    requestedPages.push(page);
    return new Response(JSON.stringify({
      status: "000",
      total_page: 5,
      list: [{
        corp_name: "테스트",
        report_nm: page === 1 ? "유상증자결정" : "공급계약체결",
        rcept_dt: `202607${String(23 - page).padStart(2, "0")}`,
        rcept_no: String(page),
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const firstResponse = await handleRequest(
      request("/api/dart/disclosures?ticker=005930.KS&corpCode=00126380&progressive=1&page=1&force=1", { token: "private" }),
      { DART_API_KEY: "dart", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache },
    );
    const first = await firstResponse.json();
    assert.equal(first.records.length, 4);
    assert.equal(first.page, 4);
    assert.equal(first.nextPage, 5);
    assert.equal(first.complete, false);
    assert.equal(JSON.parse(cache.values.get("ticker:005930.KS")).complete, false);

    const secondResponse = await handleRequest(
      request(`/api/dart/disclosures?ticker=005930.KS&corpCode=00126380&progressive=1&page=5&force=1&since=${first.checkedFrom}`, { token: "private" }),
      { DART_API_KEY: "dart", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache },
    );
    const second = await secondResponse.json();
    const completedCache = JSON.parse(cache.values.get("ticker:005930.KS"));
    assert.equal(second.records.length, 1);
    assert.equal(second.nextPage, null);
    assert.equal(second.complete, true);
    assert.equal(completedCache.complete, true);
    assert.equal(completedCache.records.length, 5);
    assert.deepEqual(requestedPages, [1, 2, 3, 4, 5]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("merges disclosures by receipt number and keeps the newest payload", () => {
  const oldRecord = { ticker: "005930.KS", date: "2026-07-20", title: "배당 결정", receiptNo: "1", name: "old" };
  const newRecord = { ...oldRecord, name: "new" };
  const merged = mergeRecords([oldRecord], [newRecord]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "new");
});

test("normalizes DART insider ownership changes and merges revised reports", () => {
  const buy = insiderRecordFromItem("218410.KQ", {
    rcept_dt: "2026-07-31",
    rcept_no: "20260731000123",
    repror: "홍길동",
    isu_exctv_rgist_at: "등기임원",
    isu_exctv_ofcps: "대표이사",
    sp_stock_lmp_cnt: "10,000",
    sp_stock_lmp_irds_cnt: "1,250",
    sp_stock_lmp_rate: "1.25",
  });
  const revised = { ...buy, sharesChanged: 1300 };
  const sell = insiderRecordFromItem("218410.KQ", {
    rcept_dt: "20260730",
    rcept_no: "20260730000123",
    repror: "김주주",
    isu_main_shrholdr: "10%이상주주",
    sp_stock_lmp_cnt: "9,500",
    sp_stock_lmp_irds_cnt: "-500",
  });

  assert.equal(buy.side, "buy");
  assert.equal(buy.role, "등기임원 · 대표이사");
  assert.equal(sell.side, "sell");
  const merged = mergeInsiderRecords([buy], [revised, sell]);
  assert.equal(merged.length, 2);
  assert.equal(merged.at(-1).sharesChanged, 1300);
});

test("parses every major-holder transaction row from one DART original document", () => {
  const xml = `<DOCUMENT><TABLE>
    <TR><TE ACODE="SPC_NM">Morgan Stanley &amp; Co.</TE><TU AUNIT="MDF_DT">2026.07.20</TU><TU AUNIT="HLD_MTH">장내매도(-)</TU><TU AUNIT="STK_KND">의결권있는 주식</TU><TE ACODE="BFR_MDF_CNT">1,337,773</TE><TE ACODE="MDF_SDK_CNT">-4,767</TE><TE ACODE="AFR_MDF_CNT">1,333,006</TE><TE ACODE="HLD_UNT_PRJ">42,992</TE></TR>
    <TR><TE ACODE="SPC_NM">Morgan Stanley &amp; Co.</TE><TU AUNIT="MDF_DT">2026.07.20</TU><TU AUNIT="HLD_MTH">장내매수(+)</TU><TU AUNIT="STK_KND">의결권있는 주식</TU><TE ACODE="BFR_MDF_CNT">1,333,006</TE><TE ACODE="MDF_SDK_CNT">13,725</TE><TE ACODE="AFR_MDF_CNT">1,346,731</TE><TE ACODE="HLD_UNT_PRJ">42,695</TE></TR>
  </TABLE></DOCUMENT>`;
  const report = {
    rcept_no: "20260721001006",
    repror: "MORGANSTANLEY&COINTLPLC",
    stkrt: "5.07",
  };

  const rows = parseMajorHolderDocument("218410.KQ", xml, report);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.side), ["sell", "buy"]);
  assert.deepEqual(rows.map((row) => row.sharesChanged), [-4767, 13725]);
  assert.deepEqual(rows.map((row) => row.sharesOwned), [1333006, 1346731]);
  assert.equal(rows[1].ownershipRate, 5.07);
  assert.equal(rows[1].transactionMethod, "장내매수(+)");
  assert.equal(rows[1].recordType, "major-holder-detail");
  assert.equal(mergeInsiderRecords([], rows).length, 2);
});

test("returns three years of authenticated insider trades and caches the result", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const cache = memoryKv();
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    if (new URL(url).pathname === "/api/majorstock.json") {
      return new Response(JSON.stringify({ status: "013", list: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    assert.equal(new URL(url).pathname, "/api/elestock.json");
    return new Response(JSON.stringify({
      status: "000",
      list: [
        {
          rcept_dt: new Date().toISOString().slice(0, 10),
          rcept_no: "20260803000123",
          repror: "홍길동",
          sp_stock_lmp_cnt: "10,000",
          sp_stock_lmp_irds_cnt: "1,250",
        },
        {
          rcept_dt: "2020-01-01",
          rcept_no: "20200101000123",
          repror: "과거보고자",
          sp_stock_lmp_irds_cnt: "100",
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const env = {
      DART_API_KEY: "dart",
      THINKSTOCK_ACCESS_TOKEN: "private",
      DISCLOSURE_CACHE: cache,
    };
    const path = "/api/dart/insider-trades?ticker=218410.KQ&corpCode=01035674";
    const first = await handleRequest(request(path, { token: "private" }), env);
    const firstPayload = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstPayload.cached, false);
    assert.equal(firstPayload.records.length, 1);
    assert.equal(firstPayload.records[0].side, "buy");

    const second = await handleRequest(request(path, { token: "private" }), env);
    const secondPayload = await second.json();
    assert.equal(secondPayload.cached, true);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("combines DART majorstock originals with insider ownership records", async () => {
  const originalFetch = globalThis.fetch;
  const cache = memoryKv();
  const receiptNo = "20260721001006";
  const xml = `<DOCUMENT><TABLE>
    <TR><TE ACODE="SPC_NM">Morgan Stanley</TE><TU AUNIT="MDF_DT">2026.07.20</TU><TU AUNIT="HLD_MTH">장내매도(-)</TU><TU AUNIT="STK_KND">의결권있는 주식</TU><TE ACODE="BFR_MDF_CNT">1,337,773</TE><TE ACODE="MDF_SDK_CNT">-4,767</TE><TE ACODE="AFR_MDF_CNT">1,333,006</TE></TR>
    <TR><TE ACODE="SPC_NM">Morgan Stanley</TE><TU AUNIT="MDF_DT">2026.07.20</TU><TU AUNIT="HLD_MTH">장내매수(+)</TU><TU AUNIT="STK_KND">의결권있는 주식</TU><TE ACODE="BFR_MDF_CNT">1,333,006</TE><TE ACODE="MDF_SDK_CNT">13,725</TE><TE ACODE="AFR_MDF_CNT">1,346,731</TE></TR>
  </TABLE></DOCUMENT>`;
  const archive = zipSync({ [`${receiptNo}.xml`]: strToU8(xml) });
  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/api/elestock.json") {
      return new Response(JSON.stringify({ status: "013", list: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (pathname === "/api/majorstock.json") {
      return new Response(JSON.stringify({
        status: "000",
        list: [{ rcept_no: receiptNo, rcept_dt: "20260721", repror: "MORGANSTANLEY&COINTLPLC", stkrt: "5.07" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.equal(pathname, "/api/document.xml");
    return new Response(archive, {
      status: 200,
      headers: { "Content-Type": "application/zip", "Content-Length": String(archive.byteLength) },
    });
  };

  try {
    const env = {
      DART_API_KEY: "secret",
      THINKSTOCK_ACCESS_TOKEN: "private",
      DISCLOSURE_CACHE: cache,
    };
    const response = await handleRequest(request(
      "/api/dart/insider-trades?ticker=218410.KQ&corpCode=01078178",
      { token: "private" },
    ), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.records.length, 2);
    assert.deepEqual(payload.records.map((row) => row.side).sort(), ["buy", "sell"]);
    assert.equal(payload.records.every((row) => row.receiptNo === receiptNo), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports a safe warning when every major-holder original document fails", async () => {
  const originalFetch = globalThis.fetch;
  const receiptNo = "20260721001006";
  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/api/elestock.json") {
      return new Response(JSON.stringify({
        status: "000",
        list: [{
          rcept_dt: "20260731",
          rcept_no: "20260731000123",
          repror: "홍길동",
          sp_stock_lmp_cnt: "10,000",
          sp_stock_lmp_irds_cnt: "1,250",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (pathname === "/api/majorstock.json") {
      return new Response(JSON.stringify({
        status: "000",
        list: [{ rcept_no: receiptNo, rcept_dt: "20260721", repror: "MORGANSTANLEY" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("blocked", { status: 403 });
  };

  try {
    const response = await handleRequest(request(
      "/api/dart/insider-trades?ticker=218410.KQ&corpCode=01078178&force=1",
      { token: "private" },
    ), {
      DART_API_KEY: "secret",
      THINKSTOCK_ACCESS_TOKEN: "private",
      DISCLOSURE_CACHE: memoryKv(),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.records.length, 1);
    assert.deepEqual(payload.warnings, ["major-holder: DART major-holder documents failed: DART document HTTP 403"]);
    assert.equal(JSON.stringify(payload).includes("secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parses Naver WiseReport consensus values", () => {
  const html = `<table id="cTB15"><tr><th>opinion</th></tr><tr>
    <td><b>4.00</b></td><td>132,600</td><td>1,665</td><td>26.16</td><td>5</td>
  </tr></table>`;
  const result = parseConsensusHtml(html, "218410.KQ");
  assert.equal(result.opinion, 4);
  assert.equal(result.targetPrice, 132600);
  assert.equal(result.institutions, 5);
});

test("keeps the newest DART page when a later progressive page fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get("page_no"));
    if (page === 2) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({
      status: "000",
      total_page: 4,
      list: [{
        corp_name: "테스트",
        report_nm: "공급계약체결",
        rcept_dt: `202607${String(23 - page).padStart(2, "0")}`,
        rcept_no: String(page),
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handleRequest(
      request("/api/dart/disclosures?ticker=005930.KS&corpCode=00126380&progressive=1&page=1&force=1", { token: "private" }),
      { DART_API_KEY: "dart", THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.records.length, 1);
    assert.equal(payload.page, 1);
    assert.equal(payload.nextPage, 2);
    assert.equal(payload.complete, false);
    assert.match(payload.warning, /다음 페이지/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parses recent Naver stock news with dates and deduplicated links", () => {
  const html = `<div class="sub_section news_section"><ul>
    <li><span class="txt"><a href="/item/news_read.naver?article_id=1&amp;office_id=2&amp;code=005930">사상 최대 실적&amp;수주</a></span><span class="info">연합뉴스</span><em> 08/08</em></li>
    <li><span class="txt"><a href="/item/news_read.naver?article_id=1&amp;office_id=2&amp;code=005930">사상 최대 실적&amp;수주</a></span><em> 08/08</em></li>
    <li><span class="txt"><a href="/item/news_read.naver?article_id=3&amp;office_id=4&amp;code=005930">목표가 하향</a></span><em> 12/31</em></li>
  </ul></div>`;
  const result = parseNaverNewsHtml(html, "005930.KS", new Date("2026-01-03T00:00:00Z"));
  assert.equal(result.length, 2);
  assert.equal(result[0].date, "2025-12-31");
  assert.equal(result[1].title, "사상 최대 실적&수주");
  assert.equal(result[1].source, "연합뉴스");
  assert.match(result[1].url, /code=005930/);

  const newYearHtml = `<li><a href="/item/news_read.naver?article_id=4&amp;office_id=5&amp;code=005930">새해 뉴스</a><em>01/01</em></li>`;
  const newYearResult = parseNaverNewsHtml(
    newYearHtml,
    "005930.KS",
    new Date("2025-12-31T15:30:00Z"),
  );
  assert.equal(newYearResult[0].date, "2026-01-01");
});

test("parses annual and quarterly WiseReport financial summaries", () => {
  const html = `<table><thead><tr>
    <th class="r02c00">2024/12</th><th class="r02c01">2025/12</th>
    <th class="r02c04">2025/12</th><th class="r02c05">2026/03</th>
  </tr></thead><tbody>
    <tr><th>매출액</th><td title="1,000"></td><td title="1,300"></td><td title="320"></td><td title="410"></td></tr>
    <tr><th>영업이익(발표기준)</th><td title="100"></td><td title="180"></td><td title="42"></td><td title="61"></td></tr>
    <tr><th>당기순이익(지배)</th><td title="70"></td><td title="120"></td><td title="31"></td><td title="48"></td></tr>
    <tr><th>EPS</th><td title="700"></td><td title="1,200"></td><td title="310"></td><td title="480"></td></tr>
  </tbody></table>`;
  const result = parseFinancialSummaryHtml(html, "218410.KQ");
  assert.equal(result.length, 4);
  assert.deepEqual(result[1], {
    ticker: "218410.KQ",
    period: "2025-12",
    frequency: "annual",
    estimate: false,
    revenue: 1300,
    operatingProfit: 180,
    netIncome: 120,
    eps: 1200,
  });
  assert.equal(result[3].frequency, "quarter");
});

test("parses embedded quarterly earnings without a second upstream request", () => {
  const html = `<script>var EarnigList = function() {
    var res = {"yymm":["202512","202603","202606"],"data":[
      {"1":90.3,"2":70,"3":122.2},{"1":110.7,"2":77.3,"3":null},
      {"1":22.6,"2":10.5,"3":null},{"1":349.8,"2":107.1,"3":null},
      {"1":50.4,"2":-32.6,"3":null},{"1":81,"2":67,"3":99},
      {"1":118.3,"2":67.1,"3":null},{"1":46,"2":0.1,"3":null},
      {"1":1494.9,"2":71.6,"3":null},{"1":108.6,"2":-44,"3":null}
    ],"yymmdd":["2026/01/26(connected)","2026/04/27(connected)",null],"type":[1,1,0]};
  };</script>`;
  const result = parseEarningsTrendHtml(html, "218410.KQ");
  assert.equal(result.length, 3);
  assert.equal(result[0].operatingProfit, 110.7);
  assert.equal(result[0].operatingProfitConsensus, 90.3);
  assert.equal(result[0].operatingProfitSurprise, 22.6);
  assert.equal(result[0].reportDate, "2026-01-26");
  assert.equal(result[2].estimate, true);
  assert.equal(result[2].operatingProfit, 122.2);
  assert.equal(result[2].netIncome, 99);
});

test("merges newly collected financial periods without discarding history", () => {
  const old = { ticker: "218410.KQ", period: "2024-12", frequency: "annual", revenue: 1000 };
  const revised = { ticker: "218410.KQ", period: "2024-12", frequency: "annual", revenue: 1010 };
  const added = { ticker: "218410.KQ", period: "2025-12", frequency: "annual", revenue: 1300 };
  const result = mergeFinancialRecords([old], [revised, added]);
  assert.equal(result.length, 2);
  assert.equal(result[0].revenue, 1010);
  assert.equal(result[1].period, "2025-12");
});

test("merges complementary summary and earnings fields for the same quarter", () => {
  const summary = {
    ticker: "218410.KQ", period: "2026-06", frequency: "quarter",
    revenue: 410, operatingProfit: 61, netIncome: 48, eps: 480,
  };
  const earnings = {
    ticker: "218410.KQ", period: "2026-06", frequency: "quarter",
    operatingProfit: 63, operatingProfitConsensus: 55,
    operatingProfitSurprise: 14.5, reportDate: "2026-08-12",
  };
  const [result] = mergeFinancialRecords([summary], [earnings]);
  assert.equal(result.revenue, 410);
  assert.equal(result.operatingProfit, 63);
  assert.equal(result.operatingProfitConsensus, 55);
  assert.equal(result.reportDate, "2026-08-12");
});

test("returns a fresh consensus KV cache without requiring the DART key", async () => {
  const consensus = { ticker: "218410.KQ", targetPrice: 132600, institutions: 5 };
  const cache = memoryKv({
    "consensus:218410.KQ": JSON.stringify({
      schema: 1,
      ticker: "218410.KQ",
      savedAt: Date.now(),
      consensus,
    }),
  });
  const response = await handleRequest(
    request("/api/consensus?ticker=218410.KQ", { token: "private" }),
    { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.cached, true);
  assert.deepEqual(payload.consensus, consensus);
});

test("returns today's accumulated analysis cache without an upstream request", async () => {
  const financials = [{
    ticker: "218410.KQ",
    period: "2025-12",
    frequency: "annual",
    estimate: false,
    revenue: 1300,
  }];
  const cache = memoryKv({
    "analysis:218410.KQ": JSON.stringify({
      schema: 4,
      ticker: "218410.KQ",
      savedAt: Date.now(),
      consensus: null,
      financials,
      news: [],
    }),
  });
  const response = await handleRequest(
    request("/api/analysis?ticker=218410.KQ", { token: "private" }),
    { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.cached, true);
  assert.deepEqual(payload.financials, financials);
  assert.equal(payload.snapshots.length, 1);
  const migrated = JSON.parse(cache.values.get("analysis:218410.KQ"));
  assert.equal(migrated.schema, 5);
  assert.equal(migrated.snapshots.length, 1);
  assert.deepEqual(migrated.snapshots[0].financials, financials);
});

test("refreshes today's company analysis only when explicitly requested", async () => {
  const originalFetch = globalThis.fetch;
  const cache = memoryKv({
    "analysis:218410.KQ": JSON.stringify({
      schema: 4,
      ticker: "218410.KQ",
      savedAt: Date.now(),
      consensus: null,
      financials: [{ ticker: "218410.KQ", period: "2025-12", frequency: "annual", revenue: 1300 }],
      news: [],
      snapshots: [],
    }),
  });
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const target = String(url);
    const body = target.includes("navercomp.wisereport.co.kr")
      ? `<table id="cTB15"><tr><th>opinion</th></tr><tr><td><b>4.00</b></td><td>132,600</td><td>1,665</td><td>26.16</td><td>5</td></tr></table>`
      : `<li><a href="/item/news_read.naver?article_id=4&amp;office_id=5&amp;code=218410">대규모 공급계약 체결</a><em>08/08</em></li>`;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
  try {
    const response = await handleRequest(
      request("/api/analysis?ticker=218410.KQ&refresh=1", { token: "private" }),
      { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cached, false);
    assert.equal(payload.news[0].title, "대규모 공급계약 체결");
    assert.equal(calls, 2);
    assert.equal(JSON.parse(cache.values.get("analysis:218410.KQ")).news.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves the last valid company news when only the news upstream fails", async () => {
  const originalFetch = globalThis.fetch;
  const previousNews = [{
    ticker: "218410.KQ",
    date: "2026-08-07",
    title: "기존 정상 뉴스",
    source: "Naver Finance",
    url: "https://finance.naver.com/item/news_read.naver?code=218410&article_id=1",
    clusterSize: 1,
    clusterSources: ["Naver Finance"],
  }];
  const cache = memoryKv({
    "analysis:218410.KQ": JSON.stringify({
      schema: 4,
      ticker: "218410.KQ",
      savedAt: Date.now(),
      consensus: null,
      financials: [{ ticker: "218410.KQ", period: "2025-12", frequency: "annual", revenue: 1300 }],
      news: previousNews,
      snapshots: [],
    }),
  });
  globalThis.fetch = async (url) => {
    if (String(url).includes("finance.naver.com")) return new Response("", { status: 503 });
    return new Response(
      `<table id="cTB15"><tr><th>opinion</th></tr><tr><td><b>4.00</b></td><td>132,600</td><td>1,665</td><td>26.16</td><td>5</td></tr></table>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  };
  try {
    const response = await handleRequest(
      request("/api/analysis?ticker=218410.KQ&refresh=1", { token: "private" }),
      { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.news, previousNews);
    assert.deepEqual(JSON.parse(cache.values.get("analysis:218410.KQ")).news, previousNews);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps recent analysis changes while retaining older monthly history", () => {
  const snapshots = [];
  for (let index = 0; index < 62; index += 1) {
    const savedAt = Date.UTC(2021 + Math.floor(index / 12), index % 12, 1);
    snapshots.push({
      asOf: new Date(savedAt).toISOString().slice(0, 10),
      savedAt,
      consensus: { targetPrice: 10000 + index },
      financials: [],
    });
  }
  const replacement = {
    ...snapshots.at(-1),
    savedAt: snapshots.at(-1).savedAt + 1000,
    consensus: { targetPrice: 99999 },
  };
  const result = mergeAnalysisSnapshots(snapshots, [replacement]);
  assert.equal(result.length, 62);
  assert.equal(result[0].asOf, "2021-01-01");
  assert.equal(result.at(-1).consensus.targetPrice, 99999);
});

test("rejects forecast journal requests without the personal access token", async () => {
  const response = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ"),
    { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() },
  );
  assert.equal(response.status, 401);
});

test("returns an empty forecast journal for a ticker without saved forecasts", async () => {
  const response = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", { token: "private" }),
    { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.schema, 1);
  assert.deepEqual(payload.records, []);
});

test("merges forecast records and mature evaluation results across devices", async () => {
  const cache = memoryKv();
  const env = { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: cache };
  const first = forecastRecord();
  const firstResponse = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: { ticker: "218410.KQ", records: [first] },
    }),
    env,
  );
  assert.equal(firstResponse.status, 200);

  const scored = forecastRecord({
    updatedAt: first.updatedAt + 1000,
    horizons: {
      20: {
        ...first.horizons[20],
        actualDate: "2026-08-20",
        actualPrice: 36000,
        absoluteLogError: 0.028171,
        directionCorrect: true,
        covered: true,
        scoredAt: first.updatedAt + 1000,
      },
    },
  });
  const second = forecastRecord({
    id: "218410.KQ:2026-07-24:model-1",
    asOf: "2026-07-24",
    createdAt: first.createdAt + 2000,
    updatedAt: first.updatedAt + 2000,
  });
  const secondResponse = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: { records: [scored, second] },
    }),
    env,
  );
  const payload = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(payload.records.length, 2);
  assert.equal(payload.records[0].horizons[20].actualPrice, 36000);
  assert.equal(payload.records[0].horizons[20].directionCorrect, true);

  const saved = JSON.parse(cache.values.get("forecast-journal:218410.KQ"));
  assert.equal(saved.schema, 1);
  assert.equal(saved.records.length, 2);
});

test("keeps a newer forecast record when an older device posts stale data", () => {
  const current = forecastRecord({ createdAt: 1000, updatedAt: 2000 });
  const stale = forecastRecord({ createdAt: 1000, updatedAt: 1500, basePrice: 1 });
  const records = mergeForecastJournalRecords([current], [stale], "218410.KQ", { strictIncoming: true });
  assert.equal(records.length, 1);
  assert.equal(records[0].basePrice, current.basePrice);
});

test("does not erase a matured score when another device posts an unscored copy", () => {
  const base = forecastRecord();
  const scored = forecastRecord({
    updatedAt: base.updatedAt + 1000,
    horizons: {
      20: {
        ...base.horizons[20],
        actualDate: "2026-08-20",
        actualPrice: 36000,
        absoluteLogError: 0.028171,
        directionCorrect: true,
        covered: true,
        scoredAt: base.updatedAt + 1000,
      },
    },
  });
  const unscored = forecastRecord({ updatedAt: base.updatedAt + 2000 });
  const records = mergeForecastJournalRecords([scored], [unscored], "218410.KQ", { strictIncoming: true });
  assert.equal(records[0].horizons[20].actualPrice, 36000);
  assert.equal(records[0].updatedAt, unscored.updatedAt);
});

test("accepts the browser journal nested score format", async () => {
  const record = forecastRecord();
  record.horizons[20].score = {
    actualDate: "2026-08-20",
    actualPrice: 36000,
    actualLogReturn: 0.02,
    predictedLogReturn: 0.03,
    absLogError: 0.01,
    directionCorrect: true,
    intervalCovered: true,
    scoredAt: record.updatedAt + 1000,
  };
  const response = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: { records: [record] },
    }),
    { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.records[0].horizons[20].absoluteLogError, 0.01);
  assert.ok(Math.abs(payload.records[0].horizons[20].signedLogError + 0.01) < 1e-12);
  assert.ok(Math.abs(payload.records[0].horizons[20].squaredLogError - 0.0001) < 1e-12);
  assert.equal(payload.records[0].horizons[20].covered, true);
});

test("preserves bounded forecast audit features and numeric attribution", async () => {
  const record = forecastRecord({
    audit: {
      format: "ai-audit-v1",
      asOfDate: "2026-07-24",
      priceAsOfDate: "2026-07-23",
      sourceDates: {
        price: "2026-07-23",
        internetNews: "2026-07-24",
        futureNews: "2026-07-25",
      },
      features: { adr_latest: 72.5, adr_change_28d: -9.25, model_feature_00: 0.3 },
      sources: { price_rows: 1500, internet_news_rows: 0 },
      scenarioWeights: { upside: 25, sideways: 50, downside: 25 },
    },
    horizons: {
      10: {
        targetDate: "2026-08-06",
        predictedPrice: 33000,
        lowerPrice: 29000,
        upperPrice: 37000,
        attribution: {
          days: 10,
          expectedLogReturn: 0.0307717,
          components: { localModel: 0.02, marketRegime: 0.0107717 },
        },
      },
    },
  });
  const response = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: { records: [record] },
    }),
    { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.records[0].audit.features.adr_latest, 72.5);
  assert.equal(payload.records[0].audit.sources.internet_news_rows, 0);
  assert.equal(payload.records[0].audit.asOfDate, "2026-07-24");
  assert.equal(payload.records[0].audit.priceAsOfDate, "2026-07-23");
  assert.deepEqual(Object.keys(payload.records[0].audit.sourceDates).sort(), ["internetNews", "price"]);
  assert.equal(payload.records[0].horizons[10].attribution.components.marketRegime, 0.0107717);
});

test("rejects malformed, excessive, and oversized forecast journal input", async () => {
  const env = { THINKSTOCK_ACCESS_TOKEN: "private", DISCLOSURE_CACHE: memoryKv() };
  const mismatch = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: { records: [forecastRecord({ ticker: "005930.KS" })] },
    }),
    env,
  );
  assert.equal(mismatch.status, 400);

  const excessive = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: { records: Array.from({ length: 121 }, () => forecastRecord()) },
    }),
    env,
  );
  assert.equal(excessive.status, 400);

  const withinAuditBudget = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: JSON.stringify({ records: [] }).padEnd(384 * 1024, " "),
    }),
    env,
  );
  assert.equal(withinAuditBudget.status, 200);

  const oversized = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: "x".repeat(512 * 1024 + 1),
    }),
    env,
  );
  assert.equal(oversized.status, 413);
});
