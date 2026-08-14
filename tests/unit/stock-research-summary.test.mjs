import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeResearchMinimum,
  normalizeResearchSummary,
  researchSummaryCacheKey,
} from "../../shared/stock-research-summary.mjs";

await import("../../docs/modules/stock-research-contract.js");
const { CALCULATION_VERSION } = globalThis.ThinkStockStockResearchContract;

test("allows one signal as the research minimum", () => {
  assert.equal(normalizeResearchMinimum(1), 1);
  assert.equal(normalizeResearchMinimum(0), 1);
  assert.equal(normalizeResearchMinimum(11), 10);
});

test("normalizes a compact cross-device stock-research summary", () => {
  const summary = normalizeResearchSummary({
    schema: 1,
    strategy: "top400-recovery-v1",
    baseDate: "2026-08-07",
    analysisDate: "2026-08-06",
    minimumBuySignals: 5,
    universeTickers: ["005930.KS", "005930.KS", "invalid"],
    universeState: {
      "005930.KS": {
        fingerprint: "005930.KS|KOSPI|80000",
        metadataFingerprint: "005930.KS|삼성전자|1|500000",
        signalFingerprint: "5|2026-08-01",
      },
      invalid: { fingerprint: "bad" },
    },
    sharedFingerprint: "all-sources",
    sharedFingerprints: { KOSPI: "kospi-sources", KOSDAQ: "kosdaq-sources" },
    candidateOrder: ["005930.KS"],
    candidatePool: [{
      ticker: "005930.ks",
      name: "삼성전자",
      market: "KOSPI",
      marketRank: 1,
      buyCount: 5,
      lastBuyDate: "2026-08-01",
      reasons: ["매수 5회 연속"],
    }],
  }, { strategy: "top400-recovery-v1", minimum: 5 });

  assert.equal(summary.analysisDate, "2026-08-06");
  assert.deepEqual(summary.universeTickers, ["005930.KS"]);
  assert.deepEqual(summary.universeState["005930.KS"], {
    fingerprint: "005930.KS|KOSPI|80000",
    metadataFingerprint: "005930.KS|삼성전자|1|500000",
    signalFingerprint: "5|2026-08-01",
  });
  assert.equal(summary.candidatePool[0].ticker, "005930.KS");
  assert.deepEqual(summary.sharedFingerprints, {
    KOSPI: "kospi-sources",
    KOSDAQ: "kosdaq-sources",
  });
  assert.equal(summary.universeSize, 400);
  assert.equal(researchSummaryCacheKey(summary.strategy, 5), "research-summary:1:top400-recovery-v1:5:400");
});

test("keeps cross-device summaries separate for 600 and 1000 stock searches", () => {
  const payload = {
    schema: 1,
    strategy: "adaptive1000-recovery-v8",
    baseDate: "2026-08-13",
    minimumBuySignals: 1,
    universeSize: 600,
    scanned: 600,
    universeTickers: [],
    candidatePool: [],
  };
  const summary = normalizeResearchSummary(payload, {
    strategy: payload.strategy,
    minimum: 1,
    universeSize: 600,
  });

  assert.equal(summary.universeSize, 600);
  assert.equal(summary.scanned, 600);
  assert.equal(researchSummaryCacheKey(payload.strategy, 1, 600), "research-summary:1:adaptive1000-recovery-v8:1:600");
  assert.equal(normalizeResearchSummary(payload, {
    strategy: payload.strategy,
    minimum: 1,
    universeSize: 400,
  }), null);
});

test("rejects a mismatched strategy or minimum", () => {
  const payload = {
    schema: 1,
    strategy: "top400-recovery-v1",
    baseDate: "2026-08-07",
    minimumBuySignals: 5,
    candidatePool: [],
  };
  assert.equal(normalizeResearchSummary(payload, { strategy: "other", minimum: 5 }), null);
  assert.equal(normalizeResearchSummary(payload, { strategy: payload.strategy, minimum: 2 }), null);
});

test("keeps sell-only and combined signal profiles in the shared summary", () => {
  const summary = normalizeResearchSummary({
    schema: 1,
    strategy: CALCULATION_VERSION,
    baseDate: "2026-08-11",
    minimumBuySignals: 2,
    candidatePool: [{
      ticker: "005930.KS",
      name: "삼성전자",
      market: "KOSPI",
      buyCount: 0,
      sellCount: 3,
      lastSellDate: "2026-08-11",
    }, {
      ticker: "000660.KS",
      name: "SK하이닉스",
      market: "KOSPI",
      buyCount: 1,
      sellCount: 2,
      lastBuyDate: "2026-08-10",
      lastSellDate: "2026-08-11",
    }],
  }, { strategy: CALCULATION_VERSION, minimum: 2 });

  assert.equal(summary.candidatePool.length, 2);
  assert.equal(summary.candidatePool[0].sellCount, 3);
  assert.equal(summary.candidatePool[1].buyCount, 1);
  assert.equal(summary.candidatePool[1].lastSellDate, "2026-08-11");
});
