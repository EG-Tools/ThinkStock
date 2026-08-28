import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeSourceHealth,
  MAX_BLOCK_AGE_MS,
  summarizeSourceStates,
} from "../../docs/modules/runtime-source-health.mjs";

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

test("records request success and observed quality in one source update", () => {
  let now = 7_000;
  const health = createRuntimeSourceHealth(globalThis, { now: () => now, storage: null });
  health.failure("macro", new Error("offline"));
  now = 8_000;
  const recorded = health.recordSuccess("macro", {
    firstDate: "2005-01-01",
    latestDate: "2026-08-13",
    anomalyCount: 1,
    revision: "macro:8",
  });

  assert.equal(recorded.state, "ready");
  assert.equal(recorded.lastSuccessAt, 8_000);
  assert.equal(recorded.observedAt, 8_000);
  assert.equal(recorded.failureCount, 0);
  assert.equal(recorded.qualityState, "stale");
  assert.equal(recorded.anomalyCount, 1);
  assert.equal(recorded.lastError, "");
  assert.equal(recorded.revision, "macro:8");
});

test("a failed refresh preserves the latest successful source coverage", () => {
  let now = 100;
  const health = createRuntimeSourceHealth(globalThis, { now: () => now, storage: null });
  health.success("credit", { latestDate: "2026-08-10", detail: "3 rows" });
  now = 200;
  const failed = health.failure("credit", new Error("HTTP 503"));

  assert.equal(failed.state, "stale");
  assert.equal(failed.lastSuccessAt, 100);
  assert.equal(failed.latestDate, "2026-08-10");
  assert.equal(failed.lastError, "HTTP 503");
  assert.equal(health.snapshot().credit.failureCount, 1);
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

test("coalesces rapid source updates into one persisted snapshot", () => {
  const values = new Map();
  const writes = [];
  const timers = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      values.set(key, String(value));
      writes.push(String(value));
    },
  };
  const health = createRuntimeSourceHealth(globalThis, {
    storage,
    persistDelayMs: 350,
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
  });

  health.success("macro", { latestDate: "2026-08-12" });
  health.observe("macro", { latestDate: "2026-08-12", revision: "macro:2" });
  health.success("credit", { latestDate: "2026-08-13" });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 350);
  assert.equal(writes.length, 0);

  timers[0].callback();
  assert.equal(writes.length, 1);
  const persisted = JSON.parse(writes[0]);
  assert.equal(persisted.macro.revision, "macro:2");
  assert.equal(persisted.credit.latestDate, "2026-08-13");
});
