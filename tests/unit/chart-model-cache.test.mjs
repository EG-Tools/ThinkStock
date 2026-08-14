import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-model-cache.js");
const module = globalThis.ThinkStockChartModelCache;

test("reuses recent chart compositions across visibility toggles", async () => {
  const cache = module.createChartModelCache({ maxEntries: 3 });
  let builds = 0;
  const build = (name) => () => {
    builds += 1;
    return { name };
  };

  assert.deepEqual(await cache.resolve("stock:on", build("on")).promise, { name: "on" });
  assert.deepEqual(await cache.resolve("stock:off", build("off")).promise, { name: "off" });
  const restored = cache.resolve("stock:on", build("unexpected"));

  assert.equal(restored.status, "hit");
  assert.deepEqual(await restored.promise, { name: "on" });
  assert.equal(builds, 2);
});

test("coalesces concurrent builds for the same chart composition", async () => {
  const cache = module.createChartModelCache();
  let release;
  let builds = 0;
  const producer = () => {
    builds += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = cache.resolve("same", producer);
  await Promise.resolve();
  const second = cache.resolve("same", producer);
  assert.equal(first.status, "miss");
  assert.equal(second.status, "coalesced");
  release({ ready: true });
  assert.equal(await first.promise, await second.promise);
  assert.equal(builds, 1);
});

test("clear prevents an older pending build from repopulating the cache", async () => {
  const cache = module.createChartModelCache();
  let release;
  const pending = cache.resolve("old", () => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  cache.clear();
  release({ stale: true });
  await pending.promise;

  let rebuilt = 0;
  const request = cache.resolve("old", () => {
    rebuilt += 1;
    return { stale: false };
  });
  assert.equal(request.status, "miss");
  assert.deepEqual(await request.promise, { stale: false });
  assert.equal(rebuilt, 1);
});

test("evicts the least recently used chart composition", async () => {
  const cache = module.createChartModelCache({ maxEntries: 2 });
  await cache.resolve("a", () => "a").promise;
  await cache.resolve("b", () => "b").promise;
  await cache.resolve("a", () => "unexpected").promise;
  await cache.resolve("c", () => "c").promise;

  const request = cache.resolve("b", () => "rebuilt-b");
  assert.equal(request.status, "miss");
  assert.equal(await request.promise, "rebuilt-b");
  assert.equal(cache.stats().evictions, 2);
});

test("keeps small recent compositions but bounds long-history memory weight", async () => {
  const cache = module.createChartModelCache({
    maxEntries: 3,
    maxWeight: 10,
    getWeight: (value) => value.weight,
  });
  await cache.resolve("full", () => ({ weight: 4 })).promise;
  await cache.resolve("one-hidden", () => ({ weight: 4 })).promise;
  await cache.resolve("two-hidden", () => ({ weight: 4 })).promise;

  assert.deepEqual(cache.stats(), {
    hits: 0,
    misses: 3,
    coalesced: 0,
    evictions: 1,
    clears: 0,
    entries: 2,
    pending: 0,
    maxEntries: 3,
    maxWeight: 10,
    totalWeight: 8,
  });
  assert.equal(cache.resolve("full", () => ({ weight: 4 })).status, "miss");
});

test("estimates retained chart model arrays instead of counting models equally", () => {
  assert.equal(module.estimateMainChartModelWeight({
    rows: [{}, {}],
    seriesModels: [{
      rawTexts: ["1", "2"],
      xValues: ["a", "b"],
      values: [1, 2],
      baseValues: [1, 2],
    }],
    displayIndexes: [0, 1],
  }), 12);
});

test("reuses a source fingerprint until its data revision changes", () => {
  let scans = 0;
  const cache = module.createSourceFingerprintCache({
    fingerprint: (rows, keys, options) => {
      scans += 1;
      return `${options.logicVersion}:${rows.length}:${keys.join(",")}:${scans}`;
    },
  });
  const rows = [{ date: "2026-08-13", stock: 10 }];

  const first = cache.resolve(rows, ["stock"], "price:1", { tail: 520, logicVersion: "chart-v3" });
  const same = cache.resolve(rows, ["stock"], "price:1", { tail: 520, logicVersion: "chart-v3" });
  const changed = cache.resolve(rows, ["stock"], "price:2", { tail: 520, logicVersion: "chart-v3" });

  assert.equal(first, same);
  assert.notEqual(first, changed);
  assert.equal(scans, 2);
  assert.deepEqual(cache.stats(), { entries: 2, hits: 1, misses: 2, maxEntries: 2 });
});
