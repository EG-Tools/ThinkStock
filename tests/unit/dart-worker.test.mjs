import assert from "node:assert/strict";
import test from "node:test";

import {
  handleRequest,
  isAllowedOrigin,
  mergeFinancialRecords,
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
  return new Request(`https://thinkstock-api.keg0320.workers.dev${path}`, {
    headers: {
      Origin: "https://eg-tools.github.io",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
  });
}

test("allows only ThinkStock and local app origins", () => {
  assert.equal(isAllowedOrigin("https://eg-tools.github.io"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:8787"), true);
  assert.equal(isAllowedOrigin("https://example.com"), false);
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
});
