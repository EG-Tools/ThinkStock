import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/series-cache-retention.js");
const retentionModule = globalThis.ThinkStockSeriesCacheRetention;

function records(count, start = 1) {
  return Array.from({ length: count }, (_, index) => ({
    ticker: `T${String(start + index).padStart(2, "0")}`,
    savedAt: (start + index) * 100,
    lastAccessed: (start + index) * 100,
  }));
}

test("does not rank or evict while the custom ticker cache has free slots", () => {
  const retention = retentionModule.createSeriesCacheRetention({ capacity: 24, now: () => 9000 });
  retention.initialize(records(23));
  retention.noteAccess("T01", 8000);
  retention.noteAccess("T02", 8100);

  const plan = retention.planAdmission("T24");
  assert.equal(plan.rankingRequired, false);
  assert.deepEqual(plan.evictKeys, []);
  assert.equal(retention.stats().rankingRuns, 0);
});

test("does not rerank a cached ticker even when all slots are occupied", () => {
  const retention = retentionModule.createSeriesCacheRetention({ capacity: 24 });
  retention.initialize(records(24));
  retention.noteAccess("T01", 10000);

  const plan = retention.planAdmission("T01");
  assert.equal(plan.existing, true);
  assert.equal(plan.rankingRequired, false);
  assert.equal(retention.stats().rankingRuns, 0);
});

test("ranks only when a new ticker enters a full cache", () => {
  const retention = retentionModule.createSeriesCacheRetention({ capacity: 24 });
  retention.initialize(records(24));
  retention.noteAccess("T01", 10000);
  retention.noteAccess("T02", 11000);

  const plan = retention.planAdmission("T25");
  assert.equal(plan.rankingRequired, true);
  assert.equal(plan.evictKeys.length, 1);
  assert.equal(plan.evictKeys[0], "T03");
  assert.deepEqual(plan.touchUpdates.map((entry) => entry.key), ["T01", "T02"]);
  assert.equal(retention.stats().rankingRuns, 1);

  retention.commitAdmission("T25", { ticker: "T25", lastAccessed: 12000 }, plan.evictKeys);
  assert.equal(retention.stats().entries, 24);
});

test("repairs an over-capacity legacy cache during the next admission only", () => {
  const retention = retentionModule.createSeriesCacheRetention({ capacity: 24 });
  retention.initialize(records(27));
  assert.equal(retention.stats().rankingRuns, 0);

  const plan = retention.planAdmission("T28");
  assert.equal(plan.rankingRequired, true);
  assert.deepEqual(plan.evictKeys, ["T01", "T02", "T03", "T04"]);
  retention.commitAdmission("T28", { ticker: "T28", lastAccessed: 2800 }, plan.evictKeys);
  assert.equal(retention.stats().entries, 24);
});
