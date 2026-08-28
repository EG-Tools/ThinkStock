import assert from "node:assert/strict";
import test from "node:test";


import * as module from "../../docs/modules/cache-maintenance-runtime.mjs";


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

test("scheduled maintenance uses cooperative checkpoints around expensive store work", async () => {
  const checkpoints = [];
  let scheduledTask = null;
  const runtime = module.createCacheMaintenanceRuntime(globalThis, {
    lifecyclePolicy: policy(),
    scheduler: {
      enqueue(_key, task) {
        scheduledTask = task;
        return Promise.resolve(0);
      },
      cancel() {},
    },
    store: {
      readRecord: async () => null,
      deleteRecord: async () => {},
      pruneStore: async () => 0,
    },
  });

  runtime.schedulePrune("prices", null, 0);
  await scheduledTask({
    signal: null,
    checkpoint: async () => { checkpoints.push("yield"); },
  });
  assert.deepEqual(checkpoints, ["yield", "yield"]);
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

test("persists the maintenance interval across application restarts", async () => {
  let persisted = {};
  let pruneCalls = 0;
  const stateStore = {
    read: () => persisted,
    write: (value) => { persisted = structuredClone(value); },
  };
  const createRuntime = (currentTime, timerSink = null) => module.createCacheMaintenanceRuntime(
    globalThis,
    {
      lifecyclePolicy: policy(),
      pruneIntervalMs: 1000,
      now: () => currentTime,
      stateStore,
      setTimer: (callback) => {
        if (timerSink) timerSink.callback = callback;
        return 1;
      },
      clearTimer: () => {},
      store: {
        readRecord: async () => null,
        deleteRecord: async () => {},
        pruneStore: async () => { pruneCalls += 1; return 0; },
      },
    },
  );

  await createRuntime(5000).pruneStore("prices");
  assert.equal(pruneCalls, 1);
  assert.equal(persisted.prunedAt.prices, 5000);

  assert.equal(await createRuntime(5500).schedulePrune("prices"), 0);
  assert.equal(pruneCalls, 1);

  const timer = {};
  const dueRuntime = createRuntime(7001, timer);
  const dueTask = dueRuntime.schedulePrune("prices", null, 10);
  timer.callback();
  await dueTask;
  assert.equal(pruneCalls, 2);
});

test("runs a full repair only once for each cache schema version", async () => {
  let persisted = {};
  let repairCalls = 0;
  const stateStore = {
    read: () => persisted,
    write: (value) => { persisted = structuredClone(value); },
  };
  const createRuntime = () => module.createCacheMaintenanceRuntime(globalThis, {
    lifecyclePolicy: policy(),
    validators: { prices: (record) => record.valid === true },
    repairVersions: { prices: "price-6" },
    stateStore,
    store: {
      readRecord: async () => null,
      deleteRecord: async () => {},
      repairStore: async () => { repairCalls += 1; return 0; },
      pruneStore: async () => 0,
    },
  });

  await createRuntime().pruneStore("prices");
  await createRuntime().pruneStore("prices");
  assert.equal(repairCalls, 1);
  assert.equal(persisted.repairVersions.prices, "price-6");
});
