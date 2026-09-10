import assert from "node:assert/strict";
import test from "node:test";

import { createSeriesVolumeCoverageRuntime } from "../../docs/modules/runtime-market-refresh.mjs";

function profileFor(key) {
  return String(key).startsWith("^")
    ? { kind: "market-index", requiresVolume: true }
    : { kind: "stock", requiresVolume: true };
}

test("stock and index volume use one coverage and completion contract", async () => {
  const coverage = new Map();
  const loads = [];
  const ready = [];
  const runtime = createSeriesVolumeCoverageRuntime({
    profileFor,
    hasCoverage: (key, sinceDate) => (coverage.get(key) || "9999-12-31") <= sinceDate,
    isActive: () => true,
    loadIndex: async (keys, request) => {
      loads.push(["index", keys, request.sinceDate]);
      keys.forEach((key) => coverage.set(key, request.sinceDate));
    },
    loadStock: async (key, request) => {
      loads.push(["stock", key, request.sinceDate]);
      coverage.set(key, request.sinceDate);
    },
    onReady: (keys, context) => ready.push([keys, context.sinceDate]),
  });

  const result = await runtime.ensure(["^ks11", "005930.ks"], "2025-09-01");

  assert.equal(result.ready, true);
  assert.deepEqual(loads, [
    ["index", ["^KS11"], "2025-09-01"],
    ["stock", "005930.KS", "2025-09-01"],
  ]);
  assert.deepEqual(ready, [[ ["^KS11", "005930.KS"], "2025-09-01" ]]);
});

test("repeated ranges share work and an earlier range queues once", async () => {
  let coveredSince = "9999-12-31";
  let releaseFirst;
  const loads = [];
  const runtime = createSeriesVolumeCoverageRuntime({
    profileFor,
    hasCoverage: (_key, sinceDate) => coveredSince <= sinceDate,
    isActive: () => true,
    loadIndex: async (_keys, request) => {
      loads.push(request.sinceDate);
      if (loads.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
      coveredSince = request.sinceDate;
    },
    loadStock: async () => {},
  });

  const first = runtime.ensure(["^KS11"], "2026-01-01");
  const shared = runtime.ensure(["^KS11"], "2026-01-01");
  const earlier = runtime.ensure(["^KS11"], "2025-01-01");
  await Promise.resolve();
  releaseFirst();
  await Promise.all([first, shared, earlier]);

  assert.deepEqual(loads, ["2026-01-01", "2025-01-01"]);
  assert.deepEqual(runtime.pendingKeys(), []);
});
