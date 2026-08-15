import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/runtime-foundation.mjs");
await import("../../shared/runtime-freshness-policy.mjs");
await import("../../shared/broker-report-policy.mjs");
await import("../../docs/modules/broker-report-parser.js");
await import("../../docs/modules/broker-research-cache.js");

const parser = globalThis.ThinkStockBrokerReportParser;
const {
  createBrokerReportClient,
  createBrokerResearchCache,
  latestReportsByBroker,
  normalizedBrokerKey,
} = globalThis.ThinkStockBrokerResearchCache;

test("selects the newest report from each of three different brokers", () => {
  const selected = latestReportsByBroker([
    { id: "5", publishedDate: "2026-08-14", broker: "미래에셋증권", title: "사방에 울리는 낭보" },
    { id: "4", publishedDate: "2026-08-11", broker: "미래에셋증권", title: "비중확대의 적기" },
    { id: "3", publishedDate: "2026-08-05", broker: "현대차증권", title: "공급과 수요 모두 변화" },
    { id: "2", publishedDate: "2026-07-31", broker: "교보증권", title: "변하지 않는 메모리 호황" },
    { id: "1", publishedDate: "2026-07-30", broker: "DS투자증권", title: "fourth" },
  ]);
  assert.deepEqual(selected.map((report) => report.id), ["5", "3", "2"]);
  assert.equal(normalizedBrokerKey("미래에셋 증권"), normalizedBrokerKey("미래에셋증권"));
});

function parsedReport(metadata) {
  return parser.parseReport([{
    page: 1,
    lines: [
      "FY 2025 2026E 2027E",
      "매출액(십억원) 100 110 120",
      "영업이익(십억원) 10 11 13",
      "EPS(원) 1,000 1,100 1,300",
      "ROE(%) 8 9 11",
    ],
  }], metadata);
}

test("caches structured reports and does not reprocess the same PDF", async () => {
  const records = new Map();
  const listCalls = [];
  let pdfCalls = 0;
  let parseCalls = 0;
  const reports = [
    { id: "11", publishedDate: "2026-08-14", broker: "A증권", targetPrice: 70000, sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=11" },
    { id: "10", publishedDate: "2026-07-01", broker: "A증권", targetPrice: 60000 },
    { id: "9", publishedDate: "2026-08-13", broker: "B증권", targetPrice: 68000, sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=9" },
  ];
  const createService = () => createBrokerResearchCache(globalThis, {
    parser,
    minimumReportCount: 1,
    now: () => new Date("2026-08-15T00:00:00Z"),
    read: async (ticker) => records.get(ticker) || null,
    write: async (ticker, record) => records.set(ticker, record),
    fetchList: async (_ticker, days, source) => {
      listCalls.push(`${source}:${days}`);
      return source === "naver" ? [] : reports;
    },
    fetchPdf: async () => { pdfCalls += 1; return new TextEncoder().encode("%PDF-test"); },
    extractReport: async (_bytes, metadata) => { parseCalls += 1; return parsedReport(metadata); },
  });

  const first = await createService().loadTicker("005930.KS");
  assert.equal(first.reports.length, 2);
  assert.equal(first.summary.reportCount, 2);
  assert.deepEqual(first.activeReportIds, ["11", "9"]);
  assert.ok(Math.abs(first.reports.find((report) => report.id === "11").targetPriceChange - (1 / 6)) < 1e-12);
  assert.equal(pdfCalls, 2);
  assert.equal(parseCalls, 1);
  assert.deepEqual(listCalls, ["hankyung:90", "naver:90"]);
  assert.equal("rawPdf" in first, false);
  assert.match(first.reports.find((report) => report.id === "9").parsed.sourceUrl, /report_idx=9/);

  const second = await createService().loadTicker("005930.KS");
  assert.equal(second.cached, true);
  assert.equal(pdfCalls, 2);
  assert.equal(parseCalls, 1);
  assert.deepEqual(listCalls, ["hankyung:90", "naver:90"]);
});

test("evaluates frozen report signals against later 20, 63, and 126-day prices", async () => {
  const records = new Map();
  const service = createBrokerResearchCache(globalThis, {
    parser,
    minimumReportCount: 1,
    now: () => new Date("2026-08-15T00:00:00Z"),
    read: async (ticker) => records.get(ticker) || null,
    write: async (ticker, record) => records.set(ticker, record),
    fetchList: async (_ticker, _days, source) => source === "naver" ? [] : [{
      id: "77",
      publishedDate: "2026-01-02",
      broker: "A증권",
      targetPrice: 70000,
    }],
    fetchPdf: async () => new TextEncoder().encode("%PDF-evaluation"),
    extractReport: async (_bytes, metadata) => parsedReport(metadata),
  });
  const loaded = await service.loadTicker("005930.KS");
  assert.equal(loaded.evaluationEvents.length, 1);
  const originalSignal = loaded.evaluationEvents[0].signal;
  const prices = Array.from({ length: 150 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, 5 + index)).toISOString().slice(0, 10),
    close: 100 + index,
  }));

  const evaluation = await service.evaluateTicker("005930.KS", prices, { record: loaded });
  assert.deepEqual(Object.keys(evaluation.results), ["20", "63", "126"]);
  assert.equal(evaluation.results[20].samples, 1);
  assert.equal(evaluation.results[126].samples, 1);
  assert.equal(records.get("005930.KS").evaluationEvents[0].signal, originalSignal);

  const reused = await service.evaluateTicker("005930.KS", prices);
  assert.equal(reused.evaluatedAt, evaluation.evaluatedAt);
});

