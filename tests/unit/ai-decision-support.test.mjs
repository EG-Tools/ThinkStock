import assert from "node:assert/strict";
import test from "node:test";

import {
  buildForecastDecisionSupport,
  horizonDecision,
} from "../../docs/modules/ai-forecast-quality-runtime.mjs";

function forecast(overrides = {}) {
  return {
    dates: ["2026-09-08"],
    model: {
      version: "path-v20",
      horizons: [20, 63, 126].map((days) => ({
        days,
        validationSamples: 24,
        directionAccuracy: 0.56,
        reliability: 0.6,
      })),
    },
    attribution: {
      horizons: {
        126: {
          expectedLogReturn: 0.08,
          components: { fundamentals: 0.05, marketRegime: -0.02, localModel: 0.05 },
        },
      },
    },
    audit: {
      sourceDates: { price: "2026-09-08", financials: "2026-09-01" },
    },
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    qualityConfidenceScale: 0.9,
    inputReliability: { status: "usable", confidenceScale: 0.95, staleSources: [] },
    horizons: Object.fromEntries([20, 63, 126].map((horizon) => [horizon, {
      samples: 12,
      effectiveSamples: 10,
      directionAccuracy: 0.58,
      confidenceScale: 0.9,
      probability: { confidenceScale: 0.92 },
      skillVsNoChange: 0.1,
    }])),
    ...overrides,
  };
}

test("marks weak short-term evidence as hold without changing the forecast", () => {
  const weak = profile();
  weak.horizons[20] = {
    samples: 8,
    effectiveSamples: 8,
    directionAccuracy: 0.42,
    confidenceScale: 0.7,
  };

  const result = horizonDecision(forecast(), weak, 20);

  assert.equal(result.status, "hold");
  assert.ok(result.reasons.includes("방향 검증 약함"));
});

test("explains changes, new evidence, opposing factors, and recheck conditions", () => {
  const previous = {
    asOf: "2026-08-31",
    modelVersion: "path-v20",
    horizons: {
      126: {
        attribution: {
          expectedLogReturn: 0.03,
          components: { fundamentals: 0.01, marketRegime: -0.01, localModel: 0.03 },
        },
      },
    },
    audit: { sourceDates: { price: "2026-08-31", financials: "2026-08-01" } },
  };

  const result = buildForecastDecisionSupport({
    forecast: forecast(),
    profile: profile(),
    records: [previous],
  });

  assert.match(result.hoverLines[0], /20일 참고.*63일 참고.*126일 참고/);
  assert.match(result.hoverLines[1], /전회 대비 126일 전망 \+5\.3%p/);
  assert.ok(result.hoverLines.some((line) => /새 근거 가격·실적/.test(line)));
  assert.ok(result.hoverLines.some((line) => /반대 근거 시장 국면/.test(line)));
  assert.match(result.hoverLines.at(-1), /^재검토/);
});

test("converts log-return changes to simple-return percentage points", () => {
  const previous = {
    asOf: "2026-08-31",
    modelVersion: "path-v20",
    horizons: {
      126: {
        attribution: {
          expectedLogReturn: Math.log1p(0.2),
          components: { fundamentals: 0.01 },
        },
      },
    },
  };
  const current = forecast({
    attribution: {
      horizons: {
        126: {
          expectedLogReturn: Math.log1p(0.5),
          components: { fundamentals: 0.02 },
        },
      },
    },
  });

  const result = buildForecastDecisionSupport({
    forecast: current,
    profile: profile(),
    records: [previous],
  });

  assert.match(result.hoverLines[1], /전회 대비 126일 전망 \+30\.0%p/);
});

test("reports insufficient comparison evidence instead of a zero change", () => {
  const previous = {
    asOf: "2026-08-31",
    modelVersion: "path-v20",
    horizons: { 126: { predictedPrice: 100 } },
  };
  const result = buildForecastDecisionSupport({
    forecast: forecast(),
    profile: profile(),
    records: [previous],
  });

  assert.match(result.hoverLines[1], /비교 근거 부족/);
  assert.doesNotMatch(result.hoverLines[1], /0\.0%p/);
});
