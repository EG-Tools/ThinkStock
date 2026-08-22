import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const sharedSource = await readFile(path.resolve("docs/modules/shared-request-registry.js"), "utf8");
const source = await readFile(path.resolve("docs/modules/runtime-refresh-orchestrator.js"), "utf8");
const context = {};
vm.runInNewContext(sharedSource, context);
vm.runInNewContext(source, context);
const {
  isRetryableRuntimeError,
  retryOnce,
  retryRuntimeSource,
  retryWithDelays,
  runTaskFactoriesWithConcurrency,
  runRefreshPhases,
  waitForDelay,
} = context.ThinkStockRuntimeRefresh;


function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}


test("starts supplemental work before critical work finishes", async () => {
  const critical = deferred();
  const supplemental = deferred();
  const events = [];
  const task = runRefreshPhases({
    criticalTasks: [() => { events.push("critical-start"); return critical.promise; }],
    supplementalTasks: [() => { events.push("supplemental-start"); return supplemental.promise; }],
    onCritical: () => events.push("critical-ready"),
    onSupplemental: () => events.push("supplemental-ready"),
  });

  await Promise.resolve();
  assert.deepEqual(events, ["critical-start", "supplemental-start"]);
  supplemental.resolve("supplemental");
  await Promise.resolve();
  assert.deepEqual(events, ["critical-start", "supplemental-start"]);
  critical.resolve("critical");
  const result = await task;

  assert.deepEqual(events, [
    "critical-start",
    "supplemental-start",
    "critical-ready",
    "supplemental-ready",
  ]);
  assert.deepEqual(Array.from(result.criticalResults), ["critical"]);
  assert.deepEqual(Array.from(result.supplementalResults), ["supplemental"]);
});


test("does not run supplemental completion when critical work fails", async () => {
  let supplementalCompleted = false;
  await assert.rejects(runRefreshPhases({
    criticalTasks: [() => Promise.reject(new Error("critical failed"))],
    supplementalTasks: [() => Promise.resolve("done")],
    onSupplemental: () => { supplementalCompleted = true; },
  }), /critical failed/);
  assert.equal(supplementalCompleted, false);
});

test("startup can wait for critical rendering and bounds supplemental concurrency", async () => {
  const critical = deferred();
  const first = deferred();
  const second = deferred();
  const events = [];
  const task = runRefreshPhases({
    startSupplementalAfterCritical: true,
    supplementalConcurrency: 1,
    criticalTasks: [() => { events.push("critical-start"); return critical.promise; }],
    supplementalTasks: [
      () => { events.push("supplemental-1"); return first.promise; },
      () => { events.push("supplemental-2"); return second.promise; },
    ],
    onCritical: () => events.push("critical-ready"),
  });

  await Promise.resolve();
  assert.deepEqual(events, ["critical-start"]);
  critical.resolve("critical");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["critical-start", "critical-ready", "supplemental-1"]);
  first.resolve("first");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["critical-start", "critical-ready", "supplemental-1", "supplemental-2"]);
  second.resolve("second");
  await task;
});

test("bounded task execution preserves result order", async () => {
  const active = { count: 0, maximum: 0 };
  const results = await runTaskFactoriesWithConcurrency([0, 1, 2, 3].map((value) => async () => {
    active.count += 1;
    active.maximum = Math.max(active.maximum, active.count);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active.count -= 1;
    return value;
  }), 2);
  assert.deepEqual(Array.from(results), [0, 1, 2, 3]);
  assert.equal(active.maximum, 2);
});


test("retries once after the configured delay", async () => {
  const attempts = [];
  const delays = [];
  const result = await retryOnce(async (attempt) => {
    attempts.push(attempt);
    if (attempt === 0) throw new Error("HTTP 403");
    return "ok";
  }, {
    delayMs: 3000,
    shouldRetry: () => true,
    sleep: async (delayMs) => { delays.push(delayMs); },
  });

  assert.equal(result, "ok");
  assert.deepEqual(attempts, [0, 1]);
  assert.deepEqual(delays, [3000]);
});


test("uses a longer final delay only after the second failure", async () => {
  const attempts = [];
  const delays = [];
  const result = await retryWithDelays(async (attempt) => {
    attempts.push(attempt);
    if (attempt < 2) throw new Error("HTTP 403");
    return "ok";
  }, {
    delaysMs: [3000, 15000],
    shouldRetry: () => true,
    sleep: async (delayMs) => { delays.push(delayMs); },
  });

  assert.equal(result, "ok");
  assert.deepEqual(attempts, [0, 1, 2]);
  assert.deepEqual(delays, [3000, 15000]);
});


test("does not retry a non-transient failure", async () => {
  let attempts = 0;
  let slept = false;
  await assert.rejects(retryOnce(async () => {
    attempts += 1;
    throw new Error("ADR data parse failed");
  }, {
    delayMs: 3000,
    shouldRetry: () => false,
    sleep: async () => { slept = true; },
  }), /parse failed/);

  assert.equal(attempts, 1);
  assert.equal(slept, false);
});

test("retries transient runtime failures but not authentication or contract errors", async () => {
  let attempts = 0;
  const delays = [];
  const result = await retryRuntimeSource(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("fetch failed");
      error.status = 503;
      throw error;
    }
    return "ok";
  }, {
    delaysMs: [500, 1500],
    sleep: async (delay) => { delays.push(delay); },
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [500]);
  assert.equal(isRetryableRuntimeError(Object.assign(new Error("denied"), { status: 401 })), false);
  assert.equal(isRetryableRuntimeError(Object.assign(new Error("bad rows"), { code: "RUNTIME_DATA_REJECTED" })), false);
  assert.equal(isRetryableRuntimeError(new Error("JSON parsing failed")), false);
});


test("cancels before retry when the refresh is superseded", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(retryOnce(async () => {
    attempts += 1;
    throw new Error("HTTP 503");
  }, {
    delayMs: 3000,
    signal: controller.signal,
    shouldRetry: () => true,
    sleep: async () => { controller.abort(new Error("superseded")); },
  }), /superseded/);

  assert.equal(attempts, 1);
});


test("cancels a detached retry delay when a newer refresh starts", async () => {
  const controller = new AbortController();
  const pending = waitForDelay(15000, controller.signal, async () => {
    controller.abort(new Error("newer refresh"));
  });

  await assert.rejects(pending, /newer refresh/);
});
