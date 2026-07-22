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
  isAnalysisFresh,
  normalizeAnalysisRecord,
} = context.ThinkStockAiAnalysisCache;

test("preserves accumulated financial periods while applying new analysis", () => {
  const now = Date.UTC(2026, 6, 23);
  const existing = {
    schema: 1,
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

test("refreshes analysis only after its configured monthly age", () => {
  const now = Date.UTC(2026, 6, 23);
  const record = { schema: 1, savedAt: now - (29 * 24 * 60 * 60 * 1000) };
  assert.equal(isAnalysisFresh(record, 30 * 24 * 60 * 60 * 1000, now), true);
  assert.equal(isAnalysisFresh(record, 28 * 24 * 60 * 60 * 1000, now), false);
});
