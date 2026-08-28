import assert from "node:assert/strict";
import test from "node:test";


import * as module from "../../docs/modules/runtime-snapshot-controller.mjs";


test("deduplicates identical snapshots and tracks component writes", async () => {
  let signature = "price:1";
  const writes = [];
  const controller = module.createRuntimeSnapshotController(globalThis, {
    getSignature: () => signature,
    buildSnapshot: () => ({
      manifest: { revisions: { price: Number(signature.split(":")[1]) } },
      components: { price: [{ date: "2026-08-13" }] },
    }),
    applySnapshot: () => false,
    writePrimary: async (snapshot) => writes.push(snapshot),
  });

  assert.equal(await controller.save(), true);
  assert.equal(await controller.save(), false);
  signature = "price:2";
  assert.equal(await controller.save(), true);
  assert.equal(writes.length, 2);
  assert.deepEqual(controller.persistedRevisions(), { price: 2 });
  assert.deepEqual(controller.stats(), {
    builds: 2,
    writes: 2,
    skips: 1,
    componentWrites: 2,
    idlePending: false,
    savePending: false,
    writePending: false,
  });
});


test("falls back to compact storage when IndexedDB writing fails", async () => {
  let fallback = null;
  const controller = module.createRuntimeSnapshotController(globalThis, {
    getSignature: () => "macro:1",
    buildSnapshot: () => ({ manifest: { revisions: { macro: 1 } }, components: { macro: [] } }),
    buildFallbackSnapshot: () => ({ compact: true }),
    applySnapshot: () => false,
    writePrimary: async () => { throw new Error("blocked"); },
    writeFallback: (value) => { fallback = value; },
  });

  assert.equal(await controller.save(), true);
  assert.deepEqual(fallback, { compact: true });
  assert.deepEqual(controller.persistedRevisions(), {});
});


test("loads the primary snapshot and clears an invalid restored record", async () => {
  let deleted = 0;
  const snapshot = { version: 1 };
  const controller = module.createRuntimeSnapshotController(globalThis, {
    getSignature: () => "",
    buildSnapshot: () => null,
    applySnapshot: () => false,
    readPrimary: async () => snapshot,
    deletePrimary: async () => { deleted += 1; },
  });

  assert.equal(await controller.load(), false);
  assert.equal(deleted, 1);
});


test("coalesces delayed saves behind one idle callback", async () => {
  let timerCallback = null;
  let idleCallback = null;
  let writes = 0;
  const controller = module.createRuntimeSnapshotController(globalThis, {
    getSignature: () => "price:1",
    buildSnapshot: () => ({ manifest: { revisions: { price: 1 } }, components: {} }),
    applySnapshot: () => false,
    writePrimary: async () => { writes += 1; },
    setTimer: (callback) => { timerCallback = callback; return 1; },
    clearTimer: () => {},
    requestIdle: (callback) => { idleCallback = callback; return 2; },
    cancelIdle: () => {},
  });

  controller.schedule(100);
  controller.schedule(200);
  timerCallback();
  idleCallback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writes, 1);
});

test("routes delayed snapshot saves through the shared background scheduler", async () => {
  const scheduled = [];
  let cancelled = "";
  let writes = 0;
  const scheduler = {
    enqueue(key, task, options) {
      scheduled.push({ key, task, options });
      return Promise.resolve(true);
    },
    cancel(key) { cancelled = key; return true; },
  };
  const controller = module.createRuntimeSnapshotController(globalThis, {
    scheduler,
    schedulerKey: "snapshot-test",
    schedulerPriority: -25,
    getSignature: () => "price:1",
    buildSnapshot: () => ({ manifest: { revisions: { price: 1 } }, components: {} }),
    applySnapshot: () => false,
    writePrimary: async () => { writes += 1; },
  });

  controller.schedule(2400);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].key, "snapshot-test");
  assert.deepEqual(scheduled[0].options, { delayMs: 2400, priority: -25 });
  assert.equal(controller.stats().savePending, true);
  await scheduled[0].task();
  assert.equal(writes, 1);
  assert.equal(controller.stats().savePending, false);

  controller.schedule(100);
  controller.cancelScheduledSave();
  assert.equal(cancelled, "snapshot-test");
});

