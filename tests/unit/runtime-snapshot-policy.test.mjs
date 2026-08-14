import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/runtime-snapshot-controller.js");
const policy = globalThis.ThinkStockRuntimeSnapshotPolicy;


test("tracks component revisions and reuses only current cached values", () => {
  const tracker = policy.createRevisionTracker(["price", "macro"]);
  let builds = 0;
  const resolve = () => ({ build: ++builds });

  assert.deepEqual(tracker.getComponent("price", resolve), { build: 1 });
  assert.deepEqual(tracker.getComponent("price", resolve), { build: 1 });
  tracker.markChanged(["price"]);
  assert.deepEqual(tracker.getComponent("price", resolve), { build: 2 });
  tracker.applyRevisions({ macro: 7 }, ["macro"]);
  tracker.seedComponent("macro", ["cached"]);

  assert.deepEqual(tracker.getRevisions(), { price: 1, macro: 7 });
  assert.deepEqual(tracker.getComponent("macro", resolve), ["cached"]);
});


test("validates snapshot age and creates compact fallback data", () => {
  const now = Date.parse("2026-07-20T00:00:00Z");
  assert.equal(policy.isSnapshotUsable({
    version: 9,
    saved_at: "2026-07-19T00:00:00Z",
  }, {
    schemaVersion: 9,
    now,
    futureToleranceMs: 86_400_000,
    maxAgeMs: 7 * 86_400_000,
  }), true);
  assert.equal(policy.isSnapshotUsable({
    version: 9,
    saved_at: "2026-06-01T00:00:00Z",
  }, {
    schemaVersion: 9,
    now,
    maxAgeMs: 7 * 86_400_000,
  }), false);
  assert.equal(policy.isSnapshotUsable({
    version: 8,
    saved_at: "2026-07-19T00:00:00Z",
  }, {
    schemaVersion: 9,
    now,
    maxAgeMs: 7 * 86_400_000,
  }), false);

  const compact = policy.buildCompactSnapshot({
    metadata: { version: 8, format: "compact-v1" },
    revisions: { price: 2 },
    maxRows: 2,
    maxDisclosures: 1,
    components: {
      price: { records: [{ date: "1" }, { date: "2" }, { date: "3" }] },
      macro: [1, 2, 3],
      credit: [1, 2, 3],
      adr: [1, 2, 3],
      crisis: [1, 2, 3],
      disclosure: [1, 2],
    },
  });
  assert.deepEqual(compact.pricePayload.records.map((row) => row.date), ["2", "3"]);
  assert.deepEqual(compact.disclosureRows, [2]);
  assert.deepEqual(compact.crisisRows, [2, 3]);
  assert.equal(policy.buildSignature(true, ["price"], { price: 2 }), "history::price:2");
});


test("requires price history before treating a snapshot as historical", () => {
  const historicalPrice = [
    { date: "1998-01-02", "^KS11": 400 },
    { date: "2026-07-14", "^KS11": 3000 },
  ];
  const historicalMacro = [
    { date: "1998-01-02", leading_cycle: 98 },
    { date: "2026-07-14", leading_cycle: 102 },
  ];
  const historicalCredit = [
    { date: "1998-01-02", kospi_credit: 1 },
    { date: "2026-07-14", kospi_credit: 2 },
  ];
  const recentPrice = [
    { date: "2002-01-02", "005930.KS": 5000 },
    { date: "2015-07-14", "^KS11": 2000 },
    { date: "2026-07-14", "^KS11": 3000 },
  ];
  assert.equal(policy.hasCoreHistoricalCoverage({
    price: historicalPrice,
    macro: historicalMacro,
    credit: historicalCredit,
  }, 132), true);
  assert.equal(policy.hasCoreHistoricalCoverage({
    price: recentPrice,
    macro: historicalMacro,
    credit: historicalCredit,
  }, 132), false);
});
