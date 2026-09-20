import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHankyungReportListUrl,
  buildNaverReportListUrl,
  normalizeNaverReportPdfUrl,
  normalizeNaverReportSourceUrl,
  resolveNaverReportPdfUrl,
  parseHankyungReportListHtml,
  parseNaverReportList,
  selectLatestReportsByBroker,
} from "../../shared/broker-report-source.mjs";

test("builds a bounded company-report query and parses its rows", () => {
  const url = new URL(buildHankyungReportListUrl("035900.KQ", {
    asOf: "2026-08-15",
    days: 90,
    name: "JYP Ent.",
  }));
  assert.equal(url.searchParams.get("business_code"), "035900");
  assert.equal(url.searchParams.get("search_value"), "REPORT_TITLE");
  assert.equal(url.searchParams.get("search_text"), "JYP Ent.");
  assert.equal(url.searchParams.has("report_type"), false);
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

test("parses a ticker-specific Hankyung industry report from the general report list", () => {
  const html = `<table><tr class="first last">
    <td class="first txt_number">2026-07-28</td><td>산업</td>
    <td><a href="/analysis/downpdf?report_idx=651140">RFHIC/RF머트리얼즈 2Q26 잠정실적</a></td>
    <td>이찬영</td><td>유진투자증권</td>
    <td><a href="/analysis/downpdf?report_idx=651140" title="20260728_218410_cylee_71.pdf">PDF</a></td>
  </tr></table>`;
  const rows = parseHankyungReportListHtml(html, "218410.KQ", "RFHIC");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "651140");
  assert.equal(rows[0].source, "hankyung");
  assert.equal(rows[0].publishedDate, "2026-07-28");
  assert.equal(rows[0].broker, "유진투자증권");
  assert.equal(rows[0].analyst, "이찬영");
  assert.equal(rows[0].targetPrice, null);
});

test("builds and parses a bounded Naver Finance company-report fallback", () => {
  const url = new URL(buildNaverReportListUrl("218410.KQ"));
  assert.equal(url.pathname, "/api/stockSecurity/researches/v2/company");
  assert.equal(url.searchParams.get("itemCodes"), "218410");
  assert.equal(url.searchParams.get("size"), "40");
  const report = { nid: "96176", itemCode: "218410", writeDate: "2026-09-16",
    title: "RFHIC report", brokerName: "Hana Securities", readCount: "100", goalPrice: "150000" };
  const rows = parseNaverReportList({ items: [report, report, { ...report, nid: "96177", itemCode: "005930" }] }, "218410.KQ");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "naver-96176");
  assert.equal(rows[0].source, "naver");
  assert.equal(rows[0].publishedDate, "2026-09-16");
  assert.equal(rows[0].viewCount, 100);
  assert.equal(rows[0].targetPrice, 150000);
  assert.equal(rows[0].sourceUrl, "https://stock.naver.com/research/company/96176");
  assert.equal(normalizeNaverReportPdfUrl("https://example.com/report.pdf"), "");
});

test("does not mistake a changed Naver response for an empty report list", () => {
  assert.deepEqual(parseNaverReportList({ items: [] }, "218410.KQ"), []);
  assert.throws(() => parseNaverReportList("<html>new website</html>", "218410.KQ"), /format has changed/);
  assert.throws(() => parseNaverReportList({ error: "unavailable" }, "218410.KQ"), /format has changed/);
});

test("resolves a Naver PDF only on open and retains existing PDF links", async () => {
  const page = "https://stock.naver.com/research/company/96176";
  const pdf = "https://stock.pstatic.net/stock-research/company/57/20260916_company_975720000.pdf";
  const calls = [];
  const fetchJson = async (url) => { calls.push(url); return { nid: "96176", attachUrl: pdf }; };
  assert.equal(await resolveNaverReportPdfUrl(page, "naver-96176", fetchJson), pdf);
  assert.equal(await resolveNaverReportPdfUrl(pdf, "naver-96176", fetchJson), pdf);
  assert.deepEqual(calls, ["https://stock.naver.com/api/stockSecurity/researches/v2/company/96176"]);
  assert.equal(normalizeNaverReportSourceUrl(page, "naver-96177"), "");
  assert.equal(normalizeNaverReportSourceUrl("https://stock.naver.com.evil.test/research/company/96176"), "");
  await assert.rejects(resolveNaverReportPdfUrl(page, "naver-96176", async () => ({ nid: "96177", attachUrl: pdf })), /does not match/);
  await assert.rejects(resolveNaverReportPdfUrl(page, "naver-96176", async () => ({ nid: "96176", attachUrl: "https://example.com/report.pdf" })), /URL is invalid/);
});
