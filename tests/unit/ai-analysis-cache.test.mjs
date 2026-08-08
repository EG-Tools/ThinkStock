import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("docs/modules/ai-analysis-cache.js"), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(source, context);
const {
  SCHEMA_VERSION,
  isAnalysisFresh,
  mergeSnapshots,
  normalizeAnalysisRecord,
} = context.ThinkStockAiAnalysisCache;

test("preserves accumulated financial periods while applying new analysis", () => {
  const now = Date.UTC(2026, 6, 23);
  const existing = {
    schema: SCHEMA_VERSION,
    ticker: "218410.KQ",
    savedAt: now - 40,
    financials: [{
      ticker: "218410.KQ",
      period: "2024-12",
      frequency: "annual",
      estimate: false,
      revenue: 1000,
    }],
  };
  const result = normalizeAnalysisRecord("218410.KQ", {
    savedAt: now,
    consensus: { ticker: "218410.KQ", targetPrice: 130000, institutions: 5 },
    financials: [{
      ticker: "218410.KQ",
      period: "2025-12",
      frequency: "annual",
      estimate: false,
      revenue: 1300,
    }],
  }, existing, now);
  assert.equal(result.financials.length, 2);
  assert.equal(result.consensus.targetPrice, 130000);
  assert.equal(result.lastAccessed, now);
});

test("checks analysis age without discarding today's cached record", () => {
  const now = Date.UTC(2026, 6, 23);
  const record = { schema: SCHEMA_VERSION, savedAt: now - (29 * 24 * 60 * 60 * 1000) };
  assert.equal(isAnalysisFresh(record, 30 * 24 * 60 * 60 * 1000, now), true);
  assert.equal(isAnalysisFresh(record, 28 * 24 * 60 * 60 * 1000, now), false);
});

test("normalizes and replaces the current stock-news snapshot", () => {
  const existing = normalizeAnalysisRecord("005930.KS", {
    savedAt: 10,
    news: [{ date: "2026-08-07", title: "old", source: "Naver", url: "https://example.com/old" }],
  }, null, 10);
  const result = normalizeAnalysisRecord("005930.KS", {
    savedAt: 20,
    news: [
      { date: "2026-08-08", title: "new", source: "Naver", url: "https://example.com/new" },
      { date: "2026-08-08", title: "new", source: "Naver", url: "https://example.com/new" },
    ],
  }, existing, 20);

  assert.equal(result.news.length, 1);
  assert.equal(result.news[0].title, "new");
  assert.equal(result.news[0].ticker, "005930.KS");
});

test("keeps one point-in-time analysis snapshot per month", () => {
  const snapshots = mergeSnapshots([
    { asOf: "2026-05-01", savedAt: 1, consensus: { targetPrice: 100, institutions: 2 } },
  ], [
    { asOf: "2026-05-20", savedAt: 2, consensus: { targetPrice: 120, institutions: 3 } },
    { asOf: "2026-06-10", savedAt: 3, financials: [{
      ticker: "005930.KS", period: "2026-03", frequency: "quarter", revenue: 10,
    }] },
  ], "005930.KS");

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].asOf, "2026-05-20");
  assert.equal(snapshots[0].consensus.targetPrice, 120);
  assert.equal(snapshots[1].financials.length, 1);
});

test("normalizes server snapshots together with the latest analysis", () => {
  const record = normalizeAnalysisRecord("005930.KS", {
    consensus: { targetPrice: 150, institutions: 4 },
    snapshots: [{ asOf: "2026-07-01", savedAt: 10, consensus: { targetPrice: 140, institutions: 3 } }],
  }, null, 20);

  assert.equal(record.schema, SCHEMA_VERSION);
  assert.equal(record.snapshots.length, 1);
  assert.equal(record.snapshots[0].consensus.targetPrice, 140);
});
