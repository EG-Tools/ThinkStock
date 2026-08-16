import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/shared-request-registry.js");
await import("../../docs/modules/dart-request-runtime.js");
await import("../../docs/modules/ai-forecast-input-cache.js");

test("DART request runtime shares normal work and queues one forced refresh", async () => {
  const registry = globalThis.ThinkStockSharedRequestRegistry.createSharedRequestRegistry();
  const runtime = globalThis.ThinkStockDartRequestRuntime.createDartRequestRuntime(registry);
  let runs = 0;
  let release;
  const first = runtime.run("seed", "005930.KS", async () => {
    runs += 1;
    await new Promise((resolve) => { release = resolve; });
    return "normal";
  });
  const shared = runtime.run("seed", "005930.KS", async () => "duplicate");
  const forced = runtime.run("seed", "005930.KS", async () => {
    runs += 1;
    return "forced";
  }, { force: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  assert.equal(await first, "normal");
  assert.equal(await shared, "normal");
  assert.equal(await forced, "forced");
  assert.equal(runs, 2);
  assert.deepEqual(runtime.identities("seed"), []);
});

test("DART request runtime exposes pending identities by request kind", async () => {
  const registry = globalThis.ThinkStockSharedRequestRegistry.createSharedRequestRegistry();
  const runtime = globalThis.ThinkStockDartRequestRuntime.createDartRequestRuntime(registry);
  let release;
  const request = runtime.run("insider", "005930.KS", () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(runtime.identities("insider"), ["005930.KS"]);
  release([]);
  await request;
});

test("AI input cache reuses projections and evicts the oldest entry", () => {
  const cache = globalThis.ThinkStockAiForecastInputCache.createAiForecastInputCache({ maxEntries: 2 });
  let builds = 0;
  const resolve = (key) => cache.resolve(key, () => ({ key, build: ++builds }));
  assert.equal(resolve("a"), resolve("a"));
  resolve("b");
  resolve("c");
  assert.equal(resolve("a").build, 4);
  assert.equal(cache.stats().entries, 2);
});
