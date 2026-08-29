import assert from "node:assert/strict";
import test from "node:test";

import * as module from "../../docs/modules/chart-model-cache.mjs";

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
    entryEvictions: 0,
    weightEvictions: 1,
    stores: 3,
    clears: 0,
    requests: 3,
    hitRate: 0,
    reuseRate: 0,
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
  assert.deepEqual(cache.stats(), {
    entries: 2,
    hits: 1,
    misses: 2,
    evictions: 0,
    hitRate: 1 / 3,
    maxEntries: 2,
  });
});

test("invalidates every revisioned calculation for only the changed series", () => {
  const cache = module.createSeriesDerivedCache({ maxEntries: 4 });
  let builds = 0;
  const build = (value) => () => {
    builds += 1;
    return value;
  };

  assert.equal(cache.resolve("005930", "price-1", build("samsung-1")), "samsung-1");
  assert.equal(cache.resolve("005930", "price-2", build("samsung-2")), "samsung-2");
  assert.equal(cache.resolve("000660", "price-1", build("hynix-1")), "hynix-1");
  assert.equal(cache.resolve("005930", "price-2", build("unexpected")), "samsung-2");
  assert.equal(builds, 3);

  assert.equal(cache.invalidate("005930"), 2);
  assert.equal(cache.resolve("000660", "price-1", build("unexpected")), "hynix-1");
  assert.equal(cache.resolve("005930", "price-2", build("samsung-new")), "samsung-new");
  assert.deepEqual(cache.stats(), {
    hits: 2,
    misses: 4,
    evictions: 0,
    invalidations: 1,
    entries: 2,
    maxEntries: 4,
    series: 2,
  });
});

test("bounds revisioned series calculations with least-recently-used eviction", () => {
  const cache = module.createSeriesDerivedCache({ maxEntries: 2 });
  cache.resolve("a", "1", () => "a1");
  cache.resolve("b", "1", () => "b1");
  cache.resolve("a", "1", () => "unexpected");
  cache.resolve("c", "1", () => "c1");

  assert.equal(cache.resolve("b", "1", () => "b1-new"), "b1-new");
  assert.equal(cache.stats().evictions, 2);
});

test("routes source changes only to dependent derived series caches", () => {
  const registry = module.createSeriesDerivedCacheRegistry();
  const calls = [];
  registry.register("macd", {
    invalidate: (ticker) => calls.push(["macd", ticker]),
    stats: () => ({ entries: 2 }),
  }, { sources: ["price"] });
  registry.register("timing", {
    invalidate: (ticker) => calls.push(["timing", ticker]),
  }, { stores: ["tickerTimingModels"] });

  assert.equal(registry.invalidate("005930", {
    changedSources: ["price"],
    stores: ["tickerTimingModels"],
  }), 2);
  assert.deepEqual(calls, [["macd", "005930"], ["timing", "005930"]]);
  assert.deepEqual(registry.stats(), {
    invalidations: 1,
    adapterInvalidations: 2,
    clears: 0,
    adapters: {
      macd: { entries: 2 },
      timing: null,
    },
  });
});