test("expands to six months only when the three-month list is empty", async () => {
  const calls = [];
  const service = createBrokerResearchCache(globalThis, {
    parser,
    minimumReportCount: 1,
    now: () => new Date("2026-08-15T00:00:00Z"),
    fetchList: async (_ticker, days, source) => {
      calls.push(`${source}:${days}`);
      return source === "hankyung" && days === 180
        ? [{ id: "7", publishedDate: "2026-04-01", broker: "C증권" }]
        : [];
    },
    fetchPdf: async () => new TextEncoder().encode("%PDF-test"),
    extractReport: async (_bytes, metadata) => parsedReport(metadata),
  });

  const result = await service.loadTicker("035900.KQ");
  assert.deepEqual(calls, [
    "hankyung:90", "naver:90", "hankyung:180", "naver:180",
  ]);
  assert.equal(result.checkedWindowDays, 180);
  assert.equal(result.activeReportIds[0], "7");
});

test("compares both sources before selecting three latest brokerages", async () => {
  const listCalls = [];
  const hankyung = [
    {
      id: "41",
      publishedDate: "2026-07-31",
      broker: "IBK투자증권",
      title: "무시할 실적이 아니다",
      sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=41",
    },
    { id: "40", publishedDate: "2026-07-08", broker: "iM증권", title: "실적 전망치 상향" },
    { id: "39", publishedDate: "2026-07-08", broker: "유진투자증권", title: "걱정의 벽" },
  ];
  const naver = [
    {
      id: "naver-42",
      source: "naver",
      sourceReportId: "42",
      publishedDate: "2026-08-14",
      broker: "미래에셋증권",
      title: "사방에서 울리는 낭보들",
      sourceUrl: "https://stock.pstatic.net/stock-research/company/57/20260813_company_184323001.pdf",
    },
    {
      id: "naver-43",
      source: "naver",
      sourceReportId: "43",
      publishedDate: "2026-08-11",
      broker: "미래에셋 증권",
      title: "비중확대의 적기",
      sourceUrl: "https://stock.pstatic.net/stock-research/company/57/20260812_company_184323002.pdf",
    },
    {
      id: "naver-44",
      source: "naver",
      sourceReportId: "44",
      publishedDate: "2026-08-05",
      broker: "현대차증권",
      title: "공급과 수요 모두 변화",
      sourceUrl: "https://stock.pstatic.net/stock-research/company/57/20260805_company_184323003.pdf",
    },
    {
      id: "naver-45",
      source: "naver",
      sourceReportId: "45",
      publishedDate: "2026-07-31",
      broker: "교보증권",
      title: "변하지 않는 메모리 호황",
      sourceUrl: "https://stock.pstatic.net/stock-research/company/57/20260731_company_184323004.pdf",
    },
  ];
  const service = createBrokerResearchCache(globalThis, {
    parser,
    now: () => new Date("2026-08-15T00:00:00Z"),
    fetchList: async (_ticker, days, source) => {
      listCalls.push(`${source || "hankyung"}:${days}`);
      return source === "naver" ? naver : hankyung;
    },
    fetchPdf: async (metadata) => new TextEncoder().encode(`%PDF-${metadata.id}`),
    extractReport: async (_bytes, metadata) => parsedReport(metadata),
  });

  const result = await service.loadTicker("218410.KQ");
  assert.equal(result.summary.reportCount, 3);
  assert.deepEqual(result.activeReportIds, ["naver-42", "naver-44", "41"]);
  assert.deepEqual(listCalls, ["hankyung:90", "naver:90"]);
});

