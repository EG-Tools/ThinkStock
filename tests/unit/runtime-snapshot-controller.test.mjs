import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/runtime-snapshot-controller.js");
const module = globalThis.ThinkStockRuntimeSnapshotController;


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
