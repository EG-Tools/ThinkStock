import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/runtime-foundation.mjs");
await import("../../shared/broker-report-policy.mjs");
await import("../../docs/modules/broker-report-parser.js");

const parser = globalThis.ThinkStockBrokerReportParser;

function jypPages() {
  return [{
    page: 1,
    lines: [
      "목표주가 하향",
      "FY 2025 2026E 2027E 2028E",
      "매출액(십억원) 822 828 867 830",
      "영업이익(십억원) 155 154 159 150",
      "순이익(십억원) 161 125 124 117",
      "EPS(원) 4,519 3,525 3,478 3,286",
      "BPS(원) 17,466 20,299 23,068 25,635",
      "PER(배) 16.1 11.6 11.7 12.4",
      "PBR(배) 4.2 2.0 1.8 1.6",
      "ROE(%) 29.2 18.7 16.0 13.5",
    ],
  }];
}

function flatPrimaryPages() {
  return [{
    page: 1,
    lines: [
      "FY 2025 2026E 2027E",
      "Revenue 100 100 100",
      "Operating Profit 10 10 10",
      "EPS 1,000 1,000 1,000",
      "ROE 10 10 10",
    ],
  }];
}

test("extracts only forward EPS, ROE and table-validation metrics", () => {
  const report = parser.parseReport(jypPages(), {
    id: "651738",
    publishedDate: "2026-08-14",
    broker: "iM증권",
    targetPrice: 60000,
    previousTargetPrice: 75000,
    targetPriceChange: -0.2,
  });

  assert.equal(report.usable, true);
  assert.deepEqual(Object.keys(report.metrics), ["revenue", "operatingProfit", "eps", "roe"]);
  assert.equal(report.metrics.eps.current, 3525);
  assert.equal(report.metrics.eps.next, 3478);
  assert.equal(report.metrics.roe.current, 18.7);
  assert.equal(report.metrics.roe.next, 16);
  assert.equal(report.metrics.revenue.unit, "KRW_BILLION");
  assert.equal(report.targetRevision, -1);
  assert.equal(report.targetPriceChange, -0.2);
});

test("rejects prose numbers when a verified forward table is absent", () => {
  const report = parser.parseReport([{
    page: 1,
    lines: [
      "2027년 EPS가 증가할 전망이다",
      "목표주가 60,000원",
      "ROE 개선 기대",
    ],
  }], { id: "1", publishedDate: "2026-08-14" });

  assert.equal(report.usable, false);
  assert.equal(report.reason, "verified-forward-table-not-found");
});

test("keeps an opinion-only report as a neutral reference link", () => {
  const report = parser.parseReport([{
    page: 1,
    lines: ["Business outlook remains constructive without a forecast table."],
  }], {
    id: "naver-94372",
    publishedDate: "2026-07-23",
    broker: "Hana Securities",
    title: "RFHIC report",
    source: "naver",
    sourceUrl: "https://stock.pstatic.net/stock-research/company/57/20260723_company_184323000.pdf",
  });
  const summary = parser.summarizeReports([report], "2026-08-15");
  assert.equal(report.usable, false);
  assert.equal(summary.reportCount, 0);
  assert.equal(summary.signal, 0);
  assert.equal(summary.adjustment, 0);
  assert.equal(summary.representativeReports.reference.reportId, "naver-94372");
  assert.equal(summary.representativeReports.reference.quantitative, false);
});

test("rejects revenue-only tables but preserves a verified target-price cut as target-only evidence", () => {
  const pages = [{
    page: 1,
    lines: [
      "FY 2025 2026E 2027E",
      "Revenue 100 110 120",
      "Operating Profit 10 11 13",
    ],
  }];
  const rejected = parser.parseReport(pages, {
    id: "4",
    publishedDate: "2026-08-14",
  });
  assert.equal(rejected.usable, false);
  assert.equal(rejected.reason, "primary-forward-metrics-not-found");

  const targetOnly = parser.parseReport(pages, {
    id: "5",
    publishedDate: "2026-08-14",
    broker: "A Securities",
    targetPrice: 80000,
    previousTargetPrice: 100000,
    targetPriceChange: -0.2,
  });
  assert.equal(targetOnly.usable, true);
  assert.equal(targetOnly.analysisMode, "target-revision-only");
  assert.deepEqual(targetOnly.metrics, {});
  assert.equal(targetOnly.targetRevision, -1);
});

test("weights target-price cuts more strongly than equal-sized raises", () => {
  const metadata = {
    publishedDate: "2026-08-14",
    broker: "A Securities",
  };
  const raised = parser.parseReport(flatPrimaryPages(), {
    ...metadata,
    id: "6",
    targetPrice: 110000,
    previousTargetPrice: 100000,
    targetPriceChange: 0.1,
  });
  const cut = parser.parseReport(flatPrimaryPages(), {
    ...metadata,
    id: "7",
    targetPrice: 90000,
    previousTargetPrice: 100000,
    targetPriceChange: -0.1,
  });
  const repeatedCut = parser.parseReport(flatPrimaryPages(), {
    ...metadata,
    id: "8",
    targetPrice: 90000,
    previousTargetPrice: 100000,
    targetPriceChange: -0.1,
    targetRevisionStreak: 2,
  });
  const raisedSummary = parser.summarizeReports([raised], "2026-08-15");
  const cutSummary = parser.summarizeReports([cut], "2026-08-15");
  const repeatedCutSummary = parser.summarizeReports([repeatedCut], "2026-08-15");

  assert.ok(Math.abs(cutSummary.signal) > Math.abs(raisedSummary.signal));
  assert.ok(cutSummary.adjustment < -raisedSummary.adjustment);
  assert.ok(repeatedCutSummary.signal < cutSummary.signal);
  assert.equal(repeatedCutSummary.targetCutStreak, 2);
});

