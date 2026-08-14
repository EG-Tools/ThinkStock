import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheTtlSeconds,
  executeRuntimeSourcePlan,
  retryDelaysMs,
  shouldConfirmRuntimeSource,
} from "../../shared/runtime-freshness-policy.mjs";

test("keeps current-day market caches short and historical caches stable", () => {
  const now = new Date("2026-08-10T00:30:00Z");
  assert.equal(cacheTtlSeconds("price", { baseDate: "2026-08-10", now }), 60);
  assert.equal(cacheTtlSeconds("price", { baseDate: "2026-08-07", now }), 15 * 24 * 60 * 60);
  assert.equal(cacheTtlSeconds("price", { baseDate: "2026-08-07", now, empty: true }), 10 * 60);
  assert.equal(cacheTtlSeconds("indices", { baseDate: "2026-08-10", now }), 60);
});

test("provides one retry policy for browser and Worker callers", () => {
  assert.deepEqual(retryDelaysMs("price"), [500, 1500]);
  assert.deepEqual(retryDelaysMs("adr"), [3000, 15000]);
  assert.deepEqual(retryDelaysMs("credit"), [500]);
  assert.deepEqual(retryDelaysMs("disclosure"), [400, 800]);
});

test("runs retries, fallback, and stale cache through one source plan", async () => {
  let attempts = 0;
  const retryResult = await executeRuntimeSourcePlan("price", {
    primary: async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("temporary");
      return "live";
    },
  }, { delaysMs: [0], sleep: async () => {} });
  assert.deepEqual(retryResult, { value: "live", source: "primary", stale: false, attempts: 2 });

  const fallbackResult = await executeRuntimeSourcePlan("price", {
    primary: async () => { const error = new Error("blocked"); error.retryable = false; throw error; },
    fallback: async () => "fallback",
  });
  assert.equal(fallbackResult.source, "fallback");

  const cacheResult = await executeRuntimeSourcePlan("price", {
    primary: async () => { throw new Error("offline"); },
    fallback: async () => { throw new Error("fallback offline"); },
    cache: async () => "cached",
  }, { delaysMs: [] });
  assert.deepEqual(cacheResult, { value: "cached", source: "cache", stale: true, attempts: 1 });
});

test("confirms live prices again after the shared live interval", () => {
  const now = new Date("2026-08-10T00:30:00Z");
  assert.equal(shouldConfirmRuntimeSource("price", {
    now,
    checkedAt: now.getTime() - 30_000,
  }), false);
  assert.equal(shouldConfirmRuntimeSource("price", {
    now,
    checkedAt: now.getTime() - 61_000,
  }), true);
  assert.equal(shouldConfirmRuntimeSource("price", { now, force: true, checkedAt: now.getTime() }), true);
});
