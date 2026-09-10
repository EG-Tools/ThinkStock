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
    "실제 신뢰 참고 가능 · 동일 유형 12회 · 20일 적중 66.6%",
    "20일 평균 +4.1% · 최대 하락 -7.2%",
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
  assert.match(result.lines[0], /3회/);
});

test("uses OBV-confirmed samples when available and otherwise falls back", () => {
  const fallbackQuality = quality({
    samples: 12,
    hitRate: 0.6,
    hitRateLowerBound: 0.36,
    meanDirectionalReturn: 0.03,
    worstMaxAdverseReturn: -0.08,
  });
  const confirmed = buildMarketTimingReliability(
    { entryMode: "trend-pullback" },
    quality({
      samples: 8,
      hitRate: 0.75,
      hitRateLowerBound: 0.4,
      meanDirectionalReturn: 0.05,
      worstMaxAdverseReturn: -0.06,
    }),
    "buy",
    { fallbackQuality, sourceLabel: "OBV 확인 표본" },
  );
  const fallback = buildMarketTimingReliability(
    { entryMode: "trend-pullback" },
    quality({ samples: 0 }),
    "buy",
    { fallbackQuality, sourceLabel: "OBV 확인 표본" },
  );

  assert.match(confirmed.lines[0], /OBV 확인 표본/);
  assert.match(confirmed.lines[0], /8회/);
  assert.doesNotMatch(fallback.lines[0], /OBV 확인 표본/);
  assert.match(fallback.lines[0], /12회/);
});
