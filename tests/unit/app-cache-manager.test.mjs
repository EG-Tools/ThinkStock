import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import * as appCacheManagerModule from "../../docs/modules/app-cache-manager.mjs";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

function loadModule(scope) {
  scope.TextEncoder = TextEncoder;
  return appCacheManagerModule;
}

function createCacheStorage(entriesByName) {
  const entries = new Map(Object.entries(entriesByName));
  return {
    async keys() { return [...entries.keys()]; },
    async delete(name) { return entries.delete(name); },
    async open(name) {
      const records = entries.get(name) || [];
      return {
        async keys() { return records.map((record) => record.request); },
        async match(request) {
          return records.find((record) => record.request.url === request.url)?.response || null;
        },
      };
    },
    entries,
  };
}

function responseWithBytes(size) {
  return {
    clone() { return this; },
    async arrayBuffer() { return new Uint8Array(size).buffer; },
    headers: { get: () => null },
  };
}

test("app cache size combines only configured ThinkStock storage", async () => {
  const localStorage = createStorage({ cache: "abc", secret: "keep-me" });
  const sessionStorage = createStorage({ sessionCache: "xy" });
  const indexedRecords = new Map([
    ["snapshots", [{ rows: [1, 2, 3] }]],
    ["journal", [{ prediction: "keep" }]],
  ]);
  const indexedCacheStore = {
    async readAllRecords(name) { return indexedRecords.get(name) || []; },
    async clearStore(name) { indexedRecords.set(name, []); },
  };
  const request = { url: "https://example.test/ThinkStock/app.js" };
  const caches = createCacheStorage({
    "thinkstock-shell": [{ request, response: responseWithBytes(2048) }],
    "another-app": [{ request: { url: "https://example.test/other.js" }, response: responseWithBytes(4096) }],
  });
  const scope = { caches, localStorage, sessionStorage };
  const module = loadModule(scope);
  const manager = module.createAppCacheManager(scope, {
    indexedCacheStore,
    indexedStoreNames: ["snapshots"],
    localStorageKeys: ["cache"],
    sessionStorageKeys: ["sessionCache"],
  });

  const summary = await manager.measure();
  const encoder = new TextEncoder();
  assert.equal(summary.localBytes, encoder.encode("cacheabc").byteLength);
  assert.equal(summary.sessionBytes, encoder.encode("sessionCachexy").byteLength);
  assert.equal(summary.indexedBytes, encoder.encode(JSON.stringify({ rows: [1, 2, 3] })).byteLength);
  assert.equal(summary.browserCacheBytes, encoder.encode(request.url).byteLength + 2048);
  assert.equal(summary.totalBytes, summary.localBytes
    + summary.sessionBytes
    + summary.indexedBytes
    + summary.browserCacheBytes);

  await manager.clear();
  assert.equal(localStorage.values.has("cache"), false);
  assert.equal(localStorage.values.get("secret"), "keep-me");
  assert.equal(sessionStorage.values.has("sessionCache"), false);
  assert.deepEqual(indexedRecords.get("snapshots"), []);
  assert.deepEqual(indexedRecords.get("journal"), [{ prediction: "keep" }]);
  assert.equal(caches.entries.has("thinkstock-shell"), false);
  assert.equal(caches.entries.has("another-app"), true);
  assert.equal((await manager.measure()).totalBytes, 0);
});

test("cache size labels stay compact and readable", () => {
  const module = loadModule({});
  assert.equal(module.formatBytes(0), "0B");
  assert.equal(module.formatBytes(512 * 1024), "512KB");
  assert.equal(module.formatBytes(5.2 * 1024 * 1024), "5.2MB");
});

test("cache measurement stays complete across many bounded IndexedDB records", async () => {
  const records = Array.from({ length: 600 }, (_, index) => ({
    ticker: `T${index}`,
    values: [index, index + 1, index + 2],
  }));
  const scope = { localStorage: createStorage(), sessionStorage: createStorage() };
  const module = loadModule(scope);
  const manager = module.createAppCacheManager(scope, {
    indexedCacheStore: {
      async readAllRecords(name) {
        return name === "prices" ? records : [{ ticker: "AI", values: [1] }];
      },
    },
    indexedStoreNames: ["prices", "analysis"],
  });
  const encoder = new TextEncoder();
  const expected = records.reduce((sum, record) => (
    sum + encoder.encode(JSON.stringify(record)).byteLength
  ), encoder.encode(JSON.stringify({ ticker: "AI", values: [1] })).byteLength);

  const measured = await manager.measure();
  assert.equal(measured.indexedBytes, expected);
  assert.equal(measured.totalBytes, expected);
  const circular = {};
  circular.self = circular;
  assert.equal(module.byteLength(scope, circular), 0);
});

test("simultaneous and repeated capacity checks reuse one bounded measurement", async () => {
  let indexedReads = 0;
  let bodyReads = 0;
  const request = { url: "https://example.test/ThinkStock/app.js" };
  const caches = createCacheStorage({
    "thinkstock-shell": [{ request, response: {
      clone() { return this; },
      headers: { get: () => "2048" },
      async arrayBuffer() { bodyReads += 1; throw new Error("body should not be read"); },
    } }],
  });
  const manager = appCacheManagerModule.createAppCacheManager({ caches, TextEncoder }, {
    indexedCacheStore: {
      async readAllRecords() { indexedReads += 1; return [{ value: 1 }]; },
    },
    indexedStoreNames: ["prices"],
  });
  const [first, concurrent] = await Promise.all([manager.measure(), manager.measure()]);
  assert.equal(first, concurrent);
  assert.equal(indexedReads, 1);
  assert.equal(bodyReads, 0);
  assert.equal((await manager.measure()).totalBytes, first.totalBytes);
  assert.equal(indexedReads, 1);
  await manager.measure({ full: true });
  assert.equal(indexedReads, 2);
});

test("clearing app caches invalidates the service worker active data cache", async () => {
  const messages = [];
  const scope = {
    MessageChannel,
    navigator: { serviceWorker: { controller: {
      postMessage(message, ports) {
        messages.push(message);
        ports[0].postMessage({ ok: true });
      },
    } } },
  };
  await appCacheManagerModule.createAppCacheManager(scope).clear();
  assert.deepEqual(messages, ["INVALIDATE_DATA_CACHE_INFO"]);
});

test("partial cache clearing still invalidates the service worker lookup", async () => {
  const messages = [];
  const scope = {
    MessageChannel,
    navigator: { serviceWorker: { controller: {
      postMessage(message, ports) {
        messages.push(message);
        ports[0].postMessage({ ok: true });
      },
    } } },
  };
  const manager = appCacheManagerModule.createAppCacheManager(scope, {
    indexedCacheStore: { async clearStore() { throw new Error("database unavailable"); } },
    indexedStoreNames: ["prices"],
  });
  await assert.rejects(manager.clear(), /일부 캐시/);
  assert.deepEqual(messages, ["INVALIDATE_DATA_CACHE_INFO"]);
});
