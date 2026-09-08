import assert from "node:assert/strict";
import test from "node:test";


import * as module from "../../docs/modules/shared-request-registry.mjs";


test("shares one producer across simultaneous consumers", async () => {
  const registry = module.createSharedRequestRegistry();
  let calls = 0;
  let release;
  const factory = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = registry.run("price:005930", factory);
  const second = registry.run("price:005930", factory);
  await Promise.resolve();
  release({ close: 100 });

  assert.deepEqual(await first, { close: 100 });
  assert.deepEqual(await second, { close: 100 });
  assert.equal(calls, 1);
  assert.equal(registry.stats().sharedHits, 1);
});

test("starts a fresh producer when the same key is requested immediately after completion", async () => {
  const registry = module.createSharedRequestRegistry();
  let calls = 0;
  const factory = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await registry.run("price:005930", factory), 1);
  assert.equal(await registry.run("price:005930", factory), 2);
  assert.equal(calls, 2);
  assert.equal(registry.stats().inFlight, 0);
});

test("an old producer cleanup cannot delete a new request for the same key", async () => {
  const registry = module.createSharedRequestRegistry();
  let releaseSecond;
  let calls = 0;
  const factory = () => {
    calls += 1;
    if (calls === 1) return Promise.resolve("first");
    return new Promise((resolve) => { releaseSecond = resolve; });
  };

  assert.equal(await registry.run("macro", factory), "first");
  const second = registry.run("macro", factory);
  await Promise.resolve();
  assert.equal(registry.has("macro"), true);
  await Promise.resolve();
  assert.equal(registry.has("macro"), true);
  releaseSecond("second");
  assert.equal(await second, "second");
});


test("one cancelled consumer does not abort another consumer", async () => {
  const registry = module.createSharedRequestRegistry();
  const firstController = new AbortController();
  let release;
  let producerAborted = false;
  const factory = (signal) => {
    signal.addEventListener("abort", () => { producerAborted = true; });
    return new Promise((resolve) => { release = resolve; });
  };
  const first = registry.run("macro", factory, { signal: firstController.signal });
  const second = registry.run("macro", factory);
  await Promise.resolve();
  firstController.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(producerAborted, false);
  release("ready");
  assert.equal(await second, "ready");
});


test("aborts the producer after its last consumer cancels", async () => {
  const registry = module.createSharedRequestRegistry();
  const controller = new AbortController();
  let producerAborted = false;
  const request = registry.run("credit", (signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      producerAborted = true;
      reject(module.abortError());
    });
  }), { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(producerAborted, true);
});


test("maps work with a bounded concurrency while preserving result order", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await module.mapWithConcurrency([4, 3, 2, 1], 2, async (value, index) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active -= 1;
    return `${index}:${value}`;
  });
  assert.deepEqual(results, ["0:4", "1:3", "2:2", "3:1"]);
  assert.equal(maximumActive, 2);
  assert.deepEqual(await module.mapWithConcurrency([], 2, () => null), []);
});

test("queues one forced producer after a normal request and shares duplicate force callers", async () => {
  const registry = module.createSharedRequestRegistry();
  const releases = [];
  let calls = 0;
  const factory = () => {
    calls += 1;
    return new Promise((resolve) => releases.push(resolve));
  };
  const normal = registry.run("analysis:005930", factory, { tag: "normal" });
  await Promise.resolve();
  const forcedA = registry.run("analysis:005930", factory, { tag: "force", afterCurrent: true });
  const forcedB = registry.run("analysis:005930", factory, { tag: "force", afterCurrent: true });
  assert.equal(registry.has("analysis:005930"), true);
  assert.equal(registry.tag("analysis:005930"), "normal");
  releases.shift()("cached");
  assert.equal(await normal, "cached");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(registry.tag("analysis:005930"), "force");
  releases.shift()("fresh");
  assert.equal(await forcedA, "fresh");
  assert.equal(await forcedB, "fresh");
  assert.equal(registry.stats().queued, 2);
  assert.equal(registry.stats().sharedHits, 1);
});

test("publishes compact in-flight snapshots", async () => {
  const registry = module.createSharedRequestRegistry();
  const snapshots = [];
  const unsubscribe = registry.subscribe((value) => snapshots.push(value));
  let release;
  const request = registry.run("macro", () => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  assert.deepEqual(registry.keys(), ["macro"]);
  release("ok");
  await request;
  await Promise.resolve();
  unsubscribe();
  assert.equal(snapshots.some((value) => value.inFlight === 1), true);
  assert.equal(snapshots.at(-1).inFlight, 0);
});
