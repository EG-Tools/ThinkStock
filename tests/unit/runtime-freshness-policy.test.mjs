import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheRefreshDecision,
  cacheTtlSeconds,
  executeRuntimeSourcePlan,
  failureBackoffMs,
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
  assert.equal(failureBackoffMs("prices", 1), 15_000);
  assert.equal(failureBackoffMs("credit", 20), 900_000);
});

test("distinguishes ready, empty, and failed cache refresh decisions", () => {
  const now = new Date("2026-08-15T03:00:00Z").getTime();
  assert.equal(cacheRefreshDecision("brokerResearch", {
    resultState: "ready",
    checkedAt: now - 60_000,
  }, { now, maximumAgeMs: 120_000 }).reuse, true);
  assert.equal(cacheRefreshDecision("brokerResearch", {
    resultState: "empty",
    checkedAt: now - 16 * 60_000,
  }, { now }).refresh, true);
  const failed = cacheRefreshDecision("credit", {
    resultState: "error",
    failureCount: 2,
    lastFailureAt: now - 10_000,
  }, { now });
  assert.equal(failed.reuse, true);
  assert.equal(failed.waitMs, 290_000);
  assert.equal(cacheRefreshDecision("price", null, { now }).reason, "missing-stale");
  assert.equal(cacheRefreshDecision("price", { checkedAt: now }, { now, force: true }).reason, "forced");
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

test("source plan skips permanent HTTP failures and honors bounded rate-limit delays", async () => {
  let authAttempts = 0;
  const auth = await executeRuntimeSourcePlan("credit", {
    primary: async () => {
      authAttempts += 1;
      const error = new Error("provider HTTP 403");
      error.status = 403;
      throw error;
    },
    fallback: async () => "mirror",
  }, { delaysMs: [1, 2], sleep: async () => {} });
  assert.equal(authAttempts, 1);
  assert.equal(auth.source, "fallback");

  const waits = [];
  let attempts = 0;
  await executeRuntimeSourcePlan("credit", {
    primary: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("provider HTTP 429");
        error.status = 429;
        error.retryAfterMs = 12_000;
        throw error;
      }
      return "fresh";
    },
  }, {
    delaysMs: [500],
    maximumRetryDelayMs: 5_000,
    sleep: async (delay) => waits.push(delay),
  });
  assert.deepEqual(waits, [5_000]);
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
