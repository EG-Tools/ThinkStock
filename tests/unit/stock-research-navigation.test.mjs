import assert from "node:assert/strict";
import test from "node:test";

import navigation from "../../docs/modules/stock-research-navigation.js";

test("retains the full configurable research universe for incremental reuse", () => {
  const state = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => {
    const market = index % 2 ? "KS" : "KQ";
    const code = String(index + 1).padStart(6, "0");
    return [`${code}.${market}`, {
      fingerprint: `price-${index}`,
      metadataFingerprint: `meta-${index}`,
      signalFingerprint: `signal-${index}`,
    }];
  }));

  const normalized = navigation.normalizeUniverseState(state);
  assert.equal(navigation.MAX_UNIVERSE_STATE, 1000);
  assert.equal(Object.keys(normalized).length, 1000);
  assert.equal(normalized["001000.KS"].signalFingerprint, "signal-999");
});

test("incremental research skips successful unchanged stocks and backs off failures", () => {
  const now = Date.parse("2026-08-30T00:00:00.000Z");
  const records = [
    { ticker: "005930.KS", market: "KOSPI", baseDate: "2026-08-29", close: 81000 },
    { ticker: "000660.KS", market: "KOSPI", baseDate: "2026-08-29", close: 220000 },
  ];
  const state = navigation.diffUniverseState({}, records).state;
  state["005930.KS"] = navigation.markUniverseAnalysisSuccess(state["005930.KS"]);
  state["000660.KS"] = navigation.markUniverseAnalysisFailure(state["000660.KS"], now);

  assert.deepEqual(navigation.selectIncrementalScanRecords(records, {
    canIncrement: true,
    previousState: state,
    now: now + 1000,
  }), []);
  assert.deepEqual(navigation.selectIncrementalScanRecords(records, {
    canIncrement: true,
    previousState: state,
    now: now + navigation.FAILURE_RETRY_DELAYS_MS[0],
  }), [records[1]]);
});

test("incremental research recalculates direct and market-wide input changes only", () => {
  const records = [
    { ticker: "005930.KS", market: "KOSPI" },
    { ticker: "247540.KQ", market: "KOSDAQ" },
    { ticker: "000660.KS", market: "KOSPI" },
  ];
  assert.deepEqual(navigation.selectIncrementalScanRecords(records, {
    canIncrement: true,
    directlyChangedTickers: new Set(["005930.KS"]),
    sharedMarketsChanged: new Set(["KOSDAQ"]),
  }), [records[0], records[1]]);
});

test("lists only failed research stocks using their stored display names", () => {
  const failures = navigation.universeAnalysisFailures({
    "279570.KS": {
      metadataFingerprint: "279570.KS|케이뱅크|120|100000",
      analysisStatus: "failed",
      failureCount: 1,
    },
    "005930.KS": {
      metadataFingerprint: "005930.KS|삼성전자|1|500000",
      analysisStatus: "success",
    },
    "950260.KQ": {
      metadataFingerprint: "950260.KQ|인제니아테라퓨틱스(Reg.S)|180|50000",
      analysisStatus: "failed",
      failureCount: 2,
    },
  });

  assert.deepEqual(failures, [
    { ticker: "279570.KS", name: "케이뱅크" },
    { ticker: "950260.KQ", name: "인제니아테라퓨틱스(Reg.S)" },
  ]);
});
