import assert from "node:assert/strict";
import test from "node:test";

import * as module from "../../docs/modules/ai-forecast-quality-runtime.mjs";

function createFeature() {
  const mergeForecastRecords = (existing, incoming) => {
    const records = new Map();
    [...(existing || []), ...(incoming || [])].forEach((record) => {
      if (record?.id) records.set(record.id, { ...record });
    });
    return [...records.values()];
  };
  return {
    journal: {
      SCHEMA_VERSION: 2,
      buildForecastRecord: ({ ticker, forecast }) => ({
        id: `${ticker}:${forecast.asOf}:test`,
        ticker,
        asOf: forecast.asOf,
      }),
      mergeForecastRecords,
      normalizeForecastRecord: (record) => record?.id ? { ...record } : null,
      scoreForecastRecords: (records) => records.map((record) => ({ ...record, scored: true })),
      summarizeForecastQuality: (records, options) => ({
        asOf: options.asOf,
        totalSamples: records.length,
      }),
    },
    calibration: {
      applyForecastCalibration: (forecast, profile) => ({ ...forecast, profile }),
      buildCalibrationProfile: ({ ticker, records }) => ({
        ticker,
        samples: records.length,
        totalSamples: records.length,
        applied: records.length > 0,
        horizons: {
          126: {
            correctionEligible: records.length > 0,
            walkForward: { applied: records.length > 0, passed: records.length === 0 },
          },
        },
        inputReliability: { staleSources: [] },
      }),
      buildForecastQualityDiagnostic: (profile) => ({ status: "usable", ...profile }),
      summarizeForecastQualityDiagnostics: (diagnostics) => ({ seriesCount: diagnostics.size }),
    },
    forecast: {
      applyChartTransform: (forecast) => ({ ...forecast, transformed: true }),
    },
  };
}

test("coalesces ticker and pool reads while skipping identical writes", async () => {
  const feature = createFeature();
  let tickerReads = 0;
  let poolReads = 0;
  let writes = 0;
  const stored = [{ id: "005930.KS:2026-01-01:test", ticker: "005930.KS", scored: true }];
  const runtime = module.createAiForecastQualityRuntime(globalThis, {
    getFeature: () => feature,
    readTicker: async () => { tickerReads += 1; return { records: stored }; },
    readAll: async () => { poolReads += 1; return [{ records: stored }]; },
    writeTicker: async () => { writes += 1; },
  });
  const forecast = { asOf: "2026-08-13", dates: ["2026-08-13"] };
  const history = [{ date: "2026-08-13", "005930.KS": 100 }];

  const [first, second] = await Promise.all([
    runtime.calibrate("005930.KS", forecast, history, {}),
    runtime.calibrate("005930.KS", forecast, history, {}),
  ]);

  assert.equal(first.transformed, true);
  assert.equal(second.transformed, true);
  assert.equal(tickerReads, 1);
  assert.equal(poolReads, 1);
  assert.equal(writes, 0);
  assert.equal(runtime.stats().calibrationRuns, 2);
  assert.equal(runtime.stats().calibrationApplied, 2);
  assert.equal(runtime.stats().correctionEligibleHorizons, 2);
  assert.equal(runtime.stats().walkForwardRejectedHorizons, 2);
});

test("serializes changed journal writes and persists the same result once", async () => {
  const feature = createFeature();
  let writes = 0;
  const stored = [{ id: "005930.KS:2026-01-01:test", ticker: "005930.KS" }];
  const runtime = module.createAiForecastQualityRuntime(globalThis, {
    getFeature: () => feature,
    readTicker: async () => ({ records: stored }),
    readAll: async () => [{ records: stored }],
    writeTicker: async () => { writes += 1; },
  });
  const forecast = { asOf: "2026-08-13", dates: ["2026-08-13"] };

  await Promise.all([
    runtime.calibrate("005930.KS", forecast, [], {}),
    runtime.calibrate("005930.KS", forecast, [], {}),
  ]);
  assert.equal(writes, 1);
  assert.ok(runtime.stats().tickerWriteSkips >= 1);
});

test("keeps preloaded pool records when a ticker sync happens first", async () => {
  const feature = createFeature();
  const older = { id: "000660.KS:2026-01-01:test", ticker: "000660.KS" };
  const runtime = module.createAiForecastQualityRuntime(globalThis, {
    getFeature: () => feature,
    readTicker: async () => ({ records: [] }),
    readAll: async () => [{ records: [older] }],
    writeTicker: async () => true,
  });

  await runtime.sync("005930.KS", { asOf: "2026-08-13" }, []);
  const records = await runtime.readPoolRecords();
  assert.deepEqual(new Set(records.map((record) => record.ticker)), new Set(["000660.KS", "005930.KS"]));
});

test("deduplicates identical remote forecast journal synchronization", async () => {
  const feature = createFeature();
  let remoteReads = 0;
  let remoteWrites = 0;
  const runtime = module.createAiForecastQualityRuntime(globalThis, {
    getFeature: () => feature,
    readTicker: async () => ({ records: [] }),
    writeTicker: async () => true,
    isRemoteEnabled: () => true,
    readRemote: async () => { remoteReads += 1; return []; },
    writeRemote: async () => { remoteWrites += 1; return true; },
  });
  const forecast = { asOf: "2026-08-13" };

  const [first, second] = await Promise.all([
    runtime.sync("005930.KS", forecast, []),
    runtime.sync("005930.KS", forecast, []),
  ]);
  assert.equal(first, second);
  assert.equal(remoteReads, 1);
  assert.equal(remoteWrites, 1);
  assert.equal(runtime.stats().syncCoalesced, 1);
});

test("bounds diagnostics and invalidates one ticker without touching others", async () => {
  const feature = createFeature();
  const runtime = module.createAiForecastQualityRuntime(globalThis, {
    getFeature: () => feature,
    maxDiagnostics: 2,
  });
  const tickers = ["000001.KS", "000002.KS", "000003.KS"];
  for (const ticker of tickers) {
    await runtime.calibrate(ticker, { asOf: "2026-08-13", dates: ["2026-08-13"] }, [], {});
  }
  assert.equal(runtime.summarizeDiagnostics().seriesCount, 2);
  assert.equal(runtime.invalidateTicker("000003.KS"), true);
  assert.equal(runtime.summarizeDiagnostics().seriesCount, 1);
});