test("passes the cooperative scheduler context through an asynchronous snapshot build", async () => {
  let scheduledTask = null;
  const context = {
    signal: null,
    shouldYield: () => true,
    checkpoint: async () => true,
  };
  const received = [];
  const controller = module.createRuntimeSnapshotController(globalThis, {
    scheduler: {
      enqueue(_key, task) {
        scheduledTask = task;
        return Promise.resolve(true);
      },
      cancel() {},
    },
    getSignature: () => "price:1",
    buildSnapshot: async (taskContext) => {
      received.push(taskContext);
      await taskContext.checkpoint();
      return { manifest: { revisions: { price: 1 } }, components: { price: [] } };
    },
    applySnapshot: () => false,
    writePrimary: async () => {},
  });

  controller.schedule(0);
  assert.equal(typeof scheduledTask, "function");
  assert.equal(await scheduledTask(context), true);
  assert.deepEqual(received, [context]);
  assert.equal(controller.stats().componentWrites, 1);
});

test("removes exit-save listeners when the snapshot runtime is disposed", () => {
  const listeners = new Map();
  const documentListeners = new Map();
  const scope = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      if (listeners.get(name) === handler) listeners.delete(name);
    },
    document: {
      visibilityState: "visible",
      addEventListener: (name, handler) => documentListeners.set(name, handler),
      removeEventListener: (name, handler) => {
        if (documentListeners.get(name) === handler) documentListeners.delete(name);
      },
    },
  };
  const controller = module.createRuntimeSnapshotController(scope, {
    getSignature: () => "",
    buildSnapshot: () => null,
    applySnapshot: () => false,
  });

  assert.equal(controller.bindExitSave(), true);
  assert.equal(controller.bindExitSave(), false);
  assert.equal(listeners.has("pagehide"), true);
  assert.equal(documentListeners.has("visibilitychange"), true);
  controller.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(documentListeners.size, 0);
  assert.equal(controller.bindExitSave(), true);
});

test("reuses a normalized snapshot component until its source revision changes", () => {
  const tracker = module.createRevisionTracker(["price", "macro"]);
  let normalizations = 0;
  const normalizePrice = () => {
    normalizations += 1;
    return { records: [{ date: "2026-08-27", value: 100 }] };
  };

  const first = tracker.getComponent("price", normalizePrice);
  const second = tracker.getComponent("price", normalizePrice);
  assert.equal(first, second);
  assert.equal(normalizations, 1);
  assert.deepEqual(tracker.stats(), {
    hits: 1,
    misses: 1,
    invalidations: 0,
    seeds: 0,
    entries: 1,
  });

  tracker.markChanged(["price"]);
  const third = tracker.getComponent("price", normalizePrice);
  assert.notEqual(third, first);
  assert.equal(normalizations, 2);
  assert.deepEqual(tracker.stats(), {
    hits: 1,
    misses: 2,
    invalidations: 1,
    seeds: 0,
    entries: 1,
  });
});

test("normalizes current and restored snapshot components through one contract", () => {
  const contract = module.createSnapshotComponentContract({
    price: {
      snapshotKey: "pricePayload",
      dataKey: "pricePayload",
      required: true,
      normalize: (value) => ({ records: Array.isArray(value?.records) ? value.records : [] }),
      validate: (value) => value.records.length > 0,
    },
    macro: {
      snapshotKey: "macroRows",
      dataKey: "macroRows",
      isIncluded: Array.isArray,
      normalize: (value) => [...value].sort((left, right) => left.date.localeCompare(right.date)),
    },
  });

  assert.deepEqual(contract.names, ["price", "macro"]);
  assert.deepEqual(contract.normalizeCurrent("macro", {
    macroRows: [{ date: "2026-08-02" }, { date: "2026-08-01" }],
  }), [{ date: "2026-08-01" }, { date: "2026-08-02" }]);

  const restored = contract.prepareRestore({
    pricePayload: { records: [{ date: "2026-08-28" }] },
    macroRows: [{ date: "2026-08-02" }, { date: "2026-08-01" }],
  });
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.loadedNames, ["price", "macro"]);
  assert.deepEqual(restored.patch, {
    pricePayload: { records: [{ date: "2026-08-28" }] },
    macroRows: [{ date: "2026-08-01" }, { date: "2026-08-02" }],
  });
  assert.equal(contract.prepareRestore({ pricePayload: { records: [] } }).ok, false);
});
