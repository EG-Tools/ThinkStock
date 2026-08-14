import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/shared-request-registry.js");
const module = globalThis.ThinkStockSharedRequestRegistry;


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
