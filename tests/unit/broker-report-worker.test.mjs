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

test("serves a previously verified report PDF from the edge cache", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const entries = new Map();
  let upstreamCalls = 0;
  const waitUntilTasks = [];
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        match: async (request) => entries.get(request.url)?.clone() || null,
        put: async (request, response) => { entries.set(request.url, response.clone()); },
      },
    },
  });
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response(new TextEncoder().encode("%PDF-cached-report"), { status: 200 });
  };
  const context = { waitUntil: (task) => waitUntilTasks.push(task) };
  try {
    const first = await handleRequest(
      workerRequest("/api/broker-report-pdf?reportId=651738"),
      { THINKSTOCK_ACCESS_TOKEN: "private" },
      context,
    );
    assert.equal(first.headers.get("X-ThinkStock-Report-Cache"), "MISS");
    assert.equal(new TextDecoder().decode(await first.arrayBuffer()), "%PDF-cached-report");
    await Promise.all(waitUntilTasks);

    const second = await handleRequest(
      workerRequest("/api/broker-report-pdf?reportId=651738"),
      { THINKSTOCK_ACCESS_TOKEN: "private" },
      context,
    );
    assert.equal(second.headers.get("X-ThinkStock-Report-Cache"), "HIT");
    assert.equal(second.headers.get("Cache-Control"), "private, no-store");
    assert.equal(new TextDecoder().decode(await second.arrayBuffer()), "%PDF-cached-report");
    assert.equal(upstreamCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
    else delete globalThis.caches;
  }
});

test("uses Naver Finance as an explicit secondary report source", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /stock\.naver\.com\/api\/stockSecurity\/researches\/v2\/company\?/);
    assert.equal(new URL(url).searchParams.get("itemCodes"), "218410");
    return Response.json({ items: [
      { nid: "96176", itemCode: "218410", title: "RFHIC report", brokerName: "Hana Securities", writeDate: "2026-09-16" },
      { nid: "94372", itemCode: "218410", title: "old report", writeDate: "2026-03-23" },
    ] });
  };
  try {
    const response = await handleRequest(
      workerRequest("/api/broker-reports?ticker=218410.KQ&days=90&asOf=2026-09-20&source=naver"),
      { THINKSTOCK_ACCESS_TOKEN: "private" },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.source, "Naver Finance");
    assert.equal(payload.reports.length, 1);
    assert.equal(payload.reports[0].id, "naver-96176");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports a changed upstream response as failure instead of successful empty data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>redirected site</html>");
  try {
    const response = await handleRequest(workerRequest("/api/broker-reports?ticker=218410.KQ&source=naver"), {
      THINKSTOCK_ACCESS_TOKEN: "private",
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).ok, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("opens the PDF attached to a new Naver research-page link", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pdf = "https://stock.pstatic.net/stock-research/company/57/20260916_company_975720000.pdf";
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/96176")) return Response.json({ nid: "96176", attachUrl: pdf });
    assert.equal(String(url), pdf);
    return new Response("%PDF-latest-naver-report");
  };
  try {
    const query = new URLSearchParams({ reportId: "naver-96176", source: "naver", sourceUrl: "https://stock.naver.com/research/company/96176" });
    const response = await handleRequest(workerRequest(`/api/broker-report-pdf?${query}`), { THINKSTOCK_ACCESS_TOKEN: "private" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "%PDF-latest-naver-report");
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
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
