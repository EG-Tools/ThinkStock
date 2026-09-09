import assert from "node:assert/strict";
import test from "node:test";

import { buildMarketTimingReliability } from "../../docs/modules/chart-marker-runtime.mjs";

function quality(row) {
  return {
    validation: {
      holdoutByEntryMode: {
        buy: { "trend-pullback": { horizons: { 20: row } } },
        sell: { "trend-pullback": { horizons: { 20: row } } },
      },
    },
  };
}

test("reports holdout performance separately from evidence strength", () => {
  const result = buildMarketTimingReliability(
    { entryMode: "trend-pullback" },
    quality({
      samples: 12,
      hitRate: 0.666,
      hitRateLowerBound: 0.39,
      meanDirectionalReturn: 0.041,
      worstMaxAdverseReturn: -0.072,
    }),
    "buy",
  );

  assert.equal(result.status, "참고 가능");
  assert.deepEqual(result.lines, [
    "실제 신뢰 · 참고 가능",
    "동일 유형 12회 · 20일 적중 66.6%",
    "20일 평균 성과 +4.1% · 최대 하락 -7.2%",
  ]);
});

test("never presents a tiny high-hit sample as reliable", () => {
  const result = buildMarketTimingReliability(
    { entryMode: "trend-pullback" },
    quality({
      samples: 3,
      hitRate: 1,
      hitRateLowerBound: 0.44,
      meanDirectionalReturn: 0.08,
      worstMaxAdverseReturn: -0.02,
    }),
    "buy",
  );

  assert.equal(result.status, "표본 부족");
  assert.match(result.lines[1], /3회/);
});