test("reads an EPS row merged behind prose and recognizes a spaced target-price cut", () => {
  const report = parser.parseReport([{
    page: 1,
    lines: [
      "목표주가 : 60,000 원 ( 하향 )",
      "FY 2025 2026E 2027E 2028E",
      "Revenue 822 828 867 830",
      "Operating Profit 155 154 159 150",
      "예약 판매분은 EPS( 원 ) 4,519 3,525 3,478 3,286",
      "ROE(%) 29.2 18.7 16.0 13.5",
    ],
  }], {
    id: "9",
    publishedDate: "2026-08-14",
    broker: "A Securities",
    targetPrice: 60000,
  });

  assert.equal(report.usable, true);
  assert.equal(report.metrics.eps.current, 3525);
  assert.equal(report.metrics.eps.next, 3478);
  assert.equal(report.targetRevision, -1);
});

test("keeps leading table values when PDF extraction joins prose to a metric row", () => {
  const report = parser.parseReport([{
    page: 1,
    lines: [
      "Financial Data",
      "투자지표 2024 2025 2026F 2027F",
      "Revenue 114.9 185.8 265.5 318.0",
      "Operating Profit 1.5 30.9 54.1 75.3",
      "EPS 969 1,082 1,428 2,162",
      "ROE 8.60 8.84 10.35 13.78 이후 3개월 동안 66% 하락",
    ],
  }], {
    id: "naver-94372",
    publishedDate: "2026-07-23",
  });

  assert.equal(report.usable, true);
  assert.equal(report.metrics.roe.current, 10.35);
  assert.equal(report.metrics.roe.next, 13.78);
});

test("supports a split year header and wrapped metric values without accepting prose", () => {
  const report = parser.parseReport([{
    page: 2,
    lines: [
      "Financial estimates FY 2025A",
      "2026E 2027E 2028E",
      "Revenue 100 110",
      "120 130",
      "EPS 1,000 1,100",
      "1,300 1,500",
      "ROE 8 9 11 12",
    ],
  }], {
    id: "91",
    publishedDate: "2026-08-14",
  });
  assert.equal(report.usable, true);
  assert.equal(report.metrics.eps.current, 1100);
  assert.equal(report.metrics.eps.next, 1300);
  assert.equal(report.evidence.layoutAdapter, "split-header");
});

test("prioritizes EPS, ROE and target-price revisions in the report summary", () => {
  const positive = parser.parseReport(jypPages().map((page) => ({
    ...page,
    lines: page.lines.map((line) => line
      .replace("목표주가 하향", "목표주가 상향")
      .replace("3,525 3,478", "3,525 4,200")
      .replace("18.7 16.0", "18.7 22.0")),
  })), {
    id: "2",
    publishedDate: "2026-08-14",
    broker: "A증권",
    targetPrice: 70000,
    previousTargetPrice: 60000,
    targetPriceChange: 1 / 6,
  });
  const negative = parser.parseReport(jypPages(), {
    id: "3",
    publishedDate: "2026-08-13",
    broker: "B증권",
    targetPrice: 60000,
    previousTargetPrice: 75000,
    targetPriceChange: -0.2,
  });

  const positiveSummary = parser.summarizeReports([positive], "2026-08-15");
  const negativeSummary = parser.summarizeReports([negative], "2026-08-15");
  assert.ok(positiveSummary.signal > 0);
  assert.ok(negativeSummary.signal < 0);
  assert.equal(positiveSummary.primaryCoverage, 1);
  assert.equal(negativeSummary.targetRevisionSignal, -1);
});

test("excludes future and not-yet-available reports from historical summaries", () => {
  const report = parser.parseReport(flatPrimaryPages(), {
    id: "10",
    publishedDate: "2026-08-14",
    broker: "A Securities",
    targetPrice: 90000,
    previousTargetPrice: 100000,
    targetPriceChange: -0.1,
  });
  assert.equal(parser.summarizeReports([report], "2026-08-13"), null);
  assert.equal(parser.summarizeReports([report], "2026-08-14", { historicalMode: true }), null);
  assert.ok(parser.summarizeReports([report], "2026-08-17", { historicalMode: true }));
});

test("selects one direction-matched representative report link", () => {
  const positive = parser.parseReport(flatPrimaryPages(), {
    id: "11",
    publishedDate: "2026-08-14",
    broker: "A Securities",
    title: "Positive report",
    sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=11",
    targetPrice: 120000,
    previousTargetPrice: 100000,
    targetPriceChange: 0.2,
  });
  const negative = parser.parseReport(flatPrimaryPages(), {
    id: "12",
    publishedDate: "2026-08-13",
    broker: "B Securities",
    title: "Negative report",
    sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=12",
    targetPrice: 80000,
    previousTargetPrice: 100000,
    targetPriceChange: -0.2,
  });
  const summary = parser.summarizeReports([positive, negative], "2026-08-15");
  assert.equal(summary.representativeReports.upside.reportId, "11");
  assert.equal(summary.representativeReports.downside.reportId, "12");
});