test("uses popularity only after date, broker, and quantitative metadata quality", () => {
  const sameDate = latestReportsByBroker([
    {
      id: "101",
      source: "hankyung",
      publishedDate: "2026-07-31",
      broker: "IBK투자증권",
      targetPrice: 460000,
      recommendation: "매수",
      analyst: "김운호",
    },
    {
      id: "naver-102",
      source: "naver",
      publishedDate: "2026-07-31",
      broker: "교보증권",
      viewCount: 51751,
    },
    {
      id: "naver-103",
      source: "naver",
      publishedDate: "2026-07-31",
      broker: "DS투자증권",
      viewCount: 39627,
    },
  ], 1);
  assert.equal(sameDate[0].id, "101");

  const popularityTie = latestReportsByBroker([
    { id: "naver-104", publishedDate: "2026-07-30", broker: "교보증권", viewCount: 50000 },
    { id: "naver-105", publishedDate: "2026-07-30", broker: "DS투자증권", viewCount: 10000 },
  ], 1);
  assert.equal(popularityTie[0].id, "naver-104");
});

test("replaces a pre-Naver empty cache with an available RFHIC reference report", async () => {
  const listCalls = [];
  const phases = [];
  const oldRecord = {
    schema: 3,
    ticker: "218410.KQ",
    checkedDate: "2026-08-15",
    checkedWindowDays: 90,
    complete: true,
    reports: [],
    summary: null,
  };
  const naverReport = {
    id: "naver-94372",
    source: "naver",
    sourceReportId: "94372",
    publishedDate: "2026-07-23",
    broker: "하나증권",
    title: "호재 나올 텐데 주가는 급락, 정답은 매수",
    sourceUrl: "https://stock.pstatic.net/stock-research/company/57/20260723_company_184323000.pdf",
  };
  const service = createBrokerResearchCache(globalThis, {
    parser,
    now: () => new Date("2026-08-15T00:00:00Z"),
    read: async () => oldRecord,
    fetchList: async (_ticker, days, source) => {
      listCalls.push(`${source || "hankyung"}:${days}`);
      return source === "naver" ? [naverReport] : [];
    },
    fetchPdf: async () => {
      phases.push("pdf");
      return new TextEncoder().encode("%PDF-rfhic");
    },
    extractReport: async (_bytes, metadata) => parsedReport(metadata),
  });

  assert.equal(service.CACHE_SCHEMA, 6);
  assert.equal(service.normalizeCacheRecord(oldRecord, "218410.KQ"), null);
  const result = await service.loadTicker("218410.KQ", {
    onReferenceReport: (report) => phases.push(`reference:${report.sourceUrl}`),
  });
  assert.equal(result.cached, false);
  assert.equal(result.summary.reportCount, 1);
  assert.equal(result.summary.representativeReports.reference.sourceUrl, naverReport.sourceUrl);
  assert.deepEqual(listCalls, ["hankyung:90", "naver:90"]);
  assert.deepEqual(phases, [`reference:${naverReport.sourceUrl}`, "pdf"]);
});

