import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHankyungReportListUrl,
  buildNaverReportListUrl,
  normalizeNaverReportPdfUrl,
  parseHankyungReportListHtml,
  parseNaverReportListHtml,
  selectLatestReportsByBroker,
} from "../../shared/broker-report-source.mjs";

test("builds a bounded company-report query and parses its rows", () => {
  const url = new URL(buildHankyungReportListUrl("035900.KQ", {
    asOf: "2026-08-15",
    days: 90,
  }));
  assert.equal(url.searchParams.get("business_code"), "035900");
  assert.equal(url.searchParams.get("sdate"), "2026-05-18");
  const html = `<table><tr>
    <td>2026-08-14</td>
    <td><a href="/analysis/downpdf?report_idx=651738">JYP Ent.(035900)</a></td>
    <td>60,000</td><td>Buy</td><td>황지원</td><td>iM증권</td>
  </tr></table>`;
  const rows = parseHankyungReportListHtml(html, "035900.KQ");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "651738");
  assert.equal(rows[0].ticker, "035900.KQ");
  assert.equal(rows[0].targetPrice, 60000);
  assert.equal(selectLatestReportsByBroker([...rows, { ...rows[0], id: "1" }]).length, 1);
});

test("builds and parses a bounded Naver Finance company-report fallback", () => {
  const url = new URL(buildNaverReportListUrl("218410.KQ"));
  assert.equal(url.searchParams.get("searchType"), "itemCode");
  assert.equal(url.searchParams.get("itemCode"), "218410");
  const pdfUrl = "https://stock.pstatic.net/stock-research/company/57/20260723_company_184323000.pdf";
  const html = `<table><tr>
    <td><a href="/item/main.naver?code=218410">RFHIC</a></td>
    <td><a href="company_read.naver?nid=94372&page=1&searchType=itemCode&itemCode=218410">RFHIC report</a></td>
    <td>Hana Securities</td><td><a href="${pdfUrl}">PDF</a></td><td>26.07.23</td><td>100</td>
  </tr></table>`;
  const rows = parseNaverReportListHtml(html, "218410.KQ");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "naver-94372");
  assert.equal(rows[0].source, "naver");
  assert.equal(rows[0].publishedDate, "2026-07-23");
  assert.equal(rows[0].viewCount, 100);
  assert.equal(rows[0].sourceUrl, pdfUrl);
  assert.equal(normalizeNaverReportPdfUrl("https://example.com/report.pdf"), "");
});
