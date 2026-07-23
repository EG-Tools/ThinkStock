import assert from "node:assert/strict";
import test from "node:test";

import {
  handleRequest,
  isAllowedOrigin,
  mergeAnalysisSnapshots,
  mergeFinancialRecords,
  mergeForecastJournalRecords,
  mergeRecords,
  parseConsensusHtml,
  parseEarningsTrendHtml,
  parseFinancialSummaryHtml,
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

test("parses Naver WiseReport consensus values", () => {
  const html = `<table id="cTB15"><tr><th>opinion</th></tr><tr>
    <td><b>4.00</b></td><td>132,600</td><td>1,665</td><td>26.16</td><td>5</td>
  </tr></table>`;
  const result = parseConsensusHtml(html, "218410.KQ");
  assert.equal(result.opinion, 4);
  assert.equal(result.targetPrice, 132600);
  assert.equal(result.institutions, 5);
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

test("returns a fresh accumulated analysis cache without an upstream request", async () => {
  const financials = [{
    ticker: "218410.KQ",
    period: "2025-12",
    frequency: "annual",
    estimate: false,
    revenue: 1300,
  }];
  const cache = memoryKv({
    "analysis:218410.KQ": JSON.stringify({
      schema: 2,
      ticker: "218410.KQ",
      savedAt: Date.now(),
      consensus: null,
      financials,
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
  assert.equal(migrated.schema, 3);
  assert.equal(migrated.snapshots.length, 1);
  assert.deepEqual(migrated.snapshots[0].financials, financials);
});

test("keeps the latest point-in-time analysis snapshot per month and caps history at 60", () => {
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
  assert.equal(result.length, 60);
  assert.equal(result[0].asOf, "2021-03-01");
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
  assert.equal(payload.records[0].horizons[20].covered, true);
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

  const oversized = await handleRequest(
    request("/api/forecast-journal?ticker=218410.KQ", {
      method: "POST",
      token: "private",
      body: "x".repeat(256 * 1024 + 1),
    }),
    env,
  );
  assert.equal(oversized.status, 413);
});
