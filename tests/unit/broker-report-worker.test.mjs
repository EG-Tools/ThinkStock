import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../../worker/src/index.mjs";

function workerRequest(path) {
  return new Request(`https://thinkstock-api.keg0320.workers.dev${path}`, {
    headers: {
      Authorization: "Bearer private",
      Origin: "https://eg-tools.github.io",
    },
  });
}

test("proxies a bounded broker-report list without exposing a source credential", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /consensus\.hankyung\.com\/analysis\/list/);
    return new Response(`<table><tr>
      <td>2026-08-14</td>
      <td><a href="/analysis/downpdf?report_idx=651738">JYP Ent.(035900)</a></td>
      <td>60,000</td><td>Buy</td><td>황지원</td><td>iM증권</td>
    </tr></table>`, { status: 200 });
  };
  try {
    const response = await handleRequest(
      workerRequest("/api/broker-reports?ticker=035900.KQ&name=JYP%20Ent.&days=90&asOf=2026-08-15"),
      { THINKSTOCK_ACCESS_TOKEN: "private" },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.reports.length, 1);
    assert.equal(payload.reports[0].id, "651738");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a verified bounded PDF through the authenticated gateway", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /report_idx=651738/);
    return new Response(new TextEncoder().encode("%PDF-test-report"), {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });
  };
  try {
    const response = await handleRequest(
      workerRequest("/api/broker-report-pdf?reportId=651738"),
      { THINKSTOCK_ACCESS_TOKEN: "private" },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/pdf");
    assert.match(response.headers.get("Content-Disposition"), /^inline;/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(new TextDecoder().decode(await response.arrayBuffer()), "%PDF-test-report");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses Naver Finance as an explicit secondary report source", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /finance\.naver\.com\/research\/company_list\.naver/);
    return new Response(`<table><tr>
      <td><a href="/item/main.naver?code=218410">RFHIC</a></td>
      <td><a href="company_read.naver?nid=94372&page=1">RFHIC report</a></td>
      <td>Hana Securities</td>
      <td><a href="https://stock.pstatic.net/stock-research/company/57/20260723_company_184323000.pdf">PDF</a></td>
      <td>26.07.23</td><td>100</td>
    </tr></table>`, { status: 200 });
  };
  try {
    const response = await handleRequest(
      workerRequest("/api/broker-reports?ticker=218410.KQ&days=90&asOf=2026-08-15&source=naver"),
      { THINKSTOCK_ACCESS_TOKEN: "private" },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.source, "Naver Finance");
    assert.equal(payload.reports[0].id, "naver-94372");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxies only an allowlisted Naver Finance report PDF URL", async () => {
  const originalFetch = globalThis.fetch;
  const sourceUrl = "https://stock.pstatic.net/stock-research/company/57/20260723_company_184323000.pdf";
  globalThis.fetch = async (url) => {
    assert.equal(String(url), sourceUrl);
    return new Response(new TextEncoder().encode("%PDF-naver-report"), { status: 200 });
  };
  try {
    const query = new URLSearchParams({
      reportId: "naver-94372",
      source: "naver",
      sourceUrl,
    });
    const response = await handleRequest(
      workerRequest(`/api/broker-report-pdf?${query}`),
      { THINKSTOCK_ACCESS_TOKEN: "private" },
    );
    assert.equal(response.status, 200);
    assert.equal(new TextDecoder().decode(await response.arrayBuffer()), "%PDF-naver-report");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
