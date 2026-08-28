import assert from "node:assert/strict";
import test from "node:test";

import * as runtime from "../../docs/modules/broker-research-runtime.mjs";

test("never replaces a newer reference report with an older parsed result", () => {
  const july = {
    publishedDate: "2026-07-27",
    sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=651060",
    title: "July report",
  };
  const june = {
    publishedDate: "2026-06-29",
    sourceUrl: "https://stock.pstatic.net/stock-research/company/15/june.pdf",
    title: "June report",
  };
  const current = runtime.mergeReferenceSummary(null, july, "2026-08-15");
  assert.equal(runtime.mergeReferenceSummary(current, june).representativeReports.reference, july);
});

test("preserves three latest reference links for the chart report marker", () => {
  const references = [
    { reportId: "3", publishedDate: "2026-08-22", title: "A", sourceUrl: "https://example.com/a" },
    { reportId: "2", publishedDate: "2026-08-21", title: "B", sourceUrl: "https://example.com/b" },
    { reportId: "1", publishedDate: "2026-08-20", title: "C", sourceUrl: "https://example.com/c" },
  ];
  const summary = runtime.toReferenceOnlySummary({
    representativeReports: { reference: references[0], references },
  });
  assert.equal(summary.representativeReports.references.length, 3);
  assert.equal(summary.representativeReports.reference, references[0]);
});

test("keeps only the newest report from each brokerage", () => {
  const summary = runtime.toReferenceOnlySummary({
    representativeReports: {
      references: [
        { reportId: "3", publishedDate: "2026-08-22", broker: "미래에셋증권", sourceUrl: "https://example.com/a" },
        { reportId: "2", publishedDate: "2026-08-21", broker: "미래에셋", sourceUrl: "https://example.com/b" },
        { reportId: "1", publishedDate: "2026-08-20", broker: "교보증권", sourceUrl: "https://example.com/c" },
      ],
    },
  });

  assert.deepEqual(
    summary.representativeReports.references.map((report) => report.reportId),
    ["3", "1"],
  );
});

test("strips historical quantitative report fields while preserving the reference", () => {
  const summary = runtime.toReferenceOnlySummary({
    reportCount: 3,
    signal: 0.8,
    confidence: 0.9,
    adjustment: 0.02,
    representativeReports: {
      reference: {
        publishedDate: "2026-08-19",
        sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=1",
      },
    },
  });
  assert.equal(summary.reportCount, 0);
  assert.equal(summary.signal, 0);
  assert.equal(summary.confidence, 0);
  assert.equal(summary.adjustment, 0);
});

test("constructs one report client, cache, and background extraction lane", async () => {
  let extractPdfPages = null;
  let disposed = false;
  const cacheModule = {
    createBrokerReportClient: () => ({ fetchList() {}, fetchPdf() {} }),
    createBrokerResearchCache: (_scope, options) => {
      extractPdfPages = options.extractPdfPages;
      return { CACHE_SCHEMA: 5, loadTicker: async () => "loaded" };
    },
  };
  const service = runtime.createBrokerResearchRuntime({}, {
    cacheModule,
    parser: {},
    workerModule: {
      createBrokerReportWorkerClient: () => ({
        extractPages: async () => [{ page: 1, lines: ["report"] }],
        dispose: () => { disposed = true; },
      }),
    },
    workerUrl: "/worker.js",
  });
  assert.deepEqual(await extractPdfPages(new Uint8Array([1])), [{ page: 1, lines: ["report"] }]);
  assert.equal(await service.loadTicker(), "loaded");
  service.dispose();
  assert.equal(disposed, true);
});

