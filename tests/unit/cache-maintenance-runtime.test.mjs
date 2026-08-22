import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/cache-maintenance-runtime.js");
const module = globalThis.ThinkStockCacheMaintenanceRuntime;


function policy() {
  return {
    recordLifecycle: (record) => record.active ? "active" : "expired",
    storePolicy: (_name, overrides = {}) => ({
      maxRecords: overrides.maxRecords || 10,
      maxIdleMs: 1000,
    }),
  };
}


test("removes expired records while preserving active records", async () => {
  const deleted = [];
  const records = new Map([
    ["active", { active: true }],
    ["expired", { active: false }],
  ]);
  const runtime = module.createCacheMaintenanceRuntime(globalThis, {
    lifecyclePolicy: policy(),
    store: {
      readRecord: async (_store, key) => records.get(key) || null,
      deleteRecord: async (_store, key) => deleted.push(key),
      pruneStore: async () => 0,
    },
  });

  assert.deepEqual(await runtime.readActiveRecord("prices", "active"), { active: true });
  assert.equal(await runtime.readActiveRecord("prices", "expired"), null);
  assert.deepEqual(deleted, ["expired"]);
  assert.equal(runtime.stats().deleted, 1);
});


test("coalesces scheduled pruning and records one transaction", async () => {
  let pruneCalls = 0;
  let scheduled = null;
  const runtime = module.createCacheMaintenanceRuntime(globalThis, {
    lifecyclePolicy: policy(),
    pruneIntervalMs: 1000,
    now: () => 5000,
    setTimer: (callback) => { scheduled = callback; return 1; },
    clearTimer: () => {},
    store: {
      readRecord: async () => null,
      deleteRecord: async () => {},
      pruneStore: async () => { pruneCalls += 1; return 3; },
    },
  });

  const first = runtime.schedulePrune("prices", 20, 10);
  const second = runtime.schedulePrune("prices", 20, 10);
  assert.equal(first, second);
  scheduled();
  assert.equal(await first, 3);
  assert.equal(pruneCalls, 1);
  assert.deepEqual(runtime.stats(), {
    runs: 1,
    transactions: 1,
    deleted: 3,
    repaired: 0,
    activePrunes: 0,
    scheduledPrunes: 0,
  });
});

test("repairs invalid records before applying retention pruning", async () => {
  const calls = [];
  const runtime = module.createCacheMaintenanceRuntime(globalThis, {
    lifecyclePolicy: policy(),
    validators: { prices: (record) => record.valid === true },
    store: {
      readRecord: async () => null,
      deleteRecord: async () => {},
      repairStore: async (_store, validate) => {
        calls.push(validate({ valid: false }));
        return 2;
      },
      pruneStore: async () => 1,
    },
  });
  assert.equal(await runtime.pruneStore("prices"), 3);
  assert.deepEqual(calls, [false]);
  assert.equal(runtime.stats().repaired, 2);
  assert.equal(runtime.stats().deleted, 3);
});