test("detects consecutive same-broker target-price cuts", () => {
  const selected = latestReportsByBroker([
    { id: "21", publishedDate: "2026-08-14", broker: "A Securities", targetPrice: 80000 },
    { id: "20", publishedDate: "2026-07-14", broker: "A Securities", targetPrice: 90000 },
    { id: "19", publishedDate: "2026-06-14", broker: "A Securities", targetPrice: 100000 },
    { id: "18", publishedDate: "2026-08-13", broker: "B Securities", targetPrice: 50000 },
  ], 5);
  const report = selected.find((item) => item.id === "21");
  assert.equal(report.previousTargetPrice, 90000);
  assert.ok(report.targetPriceChange < -0.11);
  assert.equal(report.targetRevisionStreak, 2);
});

test("checks the list daily while downloading only new report ids", async () => {
  const records = new Map();
  let now = new Date("2026-08-15T00:00:00Z");
  let reports = [{
    id: "31",
    publishedDate: "2026-08-14",
    broker: "A Securities",
    title: "First report",
    sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=31",
    targetPrice: 70000,
  }];
  let listCalls = 0;
  let pdfCalls = 0;
  const service = createBrokerResearchCache(globalThis, {
    parser,
    minimumReportCount: 1,
    now: () => now,
    read: async (ticker) => records.get(ticker) || null,
    write: async (ticker, record) => records.set(ticker, record),
    fetchList: async (_ticker, _days, source) => {
      listCalls += 1;
      return source === "naver" ? [] : reports;
    },
    fetchPdf: async () => { pdfCalls += 1; return new TextEncoder().encode("%PDF-test"); },
    extractReport: async (_bytes, metadata) => parsedReport(metadata),
  });

  const first = await service.loadTicker("005930.KS");
  assert.equal(first.refreshStats.downloadedPdfCount, 1);
  assert.equal(listCalls, 2);
  assert.equal(pdfCalls, 1);

  await service.loadTicker("005930.KS");
  assert.equal(listCalls, 2);
  assert.equal(pdfCalls, 1);

  now = new Date("2026-08-16T00:00:00Z");
  reports = [{
    id: "32",
    publishedDate: "2026-08-15",
    broker: "B Securities",
    title: "New report",
    sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=32",
    targetPrice: 72000,
  }, ...reports];
  const secondDay = await service.loadTicker("005930.KS");
  assert.equal(listCalls, 4);
  assert.equal(pdfCalls, 2);
  assert.equal(secondDay.refreshStats.downloadedPdfCount, 1);
  assert.equal(secondDay.refreshStats.reusedReportCount, 1);
  assert.deepEqual(secondDay.activeReportIds, ["32", "31"]);
});

test("shares one authenticated transport for report lists and PDFs", async () => {
  const calls = [];
  const client = createBrokerReportClient(globalThis, {
    baseUrl: "https://example.test/app/",
    listEndpoint: "./reports",
    pdfEndpoint: "./report-pdf",
    getAsOfDate: () => "2026-08-15",
    getHeaders: () => ({ Authorization: "Bearer local-token" }),
    fetchWithTimeout: async (url, init, timeout) => {
      calls.push({ url, init, timeout });
      if (url.includes("report-pdf")) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          json: async () => null,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, reports: [{ id: "77" }] }),
      };
    },
  });

  assert.deepEqual(await client.fetchList("005930.KS", 90), [{ id: "77" }]);
  assert.equal((await client.fetchPdf("77")).byteLength, 3);
  assert.match(calls[0].url, /ticker=005930\.KS/);
  assert.match(calls[0].url, /days=90/);
  assert.match(calls[0].url, /asOf=2026-08-15/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer local-token");
  assert.equal(calls[0].timeout, 25000);
  assert.equal(calls[1].timeout, 35000);
});