test("owns broker request state, cache hydration, and forced request ordering", async () => {
  const requestCalls = [];
  const stateSizes = [];
  const cacheModule = {
    CACHE_SCHEMA: 10,
    createBrokerReportClient: () => ({
      fetchList() {},
      fetchPdf() {},
      clearPdfMemoryCache() {},
    }),
    createBrokerResearchCache: () => ({
      loadTicker: async (_ticker, options) => {
        options.onReferenceReport({
          reportId: "new",
          broker: "교보증권",
          publishedDate: "2026-08-27",
          sourceUrl: "https://example.com/new.pdf",
        });
        return { summary: { representativeReports: {} } };
      },
    }),
  };
  const app = runtime.createBrokerResearchApp({}, {
    cacheModule,
    parser: {
      PARSER_REVISION: "quant-v3",
      reportSummaryFingerprint: () => "fingerprint",
    },
    requestRegistry: {
      run: async (key, task, options) => {
        requestCalls.push({ key, options });
        return task();
      },
      has: () => true,
      tag: () => "normal",
    },
    getAsOfDate: () => "2026-08-27",
    readRecord: async () => ({
      summary: {
        representativeReports: {
          reference: {
            reportId: "old",
            broker: "미래에셋증권",
            publishedDate: "2026-08-20",
            sourceUrl: "https://example.com/old.pdf",
          },
        },
      },
    }),
    onStateChange: ({ pendingTickers }) => stateSizes.push(pendingTickers.size),
  });

  const summary = await app.request("000660.KS", { forceNetwork: true });
  assert.deepEqual(stateSizes, [1, 0]);
  assert.deepEqual(requestCalls, [{
    key: "broker-research:000660.KS",
    options: { tag: "force", afterCurrent: true },
  }]);
  assert.equal(app.pendingTickers.size, 0);
  assert.equal(app.summaries.get("000660.KS"), summary);
  assert.equal(summary.representativeReports.reference.reportId, "new");
  app.dispose();
  assert.equal(app.summaries.size, 0);
});


test("opens report bytes through a temporary memory URL without persistent storage", async () => {
  const navigated = [];
  const revoked = [];
  const popup = {
    opener: {},
    location: { replace: (url) => navigated.push(url) },
  };
  const scope = {
    Blob,
    URL: {
      createObjectURL: (blob) => {
        assert.equal(blob.type, "application/pdf");
        return "blob:thinkstock-report";
      },
      revokeObjectURL: (url) => revoked.push(url),
    },
    open: () => popup,
    setTimeout: (callback) => callback(),
  };
  const openReport = runtime.createInlineReportOpener(
    scope,
    async () => new Uint8Array([37, 80, 68, 70]).buffer,
  );

  assert.equal(openReport({ sourceUrl: "https://example.com/report.pdf" }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(popup.opener, null);
  assert.deepEqual(navigated, ["blob:thinkstock-report"]);
  assert.deepEqual(revoked, ["blob:thinkstock-report"]);
});

test("shows a loading message in the report tab before PDF retrieval completes", async () => {
  let html = "";
  let resolvePdf;
  const popup = {
    document: {
      open() {},
      write(value) { html += value; },
      close() {},
    },
    location: { replace() {} },
  };
  const openReport = runtime.createInlineReportOpener({
    Blob,
    URL: { createObjectURL: () => "blob:report", revokeObjectURL() {} },
    open: () => popup,
    setTimeout() {},
  }, () => new Promise((resolve) => { resolvePdf = resolve; }));

  assert.equal(openReport({ sourceUrl: "https://example.com/report.pdf" }), true);
  assert.match(html, /리포트를 불러오고 있습니다/);
  assert.match(html, /잠시 기다려 주세요/);
  resolvePdf(new Uint8Array([37, 80, 68, 70]).buffer);
  await new Promise((resolve) => setImmediate(resolve));
});

test("falls back to the source report when inline retrieval fails", async () => {
  const navigated = [];
  const openReport = runtime.createInlineReportOpener({
    Blob,
    URL: { createObjectURL: () => "blob:unused", revokeObjectURL() {} },
    open: () => ({
      location: { replace: (url) => navigated.push(url) },
    }),
  }, async () => { throw new Error("offline"); });

  assert.equal(openReport({ sourceUrl: "https://example.com/fallback.pdf" }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(navigated, ["https://example.com/fallback.pdf"]);
});
