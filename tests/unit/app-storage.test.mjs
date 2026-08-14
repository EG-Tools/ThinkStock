import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";


const source = await readFile(new URL("../../docs/modules/app-storage.js", import.meta.url), "utf8");

function loadModule(scope = {}) {
  const context = vm.createContext({
    ...scope,
    self: scope,
    globalThis: scope,
    Object,
    String,
    Number,
    Date,
    JSON,
    Set,
    Promise,
    Error,
  });
  vm.runInContext(source, context);
  return scope.ThinkStockAppStorage;
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

function createIndexedDb() {
  const stores = new Map();
  const stats = { opens: 0, closes: 0 };
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => { stores.set(name, new Map()); },
    close: () => { stats.closes += 1; },
    transaction(storeName) {
      const values = stores.get(storeName);
      let completionQueued = false;
      const transaction = {
        error: null,
        objectStore() {
          const resultRequest = (value) => {
            const request = { result: null, error: null };
            setTimeout(() => {
              request.result = value;
              request.onsuccess?.();
            }, 0);
            return request;
          };
          const queueComplete = () => {
            if (completionQueued) return;
            completionQueued = true;
            setTimeout(() => transaction.oncomplete?.(), 0);
          };
          return {
            get: (key) => resultRequest(values.get(key)),
            getAll: () => resultRequest([...values.values()]),
            put: (value, key) => { values.set(key, value); queueComplete(); },
            delete: (key) => { values.delete(key); queueComplete(); },
            clear: () => { values.clear(); queueComplete(); },
          };
        },
        abort() {
          transaction.onabort?.();
        },
      };
      return transaction;
    },
  };
  return {
    stats,
    stores,
    open() {
      stats.opens += 1;
      const request = { result: database, error: null };
      setTimeout(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}

test("API settings are sanitized, mirrored, and loaded from persistent storage first", () => {
  const localStorage = createStorage({
    local: JSON.stringify({ token: " local-value ", enabled: true }),
  });
  const sessionStorage = createStorage({
    session: JSON.stringify({ token: "session-value", enabled: false }),
  });
  const module = loadModule({ localStorage, sessionStorage });
  const store = module.createApiSettingsStore(
    { localStorage, sessionStorage },
    {
      defaults: { token: "", enabled: false },
      localKey: "local",
      sessionKey: "session",
    },
  );

  assert.deepEqual({ ...store.load() }, { token: "local-value", enabled: true });
  assert.deepEqual(
    JSON.parse(sessionStorage.values.get("session")),
    { token: "local-value", enabled: true },
  );

  store.clear();
  assert.equal(localStorage.values.has("local"), false);
  assert.equal(sessionStorage.values.has("session"), false);
});

test("API settings fall back to session storage when persistent data is invalid", () => {
  const localStorage = createStorage({ local: "not-json" });
  const sessionStorage = createStorage({
    session: JSON.stringify({ token: " fallback ", enabled: "yes" }),
  });
  const module = loadModule({ localStorage, sessionStorage });
  const store = module.createApiSettingsStore(
    { localStorage, sessionStorage },
    {
      defaults: { token: "", enabled: false },
      localKey: "local",
      sessionKey: "session",
    },
  );

  assert.deepEqual({ ...store.load() }, { token: "fallback", enabled: false });
});

test("JSON storage returns a fallback for damaged data and centralizes removal", () => {
  const storage = createStorage({ state: "not-json" });
  const module = loadModule({ localStorage: storage });
  const store = module.createJsonStore({ localStorage: storage }, { key: "state" });

  assert.deepEqual({ ...store.read({ safe: true }) }, { safe: true });
  assert.deepEqual({ ...store.write({ active: 1 }) }, { active: 1 });
  assert.deepEqual(JSON.parse(storage.values.get("state")), { active: 1 });
  store.remove();
  assert.equal(storage.values.has("state"), false);
});

test("cache pruning removes idle records before least-recent overflow", () => {
  const module = loadModule();
  const deleteKeys = module.planPruneKeys([
    { ticker: "OLD", lastAccessed: 1000 },
    { ticker: "A", lastAccessed: 9000 },
    { ticker: "B", lastAccessed: 8000 },
    { ticker: "C", lastAccessed: 7000 },
  ], {
    now: 10000,
    maxIdleMs: 5000,
    maxRecords: 2,
  });

  assert.deepEqual([...deleteKeys], ["OLD", "C"]);
});

test("IndexedDB connection is reused and batch records share one transaction", async () => {
  const indexedDB = createIndexedDb();
  const module = loadModule({ indexedDB });
  const store = module.createIndexedCacheStore({ indexedDB }, {
    dbName: "test-db",
    storeNames: ["history"],
  });

  await store.writeRecords("history", new Map([
    ["A", { ticker: "A", close: 10 }],
    ["B", { ticker: "B", close: 20 }],
  ]));
  const records = await store.readRecords("history", ["A", "B", "MISSING"]);
  assert.deepEqual(records.get("A"), { ticker: "A", close: 10 });
  assert.deepEqual(records.get("B"), { ticker: "B", close: 20 });
  assert.equal(records.get("MISSING"), null);
  assert.deepEqual(await store.readRecord("history", "A"), { ticker: "A", close: 10 });
  assert.equal(indexedDB.stats.opens, 1);
  assert.equal(indexedDB.stats.closes, 0);

  store.close();
  assert.equal(indexedDB.stats.closes, 1);
});
