import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_DATA_KEYS,
  createAppDataRevisionBridge,
  createAppDataStore,
} from "../../docs/modules/app-data-store.mjs";

test("app data store owns core datasets and versions only real replacements", () => {
  const pricePayload = { records: [{ date: "2026-08-26" }] };
  const store = createAppDataStore({ pricePayload });
  const events = [];
  const unsubscribe = store.subscribe((event) => events.push(event));

  store.pricePayload = pricePayload;
  store.macroRows = [{ date: "2026-08-26", leading_cycle: 100 }];
  const changed = store.patch({
    creditRows: [{ date: "2026-08-26", kospi_credit: 1 }],
    crisisRows: [],
  });

  assert.deepEqual(changed, ["creditRows", "crisisRows"]);
  assert.equal(store.revision("pricePayload"), 0);
  assert.equal(store.revision("macroRows"), 1);
  assert.equal(store.revision("creditRows"), 1);
  assert.equal(store.revision(), 3);
  assert.equal(events.length, 2);
  assert.deepEqual(Object.keys(store.snapshot()), [...APP_DATA_KEYS]);

  unsubscribe();
});

test("app data store rejects accidental unowned datasets", () => {
  const store = createAppDataStore();
  assert.throws(() => store.patch({ unknownRows: [] }), /Unknown app data key/);
  assert.equal(Object.isSealed(store), true);
  assert.equal(Reflect.set(store, "unknownRows", []), false);
});

test("app data store can explicitly version a real in-place price mutation", () => {
  const payload = { records: [] };
  const store = createAppDataStore({ pricePayload: payload });
  const events = [];
  store.subscribe((event) => events.push(event));

  payload.records.push({ date: "2026-08-28", value: 100 });
  store.touch("pricePayload");

  assert.equal(store.revision("pricePayload"), 1);
  assert.deepEqual(events[0].changed, ["pricePayload"]);
});

test("app data store can suppress semantically unchanged network rows", () => {
  const events = [];
  const store = createAppDataStore({
    macroRows: [{ date: "2026-08-28", leading_cycle: 101 }],
  }, {
    equalsByKey: {
      macroRows: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    },
  });
  store.subscribe((event) => events.push(event));

  store.macroRows = [{ date: "2026-08-28", leading_cycle: 101 }];

  assert.equal(store.revision(), 0);
  assert.equal(events.length, 0);
  assert.deepEqual(store.stats(), {
    revision: 0,
    replacements: 0,
    touches: 0,
    skipped: 1,
    revisions: Object.fromEntries(APP_DATA_KEYS.map((key) => [key, 0])),
  });
});

test("revision bridge maps one data replacement to one persisted component invalidation", () => {
  const store = createAppDataStore();
  const revisions = [];
  let refreshes = 0;
  const bridge = createAppDataRevisionBridge(store, {
    markChanged: (components) => revisions.push(components),
    onChanged: () => { refreshes += 1; },
  });

  store.patch({
    macroRows: [{ date: "2026-08-28" }],
    creditRows: [{ date: "2026-08-28" }],
  });
  store.insiderTradeRows = [{ date: "2026-08-28" }];

  assert.deepEqual(revisions, [["macro", "credit"]]);
  assert.equal(refreshes, 1);
  bridge.dispose();
});
