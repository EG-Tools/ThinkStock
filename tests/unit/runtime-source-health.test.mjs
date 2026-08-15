import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/runtime-freshness-policy.mjs");
await import("../../docs/modules/runtime-source-health.js");

const {
  createRuntimeSourceHealth,
  MAX_BLOCK_AGE_MS,
  summarizeSourceStates,
} = globalThis.ThinkStockRuntimeSourceHealth;

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("source health persists a failure and blocks an immediate automatic retry", () => {
  let now = 1_000;
  const storage = createStorage();
  const first = createRuntimeSourceHealth(globalThis, { now: () => now, storage });
  first.failure("indices", new Error("HTTP 503"));

  const restored = createRuntimeSourceHealth(globalThis, { now: () => now, storage });
  const decision = restored.canAttempt("indices");
  assert.equal(decision.allowed, false);
  assert.equal(decision.waitMs, 15_000);
  assert.equal(decision.state.lastError, "HTTP 503");
});

test("manual refresh bypasses source backoff and success closes the circuit", () => {
  let now = 5_000;
  const health = createRuntimeSourceHealth(globalThis, { now: () => now, storage: null });
  health.failure("credit", new Error("offline"));
  assert.equal(health.canAttempt("credit").allowed, false);
  assert.equal(health.canAttempt("credit", { force: true }).allowed, true);

  now += 10;
  health.success("credit", { latestDate: "2026-08-11" });
  assert.equal(health.canAttempt("credit").allowed, true);
  assert.equal(health.snapshot().credit.failureCount, 0);
});

test("a stale persisted failure cannot block a later session indefinitely", () => {
  let now = 10_000;
  const health = createRuntimeSourceHealth(globalThis, { now: () => now, storage: null });
  health.failure("adr", new Error("HTTP 503"));
  now += MAX_BLOCK_AGE_MS + 1;
  assert.equal(health.canAttempt("adr").allowed, true);
});

test("records data coverage and quality without resetting request backoff", () => {
  let now = 20_000;
  const health = createRuntimeSourceHealth(globalThis, { now: () => now, storage: null });
  health.failure("macro", new Error("offline"));
  now += 100;
  const observed = health.observe("macro", {
    firstDate: "2005-01-01",
    latestDate: "2026-08-13",
    anomalyCount: 1,
    gapCount: 2,
    revision: "macro:7",
  });

  assert.equal(observed.qualityState, "stale");
  assert.equal(observed.firstDate, "2005-01-01");
  assert.equal(observed.gapCount, 2);
  assert.equal(observed.lastError, "offline");
  assert.equal(health.canAttempt("macro").allowed, false);
});

test("summarizes source coverage and quality without retaining error text", () => {
  const summary = summarizeSourceStates({
    prices: {
      state: "ready",
      qualityState: "ready",
      firstDate: "2000-01-04",
      latestDate: "2026-08-13",
      observedAt: 100,
    },
    credit: {
      state: "ready",
      qualityState: "stale",
      firstDate: "2021-11-09",
      latestDate: "2026-08-11",
      anomalyCount: 1,
      gapCount: 2,
      lastError: "secret upstream detail",
      observedAt: 200,
    },
    adr: {
      state: "error",
      qualityState: "error",
      isEmpty: true,
      lastFailureAt: 300,
    },
  });

  assert.deepEqual(summary.states, { ready: 1, stale: 1, error: 1 });
  assert.deepEqual(summary.issueSources, ["adr", "credit"]);
  assert.equal(summary.anomalyCount, 1);
  assert.equal(summary.gapCount, 2);
  assert.equal(summary.latestObservedAt, 300);
  assert.equal(summary.coverage.credit.state, "stale");
  assert.equal(JSON.stringify(summary).includes("secret upstream detail"), false);
});

test("bounds repeated provider failures and recovers after the maximum backoff", () => {
  let now = 50_000;
  const health = createRuntimeSourceHealth(globalThis, { now: () => now, storage: null });
  for (let index = 0; index < 100; index += 1) health.failure("credit", new Error("HTTP 503"));

  assert.equal(health.snapshot().credit.failureCount, 20);
  assert.equal(health.canAttempt("credit").waitMs, 900_000);
  now += 900_000;
  assert.equal(health.canAttempt("credit").allowed, true);
  health.success("credit", { latestDate: "2026-08-13" });
  assert.equal(health.snapshot().credit.failureCount, 0);
  assert.equal(health.snapshot().credit.latestDate, "2026-08-13");
});
