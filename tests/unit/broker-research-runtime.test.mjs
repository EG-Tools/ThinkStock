import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/broker-research-runtime.js");

const runtime = globalThis.ThinkStockBrokerResearchRuntime;

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
